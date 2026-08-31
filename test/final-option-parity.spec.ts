import { computeFinalOption } from '../src/utils/option-mapper.util';

// ĐẶC TẢ TRIGGER sync_final_option() PHÍA JS.
// SQL trigger thật sống trong DBeaver (migration 20260826_final_option_db_trigger),
// KHÔNG có trong repo. Nếu sửa trigger đó thì PHẢI sửa `pickPrimaryOption` +
// `referenceTriggerLogic` bên dưới cho khớp — đây là chốt canh 2 nguồn sự thật.
// Lưu ý: mảng options truyền vào được giả định đã sắp xếp theo createdAt ASC.
type Opt = {
  id: string;
  quotedPrice: any;
  selectionStatus: string;
  createdAt?: Date;
};

function referenceTriggerLogic(options: Opt[]): {
  finalOptionId: string | null;
  finalPrice: any;
} {
  if (options.length === 0) return { finalOptionId: null, finalPrice: null };

  const closed = options.find((o) => o.selectionStatus === 'CLOSED');
  if (closed)
    return { finalOptionId: closed.id, finalPrice: closed.quotedPrice };

  const selected = options.find((o) => o.selectionStatus === 'SELECTED');
  if (selected)
    return { finalOptionId: selected.id, finalPrice: selected.quotedPrice };

  const priced = options.filter((o) => o.quotedPrice != null);
  if (priced.length > 0) {
    const last = priced[priced.length - 1];
    return { finalOptionId: last.id, finalPrice: last.quotedPrice };
  }

  return {
    finalOptionId: options[0].id,
    finalPrice: options[0].quotedPrice,
  };
}

const D = (n: number) => new Date(2026, 0, n);

const CASES: Opt[][] = [
  // 0: Không có option nào
  [],
  // 1: 1 option chưa có giá
  [{ id: 'a', quotedPrice: null, selectionStatus: 'NONE', createdAt: D(1) }],
  // 2: 2 option, option sau có giá
  [
    { id: 'a', quotedPrice: null, selectionStatus: 'NONE', createdAt: D(1) },
    { id: 'b', quotedPrice: 5, selectionStatus: 'NONE', createdAt: D(2) },
  ],
  // 3: option a SELECTED (cũ hơn), option b NONE
  [
    { id: 'a', quotedPrice: 4, selectionStatus: 'SELECTED', createdAt: D(1) },
    { id: 'b', quotedPrice: 9, selectionStatus: 'NONE', createdAt: D(2) },
  ],
  // 4: option a SELECTED, option b CLOSED -> ưu tiên CLOSED
  [
    { id: 'a', quotedPrice: 4, selectionStatus: 'SELECTED', createdAt: D(1) },
    { id: 'b', quotedPrice: 9, selectionStatus: 'CLOSED', createdAt: D(2) },
  ],
  // 5: toàn chưa có giá (thứ tự createdAt asc: b cũ D(1) trước, a mới D(3) sau)
  [
    { id: 'b', quotedPrice: null, selectionStatus: 'NONE', createdAt: D(1) },
    { id: 'a', quotedPrice: null, selectionStatus: 'NONE', createdAt: D(3) },
  ],
  // 6: option a có giá (cũ), option b chưa có giá (mới) -> lấy option a (cuối cùng có giá)
  [
    { id: 'a', quotedPrice: 3, selectionStatus: 'NONE', createdAt: D(1) },
    { id: 'b', quotedPrice: null, selectionStatus: 'NONE', createdAt: D(5) },
  ],
  // 7: nhiều option có giá -> lấy option có giá mới nhất (c D(3))
  [
    { id: 'a', quotedPrice: 3, selectionStatus: 'NONE', createdAt: D(1) },
    { id: 'b', quotedPrice: 7, selectionStatus: 'NONE', createdAt: D(2) },
    { id: 'c', quotedPrice: 5, selectionStatus: 'NONE', createdAt: D(3) },
  ],
];

describe('computeFinalOption khớp đặc tả trigger sync_final_option', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('case %i', (_i, options) => {
    expect(computeFinalOption(options as any)).toEqual(
      referenceTriggerLogic(options),
    );
  });
});
