import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  async findAll() {
    return this.materialsService.findAll();
  }

  @Roles(Role.ADMIN)
  @Post()
  async create(
    @Body('name') name: string,
    @Body('pricingFormulaId') pricingFormulaId: string,
    @Body('priceRatioPct') priceRatioPct?: number,
    @Body('baseMetalId') baseMetalId?: string,
  ) {
    return this.materialsService.create(
      name,
      pricingFormulaId,
      priceRatioPct,
      baseMetalId,
    );
  }

  // Sửa % tính giá / công thức tính lãi / kim loại gốc của 1 chất liệu — chỉ ORDER/ADMIN, thay
  // cho bảng tỷ lệ vàng + bảng lợi nhuận cũ ở pricing-config
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body('name') name?: string,
    @Body('priceRatioPct') priceRatioPct?: number,
    @Body('pricingFormulaId') pricingFormulaId?: string,
    @Body('baseMetalId') baseMetalId?: string | null,
  ) {
    return this.materialsService.update(id, {
      name,
      priceRatioPct,
      pricingFormulaId,
      baseMetalId,
    });
  }
}
