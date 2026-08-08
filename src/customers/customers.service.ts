import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(search?: string) {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { province: { contains: search, mode: 'insensitive' as const } },
            { ward: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    return this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { quoteRequests: true },
    });
    if (!customer) {
      throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    }
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        name: dto.name,
        phone: dto.phone || null,
        address: dto.address || null,
        province: dto.province || '',
        ward: dto.ward || '',
        note: dto.note || null,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Đã xóa thông tin khách hàng thành công' };
  }
}
