import { DynamicModule, Module } from '@nestjs/common';
import { FeatureFlagAdminController } from './feature-flag-admin.controller';
import { FeatureFlagAdminOptions } from './admin-options.interface';

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
      providers: [options.guard],
    };
  }
}
