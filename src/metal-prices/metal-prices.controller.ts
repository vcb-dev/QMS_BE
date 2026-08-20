import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MetalPricesService } from './metal-prices.service';
import { MetalPrices } from './dto/metal-prices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('metal-prices')
export class MetalPricesController {
  constructor(private readonly metalPricesService: MetalPricesService) {}

  @Get()
  getLatest() {
    return this.metalPricesService.getLatest();
  }

  /** Cập nhật giá vàng/bạc thủ công, lưu vào DB — chỉ ORDER / ADMIN */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORDER, Role.ADMIN)
  @Post()
  updatePrices(@Body() prices: Partial<MetalPrices>) {
    return this.metalPricesService.updatePrices(prices);
  }
}
