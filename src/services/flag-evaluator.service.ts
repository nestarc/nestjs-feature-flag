import { Injectable } from '@nestjs/common';
import {
  FeatureFlagWithOverrides,
  FlagOverride,
  TargetingAttributeValue,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { murmurhash3 } from '../utils/hash';
import { matchesTargetingAttributes } from '../utils/targeting-attributes';
import {
  BooleanEvaluationDetails,
  BucketBy,
  EvaluationSource,
  FlagEvaluatorOptions,
} from '../interfaces/evaluation-details.interface';

export type EvaluationResult = BooleanEvaluationDetails;

@Injectable()
export class FlagEvaluatorService {
  evaluate(
    flag: FeatureFlagWithOverrides,
    context: EvaluationContext,
    options: FlagEvaluatorOptions = {},
  ): EvaluationResult {
    if (flag.archivedAt) {
      return this.result(flag.key, false, 'global', 'ARCHIVED');
    }

    const override = this.findMatchingOverride(flag.overrides, context);
    if (override) {
      return this.result(flag.key, override.enabled, 'override', 'OVERRIDE_MATCH', {
        matchedOverrideId: override.id,
      });
    }

    if (flag.percentage > 0) {
      if (flag.percentage === 100) {
        return this.result(flag.key, true, 'percentage', 'PERCENTAGE_MATCH');
      }

      const targetingKey = this.resolveTargetingKey(flag, context, options.bucketBy);
      if (!targetingKey) {
        return this.result(
          flag.key,
          flag.enabled,
          'global',
          'PERCENTAGE_NO_TARGETING_KEY',
        );
      }

      const bucket = murmurhash3(flag.key + targetingKey) % 100;
      const enabled = bucket < flag.percentage;
      return this.result(
        flag.key,
        enabled,
        'percentage',
        enabled ? 'PERCENTAGE_MATCH' : 'PERCENTAGE_MISS',
        { bucket, targetingKey },
      );
    }

    return this.result(flag.key, flag.enabled, 'global', 'GLOBAL');
  }

  private findMatchingOverride(
    overrides: FlagOverride[],
    context: EvaluationContext,
  ): FlagOverride | null {
    const contextAttributes = context.attributes ?? {};

    return (
      overrides
        .filter((override) => matchesTargetingAttributes(override.attributes, contextAttributes))
        .sort(compareOverrides)[0] ?? null
    );
  }

  private resolveTargetingKey(
    flag: FeatureFlagWithOverrides,
    context: EvaluationContext,
    bucketBy?: BucketBy,
  ): string {
    if (context.targetingKey) {
      return context.targetingKey;
    }

    const configuredBucketBy = bucketBy ?? this.getMetadataBucketBy(flag.metadata);
    if (configuredBucketBy) {
      const configuredValue = this.readBucketValue(context, configuredBucketBy);
      if (configuredValue) {
        return configuredValue;
      }
    }

    return context.userId ?? context.tenantId ?? '';
  }

  private getMetadataBucketBy(metadata: Record<string, unknown>): BucketBy | undefined {
    const bucketBy = metadata.bucketBy;
    return typeof bucketBy === 'string' && bucketBy.length > 0 ? bucketBy : undefined;
  }

  private readBucketValue(context: EvaluationContext, bucketBy: BucketBy): string {
    if (bucketBy === 'userId') {
      return context.userId ?? '';
    }
    if (bucketBy === 'tenantId') {
      return context.tenantId ?? '';
    }
    if (bucketBy === 'environment') {
      return context.environment ?? '';
    }
    if (bucketBy === 'targetingKey') {
      return context.targetingKey ?? '';
    }

    return stringifyBucketValue(context.attributes?.[bucketBy]);
  }

  private result(
    flagKey: string,
    value: boolean,
    source: EvaluationSource,
    reason: EvaluationResult['reason'],
    details: Partial<EvaluationResult> = {},
  ): EvaluationResult {
    return {
      flagKey,
      value,
      result: value,
      source,
      reason,
      defaultUsed: false,
      ...details,
    };
  }
}

function stringifyBucketValue(value: TargetingAttributeValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function compareOverrides(a: FlagOverride, b: FlagOverride): number {
  const specificityDelta = Object.keys(b.attributes).length - Object.keys(a.attributes).length;
  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta = getOverrideCreatedAtTime(a) - getOverrideCreatedAtTime(b);
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return a.id.localeCompare(b.id);
}

function getOverrideCreatedAtTime(override: FlagOverride): number {
  const createdAt = override.createdAt as Date | string;
  return createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
}
