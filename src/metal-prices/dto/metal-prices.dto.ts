export class MetalPrices {
  id?: string;
  gold24kVnd: number; // VNĐ / chỉ (3.75g)
  silverVnd: number; // VNĐ / chỉ
  platinumVnd: number; // optional
  // % tăng/giảm của từng kim loại so với lần cập nhật gần nhất trước đó — null nếu là lần đầu tiên
  goldChangePct?: number | null;
  silverChangePct?: number | null;
  platinumChangePct?: number | null;
  isActive?: boolean; // true = giá đang được dùng để tính giá hiện tại
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedAt: string; // ISO timestamp — mốc tạo dòng lịch sử này (createdAt trong DB)
  source: string;
}

// 1 dòng trong lịch sử biến động giá — dùng cho màn xem lại thứ tự các lần đổi giá
export class MetalPriceHistoryItem extends MetalPrices {}
