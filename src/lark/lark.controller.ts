import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LarkService } from './lark.service';
import {
  CreateLarkWebhookDto,
  ListLarkWebhookDto,
  UpdateLarkWebhookDto,
} from './dto/lark-webhook.dto';
import { UpdateDmBridgeDto } from './dto/lark-dm-bridge.dto';

@ApiTags('Cấu hình thông báo Lark (ADMIN)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('lark-webhooks')
export class LarkController {
  constructor(private readonly service: LarkService) {}

  @ApiOperation({ summary: 'Danh mục hành động có thể đăng ký nhận thông báo' })
  @Get('actions')
  getActions() {
    return this.service.getActionCatalog();
  }

  @ApiOperation({ summary: 'Danh sách người từng cập nhật webhook (lọc)' })
  @Get('updaters')
  updaters() {
    return this.service.listUpdaters();
  }

  @ApiOperation({ summary: 'Trạng thái cầu trả lời qua Lark DM' })
  @Get('dm-bridge')
  getDmBridge() {
    return this.service.getBridgeStatus();
  }

  @ApiOperation({ summary: 'Danh sách webhook Lark (lọc + phân trang ở BE)' })
  @Get()
  list(@Query() query: ListLarkWebhookDto) {
    return this.service.list(query);
  }

  @ApiOperation({ summary: 'Thêm webhook Lark' })
  @Post()
  create(@Body() dto: CreateLarkWebhookDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @ApiOperation({ summary: 'Bật/tắt cầu trả lời qua Lark DM' })
  @Patch('dm-bridge')
  setDmBridge(
    @Body() dto: UpdateDmBridgeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.setBridgeEnabled(dto.isEnabled, dto.note, userId);
  }

  @ApiOperation({ summary: 'Cập nhật webhook Lark' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLarkWebhookDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @ApiOperation({ summary: 'Xóa webhook Lark' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Gửi tin thử qua webhook' })
  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.service.sendTest(id);
  }
}
