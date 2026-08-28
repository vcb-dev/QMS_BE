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

  // Báo bot SALE dạng "post" nhiều dòng — dùng khi Order báo giá thành công, Sale cần xem đầy đủ
  // thông tin yêu cầu kèm giá. Mỗi phần tử `lines` là 1 dòng; dòng cuối tự chèn link "Xem chi tiết".
  // Đây là thông báo Lark DUY NHẤT của luồng báo giá — mọi mốc khác (tạo yêu cầu, từ chối, trả lại,
  // gửi lại) không bắn Lark nữa.
  async notifySaleDetail(lines: string[], requestId?: string): Promise<void> {
    const webhookUrl = this.config.get<string>('LARK_SALE_WEBHOOK_URL');
    if (!webhookUrl) return;

    const link = requestId ? this.buildRequestLink(requestId) : undefined;
    const content: unknown[][] = lines
      .filter((l) => l != null)
      .map((line) => [{ tag: 'text', text: line }]);
    if (link) {
      content.push([{ tag: 'a', text: link.text, href: link.href }]);
    }

    const body: Record<string, unknown> = {
      msg_type: 'post',
      content: { post: { vi: { title: '', content } } },
    };
    this.attachSign(body, 'LARK_SALE_SECRET');
    await this.deliver('LARK_SALE_WEBHOOK_URL', webhookUrl, body);
  }

  private attachSign(body: Record<string, unknown>, secretKey: string): void {
    const secret = this.config.get<string>(secretKey);
    if (!secret) return;
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = this.sign(timestamp, secret);
  }

  // Bắn thông báo không được làm hỏng luồng nghiệp vụ chính — lỗi chỉ log, không throw.
  private async deliver(
    urlKey: string,
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
