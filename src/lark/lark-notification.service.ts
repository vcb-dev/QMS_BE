import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
export interface LarkLink {
  text: string;
  href: string;
}


@Injectable()
export class LarkNotificationService {
  private readonly logger = new Logger(LarkNotificationService.name);

  constructor(private readonly config: ConfigService) {}

  // Chữ ký Custom Bot Lark: HMAC-SHA256 với key = `${timestamp}\n${secret}`, hash trên chuỗi rỗng —
  // đúng thuật toán Lark quy định, không phải HMAC thông thường.
  private sign(timestamp: string, secret: string): string {
    return createHmac('sha256', `${timestamp}\n${secret}`)
      .update('')
      .digest('base64');
  }

  // Link "Xem chi tiết" trỏ vào trang chi tiết đơn trên FE — dùng chung FRONTEND_URL đã có sẵn
  // cho CORS (realtime.gateway.ts). Không có FRONTEND_URL thì bỏ qua link, vẫn gửi tin nhắn thường.
  private buildRequestLink(requestId: string): LarkLink | undefined {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    if (!frontendUrl) return undefined;
    return {
      text: 'Xem chi tiết →',
      href: `${frontendUrl}/requests/${requestId}`,
    };
  }

  // Báo bot ORDER — dùng khi Sale tạo/gửi lại yêu cầu, cần Order xử lý.
  async notifyOrder(text: string, requestId?: string): Promise<void> {
    return this.send('LARK_WEBHOOK_URL', 'LARK_SECRET', text, requestId);
  }

  // Báo bot SALE — dùng khi Order hoàn tất báo giá/từ chối/trả lại, cần Sale biết kết quả.
  async notifySale(text: string, requestId?: string): Promise<void> {
    return this.send(
      'LARK_SALE_WEBHOOK_URL',
      'LARK_SALE_SECRET',
      text,
      requestId,
    );
  }

  // Bắn thông báo không được làm hỏng luồng nghiệp vụ chính — lỗi chỉ log, không throw.
  private async send(
    urlKey: string,
    secretKey: string,
    text: string,
    requestId?: string,
  ): Promise<void> {
    const webhookUrl = this.config.get<string>(urlKey);
    if (!webhookUrl) return;

    const secret = this.config.get<string>(secretKey);
    const link = requestId ? this.buildRequestLink(requestId) : undefined;
    const body: Record<string, unknown> = link
      ? {
          msg_type: 'post',
          content: {
            post: {
              vi: {
                title: '',
                content: [
                  [
                    { tag: 'text', text: `${text} ` },
                    { tag: 'a', text: link.text, href: link.href },
                  ],
                ],
              },
            },
          },
        }
      : {
          msg_type: 'text',
          content: { text },
        };
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      body.timestamp = timestamp;
      body.sign = this.sign(timestamp, secret);
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.logger.warn(
          `Lark webhook (${urlKey}) trả về lỗi HTTP ${res.status}`,
        );
        return;
      }
      const data: any = await res.json().catch(() => null);
      if (data && data.code !== 0) {
        this.logger.warn(
          `Lark webhook (${urlKey}) từ chối: ${data.msg || JSON.stringify(data)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Không thể gửi thông báo Lark (${urlKey}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
