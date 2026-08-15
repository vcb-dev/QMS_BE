import { Injectable, UnauthorizedException, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { MailService } from '../mail/mail.service';
import { APP_CONSTANTS } from 'src/common/constants';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mailService: MailService,
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
    const accessExpires = this.config.get<string>('JWT_ACCESS_EXPIRES',  APP_CONSTANTS.JWT_ACCESS_EXPIRES);
    const refreshExpires = this.config.get<string>('JWT_REFRESH_EXPIRES', APP_CONSTANTS.JWT_REFRESH_EXPIRES);

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

    if (!user.isApproved) {
      throw new UnauthorizedException('Tài khoản của bạn đang CHỜ ADMIN PHÊ DUYỆT. Vui lòng liên hệ quản trị viên để được kích hoạt.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
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

    if (!user || !user.isApproved || !user.isActive) {
      throw new UnauthorizedException('Tài khoản không tồn tại, chưa được phê duyệt hoặc đã bị khóa');
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
    const { passwordHash, refreshTokenHash, resetTokenHash, resetTokenExpires, ...result } = user;
    return result;
  }

  async register(registerDto: RegisterDto) {
    const { email, password, name, role, departmentId } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email này đã được đăng ký sử dụng trong hệ thống');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        isApproved: false, // Chờ ADMIN phê duyệt
        role: role || Role.SALE,
        departmentId: departmentId || undefined,
      },
      include: { department: true },
    });

    // Gửi email chào mừng & thông báo đăng ký
    this.mailService.sendWelcome(user.email, user.name).catch(() => {});

    const { passwordHash: _p, refreshTokenHash: _r, resetTokenHash: _rst, resetTokenExpires: _exp, ...userWithoutSecrets } = user;
    return {
      message: 'Đăng ký tài khoản thành công! Yêu cầu của bạn đang CHỜ ADMIN PHÊ DUYỆT trước khi có thể đăng nhập.',
      user: userWithoutSecrets,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const { email } = dto;
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Để bảo mật không làm lộ email tồn tại hay không, vẫn trả lời thông báo chung
      return {
        message: 'Nếu email tồn tại trong hệ thống, mã xác thực OTP đã được gửi đến bạn.',
      };
    }

    // Sinh mã OTP 6 chữ số
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenHash = this.hashSha256(otp);
    const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash,
        resetTokenExpires,
      },
    });

    // console.log(`[SECURITY LOG] Mã OTP Quên Mật Khẩu của ${email} là: ${otp}`);

    // Gửi OTP qua email (fire-and-forget)
    this.mailService.sendForgotPasswordOtp(user.email, user.name, otp).catch(() => {});

    return {
      message: 'Mã xác thực OTP đặt lại mật khẩu đã được gửi đến email của bạn (hiệu lực 15 phút)',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { email, otp, newPassword } = dto;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.resetTokenHash || !user.resetTokenExpires) {
      throw new BadRequestException('Yêu cầu đặt lại mật khẩu không hợp lệ hoặc không tồn tại');
    }

    if (new Date() > user.resetTokenExpires) {
      throw new BadRequestException('Mã xác thực OTP đã hết hạn (chỉ có hiệu lực trong 15 phút)');
    }

    const incomingHash = this.hashSha256(otp);
    if (user.resetTokenHash !== incomingHash) {
      throw new BadRequestException('Mã xác thực OTP không chính xác');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        resetTokenHash: null,
        resetTokenExpires: null,
        refreshTokenHash: null, // Yêu cầu đăng nhập lại
      },
    });

    return {
      message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
    };
  }
}

