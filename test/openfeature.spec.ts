import { createOpenFeatureBooleanProvider } from '../src/openfeature';
import { FeatureFlagService } from '../src/services/feature-flag.service';

describe('OpenFeature boolean provider adapter', () => {
  it('should expose provider metadata', () => {
    const service = {} as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service, {
      name: '@nestarc/feature-flag-test',
    });

    expect(provider.metadata.name).toBe('@nestarc/feature-flag-test');
  });

  it('should resolve boolean evaluations through FeatureFlagService', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({
        flagKey: 'MY_FLAG',
        value: true,
        result: true,
        source: 'global',
        reason: 'GLOBAL',
        defaultUsed: false,
        evaluationTimeMs: 1,
      }),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation(
      'MY_FLAG',
      false,
      {
        targetingKey: 'user-1',
        tenantId: 'tenant-1',
        plan: 'pro',
      },
    );

    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'MY_FLAG',
      {
        targetingKey: 'user-1',
        tenantId: 'tenant-1',
        attributes: { plan: 'pro' },
      },
      { defaultValue: false },
    );
    expect(result).toEqual(
      expect.objectContaining({
        value: true,
        reason: 'STATIC',
        flagMetadata: expect.objectContaining({
          source: 'global',
          localReason: 'GLOBAL',
          defaultUsed: false,
        }),
      }),
    );
  });

  it('should map missing flags to OpenFeature DEFAULT reason', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({
        flagKey: 'MISSING',
        value: true,
        result: true,
        source: 'default',
        reason: 'FLAG_NOT_FOUND',
        defaultUsed: true,
        evaluationTimeMs: 1,
      }),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MISSING', true, {});

    expect(result.value).toBe(true);
    expect(result.reason).toBe('DEFAULT');
  });
});
