import { RedisCacheAdapter } from '../../src/cache/redis-cache.adapter';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';
import RedisMock from 'ioredis-mock';

function makeFlag(key: string): FeatureFlagWithOverrides {
  return {
    id: 'uuid-1',
    key,
    description: null,
    enabled: true,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    overrides: [],
  };
}

describe('RedisCacheAdapter', () => {
  let adapter: RedisCacheAdapter;
  let client: InstanceType<typeof RedisMock>;
  let subscriber: InstanceType<typeof RedisMock>;

  beforeEach(async () => {
    client = new RedisMock();
    subscriber = new RedisMock();
    // ioredis-mock shares state across instances; flush before each test
    await client.flushall();
    adapter = new RedisCacheAdapter({ client: client as any, subscriber: subscriber as any });
  });

  afterEach(async () => {
    await adapter.onModuleDestroy();
  });

  it('should return null for a cache miss', async () => {
    expect(await adapter.get('UNKNOWN')).toBeNull();
  });

  it('should store and retrieve a flag', async () => {
    const flag = makeFlag('MY_FLAG');
    await adapter.set('MY_FLAG', flag, 5000);
    const result = await adapter.get('MY_FLAG');
    expect(result).toEqual(expect.objectContaining({ key: 'MY_FLAG', enabled: true }));
  });

  it('should store and retrieve all-flags cache', async () => {
    const flags = [makeFlag('A'), makeFlag('B')];
    await adapter.setAll(flags, 5000);
    const result = await adapter.getAll();
    expect(result).toHaveLength(2);
  });

  it('should return null for all-flags cache miss', async () => {
    expect(await adapter.getAll()).toBeNull();
  });

  it('should invalidate a specific key and publish', async () => {
    await adapter.set('A', makeFlag('A'), 5000);
    const publishSpy = jest.spyOn(client, 'publish');
    await adapter.invalidate('A');
    expect(await adapter.get('A')).toBeNull();
    expect(publishSpy).toHaveBeenCalledWith('feature-flag:invalidate', 'A');
  });

  it('should invalidate all keys and publish __all__', async () => {
    await adapter.set('A', makeFlag('A'), 5000);
    const publishSpy = jest.spyOn(client, 'publish');
    await adapter.invalidate();
    expect(publishSpy).toHaveBeenCalledWith('feature-flag:invalidate', '__all__');
  });

  it('should use custom keyPrefix and channel', async () => {
    const custom = new RedisCacheAdapter({
      client: client as any,
      subscriber: subscriber as any,
      keyPrefix: 'custom:',
      channel: 'custom:invalidate',
    });
    const flag = makeFlag('X');
    await custom.set('X', flag, 5000);
    const raw = await client.get('custom:X');
    expect(raw).not.toBeNull();
    await custom.onModuleDestroy();
  });

  it('should skip caching when ttlMs is 0', async () => {
    await adapter.set('MY_FLAG', makeFlag('MY_FLAG'), 0);
    expect(await adapter.get('MY_FLAG')).toBeNull();
  });
});
