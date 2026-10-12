import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  APP_CONSTANTS,
  CANCELLABLE_QUOTE_STATUSES,
  FILTERABLE_QUOTE_STATUSES,
} from '../src/common/constants';
import { QuoteAction } from '../src/quote-requests/dto/update-quote-status.dto';
import { FilterQuoteRequestDto } from '../src/quote-requests/dto/filter-quote-request.dto';

describe('Trạng thái CANCELLED — hằng số và DTO', () => {
  it('được phép lọc theo CANCELLED ở API danh sách', () => {
    expect(FILTERABLE_QUOTE_STATUSES).toContain('CANCELLED');
  });

  it('có nhãn tiếng Việt "Đã hủy"', () => {
    expect(APP_CONSTANTS.QUOTE_STATUS_LABELS.CANCELLED).toBe('Đã hủy');
  });

  it('chỉ hủy được từ 4 trạng thái đang mở (không REJECTED, không CANCELLED)', () => {
    expect([...CANCELLABLE_QUOTE_STATUSES].sort()).toEqual(
      ['NEED_MORE_INFO', 'PENDING', 'PROCESSING', 'QUOTED'].sort(),
    );
  });

  it('QuoteAction có CANCEL và RESTORE', () => {
    expect(QuoteAction.CANCEL).toBe('CANCEL');
    expect(QuoteAction.RESTORE).toBe('RESTORE');
  });

  it('DTO danh sách chấp nhận status=CANCELLED nhưng vẫn từ chối CLOSED', async () => {
    const ok = plainToInstance(FilterQuoteRequestDto, { status: 'CANCELLED' });
    expect(await validate(ok)).toHaveLength(0);

    const bad = plainToInstance(FilterQuoteRequestDto, { status: 'CLOSED' });
    expect(await validate(bad)).not.toHaveLength(0);
  });
});
