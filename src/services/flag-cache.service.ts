import { Injectable, Inject } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class FlagCacheService {
  private cache = new Map<string, CacheEntry<FeatureFlagWithOverrides>>();
  private allFlagsCache: CacheEntry<FeatureFlagWithOverrides[]> | null = null;

  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
  ) {}

  get(key: string): FeatureFlagWithOverrides | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: FeatureFlagWithOverrides): void {
    const ttl = this.options.cacheTtlMs ?? 30_000;
    if (ttl === 0) return;
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  getAll(): FeatureFlagWithOverrides[] | null {
    if (!this.allFlagsCache) return null;
    if (Date.now() > this.allFlagsCache.expiresAt) {
      this.allFlagsCache = null;
      return null;
    }
    return this.allFlagsCache.data;
  }

  setAll(data: FeatureFlagWithOverrides[]): void {
    const ttl = this.options.cacheTtlMs ?? 30_000;
    if (ttl === 0) return;
    this.allFlagsCache = { data, expiresAt: Date.now() + ttl };
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.allFlagsCache = null;
    } else {
      this.cache.clear();
      this.allFlagsCache = null;
    }
  }
}
