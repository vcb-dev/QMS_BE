import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONSTANTS } from 'src/common/constants';
@Injectable()
export class MaterialsService {
  private cache: any[] | null = null;
  private lastFetch = 0;

  constructor(private prisma: PrismaService) { }

  async findAll() {
    if (this.cache && Date.now() - this.lastFetch < APP_CONSTANTS.MATERIAL_TTL) {
      return this.cache;
    }
    const data = await this.prisma.material.findMany({
      orderBy: { name: 'asc' },
    });
    this.cache = data;
    this.lastFetch = Date.now();
    return data;
  }

  async create(name: string) {
    this.cache = null;
    return this.prisma.material.create({
      data: { name },
    });
  }
}
