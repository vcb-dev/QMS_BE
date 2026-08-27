import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getProvinces() {
    return this.prisma.province.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
      },
    });
  }

  async getWardsByProvince(provinceIdOrName?: string) {
    if (!provinceIdOrName) return [];

    const province = await this.prisma.province.findFirst({
      where: {
        OR: [{ id: provinceIdOrName }, { name: provinceIdOrName }],
      },
    });

    if (!province) return [];

    return this.prisma.ward.findMany({
      where: { provinceId: province.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        provinceId: true,
      },
    });
  }
}
