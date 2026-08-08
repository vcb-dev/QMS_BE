import { Controller, Post, Body, Get, UseGuards, Res, Req, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { CookieAuthService } from './cookie-auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { COOKIE_REFRESH } from './cookie.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieAuthService: CookieAuthService,
  ) {}

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
      refreshTokenHash: result.refreshTokenHash,
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
      refreshTokenHash: result.refreshTokenHash,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[COOKIE_REFRESH] || req.body?.refreshToken;
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

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }
}
