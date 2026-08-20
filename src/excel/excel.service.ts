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
}