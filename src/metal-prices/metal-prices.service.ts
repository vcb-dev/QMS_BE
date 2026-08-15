import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPrices } from './dto/metal-prices.dto';

@Injectable()
export class MetalPricesService implements OnModuleInit {
  private readonly logger = new Logger(MetalPricesService.name);
  private cached: MetalPrices | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadFromDb();
  }

  async getLatestAsync(): Promise<MetalPrices> {
    const dbPrice = await this.loadFromDb();
    if (dbPrice) return dbPrice;
    return this.getLatest();
  }

  getLatest(): MetalPrices {
    if (!this.cached) {
      return {
        gold24kVnd: 13_900_000,
        silverVnd: 1_200_000,
        updatedAt: new Date().toISOString(),
        source: 'giá tham khảo thị trường (Vàng 24K & Bạc)',
      };
    }
    return this.cached;
  }

  async updatePrices(prices: Partial<MetalPrices>): Promise<MetalPrices> {
    const current = this.getLatest();
    const updated: MetalPrices = {
      ...current,
      ...prices,
      updatedAt: new Date().toISOString(),
      source: 'cập nhật thủ công',
    };
    this.cached = updated;
    await this.saveToDb(updated);
    return this.cached;
  }

  private async saveToDb(prices: MetalPrices) {
    try {
      await this.prisma.metalPrice.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          gold24kVnd: prices.gold24kVnd,
          silverVnd: prices.silverVnd,
          platinumVnd: prices.platinumVnd ?? 0,
          source: prices.source,
        },
        update: {
          gold24kVnd: prices.gold24kVnd,
          silverVnd: prices.silverVnd,
          platinumVnd: prices.platinumVnd ?? 0,
          source: prices.source,
        },
      });
      this.logger.log('Đã lưu thành công giá vàng và bạc vào Database (PostgreSQL)');
    } catch (err) {
      this.logger.error('Lỗi khi lưu giá vàng/bạc vào DB', err);
    }
  }

  private async loadFromDb(): Promise<MetalPrices | null> {
    try {
      const record = await this.prisma.metalPrice.findUnique({
        where: { id: 'singleton' },
      });
      if (record) {
        this.cached = {
          gold24kVnd: Number(record.gold24kVnd),
          silverVnd: Number(record.silverVnd),
          updatedAt: record.updatedAt.toISOString(),
          source: record.source || 'Database PostgreSQL',
        };
        return this.cached;
      }
    } catch (err) {
      this.logger.error('Lỗi khi nạp giá vàng từ DB', err);
    }

    return this.cached;
  }
}
