import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TenantContextProvider } from '../interfaces/tenant-context-provider.interface';

@Injectable()
export class DefaultTenantContextProvider implements TenantContextProvider {
  constructor(private readonly moduleRef: ModuleRef) {}

  getCurrentTenantId(): string | null {
    try {
      const { TenancyService } = require('@nestarc/tenancy');
      const tenancyService = this.moduleRef.get(TenancyService, { strict: false });
      return tenancyService?.getCurrentTenant() ?? null;
    } catch {
      return null;
    }
  }
}
