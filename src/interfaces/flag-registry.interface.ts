import { BucketBy } from './evaluation-details.interface';

export type FeatureFlagType = 'release' | 'experiment' | 'ops' | 'permission';

export interface FeatureFlagLifecycleMetadata {
  type?: FeatureFlagType;
  owner?: string;
  tags?: readonly string[];
  expiresAt?: string | Date;
  staleAt?: string | Date;
}

export interface FlagDefinition extends FeatureFlagLifecycleMetadata {
  defaultValue: boolean;
  description?: string;
  bucketBy?: BucketBy;
  trackExposure?: boolean;
}

export type FlagRegistry = Record<string, FlagDefinition>;
export type FlagKey<TFlags extends FlagRegistry> = Extract<keyof TFlags, string>;
