// Thư Viện Sản Phẩm (Quản Lý Sản Phẩm) — mỗi yêu cầu báo giá đã QUOTED/CLOSED là 1 sản phẩm (1 thẻ),
// KHÔNG gộp các yêu cầu giống nhau lại. Chi tiết thẻ là "Lịch sử báo giá": các phương án đã báo giá
// của chính yêu cầu đó, mỗi phương án có giá lúc báo giá + giá tính lại hôm nay. Không cache RAM —
// query thẳng DB mỗi lần. Payload thẻ chỉ có giá bán (không có giá vốn/lãi), nên Sale và Order nhận
// cùng một dữ liệu.

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LibraryProductsQueryDto } from '../dto/library-products-query.dto';
import {
  OPTION_SUMMARY_SELECT,
  buildLibraryProductName,
  stripMaterialPercent,
  computePriceBreakdown,
  computeLivePriceBreakdown,
  attachPriceBreakdowns,
  pickPrimaryOption,
  toLivePriceInput,
  applyLivePriceMap,
} from '../../utils/option-mapper.util';
import { resolveDateRange } from '../../utils/date-range.util';
import { QuoteOptionsService } from '../quote-option/quote-options.service';

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteOptionsService: QuoteOptionsService,
  ) {}

  // Bộ lọc SQL của danh sách Thư Viện. Alias: qr = quote_requests, qo = quote_options, pc =
  // product_categories (caller phải JOIN đủ 3).
  private buildLibraryFilters(dto: LibraryProductsQueryDto): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [
      Prisma.sql`qo.quoted_price IS NOT NULL`,
      Prisma.sql`qr.status IN ('QUOTED', 'CLOSED')`,
    ];
    if (dto.categoryId && dto.categoryId !== 'ALL') {
      filters.push(Prisma.sql`qr.category_id = ${dto.categoryId}`);
    }
    if (dto.materialId && dto.materialId !== 'ALL') {
      filters.push(
        Prisma.sql`EXISTS (SELECT 1 FROM quote_option_materials qom WHERE qom.option_id = qo.id AND qom.material_id = ${dto.materialId})`,
      );
    }
    if (dto.salePersonId && dto.salePersonId !== 'ALL') {
      filters.push(Prisma.sql`qr.requester_id = ${dto.salePersonId}`);
    }
    if (dto.orderPersonId && dto.orderPersonId !== 'ALL') {
      filters.push(Prisma.sql`qr.assignee_id = ${dto.orderPersonId}`);
    }
    const search = dto.search?.trim();
    if (search) {
      filters.push(Prisma.sql`(
        qr.code ILIKE ${`%${search}%`}
        OR pc.name ILIKE ${`%${search}%`}
        OR EXISTS (
          SELECT 1 FROM quote_option_materials qom2
          JOIN materials m ON m.id = qom2.material_id
          WHERE qom2.option_id = qo.id AND m.name ILIKE ${`%${search}%`}
        )
      )`);
    }
    // timeRange / startDate / endDate quy đổi qua resolveDateRange — CÙNG 1 nguồn với danh sách yêu
    // cầu báo giá / khách hàng / nhân viên. Cột mốc thời gian của Thư Viện là
    // COALESCE(quoted_date, created_at).
    const dateRange = resolveDateRange(
      dto.timeRange,
      dto.startDate,
      dto.endDate,
    );
    if (dateRange?.gte) {
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) >= ${dateRange.gte}`,
      );
    }
    if (dateRange?.lte) {
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) <= ${dateRange.lte}`,
      );
    }
    return filters;
  }

  /**
   * Danh sách sản phẩm đã báo giá (Thư viện/Quản lý sản phẩm). 1 yêu cầu QUOTED/CLOSED = 1 thẻ.
   *
   * SQL chỉ sắp xếp + phân trang theo yêu cầu (GROUP BY qr.id); sau đó hydrate + tính giá sống cho
   * các phương án đã báo giá của ĐÚNG các yêu cầu trong trang này. Sort PRICE_ASC/DESC theo giá ĐÃ
   * BÁO (quoted_price); thẻ vẫn hiển thị thêm giá sống. Không cache RAM — query thẳng DB mỗi lần.
   */
  async getLibraryProducts(dto: LibraryProductsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 8;
    const offset = (page - 1) * limit;

    const whereSql = Prisma.join(this.buildLibraryFilters(dto), ' AND ');

    // Sort theo giá ĐÃ BÁO (quoted_price) để SQL sắp + phân trang được.
    const sortSql =
      dto.sortMode === 'PRICE_ASC'
        ? Prisma.sql`q_min ASC`
        : dto.sortMode === 'RECENT'
          ? Prisma.sql`last_at DESC`
          : Prisma.sql`q_max DESC`; // PRICE_DESC (mặc định)

    // count(*) OVER() = tổng số yêu cầu khớp bộ lọc, để phân trang.
    const pageRows = await this.prisma.$queryRaw<
      { request_id: string; total: bigint }[]
    >(Prisma.sql`
      SELECT
        qr.id AS request_id,
        min(qo.quoted_price) AS q_min,
        max(qo.quoted_price) AS q_max,
        max(COALESCE(qo.quoted_date, qr.created_at)) AS last_at,
        count(*) OVER () AS total
      FROM quote_requests qr
      JOIN quote_options qo ON qo.quote_request_id = qr.id
      LEFT JOIN product_categories pc ON pc.id = qr.category_id
      WHERE ${whereSql}
      GROUP BY qr.id
      ORDER BY ${sortSql}, qr.id
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = pageRows.length ? Number(pageRows[0].total) : 0;
    const requests = pageRows.length
      ? await this.hydrateRequests(pageRows.map((r) => r.request_id))
      : [];

    const options = requests.flatMap((r) => r.options as any[]);
    await this.attachLivePricesToOptions(options);
    for (const o of options) attachPriceBreakdowns(o);

    // Thứ tự thẻ = thứ tự SQL đã sort + phân trang.
    const byId = new Map(requests.map((r) => [r.id, r]));
    const data = pageRows
      .map((row) => byId.get(row.request_id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => this.buildLibraryCard(r))
      .filter((c): c is NonNullable<typeof c> => !!c);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  // Các yêu cầu của trang hiện tại kèm MỌI phương án đã có giá (kể cả phương án không khớp bộ lọc
  // chất liệu — thẻ phải hiện đủ lịch sử báo giá của yêu cầu đó).
  private hydrateRequests(requestIds: string[]) {
    return this.prisma.quoteRequest.findMany({
      where: { id: { in: requestIds } },
      select: {
        id: true,
        code: true,
        createdAt: true,
        category: { select: { name: true } },
        requester: { select: { name: true } },
        assignee: { select: { name: true } },
        images: {
          select: { id: true, imageUrl: true },
          orderBy: { id: 'asc' },
        },
        options: {
          where: { quotedPrice: { not: null } },
          orderBy: { createdAt: 'asc' },
          select: {
            ...OPTION_SUMMARY_SELECT,
            materials: {
              select: {
                materialId: true,
                weightChi: true,
                material: {
                  select: {
                    id: true,
                    name: true,
                    baseMetalId: true,
                    baseMetal: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  // Giá sống cho 1 tập option đã hydrate — 1 lệnh batchComputeLivePrices, 0 query DB thêm.
  private async attachLivePricesToOptions(options: any[]) {
    const inputs = options
      .filter((o) => o.quotedPrice != null)
      .map((o) => toLivePriceInput(o));
    if (inputs.length === 0) return;
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    applyLivePriceMap(options, priceMap);
  }

  // Dải khối lượng của 1 tập option — "min – max chỉ", 1 số nếu đồng nhất, null nếu không có.
  private weightRangeDisplay(opts: any[]): string | null {
    const w = [
      ...new Set(
        opts.map((o) => Number(o.weightChi) || 0).filter((x) => x > 0),
      ),
    ].sort((a, b) => a - b);
    if (w.length === 0) return null;
    if (w.length === 1) return `${w[0]} chỉ`;
    return `${w[0]} – ${w[w.length - 1]} chỉ`;
  }

  // Kim loại gốc "chủ đạo" của 1 option = baseMetal của material nặng nhất. null nếu toàn phi kim loại.
  private dominantMaterial(o: any): any | null {
    const mats = (o.materials || []).filter(
      (m: any) => m.material?.baseMetalId,
    );
    if (mats.length === 0) return null;
    return [...mats].sort(
      (a: any, b: any) =>
        (Number(b.weightChi) || 0) - (Number(a.weightChi) || 0),
    )[0];
  }

  // Tên đá CHỦ (MAIN) của 1 option — giữ nguyên tên đầy đủ. Đá tấm (SIDE) bỏ hẳn.
  private mainStoneNames(o: any): string[] {
    return [
      ...new Set(
        ((o.stones || []) as any[])
          .filter((s) => s.stone?.stoneType === 'MAIN' && s.stone?.name)
          .map((s) => String(s.stone.name).trim())
          .filter(Boolean),
      ),
    ];
  }

  // Thẻ sản phẩm của 1 yêu cầu: tên theo phương án đại diện (đã chốt > đang chọn > báo gần nhất),
  // chất liệu/khối lượng/đá tổng hợp từ MỌI phương án đã báo, kèm lịch sử báo giá từng phương án.
  private buildLibraryCard(req: any) {
    const opts = (req.options || []) as any[];
    const primary = pickPrimaryOption({ options: opts });
    if (!primary) return null;

    const productName = buildLibraryProductName(
      req.category?.name,
      this.dominantMaterial(primary)?.material?.baseMetal?.name,
      [...this.mainStoneNames(primary)].sort(),
    );

    const matNames = [
      ...new Set(
        opts.flatMap((o) =>
          ((o.materials || []) as any[])
            .map((m) => m.material?.name)
            .filter(Boolean)
            .map(stripMaterialPercent),
        ),
      ),
    ].sort();
    const stoneNames = [
      ...new Set(opts.flatMap((o) => this.mainStoneNames(o))),
    ].sort();

    const history = opts
      .map((o) => this.buildHistoryOption(o))
      .sort((a, b) => a.price - b.price);

    const prices = history.map((h) => h.price).filter((p) => p > 0);
    const livePrices = history
      .map((h) => h.livePrice)
      .filter((p): p is number => p != null);
    const roundK = (x: number) => Math.round(x / 1000) * 1000;

    const quotedAt =
      opts
        .map((o) => o.quotedDate)
        .filter(Boolean)
        .sort(
          (a: any, b: any) => new Date(b).getTime() - new Date(a).getTime(),
        )[0] || req.createdAt;

    return {
      key: `req:${req.id}`,
      requestId: req.id,
      code: req.code,
      images: req.images,
      productName,
      matStr: matNames.join(', '),
      weightDisplay: this.weightRangeDisplay(opts),
      stoneDisplay: stoneNames.length ? stoneNames.join(', ') : 'Không đính đá',
      saleName: req.requester?.name || '',
      pricerName: req.assignee?.name || null,
      quotedAt,
      priceMin: prices.length ? Math.min(...prices) : 0,
      priceMax: prices.length ? Math.max(...prices) : 0,
      // Khoảng giá HÔM NAY: min/max giá sống của các phương án (null nếu không phương án nào tính được).
      livePriceMin: livePrices.length ? roundK(Math.min(...livePrices)) : null,
      livePriceMax: livePrices.length ? roundK(Math.max(...livePrices)) : null,
      options: history,
    };
  }

  // 1 dòng lịch sử báo giá = 1 phương án đã báo: giá đã đóng băng lúc báo + giá sống hôm nay.
  private buildHistoryOption(o: any) {
    const price = Number(o.quotedPrice) || 0;
    const livePrice = o.livePrice != null ? Number(o.livePrice) : null;
    let livePriceDeltaPct: number | null = null;
    if (livePrice != null && price > 0) {
      const pct = ((livePrice - price) / price) * 100;
      livePriceDeltaPct = Math.abs(pct) < 0.05 ? 0 : Math.round(pct * 10) / 10;
    }
    return {
      optionName: o.optionName,
      price,
      livePrice,
      livePriceDeltaPct,
      selectionStatus: o.selectionStatus,
      priceBreakdown:
        computePriceBreakdown(o.quotedPrice, o.stonePrice) ?? undefined,
      livePriceBreakdown:
        computeLivePriceBreakdown(o.livePrice, o.liveStonePrice) ?? undefined,
    };
  }
}
