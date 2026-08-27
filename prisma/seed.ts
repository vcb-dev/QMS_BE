import { PrismaClient, Role, StoneType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Bắt đầu khởi tạo dữ liệu mẫu (Seeding)...');

  // 1. TẠO PHÒNG BAN (Departments)
  console.log('📌 1. Tạo phòng ban...');
  const deptBGD = await prisma.department.upsert({
    where: { name: 'Ban Giám Đốc' },
    update: {},
    create: { name: 'Ban Giám Đốc' },
  });

  const deptSale = await prisma.department.upsert({
    where: { name: 'Phòng Kinh Doanh' },
    update: {},
    create: { name: 'Phòng Kinh Doanh' },
  });

  const deptPricing = await prisma.department.upsert({
    where: { name: 'Phòng Báo Giá & Đơn Hàng' },
    update: {},
    create: { name: 'Phòng Báo Giá & Đơn Hàng' },
  });

  // 2. TẠO TÀI KHOẢN MẪU (Users: Admin, Sale, Pricing/Order)
  console.log('📌 2. Tạo tài khoản mẫu (Admin / Sale / Order)...');
  const passwordHash = await bcrypt.hash('123456', 10);

  const users = [
    {
      email: 'admin@vcb.vn',
      name: 'Ban Giám Đốc',
      role: Role.ADMIN,
      departmentId: deptBGD.id,
      isApproved: true,
      isActive: true,
      passwordHash,
    },
    {
      email: 'sale@vcb.vn',
      name: 'Nguyễn Văn Sale',
      role: Role.SALE,
      departmentId: deptSale.id,
      isApproved: true,
      isActive: true,
      passwordHash,
    },
    {
      email: 'pricing@vcb.vn',
      name: 'Trần Văn Order',
      role: Role.ORDER,
      departmentId: deptPricing.id,
      isApproved: true,
      isActive: true,
      passwordHash,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        departmentId: u.departmentId,
        isApproved: true,
        isActive: true,
        passwordHash: u.passwordHash,
      },
      create: u,
    });
  }

  // 2b. TẠO CÔNG THỨC TÍNH LÃI (PricingFormula) — gắn theo NHÓM, nhiều chất liệu dùng chung 1
  // công thức. Thêm chất liệu/kim loại mới sau này chỉ cần trỏ tới công thức có sẵn hoặc tạo
  // công thức mới qua UI, không cần sửa code tính giá.
  console.log('📌 2b. Tạo công thức tính lãi...');
  const marginTiersFormula = await prisma.pricingFormula.upsert({
    where: { name: 'Bậc lợi nhuận theo chi phí' },
    update: {},
    create: {
      name: 'Bậc lợi nhuận theo chi phí',
      formulaType: 'MARGIN_TIERS',
      isDefault: true, // Dùng làm công thức mặc định tính lãi phần Đá
      config: {
        tiers: [
          { maxCost: 2000000, divisor: 0.55, margin: '45%' },
          { maxCost: 5000000, divisor: 0.6, margin: '40%' },
          { maxCost: 10000000, divisor: 0.65, margin: '35%' },
          { maxCost: 20000000, divisor: 0.7, margin: '30%' },
          { maxCost: 50000000, divisor: 0.75, margin: '25%' },
          { maxCost: 999999999999, divisor: 0.8, margin: '20%' },
        ],
      },
    },
  });

  const silverMultiplierFormula = await prisma.pricingFormula.upsert({
    where: { name: 'Hệ số nhân Bạc' },
    update: {},
    create: {
      name: 'Hệ số nhân Bạc',
      formulaType: 'MULTIPLIER',
      isDefault: false,
      config: { multipliers: [2.5, 3] },
    },
  });

  // 3. TẠO CHẤT LIỆU MẪU (Materials) — % tính giá (priceRatioPct) và công thức tính lãi lưu
  // thẳng trên từng chất liệu: Vàng theo tuổi = % thực áp dụng, Bạc/Bạch kim = 100%
  console.log('📌 3. Tạo danh mục chất liệu kim loại...');
  const materials = [
    {
      name: 'Vàng 10K',
      priceRatioPct: 40,
      pricingFormulaId: marginTiersFormula.id,
    },
    {
      name: 'Vàng 14K',
      priceRatioPct: 58,
      pricingFormulaId: marginTiersFormula.id,
    },
    {
      name: 'Vàng 18K',
      priceRatioPct: 75,
      pricingFormulaId: marginTiersFormula.id,
    },
    {
      name: 'Vàng 24K (9999)',
      priceRatioPct: 99.9,
      pricingFormulaId: marginTiersFormula.id,
    },
    {
      name: 'Bạc 925',
      priceRatioPct: 100,
      pricingFormulaId: silverMultiplierFormula.id,
    },
    {
      name: 'Bạch Kim (Pt950)',
      priceRatioPct: 100,
      pricingFormulaId: marginTiersFormula.id,
    },
  ];

  for (const m of materials) {
    await prisma.material.upsert({
      where: { name: m.name },
      update: {
        priceRatioPct: m.priceRatioPct,
        pricingFormulaId: m.pricingFormulaId,
      },
      create: m,
    });
  }

  // 4. TẠO DANH MỤC SẢN PHẨM (Product Categories) — vatRate giờ nằm theo danh mục, thay cho
  // PricingConfig.defaultVatRate cũ (1 giá trị global duy nhất cho cả hệ thống)
  console.log('📌 4. Tạo danh mục sản phẩm...');
  const categories = [
    { name: 'Nhẫn Nữ', laborCost: 500000, vatRate: 10 },
    { name: 'Nhẫn Nam', laborCost: 600000, vatRate: 10 },
    { name: 'Dây Chuyền', laborCost: 700000, vatRate: 10 },
    { name: 'Lắc Tay / Vòng Tay', laborCost: 650000, vatRate: 10 },
    { name: 'Bông Tai', laborCost: 450000, vatRate: 10 },
    { name: 'Mặt Dây Chuyền', laborCost: 500000, vatRate: 10 },
    { name: 'Kiềng Cưới', laborCost: 1200000, vatRate: 10 },
  ];

  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { name: cat.name },
      update: { laborCost: cat.laborCost, vatRate: cat.vatRate },
      create: {
        name: cat.name,
        laborCost: cat.laborCost,
        vatRate: cat.vatRate,
      },
    });
  }

  // 5. TẠO BẢNG GIÁ ĐÁ MẪU (Stones)
  console.log('📌 5. Tạo danh mục đá...');
  const stones = [
    {
      stoneType: StoneType.MAIN,
      name: 'Moissanite Tròn 5.0mm (0.5ct)',
      cut: 'Round',
      size: '5.0mm',
      price: 450000,
    },
    {
      stoneType: StoneType.MAIN,
      name: 'Moissanite Tròn 6.5mm (1.0ct)',
      cut: 'Round',
      size: '6.5mm',
      price: 950000,
    },
    {
      stoneType: StoneType.MAIN,
      name: 'Moissanite Tròn 7.2mm (1.5ct)',
      cut: 'Round',
      size: '7.2mm',
      price: 1650000,
    },
    {
      stoneType: StoneType.MAIN,
      name: 'Moissanite Tròn 8.0mm (2.0ct)',
      cut: 'Round',
      size: '8.0mm',
      price: 2500000,
    },
    {
      stoneType: StoneType.MAIN,
      name: 'Đá CZ Tròn 5.0mm',
      cut: 'Round',
      size: '5.0mm',
      price: 50000,
    },
    {
      stoneType: StoneType.MAIN,
      name: 'Đá CZ Tròn 6.5mm',
      cut: 'Round',
      size: '6.5mm',
      price: 80000,
    },
    {
      stoneType: StoneType.SIDE,
      name: 'Đá tấm Moissanite 1.2mm',
      cut: 'Round',
      size: '1.2mm',
      price: 25000,
    },
    {
      stoneType: StoneType.SIDE,
      name: 'Đá tấm Moissanite 1.5mm',
      cut: 'Round',
      size: '1.5mm',
      price: 35000,
    },
    {
      stoneType: StoneType.SIDE,
      name: 'Đá tấm Moissanite 1.8mm',
      cut: 'Round',
      size: '1.8mm',
      price: 45000,
    },
    {
      stoneType: StoneType.SIDE,
      name: 'Đá tấm CZ 1.2mm',
      cut: 'Round',
      size: '1.2mm',
      price: 5000,
    },
    {
      stoneType: StoneType.SIDE,
      name: 'Đá tấm CZ 1.5mm',
      cut: 'Round',
      size: '1.5mm',
      price: 8000,
    },
  ];

  const existingStones = await prisma.stone.count();
  if (existingStones === 0) {
    for (const st of stones) {
      await prisma.stone.create({ data: st });
    }
  }

  // 6. TẠO KIM LOẠI GỐC + GIÁ KHỞI TẠO (BaseMetal + BaseMetalPriceHistory — bảng lịch sử, chỉ seed nếu chưa có kim loại gốc nào)
  console.log('📌 6. Khởi tạo danh mục kim loại gốc & giá thị trường...');
  const existingBaseMetal = await prisma.baseMetal.count();
  if (existingBaseMetal === 0) {
    const baseMetalSeeds = [
      { name: 'Vàng 24K', isDefault: true, priceVnd: 13900000 },
      { name: 'Bạc', isDefault: false, priceVnd: 1200000 },
      { name: 'Bạch kim', isDefault: false, priceVnd: 6000000 },
    ];
    for (const bm of baseMetalSeeds) {
      await prisma.baseMetal.create({
        data: {
          name: bm.name,
          isDefault: bm.isDefault,
          priceHistory: {
            create: {
              priceVnd: bm.priceVnd,
              source: 'giá khởi tạo mặc định',
              isActive: true,
            },
          },
        },
      });
    }
  }

  // PricingConfig (bảng cấu hình global cũ) đã xóa hoàn toàn — VAT giờ nằm theo danh mục sản
  // phẩm (bước 4), profitMargins/silverMultipliers nằm ở PricingFormula (bước 2b)

  // 8. TẠO DỮ LIỆU ĐỊA GIỚI HÀNH CHÍNH (Provinces & Wards từ doc/data.json)
  console.log(
    '📌 8. Nạp dữ liệu 34 Tỉnh/Thành & các Xã/Phường từ doc/data.json...',
  );
  const possiblePaths = [
    path.resolve(__dirname, '../../doc/data.json'),
    path.resolve(process.cwd(), '../doc/data.json'),
    path.resolve(process.cwd(), 'doc/data.json'),
    'D:/VCB/Pricing/doc/data.json',
  ];

  let dataFilePath = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      dataFilePath = p;
      break;
    }
  }

  if (!dataFilePath) {
    console.warn('⚠️ Không tìm thấy file doc/data.json!');
  } else {
    console.log(`📖 Đọc dữ liệu từ: ${dataFilePath}`);
    const rawData = fs.readFileSync(dataFilePath, 'utf-8');
    const provincesData: Array<{
      province_code: string;
      name: string;
      short_name?: string;
      code?: string;
      place_type?: string;
      wards?: Array<{
        ward_code: string;
        name: string;
        province_code?: string;
      }>;
    }> = JSON.parse(rawData);

    console.log(
      `📍 Tìm thấy ${provincesData.length} Tỉnh/Thành phố trong data.json.`,
    );

    let totalWardsCount = 0;

    for (const p of provincesData) {
      const provinceName: string = (p.name || p.short_name || '').trim();
      const provinceCode: string | undefined =
        (p.code || p.province_code || '').trim() || undefined;

      if (!provinceName) continue;

      const province = await prisma.province.upsert({
        where: { name: provinceName },
        update: { code: provinceCode },
        create: {
          name: provinceName,
          code: provinceCode,
        },
      });

      if (Array.isArray(p.wards) && p.wards.length > 0) {
        // Lấy danh sách mã ward đã có của tỉnh này để tránh trùng
        const existingWards = await prisma.ward.findMany({
          where: { provinceId: province.id },
          select: { name: true, code: true },
        });
        const existingKeys = new Set(
          existingWards.map((w) => `${w.name}_${w.code || ''}`),
        );

        const wardsToCreate = p.wards
          .filter((w) => !existingKeys.has(`${w.name}_${w.ward_code || ''}`))
          .map((w) => ({
            name: w.name,
            code: w.ward_code || null,
            provinceId: province.id,
          }));

        if (wardsToCreate.length > 0) {
          // Chia thành các chunk 500 items để insert nhanh
          const chunkSize = 500;
          for (let i = 0; i < wardsToCreate.length; i += chunkSize) {
            const chunk = wardsToCreate.slice(i, i + chunkSize);
            await prisma.ward.createMany({
              data: chunk,
            });
          }
          totalWardsCount += wardsToCreate.length;
        }
      }
    }

    console.log(
      `✅ Đã nạp thành công ${provincesData.length} Tỉnh/Thành phố và ${totalWardsCount} Xã/Phường vào cơ sở dữ liệu!`,
    );
  }

  console.log('🎉 Hoàn tất Seeding dữ liệu!');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed dữ liệu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
