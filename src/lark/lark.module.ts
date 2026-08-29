import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LarkService } from './lark.service';

@Module({
  imports: [ConfigModule],
  providers: [LarkService],
  exports: [LarkService],
})
export class LarkModule {}
