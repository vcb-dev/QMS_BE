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

  it('không options nhưng có materialIds → 1 option "Yêu cầu ban đầu"', () => {
    const out = build({ materialIds: ['m1', 'm2'], defaultVat: 8 });
    expect(out).toHaveLength(1);
    expect(out[0].optionName).toBe('Yêu cầu ban đầu');
    expect(out[0].materials).toEqual([
      { materialId: 'm1' },
      { materialId: 'm2' },
    ]);
    expect(out[0].vat).toBe(8);
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

  it('SALE (là người tạo) xóa đơn status: CLOSED -> reject ConflictException, delete không được gọi', async () => {
    prisma.quoteRequest.findUnique.mockResolvedValue({ requesterId: 'sale1', status: 'CLOSED' });
    await expect(svc.remove('req1', 'sale1', 'SALE')).rejects.toThrow('Yêu cầu đã chốt hoặc đã bị từ chối');
    expect(prisma.quoteRequest.delete).not.toHaveBeenCalled();
  });
});
