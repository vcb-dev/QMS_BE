import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProductCategory } from '@prisma/client';
import { CacheWithTtl } from '../common/cache-with-ttl.util';

@Injectable()
export class ProductCategoriesService {
  private readonly cache = new CacheWithTtl<ProductCategory[]>(60_000);

  constructor(private prisma: PrismaService) {}

  private isPrismaError(err: unknown, code: string): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
    );
  }

  async findAll() {
    const cached = this.cache.get();
    if (cached) return cached;

    const data = await this.prisma.productCategory.findMany({
      orderBy: { name: 'asc' },
    });
    this.cache.set(data);
    return data;
  }

  async create(name: string, laborCost?: number) {
    if (!name || !name.trim()) {
      throw new BadRequestException('Tên danh mục không được để trống');
    }
    this.cache.clear();
    try {
      return await this.prisma.productCategory.create({
        data: { name: name.trim(), laborCost: laborCost ?? 0 },
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
    this.cache.clear();
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
    this.cache.clear();
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

  async updateLaborCost(id: string, laborCost: number) {
    const existing = await this.prisma.productCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException('Không tìm thấy danh mục sản phẩm');
    this.cache.clear();
    return this.prisma.productCategory.update({
      where: { id },
      data: { laborCost },
    });
  }

  // Lưu tiền công nhiều danh mục cùng lúc — 1 API call, 1 transaction thay vì gọi lặp lại từng cái
  async updateManyLaborCosts(items: { id: string; laborCost: number }[]) {
    if (!items || items.length === 0) return { updated: 0 };
    this.cache.clear();
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.productCategory.update({
          where: { id: it.id },
          data: { laborCost: it.laborCost },
        }),
      ),
    );
    return { updated: items.length };
  }
}
