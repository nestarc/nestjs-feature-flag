import { Test } from '@nestjs/testing';
import { CanActivate, DynamicModule, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { FeatureFlagAdminModule } from '../../src/admin/feature-flag-admin.module';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

@Injectable()
class MockGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByKey: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
  setOverride: jest.fn(),
  removeOverride: jest.fn(),
};

/**
 * Simulates FeatureFlagModule.forRoot() for unit tests — provides a mock
 * FeatureFlagService globally, exactly as the real module does.
 */
@Module({})
class MockFeatureFlagModule {
  static forTest(): DynamicModule {
    return {
      module: MockFeatureFlagModule,
      global: true,
      providers: [{ provide: FeatureFlagService, useValue: mockService }],
      exports: [FeatureFlagService],
    };
  }
}

describe('FeatureFlagAdminModule', () => {
  it('should register the controller with a guard', async () => {
    const module = await Test.createTestingModule({
      imports: [
        MockFeatureFlagModule.forTest(),
        FeatureFlagAdminModule.register({ guard: MockGuard }),
      ],
    }).compile();

    const controller = module.get(FeatureFlagAdminController);
    expect(controller).toBeDefined();
  });

  it('should throw if guard is not provided', () => {
    expect(() => {
      FeatureFlagAdminModule.register({} as any);
    }).toThrow();
  });
});
