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
