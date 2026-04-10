import { ModuleMetadata, Type } from '@nestjs/common';
import { Request } from 'express';
import { CacheAdapter } from './cache-adapter.interface';

export interface FeatureFlagModuleOptions {
  /** Current environment (e.g., 'development', 'staging', 'production') */
  environment: string;

  /** Cache TTL in milliseconds. 0 disables caching. Default: 30000 */
  cacheTtlMs?: number;

  /** Extract user ID from request. Returns null if user is not authenticated. */
  userIdExtractor?: (req: Request) => string | null;

  /** Default value when evaluating a non-existent flag. Default: false */
  defaultOnMissing?: boolean;

  /** Emit evaluation events via @nestjs/event-emitter. Default: false */
  emitEvents?: boolean;

  /** Custom cache adapter implementation. If not provided, an in-memory cache is used. */
  cacheAdapter?: CacheAdapter;
}

export interface FeatureFlagModuleOptionsFactory {
  createFeatureFlagOptions():
    | Promise<FeatureFlagModuleOptions & { prisma: any }>
    | (FeatureFlagModuleOptions & { prisma: any });
}

export interface FeatureFlagModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<FeatureFlagModuleOptions> | FeatureFlagModuleOptions;
  useClass?: Type<FeatureFlagModuleOptionsFactory>;
  useExisting?: Type<FeatureFlagModuleOptionsFactory>;
}
