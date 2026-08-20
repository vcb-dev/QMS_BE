import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StonesService } from './stones.service';
import { CreateStoneDto, UpdateStoneDto } from './dto/stone.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, StoneType } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('stones')
export class StonesController {
  constructor(private readonly stonesService: StonesService) {}

  @Get()
  async findAll(@Query('stoneType') stoneType?: StoneType) {
    return this.stonesService.findAll(stoneType);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post()
  async create(@Body() dto: CreateStoneDto) {
    return this.stonesService.create(dto);
  }

  // Import bảng giá đá từ file Excel (.xlsx/.xls) — chặn ngay ở tầng multer (đuôi file + kích thước)
  // trước khi vào service verify chi tiết nội dung từng dòng
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        if (!/\.(xlsx|xls)$/i.test(file.originalname || '')) {
          return cb(
            new BadRequestException(
              'Chỉ chấp nhận file Excel (.xlsx hoặc .xls)',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async importFromExcel(@UploadedFile() file?: Express.Multer.File) {
    return this.stonesService.importFromExcel(file);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStoneDto) {
    return this.stonesService.update(id, dto);
  }

  // Lưu giá nhiều viên đá cùng lúc (1 API call thay vì gọi lặp lại từng viên)
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch('prices')
  async updatePrices(@Body('items') items: { id: string; price: number }[]) {
    return this.stonesService.updateManyPrices(items);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.stonesService.remove(id);
  }

  // Xóa nhiều viên đá cùng lúc — dùng khi FE "chốt" các dòng đã đánh dấu xóa lúc bấm Lưu cấu hình
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post('delete-many')
  async removeMany(@Body('ids') ids: string[]) {
    return this.stonesService.removeMany(ids);
  }
}
