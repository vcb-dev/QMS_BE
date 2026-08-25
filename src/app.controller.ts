import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

// Root health-check mặc định NestJS — cố ý không gắn JwtAuthGuard.
@Public()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Health-check thật cho platform deploy — GET / chỉ trả text tĩnh, không phản ánh app còn
  // sống hay không nếu DB chết. Ping thử 1 query rẻ nhất có thể (SELECT 1), không đọc bảng nào.
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
  }
}
