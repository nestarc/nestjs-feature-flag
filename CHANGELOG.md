# Changelog

All notable changes to `@nestarc/feature-flag` will be documented in this file.

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
