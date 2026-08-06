import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DepartmentsModule } from './departments/departments.module';
import { MaterialsModule } from './materials/materials.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';
import { CustomersModule } from './customers/customers.module';
import { QuoteRequestsModule } from './quote-requests/quote-requests.module';
import { MetalPricesModule } from './metal-prices/metal-prices.module';
import { PricingConfigModule } from './pricing-config/pricing-config.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    DepartmentsModule,
    MaterialsModule,
    ProductCategoriesModule,
    CustomersModule,
    QuoteRequestsModule,
    MetalPricesModule,
    PricingConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

