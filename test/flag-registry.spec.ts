import 'reflect-metadata';
import {
  defineFlags,
  createFeatureFlagClient,
  createFeatureFlagDecorators,
  getFlagLifecycleStatus,
} from '../src/flag-registry';
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY } from '../src/feature-flag.constants';
import { FeatureFlagService } from '../src/services/feature-flag.service';

describe('flag registry helpers', () => {
  const flags = defineFlags({
    NEW_CHECKOUT: {
      defaultValue: false,
      description: 'New checkout flow',
      bucketBy: 'tenantId',
      trackExposure: true,
      owner: 'payments',
      tags: ['checkout'],
      staleAt: '2026-06-10T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
    },
    ALWAYS_ON: {
      defaultValue: true,
    },
  });

  it('should return the same registry object from defineFlags', () => {
    expect(flags.NEW_CHECKOUT.defaultValue).toBe(false);
    expect(flags.NEW_CHECKOUT.bucketBy).toBe('tenantId');
  });

  it('should create a typed client that applies registry defaults', async () => {
    const service = {
      isEnabled: jest.fn().mockResolvedValue(true),
      evaluateBoolean: jest.fn().mockResolvedValue({ value: true }),
    } as unknown as FeatureFlagService;

    const client = createFeatureFlagClient(service, flags);

    await client.isEnabled('NEW_CHECKOUT', { tenantId: 'tenant-1' });
    await client.evaluateBoolean('NEW_CHECKOUT', { tenantId: 'tenant-1' });

    expect(service.isEnabled).toHaveBeenCalledWith(
      'NEW_CHECKOUT',
      { tenantId: 'tenant-1' },
      { defaultValue: false, bucketBy: 'tenantId', trackExposure: true },
    );
    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'NEW_CHECKOUT',
      { tenantId: 'tenant-1' },
      { defaultValue: false, bucketBy: 'tenantId', trackExposure: true },
    );
  });

  it('should let invocation options override registry options', async () => {
    const service = {
      evaluateBoolean: jest.fn().mockResolvedValue({ value: true }),
    } as unknown as FeatureFlagService;
    const client = createFeatureFlagClient(service, flags);

    await client.evaluateBoolean('NEW_CHECKOUT', { userId: 'user-1' }, {
      defaultValue: true,
      bucketBy: 'userId',
      trackExposure: false,
    });

    expect(service.evaluateBoolean).toHaveBeenCalledWith(
      'NEW_CHECKOUT',
      { userId: 'user-1' },
      { defaultValue: true, bucketBy: 'userId', trackExposure: false },
    );
  });

  it('should create decorators that attach typed flag metadata and defaultValue', () => {
    const decorators = createFeatureFlagDecorators(flags);

    class TestController {
      @decorators.FeatureFlag('ALWAYS_ON')
      handler() {
        return 'ok';
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      TestController.prototype,
      'handler',
    );

    expect(Reflect.getMetadata(FEATURE_FLAG_KEY, descriptor?.value)).toBe('ALWAYS_ON');
    expect(Reflect.getMetadata(FEATURE_FLAG_OPTIONS_KEY, descriptor?.value)).toEqual({
      defaultValue: true,
    });
  });

  it('should classify lifecycle metadata as active, stale, or expired', () => {
    expect(
      getFlagLifecycleStatus(flags.NEW_CHECKOUT, new Date('2026-06-01T00:00:00.000Z')),
    ).toEqual(
      expect.objectContaining({
        status: 'active',
        owner: 'payments',
        tags: ['checkout'],
      }),
    );
    expect(
      getFlagLifecycleStatus(flags.NEW_CHECKOUT, new Date('2026-06-15T00:00:00.000Z'))
        .status,
    ).toBe('stale');
    expect(
      getFlagLifecycleStatus(flags.NEW_CHECKOUT, new Date('2026-07-02T00:00:00.000Z'))
        .status,
    ).toBe('expired');
  });
});
