import { QuoteStatus } from '@prisma/client/wasm';
import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredNumberEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value))
    throw new Error(`Environment variable ${name} must be a number`);
  return value;
}
export interface VnGoldPriceItem {
  key: string;
  label: string;
  priceVnd: number; // đ/chỉ
  changeAmount: number | null;
  changePct: number | null;
}

export interface VangTodaySource {
  code: string; // data-code trên vang.today
  label: string;
}

export const APP_CONSTANTS = {
  PORT: requiredNumberEnv('PORT'),
  JWT_SECRET: requiredEnv('JWT_SECRET'),
  JWT_ACCESS_EXPIRES: requiredEnv('JWT_ACCESS_EXPIRES'),
  JWT_REFRESH_EXPIRES: requiredEnv('JWT_REFRESH_EXPIRES'),
  CORS_ORIGINS: requiredEnv('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  COOKIE_SECURE: process.env['COOKIE_SECURE'] === 'true',
  THROTTLE_TTL: requiredNumberEnv('LOGIN_THROTTLE_TTL'),
  THROTTLE_LIMIT: requiredNumberEnv('LOGIN_THROTTLE_LIMIT'),
  // Lark OAuth (đăng nhập bằng tài khoản Lark) — flow v2, không cần app_access_token
  LARK_OAUTH_AUTHORIZE_URL:
    'https://open.larksuite.com/open-apis/authen/v1/authorize',
  LARK_OAUTH_TOKEN_URL:
    'https://open.larksuite.com/open-apis/authen/v2/oauth/token',
  LARK_USER_INFO_URL:
    'https://open.larksuite.com/open-apis/authen/v1/user_info',
  // Lark app (bot) — dùng cho thông báo báo giá: lấy tenant_access_token rồi upload ảnh sản phẩm
  // để nhúng vào message card (webhook custom bot không nhận URL ảnh, phải có image_key).
  LARK_TENANT_TOKEN_URL:
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
  LARK_IMAGE_UPLOAD_URL: 'https://open.larksuite.com/open-apis/im/v1/images',
  // Gửi / reply tin nhắn qua Lark App (cầu chat web <-> Lark DM).
  LARK_MESSAGE_SEND_URL: 'https://open.larksuite.com/open-apis/im/v1/messages',
  VNAPPMOB_API_KEY: requiredEnv('VNAPPMOB_API_KEY'),
  VNAPPMOB_GOLD_URL: requiredEnv('VNAPPMOB_GOLD_URL'),
  VANG_TODAY_URL: requiredEnv('VANG_TODAY_URL'),
  REFRESH_INTERVAL_MS: 24 * 60 * 60 * 1000, // Tự động gọi lại API ngoài 1 ngày/lần
  TOKEN_TTL_MS: 13 * 24 * 60 * 60 * 1000, // Token vnappmob sống 15 ngày, an toàn refresh sớm hơn

  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/svg+xml',
  ],
  MAX_VIDEO_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  ALLOWED_VIDEO_MIME_TYPES: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo',
    'video/3gpp',
  ],
  MAX_IMPORT_ROWS: 1000,
  MAX_EXPORT_ROWS: 5000,
  QUOTE_STATUS_LABELS: {
    PENDING: 'Yêu cầu mới',
    PROCESSING: 'Đang xử lý',
    NEED_MORE_INFO: 'Cần bổ sung thông tin',
    QUOTED: 'Hoàn thành / Đã báo giá',
    CLOSED: 'Đã chốt',
    REJECTED: 'Bị từ chối',
  },
  VANG_TODAY_SOURCES: [
    { code: 'SJL1L10', label: 'SJC 9999' },
    { code: 'BT9999NTT', label: 'Bảo Tín 9999' },
    { code: 'DOHNL', label: 'DOJI Hà Nội' },
    { code: 'PQHN24NTT', label: 'PNJ 24K' },
  ],

  VANG_TODAY_PATH: '/vi/',
};
