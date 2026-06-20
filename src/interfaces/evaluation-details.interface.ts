export type EvaluationSource = 'override' | 'percentage' | 'global' | 'default';

export type EvaluationReason =
  | 'ARCHIVED'
  | 'OVERRIDE_MATCH'
  | 'PERCENTAGE_MATCH'
  | 'PERCENTAGE_MISS'
  | 'PERCENTAGE_NO_TARGETING_KEY'
  | 'GLOBAL'
  | 'FLAG_NOT_FOUND'
  | 'ERROR';

export type BucketBy =
  | 'userId'
  | 'tenantId'
  | 'environment'
  | 'targetingKey'
  | (string & {});

export interface EvaluateBooleanOptions {
  /** Invocation-level default used when the flag is missing or evaluation fails. */
  defaultValue?: boolean;

  /** Emit an exposure event for this evaluation. */
  trackExposure?: boolean;

  /** Include the full resolved context in evaluation/exposure events. */
  includeContextInEvent?: boolean;
}

export interface BooleanEvaluationDetails {
  flagKey: string;
  value: boolean;
  /** Backward-compatible alias for value. */
  result: boolean;
  source: EvaluationSource;
  reason: EvaluationReason;
  defaultUsed: boolean;
  errorCode?: string;
  errorMessage?: string;
  matchedOverrideId?: string;
  bucket?: number;
  targetingKey?: string;
  evaluationTimeMs?: number;
}

export interface FlagEvaluatorOptions {
  bucketBy?: BucketBy;
}
