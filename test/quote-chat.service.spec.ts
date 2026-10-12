import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('QuoteChatService', () => {
  let service: QuoteChatService;
  let prisma: {
    quoteRequest: { findUnique: jest.Mock; findMany: jest.Mock };
    quoteChatMessage: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    quoteChatRead: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };

  const REQUEST = { requesterId: 'sale-1', assigneeId: 'order-1' };

  beforeEach(async () => {
    prisma = {
      quoteRequest: {
        findUnique: jest.fn().mockResolvedValue(REQUEST),
        findMany: jest.fn(),
      },
      quoteChatMessage: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      quoteChatRead: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      // Mặc định user không có role (không phải ORDER/ADMIN) — giữ đúng hành vi cũ (chỉ
      // requester/assignee) cho các test không quan tâm tới group chat. Test group chat tự
      // mockResolvedValueOnce role ORDER/ADMIN khi cần.
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteChatService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<QuoteChatService>(QuoteChatService);
  });

  describe('assertParticipant', () => {
    it('cho qua khi user là requester', async () => {
      await expect(
        service.assertParticipant('req-1', 'sale-1'),
      ).resolves.toEqual(REQUEST);
    });

    it('cho qua khi user là assignee', async () => {
      await expect(
        service.assertParticipant('req-1', 'order-1'),
      ).resolves.toEqual(REQUEST);
    });

    it('chặn user không phải participant', async () => {
      await expect(
        service.assertParticipant('req-1', 'nguoi-la-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cho qua ORDER khác không phải assignee của đơn — group chat', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ORDER' });
      await expect(
        service.assertParticipant('req-1', 'order-khac-1'),
      ).resolves.toEqual(REQUEST);
    });

    it('cho qua ADMIN bất kỳ — group chat', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      await expect(
        service.assertParticipant('req-1', 'admin-1'),
      ).resolves.toEqual(REQUEST);
    });

    it('vẫn chặn SALE khác không liên quan đơn', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'SALE' });
      await expect(
        service.assertParticipant('req-1', 'sale-khac-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('chặn khi request không tồn tại', async () => {
      prisma.quoteRequest.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.assertParticipant('req-x', 'sale-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('saveMessage', () => {
    it('chặn khi cả content lẫn imageUrl đều trống', async () => {
      await expect(
        service.saveMessage('req-1', 'sale-1', undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('lưu tin nhắn hợp lệ và trả về ChatMessageDto', async () => {
      const created = {
        id: 'msg-1',
        quoteRequestId: 'req-1',
        senderId: 'sale-1',
        content: 'chào order',
        imageUrl: null,
        createdAt: new Date('2026-08-20T10:00:00Z'),
        sender: { name: 'Nguyễn Văn Sale' },
      };
      prisma.quoteChatMessage.create.mockResolvedValue(created);

      const result = await service.saveMessage('req-1', 'sale-1', 'chào order');

      expect(result).toEqual({
        id: 'msg-1',
        quoteRequestId: 'req-1',
        senderId: 'sale-1',
        senderName: 'Nguyễn Văn Sale',
        content: 'chào order',
        imageUrl: null,
        createdAt: created.createdAt,
      });
    });
  });

  describe('getMessages', () => {
    it('unreadCount = tổng tin khi chưa đọc lần nào (không có QuoteChatRead)', async () => {
      prisma.quoteChatRead.findUnique.mockResolvedValue(null);
      prisma.quoteChatMessage.findMany.mockResolvedValue([]);
      prisma.quoteChatMessage.count.mockResolvedValue(3);

      const result = await service.getMessages('req-1', 'order-1');

      expect(prisma.quoteChatMessage.count).toHaveBeenCalledWith({
        where: {
          quoteRequestId: 'req-1',
          createdAt: { gt: new Date(0) },
          senderId: { not: 'order-1' },
        },
      });
      expect(result.unreadCount).toBe(3);
    });

    it('unreadCount = tin sau lastReadAt khi đã đọc trước đó', async () => {
      const lastReadAt = new Date('2026-08-20T09:00:00Z');
      prisma.quoteChatRead.findUnique.mockResolvedValue({ lastReadAt });
      prisma.quoteChatMessage.findMany.mockResolvedValue([]);
      prisma.quoteChatMessage.count.mockResolvedValue(2);

      const result = await service.getMessages('req-1', 'order-1');

      expect(prisma.quoteChatMessage.count).toHaveBeenCalledWith({
        where: {
          quoteRequestId: 'req-1',
          createdAt: { gt: lastReadAt },
          senderId: { not: 'order-1' },
        },
      });
      expect(result.unreadCount).toBe(2);
    });
  });

  describe('getUnreadCounts', () => {
    it('trả object rỗng khi danh sách id rỗng — không gọi DB', async () => {
      const result = await service.getUnreadCounts('order-1', []);
      expect(result).toEqual({});
      expect(prisma.quoteRequest.findMany).not.toHaveBeenCalled();
    });

    it('bỏ qua đơn user không phải requester/assignee — không có trong kết quả', async () => {
      prisma.quoteRequest.findMany.mockResolvedValue([]);
      const result = await service.getUnreadCounts('nguoi-la-1', ['req-1']);
      expect(result).toEqual({});
      expect(prisma.quoteChatRead.findMany).not.toHaveBeenCalled();
    });

    it('đếm đúng theo lastReadAt riêng từng đơn, bỏ qua tin của chính mình', async () => {
      prisma.quoteRequest.findMany.mockResolvedValue([
        { id: 'req-1' },
        { id: 'req-2' },
      ]);
      prisma.quoteChatRead.findMany.mockResolvedValue([
        { quoteRequestId: 'req-1', lastReadAt: new Date('2026-08-20T09:00:00Z') },
      ]);
      prisma.quoteChatMessage.findMany.mockResolvedValue([
        { quoteRequestId: 'req-1', createdAt: new Date('2026-08-20T10:00:00Z') }, // sau lastReadAt -> tính
        { quoteRequestId: 'req-1', createdAt: new Date('2026-08-20T08:00:00Z') }, // trước lastReadAt -> bỏ
        { quoteRequestId: 'req-2', createdAt: new Date('2026-08-20T10:00:00Z') }, // chưa có lastReadAt -> tính
      ]);

      const result = await service.getUnreadCounts('order-1', ['req-1', 'req-2']);

      expect(result).toEqual({ 'req-1': 1, 'req-2': 1 });
      expect(prisma.quoteChatMessage.findMany).toHaveBeenCalledWith({
        where: {
          quoteRequestId: { in: ['req-1', 'req-2'] },
          senderId: { not: 'order-1' },
        },
        select: { quoteRequestId: true, createdAt: true },
      });
    });

    it('ORDER/ADMIN thấy mọi đơn, không lọc theo requester/assignee — group chat', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ORDER' });
      prisma.quoteRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);
      prisma.quoteChatRead.findMany.mockResolvedValue([]);
      prisma.quoteChatMessage.findMany.mockResolvedValue([
        { quoteRequestId: 'req-1', createdAt: new Date('2026-08-20T10:00:00Z') },
      ]);

      const result = await service.getUnreadCounts('order-khac-1', ['req-1']);

      // Không lọc theo requester/assignee (group chat) — nhưng ORDER không bao giờ thấy đơn đã hủy.
      expect(prisma.quoteRequest.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['req-1'] }, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      expect(result).toEqual({ 'req-1': 1 });
    });

    it('ADMIN: không lọc gì thêm (thấy cả đơn đã hủy trong tab "Đã hủy")', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      prisma.quoteRequest.findMany.mockResolvedValue([{ id: 'req-1' }]);
      prisma.quoteChatRead.findMany.mockResolvedValue([]);
      prisma.quoteChatMessage.findMany.mockResolvedValue([]);

      await service.getUnreadCounts('admin-1', ['req-1']);

      expect(prisma.quoteRequest.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['req-1'] } },
        select: { id: true },
      });
    });

    it('SALE: lọc theo requester/assignee VÀ loại đơn đã hủy', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'SALE' });
      prisma.quoteRequest.findMany.mockResolvedValue([]);

      await service.getUnreadCounts('sale-1', ['req-1']);

      expect(prisma.quoteRequest.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['req-1'] },
          OR: [{ requesterId: 'sale-1' }, { assigneeId: 'sale-1' }],
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
    });
  });

  describe('đơn đã hủy', () => {
    const CANCELLED = {
      requesterId: 'sale-1',
      assigneeId: 'order-1',
      status: 'CANCELLED',
    };
    const FORBIDDEN_MSG = 'Bạn không có quyền xem cuộc trò chuyện này';

    beforeEach(() => {
      prisma.quoteRequest.findUnique.mockResolvedValue(CANCELLED);
      prisma.quoteChatRead.findUnique.mockResolvedValue(null);
      prisma.quoteChatMessage.findMany.mockResolvedValue([]);
      prisma.quoteChatMessage.count.mockResolvedValue(0);
    });

    it.each([
      ['SALE là người tạo đơn', 'sale-1', 'SALE'],
      ['ORDER là người tiếp nhận', 'order-1', 'ORDER'],
      ['ORDER khác (group chat)', 'order-khac-1', 'ORDER'],
      ['SALE khác', 'sale-khac-1', 'SALE'],
    ])(
      'assertParticipant: %s → bị chặn với đúng thông điệp của đơn không tồn tại',
      async (_label, userId, role) => {
        prisma.user.findUnique.mockResolvedValueOnce({ role });
        await expect(
          service.assertParticipant('req-1', userId),
        ).rejects.toThrow(new ForbiddenException(FORBIDDEN_MSG));
      },
    );

    it('assertParticipant: ADMIN vẫn vào được và biết đơn đã hủy', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      await expect(
        service.assertParticipant('req-1', 'admin-1'),
      ).resolves.toEqual({
        requesterId: 'sale-1',
        assigneeId: 'order-1',
        status: 'CANCELLED',
      });
    });

    it('getMessages: ADMIN đọc được, SALE là người tạo thì không', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      await expect(service.getMessages('req-1', 'admin-1')).resolves.toEqual({
        messages: [],
        unreadCount: 0,
      });

      prisma.user.findUnique.mockResolvedValueOnce({ role: 'SALE' });
      await expect(service.getMessages('req-1', 'sale-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('markRead: SALE bị chặn, không ghi lastReadAt', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'SALE' });
      await expect(service.markRead('req-1', 'sale-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.quoteChatRead.upsert).not.toHaveBeenCalled();
    });

    it('saveMessage: ngay cả ADMIN cũng không gửi thêm được vào đơn đã hủy', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      await expect(
        service.saveMessage('req-1', 'admin-1', 'xin chào'),
      ).rejects.toThrow('đã bị hủy');
      expect(prisma.quoteChatMessage.create).not.toHaveBeenCalled();
    });

    it('saveMessage: SALE bị chặn như đơn không tồn tại (Forbidden), không phải "đã bị hủy"', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ role: 'SALE' });
      await expect(
        service.saveMessage('req-1', 'sale-1', 'xin chào'),
      ).rejects.toThrow(new ForbiddenException(FORBIDDEN_MSG));
      expect(prisma.quoteChatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('upsert lastReadAt cho đúng (quoteRequestId, userId)', async () => {
      await service.markRead('req-1', 'order-1');

      expect(prisma.quoteChatRead.upsert).toHaveBeenCalledWith({
        where: {
          quoteRequestId_userId: { quoteRequestId: 'req-1', userId: 'order-1' },
        },
        create: {
          quoteRequestId: 'req-1',
          userId: 'order-1',
          lastReadAt: expect.any(Date),
        },
        update: { lastReadAt: expect.any(Date) },
      });
    });
  });
});
