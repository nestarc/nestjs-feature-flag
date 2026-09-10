import { Test } from '@nestjs/testing';
import { Inject, Injectable, Module } from '@nestjs/common';
import { FeatureFlagModule } from '../src/feature-flag.module';
import { FeatureFlagService } from '../src/services/feature-flag.service';
import { FlagEvaluatorService } from '../src/services/flag-evaluator.service';
import { FlagContext } from '../src/services/flag-context';
import {
  CACHE_ADAPTER,
  FEATURE_FLAG_REPOSITORY,
  TENANT_CONTEXT_PROVIDER,
} from '../src/feature-flag.constants';
import { FeatureFlagRepository } from '../src/interfaces/feature-flag-repository.interface';
import { TenantContextProvider } from '../src/interfaces/tenant-context-provider.interface';
import { FeatureFlagModuleOptionsFactory } from '../src/interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../src/interfaces/feature-flag.interface';

const mockPrisma = {
  featureFlag: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  featureFlagOverride: { upsert: jest.fn(), deleteMany: jest.fn() },
};

describe('FeatureFlagModule', () => {
  describe('forRoot', () => {
    it('should provide all core services', async () => {
      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRoot({
            environment: 'test',
            prisma: mockPrisma,
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
      expect(module.get(CACHE_ADAPTER)).toBeDefined();
      expect(module.get(FlagEvaluatorService)).toBeDefined();
      expect(module.get(FlagContext)).toBeDefined();
    });
  });

  describe('custom storage and tenant resolution', () => {
    function createCustomProviders() {
      const date = new Date('2026-01-01T00:00:00.000Z');
      const flag: FeatureFlagWithOverrides = {
        id: 'custom-flag',
        key: 'tenant-feature',
        description: null,
        enabled: false,
        percentage: 0,
        metadata: {},
        archivedAt: null,
        createdAt: date,
        updatedAt: date,
        overrides: [
          {
            id: 'tenant-override',
            flagId: 'custom-flag',
            attributes: { tenantId: 'custom-tenant' },
            priority: 0,
            enabled: true,
            createdAt: date,
            updatedAt: date,
          },
        ],
      };
      const repository: jest.Mocked<FeatureFlagRepository> = {
        createFlag: jest.fn(),
        updateFlag: jest.fn(),
        archiveFlag: jest.fn(),
        findFlagByKey: jest.fn().mockResolvedValue(flag),
        findFlagIdByKey: jest.fn(),
        findAllActiveFlags: jest.fn().mockResolvedValue([flag]),
        findOverride: jest.fn(),
        createOverride: jest.fn(),
        updateOverride: jest.fn(),
        deleteOverride: jest.fn(),
      };
      const tenantContextProvider = {
        getCurrentTenantId: jest.fn().mockReturnValue('custom-tenant'),
      };
      const repositoryToken = Symbol('CUSTOM_REPOSITORY');
      const tenantToken = Symbol('CUSTOM_TENANT_CONTEXT');

      @Module({
        providers: [
          { provide: repositoryToken, useValue: repository },
          { provide: tenantToken, useValue: tenantContextProvider },
        ],
        exports: [repositoryToken, tenantToken],
      })
      class CustomProvidersModule {}

      @Injectable()
      class CustomOptionsFactory implements FeatureFlagModuleOptionsFactory {
        constructor(
          @Inject(repositoryToken) private readonly storage: FeatureFlagRepository,
          @Inject(tenantToken) private readonly tenants: TenantContextProvider,
        ) {}

        createFeatureFlagOptions() {
          return {
            environment: 'test',
            cacheTtlMs: 0,
            repository: this.storage,
            tenantContextProvider: this.tenants,
          };
        }
      }

      @Module({
        imports: [CustomProvidersModule],
        providers: [CustomOptionsFactory],
        exports: [CustomOptionsFactory],
      })
      class ExistingOptionsModule {}

      return {
        repository,
        tenantContextProvider,
        repositoryToken,
        tenantToken,
        CustomProvidersModule,
        CustomOptionsFactory,
        ExistingOptionsModule,
      };
    }

    it.each([false, true])(
      'uses supplied instances forRoot, with prisma supplied: %s',
      async (includePrisma) => {
        const { repository, tenantContextProvider } = createCustomProviders();
        const module = await Test.createTestingModule({
          imports: [
            FeatureFlagModule.forRoot({
              environment: 'test',
              cacheTtlMs: 0,
              repository,
              tenantContextProvider,
              ...(includePrisma ? { prisma: mockPrisma } : {}),
            }),
          ],
        }).compile();

        try {
          expect(module.get(FEATURE_FLAG_REPOSITORY)).not.toBe(repository);
          expect(module.get(TENANT_CONTEXT_PROVIDER)).not.toBe(tenantContextProvider);
          expect(await module.get(FeatureFlagService).isEnabled('tenant-feature')).toBe(true);
          expect(repository.findFlagByKey).toHaveBeenCalledWith('tenant-feature');
          expect(tenantContextProvider.getCurrentTenantId).toHaveBeenCalledTimes(1);
        } finally {
          await module.close();
        }
      },
    );

    it.each(['useFactory', 'useClass', 'useExisting'] as const)(
      'resolves custom instances from imported modules with %s',
      async (registration) => {
        const {
          repository,
          tenantContextProvider,
          repositoryToken,
          tenantToken,
          CustomProvidersModule,
          CustomOptionsFactory,
          ExistingOptionsModule,
        } = createCustomProviders();
        const options =
          registration === 'useFactory'
            ? {
                imports: [CustomProvidersModule],
                inject: [repositoryToken, tenantToken],
                useFactory: async (
                  storage: FeatureFlagRepository,
                  tenants: TenantContextProvider,
                ) => ({
                  environment: 'test',
                  cacheTtlMs: 0,
                  repository: storage,
                  tenantContextProvider: tenants,
                }),
              }
            : registration === 'useClass'
              ? { imports: [CustomProvidersModule], useClass: CustomOptionsFactory }
              : { imports: [ExistingOptionsModule], useExisting: CustomOptionsFactory };
        const module = await Test.createTestingModule({
          imports: [FeatureFlagModule.forRootAsync(options)],
        }).compile();

        try {
          expect(module.get(FEATURE_FLAG_REPOSITORY)).not.toBe(repository);
          expect(module.get(TENANT_CONTEXT_PROVIDER)).not.toBe(tenantContextProvider);
          expect(await module.get(FeatureFlagService).isEnabled('tenant-feature')).toBe(true);
          expect(repository.findFlagByKey).toHaveBeenCalledWith('tenant-feature');
          expect(tenantContextProvider.getCurrentTenantId).toHaveBeenCalledTimes(1);
        } finally {
          await module.close();
        }
      },
    );

    it('leaves imported repository and tenant lifecycle hooks with their declaring module', async () => {
      const { repository } = createCustomProviders();
      const lifecycle = () => ({
        onModuleInit: jest.fn(),
        onApplicationBootstrap: jest.fn(),
        onModuleDestroy: jest.fn(),
        beforeApplicationShutdown: jest.fn(),
        onApplicationShutdown: jest.fn(),
      });
      const repositoryLifecycle = lifecycle();
      const tenantLifecycle = lifecycle();

      @Injectable()
      class ManagedRepository implements FeatureFlagRepository {
        private initialized = false;
        createFlag = repository.createFlag;
        updateFlag = repository.updateFlag;
        archiveFlag = repository.archiveFlag;
        findFlagIdByKey = repository.findFlagIdByKey;
        findAllActiveFlags = repository.findAllActiveFlags;
        findOverride = repository.findOverride;
        createOverride = repository.createOverride;
        updateOverride = repository.updateOverride;
        deleteOverride = repository.deleteOverride;

        findFlagByKey(key: string) {
          if (!this.initialized) throw new Error('Repository must be initialized');
          return repository.findFlagByKey(key);
        }

        onModuleInit() {
          this.initialized = true;
          repositoryLifecycle.onModuleInit();
        }

        onApplicationBootstrap() {
          repositoryLifecycle.onApplicationBootstrap();
        }

        onModuleDestroy() {
          repositoryLifecycle.onModuleDestroy();
        }

        beforeApplicationShutdown() {
          repositoryLifecycle.beforeApplicationShutdown();
        }

        onApplicationShutdown() {
          repositoryLifecycle.onApplicationShutdown();
        }
      }

      @Injectable()
      class ManagedTenantProvider implements TenantContextProvider {
        private tenantId: string | null = null;

        getCurrentTenantId() {
          if (!this.tenantId) throw new Error('Tenant provider must be initialized');
          return this.tenantId;
        }

        onModuleInit() {
          this.tenantId = 'custom-tenant';
          tenantLifecycle.onModuleInit();
        }

        onApplicationBootstrap() {
          tenantLifecycle.onApplicationBootstrap();
        }

        onModuleDestroy() {
          tenantLifecycle.onModuleDestroy();
        }

        beforeApplicationShutdown() {
          tenantLifecycle.beforeApplicationShutdown();
        }

        onApplicationShutdown() {
          tenantLifecycle.onApplicationShutdown();
        }
      }

      @Module({
        providers: [ManagedRepository, ManagedTenantProvider],
        exports: [ManagedRepository, ManagedTenantProvider],
      })
      class StorageModule {}

      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            imports: [StorageModule],
            inject: [ManagedRepository, ManagedTenantProvider],
            useFactory: (storage: ManagedRepository, tenants: ManagedTenantProvider) => ({
              environment: 'test',
              cacheTtlMs: 0,
              repository: storage,
              tenantContextProvider: tenants,
            }),
          }),
        ],
      }).compile();

      try {
        await module.init();
        // Both regular class methods read initialized instance state, verifying correct binding.
        expect(await module.get(FeatureFlagService).isEnabled('tenant-feature')).toBe(true);
        expect(repository.findFlagByKey).toHaveBeenCalledWith('tenant-feature');
      } finally {
        await module.close();
      }

      for (const hook of [
        ...Object.values(repositoryLifecycle),
        ...Object.values(tenantLifecycle),
      ]) {
        expect(hook).toHaveBeenCalledTimes(1);
      }
    });

    it.each(['forRoot', 'forRootAsync'] as const)(
      'does not take ownership of manually supplied instances with %s',
      async (registration) => {
        const custom = createCustomProviders();
        const repository = Object.assign(custom.repository, {
          onModuleInit: jest.fn(),
          onModuleDestroy: jest.fn(),
        });
        const tenantContextProvider = Object.assign(custom.tenantContextProvider, {
          onModuleInit: jest.fn(),
          onModuleDestroy: jest.fn(),
        });
        const options = { environment: 'test', repository, tenantContextProvider };
        const module = await Test.createTestingModule({
          imports: [
            registration === 'forRoot'
              ? FeatureFlagModule.forRoot(options)
              : FeatureFlagModule.forRootAsync({ useFactory: () => options }),
          ],
        }).compile();

        try {
          await module.init();
          expect(await module.get(FeatureFlagService).isEnabled('tenant-feature')).toBe(true);
        } finally {
          await module.close();
        }

        expect(repository.onModuleInit).not.toHaveBeenCalled();
        expect(repository.onModuleDestroy).not.toHaveBeenCalled();
        expect(tenantContextProvider.onModuleInit).not.toHaveBeenCalled();
        expect(tenantContextProvider.onModuleDestroy).not.toHaveBeenCalled();
      },
    );

    it('rejects synchronous registration without a repository or prisma', () => {
      expect(() => FeatureFlagModule.forRoot({ environment: 'test' })).toThrow(
        'FeatureFlagModule requires either a prisma client or a custom repository.',
      );
    });

    it('rejects asynchronous registration without a repository or prisma', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            FeatureFlagModule.forRootAsync({
              useFactory: async () => ({ environment: 'test' }),
            }),
          ],
        }).compile(),
      ).rejects.toThrow(
        'FeatureFlagModule requires either a prisma client or a custom repository.',
      );
    });
  });

  describe('forRootAsync', () => {
    it('should provide services with async factory', async () => {
      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            useFactory: () => ({
              environment: 'test',
              prisma: mockPrisma,
            }),
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
    });
  });

  describe('forRootAsync with useClass', () => {
    it('should provide services using a class-based options factory', async () => {
      class TestOptionsFactory {
        createFeatureFlagOptions() {
          return {
            environment: 'test',
            prisma: mockPrisma,
          };
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            useClass: TestOptionsFactory,
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
    });
  });

  describe('forRootAsync with useExisting', () => {
    it('should provide services using an existing provider', async () => {
      class TestOptionsFactory {
        createFeatureFlagOptions() {
          return {
            environment: 'test',
            prisma: mockPrisma,
          };
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            useExisting: TestOptionsFactory,
            imports: [
              {
                module: class TestModule {},
                providers: [TestOptionsFactory],
                exports: [TestOptionsFactory],
              },
            ],
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
    });
  });

  describe('emitEvents', () => {
    it.each(['forRoot', 'forRootAsync'] as const)(
      'emits through the EventEmitter2 instance managed by NestJS with %s',
      async (registration) => {
        const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
        const options = { environment: 'test', prisma: mockPrisma, emitEvents: true };

        const module = await Test.createTestingModule({
          imports: [
            EventEmitterModule.forRoot(),
            registration === 'forRoot'
              ? FeatureFlagModule.forRoot(options)
              : FeatureFlagModule.forRootAsync({ useFactory: async () => options }),
          ],
        }).compile();

        try {
          const emitter = module.get('EVENT_EMITTER');
          const nestEmitter = module.get(EventEmitter2);
          const listener = jest.fn();
          nestEmitter.once('feature-flag.evaluated', listener);

          expect(emitter).toBe(nestEmitter);
          await module.get(FeatureFlagService).isEnabled('missing-flag');
          expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({
              flagKey: 'missing-flag',
              result: false,
              reason: 'FLAG_NOT_FOUND',
            }),
          );
        } finally {
          await module.close();
        }
      },
    );

    it('should provide null EVENT_EMITTER when emitEvents is false', async () => {
      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRoot({
            environment: 'test',
            prisma: mockPrisma,
          }),
        ],
      }).compile();

      const emitter = module.get('EVENT_EMITTER');
      expect(emitter).toBeNull();
    });
  });

  describe('forRootAsync factory should only be called once', () => {
    it('should invoke the factory exactly once', async () => {
      const factory = jest.fn().mockReturnValue({
        environment: 'test',
        prisma: mockPrisma,
      });

      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            useFactory: factory,
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });
});
