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

