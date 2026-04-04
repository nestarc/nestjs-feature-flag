import { EvaluationContext } from '../interfaces/evaluation-context.interface';

export const FeatureFlagEvents = {
  EVALUATED: 'feature-flag.evaluated',
  CREATED: 'feature-flag.created',
  UPDATED: 'feature-flag.updated',
  ARCHIVED: 'feature-flag.archived',
  OVERRIDE_SET: 'feature-flag.override.set',
  OVERRIDE_REMOVED: 'feature-flag.override.removed',
  CACHE_INVALIDATED: 'feature-flag.cache.invalidated',
} as const;

export interface FlagEvaluatedEvent {
  flagKey: string;
  result: boolean;
  context: EvaluationContext;
  source: 'user_override' | 'tenant_override' | 'env_override' | 'percentage' | 'global';
  evaluationTimeMs: number;
}

export interface FlagMutationEvent {
  flagKey: string;
  action: 'created' | 'updated' | 'archived';
}

export interface FlagOverrideEvent {
  flagKey: string;
  tenantId?: string | null;
  userId?: string | null;
  environment?: string | null;
  enabled: boolean;
  action: 'set' | 'removed';
}
