import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  private async logAction(actorId: string, actorRole: Role, action: string, entityId?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    await this.auditLog.log({
      actorId,
      actorName: actor?.name || 'Không rõ',
      actorRole,
      action,
      entityType: 'User',
      entityId,
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
        department: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending() {
    return this.prisma.user.findMany({
      where: { isApproved: false },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
        department: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
        department: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return user;
  }

  async approveUser(id: string, actorId: string, actorRole: Role, role?: Role) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isApproved: true,
        ...(role ? { role } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
        department: true,
        updatedAt: true,
      },
    });

    await this.logAction(actorId, actorRole, 'APPROVE_USER', id);
    return updated;
  }

  async setActive(id: string, isActive: boolean, actorId: string, actorRole: Role) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        isActive: true,
        department: true,
        updatedAt: true,
      },
    });

    await this.logAction(actorId, actorRole, isActive ? 'UNLOCK_USER' : 'LOCK_USER', id);
    return updated;
  }

  async rejectUser(id: string, actorId: string, actorRole: Role) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    await this.logAction(actorId, actorRole, 'REJECT_USER', id);
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Đã từ chối và xóa tài khoản thành công' };
  }
}
