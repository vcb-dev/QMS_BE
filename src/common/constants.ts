import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredNumberEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`Environment variable ${name} must be a number`);
  return value;
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
  VNAPPMONEY_TOKEN_URL: requiredEnv('VNAPPMONEY_API_KEY'),
  VNAPPMONEY_GOLD_URL: requiredEnv('VNAPPMONEY_GOLD_URL'),
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
    MATERIAL_TTL:60_000,

};
