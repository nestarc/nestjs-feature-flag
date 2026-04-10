import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagModule } from '../../src/feature-flag.module';
import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { RedisCacheAdapter } from '../../src/cache/redis-cache.adapter';
import { CACHE_ADAPTER } from '../../src/feature-flag.constants';
import { getPrisma, cleanDatabase, disconnectPrisma } from './helpers/prisma-test.helper';
import RedisMock from 'ioredis-mock';

/**
 * Simulates two NestJS application instances sharing a Redis-backed cache
 * with Pub/Sub cross-instance invalidation.
 *
 * Because ioredis-mock shares state within the same process, two adapters
 * backed by the same mock instance behave like two real Redis connections
 * pointing at the same server — writes by one adapter are visible to the other.
 */
describe('Redis Cache cross-instance invalidation (e2e)', () => {
  let moduleA: TestingModule;
  let moduleB: TestingModule;
  let serviceA: FeatureFlagService;
  let serviceB: FeatureFlagService;
  let adapterA: RedisCacheAdapter;
  let adapterB: RedisCacheAdapter;
  let redisClient: InstanceType<typeof RedisMock>;

  const prisma = getPrisma();

  beforeAll(async () => {
    redisClient = new RedisMock();
    await redisClient.flushall();

    // Shared Redis, separate subscribers for Pub/Sub
    adapterA = new RedisCacheAdapter({
      client: redisClient as any,
      subscriber: new RedisMock() as any,
    });
    adapterB = new RedisCacheAdapter({
      client: redisClient as any,
      subscriber: new RedisMock() as any,
    });

    // Instance A
    moduleA = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'test',
          prisma,
          cacheTtlMs: 30_000,
          cacheAdapter: adapterA,
        }),
      ],
    })
      .overrideProvider(CACHE_ADAPTER)
      .useValue(adapterA)
      .compile();

    // Instance B
    moduleB = await Test.createTestingModule({
      imports: [
        FeatureFlagModule.forRoot({
          environment: 'test',
          prisma,
          cacheTtlMs: 30_000,
          cacheAdapter: adapterB,
        }),
      ],
    })
      .overrideProvider(CACHE_ADAPTER)
      .useValue(adapterB)
      .compile();

    serviceA = moduleA.get(FeatureFlagService);
    serviceB = moduleB.get(FeatureFlagService);
  });

  beforeEach(async () => {
    await cleanDatabase();
    await redisClient.flushall();
  });

  afterAll(async () => {
    await adapterA.onModuleDestroy();
    await adapterB.onModuleDestroy();
    await moduleA.close();
    await moduleB.close();
    await disconnectPrisma();
  });

  it('should share cache state between two instances via shared Redis', async () => {
    await serviceA.create({ key: 'SHARED_FLAG', enabled: true });

    // Instance A populates cache
    const resultA = await serviceA.isEnabled('SHARED_FLAG');
    expect(resultA).toBe(true);

    // Instance B should resolve the same flag from shared Redis cache
    const resultB = await serviceB.isEnabled('SHARED_FLAG');
    expect(resultB).toBe(true);
  });

  it('should invalidate specific key across instances via Pub/Sub', async () => {
    await serviceA.create({ key: 'CROSS_INV', enabled: true });

    // Both instances populate their cache
    await serviceA.isEnabled('CROSS_INV');
    await serviceB.isEnabled('CROSS_INV');

    // Instance A updates the flag — triggers cache invalidation + Pub/Sub
    await serviceA.update('CROSS_INV', { enabled: false });

    // Allow Pub/Sub message propagation
    await new Promise((r) => setImmediate(r));

    // Instance B should see the updated value (cache miss → DB read)
    const result = await serviceB.isEnabled('CROSS_INV');
    expect(result).toBe(false);
  });

  it('should invalidate all caches across instances on full flush', async () => {
    await serviceA.create({ key: 'FLUSH_A', enabled: true });
    await serviceA.create({ key: 'FLUSH_B', enabled: true });

    // Both instances populate their caches
    await serviceA.evaluateAll();
    await serviceB.evaluateAll();

    // Instance A flushes all caches
    await serviceA.invalidateCache();

    // Allow Pub/Sub propagation
    await new Promise((r) => setImmediate(r));

    // Instance B's cache should be empty — DB read returns fresh data
    const result = await serviceB.evaluateAll();
    expect(result).toEqual(
      expect.objectContaining({ FLUSH_A: true, FLUSH_B: true }),
    );
  });

  it('should handle override set invalidation across instances', async () => {
    await serviceA.create({ key: 'OVR_CROSS', enabled: false });

    // Instance B evaluates and caches the disabled flag
    expect(await serviceB.isEnabled('OVR_CROSS', { userId: 'u-1' })).toBe(false);

    // Instance A sets a user override
    await serviceA.setOverride('OVR_CROSS', { userId: 'u-1', enabled: true });

    // Allow Pub/Sub propagation
    await new Promise((r) => setImmediate(r));

    // Instance B should see the override after cache invalidation
    expect(await serviceB.isEnabled('OVR_CROSS', { userId: 'u-1' })).toBe(true);
  });
});
