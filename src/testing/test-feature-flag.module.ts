import { Module, DynamicModule } from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';

@Module({})
export class TestFeatureFlagModule {
  static register(flags?: Record<string, boolean>): DynamicModule {
    return {
      module: TestFeatureFlagModule,
      global: true,
      providers: [
        {
          provide: FeatureFlagService,
          useValue: {
            isEnabled: async (key: string) => flags?.[key] ?? false,
            evaluateAll: async () => flags ?? {},
            create: async () => ({}),
            update: async () => ({}),
            archive: async () => ({}),
            setOverride: async () => {},
            findAll: async () => [],
            invalidateCache: () => {},
          },
        },
      ],
      exports: [FeatureFlagService],
    };
  }
}
