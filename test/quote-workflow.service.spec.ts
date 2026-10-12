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
