import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { MetalPricesService } from './metal-prices.service';
import { MetalPrices } from './dto/metal-prices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('metal-prices')
export class MetalPricesController {
  constructor(private readonly metalPricesService: MetalPricesService) {}

  /** Giá gốc dùng để tính giá — Sale không được xem, chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Get()
  getLatest() {
    return this.metalPricesService.getLatest();
  }

  /** Lịch sử các lần đổi giá (mới nhất trước) — biết được thứ tự biến động giá — chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Get('history')
  getHistory(@Query('limit') limit?: string) {
    return this.metalPricesService.getHistory(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /** Cập nhật giá vàng/bạc thủ công — tạo 1 dòng lịch sử mới, không sửa lên dòng cũ — chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post()
  updatePrices(
    @Body() prices: Partial<MetalPrices>,
    @CurrentUser('id') actorId: string,
  ) {
    return this.metalPricesService.updatePrices(prices, { id: actorId });
  }
}
