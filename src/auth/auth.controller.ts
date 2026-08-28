import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Res,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { CookieAuthService } from './cookie/cookie-auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { COOKIE_REFRESH } from './cookie/cookie.constants';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import { APP_CONSTANTS } from '../common/constants';
import { SkipCsrf } from './decorators/skip-csrf.decorator';

const LARK_STATE_COOKIE = 'lark_oauth_state';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieAuthService: CookieAuthService,
    private readonly configService: ConfigService,
  ) {}

  @Throttle({
    default: {
      ttl: APP_CONSTANTS.THROTTLE_TTL,
      limit: APP_CONSTANTS.THROTTLE_LIMIT,
    },
  })
  @SkipCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);

    // Ghi token vào HttpOnly Cookies an toàn (chống XSS)
    this.cookieAuthService.setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    return {
      message: 'Đăng nhập thành công',
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      req.cookies?.[COOKIE_REFRESH] || req.body?.refreshToken;
    const result = await this.authService.refreshTokens(refreshToken);

    this.cookieAuthService.setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });

    return {
      message: 'Cấp mới token thành công',
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[COOKIE_REFRESH];
    if (refreshToken) {
      try {
        const payload = this.authService.verifyRefreshToken(refreshToken);
        if (payload?.sub) {
          await this.authService.logout(payload.sub);
        }
      } catch {
        // Token đã hết hạn hoặc không hợp lệ, tiếp tục xóa cookie
      }
    }

    this.cookieAuthService.clearAuthCookies(res);
    return { message: 'Đăng xuất thành công' };
  }

  @SkipCsrf()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    const result = await this.authService.register(registerDto);

    return {
      message: result.message,
      user: result.user,
    };
  }

  @SkipCsrf()
  @Throttle({
    default: {
      ttl: APP_CONSTANTS.THROTTLE_TTL,
      limit: APP_CONSTANTS.THROTTLE_LIMIT,
    },
  })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @SkipCsrf()
  @Throttle({
    default: {
      ttl: APP_CONSTANTS.THROTTLE_TTL,
      limit: APP_CONSTANTS.THROTTLE_LIMIT,
    },
  })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @SkipCsrf()
  @Throttle({
    default: {
      ttl: APP_CONSTANTS.THROTTLE_TTL,
      limit: APP_CONSTANTS.THROTTLE_LIMIT,
    },
  })
  @Get('lark')
  larkLogin(@Res() res: Response) {
    const appId = this.configService.get<string>('LARK_APP_ID');
    const redirectUri = this.configService.get<string>('LARK_REDIRECT_URI');
    console.log(
      'Lark OAuth login requested. App ID:',
      appId,
      'Redirect URI:',
      redirectUri,
    );
    if (!appId || !redirectUri) {
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Lark OAuth chưa được cấu hình');
    }

    // State chống CSRF: lưu vào cookie HttpOnly ngắn hạn, đối chiếu lại ở callback
    const state = randomBytes(16).toString('hex');
    res.cookie(LARK_STATE_COOKIE, state, {
      httpOnly: true,
      secure:
        this.configService.get<string>('COOKIE_SECURE', 'false') === 'true',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 10 * 60 * 1000, // 10 phút
    });

    const larkAuthUrl = `${APP_CONSTANTS.LARK_OAUTH_AUTHORIZE_URL}?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return res.redirect(larkAuthUrl);
  }

  @SkipCsrf()
  @Get('lark/callback')
  async larkCallback(@Req() req: Request, @Res() res: Response) {
    const { code, error, state } = req.query;
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    const expectedState = req.cookies?.[LARK_STATE_COOKIE];
    res.clearCookie(LARK_STATE_COOKIE, {
      path: '/api/auth',
      sameSite: 'lax',
      secure:
        this.configService.get<string>('COOKIE_SECURE', 'false') === 'true',
    });

    if (error || !code) {
      return res.redirect(`${frontendUrl}/login?error=LarkAuthFailed`);
    }

    if (!state || !expectedState || state !== expectedState) {
      return res.redirect(`${frontendUrl}/login?error=LarkAuthFailed`);
    }

    try {
      const result = await this.authService.loginWithLark(code as string);

      this.cookieAuthService.setAuthCookies(res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });

      return res.redirect(`${frontendUrl}/`); // Tùy chỉnh URL sau khi login thành công
    } catch (err: any) {
      console.error('[Lark OAuth Error]', err.message);
      const reason = encodeURIComponent(
        err?.message || 'Lỗi máy chủ khi xác thực Lark',
      );
      return res.redirect(
        `${frontendUrl}/login?error=LarkLoginError&reason=${reason}`,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }
}
