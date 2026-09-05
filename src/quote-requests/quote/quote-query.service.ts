import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilterQuoteRequestDto } from '../dto/filter-quote-request.dto';
import { User, Role } from '@prisma/client';
import { APP_CONSTANTS } from '../../common/constants';
import {
  REQUEST_DETAIL_INCLUDE,
  OPTION_SUMMARY_SELECT,
  mapQuoteRequestDetail,
  pickPrimaryOption,
  buildProductName,
  attachPriceBreakdowns,
  toLivePriceInput,
  applyLivePriceMap,
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

// Read path CHÍNH của yêu cầu báo giá: danh sách (findAll, có counts + giá sống), chi tiết
// (findOne), và export Excel (findAllForExport). Thư Viện Sản Phẩm đã tách hẳn sang LibraryService
// (dữ liệu lịch sử, query gộp nhóm rất khác). Không cache RAM — mọi lần đọc query thẳng DB.
@Injectable()
export class QuoteQueryService {
  constructor(
    private prisma: PrismaService,
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
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
      // attachPriceBreakdowns (trong sanitizeItem) đã chạy TRƯỚC bước này nên livePriceBreakdown
      // chưa populate — gắn lại sau khi đã có livePrice/liveStonePrice trên option.
      for (const item of sanitizedItems) {
        for (const o of item.options || []) attachPriceBreakdowns(o);
      }
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

    return result;
  }

  // Gắn giá "sống" (livePrice) vào từng option — tính theo config HIỆN TẠI (giá kim loại/đá/tỷ lệ/
  // VAT hôm nay), không đụng quotedPrice đã đóng băng. 1 lệnh gọi cho cả trang
  // (batchComputeLivePrices tự lấy giá kim loại/chất liệu/đá).
  private async attachLivePrices(items: any[]) {
    const inputs: LivePriceItem[] = [];
    const allOpts: any[] = [];
    for (const item of items) {
      const categoryVat =
        item.category?.vatRate != null ? Number(item.category.vatRate) : null;
      for (const opt of item.options || []) {
        allOpts.push(opt);
        if (opt.quotedPrice == null) continue;
        inputs.push(toLivePriceInput(opt, categoryVat));
      }
    }
    if (inputs.length === 0) return;
    // Batch tính giá sống cho cả trang, tránh query DB nhiều lần (1 option = 1 query).
    const priceMap =
      await this.quoteOptionsService.batchComputeLivePrices(inputs);
    applyLivePriceMap(allOpts, priceMap);
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
        // costBreakdown = cấu thành lãi/VAT giá vốn — SALE không được thấy.
        costBreakdown,
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

    if (Array.isArray(item.options))
      item.options = item.options.map((o: any) => attachPriceBreakdowns(o));

    return {
      ...item,
      productName: dynamicProductName,
      material: matArr[0] || null,
      materials: matArr,
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
      // Bản ghi cũ có thể lưu nguyên chuỗi base64 (data:...) thay vì link Cloudinary — lọc bỏ hẳn
      // khỏi response (trước đây thay bằng 1 URL Unsplash hardcode, gây hiển thị sai sản phẩm).
      // Luồng tạo/sửa yêu cầu giờ đã chặn không cho data: lọt vào DB nữa.
      images: (item.images || []).filter(
        (img: any) => !String(img?.imageUrl || '').startsWith('data:'),
      ),
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
            stonePrice: true,
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

    return items.map((item: any) => {
      const primaryOption = pickPrimaryOption(item);
      return {
        ...this.sanitizeItem(item),
        stonePrice: primaryOption?.stonePrice ?? null,
      };
    });
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
