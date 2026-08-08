import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { COOKIE_ACCESS } from '../cookie.constants';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
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
            const headerToken = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
            if (headerToken && headerToken !== 'undefined' && headerToken !== 'null') {
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
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
