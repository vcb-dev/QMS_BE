import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerStatsQueryDto } from './dto/customer-stats-query.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role, Prisma } from '@prisma/client';

const CUSTOMER_INCLUDE = { province: true, ward: true } as const;

interface CustomerStatRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  provinceId: string | null;
  wardId: string | null;
  total_orders: number;
  total_closed: number;
  closed_value: string;
  last_order: Date | null;
}

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

  async getStats(dto: CustomerStatsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 12;
    const offset = (page - 1) * limit;
    const search = dto.search?.trim();
    const sortMode = dto.sortMode ?? 'TOP_SPEND';

    const searchCondition = search
      ? Prisma.sql`WHERE (c.name ILIKE ${`%${search}%`} OR c.phone ILIKE ${`%${search}%`})`
      : Prisma.empty;

    const orderBy =
      sortMode === 'MOST_ORDERS'
        ? Prisma.sql`total_orders DESC, c.id`
        : sortMode === 'RECENT'
          ? Prisma.sql`last_order DESC NULLS LAST, c.id`
          : Prisma.sql`closed_value DESC, c.id`;

    const rows = await this.prisma.$queryRaw<CustomerStatRow[]>(Prisma.sql`
      SELECT c.id, c.name, c.phone, c.address,
        c.province_id AS "provinceId", c.ward_id AS "wardId",
        COUNT(qr.id)::int AS total_orders,
        COUNT(qr.id) FILTER (WHERE qr.status = 'CLOSED')::int AS total_closed,
        COALESCE(SUM(qr.final_price) FILTER (WHERE qr.status = 'CLOSED'), 0)::numeric AS closed_value,
        MAX(qr.created_at) AS last_order
      FROM customers c
      LEFT JOIN quote_requests qr ON qr.customer_id = c.id
      ${searchCondition}
      GROUP BY c.id
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [{ count: totalRaw }] = await this.prisma.$queryRaw<
      { count: bigint }[]
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM customers c ${searchCondition}
    `);
    const total = Number(totalRaw);

    const [{ sum: totalClosedValueAllRaw }] = await this.prisma.$queryRaw<
      { sum: string | null }[]
    >(Prisma.sql`
      SELECT COALESCE(SUM(final_price), 0)::numeric AS sum FROM quote_requests WHERE status = 'CLOSED'
    `);

    const provinceIds = [
      ...new Set(
        rows.map((r) => r.provinceId).filter((id): id is string => !!id),
      ),
    ];
    const wardIds = [
      ...new Set(rows.map((r) => r.wardId).filter((id): id is string => !!id)),
    ];
    const [provinces, wards] = await Promise.all([
      provinceIds.length
        ? this.prisma.province.findMany({
            where: { id: { in: provinceIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve<{ id: string; name: string }[]>([]),
      wardIds.length
        ? this.prisma.ward.findMany({
            where: { id: { in: wardIds } },
            select: { id: true, name: true, districtName: true },
          })
        : Promise.resolve<
            { id: string; name: string; districtName: string | null }[]
          >([]),
    ]);
    const provinceById = new Map<string, string>(
      provinces.map((p): [string, string] => [p.id, p.name]),
    );
    const wardById = new Map<
      string,
      { name: string; districtName: string | null }
    >(
      wards.map(
        (w): [string, { name: string; districtName: string | null }] => [
          w.id,
          { name: w.name, districtName: w.districtName },
        ],
      ),
    );

    const data = rows.map((r) => ({
      customer: {
        id: r.id,
        name: r.name,
        phone: r.phone ?? undefined,
        address: r.address ?? undefined,
        province: r.provinceId
          ? { id: r.provinceId, name: provinceById.get(r.provinceId) || '' }
          : undefined,
        ward: r.wardId
          ? {
              id: r.wardId,
              name: wardById.get(r.wardId)?.name || '',
              districtName: wardById.get(r.wardId)?.districtName || undefined,
            }
          : undefined,
      },
      totalOrders: r.total_orders,
      totalClosed: r.total_closed,
      closedValue: Number(r.closed_value),
      lastOrder: r.last_order,
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      totalClosedValueAll: Number(totalClosedValueAllRaw),
    };
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
