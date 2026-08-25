import { Test, TestingModule } from '@nestjs/testing';
import { QuoteWorkflowService } from './quote-workflow.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteQueryService } from './quote-query.service';
import { MailService } from '../mail/mail.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LarkNotificationService } from '../lark/lark-notification.service';
import { QuoteOptionsService } from './quote-options.service';
import { QuoteAction } from './dto/update-quote-status.dto';
import { Role } from '@prisma/client';

// Kiểm tra syncFinalOption() được gọi đúng ở CẢ 6 nơi ghi QuoteOption trong
// quote-workflow.service.ts — mỗi test drive qua public entry point thật (updateStatus /
// deleteOption), mock Prisma để không đụng DB thật, rồi xác nhận:
//   1) quoteOption.findMany đọc lại đúng quoteRequestId vừa ghi
//   2) quoteRequest.update ghi finalOptionId/finalPrice đúng kết quả computeFinalOption
describe('QuoteWorkflowService — syncFinalOption sync points', () => {
  let service: QuoteWorkflowService;
  let prisma: any;
  let queryService: any;
  let mailService: any;
  let auditLog: any;
  let larkService: any;
  let quoteOptionsService: any;

  // computeFinalOption([{ id: 'o1', quotedPrice: 5_000_000, selectionStatus: 'CLOSED' }])
  // => { finalOptionId: 'o1', finalPrice: 5_000_000 } (option CLOSED luôn được ưu tiên chọn).
  const FINAL_OPTIONS = [
    { id: 'o1', quotedPrice: 5_000_000, selectionStatus: 'CLOSED' },
  ];

  const DETAIL = {
    id: 'r1',
    code: 'QR-001',
    status: 'PROCESSING',
    requester: { email: 'sale@example.com', name: 'Sale A' },
    category: { name: 'Nhẫn' },
    options: [
      {
        id: 'o1',
        quotedPrice: 5_000_000,
        selectionStatus: 'CLOSED',
        materials: [],
        stones: [],
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        update: jest.fn().mockResolvedValue(DETAIL),
        updateMany: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ categoryId: 'cat-1', _count: { options: 1 } }),
      },
      quoteOption: {
        findMany: jest.fn().mockResolvedValue(FINAL_OPTIONS),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([{}, {}]),
    };
    queryService = {
      clearCache: jest.fn(),
      findOne: jest.fn().mockResolvedValue(DETAIL),
      stripCostFieldsForSale: jest.fn((opts: any) => opts),
    };
    mailService = {
      sendQuoteCompleted: jest.fn().mockResolvedValue(undefined),
      sendQuoteRejected: jest.fn().mockResolvedValue(undefined),
      sendNeedMoreInfo: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { logAction: jest.fn().mockResolvedValue(undefined) };
    larkService = { notifySale: jest.fn(), notifyOrder: jest.fn() };
    quoteOptionsService = {
      buildStonePriceMap: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: QuoteQueryService, useValue: queryService },
        { provide: MailService, useValue: mailService },
        { provide: AuditLogService, useValue: auditLog },
        { provide: LarkNotificationService, useValue: larkService },
        { provide: QuoteOptionsService, useValue: quoteOptionsService },
      ],
    }).compile();

    service = module.get(QuoteWorkflowService);
  });

  function expectSynced() {
    expect(prisma.quoteOption.findMany).toHaveBeenCalledWith({
      where: { quoteRequestId: 'r1' },
      select: { id: true, quotedPrice: true, selectionStatus: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.quoteRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { finalOptionId: 'o1', finalPrice: 5_000_000 },
    });
  }

  // 1) completeQuote — action QUOTE
  it('syncs finalOption after QUOTE (completeQuote deletes+recreates options)', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValueOnce({
      status: 'PROCESSING',
      assigneeId: 'u1',
      categoryId: 'cat-1',
    });
    await service.updateStatus('r1', 'u1', Role.ORDER, {
      action: QuoteAction.QUOTE,
      options: [{ optionName: 'A', quotedPrice: 5_000_000 }],
    });
    expectSynced();
  });

  // 2) updateStatus switch — case QUICK_QUOTE
  it('syncs finalOption after QUICK_QUOTE (deletes+recreates options)', async () => {
    await service.updateStatus('r1', 'u1', Role.ORDER, {
      action: QuoteAction.QUICK_QUOTE,
    });
    expectSynced();
  });

  // 3) updateStatus switch — case QUICK_APPROVE
  it('syncs finalOption after QUICK_APPROVE (deletes+recreates options)', async () => {
    await service.updateStatus('r1', 'u1', Role.ORDER, {
      action: QuoteAction.QUICK_APPROVE,
      options: [{ optionName: 'A', quotedPrice: 5_000_000 }],
    });
    expectSynced();
  });

  // 4) selectOption — sets one option to SELECTED via $transaction
  it('syncs finalOption after SELECT_OPTION', async () => {
    prisma.quoteOption.findUnique.mockResolvedValueOnce({
      id: 'o1',
      quoteRequestId: 'r1',
    });
    await service.updateStatus('r1', 'u1', Role.SALE, {
      action: QuoteAction.SELECT_OPTION,
      optionId: 'o1',
    });
    expectSynced();
  });

  // 5) markClosed — sets one option to CLOSED via $transaction, inside `if (targetOptionId)`
  it('syncs finalOption after MARK_CLOSED', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValueOnce({
      status: 'QUOTED',
      options: [{ id: 'o1', quotedPrice: 5_000_000, selectionStatus: 'NONE' }],
    });
    await service.updateStatus('r1', 'u1', Role.SALE, {
      action: QuoteAction.MARK_CLOSED,
    });
    expectSynced();
  });

  // 6) deleteOption — deletes one option directly
  it('syncs finalOption after deleteOption', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({
      status: 'PROCESSING',
      options: [{ id: 'o1' }, { id: 'o2' }],
    });
    // Phải giữ lại ít nhất 1 phương án — xóa 'o2', không xóa 'o1' (phần tử cuối cùng).
    await service.deleteOption('r1', 'o2', 'u1', Role.ORDER);
    expectSynced();
  });
});
