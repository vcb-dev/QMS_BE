import { getSpotPrice } from './pricing-math.util';

describe('getSpotPrice', () => {
  it('trả đúng giá khi baseMetalId có trong map', () => {
    const prices = new Map([['gold-1', 13_000_000]]);
    expect(getSpotPrice('gold-1', prices)).toBe(13_000_000);
  });

  it('trả 0 khi baseMetalId không có trong map', () => {
    const prices = new Map([['gold-1', 13_000_000]]);
    expect(getSpotPrice('silver-1', prices)).toBe(0);
  });

  it('trả 0 khi baseMetalId null (phi kim loại)', () => {
    const prices = new Map([['gold-1', 13_000_000]]);
    expect(getSpotPrice(null, prices)).toBe(0);
  });
});
