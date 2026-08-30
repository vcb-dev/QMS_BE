import {
  Controller,
  Get,
  Param,
  Patch,
  Delete,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TimeRangeQueryDto } from '../common/time-range-query.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users - Quản lý Người dùng')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Lấy tất cả danh sách người dùng' })
  @Get()
  async findAll(@Query() query: TimeRangeQueryDto) {
    return this.usersService.findAll(query);
  }

  @ApiOperation({
    summary: 'Lấy danh sách tài khoản CHỜ ADMIN PHÊ DUYỆT (ADMIN)',
  })
  @Roles(Role.ADMIN)
  @Get('pending')
  async findPending() {
    return this.usersService.findPending();
  }

  @ApiOperation({
    summary:
      'Thống kê tổng hợp người dùng (tổng số, theo vai trò, theo bộ phận, chờ duyệt)',
  })
  @Get('stats')
  async getStats(@Query() query: TimeRangeQueryDto) {
    return this.usersService.getStats(query);
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
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
    @Body('role') role?: Role,
  ) {
    return this.usersService.approveUser(id, actorId, actorRole, role);
  }

  @ApiOperation({ summary: 'Từ chối & Xóa tài khoản chờ duyệt (ADMIN)' })
  @Roles(Role.ADMIN)
  @Delete(':id/reject')
  async rejectUser(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
  ) {
    return this.usersService.rejectUser(id, actorId, actorRole);
  }

  @ApiOperation({ summary: 'Khóa / mở khóa tài khoản (ADMIN)' })
  @Roles(Role.ADMIN)
  @Patch(':id/active')
  async setActive(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') actorRole: Role,
    @Body('isActive') isActive: boolean,
  ) {
    return this.usersService.setActive(id, isActive, actorId, actorRole);
  }
}
