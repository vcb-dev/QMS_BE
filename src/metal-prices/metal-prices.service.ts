import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as https from 'https';
import { PrismaService } from '../prisma/prisma.service';
import { MetalPrices } from './dto/metal-prices.dto';
import { APP_CONSTANTS } from 'src/common/constants';

@Injectable()
export class MetalPricesService implements OnModuleInit {
  private readonly logger = new Logger(MetalPricesService.name);
  private cached: MetalPrices | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadFromDb();
    await this.fetchLivePrices();
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

  async fetchLivePrices(): Promise<MetalPrices> {
    try {
      const [usdVnd, goldSpotUsd, silverSpotUsd] = await Promise.all([
        this.getUsdVndRate(),
        this.getGoldApiPrice('XAU'),
        this.getGoldApiPrice('XAG'),
      ]);

      const multiplier = APP_CONSTANTS.CHI_GRAMS / APP_CONSTANTS.TROY_OZ_GRAMS;
      
      // Calculate converted VND per chỉ
      let gold24kVnd = Math.round(goldSpotUsd * usdVnd * multiplier);
      let silverVnd = Math.round(silverSpotUsd * usdVnd * multiplier);

      this.logger.log(`API Live fetched: GoldSpot=$${goldSpotUsd}, USD/VND=${usdVnd} => Gold=${gold24kVnd.toLocaleString('vi-VN')} ₫/chỉ`);

      if (gold24kVnd > 1000000) {
        const newPrices: MetalPrices = {
          gold24kVnd,
          silverVnd: silverVnd > 10000 ? silverVnd : 1_200_000,
          updatedAt: new Date().toISOString(),
          source: 'gold-api.com + exchangerate-api (live API)',
        };
        this.cached = newPrices;
        await this.saveToDb(newPrices);
      }
    } catch (err) {
      this.logger.warn('Không thể kết nối API trực tuyến, giữ nguyên giá từ DB/gần nhất');
    }

    return this.getLatest();
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

  private getUsdVndRate(): Promise<number> {
    return new Promise((resolve) => {
      const options = {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      };
      const req = https.get(APP_CONSTANTS.EXCHANGE_RATE_API_URL, options, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data?.rates?.VND || APP_CONSTANTS.DEFAULT_EXCHANGE_RATE);
          } catch {
            resolve(APP_CONSTANTS.DEFAULT_EXCHANGE_RATE);
          }
        });
      });
      req.on('error', () => resolve(APP_CONSTANTS.DEFAULT_EXCHANGE_RATE));
      req.on('timeout', () => { req.destroy(); resolve(APP_CONSTANTS.DEFAULT_EXCHANGE_RATE); });
    });
  }

  private getGoldApiPrice(symbol: 'XAU' | 'XAG'): Promise<number> {
    return new Promise((resolve) => {
      const options = {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      };
      const apiUrl = `${APP_CONSTANTS.GOLD_API_URL}/${symbol}`;
      const req = https.get(apiUrl, options, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data?.price || 0);
          } catch {
            resolve(0);
          }
        });
      });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
    });
  }
}
