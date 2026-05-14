import { Injectable } from '@nestjs/common';
import { FeatureFlagWithOverrides, FlagOverride } from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { murmurhash3 } from '../utils/hash';
import { FlagEvaluatedEvent } from '../events/feature-flag.events';
import { matchesTargetingAttributes } from '../utils/targeting-attributes';

type EvaluationSource = FlagEvaluatedEvent['source'];

export interface EvaluationResult {
  result: boolean;
  source: EvaluationSource;
}

@Injectable()
export class FlagEvaluatorService {
  evaluate(flag: FeatureFlagWithOverrides, context: EvaluationContext): EvaluationResult {
    if (flag.archivedAt) {
      return { result: false, source: 'global' };
    }

    const override = this.findMatchingOverride(flag.overrides, context);
    if (override) {
      return { result: override.enabled, source: 'override' };
    }

    if (flag.percentage > 0) {
      if (flag.percentage === 100) {
        return { result: true, source: 'percentage' };
      }

      const hashKey = context.userId ?? context.tenantId ?? '';
      if (!hashKey) {
        return { result: flag.enabled, source: 'global' };
      }

      const bucket = murmurhash3(flag.key + hashKey) % 100;
      return { result: bucket < flag.percentage, source: 'percentage' };
    }

    return { result: flag.enabled, source: 'global' };
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

  const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return a.id.localeCompare(b.id);
}
