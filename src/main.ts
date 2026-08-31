import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { APP_CONSTANTS } from './common/constants';

import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Bắt buộc để PrismaService.onModuleDestroy() ($disconnect) chạy khi app tắt/restart —
  // thiếu dòng này thì watch-mode restart liên tục sẽ để lại connection treo trên DB pool
  // (Supabase session-mode pooler giới hạn cứng số client, dễ bị full sau vài lần restart).
  app.enableShutdownHooks();

  // Cấu hình tăng giới hạn Dung lượng Body Request hỗ trợ tải ảnh Base64 & File lớn (50MB)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Bảo mật HTTP Headers nâng cao bằng Helmet
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hidePoweredBy: true,
      noSniff: true,
      xssFilter: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  // Đọc HttpOnly Cookies từ request
  app.use(cookieParser());

  // CORS hỗ trợ gửi/nhận Cookie từ Frontend
  // Danh sách origin lấy từ APP_CONSTANTS.CORS_ORIGINS (requiredEnv('FRONTEND_URL') — thiếu env là
  // crash ngay lúc khởi động, KHÔNG âm thầm rơi về localhost ở prod). Hỗ trợ nhiều origin phân tách
  // bằng dấu phẩy.
  app.enableCors({
    origin: APP_CONSTANTS.CORS_ORIGINS,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('VCB QMS API Documentation')
    .setDescription(
      'Hệ thống Quản lý Yêu cầu & Báo giá Trang sức VCB QMS (NestJS + Prisma + PostgreSQL)',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Nhập token thu được sau khi đăng nhập',
        in: 'header',
      },
      'JWT-auth',
    )
    .addCookieAuth('crmspd_at')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 8000;
  await app.listen(port);
  console.log(
    `🚀 Swagger UI documentation running at http://localhost:${port}/api/docs`,
  );
}
bootstrap();
