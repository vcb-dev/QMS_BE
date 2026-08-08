import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductCategoriesService {
  private cache: any[] | null = null;
  private lastFetch = 0;

  constructor(private prisma: PrismaService) { }

  async findAll() {
    if (this.cache && Date.now() - this.lastFetch < 60_000) {
      return this.cache;
    }
    const data = await this.prisma.productCategory.findMany({
      orderBy: { name: 'asc' },
    });
    this.cache = data;
    this.lastFetch = Date.now();
    return data;
  }

  async create(name: string) {
    this.cache = null;
    return this.prisma.productCategory.create({
      data: { name },
    });
  }
}
