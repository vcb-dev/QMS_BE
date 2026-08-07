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

  FALLBACK_USD_VND_RATE: requiredNumberEnv('FALLBACK_USD_VND_RATE'),
  DEFAULT_GOLD_24K_VND: requiredNumberEnv('DEFAULT_GOLD_24K_VND'),
  DEFAULT_SILVER_VND: requiredNumberEnv('DEFAULT_SILVER_VND'),
};
