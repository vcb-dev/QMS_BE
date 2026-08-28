import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateQuoteStatusDto,
  QuoteAction,
} from '../dto/update-quote-status.dto';
import { CompleteQuoteInput } from '../dto/quote-complete.dto';
import { randomUUID } from 'node:crypto';
import { QuoteStatus, Role, OptionSelectionStatus } from '@prisma/client';
import { QuoteQueryService } from './quote-query.service';
import { MailService } from '../../mail/mail.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { LarkNotificationService } from '../../lark/lark-notification.service';
import { QuoteOptionsService } from '../quote-option/quote-options.service';
import {
  REQUEST_DETAIL_INCLUDE,
  buildOptionCreateInput,
  mapQuoteRequestDetail,
  pickPrimaryOption,
} from '../../utils/option-mapper.util';

@Injectable()
export class QuoteWorkflowService {
  constructor(
    private prisma: PrismaService,
    private queryService: QuoteQueryService,
    private mailService: MailService,
    private auditLog: AuditLogService,
    private larkService: LarkNotificationService,
    private quoteOptionsService: QuoteOptionsService,
  ) {}

  private assertRole(role: Role, allowed: Role[], message: string) {
    if (!allowed.includes(role)) {
      throw new ForbiddenException(message);
    }
  }

  // finalOptionId/finalPrice trên QuoteRequest được DB tự đồng bộ bằng trigger
  // (sync_final_option(), migration 20260826_final_option_db_trigger) ngay khi quote_options
  // thay đổi — không cần gọi lại từ app nữa.

  /**
   * Order tiếp nhận yêu cầu báo giá từ Sale.
   * Trạng thái chuyển từ PENDING -> PROCESSING và gán người xử lý (assigneeId).
   */
  private async accept(id: string, userId: string) {
    this.queryService.clearCache();
    const result = await this.prisma.quoteRequest.updateMany({
      where: { id, status: QuoteStatus.PENDING },
      data: {
        status: QuoteStatus.PROCESSING,
        assigneeId: userId,
        acceptedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new ConflictException(
        'Yêu cầu này đã được tiếp nhận bởi nhân sự khác',
      );
    }

    return this.queryService.findOne(id);
  }

  private async assertPricingCanProcess(
    id: string,
    userId: string,
    role: Role,
  ) {
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: { status: true, assigneeId: true },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status !== QuoteStatus.PROCESSING) {
      throw new ConflictException(
        'Yêu cầu phải đang được xử lý trước khi thực hiện thao tác này',
      );
    }

    if (role === Role.ORDER && quote.assigneeId !== userId) {
      throw new ForbiddenException(
        'Bạn chỉ được thao tác trên yêu cầu do mình tiếp nhận xử lý',
      );
    }
  }

  private pickProductName(quote: any): string {
    return quote.category?.name || 'Sản phẩm chế tác';
  }

  private notifySale(
    quote: any,
    send: (
      to: string,
      name: string,
      code: string,
      ...rest: any[]
    ) => Promise<any>,
    ...rest: any[]
  ) {
    if (!quote?.requester?.email) return;
    send(
      quote.requester.email,
      quote.requester.name || 'NVKD',
      quote.code,
      ...rest,
    ).catch(() => {});
  }

  private notifySaleQuoteCompleted(quote: any) {
    const price = Number(pickPrimaryOption(quote)?.quotedPrice || 0);
    this.notifySale(
      quote,
      this.mailService.sendQuoteCompleted.bind(this.mailService),
      price,
      this.pickProductName(quote),
    );
    this.larkService.notifySale(
      `✅ Đơn ${quote.code} (${this.pickProductName(quote)}) đã có giá: ${price.toLocaleString('vi-VN')}đ`,
      quote.id,
    );
  }

  private notifySaleQuoteRejected(quote: any, reason: string) {
    this.notifySale(
      quote,
      this.mailService.sendQuoteRejected.bind(this.mailService),
      this.pickProductName(quote),
      reason,
    );
    this.larkService.notifySale(
      `❌ Đơn ${quote.code} (${this.pickProductName(quote)}) bị từ chối: ${reason}`,
      quote.id,
    );
  }

  private notifySaleNeedMoreInfo(quote: any, reason: string) {
    this.notifySale(
      quote,
      this.mailService.sendNeedMoreInfo.bind(this.mailService),
      this.pickProductName(quote),
      reason,
    );
    this.larkService.notifySale(
      `⚠️ Đơn ${quote.code} (${this.pickProductName(quote)}) cần bổ sung thông tin: ${reason}`,
      quote.id,
    );
  }

  /**
   * Hoàn thành việc tính toán báo giá.
   * Cập nhật giá trị cho các phương án (options) và chuyển trạng thái sang QUOTED.
   * Gửi email và thông báo cho Sale qua hệ thống.
   */
  private async completeQuote(
    id: string,
    userId: string,
    dto: CompleteQuoteInput,
  ) {
    this.queryService.clearCache();

    // FE luôn gửi kèm options đầy đủ (mỗi phương án tự mang materials/stones riêng) —
    const existing = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: { categoryId: true },
    });

    const opts = dto.options ?? [];

    const [stonePriceMap, keyMaps] =
      opts.length > 0
        ? await Promise.all([
            this.quoteOptionsService.buildStonePriceMap(opts),
            this.quoteOptionsService.buildLibraryKeyMaps(opts),
          ])
        : [new Map<string, number>(), undefined];

    if (opts.length === 0) {
      const updatedNoOpts = await this.prisma.quoteRequest.update({
        where: { id },
        data: { status: QuoteStatus.QUOTED, assigneeId: userId },
        include: REQUEST_DETAIL_INCLUDE,
      });
      const mappedNoOpts = mapQuoteRequestDetail(updatedNoOpts);
      this.notifySaleQuoteCompleted(mappedNoOpts);
      return mappedNoOpts;
    }

    // Ghi options bằng createMany PHẲNG (tối đa 3 câu INSERT cho cả lô) thay vì nested-create của
    // Prisma — nested-create bắn 1 INSERT cho MỖI option + MỖI material/stone, chậm rõ khi qua
    // pooler (mỗi statement kèm BEGIN/DEALLOCATE ALL/COMMIT). Tự sinh id để gắn material/stone vào
    // đúng option mà không phải chờ từng INSERT trả id về.
    const base = Date.now();
    const optionWrites = opts.map((opt, idx) => {
      const built: any = buildOptionCreateInput(
        opt,
        idx,
        existing?.categoryId,
        stonePriceMap,
        keyMaps,
      );
      delete built.materials;
      delete built.stones;
      const optionId = randomUUID();
      built.id = optionId;
      built.quoteRequestId = id;
      // createdAt cách nhau 1ms theo idx — REQUEST_DETAIL_INCLUDE orderBy createdAt asc, giữ đúng
      // thứ tự "Phương án 1/2/3..." (createMany để now() giống nhau cho mọi row nếu không set).
      built.createdAt = new Date(base + idx);
      return { id: optionId, row: built, opt };
    });

    const materialRows = optionWrites.flatMap(({ id: optionId, opt }) =>
      (opt.materials ?? []).map((m: any) => ({
        optionId,
        materialId: m.materialId,
        weightChi: m.weightChi != null ? m.weightChi : opt.weightChi,
      })),
    );
    const stoneRows = optionWrites.flatMap(({ id: optionId, opt }) =>
      (opt.stones ?? []).map((s: any) => ({
        optionId,
        stoneId: s.stoneId,
        quantity: s.quantity,
        unitPriceAtQuote: stonePriceMap.get(s.stoneId),
      })),
    );

    await this.prisma.$transaction([
      this.prisma.quoteOption.deleteMany({ where: { quoteRequestId: id } }),
      this.prisma.quoteRequest.update({
        where: { id },
        data: { status: QuoteStatus.QUOTED, assigneeId: userId },
      }),
      this.prisma.quoteOption.createMany({
        data: optionWrites.map((w) => w.row),
      }),
      ...(materialRows.length > 0
        ? [this.prisma.quoteOptionMaterial.createMany({ data: materialRows })]
        : []),
      ...(stoneRows.length > 0
        ? [this.prisma.quoteOptionStone.createMany({ data: stoneRows })]
        : []),
    ]);

    const updated = await this.prisma.quoteRequest.findUniqueOrThrow({
      where: { id },
      include: REQUEST_DETAIL_INCLUDE,
    });

    const mapped = mapQuoteRequestDetail(updated);
    this.notifySaleQuoteCompleted(mapped);
    return mapped;
  }

  private async selectOption(id: string, optionId: string, role: Role) {
    this.queryService.clearCache();
    const option = await this.prisma.quoteOption.findUnique({
      where: { id: optionId },
    });

    if (!option || option.quoteRequestId !== id) {
      throw new NotFoundException('Không tìm thấy phương án báo giá tương ứng');
    }

    await this.prisma.$transaction([
      this.prisma.quoteOption.updateMany({
        where: { quoteRequestId: id },
        data: { selectionStatus: OptionSelectionStatus.NONE },
      }),
      this.prisma.quoteOption.update({
        where: { id: optionId },
        data: { selectionStatus: OptionSelectionStatus.SELECTED },
      }),
    ]);
    return this.queryService.findOne(id, role);
  }

  /**
   * Từ chối báo giá (Order quyết định không nhận làm).
   * Yêu cầu phải có lý do từ chối. Trạng thái chuyển sang REJECTED.
   */
  private async rejectQuote(id: string, userId: string, rejectReason: string) {
    this.queryService.clearCache();
    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        rejectReason,
        assigneeId: userId,
        status: QuoteStatus.REJECTED,
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    const mapped = mapQuoteRequestDetail(updated);
    this.notifySaleQuoteRejected(mapped, rejectReason);
    return mapped;
  }

  /**
   * Trả lại yêu cầu cho Sale để bổ sung thông tin.
   * Trạng thái chuyển sang NEED_MORE_INFO kèm theo lý do cần bổ sung.
   */
  private async returnQuote(id: string, userId: string, returnReason: string) {
    this.queryService.clearCache();
    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        returnReason,
        assigneeId: userId,
        status: QuoteStatus.NEED_MORE_INFO,
        returnedAt: new Date(),
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    const mapped = mapQuoteRequestDetail(updated);
    this.notifySaleNeedMoreInfo(mapped, returnReason);
    return mapped;
  }

  /**
   * Đánh dấu đơn hàng là đã chốt (Khách đồng ý mua).
   * Yêu cầu phải chọn 1 phương án cuối cùng (optionId) mà khách đã chọn.
   */
  private async markClosed(id: string, role: Role, optionId?: string) {
    this.queryService.clearCache();
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: {
        status: true,
        options: {
          select: { id: true, quotedPrice: true, selectionStatus: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status !== QuoteStatus.QUOTED) {
      throw new ConflictException(
        'Chỉ đánh dấu Đã chốt được khi yêu cầu đã có báo giá (QUOTED)',
      );
    }

    // Sale chỉ chọn phương án cuối cùng trên UI (không gọi API riêng khi bấm từng thẻ) —
    // phương án được chọn chỉ ghi xuống DB cùng lúc với hành động "Đánh Dấu Đã Chốt".
    // FE không phải lúc nào cũng gửi optionId (VD: chỉ có 1 phương án, Sale không cần bấm chọn) —
    // tự suy ra phương án đại diện bằng pickPrimaryOption, không được để selectionStatus đứng yên.
    const targetOptionId = optionId || pickPrimaryOption(quote)?.id;

    if (targetOptionId) {
      const target = quote.options.find((o) => o.id === targetOptionId);
      if (!target) {
        throw new NotFoundException(
          'Không tìm thấy phương án báo giá tương ứng',
        );
      }
      await this.prisma.$transaction([
        this.prisma.quoteOption.updateMany({
          where: { quoteRequestId: id },
          data: { selectionStatus: OptionSelectionStatus.NONE },
        }),
        this.prisma.quoteOption.update({
          where: { id: targetOptionId },
          data: { selectionStatus: OptionSelectionStatus.CLOSED },
        }),
      ]);
    }

    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.CLOSED,
      },
      include: REQUEST_DETAIL_INCLUDE,
    });
    const mapped = mapQuoteRequestDetail(updated);
    // Sale gọi được action này — không được thấy cấu thành giá vốn trong response trả về.
    if (role === Role.SALE) {
      mapped.options = this.queryService.stripCostFieldsForSale(mapped.options);
    }
    return mapped;
  }

  // ORDER/ADMIN xóa 1 phương án báo giá không muốn đề xuất nữa (VD: nhập nhầm, hoặc phương án
  // quá cao/thấp không đáng để Sale cân nhắc) — chỉ trong lúc request còn đang xử lý, và luôn phải
  // giữ lại ít nhất 1 phương án để request còn có giá để hiển thị.
  async deleteOption(
    requestId: string,
    optionId: string,
    userId: string,
    role: Role,
  ) {
    this.assertRole(
      role,
      [Role.ORDER, Role.ADMIN],
      'Chỉ có vai trò ORDER hoặc ADMIN mới được phép xóa phương án báo giá',
    );
    this.queryService.clearCache();

    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        options: { select: { id: true } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status === QuoteStatus.CLOSED) {
      throw new ConflictException(
        'Yêu cầu đã chốt, không thể xóa phương án báo giá',
      );
    }

    const target = quote.options.find((o) => o.id === optionId);
    if (!target) {
      throw new NotFoundException('Không tìm thấy phương án báo giá tương ứng');
    }

    if (quote.options.length <= 1) {
      throw new ConflictException('Phải giữ lại ít nhất 1 phương án báo giá');
    }

    await this.prisma.quoteOption.delete({ where: { id: optionId } });
    await this.auditLog.logAction(
      userId,
      role,
      'DELETE_QUOTE_OPTION',
      'QuoteRequest',
      requestId,
    );

    const updated = await this.prisma.quoteRequest.findUnique({
      where: { id: requestId },
      include: REQUEST_DETAIL_INCLUDE,
    });
    return mapQuoteRequestDetail(updated);
  }

  /**
   * Sale gửi lại yêu cầu sau khi đã bổ sung đủ thông tin.
   * Reset lại trạng thái về PENDING để Order tiếp nhận lại từ đầu.
   */
  private async resubmitQuote(id: string, role: Role) {
    this.queryService.clearCache();
    const curent = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!curent) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (curent.status !== QuoteStatus.NEED_MORE_INFO) {
      throw new ConflictException(
        'Chỉ có thể gửi lại yêu cầu khi đang ở trạng thái Cần bổ sung thông tin',
      );
    }
    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.PENDING,
        assigneeId: null,
        version: { increment: 1 },
      },
      include: REQUEST_DETAIL_INCLUDE,
    });
    const mapped = mapQuoteRequestDetail(updated);
    this.larkService.notifyOrder(
      ` Đơn ${mapped.code} (${this.pickProductName(mapped)}) đã được gửi lại, cần xử lý`,
      mapped.id,
    );
    // Sale gọi được action này — không được thấy cấu thành giá vốn trong response trả về.
    if (role === Role.SALE) {
      mapped.options = this.queryService.stripCostFieldsForSale(mapped.options);
    }
    return mapped;
  }

  async updateStatus(
    id: string,
    userId: string,
    role: Role,
    dto: UpdateQuoteStatusDto,
  ) {
    switch (dto.action) {
      case QuoteAction.ACCEPT:
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép tiếp nhận yêu cầu',
        );
        await this.auditLog.logAction(
          userId,
          role,
          'ACCEPT_QUOTE',
          'QuoteRequest',
          id,
        );
        return this.accept(id, userId);

      case QuoteAction.QUOTE: {
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép báo giá',
        );
        const hasPrice = dto.options?.some((o) => o.quotedPrice != null);
        if (!hasPrice) {
          throw new BadRequestException(
            'Vui lòng nhập giá sản phẩm cho ít nhất 1 phương án (options[].quotedPrice)',
          );
        }
        await this.assertPricingCanProcess(id, userId, role);
        // Fire-and-forget — không chặn phản hồi bằng 1 INSERT audit_logs qua pooler (~0.8s cộng
        // thẳng vào thời gian bấm "Xác Nhận & Gửi Báo Giá"). logAction tự nuốt lỗi.
        void this.auditLog.logAction(
          userId,
          role,
          'QUOTE_PRICE',
          'QuoteRequest',
          id,
        );
        return this.completeQuote(id, userId, { options: dto.options! });
      }

      case QuoteAction.QUICK_QUOTE: {
        this.queryService.clearCache();
        await this.auditLog.logAction(
          userId,
          role,
          'QUICK_QUOTE',
          'QuoteRequest',
          id,
        );
        const existing = await this.prisma.quoteRequest.findUnique({
          where: { id },
          select: { categoryId: true },
        });
        const quickQuoteKeyMaps = dto.options?.length
          ? await this.quoteOptionsService.buildLibraryKeyMaps(dto.options)
          : undefined;
        const updated = await this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.PROCESSING,
            options:
              dto.options && dto.options.length > 0
                ? {
                    deleteMany: {},
                    create: dto.options.map((opt, idx) =>
                      buildOptionCreateInput(
                        opt,
                        idx,
                        existing?.categoryId,
                        undefined,
                        quickQuoteKeyMaps,
                      ),
                    ),
                  }
                : undefined,
          },
          include: REQUEST_DETAIL_INCLUDE,
        });
        return mapQuoteRequestDetail(updated);
      }

      case QuoteAction.QUICK_APPROVE: {
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép duyệt báo giá nhanh',
        );
        this.queryService.clearCache();
        await this.auditLog.logAction(
          userId,
          role,
          'QUICK_APPROVE',
          'QuoteRequest',
          id,
        );

        const existingReq = await this.prisma.quoteRequest.findUnique({
          where: { id },
          select: { categoryId: true, _count: { select: { options: true } } },
        });
        if (!existingReq) {
          throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
        }
        if (
          existingReq._count.options === 0 &&
          (!dto.options || dto.options.length === 0)
        ) {
          throw new BadRequestException(
            'Vui lòng nhập giá sản phẩm (options[].quotedPrice) trước khi duyệt',
          );
        }

        const quickApproveKeyMaps = dto.options?.length
          ? await this.quoteOptionsService.buildLibraryKeyMaps(dto.options)
          : undefined;
        const approved = await this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.QUOTED,
            assigneeId: userId,
            options:
              dto.options && dto.options.length > 0
                ? {
                    deleteMany: {},
                    create: dto.options.map((opt, idx) =>
                      buildOptionCreateInput(
                        opt,
                        idx,
                        existingReq.categoryId,
                        undefined,
                        quickApproveKeyMaps,
                      ),
                    ),
                  }
                : undefined,
          },
          include: REQUEST_DETAIL_INCLUDE,
        });
        const mapped = mapQuoteRequestDetail(approved);
        this.notifySaleQuoteCompleted(mapped);
        return mapped;
      }

      case QuoteAction.QUICK_REJECT:
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép từ chối báo giá nhanh',
        );
        this.queryService.clearCache();
        await this.auditLog.logAction(
          userId,
          role,
          'QUICK_REJECT',
          'QuoteRequest',
          id,
        );
        return this.rejectQuote(
          id,
          userId,
          dto.rejectReason || 'Không đồng ý với báo giá nhanh này',
        );

      case QuoteAction.REJECT:
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép từ chối yêu cầu',
        );
        if (!dto.rejectReason) {
          throw new BadRequestException(
            'Vui lòng nhập lý do từ chối (rejectReason)',
          );
        }
        await this.assertPricingCanProcess(id, userId, role);
        await this.auditLog.logAction(
          userId,
          role,
          'REJECT_QUOTE',
          'QuoteRequest',
          id,
        );
        return this.rejectQuote(id, userId, dto.rejectReason);

      case QuoteAction.RETURN:
        this.assertRole(
          role,
          [Role.ORDER, Role.ADMIN],
          'Chỉ có vai trò ORDER hoặc ADMIN mới được phép trả lại yêu cầu',
        );
        if (!dto.returnReason) {
          throw new BadRequestException(
            'Vui lòng nhập lý do cần bổ sung (returnReason)',
          );
        }
        await this.assertPricingCanProcess(id, userId, role);
        await this.auditLog.logAction(
          userId,
          role,
          'RETURN_QUOTE',
          'QuoteRequest',
          id,
        );
        return this.returnQuote(id, userId, dto.returnReason);

      case QuoteAction.RESUBMIT:
        this.assertRole(
          role,
          [Role.SALE, Role.ADMIN],
          'Chỉ có vai trò SALE hoặc ADMIN mới được phép gửi lại yêu cầu',
        );
        await this.auditLog.logAction(
          userId,
          role,
          'RESUBMIT_QUOTE',
          'QuoteRequest',
          id,
        );
        return this.resubmitQuote(id, role);

      case QuoteAction.MARK_CLOSED:
        this.assertRole(
          role,
          [Role.SALE, Role.ADMIN],
          'Chỉ có vai trò SALE hoặc ADMIN mới được phép đánh dấu Đã chốt',
        );
        await this.auditLog.logAction(
          userId,
          role,
          'MARK_CLOSED',
          'QuoteRequest',
          id,
        );
        return this.markClosed(id, role, dto.optionId);

      case QuoteAction.SELECT_OPTION:
        this.assertRole(
          role,
          [Role.SALE, Role.ADMIN],
          'Chỉ có vai trò SALE hoặc ADMIN mới được phép chọn phương án báo giá',
        );
        if (!dto.optionId) {
          throw new BadRequestException(
            'Vui lòng chọn ID phương án (optionId)',
          );
        }
        await this.auditLog.logAction(
          userId,
          role,
          'SELECT_OPTION',
          'QuoteRequest',
          id,
        );
        return this.selectOption(id, dto.optionId, role);

      default:
        throw new BadRequestException(
          'Hành động chuyển trạng thái không hợp lệ',
        );
    }
  }
}
