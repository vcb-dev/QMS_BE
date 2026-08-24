// Phân loại chất liệu theo tên (Vàng/Bạc/Bạch kim) dùng chung cho lúc tính giá (chọn giá kim loại
// gốc nào để nhân priceRatioPct) và lúc dựng ticker giá vàng tham khảo — cùng 1 quy tắc suy luận
// từ tên, không lặp lại logic match chuỗi ở nhiều nơi.
export type MaterialMetalType = 'GOLD' | 'SILVER' | 'PLATINUM' | 'OTHER';

export function classifyMaterialType(name: string): MaterialMetalType {
  const upper = (name || '').trim().toUpperCase();
  if (upper.includes('PLATINUM') || upper.includes('BẠCH KIM')) {
    return 'PLATINUM';
  }
  if (
    (upper.includes('BẠC') && !upper.includes('BẠCH')) ||
    upper.includes('SILVER') ||
    upper.includes('925')
  ) {
    return 'SILVER';
  }
  if (
    upper.includes('VÀNG') ||
    upper.includes('GOLD') ||
    /\d+K\b/.test(upper)
  ) {
    return 'GOLD';
  }
  return 'OTHER';
}
