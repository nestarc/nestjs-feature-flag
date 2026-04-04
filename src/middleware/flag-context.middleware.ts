import { Injectable, Inject, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FlagContext } from '../services/flag-context';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';

@Injectable()
export class FlagContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: FlagContext,
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const userId = this.options.userIdExtractor?.(req) ?? null;
    this.context.run({ userId }, () => next());
  }
}
