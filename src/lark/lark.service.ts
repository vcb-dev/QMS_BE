import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { APP_CONSTANTS } from '../common/constants';
import { formatVnd } from '../utils/currency.util';
import { QuoteCardData } from './lark.types';

// Toàn bộ tương tác với Lark cho luồng báo giá gom về 1 service:
//  - lấy tenant_access_token (cache RAM) + upload ảnh sản phẩm lên Lark để nhúng vào card
//    (webhook custom bot không nhận URL ảnh, phải có image_key từ im/v1/images)
//  - ký chữ ký custom bot (HMAC-SHA256) + gửi message card qua webhook
// Mọi lỗi ở đây chỉ log, KHÔNG throw — thông báo hỏng không được làm gãy luồng nghiệp vụ chính.
@Injectable()
export class LarkService {
  private readonly logger = new Logger(LarkService.name);

  // tenant_access_token sống ~2h; cache RAM, refresh sớm 5 phút trước hạn.
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  // ============ Thông báo (webhook custom bot) ============

  // Thông báo Lark DUY NHẤT của luồng báo giá — bắn khi Order báo giá thành công, dạng message card
  // (msg_type: interactive): header xanh, field 2 cột, ảnh sản phẩm, từng phương án + giá, nút "Xem
  // chi tiết". Mọi mốc khác (tạo yêu cầu, từ chối, trả lại, gửi lại) không bắn Lark.
  async notifySaleQuoteCard(data: QuoteCardData): Promise<void> {
    const webhookUrl = this.config.get<string>('LARK_WEBHOOK_URL');
    if (!webhookUrl) return;

    // Upload ảnh trước (nếu có) — hỏng thì card vẫn gửi, chỉ thiếu ảnh.
    const imgKey = data.imageUrl
      ? await this.uploadImageFromUrl(data.imageUrl)
      : null;

    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    const detailUrl =
      frontendUrl && data.requestId
        ? `${frontendUrl}/requests/${data.requestId}`
        : null;

    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      card: this.buildQuoteCard(data, imgKey, detailUrl),
    };
    this.attachSign(body);
    await this.deliver(webhookUrl, body);
  }

  // Chữ ký Custom Bot Lark: HMAC-SHA256 với key = `${timestamp}\n${secret}`, hash trên chuỗi rỗng —
  // đúng thuật toán Lark quy định, không phải HMAC thông thường.
  private sign(timestamp: string, secret: string): string {
    return createHmac('sha256', `${timestamp}\n${secret}`)
      .update('')
      .digest('base64');
  }

  private attachSign(body: Record<string, unknown>): void {
    const secret = this.config.get<string>('LARK_SECRET');
    if (!secret) return;
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = this.sign(timestamp, secret);
  }

  private async deliver(
    webhookUrl: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.logger.warn(`Lark webhook trả về lỗi HTTP ${res.status}`);
        return;
      }
      const data: any = await res.json().catch(() => null);
      if (data && data.code !== 0) {
        this.logger.warn(
          `Lark webhook từ chối: ${data.msg || JSON.stringify(data)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Không thể gửi thông báo Lark: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ============ Dựng message card ============

  private field(label: string, value: string) {
    return {
      is_short: true,
      text: { tag: 'lark_md', content: `**${label}**\n${value || '—'}` },
    };
  }

  // card v1 cho custom bot (msg_type: interactive). Nhúng ảnh chỉ khi có imgKey (upload thành công).
  private buildQuoteCard(
    data: QuoteCardData,
    imgKey: string | null,
    detailUrl: string | null,
  ): Record<string, unknown> {
    const elements: Record<string, unknown>[] = [
      {
        tag: 'div',
        fields: [
          this.field('Danh mục', data.categoryName),
          this.field('Sản phẩm', data.productName),
          this.field('Khách hàng', data.customerName),
          this.field('SĐT', data.customerPhone || '—'),
          this.field('Sale', data.saleName),
          this.field('Order', data.orderName),
        ],
      },
    ];

    if (imgKey) {
      elements.push({
        tag: 'img',
        img_key: imgKey,
        alt: { tag: 'plain_text', content: 'Ảnh sản phẩm' },
        mode: 'fit_horizontal',
        preview: true,
      });
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
    if (!appId || !appSecret) return null;

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
    if (!/^https?:\/\//i.test(imageUrl)) return null;

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
