import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilterQuoteRequestDto } from '../dto/filter-quote-request.dto';
import {
  LibraryProductsQueryDto,
  LibraryHistoryQueryDto,
} from '../dto/library-products-query.dto';
import { User, Role, Prisma } from '@prisma/client';
import { APP_CONSTANTS } from '../../common/constants';
import {
  REQUEST_DETAIL_INCLUDE,
  OPTION_SUMMARY_SELECT,
  mapQuoteRequestDetail,
  pickPrimaryOption,
  buildProductName,
  buildLibraryProductName,
  stripMaterialPercent,
} from '../../utils/option-mapper.util';
import { buildQuoteWhereClause } from '../../utils/quote-filter.util';
import {
  countsFromGroupBy,
  getMyReqCount,
} from '../../utils/quote-counts.util';
import {
  QuoteOptionsService,
  LivePriceItem,
} from '../quote-option/quote-options.service';

@Injectable()
export class QuoteQueryService {
  private readonly listCache = new Map<string, { at: number; data: any }>();
  // TTL cache danh sách (findAll) + thư viện sản phẩm (getLibraryProducts). Mọi lệnh ghi đã gọi
  // clearCache() nên stale chỉ xảy ra khi đổi dữ liệu ngoài luồng hoặc chạy nhiều instance (cache
  // theo từng instance). Chỉnh qua LIST_CACHE_TTL_MS; mặc định 60s.
  private readonly cacheTtlMs = Number(process.env.LIST_CACHE_TTL_MS) || 60_000;
  // Trần số entry — cacheKey = JSON.stringify(filterDto) nên số key phân biệt là vô hạn (mỗi tổ
  // hợp filter/search/page là 1 key). Không có trần thì Map phình mãi = memory leak chậm. Map giữ
  // thứ tự insert; cacheSet xóa+chèn lại khi "touch" nên key cũ nhất luôn ở đầu -> evict kiểu LRU.
  private readonly cacheMaxEntries =
    Number(process.env.LIST_CACHE_MAX_ENTRIES) || 200;

  constructor(
    private prisma: PrismaService,
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  clearCache() {
    this.listCache.clear();
  }

  // Đọc cache có kiểm TTL + "touch" (đưa key lên cuối) để lần evict sau bỏ đúng key ít dùng nhất.
  private cacheGet(key: string): any | undefined {
    const hit = this.listCache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.cacheTtlMs) {
      this.listCache.delete(key);
      return undefined;
    }
    this.listCache.delete(key);
    this.listCache.set(key, hit);
    return hit.data;
  }

  // Ghi cache + evict key cũ nhất khi vượt trần.
  private cacheSet(key: string, data: any): void {
    this.listCache.delete(key);
    this.listCache.set(key, { at: Date.now(), data });
    while (this.listCache.size > this.cacheMaxEntries) {
      const oldest = this.listCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.listCache.delete(oldest);
    }
  }

  /**
   * Danh sách sản phẩm đã báo giá (Thư viện/Quản lý sản phẩm). Gộp nhóm THÔ theo cột
   * QuoteOption.libraryGroupKey (tính SẴN lúc ghi option — xem computeLibraryGroupKey):
   * "<categoryId> | <baseMetalId chất liệu nặng nhất> | <tập tên đá MAIN>". Bỏ tuổi vàng/khối
   * lượng/size đá/đá tấm.
   *
   * SQL gộp + phân trang phía DB (GROUP BY library_group_key), CHỈ hydrate + tính giá sống cho
   * option thuộc các nhóm CỦA TRANG này — không kéo toàn bộ option như trước. Sort PRICE_ASC/DESC
   * theo giá ĐÃ BÁO (quoted_price) để SQL sắp được; card vẫn hiển thị giá sống (có thể lệch nhẹ
   * thứ tự ở các cặp giá suýt soát — chấp nhận). Cache như findAll; mọi thao tác ghi gọi clearCache().
   */
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
    const cutoff = this.libraryTimeRangeCutoff(dto.timeRange);
    if (cutoff) {
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) >= ${cutoff}`,
      );
    }
    const startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (startDate && !isNaN(startDate.getTime())) {
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) >= ${startDate}`,
      );
    }
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && !isNaN(endDate.getTime())) {
      endDate.setDate(endDate.getDate() + 1); // bao trọn ngày endDate
      filters.push(
        Prisma.sql`COALESCE(qo.quoted_date, qr.created_at) < ${endDate}`,
      );
    }
    return filters;
  }

  async getLibraryProducts(dto: LibraryProductsQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 8;
    const offset = (page - 1) * limit;

    const cacheKey = `library:${JSON.stringify(dto)}`;
    const cached = this.cacheGet(cacheKey);
    if (cached) return cached;

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

    // 1 trang KHÓA NHÓM + số liệu tổng hợp (từ covering index) + id option: ĐẠI DIỆN (mới nhất, để
    // hiện tên/ảnh) + option giá THẤP NHẤT + option giá CAO NHẤT (để tính giá hôm nay ĐÚNG cho từng
    // đầu — min/max báo khác ngày nên biến động khác nhau). Phân trang phía DB.
    const grpRows = await this.prisma.$queryRaw<
      {
        gkey: string;
        dup_count: bigint;
        q_min: unknown;
        q_max: unknown;
        w_min: unknown;
        w_max: unknown;
        last_at: Date;
        rep_id: string;
        min_opt_id: string;
        max_opt_id: string;
        total: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        qo.library_group_key AS gkey,
        count(DISTINCT qo.quote_request_id) AS dup_count,
        min(qo.quoted_price) AS q_min,
        max(qo.quoted_price) AS q_max,
        min(qo.weight_chi)  AS w_min,
        max(qo.weight_chi)  AS w_max,
        max(COALESCE(qo.quoted_date, qr.created_at)) AS last_at,
        (array_agg(qo.id ORDER BY COALESCE(qo.quoted_date, qr.created_at) DESC, qo.id DESC))[1] AS rep_id,
        (array_agg(qo.id ORDER BY qo.quoted_price ASC, qo.id))[1]  AS min_opt_id,
        (array_agg(qo.id ORDER BY qo.quoted_price DESC, qo.id))[1] AS max_opt_id,
        count(*) OVER () AS total
      FROM quote_options qo
      JOIN quote_requests qr ON qr.id = qo.quote_request_id
      LEFT JOIN product_categories pc ON pc.id = qr.category_id
      WHERE ${whereSql}
      GROUP BY qo.library_group_key
      ORDER BY ${sortSql}, gkey
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = grpRows.length ? Number(grpRows[0].total) : 0;

    // Hydrate rep + option min/max giá của mỗi nhóm trên trang (dedupe) — ≤ 3×limit dòng.
    const optIds = [
      ...new Set(
        grpRows.flatMap((r) => [r.rep_id, r.min_opt_id, r.max_opt_id]),
      ),
    ];
    const opts = optIds.length ? await this.hydrateLibraryOptions(optIds) : [];
    await this.attachLivePricesToOptions(opts as any[]);
    const optById = new Map((opts as any[]).map((o) => [o.id, o]));

    // Thứ tự thẻ = thứ tự SQL đã sort + phân trang.
    const data = grpRows
      .map((r) => {
        const rep = optById.get(r.rep_id);
        if (!rep) return null;
        return this.buildLibraryCardFromRep(r.gkey, rep, {
          dupCount: Number(r.dup_count),
          qMin: Number(r.q_min) || 0,
          qMax: Number(r.q_max) || 0,
          wMin: r.w_min != null ? Number(r.w_min) : null,
          wMax: r.w_max != null ? Number(r.w_max) : null,
          lastAt: r.last_at,
          liveMin: this.livePriceOf(optById.get(r.min_opt_id)),
          liveMax: this.livePriceOf(optById.get(r.max_opt_id)),
        });
      })
      .filter((c): c is NonNullable<typeof c> => !!c);

    const result = {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
    this.cacheSet(cacheKey, result);
    return result;
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
        // Khóa gộp nhóm (tính sẵn lúc ghi) — dùng để gom option đã hydrate về đúng thẻ.
        libraryGroupKey: true,
        // Cần kim loại gốc để gộp nhóm + đặt tên — OPTION_SUMMARY_SELECT chỉ có id/name của material.
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
            // Lịch sử báo giá ở modal chi tiết cần tên Sale (người tạo) + người báo giá (assignee).
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

  // Kim loại gốc "chủ đạo" của 1 option = baseMetal của material nặng nhất (option 1 chất liệu là
  // thường; hợp kim nhiều chất liệu lấy cái weightChi lớn nhất). null nếu toàn phi kim loại.
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

  // Tên đá CHỦ (MAIN) của 1 option — giữ nguyên tên đầy đủ trong danh mục đá, không cắt bớt.
  // Đá tấm (SIDE) bỏ hẳn: là đá phụ trang trí, không định danh sản phẩm.
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

  // Khóa gộp nhóm tính SẴN lúc ghi option (computeLibraryGroupKey). dominantMaterial() +
  // mainStoneNames() vẫn giữ để build thẻ (tên/chất liệu/đá) từ option đại diện.

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

  // Thẻ sản phẩm từ 1 option ĐẠI DIỆN (mới nhất của nhóm) + số liệu tổng hợp SQL. Nhóm gộp thô
  // (cùng danh mục + kim loại gốc + tập đá MAIN) nên rep đủ để hiện tên/chất liệu/đá. Khoảng giá
  // trên thẻ = giá ĐÃ BÁO (qMin/qMax từ SQL); giá sống chỉ của rep. Lịch sử báo giá (history) KHÔNG
  // nằm trong response này — FE lazy-load qua getLibraryProductHistory khi mở modal.
  // Giá sống đã gắn vào 1 option đã hydrate — null nếu không tính được (thiếu config).
  private livePriceOf(o: any): number | null {
    return o && o.livePrice != null ? Number(o.livePrice) : null;
  }

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
    },
  ) {
    const catName = rep.quoteRequest.category?.name || '';
    const baseMetalName =
      this.dominantMaterial(rep)?.material?.baseMetal?.name || '';
    const stoneNames = [
      ...new Set(this.mainStoneNames(rep)),
    ].sort() as string[];

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
      .sort() as string[];

    // Khoảng giá HÔM NAY: tính live ĐÚNG cho option giá thấp nhất + option giá cao nhất của nhóm
    // (mỗi cái theo config riêng của nó — min/max báo khác ngày, biến động khác nhau). null khi
    // option tương ứng không tính được giá sống.
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
      // Ước lượng khoảng giá hôm nay (xem comment trên) — FE hiện "Hôm nay ~X – Y".
      livePriceMin,
      livePriceMax,
      history: [] as unknown[], // giữ field cho tương thích; nội dung lazy-load riêng
    };
  }

  // 1 dòng lịch sử = 1 đơn báo giá (opts = mọi option của đơn đó thuộc nhóm). Dùng chung bởi
  // getLibraryProductHistory. `price` = giá đã báo (đóng băng); `livePrice` = tính lại hôm nay;
  // `livePriceDeltaPct` = % lệch (BE tính sẵn).
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
      options,
    };
  }

  private libraryTimeRangeCutoff(timeRange: string | undefined): Date | null {
    const now = new Date();
    if (timeRange === 'TODAY')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (timeRange === 'THIS_WEEK') {
      const day = now.getDay() || 7;
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - day + 1,
      );
    }
    if (timeRange === 'THIS_MONTH')
      return new Date(now.getFullYear(), now.getMonth(), 1);
    return null;
  }

  private async attachLivePricesToOptions(options: any[]) {
    const inputs: LivePriceItem[] = [];
    for (const opt of options) {
      if (opt.quotedPrice == null) continue;
      inputs.push({
        key: opt.id,
        materials: (opt.materials || []).map((m: any) => ({
          materialId: m.materialId,
          weightChi: Number(m.weightChi) || 0,
        })),
        laborCost: Number(opt.laborCost) || 0,
        vatRate: opt.vat != null ? Number(opt.vat) : 10,
        stones:
          (opt.stones || []).length > 0
            ? opt.stones.map((s: any) => ({
                stoneId: s.stoneId,
                quantity: s.quantity,
              }))
            : undefined,
        manualStoneCost: Number(opt.stoneCost) || 0,
      });
    }
    if (inputs.length === 0) return;
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    for (const opt of options) {
      if (priceMap.has(opt.id)) opt.livePrice = priceMap.get(opt.id);
    }
  }

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const cacheKey = JSON.stringify({
      filterDto,
      userId: _user?.id,
      role: _user?.role,
    });
    // withLivePrice=true là nút "Tải lại giá" bấm tay — phải luôn tính lại giá MỚI NHẤT, cache
    // 30s ở đây sẽ trả nhầm giá cũ nếu bấm lại trong vòng 30s sau khi vừa đổi giá kim loại/đá.
    const skipCache = filterDto.withLivePrice === 'true';
    const cached = skipCache ? undefined : this.cacheGet(cacheKey);
    if (cached) return cached;

    const { page = 1, limit = 10 } = filterDto;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = buildQuoteWhereClause(filterDto, _user);
    // Counts phải bỏ status filter — nếu không, groupBy chỉ còn đúng status đang chọn,
    // các ô trạng thái khác trên UI sẽ hiện 0 hết.
    const countsWhere = buildQuoteWhereClause(
      { ...filterDto, status: undefined },
      _user,
    );

    const countsPromise = Promise.all([
      this.prisma.quoteRequest.groupBy({
        by: ['status'],
        where: countsWhere,
        _count: { _all: true },
      }),
      getMyReqCount(this.prisma, _user),
    ]).then(([res, myReqCnt]) => countsFromGroupBy(res, myReqCnt));

    // Dashboard fetch 500 dòng chỉ để vẽ biểu đồ/thống kê — không cần customer/assignee/options
    // (quan hệ nặng nhất, không dùng tới), bỏ luôn cho nhẹ query.
    const isLite = filterDto.lite === 'true';

    const [items, total, counts] = await Promise.all([
      this.prisma.quoteRequest.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          code: true,
          desiredLeadTime: true,
          customerMeasurements: true,
          closeRatePct: true,
          status: true,
          rejectReason: true,
          returnReason: true,
          acceptedAt: true,
          returnedAt: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          videoUrl: true,
          customerId: true,
          categoryId: true,
          requesterId: true,
          assigneeId: true,
          category: { select: { id: true, name: true, vatRate: true } },
          requester: {
            select: {
              id: true,
              name: true,
              email: true,
              department: { select: { id: true, name: true } },
            },
          },
          images: {
            select: { id: true, imageUrl: true },
            orderBy: { id: 'asc' },
          },
          ...(isLite
            ? {
                // Lấy option MỚI NHẤT (không phải cũ nhất) — option đầu tiên luôn là bản nháp
                // rỗng "Yêu cầu ban đầu", lấy createdAt asc + take:1 sẽ luôn ra option chưa có giá.
                options: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: OPTION_SUMMARY_SELECT,
                },
              }
            : {
                options: {
                  orderBy: { createdAt: 'asc' },
                  select: OPTION_SUMMARY_SELECT,
                },
                customer: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    address: true,
                    province: true,
                    ward: true,
                  },
                },
                assignee: { select: { id: true, name: true, email: true } },
              }),
        },
      }),
      this.prisma.quoteRequest.count({ where }),
      countsPromise,
    ]);

    if (items.length === 0) {
      return {
        data: [],
        meta: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
          counts,
        },
      };
    }

    const sanitizedItems = items.map((item: any) => this.sanitizeItem(item));

    if (filterDto.withLivePrice === 'true' && !isLite) {
      // Phải tính giá sống TRƯỚC khi ẩn field giá vốn — attachLivePrices cần đọc laborCost/
      // stoneCost của chính option đó để tính lại giá, ẩn trước thì Sale mở Thư Viện Sản Phẩm sẽ
      // luôn ra null.
      await this.attachLivePrices(sanitizedItems);
    }

    // Sale chỉ được xem Giá bán — không được thấy cấu thành giá (giá vốn kim loại/tiền công/giá
    // đá), giống chính sách đã áp dụng ở quote-options.controller cho luồng tính giá. Ẩn ở tầng
    // service (không phải chỉ FE) vì đây là dữ liệu nghiệp vụ nhạy cảm nhất hệ thống.
    if (_user?.role === Role.SALE) {
      for (const item of sanitizedItems) {
        item.options = this.stripCostFieldsForSale(item.options);
      }
    }

    const totalPages = Math.ceil(total / limitNum) || 1;

    const result = {
      data: sanitizedItems,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        counts,
      },
    };

    if (!skipCache) {
      this.cacheSet(cacheKey, result);
    }
    return result;
  }

  // Gắn giá "sống" (livePrice) vào từng option — tính theo config HIỆN TẠI (giá kim loại/đá/tỷ lệ/
  // VAT hôm nay), không đụng quotedPrice đã đóng băng. 1 lệnh gọi cho cả trang, 0 query DB thêm
  // (batchComputeLivePrices tự lấy giá kim loại/chất liệu/đá từ cache TTL sẵn có).
  private async attachLivePrices(items: any[]) {
    const inputs: LivePriceItem[] = [];
    for (const item of items) {
      const categoryVat =
        item.category?.vatRate != null ? Number(item.category.vatRate) : null;
      for (const opt of item.options || []) {
        if (opt.quotedPrice == null) continue;
        inputs.push({
          key: opt.id,
          materials: (opt.materials || []).map((m: any) => ({
            materialId: m.materialId,
            weightChi: Number(m.weightChi) || 0,
          })),
          laborCost: Number(opt.laborCost) || 0,
          vatRate: categoryVat ?? (opt.vat != null ? Number(opt.vat) : 10),
          stones:
            (opt.stones || []).length > 0
              ? opt.stones.map((s: any) => ({
                  stoneId: s.stoneId,
                  quantity: s.quantity,
                }))
              : undefined,
          manualStoneCost: Number(opt.stoneCost) || 0,
        });
      }
    }
    if (inputs.length === 0) return;
    // Batch tính giá sống cho cả trang, tránh query DB nhiều lần (1 option = 1 query) — batchComputeLivePrices
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    for (const item of items) {
      for (const opt of item.options || []) {
        if (priceMap.has(opt.id)) opt.livePrice = priceMap.get(opt.id);
      }
    }
  }

  // Cắt field cấu thành giá vốn khỏi từng option — Sale chỉ được xem quotedPrice (giá bán), không
  // được thấy laborCost/stoneCost/totalMetalCost/metalRawCost/stonePrice. Public vì
  // QuoteWorkflowService (accept/markClosed/selectOption/resubmit...) cũng trả trực tiếp
  // mapQuoteRequestDetail() cho các action Sale được phép gọi, cần lọc lại y hệt ở đây.
  stripCostFieldsForSale(options: any[] | undefined) {
    if (!options) return options;
    return options.map((opt: any) => {
      const {
        laborCost,
        stoneCost,
        totalMetalCost,
        metalRawCost,
        stonePrice,
        ...rest
      } = opt;
      return rest;
    });
  }

  private sanitizeItem(item: any) {
    const primaryOption = pickPrimaryOption(item);
    const matArr = (primaryOption?.materials || []).map((m: any) => m.material);
    const dynamicProductName = buildProductName(
      item.category?.name,
      matArr.map((m: any) => m.name),
    );

    return {
      ...item,
      productName: dynamicProductName,
      material: matArr[0] || null,
      materials: matArr,
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
      images: (item.images || []).map((img: any) => ({
        ...img,
        imageUrl: img.imageUrl.startsWith('data:image')
          ? 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=500&auto=format&fit=crop&q=60'
          : img.imageUrl,
      })),
    };
  }

  /**
   * Lấy toàn bộ danh sách theo bộ lọc (không phân trang, không cache) — dùng cho export Excel.
   * Chặn trần MAX_EXPORT_ROWS để tránh kéo quá nhiều dòng cùng lúc.
   */
  async findAllForExport(filterDto: FilterQuoteRequestDto, user: User) {
    const where = buildQuoteWhereClause(filterDto, user);

    const items = await this.prisma.quoteRequest.findMany({
      where,
      take: APP_CONSTANTS.MAX_EXPORT_ROWS,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        desiredLeadTime: true,
        customerMeasurements: true,
        closeRatePct: true,
        status: true,
        rejectReason: true,
        returnReason: true,
        acceptedAt: true,
        returnedAt: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
            department: { select: { id: true, name: true } },
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            province: true,
            ward: true,
          },
        },
        assignee: { select: { id: true, name: true, email: true } },
        images: { select: { id: true, imageUrl: true }, take: 1 },
        options: {
          orderBy: { createdAt: 'asc' },
          select: {
            quotedPrice: true,
            vat: true,
            quotedDate: true,
            selectionStatus: true,
            materials: {
              select: { material: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    return items.map((item: any) => this.sanitizeItem(item));
  }

  async findOne(idOrCode: string, role?: Role) {
    const quote = await this.prisma.quoteRequest.findFirst({
      where: {
        OR: [{ id: idOrCode }, { code: idOrCode }],
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    const mapped = mapQuoteRequestDetail(quote);
    // Sale chỉ được xem Giá bán — không được thấy cấu thành giá vốn (xem thêm comment ở findAll).
    if (role === Role.SALE) {
      mapped.options = this.stripCostFieldsForSale(mapped.options);
    }

    const primaryOption = pickPrimaryOption(mapped);
    const matArr = primaryOption?.materials || [];
    const dynamicProductName = buildProductName(
      mapped.category?.name,
      matArr.map((m: any) => m.materialName),
    );

    return {
      ...mapped,
      material: matArr[0]
        ? { id: matArr[0].materialId, name: matArr[0].materialName }
        : null,
      productName: dynamicProductName,
      // QuoteRequest không có cột quotedPrice riêng (giá nằm ở QuoteOption) — bổ sung field cấp
      // ngoài cho FE, khớp với findAll(). Thiếu field này khiến F5 trực tiếp trang chi tiết luôn
      // hiện "Chưa có giá chốt" dù đã có phương án báo giá thật.
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
    };
  }
}
