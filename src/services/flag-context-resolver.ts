import { Injectable, Inject } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS, TENANT_CONTEXT_PROVIDER } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { TenantContextProvider } from '../interfaces/tenant-context-provider.interface';
import { FlagContext } from './flag-context';

@Injectable()
export class FlagContextResolver {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    private readonly flagContext: FlagContext,
    @Inject(TENANT_CONTEXT_PROVIDER) private readonly tenantProvider: TenantContextProvider,
  ) {}

  resolve(explicit?: EvaluationContext): EvaluationContext {
    const userId =
      explicit?.userId !== undefined ? explicit.userId : this.flagContext.getUserId();
    const tenantId =
      explicit?.tenantId !== undefined
        ? explicit.tenantId
        : this.tenantProvider.getCurrentTenantId();
    const environment =
      explicit?.environment !== undefined ? explicit.environment : this.options.environment;

    return {
      userId,
      tenantId,
      environment,
      attributes: {
        ...(explicit?.attributes ?? {}),
        ...(userId !== undefined && { userId }),
        ...(tenantId !== undefined && { tenantId }),
        ...(environment !== undefined && { environment }),
      },
    };
  }
}
