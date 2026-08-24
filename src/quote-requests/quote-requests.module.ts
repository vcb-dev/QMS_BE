import { Module } from '@nestjs/common';
import { QuoteRequestsService } from './quote-requests.service';
import { QuoteQueryService } from './quote-query.service';
import { QuoteWorkflowService } from './quote-workflow.service';
import { QuoteRequestsController } from './quote-requests.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MailModule } from '../mail/mail.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ExcelModule } from '../excel/excel.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { LarkModule } from '../lark/lark.module';

@Module({
  imports: [
    CloudinaryModule,
    MailModule,
    AuditLogModule,
    ExcelModule,
    RealtimeModule,
    LarkModule,
  ],
  controllers: [QuoteRequestsController],
  providers: [QuoteRequestsService, QuoteQueryService, QuoteWorkflowService],
  exports: [QuoteRequestsService, QuoteQueryService, QuoteWorkflowService],
})
export class QuoteRequestsModule {}
