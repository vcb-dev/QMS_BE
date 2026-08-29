import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';

const USER_BASE_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
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

  async getStats() {
    const [totalUsers, roleGroups, deptGroups, pendingCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
        this.prisma.user.groupBy({
          by: ['departmentId'],
          _count: { _all: true },
        }),
        this.prisma.user.count({ where: { isApproved: false } }),
      ]);

    const byRole = { SALE: 0, ORDER: 0, ADMIN: 0 };
    for (const g of roleGroups) {
      if (g.role in byRole)
        byRole[g.role as keyof typeof byRole] = g._count._all;
    }

    const deptIds = deptGroups
      .map((g) => g.departmentId)
      .filter((id): id is string => !!id);
    const depts = deptIds.length
      ? await this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : [];
    const deptNameById = new Map(depts.map((d) => [d.id, d.name]));
    const byDept = deptGroups
      .map((g) => ({
        name:
          (g.departmentId && deptNameById.get(g.departmentId)) ||
          'Chưa gán bộ phận',
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return { totalUsers, byRole, byDept, pendingCount };
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
      select: { id: true, isApproved: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // Chỉ xóa cứng được tài khoản CHƯA duyệt (chưa thể có quote/chat liên kết) — tài khoản đã
    // duyệt có thể đã có dữ liệu nghiệp vụ, xóa cứng sẽ vỡ FK hoặc mất lịch sử. Khóa qua isActive.
    if (user.isApproved) {
      throw new BadRequestException(
        'Tài khoản đã được duyệt — chỉ có thể khóa (isActive), không thể xóa cứng',
      );
    }

    await this.auditLog.logAction(
      actorId,
      actorRole,
      'REJECT_USER',
      'User',
      id,
    );
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2003' || err.code === 'P2014')
      ) {
        throw new BadRequestException(
          'Không thể xóa — tài khoản đã có dữ liệu liên kết (yêu cầu báo giá, tin nhắn...)',
        );
      }
      throw err;
    }
    return { message: 'Đã từ chối và xóa tài khoản thành công' };
  }
}
