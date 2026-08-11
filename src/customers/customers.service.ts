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
      include: { provinceRel: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { provinceRel: true, quoteRequests: true },
    });
    if (!customer) {
      throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    }
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const cleanName = dto.name.trim();
    const cleanPhone = dto.phone ? dto.phone.trim() : '';

    if (cleanPhone) {
      const existingByPhone = await this.prisma.customer.findFirst({
        where: { phone: cleanPhone },
        include: { provinceRel: true },
      });
      if (existingByPhone) {
        return this.prisma.customer.update({
          where: { id: existingByPhone.id },
          data: {
            name: cleanName || existingByPhone.name,
            address: dto.address?.trim() || existingByPhone.address,
            province: dto.province || existingByPhone.province,
            ward: dto.ward || existingByPhone.ward,
            note: dto.note || existingByPhone.note,
          },
          include: { provinceRel: true },
        });
      }
    }

    const existingByName = await this.prisma.customer.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } },
      include: { provinceRel: true },
    });
    if (existingByName) {
      return this.prisma.customer.update({
        where: { id: existingByName.id },
        data: {
          phone: cleanPhone || existingByName.phone,
          address: dto.address?.trim() || existingByName.address,
          province: dto.province || existingByName.province,
          ward: dto.ward || existingByName.ward,
          note: dto.note || existingByName.note,
        },
        include: { provinceRel: true },
      });
    }

    return this.prisma.customer.create({
      data: {
        name: cleanName,
        phone: cleanPhone || null,
        address: dto.address?.trim() || null,
        province: dto.province || null,
        ward: dto.ward || null,
        note: dto.note || null,
      },
      include: { provinceRel: true },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: dto,
      include: { provinceRel: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Đã xóa thông tin khách hàng thành công' };
  }
}
