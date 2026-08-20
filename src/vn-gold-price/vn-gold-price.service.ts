import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as https from 'https';
import { APP_CONSTANTS } from '../common/constants';
import { PricingConfigService } from '../pricing-config/pricing-config.service';

export interface VnGoldPriceItem {
  key: string;
  label: string;
  priceVnd: number; // đ/chỉ
  changeAmount: number | null;
  changePct: number | null;
}

@Injectable()
export class VnGoldPriceService implements OnModuleInit {
  private readonly logger = new Logger(VnGoldPriceService.name);

  private token: string | null = null;
  private tokenFetchedAt = 0;

  // Giá vàng 24K gốc lấy từ API ngoài — tách riêng khỏi goldRatios vì gọi API ngoài tốn kém,
  // chỉ nên làm mới 1 ngày/lần (REFRESH_INTERVAL_MS). goldRatios thì rẻ (đọc DB có cache sẵn ở
  // PricingConfigService), tính lại được mỗi lần load — không đợi 24h tick mới thấy admin vừa sửa.
  private base24kPerChi = 0;
  private lastExternalFetchedAt = 0;

  private lastItems: VnGoldPriceItem[] = [];
  private lastRaw: Record<string, number> = {};
  private lastComputedAt = 0;

  constructor(private readonly pricingConfigService: PricingConfigService) {}

  async onModuleInit() {
    await this.refreshExternalPrice().catch((err) =>
      this.logger.warn(
        `Không thể tải giá vàng tham khảo lúc khởi động: ${err.message}`,
      ),
    );
    await this.recomputeItems();
  }

  @Interval(APP_CONSTANTS.REFRESH_INTERVAL_MS)
  async autoRefresh() {
    try {
      await this.refreshExternalPrice();
      await this.recomputeItems();
    } catch (err: any) {
      this.logger.warn(
        `Tự động refresh giá vàng tham khảo thất bại: ${err.message}`,
      );
    }
  }

  async getLatest(): Promise<{
    items: VnGoldPriceItem[];
    updatedAt: string;
    source: string;
  }> {
    // Auto-refresh (Interval) chạy nền 1 ngày/lần — chỗ này chỉ là lưới an toàn
    // nếu vì lý do gì đó giá gốc vẫn bị cũ hơn dự kiến.
    if (
      Date.now() - this.lastExternalFetchedAt >
      APP_CONSTANTS.REFRESH_INTERVAL_MS
    ) {
      try {
        await this.refreshExternalPrice();
      } catch (err: any) {
        this.logger.warn(
          `Lỗi refresh giá vàng tham khảo, dùng giá gốc cũ: ${err.message}`,
        );
      }
    }

    // Luôn tính lại items theo goldRatios hiện tại — admin vừa thêm/sửa loại vàng ở Cấu hình giá
    // phải thấy ngay ở đây, không phải đợi tick refresh 24h của giá vàng ngoài.
    try {
      await this.recomputeItems();
    } catch (err: any) {
      this.logger.warn(
        `Lỗi tính lại giá vàng tham khảo, dùng dữ liệu cũ: ${err.message}`,
      );
    }

    return {
      items: this.lastItems,
      updatedAt: this.lastComputedAt
        ? new Date(this.lastComputedAt).toISOString()
        : new Date().toISOString(),
      source:
        'vnappmob.com (nữ trang 99.99%) — chỉ tham khảo, không dùng để tính giá',
    };
  }

  private async ensureToken(): Promise<string> {
    if (
      this.token &&
      Date.now() - this.tokenFetchedAt < APP_CONSTANTS.TOKEN_TTL_MS
    ) {
      return this.token;
    }

    const data = await this.httpGetJson(APP_CONSTANTS.VNAPPMONEY_TOKEN_URL);
    const token = data?.results;
    if (!token || typeof token !== 'string') {
      throw new Error('Không lấy được API token từ vnappmob');
    }

    this.token = token;
    this.tokenFetchedAt = Date.now();
    return token;
  }

  private async refreshExternalPrice(): Promise<void> {
    const token = await this.ensureToken();
    const data = await this.httpGetJson(
      APP_CONSTANTS.VNAPPMONEY_GOLD_URL,
      token,
    );
    const row = Array.isArray(data?.results) ? data.results[0] : null;
    if (!row) {
      throw new Error('Phản hồi giá vàng vnappmob không hợp lệ');
    }

    const base24kPerLuong = parseFloat(row.sell_nutrang_9999);
    if (!Number.isFinite(base24kPerLuong) || base24kPerLuong <= 0) {
      throw new Error('Giá vàng nữ trang 99.99% trả về không hợp lệ');
    }
    this.base24kPerChi = base24kPerLuong / 10; // 1 lượng = 10 chỉ
    this.lastExternalFetchedAt = Date.now();
  }

  // Nhân giá gốc 24K (đã cache ở base24kPerChi) với goldRatios MỚI NHẤT từ DB — không gọi API
  // ngoài nên rẻ, gọi lại mỗi lần getLatest() được, phản ánh ngay khi admin sửa Cấu hình giá.
  private async recomputeItems(): Promise<void> {
    if (!this.base24kPerChi) return; // chưa có giá gốc lần nào (vd lần gọi API ngoài đầu tiên lỗi)

    const config = await this.pricingConfigService.getConfig();
    const nextRaw: Record<string, number> = {};

    const items: VnGoldPriceItem[] = (config.goldRatios || []).map((r) => {
      const ratio = r.applied > 1 ? r.applied / 100 : r.applied;
      const priceVnd = Math.round(this.base24kPerChi * ratio);
      nextRaw[r.key] = priceVnd;

      const prev = this.lastRaw[r.key];
      const changeAmount = prev ? priceVnd - prev : null;
      const changePct = prev
        ? Math.round(((priceVnd - prev) / prev) * 10000) / 100
        : null;

      return { key: r.key, label: r.label, priceVnd, changeAmount, changePct };
    });

    this.lastRaw = nextRaw;
    this.lastItems = items;
    this.lastComputedAt = Date.now();
  }

  private httpGetJson(url: string, bearerToken?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        timeout: 8000,
      };
      const req = https.get(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Không parse được phản hồi JSON từ vnappmob'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout khi gọi API vnappmob'));
      });
    });
  }
}
