import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { Subject, Observable } from 'rxjs';
import { APP_CONSTANTS } from '../common/constants';
import { formatVnd } from '../utils/currency.util';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteChatService } from '../quote-chat/quote-chat.service';
import { ChatMessageDto } from '../quote-chat/dto/quote-chat.types';
import {
  LarkWebhookView,
  QuoteCardData,
  SummaryCardInput,
  LarkDmBridgeStatus,
  LarkInboundEventData,
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

interface DmCardQuote {
  code: string;
  customer: { name: string };
  category: { name: string };
}

const VALID_ACTIONS = new Set<string>(Object.values(AuditAction));

// ============ Khối dựng Lark interactive card (msg_type: interactive) ============
// Thuần: nhận dữ liệu đã sẵn sàng, trả object JSON. Việc gửi đi do LarkService lo.

type LarkCard = Record<string, unknown>;
type LarkElement = Record<string, unknown>;

const md = (content: string): LarkElement => ({
  tag: 'div',
  text: { tag: 'lark_md', content },
});
const hr = (): LarkElement => ({ tag: 'hr' });
const linkBtn = (
  content: string,
  url: string,
  type: 'default' | 'primary' = 'default',
): LarkElement => ({
  tag: 'action',
  actions: [{ tag: 'button', text: { tag: 'plain_text', content }, type, url }],
});
const wrapCard = (
  template: string,
  title: string,
  elements: LarkElement[],
): LarkCard => ({
  config: { wide_screen_mode: true },
  header: { template, title: { tag: 'plain_text', content: title } },
  elements,
});

// Toàn bộ tương tác với Lark gom về 1 service:
//  - CRUD cấu hình webhook (lark_webhook + lark_webhook_subscription) cho trang ADMIN
//  - định tuyến/fan-out thông báo theo audit action (dispatchSummary / dispatchQuoteCard)
//  - lấy tenant_access_token (cache RAM) + upload ảnh sản phẩm để nhúng vào card
//  - ký chữ ký custom bot (HMAC-SHA256) + gửi message card qua webhook (deliverCard)
//  - cầu chat web <-> Lark DM 1-1 với bot (onWebMessage / handleInboundLarkMessage + WS)
// Lỗi khi GỬI chỉ log, KHÔNG throw — thông báo hỏng không được làm gãy luồng nghiệp vụ chính.
// Lỗi khi LƯU cấu hình thì throw như bình thường (controller trả lỗi cho ADMIN).
@Injectable()
export class LarkService implements OnModuleInit {
  private readonly logger = new Logger(LarkService.name);
  private static readonly ROUTE_TTL_MS = 15_000;
  private static readonly BRIDGE_CONFIG_TTL_MS = 15_000;
  private static readonly DM_DIGEST_COOLDOWN_MS = 2 * 60 * 1000;
  // tenant_access_token sống ~2h; cache RAM, refresh sớm 5 phút trước hạn.
  private tokenCache: { token: string; expiresAt: number } | null = null;
  // Cache bảng định tuyến (webhook đang bật + action đang bật) — tránh 1 query mỗi lần ghi audit.
  private routesCache: { at: number; data: RouteRow[] } | null = null;
  // Cache công tắc tổng của cầu DM.
  private bridgeConfigCache: { at: number; enabled: boolean } | null = null;

  // Reply từ Lark DM -> RealtimeGateway subscribe cái này (tránh vòng phụ thuộc module).
  private readonly replySubject = new Subject<ChatMessageDto>();
  get reply$(): Observable<ChatMessageDto> {
    return this.replySubject.asObservable();
  }

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly quoteChat: QuoteChatService,
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

  // ============ Nội bộ — định tuyến ============

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

  // ============ Dựng message card ============

  // Field "Sale": có open_id -> @mention (Lark ping đúng người trong nhóm), không -> tên thường.
  private saleMention(data: QuoteCardData): string {
    return data.saleLarkOpenId
      ? `<at id="${data.saleLarkOpenId}"></at>`
      : data.saleName;
  }

  private fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  // Thẻ tóm tắt generic cho các hành động không phải "đã báo giá"
  // (từ chối, trả lại, tạo yêu cầu, xuất Excel, tin thử...). Header xám.
  private buildSummaryCard(input: SummaryCardInput): LarkCard {
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

    const elements = [
      md(
        [
          `**Người thực hiện:** ${input.actorName}`,
          `**Đối tượng:** ${target}`,
          `**Thời điểm:** ${at}`,
        ].join('\n'),
      ),
    ];
    if (input.detailUrl)
      elements.push(linkBtn('Xem chi tiết', input.detailUrl));
    return wrapCard('grey', input.actionLabel, elements);
  }

  // Dựng payload card "đã báo giá": header xanh, ảnh sản phẩm 2 cột, từng phương án + giá,
  // nút "Xem chi tiết". Upload ảnh trước — hỏng thì card vẫn dựng, chỉ thiếu ảnh.
  async buildQuoteCardPayload(data: QuoteCardData): Promise<LarkCard> {
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

  // card v1 cho custom bot. Nhúng ảnh chỉ khi có imgKey (upload thành công).
  private buildQuoteCard(
    data: QuoteCardData,
    imgKey: string | null,
    detailUrl: string | null,
  ): LarkCard {
    const elements: LarkElement[] = [];

    // Thông tin đơn — 1 khối text, mỗi field 1 dòng (để đặt vừa cột hẹp bên phải ảnh).
    const infoDiv = md(
      [
        `**Danh mục:** ${data.categoryName || '—'}`,
        `**Sản phẩm:** ${data.productName || '—'}`,
        `**Khách hàng:** ${data.customerName || '—'}`,
        `**Sale:** ${this.saleMention(data)}`,
        `**Order:** ${data.orderName || '—'}`,
        `**Ngày tạo:** ${this.fmtDate(data.createdAt)}`,
        `**Ngày báo giá:** ${this.fmtDate(data.quotedAt)}`,
      ].join('\n'),
    );

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

    // Chỉ dựng phương án BÁO GIÁ CHÍNH (data.options đã lọc ở buildQuoteCardData còn đúng 1 phương
    // án chính, bỏ các phương án phụ / so sánh loại vàng khác).
    data.options.forEach((opt) => {
      const lines = [`**${opt.name}**`];
      if (opt.materialText) lines.push(`• Chất liệu: ${opt.materialText}`);
      lines.push(`• Giá chất liệu: ${formatVnd(opt.materialPrice)}`);
      lines.push(`• Đá: ${opt.stoneText}`);
      if (opt.stonePrice > 0)
        lines.push(`• Giá đá: ${formatVnd(opt.stonePrice)}`);
      lines.push(`• Giá báo: ${formatVnd(opt.quotedPrice)}`);
      elements.push(hr());
      elements.push(md(lines.join('\n')));
    });

    elements.push(hr());
    elements.push(
      md(
        `**TỔNG BÁO GIÁ**\n<font color="green">**${formatVnd(data.totalPrice)}**</font>`,
      ),
    );

    if (detailUrl) elements.push(linkBtn('Xem chi tiết', detailUrl, 'primary'));

    return wrapCard('green', `Đã báo giá · ${data.code}`, elements);
  }

  private dmPreview(msg: ChatMessageDto): string {
    if (msg.content) {
      return msg.content.length > 200
        ? `${msg.content.slice(0, 200)}…`
        : msg.content;
    }
    return msg.imageUrl ? '[đã gửi ảnh]' : '';
  }

  // Thẻ DM cầu chat: header xanh nổi bật, tên khách + loại, rồi tên người gửi + nội dung.
  private buildDmCard(
    quote: DmCardQuote,
    msg: ChatMessageDto,
    pendingCount: number,
  ): LarkCard {
    const title =
      pendingCount > 1
        ? `${pendingCount} tin mới · ${quote.code}`
        : `Tin nhắn mới · ${quote.code}`;
    return wrapCard('blue', title, [
      md(`**${quote.customer.name}** · ${quote.category.name}`),
      hr(),
      md(`**${msg.senderName}**\n${this.dmPreview(msg)}`),
    ]);
  }

  // ============ Chữ ký + gửi card qua webhook ============

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
    card: LarkCard,
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

  // ============ Lark app — gửi DM 1-1 với bot ============

  /**
   * Gửi DM text tới 1 user theo open_id. Trả message_id để lưu làm "anchor"
   * cho luồng reply. null nếu thiếu token hoặc Lark trả lỗi.
   */
  async sendDirectMessage(
    openId: string,
    text: string,
  ): Promise<{ messageId: string } | null> {
    const token = await this.getTenantToken();
    if (!token) return null;
    try {
      const res = await fetch(
        `${APP_CONSTANTS.LARK_MESSAGE_SEND_URL}?receive_id_type=open_id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            receive_id: openId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
          }),
        },
      );
      const data: any = await res.json().catch(() => null);
      if (!data || data.code !== 0 || !data.data?.message_id) {
        this.logger.warn(
          `Lark gửi DM lỗi: ${data?.msg || `HTTP ${res.status}`}`,
        );
        return null;
      }
      return { messageId: data.data.message_id as string };
    } catch (err) {
      this.logger.warn(
        `Không gửi được Lark DM: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Gửi 1 interactive card tới user theo open_id — thẻ nổi bật hơn text thường,
   * dùng cho DM cầu chat. Chat 1-1 với bot không có thread nên không dùng reply
   * API, chỉ gửi thẳng.
   */
  async sendDirectCard(
    openId: string,
    card: unknown,
  ): Promise<{ messageId: string } | null> {
    const token = await this.getTenantToken();
    if (!token) return null;
    try {
      const res = await fetch(
        `${APP_CONSTANTS.LARK_MESSAGE_SEND_URL}?receive_id_type=open_id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            receive_id: openId,
            msg_type: 'interactive',
            content: JSON.stringify(card),
          }),
        },
      );
      const data: any = await res.json().catch(() => null);
      if (!data || data.code !== 0 || !data.data?.message_id) {
        this.logger.warn(
          `Lark gửi card lỗi: ${data?.msg || `HTTP ${res.status}`}`,
        );
        return null;
      }
      return { messageId: data.data.message_id as string };
    } catch (err) {
      this.logger.warn(
        `Không gửi được Lark card: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // ============ Cầu chat web <-> Lark DM — công tắc ADMIN ============

  async isBridgeEnabled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.bridgeConfigCache &&
      now - this.bridgeConfigCache.at < LarkService.BRIDGE_CONFIG_TTL_MS
    ) {
      return this.bridgeConfigCache.enabled;
    }
    const row = await this.prisma.larkDmBridgeConfig.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { isEnabled: true },
    });
    const enabled = row?.isEnabled ?? false;
    this.bridgeConfigCache = { at: now, enabled };
    return enabled;
  }

  async getBridgeStatus(): Promise<LarkDmBridgeStatus> {
    const row = await this.prisma.larkDmBridgeConfig.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { name: true } } },
    });
    return {
      isEnabled: row?.isEnabled ?? false,
      changedByName: row?.changedBy?.name ?? null,
      changedAt: row?.createdAt?.toISOString() ?? null,
    };
  }

  async setBridgeEnabled(
    isEnabled: boolean,
    note: string | undefined,
    userId: string,
  ): Promise<LarkDmBridgeStatus> {
    await this.prisma.larkDmBridgeConfig.create({
      data: { isEnabled, note: note?.trim() || null, changedById: userId },
    });
    this.bridgeConfigCache = null;
    return this.getBridgeStatus();
  }

  // ============ Cầu chat — chiều web -> Lark DM ============

  /**
   * Gọi từ RealtimeGateway sau khi lưu + emit tin web. Fire-and-forget:
   * mọi lỗi tự log, không throw.
   * @param recipientInRoom người nhận đang mở đúng room chat này trên web?
   */
  async onWebMessage(
    msg: ChatMessageDto,
    recipientId: string,
    recipientInRoom: boolean,
  ): Promise<void> {
    try {
      if (recipientInRoom) return;
      if (!(await this.isBridgeEnabled())) return;

      const recipient = await this.prisma.user.findUnique({
        where: { id: recipientId },
        select: { larkOpenId: true },
      });
      if (!recipient?.larkOpenId) return;

      const quote = await this.prisma.quoteRequest.findUnique({
        where: { id: msg.quoteRequestId },
        select: {
          code: true,
          customer: { select: { name: true } },
          category: { select: { name: true } },
        },
      });
      if (!quote) return;

      const key = {
        quoteRequestId_userId: {
          quoteRequestId: msg.quoteRequestId,
          userId: recipientId,
        },
      };
      const read = await this.prisma.quoteChatRead.upsert({
        where: key,
        create: {
          quoteRequestId: msg.quoteRequestId,
          userId: recipientId,
          lastReadAt: new Date(0),
          larkPendingCount: 1,
        },
        update: { larkPendingCount: { increment: 1 } },
        select: {
          larkAnchorMsgId: true,
          larkPendingCount: true,
          larkLastDmAt: true,
        },
      });

      if (!read.larkAnchorMsgId) {
        const sent = await this.sendDirectCard(
          recipient.larkOpenId,
          this.buildDmCard(quote, msg, 0),
        );
        if (!sent) return;
        await this.prisma.quoteChatRead.update({
          where: key,
          data: {
            larkAnchorMsgId: sent.messageId,
            larkLastDmAt: new Date(),
            larkPendingCount: 0,
          },
        });
        return;
      }

      const lastAt = read.larkLastDmAt?.getTime() ?? 0;
      if (Date.now() - lastAt < LarkService.DM_DIGEST_COOLDOWN_MS) return;

      const sent = await this.sendDirectCard(
        recipient.larkOpenId,
        this.buildDmCard(quote, msg, read.larkPendingCount),
      );
      if (!sent) return;
      await this.prisma.quoteChatRead.update({
        where: key,
        data: {
          larkAnchorMsgId: sent.messageId,
          larkLastDmAt: new Date(),
          larkPendingCount: 0,
        },
      });
    } catch (err) {
      this.logger.warn(
        `onWebMessage lỗi (quote ${msg.quoteRequestId}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Người nhận đã mở / đọc room web -> reset đếm gộp, giữ anchor + lastDmAt. */
  async onRecipientEngaged(
    quoteRequestId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.prisma.quoteChatRead.updateMany({
        where: {
          quoteRequestId,
          userId,
          larkPendingCount: { gt: 0 },
        },
        data: { larkPendingCount: 0 },
      });
    } catch (err) {
      this.logger.warn(
        `onRecipientEngaged lỗi: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ============ Cầu chat — chiều Lark -> web (WS long-connection) ============

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('LARK_WS_ENABLED') !== 'true') {
      this.logger.log('Lark DM bridge WS: tắt (LARK_WS_ENABLED != true)');
      return;
    }
    const appId = this.config.get<string>('LARK_APP_ID');
    const appSecret = this.config.get<string>('LARK_APP_SECRET');
    if (!appId || !appSecret) {
      this.logger.warn(
        'Lark DM bridge WS: thiếu LARK_APP_ID / LARK_APP_SECRET',
      );
      return;
    }
    try {
      const Lark = await import('@larksuiteoapi/node-sdk');
      const wsClient = new Lark.WSClient({
        appId,
        appSecret,
        domain: Lark.Domain.Lark,
        loggerLevel: Lark.LoggerLevel.warn,
        onError: (e) =>
          this.logger.error(
            `Lark DM bridge WS lỗi: ${e instanceof Error ? e.message : e}`,
          ),
        onReconnected: () =>
          this.logger.log('Lark DM bridge WS: đã kết nối lại'),
      });
      const dispatcher = new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: unknown) => {
          const evt = data as LarkInboundEventData;
          await this.handleInboundLarkMessage({
            sender: evt?.sender,
            message: evt?.message,
          });
        },
      });
      void wsClient.start({ eventDispatcher: dispatcher });
      this.logger.log('Lark DM bridge WS: đã khởi động');
    } catch (err) {
      this.logger.error(
        `Lark DM bridge WS không khởi động được: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Nhận reply của người dùng trong Lark, đẩy vào đúng room chat web. */
  async handleInboundLarkMessage(evt: LarkInboundEventData): Promise<void> {
    try {
      const msg = evt?.message;
      const sender = evt?.sender;
      if (!msg?.message_id) return;
      if (sender?.sender_type && sender.sender_type !== 'user') return;

      const senderOpenId = sender?.sender_id?.open_id ?? null;
      const botReply = (t: string) => {
        if (senderOpenId) void this.sendDirectMessage(senderOpenId, t);
      };

      if (msg.message_type !== 'text') {
        botReply(
          'Ảnh và tệp chỉ gửi và xem được trên web. Vào web để gửi ảnh.',
        );
        return;
      }

      const rootId = msg.root_id || msg.parent_id || null;

      // Chat 1-1 với bot thường KHÔNG có reply/thread -> tin gõ thẳng không có
      // parent_id. Khi đó coi như trả lời cho DM gần nhất bot gửi cho người này.
      const read = rootId
        ? await this.prisma.quoteChatRead.findFirst({
            where: { larkAnchorMsgId: rootId },
            select: {
              quoteRequestId: true,
              userId: true,
              user: { select: { larkOpenId: true } },
            },
          })
        : senderOpenId
          ? await this.prisma.quoteChatRead.findFirst({
              where: {
                larkAnchorMsgId: { not: null },
                user: { larkOpenId: senderOpenId },
              },
              orderBy: { larkLastDmAt: { sort: 'desc', nulls: 'last' } },
              select: {
                quoteRequestId: true,
                userId: true,
                user: { select: { larkOpenId: true } },
              },
            })
          : null;

      if (!read) {
        botReply('Chưa có yêu cầu nào đang chờ bạn trả lời. Mở web để nhắn.');
        return;
      }

      if (
        senderOpenId &&
        read.user.larkOpenId &&
        senderOpenId !== read.user.larkOpenId
      ) {
        return;
      }

      let text = '';
      try {
        const parsed = JSON.parse(msg.content ?? '{}') as { text?: unknown };
        text = String(parsed.text ?? '').trim();
      } catch {
        text = '';
      }
      if (!text) return;

      let saved: ChatMessageDto;
      try {
        saved = await this.quoteChat.saveMessage(
          read.quoteRequestId,
          read.userId,
          text,
        );
      } catch (err) {
        const reason =
          err instanceof ForbiddenException
            ? 'Bạn không còn phụ trách yêu cầu này.'
            : err instanceof BadRequestException
              ? 'Tin quá dài (tối đa 2000 ký tự), gửi lại giúp.'
              : 'Không lưu được tin, thử lại trên web.';
        botReply(reason);
        return;
      }

      this.replySubject.next(saved);
      await this.prisma.quoteChatRead.updateMany({
        where: { quoteRequestId: read.quoteRequestId, userId: read.userId },
        data: { larkPendingCount: 0 },
      });
    } catch (err) {
      this.logger.warn(
        `handleInboundLarkMessage lỗi: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
