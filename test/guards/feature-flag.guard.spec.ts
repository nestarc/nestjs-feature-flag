import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { FeatureFlagGuard } from '../../src/guards/feature-flag.guard';
import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY, BYPASS_FEATURE_FLAG_KEY } from '../../src/feature-flag.constants';

function createMockContext(handler: Function, classRef: Function = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let reflector: Reflector;
  let mockService: Partial<FeatureFlagService>;

  beforeEach(() => {
    reflector = new Reflector();
    mockService = {
      isEnabled: jest.fn(),
    };
    guard = new FeatureFlagGuard(reflector, mockService as FeatureFlagService);
  });

  it('should allow access when no flag key is set', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should allow access when bypass is set', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: unknown) => {
      if (key === BYPASS_FEATURE_FLAG_KEY) return true;
      return undefined;
    });

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should allow access when flag is enabled', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: unknown) => {
      if (key === FEATURE_FLAG_KEY) return 'MY_FLAG';
      if (key === FEATURE_FLAG_OPTIONS_KEY) return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(true);

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw 403 when flag is disabled', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: unknown) => {
      if (key === FEATURE_FLAG_KEY) return 'MY_FLAG';
      if (key === FEATURE_FLAG_OPTIONS_KEY) return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(false);

    const ctx = createMockContext(handler);
    try {
      await guard.canActivate(ctx);
      fail('Expected HttpException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(403);
    }
  });

  it('should use custom statusCode and fallback from options', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: unknown) => {
      if (key === FEATURE_FLAG_KEY) return 'MY_FLAG';
      if (key === FEATURE_FLAG_OPTIONS_KEY) return {
        statusCode: 402,
        fallback: { message: 'Upgrade your plan' },
      };
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(false);

    const ctx = createMockContext(handler);
    try {
      await guard.canActivate(ctx);
      fail('Expected HttpException');
    } catch (e: any) {
      expect(e.getStatus()).toBe(402);
      expect(e.getResponse()).toEqual({ message: 'Upgrade your plan' });
    }
  });

  it('should check class-level flag key when handler has none', async () => {
    const handler = () => {};
    const classRef = class TestController {};

    jest.spyOn(reflector, 'get').mockImplementation((key: unknown, target: unknown) => {
      if (key === FEATURE_FLAG_KEY && target === handler) return undefined;
      if (key === FEATURE_FLAG_KEY && target === classRef) return 'CLASS_FLAG';
      if (key === FEATURE_FLAG_OPTIONS_KEY) return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(true);

    const ctx = createMockContext(handler, classRef);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockService.isEnabled).toHaveBeenCalledWith('CLASS_FLAG');
  });
});
