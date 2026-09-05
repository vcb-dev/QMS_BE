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
    try {
      return await this.prisma.productCategory.create({
        data: {
          name: name.trim(),
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

  async remove(id: string) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy danh mục sản phẩm');
    try {
      await this.prisma.productCategory.delete({ where: { id } });
      return { message: 'Đã xóa danh mục sản phẩm thành công' };
    } catch (err) {
      if (this.isPrismaError(err, 'P2003')) {
        throw new BadRequestException(
          'Danh mục này đang được dùng trong yêu cầu báo giá, không thể xóa',
        );
      }
      throw err;
    }
  }

  // Xóa nhiều danh mục cùng lúc — xóa từng cái riêng (không dùng deleteMany) để danh mục nào
  // đang bị ràng buộc FK (đã có yêu cầu báo giá dùng) không làm hỏng các danh mục khác xóa được
  async removeMany(ids: string[]) {
    if (!ids || ids.length === 0)
      return { deleted: 0, failedIds: [] as string[] };
    let deleted = 0;
    const failedIds: string[] = [];
    for (const id of ids) {
      try {
        await this.prisma.productCategory.delete({ where: { id } });
        deleted++;
      } catch {
        failedIds.push(id);
      }
    }
    return { deleted, failedIds };
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
