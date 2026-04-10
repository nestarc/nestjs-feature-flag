import { Injectable } from '@nestjs/common';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class MemoryCacheAdapter implements CacheAdapter {
  private cache = new Map<string, CacheEntry<FeatureFlagWithOverrides>>();
  private allFlagsCache: CacheEntry<FeatureFlagWithOverrides[]> | null = null;

  async get(key: string): Promise<FeatureFlagWithOverrides | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  async getAll(): Promise<FeatureFlagWithOverrides[] | null> {
    if (!this.allFlagsCache) return null;
    if (Date.now() > this.allFlagsCache.expiresAt) {
      this.allFlagsCache = null;
      return null;
    }
    return this.allFlagsCache.data;
  }

  async setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    this.allFlagsCache = { data, expiresAt: Date.now() + ttlMs };
  }

  async invalidate(key?: string): Promise<void> {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
    this.allFlagsCache = null;
  }
}
