import { SetMetadata } from '@nestjs/common';

// Đánh dấu tường minh 1 controller/route KHÔNG cần đăng nhập là chủ ý (dữ liệu tra cứu công khai),
// phân biệt với "quên gắn @UseGuards(JwtAuthGuard)". Không có guard global đọc metadata này —
// JwtAuthGuard vẫn opt-in theo từng controller như cũ, decorator này thuần mục đích tài liệu hóa.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
