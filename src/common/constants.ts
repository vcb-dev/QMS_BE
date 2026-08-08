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
  CORS_ORIGINS: requiredEnv('FRONTEND_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  EXCHANGE_RATE_API_URL: requiredEnv('EXCHANGE_RATE_API_URL'),
  GOLD_API_URL: requiredEnv('GOLD_API_URL'),

  CHI_GRAMS: 3.75,
  TROY_OZ_GRAMS: 31.1034768,
  DEFAULT_EXCHANGE_RATE: 26150,

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
