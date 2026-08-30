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
  saleName: string;
  saleLarkOpenId: string | null; // có -> field "Sale" trong card là @mention, không -> tên thường
  orderName: string;
  imageUrl: string | null;
  options: QuoteCardOption[];
  totalPrice: number | null;
  requestId: string;
}

// Đầu vào dựng thẻ Lark tóm tắt cho các hành động không phải "đã báo giá".
export interface SummaryCardInput {
  actionLabel: string; // nhãn tiếng Việt của hành động (AUDIT_ACTION_LABELS)
  actorName: string;
  entityType: string | null;
  entityCode: string | null; // mã yêu cầu nếu tra được, ưu tiên hơn entityType/#id
  entityId: string | null;
  detailUrl: string | null;
  at: Date;
}

// ===== Cấu hình webhook Lark (ADMIN) =====

// Bản ghi trả về client — KHÔNG kèm webhookSecret, chỉ hasSecret.
export interface LarkWebhookView {
  id: string;
  chatName: string;
  botName: string | null;
  webhookUrl: string;
  hasSecret: boolean;
  isEnabled: boolean;
  actions: string[]; // các AuditAction đang bật cho webhook này
  updatedByName: string | null;
  updatedAt: string | null;
}
