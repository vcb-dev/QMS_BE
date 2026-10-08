import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { TeamsService } from './teams.service';
import { TeamNameDto } from './dto/team-name.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Teams - Quản lý Team người dùng')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @ApiOperation({
    summary:
      'Danh sách team (mọi vai trò). Có page & limit thì phân trang kèm số thành viên, không thì trả mảng đầy đủ',
  })
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    if (page && limit) {
      return this.teamsService.findPaginated(+page, +limit, search);
    }
    return this.teamsService.findAll(search);
  }

  @ApiOperation({ summary: 'Tạo team (ADMIN)' })
  @Roles(Role.ADMIN)
  @Post()
  async create(@Body() dto: TeamNameDto) {
    return this.teamsService.create(dto.name);
  }

  @ApiOperation({ summary: 'Đổi tên team (ADMIN)' })
  @Roles(Role.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: TeamNameDto) {
    return this.teamsService.update(id, dto.name);
  }

  @ApiOperation({
    summary: 'Xóa team (ADMIN) — thành viên chuyển thành "Chưa có team"',
  })
  @Roles(Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.teamsService.remove(id);
  }
}
