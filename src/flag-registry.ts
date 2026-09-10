import { FeatureFlag } from './decorators/feature-flag.decorator';
import { EvaluationContext } from './interfaces/evaluation-context.interface';
import {
  BooleanEvaluationDetails,
  EvaluateBooleanOptions,
} from './interfaces/evaluation-details.interface';
import { FeatureFlagGuardOptions } from './interfaces/feature-flag.interface';
import {
  FeatureFlagLifecycleMetadata,
  FlagKey,
  FlagRegistry,
} from './interfaces/flag-registry.interface';
import { FeatureFlagService } from './services/feature-flag.service';

export interface TypedFeatureFlagClient<TFlags extends FlagRegistry> {
  isEnabled<K extends FlagKey<TFlags>>(
    flagKey: K,
    context?: EvaluationContext,
    options?: EvaluateBooleanOptions,
  ): Promise<boolean>;

  evaluateBoolean<K extends FlagKey<TFlags>>(
    flagKey: K,
    context?: EvaluationContext,
    options?: EvaluateBooleanOptions,
  ): Promise<BooleanEvaluationDetails>;

  registry: TFlags;
}

export interface TypedFeatureFlagDecorators<TFlags extends FlagRegistry> {
  FeatureFlag<K extends FlagKey<TFlags>>(
    flagKey: K,
    options?: FeatureFlagGuardOptions,
  ): ClassDecorator & MethodDecorator;
}

export type FlagLifecycleStatusName = 'active' | 'stale' | 'expired';

export interface FlagLifecycleStatus extends FeatureFlagLifecycleMetadata {
  status: FlagLifecycleStatusName;
  tags: string[];
  staleAt?: Date;
  expiresAt?: Date;
}

export function defineFlags<const TFlags extends FlagRegistry>(flags: TFlags): TFlags {
  return flags;
}

export function createFeatureFlagClient<TFlags extends FlagRegistry>(
  service: FeatureFlagService,
  registry: TFlags,
): TypedFeatureFlagClient<TFlags> {
  return {
    registry,
    isEnabled: (flagKey, context, options) =>
      service.isEnabled(flagKey, context, mergeRegistryOptions(registry[flagKey], options)),
    evaluateBoolean: (flagKey, context, options) =>
      service.evaluateBoolean(
        flagKey,
        context,
        mergeRegistryOptions(registry[flagKey], options),
      ),
  };
}

export function createFeatureFlagDecorators<TFlags extends FlagRegistry>(
  registry: TFlags,
): TypedFeatureFlagDecorators<TFlags> {
  return {
    FeatureFlag: (flagKey, options = {}) =>
      FeatureFlag(flagKey, {
        defaultValue: registry[flagKey].defaultValue,
        ...options,
      }),
  };
}

export function getFlagLifecycleStatus(
  metadata: FeatureFlagLifecycleMetadata,
  now: Date = new Date(),
): FlagLifecycleStatus {
  const staleAt = parseLifecycleDate(metadata.staleAt);
  const expiresAt = parseLifecycleDate(metadata.expiresAt);
  const status = getLifecycleStatusName(now, staleAt, expiresAt);

  return {
    ...metadata,
    tags: [...(metadata.tags ?? [])],
    staleAt,
    expiresAt,
    status,
  };
}

function mergeRegistryOptions(
  definition: FlagRegistry[string],
  options: EvaluateBooleanOptions = {},
): EvaluateBooleanOptions {
  const merged: EvaluateBooleanOptions = {
    defaultValue: definition.defaultValue,
  };

  if (definition.bucketBy !== undefined) {
    merged.bucketBy = definition.bucketBy;
  }

  if (definition.trackExposure !== undefined) {
    merged.trackExposure = definition.trackExposure;
  }

  return { ...merged, ...options };
}

function getLifecycleStatusName(
  now: Date,
  staleAt?: Date,
  expiresAt?: Date,
): FlagLifecycleStatusName {
  if (expiresAt && now >= expiresAt) {
    return 'expired';
  }

  if (staleAt && now >= staleAt) {
    return 'stale';
  }

  return 'active';
}

function parseLifecycleDate(value: string | Date | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value : new Date(value);
}
