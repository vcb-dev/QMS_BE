import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Customers - Quản lý Khách hàng')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @ApiOperation({ summary: 'Lấy danh sách khách hàng (Có lọc tìm kiếm)' })
  @Get()
  async findAll(@Query('search') search?: string) {
    return this.customersService.findAll(search);
  }

  @ApiOperation({ summary: 'Lấy chi tiết khách hàng theo ID' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @ApiOperation({ summary: 'Tạo mới khách hàng (Tách biệt tỉnh/thành và phường/xã/quận/huyện)' })
  @Post()
  async create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @ApiOperation({ summary: 'Cập nhật thông tin khách hàng' })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @ApiOperation({ summary: 'Xóa khách hàng' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
