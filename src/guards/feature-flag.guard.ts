import { Injectable, CanActivate, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  FEATURE_FLAG_KEY,
  FEATURE_FLAG_OPTIONS_KEY,
  BYPASS_FEATURE_FLAG_KEY,
} from '../feature-flag.constants';
import { FeatureFlagGuardOptions } from '../interfaces/feature-flag.interface';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check bypass
    const bypass =
      this.reflector.get<boolean>(BYPASS_FEATURE_FLAG_KEY, handler) ||
      this.reflector.get<boolean>(BYPASS_FEATURE_FLAG_KEY, classRef);
    if (bypass) return true;

    // Check flag key (handler-level first, then class-level)
    const flagKey =
      this.reflector.get<string>(FEATURE_FLAG_KEY, handler) ??
      this.reflector.get<string>(FEATURE_FLAG_KEY, classRef);
    if (!flagKey) return true;

    const options: FeatureFlagGuardOptions =
      this.reflector.get<FeatureFlagGuardOptions>(FEATURE_FLAG_OPTIONS_KEY, handler) ??
      this.reflector.get<FeatureFlagGuardOptions>(FEATURE_FLAG_OPTIONS_KEY, classRef) ??
      {};

    const enabled = await this.featureFlagService.isEnabled(flagKey);

    if (!enabled) {
      const statusCode = options.statusCode ?? 403;
      const body = options.fallback ?? { message: 'Feature not available' };
      throw new HttpException(body, statusCode);
    }

    return true;
  }
}
