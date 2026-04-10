import { Module, DynamicModule, NotFoundException } from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  FeatureFlagWithOverrides,
  CreateFeatureFlagInput,
} from '../interfaces/feature-flag.interface';

function makeStubFlag(
  partial: Partial<FeatureFlagWithOverrides> = {},
): FeatureFlagWithOverrides {
  return {
    id: partial.id ?? 'stub-id',
    key: partial.key ?? 'STUB',
    description: partial.description ?? null,
    enabled: partial.enabled ?? false,
    percentage: partial.percentage ?? 0,
    metadata: partial.metadata ?? {},
    archivedAt: partial.archivedAt ?? null,
    createdAt: partial.createdAt ?? new Date('2026-01-01'),
    updatedAt: partial.updatedAt ?? new Date('2026-01-01'),
    overrides: partial.overrides ?? [],
  };
}

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
            create: async (input: CreateFeatureFlagInput) =>
              makeStubFlag({ key: input.key, enabled: input.enabled ?? false }),
            update: async (key: string, input: Partial<FeatureFlagWithOverrides>) =>
              makeStubFlag({ key, ...input }),
            archive: async (key: string) =>
              makeStubFlag({ key, archivedAt: new Date() }),
            setOverride: async () => {},
            removeOverride: async () => {},
            findAll: async () =>
              Object.entries(flags ?? {}).map(([key, enabled]) =>
                makeStubFlag({ key, enabled }),
              ),
            findByKey: async (key: string) => {
              if (flags && key in flags) {
                return makeStubFlag({ key, enabled: flags[key] });
              }
              throw new NotFoundException(`Feature flag "${key}" not found`);
            },
            invalidateCache: async () => {},
          },
        },
      ],
      exports: [FeatureFlagService],
    };
  }
}
