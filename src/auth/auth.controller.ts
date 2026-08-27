import { Controller, Post, Body, Get, UseGuards, Res, Req, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { CookieAuthService } from './cookie-auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { COOKIE_REFRESH } from './cookie.constants';
import { Throttle } from '@nestjs/throttler';
import { APP_CONSTANTS } from '../common/constants';
import { SkipCsrf } from './decorators/skip-csrf.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieAuthService: CookieAuthService,
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
    const refreshToken = req.cookies?.[COOKIE_REFRESH] || req.body?.refreshToken;
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
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
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
  async register(
    @Body() registerDto: RegisterDto,
  ) {
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

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }
}
