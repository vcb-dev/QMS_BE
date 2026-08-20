import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';

const USER_BASE_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  isApproved: true,
  isActive: true,
  department: true,
} as const;

const USER_LIST_SELECT = { ...USER_BASE_FIELDS, createdAt: true } as const;
const USER_UPDATE_SELECT = { ...USER_BASE_FIELDS, updatedAt: true } as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending() {
    return this.prisma.user.findMany({
      where: { isApproved: false },
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_LIST_SELECT,
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return user;
  }

  async approveUser(id: string, actorId: string, actorRole: Role, role?: Role) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isApproved: true,
        ...(role ? { role } : {}),
      },
      select: USER_UPDATE_SELECT,
    });

    await this.auditLog.logAction(
      actorId,
      actorRole,
      'APPROVE_USER',
      'User',
      id,
    );
    return updated;
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorId: string,
    actorRole: Role,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: USER_UPDATE_SELECT,
    });

    await this.auditLog.logAction(
      actorId,
      actorRole,
      isActive ? 'UNLOCK_USER' : 'LOCK_USER',
      'User',
      id,
    );
    return updated;
  }

  async rejectUser(id: string, actorId: string, actorRole: Role) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    await this.auditLog.logAction(
      actorId,
      actorRole,
      'REJECT_USER',
      'User',
      id,
    );
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Đã từ chối và xóa tài khoản thành công' };
  }
}
