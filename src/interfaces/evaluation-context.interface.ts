export interface EvaluationContext {
  /** User ID — used for user overrides and percentage hash */
  userId?: string | null;

  /** Tenant ID — used for tenant overrides. Ignored if tenancy is not installed */
  tenantId?: string | null;

  /** Environment — auto-injected from module options. Can be explicitly overridden */
  environment?: string;
}
