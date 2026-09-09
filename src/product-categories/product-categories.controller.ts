import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ProductCategoriesService } from './product-categories.service';
import { CreateProductCategoryDto, UpdateProductCategoryDto, UpdateProductCategoriesBulkDto, DeleteProductCategoriesDto } from './dto/product-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly categoriesService: ProductCategoriesService) {}

  @Get()
  async findAll() {
    return this.categoriesService.findAll();
  }

  @Roles(Role.ORDER, Role.ADMIN)
  @Post()
  async create(@Body() dto: CreateProductCategoryDto) {
    return this.categoriesService.create(dto.name, dto.laborCost, dto.vatRate);
  }

  // Lưu tiền công/VAT nhiều danh mục cùng lúc (1 API call) — phải khai TRƯỚC @Patch(':id') để không bị route ':id' nuốt mất
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch('bulk')
  async updateBulk(@Body() dto: UpdateProductCategoriesBulkDto) {
    return this.categoriesService.updateMany(dto.items);
  }

  // Tiền công/VAT theo danh mục sản phẩm — Sale dùng giá này khi báo giá, chỉ ORDER/ADMIN sửa được
  @Roles(Role.ORDER, Role.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductCategoryDto) {
    return this.categoriesService.update(id, {
      laborCost: dto.laborCost,
      vatRate: dto.vatRate,
    });
  }

  @Roles(Role.ORDER, Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }

  // Xóa nhiều danh mục cùng lúc — dùng khi FE "chốt" các dòng đã đánh dấu xóa lúc bấm Lưu cấu hình
  @Roles(Role.ORDER, Role.ADMIN)
  @Post('delete-many')
  async removeMany(@Body() dto: DeleteProductCategoriesDto) {
    return this.categoriesService.removeMany(dto.ids);
  }
}
