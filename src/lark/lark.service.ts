import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { APP_CONSTANTS } from '../common/constants';
import { formatVnd } from '../utils/currency.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  LarkWebhookView,
  QuoteCardData,
  SummaryCardInput,
} from '../common/lark.types';
import {
  CreateLarkWebhookDto,
  ListLarkWebhookDto,
  UpdateLarkWebhookDto,
} from './dto/lark-webhook.dto';
import {
  AuditAction,
  AUDIT_ACTION_LABELS,
  RICH_CARD_ACTIONS,
  NOTIFIABLE_ACTION_LIST,
  type NotifiableActionInfo,
} from '../common/audit-actions';

interface RouteRow {
  webhookUrl: string;
  webhookSecret: string | null;
  actions: Set<string>;
}

interface DispatchContext {
  actorId: string | null;
  entityType?: string;
  entityId?: string;
}

const VALID_ACTIONS = new Set<string>(Object.values(AuditAction));

// Toàn bộ tương tác với Lark gom về 1 service:
//  - CRUD cấu hình webhook (lark_webhook + lark_webhook_subscription) cho trang ADMIN
//  - định tuyến/fan-out thông báo theo audit action (dispatchSummary / dispatchQuoteCard)
//  - lấy tenant_access_token (cache RAM) + upload ảnh sản phẩm để nhúng vào card
//  - ký chữ ký custom bot (HMAC-SHA256) + gửi message card qua webhook (deliverCard)
// Lỗi khi GỬI chỉ log, KHÔNG throw — thông báo hỏng không được làm gãy luồng nghiệp vụ chính.
// Lỗi khi LƯU cấu hình thì throw như bình thường (controller trả lỗi cho ADMIN).
@Injectable()
export class LarkService {
  private readonly logger = new Logger(LarkService.name);
  private static readonly ROUTE_TTL_MS = 15_000;
  // tenant_access_token sống ~2h; cache RAM, refresh sớm 5 phút trước hạn.
  private tokenCache: { token: string; expiresAt: number } | null = null;
  // Cache bảng định tuyến (webhook đang bật + action đang bật) — tránh 1 query mỗi lần ghi audit.
  private routesCache: { at: number; data: RouteRow[] } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ============ Danh mục hành động (checklist FE) ============

  getActionCatalog(): readonly NotifiableActionInfo[] {
    return NOTIFIABLE_ACTION_LIST;
  }

  // ============ CRUD ============

  // Danh sách webhook — lọc + phân trang HẾT ở BE. FE chỉ gửi query rồi hiển thị.
  async list(q: ListLarkWebhookDto): Promise<{
    data: LarkWebhookView[];
    meta: { total: number; page: number; limit: number; totalPages: number };
    stats: { total: number; enabled: number; actionsCovered: number };
  }> {
    const page = q.page && q.page > 0 ? q.page : 1;
    const limit = q.limit && q.limit > 0 ? q.limit : 10;

    const where: Prisma.LarkWebhookWhereInput = {};
    const search = q.search?.trim();
    if (search) {
      where.OR = [
        { chatName: { contains: search, mode: 'insensitive' } },
        { botName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (q.status === 'on') where.isEnabled = true;
    else if (q.status === 'off') where.isEnabled = false;
    if (q.updatedById) where.updatedById = q.updatedById;
    if (q.updatedWithin) {
      const hours =
        q.updatedWithin === '24h' ? 24 : q.updatedWithin === '7d' ? 168 : 720;
      where.updatedAt = { gte: new Date(Date.now() - hours * 3_600_000) };
    }

    const [total, rows, statAll, statEnabled, distinctActions] =
      await this.prisma.$transaction([
        this.prisma.larkWebhook.count({ where }),
        this.prisma.larkWebhook.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            updatedBy: { select: { name: true } },
            subscriptions: {
              where: { isEnabled: true },
              select: { action: true },
            },
          },
        }),
        this.prisma.larkWebhook.count(),
        this.prisma.larkWebhook.count({ where: { isEnabled: true } }),
        this.prisma.larkWebhookSubscription.findMany({
          where: { isEnabled: true, webhook: { isEnabled: true } },
          distinct: ['action'],
          select: { action: true },
        }),
      ]);

    return {
      data: rows.map((r) => this.toView(r)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats: {
        total: statAll,
        enabled: statEnabled,
        actionsCovered: distinctActions.length,
      },
    };
  }

  // Danh sách người từng cập nhật webhook — cho dropdown lọc trên FE.
  async listUpdaters(): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.larkWebhook.findMany({
      where: { updatedById: { not: null } },
      distinct: ['updatedById'],
      select: { updatedBy: { select: { id: true, name: true } } },
    });
    return rows
      .map((r) => r.updatedBy)
      .filter((u): u is { id: string; name: string } => !!u)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  async create(
    dto: CreateLarkWebhookDto,
    userId: string,
  ): Promise<LarkWebhookView> {
    const actions = this.normalizeActions(dto.actions);
    try {
      const created = await this.prisma.larkWebhook.create({
        data: {
          chatName: dto.chatName.trim(),
          botName: dto.botName?.trim() || null,
          webhookUrl: dto.webhookUrl.trim(),
          webhookSecret: dto.webhookSecret?.trim() || null,
          isEnabled: dto.isEnabled ?? true,
          updatedById: userId,
          subscriptions: { create: actions.map((action) => ({ action })) },
        },
        include: {
          updatedBy: { select: { name: true } },
          subscriptions: {
            where: { isEnabled: true },
            select: { action: true },
          },
        },
      });
      this.invalidate();
      return this.toView(created);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async update(
    id: string,
    dto: UpdateLarkWebhookDto,
    userId: string,
  ): Promise<LarkWebhookView> {
    const existing = await this.prisma.larkWebhook.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy webhook');

    const data: Prisma.LarkWebhookUpdateInput = {
      updatedBy: { connect: { id: userId } },
    };
    if (dto.chatName !== undefined) data.chatName = dto.chatName.trim();
    if (dto.botName !== undefined) data.botName = dto.botName.trim() || null;
    if (dto.webhookUrl !== undefined) data.webhookUrl = dto.webhookUrl.trim();
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    // webhookSecret: bỏ field = giữ nguyên; '' = xóa; chuỗi khác = đặt mới
    if (dto.webhookSecret !== undefined) {
      data.webhookSecret = dto.webhookSecret.trim() || null;
    }

    try {
      await this.prisma.larkWebhook.update({ where: { id }, data });
      if (dto.actions !== undefined) {
        await this.syncSubscriptions(id, this.normalizeActions(dto.actions));
      }
    } catch (err) {
      throw this.mapWriteError(err);
    }

    this.invalidate();
    const fresh = await this.prisma.larkWebhook.findUniqueOrThrow({
      where: { id },
      include: {
        updatedBy: { select: { name: true } },
        subscriptions: { where: { isEnabled: true }, select: { action: true } },
      },
    });
    return this.toView(fresh);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.larkWebhook.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy webhook');
    await this.prisma.larkWebhook.delete({ where: { id } }); // subscription cascade
    this.invalidate();
  }

  async sendTest(id: string): Promise<{ ok: boolean; message: string }> {
    const w = await this.prisma.larkWebhook.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Không tìm thấy webhook');
    const card = this.buildSummaryCard({
      actionLabel: 'Tin thử từ VCB QMS',
      actorName: 'Hệ thống',
      entityType: null,
      entityCode: null,
      entityId: null,
      detailUrl: null,
      at: new Date(),
    });
    return this.deliverCard(w.webhookUrl, w.webhookSecret, card);
  }

  // ============ Dispatch (gọi từ AuditLogService + QuoteWorkflowService) ============

  // Thẻ tóm tắt cho action thường. Bỏ qua action gửi thẻ chi tiết (do dispatchQuoteCard lo).
  async dispatchSummary(action: string, ctx: DispatchContext): Promise<void> {
    if (RICH_CARD_ACTIONS.has(action as AuditAction)) return;
    const targets = await this.webhooksForAction(action);
    if (targets.length === 0) return;

    const [actorName, entityCode] = await Promise.all([
      this.resolveActorName(ctx.actorId),
      this.resolveEntityCode(ctx.entityType, ctx.entityId),
    ]);
    const detailUrl = this.buildEntityUrl(ctx.entityType, ctx.entityId);

    const card = this.buildSummaryCard({
      actionLabel: AUDIT_ACTION_LABELS[action as AuditAction] || action,
      actorName,
      entityType: ctx.entityType ?? null,
      entityCode,
      entityId: ctx.entityId ?? null,
      detailUrl,
      at: new Date(),
    });

    await Promise.allSettled(
      targets.map((t) => this.deliverCard(t.webhookUrl, t.webhookSecret, card)),
    );
  }

  // Thẻ chi tiết "đã báo giá" — fan-out tới các webhook đăng ký action này.
  // Không cấu hình webhook nào cho action -> không gửi (không còn fallback .env).
  async dispatchQuoteCard(action: string, data: QuoteCardData): Promise<void> {
    const targets = await this.webhooksForAction(action);
    if (targets.length === 0) return;
    const card = await this.buildQuoteCardPayload(data);
    await Promise.allSettled(
      targets.map((t) => this.deliverCard(t.webhookUrl, t.webhookSecret, card)),
    );
  }

  // ============ Nội bộ ============

  private invalidate(): void {
    this.routesCache = null;
  }

  private async loadRoutes(): Promise<RouteRow[]> {
    const now = Date.now();
    if (
      this.routesCache &&
      now - this.routesCache.at < LarkService.ROUTE_TTL_MS
    ) {
      return this.routesCache.data;
    }
    const rows = await this.prisma.larkWebhook.findMany({
      where: { isEnabled: true },
      select: {
        webhookUrl: true,
        webhookSecret: true,
        subscriptions: { where: { isEnabled: true }, select: { action: true } },
      },
    });
    const data: RouteRow[] = rows.map((r) => ({
      webhookUrl: r.webhookUrl,
      webhookSecret: r.webhookSecret,
      actions: new Set(r.subscriptions.map((s) => s.action)),
    }));
    this.routesCache = { at: now, data };
    return data;
  }

  private async webhooksForAction(
    action: string,
  ): Promise<{ webhookUrl: string; webhookSecret: string | null }[]> {
    const routes = await this.loadRoutes();
    return routes
      .filter((r) => r.actions.has(action))
      .map((r) => ({
        webhookUrl: r.webhookUrl,
        webhookSecret: r.webhookSecret,
      }));
  }

  private async syncSubscriptions(
    webhookId: string,
    desired: string[],
  ): Promise<void> {
    const want = new Set(desired);
    const current = await this.prisma.larkWebhookSubscription.findMany({
      where: { webhookId },
      select: { id: true, action: true },
    });
    const toDelete = current
      .filter((s) => !want.has(s.action))
      .map((s) => s.id);
    const toAdd = desired.filter((a) => !current.some((s) => s.action === a));
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (toDelete.length > 0) {
      ops.push(
        this.prisma.larkWebhookSubscription.deleteMany({
          where: { id: { in: toDelete } },
        }),
      );
    }
    if (toAdd.length > 0) {
      ops.push(
        this.prisma.larkWebhookSubscription.createMany({
          data: toAdd.map((action) => ({ webhookId, action })),
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
  }

  private normalizeActions(actions: string[] | undefined): string[] {
    if (!actions || actions.length === 0) return [];
    const invalid = actions.filter((a) => !VALID_ACTIONS.has(a));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Hành động không hợp lệ: ${invalid.join(', ')}`,
      );
    }
    return [...new Set(actions)];
  }

  private async resolveActorName(actorId: string | null): Promise<string> {
    if (!actorId) return 'Không rõ';
    const u = await this.prisma.user
      .findUnique({ where: { id: actorId }, select: { name: true } })
      .catch(() => null);
    return u?.name || 'Không rõ';
  }

  private async resolveEntityCode(
    entityType: string | undefined,
    entityId: string | undefined,
  ): Promise<string | null> {
    if (entityType !== 'QuoteRequest' || !entityId) return null;
    const q = await this.prisma.quoteRequest
      .findUnique({ where: { id: entityId }, select: { code: true } })
      .catch(() => null);
    return q?.code ?? null;
  }

  private buildEntityUrl(
    entityType: string | undefined,
    entityId: string | undefined,
  ): string | null {
    if (entityType !== 'QuoteRequest' || !entityId) return null;
    const base = this.config.get<string>('FRONTEND_URL');
    return base ? `${base.split(',')[0].trim()}/requests/${entityId}` : null;
  }

  private toView(row: {
    id: string;
    chatName: string;
    botName: string | null;
    webhookUrl: string;
    webhookSecret: string | null;
    isEnabled: boolean;
    updatedAt: Date;
    updatedBy: { name: string } | null;
    subscriptions: { action: string }[];
  }): LarkWebhookView {
    return {
      id: row.id,
      chatName: row.chatName,
      botName: row.botName,
      webhookUrl: row.webhookUrl,
      hasSecret: !!row.webhookSecret,
      isEnabled: row.isEnabled,
      actions: row.subscriptions.map((s) => s.action),
      updatedByName: row.updatedBy?.name ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapWriteError(err: unknown): Error {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return new BadRequestException(
        'Webhook URL hoặc signing secret này đã được dùng ở một cấu hình khác.',
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
  // ============ Thông báo (webhook custom bot) ============

  // Dựng payload card "đã báo giá" (msg_type: interactive): header xanh, ảnh sản phẩm 2 cột, từng
  // phương án + giá, nút "Xem chi tiết". Upload ảnh trước — hỏng thì card vẫn dựng, chỉ thiếu ảnh.
  // Việc chọn webhook nào để gửi (fan-out theo cấu hình) do dispatchQuoteCard lo.
  async buildQuoteCardPayload(
    data: QuoteCardData,
  ): Promise<Record<string, unknown>> {
    if (!data.imageUrl) {
      this.logger.warn(
        'Lark card: đơn không có ảnh sản phẩm (quote.images rỗng)',
      );
    }
    const imgKey = data.imageUrl
      ? await this.uploadImageFromUrl(data.imageUrl)
      : null;
    if (data.imageUrl && !imgKey) {
      this.logger.warn(
        `Lark card: có ảnh nhưng không lấy được image_key — ${data.imageUrl.slice(0, 80)}`,
      );
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const detailUrl =
      frontendUrl && data.requestId
        ? `${frontendUrl}/requests/${data.requestId}`
        : null;

    return this.buildQuoteCard(data, imgKey, detailUrl);
  }

  // Thẻ tóm tắt generic cho các hành động khác (từ chối, trả lại, tạo yêu cầu, xuất Excel...).
  buildSummaryCard(input: SummaryCardInput): Record<string, unknown> {
    const at = input.at.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const target =
      input.entityCode ||
      (input.entityType && input.entityId
        ? `${input.entityType} #${input.entityId}`
        : input.entityType || '—');

    const elements: Record<string, unknown>[] = [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**Người thực hiện:** ${input.actorName}`,
            `**Đối tượng:** ${target}`,
            `**Thời điểm:** ${at}`,
          ].join('\n'),
        },
      },
    ];

    if (input.detailUrl) {
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: 'Xem chi tiết' },
            type: 'default',
            url: input.detailUrl,
          },
        ],
      });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        template: 'grey',
        title: { tag: 'plain_text', content: input.actionLabel },
      },
      elements,
    };
  }

  // Chữ ký Custom Bot Lark: HMAC-SHA256 với key = `${timestamp}\n${secret}`, hash trên chuỗi rỗng —
  // đúng thuật toán Lark quy định, không phải HMAC thông thường.
  private sign(timestamp: string, secret: string): string {
    return createHmac('sha256', `${timestamp}\n${secret}`)
      .update('')
      .digest('base64');
  }

  private signBody(
    body: Record<string, unknown>,
    secret: string | null | undefined,
  ): void {
    if (!secret) return;
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = this.sign(timestamp, secret);
  }

  // Ký (nếu có secret) rồi POST 1 card tới 1 webhook. Không throw — trả trạng thái để hiển thị/log.
  async deliverCard(
    webhookUrl: string,
    secret: string | null | undefined,
    card: Record<string, unknown>,
  ): Promise<{ ok: boolean; message: string }> {
    const body: Record<string, unknown> = { msg_type: 'interactive', card };
    this.signBody(body, secret);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = `Lark webhook trả về lỗi HTTP ${res.status}`;
        this.logger.warn(msg);
        return { ok: false, message: msg };
      }
      const data: any = await res.json().catch(() => null);
      if (data && data.code !== 0) {
        const msg = `Lark webhook từ chối: ${data.msg || JSON.stringify(data)}`;
        this.logger.warn(msg);
        return { ok: false, message: msg };
      }
      return { ok: true, message: 'Đã gửi tin tới Lark' };
    } catch (err) {
      const msg = `Không gửi được thông báo Lark: ${err instanceof Error ? err.message : err}`;
      this.logger.warn(msg);
      return { ok: false, message: msg };
    }
  }

  // ============ Dựng message card ============

  // Field "Sale": có open_id -> @mention (Lark ping đúng người trong nhóm), không -> tên thường.
  // open_id lấy từ OAuth "Pricing App", cùng tenant nên custom bot vẫn resolve; nếu Lark hiện
  // text trơ thì đổi <at id="..."> sang <at email="...">.
  private saleMention(data: QuoteCardData): string {
    return data.saleLarkOpenId
      ? `<at id="${data.saleLarkOpenId}"></at>`
      : data.saleName;
  }

  // card v1 cho custom bot (msg_type: interactive). Nhúng ảnh chỉ khi có imgKey (upload thành công).
  private buildQuoteCard(
    data: QuoteCardData,
    imgKey: string | null,
    detailUrl: string | null,
  ): Record<string, unknown> {
    const elements: Record<string, unknown>[] = [];

    // Thông tin đơn — 1 khối text, mỗi field 1 dòng (để đặt vừa cột hẹp bên phải ảnh).
    const infoDiv = {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          `**Danh mục:** ${data.categoryName || '—'}`,
          `**Sản phẩm:** ${data.productName || '—'}`,
          `**Khách hàng:** ${data.customerName || '—'}`,
          `**Sale:** ${this.saleMention(data)}`,
          `**Order:** ${data.orderName || '—'}`,
        ].join('\n'),
      },
    };

    if (imgKey) {
      // Ảnh trái (cỡ nhỏ, co theo cột, giữ đúng tỉ lệ) — thông tin đơn ở cột phải.
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 2,
            vertical_align: 'top',
            elements: [
              {
                tag: 'img',
                img_key: imgKey,
                alt: { tag: 'plain_text', content: 'Ảnh sản phẩm' },
                mode: 'fit_horizontal',
                preview: true,
              },
            ],
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 3,
            vertical_align: 'top',
            elements: [infoDiv],
          },
        ],
      });
    } else {
      elements.push(infoDiv);
    }

    data.options.forEach((opt) => {
      const lines = [`**${opt.name}**`];
      if (opt.materialText) lines.push(`• Chất liệu: ${opt.materialText}`);
      lines.push(`• Giá chất liệu: ${formatVnd(opt.materialPrice)}`);
      lines.push(`• Đá: ${opt.stoneText}`);
      if (opt.stonePrice > 0)
        lines.push(`• Giá đá: ${formatVnd(opt.stonePrice)}`);
      lines.push(`• Giá báo: ${formatVnd(opt.quotedPrice)}`);
      elements.push({ tag: 'hr' });
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: lines.join('\n') },
      });
    });

    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**TỔNG BÁO GIÁ**\n<font color="green">**${formatVnd(data.totalPrice)}**</font>`,
      },
    });

    if (detailUrl) {
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: 'Xem chi tiết' },
            type: 'primary',
            url: detailUrl,
          },
        ],
      });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        template: 'green',
        title: {
          tag: 'plain_text',
          content: `Đã báo giá · ${data.code}`,
        },
      },
      elements,
    };
  }

  // ============ Lark app (tenant token + upload ảnh) ============

  private async getTenantToken(): Promise<string | null> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now) {
      return this.tokenCache.token;
    }

    const appId = this.config.get<string>('LARK_APP_ID');
    const appSecret = this.config.get<string>('LARK_APP_SECRET');
    if (!appId || !appSecret) {
      this.logger.warn(
        'Lark: thiếu LARK_APP_ID / LARK_APP_SECRET — không upload ảnh được',
      );
      return null;
    }

    try {
      const res = await fetch(APP_CONSTANTS.LARK_TENANT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const data: any = await res.json().catch(() => null);
      if (!data || data.code !== 0 || !data.tenant_access_token) {
        this.logger.warn(
          `Lark tenant_access_token lỗi: ${data?.msg || `HTTP ${res.status}`}`,
        );
        return null;
      }
      const expireSec = Number(data.expire) || 7200;
      this.tokenCache = {
        token: data.tenant_access_token,
        expiresAt: now + (expireSec - 300) * 1000,
      };
      return this.tokenCache.token;
    } catch (err) {
      this.logger.warn(
        `Không lấy được Lark tenant_access_token: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // Tải ảnh từ URL (Cloudinary) rồi upload lên Lark, trả image_key để nhúng vào card.
  // null nếu URL không hợp lệ / tải/upload lỗi / ảnh quá lớn.
  private async uploadImageFromUrl(imageUrl: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(imageUrl)) {
      this.logger.warn(
        `Lark: ảnh không phải URL http(s) (data URI?), bỏ qua — ${imageUrl.slice(0, 40)}`,
      );
      return null;
    }

    const token = await this.getTenantToken();
    if (!token) return null;

    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        this.logger.warn(`Tải ảnh sản phẩm lỗi HTTP ${imgRes.status}`);
        return null;
      }
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > APP_CONSTANTS.MAX_FILE_SIZE
      ) {
        this.logger.warn(
          `Lark: ảnh rỗng hoặc quá lớn (${bytes.byteLength} bytes), bỏ qua`,
        );
        return null;
      }
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

      const form = new FormData();
      form.append('image_type', 'message');
      form.append(
        'image',
        new Blob([bytes], { type: contentType }),
        'product-image',
      );

      const upRes = await fetch(APP_CONSTANTS.LARK_IMAGE_UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data: any = await upRes.json().catch(() => null);
      if (!data || data.code !== 0 || !data.data?.image_key) {
        this.logger.warn(
          `Lark upload ảnh lỗi: ${data?.msg || `HTTP ${upRes.status}`}`,
        );
        return null;
      }
      return data.data.image_key as string;
    } catch (err) {
      this.logger.warn(
        `Không upload được ảnh lên Lark: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
