/**
 * Generic Least-Recently-Used (LRU) Cache with bounded memory policy and eviction callback.
 */
export class TileCache<T> {
  private cache = new Map<string, T>();
  private maxCapacity: number;
  private onEvict?: (key: string, value: T) => void;

  constructor(maxCapacity = 80, onEvict?: (key: string, value: T) => void) {
    this.maxCapacity = Math.max(1, maxCapacity);
    this.onEvict = onEvict;
  }

  get(key: string): T | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Re-insert to mark as most recently used
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      // Evict oldest entry (first key in iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        if (evicted !== undefined && this.onEvict) {
          this.onEvict(oldestKey, evicted);
        }
      }
    }
    this.cache.set(key, value);
  }

  delete(key: string): boolean {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      if (this.onEvict) {
        this.onEvict(key, value);
      }
      return true;
    }
    return false;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.cache.entries()) {
        this.onEvict(key, value);
      }
    }
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  values(): IterableIterator<T> {
    return this.cache.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this.cache.entries();
  }
}
