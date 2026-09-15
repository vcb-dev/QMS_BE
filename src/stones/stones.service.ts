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

function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw))
    return raw > 0 ? raw : null;
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Injectable()
export class StonesService {
  constructor(
    private prisma: PrismaService,
    private excelService: ExcelService,
  ) {}

  async findAll(stoneType?: StoneType) {
    const all = await this.prisma.stone.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
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

    return this.prisma.stone.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.stone.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy đá');
    await this.prisma.stone.delete({ where: { id } });
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
    return { updated: items.length };
  }

  // Xóa nhiều viên đá cùng lúc — chỉ xóa thật khi bấm "Lưu cấu hình" (xóa staged ở FE trước đó)
  async removeMany(ids: string[]) {
    if (!ids || ids.length === 0) return { deleted: 0 };
    const result = await this.prisma.stone.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: result.count };
  }

  // Lưu 1 lô đá từ bảng giá lưới shape/size — trùng (stoneType, name, cut, size) với đá đã có
  // thì ĐÈ giá mới lên (bảng giá kim cương đổi theo thị trường, import lại file mới nhất là để
  // cập nhật giá, không phải chặn trùng).
  async importPriceGridRows(rows: CreateStoneDto[]) {
    if (!rows || rows.length === 0) return { imported: 0, updated: 0 };

    const existing = await this.prisma.stone.findMany({
      select: { id: true, stoneType: true, name: true, cut: true, size: true },
    });
    const existingByKey = new Map(
      existing.map((s) => [
        this.stoneDedupKey(s.stoneType, s.name, s.cut, s.size),
        s.id,
      ]),
    );

    // File có thể có 2 dòng cùng shape/size (lỗi nhập liệu) — giữ giá dòng SAU CÙNG trong file.
    const rowByKey = new Map<string, CreateStoneDto>();
    for (const row of rows) {
      rowByKey.set(
        this.stoneDedupKey(row.stoneType, row.name, row.cut, row.size),
        row,
      );
    }

    const toCreate: CreateStoneDto[] = [];
    const updates: { id: string; price: number }[] = [];
    for (const [key, row] of rowByKey) {
      const existingId = existingByKey.get(key);
      if (existingId) updates.push({ id: existingId, price: row.price });
      else toCreate.push(row);
    }

    await this.prisma.$transaction([
      ...updates.map((u) =>
        this.prisma.stone.update({
          where: { id: u.id },
          data: { price: u.price },
        }),
      ),
      ...(toCreate.length > 0
        ? [this.prisma.stone.createMany({ data: toCreate })]
        : []),
    ]);

    return { imported: toCreate.length, updated: updates.length };
  }

  // Import bảng giá đá theo lưới shape/size (VD kim cương: dòng 1 = tên đá, dòng 2 = header cột
  // Shape/Size/Đơn giá·carat/Trọng lượng ước tính/Thành tiền, dòng 3+ = data) — không có cột
  // Loại/Tên riêng từng dòng: `stoneType` do người dùng chọn qua nút bấm (đá chủ/đá tấm), `name`
  // lấy từ dòng tên; chỉ lưu "Thành tiền" (giá/viên) vào price, không lưu đơn giá/carat hay
  // trọng lượng ước tính (không có field, không cần tính lại sau).
  async importPriceGridFromExcel(
    file: Express.Multer.File | undefined,
    stoneType: StoneType,
  ) {
    const { title, rows: rawRows } =
      this.excelService.parseExcelFileWithTitleRow(file);
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
    const keyShape = findKey(['shape', 'hinh dang']);
    const keySize = findKey([
      'size (mm)',
      'size mm',
      'size',
      'kich thuoc (mm)',
      'kich thuoc',
    ]);
    const keyFinalPrice = findKey([
      'thanh tien (vnd)',
      'thanh tien',
      'gia tien',
      'thanh tien vnd',
    ]);
    const missingCols: string[] = [];
    if (!keyShape) missingCols.push('Shape');
    if (!keyFinalPrice) missingCols.push('Thành tiền (VND)');
    if (missingCols.length > 0) {
      throw new BadRequestException(
        `File Excel thiếu cột dữ liệu bắt buộc: ${missingCols.join(', ')}`,
      );
    }

    const errors: string[] = [];
    const validRows: CreateStoneDto[] = [];
    rawRows.forEach((row, idx) => {
      const excelRowNum = idx + 3; // +2 dòng tên/header ở trên
      const shapeRaw = String(row[keyShape!] ?? '').trim();
      const sizeRaw = keySize ? String(row[keySize] ?? '').trim() : '';
      const priceRaw = row[keyFinalPrice!];

      if (!shapeRaw && !sizeRaw && !priceRaw) return; // Bỏ qua dòng trống

      if (!shapeRaw) {
        errors.push(`Dòng ${excelRowNum}: thiếu "Shape"`);
        return;
      }

      const price = parsePrice(priceRaw);
      if (price === null) {
        errors.push(
          `Dòng ${excelRowNum}: "Thành tiền" phải là số lớn hơn 0 (đang là "${String(priceRaw)}")`,
        );
        return;
      }

      validRows.push({
        stoneType,
        name: title,
        cut: shapeRaw,
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

    return this.importPriceGridRows(validRows);
  }
}
