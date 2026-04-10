import { CanActivate, Type } from '@nestjs/common';

export interface FeatureFlagAdminOptions {
  guard: Type<CanActivate>;
  path?: string;
}
