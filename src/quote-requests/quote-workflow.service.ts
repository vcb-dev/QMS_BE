import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateQuoteStatusDto,
  QuoteAction,
} from './dto/update-quote-status.dto';
import { CompleteQuoteInput } from './dto/quote-complete.dto';
import { QuoteStatus, Role, OptionSelectionStatus } from '@prisma/client';
import { QuoteQueryService } from './quote-query.service';
import { MailService } from '../mail/mail.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LarkNotificationService } from '../lark/lark-notification.service';
import { QuoteOptionsService } from './quote-options.service';
import {
  REQUEST_DETAIL_INCLUDE,
  buildOptionCreateInput,
  computeFinalOption,
  mapQuoteRequestDetail,
  pickPrimaryOption,
} from '../utils/option-mapper.util';

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

  // Đồng bộ finalOptionId/finalPrice trên QuoteRequest — gọi ngay sau MỌI chỗ ghi QuoteOption
  // (6 nơi trong file này). Luôn đọc lại option THẬT SỰ vừa ghi (không suy đoán từ input DTO) để
  // đảm bảo đúng business rule (pickPrimaryOption) bất kể path nào gọi tới.
  private async syncFinalOption(quoteRequestId: string) {
    const options = await this.prisma.quoteOption.findMany({
      where: { quoteRequestId },
      select: { id: true, quotedPrice: true, selectionStatus: true },
      orderBy: { createdAt: 'asc' },
    });
    const { finalOptionId, finalPrice } = computeFinalOption(options);
    await this.prisma.quoteRequest.update({
      where: { id: quoteRequestId },
      data: { finalOptionId, finalPrice },
    });
  }

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

    const stonePriceMap = dto.options
      ? await this.quoteOptionsService.buildStonePriceMap(dto.options)
      : new Map<string, number>();
    const optionsCreate =
      dto.options && dto.options.length > 0
        ? {
            deleteMany: {},
            create: dto.options.map((opt, idx) =>
              buildOptionCreateInput(
                opt,
                idx,
                existing?.categoryId,
                stonePriceMap,
              ),
            ),
          }
        : undefined;

    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.QUOTED,
        assigneeId: userId,
        options: optionsCreate,
      },
      include: REQUEST_DETAIL_INCLUDE,
    });

    await this.syncFinalOption(id);
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
    await this.syncFinalOption(id);
    return this.queryService.findOne(id, role);
  }

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
      await this.syncFinalOption(id);
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
    await this.syncFinalOption(requestId);
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

  private async resubmitQuote(id: string, role: Role) {
    this.queryService.clearCache();
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
      `🔄 Đơn ${mapped.code} (${this.pickProductName(mapped)}) đã được gửi lại, cần xử lý`,
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
        await this.auditLog.logAction(
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
        const updated = await this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.PROCESSING,
            options:
              dto.options && dto.options.length > 0
                ? {
                    deleteMany: {},
                    create: dto.options.map((opt, idx) =>
                      buildOptionCreateInput(opt, idx, existing?.categoryId),
                    ),
                  }
                : undefined,
          },
          include: REQUEST_DETAIL_INCLUDE,
        });
        await this.syncFinalOption(id);
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
                      buildOptionCreateInput(opt, idx, existingReq.categoryId),
                    ),
                  }
                : undefined,
          },
          include: REQUEST_DETAIL_INCLUDE,
        });
        await this.syncFinalOption(id);
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
