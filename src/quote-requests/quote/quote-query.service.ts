import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilterQuoteRequestDto } from '../dto/filter-quote-request.dto';
import { User, Role } from '@prisma/client';
import { APP_CONSTANTS } from '../../common/constants';
import {
  REQUEST_DETAIL_INCLUDE,
  OPTION_LIST_SELECT,
  mapQuoteRequestDetail,
  pickPrimaryOption,
  attachPriceBreakdowns,
} from '../../utils/option-mapper.util';
import { buildQuoteWhereClause } from '../../utils/quote-filter.util';
import {
  countsFromGroupBy,
  getMyReqCount,
} from '../../utils/quote-counts.util';

// Read path CHÍNH của yêu cầu báo giá: danh sách (findAll, có counts), chi tiết (findOne), và
// export Excel (findAllForExport). Thư Viện Sản Phẩm đã tách hẳn sang LibraryService (dữ liệu lịch
// sử + giá sống, query rất khác). Không cache RAM — mọi lần đọc query thẳng DB.
@Injectable()
export class QuoteQueryService {
  constructor(private prisma: PrismaService) {}

  async findAll(filterDto: FilterQuoteRequestDto, _user: User) {
    const { page = 1, limit = 10 } = filterDto;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = buildQuoteWhereClause(filterDto, _user);

    // Counts sidebar = 2 query thêm (groupBy status + count MY_REQ). Chỉ tính khi FE xin
    // (includeCounts=true) — phân trang thuần và socket refresh không đổi bộ lọc thì FE giữ counts
    // cũ, khỏi mượn 2 connection mỗi lần. FE gửi flag khi: lần đầu, đổi bộ lọc, hoặc socket refresh.
    // countsWhere bỏ status filter — nếu không, groupBy chỉ còn đúng status đang chọn, các ô trạng
    // thái khác trên UI sẽ hiện 0 hết.
    const wantCounts = filterDto.includeCounts === 'true';
    const countsPromise = wantCounts
      ? Promise.all([
          this.prisma.quoteRequest.groupBy({
            by: ['status'],
            where: buildQuoteWhereClause(
              { ...filterDto, status: undefined },
              _user,
            ),
            _count: { _all: true },
          }),
          getMyReqCount(this.prisma, _user),
        ]).then(([res, myReqCnt]) => countsFromGroupBy(res, myReqCnt))
      : Promise.resolve(undefined);

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
          productName: true,
          productCode: true,
          desiredLeadTime: true,
          customerMeasurements: true,
          note: true,
          closeRatePct: true,
          inspectionFee: true,
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
          assignedOrderId: true,
          departmentId: true,
          department: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, vatRate: true } },
          requester: {
            select: {
              id: true,
              name: true,
              email: true,
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
                  select: OPTION_LIST_SELECT,
                },
              }
            : {
                options: {
                  orderBy: { createdAt: 'asc' },
                  select: OPTION_LIST_SELECT,
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
                // Cột "Người được giao" (tự chia đều lúc tạo đơn) — khác assignee ở trên.
                assignedOrder: {
                  select: { id: true, name: true, email: true },
                },
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
      // materials[].rawCost = giá vốn thô riêng từng kim loại — cùng nhóm giá vốn, cắt luôn.
      if (Array.isArray(rest.materials)) {
        rest.materials = rest.materials.map((m: any) => {
          const { rawCost, ...restMat } = m;
          return restMat;
        });
      }
      return rest;
    });
  }

  private sanitizeItem(item: any) {
    const primaryOption = pickPrimaryOption(item);
    const matArr = (primaryOption?.materials || []).map((m: any) => m.material);

    if (Array.isArray(item.options))
      item.options = item.options.map((o: any) => attachPriceBreakdowns(o));

    return {
      ...item,
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
        productName: true,
        productCode: true,
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
        department: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        requester: {
          select: {
            id: true,
            name: true,
            email: true,
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
        assignedOrder: { select: { id: true, name: true, email: true } },
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

    return {
      ...mapped,
      material: matArr[0]
        ? { id: matArr[0].materialId, name: matArr[0].materialName }
        : null,
      // QuoteRequest không có cột quotedPrice riêng (giá nằm ở QuoteOption) — bổ sung field cấp
      // ngoài cho FE, khớp với findAll(). Thiếu field này khiến F5 trực tiếp trang chi tiết luôn
      // hiện "Chưa có giá chốt" dù đã có phương án báo giá thật.
      quotedPrice: primaryOption?.quotedPrice ?? null,
      vat: primaryOption?.vat ?? null,
      quotedDate: primaryOption?.quotedDate ?? null,
    };
  }
}
