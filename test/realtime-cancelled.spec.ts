import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { QuoteChatService } from '../src/quote-chat/quote-chat.service';
import { LarkService } from '../src/lark/lark.service';

// Đơn đã hủy chỉ ADMIN được biết: sự kiện realtime KHÔNG được lộ CANCELLED (hay id) cho socket khác.
describe('RealtimeGateway — đơn đã hủy', () => {
  let gateway: RealtimeGateway;
  let server: {
    emit: jest.Mock;
    to: jest.Mock;
    except: jest.Mock;
    in: jest.Mock;
  };
  let toEmit: jest.Mock;
  let exceptEmit: jest.Mock;
  let fetchSockets: jest.Mock;

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const sock = (role: string) => ({
    data: { user: { id: `u-${role}`, role } },
    join: jest.fn(),
    leave: jest.fn(),
  });

  beforeEach(async () => {
    toEmit = jest.fn();
    exceptEmit = jest.fn();
    fetchSockets = jest.fn().mockResolvedValue([]);
    server = {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit }),
      except: jest.fn().mockReturnValue({ emit: exceptEmit }),
      in: jest.fn().mockReturnValue({ fetchSockets }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: QuoteChatService, useValue: {} },
        { provide: LarkService, useValue: { reply$: { subscribe: jest.fn() } } },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      ],
    }).compile();
    gateway = moduleRef.get(RealtimeGateway);
    gateway.server = server as never;
  });

  describe('handleConnection', () => {
    it('socket ADMIN vào phòng role:ADMIN', () => {
      const admin = sock('ADMIN');
      gateway.handleConnection(admin as never);
      expect(admin.join).toHaveBeenCalledWith(RealtimeGateway.ADMIN_ROOM);
      expect(RealtimeGateway.ADMIN_ROOM).toBe('role:ADMIN');
    });

    it.each(['SALE', 'ORDER'])('socket %s KHÔNG vào phòng ADMIN', (role) => {
      const s = sock(role);
      gateway.handleConnection(s as never);
      expect(s.join).not.toHaveBeenCalled();
    });

    it('socket chưa xác thực (không có user) cũng không vào', () => {
      const s = { data: {}, join: jest.fn() };
      gateway.handleConnection(s as never);
      expect(s.join).not.toHaveBeenCalled();
    });
  });

  describe('broadcastStatusChanged', () => {
    it('CANCELLED: ADMIN nhận CANCELLED; mọi socket khác chỉ nhận sự kiện "đơn biến mất" (DELETED) — không có emit toàn cục', () => {
      gateway.broadcastStatusChanged('q1', 'CANCELLED');

      expect(server.to).toHaveBeenCalledWith('role:ADMIN');
      expect(toEmit).toHaveBeenCalledWith('statusChanged', {
        quoteRequestId: 'q1',
        status: 'CANCELLED',
      });
      expect(server.except).toHaveBeenCalledWith('role:ADMIN');
      expect(exceptEmit).toHaveBeenCalledWith('statusChanged', {
        quoteRequestId: 'q1',
        status: 'DELETED',
      });
      expect(server.emit).not.toHaveBeenCalled();
    });

    it.each(['QUOTED', 'PENDING', 'DELETED', 'OPTION_DELETED'])(
      'trạng thái %s: phát cho mọi socket như cũ, không tách role',
      (status) => {
        gateway.broadcastStatusChanged('q1', status);
        expect(server.emit).toHaveBeenCalledWith('statusChanged', {
          quoteRequestId: 'q1',
          status,
        });
        expect(server.to).not.toHaveBeenCalled();
        expect(server.except).not.toHaveBeenCalled();
      },
    );

    it('CANCELLED: đuổi socket non-admin đang ở phòng chat của đơn, giữ ADMIN', async () => {
      const admin = sock('ADMIN');
      const sale = sock('SALE');
      const order = sock('ORDER');
      fetchSockets.mockResolvedValue([admin, sale, order]);

      gateway.broadcastStatusChanged('q1', 'CANCELLED');
      await flush();

      expect(server.in).toHaveBeenCalledWith('quote-chat:q1');
      expect(sale.leave).toHaveBeenCalledWith('quote-chat:q1');
      expect(order.leave).toHaveBeenCalledWith('quote-chat:q1');
      expect(admin.leave).not.toHaveBeenCalled();
    });

    it('lỗi khi lấy danh sách socket không làm hỏng việc phát sự kiện', async () => {
      fetchSockets.mockRejectedValue(new Error('adapter down'));

      expect(() => gateway.broadcastStatusChanged('q1', 'CANCELLED')).not.toThrow();
      await flush();

      expect(toEmit).toHaveBeenCalled();
      expect(exceptEmit).toHaveBeenCalled();
    });
  });
});
