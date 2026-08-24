import { VangTodaySource } from './vn-gold-price.types';

// data-code lấy từ HTML vang.today (trang server-render, không có API JSON) —
// mỗi mục là giá vàng 24K (999.9) của từng thương hiệu.
export const VANG_TODAY_SOURCES: VangTodaySource[] = [
  { code: 'SJL1L10', label: 'SJC 9999' },
  { code: 'BT9999NTT', label: 'Bảo Tín 9999' },
  { code: 'DOHNL', label: 'DOJI Hà Nội' },
  { code: 'PQHN24NTT', label: 'PNJ 24K' },
];

export const VANG_TODAY_PATH = '/vi/';
