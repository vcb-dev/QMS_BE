import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONSTANTS } from 'src/common/constants';
import { CacheWithTtl } from '../common/cache-with-ttl.util';
import { Material } from '@prisma/client';

@Injectable()
export class MaterialsService {
  private readonly cache = new CacheWithTtl<Material[]>(
    APP_CONSTANTS.MATERIAL_TTL,
  );

  constructor(private prisma: PrismaService) {}

  async findAll() {
    const cached = this.cache.get();
    if (cached) return cached;

    const data = await this.prisma.material.findMany({
      orderBy: { name: 'asc' },
    });
    this.cache.set(data);
    return data;
  }

  async create(name: string) {
    this.cache.clear();
    return this.prisma.material.create({
      data: { name },
    });
  }
}
