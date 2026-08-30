import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { LarkService } from '../lark/lark.service';

// Chỉ dọn log "ồn" nhất, giá trị lưu trữ thấp nhất — mặc định LOGIN quá 90 ngày. Log nghiệp vụ
// (ACCEPT_QUOTE, CREATE_QUOTE, APPROVE_USER...) KHÔNG bị đụng. Chỉnh qua env.
const PRUNE_ACTIONS = (process.env.AUDIT_LOG_PRUNE_ACTIONS || 'LOGIN')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PRUNE_AFTER_DAYS = Number(process.env.AUDIT_LOG_PRUNE_AFTER_DAYS) || 90;

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private prisma: PrismaService,
    private larkService: LarkService,
  ) {}

  // audit_logs là bảng tăng nhanh nhất (mỗi lần đăng nhập + mọi hành động). Không dọn thì vài năm
  // nó chiếm phần lớn DB và làm chậm getActionStatsByRole (groupBy toàn bảng). Chạy 03:00 hằng ngày.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldLogs() {
    if (PRUNE_ACTIONS.length === 0) return;
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000);
    try {
      const { count } = await this.prisma.auditLog.deleteMany({
        where: { action: { in: PRUNE_ACTIONS }, createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `Đã dọn ${count} audit log (${PRUNE_ACTIONS.join(', ')}) cũ hơn ${PRUNE_AFTER_DAYS} ngày`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Dọn audit log thất bại: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Ghi log không được làm hỏng luồng nghiệp vụ chính — lỗi ghi log chỉ log ra console, không throw
  async log(params: {
    actorId?: string | null;
    actorRole: Role;
    action: string;
    entityType?: string;
    entityId?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId || undefined,
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

    // Bắn thông báo Lark nếu có webhook đăng ký action này — fire-and-forget, KHÔNG chặn/không throw.
    void this.larkService
      .dispatchSummary(params.action, {
        actorId: params.actorId || null,
        entityType: params.entityType,
        entityId: params.entityId,
      })
      .catch((e) =>
        this.logger.warn(
          `Lark dispatch (${params.action}) lỗi: ${e instanceof Error ? e.message : e}`,
        ),
      );
  }

  // Actor role đã biết (truyền từ controller/guard) — tên tra qua quan hệ actor lúc đọc, không cần snapshot lúc ghi.
  async logAction(
    actorId: string,
    actorRole: Role,
    action: string,
    entityType?: string,
    entityId?: string,
  ) {
    await this.log({ actorId, actorRole, action, entityType, entityId });
  }

  // Chỉ có userId (role chưa biết) — tự tra role; im lặng bỏ qua nếu user không còn tồn tại.
  async logActionByUserId(
    userId: string,
    action: string,
    entityId?: string,
    entityType = 'QuoteRequest',
  ) {
    let user: { role: Role } | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
    } catch (err) {
      this.logger.warn(
        `Không thể tra actor cho audit log (${action}): ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    if (!user) return;
    await this.log({
      actorId: userId,
      actorRole: user.role,
      action,
      entityType,
      entityId,
    });
  }

  // Đếm số lần mỗi action, nhóm theo role — kèm breakdown theo từng người để biết ai làm gì.
  // Tên actor tra riêng qua quan hệ User (không còn cột actorName lưu trùng trên audit_logs).
  async getActionStatsByRole() {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['actorRole', 'action', 'actorId'],
      _count: { _all: true },
    });

    const actorIds = [
      ...new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id)),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(actors.map((a) => [a.id, a.name]));

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
        actorName: row.actorId
          ? (nameById.get(row.actorId) ?? 'Không rõ')
          : 'Không rõ',
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
