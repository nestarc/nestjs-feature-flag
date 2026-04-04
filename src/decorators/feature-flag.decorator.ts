import { SetMetadata, applyDecorators } from '@nestjs/common';
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY } from '../feature-flag.constants';
import { FeatureFlagGuardOptions } from '../interfaces/feature-flag.interface';

export function FeatureFlag(
  flagKey: string,
  options: FeatureFlagGuardOptions = {},
): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(FEATURE_FLAG_KEY, flagKey),
    SetMetadata(FEATURE_FLAG_OPTIONS_KEY, options),
  );
}
