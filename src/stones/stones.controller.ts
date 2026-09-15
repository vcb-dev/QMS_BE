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
import {
  CreateStoneDto,
  UpdateStoneDto,
  UpdateStonePricesDto,
  DeleteStonesDto,
} from './dto/stone.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role, StoneType } from '@prisma/client';

// Chặn ngay ở tầng multer (đuôi file + kích thước) trước khi vào service verify chi tiết từng dòng.
const stoneExcelFileInterceptor = FileInterceptor('file', {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!/\.(xlsx|xls)$/i.test(file.originalname || '')) {
      return cb(
        new BadRequestException('Chỉ chấp nhận file Excel (.xlsx hoặc .xls)'),
        false,
      );
    }
    cb(null, true);
  },
});

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

  // Import bảng giá đá theo lưới shape/size (VD kim cương: dòng 1 = tên đá, dòng 2 = header cột
  // Shape/Size/Đơn giá·carat/Trọng lượng ước tính/Thành tiền) — không có cột Loại/Tên riêng từng
  // dòng, stoneType lấy từ nút bấm (đá chủ/đá tấm) qua query, không đọc từ file. Trùng shape/size
  // với đá đã có thì đè giá mới.
  @UseGuards(RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post('import-price-grid')
  @UseInterceptors(stoneExcelFileInterceptor)
  async importPriceGrid(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('stoneType') stoneType?: StoneType,
  ) {
    if (stoneType !== StoneType.MAIN && stoneType !== StoneType.SIDE) {
      throw new BadRequestException(
        'Thiếu hoặc sai tham số stoneType (MAIN hoặc SIDE)',
      );
    }
    return this.stonesService.importPriceGridFromExcel(file, stoneType);
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
  async updatePrices(@Body() dto: UpdateStonePricesDto) {
    return this.stonesService.updateManyPrices(dto.items);
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
  async removeMany(@Body() dto: DeleteStonesDto) {
    return this.stonesService.removeMany(dto.ids);
  }
}
