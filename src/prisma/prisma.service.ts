import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function stripEnvQuotes(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Supabase transaction pooler (:6543 + pgbouncer) đôi khi trả
 * "cannot execute UPDATE/INSERT in a read-only transaction".
 * Ưu tiên DIRECT_URL / session port :5432 cho runtime Nest (cần ghi).
 */
function preferWritableSessionUrl(url: string): string {
  if (!url) return url;
  return url
    .replace(':6543/', ':5432/')
    .replace(/([?&])pgbouncer=true&?/gi, '$1')
    .replace(/[?&]$/, '')
    .replace(/\?&/, '?');
}

function resolveRuntimeUrl(): string {
  const url = preferWritableSessionUrl(
    stripEnvQuotes(process.env.DATABASE_URL),
  );
  if (!url) return url;
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT) || 20;
  const poolTimeout = Number(process.env.DB_POOL_TIMEOUT) || 20;
  const parts: string[] = [];
  if (!url.includes('connection_limit='))
    parts.push(`connection_limit=${connectionLimit}`);
  if (!url.includes('pool_timeout=')) parts.push(`pool_timeout=${poolTimeout}`);
  if (parts.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + parts.join('&');
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  // Round-trip tới DB ~100-250ms ở môi trường này (ngay cả `SELECT 1`), nên ngưỡng thấp sẽ log
  // gần như mọi query. Chỉ cảnh báo query thực sự chậm. Chỉnh qua SLOW_QUERY_MS.
  private readonly slowQueryMs = Number(process.env.SLOW_QUERY_MS) || 300;

  constructor() {
    super({
      datasourceUrl: resolveRuntimeUrl() || undefined,
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  async onModuleInit() {
    // Railway/Supabase cold start đôi khi chưa reachable ngay — retry backoff thay vì để app chết.
    const attempts = 5;
    for (let i = 1; i <= attempts; i++) {
      try {
        const t0 = Date.now();
        await this.$connect();
        this.logger.log(
          `$connect() took ${Date.now() - t0}ms (lần ${i}/${attempts})`,
        );
        break;
      } catch (e) {
        if (i === attempts) throw e;
        const delay = i * 2_000;
        this.logger.warn(
          `Prisma connect fail (${i}/${attempts}): ${(e as Error).message}. Thử lại sau ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // @ts-expect-error - Prisma event typing
    this.$on('query', (e: any) => {
      if (e.duration > this.slowQueryMs) {
        this.logger.warn(`SLOW QUERY (${e.duration}ms): ${e.query}`);
      } else {
        this.logger.debug(`query (${e.duration}ms): ${e.query}`);
      }
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
