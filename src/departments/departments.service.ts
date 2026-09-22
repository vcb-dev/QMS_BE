import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) { }

  async findAll(search?: string) {
    return this.prisma.department.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' as const } } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findPaginated(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : undefined;
    
    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { quoteRequests: true }
          }
        }
      }),
      this.prisma.department.count({ where })
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      }
    };
  }

  async create(name: string) {
    return this.prisma.department.create({
      data: { name },
    });
  }

  async update(id: string, name: string) {
    const existing = await this.prisma.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Phòng ban không tồn tại');
    
    return this.prisma.department.update({
      where: { id },
      data: { name },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.department.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Phòng ban không tồn tại');

    // Prisma might throw constraint error if there are users/quotes, handled generally or we can explicitly check
    return this.prisma.department.delete({
      where: { id },
    });
  }
}
