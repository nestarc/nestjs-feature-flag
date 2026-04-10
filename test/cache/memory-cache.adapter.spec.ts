import { MemoryCacheAdapter } from '../../src/cache/memory-cache.adapter';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';

function makeFlag(key: string): FeatureFlagWithOverrides {
  return {
    id: 'uuid-1',
    key,
    description: null,
    enabled: true,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
  };
}

describe('MemoryCacheAdapter', () => {
  let adapter: MemoryCacheAdapter;

  beforeEach(() => {
    adapter = new MemoryCacheAdapter();
  });

  it('should return null for a cache miss', async () => {
    expect(await adapter.get('UNKNOWN')).toBeNull();
  });

  it('should store and retrieve a flag', async () => {
    const flag = makeFlag('MY_FLAG');
    await adapter.set('MY_FLAG', flag, 5000);
    expect(await adapter.get('MY_FLAG')).toEqual(flag);
  });

  it('should return null after TTL expires', async () => {
    jest.useFakeTimers();
    const flag = makeFlag('MY_FLAG');
    await adapter.set('MY_FLAG', flag, 5000);
    jest.advanceTimersByTime(5001);
    expect(await adapter.get('MY_FLAG')).toBeNull();
    jest.useRealTimers();
  });

  it('should store and retrieve all-flags cache', async () => {
    const flags = [makeFlag('A'), makeFlag('B')];
    await adapter.setAll(flags, 5000);
    expect(await adapter.getAll()).toEqual(flags);
  });

  it('should return null for all-flags cache miss', async () => {
    expect(await adapter.getAll()).toBeNull();
  });

  it('should return null for all-flags cache after TTL expires', async () => {
    jest.useFakeTimers();
    await adapter.setAll([makeFlag('A')], 5000);
    jest.advanceTimersByTime(5001);
    expect(await adapter.getAll()).toBeNull();
    jest.useRealTimers();
  });

  it('should invalidate a specific key and clear allFlagsCache', async () => {
    await adapter.set('A', makeFlag('A'), 5000);
    await adapter.set('B', makeFlag('B'), 5000);
    await adapter.setAll([makeFlag('A'), makeFlag('B')], 5000);
    await adapter.invalidate('A');
    expect(await adapter.get('A')).toBeNull();
    expect(await adapter.get('B')).not.toBeNull();
    expect(await adapter.getAll()).toBeNull();
  });

  it('should invalidate all keys when no key is provided', async () => {
    await adapter.set('A', makeFlag('A'), 5000);
    await adapter.set('B', makeFlag('B'), 5000);
    await adapter.invalidate();
    expect(await adapter.get('A')).toBeNull();
    expect(await adapter.get('B')).toBeNull();
  });

  it('should skip caching when ttlMs is 0', async () => {
    await adapter.set('MY_FLAG', makeFlag('MY_FLAG'), 0);
    expect(await adapter.get('MY_FLAG')).toBeNull();
  });

  it('should skip caching all flags when ttlMs is 0', async () => {
    await adapter.setAll([makeFlag('A')], 0);
    expect(await adapter.getAll()).toBeNull();
  });
});
