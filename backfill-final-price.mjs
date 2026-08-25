// qms_be/backfill-final-price.mjs
// Chạy 1 lần sau khi áp migration 20260825d_final_price_denorm — set finalOptionId/finalPrice
// cho toàn bộ quote_requests đã tồn tại trước migration. Dùng ĐÚNG rule pickPrimaryOption
// (CLOSED > SELECTED > option có giá mới nhất theo createdAt asc).
// Chạy: node backfill-final-price.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function pickPrimaryOption(options) {
  if (options.length === 0) return null;
  const closed = options.find((o) => o.selectionStatus === 'CLOSED');
  if (closed) return closed;
  const selected = options.find((o) => o.selectionStatus === 'SELECTED');
  if (selected) return selected;
  const priced = options.filter((o) => o.quotedPrice != null);
  if (priced.length > 0) return priced[priced.length - 1];
  return options[0];
}

async function main() {
  const requests = await prisma.quoteRequest.findMany({
    select: {
      id: true,
      options: {
        select: { id: true, quotedPrice: true, selectionStatus: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  console.log(`Tổng ${requests.length} quote_requests cần backfill.`);
  let updated = 0;
  for (const r of requests) {
    const primary = pickPrimaryOption(r.options);
    await prisma.quoteRequest.update({
      where: { id: r.id },
      data: {
        finalOptionId: primary?.id ?? null,
        finalPrice: primary?.quotedPrice ?? null,
      },
    });
    updated += 1;
    if (updated % 100 === 0) console.log(`Đã backfill ${updated}/${requests.length}`);
  }
  console.log(`Hoàn tất — đã backfill ${updated}/${requests.length} quote_requests.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
