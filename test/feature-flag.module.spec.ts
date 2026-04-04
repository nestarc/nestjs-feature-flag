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
});
