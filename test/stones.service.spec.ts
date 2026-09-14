import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StoneType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { StonesService } from '../src/stones/stones.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExcelService } from '../src/excel/excel.service';

describe('StonesService — import bảng giá lưới shape/size', () => {
  let service: StonesService;
  let prisma: {
    stone: {
      findMany: jest.Mock;
      update: jest.Mock;
      createMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let excelService: ExcelService;

  beforeEach(async () => {
    prisma = {
      stone: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    excelService = new ExcelService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StonesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExcelService, useValue: excelService },
      ],
    }).compile();

    service = module.get<StonesService>(StonesService);
  });

  describe('importPriceGridRows', () => {
    it('tạo mới đá chưa có trong DB', async () => {
      prisma.stone.findMany.mockResolvedValue([]);
      const result = await service.importPriceGridRows([
        {
          stoneType: StoneType.MAIN,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '0.7-0.8mm',
          price: 17082,
        },
      ]);
      expect(result).toEqual({ imported: 1, updated: 0 });
      expect(prisma.stone.createMany).toHaveBeenCalledWith({
        data: [
          {
            stoneType: StoneType.MAIN,
            name: 'Kim Cương Lab Grown',
            cut: 'Round',
            size: '0.7-0.8mm',
            price: 17082,
          },
        ],
      });
      expect(prisma.stone.update).not.toHaveBeenCalled();
    });

    it('đè giá đá đã có sẵn (trùng stoneType+name+cut+size)', async () => {
      prisma.stone.findMany.mockResolvedValue([
        {
          id: 'stone-1',
          stoneType: StoneType.MAIN,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '0.7-0.8mm',
        },
      ]);
      const result = await service.importPriceGridRows([
        {
          stoneType: StoneType.MAIN,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '0.7-0.8mm',
          price: 20000,
        },
      ]);
      expect(result).toEqual({ imported: 0, updated: 1 });
      expect(prisma.stone.update).toHaveBeenCalledWith({
        where: { id: 'stone-1' },
        data: { price: 20000 },
      });
      expect(prisma.stone.createMany).not.toHaveBeenCalled();
    });

    it('cùng shape/size trùng nhau ngay trong file — giữ giá dòng sau cùng', async () => {
      prisma.stone.findMany.mockResolvedValue([]);
      await service.importPriceGridRows([
        {
          stoneType: StoneType.SIDE,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '1.0mm',
          price: 14001,
        },
        {
          stoneType: StoneType.SIDE,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '1.0mm',
          price: 99999,
        },
      ]);
      expect(prisma.stone.createMany).toHaveBeenCalledWith({
        data: [
          {
            stoneType: StoneType.SIDE,
            name: 'Kim Cương Lab Grown',
            cut: 'Round',
            size: '1.0mm',
            price: 99999,
          },
        ],
      });
    });

    it('đá chủ và đá tấm cùng shape/size không tính trùng nhau (stoneType khác)', async () => {
      prisma.stone.findMany.mockResolvedValue([
        {
          id: 'stone-main',
          stoneType: StoneType.MAIN,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '1.0mm',
        },
      ]);
      const result = await service.importPriceGridRows([
        {
          stoneType: StoneType.SIDE,
          name: 'Kim Cương Lab Grown',
          cut: 'Round',
          size: '1.0mm',
          price: 14001,
        },
      ]);
      expect(result).toEqual({ imported: 1, updated: 0 });
    });
  });

  describe('importPriceGridFromExcel', () => {
    it('parse đúng: Shape→cut, Size→size, Thành tiền→price, tên lấy từ dòng đầu', async () => {
      jest.spyOn(excelService, 'parseExcelFileWithTitleRow').mockReturnValue({
        title: 'KIM CƯƠNG LAB GROWN',
        rows: [
          {
            Shape: 'Round (Tròn)',
            'Size (mm)': '0.7-0.8mm',
            'Đơn giá / carat (VND)': 5694000,
            'Trọng lượng ước tính (ct)': 0.003,
            'Thành tiền (VND)': 17082,
          },
          {
            Shape: 'Round',
            'Size (mm)': '0.9mm',
            'Đơn giá / carat (VND)': 5227000,
            'Trọng lượng ước tính (ct)': 0.003,
            'Thành tiền (VND)': 15681,
          },
        ],
      });
      prisma.stone.findMany.mockResolvedValue([]);

      const result = await service.importPriceGridFromExcel(
        { originalname: 'diamond.xlsx' } as Express.Multer.File,
        StoneType.MAIN,
      );

      expect(result).toEqual({ imported: 2, updated: 0 });
      expect(prisma.stone.createMany).toHaveBeenCalledWith({
        data: [
          {
            stoneType: StoneType.MAIN,
            name: 'KIM CƯƠNG LAB GROWN',
            cut: 'Round (Tròn)',
            size: '0.7-0.8mm',
            price: 17082,
          },
          {
            stoneType: StoneType.MAIN,
            name: 'KIM CƯƠNG LAB GROWN',
            cut: 'Round',
            size: '0.9mm',
            price: 15681,
          },
        ],
      });
    });

    it('thiếu cột Shape/Thành tiền → BadRequestException', async () => {
      jest.spyOn(excelService, 'parseExcelFileWithTitleRow').mockReturnValue({
        title: 'KIM CƯƠNG LAB GROWN',
        rows: [{ Cỡ: '0.7mm' }],
      });
      await expect(
        service.importPriceGridFromExcel(
          { originalname: 'x.xlsx' } as Express.Multer.File,
          StoneType.MAIN,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('giá không hợp lệ → BadRequestException báo đúng số dòng lỗi', async () => {
      jest.spyOn(excelService, 'parseExcelFileWithTitleRow').mockReturnValue({
        title: 'KIM CƯƠNG LAB GROWN',
        rows: [
          { Shape: 'Round', 'Size (mm)': '0.7mm', 'Thành tiền (VND)': 'lỗi' },
        ],
      });
      await expect(
        service.importPriceGridFromExcel(
          { originalname: 'x.xlsx' } as Express.Multer.File,
          StoneType.MAIN,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('ExcelService.parseExcelFileWithTitleRow (thực, không mock)', () => {
    it('đọc đúng dòng 1 = tên, dòng 2 = header, dòng 3+ = data', () => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['KIM CƯƠNG LAB GROWN'],
        ['Shape', 'Size (mm)', 'Thành tiền (VND)'],
        ['Round', '0.7-0.8mm', 17082],
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
      const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Buffer;

      const result = new ExcelService().parseExcelFileWithTitleRow({
        originalname: 'diamond.xlsx',
        buffer,
      } as Express.Multer.File);

      expect(result.title).toBe('KIM CƯƠNG LAB GROWN');
      expect(result.rows).toEqual([
        { Shape: 'Round', 'Size (mm)': '0.7-0.8mm', 'Thành tiền (VND)': 17082 },
      ]);
    });
  });
});
