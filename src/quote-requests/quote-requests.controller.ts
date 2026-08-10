import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { QuoteRequestsService } from './quote-requests.service';
import { CreateQuoteRequestDto } from './dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from './dto/update-quote-request.dto';
import { FilterQuoteRequestDto } from './dto/filter-quote-request.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { QuickQuoteSubmitDto } from './dto/quick-quote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role, User } from '@prisma/client';

@ApiTags('Quote Requests - Quản lý Báo giá')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(private readonly quoteRequestsService: QuoteRequestsService) { }

  @ApiOperation({ summary: 'Tạo mới yêu cầu báo giá (SALE / ADMIN)', description: 'Tự động validate & upload 100% ảnh lên Cloudinary' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(Role.SALE, Role.ADMIN)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 5))
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateQuoteRequestDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.quoteRequestsService.create(userId, dto, files);
  }

  @ApiOperation({ summary: 'Gửi yêu cầu Báo Giá Nhanh đến người báo giá / Pricer (SALE / PRICING / ADMIN)' })
  @Post('quick-submit')
  async submitQuickQuote(
    @CurrentUser('id') userId: string,
    @Body() dto: QuickQuoteSubmitDto,
  ) {
    return this.quoteRequestsService.submitQuickQuote(userId, dto);
  }

  @ApiOperation({ summary: 'Lấy danh sách yêu cầu báo giá (Có lọc & phân trang)' })
  @Get()
  async findAll(
    @Query() filterDto: FilterQuoteRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.quoteRequestsService.findAll(filterDto, user);
  }

  @ApiOperation({ summary: 'Lấy chi tiết yêu cầu báo giá theo ID' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.quoteRequestsService.findOne(id);
  }

  @ApiOperation({ summary: 'Cập nhật yêu cầu báo giá (SALE / ADMIN)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @Roles(Role.SALE, Role.ADMIN)
  @Patch(':id')
  @UseInterceptors(FilesInterceptor('files', 5))
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateQuoteRequestDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.quoteRequestsService.update(id, userId, dto, files);
  }

  @ApiOperation({ summary: 'Hủy yêu cầu báo giá (SALE / ADMIN)' })
  @Roles(Role.SALE, Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quoteRequestsService.remove(id, userId);
  }

  @ApiOperation({ summary: 'Chuyển trạng thái yêu cầu báo giá tập trung (Bao gồm Duyệt nhanh QUICK_APPROVE & QUICK_REJECT)' })
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: UpdateQuoteStatusDto,
  ) {
    return this.quoteRequestsService.updateStatus(id, userId, role, dto);
  }
}
