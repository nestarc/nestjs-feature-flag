# Feature Flag v0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.3.0 as the breaking release that replaces fixed override dimensions with exact-match attribute targeting, adds Admin API DTO validation, and adds copyable examples.

**Architecture:** Introduce a small targeting-attributes utility as the shared boundary for runtime validation and normalization. Migrate Prisma storage from nullable `tenant_id` / `user_id` / `environment` columns to `attributes jsonb` plus `priority`, then update repository, service, evaluator, Admin API, tests, examples, and docs around that model. Keep percentage rollout and global fallback behavior unchanged.

**Tech Stack:** NestJS 11, TypeScript, Prisma 6, PostgreSQL jsonb, Jest, Supertest, class-validator, class-transformer.

---

## File Structure

### New Files

- `src/utils/targeting-attributes.ts` - shared primitive attribute validation, normalization, and match helpers.
- `src/admin/feature-flag-admin.dto.ts` - class-validator DTOs for Admin API request bodies.
- `src/admin/targeting-attributes.validator.ts` - custom class-validator decorator for non-empty primitive attribute maps.
- `prisma/migrations/20260512000000_attribute_targeting/migration.sql` - v0.2.0 to v0.3.0 data migration.
- `test/utils/targeting-attributes.spec.ts` - unit tests for targeting utility.
- `test/e2e/attribute-targeting-migration.e2e-spec.ts` - migration/constraint validation against PostgreSQL.
- `examples/basic-guard/package.json`
- `examples/basic-guard/README.md`
- `examples/basic-guard/src/app.module.ts`
- `examples/basic-guard/src/dashboard.controller.ts`
- `examples/basic-guard/src/prisma.service.ts`
- `examples/multi-tenant-targeting/package.json`
- `examples/multi-tenant-targeting/README.md`
- `examples/multi-tenant-targeting/src/app.module.ts`
- `examples/multi-tenant-targeting/src/checkout.controller.ts`
- `examples/multi-tenant-targeting/src/prisma.service.ts`
- `examples/redis-events/package.json`
- `examples/redis-events/README.md`
- `examples/redis-events/src/app.module.ts`
- `examples/redis-events/src/flag-events.listener.ts`
- `examples/redis-events/src/prisma.service.ts`

### Modified Files

- `package.json` - bump version and add class-validator/class-transformer dependencies.
- `package-lock.json` - lockfile update after dependency install.
- `prisma/schema.prisma` - replace override target columns with `attributes` and `priority`.
- `src/interfaces/feature-flag.interface.ts` - add targeting types and update override shapes.
- `src/interfaces/evaluation-context.interface.ts` - add `attributes`.
- `src/interfaces/feature-flag-repository.interface.ts` - update override criteria and update method.
- `src/events/feature-flag.events.ts` - replace fixed override event fields with `attributes` and `priority`.
- `src/services/flag-context-resolver.ts` - normalize top-level context fields into attributes.
- `src/services/flag-evaluator.service.ts` - evaluate exact-match attribute overrides.
- `src/services/feature-flag.service.ts` - upsert/remove overrides by attributes and emit new event shape.
- `src/repositories/prisma-feature-flag.repository.ts` - store and query `attributes` jsonb and `priority`.
- `src/admin/feature-flag-admin.controller.ts` - use DTOs and scoped ValidationPipe.
- `src/index.ts` - export targeting types if needed by consumers.
- `test/services/flag-context-resolver.spec.ts` - cover context attribute normalization.
- `test/services/flag-evaluator.service.spec.ts` - replace fixed override cascade tests with attribute targeting tests.
- `test/services/feature-flag.service.spec.ts` - update service override tests.
- `test/repositories/prisma-feature-flag.repository.spec.ts` - update repository contract tests.
- `test/admin/feature-flag-admin.controller.spec.ts` - update controller delegation tests to DTO body shape.
- `test/e2e/admin.e2e-spec.ts` - add DTO validation and attribute override e2e coverage.
- `test/e2e/feature-flag.service.e2e-spec.ts` - update override assertions to attributes.
- `test/testing/test-feature-flag.module.spec.ts` - update flag fixture shape if overrides appear.
- `README.md` - document v0.3.0 targeting and Admin API body changes.
- `CHANGELOG.md` - add v0.3.0 release notes.

### Deleted or Replaced Concepts

- `FlagOverride.tenantId`
- `FlagOverride.userId`
- `FlagOverride.environment`
- `OverrideCriteria.tenantId`
- `OverrideCriteria.userId`
- `OverrideCriteria.environment`
- `FeatureFlagRepository.updateOverrideEnabled()`

---

### Task 1: Targeting Attribute Types and Utility

**Files:**
- Modify: `src/interfaces/feature-flag.interface.ts`
- Create: `src/utils/targeting-attributes.ts`
- Create: `test/utils/targeting-attributes.spec.ts`
- Test: `test/utils/targeting-attributes.spec.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `test/utils/targeting-attributes.spec.ts`:

```typescript
import {
  isTargetingAttributeValue,
  isTargetingAttributes,
  normalizeTargetingAttributes,
  matchesTargetingAttributes,
} from '../../src/utils/targeting-attributes';

describe('targeting attributes utilities', () => {
  describe('isTargetingAttributeValue', () => {
    it('accepts primitive JSON values and null', () => {
      expect(isTargetingAttributeValue('KR')).toBe(true);
      expect(isTargetingAttributeValue(42)).toBe(true);
      expect(isTargetingAttributeValue(true)).toBe(true);
      expect(isTargetingAttributeValue(null)).toBe(true);
    });

    it('rejects arrays, objects, and undefined', () => {
      expect(isTargetingAttributeValue(['KR'])).toBe(false);
      expect(isTargetingAttributeValue({ country: 'KR' })).toBe(false);
      expect(isTargetingAttributeValue(undefined)).toBe(false);
    });
  });

  describe('isTargetingAttributes', () => {
    it('accepts a non-empty object with primitive values', () => {
      expect(isTargetingAttributes({ tenantId: 't-1', plan: 'pro', beta: true })).toBe(true);
    });

    it('rejects empty objects when allowEmpty is false', () => {
      expect(isTargetingAttributes({}, { allowEmpty: false })).toBe(false);
    });

    it('accepts empty objects when allowEmpty is true', () => {
      expect(isTargetingAttributes({}, { allowEmpty: true })).toBe(true);
    });

    it('rejects arrays and nested objects', () => {
      expect(isTargetingAttributes(['tenantId'])).toBe(false);
      expect(isTargetingAttributes({ plan: { name: 'pro' } })).toBe(false);
    });
  });

  describe('normalizeTargetingAttributes', () => {
    it('returns a shallow copy of valid attributes', () => {
      const input = { tenantId: 't-1', country: 'KR' };
      const result = normalizeTargetingAttributes(input, { allowEmpty: false });

      expect(result).toEqual(input);
      expect(result).not.toBe(input);
    });

    it('throws for invalid values', () => {
      expect(() => normalizeTargetingAttributes({ plan: ['pro'] }, { allowEmpty: false })).toThrow(
        'attributes must be a non-empty object with string, number, boolean, or null values',
      );
    });
  });

  describe('matchesTargetingAttributes', () => {
    it('matches when every override attribute exists in context with the same value', () => {
      expect(
        matchesTargetingAttributes(
          { tenantId: 't-1', plan: 'pro' },
          { tenantId: 't-1', plan: 'pro', country: 'KR' },
        ),
      ).toBe(true);
    });

    it('does not match when a value differs', () => {
      expect(
        matchesTargetingAttributes(
          { country: 'KR' },
          { country: 'US' },
        ),
      ).toBe(false);
    });

    it('does not match when a key is missing', () => {
      expect(
        matchesTargetingAttributes(
          { tenantId: 't-1', plan: 'pro' },
          { tenantId: 't-1' },
        ),
      ).toBe(false);
    });

    it('does not match empty override attributes', () => {
      expect(matchesTargetingAttributes({}, { tenantId: 't-1' })).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the utility tests to verify they fail**

Run:

```bash
npx jest test/utils/targeting-attributes.spec.ts --no-coverage
```

Expected: FAIL with `Cannot find module '../../src/utils/targeting-attributes'`.

- [ ] **Step 3: Add public targeting types**

In `src/interfaces/feature-flag.interface.ts`, add these types before `CreateFeatureFlagInput`:

```typescript
export type TargetingAttributeValue = string | number | boolean | null;
export type TargetingAttributes = Record<string, TargetingAttributeValue>;
```

- [ ] **Step 4: Implement the targeting utility**

Create `src/utils/targeting-attributes.ts`:

```typescript
import {
  TargetingAttributes,
  TargetingAttributeValue,
} from '../interfaces/feature-flag.interface';

interface AttributeValidationOptions {
  allowEmpty: boolean;
}

const INVALID_ATTRIBUTES_MESSAGE =
  'attributes must be a non-empty object with string, number, boolean, or null values';

export function isTargetingAttributeValue(value: unknown): value is TargetingAttributeValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function isTargetingAttributes(
  value: unknown,
  options: AttributeValidationOptions = { allowEmpty: false },
): value is TargetingAttributes {
  if (!isPlainObject(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (!options.allowEmpty && entries.length === 0) {
    return false;
  }

  return entries.every(([, attributeValue]) => isTargetingAttributeValue(attributeValue));
}

export function normalizeTargetingAttributes(
  value: unknown,
  options: AttributeValidationOptions = { allowEmpty: false },
): TargetingAttributes {
  if (!isTargetingAttributes(value, options)) {
    throw new Error(INVALID_ATTRIBUTES_MESSAGE);
  }

  return { ...value };
}

export function matchesTargetingAttributes(
  overrideAttributes: TargetingAttributes,
  contextAttributes: TargetingAttributes,
): boolean {
  const entries = Object.entries(overrideAttributes);
  if (entries.length === 0) {
    return false;
  }

  return entries.every(([key, value]) => contextAttributes[key] === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
```

- [ ] **Step 5: Run the utility tests to verify they pass**

Run:

```bash
npx jest test/utils/targeting-attributes.spec.ts --no-coverage
```

Expected: PASS with 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/interfaces/feature-flag.interface.ts src/utils/targeting-attributes.ts test/utils/targeting-attributes.spec.ts
git commit -m "feat: add targeting attribute utilities"
```

---

### Task 2: Hybrid Evaluation Context Normalization

**Files:**
- Modify: `src/interfaces/evaluation-context.interface.ts`
- Modify: `src/services/flag-context-resolver.ts`
- Modify: `test/services/flag-context-resolver.spec.ts`
- Test: `test/services/flag-context-resolver.spec.ts`

- [ ] **Step 1: Add failing context resolver tests**

Append these cases inside `describe('FlagContextResolver', () => { ... })` in `test/services/flag-context-resolver.spec.ts`:

```typescript
  describe('attribute normalization', () => {
    it('should include explicit generic attributes', () => {
      const result = resolver.resolve({
        attributes: {
          country: 'KR',
          plan: 'pro',
        },
      });

      expect(result.attributes).toEqual({
        country: 'KR',
        plan: 'pro',
        userId: 'ambient-user',
        tenantId: 'ambient-tenant',
        environment: 'production',
      });
    });

    it('should let top-level legacy fields win over attributes with the same key', () => {
      const result = resolver.resolve({
        userId: 'explicit-user',
        tenantId: 'explicit-tenant',
        environment: 'staging',
        attributes: {
          userId: 'attribute-user',
          tenantId: 'attribute-tenant',
          environment: 'attribute-env',
          plan: 'pro',
        },
      });

      expect(result.attributes).toEqual({
        userId: 'explicit-user',
        tenantId: 'explicit-tenant',
        environment: 'staging',
        plan: 'pro',
      });
    });

    it('should preserve explicit null userId and tenantId in attributes', () => {
      const result = resolver.resolve({
        userId: null,
        tenantId: null,
        attributes: {
          plan: 'free',
        },
      });

      expect(result.attributes).toEqual({
        plan: 'free',
        userId: null,
        tenantId: null,
        environment: 'production',
      });
    });
  });
```

- [ ] **Step 2: Run resolver tests to verify they fail**

Run:

```bash
npx jest test/services/flag-context-resolver.spec.ts --no-coverage
```

Expected: FAIL because `EvaluationContext` has no `attributes` field and resolver does not normalize attributes.

- [ ] **Step 3: Update the evaluation context interface**

Replace `src/interfaces/evaluation-context.interface.ts` with:

```typescript
import { TargetingAttributes } from './feature-flag.interface';

export interface EvaluationContext {
  /** User ID - used for user-scoped targeting and percentage hash */
  userId?: string | null;

  /** Tenant ID - used for tenant-scoped targeting. Ignored if tenancy is not installed */
  tenantId?: string | null;

  /** Environment - auto-injected from module options. Can be explicitly overridden */
  environment?: string;

  /** Additional exact-match targeting attributes */
  attributes?: TargetingAttributes;
}
```

- [ ] **Step 4: Update the context resolver**

Replace the `resolve()` method in `src/services/flag-context-resolver.ts` with:

```typescript
  resolve(explicit?: EvaluationContext): EvaluationContext {
    const userId =
      explicit?.userId !== undefined ? explicit.userId : this.flagContext.getUserId();
    const tenantId =
      explicit?.tenantId !== undefined
        ? explicit.tenantId
        : this.tenantProvider.getCurrentTenantId();
    const environment =
      explicit?.environment !== undefined ? explicit.environment : this.options.environment;

    return {
      userId,
      tenantId,
      environment,
      attributes: {
        ...(explicit?.attributes ?? {}),
        ...(userId !== undefined && { userId }),
        ...(tenantId !== undefined && { tenantId }),
        ...(environment !== undefined && { environment }),
      },
    };
  }
```

- [ ] **Step 5: Update existing resolver assertions**

In `test/services/flag-context-resolver.spec.ts`, update exact `toEqual` assertions for full context objects so they include `attributes`. For the explicit context case:

```typescript
      expect(result).toEqual({
        userId: 'u1',
        tenantId: 't1',
        environment: 'dev',
        attributes: {
          userId: 'u1',
          tenantId: 't1',
          environment: 'dev',
        },
      });
```

For the ambient context case:

```typescript
      expect(result).toEqual({
        userId: 'ambient-user',
        tenantId: 'ambient-tenant',
        environment: 'production',
        attributes: {
          userId: 'ambient-user',
          tenantId: 'ambient-tenant',
          environment: 'production',
        },
      });
```

- [ ] **Step 6: Run resolver tests to verify they pass**

Run:

```bash
npx jest test/services/flag-context-resolver.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/evaluation-context.interface.ts src/services/flag-context-resolver.ts test/services/flag-context-resolver.spec.ts
git commit -m "feat: normalize evaluation context attributes"
```

---

### Task 3: Prisma Schema and Attribute Targeting Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260512000000_attribute_targeting/migration.sql`
- Create: `test/e2e/attribute-targeting-migration.e2e-spec.ts`
- Test: `test/e2e/attribute-targeting-migration.e2e-spec.ts`

- [ ] **Step 1: Write migration validation tests**

Create `test/e2e/attribute-targeting-migration.e2e-spec.ts`:

```typescript
import { getPrisma, disconnectPrisma } from './helpers/prisma-test.helper';

describe('attribute targeting migration schema (e2e)', () => {
  const prisma = getPrisma();

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('should expose attributes and priority columns on feature_flag_overrides', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'feature_flag_overrides'
      ORDER BY column_name
    `;

    const columnNames = columns.map((column) => column.column_name);
    expect(columnNames).toContain('attributes');
    expect(columnNames).toContain('priority');
    expect(columnNames).not.toContain('tenant_id');
    expect(columnNames).not.toContain('user_id');
    expect(columnNames).not.toContain('environment');
  });

  it('should enforce non-empty attributes', async () => {
    const flag = await prisma.featureFlag.create({
      data: {
        key: 'MIGRATION_EMPTY_ATTRIBUTES',
        enabled: true,
        percentage: 0,
        metadata: {},
      },
    });

    await expect(
      prisma.$executeRaw`
        INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
        VALUES (${flag.id}::uuid, '{}'::jsonb, 0, true)
      `,
    ).rejects.toThrow();
  });

  it('should enforce one override per flag and attributes object', async () => {
    const flag = await prisma.featureFlag.create({
      data: {
        key: 'MIGRATION_UNIQUE_ATTRIBUTES',
        enabled: true,
        percentage: 0,
        metadata: {},
      },
    });

    await prisma.$executeRaw`
      INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
      VALUES (${flag.id}::uuid, '{"tenantId":"t-1"}'::jsonb, 0, true)
    `;

    await expect(
      prisma.$executeRaw`
        INSERT INTO feature_flag_overrides (flag_id, attributes, priority, enabled)
        VALUES (${flag.id}::uuid, '{"tenantId":"t-1"}'::jsonb, 10, false)
      `,
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run migration validation tests to verify they fail before schema changes**

Run:

```bash
npm run test:e2e -- --runTestsByPath test/e2e/attribute-targeting-migration.e2e-spec.ts
```

Expected: FAIL because the current schema still contains `tenant_id`, `user_id`, and `environment`.

- [ ] **Step 3: Update Prisma schema**

Replace the `FeatureFlagOverride` model in `prisma/schema.prisma` with:

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

- [ ] **Step 4: Add the migration SQL**

Create `prisma/migrations/20260512000000_attribute_targeting/migration.sql`:

```sql
ALTER TABLE "feature_flag_overrides"
  ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

UPDATE "feature_flag_overrides"
SET "attributes" = jsonb_strip_nulls(
  jsonb_build_object(
    'tenantId', "tenant_id",
    'userId', "user_id",
    'environment', "environment"
  )
);

DELETE FROM "feature_flag_overrides"
WHERE "attributes" = '{}'::jsonb;

WITH ranked_overrides AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "flag_id", "attributes"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS row_number
  FROM "feature_flag_overrides"
)
DELETE FROM "feature_flag_overrides" target
USING ranked_overrides ranked
WHERE target."id" = ranked."id"
  AND ranked.row_number > 1;

DROP INDEX IF EXISTS "uq_override_000";
DROP INDEX IF EXISTS "uq_override_001";
DROP INDEX IF EXISTS "uq_override_010";
DROP INDEX IF EXISTS "uq_override_011";
DROP INDEX IF EXISTS "uq_override_100";
DROP INDEX IF EXISTS "uq_override_101";
DROP INDEX IF EXISTS "uq_override_110";
DROP INDEX IF EXISTS "uq_override_111";

ALTER TABLE "feature_flag_overrides"
  DROP COLUMN "tenant_id",
  DROP COLUMN "user_id",
  DROP COLUMN "environment";

CREATE UNIQUE INDEX "uq_feature_flag_override_attributes"
  ON "feature_flag_overrides"("flag_id", "attributes");

ALTER TABLE "feature_flag_overrides"
  ADD CONSTRAINT "chk_feature_flag_override_attributes_non_empty"
  CHECK ("attributes" <> '{}'::jsonb);
```

- [ ] **Step 5: Run Prisma migration deploy against the e2e database**

Run:

```bash
npm run db:reset
npm run db:migrate
```

Expected: both commands exit 0.

- [ ] **Step 6: Run migration validation tests**

Run:

```bash
npm run test:e2e -- --runTestsByPath test/e2e/attribute-targeting-migration.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260512000000_attribute_targeting/migration.sql test/e2e/attribute-targeting-migration.e2e-spec.ts
git commit -m "feat: migrate overrides to attribute targeting schema"
```

---

### Task 4: Repository Port and Prisma Repository

**Files:**
- Modify: `src/interfaces/feature-flag.interface.ts`
- Modify: `src/interfaces/feature-flag-repository.interface.ts`
- Modify: `src/repositories/prisma-feature-flag.repository.ts`
- Modify: `test/repositories/prisma-feature-flag.repository.spec.ts`
- Test: `test/repositories/prisma-feature-flag.repository.spec.ts`

- [ ] **Step 1: Update failing repository tests**

In `test/repositories/prisma-feature-flag.repository.spec.ts`, replace the override-related tests with:

```typescript
  describe('findOverride', () => {
    it('should delegate with exact attributes equality', async () => {
      const criteria = { attributes: { tenantId: 't1', plan: 'pro' } };
      const expected = { id: 'override-1' };
      prisma.featureFlagOverride.findFirst.mockResolvedValue(expected);

      const result = await repository.findOverride('flag-id', criteria);

      expect(prisma.featureFlagOverride.findFirst).toHaveBeenCalledWith({
        where: {
          flagId: 'flag-id',
          attributes: { equals: { tenantId: 't1', plan: 'pro' } },
        },
        select: { id: true },
      });
      expect(result).toBe(expected);
    });

    it('should return null when no override exists', async () => {
      prisma.featureFlagOverride.findFirst.mockResolvedValue(null);

      const result = await repository.findOverride('flag-id', {
        attributes: { tenantId: 'missing' },
      });

      expect(result).toBeNull();
    });
  });

  describe('createOverride', () => {
    it('should delegate to prisma.featureFlagOverride.create with attributes and priority', async () => {
      const criteria = { attributes: { tenantId: 't1', plan: 'pro' } };
      prisma.featureFlagOverride.create.mockResolvedValue({});

      await repository.createOverride('flag-id', criteria, true, 10);

      expect(prisma.featureFlagOverride.create).toHaveBeenCalledWith({
        data: {
          flagId: 'flag-id',
          attributes: { tenantId: 't1', plan: 'pro' },
          priority: 10,
          enabled: true,
        },
      });
    });

    it('should fall back to update on unique violation (P2002 race)', async () => {
      const criteria = { attributes: { tenantId: 't1' } };
      prisma.featureFlagOverride.create.mockRejectedValue({ code: 'P2002' });
      prisma.featureFlagOverride.findFirst.mockResolvedValue({ id: 'existing-id' });
      prisma.featureFlagOverride.update.mockResolvedValue({});

      await repository.createOverride('flag-id', criteria, true, 20);

      expect(prisma.featureFlagOverride.update).toHaveBeenCalledWith({
        where: { id: 'existing-id' },
        data: { enabled: true, priority: 20 },
      });
    });
  });

  describe('updateOverride', () => {
    it('should delegate with enabled and priority', async () => {
      prisma.featureFlagOverride.update.mockResolvedValue({});

      await repository.updateOverride('override-1', { enabled: false, priority: 5 });

      expect(prisma.featureFlagOverride.update).toHaveBeenCalledWith({
        where: { id: 'override-1' },
        data: { enabled: false, priority: 5 },
      });
    });
  });
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:

```bash
npx jest test/repositories/prisma-feature-flag.repository.spec.ts --no-coverage
```

Expected: FAIL because repository interfaces and implementation still use fixed override columns.

- [ ] **Step 3: Update feature flag interfaces**

In `src/interfaces/feature-flag.interface.ts`, replace `SetOverrideInput`, `FlagOverride`, and `RemoveOverrideInput` with:

```typescript
export interface SetOverrideInput {
  attributes: TargetingAttributes;
  enabled: boolean;
  priority?: number;
}

export interface FlagOverride {
  id: string;
  flagId: string;
  attributes: TargetingAttributes;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemoveOverrideInput {
  attributes: TargetingAttributes;
}
```

- [ ] **Step 4: Update repository interface**

Replace `src/interfaces/feature-flag-repository.interface.ts` with:

```typescript
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  FeatureFlagWithOverrides,
  TargetingAttributes,
} from './feature-flag.interface';

export interface OverrideCriteria {
  attributes: TargetingAttributes;
}

export interface UpdateOverrideInput {
  enabled: boolean;
  priority: number;
}

export interface FeatureFlagRepository {
  createFlag(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  updateFlag(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides>;
  archiveFlag(key: string): Promise<FeatureFlagWithOverrides>;
  findFlagByKey(key: string): Promise<FeatureFlagWithOverrides | null>;
  findFlagIdByKey(key: string): Promise<string | null>;
  findAllActiveFlags(): Promise<FeatureFlagWithOverrides[]>;
  findOverride(flagId: string, criteria: OverrideCriteria): Promise<{ id: string } | null>;
  createOverride(
    flagId: string,
    criteria: OverrideCriteria,
    enabled: boolean,
    priority: number,
  ): Promise<void>;
  updateOverride(id: string, input: UpdateOverrideInput): Promise<void>;
  deleteOverride(id: string): Promise<void>;
}
```

- [ ] **Step 5: Update Prisma repository override methods**

In `src/repositories/prisma-feature-flag.repository.ts`, import `UpdateOverrideInput` and replace the override methods with:

```typescript
  async findOverride(flagId: string, criteria: OverrideCriteria): Promise<{ id: string } | null> {
    return this.prisma.featureFlagOverride.findFirst({
      where: {
        flagId,
        attributes: { equals: criteria.attributes },
      },
      select: { id: true },
    });
  }

  async createOverride(
    flagId: string,
    criteria: OverrideCriteria,
    enabled: boolean,
    priority: number,
  ): Promise<void> {
    try {
      await this.prisma.featureFlagOverride.create({
        data: {
          flagId,
          attributes: criteria.attributes,
          priority,
          enabled,
        },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        const existing = await this.findOverride(flagId, criteria);
        if (existing) {
          await this.updateOverride(existing.id, { enabled, priority });
          return;
        }
      }
      throw error;
    }
  }

  async updateOverride(id: string, input: UpdateOverrideInput): Promise<void> {
    await this.prisma.featureFlagOverride.update({
      where: { id },
      data: {
        enabled: input.enabled,
        priority: input.priority,
      },
    });
  }
```

Delete the old `updateOverrideEnabled()` method.

- [ ] **Step 6: Run repository tests to verify they pass**

Run:

```bash
npx jest test/repositories/prisma-feature-flag.repository.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/feature-flag.interface.ts src/interfaces/feature-flag-repository.interface.ts src/repositories/prisma-feature-flag.repository.ts test/repositories/prisma-feature-flag.repository.spec.ts
git commit -m "feat: update repository for attribute overrides"
```

---

### Task 5: Attribute Override Evaluator

**Files:**
- Modify: `src/events/feature-flag.events.ts`
- Modify: `src/services/flag-evaluator.service.ts`
- Modify: `test/services/flag-evaluator.service.spec.ts`
- Test: `test/services/flag-evaluator.service.spec.ts`

- [ ] **Step 1: Replace evaluator tests with attribute targeting behavior**

In `test/services/flag-evaluator.service.spec.ts`, update `makeOverride()` to:

```typescript
function makeOverride(partial: Partial<FlagOverride> = {}): FlagOverride {
  return {
    id: 'override-1',
    flagId: 'flag-1',
    attributes: { tenantId: 'tenant-1' },
    priority: 0,
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}
```

Replace the user/tenant/environment override describe blocks with:

```typescript
  describe('attribute overrides', () => {
    it('should use an override when all attributes match', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ attributes: { tenantId: 'tenant-1', plan: 'pro' } })],
      });

      const result = evaluator.evaluate(flag, {
        tenantId: 'tenant-1',
        attributes: { tenantId: 'tenant-1', plan: 'pro', country: 'KR' },
      });

      expect(result.result).toBe(true);
      expect(result.source).toBe('override');
    });

    it('should not use an override when any attribute differs', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: { country: 'KR' } })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { country: 'US' },
      });

      expect(result.result).toBe(false);
      expect(result.source).toBe('global');
    });

    it('should not use an override when the context is missing an attribute', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: { tenantId: 'tenant-1', plan: 'pro' } })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1' },
      });

      expect(result.result).toBe(false);
    });

    it('should prefer the override with more matching attributes', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'broad',
            attributes: { tenantId: 'tenant-1' },
            enabled: false,
          }),
          makeOverride({
            id: 'specific',
            attributes: { tenantId: 'tenant-1', plan: 'pro' },
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should use priority when specificity is tied', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'low-priority',
            attributes: { tenantId: 'tenant-1' },
            priority: 0,
            enabled: false,
          }),
          makeOverride({
            id: 'high-priority',
            attributes: { plan: 'pro' },
            priority: 20,
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should tie-break by createdAt then id', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({
            id: 'b-override',
            attributes: { plan: 'pro' },
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            enabled: false,
          }),
          makeOverride({
            id: 'a-override',
            attributes: { plan: 'pro' },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            enabled: true,
          }),
        ],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { plan: 'pro' },
      });

      expect(result.result).toBe(true);
    });

    it('should ignore empty override attributes defensively', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ attributes: {}, enabled: true })],
      });

      const result = evaluator.evaluate(flag, {
        attributes: { tenantId: 'tenant-1' },
      });

      expect(result.result).toBe(false);
    });
  });
```

- [ ] **Step 2: Run evaluator tests to verify they fail**

Run:

```bash
npx jest test/services/flag-evaluator.service.spec.ts --no-coverage
```

Expected: FAIL because the event source union and evaluator still use fixed override columns.

- [ ] **Step 3: Update event source and override event types**

In `src/events/feature-flag.events.ts`, replace the source and override event definitions with:

```typescript
export interface FlagEvaluatedEvent {
  flagKey: string;
  result: boolean;
  context: EvaluationContext;
  source: 'override' | 'percentage' | 'global';
  evaluationTimeMs: number;
}

export interface FlagOverrideEvent {
  flagKey: string;
  attributes: Record<string, string | number | boolean | null>;
  enabled?: boolean;
  priority?: number;
  action: 'set' | 'removed';
}
```

- [ ] **Step 4: Replace evaluator implementation**

Replace `src/services/flag-evaluator.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { FeatureFlagWithOverrides, FlagOverride } from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { murmurhash3 } from '../utils/hash';
import { FlagEvaluatedEvent } from '../events/feature-flag.events';
import { matchesTargetingAttributes } from '../utils/targeting-attributes';

type EvaluationSource = FlagEvaluatedEvent['source'];

export interface EvaluationResult {
  result: boolean;
  source: EvaluationSource;
}

@Injectable()
export class FlagEvaluatorService {
  evaluate(flag: FeatureFlagWithOverrides, context: EvaluationContext): EvaluationResult {
    if (flag.archivedAt) {
      return { result: false, source: 'global' };
    }

    const override = this.findMatchingOverride(flag.overrides, context);
    if (override) {
      return { result: override.enabled, source: 'override' };
    }

    if (flag.percentage > 0) {
      if (flag.percentage === 100) {
        return { result: true, source: 'percentage' };
      }

      const hashKey = context.userId ?? context.tenantId ?? '';
      if (!hashKey) {
        return { result: flag.enabled, source: 'global' };
      }

      const bucket = murmurhash3(flag.key + hashKey) % 100;
      return { result: bucket < flag.percentage, source: 'percentage' };
    }

    return { result: flag.enabled, source: 'global' };
  }

  private findMatchingOverride(
    overrides: FlagOverride[],
    context: EvaluationContext,
  ): FlagOverride | null {
    const contextAttributes = context.attributes ?? {};

    return overrides
      .filter((override) => matchesTargetingAttributes(override.attributes, contextAttributes))
      .sort(compareOverrides)
      [0] ?? null;
  }
}

function compareOverrides(a: FlagOverride, b: FlagOverride): number {
  const specificityDelta =
    Object.keys(b.attributes).length - Object.keys(a.attributes).length;
  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  const priorityDelta = b.priority - a.priority;
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return a.id.localeCompare(b.id);
}
```

- [ ] **Step 5: Run evaluator tests to verify they pass**

Run:

```bash
npx jest test/services/flag-evaluator.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/events/feature-flag.events.ts src/services/flag-evaluator.service.ts test/services/flag-evaluator.service.spec.ts
git commit -m "feat: evaluate attribute-based overrides"
```

---

### Task 6: FeatureFlagService Attribute Override Behavior

**Files:**
- Modify: `src/services/feature-flag.service.ts`
- Modify: `test/services/feature-flag.service.spec.ts`
- Test: `test/services/feature-flag.service.spec.ts`

- [ ] **Step 1: Update mock repository shape in service tests**

In `test/services/feature-flag.service.spec.ts`, replace `updateOverrideEnabled` in `mockRepository` with:

```typescript
      updateOverride: jest.fn(),
```

- [ ] **Step 2: Replace service override tests**

Replace the `describe('setOverride', ...)`, `describe('removeOverride', ...)`, and `describe('setOverride error handling', ...)` blocks with:

```typescript
  describe('setOverride', () => {
    it('should create a new attribute override when none exists', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue(null);
      mockRepository.createOverride.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
        enabled: true,
        priority: 10,
      });

      expect(mockRepository.findOverride).toHaveBeenCalledWith('uuid-1', {
        attributes: { tenantId: 'tenant-1', plan: 'pro' },
      });
      expect(mockRepository.createOverride).toHaveBeenCalledWith(
        'uuid-1',
        { attributes: { tenantId: 'tenant-1', plan: 'pro' } },
        true,
        10,
      );
    });

    it('should update existing override instead of creating a duplicate', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('uuid-1');
      mockRepository.findOverride.mockResolvedValue({ id: 'existing-1' });
      mockRepository.updateOverride.mockResolvedValue(undefined);

      await service.setOverride('MY_FLAG', {
        attributes: { tenantId: 'tenant-1' },
        enabled: false,
      });

      expect(mockRepository.updateOverride).toHaveBeenCalledWith('existing-1', {
        enabled: false,
        priority: 0,
      });
      expect(mockRepository.createOverride).not.toHaveBeenCalled();
    });

    it('should reject empty attributes', async () => {
      await expect(
        service.setOverride('MY_FLAG', {
          attributes: {},
          enabled: true,
        }),
      ).rejects.toThrow('attributes must be a non-empty object');
    });

    it('should throw when flag is not found', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue(null);

      await expect(
        service.setOverride('MISSING', {
          attributes: { tenantId: 'tenant-1' },
          enabled: true,
        }),
      ).rejects.toThrow('Feature flag "MISSING" not found');
    });
  });

  describe('removeOverride', () => {
    it('should delete existing override and invalidate cache', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('flag-1');
      mockRepository.findOverride.mockResolvedValue({ id: 'ov-1' });
      mockRepository.deleteOverride.mockResolvedValue(undefined);

      await service.removeOverride('TEST', {
        attributes: { tenantId: 't-1' },
      });

      expect(mockRepository.findOverride).toHaveBeenCalledWith('flag-1', {
        attributes: { tenantId: 't-1' },
      });
      expect(mockRepository.deleteOverride).toHaveBeenCalledWith('ov-1');
      expect(mockCacheAdapter.invalidate).toHaveBeenCalledWith('TEST');
    });

    it('should throw NotFoundException when flag not found', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue(null);

      await expect(
        service.removeOverride('MISSING', {
          attributes: { tenantId: 't-1' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not fail when override does not exist', async () => {
      mockRepository.findFlagIdByKey.mockResolvedValue('flag-1');
      mockRepository.findOverride.mockResolvedValue(null);

      await expect(
        service.removeOverride('TEST', {
          attributes: { tenantId: 't-1' },
        }),
      ).resolves.not.toThrow();
    });

    it('should reject empty attributes', async () => {
      await expect(
        service.removeOverride('TEST', {
          attributes: {},
        }),
      ).rejects.toThrow('attributes must be a non-empty object');
    });
  });
```

- [ ] **Step 3: Update service event tests**

Use these bodies in the OVERRIDE_SET and OVERRIDE_REMOVED tests:

```typescript
      await service.setOverride('MY_FLAG', {
        attributes: { tenantId: 'tenant-1' },
        enabled: true,
        priority: 5,
      });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('override'),
        expect.objectContaining({
          flagKey: 'MY_FLAG',
          attributes: { tenantId: 'tenant-1' },
          enabled: true,
          priority: 5,
          action: 'set',
        }),
      );
```

```typescript
      await service.removeOverride('MY_FLAG', {
        attributes: { tenantId: 'tenant-1' },
      });
      expect(mockEventPublisher.emit).toHaveBeenCalledWith(
        expect.stringContaining('override'),
        expect.objectContaining({
          flagKey: 'MY_FLAG',
          attributes: { tenantId: 'tenant-1' },
          action: 'removed',
        }),
      );
```

- [ ] **Step 4: Run service tests to verify they fail**

Run:

```bash
npx jest test/services/feature-flag.service.spec.ts --no-coverage
```

Expected: FAIL because service still builds fixed override criteria and calls `updateOverrideEnabled`.

- [ ] **Step 5: Update service override methods**

In `src/services/feature-flag.service.ts`, add imports:

```typescript
import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { normalizeTargetingAttributes } from '../utils/targeting-attributes';
```

Then replace `setOverride()` and `removeOverride()` with:

```typescript
  async setOverride(key: string, input: SetOverrideInput): Promise<void> {
    const attributes = this.normalizeOverrideAttributes(input.attributes);
    const priority = input.priority ?? 0;

    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = { attributes };
    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.updateOverride(existing.id, {
        enabled: input.enabled,
        priority,
      });
    } else {
      await this.repository.createOverride(flagId, criteria, input.enabled, priority);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_SET, {
      flagKey: key,
      attributes,
      enabled: input.enabled,
      priority,
      action: 'set',
    });
  }

  async removeOverride(key: string, input: RemoveOverrideInput): Promise<void> {
    const attributes = this.normalizeOverrideAttributes(input.attributes);

    const flagId = await this.repository.findFlagIdByKey(key);
    if (!flagId) {
      throw new NotFoundException(`Feature flag "${key}" not found`);
    }

    const criteria = { attributes };
    const existing = await this.repository.findOverride(flagId, criteria);
    if (existing) {
      await this.repository.deleteOverride(existing.id);
    }

    await this.safeInvalidateCache(key);
    this.eventPublisher.emit(FeatureFlagEvents.OVERRIDE_REMOVED, {
      flagKey: key,
      attributes,
      action: 'removed',
    });
  }

  private normalizeOverrideAttributes(input: unknown) {
    try {
      return normalizeTargetingAttributes(input, { allowEmpty: false });
    } catch (error) {
      throw new BadRequestException(String(error instanceof Error ? error.message : error));
    }
  }
```

Keep `normalizeOverrideAttributes()` before `safeInvalidateCache()`.

- [ ] **Step 6: Update context-resolution service tests**

Any test fixtures in `test/services/feature-flag.service.spec.ts` that create overrides must use the new shape:

```typescript
        overrides: [{
          id: 'o1',
          flagId: 'uuid-1',
          attributes: { userId: 'user-1' },
          priority: 0,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
```

- [ ] **Step 7: Run service tests to verify they pass**

Run:

```bash
npx jest test/services/feature-flag.service.spec.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/feature-flag.service.ts test/services/feature-flag.service.spec.ts
git commit -m "feat: update service override management"
```

---

### Task 7: Admin API DTO Validation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/admin/targeting-attributes.validator.ts`
- Create: `src/admin/feature-flag-admin.dto.ts`
- Modify: `src/admin/feature-flag-admin.controller.ts`
- Modify: `test/admin/feature-flag-admin.controller.spec.ts`
- Modify: `test/e2e/admin.e2e-spec.ts`
- Test: `test/admin/feature-flag-admin.controller.spec.ts`, `test/e2e/admin.e2e-spec.ts`

- [ ] **Step 1: Add failing Admin e2e validation tests**

Append these tests to `test/e2e/admin.e2e-spec.ts`:

```typescript
  it('POST /feature-flags - should return 400 for empty key', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: '', enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags - should return 400 for invalid percentage', async () => {
    const res = await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'BAD_PERCENTAGE', percentage: -5 });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should reject missing attributes', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'MISSING_ATTRIBUTES', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/MISSING_ATTRIBUTES/overrides')
      .send({ enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should reject legacy top-level tenantId body', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'LEGACY_OVERRIDE_BODY', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/LEGACY_OVERRIDE_BODY/overrides')
      .send({ tenantId: 't-1', enabled: true });

    expect(res.status).toBe(400);
  });

  it('POST /feature-flags/:key/overrides - should accept attribute override body', async () => {
    await request(app.getHttpServer())
      .post('/feature-flags')
      .send({ key: 'ATTRIBUTE_OVERRIDE_BODY', enabled: false });

    const res = await request(app.getHttpServer())
      .post('/feature-flags/ATTRIBUTE_OVERRIDE_BODY/overrides')
      .send({
        attributes: { tenantId: 't-1', plan: 'pro' },
        enabled: true,
        priority: 10,
      });

    expect(res.status).toBe(201);

    const flagRes = await request(app.getHttpServer()).get('/feature-flags/ATTRIBUTE_OVERRIDE_BODY');
    expect(flagRes.body.overrides[0]).toEqual(
      expect.objectContaining({
        attributes: { tenantId: 't-1', plan: 'pro' },
        priority: 10,
        enabled: true,
      }),
    );
  });
```

- [ ] **Step 2: Run Admin e2e tests to verify they fail**

Run:

```bash
npm run test:e2e -- --runTestsByPath test/e2e/admin.e2e-spec.ts
```

Expected: FAIL because the controller has no scoped ValidationPipe and still accepts legacy body fields.

- [ ] **Step 3: Install validation libraries for local build and lockfile**

Run:

```bash
npm install class-validator class-transformer --save-dev
```

Expected: `package.json` and `package-lock.json` update with dev dependencies.

- [ ] **Step 4: Add targeting attributes validator**

Create `src/admin/targeting-attributes.validator.ts`:

```typescript
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isTargetingAttributes } from '../utils/targeting-attributes';

@ValidatorConstraint({ name: 'isTargetingAttributes', async: false })
export class IsTargetingAttributesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isTargetingAttributes(value, { allowEmpty: false });
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'attributes must be a non-empty object with string, number, boolean, or null values';
  }
}

export function IsTargetingAttributes(validationOptions?: ValidationOptions) {
  return function registerTargetingAttributesDecorator(
    target: object,
    propertyName: string,
  ): void {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsTargetingAttributesConstraint,
    });
  };
}
```

- [ ] **Step 5: Add Admin DTOs**

Create `src/admin/feature-flag-admin.dto.ts`:

```typescript
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TargetingAttributes } from '../interfaces/feature-flag.interface';
import { IsTargetingAttributes } from './targeting-attributes.validator';

export class CreateFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SetOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class RemoveOverrideDto {
  @IsTargetingAttributes()
  attributes!: TargetingAttributes;
}
```

- [ ] **Step 6: Apply scoped ValidationPipe and DTOs to controller**

Replace imports and body types in `src/admin/feature-flag-admin.controller.ts` so the file is:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';
import {
  CreateFeatureFlagDto,
  RemoveOverrideDto,
  SetOverrideDto,
  UpdateFeatureFlagDto,
} from './feature-flag-admin.dto';

@Controller()
@UsePipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}))
export class FeatureFlagAdminController {
  constructor(private readonly service: FeatureFlagService) {}

  @Post()
  create(@Body() input: CreateFeatureFlagDto): Promise<FeatureFlagWithOverrides> {
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
    @Body() input: UpdateFeatureFlagDto,
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
    @Body() input: SetOverrideDto,
  ): Promise<void> {
    return this.service.setOverride(key, input);
  }

  @Delete(':key/overrides')
  removeOverride(
    @Param('key') key: string,
    @Body() input: RemoveOverrideDto,
  ): Promise<void> {
    return this.service.removeOverride(key, input);
  }
}
```

- [ ] **Step 7: Update controller unit tests**

In `test/admin/feature-flag-admin.controller.spec.ts`, change override bodies:

```typescript
  it('should set an override', async () => {
    const input = { attributes: { tenantId: 't-1' }, enabled: true };
    await controller.setOverride('TEST_FLAG', input);
    expect(mockService.setOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });

  it('should remove an override', async () => {
    const input = { attributes: { tenantId: 't-1' } };
    await controller.removeOverride('TEST_FLAG', input);
    expect(mockService.removeOverride).toHaveBeenCalledWith('TEST_FLAG', input);
  });
```

- [ ] **Step 8: Update existing Admin e2e override bodies**

In `test/e2e/admin.e2e-spec.ts`, replace existing override request bodies:

```typescript
.send({ userId: 'u-1', enabled: true })
```

with:

```typescript
.send({ attributes: { userId: 'u-1' }, enabled: true })
```

Replace remove bodies:

```typescript
.send({ userId: 'u-1' })
```

with:

```typescript
.send({ attributes: { userId: 'u-1' } })
```

Update response assertions from:

```typescript
expect(flagRes.body.overrides[0].userId).toBe('u-1');
```

to:

```typescript
expect(flagRes.body.overrides[0].attributes).toEqual({ userId: 'u-1' });
```

- [ ] **Step 9: Run Admin tests**

Run:

```bash
npx jest test/admin/feature-flag-admin.controller.spec.ts --no-coverage
npm run test:e2e -- --runTestsByPath test/e2e/admin.e2e-spec.ts
```

Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/admin/targeting-attributes.validator.ts src/admin/feature-flag-admin.dto.ts src/admin/feature-flag-admin.controller.ts test/admin/feature-flag-admin.controller.spec.ts test/e2e/admin.e2e-spec.ts
git commit -m "feat: validate admin API DTOs"
```

---

### Task 8: Package Dependencies, Exports, and Type Surface

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/index.ts`
- Test: build command

- [ ] **Step 1: Verify validation libraries are installed**

Run:

```bash
npm ls class-validator class-transformer
```

Expected: exit 0 with both packages present from Task 7.

- [ ] **Step 2: Add peer dependencies**

In `package.json`, add these entries under `peerDependencies`:

```json
"class-transformer": "^0.5.1",
"class-validator": "^0.14.0"
```

Add both to `peerDependenciesMeta` as optional if the core module should be installable without Admin API dependencies:

```json
"class-transformer": {
  "optional": true
},
"class-validator": {
  "optional": true
}
```

- [ ] **Step 3: Bump package version**

In `package.json`, change:

```json
"version": "0.2.0"
```

to:

```json
"version": "0.3.0"
```

- [ ] **Step 4: Export targeting types**

In `src/index.ts`, include targeting types in the feature flag interface export:

```typescript
export {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  RemoveOverrideInput,
  FeatureFlagGuardOptions,
  FeatureFlagWithOverrides,
  FlagOverride,
  TargetingAttributeValue,
  TargetingAttributes,
} from './interfaces/feature-flag.interface';
```

Include `UpdateOverrideInput` in the repository export:

```typescript
export type {
  FeatureFlagRepository,
  OverrideCriteria,
  UpdateOverrideInput,
} from './interfaces/feature-flag-repository.interface';
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/index.ts
git commit -m "chore: prepare package metadata for v0.3.0"
```

---

### Task 9: Update E2E and Testing Fixtures for Attribute Overrides

**Files:**
- Modify: `test/e2e/feature-flag.service.e2e-spec.ts`
- Modify: `test/testing/test-feature-flag.module.spec.ts`
- Modify: any remaining test file matched by `rg "tenantId|userId|environment" test src`
- Test: focused Jest and e2e commands

- [ ] **Step 1: Find remaining legacy override field usage**

Run:

```bash
rg -n "tenantId:|userId:|environment:" test src
```

Expected: results remain for `EvaluationContext` top-level fields, but no `FlagOverride` object should use `tenantId`, `userId`, or `environment` as direct override properties.

- [ ] **Step 2: Update e2e override creation calls**

In `test/e2e/feature-flag.service.e2e-spec.ts`, replace service calls like:

```typescript
await service.setOverride('BETA_FEATURE', {
  tenantId: 'tenant-1',
  enabled: true,
});
```

with:

```typescript
await service.setOverride('BETA_FEATURE', {
  attributes: { tenantId: 'tenant-1' },
  enabled: true,
});
```

For multi-attribute cases, use:

```typescript
await service.setOverride('BETA_FEATURE', {
  attributes: {
    tenantId: 'tenant-1',
    plan: 'pro',
  },
  enabled: true,
  priority: 10,
});
```

- [ ] **Step 3: Update flag fixtures**

Where tests build `FeatureFlagWithOverrides` objects, use this override shape:

```typescript
{
  id: 'override-1',
  flagId: 'flag-1',
  attributes: { tenantId: 'tenant-1' },
  priority: 0,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
```

- [ ] **Step 4: Run the legacy usage search again**

Run:

```bash
rg -n "tenantId: null|userId: null|environment: null|\\.tenantId|\\.userId|\\.environment" src test
```

Expected: no results for direct override fields. Results for `EvaluationContext` or `options.environment` are allowed only when they are not part of a `FlagOverride` object.

- [ ] **Step 5: Run focused test suites**

Run:

```bash
npx jest test/services/flag-evaluator.service.spec.ts test/services/feature-flag.service.spec.ts test/repositories/prisma-feature-flag.repository.spec.ts test/testing/test-feature-flag.module.spec.ts --no-coverage
npm run test:e2e -- --runTestsByPath test/e2e/feature-flag.service.e2e-spec.ts
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add test/e2e/feature-flag.service.e2e-spec.ts test/testing/test-feature-flag.module.spec.ts
git commit -m "test: update fixtures for attribute overrides"
```

---

### Task 10: Examples

**Files:**
- Create all files under `examples/basic-guard`
- Create all files under `examples/multi-tenant-targeting`
- Create all files under `examples/redis-events`
- Test: TypeScript build after examples are added if examples are included by tsconfig, otherwise repository build

- [ ] **Step 1: Create `examples/basic-guard/package.json`**

```json
{
  "name": "feature-flag-basic-guard-example",
  "private": true,
  "scripts": {
    "start": "nest start"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestarc/feature-flag": "file:../..",
    "@prisma/client": "^6.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `examples/basic-guard/src/prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 3: Create `examples/basic-guard/src/dashboard.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { FeatureFlag } from '@nestarc/feature-flag';

@Controller('dashboard')
export class DashboardController {
  @FeatureFlag('NEW_DASHBOARD')
  @Get()
  getDashboard() {
    return { message: 'New dashboard is enabled' };
  }
}
```

- [ ] **Step 4: Create `examples/basic-guard/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { DashboardController } from './dashboard.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'development',
        userIdExtractor: (req) => req.headers['x-user-id'] as string | undefined,
      }),
    }),
  ],
  controllers: [DashboardController],
  providers: [PrismaService],
})
export class AppModule {}
```

- [ ] **Step 5: Create `examples/basic-guard/README.md`**

````markdown
# Basic Guard Example

This example gates a controller route with `@FeatureFlag('NEW_DASHBOARD')`.

Seed one flag before calling `GET /dashboard`:

```ts
await prisma.featureFlag.create({
  data: {
    key: 'NEW_DASHBOARD',
    enabled: true,
    percentage: 0,
    metadata: {},
  },
});
```
````

- [ ] **Step 6: Create `examples/multi-tenant-targeting/package.json`**

```json
{
  "name": "feature-flag-multi-tenant-targeting-example",
  "private": true,
  "scripts": {
    "start": "nest start"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestarc/feature-flag": "file:../..",
    "@prisma/client": "^6.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 7: Create multi-tenant targeting source files**

Create `examples/multi-tenant-targeting/src/checkout.controller.ts`:

```typescript
import { Controller, Get, Headers } from '@nestjs/common';
import { FeatureFlagService } from '@nestarc/feature-flag';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Get()
  async getCheckout(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-user-id') userId: string,
    @Headers('x-country') country: string,
    @Headers('x-plan') plan: string,
  ) {
    const enabled = await this.flags.isEnabled('NEW_CHECKOUT', {
      userId,
      tenantId,
      attributes: {
        country,
        plan,
      },
    });

    return { version: enabled ? 'new' : 'classic' };
  }
}
```

Create `examples/multi-tenant-targeting/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { CheckoutController } from './checkout.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'development',
        userIdExtractor: (req) => req.headers['x-user-id'] as string | undefined,
      }),
    }),
  ],
  controllers: [CheckoutController],
  providers: [PrismaService],
})
export class AppModule {}
```

Run:

```bash
cp examples/basic-guard/src/prisma.service.ts examples/multi-tenant-targeting/src/prisma.service.ts
```

Create `examples/multi-tenant-targeting/README.md`:

````markdown
# Multi-Tenant Targeting Example

Create an override through the Admin API:

```http
POST /feature-flags/NEW_CHECKOUT/overrides
Content-Type: application/json

{
  "attributes": {
    "tenantId": "tenant-1",
    "plan": "pro",
    "country": "KR"
  },
  "enabled": true,
  "priority": 10
}
```

Evaluate with a hybrid context:

```ts
await flags.isEnabled('NEW_CHECKOUT', {
  userId: 'user-1',
  tenantId: 'tenant-1',
  attributes: {
    plan: 'pro',
    country: 'KR'
  }
});
```
````

- [ ] **Step 8: Create `examples/redis-events/package.json`**

```json
{
  "name": "feature-flag-redis-events-example",
  "private": true,
  "scripts": {
    "start": "nest start"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/event-emitter": "^3.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestarc/feature-flag": "file:../..",
    "@prisma/client": "^6.0.0",
    "ioredis": "^5.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 9: Create Redis events source files**

Create `examples/redis-events/src/flag-events.listener.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '@nestarc/feature-flag';

@Injectable()
export class FlagEventsListener {
  private readonly logger = new Logger(FlagEventsListener.name);

  @OnEvent(FeatureFlagEvents.EVALUATED)
  onEvaluated(event: FlagEvaluatedEvent): void {
    this.logger.log({
      flagKey: event.flagKey,
      result: event.result,
      source: event.source,
      evaluationTimeMs: event.evaluationTimeMs,
    });
  }
}
```

Create `examples/redis-events/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { FeatureFlagModule, RedisCacheAdapter } from '@nestarc/feature-flag';
import { Redis } from 'ioredis';
import { FlagEventsListener } from './flag-events.listener';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    FeatureFlagModule.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

        return {
          prisma,
          environment: process.env.NODE_ENV ?? 'production',
          emitEvents: true,
          cacheAdapter: new RedisCacheAdapter({ client: redis }),
        };
      },
    }),
  ],
  providers: [PrismaService, FlagEventsListener],
})
export class AppModule {}
```

Run:

```bash
cp examples/basic-guard/src/prisma.service.ts examples/redis-events/src/prisma.service.ts
```

Create `examples/redis-events/README.md`:

````markdown
# Redis Cache and Events Example

This example wires `RedisCacheAdapter` for multi-instance cache invalidation and subscribes to `FeatureFlagEvents.EVALUATED`.

Run Redis locally:

```bash
docker run --rm -p 6379:6379 redis:7
```

The app uses `REDIS_URL` when it is present and falls back to `redis://localhost:6379`.
````

- [ ] **Step 10: Run repository build**

Run:

```bash
npm run build
```

Expected: PASS. The root build does not compile examples unless tsconfig is expanded.

- [ ] **Step 11: Commit**

```bash
git add examples
git commit -m "docs: add feature flag examples"
```

---

### Task 11: README and Changelog

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: documentation grep checks and build

- [ ] **Step 1: Update README peer dependency section**

In `README.md`, update the peer dependency install command:

```bash
npm install @nestjs/common @nestjs/core @prisma/client rxjs reflect-metadata
```

Add an Admin API note:

```bash
# Required if you use FeatureFlagAdminModule
npm install class-validator class-transformer
```

- [ ] **Step 2: Update Admin API override examples**

Replace legacy override body examples with:

```typescript
await flags.setOverride('NEW_CHECKOUT', {
  attributes: {
    tenantId: 'tenant-1',
    plan: 'pro',
    country: 'KR',
  },
  enabled: true,
  priority: 10,
});
```

Document REST body:

```json
{
  "attributes": {
    "tenantId": "tenant-1",
    "plan": "pro",
    "country": "KR"
  },
  "enabled": true,
  "priority": 10
}
```

- [ ] **Step 3: Add attribute targeting section**

Add this section after programmatic evaluation:

````markdown
## Attribute Targeting

Overrides match against exact attributes. An override applies only when every key/value pair in `attributes` exists in the evaluation context.

```ts
await flags.isEnabled('NEW_CHECKOUT', {
  userId: 'user-1',
  tenantId: 'tenant-1',
  environment: 'production',
  attributes: {
    plan: 'pro',
    country: 'KR',
  },
});
```

Top-level `userId`, `tenantId`, and `environment` are merged into the targeting attributes and win over duplicate keys in `attributes`.

When multiple overrides match:

1. More attributes wins.
2. Higher `priority` wins.
3. Earlier `createdAt` wins.
4. Lower `id` wins.
````

- [ ] **Step 4: Add migration guide**

Add this section near Prisma schema documentation:

````markdown
## Migration from 0.2.0 to 0.3.0

v0.3.0 changes override storage from fixed columns to `attributes jsonb` plus `priority`.

Run Prisma migrations:

```bash
npx prisma migrate deploy
```

The migration copies non-null legacy columns into `attributes`:

- `tenant_id` becomes `attributes.tenantId`
- `user_id` becomes `attributes.userId`
- `environment` becomes `attributes.environment`

Rows where all three legacy columns were null are deleted because empty override attributes are not valid in v0.3.0.

Legacy Admin API bodies are rejected:

```json
{ "tenantId": "tenant-1", "enabled": true }
```

Use:

```json
{ "attributes": { "tenantId": "tenant-1" }, "enabled": true }
```
````

- [ ] **Step 5: Add examples links**

Add:

```markdown
## Examples

- [`examples/basic-guard`](examples/basic-guard) - route gating with `@FeatureFlag()`
- [`examples/multi-tenant-targeting`](examples/multi-tenant-targeting) - tenant and plan targeting with attributes
- [`examples/redis-events`](examples/redis-events) - Redis cache invalidation and feature flag events
```

- [ ] **Step 6: Add CHANGELOG 0.3.0 entry**

At the top of `CHANGELOG.md`, add:

```markdown
## [0.3.0] - 2026-05-12

### Added
- Attribute-based override targeting with exact-match `attributes`
- Override `priority` for tied specificity
- Admin API DTO validation with `class-validator` and `class-transformer`
- Automatic Prisma migration from fixed override columns to `attributes`
- Copyable examples for basic guards, multi-tenant targeting, and Redis events

### Changed
- `SetOverrideInput` and `RemoveOverrideInput` now use `attributes`
- `FlagOverride` now exposes `attributes` and `priority`
- Override evaluation now uses specificity, priority, `createdAt`, and `id`
- Evaluation event source now uses `override` for matched attribute overrides

### Breaking
- Removed direct override fields `tenantId`, `userId`, and `environment`
- Removed `FeatureFlagRepository.updateOverrideEnabled()`
- Legacy Admin API override bodies are rejected
- Prisma schema migration is required

### Migration
- Run `npx prisma migrate deploy`
- Replace `{ "tenantId": "t-1", "enabled": true }` with `{ "attributes": { "tenantId": "t-1" }, "enabled": true }`
```

- [ ] **Step 7: Run documentation checks**

Run:

```bash
rg -n "tenantId.*enabled|userId.*enabled|attributes|0.3.0|class-validator|examples/basic-guard" README.md CHANGELOG.md
npm run build
```

Expected: grep shows new docs and no remaining legacy Admin body examples. Build exits 0.

- [ ] **Step 8: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document v0.3.0 migration and targeting"
```

---

### Task 12: Final Verification

**Files:**
- No new files
- Test: all relevant commands

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm test
```

Expected: all Jest unit tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript build exits 0.

- [ ] **Step 3: Run e2e tests**

Run:

```bash
npm run test:e2e
```

Expected: all e2e tests pass against Docker PostgreSQL/Redis services.

- [ ] **Step 4: Run audit**

Run:

```bash
npm audit
```

Expected: no high or critical vulnerabilities introduced by the validation dependencies.

- [ ] **Step 5: Check legacy override fields are gone from storage and override fixtures**

Run:

```bash
rg -n "tenant_id|user_id|uq_override_|updateOverrideEnabled|tenantId: null|userId: null|environment: null" src prisma test
```

Expected: no results, except legacy names inside the new migration file where they are used to migrate old columns.

- [ ] **Step 6: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree.

- [ ] **Step 7: Commit any missed documentation or test-only adjustments**

If Step 6 is not clean, inspect the diff:

```bash
git diff
```

Stage only intentional files and commit with a narrow message:

```bash
git add README.md CHANGELOG.md test src prisma examples package.json package-lock.json
git commit -m "chore: finalize v0.3.0 implementation"
```
