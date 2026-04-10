# @nestarc/feature-flag v0.2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CacheAdapter abstraction (Memory + Redis with Pub/Sub invalidation) and REST Admin API module to `@nestarc/feature-flag`.

**Architecture:** Extract `FlagCacheService` into a `CacheAdapter` interface with `MemoryCacheAdapter` (refactored) and `RedisCacheAdapter` (new, includes Pub/Sub). Add `FeatureFlagAdminModule` as an opt-in separate module with guard injection. All `FeatureFlagService` cache calls become async.

**Tech Stack:** NestJS 11, TypeScript, Prisma 6, ioredis (optional peer), Jest

**Working Directory:** `C:/Users/ksy/Documents/GitHub/nestjs-feature-flag`

---

## File Structure

### New Files
- `src/interfaces/cache-adapter.interface.ts` — CacheAdapter interface + RemoveOverrideInput
- `src/cache/memory-cache.adapter.ts` — MemoryCacheAdapter (refactored from FlagCacheService)
- `src/cache/redis-cache.adapter.ts` — RedisCacheAdapter with Pub/Sub
- `src/admin/feature-flag-admin.module.ts` — FeatureFlagAdminModule
- `src/admin/feature-flag-admin.controller.ts` — REST endpoints
- `src/admin/admin-options.interface.ts` — AdminModuleOptions
- `test/cache/memory-cache.adapter.spec.ts` — MemoryCacheAdapter tests
- `test/cache/redis-cache.adapter.spec.ts` — RedisCacheAdapter tests with ioredis-mock
- `test/cache/cache-adapter.contract.spec.ts` — Shared contract test suite
- `test/admin/feature-flag-admin.controller.spec.ts` — Controller tests
- `test/admin/feature-flag-admin.module.spec.ts` — Module registration tests

### Modified Files
- `src/interfaces/feature-flag-options.interface.ts` — add `cacheAdapter?` field
- `src/feature-flag.constants.ts` — add `CACHE_ADAPTER` token
- `src/feature-flag.module.ts` — wire CacheAdapter, remove FlagCacheService
- `src/services/feature-flag.service.ts` — async cache calls, add `findByKey()`, `removeOverride()`
- `src/index.ts` — export new public API
- `test/services/feature-flag.service.spec.ts` — update for async cache

### Deleted Files
- `src/services/flag-cache.service.ts` — replaced by `src/cache/memory-cache.adapter.ts`
- `test/services/flag-cache.service.spec.ts` — replaced by `test/cache/memory-cache.adapter.spec.ts`

---

### Task 1: CacheAdapter Interface

**Files:**
- Create: `src/interfaces/cache-adapter.interface.ts`
- Modify: `src/feature-flag.constants.ts`
- Test: (no tests — interface only)

- [ ] **Step 1: Create the CacheAdapter interface**

```typescript
// src/interfaces/cache-adapter.interface.ts
import { FeatureFlagWithOverrides } from './feature-flag.interface';

export interface CacheAdapter {
  get(key: string): Promise<FeatureFlagWithOverrides | null>;
  set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void>;
  getAll(): Promise<FeatureFlagWithOverrides[] | null>;
  setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void>;
  invalidate(key?: string): Promise<void>;
  onModuleDestroy?(): Promise<void>;
}

export interface RemoveOverrideInput {
  tenantId?: string;
  userId?: string;
  environment?: string;
}
```

- [ ] **Step 2: Add CACHE_ADAPTER constant**

In `src/feature-flag.constants.ts`, add:

```typescript
export const CACHE_ADAPTER = Symbol('CACHE_ADAPTER');
```

- [ ] **Step 3: Add cacheAdapter to module options**

In `src/interfaces/feature-flag-options.interface.ts`, add:

```typescript
import { CacheAdapter } from './cache-adapter.interface';

export interface FeatureFlagModuleOptions {
  // ... existing fields ...
  /** Custom cache adapter. Default: MemoryCacheAdapter */
  cacheAdapter?: CacheAdapter;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/interfaces/cache-adapter.interface.ts src/feature-flag.constants.ts src/interfaces/feature-flag-options.interface.ts
git commit -m "feat: add CacheAdapter interface and RemoveOverrideInput type"
```

---

### Task 2: MemoryCacheAdapter (TDD)

**Files:**
- Create: `src/cache/memory-cache.adapter.ts`
- Create: `test/cache/memory-cache.adapter.spec.ts`
- Delete: `src/services/flag-cache.service.ts`
- Delete: `test/services/flag-cache.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/cache/memory-cache.adapter.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/cache/memory-cache.adapter.spec.ts --no-coverage`
Expected: FAIL — Cannot find module `../../src/cache/memory-cache.adapter`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/cache/memory-cache.adapter.ts
import { Injectable } from '@nestjs/common';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class MemoryCacheAdapter implements CacheAdapter {
  private cache = new Map<string, CacheEntry<FeatureFlagWithOverrides>>();
  private allFlagsCache: CacheEntry<FeatureFlagWithOverrides[]> | null = null;

  async get(key: string): Promise<FeatureFlagWithOverrides | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  async set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  async getAll(): Promise<FeatureFlagWithOverrides[] | null> {
    if (!this.allFlagsCache) return null;
    if (Date.now() > this.allFlagsCache.expiresAt) {
      this.allFlagsCache = null;
      return null;
    }
    return this.allFlagsCache.data;
  }

  async setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    this.allFlagsCache = { data, expiresAt: Date.now() + ttlMs };
  }

  async invalidate(key?: string): Promise<void> {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
    this.allFlagsCache = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/cache/memory-cache.adapter.spec.ts --no-coverage`
Expected: All 10 tests PASS

- [ ] **Step 5: Delete old FlagCacheService files**

```bash
rm src/services/flag-cache.service.ts
rm test/services/flag-cache.service.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/cache/memory-cache.adapter.ts test/cache/memory-cache.adapter.spec.ts
git rm src/services/flag-cache.service.ts test/services/flag-cache.service.spec.ts
git commit -m "feat: add MemoryCacheAdapter implementing CacheAdapter interface"
```

---

### Task 3: Wire CacheAdapter into Module + Service

**Files:**
- Modify: `src/feature-flag.module.ts`
- Modify: `src/services/feature-flag.service.ts`
- Modify: `test/services/feature-flag.service.spec.ts`

- [ ] **Step 1: Update FeatureFlagModule to use CACHE_ADAPTER**

In `src/feature-flag.module.ts`:

Replace `FlagCacheService` import with `MemoryCacheAdapter` and `CACHE_ADAPTER`:

```typescript
import { MemoryCacheAdapter } from './cache/memory-cache.adapter';
import { CACHE_ADAPTER } from './feature-flag.constants';
```

Remove `FlagCacheService` from `coreProviders` array. Add `CACHE_ADAPTER` provider in `forRoot()`:

```typescript
// Inside forRoot(), add before ...coreProviders:
{
  provide: CACHE_ADAPTER,
  useValue: options.cacheAdapter ?? new MemoryCacheAdapter(),
},
```

And in `forRootAsync()`, add the CACHE_ADAPTER provider:

```typescript
{
  provide: CACHE_ADAPTER,
  useFactory: (full: FeatureFlagModuleRootOptions) =>
    full.cacheAdapter ?? new MemoryCacheAdapter(),
  inject: [FULL_OPTIONS],
},
```

Update exports to include `CACHE_ADAPTER`.

- [ ] **Step 2: Update FeatureFlagService to use CacheAdapter**

In `src/services/feature-flag.service.ts`:

Replace `FlagCacheService` import and injection:

```typescript
import { CACHE_ADAPTER } from '../feature-flag.constants';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { RemoveOverrideInput } from '../interfaces/cache-adapter.interface';

// In constructor:
@Inject(CACHE_ADAPTER) private readonly cacheAdapter: CacheAdapter,
// Remove: private readonly cache: FlagCacheService,
```

Make all cache calls async. Replace every `this.cache.xxx` with `await this.cacheAdapter.xxx`. Pass `this.options.cacheTtlMs ?? 30_000` as the ttlMs argument to `set()` and `setAll()`.

Add `findByKey()`:

```typescript
async findByKey(key: string): Promise<FeatureFlagWithOverrides> {
  const flag = await this.prisma.featureFlag.findUnique({
    where: { key },
    include: { overrides: true },
  });
  if (!flag) {
    throw new NotFoundException(`Feature flag "${key}" not found`);
  }
  return flag;
}
```

Add `removeOverride()`:

```typescript
async removeOverride(key: string, input: RemoveOverrideInput): Promise<void> {
  const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) {
    throw new NotFoundException(`Feature flag "${key}" not found`);
  }

  const where = {
    flagId: flag.id,
    tenantId: input.tenantId ?? null,
    userId: input.userId ?? null,
    environment: input.environment ?? null,
  };

  const existing = await this.prisma.featureFlagOverride.findFirst({ where });
  if (existing) {
    await this.prisma.featureFlagOverride.delete({ where: { id: existing.id } });
  }

  await this.cacheAdapter.invalidate(key);

  if (this.options.emitEvents && this.eventEmitter) {
    this.eventEmitter.emit(FeatureFlagEvents.OVERRIDE_REMOVED, {
      flagKey: key,
      ...input,
      action: 'removed',
    });
  }
}
```

Update `invalidateCache()` to be async:

```typescript
async invalidateCache(): Promise<void> {
  await this.cacheAdapter.invalidate();
  // ... event emission
}
```

- [ ] **Step 3: Update service tests for async cache**

In `test/services/feature-flag.service.spec.ts`:

Replace `FlagCacheService` mock with `CacheAdapter` mock:

```typescript
const mockCacheAdapter = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  getAll: jest.fn().mockResolvedValue(null),
  setAll: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
};
```

Update the service construction to inject `mockCacheAdapter` via `CACHE_ADAPTER` token. Update all test assertions from `cache.get('key')` to `cacheAdapter.get('key')`, and from `toHaveBeenCalledWith('key', flag)` to `toHaveBeenCalledWith('key', flag, 30000)` (includes ttlMs).

Add tests for `findByKey()` (found + not found) and `removeOverride()` (found + not found + event emission).

- [ ] **Step 4: Run all tests**

Run: `npx jest --selectProjects unit --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/feature-flag.module.ts src/services/feature-flag.service.ts test/services/feature-flag.service.spec.ts
git commit -m "feat: wire CacheAdapter into module and service, add findByKey/removeOverride"
```

---

### Task 4: RedisCacheAdapter (TDD)

**Files:**
- Create: `src/cache/redis-cache.adapter.ts`
- Create: `test/cache/redis-cache.adapter.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/cache/redis-cache.adapter.spec.ts
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

  beforeEach(() => {
    client = new RedisMock();
    subscriber = new RedisMock();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/cache/redis-cache.adapter.spec.ts --no-coverage`
Expected: FAIL — Cannot find module `../../src/cache/redis-cache.adapter`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/cache/redis-cache.adapter.ts
import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CacheAdapter } from '../interfaces/cache-adapter.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

export interface RedisCacheAdapterOptions {
  client: Redis;
  subscriber?: Redis;
  keyPrefix?: string;
  channel?: string;
}

@Injectable()
export class RedisCacheAdapter implements CacheAdapter {
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly keyPrefix: string;
  private readonly channel: string;
  private readonly ownsSubscriber: boolean;

  constructor(options: RedisCacheAdapterOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'feature-flag:';
    this.channel = options.channel ?? 'feature-flag:invalidate';

    if (options.subscriber) {
      this.subscriber = options.subscriber;
      this.ownsSubscriber = false;
    } else {
      this.subscriber = this.client.duplicate();
      this.ownsSubscriber = true;
    }

    this.subscriber.subscribe(this.channel);
    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch !== this.channel) return;
      if (message === '__all__') {
        this.flushLocal();
      } else {
        this.client.del(this.prefixedKey(message));
        this.client.del(this.prefixedKey('__all__'));
      }
    });
  }

  async get(key: string): Promise<FeatureFlagWithOverrides | null> {
    const raw = await this.client.get(this.prefixedKey(key));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    await this.client.set(this.prefixedKey(key), JSON.stringify(data), 'PX', ttlMs);
  }

  async getAll(): Promise<FeatureFlagWithOverrides[] | null> {
    const raw = await this.client.get(this.prefixedKey('__all__'));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void> {
    if (ttlMs === 0) return;
    await this.client.set(this.prefixedKey('__all__'), JSON.stringify(data), 'PX', ttlMs);
  }

  async invalidate(key?: string): Promise<void> {
    if (key) {
      await this.client.del(this.prefixedKey(key));
      await this.client.del(this.prefixedKey('__all__'));
      await this.client.publish(this.channel, key);
    } else {
      await this.flushLocal();
      await this.client.publish(this.channel, '__all__');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe(this.channel);
    if (this.ownsSubscriber) {
      await this.subscriber.quit();
    }
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async flushLocal(): Promise<void> {
    const keys = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/cache/redis-cache.adapter.spec.ts --no-coverage`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache/redis-cache.adapter.ts test/cache/redis-cache.adapter.spec.ts
git commit -m "feat: add RedisCacheAdapter with Pub/Sub invalidation"
```

---

### Task 5: FeatureFlagAdminModule + Controller (TDD)

**Files:**
- Create: `src/admin/admin-options.interface.ts`
- Create: `src/admin/feature-flag-admin.module.ts`
- Create: `src/admin/feature-flag-admin.controller.ts`
- Create: `test/admin/feature-flag-admin.controller.spec.ts`
- Create: `test/admin/feature-flag-admin.module.spec.ts`

- [ ] **Step 1: Create the admin options interface**

```typescript
// src/admin/admin-options.interface.ts
import { CanActivate, Type } from '@nestjs/common';

export interface FeatureFlagAdminOptions {
  /** Guard class to protect all admin endpoints. Required. */
  guard: Type<CanActivate>;
  /** Route prefix. Default: 'feature-flags' */
  path?: string;
}
```

- [ ] **Step 2: Write failing controller tests**

```typescript
// test/admin/feature-flag-admin.controller.spec.ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

const mockFlag = {
  id: 'uuid-1',
  key: 'TEST_FLAG',
  description: null,
  enabled: true,
  percentage: 0,
  metadata: {},
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  overrides: [],
};

const mockService = {
  create: jest.fn().mockResolvedValue(mockFlag),
  findAll: jest.fn().mockResolvedValue([mockFlag]),
  findByKey: jest.fn().mockResolvedValue(mockFlag),
  update: jest.fn().mockResolvedValue(mockFlag),
  archive: jest.fn().mockResolvedValue({ ...mockFlag, archivedAt: new Date() }),
  setOverride: jest.fn().mockResolvedValue(undefined),
  removeOverride: jest.fn().mockResolvedValue(undefined),
};

describe('FeatureFlagAdminController', () => {
  let controller: FeatureFlagAdminController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [FeatureFlagAdminController],
      providers: [
        { provide: FeatureFlagService, useValue: mockService },
      ],
    }).compile();

    controller = module.get(FeatureFlagAdminController);
    jest.clearAllMocks();
  });

  it('should create a flag', async () => {
    const input = { key: 'TEST_FLAG', enabled: true };
    const result = await controller.create(input);
    expect(mockService.create).toHaveBeenCalledWith(input);
    expect(result.key).toBe('TEST_FLAG');
  });

  it('should list all flags', async () => {
    const result = await controller.findAll();
    expect(mockService.findAll).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('should get a single flag by key', async () => {
    const result = await controller.findByKey('TEST_FLAG');
    expect(mockService.findByKey).toHaveBeenCalledWith('TEST_FLAG');
    expect(result.key).toBe('TEST_FLAG');
  });

  it('should update a flag', async () => {
    const input = { enabled: false };
    await controller.update('TEST_FLAG', input);
    expect(mockService.update).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should archive a flag', async () => {
    const result = await controller.archive('TEST_FLAG');
    expect(mockService.archive).toHaveBeenCalledWith('TEST_FLAG');
    expect(result.archivedAt).not.toBeNull();
  });

  it('should set an override', async () => {
    const input = { tenantId: 't-1', enabled: true };
    await controller.setOverride('TEST_FLAG', input);
    expect(mockService.setOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should remove an override', async () => {
    const input = { tenantId: 't-1' };
    await controller.removeOverride('TEST_FLAG', input);
    expect(mockService.removeOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest test/admin/feature-flag-admin.controller.spec.ts --no-coverage`
Expected: FAIL — Cannot find module

- [ ] **Step 4: Write the controller**

```typescript
// src/admin/feature-flag-admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { RemoveOverrideInput } from '../interfaces/cache-adapter.interface';

@Controller()
export class FeatureFlagAdminController {
  constructor(private readonly service: FeatureFlagService) {}

  @Post()
  create(@Body() input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    return this.service.create(input);
  }

  @Get()
  findAll(): Promise<FeatureFlagWithOverrides[]> {
    return this.service.findAll();
  }

  @Get(':key')
  findByKey(@Param('key') key: string): Promise<FeatureFlagWithOverrides> {
    return this.service.findByKey(key);
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() input: UpdateFeatureFlagInput,
  ): Promise<FeatureFlagWithOverrides> {
    return this.service.update(key, input);
  }

  @Delete(':key')
  archive(@Param('key') key: string): Promise<FeatureFlagWithOverrides> {
    return this.service.archive(key);
  }

  @Post(':key/overrides')
  setOverride(
    @Param('key') key: string,
    @Body() input: SetOverrideInput,
  ): Promise<void> {
    return this.service.setOverride(key, input);
  }

  @Delete(':key/overrides')
  removeOverride(
    @Param('key') key: string,
    @Body() input: RemoveOverrideInput,
  ): Promise<void> {
    return this.service.removeOverride(key, input);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/admin/feature-flag-admin.controller.spec.ts --no-coverage`
Expected: All 7 tests PASS

- [ ] **Step 6: Write failing module tests**

```typescript
// test/admin/feature-flag-admin.module.spec.ts
import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FeatureFlagAdminModule } from '../../src/admin/feature-flag-admin.module';
import { FeatureFlagAdminController } from '../../src/admin/feature-flag-admin.controller';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

@Injectable()
class MockGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByKey: jest.fn(),
  update: jest.fn(),
  archive: jest.fn(),
  setOverride: jest.fn(),
  removeOverride: jest.fn(),
};

describe('FeatureFlagAdminModule', () => {
  it('should register the controller with a guard', async () => {
    const module = await Test.createTestingModule({
      imports: [FeatureFlagAdminModule.register({ guard: MockGuard })],
      providers: [{ provide: FeatureFlagService, useValue: mockService }],
    }).compile();

    const controller = module.get(FeatureFlagAdminController);
    expect(controller).toBeDefined();
  });

  it('should throw if guard is not provided', () => {
    expect(() => {
      FeatureFlagAdminModule.register({} as any);
    }).toThrow();
  });
});
```

- [ ] **Step 7: Write the admin module**

```typescript
// src/admin/feature-flag-admin.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FeatureFlagAdminController } from './feature-flag-admin.controller';
import { FeatureFlagAdminOptions } from './admin-options.interface';

@Module({})
export class FeatureFlagAdminModule {
  static register(options: FeatureFlagAdminOptions): DynamicModule {
    if (!options.guard) {
      throw new Error(
        'FeatureFlagAdminModule requires a guard. ' +
        'Pass your auth guard via register({ guard: MyGuard }).',
      );
    }

    const path = options.path ?? 'feature-flags';

    // Dynamically set the controller route prefix
    Reflect.defineMetadata('path', path, FeatureFlagAdminController);

    return {
      module: FeatureFlagAdminModule,
      controllers: [FeatureFlagAdminController],
      providers: [
        options.guard,
        {
          provide: APP_GUARD,
          useExisting: options.guard,
        },
      ],
    };
  }
}
```

Note: The `APP_GUARD` approach here applies the guard globally within this module's scope. An alternative is using `@UseGuards()` on the controller — implement whichever pattern the existing codebase uses. If `APP_GUARD` leaks to other modules, switch to controller-level `@UseGuards()` with a provider for the guard class.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest test/admin/feature-flag-admin.module.spec.ts --no-coverage`
Expected: All 2 tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/admin/ test/admin/
git commit -m "feat: add FeatureFlagAdminModule with REST controller and guard injection"
```

---

### Task 6: Update Barrel Exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add new exports**

Add to `src/index.ts`:

```typescript
// Cache adapters
export type { CacheAdapter, RemoveOverrideInput } from './interfaces/cache-adapter.interface';
export { MemoryCacheAdapter } from './cache/memory-cache.adapter';
export { RedisCacheAdapter, type RedisCacheAdapterOptions } from './cache/redis-cache.adapter';

// Admin module
export { FeatureFlagAdminModule } from './admin/feature-flag-admin.module';
export type { FeatureFlagAdminOptions } from './admin/admin-options.interface';

// Constants
export { CACHE_ADAPTER } from './feature-flag.constants';
```

- [ ] **Step 2: Run all unit tests**

Run: `npx jest --selectProjects unit --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export CacheAdapter, RedisCacheAdapter, and FeatureFlagAdminModule"
```

---

### Task 7: Full Test Suite Verification

**Files:**
- All test files

- [ ] **Step 1: Run full unit test suite with coverage**

Run: `npx jest --selectProjects unit --coverage`
Expected: All tests PASS, coverage >= 90% on branches/functions/lines/statements

- [ ] **Step 2: Fix any coverage gaps**

If coverage drops below 90%, add tests for uncovered branches. Common gaps:
- `RedisCacheAdapter.onModuleDestroy()` with ownsSubscriber=true vs false
- `FeatureFlagService.findByKey()` NotFoundException path
- `FeatureFlagService.removeOverride()` event emission when emitEvents=true
- `FeatureFlagAdminModule.register()` with custom `path`

- [ ] **Step 3: Update package.json version**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bump version to 0.2.0, ensure full test coverage"
```

---

### Task 8: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README**

Add sections for:
- `cacheAdapter` option in configuration reference
- `RedisCacheAdapter` usage example with ioredis
- Pub/Sub invalidation explanation
- `FeatureFlagAdminModule.register()` usage example
- REST endpoint table

- [ ] **Step 2: Update CHANGELOG**

Add v0.2.0 section:

```markdown
## [0.2.0] — 2026-04-10

### Added
- `CacheAdapter` interface for pluggable cache backends
- `MemoryCacheAdapter` (refactored from internal FlagCacheService)
- `RedisCacheAdapter` with Redis Pub/Sub for cross-instance cache invalidation
- `FeatureFlagAdminModule` with REST CRUD controller and guard injection
- `findByKey()` and `removeOverride()` methods on FeatureFlagService
- `RemoveOverrideInput` type
- `CACHE_ADAPTER` injection token

### Changed
- All cache operations are now async (CacheAdapter interface)
- `cacheAdapter` option added to FeatureFlagModuleOptions (optional, defaults to MemoryCacheAdapter)

### Removed
- `FlagCacheService` (internal, replaced by CacheAdapter)
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: update README and CHANGELOG for v0.2.0"
```
