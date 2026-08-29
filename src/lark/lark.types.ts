// Dữ liệu đầu vào để dựng Lark message card cho thông báo "đã báo giá".
// Consumer: QuoteWorkflowService.buildQuoteCardData() gói dữ liệu này rồi đưa cho LarkService.

export interface QuoteCardOption {
  name: string;
  materialText: string; // "Vàng 24K (1.2 chỉ)" | "" nếu không rõ
  materialPrice: number;
  stoneText: string; // "2v Kim cương" | "Không đính đá"
  stonePrice: number; // 0 nếu không đá
  quotedPrice: number;
}

export interface QuoteCardData {
  code: string;
  categoryName: string;
  productName: string;
  customerName: string;
  customerPhone: string | null;
  saleName: string;
  orderName: string;
  imageUrl: string | null;
  options: QuoteCardOption[];
  totalPrice: number | null;
  requestId: string;
}
