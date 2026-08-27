import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoneType } from '@prisma/client';
import { CreateStoneDto, UpdateStoneDto } from './dto/stone.dto';
import { APP_CONSTANTS } from '../common/constants';
import { ExcelService } from '../excel/excel.service';
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
      all = await this.prisma.stone.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
      this.cache.set(all);
    }
    return stoneType ? all.filter((s) => s.stoneType === stoneType) : all;
  }

  // "Cùng đá" = cùng loại (chủ/tấm) + cùng tên + cùng giác cắt + cùng size, so sánh không phân
  // biệt hoa/thường và bỏ khoảng trắng thừa — tránh thêm trùng 1 viên đá thành nhiều dòng khác giá.
  private normalizeStoneField(v?: string | null): string {
    return (v || '').trim().toLowerCase();
  }

  private stoneDedupKey(
    stoneType: StoneType,
    name: string,
    cut?: string | null,
    size?: string | null,
  ): string {
    return [
      stoneType,
      this.normalizeStoneField(name),
      this.normalizeStoneField(cut),
      this.normalizeStoneField(size),
    ].join('|');
  }

  private async findDuplicateStone(
    stoneType: StoneType,
    name: string,
    cut?: string | null,
    size?: string | null,
    excludeId?: string,
  ) {
    const candidates = await this.prisma.stone.findMany({
      where: { stoneType },
      select: { id: true, name: true, cut: true, size: true, price: true },
    });
    const key = this.stoneDedupKey(stoneType, name, cut, size);
    return candidates.find(
      (s) =>
        s.id !== excludeId &&
        this.stoneDedupKey(stoneType, s.name, s.cut, s.size) === key,
    );
  }

  async create(dto: CreateStoneDto) {
    const dup = await this.findDuplicateStone(
      dto.stoneType,
      dto.name,
      dto.cut,
      dto.size,
    );
    if (dup) {
      throw new ConflictException(
        `Đá "${dto.name}"${dto.cut ? ` - ${dto.cut}` : ''}${dto.size ? ` - ${dto.size}` : ''} đã tồn tại trong danh mục, vui lòng sửa giá đá cũ thay vì thêm trùng`,
      );
    }
    this.cache.clear();
    return this.prisma.stone.create({ data: dto });
  }

  async update(id: string, dto: UpdateStoneDto) {
    const existing = await this.prisma.stone.findUnique({
      where: { id },
      select: { id: true, stoneType: true, name: true, cut: true, size: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy đá');

    // Sửa tên/cut/size mà trùng với 1 viên đá KHÁC (loại trừ chính nó qua excludeId) thì chặn lại
    // — trùng với chính giá trị cũ của nó (không đổi gì) thì dĩ nhiên không tính là trùng.
    const mergedStoneType = dto.stoneType ?? existing.stoneType;
    const mergedName = dto.name ?? existing.name;
    const mergedCut = dto.cut ?? existing.cut;
    const mergedSize = dto.size ?? existing.size;
    const dup = await this.findDuplicateStone(
      mergedStoneType,
      mergedName,
      mergedCut,
      mergedSize,
      id,
    );
    if (dup) {
      throw new ConflictException(
        `Đá "${mergedName}"${mergedCut ? ` - ${mergedCut}` : ''}${mergedSize ? ` - ${mergedSize}` : ''} đã tồn tại trong danh mục, vui lòng sửa giá đá đó thay vì tạo trùng`,
      );
    }

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
    const found = await this.prisma.stone.findMany({
      where: { id: { in: items.map((it) => it.id) } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((s) => s.id));
    const missingIds = items
      .map((it) => it.id)
      .filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Không tìm thấy đá với id: ${missingIds.join(', ')}`,
      );
    }
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

  // Bỏ qua dòng trùng (cùng loại + tên + cut + size) với đá đã có sẵn HOẶC trùng với dòng khác
  // ngay trong cùng file Excel đang import — không lưu bất kỳ dòng trùng nào.
  async importMany(rows: CreateStoneDto[]) {
    const existing = await this.prisma.stone.findMany({
      select: { stoneType: true, name: true, cut: true, size: true },
    });
    const seenKeys = new Set(
      existing.map((s) =>
        this.stoneDedupKey(s.stoneType, s.name, s.cut, s.size),
      ),
    );
    const uniqueRows: CreateStoneDto[] = [];
    let skipped = 0;
    for (const row of rows) {
      const key = this.stoneDedupKey(
        row.stoneType,
        row.name,
        row.cut,
        row.size,
      );
      if (seenKeys.has(key)) {
        skipped++;
        continue;
      }
      seenKeys.add(key);
      uniqueRows.push(row);
    }

    const created =
      uniqueRows.length > 0
        ? await this.prisma.stone.createMany({ data: uniqueRows })
        : { count: 0 };
    this.cache.clear();
    return { imported: created.count, skipped };
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
