import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface GoldRatio {
  key: string;
  standard: number;
  applied: number;
  label: string;
}

export interface ProfitMargin {
  maxCost: number;
  divisor: number;
  margin: string;
}

export interface PricingConfigDto {
  goldRatios: GoldRatio[];
  profitMargins: ProfitMargin[];
  silverMultiplier: number;
  updatedAt?: string;
}

@Injectable()
export class PricingConfigService {
  private readonly logger = new Logger(PricingConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<PricingConfigDto> {
    const record = await this.prisma.pricingConfig.findUnique({
      where: { id: 'singleton' },
    });

    if (!record) {
      this.logger.warn('Chưa có cấu hình PricingConfig trong DB');
      throw new NotFoundException('Chưa tìm thấy bản ghi cấu hình trong Database.');
    }

    return {
      goldRatios: record.goldRatios as any,
      profitMargins: record.profitMargins as any,
      silverMultiplier: Number(record.silverMultiplier),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async updateConfig(dto: Partial<PricingConfigDto>): Promise<PricingConfigDto> {
    const updated = await this.prisma.pricingConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        goldRatios: (dto.goldRatios || []) as any,
        profitMargins: (dto.profitMargins || []) as any,
        silverMultiplier: dto.silverMultiplier ?? 3,
      },
      update: {
        ...(dto.goldRatios ? { goldRatios: dto.goldRatios as any } : {}),
        ...(dto.profitMargins ? { profitMargins: dto.profitMargins as any } : {}),
        ...(dto.silverMultiplier !== undefined ? { silverMultiplier: dto.silverMultiplier } : {}),
      },
    });

    this.logger.log('Đã cập nhật cấu hình PricingConfig trực tiếp vào Database PostgreSQL');
    return {
      goldRatios: updated.goldRatios as any,
      profitMargins: updated.profitMargins as any,
      silverMultiplier: Number(updated.silverMultiplier),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
