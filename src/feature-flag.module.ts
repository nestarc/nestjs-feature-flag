import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  FEATURE_FLAG_MODULE_OPTIONS,
  CACHE_ADAPTER,
  FEATURE_FLAG_REPOSITORY,
  TENANT_CONTEXT_PROVIDER,
} from './feature-flag.constants';
import {
  FeatureFlagModuleAsyncOptions,
  FeatureFlagModuleOptions,
  FeatureFlagModuleOptionsFactory,
} from './interfaces/feature-flag-options.interface';
import { FeatureFlagService } from './services/feature-flag.service';
import { MemoryCacheAdapter } from './cache/memory-cache.adapter';
import { PrismaFeatureFlagRepository } from './repositories/prisma-feature-flag.repository';
import { DefaultTenantContextProvider } from './services/default-tenant-context-provider';
import { FlagEvaluatorService } from './services/flag-evaluator.service';
import { FlagContext } from './services/flag-context';
import { FlagContextResolver } from './services/flag-context-resolver';
import { FlagEventPublisher } from './services/flag-event-publisher';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { FlagContextMiddleware } from './middleware/flag-context.middleware';

export interface FeatureFlagModuleRootOptions extends FeatureFlagModuleOptions {
  prisma: any;
}

export interface FeatureFlagModuleRootAsyncOptions extends FeatureFlagModuleAsyncOptions {
  useFactory?: (
    ...args: any[]
  ) => Promise<FeatureFlagModuleRootOptions> | FeatureFlagModuleRootOptions;
}

const FULL_OPTIONS = Symbol('FEATURE_FLAG_FULL_OPTIONS');

const coreProviders: Provider[] = [
  FlagEvaluatorService,
  FlagContext,
  FlagContextResolver,
  FlagEventPublisher,
  FeatureFlagGuard,
  FeatureFlagService,
];

@Module({})
export class FeatureFlagModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(FlagContextMiddleware)
      .forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }

  static forRoot(options: FeatureFlagModuleRootOptions): DynamicModule {
    const { prisma, ...moduleOptions } = options;

    let eventProvider: Provider = { provide: 'EVENT_EMITTER', useValue: null };
    if (options.emitEvents) {
      try {
        const { EventEmitter2 } = require('@nestjs/event-emitter');
        eventProvider = { provide: 'EVENT_EMITTER', useExisting: EventEmitter2 };
      } catch {
        /* @nestjs/event-emitter not installed */
      }
    }

    return {
      module: FeatureFlagModule,
      global: true,
      providers: [
        { provide: FEATURE_FLAG_MODULE_OPTIONS, useValue: moduleOptions },
        eventProvider,
        {
          provide: CACHE_ADAPTER,
          useValue: options.cacheAdapter ?? new MemoryCacheAdapter(),
        },
        {
          provide: FEATURE_FLAG_REPOSITORY,
          useValue: new PrismaFeatureFlagRepository(prisma),
        },
        {
          provide: TENANT_CONTEXT_PROVIDER,
          useClass: DefaultTenantContextProvider,
        },
        ...coreProviders,
      ],
      exports: [
        FeatureFlagService,
        FlagContext,
        FEATURE_FLAG_MODULE_OPTIONS,
        CACHE_ADAPTER,
        FEATURE_FLAG_REPOSITORY,
        TENANT_CONTEXT_PROVIDER,
      ],
    };
  }

  static forRootAsync(options: FeatureFlagModuleRootAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: FeatureFlagModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        ...asyncProviders,
        {
          provide: FEATURE_FLAG_MODULE_OPTIONS,
          useFactory: ({ prisma: _, ...moduleOptions }: FeatureFlagModuleRootOptions) =>
            moduleOptions,
          inject: [FULL_OPTIONS],
        },
        {
          provide: 'EVENT_EMITTER',
          useFactory: (full: FeatureFlagModuleRootOptions, moduleRef: ModuleRef) => {
            if (!full.emitEvents) return null;
            try {
              const { EventEmitter2 } = require('@nestjs/event-emitter');
              return moduleRef.get(EventEmitter2, { strict: false });
            } catch {
              return null;
            }
          },
          inject: [FULL_OPTIONS, ModuleRef],
        },
        {
          provide: CACHE_ADAPTER,
          useFactory: (full: FeatureFlagModuleRootOptions) =>
            full.cacheAdapter ?? new MemoryCacheAdapter(),
          inject: [FULL_OPTIONS],
        },
        {
          provide: FEATURE_FLAG_REPOSITORY,
          useFactory: (full: FeatureFlagModuleRootOptions) =>
            new PrismaFeatureFlagRepository(full.prisma),
          inject: [FULL_OPTIONS],
        },
        {
          provide: TENANT_CONTEXT_PROVIDER,
          useClass: DefaultTenantContextProvider,
        },
        ...coreProviders,
      ],
      exports: [
        FeatureFlagService,
        FlagContext,
        FEATURE_FLAG_MODULE_OPTIONS,
        CACHE_ADAPTER,
        FEATURE_FLAG_REPOSITORY,
        TENANT_CONTEXT_PROVIDER,
      ],
    };
  }

  private static createAsyncProviders(
    options: FeatureFlagModuleRootAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: FULL_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useClass) {
      return [
        { provide: options.useClass, useClass: options.useClass },
        {
          provide: FULL_OPTIONS,
          useFactory: (factory: FeatureFlagModuleOptionsFactory) =>
            factory.createFeatureFlagOptions(),
          inject: [options.useClass],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: FULL_OPTIONS,
          useFactory: (factory: FeatureFlagModuleOptionsFactory) =>
            factory.createFeatureFlagOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    return [];
  }
}
