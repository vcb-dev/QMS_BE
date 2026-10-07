import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ChangePasswordDto } from './dto/change-password.dto';

// Hai thao tác GHI trên hồ sơ của chính người đăng nhập (đổi ảnh, đổi mật khẩu). Đặt ở module riêng
// thay vì AuthService vì AuthModule → AuditLogModule → LarkModule → QuoteChatModule → AuthModule
// sẽ thành vòng import. GET /auth/profile (chỉ đọc) vẫn nằm ở AuthController.
@Injectable()
export class ProfileService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
    private auditLog: AuditLogService,
  ) {}

  // Chỉ ghi cột name của đúng người đăng nhập (id lấy từ JWT) — email, vai trò, mật khẩu không đổi.
  async updateName(userId: string, name: string) {
    const clean = (name ?? '').trim();
    if (!clean) {
      throw new BadRequestException('Họ tên không được để trống');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: clean },
      select: { name: true },
    });
  }

  async updateAvatar(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn tập tin ảnh để tải lên');
    }
    // uploadImage kiểm kích thước, MIME và nội dung ảnh thật; lỗi của nó được ném tiếp NGUYÊN VẸN
    // và avatar chỉ được ghi sau khi tải lên thành công.
    const { url } = await this.cloudinary.uploadImage(file);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: url },
    });
    return { avatar: url };
  }

  async changePassword(userId: string, role: Role, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // Tài khoản chỉ đăng nhập bằng Lark không có mật khẩu để so khớp/đổi.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Tài khoản này không đăng nhập bằng mật khẩu nên không thể đổi mật khẩu',
      );
    }
    // 400 (không phải 401): 401 làm interceptor FE tự refresh/đăng xuất người dùng.
    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      // refreshTokenHash = null thu hồi phiên refresh (giống resetPassword): thiết bị khác phải
      // đăng nhập lại khi access token hết hạn. Hủy luôn OTP quên mật khẩu còn treo (giống
      // resetPassword) để mã cũ không dùng lại được sau khi đổi mật khẩu.
      data: {
        passwordHash,
        refreshTokenHash: null,
        resetTokenHash: null,
        resetTokenExpires: null,
      },
    });
    await this.auditLog.logAction(
      userId,
      role,
      'CHANGE_PASSWORD',
      'User',
      userId,
    );

    return {
      message:
        'Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.',
    };
  }
}
