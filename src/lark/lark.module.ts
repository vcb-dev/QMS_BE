import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LarkNotificationService } from './lark-notification.service';

@Module({
  imports: [ConfigModule],
  providers: [LarkNotificationService],
  exports: [LarkNotificationService],
})
export class LarkModule {}
