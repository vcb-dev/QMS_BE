import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingFormulaType, Prisma } from '@prisma/client';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreatePricingFormulaDto,
  MarginTiersConfigDto,
  MultiplierConfigDto,
  UpdatePricingFormulaDto,
} from './dto/pricing-formula.dto';

@Injectable()
export class PricingFormulasService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.pricingFormula.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  private async loadDefault() {
    const found = await this.prisma.pricingFormula.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!found) {
      throw new NotFoundException(
        'Chưa cấu hình công thức mặc định (dùng để tính lãi phần đá) trong Database.',
      );
    }
    return found;
  }

  // Công thức mặc định dùng để tính lãi phần ĐÁ — đá tách tính riêng khỏi kim loại, luôn cần
  // 1 bậc lợi nhuận theo chi phí bất kể chất liệu kim loại đi kèm dùng công thức gì (hệ số nhân
  // như Bạc không áp dụng được cho đá).
  async getDefault() {
    return this.loadDefault();
  }

  // config có hình dạng khác nhau tùy formulaType nên không khai được bằng decorator trên
  // một class duy nhất — validate tay ở đây, dùng lại chính DTO đã định nghĩa.
  private assertValidConfig(
    formulaType: PricingFormulaType,
    config: unknown,
  ): Record<string, unknown> {
    const instance =
      formulaType === PricingFormulaType.MULTIPLIER
        ? plainToInstance(MultiplierConfigDto, config ?? {}, {
            enableImplicitConversion: false,
          })
        : plainToInstance(MarginTiersConfigDto, config ?? {}, {
            enableImplicitConversion: false,
          });
    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      const detail = errors
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .join('; ');
      throw new BadRequestException(
        `Cấu hình công thức không hợp lệ: ${detail || 'sai định dạng'}`,
      );
    }
    return instance as unknown as Record<string, unknown>;
  }

  async create(dto: CreatePricingFormulaDto, updatedById?: string) {
    const safeConfig = this.assertValidConfig(dto.formulaType, dto.config);

    if (dto.isDefault) {
      await this.prisma.pricingFormula.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.pricingFormula.create({
      data: {
        name: dto.name,
        formulaType: dto.formulaType,
        config: safeConfig as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
        updatedById,
      },
    });
  }

  // Không cho sửa formulaType sau khi tạo — đổi DẠNG công thức (tier/hệ số nhân) giữa chừng sẽ
  // làm sai lệch cách các chất liệu đang trỏ tới nó được tính giá.
  async update(
    id: string,
    patch: UpdatePricingFormulaDto,
    updatedById?: string,
  ) {
    let safeConfig: Record<string, unknown> | undefined;
    if (patch.config !== undefined) {
      const current = await this.prisma.pricingFormula.findUnique({
        where: { id },
        select: { formulaType: true },
      });
      if (!current) {
        throw new NotFoundException('Không tìm thấy công thức tính lãi');
      }
      safeConfig = this.assertValidConfig(current.formulaType, patch.config);
    }

    if (patch.isDefault) {
      await this.prisma.pricingFormula.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return this.prisma.pricingFormula.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(safeConfig !== undefined
          ? { config: safeConfig as Prisma.InputJsonValue }
          : {}),
        ...(patch.isDefault !== undefined
          ? { isDefault: patch.isDefault }
          : {}),
        updatedById,
      },
    });
  }
}
