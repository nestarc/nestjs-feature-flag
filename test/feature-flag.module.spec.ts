import { Test } from '@nestjs/testing';
import { FeatureFlagModule } from '../src/feature-flag.module';
import { FeatureFlagService } from '../src/services/feature-flag.service';
import { FlagCacheService } from '../src/services/flag-cache.service';
import { FlagEvaluatorService } from '../src/services/flag-evaluator.service';
import { FlagContext } from '../src/services/flag-context';

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
      expect(module.get(FlagCacheService)).toBeDefined();
      expect(module.get(FlagEvaluatorService)).toBeDefined();
      expect(module.get(FlagContext)).toBeDefined();
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

  describe('forRoot with emitEvents', () => {
    it('should provide a real EventEmitter2 when emitEvents is true', async () => {
      const { EventEmitterModule } = await import('@nestjs/event-emitter');

      const module = await Test.createTestingModule({
        imports: [
          EventEmitterModule.forRoot(),
          FeatureFlagModule.forRoot({
            environment: 'test',
            prisma: mockPrisma,
            emitEvents: true,
          }),
        ],
      }).compile();

      const emitter = module.get('EVENT_EMITTER');
      expect(emitter).not.toBeNull();
      expect(emitter.emit).toBeDefined();
    });

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
