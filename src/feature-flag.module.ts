import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
} from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS } from './feature-flag.constants';
import {
  FeatureFlagModuleAsyncOptions,
  FeatureFlagModuleOptions,
  FeatureFlagModuleOptionsFactory,
} from './interfaces/feature-flag-options.interface';
import { FeatureFlagService } from './services/feature-flag.service';
import { FlagCacheService } from './services/flag-cache.service';
import { FlagEvaluatorService } from './services/flag-evaluator.service';
import { FlagContext } from './services/flag-context';
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
  FlagCacheService,
  FlagEvaluatorService,
  FlagContext,
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

    const eventProvider: Provider = options.emitEvents
      ? {
          provide: 'EVENT_EMITTER',
          useFactory: () => {
            try {
              const { EventEmitter2 } = require('@nestjs/event-emitter');
              return new EventEmitter2();
            } catch {
              return null;
            }
          },
        }
      : { provide: 'EVENT_EMITTER', useValue: null };

    return {
      module: FeatureFlagModule,
      global: true,
      providers: [
        { provide: FEATURE_FLAG_MODULE_OPTIONS, useValue: moduleOptions },
        { provide: 'PRISMA_SERVICE', useValue: prisma },
        eventProvider,
        ...coreProviders,
      ],
      exports: [FeatureFlagService, FlagContext, FEATURE_FLAG_MODULE_OPTIONS],
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
          provide: 'PRISMA_SERVICE',
          useFactory: (full: FeatureFlagModuleRootOptions) => full.prisma,
          inject: [FULL_OPTIONS],
        },
        {
          provide: 'EVENT_EMITTER',
          useFactory: (full: FeatureFlagModuleRootOptions) => {
            if (!full.emitEvents) return null;
            try {
              const { EventEmitter2 } = require('@nestjs/event-emitter');
              return new EventEmitter2();
            } catch {
              return null;
            }
          },
          inject: [FULL_OPTIONS],
        },
        ...coreProviders,
      ],
      exports: [FeatureFlagService, FlagContext, FEATURE_FLAG_MODULE_OPTIONS],
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
