import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  FeatureFlagWithOverrides,
  TargetingAttributes,
} from './feature-flag.interface';

export interface OverrideCriteria {
  attributes: TargetingAttributes;
}

export interface UpdateOverrideInput {
  enabled: boolean;
  priority: number;
}

export interface FeatureFlagRepository {
  createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  updateFlag(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  archiveFlag(key: string): Promise<FeatureFlagWithOverrides>;
  findFlagByKey(key: string): Promise<FeatureFlagWithOverrides | null>;
  findFlagIdByKey(key: string): Promise<string | null>;
  findAllActiveFlags(): Promise<FeatureFlagWithOverrides[]>;
  findOverride(flagId: string, criteria: OverrideCriteria): Promise<{ id: string } | null>;
  createOverride(
    flagId: string,
    criteria: OverrideCriteria,
    enabled: boolean,
    priority: number,
  ): Promise<void>;
  updateOverride(id: string, input: UpdateOverrideInput): Promise<void>;
  deleteOverride(id: string): Promise<void>;
}
