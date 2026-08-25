// qms_be/backfill-dedup-key.mjs
// Chạy 1 lần sau khi áp migration 20260825e_option_dedup_key — set dedup_key cho toàn bộ
// quote_options đã tồn tại trước migration. Công thức GIỐNG HỆT buildOptionCreateInput
// (option-mapper.util.ts).
// Chạy: node backfill-dedup-key.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function computeDedupKey(categoryId, materials, weightChi, stones, stoneDescription, stoneCost) {
  const matKey =
    materials.length > 0
      ? materials.map((m) => `${m.materialId}:${m.weightChi ?? weightChi ?? 0}`).sort().join(',')
      : `:${weightChi || 0}`;
  const stoneKey =
    stones.length > 0
      ? stones.map((s) => `${s.stoneId}:${s.quantity}`).sort().join(',')
      : stoneDescription || (stoneCost ? `cost:${stoneCost}` : 'none');
  return `${categoryId || ''}|${matKey}|${stoneKey}`;
}

async function main() {
  const options = await prisma.quoteOption.findMany({
    select: {
      id: true,
      weightChi: true,
      stoneDescription: true,
      stoneCost: true,
      quoteRequest: { select: { categoryId: true } },
      materials: { select: { materialId: true, weightChi: true } },
      stones: { select: { stoneId: true, quantity: true } },
    },
  });

  console.log(`Tổng ${options.length} quote_options cần backfill.`);
  let updated = 0;
  for (const o of options) {
    const dedupKey = computeDedupKey(
      o.quoteRequest.categoryId,
      o.materials,
      o.weightChi ? Number(o.weightChi) : null,
      o.stones,
      o.stoneDescription,
      o.stoneCost ? Number(o.stoneCost) : null,
    );
    await prisma.quoteOption.update({ where: { id: o.id }, data: { dedupKey } });
    updated += 1;
    if (updated % 200 === 0) console.log(`Đã backfill ${updated}/${options.length}`);
  }
  console.log(`Hoàn tất — đã backfill ${updated}/${options.length} quote_options.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
