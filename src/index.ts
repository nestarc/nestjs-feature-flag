// Module
export { FeatureFlagModule, FeatureFlagModuleRootOptions, FeatureFlagModuleRootAsyncOptions } from './feature-flag.module';

// Services
export { FeatureFlagService } from './services/feature-flag.service';
export { FlagContext } from './services/flag-context';

// Guard
export { FeatureFlagGuard } from './guards/feature-flag.guard';

// Decorators
export { FeatureFlag } from './decorators/feature-flag.decorator';
export { BypassFeatureFlag } from './decorators/bypass-feature-flag.decorator';

// Interfaces
export {
  FeatureFlagModuleOptions,
  FeatureFlagModuleAsyncOptions,
  FeatureFlagModuleOptionsFactory,
} from './interfaces/feature-flag-options.interface';
export { EvaluationContext } from './interfaces/evaluation-context.interface';
export {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagGuardOptions,
  FeatureFlagWithOverrides,
  FlagOverride,
} from './interfaces/feature-flag.interface';

// Events
export {
  FeatureFlagEvents,
  FlagEvaluatedEvent,
  FlagMutationEvent,
  FlagOverrideEvent,
} from './events/feature-flag.events';

// Constants
export { FEATURE_FLAG_MODULE_OPTIONS } from './feature-flag.constants';
export { CACHE_ADAPTER } from './feature-flag.constants';

// Cache adapters
export type { CacheAdapter, RemoveOverrideInput } from './interfaces/cache-adapter.interface';
export { MemoryCacheAdapter } from './cache/memory-cache.adapter';
export { RedisCacheAdapter, type RedisCacheAdapterOptions } from './cache/redis-cache.adapter';

// Admin module
export { FeatureFlagAdminModule } from './admin/feature-flag-admin.module';
export type { FeatureFlagAdminOptions } from './admin/admin-options.interface';
