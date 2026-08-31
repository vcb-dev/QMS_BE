import { ConflictException } from '@nestjs/common';
import { QuoteWorkflowService } from '../src/quote-requests/quote/quote-workflow.service';
import { QuoteStatus, Role } from '@prisma/client';

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
