import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as https from 'https';
import { APP_CONSTANTS } from '../common/constants';
import { MaterialsService } from '../materials/materials.service';
import { classifyMaterialType } from '../materials/material-type.util';
import { VnGoldPriceItem } from './vn-gold-price.types';
import { VANG_TODAY_PATH, VANG_TODAY_SOURCES } from './vn-gold-price.constants';

@Injectable()
export class VnGoldPriceService implements OnModuleInit {
  private readonly logger = new Logger(VnGoldPriceService.name);

  private token: string | null = null;
  private tokenFetchedAt = 0;

  // Giá vàng 24K gốc lấy từ API ngoài — tách riêng khỏi priceRatioPct vì gọi API ngoài tốn kém,
  // chỉ nên làm mới 1 ngày/lần (REFRESH_INTERVAL_MS). Đọc materials thì rẻ (có cache sẵn ở
  // MaterialsService), tính lại được mỗi lần load — không đợi 24h tick mới thấy admin vừa sửa.
  private base24kPerChi = 0;
  private lastExternalFetchedAt = 0;

  private lastItems: VnGoldPriceItem[] = [];
  private lastRaw: Record<string, number> = {};
  private lastComputedAt = 0;

  // Giá vàng 24K bán ra của 4 thương hiệu (SJC, Bảo Tín, DOJI, PNJ) cào từ vang.today —
  // đây là dữ liệu hiển thị ở "Giá Vàng Thị Trường". vnAppMob (phía trên) vẫn được gọi
  // để giữ nóng base24kPerChi nhưng tạm thời không dùng để hiển thị nữa.
  private vangTodayItems: VnGoldPriceItem[] = [];
  private vangTodayFetchedAt = 0;

  constructor(private readonly materialsService: MaterialsService) {}

  async onModuleInit() {
    await this.refreshExternalPrice().catch((err) =>
      this.logger.warn(
        `Không thể tải giá vàng tham khảo lúc khởi động: ${err.message}`,
      ),
    );
    await this.recomputeItems();

    await this.refreshVangToday().catch((err) =>
      this.logger.warn(
        `Không thể tải giá vàng vang.today lúc khởi động: ${err.message}`,
      ),
    );
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

    try {
      await this.refreshVangToday();
    } catch (err: any) {
      this.logger.warn(
        `Tự động refresh giá vàng vang.today thất bại: ${err.message}`,
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

    // Luôn tính lại items theo priceRatioPct hiện tại của materials — admin vừa thêm/sửa loại vàng
    // phải thấy ngay ở đây, không phải đợi tick refresh 24h của giá vàng ngoài.
    try {
      await this.recomputeItems();
    } catch (err: any) {
      this.logger.warn(
        `Lỗi tính lại giá vàng tham khảo, dùng dữ liệu cũ: ${err.message}`,
      );
    }

    // Lưới an toàn cho giá vang.today, tương tự lưới an toàn của vnAppMob ở trên.
    if (
      Date.now() - this.vangTodayFetchedAt >
      APP_CONSTANTS.REFRESH_INTERVAL_MS
    ) {
      try {
        await this.refreshVangToday();
      } catch (err: any) {
        this.logger.warn(
          `Lỗi refresh giá vàng vang.today, dùng dữ liệu cũ: ${err.message}`,
        );
      }
    }

    return {
      items: this.vangTodayItems,
      updatedAt: this.vangTodayFetchedAt
        ? new Date(this.vangTodayFetchedAt).toISOString()
        : new Date().toISOString(),
      source:
        'vang.today (giá bán vàng 24K SJC/Bảo Tín/DOJI/PNJ) — chỉ tham khảo, không dùng để tính giá',
    };
  }

  private async ensureToken(): Promise<string> {
    if (
      this.token &&
      Date.now() - this.tokenFetchedAt < APP_CONSTANTS.TOKEN_TTL_MS
    ) {
      return this.token;
    }

    const data = await this.httpGetJson(APP_CONSTANTS.VNAPPMOB_API_KEY);
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
    const data = await this.httpGetJson(APP_CONSTANTS.VNAPPMOB_GOLD_URL, token);
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

  // Nhân giá gốc 24K (đã cache ở base24kPerChi) với priceRatioPct MỚI NHẤT của từng chất liệu Vàng
  // trong DB — không gọi API ngoài nên rẻ, gọi lại mỗi lần getLatest() được, phản ánh ngay khi
  // admin vừa sửa % ở màn quản lý chất liệu.
  private async recomputeItems(): Promise<void> {
    if (!this.base24kPerChi) return; // chưa có giá gốc lần nào (vd lần gọi API ngoài đầu tiên lỗi)

    const materials = await this.materialsService.findAll();
    const goldMaterials = materials.filter(
      (m) => classifyMaterialType(m.name) === 'GOLD',
    );
    const nextRaw: Record<string, number> = {};

    const items: VnGoldPriceItem[] = goldMaterials.map((m) => {
      const applied = Number(m.priceRatioPct);
      const ratio = applied > 1 ? applied / 100 : applied;
      const priceVnd = Math.round(this.base24kPerChi * ratio);
      nextRaw[m.id] = priceVnd;

      const prev = this.lastRaw[m.id];
      const changeAmount = prev ? priceVnd - prev : null;
      const changePct = prev
        ? Math.round(((priceVnd - prev) / prev) * 10000) / 100
        : null;

      return { key: m.id, label: m.name, priceVnd, changeAmount, changePct };
    });

    this.lastRaw = nextRaw;
    this.lastItems = items;
    this.lastComputedAt = Date.now();
  }

  // Cào giá bán vàng 24K từ vang.today (trang server-render, không có API JSON) cho 4
  // thương hiệu ở VANG_TODAY_SOURCES, quy đổi từ đ/lượng sang đ/chỉ.
  private async refreshVangToday(): Promise<void> {
    const html = await this.httpGetText(
      `${APP_CONSTANTS.VANG_TODAY_URL}${VANG_TODAY_PATH}`,
    );
    const items = this.parseVangTodayItems(html);
    if (items.length === 0) {
      throw new Error('Không đọc được giá vàng từ vang.today');
    }
    this.vangTodayItems = items;
    this.vangTodayFetchedAt = Date.now();
  }

  private parseVangTodayItems(html: string): VnGoldPriceItem[] {
    const items: VnGoldPriceItem[] = [];

    for (const source of VANG_TODAY_SOURCES) {
      const blockMatch = html.match(
        new RegExp(
          `data-code="${source.code}"[\\s\\S]*?<!-- History Panel -->`,
        ),
      );
      if (!blockMatch) continue;

      const cellRegex =
        /<div class="price-value">([\d.,]+)<span class="currency-unit">₫<\/span><\/div>\s*<div class="price-change"><span class='change-(up|down|neutral)'>([^<]*)<\/span><\/div>/g;
      const cells = [...blockMatch[0].matchAll(cellRegex)];
      const sellCell = cells[1]; // 0 = mua vào, 1 = bán ra
      if (!sellCell) continue;

      const sellLuong = parseInt(sellCell[1].replace(/[.,]/g, ''), 10);
      if (!Number.isFinite(sellLuong) || sellLuong <= 0) continue;

      const changeDigits = sellCell[3].replace(/[^\d]/g, '');
      const changeLuong = changeDigits ? parseInt(changeDigits, 10) : 0;
      const signedChangeLuong =
        sellCell[2] === 'down' ? -changeLuong : changeLuong;

      const priceVnd = Math.round(sellLuong / 10); // 1 lượng = 10 chỉ
      const changeAmount = signedChangeLuong
        ? Math.round(signedChangeLuong / 10)
        : 0;
      const changePct = signedChangeLuong
        ? Math.round(
            (signedChangeLuong / (sellLuong - signedChangeLuong)) * 10000,
          ) / 100
        : 0;

      items.push({
        key: source.code,
        label: source.label,
        priceVnd,
        changeAmount,
        changePct,
      });
    }

    return items;
  }

  private httpGetText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000,
      };
      const req = https.get(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout khi gọi vang.today'));
      });
    });
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
