import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { EvaluateBooleanOptions } from '../interfaces/evaluation-details.interface';
import { TargetingAttributes } from '../interfaces/feature-flag.interface';
import { IsTargetingAttributes } from './targeting-attributes.validator';

export class CreateFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SetOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class RemoveOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;
}

export class EvaluateFeatureFlagDto implements EvaluateBooleanOptions {
  @IsOptional()
  @IsObject()
  context?: EvaluationContext;

  @IsOptional()
  @IsBoolean()
  defaultValue?: boolean;

  @IsOptional()
  @IsBoolean()
  trackExposure?: boolean;

  @IsOptional()
  @IsBoolean()
  includeContextInEvent?: boolean;
}
