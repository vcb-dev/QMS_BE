import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  private async logAction(actorId: string, actorRole: Role, action: string, entityId?: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    await this.auditLog.log({
      actorId,
      actorName: actor?.name || 'Không rõ',
      actorRole,
      action,
      entityType: 'Customer',
      entityId,
    });
  }

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

  async create(dto: CreateCustomerDto, actorId: string, actorRole: Role) {
    const cleanName = dto.name.trim();
    const cleanPhone = dto.phone ? dto.phone.trim() : '';

    if (cleanPhone) {
      const existingByPhone = await this.prisma.customer.findFirst({
        where: { phone: cleanPhone },
        include: { provinceRel: true },
      });
      if (existingByPhone) {
        const updated = await this.prisma.customer.update({
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
        await this.logAction(actorId, actorRole, 'UPDATE_CUSTOMER', updated.id);
        return updated;
      }
    }

    const existingByName = await this.prisma.customer.findFirst({
      where: { name: { equals: cleanName, mode: 'insensitive' } },
      include: { provinceRel: true },
    });
    if (existingByName) {
      const updated = await this.prisma.customer.update({
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
      await this.logAction(actorId, actorRole, 'UPDATE_CUSTOMER', updated.id);
      return updated;
    }

    const created = await this.prisma.customer.create({
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
    await this.logAction(actorId, actorRole, 'CREATE_CUSTOMER', created.id);
    return created;
  }

  async update(id: string, dto: UpdateCustomerDto, actorId: string, actorRole: Role) {
    await this.findOne(id);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: dto,
      include: { provinceRel: true },
    });
    await this.logAction(actorId, actorRole, 'UPDATE_CUSTOMER', id);
    return updated;
  }

  async remove(id: string, actorId: string, actorRole: Role) {
    await this.findOne(id);
    await this.logAction(actorId, actorRole, 'DELETE_CUSTOMER', id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Đã xóa thông tin khách hàng thành công' };
  }
}
