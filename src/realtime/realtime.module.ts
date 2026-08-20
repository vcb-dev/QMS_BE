import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../auth/auth.module';
import { QuoteChatModule } from '../quote-chat/quote-chat.module';

@Module({
  imports: [AuthModule, QuoteChatModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
