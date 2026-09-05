import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response, Request } from 'express';

// Catch-all — trước đây chỉ bắt lỗi Prisma, lỗi bất ngờ khác (TypeError, lỗi thư viện ngoài...)
// rơi vào filter mặc định của Nest, không log qua Logger của app nên khó truy vết khi debug prod.
//
// Nhánh HttpException PHẢI trả đúng y hệt Nest mặc định (xem
// @nestjs/core/exceptions/base-exception-filter.js) — không thì đổi response shape của MỌI
// `throw new XxxException(...)` đang có sẵn khắp app cùng lúc.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res
        .status(status)
        .json(
          typeof body === 'object' && body !== null
            ? body
            : { statusCode: status, message: body },
        );
      return;
    }

    if (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientValidationError
    ) {
      const { status, message } = mapPrismaError(exception, this.logger);
      res.status(status).json({ statusCode: status, message });
      return;
    }

    // Lỗi thật sự bất ngờ (TypeError, lỗi thư viện ngoài...) — log đủ context để truy vết, KHÔNG
    // trả message/stack thật ra client (tránh lộ chi tiết nội bộ).
    this.logger.error(
      `Unhandled exception at ${req.method} ${req.originalUrl}: ${
        exception instanceof Error ? exception.stack : String(exception)
      }`,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Lỗi hệ thống, vui lòng thử lại sau',
    });
  }
}

function mapPrismaError(
  exception:
    Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
  logger: Logger,
): { status: number; message: string } {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(
          ', ',
        );
        return {
          status: HttpStatus.CONFLICT,
          message: target
            ? `Dữ liệu đã tồn tại (trùng: ${target})`
            : 'Dữ liệu đã tồn tại trong hệ thống',
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Không tìm thấy bản ghi cần thao tác',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message:
            'Không thể thao tác — dữ liệu đang được tham chiếu ở nơi khác',
        };
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Giá trị nhập vào vượt quá độ dài cho phép',
        };
      default:
        logger.error(`Prisma ${exception.code}: ${exception.message}`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Lỗi máy chủ khi xử lý dữ liệu',
        };
    }
  }
  // PrismaClientValidationError — sai kiểu/thiếu field ở tầng query, là bug code.
  logger.error(`Prisma validation error: ${exception.message}`);
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Lỗi máy chủ khi xử lý dữ liệu',
  };
}
