import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'crypto';
import {APP_CONSTANTS} from '../../common/constants';
import {
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_REFRESH,
} from './cookie.constants';

@Injectable()
export class CookieAuthService {
  constructor(private readonly config: ConfigService) {}

  cookieFlags(): Pick<CookieOptions, 'secure' | 'sameSite'> {
    const sameSite = APP_CONSTANTS.COOKIE_SAMESITE;
    return {
      sameSite,
      // SameSite=None bắt buộc Secure; ép true để browser không nuốt cookie.
      secure: APP_CONSTANTS.COOKIE_SECURE || sameSite === 'none',
    };
  }

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      ...this.cookieFlags(),
      path: '/',
    };
  }

  setAuthCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const accessMaxAge = this.parseDurationMs(
      this.config.get<string>('JWT_ACCESS_EXPIRES', APP_CONSTANTS.JWT_ACCESS_EXPIRES),
    );
    const refreshMaxAge = this.parseDurationMs(
      this.config.get<string>('JWT_REFRESH_EXPIRES', APP_CONSTANTS.JWT_REFRESH_EXPIRES),
    );
    const csrf = randomBytes(32).toString('hex');

    res.cookie(COOKIE_ACCESS, tokens.accessToken, {
      ...this.baseOptions(),
      maxAge: accessMaxAge,
    });

    res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
      ...this.baseOptions(),
      maxAge: refreshMaxAge,
      path: '/api/auth',
    });

    res.cookie(COOKIE_CSRF, csrf, {
      httpOnly: false,
      ...this.cookieFlags(),
      path: '/',
      maxAge: refreshMaxAge,
    });
  }

  clearAuthCookies(res: Response) {
    const flags = this.cookieFlags();
    res.clearCookie(COOKIE_ACCESS, { path: '/', ...flags });
    res.clearCookie(COOKIE_REFRESH, {
      path: '/api/auth',
      ...flags,
    });
    res.clearCookie(COOKIE_CSRF, { path: '/', ...flags });
  }

  private parseDurationMs(value: string): number {
    const v = value.trim().toLowerCase();
    const m = /^(\d+)([smhd])$/.exec(v);
    if (!m) return 7 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    const mult =
      unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mult;
  }
}
