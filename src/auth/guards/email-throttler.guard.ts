import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Throttle theo EMAIL trong body thay vì theo IP. Luồng quên/đặt lại mật khẩu bị dò mã OTP
// bằng script — đổi IP là qua được giới hạn theo IP, nhưng email thì cố định vì đó chính là
// tài khoản đang bị nhắm. Fallback về IP khi body không có email.
@Injectable()
export class EmailThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = String(req.body?.email ?? '')
      .trim()
      .toLowerCase();
    return email ? `email:${email}` : req.ip;
  }
}
