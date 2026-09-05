// Thư Viện Sản Phẩm (Quản Lý Sản Phẩm) — danh sách báo giá đã chốt, gộp nhóm THÔ theo cột
// QuoteOption.libraryGroupKey (tính SẴN lúc ghi option, xem computeLibraryGroupKey). Trước đây nằm
// chung trong QuoteQueryService (god-service ~1000 dòng gộp cả read path realtime lẫn query gộp
// nhóm nặng của Thư Viện) — tách hẳn ra vì: dữ liệu LỊCH SỬ không cần realtime, SQL gộp nhóm/hydrate
// rất khác findAll. Không cache RAM — query thẳng DB mỗi lần.

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LibraryProductsQueryDto,
  LibraryHistoryQueryDto,
} from '../dto/library-products-query.dto';
import {
  OPTION_SUMMARY_SELECT,
  buildLibraryProductName,
  stripMaterialPercent,
  computePriceBreakdown,
  computeLivePriceBreakdown,
  attachPriceBreakdowns,
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

  // Bộ lọc SQL dùng chung cho danh sách Thư Viện + lịch sử báo giá 1 sản phẩm. Alias: qo =
  // quote_options, qr = quote_requests, pc = product_categories (caller phải JOIN đủ 3).
  private buildLibraryFilters(dto: {
    search?: string;
    categoryId?: string;
    materialId?: string;
    salePersonId?: string;
    orderPersonId?: string;
    timeRange?: string;
    startDate?: string;
    endDate?: string;
  }): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [
      Prisma.sql`qo.quoted_price IS NOT NULL`,
      Prisma.sql`qr.status IN ('QUOTED', 'CLOSED')`,
      Prisma.sql`qo.dedup_key IS NOT NULL`,
      Prisma.sql`qo.library_group_key IS NOT NULL`,
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
   * Danh sách sản phẩm đã báo giá (Thư viện/Quản lý sản phẩm). Gộp nhóm THÔ theo cột
   * QuoteOption.libraryGroupKey: "<categoryId> | <baseMetalId chất liệu nặng nhất> | <tập tên đá
   * MAIN>". Bỏ tuổi vàng/khối lượng/size đá/đá tấm.
   *
   * SQL gộp + phân trang phía DB (GROUP BY library_group_key), CHỈ hydrate + tính giá sống cho
   * option thuộc các nhóm CỦA TRANG này. Sort PRICE_ASC/DESC theo giá ĐÃ BÁO (quoted_price); card
   * vẫn hiển thị giá sống. Không cache RAM — query thẳng DB mỗi lần.
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
        : dto.sortMode === 'MOST_QUOTED'
          ? Prisma.sql`dup_count DESC`
          : dto.sortMode === 'RECENT'
            ? Prisma.sql`last_at DESC`
            : Prisma.sql`q_max DESC`; // PRICE_DESC (mặc định)

    // 1 query CTE — gộp 2 bước thành 1 round-trip DB:
    //  page:   1 TRANG khóa nhóm + aggregate. count(*) OVER() = tổng số nhóm để phân trang.
    //  ranked: chỉ cho các khóa nhóm CỦA TRANG — row_number() lấy option ĐẠI DIỆN (mới nhất) +
    //          option giá THẤP NHẤT + CAO NHẤT.
    const grpRows = await this.prisma.$queryRaw<
      {
        gkey: string;
        dup_count: bigint;
        q_min: unknown;
        q_max: unknown;
        mat_min: unknown;
        mat_max: unknown;
        stone_min: unknown;
        stone_max: unknown;
        w_min: unknown;
        w_max: unknown;
        last_at: Date;
        total: bigint;
        rep_id: string | null;
        min_opt_id: string | null;
        max_opt_id: string | null;
      }[]
    >(Prisma.sql`
      WITH page AS (
        SELECT
          qo.library_group_key AS gkey,
          count(DISTINCT qo.quote_request_id) AS dup_count,
          min(qo.quoted_price) AS q_min,
          max(qo.quoted_price) AS q_max,
          min(qo.quoted_price - COALESCE(qo.stone_price, 0)) AS mat_min,
          max(qo.quoted_price - COALESCE(qo.stone_price, 0)) AS mat_max,
          min(COALESCE(qo.stone_price, 0)) AS stone_min,
          max(COALESCE(qo.stone_price, 0)) AS stone_max,
          min(qo.weight_chi) AS w_min,
          max(qo.weight_chi) AS w_max,
          max(COALESCE(qo.quoted_date, qr.created_at)) AS last_at,
          count(*) OVER () AS total
        FROM quote_options qo
        JOIN quote_requests qr ON qr.id = qo.quote_request_id
        LEFT JOIN product_categories pc ON pc.id = qr.category_id
        WHERE ${whereSql}
        GROUP BY qo.library_group_key
        ORDER BY ${sortSql}, gkey
        LIMIT ${limit} OFFSET ${offset}
      ),
      ranked AS (
        SELECT
          qo.library_group_key AS gkey,
          qo.id,
          row_number() OVER (PARTITION BY qo.library_group_key ORDER BY COALESCE(qo.quoted_date, qr.created_at) DESC, qo.id DESC) AS rn_rep,
          row_number() OVER (PARTITION BY qo.library_group_key ORDER BY qo.quoted_price ASC, qo.id) AS rn_min,
          row_number() OVER (PARTITION BY qo.library_group_key ORDER BY qo.quoted_price DESC, qo.id) AS rn_max
        FROM quote_options qo
        JOIN quote_requests qr ON qr.id = qo.quote_request_id
        LEFT JOIN product_categories pc ON pc.id = qr.category_id
        WHERE ${whereSql}
          AND qo.library_group_key IN (SELECT gkey FROM page)
      ),
      reps AS (
        SELECT
          gkey,
          max(id) FILTER (WHERE rn_rep = 1) AS rep_id,
          max(id) FILTER (WHERE rn_min = 1) AS min_opt_id,
          max(id) FILTER (WHERE rn_max = 1) AS max_opt_id
        FROM ranked
        WHERE rn_rep = 1 OR rn_min = 1 OR rn_max = 1
        GROUP BY gkey
      )
      SELECT p.*, r.rep_id, r.min_opt_id, r.max_opt_id
      FROM page p
      LEFT JOIN reps r ON r.gkey = p.gkey
      ORDER BY ${sortSql}, p.gkey
    `);

    const total = grpRows.length ? Number(grpRows[0].total) : 0;

    // Hydrate rep + option min/max giá của mỗi nhóm trên trang (dedupe) — ≤ 3×limit dòng.
    const optIds = [
      ...new Set(
        grpRows.flatMap((r) =>
          [r.rep_id, r.min_opt_id, r.max_opt_id].filter(
            (x): x is string => !!x,
          ),
        ),
      ),
    ];
    const opts = optIds.length ? await this.hydrateLibraryOptions(optIds) : [];
    await this.attachLivePricesToOptions(opts as any[]);
    for (const o of opts as any[]) attachPriceBreakdowns(o);
    const optById = new Map((opts as any[]).map((o) => [o.id, o]));

    // Thứ tự thẻ = thứ tự SQL đã sort + phân trang.
    const data = grpRows
      .map((r) => {
        const rep = r.rep_id ? optById.get(r.rep_id) : undefined;
        if (!rep) return null;
        const minOpt = r.min_opt_id ? optById.get(r.min_opt_id) : undefined;
        const maxOpt = r.max_opt_id ? optById.get(r.max_opt_id) : undefined;
        return this.buildLibraryCardFromRep(r.gkey, rep, {
          dupCount: Number(r.dup_count),
          qMin: Number(r.q_min) || 0,
          qMax: Number(r.q_max) || 0,
          matMin: Number(r.mat_min) || 0,
          matMax: Number(r.mat_max) || 0,
          stoneMin: Number(r.stone_min) || 0,
          stoneMax: Number(r.stone_max) || 0,
          wMin: r.w_min != null ? Number(r.w_min) : null,
          wMax: r.w_max != null ? Number(r.w_max) : null,
          lastAt: r.last_at,
          liveMin: this.livePriceOf(minOpt),
          liveMax: this.livePriceOf(maxOpt),
          liveStoneMin: minOpt?.liveStonePrice ?? null,
          liveStoneMax: maxOpt?.liveStonePrice ?? null,
        });
      })
      .filter((c): c is NonNullable<typeof c> => !!c);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /**
   * Lịch sử báo giá của 1 sản phẩm (1 thẻ Thư Viện) — lazy load khi mở modal chi tiết. Phân trang
   * theo ĐƠN (1 dòng = 1 yêu cầu báo giá), mới → cũ. Áp cùng bộ lọc với danh sách ngoài.
   */
  async getLibraryProductHistory(dto: LibraryHistoryQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;

    const filters = this.buildLibraryFilters(dto);
    filters.push(Prisma.sql`qo.library_group_key = ${dto.groupKey}`);
    const whereSql = Prisma.join(filters, ' AND ');

    const reqRows = await this.prisma.$queryRaw<
      { request_id: string; total: bigint }[]
    >(Prisma.sql`
      SELECT
        qr.id AS request_id,
        max(COALESCE(qo.quoted_date, qr.created_at)) AS last_at,
        count(*) OVER () AS total
      FROM quote_options qo
      JOIN quote_requests qr ON qr.id = qo.quote_request_id
      LEFT JOIN product_categories pc ON pc.id = qr.category_id
      WHERE ${whereSql}
      GROUP BY qr.id
      ORDER BY last_at DESC, qr.id
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = reqRows.length ? Number(reqRows[0].total) : 0;
    const requestIds = reqRows.map((r) => r.request_id);

    const optRows = requestIds.length
      ? await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT qo.id
          FROM quote_options qo
          WHERE qo.quote_request_id IN (${Prisma.join(requestIds)})
            AND qo.library_group_key = ${dto.groupKey}
            AND qo.quoted_price IS NOT NULL
        `)
      : [];

    const options = optRows.length
      ? await this.hydrateLibraryOptions(optRows.map((r) => r.id))
      : [];
    await this.attachLivePricesToOptions(options as any[]);
    for (const o of options as any[]) attachPriceBreakdowns(o);

    const byRequest = new Map<string, any[]>();
    for (const o of options as any[]) {
      const rid = o.quoteRequest.id;
      const b = byRequest.get(rid);
      if (b) b.push(o);
      else byRequest.set(rid, [o]);
    }

    const data = requestIds
      .map((rid) => {
        const opts = byRequest.get(rid);
        return opts && opts.length ? this.buildHistoryEntry(opts) : null;
      })
      .filter((e): e is NonNullable<typeof e> => !!e);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  private hydrateLibraryOptions(optionIds: string[]) {
    return this.prisma.quoteOption.findMany({
      where: { id: { in: optionIds } },
      select: {
        ...OPTION_SUMMARY_SELECT,
        libraryGroupKey: true,
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
        quoteRequest: {
          select: {
            id: true,
            code: true,
            categoryId: true,
            createdAt: true,
            category: { select: { name: true } },
            requester: { select: { name: true } },
            assignee: { select: { name: true } },
            images: {
              select: { id: true, imageUrl: true },
              orderBy: { id: 'asc' },
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

  // Dải khối lượng "min – max chỉ" từ 2 số min/max SQL đã tính sẵn cho cả nhóm.
  private weightRangeFromMinMax(
    min: number | null,
    max: number | null,
  ): string | null {
    const lo = min && min > 0 ? min : null;
    const hi = max && max > 0 ? max : null;
    if (lo == null && hi == null) return null;
    if (lo != null && hi != null && lo !== hi) return `${lo} – ${hi} chỉ`;
    return `${hi ?? lo} chỉ`;
  }

  // Giá sống đã gắn vào 1 option đã hydrate — null nếu không tính được (thiếu config).
  private livePriceOf(o: any): number | null {
    return o && o.livePrice != null ? Number(o.livePrice) : null;
  }

  // Thẻ sản phẩm từ 1 option ĐẠI DIỆN (mới nhất của nhóm) + số liệu tổng hợp SQL.
  private buildLibraryCardFromRep(
    groupKey: string,
    rep: any,
    agg: {
      dupCount: number;
      qMin: number;
      qMax: number;
      wMin: number | null;
      wMax: number | null;
      lastAt: Date;
      liveMin: number | null;
      liveMax: number | null;
      matMin: number;
      matMax: number;
      stoneMin: number;
      stoneMax: number;
      liveStoneMin: number | null;
      liveStoneMax: number | null;
    },
  ) {
    const catName = rep.quoteRequest.category?.name || '';
    const baseMetalName =
      this.dominantMaterial(rep)?.material?.baseMetal?.name || '';
    const stoneNames = [...new Set(this.mainStoneNames(rep))].sort();

    const productName = buildLibraryProductName(
      catName,
      baseMetalName,
      stoneNames,
    );

    const detailMatNames = [
      ...new Set(
        ((rep.materials || []) as any[])
          .map((m) => m.material?.name)
          .filter(Boolean),
      ),
    ]
      .map(stripMaterialPercent)
      .sort();

    // Khoảng giá HÔM NAY: tính live ĐÚNG cho option giá thấp nhất + option giá cao nhất của nhóm.
    const roundK = (x: number) => Math.round(x / 1000) * 1000;
    const livePriceMin = agg.liveMin != null ? roundK(agg.liveMin) : null;
    const livePriceMax = agg.liveMax != null ? roundK(agg.liveMax) : null;

    return {
      key: `grp:${groupKey}`,
      groupKey,
      requestId: rep.quoteRequest.id,
      code: rep.quoteRequest.code,
      categoryId: rep.quoteRequest.categoryId,
      images: rep.quoteRequest.images,
      option: rep,
      productName,
      matStr: baseMetalName || detailMatNames.join(', '),
      weightDisplay: this.weightRangeFromMinMax(agg.wMin, agg.wMax),
      stoneDisplay: stoneNames.length ? stoneNames.join(', ') : 'Không đính đá',
      materialIds: [
        ...new Set(
          ((rep.materials || []) as any[])
            .map((m) => m.materialId)
            .filter(Boolean),
        ),
      ] as string[],
      requestCreatedAt: rep.quoteRequest.createdAt,
      lastQuotedAt: agg.lastAt,
      duplicateCount: agg.dupCount,
      priceMin: agg.qMin,
      priceMax: agg.qMax,
      priceMaterialMin: agg.matMin,
      priceMaterialMax: agg.matMax,
      priceStoneMin: agg.stoneMin,
      priceStoneMax: agg.stoneMax,
      livePriceMin,
      livePriceMax,
      livePriceMaterialMin:
        agg.liveMin != null && agg.liveStoneMin != null
          ? roundK(agg.liveMin - agg.liveStoneMin)
          : null,
      livePriceMaterialMax:
        agg.liveMax != null && agg.liveStoneMax != null
          ? roundK(agg.liveMax - agg.liveStoneMax)
          : null,
      livePriceStoneMin:
        agg.liveStoneMin != null ? roundK(agg.liveStoneMin) : null,
      livePriceStoneMax:
        agg.liveStoneMax != null ? roundK(agg.liveStoneMax) : null,
      history: [] as unknown[], // giữ field cho tương thích; nội dung lazy-load riêng
    };
  }

  // 1 dòng lịch sử = 1 đơn báo giá (opts = mọi option của đơn đó thuộc nhóm).
  private buildHistoryEntry(opts: any[]) {
    const req = opts[0].quoteRequest;
    const quotedDate =
      opts
        .map((o) => o.quotedDate)
        .filter(Boolean)
        .sort(
          (a: any, b: any) => new Date(b).getTime() - new Date(a).getTime(),
        )[0] || null;

    const options = [...opts]
      .map((o) => {
        const price = Number(o.quotedPrice) || 0;
        const livePrice = o.livePrice != null ? Number(o.livePrice) : null;
        let livePriceDeltaPct: number | null = null;
        if (livePrice != null && price > 0) {
          const pct = ((livePrice - price) / price) * 100;
          livePriceDeltaPct =
            Math.abs(pct) < 0.05 ? 0 : Math.round(pct * 10) / 10;
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
            computeLivePriceBreakdown(o.livePrice, o.liveStonePrice) ??
            undefined,
        };
      })
      .sort((a, b) => a.price - b.price);

    const paid = options.map((o) => o.price).filter((p) => p > 0);
    return {
      requestId: req.id,
      code: req.code,
      quotedDate,
      quotedAt: quotedDate || req.createdAt,
      weightDisplay: this.weightRangeDisplay(opts),
      saleName: req.requester?.name || '',
      pricerName: req.assignee?.name || null,
      priceMin: paid.length ? Math.min(...paid) : 0,
      priceMax: paid.length ? Math.max(...paid) : 0,
      images: (req.images || []).map((i: any) => ({
        id: i.id,
        imageUrl: i.imageUrl,
      })),
      options,
    };
  }
}
