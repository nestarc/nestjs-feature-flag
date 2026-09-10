import { TargetingAttributes } from './feature-flag.interface';

export interface EvaluationContext {
  /** User ID for targeting and percentage bucketing. Null suppresses the ambient user ID. */
  userId?: string | null;

  /** Tenant ID for targeting and percentage bucketing, including without a tenancy package. Null suppresses the ambient tenant ID. */
  tenantId?: string | null;

  /** Environment defaults to module options. An explicit value or null overrides that default. */
  environment?: string | null;

  /** Non-empty stable key for percentage bucketing; takes precedence over bucketBy. Null or an empty string allows normal fallback. */
  targetingKey?: string | null;

  /** Additional exact-match targeting attributes */
  attributes?: TargetingAttributes;
}
