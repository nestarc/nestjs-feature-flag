# @nestarc/feature-flag v0.4.0 Design Spec

**Goal:** Ship v0.4.0 as an additive stability and developer-experience release that makes boolean flag evaluation type-safe, explainable, fallback-aware, and safer for multi-tenant rollout without turning the package into a full feature-management platform.

**Scope:** Detailed boolean evaluation results, invocation-level fallback defaults, type-safe flag registry helpers, explicit rollout bucketing keys, improved testing utilities, OpenFeature boolean provider adapter, opt-in exposure events, lightweight lifecycle metadata conventions, audit event enrichment, docs, and examples.

**Out of scope:** Variant flags, string/number/json remote config flags, reusable segments, rule operators (`IN`, `NOT_IN`, semver/date/numeric operators), persisted audit log tables, persisted exposure analytics, scheduled rollout jobs, approval workflows, GraphQL integration, and full OpenFeature conformance beyond boolean evaluation.

---

## 1. Release Positioning

v0.3.0 changed the targeting model from fixed `tenantId` / `userId` / `environment` columns to exact-match primitive `attributes`. v0.4.0 should not introduce another broad storage migration. The next release should stabilize how consumers evaluate flags and reason about runtime behavior.

The release should position `@nestarc/feature-flag` as:

> A NestJS-native, Prisma/PostgreSQL-backed feature flag module for server-side release control, with type-safe keys, deterministic tenant/user rollout, explainable fallback behavior, and a path toward OpenFeature compatibility.

This keeps the package distinct from LaunchDarkly, Unleash, Flagsmith, GrowthBook, and PostHog. Those products provide broad control planes, experiment analytics, rule builders, and dashboards. This package should focus on the narrow NestJS backend library problem: safe route/service gating without external SaaS.

## 2. Current Baseline

The current package is `@nestarc/feature-flag` version `0.3.0`.

Implemented:

- `FeatureFlagModule.forRoot()` and `forRootAsync()`.
- `FeatureFlagService.isEnabled()` and `evaluateAll()`.
- Boolean flags with `enabled`, `percentage`, `archivedAt`, and `metadata`.
- Exact-match primitive attribute overrides with `priority`.
- Context merge for `userId`, `tenantId`, `environment`, and custom `attributes`.
- Deterministic percentage rollout using `murmurhash3(flag.key + (userId ?? tenantId ?? '')) % 100`.
- `@FeatureFlag()` and `@BypassFeatureFlag()` decorators.
- `FeatureFlagGuard`.
- Memory cache and Redis cache adapter with Pub/Sub invalidation.
- Opt-in Admin REST API with guard injection.
- Optional `@nestjs/event-emitter` event publication.
- `TestFeatureFlagModule` at `@nestarc/feature-flag/testing`.

Known limits:

- The public evaluation API returns only `boolean`.
- Evaluator details are limited to internal `{ result, source }`.
- Missing flags use global `defaultOnMissing`; there is no invocation-level default.
- Repository/cache errors are not represented as structured evaluation details.
- Rollout bucketing is fixed to `userId` then `tenantId`.
- There is no typed registry or typed decorator key.
- Testing utilities are stateless boolean stubs.
- Evaluation events include the full context and do not distinguish exposure/impression.
- Mutation events do not include actor, reason, request id, or before/after data.
- There is no OpenFeature provider adapter.

## 3. Design Principles

1. Keep v0.4.0 additive. Existing `isEnabled(key, context?)` calls must continue to work.
2. Keep boolean flags as the only first-class runtime value in this release.
3. Prefer compile-time helpers and event-contract improvements over schema migrations.
4. Make fallback behavior explicit at the call site.
5. Do not persist exposure/audit data in core yet.
6. Treat evaluation context as potentially sensitive. New events must avoid leaking unnecessary context by default.
7. Make rollout bucketing deterministic and configurable without changing existing results unless consumers opt in.
8. Preserve NestJS-native ergonomics as the primary product advantage.

## 4. Detailed Evaluation API

### Public API

Add a detailed boolean evaluation method:

```typescript
export interface EvaluateBooleanOptions {
  defaultValue?: boolean;
  trackExposure?: boolean;
  includeContextInEvent?: boolean;
}

export type EvaluationReason =
  | 'ARCHIVED'
  | 'OVERRIDE_MATCH'
  | 'PERCENTAGE_MATCH'
  | 'PERCENTAGE_MISS'
  | 'PERCENTAGE_NO_TARGETING_KEY'
  | 'GLOBAL'
  | 'FLAG_NOT_FOUND'
  | 'ERROR';

export interface BooleanEvaluationDetails {
  flagKey: string;
  value: boolean;
  source: 'override' | 'percentage' | 'global' | 'default';
  reason: EvaluationReason;
  defaultUsed: boolean;
  errorCode?: 'FLAG_NOT_FOUND' | 'CACHE_ERROR' | 'REPOSITORY_ERROR' | 'EVALUATION_ERROR';
  errorMessage?: string;
  matchedOverrideId?: string;
  bucket?: number;
  targetingKey?: string;
  evaluationTimeMs: number;
}

class FeatureFlagService {
  evaluateBoolean(
    flagKey: string,
    explicitContext?: EvaluationContext,
    options?: EvaluateBooleanOptions,
  ): Promise<BooleanEvaluationDetails>;
}
```

`isEnabled()` remains as the simple API:

```typescript
async isEnabled(
  flagKey: string,
  explicitContext?: EvaluationContext,
  options?: EvaluateBooleanOptions,
): Promise<boolean> {
  return (await this.evaluateBoolean(flagKey, explicitContext, options)).value;
}
```

The third parameter is additive. Existing two-argument calls keep current behavior.

### Behavior

Detailed evaluation should represent every decision:

| Case | value | source | reason | defaultUsed |
| --- | --- | --- | --- | --- |
| archived flag | `false` | `global` | `ARCHIVED` | `false` |
| matching override | override enabled | `override` | `OVERRIDE_MATCH` | `false` |
| percentage bucket included | `true` | `percentage` | `PERCENTAGE_MATCH` | `false` |
| percentage bucket excluded | `false` | `percentage` | `PERCENTAGE_MISS` | `false` |
| percentage enabled but no targeting key | `flag.enabled` | `global` | `PERCENTAGE_NO_TARGETING_KEY` | `false` |
| no override/percentage | `flag.enabled` | `global` | `GLOBAL` | `false` |
| missing flag | call default or module default | `default` | `FLAG_NOT_FOUND` | `true` |
| repository/cache/evaluator error | call default or module default | `default` | `ERROR` | `true` |

### Error Policy

Flag evaluation is on the hot path. The detailed API should not throw for normal evaluation failures such as missing flags or provider errors. It should return the default and emit a structured event. Setup/configuration errors can still throw during module registration.

The default value priority is:

1. `options.defaultValue`
2. registry `defaultValue` if a typed registry is used
3. module `defaultOnMissing`
4. `false`

### Internal Changes

`FlagEvaluatorService.evaluate()` should return a richer internal result:

```typescript
export interface EvaluationResult {
  result: boolean;
  source: 'override' | 'percentage' | 'global';
  reason: EvaluationReason;
  matchedOverrideId?: string;
  bucket?: number;
  targetingKey?: string;
}
```

`FeatureFlagService` should own error handling and default resolution because it has access to module options, registry defaults, event publisher, repository, and cache.

## 5. Invocation-Level Fallback

### Problem

The current `defaultOnMissing` option is global. It cannot express that one call should fail closed while another non-critical UI or rollout call may fail open.

### Design

Add `defaultValue` to `EvaluateBooleanOptions`.

```typescript
await flags.isEnabled('NEW_CHECKOUT', context, { defaultValue: false });
await flags.evaluateBoolean('SHOW_OPTIONAL_BANNER', context, { defaultValue: true });
```

The documentation must state:

- Route guards and permission-like gates should default to `false`.
- Optional UI, non-critical background behavior, and progressive rollout experiments may choose explicit defaults.
- Consumers should not use feature flags as the only authorization boundary.

### Guard Behavior

`FeatureFlagGuardOptions` gains `defaultValue?: boolean`.

```typescript
@FeatureFlag('NEW_DASHBOARD', {
  defaultValue: false,
  statusCode: 403,
  fallback: { message: 'Feature not available' },
})
```

If omitted, guard default remains fail-closed.

## 6. Type-Safe Flag Registry

### Problem

String flag keys are easy to mistype and hard to keep aligned across service code, decorators, tests, and docs.

### Registry Helper

Add a compile-time registry helper:

```typescript
export type BucketBy = 'userId' | 'tenantId' | 'environment' | string;

export interface FlagDefinition {
  defaultValue: boolean;
  description?: string;
  bucketBy?: BucketBy;
  trackExposure?: boolean;
  tags?: string[];
  owner?: string;
  expiresAt?: string;
}

export function defineFlags<const T extends Record<string, FlagDefinition>>(flags: T): T;
```

Example:

```typescript
export const flags = defineFlags({
  NEW_CHECKOUT: {
    defaultValue: false,
    bucketBy: 'tenantId',
    owner: 'payments',
    expiresAt: '2026-09-30',
  },
  PREMIUM_REPORTS: {
    defaultValue: false,
    bucketBy: 'userId',
  },
});

export type AppFlagKey = keyof typeof flags;
```

### Typed Client Helper

Because NestJS DI cannot easily inject generic services, keep `FeatureFlagService` non-generic and provide a typed wrapper:

```typescript
export function createFeatureFlagClient<const T extends Record<string, FlagDefinition>>(
  service: FeatureFlagService,
  registry: T,
): TypedFeatureFlagClient<T>;

export interface TypedFeatureFlagClient<T extends Record<string, FlagDefinition>> {
  isEnabled<K extends keyof T & string>(
    key: K,
    context?: EvaluationContext,
    options?: EvaluateBooleanOptions,
  ): Promise<boolean>;

  evaluateBoolean<K extends keyof T & string>(
    key: K,
    context?: EvaluationContext,
    options?: EvaluateBooleanOptions,
  ): Promise<BooleanEvaluationDetails>;
}
```

The typed wrapper applies registry defaults when call options do not provide `defaultValue`.

### Typed Decorator Helper

Add an optional factory for typed decorators:

```typescript
export const { FeatureFlag: AppFeatureFlag } = createFeatureFlagDecorators(flags);

@AppFeatureFlag('NEW_CHECKOUT')
@Get('/checkout')
getCheckout() {}
```

The existing untyped `FeatureFlag()` decorator remains unchanged.

## 7. Explicit Rollout Bucketing

### Problem

Current percentage rollout hashes `userId ?? tenantId ?? ''`. That is simple, but multi-tenant services often need to choose whether rollout is by user, tenant, organization, workspace, API key, or a composite rollout key.

### Context Addition

Extend `EvaluationContext`:

```typescript
export interface EvaluationContext {
  userId?: string | null;
  tenantId?: string | null;
  environment?: string;
  targetingKey?: string | null;
  attributes?: TargetingAttributes;
}
```

`targetingKey` is the most explicit per-call bucketing input.

### Bucket Resolution

Add a resolver with this priority:

1. `context.targetingKey` when not `undefined`.
2. registry or flag metadata `bucketBy`.
3. existing compatibility behavior: `context.userId ?? context.tenantId ?? ''`.

For `bucketBy`, lookup values in:

1. top-level context fields (`userId`, `tenantId`, `environment`)
2. `context.attributes[bucketBy]`

If no value is available, evaluation returns the global flag value with reason `PERCENTAGE_NO_TARGETING_KEY`.

### Compatibility

Existing percentage rollout behavior must not change unless `targetingKey` or `bucketBy` is explicitly used.

## 8. Testing Utility Improvements

### Problem

`TestFeatureFlagModule.register()` currently accepts `Record<string, boolean>` and is stateless. It cannot reflect detailed evaluation, registry defaults, per-test override, or typed keys.

### Additions

Keep the existing API and add:

```typescript
TestFeatureFlagModule.registerRegistry(flags, {
  overrides: {
    NEW_CHECKOUT: true,
  },
});
```

Provide an exported test controller service:

```typescript
export interface TestFeatureFlagController<TFlags> {
  set<K extends keyof TFlags & string>(key: K, value: boolean): void;
  reset(): void;
  getDetails<K extends keyof TFlags & string>(key: K): BooleanEvaluationDetails;
}
```

This service is only for tests and should not be exported from the root package path.

### Behavior

- Unknown keys default to registry `defaultValue` when registry is provided.
- Unknown keys default to `false` for legacy `register()`.
- `evaluateBoolean()` returns `source: 'default'` or `source: 'global'` with deterministic details.
- Writes such as `create()` and `update()` may remain stubbed, but the docs must state whether state is persisted in the test module.

## 9. OpenFeature Boolean Provider Adapter

### Goal

Provide a bridge for teams already using OpenFeature without making OpenFeature the only public API.

### Export Path

Add a separate subpath:

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/index.d.ts", "default": "./dist/testing/index.js" },
    "./openfeature": {
      "types": "./dist/openfeature/index.d.ts",
      "default": "./dist/openfeature/index.js"
    }
  }
}
```

### Scope

v0.4.0 supports boolean evaluation only:

- OpenFeature `resolveBooleanEvaluation()`
- context mapping from OpenFeature evaluation context to `EvaluationContext`
- default value mapping
- reason and error code mapping from `BooleanEvaluationDetails`

Out of scope for this adapter:

- string, number, object evaluation
- OpenFeature hooks implementation
- OpenFeature tracking API
- conformance suite beyond boolean provider behavior

### Dependency

`@openfeature/server-sdk` should be an optional peer dependency, not a hard runtime dependency for consumers who do not use the adapter.

## 10. Exposure Events

### Problem

`feature-flag.evaluated` currently emits every `isEnabled()` call when events are enabled. It is useful for observability but too broad to be treated as product exposure/impression tracking.

### Design

Add a separate event:

```typescript
export const FeatureFlagEvents = {
  // existing
  EXPOSED: 'feature-flag.exposed',
} as const;

export interface FlagExposedEvent {
  flagKey: string;
  value: boolean;
  reason: EvaluationReason;
  source: 'override' | 'percentage' | 'global' | 'default';
  targetingKey?: string;
  attributes?: TargetingAttributes;
  evaluationTimeMs: number;
}
```

Exposure events are opt-in:

- registry `trackExposure: true`
- or call option `{ trackExposure: true }`
- or future flag metadata convention `metadata.trackExposure`

Default exposure event payload must not include full context. If `attributes` are included, they must pass through a redaction hook or allowlist option.

No persistence is implemented in v0.4.0.

## 11. Audit Event Enrichment

### Current State

Mutation events include only flag key and action, or override attributes. They do not include actor, reason, request id, correlation id, or before/after values.

### Additive Event Metadata

Add optional mutation metadata:

```typescript
export interface FlagMutationMetadata {
  actorId?: string;
  actorType?: 'user' | 'service' | 'system';
  reason?: string;
  requestId?: string;
  correlationId?: string;
}
```

Update service mutation methods with optional metadata:

```typescript
create(input, metadata?)
update(key, input, metadata?)
archive(key, metadata?)
setOverride(key, input, metadata?)
removeOverride(key, input, metadata?)
```

Events should include this metadata when supplied.

### Persistence

No audit table is added in v0.4.0. Durable audit persistence belongs in a later release or in a recipe that forwards events to `@nestarc/audit-log`.

## 12. Lifecycle Metadata Convention

### Goal

Start reducing stale flag debt without a schema migration.

### Metadata Convention

Document and validate optional metadata keys:

```typescript
interface FeatureFlagLifecycleMetadata {
  type?: 'release' | 'experiment' | 'operational' | 'permission' | 'kill-switch';
  owner?: string;
  tags?: string[];
  expiresAt?: string;
  staleAt?: string;
}
```

Add helper:

```typescript
export function getFlagLifecycleStatus(
  flag: FeatureFlagWithOverrides,
  now?: Date,
): 'active' | 'potentially-stale' | 'stale' | 'archived';
```

This helper reads metadata only. It does not change evaluation behavior.

## 13. Admin API Additions

### Evaluation Debug Endpoint

Could-have in v0.4.0:

```http
POST /feature-flags/:key/evaluate
```

Request body:

```json
{
  "context": {
    "userId": "user-1",
    "tenantId": "tenant-1",
    "attributes": { "plan": "pro" }
  },
  "defaultValue": false
}
```

Response is `BooleanEvaluationDetails`.

Security:

- Endpoint must be behind the existing Admin module guard.
- Request context must not be persisted.
- Docs should warn against sending raw PII.

This endpoint can be deferred if detailed evaluation and testing utilities consume the available 0.4.0 capacity.

## 14. Documentation and Examples

Update README:

- Explain `evaluateBoolean()` and reason codes.
- Explain `defaultValue` and fail-closed defaults for guards.
- Document typed registry and typed decorator helper.
- Document `targetingKey` and `bucketBy` with tenant rollout examples.
- Document PII-safe context practices.
- Clarify that `zero external dependencies` means no external feature flag service, not no peer dependencies.
- Refresh benchmark docs or remove stale benchmark claims if they cannot be reproduced.

Add examples:

- `examples/typed-registry`
- `examples/fallback-and-reasons`
- `examples/openfeature-provider` if the adapter lands in v0.4.0

Update `CHANGELOG.md` for v0.4.0.

## 15. Backward Compatibility

Required compatibility:

- Existing `isEnabled(key)` and `isEnabled(key, context)` calls work.
- Existing `evaluateAll(context?)` behavior remains `Record<string, boolean>`.
- Existing Admin API routes continue to work.
- Existing Prisma schema remains valid.
- Existing testing module `register({ FLAG: true })` continues to work.
- Existing percentage rollout results remain unchanged unless `targetingKey` or `bucketBy` is used.

Potential breaking changes to avoid:

- Do not change `FlagEvaluatedEvent` fields in a way that breaks listeners. Add fields only.
- Do not make `@openfeature/server-sdk` a required dependency for all users.
- Do not change `metadata` from arbitrary object to a closed schema.

## 16. Security and Privacy

Feature flag targeting context may contain personal data, tenant identifiers, pricing plan, region, app version, or internal rollout cohort names.

v0.4.0 must:

- Default route gating to fail closed.
- Avoid full-context exposure events by default.
- Support context redaction or allowlisting before exposure event emission.
- Warn that feature flags are not a replacement for authorization checks.
- Avoid persisting exposure or audit data in core until retention and legal requirements are designed.
- Document that email, IP address, precise location, and other personal data should not be used as raw targeting attributes unless the application has a clear privacy basis.

Legal review needed later:

- persisted exposure analytics
- audit retention policy
- consent-based targeting
- experiment attribution tied to user identity
- data-subject export/delete implications

## 17. Test Plan

Unit tests:

- `FlagEvaluatorService` reason codes.
- percentage bucket details and `targetingKey` / `bucketBy` selection.
- missing flag default resolution.
- repository/cache error fallback details.
- lifecycle metadata helper.
- registry helper type tests.

Service tests:

- `evaluateBoolean()` returns details for every cascade path.
- `isEnabled()` delegates to `evaluateBoolean()`.
- exposure events are emitted only when opted in.
- mutation metadata is included in events.

Guard tests:

- default fail-closed behavior.
- `FeatureFlagGuardOptions.defaultValue`.
- fallback body/status still work.

Testing utility tests:

- legacy `register()` compatibility.
- registry-based defaults.
- per-test override and reset.
- detailed evaluation mocks.

OpenFeature tests:

- boolean provider returns OpenFeature-compatible resolution details.
- OpenFeature context maps to local evaluation context.
- missing flag returns OpenFeature default.

E2E tests:

- Admin evaluation endpoint if implemented.
- Redis/cache behavior remains unchanged.
- No Prisma migration required for core v0.4.0 features.

## 18. Implementation Order

1. Add detailed internal evaluator result.
2. Add `FeatureFlagService.evaluateBoolean()`.
3. Extend `isEnabled()` with optional `EvaluateBooleanOptions`.
4. Add invocation default handling and structured error fallback.
5. Add `EvaluationContext.targetingKey`.
6. Add `bucketBy` resolution through registry/metadata.
7. Add typed registry helpers.
8. Extend testing module.
9. Add exposure event opt-in.
10. Add audit event metadata.
11. Add lifecycle metadata helper.
12. Add OpenFeature boolean provider adapter.
13. Add optional Admin evaluation endpoint.
14. Update README, examples, and changelog.

## 19. Success Metrics

- Existing test suite remains green.
- No required Prisma migration for v0.4.0 core features.
- New tests cover all `EvaluationReason` values.
- Typed registry examples compile without `any`.
- Existing untyped API examples still compile.
- Percentage rollout compatibility tests prove unchanged results without `targetingKey`/`bucketBy`.
- OpenFeature adapter remains optional.
- README clearly distinguishes v0.4.0 scope from postponed variant/rule/audit platform features.

## 20. Future Work

v0.5.0 or later should separately design:

- variant flags and weighted variants
- string/number/json remote config values
- reusable segments and rule operators
- persisted audit log with retention policy
- exposure analytics with sampling/batching/backpressure
- scheduled rollouts and stale cleanup jobs
- OpenTelemetry metrics/tracing
- full OpenFeature typed value support
