import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingFormulaType } from '@prisma/client';
import { CacheWithTtl } from '../common/cache-with-ttl.util';
import { APP_CONSTANTS } from '../common/constants';

@Injectable()
export class PricingFormulasService {
  constructor(private readonly prisma: PrismaService) {}

  // getDefault() bị gọi mỗi lần tính giá (calculate / calculate-batch / danh sách Thư Viện qua
  // getDefaultStoneTiers) — công thức mặc định gần như không đổi nên cache RAM để bỏ 1 round-trip
  // DB mỗi lần. Mọi create/update đều clear() cache.
  private readonly defaultCache = new CacheWithTtl<
    Awaited<ReturnType<PricingFormulasService['loadDefault']>>
  >(APP_CONSTANTS.REFERENCE_DATA_TTL);

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
    const cached = this.defaultCache.get();
    if (cached) return cached;
    const found = await this.loadDefault();
    this.defaultCache.set(found);
    return found;
  }

  async create(
    dto: {
      name: string;
      formulaType: PricingFormulaType;
      config: unknown;
      isDefault?: boolean;
    },
    updatedById?: string,
  ) {
    if (dto.isDefault) {
      await this.prisma.pricingFormula.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    this.defaultCache.clear();
    return this.prisma.pricingFormula.create({
      data: {
        name: dto.name,
        formulaType: dto.formulaType,
        config: dto.config as any,
        isDefault: dto.isDefault ?? false,
        updatedById,
      },
    });
  }

  // Không cho sửa formulaType sau khi tạo — đổi DẠNG công thức (tier/hệ số nhân) giữa chừng sẽ
  // làm sai lệch cách các chất liệu đang trỏ tới nó được tính giá.
  async update(
    id: string,
    patch: { name?: string; config?: unknown; isDefault?: boolean },
    updatedById?: string,
  ) {
    if (patch.isDefault) {
      await this.prisma.pricingFormula.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    this.defaultCache.clear();
    return this.prisma.pricingFormula.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.config !== undefined ? { config: patch.config as any } : {}),
        ...(patch.isDefault !== undefined
          ? { isDefault: patch.isDefault }
          : {}),
        updatedById,
      },
    });
  }
}
