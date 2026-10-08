import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { ProfileService } from '../src/profile/profile.service';
import { ChangePasswordDto } from '../src/profile/dto/change-password.dto';
import { UpdateNameDto } from '../src/profile/dto/update-name.dto';
import { PrismaService } from '../src/prisma/prisma.service';
import { CloudinaryService } from '../src/cloudinary/cloudinary.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';

// Mock Prisma / Cloudinary / AuditLog bằng plain object jest.fn(), KHÔNG đụng DB hay mạng thật.
describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: any;
  let cloudinary: any;
  let auditLog: any;

  // Hash cost thấp cho nhanh — chỉ test so khớp, không test độ mạnh.
  const OLD_HASH = bcrypt.hashSync('oldpass1', 4);

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'u1', passwordHash: OLD_HASH }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    cloudinary = {
      uploadImage: jest
        .fn()
        .mockResolvedValue({ url: 'https://img/new.png', publicId: 'p1' }),
    };
    auditLog = { logAction: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloudinaryService, useValue: cloudinary },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'oldpass1', newPassword: 'newpass1' };

    it('tài khoản không có passwordHash (Lark) → 400 đúng thông báo, không ghi', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        passwordHash: null,
      });
      await expect(
        service.changePassword('u1', Role.SALE, dto),
      ).rejects.toThrow(
        new BadRequestException(
          'Tài khoản này không đăng nhập bằng mật khẩu nên không thể đổi mật khẩu',
        ),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it('người dùng không tồn tại → 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword('ghost', Role.SALE, dto),
      ).rejects.toThrow(new NotFoundException('Không tìm thấy người dùng'));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('sai mật khẩu hiện tại → 400 "Mật khẩu hiện tại không chính xác" và KHÔNG ghi', async () => {
      await expect(
        service.changePassword('u1', Role.SALE, {
          currentPassword: 'wrong-pass',
          newPassword: 'newpass1',
        }),
      ).rejects.toThrow(
        new BadRequestException('Mật khẩu hiện tại không chính xác'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it('mật khẩu mới trùng mật khẩu cũ → 400 đúng thông báo, không ghi', async () => {
      await expect(
        service.changePassword('u1', Role.SALE, {
          currentPassword: 'oldpass1',
          newPassword: 'oldpass1',
        }),
      ).rejects.toThrow(
        new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it('thành công → ghi hash mới khớp mật khẩu mới (khác hash cũ), thu hồi refresh token, audit, trả message', async () => {
      const res = await service.changePassword('u1', Role.SALE, dto);

      // Chỉ tra đúng người đang đăng nhập (id lấy từ JWT, không từ body)
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' } }),
      );
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const arg = prisma.user.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'u1' });
      expect(arg.data.refreshTokenHash).toBeNull();
      // Mã OTP quên mật khẩu còn treo cũng bị hủy — không dùng lại được sau khi đổi mật khẩu
      expect(arg.data.resetTokenHash).toBeNull();
      expect(arg.data.resetTokenExpires).toBeNull();
      // Hash cost 10 (giống resetPassword), không phải cost thấp
      expect(bcrypt.getRounds(arg.data.passwordHash)).toBe(10);
      expect(arg.data.passwordHash).not.toBe(OLD_HASH);
      expect(await bcrypt.compare('newpass1', arg.data.passwordHash)).toBe(
        true,
      );
      expect(await bcrypt.compare('oldpass1', arg.data.passwordHash)).toBe(
        false,
      );

      expect(auditLog.logAction).toHaveBeenCalledWith(
        'u1',
        Role.SALE,
        'CHANGE_PASSWORD',
        'User',
        'u1',
      );
      expect(res).toEqual({
        message:
          'Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.',
      });
    });
  });

  describe('updateName', () => {
    it('ghi tên đã cắt khoảng trắng đầu/cuối và trả { name }', async () => {
      prisma.user.update.mockResolvedValue({ name: 'Nguyễn Văn A' });

      const res = await service.updateName('u1', '  Nguyễn Văn A ');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { name: 'Nguyễn Văn A' },
        select: { name: true },
      });
      expect(res).toEqual({ name: 'Nguyễn Văn A' });
    });

    it.each(['', '   '])('tên %p → 400 và không ghi', async (name) => {
      await expect(service.updateName('u1', name)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('chỉ ghi cột name của đúng người đăng nhập, không đụng email/role/mật khẩu', async () => {
      prisma.user.update.mockResolvedValue({ name: 'B' });
      await service.updateName('u1', 'B');
      const arg = prisma.user.update.mock.calls[0][0];
      expect(Object.keys(arg.data)).toEqual(['name']);
      expect(arg.where).toEqual({ id: 'u1' });
    });
  });

  describe('updateAvatar', () => {
    const file = {
      buffer: Buffer.from('x'),
      mimetype: 'image/png',
      size: 1,
    } as Express.Multer.File;

    it('gọi uploadImage với đúng tệp, ghi avatar và trả { avatar }', async () => {
      const res = await service.updateAvatar('u1', file);

      expect(cloudinary.uploadImage).toHaveBeenCalledWith(file);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatar: 'https://img/new.png' },
      });
      expect(res).toEqual({ avatar: 'https://img/new.png' });
    });

    it('thiếu tệp → 400 và không gọi Cloudinary, không ghi', async () => {
      await expect(
        service.updateAvatar('u1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.uploadImage).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('Cloudinary lỗi (ảnh hỏng/quá lớn) → ném tiếp lỗi và KHÔNG ghi avatar', async () => {
      cloudinary.uploadImage.mockRejectedValue(
        new BadRequestException('Nội dung tập tin không phải là ảnh hợp lệ'),
      );
      await expect(service.updateAvatar('u1', file)).rejects.toThrow(
        'Nội dung tập tin không phải là ảnh hợp lệ',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

describe('ChangePasswordDto', () => {
  it('mật khẩu mới 5 ký tự → lỗi ở thuộc tính newPassword', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: 'a',
      newPassword: '12345',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['newPassword']);
  });

  it('mật khẩu mới 6 ký tự + mật khẩu hiện tại có giá trị → hợp lệ', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: 'a',
      newPassword: '123456',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('thiếu mật khẩu hiện tại → lỗi ở currentPassword', async () => {
    const dto = plainToInstance(ChangePasswordDto, { newPassword: '123456' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('currentPassword');
  });
});

describe('UpdateNameDto', () => {
  it('tên được cắt khoảng trắng đầu/cuối', async () => {
    const dto = plainToInstance(UpdateNameDto, { name: '  Trịnh Huy Hoàng  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('Trịnh Huy Hoàng');
  });

  it.each(['', '   '])('tên %p → lỗi ở thuộc tính name', async (name) => {
    const errors = await validate(plainToInstance(UpdateNameDto, { name }));
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });

  it('tên dài quá 100 ký tự → lỗi', async () => {
    const errors = await validate(
      plainToInstance(UpdateNameDto, { name: 'a'.repeat(101) }),
    );
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });

  it('đúng 100 ký tự → hợp lệ', async () => {
    const dto = plainToInstance(UpdateNameDto, { name: 'a'.repeat(100) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('thiếu name → lỗi', async () => {
    const errors = await validate(plainToInstance(UpdateNameDto, {}));
    expect(errors.map((e) => e.property)).toContain('name');
  });
});
