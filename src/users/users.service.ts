import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveDateRange } from '../utils/date-range.util';
import { TimeRangeQueryDto } from '../common/time-range-query.dto';

const USER_BASE_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
  isApproved: true,
  isActive: true,
  team: { select: { id: true, name: true } },
} as const;

const USER_LIST_SELECT = { ...USER_BASE_FIELDS, createdAt: true } as const;
const USER_UPDATE_SELECT = { ...USER_BASE_FIELDS, updatedAt: true } as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll(query?: TimeRangeQueryDto) {
    return this.prisma.user.findMany({
      where: this.dateWhere(query),
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Lọc theo user.createdAt — nút lọc nhanh / khoảng ngày tùy chọn quy đổi ở resolveDateRange.
  // Không có bộ lọc thời gian => where rỗng, giữ nguyên hành vi cũ.
  private dateWhere(query?: TimeRangeQueryDto) {
    const range = query
      ? resolveDateRange(query.timeRange, query.startDate, query.endDate)
      : null;
    return range ? { createdAt: range } : {};
  }

  async getStats(query?: TimeRangeQueryDto) {
    const dateWhere = this.dateWhere(query);
    const [totalUsers, roleGroups, pendingCount] =
      await Promise.all([
        this.prisma.user.count({ where: dateWhere }),
        this.prisma.user.groupBy({
          by: ['role'],
          where: dateWhere,
          _count: { _all: true },
        }),
        this.prisma.user.count({
          where: { ...dateWhere, isApproved: false },
        }),
      ]);

    const byRole = { SALE: 0, ORDER: 0, ADMIN: 0 };
    for (const g of roleGroups) {
      if (g.role in byRole)
        byRole[g.role as keyof typeof byRole] = g._count._all;
    }

    return { totalUsers, byRole, byDept: [], pendingCount };
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

  // teamId: undefined = không đụng team; chuỗi = gán (phải tồn tại); null/'' = gỡ team.
  async approveUser(
    id: string,
    actorId: string,
    actorRole: Role,
    role?: Role,
    teamId?: string | null,
  ) {
    const teamChange = this.parseTeamId(teamId);
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    // Kiểm tra team TRƯỚC khi duyệt — team không tồn tại thì không để lại user đã duyệt mà thiếu team.
    await this.assertTeamExists(teamChange);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        isApproved: true,
        ...(role ? { role } : {}),
        ...(teamChange !== undefined ? { teamId: teamChange } : {}),
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

  async setUserTeam(
    id: string,
    teamId: string | null,
    actorId: string,
    actorRole: Role,
  ) {
    // Khác approve: ở đây thiếu teamId là lỗi (endpoint chỉ có việc đổi team).
    const teamChange = this.parseTeamId(teamId);
    if (teamChange === undefined) {
      throw new BadRequestException('teamId không hợp lệ');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    await this.assertTeamExists(teamChange);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { teamId: teamChange },
      select: USER_UPDATE_SELECT,
    });

    await this.auditLog.logAction(
      actorId,
      actorRole,
      'SET_USER_TEAM',
      'User',
      id,
    );
    return updated;
  }

  // undefined → không đổi; null hoặc '' → gỡ team (null); chuỗi → id team; kiểu khác → 400.
  private parseTeamId(teamId: unknown): string | null | undefined {
    if (teamId === undefined) return undefined;
    if (teamId === null || teamId === '') return null;
    if (typeof teamId !== 'string') {
      throw new BadRequestException('teamId không hợp lệ');
    }
    return teamId;
  }

  private async assertTeamExists(teamId: string | null | undefined) {
    if (!teamId) return;
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!team) {
      throw new NotFoundException('Team không tồn tại');
    }
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
