import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

// Không import AuthModule (xem ghi chú ở ProfileService) — chỉ cần Cloudinary + AuditLog, giống cách
// UsersModule import AuditLogModule.
@Module({
  imports: [CloudinaryModule, AuditLogModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
