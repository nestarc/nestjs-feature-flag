import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import {
  EvaluationReason,
  EvaluationSource,
} from '../interfaces/evaluation-details.interface';

export const FeatureFlagEvents = {
  EVALUATED: 'feature-flag.evaluated',
  EXPOSED: 'feature-flag.exposed',
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
  value?: boolean;
  context?: EvaluationContext;
  source: EvaluationSource;
  reason?: EvaluationReason;
  defaultUsed?: boolean;
  errorCode?: string;
  errorMessage?: string;
  matchedOverrideId?: string;
  bucket?: number;
  targetingKey?: string;
  evaluationTimeMs: number;
}

export interface FlagExposedEvent {
  flagKey: string;
  value: boolean;
  result: boolean;
  source: EvaluationSource;
  reason: EvaluationReason;
  defaultUsed: boolean;
  context?: EvaluationContext;
  matchedOverrideId?: string;
  bucket?: number;
  targetingKey?: string;
  evaluationTimeMs?: number;
}

export interface FlagMutationEvent {
  flagKey: string;
  action: 'created' | 'updated' | 'archived';
  actorId?: string;
  actorType?: string;
  reason?: string;
  requestId?: string;
  correlationId?: string;
}

export interface FlagOverrideEvent {
  flagKey: string;
  attributes: Record<string, string | number | boolean | null>;
  enabled?: boolean;
  priority?: number;
  action: 'set' | 'removed';
  actorId?: string;
  actorType?: string;
  reason?: string;
  requestId?: string;
  correlationId?: string;
}
