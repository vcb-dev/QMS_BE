import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Subject } from 'rxjs';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';
import { LarkService } from '../src/lark/lark.service';
import type { ChatMessageDto } from '../src/quote-chat/dto/quote-chat.types';

describe('RealtimeGateway — cầu Lark DM', () => {
  let gateway: RealtimeGateway;
  let quoteChat: { assertParticipant: jest.Mock };
  let bridge: {
    onWebMessage: jest.Mock;
    onRecipientEngaged: jest.Mock;
    reply$: Subject<ChatMessageDto>;
  };
  let emit: jest.Mock;
  let fetchSockets: jest.Mock;

  const MSG = {
    id: 'm1',
    quoteRequestId: 'q1',
    senderId: 'sale-1',
    senderName: 'S',
    content: 'hi',
    imageUrl: null,
    createdAt: new Date(),
  } as ChatMessageDto;

  beforeEach(async () => {
    quoteChat = { assertParticipant: jest.fn() };
    bridge = {
      onWebMessage: jest.fn(),
      onRecipientEngaged: jest.fn(),
      reply$: new Subject<ChatMessageDto>(),
    };
    emit = jest.fn();
    fetchSockets = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: QuoteChatService, useValue: quoteChat },
        { provide: LarkService, useValue: bridge },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
      in: jest.fn().mockReturnValue({ fetchSockets }),
      emit: jest.fn(),
    } as never;
  });

  it('maybeBridgeToLark: recipient = người còn lại, không có socket => onWebMessage(..., false)', async () => {
    quoteChat.assertParticipant.mockResolvedValue({
      requesterId: 'sale-1',
      assigneeId: 'order-1',
    });
    await gateway.maybeBridgeToLark('q1', 'sale-1', MSG);
    expect(bridge.onWebMessage).toHaveBeenCalledWith(MSG, 'order-1', false);
  });

  it('maybeBridgeToLark: recipient đang có socket trong room => true', async () => {
    quoteChat.assertParticipant.mockResolvedValue({
      requesterId: 'sale-1',
      assigneeId: 'order-1',
    });
    fetchSockets.mockResolvedValue([{ data: { user: { id: 'order-1' } } }]);
    await gateway.maybeBridgeToLark('q1', 'sale-1', MSG);
    expect(bridge.onWebMessage).toHaveBeenCalledWith(MSG, 'order-1', true);
  });

  it('maybeBridgeToLark: assignee null => không gọi bridge', async () => {
    quoteChat.assertParticipant.mockResolvedValue({
      requesterId: 'sale-1',
      assigneeId: null,
    });
    await gateway.maybeBridgeToLark('q1', 'sale-1', MSG);
    expect(bridge.onWebMessage).not.toHaveBeenCalled();
  });

  it('reply$ từ Lark => bắn newMessage vào đúng room', () => {
    gateway.onModuleInit();
    bridge.reply$.next({ ...MSG, quoteRequestId: 'q9' });
    expect(gateway.server.to).toHaveBeenCalledWith('quote-chat:q9');
    expect(emit).toHaveBeenCalledWith(
      'newMessage',
      expect.objectContaining({ quoteRequestId: 'q9' }),
    );
  });
});
