export class CacheWithTtl<T> {
  private value: T | null = null;
  private lastFetch = 0;

  constructor(private readonly ttlMs: number) {}

  get(): T | null {
    if (this.value !== null && Date.now() - this.lastFetch < this.ttlMs) {
      return this.value;
    }
    return null;
  }

  set(value: T) {
    this.value = value;
    this.lastFetch = Date.now();
  }

  clear() {
    this.value = null;
  }
}
