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
import { Role, PricingFormulaType } from '@prisma/client';

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
    @Body('name') name: string,
    @Body('formulaType') formulaType: PricingFormulaType,
    @Body('config') config: unknown,
    @Body('isDefault') isDefault: boolean | undefined,
    @CurrentUser('id') actorId: string,
  ) {
    return this.pricingFormulasService.create(
      { name, formulaType, config, isDefault },
      actorId,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body('name') name: string | undefined,
    @Body('config') config: unknown,
    @Body('isDefault') isDefault: boolean | undefined,
    @CurrentUser('id') actorId: string,
  ) {
    return this.pricingFormulasService.update(
      id,
      { name, config, isDefault },
      actorId,
    );
  }
}
