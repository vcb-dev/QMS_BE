import { Module } from '@nestjs/common';
import { QuoteRequestsService } from './quote-requests.service';
import { QuoteQueryService } from './quote/quote-query.service';
import { QuoteAnalyticsService } from './quote/quote-analytics.service';
import { QuoteWorkflowService } from './quote/quote-workflow.service';
import { QuoteOptionsService } from './quote-option/quote-options.service';
import { QuoteOptionsController } from './quote-option/quote-options.controller';
import { QuoteRequestsController } from './quote-requests.controller';
import { LibraryService } from './library/library.service';
import { LibraryController } from './library/library.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MailModule } from '../mail/mail.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ExcelModule } from '../excel/excel.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LarkModule } from '../lark/lark.module';
import { MetalPricesModule } from '../metal-prices/metal-prices.module';
import { MaterialsModule } from '../materials/materials.module';
import { PricingFormulasModule } from '../pricing-formulas/pricing-formulas.module';
import { StonesModule } from '../stones/stones.module';

@Module({
  imports: [
    CloudinaryModule,
    MailModule,
    AuditLogModule,
    ExcelModule,
    RealtimeModule,
    LarkModule,
    MetalPricesModule,
    MaterialsModule,
    PricingFormulasModule,
    StonesModule,
  ],
  // LibraryController TRƯỚC QuoteRequestsController: 2 controller cùng prefix 'quote-requests', route
  // /library-products, /library-history phải khớp trước @Get(':id') của QuoteRequestsController.
  controllers: [
    LibraryController,
    QuoteRequestsController,
    QuoteOptionsController,
  ],
  providers: [
    QuoteRequestsService,
    QuoteQueryService,
    QuoteAnalyticsService,
    QuoteWorkflowService,
    QuoteOptionsService,
    LibraryService,
  ],
  exports: [
    QuoteRequestsService,
    QuoteQueryService,
    QuoteAnalyticsService,
    QuoteWorkflowService,
  ],
})
export class QuoteRequestsModule {}
