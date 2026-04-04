import { SetMetadata } from '@nestjs/common';
import { BYPASS_FEATURE_FLAG_KEY } from '../feature-flag.constants';

export const BypassFeatureFlag = () => SetMetadata(BYPASS_FEATURE_FLAG_KEY, true);
