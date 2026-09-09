import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PricingFormulasService } from './pricing-formulas.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import {
  CreatePricingFormulaDto,
  UpdatePricingFormulaDto,
} from './dto/pricing-formula.dto';

// Công thức tính lãi — lộ ra "cấu tạo giá vốn/lợi nhuận" nên chỉ ORDER/ADMIN được xem, giống pricing-config
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORDER, Role.ADMIN)
@Controller('pricing-formulas')
export class PricingFormulasController {
  constructor(
    private readonly pricingFormulasService: PricingFormulasService,
  ) {}

  @Get()
  findAll() {
    return this.pricingFormulasService.findAll();
  }

  @Post()
  create(
    @Body() dto: CreatePricingFormulaDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.pricingFormulasService.create(dto, actorId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePricingFormulaDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.pricingFormulasService.update(id, dto, actorId);
  }
}
