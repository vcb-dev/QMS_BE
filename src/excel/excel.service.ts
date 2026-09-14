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
   * Đọc buffer Multer thành sheet Excel đầu tiên — dùng chung cho mọi cách đọc dữ liệu bên dưới.
   */
  private readFirstSheet(file?: Express.Multer.File): XLSX.WorkSheet {
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
    return workbook.Sheets[sheetName];
  }

  /**
   * Đọc file Multer Excel và trả về mảng dữ liệu JSON thô (dòng 1 = header cột)
   */
  parseExcelFile(file?: Express.Multer.File): Record<string, unknown>[] {
    const sheet = this.readFirstSheet(file);
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
   * Đọc file Multer Excel có dòng tiêu đề (tên) riêng ở trên header cột — bố cục dòng 1 = tên
   * (VD "KIM CƯƠNG LAB GROWN", 1 ô bất kỳ trong dòng), dòng 2 = header cột, dòng 3+ = dữ liệu.
   * Dùng cho các bảng giá đá theo lưới shape/size (đá không có cột "Tên" riêng từng dòng).
   */
  parseExcelFileWithTitleRow(file?: Express.Multer.File): {
    title: string;
    rows: Record<string, unknown>[];
  } {
    const sheet = this.readFirstSheet(file);
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
    });

    if (aoa.length < 3) {
      throw new BadRequestException(
        'File Excel thiếu dòng tên đá, dòng header cột, hoặc dòng dữ liệu',
      );
    }

    const title = String(
      (aoa[0] || []).find((c) => String(c ?? '').trim() !== '') ?? '',
    ).trim();
    if (!title) {
      throw new BadRequestException('File Excel thiếu tên đá ở dòng đầu');
    }

    const headers = (aoa[1] || []).map((h) => String(h ?? '').trim());
    const rows = aoa
      .slice(2)
      .map((r) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          if (h) obj[h] = r[i] ?? '';
        });
        return obj;
      })
      .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''));

    if (rows.length === 0) {
      throw new BadRequestException(
        'File Excel không có dòng dữ liệu nào (chỉ có tên/header hoặc trống)',
      );
    }

    return { title, rows };
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

    try {
      const sheet = XLSX.utils.aoa_to_sheet(aoa);
      const workbook = XLSX.utils.book_new();
      // Tên sheet Excel giới hạn 31 ký tự, quá là lỗi khi mở file.
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));

      return XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;
    } catch {
      throw new BadRequestException(
        'Không tạo được file Excel từ dữ liệu đã cho',
      );
    }
  }
}
