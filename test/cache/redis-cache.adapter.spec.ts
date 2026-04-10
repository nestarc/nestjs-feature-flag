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

  it('should skip setAll when ttlMs is 0', async () => {
    await adapter.setAll([makeFlag('A')], 0);
    expect(await adapter.getAll()).toBeNull();
  });

  it('should auto-create subscriber when none is provided (ownsSubscriber=true)', async () => {
    const ownedAdapter = new RedisCacheAdapter({ client: client as any });
    const flag = makeFlag('Z');
    await ownedAdapter.set('Z', flag, 5000);
    expect(await ownedAdapter.get('Z')).toEqual(expect.objectContaining({ key: 'Z' }));
    await ownedAdapter.onModuleDestroy();
  });

  it('should handle invalidate all when there are no keys (empty flushLocal)', async () => {
    // No keys set — flushLocal should be a no-op
    await adapter.invalidate();
    expect(await adapter.getAll()).toBeNull();
  });

  it('should handle pub/sub __all__ message by flushing local cache', async () => {
    await adapter.set('A', makeFlag('A'), 5000);
    // Simulate a pub/sub message for __all__ arriving on the subscriber
    subscriber.emit('message', 'feature-flag:invalidate', '__all__');
    // Allow async del to process
    await new Promise((r) => setImmediate(r));
    expect(await adapter.get('A')).toBeNull();
  });

  it('should handle pub/sub specific key message by deleting that key', async () => {
    await adapter.set('B', makeFlag('B'), 5000);
    await adapter.setAll([makeFlag('B')], 5000);
    // Simulate a pub/sub message for key 'B'
    subscriber.emit('message', 'feature-flag:invalidate', 'B');
    await new Promise((r) => setImmediate(r));
    expect(await adapter.get('B')).toBeNull();
  });

  it('should ignore pub/sub messages on wrong channel', async () => {
    await adapter.set('C', makeFlag('C'), 5000);
    subscriber.emit('message', 'wrong:channel', 'C');
    await new Promise((r) => setImmediate(r));
    // Key should still be present since wrong channel was ignored
    expect(await adapter.get('C')).toEqual(expect.objectContaining({ key: 'C' }));
  });
});
