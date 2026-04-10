# Changelog

All notable changes to `@nestarc/feature-flag` will be documented in this file.

## [0.2.0] — 2026-04-10

### Added
- `CacheAdapter` interface for pluggable cache backends
- `MemoryCacheAdapter` (refactored from internal FlagCacheService)
- `RedisCacheAdapter` with Redis Pub/Sub for cross-instance cache invalidation (SCAN-based flush)
- `FeatureFlagAdminModule` — opt-in REST Admin API with guard injection
  - `POST /feature-flags` — create flag (409 on duplicate key)
  - `GET /feature-flags` — list all flags
  - `GET /feature-flags/:key` — get single flag (404 on missing)
  - `PATCH /feature-flags/:key` — update flag (404 on missing)
  - `DELETE /feature-flags/:key` — archive flag (404 on missing)
  - `POST /feature-flags/:key/overrides` — set override (404 on missing flag)
  - `DELETE /feature-flags/:key/overrides` — remove override (404 on missing flag)
- `FeatureFlagRepository` interface — pluggable persistence port for custom backends
- `PrismaFeatureFlagRepository` — default Prisma implementation with error mapping
- `TenantContextProvider` interface — pluggable tenant resolution port
- `DefaultTenantContextProvider` — automatic `@nestarc/tenancy` integration
- `FlagEventPublisher` — extracted conditional event emission service
- `FlagContextResolver` — extracted ambient/explicit context merge service
- `findByKey()` method on FeatureFlagService (throws NotFoundException)
- `removeOverride()` method on FeatureFlagService
- `RemoveOverrideInput` type
- `CACHE_ADAPTER`, `FEATURE_FLAG_REPOSITORY`, `TENANT_CONTEXT_PROVIDER` injection tokens
- `ioredis` as optional peer dependency
- Cache adapter contract test suite (`cache-adapter.contract.spec.ts`)
- Admin REST e2e test suite (`admin.e2e-spec.ts`)
- Redis cross-instance invalidation e2e test suite (`redis-cache.e2e-spec.ts`)
- Percentage (0-100) range validation in repository layer

### Changed
- All cache operations are now async (`CacheAdapter` interface)
- `cacheAdapter` option added to `FeatureFlagModuleOptions` (optional, defaults to `MemoryCacheAdapter`)
- `FeatureFlagService` now depends on `FeatureFlagRepository` instead of direct Prisma access
- Cache invalidation on mutation paths is now best-effort (non-fatal); stale entries self-heal via TTL
- `TestFeatureFlagModule` mock methods now return full `FeatureFlagWithOverrides` objects (LSP compliance)
- `RemoveOverrideInput` moved from `cache-adapter.interface` to `feature-flag.interface` (ISP)
- `FeatureFlagAdminModule` uses standard NestJS DI instead of `ModuleRef.get()` for service resolution

### Fixed
- `setOverride()` now throws `NotFoundException` (was generic `Error` causing 500)
- Admin `create()` returns 409 Conflict on duplicate key (was 500)
- Admin `update()`/`archive()` return 404 on missing key (was 500)
- Override race condition: concurrent `setOverride()` calls no longer 500 on unique index violation
- Override `deleteOverride()` is idempotent (concurrent delete no longer 500)

### Removed
- `FlagCacheService` (internal, replaced by `CacheAdapter` + `MemoryCacheAdapter`)
- Direct `prisma: any` dependency in `FeatureFlagService` (replaced by `FeatureFlagRepository`)
- `ModuleRef` dependency in `FeatureFlagService` (tenancy resolved via `TenantContextProvider`)

## [0.1.0] - 2026-04-05

### Added

- `FeatureFlagModule` with `forRoot` and `forRootAsync` (useFactory / useClass / useExisting) registration
- `FeatureFlagService` with CRUD operations: `create`, `update`, `archive`, `findAll`
- `isEnabled()` and `evaluateAll()` for flag evaluation with 6-layer cascade priority
- `setOverride()` for user / tenant / environment context-specific overrides
- `@FeatureFlag()` decorator with built-in `UseGuards(FeatureFlagGuard)` for automatic route gating
- `@BypassFeatureFlag()` decorator to exempt specific routes from guard checks
- `FlagContextMiddleware` with `AsyncLocalStorage` for request-scoped userId extraction
- `FlagCacheService` with configurable TTL-based in-memory caching
- `FlagEvaluatorService` with 5-layer override hierarchy and murmurhash3-based percentage rollout
- Optional `@nestjs/event-emitter` integration (`emitEvents: true`) sharing NestJS-managed `EventEmitter2` singleton
- `TestFeatureFlagModule` at `@nestarc/feature-flag/testing` for unit/integration test support
- Prisma schema with partial unique indexes for NULL-safe override uniqueness on PostgreSQL
- Docker Compose + e2e test environment with real PostgreSQL (service-level + HTTP tests)
- Explicit `null` context support: `{ userId: null }` suppresses ambient context from ALS

### Fixed

- Override uniqueness: replaced broken `@@unique` compound constraint with 8 partial unique indexes to handle PostgreSQL `NULL != NULL` semantics
- `allFlagsCache` staleness: per-key `invalidate(key)` now also clears the all-flags cache
- `forRootAsync` double factory invocation: introduced intermediate `FULL_OPTIONS` provider so factory runs exactly once
- `EVENT_EMITTER` isolation: changed from `new EventEmitter2()` to `useExisting` / `ModuleRef.get()` so `@OnEvent` listeners receive feature-flag events
- `@FeatureFlag()` fail-open: decorator now includes `UseGuards(FeatureFlagGuard)` automatically
- `buildContext()` null semantics: explicit `null` in `EvaluationContext` now overrides ambient values instead of falling through
- Lint errors: resolved unused destructured variable and unsafe `Function` type in guard tests
