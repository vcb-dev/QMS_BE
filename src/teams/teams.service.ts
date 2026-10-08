import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Prisma báo vi phạm unique (P2002) khi 2 request cùng tạo/đổi sang một tên ngay giữa lúc kiểm tra
// trùng và lúc ghi — cũng là trùng tên, trả 409 như nhánh kiểm tra trước.
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === 'P2002';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string) {
    return this.prisma.team.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findPaginated(page: number, limit: number, search?: string) {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 10));
    const where = search
      ? { name: { contains: search, mode: 'insensitive' as const } }
      : undefined;

    const [data, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true } } },
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  async create(name: string) {
    const clean = this.cleanName(name);
    await this.assertNameFree(clean);
    try {
      return await this.prisma.team.create({ data: { name: clean } });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Team đã tồn tại');
      }
      throw err;
    }
  }

  async update(id: string, name: string) {
    const existing = await this.prisma.team.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Team không tồn tại');

    const clean = this.cleanName(name);
    // Loại trừ chính team này để đổi lại hoa/thường của chính tên mình không bị coi là trùng
    await this.assertNameFree(clean, id);
    try {
      return await this.prisma.team.update({
        where: { id },
        data: { name: clean },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Team đã tồn tại');
      }
      throw err;
    }
  }

  async remove(id: string) {
    const existing = await this.prisma.team.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Team không tồn tại');

    // Thành viên không bị chặn: FK users.team_id ON DELETE SET NULL chuyển họ về "Chưa có team".
    return this.prisma.team.delete({ where: { id } });
  }

  private cleanName(name: string): string {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Tên team không được để trống');
    return clean;
  }

  // Trùng tên không phân biệt hoa thường (unique index của DB chỉ phân biệt hoa thường).
  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.prisma.team.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' as const },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException('Team đã tồn tại');
  }
}
