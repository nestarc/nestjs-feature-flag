import { createOpenFeatureBooleanProvider } from '../src/openfeature';
import { FeatureFlagService } from '../src/services/feature-flag.service';

jest.mock('@openfeature/server-sdk', () => {
  throw new Error('The adapter must not load the optional SDK at runtime');
});

describe('OpenFeature boolean provider adapter', () => {
  it('should expose provider metadata', () => {
    const service = { evaluateBoolean: jest.fn() };
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
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
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
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    await provider.resolveBooleanEvaluation('MY_FLAG', false, {
      targetingKey: null,
      userId: null,
      tenantId: null,
      environment: null,
      plan: 'enterprise',
      nested: { unsupported: true },
      tags: ['unsupported'],
    });

    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'MY_FLAG',
      expect.objectContaining({
        targetingKey: null,
        userId: null,
        tenantId: null,
        environment: null,
        attributes: { plan: 'enterprise' },
      }),
      { defaultValue: false },
    );
  });

  it('should leave absent context dimensions undefined so the service can use ambient values', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({
        flagKey: 'MY_FLAG',
        value: true,
        result: true,
        reason: 'GLOBAL',
        source: 'global',
        defaultUsed: false,
      }),
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    await provider.resolveBooleanEvaluation('MY_FLAG', false, {});

    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'MY_FLAG',
      {
        targetingKey: undefined,
        userId: undefined,
        tenantId: undefined,
        environment: undefined,
        attributes: {},
      },
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
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', false, {});

    expect(result.reason).toBe(expected);
    expect(result.flagMetadata.localReason).toBe(reason);
  });

  it('should map service Error failures to OpenFeature error details', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockRejectedValue(new TypeError('adapter failure')),
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', true, {});

    expect(result).toEqual(
      expect.objectContaining({
        value: true,
        reason: 'ERROR',
        errorCode: 'GENERAL',
        errorMessage: 'adapter failure',
      }),
    );
    expect(result.flagMetadata).toEqual(
      expect.objectContaining({
        source: 'default',
        localReason: 'ERROR',
        defaultUsed: true,
        localErrorCode: 'TypeError',
      }),
    );
  });

  it('should stringify non-Error service failures', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockRejectedValue('adapter failure'),
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MY_FLAG', false, {});

    expect(result).toEqual(
      expect.objectContaining({
        value: false,
        reason: 'ERROR',
        errorCode: 'GENERAL',
        errorMessage: 'adapter failure',
      }),
    );
  });

  it('should map missing flags to the OpenFeature FLAG_NOT_FOUND error', async () => {
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
    } satisfies Pick<FeatureFlagService, 'evaluateBoolean'>;
    const provider = createOpenFeatureBooleanProvider(service);

    const result = await provider.resolveBooleanEvaluation('MISSING', true, {});

    expect(result.value).toBe(true);
    expect(result.reason).toBe('ERROR');
    expect(result.errorCode).toBe('FLAG_NOT_FOUND');
  });

  it('should omit absent metadata values and preserve scalar values including zero', async () => {
    const provider = createOpenFeatureBooleanProvider({
      evaluateBoolean: async () => ({
        flagKey: 'ROLLOUT',
        value: true,
        result: true,
        reason: 'PERCENTAGE_MATCH',
        source: 'percentage',
        defaultUsed: false,
        bucket: 0,
        targetingKey: 'user-1',
      }),
    });

    const result = await provider.resolveBooleanEvaluation('ROLLOUT', false, {});

    expect(result.flagMetadata).toEqual({
      source: 'percentage',
      localReason: 'PERCENTAGE_MATCH',
      defaultUsed: false,
      bucket: 0,
      targetingKey: 'user-1',
    });
  });

  it('should expose the local service error separately from the standard SDK error code', async () => {
    const provider = createOpenFeatureBooleanProvider({
      evaluateBoolean: async () => ({
        flagKey: 'BROKEN',
        value: false,
        result: false,
        reason: 'ERROR',
        source: 'default',
        defaultUsed: true,
        errorCode: 'PrismaClientKnownRequestError',
        errorMessage: 'database unavailable',
      }),
    });

    const result = await provider.resolveBooleanEvaluation('BROKEN', false, {});

    expect(result.errorCode).toBe('GENERAL');
    expect(result.errorMessage).toBe('database unavailable');
    expect(result.flagMetadata.localErrorCode).toBe('PrismaClientKnownRequestError');
  });
});
