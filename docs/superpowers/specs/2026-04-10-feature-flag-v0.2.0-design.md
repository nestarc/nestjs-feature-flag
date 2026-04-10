# @nestarc/feature-flag v0.2.0 Design Spec

**Goal:** Add REST Admin API, Redis cache adapter with Pub/Sub invalidation, and cache adapter abstraction to the feature-flag module.

**Scope:** Three features that together enable multi-instance production deployments with real-time flag management.

---

## 1. CacheAdapter Interface

### Interface

```typescript
interface CacheAdapter {
  get(key: string): Promise<FeatureFlagWithOverrides | null>;
  set(key: string, data: FeatureFlagWithOverrides, ttlMs: number): Promise<void>;
  getAll(): Promise<FeatureFlagWithOverrides[] | null>;
  setAll(data: FeatureFlagWithOverrides[], ttlMs: number): Promise<void>;
  invalidate(key?: string): Promise<void>;
  onModuleDestroy?(): Promise<void>;
}
```

### MemoryCacheAdapter

Refactored from existing `FlagCacheService`. Same `Map` + lazy TTL logic, methods wrapped as `async`. No behavioral change for existing users.

### Module Options Change

```typescript
interface FeatureFlagModuleOptions {
  // ... all existing options preserved
  cacheAdapter?: CacheAdapter;  // defaults to new MemoryCacheAdapter()
}
```

### FeatureFlagService Change

All cache calls become `await`-ed. TTL is passed at call site (adapter is TTL-policy-agnostic):
- `this.cache.get(key)` → `await this.cacheAdapter.get(key)`
- `this.cache.set(key, data)` → `await this.cacheAdapter.set(key, data, this.cacheTtlMs)`

### Backward Compatibility

- `cacheAdapter` is optional. If not provided, `MemoryCacheAdapter` is instantiated automatically.
- v0.1.0 `FeatureFlagModule.forRoot()` calls continue to work without changes.
- `FlagCacheService` is removed as a public export. It was internal — if any consumer imported it directly, that was undocumented usage.

---

## 2. RedisCacheAdapter

### Constructor Options

```typescript
interface RedisCacheAdapterOptions {
  client: Redis;           // ioredis instance for GET/SET
  subscriber?: Redis;      // Pub/Sub dedicated connection (defaults to client.duplicate())
  keyPrefix?: string;      // default: 'feature-flag:'
  channel?: string;        // default: 'feature-flag:invalidate'
}
```

### Cache Operations

| Operation | Redis Command |
|-----------|---------------|
| `get(key)` | `GET {prefix}{key}` → JSON.parse |
| `set(key, data, ttlMs)` | `SET {prefix}{key} {JSON.stringify(data)} PX {ttlMs}` |
| `getAll()` | `GET {prefix}__all__` → JSON.parse |
| `setAll(data, ttlMs)` | `SET {prefix}__all__ {JSON.stringify(data)} PX {ttlMs}` |
| `invalidate(key)` | `DEL {prefix}{key}` + `DEL {prefix}__all__` + `PUBLISH channel key` |
| `invalidate()` | scan+DEL `{prefix}*` + `PUBLISH channel __all__` |

### Pub/Sub Invalidation

- On construction: `subscriber.subscribe(channel)`
- On message: `DEL` the received key from local Redis (or flush all on `__all__`)
- Self-published messages are received but result in no-op DEL (already deleted locally)
- No instance-ID filtering needed

### subscriber Separation

ioredis enters Pub/Sub mode on `subscribe()` — the connection can no longer execute normal commands. A separate connection is required. `client.duplicate()` creates one with the same connection options.

### Lifecycle

- `onModuleDestroy()`: unsubscribe, quit subscriber if internally created (not if user-provided)

### Peer Dependency

`ioredis` remains an optional peer dependency. Only required when `RedisCacheAdapter` is used.

---

## 3. FeatureFlagAdminModule

### Registration

```typescript
FeatureFlagAdminModule.register({
  guard: AdminAuthGuard,      // required — module won't register without it
  path: 'feature-flags',     // default: 'feature-flags'
})
```

If `guard` is not provided, `register()` throws at startup with a descriptive error.

### REST Endpoints

| Method | Route | Action | Service Method |
|--------|-------|--------|----------------|
| `POST` | `/feature-flags` | Create flag | `service.create()` |
| `GET` | `/feature-flags` | List all flags | `service.findAll()` |
| `GET` | `/feature-flags/:key` | Get single flag | `service.findByKey()` (new) |
| `PATCH` | `/feature-flags/:key` | Update flag | `service.update()` |
| `DELETE` | `/feature-flags/:key` | Archive flag | `service.archive()` |
| `POST` | `/feature-flags/:key/overrides` | Set override | `service.setOverride()` |
| `DELETE` | `/feature-flags/:key/overrides` | Remove override | `service.removeOverride()` (new) |

### New Service Methods Required

- `findByKey(key: string): Promise<FeatureFlagWithOverrides>` — single flag lookup, throws NotFoundException if not found
- `removeOverride(key: string, input: RemoveOverrideInput): Promise<void>` — deletes matching override

```typescript
interface RemoveOverrideInput {
  tenantId?: string;
  userId?: string;
  environment?: string;
}
```

### Controller Design

- Pure delegation to `FeatureFlagService` — no business logic in controller
- Guard applied via `@UseGuards()` at controller level
- Uses existing input interfaces (no separate DTO classes)
- Route prefix configurable via `path` option (uses `@Controller()` with dynamic path)

### Module Design

- `FeatureFlagAdminModule` is NOT global — must be explicitly imported
- Does not import `FeatureFlagModule` — relies on `FeatureFlagService` being globally available from `FeatureFlagModule`
- Static `register()` method (not `forRoot`) — no async configuration needed

---

## 4. File Structure (New/Modified)

### New Files

```
src/
├── interfaces/
│   └── cache-adapter.interface.ts       # CacheAdapter interface
├── cache/
│   ├── memory-cache.adapter.ts          # MemoryCacheAdapter (refactored from FlagCacheService)
│   └── redis-cache.adapter.ts           # RedisCacheAdapter + Pub/Sub
└── admin/
    ├── feature-flag-admin.module.ts     # FeatureFlagAdminModule
    ├── feature-flag-admin.controller.ts # REST endpoints
    └── admin-options.interface.ts       # AdminModuleOptions
```

### Modified Files

```
src/
├── services/
│   ├── feature-flag.service.ts          # async cache calls, findByKey(), removeOverride()
│   └── flag-cache.service.ts            # DELETED (replaced by cache/memory-cache.adapter.ts)
├── feature-flag.module.ts               # cacheAdapter option, provider wiring
├── feature-flag.constants.ts            # CACHE_ADAPTER injection token
├── interfaces/
│   └── feature-flag-options.interface.ts # cacheAdapter field added
└── index.ts                             # export new public API
```

### Test Files

```
test/
├── cache/
│   ├── memory-cache.adapter.spec.ts     # Migrated from flag-cache.service.spec.ts
│   ├── redis-cache.adapter.spec.ts      # Unit tests with ioredis-mock
│   └── cache-adapter.contract.spec.ts   # Shared contract tests (both adapters)
├── admin/
│   ├── feature-flag-admin.module.spec.ts
│   └── feature-flag-admin.controller.spec.ts
├── services/
│   └── feature-flag.service.spec.ts     # Updated for async cache
└── e2e/
    ├── admin.e2e-spec.ts                # REST API integration tests
    └── redis-cache.e2e-spec.ts          # Redis + Pub/Sub integration
```

---

## 5. Public API Exports

### New Exports from `@nestarc/feature-flag`

```typescript
// Cache
export type { CacheAdapter } from './interfaces/cache-adapter.interface';
export { MemoryCacheAdapter } from './cache/memory-cache.adapter';
export { RedisCacheAdapter, type RedisCacheAdapterOptions } from './cache/redis-cache.adapter';

// Admin
export { FeatureFlagAdminModule } from './admin/feature-flag-admin.module';
```

### Removed Exports

- `FlagCacheService` — was internal, replaced by `CacheAdapter` + `MemoryCacheAdapter`

---

## 6. Testing Strategy (TDD)

### Unit Tests (jest, mocks)

1. **CacheAdapter contract tests** — shared suite that both MemoryCacheAdapter and RedisCacheAdapter must pass: get/set/getAll/setAll/invalidate semantics, TTL expiration
2. **MemoryCacheAdapter** — migrated from existing flag-cache.service.spec.ts + contract
3. **RedisCacheAdapter** — ioredis-mock for unit tests, contract suite
4. **FeatureFlagService** — updated tests for async cache calls, new findByKey/removeOverride methods
5. **FeatureFlagAdminController** — mock service, verify HTTP status codes and delegation
6. **FeatureFlagAdminModule** — verify guard injection, missing guard throws

### E2E Tests (real PostgreSQL + Redis via Docker)

1. **Admin REST API** — full CRUD cycle through HTTP
2. **Redis cache + Pub/Sub** — two NestJS app instances, flag update on instance A invalidates cache on instance B

### Coverage Target

90% branches/functions/lines/statements (same as v0.1.0)

---

## 7. Non-Goals (Explicitly Out of Scope)

- GraphQL API (v0.3.0)
- A/B test variants / non-boolean flag values (v0.3.0)
- Scheduled toggles (v0.3.0)
- Flag dependencies (v0.3.0)
- Webhooks (v0.3.0)
- Swagger/OpenAPI decorators on admin controller (can be added by consumer)
- Request validation pipes (consumer responsibility)
- Rate limiting on admin endpoints (consumer responsibility)
