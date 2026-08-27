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

    const filters: Prisma.Sql[] = [];
    if (search) {
      filters.push(
        Prisma.sql`(c.name ILIKE ${`%${search}%`} OR c.phone ILIKE ${`%${search}%`})`,
      );
    }
    if (dto.provinceId) {
      filters.push(Prisma.sql`c.province_id = ${dto.provinceId}`);
    }
    if (dto.requesterId) {
      // Lọc theo nhân viên SALE đang theo dõi đơn — requesterId nằm ở quote_requests, không phải
      // cột nào của customers, nên dùng EXISTS thay vì join trực tiếp (tránh nhân bản dòng).
      filters.push(
        Prisma.sql`EXISTS (SELECT 1 FROM quote_requests qr2 WHERE qr2.customer_id = c.id AND qr2.requester_id = ${dto.requesterId})`,
      );
    }
    const whereSql = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;

    const { start: lastOrderStart, end: lastOrderEnd } =
      this.resolveLastOrderRange(dto.timeRange, dto.startDate, dto.endDate);
    const havingParts: Prisma.Sql[] = [];
    if (lastOrderStart) {
      havingParts.push(Prisma.sql`MAX(qr.created_at) >= ${lastOrderStart}`);
    }
    if (lastOrderEnd) {
      havingParts.push(Prisma.sql`MAX(qr.created_at) <= ${lastOrderEnd}`);
    }
    const havingSql = havingParts.length
      ? Prisma.sql`HAVING ${Prisma.join(havingParts, ' AND ')}`
      : Prisma.empty;

    const orderBy =
      sortMode === 'MOST_ORDERS'
        ? Prisma.sql`total_orders DESC, c.id`
        : sortMode === 'RECENT'
          ? Prisma.sql`last_order DESC NULLS LAST, c.id`
          : Prisma.sql`closed_value DESC, c.id`;

    // CTE dùng chung cho trang hiện tại + đếm tổng — HAVING lọc theo last_order (aggregate) nên
    // không thể đếm bằng COUNT(*) đơn giản trên bảng customers như trước.
    const cteSql = Prisma.sql`
      SELECT c.id, c.name, c.phone, c.address,
        c.province_id AS "provinceId", c.ward_id AS "wardId",
        COUNT(qr.id)::int AS total_orders,
        COUNT(qr.id) FILTER (WHERE qr.status = 'CLOSED')::int AS total_closed,
        COALESCE(SUM(qr.final_price) FILTER (WHERE qr.status = 'CLOSED'), 0)::numeric AS closed_value,
        MAX(qr.created_at) AS last_order
      FROM customers c
      LEFT JOIN quote_requests qr ON qr.customer_id = c.id
      ${whereSql}
      GROUP BY c.id
      ${havingSql}
    `;

    const rows = await this.prisma.$queryRaw<CustomerStatRow[]>(Prisma.sql`
      ${cteSql} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}
    `);

    const [{ count: totalRaw }] = await this.prisma.$queryRaw<
      { count: bigint }[]
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM (${cteSql}) t
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
            select: { id: true, name: true },
          })
        : Promise.resolve<{ id: string; name: string }[]>([]),
    ]);
    const provinceById = new Map<string, string>(
      provinces.map((p): [string, string] => [p.id, p.name]),
    );
    const wardById = new Map<string, { name: string }>(
      wards.map((w): [string, { name: string }] => [w.id, { name: w.name }]),
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

  // So sánh KPI tháng này với tháng trước cho 2 card đầu trang (Tổng khách hàng/Tổng giá trị đã
  // chốt) — "khách hàng" ở đây tính là khách có ít nhất 1 yêu cầu báo giá tạo trong tháng (khách
  // hoạt động trong tháng), không phải tổng khách hàng toàn hệ thống như bảng bên dưới.
  async getMonthComparison(provinceId?: string, requesterId?: string) {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    );

    const periodStats = async (start: Date, end: Date) => {
      const filters: Prisma.Sql[] = [
        Prisma.sql`qr.created_at >= ${start}`,
        Prisma.sql`qr.created_at <= ${end}`,
      ];
      if (provinceId) filters.push(Prisma.sql`c.province_id = ${provinceId}`);
      if (requesterId)
        filters.push(Prisma.sql`qr.requester_id = ${requesterId}`);

      const [row] = await this.prisma.$queryRaw<
        { customer_count: bigint; closed_value: string }[]
      >(Prisma.sql`
        SELECT
          COUNT(DISTINCT qr.customer_id)::bigint AS customer_count,
          COALESCE(SUM(qr.final_price) FILTER (WHERE qr.status = 'CLOSED'), 0)::numeric AS closed_value
        FROM quote_requests qr
        JOIN customers c ON c.id = qr.customer_id
        WHERE ${Prisma.join(filters, ' AND ')}
      `);
      return {
        customerCount: Number(row?.customer_count || 0),
        closedValue: Number(row?.closed_value || 0),
      };
    };

    const [current, previous] = await Promise.all([
      periodStats(thisMonthStart, now),
      periodStats(lastMonthStart, lastMonthEnd),
    ]);

    // null = tháng trước = 0, không có mốc để tính % (khác 0% — 0% nghĩa là "không đổi").
    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr === 0 ? 0 : null;
      return ((curr - prev) / prev) * 100;
    };

    return {
      current,
      previous,
      customerCountDeltaPct: pctChange(
        current.customerCount,
        previous.customerCount,
      ),
      closedValueDeltaPct: pctChange(current.closedValue, previous.closedValue),
    };
  }

  // Ưu tiên khoảng ngày tùy chọn (startDate/endDate) nếu người dùng nhập; chỉ dùng nút lọc nhanh
  // (timeRange) khi không có startDate. Lọc trên last_order (MAX(qr.created_at)) — khách có đơn
  // gần nhất rơi vào khoảng này mới được tính là khớp.
  private resolveLastOrderRange(
    timeRange?: string,
    startDate?: string,
    endDate?: string,
  ): { start?: Date; end?: Date } {
    let start: Date | undefined = startDate ? new Date(startDate) : undefined;
    let end: Date | undefined = endDate ? new Date(endDate) : undefined;
    if (end) {
      end = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
        23,
        59,
        59,
      );
    }

    if (timeRange && timeRange !== 'ALL' && !start) {
      const now = new Date();
      if (timeRange === 'TODAY') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (timeRange === 'THIS_WEEK') {
        const day = now.getDay() || 7;
        start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - day + 1,
        );
      } else if (timeRange === 'THIS_MONTH') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    }

    return { start, end };
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
