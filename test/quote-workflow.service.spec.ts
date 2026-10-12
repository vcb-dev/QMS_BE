import { ConflictException } from '@nestjs/common';
import { QuoteWorkflowService } from '../src/quote-requests/quote/quote-workflow.service';
import { QuoteStatus, Role } from '@prisma/client';
import { QuoteAction } from '../src/quote-requests/dto/update-quote-status.dto';

describe('QuoteWorkflowService.assertPricingCanProcess — optimistic lock', () => {
  function make(quote: any) {
    const prisma = {
      quoteRequest: { findUnique: jest.fn().mockResolvedValue(quote) },
    };
    const svc = new QuoteWorkflowService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, prisma };
  }

  it('version khớp → không ném', async () => {
    const { svc } = make({
      status: QuoteStatus.PROCESSING,
      assigneeId: 'u1',
      version: 3,
    });
    await expect(
      (svc as any).assertPricingCanProcess('q1', 'u1', Role.ORDER, 3),
    ).resolves.toBeUndefined();
  });

  it('version lệch → ConflictException', async () => {
    const { svc } = make({
      status: QuoteStatus.PROCESSING,
      assigneeId: 'u1',
      version: 5,
    });
    await expect(
      (svc as any).assertPricingCanProcess('q1', 'u1', Role.ORDER, 3),
    ).rejects.toThrow(ConflictException);
  });

  it('không truyền version → bỏ qua kiểm (tương thích ngược)', async () => {
    const { svc } = make({
      status: QuoteStatus.PROCESSING,
      assigneeId: 'u1',
      version: 5,
    });
    await expect(
      (svc as any).assertPricingCanProcess('q1', 'u1', Role.ORDER),
    ).resolves.toBeUndefined();
  });
});

describe('QuoteWorkflowService — gỡ trạng thái "Đã chốt"', () => {
  function make(findUnique: jest.Mock) {
    const prisma = {
      quoteRequest: { findUnique },
      quoteOption: { delete: jest.fn().mockResolvedValue({}) },
    };
    const auditLog = { logAction: jest.fn() };
    const svc = new QuoteWorkflowService(
      prisma as any,
      {} as any,
      {} as any,
      auditLog as any,
      {} as any,
      {} as any,
    );
    return { svc, prisma };
  }

  it('QuoteAction không còn MARK_CLOSED', () => {
    expect(Object.values(QuoteAction)).not.toContain('MARK_CLOSED');
  });

  it.each([QuoteStatus.PROCESSING, QuoteStatus.CLOSED])(
    'editQuotedPrice chỉ nhận đơn QUOTED — status %s bị từ chối',
    async (status) => {
      const { svc } = make(
        jest.fn().mockResolvedValue({ status, version: 1, categoryId: 'c1' }),
      );
      await expect(
        (svc as any).editQuotedPrice('q1', 'u1', Role.ADMIN, [{}]),
      ).rejects.toThrow(
        'Chỉ sửa được giá cho yêu cầu đã báo giá (đang QUOTED)',
      );
    },
  );

  it('deleteOption không còn chặn theo status CLOSED (dòng cũ còn sót vẫn xóa được phương án)', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({
        status: QuoteStatus.CLOSED,
        assigneeId: 'u1',
        options: [{ id: 'o1' }, { id: 'o2' }],
      })
      .mockResolvedValueOnce(null);
    const { svc, prisma } = make(findUnique);

    await svc.deleteOption('q1', 'o1', 'admin1', Role.ADMIN);

    expect(prisma.quoteOption.delete).toHaveBeenCalledWith({
      where: { id: 'o1' },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Hủy / khôi phục yêu cầu (chỉ ADMIN) + chặn mọi thao tác khác trên đơn đã hủy
// ---------------------------------------------------------------------------------------------
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('QuoteWorkflowService — hủy / khôi phục yêu cầu', () => {
  const DETAIL = { id: 'q1', status: 'CANCELLED' };

  function make(row: any, updateManyCount = 1) {
    const prisma = {
      quoteRequest: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      },
      quoteOption: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const queryService = { findOne: jest.fn().mockResolvedValue(DETAIL) };
    const mailService = {
      sendQuoteCompleted: jest.fn(),
      sendQuoteRejected: jest.fn(),
      sendNeedMoreInfo: jest.fn(),
    };
    const auditLog = { logAction: jest.fn() };
    const larkService = {
      dispatchQuoteCard: jest.fn(),
      dispatchSummary: jest.fn(),
    };
    const svc = new QuoteWorkflowService(
      prisma as any,
      queryService as any,
      mailService as any,
      auditLog as any,
      larkService as any,
      {} as any,
    );
    return { svc, prisma, queryService, mailService, auditLog, larkService };
  }
  const anyWrite = (prisma: any) =>
    [
      prisma.quoteRequest.update,
      prisma.quoteRequest.updateMany,
      prisma.quoteOption.delete,
      prisma.quoteOption.deleteMany,
      prisma.quoteOption.updateMany,
      prisma.quoteOption.update,
      prisma.quoteOption.createMany,
      prisma.$transaction,
    ].some((fn) => fn.mock.calls.length > 0);

  describe('CANCEL', () => {
    it.each([
      QuoteStatus.PENDING,
      QuoteStatus.PROCESSING,
      QuoteStatus.NEED_MORE_INFO,
      QuoteStatus.QUOTED,
    ])(
      'ADMIN hủy được đơn %s: ghi CANCELLED + trạng thái trước + mốc hủy, ghi audit, KHÔNG mail/Lark',
      async (status) => {
        const { svc, prisma, queryService, auditLog, mailService, larkService } =
          make({ status, cancelledFromStatus: null });

        const res = await svc.updateStatus('q1', 'admin1', Role.ADMIN, {
          action: QuoteAction.CANCEL,
        });

        expect(prisma.quoteRequest.updateMany).toHaveBeenCalledWith({
          where: { id: 'q1', status },
          data: {
            status: QuoteStatus.CANCELLED,
            cancelledFromStatus: status,
            cancelledAt: expect.any(Date),
            version: { increment: 1 },
          },
        });
        expect(auditLog.logAction).toHaveBeenCalledWith(
          'admin1',
          Role.ADMIN,
          'CANCEL_QUOTE',
          'QuoteRequest',
          'q1',
        );
        expect(queryService.findOne).toHaveBeenCalledWith('q1', Role.ADMIN);
        expect(res).toBe(DETAIL);
        for (const fn of Object.values(mailService)) expect(fn).not.toHaveBeenCalled();
        for (const fn of Object.values(larkService)) expect(fn).not.toHaveBeenCalled();
      },
    );

    it.each([Role.SALE, Role.ORDER])(
      '%s KHÔNG được hủy (403) — kể cả đơn QUOTED',
      async (role) => {
        const { svc, prisma, auditLog } = make({
          status: QuoteStatus.QUOTED,
          cancelledFromStatus: null,
        });

        await expect(
          svc.updateStatus('q1', 'u1', role, { action: QuoteAction.CANCEL }),
        ).rejects.toThrow(ForbiddenException);

        expect(anyWrite(prisma)).toBe(false);
        expect(auditLog.logAction).not.toHaveBeenCalled();
      },
    );

    it('không hủy được đơn đã từ chối (REJECTED là trạng thái cuối)', async () => {
      const { svc, prisma } = make({
        status: QuoteStatus.REJECTED,
        cancelledFromStatus: null,
      });
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.CANCEL }),
      ).rejects.toThrow(ConflictException);
      expect(anyWrite(prisma)).toBe(false);
    });

    it('hủy lần hai trên đơn đã hủy → 409 "đã bị hủy"', async () => {
      const { svc, prisma } = make({
        status: QuoteStatus.CANCELLED,
        cancelledFromStatus: QuoteStatus.QUOTED,
      });
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.CANCEL }),
      ).rejects.toThrow('đã bị hủy');
      expect(anyWrite(prisma)).toBe(false);
    });

    it('trạng thái đổi giữa lúc đọc và lúc ghi (updateMany count 0) → 409 và KHÔNG ghi audit', async () => {
      const { svc, auditLog } = make(
        { status: QuoteStatus.QUOTED, cancelledFromStatus: null },
        0,
      );
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.CANCEL }),
      ).rejects.toThrow(ConflictException);
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });
  });

  describe('RESTORE', () => {
    it('ADMIN khôi phục đơn hủy từ QUOTED về QUOTED, xóa dấu vết hủy, ghi audit', async () => {
      const { svc, prisma, queryService, auditLog } = make({
        status: QuoteStatus.CANCELLED,
        cancelledFromStatus: QuoteStatus.QUOTED,
      });

      const res = await svc.updateStatus('q1', 'admin1', Role.ADMIN, {
        action: QuoteAction.RESTORE,
      });

      expect(prisma.quoteRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'q1', status: QuoteStatus.CANCELLED },
        data: {
          status: QuoteStatus.QUOTED,
          cancelledFromStatus: null,
          cancelledAt: null,
          version: { increment: 1 },
        },
      });
      expect(auditLog.logAction).toHaveBeenCalledWith(
        'admin1',
        Role.ADMIN,
        'RESTORE_QUOTE',
        'QuoteRequest',
        'q1',
      );
      expect(queryService.findOne).toHaveBeenCalledWith('q1', Role.ADMIN);
      expect(res).toBe(DETAIL);
    });

    it('không biết trạng thái trước khi hủy (cancelledFromStatus null) → 400, không ghi', async () => {
      const { svc, prisma } = make({
        status: QuoteStatus.CANCELLED,
        cancelledFromStatus: null,
      });
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.RESTORE }),
      ).rejects.toThrow(BadRequestException);
      expect(anyWrite(prisma)).toBe(false);
    });

    it('khôi phục đơn chưa bị hủy → 409', async () => {
      const { svc, prisma } = make({
        status: QuoteStatus.PENDING,
        cancelledFromStatus: null,
      });
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.RESTORE }),
      ).rejects.toThrow(ConflictException);
      expect(anyWrite(prisma)).toBe(false);
    });

    it('SALE/ORDER khôi phục đơn thường → 403; khôi phục đơn hủy → 404 (đơn như biến mất)', async () => {
      for (const role of [Role.SALE, Role.ORDER]) {
        const normal = make({ status: QuoteStatus.QUOTED, cancelledFromStatus: null });
        await expect(
          normal.svc.updateStatus('q1', 'u1', role, { action: QuoteAction.RESTORE }),
        ).rejects.toThrow(ForbiddenException);

        const cancelled = make({
          status: QuoteStatus.CANCELLED,
          cancelledFromStatus: QuoteStatus.QUOTED,
        });
        await expect(
          cancelled.svc.updateStatus('q1', 'u1', role, { action: QuoteAction.RESTORE }),
        ).rejects.toThrow(NotFoundException);
        expect(anyWrite(cancelled.prisma)).toBe(false);
      }
    });

    it('trạng thái đổi giữa lúc đọc và lúc ghi (count 0) → 409', async () => {
      const { svc, auditLog } = make(
        { status: QuoteStatus.CANCELLED, cancelledFromStatus: QuoteStatus.QUOTED },
        0,
      );
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action: QuoteAction.RESTORE }),
      ).rejects.toThrow(ConflictException);
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });
  });

  describe('mọi thao tác khác trên đơn đã hủy', () => {
    const others = Object.values(QuoteAction).filter(
      (a) => a !== QuoteAction.RESTORE,
    );
    const cancelledRow = {
      status: QuoteStatus.CANCELLED,
      cancelledFromStatus: QuoteStatus.QUOTED,
    };

    it.each(others)('ADMIN gọi %s → 409 "đã bị hủy", không ghi gì, không audit', async (action) => {
      const { svc, prisma, auditLog } = make(cancelledRow);
      await expect(
        svc.updateStatus('q1', 'admin1', Role.ADMIN, { action } as any),
      ).rejects.toThrow('đã bị hủy');
      expect(anyWrite(prisma)).toBe(false);
      expect(auditLog.logAction).not.toHaveBeenCalled();
    });

    it.each(others)('ORDER và SALE gọi %s → 404 y hệt đơn không tồn tại, không ghi gì', async (action) => {
      for (const role of [Role.ORDER, Role.SALE]) {
        const { svc, prisma, auditLog } = make(cancelledRow);
        await expect(
          svc.updateStatus('q1', 'u1', role, { action } as any),
        ).rejects.toThrow(new NotFoundException('Không tìm thấy yêu cầu báo giá'));
        expect(anyWrite(prisma)).toBe(false);
        expect(auditLog.logAction).not.toHaveBeenCalled();
      }
    });

    it('id không tồn tại → 404 với mọi role', async () => {
      for (const role of [Role.ADMIN, Role.ORDER, Role.SALE]) {
        const { svc } = make(null);
        await expect(
          svc.updateStatus('nope', 'u1', role, { action: QuoteAction.CANCEL }),
        ).rejects.toThrow(NotFoundException);
      }
    });

    it('đơn bình thường vẫn đi qua guard (ORDER tiếp nhận đơn PENDING)', async () => {
      const { svc, prisma } = make({
        status: QuoteStatus.PENDING,
        cancelledFromStatus: null,
      });
      await svc.updateStatus('q1', 'order1', Role.ORDER, {
        action: QuoteAction.ACCEPT,
      });
      expect(prisma.quoteRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q1', status: QuoteStatus.PENDING },
        }),
      );
    });

    it('deleteOption trên đơn đã hủy: ADMIN → 409, ORDER → 404, không xóa phương án', async () => {
      const row = {
        status: QuoteStatus.CANCELLED,
        assigneeId: 'order1',
        options: [{ id: 'o1' }, { id: 'o2' }],
      };
      const admin = make(row);
      await expect(
        svc_deleteOption(admin.svc, Role.ADMIN),
      ).rejects.toThrow('đã bị hủy');
      expect(admin.prisma.quoteOption.delete).not.toHaveBeenCalled();

      const order = make(row);
      await expect(
        svc_deleteOption(order.svc, Role.ORDER),
      ).rejects.toThrow(NotFoundException);
      expect(order.prisma.quoteOption.delete).not.toHaveBeenCalled();
    });
  });
});

const svc_deleteOption = (svc: QuoteWorkflowService, role: Role) =>
  svc.deleteOption('q1', 'o1', 'order1', role);
