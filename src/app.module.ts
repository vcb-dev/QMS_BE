import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { MaterialsModule } from './materials/materials.module';
import { PricingFormulasModule } from './pricing-formulas/pricing-formulas.module';
import { StonesModule } from './stones/stones.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';
import { CustomersModule } from './customers/customers.module';
import { QuoteRequestsModule } from './quote-requests/quote-requests.module';
import { MetalPricesModule } from './metal-prices/metal-prices.module';
import { VnGoldPriceModule } from './vn-gold-price/vn-gold-price.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { MailModule } from './mail/mail.module';
import { LarkModule } from './lark/lark.module';
import { LocationsModule } from './locations/locations.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { LoggerMiddleware } from './common/logger.middleware';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { ExcelModule } from './excel/excel.module';
import { QuoteChatModule } from './quote-chat/quote-chat.module';
import { RealtimeModule } from './realtime/realtime.module';
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    MaterialsModule,
    PricingFormulasModule,
    StonesModule,
    ProductCategoriesModule,
    CustomersModule,
    QuoteRequestsModule,
    MetalPricesModule,
    VnGoldPriceModule,
    CloudinaryModule,
    MailModule,
    LarkModule,
    LocationsModule,
    AuditLogModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 60,000ms = 1 minute
        limit: 60,
      },
    ]),
    ExcelModule,
    QuoteChatModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
