import {
  Body,
  Controller,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ProfileService } from './profile.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateNameDto } from './dto/update-name.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { APP_CONSTANTS } from '../common/constants';

// KHÔNG dùng @SkipCsrf(): hai endpoint ghi này vẫn qua kiểm tra CSRF (FE tự đính X-CSRF-Token).
@ApiTags('Profile - Hồ sơ cá nhân')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('auth/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @ApiOperation({ summary: 'Đổi họ tên hiển thị của chính mình (1–100 ký tự)' })
  @Patch('name')
  async updateName(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNameDto,
  ) {
    return this.profileService.updateName(userId, dto.name);
  }

  @ApiOperation({
    summary:
      'Đổi ảnh đại diện của chính mình (multipart, trường "file", tối đa 10MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: APP_CONSTANTS.MAX_FILE_SIZE },
    }),
  )
  async updateAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profileService.updateAvatar(userId, file);
  }

  @ApiOperation({
    summary:
      'Đổi mật khẩu của chính mình (sai mật khẩu hiện tại trả 400; thành công thu hồi phiên refresh)',
  })
  // 5 lần / 15 phút như reset-password — chặn dò mật khẩu hiện tại từ một phiên bị chiếm.
  @Throttle({ default: { ttl: 15 * 60 * 1000, limit: 5 } })
  @Patch('password')
  async changePassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.profileService.changePassword(userId, role, dto);
  }
}
