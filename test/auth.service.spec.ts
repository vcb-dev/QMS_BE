import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthService } from '../src/auth/auth.service';
import { EmailThrottlerGuard } from '../src/auth/guards/email-throttler.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';

describe('AuthService & JwtStrategy - Token Separation (Item 9)', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let jwtStrategy: JwtStrategy;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });
    config = {
      get: jest.fn((key: string, defaultVal?: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        if (key === 'JWT_ACCESS_EXPIRES') return '15m';
        if (key === 'JWT_REFRESH_EXPIRES') return '7d';
        return defaultVal;
      }),
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'test@example.com',
          role: 'ADMIN',
          isActive: true,
          isApproved: true,
        }),
      },
    };

    authService = new AuthService(
      prisma,
      jwtService,
      config,
      {} as any, // MailService
    );

    jwtStrategy = new JwtStrategy(config, prisma);
  });

  it('generateTokens -> decode access token có type: "access", refresh token có type: "refresh"', async () => {
    const tokens = await authService.generateTokens({
      id: 'u1',
      email: 'test@example.com',
      role: 'ADMIN',
    });

    const accessPayload: any = jwtService.decode(tokens.accessToken);
    const refreshPayload: any = jwtService.decode(tokens.refreshToken);

    expect(accessPayload.type).toBe('access');
    expect(refreshPayload.type).toBe('refresh');
    expect(accessPayload.sub).toBe('u1');
    expect(refreshPayload.sub).toBe('u1');
  });

  it('verifyRefreshToken(accessToken) -> ném UnauthorizedException', async () => {
    const tokens = await authService.generateTokens({
      id: 'u1',
      email: 'test@example.com',
      role: 'ADMIN',
    });

    expect(() => authService.verifyRefreshToken(tokens.accessToken)).toThrow(
      UnauthorizedException,
    );
  });

  it('JwtStrategy.validate({ sub, email, role, type: "refresh" }) -> ném UnauthorizedException', async () => {
    await expect(
      jwtStrategy.validate({
        sub: 'u1',
        email: 'test@example.com',
        role: 'ADMIN',
        type: 'refresh',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('JwtStrategy.validate({ sub, email, role }) (không có type) -> không ném lỗi ở bước kiểm type (tương thích ngược)', async () => {
    const res = await jwtStrategy.validate({
      sub: 'u1',
      email: 'test@example.com',
      role: 'ADMIN',
    });

    expect(res).toEqual({
      id: 'u1',
      email: 'test@example.com',
      role: 'ADMIN',
    });
  });
});

describe('Password Reset OTP & Throttler (Item 10)', () => {
  let authService: AuthService;
  let prisma: any;
  let mailService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'target@example.com',
          name: 'Target User',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mailService = {
      sendForgotPasswordOtp: jest.fn().mockResolvedValue(undefined),
    };

    authService = new AuthService(
      prisma,
      new JwtService({ secret: 'test-secret' }),
      { get: jest.fn() } as any,
      mailService,
    );
  });

  it('OTP sinh ra nằm trong [100000, 999999]', async () => {
    for (let i = 0; i < 50; i++) {
      await authService.forgotPassword({ email: 'target@example.com' });
      const lastCallArgs = mailService.sendForgotPasswordOtp.mock.calls.slice(-1)[0];
      const otp = lastCallArgs[2];
      expect(otp).toHaveLength(6);
      const num = Number(otp);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  describe('EmailThrottlerGuard', () => {
    let guard: EmailThrottlerGuard;
    let storage: ThrottlerStorageService;

    function createMockContext(body: any, ip = '127.0.0.1'): ExecutionContext {
      const req = { body, ip, headers: {} };
      const res = { setHeader: jest.fn(), header: jest.fn() };
      return {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
        getClass: () => class TestController {},
        getHandler: () => function testHandler() {},
      } as unknown as ExecutionContext;
    }

    beforeEach(async () => {
      storage = new ThrottlerStorageService();
      guard = new EmailThrottlerGuard(
        {
          throttlers: [{ name: 'default', ttl: 15 * 60 * 1000, limit: 5 }],
        },
        storage,
        new Reflector(),
      );
      await guard.onModuleInit();
    });

    afterEach(() => {
      storage.onApplicationShutdown();
    });

    it('getTracker với body không có email -> trả req.ip, không ném lỗi', async () => {
      const trackerEmpty = await guard['getTracker']({ body: {}, ip: '192.168.1.1' });
      expect(trackerEmpty).toBe('192.168.1.1');

      const trackerNullBody = await guard['getTracker']({ ip: '10.0.0.1' });
      expect(trackerNullBody).toBe('10.0.0.1');

      const trackerBlankEmail = await guard['getTracker']({ body: { email: '   ' }, ip: '10.0.0.2' });
      expect(trackerBlankEmail).toBe('10.0.0.2');
    });

    it('5 request cùng một email -> request thứ 6 trả 429 (ThrottlerException)', async () => {
      const email = 'victim@example.com';
      for (let i = 0; i < 5; i++) {
        const can = await guard.canActivate(createMockContext({ email }));
        expect(can).toBe(true);
      }

      await expect(
        guard.canActivate(createMockContext({ email })),
      ).rejects.toThrow(ThrottlerException);
    });

    it('Cùng lúc đó, email khác vẫn gọi được (chứng minh key theo email, không phải IP)', async () => {
      const victim = 'victim@example.com';
      const attacker = 'other@example.com';

      // 5 requests from same IP for victim -> 6th fails
      for (let i = 0; i < 5; i++) {
        await guard.canActivate(createMockContext({ email: victim }, '1.2.3.4'));
      }
      await expect(
        guard.canActivate(createMockContext({ email: victim }, '1.2.3.4')),
      ).rejects.toThrow(ThrottlerException);

      // Same IP '1.2.3.4' but different email -> still passes
      const canOther = await guard.canActivate(
        createMockContext({ email: attacker }, '1.2.3.4'),
      );
      expect(canOther).toBe(true);
    });
  });
});

describe('AuthService.getProfile — trả team, không lộ trường bí mật', () => {
  let authService: AuthService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          name: 'Sale A',
          email: 'a@example.com',
          role: 'SALE',
          avatar: null,
          isApproved: true,
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          team: { id: 't1', name: 'Team A' },
          // Các trường bí mật mà findUnique (không select) sẽ trả kèm
          passwordHash: 'hash',
          refreshTokenHash: 'rhash',
          resetTokenHash: 'xhash',
          resetTokenExpires: new Date(),
        }),
      },
    };
    authService = new AuthService(
      prisma,
      new JwtService({ secret: 'test-secret' }),
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('gọi findUnique với include team { id, name }', async () => {
    await authService.getProfile('u1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        include: { team: { select: { id: true, name: true } } },
      }),
    );
  });

  it('kết quả có team và KHÔNG có passwordHash/refreshTokenHash/resetTokenHash/resetTokenExpires', async () => {
    const profile: any = await authService.getProfile('u1');
    expect(profile.team).toEqual({ id: 't1', name: 'Team A' });
    expect(profile.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    for (const secret of [
      'passwordHash',
      'refreshTokenHash',
      'resetTokenHash',
      'resetTokenExpires',
    ]) {
      expect(profile).not.toHaveProperty(secret);
    }
  });

  it('người dùng không tồn tại → UnauthorizedException', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(authService.getProfile('ghost')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
