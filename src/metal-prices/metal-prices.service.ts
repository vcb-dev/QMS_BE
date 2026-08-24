import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPrices } from './dto/metal-prices.dto';
import { APP_CONSTANTS } from '../common/constants';

// % biến động so với giá active trước đó — 0 nếu không đổi (có dữ liệu cũ để so), null nếu chưa từng có dữ liệu cũ
function computeChangePct(next: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  if (next === prev) return 0;
  return Math.round(((next - prev) / prev) * 10000) / 100;
}

@Injectable()
export class MetalPricesService implements OnModuleInit {
  private readonly logger = new Logger(MetalPricesService.name);
  private cached: MetalPrices | null = null;
  private lastDbLoadAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadFromDb();
  }

  // Giá kim loại ít đổi trong ngày — cache 1 phút để khỏi query DB mỗi lần tính giá
  // (calculate/generate-options gọi hàm này nhiều lần liên tiếp).
  async getLatestAsync(): Promise<MetalPrices> {
    if (
      this.cached &&
      Date.now() - this.lastDbLoadAt < APP_CONSTANTS.REFERENCE_DATA_TTL
    ) {
      return this.cached;
    }
    const dbPrice = await this.loadFromDb();
    if (dbPrice) return dbPrice;
    return this.getLatest();
  }

  getLatest(): MetalPrices {
    if (!this.cached) {
      return {
        gold24kVnd: 13_900_000,
        silverVnd: 1_200_000,
        platinumVnd: 6_000_000,
        updatedAt: new Date().toISOString(),
        source: 'giá tham khảo thị trường (Vàng 24K & Bạc)',
      };
    }
    return this.cached;
  }

  // Mỗi lần cập nhật giá tạo 1 DÒNG LỊCH SỬ MỚI — không sửa lên dòng cũ. Dòng mới set isActive=true,
  // dòng đang active trước đó tự set isActive=false. % biến động tính riêng cho từng kim loại so
  // với giá đang active ngay trước khi ghi dòng này (null nếu đây là lần đầu tiên có giá).
  async updatePrices(
    prices: Partial<
      Pick<MetalPrices, 'gold24kVnd' | 'silverVnd' | 'platinumVnd'>
    >,
    updatedBy?: { id?: string },
  ): Promise<MetalPrices> {
    const current = this.getLatest();
    const hasPreviousRecord = !!this.cached;

    const nextGold = prices.gold24kVnd ?? current.gold24kVnd;
    const nextSilver = prices.silverVnd ?? current.silverVnd;
    const nextPlatinum = prices.platinumVnd ?? current.platinumVnd;

    const goldChangePct = hasPreviousRecord
      ? computeChangePct(nextGold, current.gold24kVnd)
      : null;
    const silverChangePct = hasPreviousRecord
      ? computeChangePct(nextSilver, current.silverVnd)
      : null;
    const platinumChangePct = hasPreviousRecord
      ? computeChangePct(nextPlatinum, current.platinumVnd)
      : null;

    const [, created] = await this.prisma.$transaction([
      this.prisma.metalPrice.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.metalPrice.create({
        data: {
          gold24kVnd: nextGold,
          silverVnd: nextSilver,
          platinumVnd: nextPlatinum,
          goldChangePct,
          silverChangePct,
          platinumChangePct,
          source: 'cập nhật thủ công',
          isActive: true,
          updatedById: updatedBy?.id,
        },
        include: { updatedBy: { select: { name: true } } },
      }),
    ]);

    const updated = this.toDto(created);
    this.cached = updated;
    this.lastDbLoadAt = Date.now();
    this.logger.log(
      'Đã lưu thành công giá vàng/bạc/bạch kim vào Database (PostgreSQL) — tạo dòng lịch sử mới',
    );
    return updated;
  }

  // Lịch sử các lần đổi giá, mới nhất trước — biết được thứ tự biến động giá qua thời gian
  async getHistory(limit = 50): Promise<MetalPrices[]> {
    const records = await this.prisma.metalPrice.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { updatedBy: { select: { name: true } } },
    });
    return records.map((r) => this.toDto(r));
  }

  private toDto(record: {
    id: string;
    gold24kVnd: unknown;
    silverVnd: unknown;
    platinumVnd: unknown;
    goldChangePct: unknown;
    silverChangePct: unknown;
    platinumChangePct: unknown;
    isActive: boolean;
    updatedById: string | null;
    updatedBy: { name: string } | null;
    createdAt: Date;
    source: string | null;
  }): MetalPrices {
    return {
      id: record.id,
      gold24kVnd: Number(record.gold24kVnd),
      silverVnd: Number(record.silverVnd),
      platinumVnd: Number(record.platinumVnd),
      goldChangePct:
        record.goldChangePct !== null ? Number(record.goldChangePct) : null,
      silverChangePct:
        record.silverChangePct !== null ? Number(record.silverChangePct) : null,
      platinumChangePct:
        record.platinumChangePct !== null
          ? Number(record.platinumChangePct)
          : null,
      isActive: record.isActive,
      updatedById: record.updatedById,
      updatedByName: record.updatedBy?.name ?? null,
      updatedAt: record.createdAt.toISOString(),
      source: record.source || 'Database PostgreSQL',
    };
  }

  private async loadFromDb(): Promise<MetalPrices | null> {
    try {
      const record = await this.prisma.metalPrice.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        include: { updatedBy: { select: { name: true } } },
      });
      if (record) {
        this.cached = this.toDto(record);
        this.lastDbLoadAt = Date.now();
        return this.cached;
      }
    } catch (err) {
      this.logger.error('Lỗi khi nạp giá vàng từ DB', err);
    }

    return this.cached;
  }
}
