import { MemoryCacheAdapter } from '../../src/cache/memory-cache.adapter';
import { RedisCacheAdapter } from '../../src/cache/redis-cache.adapter';
import { CacheAdapter } from '../../src/interfaces/cache-adapter.interface';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';
import RedisMock from 'ioredis-mock';

function makeFlag(key: string, enabled = true): FeatureFlagWithOverrides {
  return {
    id: `uuid-${key}`,
    key,
    description: null,
    enabled,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    overrides: [],
  };
}

/**
 * Shared contract suite that any CacheAdapter implementation must satisfy.
 * Tests get/set, getAll/setAll, invalidate, and TTL-zero skip semantics.
 */
function cacheAdapterContractSuite(
  name: string,
  factory: () => Promise<{ adapter: CacheAdapter; teardown: () => Promise<void> }>,
) {
  describe(`CacheAdapter contract: ${name}`, () => {
    let adapter: CacheAdapter;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const ctx = await factory();
      adapter = ctx.adapter;
      teardown = ctx.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    // ── get / set ──────────────────────────────────

    it('should return null for a cache miss', async () => {
      expect(await adapter.get('NONEXISTENT')).toBeNull();
    });

    it('should store and retrieve a single flag', async () => {
      const flag = makeFlag('FLAG_A');
      await adapter.set('FLAG_A', flag, 10_000);

      const result = await adapter.get('FLAG_A');
      expect(result).toEqual(expect.objectContaining({ key: 'FLAG_A', enabled: true }));
    });

    it('should store multiple distinct keys independently', async () => {
      await adapter.set('X', makeFlag('X'), 10_000);
      await adapter.set('Y', makeFlag('Y', false), 10_000);

      const x = await adapter.get('X');
      const y = await adapter.get('Y');
      expect(x!.key).toBe('X');
      expect(y!.enabled).toBe(false);
    });

    it('should overwrite an existing entry on repeated set', async () => {
      await adapter.set('OVR', makeFlag('OVR', true), 10_000);
      await adapter.set('OVR', makeFlag('OVR', false), 10_000);

      const result = await adapter.get('OVR');
      expect(result!.enabled).toBe(false);
    });

    // ── getAll / setAll ────────────────────────────

    it('should return null when all-flags cache is empty', async () => {
      expect(await adapter.getAll()).toBeNull();
    });

    it('should store and retrieve the all-flags list', async () => {
      const flags = [makeFlag('A'), makeFlag('B'), makeFlag('C')];
      await adapter.setAll(flags, 10_000);

      const result = await adapter.getAll();
      expect(result).toHaveLength(3);
    });

    // ── invalidate (specific key) ──────────────────

    it('should remove a specific key on invalidate(key)', async () => {
      await adapter.set('DEL', makeFlag('DEL'), 10_000);
      await adapter.invalidate('DEL');
      expect(await adapter.get('DEL')).toBeNull();
    });

    it('should clear allFlagsCache when a specific key is invalidated', async () => {
      await adapter.setAll([makeFlag('A')], 10_000);
      await adapter.invalidate('A');
      expect(await adapter.getAll()).toBeNull();
    });

    it('should not affect other keys when invalidating a specific key', async () => {
      await adapter.set('KEEP', makeFlag('KEEP'), 10_000);
      await adapter.set('REMOVE', makeFlag('REMOVE'), 10_000);
      await adapter.invalidate('REMOVE');

      expect(await adapter.get('KEEP')).not.toBeNull();
      expect(await adapter.get('REMOVE')).toBeNull();
    });

    // ── invalidate (all) ───────────────────────────

    it('should clear all entries on invalidate() with no key', async () => {
      await adapter.set('A', makeFlag('A'), 10_000);
      await adapter.set('B', makeFlag('B'), 10_000);
      await adapter.setAll([makeFlag('A'), makeFlag('B')], 10_000);

      await adapter.invalidate();

      expect(await adapter.get('A')).toBeNull();
      expect(await adapter.get('B')).toBeNull();
      expect(await adapter.getAll()).toBeNull();
    });

    // ── TTL = 0 skip ───────────────────────────────

    it('should skip caching when ttlMs is 0 (set)', async () => {
      await adapter.set('ZERO', makeFlag('ZERO'), 0);
      expect(await adapter.get('ZERO')).toBeNull();
    });

    it('should skip caching when ttlMs is 0 (setAll)', async () => {
      await adapter.setAll([makeFlag('A')], 0);
      expect(await adapter.getAll()).toBeNull();
    });
  });
}

// ── Memory adapter ───────────────────────────────

cacheAdapterContractSuite('MemoryCacheAdapter', async () => {
  const adapter = new MemoryCacheAdapter();
  return { adapter, teardown: async () => {} };
});

// ── Redis adapter ────────────────────────────────

cacheAdapterContractSuite('RedisCacheAdapter', async () => {
  const client = new RedisMock();
  const subscriber = new RedisMock();
  await client.flushall();
  const adapter = new RedisCacheAdapter({
    client: client as any,
    subscriber: subscriber as any,
  });
  return {
    adapter,
    teardown: async () => {
      await adapter.onModuleDestroy!();
    },
  };
});
