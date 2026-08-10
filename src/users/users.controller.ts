import { Controller, Get, Param, Patch, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users - Quản lý Người dùng')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Lấy tất cả danh sách người dùng' })
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({ summary: 'Lấy danh sách tài khoản CHỜ ADMIN PHÊ DUYỆT (ADMIN)' })
  @Roles(Role.ADMIN)
  @Get('pending')
  async findPending() {
    return this.usersService.findPending();
  }

  @ApiOperation({ summary: 'Lấy thông tin người dùng theo ID' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Phê duyệt tài khoản người dùng (ADMIN)' })
  @Roles(Role.ADMIN)
  @Patch(':id/approve')
  async approveUser(
    @Param('id') id: string,
    @Body('role') role?: Role,
  ) {
    return this.usersService.approveUser(id, role);
  }

  @ApiOperation({ summary: 'Từ chối & Xóa tài khoản chờ duyệt (ADMIN)' })
  @Roles(Role.ADMIN)
  @Delete(':id/reject')
  async rejectUser(@Param('id') id: string) {
    return this.usersService.rejectUser(id);
  }
}
