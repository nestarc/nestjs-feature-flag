import { FeatureFlagWithOverrides } from './feature-flag.interface';

export interface CacheAdapter {
  get(key: string): Promise<FeatureFlagWithOverrides | null>;
  set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void>;
  getAll(): Promise<FeatureFlagWithOverrides[] | null>;
  setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void>;
  invalidate(key?: string): Promise<void>;
  onModuleDestroy?(): Promise<void>;
}

export interface RemoveOverrideInput {
  tenantId?: string;
  userId?: string;
  environment?: string;
}
