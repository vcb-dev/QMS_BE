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
import { CreateMaterialDto, UpdateMaterialDto } from './dto/material.dto';
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
  async create(@Body() dto: CreateMaterialDto) {
    return this.materialsService.create(
      dto.name,
      dto.pricingFormulaId,
      dto.priceRatioPct,
      dto.baseMetalId,
    );
  }

  // Sửa % tính giá / công thức tính lãi / kim loại gốc của 1 chất liệu — chỉ ORDER/ADMIN, thay
  // cho bảng tỷ lệ vàng + bảng lợi nhuận cũ ở pricing-config
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.materialsService.update(id, dto);
  }
}
