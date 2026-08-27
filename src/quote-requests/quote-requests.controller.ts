import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { QuoteRequestsService } from './quote-requests.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import {
  LibraryProductsQueryDto,
  LibraryHistoryQueryDto,
} from './dto/library-products-query.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { ExportQuoteRequestDto } from './dto/export-quote-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role, User } from '@prisma/client';
import { QuoteQueryService } from './quote/quote-query.service';
import { QuoteAnalyticsService } from './quote/quote-analytics.service';
import { QuoteWorkflowService } from './quote/quote-workflow.service';

@ApiTags('Quote Requests - Quản lý Báo giá')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(
    private readonly quoteRequestsService: QuoteRequestsService,
    private readonly quoteQueryService: QuoteQueryService,
    private readonly quoteAnalyticsService: QuoteAnalyticsService,
    private readonly quoteWorkflowService: QuoteWorkflowService,
  ) {}

  @ApiOperation({
    summary: 'Tạo mới yêu cầu báo giá (SALE / ADMIN)',
    description: 'Tự động validate & upload 100% ảnh lên Cloudinary',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(Role.SALE, Role.ADMIN)
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'files', maxCount: 5 },
      { name: 'video', maxCount: 1 },
    ]),
  )
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateQuoteRequestDto,
    @UploadedFiles()
    uploaded?: { files?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.quoteRequestsService.create(
      userId,
      dto,
      uploaded?.files,
      uploaded?.video?.[0],
    );
  }

  @ApiOperation({
    summary: 'Lấy danh sách yêu cầu báo giá (Có lọc & phân trang)',
  })
  @Get()
  async findAll(
    @Query() filterDto: FilterQuoteRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.quoteQueryService.findAll(filterDto, user);
  }

  @ApiOperation({
    summary:
      'Lấy số liệu tổng hợp (đếm & doanh thu) theo bộ lọc — không kéo danh sách item',
  })
  @Get('stats')
  async getStats(
    @Query() filterDto: FilterQuoteRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.quoteAnalyticsService.getStats(filterDto, user);
  }

  @ApiOperation({
    summary:
      'Lấy dữ liệu 6 biểu đồ/bảng của Dashboard (timeline, sale ranking, phân bố danh mục/chất liệu/giá, sản phẩm nổi bật)',
  })
  @Get('dashboard-charts')
  async getDashboardCharts(
    @Query() filterDto: FilterQuoteRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.quoteAnalyticsService.getDashboardCharts(filterDto, user);
  }

  @ApiOperation({
    summary:
      'Hiệu suất Sale (tổng đơn/đã chốt/tỷ lệ chốt) + hiệu suất người báo giá (thời gian TB)',
  })
  @Get('staff-performance')
  async getStaffPerformance() {
    return this.quoteAnalyticsService.getStaffPerformance();
  }

  @ApiOperation({
    summary:
      'Danh sách sản phẩm đã báo giá (Thư viện) — gộp trùng theo dedupKey, sort/phân trang thật ở SQL',
  })
  @Get('library-products')
  async getLibraryProducts(@Query() dto: LibraryProductsQueryDto) {
    return this.quoteQueryService.getLibraryProducts(dto);
  }

  @ApiOperation({
    summary:
      'Lịch sử báo giá của 1 sản phẩm Thư Viện (lazy load khi mở modal) — phân trang theo đơn',
  })
  @Get('library-history')
  async getLibraryProductHistory(@Query() dto: LibraryHistoryQueryDto) {
    return this.quoteQueryService.getLibraryProductHistory(dto);
  }

  @ApiOperation({
    summary: 'Export danh sách yêu cầu báo giá ra Excel (Có lọc & chọn cột)',
  })
  @Get('export')
  async exportToExcel(
    @Query() dto: ExportQuoteRequestDto,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.quoteRequestsService.exportToExcel(dto, user);
    const filename = `bao-gia-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  @ApiOperation({ summary: 'Lấy chi tiết yêu cầu báo giá theo ID' })
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser('role') role: Role) {
    return this.quoteQueryService.findOne(id, role);
  }

  @ApiOperation({ summary: 'Cập nhật yêu cầu báo giá (SALE / ADMIN)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(Role.SALE, Role.ADMIN)
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'files', maxCount: 5 },
      { name: 'video', maxCount: 1 },
    ]),
  )
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateQuoteRequestDto,
    @UploadedFiles()
    uploaded?: { files?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.quoteRequestsService.update(
      id,
      userId,
      role,
      dto,
      uploaded?.files,
      uploaded?.video?.[0],
    );
  }

  @ApiOperation({ summary: 'Hủy yêu cầu báo giá (SALE / ADMIN)' })
  @Roles(Role.SALE, Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quoteRequestsService.remove(id, userId);
  }

  @ApiOperation({
    summary:
      'Chuyển trạng thái yêu cầu báo giá tập trung (Bao gồm Duyệt nhanh QUICK_APPROVE & QUICK_REJECT)',
  })
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quoteRequestsService.updateStatus(id, userId, role, dto);
  }

  @ApiOperation({
    summary: 'Xóa 1 phương án báo giá không muốn đề xuất (ORDER / ADMIN)',
  })
  @Roles(Role.ORDER, Role.ADMIN)
  @Delete(':id/options/:optionId')
  async deleteOption(
    @Param('id') id: string,
    @Param('optionId') optionId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.quoteRequestsService.deleteOption(id, optionId, userId, role);
  }
}
