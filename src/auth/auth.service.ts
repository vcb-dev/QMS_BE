import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  /**
   * Tạo chuỗi băm SHA-256 bảo mật cao cho Token/Data
   */
  hashSha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Lưu hoặc xóa chuỗi băm Refresh Token xuống Database cho User
   */
  async updateRefreshTokenHash(userId: string, refreshTokenHash: string | null) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });
  }

  /**
   * Tạo bộ cặp AccessToken + RefreshToken + RefreshTokenHash chuẩn chỉ
   */
  async generateTokens(user: { id: string; email: string; role: string }) {
    const accessExpires = this.config.get<string>('JWT_ACCESS_EXPIRES', '7d');
    const refreshExpires = this.config.get<string>('JWT_REFRESH_EXPIRES', '30d');

    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, { expiresIn: accessExpires as any });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: refreshExpires as any });
    const refreshTokenHash = this.hashSha256(refreshToken);

    return {
      accessToken,
      refreshToken,
      refreshTokenHash,
    };
  }

  /**
   * Xác thực Access Token
   */
  verifyAccessToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Access Token không hợp lệ hoặc đã hết hạn');
    }
  }

  /**
   * Xác thực Refresh Token
   */
  verifyRefreshToken(token: string) {
    try {
      return this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Refresh Token không hợp lệ hoặc đã hết hạn');
    }
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { department: true },
    });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const tokens = await this.generateTokens(user);

    // Lưu SHA-256 hash của refresh token xuống DB
    await this.updateRefreshTokenHash(user.id, tokens.refreshTokenHash);

    const { passwordHash, refreshTokenHash, ...userWithoutPassword } = user;
    return {
      ...tokens,
      user: userWithoutPassword,
    };
  }

  async refreshTokens(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Thiếu Refresh Token');
    }

    const payload = this.verifyRefreshToken(refreshToken);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Tài khoản không tồn tại');
    }

    // So sánh SHA-256 hash của refreshToken với giá trị lưu trong DB
    const incomingHash = this.hashSha256(refreshToken);
    if (!user.refreshTokenHash || user.refreshTokenHash !== incomingHash) {
      throw new UnauthorizedException('Refresh Token không hợp lệ hoặc đã bị thu hồi');
    }

    const newTokens = await this.generateTokens(user);
    // Cập nhật token hash mới vào DB (Token Rotation)
    await this.updateRefreshTokenHash(user.id, newTokens.refreshTokenHash);

    return newTokens;
  }

  async logout(userId?: string) {
    if (userId) {
      await this.updateRefreshTokenHash(userId, null);
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { department: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { passwordHash, refreshTokenHash, ...result } = user;
    return result;
  }
}
