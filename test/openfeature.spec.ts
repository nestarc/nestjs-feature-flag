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

  it('should preserve null known context values and ignore unsupported attributes', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({
        flagKey: 'MY_FLAG',
        value: false,
        result: false,
        source: 'default',
        reason: 'FLAG_NOT_FOUND',
        defaultUsed: true,
        evaluationTimeMs: 1,
      }),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    await provider.resolveBooleanEvaluation('MY_FLAG', false, {
      userId: null,
      environment: 'production',
      plan: 'enterprise',
      nested: { unsupported: true },
      tags: ['unsupported'],
    });

    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'MY_FLAG',
      expect.objectContaining({
        userId: null,
        environment: 'production',
        attributes: { plan: 'enterprise' },
      }),
      { defaultValue: false },
    );
  });

  it.each([
    ['OVERRIDE_MATCH', 'TARGETING_MATCH'],
    ['PERCENTAGE_MATCH', 'SPLIT'],
    ['PERCENTAGE_MISS', 'SPLIT'],
    ['PERCENTAGE_NO_TARGETING_KEY', 'DEFAULT'],
    ['ERROR', 'ERROR'],
    ['ARCHIVED', 'DISABLED'],
  ] as const)('should map local %s reason to OpenFeature %s', async (reason, expected) => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({
        flagKey: 'MY_FLAG',
        value: true,
        result: true,
        source: 'global',
        reason,
        defaultUsed: false,
        evaluationTimeMs: 1,
      }),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', false, {});

    expect(result.reason).toBe(expected);
    expect(result.flagMetadata.localReason).toBe(reason);
  });

  it('should map service Error failures to OpenFeature error details', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockRejectedValue(new TypeError('adapter failure')),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', true, {});

    expect(result).toEqual(
      expect.objectContaining({
        value: true,
        reason: 'ERROR',
        errorCode: 'TypeError',
        errorMessage: 'adapter failure',
      }),
    );
    expect(result.flagMetadata).toEqual(
      expect.objectContaining({
        source: 'default',
        localReason: 'ERROR',
        defaultUsed: true,
      }),
    );
  });

  it('should stringify non-Error service failures', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockRejectedValue('adapter failure'),
    } as unknown as FeatureFlagService;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', false, {});

    expect(result).toEqual(
      expect.objectContaining({
        value: false,
        reason: 'ERROR',
        errorCode: 'Error',
        errorMessage: 'adapter failure',
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
