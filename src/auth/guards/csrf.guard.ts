import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { COOKIE_CSRF } from '../cookie.constants';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Kiểm tra route có gắn @SkipCsrf() không (ở cả method và class)
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Bỏ qua các request chỉ đọc dữ liệu (Safe Methods)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const csrfCookie = request.cookies?.[COOKIE_CSRF];
    const csrfHeader = request.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ForbiddenException(
        'CSRF Token không hợp lệ hoặc bị thiếu trong Header X-CSRF-Token',
      );
    }

    return true;
  }
}