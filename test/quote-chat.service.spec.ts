import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('QuoteChatService', () => {
  let service: QuoteChatService;
  let prisma: {
    quoteRequest: { findUnique: jest.Mock };
    quoteChatMessage: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
    };
    quoteChatRead: { findUnique: jest.Mock; upsert: jest.Mock };
  };

  const REQUEST = { requesterId: 'sale-1', assigneeId: 'order-1' };

  beforeEach(async () => {
    prisma = {
      quoteRequest: { findUnique: jest.fn().mockResolvedValue(REQUEST) },
      quoteChatMessage: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      quoteChatRead: { findUnique: jest.fn(), upsert: jest.fn() },
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
