import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Start seeding PostgreSQL database...');

  // 1. Seed Pricing Config
  await prisma.pricingConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      goldRatios: [
        { key: 'GOLD_10K', standard: 0.417, applied: 0.47, label: 'Vàng 10K (Áp dụng 47%)' },
        { key: 'GOLD_14K', standard: 0.583, applied: 0.64, label: 'Vàng 14K (Áp dụng 64%)' },
        { key: 'GOLD_18K', standard: 0.750, applied: 0.80, label: 'Vàng 18K (Áp dụng 80%)' },
        { key: 'GOLD_24K', standard: 0.999, applied: 1.05, label: 'Vàng 24K (Áp dụng 105%)' },
        { key: 'GOLD_610', standard: 0.610, applied: 0.66, label: 'Vàng 610 (Áp dụng 66%)' },
      ],
      profitMargins: [
        { maxCost: 10_000_000, divisor: 0.65, margin: '35% (÷ 0.65)' },
        { maxCost: 50_000_000, divisor: 0.70, margin: '30% (÷ 0.70)' },
        { maxCost: 999_999_999_999, divisor: 0.75, margin: '25% (÷ 0.75)' },
      ],
      silverMultiplier: 3,
    },
  });
  console.log('✅ Seeded PricingConfig');

  // 2. Seed Metal Prices
  await prisma.metalPrice.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      gold24kVnd: 13900000,
      silverVnd: 1200000,
      platinumVnd: 0,
      source: 'giá tham khảo thị trường (Vàng 24K & Bạc)',
    },
  });
  console.log('✅ Seeded MetalPrice');

  console.log('🎉 Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
