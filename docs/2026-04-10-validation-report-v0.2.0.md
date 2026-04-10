# 0.2.0 Validation Report

Date: 2026-04-10
Target: `@nestarc/feature-flag@0.2.0`
Verdict: `NOT RELEASE READY`

## Validation Team

- Architecture/API reviewer
- Runtime/Integration reviewer
- QA/Release reviewer
- Main agent: execution verification and result synthesis

## Summary

The release is close to shippable, and the core gates are green when executed in Docker: lint, build, unit tests, coverage, PostgreSQL-backed e2e tests, and package assembly all passed. However, the new 0.2.0 surface still has one Admin API contract bug, one regression in the exported testing helper, and a material validation gap around the two flagship additions for this release: Admin HTTP and Redis cross-instance invalidation.

## Findings

### 1. Ship blocker: `POST /feature-flags/:key/overrides` returns 500 for an unknown flag

Status: confirmed by code review; not covered by automated tests

- `src/services/feature-flag.service.ts:128-132` throws a generic `Error` when the target flag does not exist.
- `src/admin/feature-flag-admin.controller.ts:52-57` delegates directly to `service.setOverride()`, so Nest will surface that as an unhandled 500 response.
- Sibling endpoints already use `NotFoundException` for the same condition: `findByKey()` at `src/services/feature-flag.service.ts:181-189` and `removeOverride()` at `src/services/feature-flag.service.ts:192-219`.

Impact:

- `POST /feature-flags/:key/overrides` has inconsistent REST semantics compared with the rest of the new Admin module.
- Admin clients will receive a server error for a simple not-found case, which breaks retry/error-classification behavior and makes the API look unstable.

### 2. Major: `@nestarc/feature-flag/testing` was not updated for the new public service API

Status: confirmed by code review

- `src/testing/test-feature-flag.module.ts:13-21` still mocks only the pre-0.2.0 methods.
- Newly added public methods `findByKey()` and `removeOverride()` exist on the real `FeatureFlagService` (`src/services/feature-flag.service.ts:181-219`) but are absent from the testing stub.
- `test/testing/test-feature-flag.module.spec.ts` only verifies the older surface and does not exercise the new methods.

Impact:

- Consumers using `@nestarc/feature-flag/testing` cannot reliably unit-test code that depends on the new 0.2.0 API.
- Test runs in consumer projects can fail with `service.findByKey is not a function` or `service.removeOverride is not a function`.

### 3. Major: the test plan for the new 0.2.0 features is only partially implemented

Status: confirmed by repository review

- The design spec requires a cache-adapter contract suite plus Admin and Redis e2e coverage (`docs/superpowers/specs/2026-04-10-feature-flag-v0.2.0-design.md:224-234`).
- The repository does not contain `test/cache/cache-adapter.contract.spec.ts`, `test/e2e/admin.e2e-spec.ts`, or `test/e2e/redis-cache.e2e-spec.ts`.
- The current e2e suite verifies service integration and route guard behavior, but it does not exercise the Admin REST module or a two-instance Redis invalidation path.

Impact:

- The current green suite does not fully prove the two headline 0.2.0 features under production-like wiring.
- This missing coverage likely explains why finding #1 was able to ship with all tests still passing.

### 4. Moderate: full Redis invalidation uses blocking `KEYS` instead of the spec'd scan-based strategy

Status: confirmed by code review

- `src/cache/redis-cache.adapter.ts:94-98` uses `client.keys("${prefix}*")` before deleting matches.
- The design spec calls for scan-based invalidation for the full-cache flush path to avoid blocking Redis (`docs/superpowers/specs/2026-04-10-feature-flag-v0.2.0-design.md`, Redis invalidation section).

Impact:

- `invalidate()` with no key can block Redis on larger shared keyspaces.
- The new multi-instance production story is functionally correct for small datasets, but the operational characteristics are weaker than the documented design.

## Execution Results

### Passed

- Dockerized validation environment
  - Node: `node:20-bookworm`
  - Database: `postgres:16-alpine` via `docker compose`
- `npm run lint`
- `npm run build`
- `npm test -- --runInBand`
  - 15/15 suites passed
  - 127/127 tests passed
- `npm run test:cov -- --runInBand`
  - statements: `98.10%`
  - branches: `92.45%`
  - functions: `98.68%`
  - lines: `97.88%`
- `npx prisma migrate deploy`
- `npx jest --config jest.e2e.config.ts --runInBand`
  - 2/2 suites passed
  - 21/21 tests passed
- `npm pack --dry-run --cache /tmp/npm-cache`
  - package assembled successfully after build
  - tarball included `dist/**` and Prisma assets

### Observations

- Running the unit and coverage suites emits `MaxListenersExceededWarning` during `test/cache/redis-cache.adapter.spec.ts`. This did not fail the run, but it is a useful signal to revisit Redis adapter listener cleanup or the test harness.
- Running `npm pack --dry-run` from the untouched host workspace before building produced a tarball without `dist/`, but the tagged release workflow already builds before `npm publish`, so the CI release path remains valid.

## Recommendation

Do not publish `0.2.0` yet.

Fix in this order:

1. Change `setOverride()` to throw `NotFoundException` for unknown flags so the Admin REST contract returns 404 instead of 500.
2. Extend `TestFeatureFlagModule` and its tests to cover `findByKey()` and `removeOverride()`.
3. Add the missing validation assets promised by the spec: Admin REST e2e, Redis cross-instance invalidation e2e, and the cache-adapter contract suite.
4. Replace the full-cache `KEYS` invalidation path with a scan-based implementation or document explicit operational limits for Redis-backed deployments.
