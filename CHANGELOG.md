# Changelog

All notable changes to `@nestarc/feature-flag` will be documented in this file.

## [Unreleased]

These changes are available in the repository checkout and have not been published as npm 0.5.0. Use a locally built package tarball to try them until a new version is released.

### Fixed
- Preserve explicit `targetingKey` during service context resolution.
- Apply registry `bucketBy` to typed clients and bulk evaluation; add invocation-level `bucketBy` selection.
- Accept custom `repository` and `tenantContextProvider` instances in synchronous and asynchronous module registration; Prisma is required only when no repository is supplied.
- Reject null and non-integer percentages before Prisma and align nullable description/context types with runtime behavior.
- Provide and test an OpenFeature SDK-compatible provider with boolean resolution and explicit unsupported-type errors.

### Documentation and verification
- Add a complete consumer guide, runnable standalone examples, and checks against a packed package in CI.
- Correct cache consistency, dependency, evaluation, and performance descriptions; link the existing 0.5 upgrade notes.
- Isolate benchmark data in a disposable schema and support environment metadata and raw timing output.
- Include the consumer guide and changelog in package files and connect npm metadata to the official documentation.

## [0.5.0] — 2026-08-02

### Changed
- Prisma 7 is now the supported Prisma major (`prisma` and `@prisma/client` 7.9.1 in development)
- Prisma Client generation now uses the `prisma-client` generator with an explicit output path
- PostgreSQL tests, benchmarks, and examples now create Prisma Client with `@prisma/adapter-pg`
- Prisma CLI connection configuration moved from `schema.prisma` to `prisma.config.ts`
- Node.js 20.19+, 22.12+, or 24+ is now required to match Prisma 7

### Migration
- Install `@prisma/adapter-pg` and `pg`, then pass a `PrismaPg` adapter to `PrismaClient`
- Import `PrismaClient` from the generated output path instead of `@prisma/client`
- Move `DATABASE_URL` into `prisma.config.ts`; no database migration is required

## [0.4.0] — 2026-06-20

### Added
- `FeatureFlagService.evaluateBoolean()` for detailed boolean evaluation results with `source`, `reason`, `defaultUsed`, `bucket`, `targetingKey`, and timing metadata
- Invocation-level fallback via `EvaluateBooleanOptions.defaultValue`
- `FeatureFlagGuardOptions.defaultValue` for route-level missing/error fallback
- `EvaluationContext.targetingKey` and registry/metadata `bucketBy` support for explicit rollout bucketing
- Type-safe registry helpers: `defineFlags()`, `createFeatureFlagClient()`, `createFeatureFlagDecorators()`, and lifecycle status helpers
- `FeatureFlagModuleOptions.flags` for registry defaults, bucket keys, and exposure settings
- `FeatureFlagEvents.EXPOSED` opt-in exposure events
- Mutation event metadata fields: `actorId`, `actorType`, `reason`, `requestId`, and `correlationId`
- `TestFeatureFlagModule.registerRegistry()` and injectable `TestFeatureFlagController`
- Boolean-only OpenFeature provider adapter at `@nestarc/feature-flag/openfeature`
- Admin API `POST /feature-flags/:key/evaluate` endpoint

### Changed
- `isEnabled()` now delegates to `evaluateBoolean()` and returns its `value`
- Missing flags now emit a structured `feature-flag.evaluated` event with reason `FLAG_NOT_FOUND`
- Percentage rollout keeps the legacy `userId ?? tenantId` fallback unless `targetingKey` or `bucketBy` is provided
- `FlagEvaluatedEvent` now includes detailed evaluation fields
- Package version is now `0.4.0`

### Migration
- No Prisma migration is required for v0.4.0 core features.
- OpenFeature support is optional and does not require the SDK unless you wire the adapter into an OpenFeature setup.
- Variant flags, reusable rule segments, persisted audit logs, and persisted exposure analytics remain out of scope for this release.

## [0.3.0] — 2026-05-12

### Added
- Attribute-based override targeting with non-empty `attributes` JSON objects
- Override `priority` for tie-breaking between matching overrides with the same specificity
- Admin API DTO validation with `class-validator` and `class-transformer`
- Automatic Prisma migration from fixed override columns to `attributes`
- Top-level `userId`, `tenantId`, and `environment` merge into targeting attributes during evaluation
- Example apps for basic route guards, multi-tenant attribute targeting, and Redis events

### Changed
- `SetOverrideInput` and `RemoveOverrideInput` now use `attributes`
- `FlagOverride` now exposes `attributes` and `priority`
- Override evaluation now matches exact attribute key/value pairs instead of a fixed tenant/user/environment hierarchy
- Matching override tie-break order is more attributes, higher `priority`, earlier `createdAt`, then lower `id`
- Evaluation event source now uses `override` for matched attribute overrides
- `FeatureFlagOverride` storage now uses `attributes` `jsonb` plus `priority`

### Breaking
- Removed direct override fields `tenantId`, `userId`, and `environment`
- Removed `FeatureFlagRepository.updateOverrideEnabled()`
- `setOverride()` and Admin API override requests now require a non-empty `attributes` object
- Legacy override bodies such as `{ "tenantId": "tenant-1", "enabled": true }` are rejected
- Prisma schema migration is required
- Legacy global override rows with `tenant_id`, `user_id`, and `environment` all `NULL` are removed during migration
- Duplicate legacy override rows that backfill to the same `(flag_id, attributes)` are deduplicated during migration
- `feature_flag_overrides` no longer stores `tenant_id`, `user_id`, or `environment` columns

### Migration
- Run `npx prisma migrate deploy`
- Legacy `tenant_id`, `user_id`, and `environment` values are backfilled to `attributes.tenantId`, `attributes.userId`, and `attributes.environment`
- Duplicate backfilled overrides keep the latest `updated_at`, then latest `created_at`, then highest `id`
- Replace `{ "tenantId": "t-1", "enabled": true }` with `{ "attributes": { "tenantId": "t-1" }, "enabled": true }`
- Use `{ "attributes": { "tenantId": "tenant-1" }, "enabled": true }` for Admin API override requests
- Install `class-validator` and `class-transformer` with the required peer dependencies

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
