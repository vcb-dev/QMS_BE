import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { LarkService } from '../src/lark/lark.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';
import type { ChatMessageDto } from '../src/quote-chat/dto/quote-chat.types';

// Cầu chat web <-> Lark DM giờ nằm trong chính LarkService (gộp theo tuân thủ).
// sendDirectCard / sendDirectMessage được spy trên chính instance thay vì mock provider.
describe('LarkService — cầu chat web <-> Lark DM', () => {
  let service: LarkService;
  let prisma: any;
  let lark: {
    sendDirectCard: jest.SpyInstance;
    sendDirectMessage: jest.SpyInstance;
  };
  let quoteChat: { saveMessage: jest.Mock };
  let replies: ChatMessageDto[];

  beforeEach(async () => {
    prisma = {
      larkDmBridgeConfig: { findFirst: jest.fn(), create: jest.fn() },
      user: { findUnique: jest.fn() },
      quoteRequest: { findUnique: jest.fn() },
      quoteChatRead: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    quoteChat = { saveMessage: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LarkService,
        { provide: PrismaService, useValue: prisma },
        { provide: QuoteChatService, useValue: quoteChat },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = moduleRef.get(LarkService);
    lark = {
      sendDirectCard: jest
        .spyOn(service, 'sendDirectCard')
        .mockResolvedValue({ messageId: 'om_anchor' }),
      sendDirectMessage: jest
        .spyOn(service, 'sendDirectMessage')
        .mockResolvedValue({ messageId: 'om_bot' }),
    };
    prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({ isEnabled: true });

    replies = [];
    service.reply$.subscribe((dto) => replies.push(dto));
  });

  describe('công tắc', () => {
    it('isBridgeEnabled: theo row created_at mới nhất', async () => {
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({
        isEnabled: true,
      });
      expect(await service.isBridgeEnabled()).toBe(true);
      expect(prisma.larkDmBridgeConfig.findFirst).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        select: { isEnabled: true },
      });
    });

    it('isBridgeEnabled: chưa có row => false', async () => {
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue(null);
      expect(await service.isBridgeEnabled()).toBe(false);
    });

    it('isBridgeEnabled: cache 15s — gọi 2 lần chỉ 1 query', async () => {
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({
        isEnabled: false,
      });
      await service.isBridgeEnabled();
      await service.isBridgeEnabled();
      expect(prisma.larkDmBridgeConfig.findFirst).toHaveBeenCalledTimes(1);
    });

    it('setBridgeEnabled: ghi row mới + xoá cache', async () => {
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({
        isEnabled: false,
      });
      await service.isBridgeEnabled();
      prisma.larkDmBridgeConfig.create.mockResolvedValue({});
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({
        isEnabled: true,
        createdAt: new Date('2026-08-30T00:00:00Z'),
        changedBy: { name: 'Admin A' },
      });

      const out = await service.setBridgeEnabled(true, ' bật thử ', 'user-1');

      expect(prisma.larkDmBridgeConfig.create).toHaveBeenCalledWith({
        data: { isEnabled: true, note: 'bật thử', changedById: 'user-1' },
      });
      expect(out).toEqual({
        isEnabled: true,
        changedByName: 'Admin A',
        changedAt: '2026-08-30T00:00:00.000Z',
      });
      expect(await service.isBridgeEnabled()).toBe(true);
    });
  });

  const MSG = {
    id: 'm1',
    quoteRequestId: 'q1',
    senderId: 'sale-1',
    senderName: 'Sale Một',
    content: 'khách hỏi giá gấp',
    imageUrl: null,
    createdAt: new Date('2026-08-30T03:00:00Z'),
  };
  const QUOTE = {
    code: 'QG-2026-0007',
    customer: { name: 'Cô Ba' },
    category: { name: 'Nhẫn cưới' },
  };

  describe('onWebMessage', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-30T03:00:00Z'));
      prisma.user.findUnique.mockResolvedValue({ larkOpenId: 'ou_recv' });
      prisma.quoteRequest.findUnique.mockResolvedValue(QUOTE);
    });
    afterEach(() => jest.useRealTimers());

    it('recipient đang mở room => không gửi', async () => {
      await service.onWebMessage(MSG as any, 'order-1', true);
      expect(lark.sendDirectCard).not.toHaveBeenCalled();
    });

    it('bridge tắt => không gửi', async () => {
      prisma.larkDmBridgeConfig.findFirst.mockResolvedValue({
        isEnabled: false,
      });
      await service.onWebMessage(MSG as any, 'order-1', false);
      expect(lark.sendDirectCard).not.toHaveBeenCalled();
    });

    it('recipient không có larkOpenId => không gửi', async () => {
      prisma.user.findUnique.mockResolvedValue({ larkOpenId: null });
      await service.onWebMessage(MSG as any, 'order-1', false);
      expect(lark.sendDirectCard).not.toHaveBeenCalled();
    });

    it('lần đầu (chưa có anchor) => gửi card mới + lưu anchor', async () => {
      prisma.quoteChatRead.upsert.mockResolvedValue({
        larkAnchorMsgId: null,
        larkPendingCount: 1,
        larkLastDmAt: null,
      });
      await service.onWebMessage(MSG as any, 'order-1', false);

      expect(lark.sendDirectCard).toHaveBeenCalledTimes(1);
      expect(lark.sendDirectCard.mock.calls[0][0]).toBe('ou_recv');
      expect(JSON.stringify(lark.sendDirectCard.mock.calls[0][1])).toContain(
        'QG-2026-0007',
      );
      expect(prisma.quoteChatRead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            larkAnchorMsgId: 'om_anchor',
            larkPendingCount: 0,
          }),
        }),
      );
    });

    it('có anchor, trong cooldown => chỉ đếm, không gọi Lark', async () => {
      prisma.quoteChatRead.upsert.mockResolvedValue({
        larkAnchorMsgId: 'om_anchor',
        larkPendingCount: 2,
        larkLastDmAt: new Date('2026-08-30T02:59:30Z'),
      });
      await service.onWebMessage(MSG as any, 'order-1', false);
      expect(lark.sendDirectCard).not.toHaveBeenCalled();
    });

    it('có anchor, quá cooldown => gửi card gộp, đổi anchor mới', async () => {
      prisma.quoteChatRead.upsert.mockResolvedValue({
        larkAnchorMsgId: 'om_old',
        larkPendingCount: 3,
        larkLastDmAt: new Date('2026-08-30T02:50:00Z'),
      });
      await service.onWebMessage(MSG as any, 'order-1', false);
      expect(lark.sendDirectCard).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(lark.sendDirectCard.mock.calls[0][1])).toContain(
        '3 tin mới',
      );
      expect(prisma.quoteChatRead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            larkAnchorMsgId: 'om_anchor',
            larkPendingCount: 0,
          }),
        }),
      );
    });
  });

  describe('onRecipientEngaged', () => {
    it('reset đếm gộp, giữ anchor + lastDmAt', async () => {
      await service.onRecipientEngaged('q1', 'order-1');
      expect(prisma.quoteChatRead.updateMany).toHaveBeenCalledWith({
        where: {
          quoteRequestId: 'q1',
          userId: 'order-1',
          larkPendingCount: { gt: 0 },
        },
        data: { larkPendingCount: 0 },
      });
    });
  });

  describe('handleInboundLarkMessage', () => {
    const base = {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_recv' } },
      message: {
        message_id: 'om_reply1',
        root_id: 'om_anchor',
        message_type: 'text',
        content: JSON.stringify({ text: '  giá ok, chốt nhé  ' }),
      },
    };

    beforeEach(() => {
      prisma.quoteChatRead.findFirst.mockResolvedValue({
        quoteRequestId: 'q1',
        userId: 'order-1',
        user: { larkOpenId: 'ou_recv' },
      });
      quoteChat.saveMessage.mockResolvedValue({
        id: 'm2',
        quoteRequestId: 'q1',
        senderId: 'order-1',
        senderName: 'Order Một',
        content: 'giá ok, chốt nhé',
        imageUrl: null,
        createdAt: new Date(),
      });
    });

    it('reply có root_id hợp lệ => saveMessage đúng + emit + reset đếm', async () => {
      await service.handleInboundLarkMessage(base as any);
      expect(quoteChat.saveMessage).toHaveBeenCalledWith(
        'q1',
        'order-1',
        'giá ok, chốt nhé',
      );
      expect(replies).toEqual([
        expect.objectContaining({ quoteRequestId: 'q1', senderId: 'order-1' }),
      ]);
      expect(prisma.quoteChatRead.updateMany).toHaveBeenCalledWith({
        where: { quoteRequestId: 'q1', userId: 'order-1' },
        data: { larkPendingCount: 0 },
      });
    });

    it('gõ thẳng không có root/parent => route theo anchor gần nhất của open_id', async () => {
      await service.handleInboundLarkMessage({
        ...base,
        message: { ...base.message, root_id: undefined, parent_id: undefined },
      } as any);
      // fallback: findFirst theo user.larkOpenId + orderBy larkLastDmAt desc
      expect(prisma.quoteChatRead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            larkAnchorMsgId: { not: null },
            user: { larkOpenId: 'ou_recv' },
          }),
        }),
      );
      expect(quoteChat.saveMessage).toHaveBeenCalledWith(
        'q1',
        'order-1',
        'giá ok, chốt nhé',
      );
    });

    it('không phải user (bot) => bỏ hẳn', async () => {
      await service.handleInboundLarkMessage({
        ...base,
        sender: { sender_type: 'app' },
      } as any);
      expect(quoteChat.saveMessage).not.toHaveBeenCalled();
    });

    it('không phải text => bot nhắn lại, không lưu', async () => {
      await service.handleInboundLarkMessage({
        ...base,
        message: { ...base.message, message_type: 'image' },
      } as any);
      expect(quoteChat.saveMessage).not.toHaveBeenCalled();
      expect(lark.sendDirectMessage).toHaveBeenCalledWith(
        'ou_recv',
        expect.stringContaining('web'),
      );
    });

    it('không tra được yêu cầu nào => bot nhắn lại, không lưu', async () => {
      prisma.quoteChatRead.findFirst.mockResolvedValue(null);
      await service.handleInboundLarkMessage(base as any);
      expect(quoteChat.saveMessage).not.toHaveBeenCalled();
      expect(lark.sendDirectMessage).toHaveBeenCalledWith(
        'ou_recv',
        expect.any(String),
      );
    });

    it('open_id gửi khác người nhận => bỏ im lặng', async () => {
      await service.handleInboundLarkMessage({
        ...base,
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_khac' } },
      } as any);
      expect(quoteChat.saveMessage).not.toHaveBeenCalled();
      expect(lark.sendDirectMessage).not.toHaveBeenCalled();
    });

    it('saveMessage ném Forbidden => bot báo "không còn phụ trách", không emit', async () => {
      quoteChat.saveMessage.mockRejectedValue(new ForbiddenException('x'));
      await service.handleInboundLarkMessage(base as any);
      expect(replies).toEqual([]);
      expect(lark.sendDirectMessage).toHaveBeenCalledWith(
        'ou_recv',
        expect.stringContaining('phụ trách'),
      );
    });
  });
});
