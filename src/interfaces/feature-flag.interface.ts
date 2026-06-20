export type TargetingAttributeValue = string | number | boolean | null;
export type TargetingAttributes = Record<string, TargetingAttributeValue>;

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
  attributes: TargetingAttributes;
  enabled: boolean;
  priority?: number;
}

export interface FeatureFlagGuardOptions {
  /** HTTP status code when flag is OFF. Default: 403 */
  statusCode?: number;

  /** Response body when flag is OFF */
  fallback?: Record<string, unknown>;

  /** Invocation-level default when the guard cannot find or evaluate the flag. Default: false */
  defaultValue?: boolean;
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
  attributes: TargetingAttributes;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemoveOverrideInput {
  attributes: TargetingAttributes;
}

export interface FlagMutationMetadata {
  actorId?: string;
  actorType?: string;
  reason?: string;
  requestId?: string;
  correlationId?: string;
}
