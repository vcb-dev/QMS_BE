import { Module } from '@nestjs/common';
import { QuoteChatService } from './quote-chat.service';
import { QuoteChatController } from './quote-chat.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CloudinaryModule, AuthModule],
  controllers: [QuoteChatController],
  providers: [QuoteChatService],
  exports: [QuoteChatService],
})
export class QuoteChatModule {}
