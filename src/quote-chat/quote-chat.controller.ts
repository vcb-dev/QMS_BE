import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { QuoteChatService } from './quote-chat.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { APP_CONSTANTS } from '../common/constants';

@UseGuards(JwtAuthGuard)
@Controller('quote-chat')
export class QuoteChatController {
  constructor(
    private readonly quoteChatService: QuoteChatService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // Đứng TRƯỚC route :quoteRequestId/messages cho dễ đọc, nhưng không xung đột — path này chỉ 1
  // segment sau /quote-chat, còn route kia bắt buộc 2 segment (/:id/messages).
  @Get('unread-counts')
  async getUnreadCounts(
    @Query('ids') ids: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    const quoteRequestIds = (ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.quoteChatService.getUnreadCounts(userId, quoteRequestIds);
  }

  @Get(':quoteRequestId/messages')
  async getMessages(
    @Param('quoteRequestId') quoteRequestId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.quoteChatService.getMessages(quoteRequestId, userId);
  }

  @Post(':quoteRequestId/upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: APP_CONSTANTS.MAX_FILE_SIZE },
    }),
  )
  async uploadImage(
    @Param('quoteRequestId') quoteRequestId: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.quoteChatService.assertParticipant(quoteRequestId, userId);
    const uploaded = await this.cloudinaryService.uploadImage(
      file as Express.Multer.File,
    );
    return { imageUrl: uploaded.url };
  }
}
