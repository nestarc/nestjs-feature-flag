import { FlagCacheService } from '../../src/services/flag-cache.service';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';

function makeFlagData(key: string): FeatureFlagWithOverrides {
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

describe('FlagCacheService', () => {
  let cache: FlagCacheService;

  beforeEach(() => {
    cache = new FlagCacheService({ cacheTtlMs: 5000, environment: 'test' });
  });

  it('should return null for a cache miss', () => {
    expect(cache.get('UNKNOWN')).toBeNull();
  });

  it('should store and retrieve a flag', () => {
    const flag = makeFlagData('MY_FLAG');
    cache.set('MY_FLAG', flag);
    expect(cache.get('MY_FLAG')).toEqual(flag);
  });

  it('should return null after TTL expires', () => {
    jest.useFakeTimers();

    const flag = makeFlagData('MY_FLAG');
    cache.set('MY_FLAG', flag);
    expect(cache.get('MY_FLAG')).toEqual(flag);

    jest.advanceTimersByTime(5001);
    expect(cache.get('MY_FLAG')).toBeNull();

    jest.useRealTimers();
  });

  it('should not cache when cacheTtlMs is 0', () => {
    const noCache = new FlagCacheService({ cacheTtlMs: 0, environment: 'test' });
    noCache.set('MY_FLAG', makeFlagData('MY_FLAG'));
    expect(noCache.get('MY_FLAG')).toBeNull();
  });

  it('should invalidate a specific key', () => {
    cache.set('A', makeFlagData('A'));
    cache.set('B', makeFlagData('B'));
    cache.invalidate('A');
    expect(cache.get('A')).toBeNull();
    expect(cache.get('B')).not.toBeNull();
  });

  it('should invalidate all keys when no key is provided', () => {
    cache.set('A', makeFlagData('A'));
    cache.set('B', makeFlagData('B'));
    cache.invalidate();
    expect(cache.get('A')).toBeNull();
    expect(cache.get('B')).toBeNull();
  });

  it('should store and retrieve all-flags cache', () => {
    const flags = [makeFlagData('A'), makeFlagData('B')];
    cache.setAll(flags);
    expect(cache.getAll()).toEqual(flags);
  });

  it('should return null for all-flags cache miss', () => {
    expect(cache.getAll()).toBeNull();
  });

  it('should clear all-flags cache on invalidate()', () => {
    cache.setAll([makeFlagData('A')]);
    cache.invalidate();
    expect(cache.getAll()).toBeNull();
  });
});
