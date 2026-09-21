/**
 * Dummy env so unit tests can import APP_CONSTANTS without a local .env.
 * Must load before any src/ import (Jest setupFiles).
 */
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '8000';
process.env.JWT_SECRET ??= 'ci-test-jwt-secret';
process.env.JWT_ACCESS_EXPIRES ??= '15m';
process.env.JWT_REFRESH_EXPIRES ??= '7d';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
process.env.LOGIN_THROTTLE_TTL ??= '60';
process.env.LOGIN_THROTTLE_LIMIT ??= '10';
process.env.VNAPPMOB_API_KEY ??= 'ci';
process.env.VNAPPMOB_GOLD_URL ??= 'https://example.com/gold';
process.env.VANG_TODAY_URL ??= 'https://example.com/vang';
process.env.DATABASE_URL ??= 'postgresql://ci:ci@127.0.0.1:5432/ci';
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.COOKIE_SECURE ??= 'false';
