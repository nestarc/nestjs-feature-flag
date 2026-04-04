import { Injectable } from '@nestjs/common';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { murmurhash3 } from '../utils/hash';
import { FlagEvaluatedEvent } from '../events/feature-flag.events';

type EvaluationSource = FlagEvaluatedEvent['source'];

export interface EvaluationResult {
  result: boolean;
  source: EvaluationSource;
}

@Injectable()
export class FlagEvaluatorService {
  evaluate(flag: FeatureFlagWithOverrides, context: EvaluationContext): EvaluationResult {
    // 1. Archived → always false
    if (flag.archivedAt) {
      return { result: false, source: 'global' };
    }

    // 2. User override (most specific)
    if (context.userId) {
      const userOverride = flag.overrides.find(
        (o) =>
          o.userId === context.userId &&
          (o.tenantId === null || o.tenantId === context.tenantId) &&
          (o.environment === null || o.environment === context.environment),
      );
      if (userOverride) {
        return { result: userOverride.enabled, source: 'user_override' };
      }
    }

    // 3. Tenant override
    if (context.tenantId) {
      const tenantOverride = flag.overrides.find(
        (o) =>
          o.tenantId === context.tenantId &&
          o.userId === null &&
          (o.environment === null || o.environment === context.environment),
      );
      if (tenantOverride) {
        return { result: tenantOverride.enabled, source: 'tenant_override' };
      }
    }

    // 4. Environment override
    if (context.environment) {
      const envOverride = flag.overrides.find(
        (o) => o.environment === context.environment && o.tenantId === null && o.userId === null,
      );
      if (envOverride) {
        return { result: envOverride.enabled, source: 'env_override' };
      }
    }

    // 5. Percentage rollout
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

    // 6. Global default
    return { result: flag.enabled, source: 'global' };
  }
}
