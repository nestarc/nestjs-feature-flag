import { Module, DynamicModule, NotFoundException } from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  FeatureFlagWithOverrides,
  CreateFeatureFlagInput,
} from '../interfaces/feature-flag.interface';
import {
  BooleanEvaluationDetails,
  EvaluateBooleanOptions,
} from '../interfaces/evaluation-details.interface';
import { FlagKey, FlagRegistry } from '../interfaces/flag-registry.interface';

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
    const controller = new TestFeatureFlagController(flags ?? {});
    return this.createModule(controller);
  }

  static registerRegistry<TFlags extends FlagRegistry>(
    flags: TFlags,
    options: TestFeatureFlagRegistryOptions<TFlags> = {},
  ): DynamicModule {
    const defaults = Object.fromEntries(
      Object.entries(flags).map(([key, definition]) => [key, definition.defaultValue]),
    );
    const controller = new TestFeatureFlagController(defaults, options.overrides);
    return this.createModule(controller);
  }

  private static createModule(controller: TestFeatureFlagController): DynamicModule {
    return {
      module: TestFeatureFlagModule,
      global: true,
      providers: [
        {
          provide: TestFeatureFlagController,
          useValue: controller,
        },
        {
          provide: FeatureFlagService,
          useValue: createFeatureFlagServiceStub(controller),
        },
      ],
      exports: [FeatureFlagService, TestFeatureFlagController],
    };
  }
}

export interface TestFeatureFlagRegistryOptions<TFlags extends FlagRegistry> {
  overrides?: Partial<Record<FlagKey<TFlags>, boolean>>;
}

export class TestFeatureFlagController<TFlags extends FlagRegistry = FlagRegistry> {
  private readonly defaults: Record<string, boolean>;
  private values: Record<string, boolean>;

  constructor(
    defaults: Record<string, boolean>,
    overrides: Partial<Record<FlagKey<TFlags>, boolean>> = {},
  ) {
    this.defaults = { ...defaults };
    this.values = { ...defaults, ...overrides };
  }

  set<K extends FlagKey<TFlags>>(key: K, value: boolean): void {
    this.values[key] = value;
  }

  reset(): void {
    this.values = { ...this.defaults };
  }

  isEnabled(key: string, options: EvaluateBooleanOptions = {}): boolean {
    return this.getValue(key, options);
  }

  evaluateAll(): Record<string, boolean> {
    return { ...this.values };
  }

  getDetails(key: string, options: EvaluateBooleanOptions = {}): BooleanEvaluationDetails {
    const hasValue = Object.prototype.hasOwnProperty.call(this.values, key);
    const value = this.getValue(key, options);

    return {
      flagKey: key,
      value,
      result: value,
      source: hasValue ? 'default' : 'default',
      reason: hasValue ? 'GLOBAL' : 'FLAG_NOT_FOUND',
      defaultUsed: !hasValue,
      evaluationTimeMs: 0,
    };
  }

  findFlag(key: string): FeatureFlagWithOverrides {
    if (!Object.prototype.hasOwnProperty.call(this.values, key)) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    return makeStubFlag({ key, enabled: this.values[key] });
  }

  findAll(): FeatureFlagWithOverrides[] {
    return Object.entries(this.values).map(([key, enabled]) =>
      makeStubFlag({ key, enabled }),
    );
  }

  private getValue(key: string, options: EvaluateBooleanOptions): boolean {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) {
      return this.values[key];
    }

    return options.defaultValue ?? false;
  }
}

function createFeatureFlagServiceStub(controller: TestFeatureFlagController) {
  return {
    isEnabled: async (
      key: string,
      _context?: unknown,
      options: EvaluateBooleanOptions = {},
    ) => controller.isEnabled(key, options),
    evaluateBoolean: async (
      key: string,
      _context?: unknown,
      options: EvaluateBooleanOptions = {},
    ) => controller.getDetails(key, options),
    evaluateAll: async () => controller.evaluateAll(),
            create: async (input: CreateFeatureFlagInput) =>
              makeStubFlag({ key: input.key, enabled: input.enabled ?? false }),
            update: async (key: string, input: Partial<FeatureFlagWithOverrides>) =>
              makeStubFlag({ key, ...input }),
            archive: async (key: string) =>
              makeStubFlag({ key, archivedAt: new Date() }),
            setOverride: async () => {},
            removeOverride: async () => {},
    findAll: async () => controller.findAll(),
    findByKey: async (key: string) => controller.findFlag(key),
            invalidateCache: async () => {},
  };
}
