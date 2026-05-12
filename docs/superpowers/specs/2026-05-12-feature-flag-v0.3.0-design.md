# @nestarc/feature-flag v0.3.0 Design Spec

**Goal:** Use v0.3.0 as the breaking 0.x release that generalizes targeting from fixed `tenantId` / `userId` / `environment` override columns to exact-match attribute overrides, while adding Admin API DTO validation and practical examples.

**Scope:** Attribute-based override storage and evaluation, automatic Prisma migration, hybrid evaluation context, scoped Admin API validation, three copyable examples, and release documentation.

**Out of scope:** Rule operators (`$in`, `$ne`, `$exists`), JSONLogic or expression rules, TypeORM adapter, OpenTelemetry or Prometheus metrics, cache stampede protection, audit-log persistence, and GraphQL integration.

---

## 1. Release Positioning

v0.3.0 is a deliberate breaking-change release. The package is still in 0.x, and this is the right point to replace the hardcoded targeting dimensions before more production users depend on the current schema.

The release focuses on the core targeting model:

- Admin APIs validate inputs at the Nest controller boundary.
- Overrides target arbitrary primitive attributes.
- Existing override data migrates automatically into the new attribute structure.
- Evaluation remains simple and deterministic: exact-match attributes only.
- Examples become real copyable project snippets under `examples/`.

The release does not become a full rule engine. Advanced operators and ordered expression rules should be designed separately after the attribute model has settled.

---

## 2. Data Model

### Prisma Model

`FeatureFlagOverride` changes from fixed nullable targeting columns to a JSON attribute bag plus priority:

```prisma
model FeatureFlagOverride {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  flagId     String   @map("flag_id") @db.Uuid
  attributes Json     @default("{}")
  priority   Int      @default(0)
  enabled    Boolean
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  flag FeatureFlag @relation(fields: [flagId], references: [id], onDelete: Cascade)

  @@index([flagId], map: "idx_override_flag_id")
  @@map("feature_flag_overrides")
}
```

The old columns are removed:

- `tenant_id`
- `user_id`
- `environment`

The new columns are:

- `attributes jsonb not null default '{}'`
- `priority int not null default 0`

### Attribute Value Type

Supported attribute values are primitive JSON values:

```typescript
export type TargetingAttributeValue = string | number | boolean | null;
export type TargetingAttributes = Record<string, TargetingAttributeValue>;
```

Objects and arrays are not valid targeting values in v0.3.0. This keeps exact matching cheap, predictable, and easy to document.

### Empty Attributes

New override writes must reject empty `attributes`.

Existing all-null override rows from v0.2.0 migrate to an empty attribute object. Those rows are deleted during migration. This preserves current runtime behavior most closely because the existing evaluator never applies an all-null override as a global override; global state belongs to the flag's `enabled` and `percentage` fields.

The database should also enforce non-empty attributes after migration:

```sql
ALTER TABLE feature_flag_overrides
  ADD CONSTRAINT chk_feature_flag_override_attributes_non_empty
  CHECK (attributes <> '{}'::jsonb);
```

### Uniqueness

The previous eight partial unique indexes are removed. The new uniqueness rule is one override per `flag_id + attributes` combination.

PostgreSQL should enforce this with a unique index on canonical `jsonb` attributes:

```sql
CREATE UNIQUE INDEX uq_feature_flag_override_attributes
  ON feature_flag_overrides (flag_id, attributes);
```

Because `jsonb` normalizes object key ordering, logically identical objects with different key order should conflict as expected.

---

## 3. Prisma Migration

The migration must transform v0.2.0 data automatically:

1. Add `attributes jsonb not null default '{}'`.
2. Add `priority integer not null default 0`.
3. Populate `attributes` from non-null legacy columns:
   - `tenant_id` becomes `attributes.tenantId`
   - `user_id` becomes `attributes.userId`
   - `environment` becomes `attributes.environment`
4. Delete rows where the populated `attributes` is `{}`.
5. Drop the old partial unique indexes.
6. Drop `tenant_id`, `user_id`, and `environment`.
7. Add the new unique index on `(flag_id, attributes)`.
8. Add the non-empty attributes check constraint.

If legacy data contains duplicate rows that collapse to the same `flag_id + attributes`, the migration should keep the most recently updated row and delete the others before creating the new unique index. That gives deterministic behavior and avoids a migration failure for data that the old partial indexes should already have prevented in normal operation.

---

## 4. Evaluation Context

The public evaluation context becomes hybrid for compatibility:

```typescript
export interface EvaluationContext {
  userId?: string | null;
  tenantId?: string | null;
  environment?: string;
  attributes?: TargetingAttributes;
}
```

Existing consumers can continue passing:

```typescript
await flags.isEnabled('NEW_DASHBOARD', {
  userId: 'u-1',
  tenantId: 't-1',
  environment: 'production',
});
```

New consumers can pass arbitrary attributes:

```typescript
await flags.isEnabled('NEW_CHECKOUT', {
  userId: 'u-1',
  tenantId: 't-1',
  environment: 'production',
  attributes: {
    country: 'KR',
    plan: 'pro',
    betaGroup: 'checkout-v2',
  },
});
```

Before evaluation, the context resolver normalizes everything into one attribute object. Merge order is:

1. Start with `attributes`.
2. Overlay top-level `userId`, `tenantId`, and `environment` when they are not `undefined`.

Top-level fields win on key conflicts. This preserves the existing API as the source of truth for the legacy dimensions.

Explicit `null` remains meaningful for `userId` and `tenantId`: it suppresses ambient values and normalizes to `userId: null` or `tenantId: null` when present.

---

## 5. Evaluation Engine

v0.3.0 implements exact-match attribute overrides, not a rule engine.

### Matching

An override matches when all of its attributes are exactly present with equal values in the normalized context attributes.

Examples:

| Override attributes | Context attributes | Match |
| --- | --- | --- |
| `{ "tenantId": "t-1" }` | `{ "tenantId": "t-1", "plan": "pro" }` | yes |
| `{ "tenantId": "t-1", "plan": "pro" }` | `{ "tenantId": "t-1" }` | no |
| `{ "country": "KR" }` | `{ "country": "US" }` | no |
| `{ "beta": true }` | `{ "beta": true }` | yes |

Deep object and array comparisons are not supported because objects and arrays are invalid targeting values.

### Priority

When multiple overrides match, choose one deterministically:

1. Higher specificity wins: more attribute keys.
2. Higher `priority` wins when specificity is tied.
3. Earlier `createdAt` wins when priority is tied.
4. Lower `id` wins when timestamps are tied.

This preserves the spirit of the old `user > tenant > environment` cascade through specificity. A user-specific override with two keys can beat a tenant-only override naturally. When two single-key overrides both match, consumers can use `priority` to express the desired winner.

### Fallbacks

After override evaluation, percentage rollout and global flag behavior remain unchanged:

1. Archived flags evaluate to false.
2. Matching attribute override returns its `enabled` value.
3. Percentage rollout uses the existing deterministic hash behavior.
4. Global `enabled` is the final fallback.

The percentage hash key remains `userId ?? tenantId ?? ''` in v0.3.0. Expanding hash key selection to arbitrary attributes is a separate design topic.

---

## 6. Admin API DTO Validation

The Admin API moves from interface-typed bodies to class-validator DTOs. Invalid input should fail at the controller boundary with a 400 response before it reaches service or repository code.

### Dependencies

Add peer dependencies:

- `class-validator`
- `class-transformer`

Also add both as dev dependencies for local tests and builds.

These are required when using `FeatureFlagAdminModule`. The core non-admin evaluator APIs should not depend on application-wide Nest validation setup.

### Validation Pipe

Apply a controller-scoped `ValidationPipe` to `FeatureFlagAdminController`:

```typescript
@UsePipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}))
```

### DTOs

`CreateFeatureFlagDto`:

- `key`: required non-empty string
- `description`: optional string
- `enabled`: optional boolean
- `percentage`: optional integer from 0 to 100
- `metadata`: optional object

`UpdateFeatureFlagDto`:

- `description`: optional string
- `enabled`: optional boolean
- `percentage`: optional integer from 0 to 100
- `metadata`: optional object

No-op PATCH requests remain allowed. They are not useful, but they preserve the existing low-friction behavior and do not create unsafe state.

`SetOverrideDto`:

- `attributes`: required non-empty object with primitive or null values
- `enabled`: required boolean
- `priority`: optional integer, default 0

`RemoveOverrideDto`:

- `attributes`: required non-empty object with primitive or null values

Legacy override bodies are rejected:

```json
{ "tenantId": "t-1", "enabled": true }
```

New bodies use `attributes`:

```json
{ "attributes": { "tenantId": "t-1" }, "enabled": true }
```

---

## 7. Service and Repository API

### Public Input Types

Feature flag create and update inputs remain service-level interfaces:

```typescript
export interface CreateFeatureFlagInput {
  key: string;
  description?: string;
  enabled?: boolean;
  percentage?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateFeatureFlagInput {
  description?: string;
  enabled?: boolean;
  percentage?: number;
  metadata?: Record<string, unknown>;
}
```

Override inputs change to attributes:

```typescript
export interface SetOverrideInput {
  attributes: TargetingAttributes;
  enabled: boolean;
  priority?: number;
}

export interface RemoveOverrideInput {
  attributes: TargetingAttributes;
}
```

`FlagOverride` changes accordingly:

```typescript
export interface FlagOverride {
  id: string;
  flagId: string;
  attributes: TargetingAttributes;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Repository Port

`OverrideCriteria` becomes:

```typescript
export interface OverrideCriteria {
  attributes: TargetingAttributes;
}
```

Repository methods keep the same broad shape but use `attributes`:

- `findOverride(flagId, criteria)` looks up by exact `flagId + attributes`.
- `createOverride(flagId, criteria, enabled, priority)` stores `attributes`, `enabled`, and `priority`.
- `updateOverride(id, input)` replaces `updateOverrideEnabled(id, enabled)` so `setOverride()` can update both `enabled` and `priority`.
- `deleteOverride(id)` remains unchanged.

The repository port should expose:

```typescript
export interface UpdateOverrideInput {
  enabled: boolean;
  priority: number;
}
```

The Prisma repository keeps the existing concurrent insert fallback: if create hits the unique index, re-read the matching override and update it.

### Service Behavior

`FeatureFlagService.setOverride()`:

- requires non-empty `attributes`
- finds the flag id by key
- upserts by `flagId + attributes`
- updates both `enabled` and `priority` when the override already exists
- invalidates cache best-effort
- emits `OVERRIDE_SET` with `flagKey`, `attributes`, `enabled`, `priority`, and `action: 'set'`

`FeatureFlagService.removeOverride()`:

- requires non-empty `attributes`
- deletes the matching override when present
- remains idempotent when no matching override exists
- invalidates cache best-effort
- emits `OVERRIDE_REMOVED` with `flagKey`, `attributes`, and `action: 'removed'`

---

## 8. Examples

Add an `examples/` directory with three copyable mini projects. They should be light enough to maintain but complete enough for adoption.

### `examples/basic-guard`

Shows:

- `FeatureFlagModule.forRoot()`
- `@FeatureFlag('NEW_DASHBOARD')`
- basic controller gating
- seed snippet for one flag

### `examples/multi-tenant-targeting`

Shows:

- hybrid context with `tenantId`, `userId`, and generic `attributes`
- Admin API override body using `attributes`
- targeting examples such as `{ tenantId, plan, country }`
- service-layer `isEnabled()` calls

### `examples/redis-events`

Shows:

- `RedisCacheAdapter`
- `emitEvents: true`
- `@OnEvent(FeatureFlagEvents.EVALUATED)`
- cache invalidation/event subscription wiring

Each example should include a short `README.md`, minimal `package.json`, and focused `src/` files. Full Docker-based e2e apps are not required for v0.3.0 examples.

---

## 9. Tests

### Admin E2E

Add or update coverage for:

- invalid create body returns 400
- invalid percentage returns 400
- override without `attributes` returns 400
- legacy override body with top-level `tenantId` returns 400
- valid `{ attributes: { tenantId: 't-1' }, enabled: true }` returns 201
- remove override by attributes returns 200

### Evaluator Unit

Add coverage for:

- exact match succeeds
- partial context mismatch fails
- higher specificity wins
- higher priority wins when specificity is tied
- deterministic tie-break by `createdAt` then `id`
- empty override attributes are ignored defensively
- percentage fallback still works
- global `enabled` fallback still works

### Repository and E2E

Add coverage for:

- `flagId + attributes` unique behavior
- concurrent `setOverride()` fallback updates existing override
- `removeOverride()` uses exact attributes
- persisted override shape includes `attributes` and `priority`

### Migration

Add migration validation for:

- `tenant_id`, `user_id`, and `environment` move into `attributes`
- all-null legacy override rows are deleted
- legacy partial unique indexes are dropped
- new unique index on `flag_id + attributes` exists
- duplicate collapsed rows resolve deterministically before index creation

---

## 10. Documentation

README updates:

- Add `class-validator` and `class-transformer` to peer dependency instructions.
- Update Admin API request examples to use `attributes`.
- Add attribute targeting guide.
- Add migration guide from v0.2.0 to v0.3.0.
- Link to all three examples.
- Document exact-match-only semantics and priority resolution.

CHANGELOG updates:

- Add `[0.3.0]` with Added, Changed, Breaking, Migration, and Removed sections.
- Call out old override body shape as breaking.
- Call out Prisma schema migration as required.

Package metadata:

- Bump version to `0.3.0` during implementation.
- Include `examples` in the published package only if the package publishing strategy intentionally wants examples on npm. Otherwise keep examples in the repository but outside the package `files` list.

---

## 11. Implementation Boundaries

v0.3.0 includes:

- DTO validation and scoped `ValidationPipe`
- attribute-based targeting override
- automatic Prisma migration
- hybrid evaluation context
- three examples
- README and CHANGELOG updates

v0.3.0 excludes:

- `$in`, `$ne`, `$exists`
- JSONLogic or expression rules
- TypeORM adapter
- OpenTelemetry or Prometheus metrics
- cache stampede protection
- audit-log persistence
- GraphQL integration

---

## 12. Open Decisions Resolved

- Targeting approach: attribute overrides first, full rule engine later.
- Migration strategy: automatic Prisma migration.
- Context API: hybrid API with legacy top-level fields plus `attributes`.
- Override priority: specificity, then `priority`, then deterministic tie-break.
- Match operators: exact match only.
- Empty attributes: rejected for new writes; all-null legacy override rows deleted during migration.
