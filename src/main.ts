import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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
    .setDescription('Hệ thống Quản lý Yêu cầu & Báo giá Trang sức VCB QMS (NestJS + Prisma + PostgreSQL)')
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
  console.log(`🚀 Swagger UI documentation running at http://localhost:${port}/api/docs`);
}
bootstrap();
