import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateQuoteStatusDto, QuoteAction } from './dto/update-quote-status.dto';
import { CompleteQuoteInput } from './dto/quote-complete.dto';
import { QuoteStatus, Role } from '@prisma/client';
import { QuoteQueryService } from './quote-query.service';
import { MailService } from '../mail/mail.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class QuoteWorkflowService {
  constructor(
    private prisma: PrismaService,
    private queryService: QuoteQueryService,
    private mailService: MailService,
    private auditLog: AuditLogService,
  ) {}

  private async logAction(userId: string, role: Role, action: string, entityId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.auditLog.log({
      actorId: userId,
      actorName: user?.name || 'Không rõ',
      actorRole: role,
      action,
      entityType: 'QuoteRequest',
      entityId,
    });
  }

  private async accept(id: string, userId: string) {
    this.queryService.clearCache();
    const result = await this.prisma.quoteRequest.updateMany({
      where: { id, status: QuoteStatus.YC_MOI },
      data: {
        status: QuoteStatus.DANG_XLY,
        pricerId: userId,
        acceptedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new ConflictException('Yêu cầu này đã được tiếp nhận bởi nhân sự khác');
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
      select: { status: true, pricerId: true },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status !== QuoteStatus.DANG_XLY) {
      throw new ConflictException('Yêu cầu phải đang được xử lý trước khi thực hiện thao tác này');
    }

    if (role === Role.PRICING && quote.pricerId !== userId) {
      throw new ForbiddenException('Bạn chỉ được thao tác trên yêu cầu do mình tiếp nhận xử lý');
    }
  }

  private async notifySaleQuoteCompleted(quote: any) {
    if (quote?.requester?.email) {
      const productName = quote.category?.name || 'Sản phẩm chế tác';
      const price = Number(quote.quotedPrice || 0);
      this.mailService.sendQuoteCompleted(
        quote.requester.email,
        quote.requester.name || 'NVKD',
        quote.code,
        price,
        productName,
      ).catch(() => {});
    }
  }

  private async notifySaleQuoteRejected(quote: any, reason: string) {
    if (quote?.requester?.email) {
      const productName = quote.category?.name || 'Sản phẩm chế tác';
      this.mailService.sendQuoteRejected(
        quote.requester.email,
        quote.requester.name || 'NVKD',
        quote.code,
        productName,
        reason,
      ).catch(() => {});
    }
  }

  private async notifySaleNeedMoreInfo(quote: any, reason: string) {
    if (quote?.requester?.email) {
      const productName = quote.category?.name || 'Sản phẩm chế tác';
      this.mailService.sendNeedMoreInfo(
        quote.requester.email,
        quote.requester.name || 'NVKD',
        quote.code,
        productName,
        reason,
      ).catch(() => {});
    }
  }

  private async completeQuote(id: string, userId: string, dto: CompleteQuoteInput) {
    this.queryService.clearCache();

    // Nếu FE gửi kèm options (form nhiều phương án) thì mới xoá & ghi đè.
    // Nếu không gửi (báo giá nhanh 1 giá) mà request đã có sẵn options (vd tạo từ máy tính giá) thì GIỮ NGUYÊN,
    // không xoá mất data thật — chỉ tạo option fallback khi request chưa từng có option nào.
    let optionsCreate: { create: any[] } | undefined;

    if (dto.options && dto.options.length > 0) {
      await this.prisma.quoteOption.deleteMany({ where: { quoteRequestId: id } });
      optionsCreate = {
        create: dto.options.map((opt, idx) => ({
          optionName: opt.optionName || `Phương án ${idx + 1}`,
          materialName: opt.materialName,
          weightChi: opt.weightChi,
          laborCost: opt.laborCost,
          stoneCost: opt.stoneCost,
          stoneDescription: opt.stoneDescription,
          vat: opt.vat,
          quotedPrice: opt.quotedPrice,
          isSelected: opt.isSelected ?? (idx === 0),
          note: opt.note,
        })),
      };
    } else {
      const existingCount = await this.prisma.quoteOption.count({ where: { quoteRequestId: id } });
      if (existingCount === 0) {
        optionsCreate = {
          create: [{ optionName: 'Phương án báo giá', quotedPrice: dto.quotedPrice, vat: dto.vat, isSelected: true }],
        };
      }
    }

    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        vat: dto.vat ?? 0,
        quotedPrice: dto.quotedPrice,
        quotedDate: new Date(),
        pricerId: userId,
        status: QuoteStatus.XONG,
        options: optionsCreate,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });

    this.notifySaleQuoteCompleted(updated);
    return updated;
  }

  private async selectOption(id: string, optionId: string) {
    this.queryService.clearCache();
    const option = await this.prisma.quoteOption.findUnique({
      where: { id: optionId },
    });

    if (!option || option.quoteRequestId !== id) {
      throw new NotFoundException('Không tìm thấy phương án báo giá tương ứng');
    }

    await this.prisma.quoteOption.updateMany({
      where: { quoteRequestId: id },
      data: { isSelected: false },
    });

    await this.prisma.quoteOption.update({
      where: { id: optionId },
      data: { isSelected: true },
    });

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedPrice: option.quotedPrice,
        selectedOptionId: option.id,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async rejectQuote(id: string, userId: string, rejectReason: string) {
    this.queryService.clearCache();
    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        rejectReason,
        pricerId: userId,
        status: QuoteStatus.TU_CHOI,
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });

    this.notifySaleQuoteRejected(updated, rejectReason);
    return updated;
  }

  private async returnQuote(id: string, userId: string, returnReason: string) {
    this.queryService.clearCache();
    const updated = await this.prisma.quoteRequest.update({
      where: { id },
      data: {
        returnReason,
        pricerId: userId,
        status: QuoteStatus.NEED_MORE_INFO,
        returnedAt: new Date(),
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });

    this.notifySaleNeedMoreInfo(updated, returnReason);
    return updated;
  }

  private async markClosed(id: string, optionId?: string) {
    this.queryService.clearCache();
    const quote = await this.prisma.quoteRequest.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!quote) {
      throw new NotFoundException('Không tìm thấy yêu cầu báo giá');
    }

    if (quote.status !== QuoteStatus.XONG) {
      throw new ConflictException('Chỉ đánh dấu Đã chốt được khi yêu cầu đã có báo giá (XONG)');
    }

    // Sale chỉ chọn phương án cuối cùng trên UI (không gọi API riêng khi bấm từng thẻ) —
    // phương án được chọn chỉ ghi xuống DB cùng lúc với hành động "Đánh Dấu Đã Chốt".
    let selectedOption: { id: string; quotedPrice: any } | null = null;
    if (optionId) {
      selectedOption = await this.prisma.quoteOption.findUnique({ where: { id: optionId } });
      if (!selectedOption || (selectedOption as any).quoteRequestId !== id) {
        throw new NotFoundException('Không tìm thấy phương án báo giá tương ứng');
      }
      await this.prisma.quoteOption.updateMany({ where: { quoteRequestId: id }, data: { isSelected: false } });
      await this.prisma.quoteOption.update({ where: { id: optionId }, data: { isSelected: true } });
    }

    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.DA_CHOT,
        ...(selectedOption ? { selectedOptionId: selectedOption.id, quotedPrice: selectedOption.quotedPrice } : {}),
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async resubmitQuote(id: string) {
    this.queryService.clearCache();
    return this.prisma.quoteRequest.update({
      where: { id },
      data: {
        status: QuoteStatus.YC_MOI,
        pricerId: null,
        version: { increment: 1 },
      },
      include: {
        customer: true,
        material: true,
        materials: { include: { material: true } },
        category: true,
        requester: { select: { id: true, name: true, email: true, department: true } },
        pricer: { select: { id: true, name: true, email: true } },
        images: true,
        options: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async updateStatus(id: string, userId: string, role: Role, dto: UpdateQuoteStatusDto) {
    switch (dto.action) {
      case QuoteAction.ACCEPT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép tiếp nhận yêu cầu');
        }
        await this.logAction(userId, role, 'ACCEPT_QUOTE', id);
        return this.accept(id, userId);

      case QuoteAction.QUOTE:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép báo giá');
        }
        if (!dto.quotedPrice) {
          throw new BadRequestException('Vui lòng nhập giá sản phẩm (quotedPrice)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        await this.logAction(userId, role, 'QUOTE_PRICE', id);
        return this.completeQuote(id, userId, {
          quotedPrice: dto.quotedPrice,
          vat: dto.vat,
          options: dto.options,
        });

      case QuoteAction.QUICK_QUOTE:
        this.queryService.clearCache();
        await this.logAction(userId, role, 'QUICK_QUOTE', id);
        return this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.DANG_XLY,
            ...(dto.quotedPrice ? { quotedPrice: dto.quotedPrice } : {}),
          },
          include: {
            customer: true,
            material: true,
            materials: { include: { material: true } },
            category: true,
            requester: { select: { id: true, name: true, email: true, department: true } },
            pricer: { select: { id: true, name: true, email: true } },
            images: true,
            options: { orderBy: { createdAt: 'asc' } },
          },
        });

      case QuoteAction.QUICK_APPROVE: {
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép duyệt báo giá nhanh');
        }
        this.queryService.clearCache();
        await this.logAction(userId, role, 'QUICK_APPROVE', id);

        const existing = await this.prisma.quoteRequest.findUnique({ where: { id }, select: { quotedPrice: true, vat: true } });
        const finalPrice = dto.quotedPrice ?? Number(existing?.quotedPrice ?? 0);

        // Giữ nguyên options có sẵn (vd tạo từ máy tính giá) — chỉ tạo fallback khi request chưa từng có option nào
        const existingOptCount = await this.prisma.quoteOption.count({ where: { quoteRequestId: id } });
        const approveOptionsCreate = existingOptCount === 0
          ? {
              create: [{
                optionName: 'Phương án báo giá',
                quotedPrice: finalPrice,
                vat: dto.vat ?? existing?.vat ?? undefined,
                isSelected: true,
              }],
            }
          : undefined;

        const approved = await this.prisma.quoteRequest.update({
          where: { id },
          data: {
            status: QuoteStatus.XONG,
            pricerId: userId,
            quotedDate: new Date(),
            ...(dto.quotedPrice ? { quotedPrice: dto.quotedPrice } : {}),
            options: approveOptionsCreate,
          },
          include: {
            customer: true,
            material: true,
            materials: { include: { material: true } },
            category: true,
            requester: { select: { id: true, name: true, email: true, department: true } },
            pricer: { select: { id: true, name: true, email: true } },
            images: true,
            options: { orderBy: { createdAt: 'asc' } },
          },
        });
        this.notifySaleQuoteCompleted(approved);
        return approved;
      }

      case QuoteAction.QUICK_REJECT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép từ chối báo giá nhanh');
        }
        this.queryService.clearCache();
        await this.logAction(userId, role, 'QUICK_REJECT', id);
        return this.rejectQuote(id, userId, dto.rejectReason || 'Không đồng ý với báo giá nhanh này');

      case QuoteAction.REJECT:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép từ chối yêu cầu');
        }
        if (!dto.rejectReason) {
          throw new BadRequestException('Vui lòng nhập lý do từ chối (rejectReason)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        await this.logAction(userId, role, 'REJECT_QUOTE', id);
        return this.rejectQuote(id, userId, dto.rejectReason);

      case QuoteAction.RETURN:
        if (role !== Role.PRICING && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò PRICING hoặc ADMIN mới được phép trả lại yêu cầu');
        }
        if (!dto.returnReason) {
          throw new BadRequestException('Vui lòng nhập lý do cần bổ sung (returnReason)');
        }
        await this.assertPricingCanProcess(id, userId, role);
        await this.logAction(userId, role, 'RETURN_QUOTE', id);
        return this.returnQuote(id, userId, dto.returnReason);

      case QuoteAction.RESUBMIT:
        if (role !== Role.SALE && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò SALE hoặc ADMIN mới được phép gửi lại yêu cầu');
        }
        await this.logAction(userId, role, 'RESUBMIT_QUOTE', id);
        return this.resubmitQuote(id);

      case QuoteAction.MARK_CLOSED:
        if (role !== Role.SALE && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò SALE hoặc ADMIN mới được phép đánh dấu Đã chốt');
        }
        await this.logAction(userId, role, 'MARK_CLOSED', id);
        return this.markClosed(id, dto.optionId);

      case QuoteAction.SELECT_OPTION:
        if (role !== Role.SALE && role !== Role.ADMIN) {
          throw new ForbiddenException('Chỉ có vai trò SALE hoặc ADMIN mới được phép chọn phương án báo giá');
        }
        if (!dto.optionId) {
          throw new BadRequestException('Vui lòng chọn ID phương án (optionId)');
        }
        await this.logAction(userId, role, 'SELECT_OPTION', id);
        return this.selectOption(id, dto.optionId);

      default:
        throw new BadRequestException('Hành động chuyển trạng thái không hợp lệ');
    }
  }
}
