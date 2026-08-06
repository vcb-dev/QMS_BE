import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { QuoteRequestsService } from './quote-requests.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role, User } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(private readonly quoteRequestsService: QuoteRequestsService) {}

  @Roles(Role.SALE, Role.ADMIN)
  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateQuoteRequestDto,
  ) {
    return this.quoteRequestsService.create(userId, dto);
  }

  @Get()
  async findAll(
    @Query() filterDto: FilterQuoteRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.quoteRequestsService.findAll(filterDto, user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.quoteRequestsService.findOne(id);
  }

  @Roles(Role.SALE, Role.ADMIN)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateQuoteRequestDto,
  ) {
    return this.quoteRequestsService.update(id, userId, dto);
  }

  @Roles(Role.SALE, Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quoteRequestsService.remove(id, userId);
  }

  @Roles(Role.SALE, Role.PRICING, Role.ADMIN)
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quoteRequestsService.updateStatus(id, userId, role, dto);
  }
}
