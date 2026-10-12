import { Prisma } from '@prisma/client';
import { QuoteRequestsService } from '../src/quote-requests/quote-requests.service';

describe('QuoteRequestsService.buildEffectiveOptions', () => {
  const svc = new QuoteRequestsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const build = (a: any) => (svc as any).buildEffectiveOptions(a);

  it('có options thật + thiếu laborCost/vat → bù từ default', () => {
    const out = build({
      options: [{ optionName: 'PA1', quotedPrice: 5_000_000 }],
      defaultLaborCost: 300_000,
      defaultVat: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0].laborCost).toBe(300_000);
    expect(out[0].vat).toBe(10);
  });

  it('không options nhưng có nhiều materialIds → mỗi chất liệu 1 option độc lập', () => {
    const out = build({ materialIds: ['m1', 'm2'], defaultVat: 8 });
    expect(out).toHaveLength(2);
    expect(out[0].optionName).toBe('Yêu cầu ban đầu (Phương án 1)');
    expect(out[0].materials).toEqual([{ materialId: 'm1' }]);
    expect(out[0].vat).toBe(8);
    expect(out[1].optionName).toBe('Yêu cầu ban đầu (Phương án 2)');
    expect(out[1].materials).toEqual([{ materialId: 'm2' }]);
    expect(out[1].vat).toBe(8);
  });

  it('materialId đơn lẻ vẫn vào fallbackMaterials', () => {
    const out = build({ materialId: 'solo' });
    expect(out[0].materials).toEqual([{ materialId: 'solo' }]);
  });

  it('không options, không material/stone → mảng rỗng', () => {
    expect(build({})).toEqual([]);
  });

  it('option có materials riêng → không bị đè bởi fallback', () => {
    const out = build({
      options: [{ optionName: 'PA1', materials: [{ materialId: 'own' }] }],
      materialIds: ['fallback'],
    });
    expect(out[0].materials).toEqual([{ materialId: 'own' }]);
  });
});

describe('QuoteRequestsService.resolveWalkInCustomerId — chống race', () => {
  it('P2002 khi create → tra lại, trả bản đã có', async () => {
    const existing = { id: 'walk-in-1' };
    const prisma = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(existing),
        create: jest
          .fn()
          .mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            }),
          ),
      },
    };
    const svc = new QuoteRequestsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const id = await (svc as any).resolveWalkInCustomerId(undefined);
    expect(id).toBe('walk-in-1');
  });
});

describe('QuoteRequestsService.remove', () => {
  let svc: any;
  let prisma: any;
  let auditLog: any;
  let realtimeGateway: any;

  beforeEach(() => {
    prisma = {
      quoteRequest: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditLog = { logActionByUserId: jest.fn() };
    realtimeGateway = { broadcastStatusChanged: jest.fn() };

    svc = new QuoteRequestsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      auditLog,
      {} as any,
      realtimeGateway,
      {} as any,
    );
  });

  it('SALE xóa đơn của chính mình, status: PENDING -> resolve, delete được gọi 1 lần', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale1', status: 'PENDING' });
    await svc.remove('req1', 'sale1', 'SALE');
    expect(prisma.quoteRequest.delete).toHaveBeenCalledTimes(1);
    expect(auditLog.logActionByUserId).toHaveBeenCalledWith('sale1', 'DELETE_QUOTE', 'req1');
  });

  it('SALE xóa đơn có requesterId khác -> reject ForbiddenException, delete không được gọi', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale2', status: 'PENDING' });
    await expect(svc.remove('req1', 'sale1', 'SALE')).rejects.toThrow('Bạn không có quyền hủy yêu cầu báo giá này');
    expect(prisma.quoteRequest.delete).not.toHaveBeenCalled();
  });

  it('ADMIN xóa đơn của người khác, status: PROCESSING -> resolve', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale1', status: 'PROCESSING' });
    await svc.remove('req1', 'admin1', 'ADMIN');
    expect(prisma.quoteRequest.delete).toHaveBeenCalledTimes(1);
  });

  it('SALE (là người tạo) xóa đơn status: REJECTED -> reject ConflictException, delete không được gọi', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale1', status: 'REJECTED' });
    await expect(svc.remove('req1', 'sale1', 'SALE')).rejects.toThrow('Yêu cầu đã bị từ chối — không thể hủy, đây là hồ sơ lịch sử');
    expect(prisma.quoteRequest.delete).not.toHaveBeenCalled();
  });

  it('ADMIN xóa đơn status: QUOTED -> resolve (đơn đã báo giá không còn bị khóa thành hồ sơ lịch sử)', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale1', status: 'QUOTED' });
    await svc.remove('req1', 'admin1', 'ADMIN');
    expect(prisma.quoteRequest.delete).toHaveBeenCalledTimes(1);
  });
});

describe('QuoteRequestsService — đơn đã hủy', () => {
  let svc: any;
  let prisma: any;
  let realtimeGateway: any;
  let workflowService: any;

  beforeEach(() => {
    prisma = {
      quoteRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    realtimeGateway = { broadcastStatusChanged: jest.fn() };
    workflowService = { updateStatus: jest.fn() };
    svc = new QuoteRequestsService(
      prisma,
      {} as any,
      {} as any,
      workflowService,
      { logActionByUserId: jest.fn() } as any,
      {} as any,
      realtimeGateway,
      {} as any,
    );
  });

  describe('remove (xóa cứng)', () => {
    it('SALE (kể cả người tạo hay người khác) → 404 y hệt đơn không tồn tại, không xóa', async () => {
      for (const requesterId of ['sale1', 'sale2']) {
        prisma.quoteRequest.findUnique.mockResolvedValue({
          requesterId,
          status: 'CANCELLED',
        });
        await expect(svc.remove('req1', 'sale1', 'SALE')).rejects.toThrow(
          'Không tìm thấy yêu cầu báo giá',
        );
      }
      expect(prisma.quoteRequest.delete).not.toHaveBeenCalled();
    });

    it('ADMIN → 409 "hồ sơ lịch sử" (hủy là để giữ hồ sơ, như REJECTED), không xóa', async () => {
      prisma.quoteRequest.findUnique.mockResolvedValue({
        requesterId: 'sale1',
        status: 'CANCELLED',
      });
      await expect(svc.remove('req1', 'admin1', 'ADMIN')).rejects.toThrow(
        'hồ sơ lịch sử',
      );
      expect(prisma.quoteRequest.delete).not.toHaveBeenCalled();
    });
  });

  describe('update (sửa yêu cầu)', () => {
    const cancelled = (requesterId = 'sale1') => ({
      requesterId,
      status: 'CANCELLED',
      requester: {},
    });

    it('SALE (chủ đơn hoặc không) → 400 "không tồn tại" y hệt đơn không có thật, không ghi', async () => {
      for (const requesterId of ['sale1', 'sale2']) {
        prisma.quoteRequest.findUnique.mockResolvedValue(cancelled(requesterId));
        await expect(
          svc.update('req1', 'sale1', 'SALE', {} as any),
        ).rejects.toThrow('Yêu cầu báo giá không tồn tại');
      }
      expect(prisma.quoteRequest.update).not.toHaveBeenCalled();
    });

    it('ADMIN → 400 "đã bị hủy", không ghi', async () => {
      prisma.quoteRequest.findUnique.mockResolvedValue(cancelled());
      await expect(
        svc.update('req1', 'admin1', 'ADMIN', {} as any),
      ).rejects.toThrow('đã bị hủy');
      expect(prisma.quoteRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('kết quả CANCELLED được chuyển nguyên cho gateway — gateway là nơi tách người nhận theo role', async () => {
      workflowService.updateStatus.mockResolvedValue({
        id: 'q1',
        status: 'CANCELLED',
      });
      await svc.updateStatus('q1', 'admin1', 'ADMIN', { action: 'CANCEL' });
      expect(realtimeGateway.broadcastStatusChanged).toHaveBeenCalledWith(
        'q1',
        'CANCELLED',
      );
    });
  });
});
