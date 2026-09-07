export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(normalizeOrigin).filter(Boolean))];
}

export const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

export function isVercelPreviewOf(
  allowedOrigin: string,
  requestOrigin: string,
): boolean {
  try {
    const allowed = new URL(allowedOrigin);
    const request = new URL(requestOrigin);
    if (
      !allowed.hostname.endsWith('.vercel.app') ||
      !request.hostname.endsWith('.vercel.app')
    ) {
      return false;
    }
    const project = allowed.hostname.slice(0, -'.vercel.app'.length);
    return (
      request.hostname === allowed.hostname ||
      request.hostname.startsWith(`${project}-`)
    );
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(
  origin: string,
  allowed: string[],
): boolean {
  const normalized = normalizeOrigin(origin);
  if (allowed.includes(normalized)) return true;
  return allowed.some((item) => isVercelPreviewOf(item, normalized));
}

export function corsOriginDelegate(allowed: string[]) {
  return (
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin || isAllowedCorsOrigin(origin, allowed)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  };
}

export function primaryFrontendUrl(frontendUrl: string | undefined): string {
  return parseOriginList(frontendUrl)[0] || frontendUrl?.trim() || '';
}
