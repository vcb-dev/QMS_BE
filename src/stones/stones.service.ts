import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoneType } from '@prisma/client';
import { CreateStoneDto, UpdateStoneDto } from './dto/stone.dto';
import { APP_CONSTANTS } from '../common/constants';
import { ExcelService } from 'src/excel/excel.service';
import { CacheWithTtl } from '../common/cache-with-ttl.util';
import { Stone } from '@prisma/client';

function resolveStoneType(
  raw: string,
  normalizeFn: (s: string) => string,
): StoneType | null {
  const v = normalizeFn(String(raw || ''));
  if (['main', 'da chu', 'chu'].includes(v)) return StoneType.MAIN;
  if (['side', 'da tam', 'tam'].includes(v)) return StoneType.SIDE;
  return null;
}

function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw))
    return raw > 0 ? raw : null;
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Injectable()
export class StonesService {
  // Danh mục đá ít đổi, mọi user/role đều đọc — cache toàn bộ danh sách (không lọc), lọc theo
  // stoneType ở tầng in-memory để khỏi phải quản lý nhiều cache key theo từng loại đá.
  private readonly cache = new CacheWithTtl<Stone[]>(
    APP_CONSTANTS.REFERENCE_DATA_TTL,
  );

  constructor(
    private prisma: PrismaService,
    private excelService: ExcelService,
  ) {}

  async findAll(stoneType?: StoneType) {
    let all = this.cache.get();
    if (!all) {
      all = await this.prisma.stone.findMany({ orderBy: { name: 'asc' } });
      this.cache.set(all);
    }
    return stoneType ? all.filter((s) => s.stoneType === stoneType) : all;
  }

  async create(dto: CreateStoneDto) {
    this.cache.clear();
    return this.prisma.stone.create({ data: dto });
  }

  async update(id: string, dto: UpdateStoneDto) {
    const existing = await this.prisma.stone.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy đá');
    this.cache.clear();
    return this.prisma.stone.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.stone.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy đá');
    await this.prisma.stone.delete({ where: { id } });
    this.cache.clear();
    return { message: 'Đã xóa đá thành công' };
  }

  // Lưu giá nhiều viên đá cùng lúc — 1 API call, 1 transaction
  async updateManyPrices(items: { id: string; price: number }[]) {
    if (!items || items.length === 0) return { updated: 0 };
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.stone.update({
          where: { id: it.id },
          data: { price: it.price },
        }),
      ),
    );
    this.cache.clear();
    return { updated: items.length };
  }

  // Xóa nhiều viên đá cùng lúc — chỉ xóa thật khi bấm "Lưu cấu hình" (xóa staged ở FE trước đó)
  async removeMany(ids: string[]) {
    if (!ids || ids.length === 0) return { deleted: 0 };
    const result = await this.prisma.stone.deleteMany({
      where: { id: { in: ids } },
    });
    this.cache.clear();
    return { deleted: result.count };
  }

  async importMany(rows: CreateStoneDto[]) {
    const created = await this.prisma.stone.createMany({ data: rows });
    this.cache.clear();
    return { imported: created.count };
  }

  async importFromExcel(file?: Express.Multer.File) {
    const rawRows = this.excelService.parseExcelFile(file);
    if (rawRows.length > APP_CONSTANTS.MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `File Excel có quá nhiều dòng dữ liệu (${rawRows.length} > ${APP_CONSTANTS.MAX_IMPORT_ROWS})`,
      );
    }
    const firstRowKeys = Object.keys(rawRows[0] || {});
    const findKey = (candidates: string[]) =>
      firstRowKeys.find((k) =>
        candidates.includes(this.excelService.normalizeHeader(k)),
      );
    const keyType = findKey(['loai', 'type', 'stoneType', 'loai da']);
    const keyName = findKey(['ten', 'name', 'stoneName', 'ten da']);
    const keyCut = findKey(['cat', 'cut', 'cutting', 'cat da']);
    const keySize = findKey(['size', 'kich thuoc', 'kichthuoc', 'size da']);
    const keyPrice = findKey(['gia', 'price', 'cost', 'gia da', 'gia tien']);
    const missingCols: string[] = [];
    if (!keyType) missingCols.push('Loại đá');
    if (!keyName) missingCols.push('Tên đá');
    if (!keyPrice) missingCols.push('Giá đá');
    if (missingCols.length > 0) {
      throw new BadRequestException(
        `File Excel thiếu cột dữ liệu bắt buộc: ${missingCols.join(', ')}`,
      );
    }
    const errors: string[] = [];
    const validRows: CreateStoneDto[] = [];
    rawRows.forEach((row, idx) => {
      const excelRowNum = idx + 2;
      const typeRaw = String(row[keyType!] ?? '').trim();
      const nameRaw = String(row[keyName!] ?? '').trim();
      const cutRaw = keyCut ? String(row[keyCut] ?? '').trim() : '';
      const sizeRaw = keySize ? String(row[keySize] ?? '').trim() : '';
      const priceRaw = row[keyPrice!];

      if (!typeRaw && !nameRaw && !priceRaw) return; // Bỏ qua dòng trống

      // Truyền hàm normalizeHeader từ ExcelService vào để so sánh
      const stoneType = resolveStoneType(typeRaw, (s) =>
        this.excelService.normalizeHeader(s),
      );

      if (!stoneType) {
        errors.push(
          `Dòng ${excelRowNum}: cột "Loại" phải là MAIN/Đá chủ hoặc SIDE/Đá tấm (đang là "${typeRaw}")`,
        );
        return;
      }
      if (!nameRaw) {
        errors.push(`Dòng ${excelRowNum}: thiếu "Tên đá"`);
        return;
      }

      const price = parsePrice(priceRaw);
      if (price === null) {
        errors.push(
          `Dòng ${excelRowNum}: "Giá đá" phải là số lớn hơn 0 (đang là "${String(priceRaw)}")`,
        );
        return;
      }

      validRows.push({
        stoneType,
        name: nameRaw,
        cut: cutRaw || undefined,
        size: sizeRaw || undefined,
        price,
      });
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: `File có ${errors.length} dòng lỗi, chưa import dòng nào. Sửa xong upload lại.`,
        errors,
      });
    }
    if (validRows.length === 0) {
      throw new BadRequestException(
        'Không có dòng dữ liệu hợp lệ nào trong file',
      );
    }

    // 5. Lưu vào database
    return this.importMany(validRows);
  }
}
