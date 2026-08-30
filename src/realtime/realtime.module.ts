import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../auth/auth.module';
import { QuoteChatModule } from '../quote-chat/quote-chat.module';
import { LarkModule } from '../lark/lark.module';

@Module({
  imports: [AuthModule, QuoteChatModule, LarkModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
