import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  // Ghi log không được làm hỏng luồng nghiệp vụ chính — lỗi ghi log chỉ log ra console, không throw
  async log(params: {
    actorId?: string | null;
    actorName: string;
    actorRole: Role;
    action: string;
    entityType?: string;
    entityId?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId || undefined,
          actorName: params.actorName,
          actorRole: params.actorRole,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Không thể ghi audit log (${params.action}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Actor role đã biết (truyền từ controller/guard) — tra tên actor rồi ghi log.
  async logAction(
    actorId: string,
    actorRole: Role,
    action: string,
    entityType?: string,
    entityId?: string,
  ) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });
    await this.log({
      actorId,
      actorName: actor?.name || 'Không rõ',
      actorRole,
      action,
      entityType,
      entityId,
    });
  }

  // Chỉ có userId (role chưa biết) — tự tra cả tên lẫn role; im lặng bỏ qua nếu user không còn tồn tại.
  async logActionByUserId(
    userId: string,
    action: string,
    entityId?: string,
    entityType = 'QuoteRequest',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });
    if (!user) return;
    await this.log({
      actorId: userId,
      actorName: user.name,
      actorRole: user.role,
      action,
      entityType,
      entityId,
    });
  }

  // Đếm số lần mỗi action, nhóm theo role — kèm breakdown theo từng người (actorName) để biết ai làm gì
  async getActionStatsByRole() {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['actorRole', 'action', 'actorId', 'actorName'],
      _count: { _all: true },
    });

    type ByActor = { actorId: string | null; actorName: string; count: number };
    const byRole: Record<
      string,
      { action: string; count: number; byActor: ByActor[] }[]
    > = {};

    for (const row of rows) {
      if (!byRole[row.actorRole]) byRole[row.actorRole] = [];
      let actionEntry = byRole[row.actorRole].find(
        (a) => a.action === row.action,
      );
      if (!actionEntry) {
        actionEntry = { action: row.action, count: 0, byActor: [] };
        byRole[row.actorRole].push(actionEntry);
      }
      actionEntry.count += row._count._all;
      actionEntry.byActor.push({
        actorId: row.actorId,
        actorName: row.actorName,
        count: row._count._all,
      });
    }

    for (const role of Object.keys(byRole)) {
      byRole[role].sort((a, b) => b.count - a.count);
      for (const entry of byRole[role]) {
        entry.byActor.sort((a, b) => b.count - a.count);
      }
    }
    return byRole;
  }
}
