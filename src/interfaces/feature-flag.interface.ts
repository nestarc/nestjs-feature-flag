export interface CreateFeatureFlagInput {
  key: string;
  description?: string;
  enabled?: boolean;
  percentage?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateFeatureFlagInput {
  description?: string;
  enabled?: boolean;
  percentage?: number;
  metadata?: Record<string, unknown>;
}

export interface SetOverrideInput {
  tenantId?: string;
  userId?: string;
  environment?: string;
  enabled: boolean;
}

export interface FeatureFlagGuardOptions {
  /** HTTP status code when flag is OFF. Default: 403 */
  statusCode?: number;

  /** Response body when flag is OFF */
  fallback?: Record<string, unknown>;
}

export interface FeatureFlagWithOverrides {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  percentage: number;
  metadata: Record<string, unknown>;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  overrides: FlagOverride[];
}

export interface FlagOverride {
  id: string;
  flagId: string;
  tenantId: string | null;
  userId: string | null;
  environment: string | null;
  enabled: boolean;
}
