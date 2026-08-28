import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { COOKIE_ACCESS } from '../cookie/cookie.constants';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

interface CachedAuthUser {
  id: string;
  email: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Cache user hợp lệ theo id — mở 1 trang bắn 6-8 request song song, mỗi cái trước đây là 1 lượt
  // query DB xác thực (BEGIN/SELECT/COMMIT/DEALLOCATE qua pooler ~200ms mỗi round-trip). TTL ngắn:
  // khóa user / đổi role có hiệu lực chậm nhất sau TTL (mặc định 30s, chỉnh qua JWT_USER_CACHE_TTL_MS).
  // Cache theo từng instance — chạy nhiều instance thì mỗi instance stale tối đa TTL độc lập.
  private readonly userCache = new Map<
    string,
    { user: CachedAuthUser; at: number }
  >();
  private readonly userCacheTtlMs =
    Number(process.env.JWT_USER_CACHE_TTL_MS) || 30_000;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const jwtSecret = config.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('Cấu hình thiếu biến môi trường JWT_SECRET trong .env');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          let token: string | null = null;
          if (request && request.cookies && request.cookies[COOKIE_ACCESS]) {
            token = request.cookies[COOKIE_ACCESS];
          }
          if (!token) {
            const headerToken =
              ExtractJwt.fromAuthHeaderAsBearerToken()(request);
            if (
              headerToken &&
              headerToken !== 'undefined' &&
              headerToken !== 'null'
            ) {
              token = headerToken;
            }
          }
          return token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Token không hợp lệ');
    }

    const cached = this.userCache.get(payload.sub);
    if (cached && Date.now() - cached.at < this.userCacheTtlMs) {
      return cached.user;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isApproved: true,
      },
    });

    if (!user || !user.isActive || !user.isApproved) {
      this.userCache.delete(payload.sub);
      throw new UnauthorizedException(
        'Người dùng không hợp lệ hoặc chưa được phê duyệt',
      );
    }

    const authUser: CachedAuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    // Chặn Map phình vô hạn (nội bộ ít user, nhưng vẫn phòng): quá ngưỡng thì xóa sạch, TTL tự dựng lại.
    if (this.userCache.size > 5_000) this.userCache.clear();
    this.userCache.set(payload.sub, { user: authUser, at: Date.now() });
    return authUser;
  }
}
