import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LarkService } from './lark.service';
import { LarkController } from './lark.controller';
import { QuoteChatModule } from '../quote-chat/quote-chat.module';

@Module({
  imports: [ConfigModule, QuoteChatModule],
  controllers: [LarkController],
  providers: [LarkService],
  exports: [LarkService],
})
export class LarkModule {}
