import { Module } from '@nestjs/common';
import { StonesService } from './stones.service';
import { StonesController } from './stones.controller';
import { ExcelModule } from 'src/excel/excel.module';

@Module({
  imports: [ExcelModule],
  controllers: [StonesController],
  providers: [StonesService],
  exports: [StonesService],
})
export class StonesModule {}
