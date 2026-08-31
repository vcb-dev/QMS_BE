import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

// Bắt lỗi Prisma chưa được service nào catch — trước đây rơi thẳng thành 500 kèm chi tiết query
// (lộ tên bảng/cột). Map các mã lỗi hay gặp sang HTTP đúng nghĩa + thông báo tiếng Việt gọn.
// HttpException tự ném từ service KHÔNG đi qua đây (chỉ @Catch đúng 2 class Prisma bên dưới).
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Lỗi máy chủ khi xử lý dữ liệu';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[] | undefined)?.join(
            ', ',
          );
          message = target
            ? `Dữ liệu đã tồn tại (trùng: ${target})`
            : 'Dữ liệu đã tồn tại trong hệ thống';
          break;
        }
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Không tìm thấy bản ghi cần thao tác';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message =
            'Không thể thao tác — dữ liệu đang được tham chiếu ở nơi khác';
          break;
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          message = 'Giá trị nhập vào vượt quá độ dài cho phép';
          break;
        default:
          this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
      }
    } else {
      // PrismaClientValidationError — sai kiểu/thiếu field ở tầng query, là bug code.
      this.logger.error(`Prisma validation error: ${exception.message}`);
    }

    res.status(status).json({ statusCode: status, message });
  }
}
