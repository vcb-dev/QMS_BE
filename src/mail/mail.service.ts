import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

const mailer: typeof sgMail = typeof (sgMail as any)?.setApiKey === 'function' ? sgMail : (sgMail as any)?.default || sgMail;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly fromEmail: string;
  private readonly fromName = 'VCB Jewelry Pricing System';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API');
    if (apiKey) {
      mailer.setApiKey(apiKey);
    } else {
      this.logger.warn('SENDGRID_API key is not set. Emails will not be sent.');
    }
    this.fromEmail = this.config.get<string>('SENDGRID_FROM_EMAIL', 'noreply@vcbjewelry.com');
  }

  private async send(to: string, subject: string, html: string) {
    try {
      await mailer.send({
        to,
        from: { email: this.fromEmail, name: this.fromName },
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${to}: ${error?.message}`, error?.response?.body);
    }
  }

  // ─── 1. WELCOME EMAIL (Đăng ký tài khoản) ─────────────────────────────────
  async sendWelcome(to: string, name: string) {
    const subject = '🎉 Chào mừng bạn đến với VCB Jewelry Pricing System';
    const html = `
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
      .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%); padding: 40px 32px; text-align: center; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; }
      .header p { color: #94a3b8; margin: 8px 0 0; font-size: 13px; }
      .body { padding: 36px 32px; }
      .body h2 { color: #0f172a; font-size: 18px; font-weight: 700; margin: 0 0 12px; }
      .body p { color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
      .feature-list { background: #f8fafc; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
      .feature-list li { color: #334155; font-size: 13.5px; margin-bottom: 8px; list-style: none; padding-left: 4px; }
      .feature-list li::before { content: '✅ '; }
      .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>💎 VCB Jewelry Pricing</h1>
        <p>Hệ thống quản lý báo giá trang sức chuyên nghiệp</p>
      </div>
      <div class="body">
        <h2>Xin chào, ${name}! 👋</h2>
        <p>Tài khoản của bạn đã được tạo thành công trên <strong>VCB Jewelry Pricing System</strong>. Bạn có thể bắt đầu sử dụng hệ thống ngay bây giờ.</p>
        <div class="feature-list">
          <ul>
            <li>Gửi và quản lý yêu cầu báo giá</li>
            <li>Theo dõi tiến trình xử lý đơn hàng</li>
            <li>Xem thư viện sản phẩm đã báo giá</li>
            <li>Nhận thông báo qua email về trạng thái đơn</li>
          </ul>
        </div>
        <p>Nếu bạn có bất kỳ thắc mắc nào, vui lòng liên hệ bộ phận hỗ trợ.</p>
        <p style="color:#64748b; font-size:13px;">Trân trọng,<br><strong>Đội ngũ VCB Jewelry</strong></p>
      </div>
      <div class="footer">© 2026 VCB Jewelry. Email này được gửi tự động, vui lòng không phản hồi.</div>
    </div>
    </body></html>`;
    return this.send(to, subject, html);
  }

  // ─── 2. FORGOT PASSWORD OTP ───────────────────────────────────────────────
  async sendForgotPasswordOtp(to: string, name: string, otp: string) {
    const subject = '🔑 Mã OTP đặt lại mật khẩu - VCB Jewelry';
    const html = `
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
      .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); padding: 40px 32px; text-align: center; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 800; }
      .header p { color: #ddd6fe; margin: 8px 0 0; font-size: 13px; }
      .body { padding: 36px 32px; text-align: center; }
      .body h2 { color: #0f172a; font-size: 18px; font-weight: 700; margin: 0 0 12px; }
      .body p { color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
      .otp-box { background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border: 2px dashed #7c3aed; border-radius: 16px; padding: 32px; margin: 24px 0; }
      .otp-code { font-size: 48px; font-weight: 900; color: #5b21b6; letter-spacing: 12px; font-family: 'Courier New', monospace; }
      .otp-expire { font-size: 12px; color: #7c3aed; margin-top: 10px; font-weight: 600; }
      .warning { background: #fff7ed; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px 16px; text-align: left; font-size: 13px; color: #92400e; margin-top: 20px; }
      .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>🔑 Đặt lại mật khẩu</h1>
        <p>VCB Jewelry Pricing System</p>
      </div>
      <div class="body">
        <h2>Xin chào, ${name}!</h2>
        <p>Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Sử dụng mã OTP bên dưới:</p>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
          <div class="otp-expire">⏱ Mã có hiệu lực trong 15 phút</div>
        </div>
        <div class="warning">
          ⚠️ <strong>Lưu ý bảo mật:</strong> Không chia sẻ mã OTP này với bất kỳ ai. VCB Jewelry sẽ không bao giờ yêu cầu mã OTP của bạn qua điện thoại hoặc email.
        </div>
        <p style="color:#64748b; font-size:13px; margin-top:20px;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
      </div>
      <div class="footer">© 2026 VCB Jewelry. Email này được gửi tự động, vui lòng không phản hồi.</div>
    </div>
    </body></html>`;
    return this.send(to, subject, html);
  }

  // ─── 3. QUOTE COMPLETED (Báo giá thành công) ────────────────────────────
  async sendQuoteCompleted(to: string, name: string, quoteCode: string, quotedPrice: number, productName: string) {
    const subject = `✅ Yêu cầu ${quoteCode} đã được báo giá - VCB Jewelry`;
    const priceFormatted = quotedPrice > 0 ? quotedPrice.toLocaleString('en-US') + ' đ' : 'Liên hệ trực tiếp';
    const html = `
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
      .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #064e3b 0%, #065f46 100%); padding: 40px 32px; text-align: center; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 800; }
      .header p { color: #a7f3d0; margin: 8px 0 0; font-size: 13px; }
      .badge { background: #10b981; color: #fff; display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 20px; }
      .body { padding: 36px 32px; }
      .body h2 { color: #0f172a; font-size: 18px; font-weight: 700; margin: 0 0 12px; }
      .body p { color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
      .info-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
      .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #dcfce7; font-size: 13.5px; }
      .info-row:last-child { border-bottom: none; }
      .info-label { color: #6b7280; font-weight: 600; }
      .info-value { color: #0f172a; font-weight: 700; }
      .price-value { color: #059669; font-size: 20px; font-weight: 900; }
      .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>✅ Báo Giá Hoàn Tất</h1>
        <p>Yêu cầu của bạn đã được xử lý thành công</p>
      </div>
      <div class="body">
        <div style="text-align:center"><span class="badge">ĐÃ BÁO GIÁ</span></div>
        <h2>Xin chào, ${name}!</h2>
        <p>Yêu cầu báo giá của bạn đã được bộ phận Pricing xử lý thành công. Dưới đây là thông tin chi tiết:</p>
        <div class="info-card">
          <div class="info-row"><span class="info-label">Mã yêu cầu</span><span class="info-value">${quoteCode}</span></div>
          <div class="info-row"><span class="info-label">Sản phẩm</span><span class="info-value">${productName}</span></div>
          <div class="info-row"><span class="info-label">Giá báo (đã VAT)</span><span class="price-value">${priceFormatted}</span></div>
        </div>
        <p>Vui lòng đăng nhập vào hệ thống để xem chi tiết báo giá và xác nhận đơn hàng.</p>
        <p style="color:#64748b; font-size:13px;">Trân trọng,<br><strong>Đội ngũ Pricing VCB Jewelry</strong></p>
      </div>
      <div class="footer">© 2026 VCB Jewelry. Email này được gửi tự động, vui lòng không phản hồi.</div>
    </div>
    </body></html>`;
    return this.send(to, subject, html);
  }

  // ─── 4. QUOTE REJECTED (Từ chối) ─────────────────────────────────────────
  async sendQuoteRejected(to: string, name: string, quoteCode: string, productName: string, reason: string) {
    const subject = `❌ Yêu cầu ${quoteCode} đã bị từ chối - VCB Jewelry`;
    const html = `
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
      .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%); padding: 40px 32px; text-align: center; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 800; }
      .header p { color: #fca5a5; margin: 8px 0 0; font-size: 13px; }
      .badge { background: #ef4444; color: #fff; display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 20px; }
      .body { padding: 36px 32px; }
      .body h2 { color: #0f172a; font-size: 18px; font-weight: 700; margin: 0 0 12px; }
      .body p { color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
      .info-card { background: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
      .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #fee2e2; font-size: 13.5px; }
      .info-row:last-child { border-bottom: none; }
      .info-label { color: #6b7280; font-weight: 600; }
      .info-value { color: #0f172a; font-weight: 700; }
      .reason-box { background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 14px 16px; font-size: 13.5px; color: #7f1d1d; margin-top: 4px; font-style: italic; }
      .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>❌ Yêu Cầu Bị Từ Chối</h1>
        <p>VCB Jewelry Pricing System</p>
      </div>
      <div class="body">
        <div style="text-align:center"><span class="badge">TỪ CHỐI</span></div>
        <h2>Xin chào, ${name}!</h2>
        <p>Rất tiếc, yêu cầu báo giá của bạn đã bị từ chối bởi bộ phận Pricing. Dưới đây là chi tiết:</p>
        <div class="info-card">
          <div class="info-row"><span class="info-label">Mã yêu cầu</span><span class="info-value">${quoteCode}</span></div>
          <div class="info-row"><span class="info-label">Sản phẩm</span><span class="info-value">${productName}</span></div>
          <div class="info-row" style="flex-direction:column">
            <span class="info-label" style="margin-bottom:8px">Lý do từ chối</span>
            <div class="reason-box">"${reason}"</div>
          </div>
        </div>
        <p>Nếu bạn cần thêm thông tin hoặc muốn tạo yêu cầu mới, vui lòng đăng nhập vào hệ thống.</p>
        <p style="color:#64748b; font-size:13px;">Trân trọng,<br><strong>Đội ngũ VCB Jewelry</strong></p>
      </div>
      <div class="footer">© 2026 VCB Jewelry. Email này được gửi tự động, vui lòng không phản hồi.</div>
    </div>
    </body></html>`;
    return this.send(to, subject, html);
  }

  // ─── 5. NEED MORE INFO (Yêu cầu bổ sung) ────────────────────────────────
  async sendNeedMoreInfo(to: string, name: string, quoteCode: string, productName: string, reason: string) {
    const subject = `📋 Yêu cầu ${quoteCode} cần bổ sung thêm thông tin - VCB Jewelry`;
    const html = `
    <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
      .container { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #78350f 0%, #92400e 100%); padding: 40px 32px; text-align: center; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; font-weight: 800; }
      .header p { color: #fde68a; margin: 8px 0 0; font-size: 13px; }
      .badge { background: #f59e0b; color: #fff; display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 20px; }
      .body { padding: 36px 32px; }
      .body h2 { color: #0f172a; font-size: 18px; font-weight: 700; margin: 0 0 12px; }
      .body p { color: #475569; font-size: 14px; line-height: 1.7; margin: 0 0 16px; }
      .info-card { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
      .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #fef3c7; font-size: 13.5px; }
      .info-row:last-child { border-bottom: none; }
      .info-label { color: #6b7280; font-weight: 600; }
      .info-value { color: #0f172a; font-weight: 700; }
      .reason-box { background: #fef9ec; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 14px 16px; font-size: 13.5px; color: #78350f; margin-top: 4px; font-style: italic; }
      .action-note { background: #eff6ff; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #1d4ed8; margin-top: 16px; }
      .footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    </style>
    </head><body>
    <div class="container">
      <div class="header">
        <h1>📋 Cần Bổ Sung Thông Tin</h1>
        <p>VCB Jewelry Pricing System</p>
      </div>
      <div class="body">
        <div style="text-align:center"><span class="badge">CẦN BỔ SUNG</span></div>
        <h2>Xin chào, ${name}!</h2>
        <p>Bộ phận Pricing đã xem xét yêu cầu báo giá của bạn và cần bạn <strong>bổ sung thêm thông tin</strong> để có thể xử lý tiếp.</p>
        <div class="info-card">
          <div class="info-row"><span class="info-label">Mã yêu cầu</span><span class="info-value">${quoteCode}</span></div>
          <div class="info-row"><span class="info-label">Sản phẩm</span><span class="info-value">${productName}</span></div>
          <div class="info-row" style="flex-direction:column">
            <span class="info-label" style="margin-bottom:8px">Thông tin cần bổ sung</span>
            <div class="reason-box">"${reason}"</div>
          </div>
        </div>
        <div class="action-note">
          💡 <strong>Hành động cần thực hiện:</strong> Vui lòng đăng nhập vào hệ thống, mở lại yêu cầu <strong>${quoteCode}</strong>, cập nhật thông tin theo yêu cầu và gửi lại để tiếp tục xử lý.
        </div>
        <p style="color:#64748b; font-size:13px; margin-top:20px;">Trân trọng,<br><strong>Đội ngũ Pricing VCB Jewelry</strong></p>
      </div>
      <div class="footer">© 2026 VCB Jewelry. Email này được gửi tự động, vui lòng không phản hồi.</div>
    </div>
    </body></html>`;
    return this.send(to, subject, html);
  }
}
