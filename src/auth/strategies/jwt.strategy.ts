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
  // Ngoại lệ có chủ đích của quy tắc "không cache RAM": đây là auth infra, không phải dữ liệu
  // nghiệp vụ. Mở 1 trang bắn nhiều request song song — mỗi cái là 1 query user qua pooler
  // (~100-200ms round-trip). Cache theo id, TTL NGẮN: khoá tài khoản / đổi trạng thái có hiệu
  // lực chậm nhất sau TTL (mặc định 15s, chỉnh qua JWT_USER_CACHE_TTL_MS). Cache theo instance.
  private readonly userCache = new Map<
    string,
    { user: CachedAuthUser; at: number }
  >();
  private readonly userCacheTtlMs =
    Number(process.env.JWT_USER_CACHE_TTL_MS) || 15_000;

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
