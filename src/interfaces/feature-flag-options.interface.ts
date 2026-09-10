import { ModuleMetadata, Type } from '@nestjs/common';
import { Request } from 'express';
import { CacheAdapter } from './cache-adapter.interface';
import { FlagRegistry } from './flag-registry.interface';
import { FeatureFlagRepository } from './feature-flag-repository.interface';
import { TenantContextProvider } from './tenant-context-provider.interface';

export interface FeatureFlagModuleOptions {
  /** Current environment (e.g., 'development', 'staging', 'production') */
  environment: string;

  /** Cache TTL in milliseconds. 0 skips cache writes; existing shared entries can still be read. Default: 30000. */
  cacheTtlMs?: number;

  /** Extract user ID from request. Returns null if user is not authenticated. */
  userIdExtractor?: (req: Request) => string | null;

  /** Fallback for an individual missing/error evaluation when no higher-priority default is supplied. Default: false. */
  defaultOnMissing?: boolean;

  /** Enable lifecycle/evaluation events through an imported EventEmitterModule. Exposure events also require opt-in. Default: false. */
  emitEvents?: boolean;

  /** Custom cache adapter implementation. If not provided, an in-memory cache is used. */
  cacheAdapter?: CacheAdapter;

  /**
   * Custom storage instance. Takes precedence over prisma when both are provided.
   * Its declaring module/caller owns initialization and cleanup. The exported
   * FEATURE_FLAG_REPOSITORY token delegates storage methods without lifecycle hooks.
   */
  repository?: FeatureFlagRepository;

  /**
   * Custom tenant resolver instance. Defaults to the optional @nestarc/tenancy integration.
   * Its declaring module/caller owns initialization and cleanup. The exported
   * TENANT_CONTEXT_PROVIDER token delegates resolution without lifecycle hooks.
   */
  tenantContextProvider?: TenantContextProvider;

  /** Optional type-safe flag registry used for defaults and evaluation metadata. */
  flags?: FlagRegistry;
}

export interface FeatureFlagModuleOptionsFactory {
  createFeatureFlagOptions():
    | Promise<FeatureFlagModuleOptions & { prisma?: any }>
    | (FeatureFlagModuleOptions & { prisma?: any });
}

export interface FeatureFlagModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<FeatureFlagModuleOptions> | FeatureFlagModuleOptions;
  useClass?: Type<FeatureFlagModuleOptionsFactory>;
  useExisting?: Type<FeatureFlagModuleOptionsFactory>;
}
