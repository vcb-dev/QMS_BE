import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  LibraryProductsQueryDto,
  LibraryHistoryQueryDto,
} from '../dto/library-products-query.dto';
import { LibraryService } from './library.service';

// Giữ prefix 'quote-requests' để KHÔNG đổi URL FE đang gọi (/quote-requests/library-products,
// /quote-requests/library-history). Controller này PHẢI đứng TRƯỚC QuoteRequestsController trong
// mảng `controllers` của module — nếu không, route @Get(':id') của QuoteRequestsController sẽ nuốt
// mất /quote-requests/library-* (khớp id = "library-products").
@ApiTags('Quote Requests - Thư Viện Sản Phẩm')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quote-requests')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @ApiOperation({
    summary:
      'Danh sách sản phẩm đã báo giá (Thư viện) — gộp nhóm theo libraryGroupKey, sort/phân trang thật ở SQL',
  })
  @Roles(Role.SALE, Role.ORDER, Role.ADMIN)
  @Get('library-products')
  async getLibraryProducts(@Query() dto: LibraryProductsQueryDto) {
    return this.libraryService.getLibraryProducts(dto);
  }

  @ApiOperation({
    summary:
      'Lịch sử báo giá của 1 sản phẩm Thư Viện (lazy load khi mở modal) — phân trang theo đơn',
  })
  @Roles(Role.SALE, Role.ORDER, Role.ADMIN)
  @Get('library-history')
  async getLibraryProductHistory(@Query() dto: LibraryHistoryQueryDto) {
    return this.libraryService.getLibraryProductHistory(dto);
  }
}
