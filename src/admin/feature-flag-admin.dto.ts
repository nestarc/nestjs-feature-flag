import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { BucketBy, EvaluateBooleanOptions } from '../interfaces/evaluation-details.interface';
import { TargetingAttributes } from '../interfaces/feature-flag.interface';
import { IsTargetingAttributes } from './targeting-attributes.validator';

export class CreateFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SetOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;

  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  priority?: number;
}

export class RemoveOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;
}

export class EvaluateFeatureFlagDto implements EvaluateBooleanOptions {
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  context?: EvaluationContext;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  bucketBy?: BucketBy;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  defaultValue?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  trackExposure?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  includeContextInEvent?: boolean;
}
