import { DynamicModule, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FeatureFlagAdminController } from './feature-flag-admin.controller';
import { FeatureFlagAdminOptions } from './admin-options.interface';
import { FeatureFlagService } from '../services/feature-flag.service';

@Module({})
export class FeatureFlagAdminModule {
  static register(options: FeatureFlagAdminOptions): DynamicModule {
    if (!options.guard) {
      throw new Error(
        'FeatureFlagAdminModule requires a guard. ' +
        'Pass your auth guard via register({ guard: MyGuard }).',
      );
    }

    const path = options.path ?? 'feature-flags';

    Reflect.defineMetadata('path', path, FeatureFlagAdminController);
    Reflect.defineMetadata('__guards__', [options.guard], FeatureFlagAdminController);

    return {
      module: FeatureFlagAdminModule,
      controllers: [FeatureFlagAdminController],
      providers: [
        options.guard,
        {
          provide: FeatureFlagService,
          useFactory: (moduleRef: ModuleRef) =>
            moduleRef.get(FeatureFlagService, { strict: false }),
          inject: [ModuleRef],
        },
      ],
    };
  }
}
