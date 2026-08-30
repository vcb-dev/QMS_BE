import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LarkService } from '../src/lark/lark.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';

describe('LarkService — DM bridge send', () => {
  let service: LarkService;
  const fetchMock = jest.fn();

  const okToken = {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ code: 0, tenant_access_token: 't-abc', expire: 7200 }),
  };
  const okMessage = {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ code: 0, data: { message_id: 'om_123' } }),
  };

  beforeEach(async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('tenant_access_token') ? okToken : okMessage,
      ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        LarkService,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === 'LARK_APP_ID'
                ? 'app'
                : k === 'LARK_APP_SECRET'
                  ? 'sec'
                  : undefined,
          },
        },
        { provide: PrismaService, useValue: {} },
        { provide: QuoteChatService, useValue: { saveMessage: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(LarkService);
  });

  it('sendDirectMessage: đúng endpoint + body, trả message_id', async () => {
    const out = await service.sendDirectMessage('ou_user', 'xin chào');
    expect(out).toEqual({ messageId: 'om_123' });

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/im/v1/messages?'),
    );
    expect(String(call![0])).toContain('receive_id_type=open_id');
    const body = JSON.parse(call![1].body);
    expect(body).toMatchObject({ receive_id: 'ou_user', msg_type: 'text' });
    expect(JSON.parse(body.content)).toEqual({ text: 'xin chào' });
    expect(call![1].headers.Authorization).toBe('Bearer t-abc');
  });

  it('sendDirectCard: msg_type interactive, content = card JSON', async () => {
    const card = { header: { title: { content: 'x' } } };
    const out = await service.sendDirectCard('ou_user', card);
    expect(out).toEqual({ messageId: 'om_123' });

    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/im/v1/messages?'),
    );
    const body = JSON.parse(call![1].body);
    expect(body).toMatchObject({
      receive_id: 'ou_user',
      msg_type: 'interactive',
    });
    expect(JSON.parse(body.content)).toEqual(card);
  });

  it('trả null khi Lark báo code != 0', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('tenant_access_token')
          ? okToken
          : {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ code: 230001, msg: 'forbidden' }),
            },
      ),
    );
    expect(await service.sendDirectMessage('ou', 'x')).toBeNull();
  });
});
