import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '@prisma/client';

const CUSTOMER_INCLUDE = { province: true, ward: true } as const;

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll(search?: string) {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    return this.prisma.customer.findMany({
      where,
      include: CUSTOMER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { ...CUSTOMER_INCLUDE, quoteRequests: true },
    });
    if (!customer) {
      throw new NotFoundException('Không tìm thấy thông tin khách hàng');
    }
    return customer;
  }

  async create(dto: CreateCustomerDto, actorId: string, actorRole: Role) {
    const cleanName = dto.name.trim();
    const cleanPhone = dto.phone ? dto.phone.trim() : '';

    if (cleanPhone) {
      const existingByPhone = await this.prisma.customer.findFirst({
        where: { phone: cleanPhone },
        include: CUSTOMER_INCLUDE,
      });
      if (existingByPhone) {
        const updated = await this.prisma.customer.update({
          where: { id: existingByPhone.id },
          data: {
            name: cleanName || existingByPhone.name,
            address: dto.address?.trim() || existingByPhone.address,
            provinceId: dto.provinceId || existingByPhone.provinceId,
            wardId: dto.wardId || existingByPhone.wardId,
            note: dto.note || existingByPhone.note,
          },
          include: CUSTOMER_INCLUDE,
        });
        await this.auditLog.logAction(
          actorId,
          actorRole,
          'UPDATE_CUSTOMER',
          'Customer',
          updated.id,
        );
        return updated;
      }
    }

    const existingByName = await this.prisma.customer.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } },
      include: CUSTOMER_INCLUDE,
    });
    if (existingByName) {
      const updated = await this.prisma.customer.update({
        where: { id: existingByName.id },
        data: {
          phone: cleanPhone || existingByName.phone,
          address: dto.address?.trim() || existingByName.address,
          provinceId: dto.provinceId || existingByName.provinceId,
          wardId: dto.wardId || existingByName.wardId,
          note: dto.note || existingByName.note,
        },
        include: CUSTOMER_INCLUDE,
      });
      await this.auditLog.logAction(
        actorId,
        actorRole,
        'UPDATE_CUSTOMER',
        'Customer',
        updated.id,
      );
      return updated;
    }

    const created = await this.prisma.customer.create({
      data: {
        name: cleanName,
        phone: cleanPhone || null,
        address: dto.address?.trim() || null,
        provinceId: dto.provinceId || null,
        wardId: dto.wardId || null,
        note: dto.note || null,
      },
      include: CUSTOMER_INCLUDE,
    });
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'CREATE_CUSTOMER',
      'Customer',
      created.id,
    );
    return created;
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    actorId: string,
    actorRole: Role,
  ) {
    await this.findOne(id);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
      include: CUSTOMER_INCLUDE,
    });
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'UPDATE_CUSTOMER',
      'Customer',
      id,
    );
    return updated;
  }

  async remove(id: string, actorId: string, actorRole: Role) {
    await this.findOne(id);
    await this.auditLog.logAction(
      actorId,
      actorRole,
      'DELETE_CUSTOMER',
      'Customer',
      id,
    );
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Đã xóa thông tin khách hàng thành công' };
  }
}
