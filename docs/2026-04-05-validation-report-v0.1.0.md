# 0.1.0 Validation Report

Date: 2026-04-05
Target: `@nestarc/feature-flag@0.1.0`
Verdict: `NOT RELEASE READY`

## Validation Team

- Architecture/API reviewer
- Evaluation/Data reviewer
- QA/Release reviewer
- Main agent: execution verification and result synthesis

## Summary

Core behaviors work in isolation, but the release still has multiple ship blockers in integration, data integrity, and release gating. Test coverage is high and build output is healthy, but that did not catch several module wiring and runtime contract problems.

## Findings

### 1. Ship blocker: override uniqueness is not enforced correctly in PostgreSQL

Status: inferred from code and schema review

- `prisma/schema.prisma:38` defines `@@unique([flagId, tenantId, userId, environment])`.
- `src/services/feature-flag.service.ts:130` relies on that constraint for `featureFlagOverride.upsert(...)`.
- Because the compound key contains nullable columns, common override shapes with `NULL` values can bypass uniqueness in PostgreSQL. That can create duplicate overrides for the same logical context and make evaluation order-dependent.

Impact:

- duplicate tenant/user/environment overrides can exist
- `FlagEvaluatorService` may return whichever duplicate is encountered first
- `setOverride()` is not a safe upsert contract under real PostgreSQL semantics

### 2. Ship blocker: `evaluateAll()` can return stale values after updates

Status: confirmed by code review

- `src/services/feature-flag.service.ts:54` reads from `resolveAllFlags()`
- `src/services/feature-flag.service.ts:99`, `src/services/feature-flag.service.ts:115`, `src/services/feature-flag.service.ts:149` only invalidate the per-key cache
- `src/services/flag-cache.service.ts:51` keeps `allFlagsCache` alive until TTL expiry unless full invalidation is used

Impact:

- `update()`, `archive()`, and `setOverride()` can leave `evaluateAll()` stale for up to `cacheTtlMs`
- service-level reads become inconsistent across API paths

### 3. Ship blocker: async module API contract is incomplete and side-effect-prone

Status: confirmed by code review

- `src/interfaces/feature-flag-options.interface.ts:25` advertises `useClass` and `useExisting`
- `src/feature-flag.module.ts:82` only implements `useFactory`
- `src/feature-flag.module.ts:86` and `src/feature-flag.module.ts:95` call the async factory twice

Impact:

- documented/typed `forRootAsync` usage modes are not actually supported
- factories that create clients or open connections can run twice

### 4. Major: `emitEvents` is exposed but module wiring makes it a no-op

Status: confirmed by code review

- `src/interfaces/feature-flag-options.interface.ts:17` documents `emitEvents`
- `src/feature-flag.module.ts:56` and `src/feature-flag.module.ts:72` bind `'EVENT_EMITTER'` to `null`
- `src/services/feature-flag.service.ts:40` only emits when an emitter instance exists

Impact:

- setting `emitEvents: true` does not enable real event emission in the shipped module
- current tests only verify manual constructor injection, not real module wiring

### 5. Major: `@FeatureFlag()` alone does not enforce route protection

Status: inferred from implementation and design-doc mismatch

- `src/decorators/feature-flag.decorator.ts:5` only sets metadata
- `src/feature-flag.module.ts:47` and `src/feature-flag.module.ts:63` do not register `APP_GUARD`
- the design example in `docs/2026-04-05-feature-flag-design.md` shows `@FeatureFlag(...)` as if it gates routes by itself

Impact:

- users following the documented decorator-only pattern get fail-open behavior
- either documentation must require explicit `UseGuards(FeatureFlagGuard)` or the module must wire the guard automatically

### 6. Major: release gate is red because lint fails

Status: confirmed by command execution

`npm run lint` fails with 3 errors:

- `src/feature-flag.module.ts:88` unused `_prisma`
- `test/guards/feature-flag.guard.spec.ts:7` unsafe `Function` type, twice

Impact:

- CI/release automation that requires a green lint gate will fail

### 7. Moderate: release documentation is not usable yet

Status: confirmed by repository review

- `README.md` only contains a title and one sentence
- there is no published setup path for Prisma schema, module registration, guard usage, event behavior, or `./testing`

Impact:

- package consumers cannot integrate the library from the public README alone
- the release artifact is technically packable but not operationally self-serve

## Execution Results

### Passed

- `npm test -- --runInBand`
  - 12/12 suites passed
  - 88/88 tests passed
- `npm run test:cov -- --runInBand`
  - statements: `99.21%`
  - branches: `92.91%`
  - functions: `97.91%`
  - lines: `99.12%`
- `npm run build`
- `npm pack --dry-run --cache /tmp/npm-cache`

### Failed

- `npm run lint`

### Environment note

- plain `npm pack --dry-run` failed because the local user npm cache under `~/.npm` has a permissions problem. Re-running with `--cache /tmp/npm-cache` succeeded, so packaging itself is functional.

## Recommendation

Do not publish `0.1.0` yet.

Fix in this order:

1. repair override uniqueness strategy for PostgreSQL
2. invalidate `allFlagsCache` on any mutation that changes aggregate evaluation
3. redesign `forRootAsync` so the API matches the implementation and the factory runs once
4. either wire event emission properly or remove/defer the option
5. make guard usage explicit in code or docs
6. restore a green lint gate
7. write a real README before publish
