import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BaseMetalDto,
  BaseMetalPriceHistoryItem,
} from './dto/metal-prices.dto';
import { APP_CONSTANTS } from '../common/constants';

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
export class MetalPricesService implements OnModuleInit {
  private readonly logger = new Logger(MetalPricesService.name);
  // baseMetalId -> giá đang active, cache RAM 1 phút (giá kim loại ít đổi trong ngày, hàm tính
  // giá gọi getLatestAsync nhiều lần liên tiếp không nên query DB mỗi lần)
  private cached: Map<string, number> | null = null;
  private lastLoadAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadFromDb();
  }

  async getLatestAsync(): Promise<Map<string, number>> {
    if (
      this.cached &&
      Date.now() - this.lastLoadAt < APP_CONSTANTS.REFERENCE_DATA_TTL
    ) {
      return this.cached;
    }
    return this.loadFromDb();
  }

  private async loadFromDb(): Promise<Map<string, number>> {
    const rows = await this.prisma.baseMetalPriceHistory.findMany({
      where: { isActive: true },
      select: { baseMetalId: true, priceVnd: true },
    });
    this.cached = new Map(rows.map((r) => [r.baseMetalId, Number(r.priceVnd)]));
    this.lastLoadAt = Date.now();
    return this.cached;
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
    const prevRows = await this.prisma.baseMetalPriceHistory.findMany({
      where: { baseMetalId, isActive: true },
      take: 1,
    });
    const prev = prevRows[0];
    const changePct = prev
      ? computeChangePct(priceVnd, Number(prev.priceVnd))
      : null;

    const [, created] = await this.prisma.$transaction([
      this.prisma.baseMetalPriceHistory.updateMany({
        where: { baseMetalId, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.baseMetalPriceHistory.create({
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
      }),
    ]);

    this.cached = null; // ép loadFromDb() lại lần đọc tiếp theo thay vì chờ hết TTL
    this.logger.log(
      `Đã cập nhật giá ${created.baseMetal.name} — tạo dòng lịch sử mới`,
    );
    return this.toHistoryItem(created);
  }

  async getHistory(
    baseMetalId?: string,
    limit = 50,
  ): Promise<BaseMetalPriceHistoryItem[]> {
    const rows = await this.prisma.baseMetalPriceHistory.findMany({
      where: baseMetalId ? { baseMetalId } : undefined,
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
