import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONSTANTS } from '../common/constants';
import { CacheWithTtl } from '../common/cache-with-ttl.util';
import { Material, PricingFormula, BaseMetal } from '@prisma/client';

type MaterialWithFormula = Material & {
  pricingFormula: PricingFormula;
  baseMetal: BaseMetal | null;
};

type PlainMaterial = Omit<MaterialWithFormula, 'priceRatioPct'> & {
  priceRatioPct: number;
};

// % tính giá hợp lệ — validate ở backend, không chỉ FE, vì @Body('priceRatioPct') là param rời
// nên ValidationPipe/class-validator toàn cục không tự chạy qua đây (chỉ áp cho @Body() cả DTO).
function assertValidRatio(priceRatioPct: number | undefined) {
  if (priceRatioPct === undefined) return;
  if (priceRatioPct < 0 || priceRatioPct > 1000) {
    throw new BadRequestException('% tính giá phải trong khoảng 0-1000');
  }
}

@Injectable()
export class MaterialsService {
  private readonly cache = new CacheWithTtl<PlainMaterial[]>(
    APP_CONSTANTS.MATERIAL_TTL,
  );

  constructor(private prisma: PrismaService) {}

  // Prisma trả priceRatioPct dạng Decimal (serialize qua JSON thành string) — ép về number ngay ở
  // service để mọi nơi gọi (FE, so sánh range 0-100 ở pricing-config) đều nhận đúng kiểu number.
  private toPlain(m: MaterialWithFormula): PlainMaterial {
    return { ...m, priceRatioPct: Number(m.priceRatioPct) };
  }

  async findAll() {
    const cached = this.cache.get();
    if (cached) return cached;

    const data = await this.prisma.material.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { pricingFormula: true, baseMetal: true },
    });
    const plain = data.map((m) => this.toPlain(m));
    this.cache.set(plain);
    return plain;
  }

  // pricingFormulaId bắt buộc — chất liệu mới phải trỏ ngay tới 1 công thức tính lãi có sẵn
  // (chọn công thức dùng chung, hoặc tạo công thức mới qua /pricing-formulas trước khi tạo chất liệu)
  // baseMetalId để trống = chất liệu phi kim loại (đá/phụ kiện, không tính theo giá kim loại gốc).
  async create(
    name: string,
    pricingFormulaId: string,
    priceRatioPct?: number,
    baseMetalId?: string,
  ) {
    assertValidRatio(priceRatioPct);
    if (!pricingFormulaId) {
      throw new BadRequestException(
        'Vui lòng chọn công thức tính lãi cho chất liệu',
      );
    }
    this.cache.clear();
    const created = await this.prisma.material.create({
      data: {
        name,
        priceRatioPct: priceRatioPct ?? 100,
        pricingFormulaId,
        baseMetalId: baseMetalId || null,
      },
      include: { pricingFormula: true, baseMetal: true },
    });
    return this.toPlain(created);
  }

  // Sửa % tính giá / công thức tính lãi / tên / kim loại gốc của 1 chất liệu đã có — dùng cho màn
  // Cấu hình giá thay bảng tỷ lệ vàng + bảng lợi nhuận cũ (giờ nằm thẳng trên chất liệu).
  async update(
    id: string,
    patch: {
      name?: string;
      priceRatioPct?: number;
      pricingFormulaId?: string;
      baseMetalId?: string | null;
    },
  ) {
    assertValidRatio(patch.priceRatioPct);
    this.cache.clear();
    const updated = await this.prisma.material.update({
      where: { id },
      data: patch,
      include: { pricingFormula: true, baseMetal: true },
    });
    return this.toPlain(updated);
  }
}
