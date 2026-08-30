import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LarkService } from './lark.service';
import { LarkController } from './lark.controller';

@Module({
  imports: [ConfigModule],
  controllers: [LarkController],
  providers: [LarkService],
  exports: [LarkService],
})
export class LarkModule {}
