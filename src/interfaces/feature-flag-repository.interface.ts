import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  FeatureFlagWithOverrides,
} from './feature-flag.interface';

export interface OverrideCriteria {
  tenantId: string | null;
  userId: string | null;
  environment: string | null;
}

export interface FeatureFlagRepository {
  createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  updateFlag(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  archiveFlag(key: string): Promise<FeatureFlagWithOverrides>;
  findFlagByKey(key: string): Promise<FeatureFlagWithOverrides | null>;
  findFlagIdByKey(key: string): Promise<string | null>;
  findAllActiveFlags(): Promise<FeatureFlagWithOverrides[]>;
  findOverride(flagId: string, criteria: OverrideCriteria): Promise<{ id: string } | null>;
  createOverride(flagId: string, criteria: OverrideCriteria, enabled: boolean): Promise<void>;
  updateOverrideEnabled(id: string, enabled: boolean): Promise<void>;
  deleteOverride(id: string): Promise<void>;
}
