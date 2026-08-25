import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MetalPricesService } from './metal-prices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('metal-prices')
export class MetalPricesController {
  constructor(private readonly metalPricesService: MetalPricesService) {}

  /** Danh mục kim loại gốc kèm giá hiện tại — Sale không được xem, chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Get()
  getLatest() {
    return this.metalPricesService.listBaseMetals();
  }

  /** Lịch sử đổi giá — truyền ?baseMetalId= để lọc theo 1 kim loại, không thì toàn bộ */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Get('history')
  getHistory(
    @Query('baseMetalId') baseMetalId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.metalPricesService.getHistory(
      baseMetalId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** Thêm kim loại gốc mới — chỉ ADMIN, đây là điểm mở rộng chính: thêm ở đây KHÔNG cần sửa code */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post()
  createBaseMetal(@Body('name') name: string) {
    return this.metalPricesService.createBaseMetal(name);
  }

  /** Ngừng dùng / bật lại 1 kim loại gốc — chỉ ADMIN, không xóa cứng (giữ FK từ Material cũ) */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.metalPricesService.setBaseMetalActive(id, isActive);
  }

  /** Cập nhật giá 1 kim loại — tạo 1 dòng lịch sử mới, không sửa lên dòng cũ — chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch(':id/price')
  updatePrice(
    @Param('id') id: string,
    @Body('priceVnd') priceVnd: number,
    @CurrentUser('id') actorId: string,
  ) {
    return this.metalPricesService.updatePrice(id, priceVnd, { id: actorId });
  }
}
