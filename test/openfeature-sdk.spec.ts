import { ErrorCode, OpenFeature } from '@openfeature/server-sdk';
import { MemoryCacheAdapter } from '../src/cache/memory-cache.adapter';
import { FeatureFlagRepository } from '../src/interfaces/feature-flag-repository.interface';
import { FeatureFlagWithOverrides } from '../src/interfaces/feature-flag.interface';
import { createOpenFeatureBooleanProvider } from '../src/openfeature';
import { FeatureFlagService } from '../src/services/feature-flag.service';
import { FlagContextResolver } from '../src/services/flag-context-resolver';
import { FlagContext } from '../src/services/flag-context';
import { FlagEvaluatorService } from '../src/services/flag-evaluator.service';
import { FlagEventPublisher } from '../src/services/flag-event-publisher';

function flag(overrides: Partial<FeatureFlagWithOverrides> = {}): FeatureFlagWithOverrides {
  return {
    id: 'flag-1',
    key: 'CHECKOUT',
    description: null,
    enabled: true,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    overrides: [],
    ...overrides,
  };
}

describe('OpenFeature server SDK compatibility', () => {
  let repository: jest.Mocked<FeatureFlagRepository>;
  let service: FeatureFlagService;

  beforeEach(async () => {
    repository = {
      createFlag: jest.fn(),
      updateFlag: jest.fn(),
      archiveFlag: jest.fn(),
      findFlagByKey: jest.fn().mockResolvedValue(flag()),
      findFlagIdByKey: jest.fn(),
      findAllActiveFlags: jest.fn(),
      findOverride: jest.fn(),
      createOverride: jest.fn(),
      updateOverride: jest.fn(),
      deleteOverride: jest.fn(),
    };
    const options = { environment: 'test', cacheTtlMs: 0 };
    service = new FeatureFlagService(
      options,
      repository,
      new MemoryCacheAdapter(),
      new FlagEvaluatorService(),
      new FlagContextResolver(options, new FlagContext(), {
        getCurrentTenantId: () => null,
      }),
      new FlagEventPublisher(options),
    );

    // Passing the returned type directly also checks the public Provider contract.
    await OpenFeature.setProviderAndWait(createOpenFeatureBooleanProvider(service));
  });

  afterEach(async () => {
    await OpenFeature.clearProviders();
  });

  it('registers with either SDK registration method and resolves a boolean', async () => {
    OpenFeature.setProvider(createOpenFeatureBooleanProvider(service));
    const client = OpenFeature.getClient();

    expect(await client.getBooleanValue('CHECKOUT', false)).toBe(true);
    expect(await client.getBooleanDetails('CHECKOUT', false)).toEqual(
      expect.objectContaining({
        flagKey: 'CHECKOUT',
        value: true,
        reason: 'STATIC',
        flagMetadata: {
          source: 'global',
          localReason: 'GLOBAL',
          defaultUsed: false,
          evaluationTimeMs: expect.any(Number),
        },
      }),
    );
  });

  it('passes SDK context attributes into the actual targeting evaluator', async () => {
    repository.findFlagByKey.mockResolvedValue(
      flag({
        enabled: false,
        overrides: [
          {
            id: 'override-1',
            flagId: 'flag-1',
            attributes: { plan: 'pro', tenantId: 'tenant-1' },
            enabled: true,
            priority: 0,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ],
      }),
    );

    const details = await OpenFeature.getClient().getBooleanDetails('CHECKOUT', false, {
      targetingKey: 'user-1',
      tenantId: 'tenant-1',
      plan: 'pro',
    });

    expect(details.value).toBe(true);
    expect(details.reason).toBe('TARGETING_MATCH');
    expect(details.flagMetadata.matchedOverrideId).toBe('override-1');
    expect(details.errorCode).toBeUndefined();
  });

  it('keeps the configured fallback when a percentage flag has no targeting key', async () => {
    repository.findFlagByKey.mockResolvedValue(flag({ percentage: 50, enabled: true }));

    const details = await OpenFeature.getClient().getBooleanDetails('CHECKOUT', false);

    expect(details.value).toBe(true);
    expect(details.reason).toBe('DEFAULT');
    expect(details.errorCode).toBeUndefined();
    expect(details.flagMetadata.localReason).toBe('PERCENTAGE_NO_TARGETING_KEY');
  });

  it('uses the module environment when absent and suppresses it when explicitly null', async () => {
    repository.findFlagByKey.mockResolvedValue(
      flag({
        enabled: false,
        overrides: [
          {
            id: 'environment-override',
            flagId: 'flag-1',
            attributes: { environment: 'test' },
            enabled: true,
            priority: 0,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ],
      }),
    );
    const client = OpenFeature.getClient();

    expect(await client.getBooleanValue('CHECKOUT', false)).toBe(true);
    expect(await client.getBooleanValue('CHECKOUT', false, { environment: null })).toBe(false);
  });

  it.each([true, false])('returns caller default %s and FLAG_NOT_FOUND for a missing flag', async (defaultValue) => {
    repository.findFlagByKey.mockResolvedValue(null);

    const details = await OpenFeature.getClient().getBooleanDetails('MISSING', defaultValue);

    expect(details.value).toBe(defaultValue);
    expect(details.reason).toBe('ERROR');
    expect(details.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND);
    expect(details.flagMetadata.localReason).toBe('FLAG_NOT_FOUND');
    expect(details.flagMetadata.defaultUsed).toBe(true);
  });

  it('returns the caller default and GENERAL on service failures', async () => {
    repository.findFlagByKey.mockRejectedValue(new TypeError('database unavailable'));

    const details = await OpenFeature.getClient().getBooleanDetails('CHECKOUT', true);

    expect(details.value).toBe(true);
    expect(details.reason).toBe('ERROR');
    expect(details.errorCode).toBe(ErrorCode.GENERAL);
    expect(details.errorMessage).toBe('database unavailable');
    expect(details.flagMetadata.localErrorCode).toBe('TypeError');
  });

  it('returns defaults and TYPE_MISMATCH for all unsupported SDK value types', async () => {
    const client = OpenFeature.getClient();
    const objectDefault = { color: 'blue', limits: [1, 2] };
    const stringDetails = await client.getStringDetails('CHECKOUT', 'blue');
    const numberDetails = await client.getNumberDetails('CHECKOUT', 42);
    const objectDetails = await client.getObjectDetails<typeof objectDefault>(
      'CHECKOUT',
      objectDefault,
    );

    expect(stringDetails.value).toBe('blue');
    expect(numberDetails.value).toBe(42);
    expect(objectDetails.value.limits).toEqual([1, 2]);
    for (const details of [stringDetails, numberDetails, objectDetails]) {
      expect(details.reason).toBe('ERROR');
      expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH);
      expect(details.errorMessage).toBe('@nestarc/feature-flag supports boolean flags only');
    }
    expect(repository.findFlagByKey).not.toHaveBeenCalled();
  });
});
