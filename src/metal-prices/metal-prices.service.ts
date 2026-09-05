import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BaseMetalDto,
  BaseMetalPriceHistoryItem,
} from './dto/metal-prices.dto';

// % biến động so với giá active trước đó — 0 nếu không đổi, null nếu chưa từng có dữ liệu cũ.
// Kẹp trong ±9999.99 cho khớp cột DB Decimal(6,2).
const MAX_CHANGE_PCT = 9999.99;
function computeChangePct(next: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  if (next === prev) return 0;
  const pct = Math.round(((next - prev) / prev) * 10000) / 100;
  return Math.max(-MAX_CHANGE_PCT, Math.min(MAX_CHANGE_PCT, pct));
}

@Injectable()
export class MetalPricesService {
  private readonly logger = new Logger(MetalPricesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // baseMetalId -> giá đang active. Query thẳng DB mỗi lần gọi (không cache RAM).
  async getLatestAsync(): Promise<Map<string, number>> {
    const rows = await this.prisma.baseMetalPriceHistory.findMany({
      where: { isActive: true },
      select: { baseMetalId: true, priceVnd: true },
    });
    return new Map(rows.map((r) => [r.baseMetalId, Number(r.priceVnd)]));
  }

  // Danh mục kim loại gốc kèm giá hiện tại — dùng cho tab "Nguồn giá gốc" (PricingConfigPage) và
  // dropdown "Kim loại gốc" lúc tạo/sửa Material.
  async listBaseMetals(): Promise<BaseMetalDto[]> {
    const metals = await this.prisma.baseMetal.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        priceHistory: {
          where: { isActive: true },
          take: 1,
          include: { updatedBy: { select: { name: true } } },
        },
      },
    });
    return metals.map((m) => {
      const active = m.priceHistory[0];
      return {
        id: m.id,
        name: m.name,
        isActive: m.isActive,
        isDefault: m.isDefault,
        priceVnd: active ? Number(active.priceVnd) : 0,
        changePct: active?.changePct != null ? Number(active.changePct) : null,
        updatedAt: active ? active.createdAt.toISOString() : null,
        updatedByName: active?.updatedBy?.name ?? null,
      };
    });
  }

  async createBaseMetal(name: string): Promise<BaseMetalDto> {
    const created = await this.prisma.baseMetal.create({ data: { name } });
    return {
      id: created.id,
      name: created.name,
      isActive: created.isActive,
      isDefault: created.isDefault,
      priceVnd: 0,
      changePct: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  async setBaseMetalActive(id: string, isActive: boolean): Promise<void> {
    await this.prisma.baseMetal.update({ where: { id }, data: { isActive } });
  }

  // Mỗi lần cập nhật giá 1 kim loại tạo 1 DÒNG LỊCH SỬ MỚI CỦA CHÍNH KIM LOẠI ĐÓ — không sửa lên
  // dòng cũ, không đụng dòng active của kim loại khác (khác MetalPrice cũ set isActive=false toàn bảng).
  async updatePrice(
    baseMetalId: string,
    priceVnd: number,
    updatedBy?: { id?: string },
  ): Promise<BaseMetalPriceHistoryItem> {
    // Serializable + đọc prev TRONG transaction: 2 request cập nhật cùng 1 kim loại đồng thời sẽ
    // không cùng tạo dòng active thứ 2 (đọc-tắt-tạo là chuỗi read-modify-write, isolation mặc định
    // Read Committed vẫn lách được). Partial unique "base_metal_price_history_one_active" là chốt
    // chặn cuối; request thua sẽ nhận lỗi transaction thay vì ghi giá sai.
    //
    // Nhưng Serializable của Postgres còn ném P2034 (serialization failure) cả khi 2 request cập
    // nhật KHÁC kim loại chạy song song — FE "Lưu cấu hình" bắn Promise.all nhiều PATCH giá một
    // lúc. Đó là xung đột nhất thời, không phải ghi sai: retry vài lần, lần chạy lại gần như luôn
    // thành công. (FE cũng đã đổi sang gọi tuần tự, đây là lớp chắn cho cả 2 admin cùng lúc.)
    const created = await this.runPriceTxWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const prev = await tx.baseMetalPriceHistory.findFirst({
            where: { baseMetalId, isActive: true },
          });
          const changePct = prev
            ? computeChangePct(priceVnd, Number(prev.priceVnd))
            : null;

          await tx.baseMetalPriceHistory.updateMany({
            where: { baseMetalId, isActive: true },
            data: { isActive: false },
          });
          return tx.baseMetalPriceHistory.create({
            data: {
              baseMetalId,
              priceVnd,
              changePct,
              source: 'cập nhật thủ công',
              isActive: true,
              updatedById: updatedBy?.id,
            },
            include: {
              updatedBy: { select: { name: true } },
              baseMetal: { select: { name: true } },
            },
          });
        },
        { isolationLevel: 'Serializable' },
      ),
    );

    this.logger.log(
      `Đã cập nhật giá ${created.baseMetal.name} — tạo dòng lịch sử mới`,
    );
    return this.toHistoryItem(created);
  }

  // Chạy lại transaction khi Postgres báo P2034 (write conflict / serialization failure) —
  // xung đột nhất thời giữa các request song song, không phải lỗi dữ liệu. Backoff nhẹ tăng dần.
  private async runPriceTxWithRetry<T>(run: () => Promise<T>): Promise<T> {
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        const isSerializationConflict =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034';
        if (!isSerializationConflict || attempt >= MAX_ATTEMPTS) throw err;
        this.logger.warn(
          `Cập nhật giá kim loại gặp P2034 (lần ${attempt}/${MAX_ATTEMPTS}) — thử lại`,
        );
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }

  // Bỏ dòng "lưu lại giá y hệt" (changePct = 0, vd Lưu tất cả nhưng chỉ đổi 1 kim loại) —
  // chỉ giữ dòng đầu tiên của mỗi kim loại (changePct null, chưa có gì để so) và dòng có
  // giá thực sự đổi, đúng ý "lịch sử THAY ĐỔI giá" chứ không phải lịch sử mọi lần bấm Lưu.
  async getHistory(
    baseMetalId?: string,
    limit = 50,
  ): Promise<BaseMetalPriceHistoryItem[]> {
    const rows = await this.prisma.baseMetalPriceHistory.findMany({
      where: {
        AND: [
          baseMetalId ? { baseMetalId } : {},
          { OR: [{ changePct: null }, { changePct: { not: 0 } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        updatedBy: { select: { name: true } },
        baseMetal: { select: { name: true } },
      },
    });
    return rows.map((r) => this.toHistoryItem(r));
  }

  private toHistoryItem(record: {
    id: string;
    baseMetalId: string;
    baseMetal: { name: string };
    priceVnd: unknown;
    changePct: unknown;
    isActive: boolean;
    updatedById: string | null;
    updatedBy: { name: string } | null;
    createdAt: Date;
    source: string | null;
  }): BaseMetalPriceHistoryItem {
    return {
      id: record.id,
      baseMetalId: record.baseMetalId,
      baseMetalName: record.baseMetal.name,
      priceVnd: Number(record.priceVnd),
      changePct: record.changePct != null ? Number(record.changePct) : null,
      isActive: record.isActive,
      updatedById: record.updatedById,
      updatedByName: record.updatedBy?.name ?? null,
      createdAt: record.createdAt.toISOString(),
      source: record.source,
    };
  }
}
