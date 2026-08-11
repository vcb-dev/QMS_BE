import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';

@ApiTags('Locations - Tỉnh / Xã Phường Việt Nam')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get('provinces')
  @ApiOperation({ summary: 'Lấy danh sách tất cả Tỉnh / Thành phố Việt Nam' })
  async getProvinces() {
    return this.locationsService.getProvinces();
  }

  @Get('wards')
  @ApiOperation({ summary: 'Lấy danh sách Xã / Phường theo Tỉnh / Thành phố (truyền provinceId hoặc provinceName)' })
  @ApiQuery({ name: 'provinceId', required: false, type: String, description: 'ID hoặc Tên của Tỉnh/Thành phố' })
  async getWards(@Query('provinceId') provinceId?: string, @Query('provinceName') provinceName?: string) {
    const queryParam = provinceId || provinceName;
    return this.locationsService.getWardsByProvince(queryParam);
  }
}
