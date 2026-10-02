import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role, User } from '@prisma/client';
import { CreateQuoteRequestDto } from '../src/quote-requests/dto/create-quote-request.dto';
import { UpdateQuoteRequestDto } from '../src/quote-requests/dto/update-quote-request.dto';
import { buildQuoteWhereClause } from '../src/utils/quote-filter.util';

const base = { departmentId: 'dep-1', categoryId: 'cat-1' };

describe('CreateQuoteRequestDto — tên sản phẩm / mã sản phẩm', () => {
  it('thiếu tên sản phẩm → lỗi', async () => {
    const dto = plainToInstance(CreateQuoteRequestDto, { ...base });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('productName');
  });

  it('tên sản phẩm chỉ có khoảng trắng → lỗi', async () => {
    const dto = plainToInstance(CreateQuoteRequestDto, {
      ...base,
      productName: '   ',
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('productName');
  });

  it('tên sản phẩm được trim, mã sản phẩm có thể bỏ trống', async () => {
    const dto = plainToInstance(CreateQuoteRequestDto, {
      ...base,
      productName: '  Nhẫn đôi kim cương  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.productName).toBe('Nhẫn đôi kim cương');
    expect(dto.productCode).toBeUndefined();
  });

  it('mã sản phẩm rỗng sau trim → null (để sửa đơn xóa được mã cũ)', async () => {
    const dto = plainToInstance(CreateQuoteRequestDto, {
      ...base,
      productName: 'Nhẫn',
      productCode: '   ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.productCode).toBeNull();
  });

  it('mã sản phẩm dài quá 50 ký tự → lỗi', async () => {
    const dto = plainToInstance(CreateQuoteRequestDto, {
      ...base,
      productName: 'Nhẫn',
      productCode: 'x'.repeat(51),
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('productCode');
  });
});

describe('UpdateQuoteRequestDto — sửa yêu cầu', () => {
  it('không gửi tên sản phẩm (không sửa) vẫn hợp lệ', async () => {
    const dto = plainToInstance(UpdateQuoteRequestDto, { note: 'ghi chú' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('gửi tên sản phẩm rỗng → lỗi, không cho xóa trắng tên', async () => {
    const dto = plainToInstance(UpdateQuoteRequestDto, { productName: '' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('productName');
  });
});

describe('buildQuoteWhereClause — tìm kiếm theo tên / mã sản phẩm', () => {
  const user = { id: 'u1', role: Role.ADMIN } as User;

  it('search khớp productName và productCode (không phân biệt hoa thường)', () => {
    const where = buildQuoteWhereClause({ search: 'ab-01' }, user) as {
      AND: any[];
    };
    const searchCond = where.AND.find(
      (c) => Array.isArray(c.OR) && c.OR.some((o: any) => o.code),
    );
    expect(searchCond.OR).toEqual(
      expect.arrayContaining([
        { productName: { contains: 'ab-01', mode: 'insensitive' } },
        { productCode: { contains: 'ab-01', mode: 'insensitive' } },
      ]),
    );
  });
});
