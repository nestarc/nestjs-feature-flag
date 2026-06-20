import { TargetingAttributes } from './feature-flag.interface';

export interface EvaluationContext {
  /** User ID - used for user-scoped targeting and percentage hash */
  userId?: string | null;

  /** Tenant ID - used for tenant-scoped targeting. Ignored if tenancy is not installed */
  tenantId?: string | null;

  /** Environment - auto-injected from module options. Can be explicitly overridden */
  environment?: string;

  /** Explicit stable key for percentage rollout bucketing */
  targetingKey?: string | null;

  /** Additional exact-match targeting attributes */
  attributes?: TargetingAttributes;
}
