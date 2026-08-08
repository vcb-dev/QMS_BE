import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
      ],
    });
  }

  async onModuleInit() {
    const t0 = Date.now();
    await this.$connect();
    this.logger.log(`$connect() took ${Date.now() - t0}ms`);

    // @ts-expect-error - Prisma event typing
    this.$on('query', (e: any) => {
      if (e.duration > 50) {
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