import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductCategoriesService {
  constructor(private prisma: PrismaService) {}

  private isPrismaError(err: unknown, code: string): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
    );
  }

  async findAll() {
    return this.prisma.productCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(name: string, laborCost?: number, vatRate?: number) {
    if (!name || !name.trim()) {
      throw new BadRequestException('Tên danh mục không được để trống');
    }
    const trimmed = name.trim();
    // Tên trùng 1 danh mục đã xóa mềm (isActive=false) — bật lại thay vì báo "đã tồn tại", tránh
    // Admin bị kẹt không thêm lại được tên đã lỡ xóa trước đó.
    const existingInactive = await this.prisma.productCategory.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' }, isActive: false },
    });
    if (existingInactive) {
      return this.prisma.productCategory.update({
        where: { id: existingInactive.id },
        data: {
          isActive: true,
          laborCost: laborCost ?? existingInactive.laborCost,
          vatRate: vatRate ?? existingInactive.vatRate,
        },
      });
    }
    try {
      return await this.prisma.productCategory.create({
        data: {
          name: trimmed,
          laborCost: laborCost ?? 0,
          vatRate: vatRate ?? 10,
        },
      });
    } catch (err) {
      if (this.isPrismaError(err, 'P2002')) {
        throw new ConflictException('Danh mục sản phẩm này đã tồn tại');
      }
      throw err;
    }
  }

  // Xóa mềm (isActive=false) — không xóa cứng để không vỡ FK từ QuoteRequest.categoryId đã có
  // (khớp cách làm với Material/PricingFormula). Danh mục Sale tạo bừa vẫn xóa (ẩn) được dù đã
  // có đơn dùng, chỉ ẩn khỏi danh sách chọn chứ không phá dữ liệu đơn cũ.
  async remove(id: string) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy danh mục sản phẩm');
    await this.prisma.productCategory.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Đã xóa danh mục sản phẩm thành công' };
  }

  // Xóa mềm nhiều danh mục cùng lúc — 1 câu updateMany, không còn cần try/catch từng cái vì
  // xóa mềm không bao giờ vỡ FK.
  async removeMany(ids: string[]) {
    if (!ids || ids.length === 0)
      return { deleted: 0, failedIds: [] as string[] };
    const result = await this.prisma.productCategory.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false },
    });
    return { deleted: result.count, failedIds: [] as string[] };
  }

  async update(id: string, patch: { laborCost?: number; vatRate?: number }) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy danh mục sản phẩm');
    return this.prisma.productCategory.update({
      where: { id },
      data: patch,
    });
  }

  // Lưu tiền công/VAT nhiều danh mục cùng lúc — 1 API call, 1 transaction thay vì gọi lặp lại từng cái
  async updateMany(
    items: { id: string; laborCost?: number; vatRate?: number }[],
  ) {
    if (!items || items.length === 0) return { updated: 0 };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.productCategory.update({
          where: { id: it.id },
          data: { laborCost: it.laborCost, vatRate: it.vatRate },
        }),
      ),
    );
    return { updated: items.length };
  }
}
