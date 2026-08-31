import { Injectable } from '@nestjs/common';

// Cache TTL trong RAM dùng CHUNG cho danh sách yêu cầu báo giá (QuoteQueryService.findAll) và Thư
// Viện Sản Phẩm (LibraryService). 1 Map duy nhất -> mỗi lệnh ghi gọi clear() là xoá sạch cả 2 loại
// entry cùng lúc (trước đây library nằm chung trong QuoteQueryService nên clearCache() lo hết; tách
// service ra thì cần chốt chung này để không bị stale nửa vời).
//
// cacheKey = JSON.stringify(dto) nên số key phân biệt là vô hạn -> có trần maxEntries, evict kiểu
// LRU: Map giữ thứ tự insert, set() xoá+chèn lại khi "touch" nên key cũ nhất luôn ở đầu.
// Cache theo TỪNG INSTANCE — chạy nhiều instance thì mỗi instance stale tối đa TTL độc lập.
@Injectable()
export class QuoteListCacheService {
  private readonly cache = new Map<
    string,
    { at: number; ttl: number; data: any }
  >();

  // TTL danh sách yêu cầu (realtime, đổi liên tục) — mặc định 60s, chỉnh qua LIST_CACHE_TTL_MS.
  readonly listTtlMs = Number(process.env.LIST_CACHE_TTL_MS) || 60_000;
  // TTL Thư Viện (dữ liệu lịch sử, query gộp nhóm nặng) — dài hơn, mặc định 5 phút, chỉnh qua
  // LIBRARY_CACHE_TTL_MS. Vẫn bị xoá ngay khi có báo giá mới qua clear().
  readonly libraryTtlMs = Number(process.env.LIBRARY_CACHE_TTL_MS) || 300_000;
  private readonly maxEntries =
    Number(process.env.LIST_CACHE_MAX_ENTRIES) || 200;

  // Đọc + kiểm TTL + "touch" (đưa key lên cuối) để lần evict sau bỏ đúng key ít dùng nhất.
  get(key: string): any | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= hit.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit.data;
  }

  // Ghi + evict key cũ nhất khi vượt trần. ttlMs mặc định = TTL danh sách.
  set(key: string, data: any, ttlMs = this.listTtlMs): void {
    this.cache.delete(key);
    this.cache.set(key, { at: Date.now(), ttl: ttlMs, data });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
