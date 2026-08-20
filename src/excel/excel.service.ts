// src/excel/excel.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class ExcelService {
  /**
   * Bỏ dấu tiếng Việt + chuẩn hóa để so khớp tên cột linh hoạt
   */
  normalizeHeader(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .trim()
      .toLowerCase();
  }

  /**
   * Đọc file Multer Excel và trả về mảng dữ liệu JSON thô
   */
  parseExcelFile(file?: Express.Multer.File): Record<string, unknown>[] {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Vui lòng chọn file Excel để import');
    }

    const nameLower = (file.originalname || '').toLowerCase();
    if (!nameLower.endsWith('.xlsx') && !nameLower.endsWith('.xls')) {
      throw new BadRequestException(
        'File không hợp lệ — chỉ chấp nhận định dạng .xlsx hoặc .xls',
      );
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException(
        'Không đọc được file Excel — file có thể bị hỏng hoặc sai định dạng',
      );
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('File Excel không có sheet dữ liệu nào');
    }
    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
    });

    if (rawRows.length === 0) {
      throw new BadRequestException(
        'File Excel không có dòng dữ liệu nào (chỉ có header hoặc trống)',
      );
    }

    return rawRows;
  }

  /**
   * Dựng file Excel (.xlsx) từ danh sách cột + dữ liệu — dùng chung cho mọi module cần export.
   * columns quyết định thứ tự & tiêu đề cột; rows là object phẳng, đọc theo columns[].key.
   */
  exportToBuffer(
    sheetName: string,
    columns: { key: string; header: string }[],
    rows: Record<string, unknown>[],
  ): Buffer {
    const aoa: unknown[][] = [
      columns.map((c) => c.header),
      ...rows.map((row) => columns.map((c) => row[c.key] ?? '')),
    ];

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const workbook = XLSX.utils.book_new();
    // Tên sheet Excel giới hạn 31 ký tự, quá là lỗi khi mở file.
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}