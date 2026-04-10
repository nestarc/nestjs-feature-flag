import {
  FeatureFlagModule,
  FeatureFlagService,
  FeatureFlag,
  BypassFeatureFlag,
  FeatureFlagGuard,
  FlagContext,
  FeatureFlagEvents,
  FEATURE_FLAG_MODULE_OPTIONS,
  CACHE_ADAPTER,
  MemoryCacheAdapter,
  RedisCacheAdapter,
  FeatureFlagAdminModule,
} from '../src';

describe('barrel exports', () => {
  it('should export all public API symbols', () => {
    expect(FeatureFlagModule).toBeDefined();
    expect(FeatureFlagService).toBeDefined();
    expect(FeatureFlag).toBeDefined();
    expect(BypassFeatureFlag).toBeDefined();
    expect(FeatureFlagGuard).toBeDefined();
    expect(FlagContext).toBeDefined();
    expect(FeatureFlagEvents).toBeDefined();
    expect(FeatureFlagEvents.EVALUATED).toBe('feature-flag.evaluated');
  });

  it('should export constants', () => {
    expect(FEATURE_FLAG_MODULE_OPTIONS).toBeDefined();
    expect(CACHE_ADAPTER).toBeDefined();
  });

  it('should export cache adapters', () => {
    expect(MemoryCacheAdapter).toBeDefined();
    expect(RedisCacheAdapter).toBeDefined();
  });

  it('should export admin module', () => {
    expect(FeatureFlagAdminModule).toBeDefined();
  });
});
