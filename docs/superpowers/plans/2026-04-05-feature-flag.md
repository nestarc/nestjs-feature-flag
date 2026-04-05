# @nestarc/feature-flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DB-backed feature flag NestJS module with tenant-aware overrides, percentage rollouts, and zero external dependencies.

**Architecture:** NestJS DynamicModule with `forRoot`/`forRootAsync` registration. Prisma + PostgreSQL for storage, in-memory Map + TTL for caching, AsyncLocalStorage for request-scoped context propagation. Guard decorator for route-level gating, service API for programmatic evaluation. 5-layer override hierarchy: user → tenant → environment → percentage → global.

**Tech Stack:** NestJS 10/11, Prisma 5/6, TypeScript 5, Jest 29, ts-jest

**Spec:** `docs/2026-04-05-feature-flag-design.md`

---

## File Structure

```
src/
├── index.ts                                # barrel export (public API)
├── feature-flag.module.ts                  # DynamicModule (forRoot/forRootAsync)
├── feature-flag.constants.ts               # injection tokens, defaults
├── interfaces/
│   ├── feature-flag-options.interface.ts    # FeatureFlagModuleOptions, FeatureFlagModuleAsyncOptions
│   ├── feature-flag.interface.ts           # FeatureFlag, FeatureFlagWithOverrides, FlagOverride
│   └── evaluation-context.interface.ts     # EvaluationContext
├── services/
│   ├── feature-flag.service.ts             # public API: isEnabled(), create(), update(), etc.
│   ├── flag-cache.service.ts               # in-memory Map + TTL cache
│   ├── flag-evaluator.service.ts           # evaluation logic (hierarchy, percentage hash)
│   └── flag-context.ts                     # AsyncLocalStorage for userId context
├── guards/
│   └── feature-flag.guard.ts               # CanActivate implementation
├── middleware/
│   └── flag-context.middleware.ts           # extract userId from request → context
├── decorators/
│   ├── feature-flag.decorator.ts           # @FeatureFlag('KEY', opts?)
│   └── bypass-feature-flag.decorator.ts    # @BypassFeatureFlag()
├── utils/
│   └── hash.ts                             # MurmurHash3 32-bit
├── testing/
│   ├── test-feature-flag.module.ts         # lightweight test module
│   └── index.ts                            # testing barrel export
└── events/
    └── feature-flag.events.ts              # event names + payload interfaces

test/
├── utils/
│   └── hash.spec.ts
├── services/
│   ├── flag-cache.service.spec.ts
│   ├── flag-evaluator.service.spec.ts
│   ├── flag-context.spec.ts
│   └── feature-flag.service.spec.ts
├── guards/
│   └── feature-flag.guard.spec.ts
├── middleware/
│   └── flag-context.middleware.spec.ts
├── decorators/
│   ├── feature-flag.decorator.spec.ts
│   └── bypass-feature-flag.decorator.spec.ts
├── feature-flag.module.spec.ts
└── testing/
    └── test-feature-flag.module.spec.ts

prisma/
└── schema.prisma                           # FeatureFlag + FeatureFlagOverride models
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `jest.config.ts`
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/ksy/Documents/GitHub/feature-flag
npm init -y
```

Then replace the generated `package.json` with:

```json
{
  "name": "@nestarc/feature-flag",
  "version": "0.1.0",
  "description": "DB-backed feature flags for NestJS + Prisma + PostgreSQL with tenant-aware overrides",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/index.d.ts",
      "default": "./dist/testing/index.js"
    }
  },
  "files": [
    "dist",
    "prisma"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "jest",
    "test:cov": "jest --coverage",
    "lint": "eslint 'src/**/*.ts' 'test/**/*.ts'",
    "format": "prettier --write 'src/**/*.ts' 'test/**/*.ts'",
    "prisma:generate": "prisma generate"
  },
  "keywords": [
    "nestjs",
    "feature-flag",
    "feature-toggle",
    "prisma",
    "postgresql",
    "multi-tenant"
  ],
  "author": "nestarc",
  "license": "MIT",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@nestarc/tenancy": {
      "optional": true
    },
    "@nestjs/event-emitter": {
      "optional": true
    }
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/event-emitter": "^3.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.0",
    "eslint": "^9.0.0",
    "jest": "^29.7.0",
    "prettier": "^3.0.0",
    "prisma": "^6.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "lib": ["ES2021"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": "./",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

- [ ] **Step 4: Create jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/index.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
```

- [ ] **Step 5: Create eslint.config.mjs**

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
);
```

- [ ] **Step 6: Create .prettierrc**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true,
  "tabWidth": 2
}
```

- [ ] **Step 7: Create Prisma schema**

File: `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model FeatureFlag {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key         String    @unique
  description String?
  enabled     Boolean   @default(false)
  percentage  Int       @default(0)
  metadata    Json      @default("{}")
  archivedAt  DateTime? @map("archived_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  overrides FeatureFlagOverride[]

  @@map("feature_flags")
}

model FeatureFlagOverride {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  flagId      String   @map("flag_id") @db.Uuid
  tenantId    String?  @map("tenant_id")
  userId      String?  @map("user_id")
  environment String?
  enabled     Boolean
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  flag FeatureFlag @relation(fields: [flagId], references: [id], onDelete: Cascade)

  @@unique([flagId, tenantId, userId, environment], map: "uq_override_context")
  @@map("feature_flag_overrides")
}
```

- [ ] **Step 8: Install dependencies**

```bash
npm install
npx prisma generate
```

- [ ] **Step 9: Verify build and test setup**

Create a placeholder to test the toolchain:

File: `src/index.ts`
```typescript
export const VERSION = '0.1.0';
```

File: `test/index.spec.ts`
```typescript
import { VERSION } from '../src';

describe('package', () => {
  it('should export version', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
```

```bash
npm run build
npm test
```

Expected: Build succeeds, 1 test passes.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json jest.config.ts eslint.config.mjs .prettierrc prisma/ src/index.ts test/index.spec.ts
git commit -m "chore: scaffold project with NestJS, Prisma, Jest, ESLint"
```

---

## Task 2: Constants & Interfaces

**Files:**
- Create: `src/feature-flag.constants.ts`
- Create: `src/interfaces/feature-flag-options.interface.ts`
- Create: `src/interfaces/evaluation-context.interface.ts`
- Create: `src/interfaces/feature-flag.interface.ts`
- Create: `src/events/feature-flag.events.ts`

These are pure type definitions — no runtime logic to TDD. Write them, verify build passes.

- [ ] **Step 1: Create constants**

File: `src/feature-flag.constants.ts`

```typescript
export const FEATURE_FLAG_MODULE_OPTIONS = Symbol('FEATURE_FLAG_MODULE_OPTIONS');

export const DEFAULT_CACHE_TTL_MS = 30_000;

export const FEATURE_FLAG_KEY = 'FEATURE_FLAG_KEY';
export const FEATURE_FLAG_OPTIONS_KEY = 'FEATURE_FLAG_OPTIONS_KEY';
export const BYPASS_FEATURE_FLAG_KEY = 'BYPASS_FEATURE_FLAG_KEY';
```

- [ ] **Step 2: Create module options interface**

File: `src/interfaces/feature-flag-options.interface.ts`

```typescript
import { ModuleMetadata, Type } from '@nestjs/common';
import { Request } from 'express';

export interface FeatureFlagModuleOptions {
  /** Current environment (e.g., 'development', 'staging', 'production') */
  environment: string;

  /** Cache TTL in milliseconds. 0 disables caching. Default: 30000 */
  cacheTtlMs?: number;

  /** Extract user ID from request. Returns null if user is not authenticated. */
  userIdExtractor?: (req: Request) => string | null;

  /** Default value when evaluating a non-existent flag. Default: false */
  defaultOnMissing?: boolean;

  /** Emit evaluation events via @nestjs/event-emitter. Default: false */
  emitEvents?: boolean;
}

export interface FeatureFlagModuleOptionsFactory {
  createFeatureFlagOptions(): Promise<FeatureFlagModuleOptions> | FeatureFlagModuleOptions;
}

export interface FeatureFlagModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<FeatureFlagModuleOptions> | FeatureFlagModuleOptions;
  useClass?: Type<FeatureFlagModuleOptionsFactory>;
  useExisting?: Type<FeatureFlagModuleOptionsFactory>;
}
```

- [ ] **Step 3: Create evaluation context interface**

File: `src/interfaces/evaluation-context.interface.ts`

```typescript
export interface EvaluationContext {
  /** User ID — used for user overrides and percentage hash */
  userId?: string | null;

  /** Tenant ID — used for tenant overrides. Ignored if tenancy is not installed */
  tenantId?: string | null;

  /** Environment — auto-injected from module options. Can be explicitly overridden */
  environment?: string;
}
```

- [ ] **Step 4: Create feature flag data interfaces**

File: `src/interfaces/feature-flag.interface.ts`

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

export interface SetOverrideInput {
  tenantId?: string;
  userId?: string;
  environment?: string;
  enabled: boolean;
}

export interface FeatureFlagGuardOptions {
  /** HTTP status code when flag is OFF. Default: 403 */
  statusCode?: number;

  /** Response body when flag is OFF */
  fallback?: Record<string, unknown>;
}

export interface FeatureFlagWithOverrides {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  percentage: number;
  metadata: Record<string, unknown>;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  overrides: FlagOverride[];
}

export interface FlagOverride {
  id: string;
  flagId: string;
  tenantId: string | null;
  userId: string | null;
  environment: string | null;
  enabled: boolean;
}
```

- [ ] **Step 5: Create event definitions**

File: `src/events/feature-flag.events.ts`

```typescript
import { EvaluationContext } from '../interfaces/evaluation-context.interface';

export const FeatureFlagEvents = {
  EVALUATED: 'feature-flag.evaluated',
  CREATED: 'feature-flag.created',
  UPDATED: 'feature-flag.updated',
  ARCHIVED: 'feature-flag.archived',
  OVERRIDE_SET: 'feature-flag.override.set',
  OVERRIDE_REMOVED: 'feature-flag.override.removed',
  CACHE_INVALIDATED: 'feature-flag.cache.invalidated',
} as const;

export interface FlagEvaluatedEvent {
  flagKey: string;
  result: boolean;
  context: EvaluationContext;
  source: 'user_override' | 'tenant_override' | 'env_override' | 'percentage' | 'global';
  evaluationTimeMs: number;
}

export interface FlagMutationEvent {
  flagKey: string;
  action: 'created' | 'updated' | 'archived';
}

export interface FlagOverrideEvent {
  flagKey: string;
  tenantId?: string | null;
  userId?: string | null;
  environment?: string | null;
  enabled: boolean;
  action: 'set' | 'removed';
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/feature-flag.constants.ts src/interfaces/ src/events/
git commit -m "feat: add constants, interfaces, and event definitions"
```

---

## Task 3: MurmurHash3 Utility

**Files:**
- Create: `src/utils/hash.ts`
- Create: `test/utils/hash.spec.ts`

- [ ] **Step 1: Write failing tests for murmurhash3**

File: `test/utils/hash.spec.ts`

```typescript
import { murmurhash3 } from '../../src/utils/hash';

describe('murmurhash3', () => {
  it('should return a non-negative 32-bit integer', () => {
    const result = murmurhash3('test-key');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('should be deterministic — same input always produces same output', () => {
    const a = murmurhash3('MY_FLAG:user-123');
    const b = murmurhash3('MY_FLAG:user-123');
    expect(a).toBe(b);
  });

  it('should produce different outputs for different inputs', () => {
    const a = murmurhash3('FLAG_A:user-1');
    const b = murmurhash3('FLAG_B:user-1');
    expect(a).not.toBe(b);
  });

  it('should support custom seed', () => {
    const a = murmurhash3('test', 0);
    const b = murmurhash3('test', 42);
    expect(a).not.toBe(b);
  });

  it('should distribute buckets uniformly across 0-99', () => {
    const buckets = new Array(100).fill(0);
    const iterations = 10_000;

    for (let i = 0; i < iterations; i++) {
      const bucket = murmurhash3(`FLAG_KEY:user-${i}`) % 100;
      buckets[bucket]++;
    }

    const expected = iterations / 100; // 100
    const tolerance = expected * 0.3; // ±30% per bucket

    for (let i = 0; i < 100; i++) {
      expect(buckets[i]).toBeGreaterThan(expected - tolerance);
      expect(buckets[i]).toBeLessThan(expected + tolerance);
    }
  });

  it('should handle empty string', () => {
    const result = murmurhash3('');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/utils/hash.spec.ts --no-coverage
```

Expected: FAIL — `murmurhash3` not found.

- [ ] **Step 3: Implement murmurhash3**

File: `src/utils/hash.ts`

```typescript
/**
 * MurmurHash3 32-bit implementation.
 * Deterministic hash for percentage rollout bucket assignment.
 * Same (flagKey + userId) always maps to the same bucket.
 */
export function murmurhash3(key: string, seed: number = 0): number {
  let h = seed;

  for (let i = 0; i < key.length; i++) {
    let k = key.charCodeAt(i);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  }

  h ^= key.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/utils/hash.spec.ts --no-coverage
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hash.ts test/utils/hash.spec.ts
git commit -m "feat: add MurmurHash3 utility for percentage rollout"
```

---

## Task 4: FlagContext (AsyncLocalStorage)

**Files:**
- Create: `src/services/flag-context.ts`
- Create: `test/services/flag-context.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/services/flag-context.spec.ts`

```typescript
import { FlagContext } from '../../src/services/flag-context';

describe('FlagContext', () => {
  let context: FlagContext;

  beforeEach(() => {
    context = new FlagContext();
  });

  it('should return null userId outside of a run context', () => {
    expect(context.getUserId()).toBeNull();
  });

  it('should return userId within a run context', () => {
    context.run({ userId: 'user-123' }, () => {
      expect(context.getUserId()).toBe('user-123');
    });
  });

  it('should return null userId when store has null userId', () => {
    context.run({ userId: null }, () => {
      expect(context.getUserId()).toBeNull();
    });
  });

  it('should isolate contexts between nested runs', () => {
    context.run({ userId: 'outer' }, () => {
      expect(context.getUserId()).toBe('outer');

      context.run({ userId: 'inner' }, () => {
        expect(context.getUserId()).toBe('inner');
      });

      expect(context.getUserId()).toBe('outer');
    });
  });

  it('should return the callback return value', () => {
    const result = context.run({ userId: 'test' }, () => 42);
    expect(result).toBe(42);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/flag-context.spec.ts --no-coverage
```

Expected: FAIL — `FlagContext` not found.

- [ ] **Step 3: Implement FlagContext**

File: `src/services/flag-context.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface FlagStore {
  userId: string | null;
}

@Injectable()
export class FlagContext {
  private static readonly storage = new AsyncLocalStorage<FlagStore>();

  run<T>(store: FlagStore, callback: () => T): T {
    return FlagContext.storage.run(store, callback);
  }

  getUserId(): string | null {
    return FlagContext.storage.getStore()?.userId ?? null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/flag-context.spec.ts --no-coverage
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/flag-context.ts test/services/flag-context.spec.ts
git commit -m "feat: add FlagContext (AsyncLocalStorage) for request-scoped userId"
```

---

## Task 5: FlagCacheService

**Files:**
- Create: `src/services/flag-cache.service.ts`
- Create: `test/services/flag-cache.service.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/services/flag-cache.service.spec.ts`

```typescript
import { FlagCacheService } from '../../src/services/flag-cache.service';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../../src/feature-flag.constants';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';

function makeFlagData(key: string): FeatureFlagWithOverrides {
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

describe('FlagCacheService', () => {
  let cache: FlagCacheService;

  beforeEach(() => {
    cache = new FlagCacheService({ cacheTtlMs: 5000, environment: 'test' });
  });

  it('should return null for a cache miss', () => {
    expect(cache.get('UNKNOWN')).toBeNull();
  });

  it('should store and retrieve a flag', () => {
    const flag = makeFlagData('MY_FLAG');
    cache.set('MY_FLAG', flag);
    expect(cache.get('MY_FLAG')).toEqual(flag);
  });

  it('should return null after TTL expires', () => {
    jest.useFakeTimers();

    const flag = makeFlagData('MY_FLAG');
    cache.set('MY_FLAG', flag);
    expect(cache.get('MY_FLAG')).toEqual(flag);

    jest.advanceTimersByTime(5001);
    expect(cache.get('MY_FLAG')).toBeNull();

    jest.useRealTimers();
  });

  it('should not cache when cacheTtlMs is 0', () => {
    const noCache = new FlagCacheService({ cacheTtlMs: 0, environment: 'test' });
    noCache.set('MY_FLAG', makeFlagData('MY_FLAG'));
    expect(noCache.get('MY_FLAG')).toBeNull();
  });

  it('should invalidate a specific key', () => {
    cache.set('A', makeFlagData('A'));
    cache.set('B', makeFlagData('B'));
    cache.invalidate('A');
    expect(cache.get('A')).toBeNull();
    expect(cache.get('B')).not.toBeNull();
  });

  it('should invalidate all keys when no key is provided', () => {
    cache.set('A', makeFlagData('A'));
    cache.set('B', makeFlagData('B'));
    cache.invalidate();
    expect(cache.get('A')).toBeNull();
    expect(cache.get('B')).toBeNull();
  });

  it('should store and retrieve all-flags cache', () => {
    const flags = [makeFlagData('A'), makeFlagData('B')];
    cache.setAll(flags);
    expect(cache.getAll()).toEqual(flags);
  });

  it('should return null for all-flags cache miss', () => {
    expect(cache.getAll()).toBeNull();
  });

  it('should clear all-flags cache on invalidate()', () => {
    cache.setAll([makeFlagData('A')]);
    cache.invalidate();
    expect(cache.getAll()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/flag-cache.service.spec.ts --no-coverage
```

Expected: FAIL — `FlagCacheService` not found.

- [ ] **Step 3: Implement FlagCacheService**

File: `src/services/flag-cache.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

@Injectable()
export class FlagCacheService {
  private cache = new Map<string, CacheEntry<FeatureFlagWithOverrides>>();
  private allFlagsCache: CacheEntry<FeatureFlagWithOverrides[]> | null = null;

  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
  ) {}

  get(key: string): FeatureFlagWithOverrides | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: FeatureFlagWithOverrides): void {
    const ttl = this.options.cacheTtlMs ?? 30_000;
    if (ttl === 0) return;
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  getAll(): FeatureFlagWithOverrides[] | null {
    if (!this.allFlagsCache) return null;
    if (Date.now() > this.allFlagsCache.expiresAt) {
      this.allFlagsCache = null;
      return null;
    }
    return this.allFlagsCache.data;
  }

  setAll(data: FeatureFlagWithOverrides[]): void {
    const ttl = this.options.cacheTtlMs ?? 30_000;
    if (ttl === 0) return;
    this.allFlagsCache = { data, expiresAt: Date.now() + ttl };
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
      this.allFlagsCache = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/flag-cache.service.spec.ts --no-coverage
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/flag-cache.service.ts test/services/flag-cache.service.spec.ts
git commit -m "feat: add FlagCacheService with TTL-based in-memory cache"
```

---

## Task 6: FlagEvaluatorService

**Files:**
- Create: `src/services/flag-evaluator.service.ts`
- Create: `test/services/flag-evaluator.service.spec.ts`

This is the core evaluation logic — the 5-layer override hierarchy. Needs thorough testing.

- [ ] **Step 1: Write failing tests**

File: `test/services/flag-evaluator.service.spec.ts`

```typescript
import { FlagEvaluatorService } from '../../src/services/flag-evaluator.service';
import { FeatureFlagWithOverrides, FlagOverride } from '../../src/interfaces/feature-flag.interface';
import { EvaluationContext } from '../../src/interfaces/evaluation-context.interface';

function makeFlag(partial: Partial<FeatureFlagWithOverrides> = {}): FeatureFlagWithOverrides {
  return {
    id: 'flag-1',
    key: 'TEST_FLAG',
    description: null,
    enabled: false,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
    ...partial,
  };
}

function makeOverride(partial: Partial<FlagOverride> = {}): FlagOverride {
  return {
    id: 'override-1',
    flagId: 'flag-1',
    tenantId: null,
    userId: null,
    environment: null,
    enabled: true,
    ...partial,
  };
}

describe('FlagEvaluatorService', () => {
  let evaluator: FlagEvaluatorService;

  beforeEach(() => {
    evaluator = new FlagEvaluatorService();
  });

  describe('archived flags', () => {
    it('should return false for archived flags', () => {
      const flag = makeFlag({ archivedAt: new Date() });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.result).toBe(false);
      expect(result.source).toBe('global');
    });
  });

  describe('user overrides', () => {
    it('should use user override when it matches userId', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('user_override');
    });

    it('should not use user override for different userId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-2' });
      expect(result.result).toBe(false);
    });

    it('should skip user override when context has no userId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ userId: 'user-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, {});
      expect(result.result).toBe(false);
    });
  });

  describe('tenant overrides', () => {
    it('should use tenant override when it matches tenantId', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ tenantId: 'tenant-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { tenantId: 'tenant-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('tenant_override');
    });

    it('should not use tenant override for different tenantId', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ tenantId: 'tenant-1', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { tenantId: 'tenant-2' });
      expect(result.result).toBe(false);
    });
  });

  describe('environment overrides', () => {
    it('should use environment override when it matches', () => {
      const flag = makeFlag({
        overrides: [makeOverride({ environment: 'staging', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { environment: 'staging' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('env_override');
    });

    it('should not use environment override for different env', () => {
      const flag = makeFlag({
        enabled: false,
        overrides: [makeOverride({ environment: 'staging', enabled: true })],
      });
      const result = evaluator.evaluate(flag, { environment: 'production' });
      expect(result.result).toBe(false);
    });
  });

  describe('override priority', () => {
    it('should prioritize user override over tenant override', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({ tenantId: 'tenant-1', enabled: false }),
          makeOverride({ userId: 'user-1', enabled: true }),
        ],
      });
      const result = evaluator.evaluate(flag, { userId: 'user-1', tenantId: 'tenant-1' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('user_override');
    });

    it('should prioritize tenant override over environment override', () => {
      const flag = makeFlag({
        overrides: [
          makeOverride({ environment: 'staging', enabled: false }),
          makeOverride({ tenantId: 'tenant-1', enabled: true }),
        ],
      });
      const result = evaluator.evaluate(flag, {
        tenantId: 'tenant-1',
        environment: 'staging',
      });
      expect(result.result).toBe(true);
      expect(result.source).toBe('tenant_override');
    });
  });

  describe('percentage rollout', () => {
    it('should use percentage rollout when no override matches', () => {
      const flag = makeFlag({ percentage: 50 });
      const result = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(result.source).toBe('percentage');
      expect(typeof result.result).toBe('boolean');
    });

    it('should be deterministic for same userId + flagKey', () => {
      const flag = makeFlag({ percentage: 50 });
      const r1 = evaluator.evaluate(flag, { userId: 'user-1' });
      const r2 = evaluator.evaluate(flag, { userId: 'user-1' });
      expect(r1.result).toBe(r2.result);
    });

    it('should fall back to global default when no identifier for percentage', () => {
      const flag = makeFlag({ percentage: 50, enabled: true });
      const result = evaluator.evaluate(flag, {});
      expect(result.result).toBe(true);
      expect(result.source).toBe('global');
    });

    it('should return true for 100% rollout', () => {
      const flag = makeFlag({ percentage: 100 });
      const result = evaluator.evaluate(flag, { userId: 'anyone' });
      expect(result.result).toBe(true);
      expect(result.source).toBe('percentage');
    });

    it('should distribute roughly according to percentage', () => {
      const flag = makeFlag({ key: 'ROLLOUT_FLAG', percentage: 30 });
      let enabledCount = 0;
      const total = 10_000;

      for (let i = 0; i < total; i++) {
        const result = evaluator.evaluate(flag, { userId: `user-${i}` });
        if (result.result) enabledCount++;
      }

      const actualPercentage = (enabledCount / total) * 100;
      expect(actualPercentage).toBeGreaterThan(25);
      expect(actualPercentage).toBeLessThan(35);
    });
  });

  describe('global default', () => {
    it('should return flag.enabled when no overrides and no percentage', () => {
      const flagOn = makeFlag({ enabled: true });
      expect(evaluator.evaluate(flagOn, {}).result).toBe(true);

      const flagOff = makeFlag({ enabled: false });
      expect(evaluator.evaluate(flagOff, {}).result).toBe(false);
    });

    it('should report source as global', () => {
      const flag = makeFlag({ enabled: true });
      expect(evaluator.evaluate(flag, {}).source).toBe('global');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/flag-evaluator.service.spec.ts --no-coverage
```

Expected: FAIL — `FlagEvaluatorService` not found.

- [ ] **Step 3: Implement FlagEvaluatorService**

File: `src/services/flag-evaluator.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { FeatureFlagWithOverrides } from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { murmurhash3 } from '../utils/hash';
import { FlagEvaluatedEvent } from '../events/feature-flag.events';

type EvaluationSource = FlagEvaluatedEvent['source'];

export interface EvaluationResult {
  result: boolean;
  source: EvaluationSource;
}

@Injectable()
export class FlagEvaluatorService {
  evaluate(flag: FeatureFlagWithOverrides, context: EvaluationContext): EvaluationResult {
    // 1. Archived → always false
    if (flag.archivedAt) {
      return { result: false, source: 'global' };
    }

    // 2. User override (most specific)
    if (context.userId) {
      const userOverride = flag.overrides.find(
        (o) =>
          o.userId === context.userId &&
          (o.tenantId === null || o.tenantId === context.tenantId) &&
          (o.environment === null || o.environment === context.environment),
      );
      if (userOverride) {
        return { result: userOverride.enabled, source: 'user_override' };
      }
    }

    // 3. Tenant override
    if (context.tenantId) {
      const tenantOverride = flag.overrides.find(
        (o) =>
          o.tenantId === context.tenantId &&
          o.userId === null &&
          (o.environment === null || o.environment === context.environment),
      );
      if (tenantOverride) {
        return { result: tenantOverride.enabled, source: 'tenant_override' };
      }
    }

    // 4. Environment override
    if (context.environment) {
      const envOverride = flag.overrides.find(
        (o) => o.environment === context.environment && o.tenantId === null && o.userId === null,
      );
      if (envOverride) {
        return { result: envOverride.enabled, source: 'env_override' };
      }
    }

    // 5. Percentage rollout
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

    // 6. Global default
    return { result: flag.enabled, source: 'global' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/flag-evaluator.service.spec.ts --no-coverage
```

Expected: All 16 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/flag-evaluator.service.ts test/services/flag-evaluator.service.spec.ts
git commit -m "feat: add FlagEvaluatorService with 5-layer override hierarchy"
```

---

## Task 7: Decorators

**Files:**
- Create: `src/decorators/feature-flag.decorator.ts`
- Create: `src/decorators/bypass-feature-flag.decorator.ts`
- Create: `test/decorators/feature-flag.decorator.spec.ts`
- Create: `test/decorators/bypass-feature-flag.decorator.spec.ts`

- [ ] **Step 1: Write failing tests for @FeatureFlag**

File: `test/decorators/feature-flag.decorator.spec.ts`

```typescript
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY } from '../../src/feature-flag.constants';
import { FeatureFlag } from '../../src/decorators/feature-flag.decorator';

describe('@FeatureFlag', () => {
  it('should set flag key metadata on a method', () => {
    class TestController {
      @FeatureFlag('MY_FLAG')
      handler() {}
    }

    const key = Reflect.getMetadata(FEATURE_FLAG_KEY, TestController.prototype.handler);
    expect(key).toBe('MY_FLAG');
  });

  it('should set flag options metadata on a method', () => {
    class TestController {
      @FeatureFlag('MY_FLAG', { statusCode: 402, fallback: { msg: 'upgrade' } })
      handler() {}
    }

    const options = Reflect.getMetadata(FEATURE_FLAG_OPTIONS_KEY, TestController.prototype.handler);
    expect(options).toEqual({ statusCode: 402, fallback: { msg: 'upgrade' } });
  });

  it('should set flag key metadata on a class', () => {
    @FeatureFlag('MODULE_FLAG')
    class TestController {}

    const key = Reflect.getMetadata(FEATURE_FLAG_KEY, TestController);
    expect(key).toBe('MODULE_FLAG');
  });

  it('should default options to empty object', () => {
    class TestController {
      @FeatureFlag('MY_FLAG')
      handler() {}
    }

    const options = Reflect.getMetadata(FEATURE_FLAG_OPTIONS_KEY, TestController.prototype.handler);
    expect(options).toEqual({});
  });
});
```

- [ ] **Step 2: Write failing tests for @BypassFeatureFlag**

File: `test/decorators/bypass-feature-flag.decorator.spec.ts`

```typescript
import { BYPASS_FEATURE_FLAG_KEY } from '../../src/feature-flag.constants';
import { BypassFeatureFlag } from '../../src/decorators/bypass-feature-flag.decorator';

describe('@BypassFeatureFlag', () => {
  it('should set bypass metadata to true on a method', () => {
    class TestController {
      @BypassFeatureFlag()
      handler() {}
    }

    const bypass = Reflect.getMetadata(BYPASS_FEATURE_FLAG_KEY, TestController.prototype.handler);
    expect(bypass).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest test/decorators/ --no-coverage
```

Expected: FAIL — decorators not found.

- [ ] **Step 4: Implement @FeatureFlag decorator**

File: `src/decorators/feature-flag.decorator.ts`

```typescript
import { SetMetadata, applyDecorators } from '@nestjs/common';
import { FEATURE_FLAG_KEY, FEATURE_FLAG_OPTIONS_KEY } from '../feature-flag.constants';
import { FeatureFlagGuardOptions } from '../interfaces/feature-flag.interface';

export function FeatureFlag(
  flagKey: string,
  options: FeatureFlagGuardOptions = {},
): ClassDecorator & MethodDecorator {
  return applyDecorators(
    SetMetadata(FEATURE_FLAG_KEY, flagKey),
    SetMetadata(FEATURE_FLAG_OPTIONS_KEY, options),
  );
}
```

- [ ] **Step 5: Implement @BypassFeatureFlag decorator**

File: `src/decorators/bypass-feature-flag.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
import { BYPASS_FEATURE_FLAG_KEY } from '../feature-flag.constants';

export const BypassFeatureFlag = () => SetMetadata(BYPASS_FEATURE_FLAG_KEY, true);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx jest test/decorators/ --no-coverage
```

Expected: All 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/decorators/ test/decorators/
git commit -m "feat: add @FeatureFlag and @BypassFeatureFlag decorators"
```

---

## Task 8: FlagContextMiddleware

**Files:**
- Create: `src/middleware/flag-context.middleware.ts`
- Create: `test/middleware/flag-context.middleware.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/middleware/flag-context.middleware.spec.ts`

```typescript
import { FlagContextMiddleware } from '../../src/middleware/flag-context.middleware';
import { FlagContext } from '../../src/services/flag-context';

describe('FlagContextMiddleware', () => {
  let middleware: FlagContextMiddleware;
  let flagContext: FlagContext;

  beforeEach(() => {
    flagContext = new FlagContext();
  });

  it('should extract userId using userIdExtractor and set it in context', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
      userIdExtractor: (req: any) => req.user?.id ?? null,
    });

    const req = { user: { id: 'user-123' } } as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBe('user-123');
      done();
    });
  });

  it('should set null userId when userIdExtractor is not provided', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
    });

    const req = {} as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBeNull();
      done();
    });
  });

  it('should set null userId when extractor returns null', (done) => {
    middleware = new FlagContextMiddleware(flagContext, {
      environment: 'test',
      userIdExtractor: () => null,
    });

    const req = {} as any;
    const res = {} as any;

    middleware.use(req, res, () => {
      expect(flagContext.getUserId()).toBeNull();
      done();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/middleware/flag-context.middleware.spec.ts --no-coverage
```

Expected: FAIL — `FlagContextMiddleware` not found.

- [ ] **Step 3: Implement FlagContextMiddleware**

File: `src/middleware/flag-context.middleware.ts`

```typescript
import { Injectable, Inject, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FlagContext } from '../services/flag-context';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';

@Injectable()
export class FlagContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: FlagContext,
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const userId = this.options.userIdExtractor?.(req) ?? null;
    this.context.run({ userId }, () => next());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/middleware/flag-context.middleware.spec.ts --no-coverage
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/ test/middleware/
git commit -m "feat: add FlagContextMiddleware for userId extraction"
```

---

## Task 9: FeatureFlagService

**Files:**
- Create: `src/services/feature-flag.service.ts`
- Create: `test/services/feature-flag.service.spec.ts`

This is the main public API. It coordinates cache, evaluator, Prisma, tenancy integration, and events.

- [ ] **Step 1: Write failing tests**

File: `test/services/feature-flag.service.spec.ts`

```typescript
import { FeatureFlagService } from '../../src/services/feature-flag.service';
import { FlagCacheService } from '../../src/services/flag-cache.service';
import { FlagEvaluatorService } from '../../src/services/flag-evaluator.service';
import { FlagContext } from '../../src/services/flag-context';
import { FeatureFlagModuleOptions } from '../../src/interfaces/feature-flag-options.interface';
import { FeatureFlagWithOverrides } from '../../src/interfaces/feature-flag.interface';

function makeFlagRecord(key: string, overrides: Partial<FeatureFlagWithOverrides> = {}): FeatureFlagWithOverrides {
  return {
    id: 'uuid-1',
    key,
    description: null,
    enabled: false,
    percentage: 0,
    metadata: {},
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    overrides: [],
    ...overrides,
  };
}

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let cache: FlagCacheService;
  let evaluator: FlagEvaluatorService;
  let context: FlagContext;
  let mockPrisma: any;
  let mockModuleRef: any;
  let mockEventEmitter: any;
  let options: FeatureFlagModuleOptions;

  beforeEach(() => {
    options = { environment: 'test', cacheTtlMs: 5000 };
    cache = new FlagCacheService(options);
    evaluator = new FlagEvaluatorService();
    context = new FlagContext();

    mockPrisma = {
      featureFlag: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      featureFlagOverride: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockModuleRef = {
      get: jest.fn().mockReturnValue(undefined),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    service = new FeatureFlagService(
      options,
      mockPrisma,
      cache,
      evaluator,
      context,
      mockModuleRef,
      mockEventEmitter,
    );
  });

  describe('isEnabled', () => {
    it('should return defaultOnMissing when flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      const result = await service.isEnabled('UNKNOWN');
      expect(result).toBe(false);
    });

    it('should return defaultOnMissing=true when configured', async () => {
      const serviceWithDefault = new FeatureFlagService(
        { ...options, defaultOnMissing: true },
        mockPrisma,
        cache,
        evaluator,
        context,
        mockModuleRef,
        mockEventEmitter,
      );
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      const result = await serviceWithDefault.isEnabled('UNKNOWN');
      expect(result).toBe(true);
    });

    it('should evaluate flag from DB when cache misses', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'MY_FLAG' },
        include: { overrides: true },
      });
    });

    it('should use cached flag on cache hit', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      cache.set('MY_FLAG', flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).not.toHaveBeenCalled();
    });

    it('should use explicit context when provided', async () => {
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: 'user-1', environment: null, enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG', { userId: 'user-1' });
      expect(result).toBe(true);
    });

    it('should inject environment from module options', async () => {
      const flag = makeFlagRecord('MY_FLAG', {
        overrides: [{
          id: 'o1', flagId: 'uuid-1', tenantId: null,
          userId: null, environment: 'test', enabled: true,
        }],
      });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      const result = await service.isEnabled('MY_FLAG');
      expect(result).toBe(true);
    });
  });

  describe('evaluateAll', () => {
    it('should return a map of all active flags', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        makeFlagRecord('FLAG_A', { enabled: true }),
        makeFlagRecord('FLAG_B', { enabled: false }),
      ]);

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true, FLAG_B: false });
    });

    it('should use allFlags cache when available', async () => {
      const flags = [
        makeFlagRecord('FLAG_A', { enabled: true }),
      ];
      cache.setAll(flags);

      const result = await service.evaluateAll();
      expect(result).toEqual({ FLAG_A: true });
      expect(mockPrisma.featureFlag.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a flag and invalidate cache', async () => {
      const created = makeFlagRecord('NEW_FLAG', { enabled: true });
      mockPrisma.featureFlag.create.mockResolvedValue(created);

      const result = await service.create({
        key: 'NEW_FLAG',
        enabled: true,
      });

      expect(result.key).toBe('NEW_FLAG');
      expect(mockPrisma.featureFlag.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a flag and invalidate cache', async () => {
      const updated = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.update.mockResolvedValue(updated);

      const result = await service.update('MY_FLAG', { enabled: true });
      expect(result.enabled).toBe(true);
    });
  });

  describe('archive', () => {
    it('should soft-delete a flag by setting archivedAt', async () => {
      const archived = makeFlagRecord('OLD_FLAG', { archivedAt: new Date() });
      mockPrisma.featureFlag.update.mockResolvedValue(archived);

      const result = await service.archive('OLD_FLAG');
      expect(result.archivedAt).not.toBeNull();
    });
  });

  describe('setOverride', () => {
    it('should upsert a tenant override', async () => {
      const override = {
        id: 'o1', flagId: 'uuid-1', tenantId: 'tenant-1',
        userId: null, environment: null, enabled: true,
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(makeFlagRecord('MY_FLAG'));
      mockPrisma.featureFlagOverride.upsert.mockResolvedValue(override);

      await service.setOverride('MY_FLAG', {
        tenantId: 'tenant-1',
        enabled: true,
      });

      expect(mockPrisma.featureFlagOverride.upsert).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all active (non-archived) flags', async () => {
      const flags = [makeFlagRecord('A'), makeFlagRecord('B')];
      mockPrisma.featureFlag.findMany.mockResolvedValue(flags);

      const result = await service.findAll();
      expect(result).toHaveLength(2);
      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        where: { archivedAt: null },
        include: { overrides: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('invalidateCache', () => {
    it('should clear the cache', () => {
      cache.set('A', makeFlagRecord('A'));
      service.invalidateCache();
      expect(cache.get('A')).toBeNull();
    });
  });

  describe('event emission', () => {
    it('should emit evaluation event when emitEvents is true', async () => {
      const serviceWithEvents = new FeatureFlagService(
        { ...options, emitEvents: true },
        mockPrisma,
        cache,
        evaluator,
        context,
        mockModuleRef,
        mockEventEmitter,
      );

      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      await serviceWithEvents.isEnabled('MY_FLAG');
      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should not emit events when emitEvents is false', async () => {
      const flag = makeFlagRecord('MY_FLAG', { enabled: true });
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag);

      await service.isEnabled('MY_FLAG');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/services/feature-flag.service.spec.ts --no-coverage
```

Expected: FAIL — `FeatureFlagService` not found.

- [ ] **Step 3: Implement FeatureFlagService**

File: `src/services/feature-flag.service.ts`

```typescript
import { Injectable, Inject, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FEATURE_FLAG_MODULE_OPTIONS } from '../feature-flag.constants';
import { FeatureFlagModuleOptions } from '../interfaces/feature-flag-options.interface';
import {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagWithOverrides,
} from '../interfaces/feature-flag.interface';
import { EvaluationContext } from '../interfaces/evaluation-context.interface';
import { FlagCacheService } from './flag-cache.service';
import { FlagEvaluatorService } from './flag-evaluator.service';
import { FlagContext } from './flag-context';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '../events/feature-flag.events';

@Injectable()
export class FeatureFlagService {
  constructor(
    @Inject(FEATURE_FLAG_MODULE_OPTIONS) private readonly options: FeatureFlagModuleOptions,
    @Inject('PRISMA_SERVICE') private readonly prisma: any,
    private readonly cache: FlagCacheService,
    private readonly evaluator: FlagEvaluatorService,
    private readonly flagContext: FlagContext,
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject('EVENT_EMITTER') private readonly eventEmitter?: any,
  ) {}

  async isEnabled(flagKey: string, explicitContext?: EvaluationContext): Promise<boolean> {
    const flag = await this.resolveFlag(flagKey);
    if (!flag) {
      return this.options.defaultOnMissing ?? false;
    }

    const context = this.buildContext(explicitContext);
    const startTime = Date.now();
    const { result, source } = this.evaluator.evaluate(flag, context);
    const evaluationTimeMs = Date.now() - startTime;

    if (this.options.emitEvents && this.eventEmitter) {
      const event: FlagEvaluatedEvent = {
        flagKey,
        result,
        context,
        source,
        evaluationTimeMs,
      };
      this.eventEmitter.emit(FeatureFlagEvents.EVALUATED, event);
    }

    return result;
  }

  async evaluateAll(explicitContext?: EvaluationContext): Promise<Record<string, boolean>> {
    const flags = await this.resolveAllFlags();
    const context = this.buildContext(explicitContext);
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = this.evaluator.evaluate(flag, context).result;
    }

    return result;
  }

  async create(input: CreateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.create({
      data: {
        key: input.key,
        description: input.description,
        enabled: input.enabled ?? false,
        percentage: input.percentage ?? 0,
        metadata: input.metadata ?? {},
      },
      include: { overrides: true },
    });

    this.cache.invalidate();

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.CREATED, { flagKey: input.key, action: 'created' });
    }

    return flag;
  }

  async update(key: string, input: UpdateFeatureFlagInput): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.update({
      where: { key },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.percentage !== undefined && { percentage: input.percentage }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      },
      include: { overrides: true },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.UPDATED, { flagKey: key, action: 'updated' });
    }

    return flag;
  }

  async archive(key: string): Promise<FeatureFlagWithOverrides> {
    const flag = await this.prisma.featureFlag.update({
      where: { key },
      data: { archivedAt: new Date() },
      include: { overrides: true },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.ARCHIVED, { flagKey: key, action: 'archived' });
    }

    return flag;
  }

  async setOverride(key: string, input: SetOverrideInput): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new Error(`Feature flag "${key}" not found`);
    }

    await this.prisma.featureFlagOverride.upsert({
      where: {
        uq_override_context: {
          flagId: flag.id,
          tenantId: input.tenantId ?? null,
          userId: input.userId ?? null,
          environment: input.environment ?? null,
        },
      },
      update: { enabled: input.enabled },
      create: {
        flagId: flag.id,
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        environment: input.environment ?? null,
        enabled: input.enabled,
      },
    });

    this.cache.invalidate(key);

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.OVERRIDE_SET, {
        flagKey: key,
        ...input,
        action: 'set',
      });
    }
  }

  async findAll(): Promise<FeatureFlagWithOverrides[]> {
    return this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  invalidateCache(): void {
    this.cache.invalidate();

    if (this.options.emitEvents && this.eventEmitter) {
      this.eventEmitter.emit(FeatureFlagEvents.CACHE_INVALIDATED, {});
    }
  }

  private async resolveFlag(key: string): Promise<FeatureFlagWithOverrides | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      include: { overrides: true },
    });

    if (flag) {
      this.cache.set(key, flag);
    }

    return flag;
  }

  private async resolveAllFlags(): Promise<FeatureFlagWithOverrides[]> {
    const cached = this.cache.getAll();
    if (cached) return cached;

    const flags = await this.prisma.featureFlag.findMany({
      where: { archivedAt: null },
      include: { overrides: true },
    });

    this.cache.setAll(flags);
    return flags;
  }

  private buildContext(explicit?: EvaluationContext): EvaluationContext {
    return {
      userId: explicit?.userId ?? this.flagContext.getUserId(),
      tenantId: explicit?.tenantId ?? this.getTenantId(),
      environment: explicit?.environment ?? this.options.environment,
    };
  }

  private getTenantId(): string | null {
    try {
      const { TenancyService } = require('@nestarc/tenancy');
      const tenancyService = this.moduleRef.get(TenancyService, { strict: false });
      return tenancyService?.getCurrentTenant() ?? null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/services/feature-flag.service.spec.ts --no-coverage
```

Expected: All 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/feature-flag.service.ts test/services/feature-flag.service.spec.ts
git commit -m "feat: add FeatureFlagService with CRUD, evaluation, caching, and events"
```

---

## Task 10: FeatureFlagGuard

**Files:**
- Create: `src/guards/feature-flag.guard.ts`
- Create: `test/guards/feature-flag.guard.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/guards/feature-flag.guard.spec.ts`

```typescript
import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { FeatureFlagGuard } from '../../src/guards/feature-flag.guard';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

function createMockContext(handler: Function, classRef: Function = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let reflector: Reflector;
  let mockService: Partial<FeatureFlagService>;

  beforeEach(() => {
    reflector = new Reflector();
    mockService = {
      isEnabled: jest.fn(),
    };
    guard = new FeatureFlagGuard(reflector, mockService as FeatureFlagService);
  });

  it('should allow access when no flag key is set', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should allow access when bypass is set', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
      if (key === 'BYPASS_FEATURE_FLAG_KEY') return true;
      return undefined;
    });

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should allow access when flag is enabled', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
      if (key === 'FEATURE_FLAG_KEY') return 'MY_FLAG';
      if (key === 'FEATURE_FLAG_OPTIONS_KEY') return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(true);

    const ctx = createMockContext(handler);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw 403 when flag is disabled', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
      if (key === 'FEATURE_FLAG_KEY') return 'MY_FLAG';
      if (key === 'FEATURE_FLAG_OPTIONS_KEY') return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(false);

    const ctx = createMockContext(handler);
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('should use custom statusCode and fallback from options', async () => {
    const handler = () => {};
    jest.spyOn(reflector, 'get').mockImplementation((key: string) => {
      if (key === 'FEATURE_FLAG_KEY') return 'MY_FLAG';
      if (key === 'FEATURE_FLAG_OPTIONS_KEY') return {
        statusCode: 402,
        fallback: { message: 'Upgrade your plan' },
      };
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(false);

    const ctx = createMockContext(handler);
    try {
      await guard.canActivate(ctx);
      fail('Expected an exception');
    } catch (e: any) {
      expect(e.status).toBe(402);
      expect(e.getResponse()).toEqual({ message: 'Upgrade your plan' });
    }
  });

  it('should check class-level flag key when handler has none', async () => {
    const handler = () => {};
    const classRef = class TestController {};

    jest.spyOn(reflector, 'get').mockImplementation((key: string, target: any) => {
      if (key === 'FEATURE_FLAG_KEY' && target === handler) return undefined;
      if (key === 'FEATURE_FLAG_KEY' && target === classRef) return 'CLASS_FLAG';
      if (key === 'FEATURE_FLAG_OPTIONS_KEY') return {};
      return undefined;
    });
    (mockService.isEnabled as jest.Mock).mockResolvedValue(true);

    const ctx = createMockContext(handler, classRef);
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockService.isEnabled).toHaveBeenCalledWith('CLASS_FLAG');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/guards/feature-flag.guard.spec.ts --no-coverage
```

Expected: FAIL — `FeatureFlagGuard` not found.

- [ ] **Step 3: Implement FeatureFlagGuard**

File: `src/guards/feature-flag.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from '../services/feature-flag.service';
import {
  FEATURE_FLAG_KEY,
  FEATURE_FLAG_OPTIONS_KEY,
  BYPASS_FEATURE_FLAG_KEY,
} from '../feature-flag.constants';
import { FeatureFlagGuardOptions } from '../interfaces/feature-flag.interface';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check bypass
    const bypass =
      this.reflector.get<boolean>(BYPASS_FEATURE_FLAG_KEY, handler) ||
      this.reflector.get<boolean>(BYPASS_FEATURE_FLAG_KEY, classRef);
    if (bypass) return true;

    // Check flag key (handler-level first, then class-level)
    const flagKey =
      this.reflector.get<string>(FEATURE_FLAG_KEY, handler) ??
      this.reflector.get<string>(FEATURE_FLAG_KEY, classRef);
    if (!flagKey) return true;

    const options: FeatureFlagGuardOptions =
      this.reflector.get<FeatureFlagGuardOptions>(FEATURE_FLAG_OPTIONS_KEY, handler) ??
      this.reflector.get<FeatureFlagGuardOptions>(FEATURE_FLAG_OPTIONS_KEY, classRef) ??
      {};

    const enabled = await this.featureFlagService.isEnabled(flagKey);

    if (!enabled) {
      const statusCode = options.statusCode ?? 403;
      const body = options.fallback ?? { message: 'Feature not available' };
      throw new HttpException(body, statusCode);
    }

    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/guards/feature-flag.guard.spec.ts --no-coverage
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/guards/ test/guards/
git commit -m "feat: add FeatureFlagGuard with class/method-level support"
```

---

## Task 11: FeatureFlagModule (DynamicModule)

**Files:**
- Create: `src/feature-flag.module.ts`
- Create: `test/feature-flag.module.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/feature-flag.module.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { FeatureFlagModule } from '../src/feature-flag.module';
import { FeatureFlagService } from '../src/services/feature-flag.service';
import { FlagCacheService } from '../src/services/flag-cache.service';
import { FlagEvaluatorService } from '../src/services/flag-evaluator.service';
import { FlagContext } from '../src/services/flag-context';

const mockPrisma = {
  featureFlag: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  featureFlagOverride: { upsert: jest.fn(), deleteMany: jest.fn() },
};

describe('FeatureFlagModule', () => {
  describe('forRoot', () => {
    it('should provide all core services', async () => {
      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRoot({
            environment: 'test',
            prisma: mockPrisma,
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
      expect(module.get(FlagCacheService)).toBeDefined();
      expect(module.get(FlagEvaluatorService)).toBeDefined();
      expect(module.get(FlagContext)).toBeDefined();
    });
  });

  describe('forRootAsync', () => {
    it('should provide services with async factory', async () => {
      const module = await Test.createTestingModule({
        imports: [
          FeatureFlagModule.forRootAsync({
            useFactory: () => ({
              environment: 'test',
              prisma: mockPrisma,
            }),
          }),
        ],
      }).compile();

      expect(module.get(FeatureFlagService)).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/feature-flag.module.spec.ts --no-coverage
```

Expected: FAIL — `FeatureFlagModule` not found.

- [ ] **Step 3: Implement FeatureFlagModule**

File: `src/feature-flag.module.ts`

Note: The module accepts `prisma` in the options so users pass their PrismaService instance. This avoids requiring a specific Prisma injection token.

```typescript
import { DynamicModule, Module, MiddlewareConsumer, NestModule, RequestMethod, Provider, Type } from '@nestjs/common';
import { FEATURE_FLAG_MODULE_OPTIONS } from './feature-flag.constants';
import {
  FeatureFlagModuleOptions,
  FeatureFlagModuleAsyncOptions,
  FeatureFlagModuleOptionsFactory,
} from './interfaces/feature-flag-options.interface';
import { FeatureFlagService } from './services/feature-flag.service';
import { FlagCacheService } from './services/flag-cache.service';
import { FlagEvaluatorService } from './services/flag-evaluator.service';
import { FlagContext } from './services/flag-context';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { FlagContextMiddleware } from './middleware/flag-context.middleware';

export interface FeatureFlagModuleRootOptions extends FeatureFlagModuleOptions {
  prisma: any;
}

export interface FeatureFlagModuleRootAsyncOptions extends FeatureFlagModuleAsyncOptions {
  useFactory?: (...args: any[]) => Promise<FeatureFlagModuleRootOptions> | FeatureFlagModuleRootOptions;
}

const coreProviders: Provider[] = [
  FlagCacheService,
  FlagEvaluatorService,
  FlagContext,
  FeatureFlagGuard,
  FeatureFlagService,
];

@Module({})
export class FeatureFlagModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(FlagContextMiddleware)
      .forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }

  static forRoot(options: FeatureFlagModuleRootOptions): DynamicModule {
    const { prisma, ...moduleOptions } = options;

    return {
      module: FeatureFlagModule,
      global: true,
      providers: [
        { provide: FEATURE_FLAG_MODULE_OPTIONS, useValue: moduleOptions },
        { provide: 'PRISMA_SERVICE', useValue: prisma },
        { provide: 'EVENT_EMITTER', useValue: null },
        ...coreProviders,
      ],
      exports: [FeatureFlagService, FlagContext, FEATURE_FLAG_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: FeatureFlagModuleRootAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: FeatureFlagModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        ...asyncProviders,
        { provide: 'EVENT_EMITTER', useValue: null },
        ...coreProviders,
      ],
      exports: [FeatureFlagService, FlagContext, FEATURE_FLAG_MODULE_OPTIONS],
    };
  }

  private static createAsyncProviders(options: FeatureFlagModuleRootAsyncOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: FEATURE_FLAG_MODULE_OPTIONS,
          useFactory: async (...args: any[]) => {
            const result = await options.useFactory!(...args);
            return { environment: result.environment, cacheTtlMs: result.cacheTtlMs, userIdExtractor: result.userIdExtractor, defaultOnMissing: result.defaultOnMissing, emitEvents: result.emitEvents };
          },
          inject: options.inject ?? [],
        },
        {
          provide: 'PRISMA_SERVICE',
          useFactory: async (...args: any[]) => {
            const result = await options.useFactory!(...args);
            return result.prisma;
          },
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useClass) {
      return [
        { provide: options.useClass, useClass: options.useClass },
        {
          provide: FEATURE_FLAG_MODULE_OPTIONS,
          useFactory: async (factory: FeatureFlagModuleOptionsFactory) =>
            factory.createFeatureFlagOptions(),
          inject: [options.useClass],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: FEATURE_FLAG_MODULE_OPTIONS,
          useFactory: async (factory: FeatureFlagModuleOptionsFactory) =>
            factory.createFeatureFlagOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/feature-flag.module.spec.ts --no-coverage
```

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/feature-flag.module.ts test/feature-flag.module.spec.ts
git commit -m "feat: add FeatureFlagModule with forRoot/forRootAsync registration"
```

---

## Task 12: TestFeatureFlagModule (Testing Utilities)

**Files:**
- Create: `src/testing/test-feature-flag.module.ts`
- Create: `src/testing/index.ts`
- Create: `test/testing/test-feature-flag.module.spec.ts`

- [ ] **Step 1: Write failing tests**

File: `test/testing/test-feature-flag.module.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { TestFeatureFlagModule } from '../../src/testing/test-feature-flag.module';
import { FeatureFlagService } from '../../src/services/feature-flag.service';

describe('TestFeatureFlagModule', () => {
  it('should provide a mock FeatureFlagService with preset flags', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestFeatureFlagModule.register({
          FEATURE_A: true,
          FEATURE_B: false,
        }),
      ],
    }).compile();

    const service = module.get(FeatureFlagService);

    expect(await service.isEnabled('FEATURE_A')).toBe(true);
    expect(await service.isEnabled('FEATURE_B')).toBe(false);
    expect(await service.isEnabled('UNKNOWN')).toBe(false);
  });

  it('should return all flags via evaluateAll', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestFeatureFlagModule.register({
          A: true,
          B: false,
        }),
      ],
    }).compile();

    const service = module.get(FeatureFlagService);
    const all = await service.evaluateAll();
    expect(all).toEqual({ A: true, B: false });
  });

  it('should default all flags to false when none provided', async () => {
    const module = await Test.createTestingModule({
      imports: [TestFeatureFlagModule.register()],
    }).compile();

    const service = module.get(FeatureFlagService);
    expect(await service.isEnabled('ANY')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest test/testing/test-feature-flag.module.spec.ts --no-coverage
```

Expected: FAIL — `TestFeatureFlagModule` not found.

- [ ] **Step 3: Implement TestFeatureFlagModule**

File: `src/testing/test-feature-flag.module.ts`

```typescript
import { Module, DynamicModule } from '@nestjs/common';
import { FeatureFlagService } from '../services/feature-flag.service';

@Module({})
export class TestFeatureFlagModule {
  static register(flags?: Record<string, boolean>): DynamicModule {
    return {
      module: TestFeatureFlagModule,
      global: true,
      providers: [
        {
          provide: FeatureFlagService,
          useValue: {
            isEnabled: async (key: string) => flags?.[key] ?? false,
            evaluateAll: async () => flags ?? {},
            create: async () => ({}),
            update: async () => ({}),
            archive: async () => ({}),
            setOverride: async () => {},
            findAll: async () => [],
            invalidateCache: () => {},
          },
        },
      ],
      exports: [FeatureFlagService],
    };
  }
}
```

File: `src/testing/index.ts`

```typescript
export { TestFeatureFlagModule } from './test-feature-flag.module';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest test/testing/test-feature-flag.module.spec.ts --no-coverage
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/testing/ test/testing/
git commit -m "feat: add TestFeatureFlagModule for consumer test support"
```

---

## Task 13: Barrel Export & Final Build

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update barrel export**

File: `src/index.ts`

```typescript
// Module
export { FeatureFlagModule, FeatureFlagModuleRootOptions, FeatureFlagModuleRootAsyncOptions } from './feature-flag.module';

// Services
export { FeatureFlagService } from './services/feature-flag.service';
export { FlagContext } from './services/flag-context';

// Guard
export { FeatureFlagGuard } from './guards/feature-flag.guard';

// Decorators
export { FeatureFlag } from './decorators/feature-flag.decorator';
export { BypassFeatureFlag } from './decorators/bypass-feature-flag.decorator';

// Interfaces
export {
  FeatureFlagModuleOptions,
  FeatureFlagModuleAsyncOptions,
  FeatureFlagModuleOptionsFactory,
} from './interfaces/feature-flag-options.interface';
export { EvaluationContext } from './interfaces/evaluation-context.interface';
export {
  CreateFeatureFlagInput,
  UpdateFeatureFlagInput,
  SetOverrideInput,
  FeatureFlagGuardOptions,
  FeatureFlagWithOverrides,
  FlagOverride,
} from './interfaces/feature-flag.interface';

// Events
export {
  FeatureFlagEvents,
  FlagEvaluatedEvent,
  FlagMutationEvent,
  FlagOverrideEvent,
} from './events/feature-flag.events';

// Constants
export { FEATURE_FLAG_MODULE_OPTIONS } from './feature-flag.constants';
```

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: Build succeeds, `dist/` contains all compiled files.

- [ ] **Step 3: Run all tests with coverage**

```bash
npm run test:cov
```

Expected: All tests pass. Coverage meets 90% threshold.

- [ ] **Step 4: Update the placeholder test**

File: `test/index.spec.ts`

```typescript
import {
  FeatureFlagModule,
  FeatureFlagService,
  FeatureFlag,
  BypassFeatureFlag,
  FeatureFlagGuard,
  FlagContext,
  FeatureFlagEvents,
} from '../src';

describe('barrel exports', () => {
  it('should export all public API symbols', () => {
    expect(FeatureFlagModule).toBeDefined();
    expect(FeatureFlagService).toBeDefined();
    expect(FeatureFlag).toBeDefined();
    expect(BypassFeatureFlag).toBeDefined();
    expect(FeatureFlagGuard).toBeDefined();
    expect(FlagContext).toBeDefined();
    expect(FeatureFlagEvents).toBeDefined();
    expect(FeatureFlagEvents.EVALUATED).toBe('feature-flag.evaluated');
  });
});
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/index.spec.ts
git commit -m "feat: finalize barrel exports and verify full build"
```

---

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | Project scaffolding | 1 placeholder |
| 2 | Constants & interfaces | Build verification |
| 3 | MurmurHash3 | 6 tests |
| 4 | FlagContext | 5 tests |
| 5 | FlagCacheService | 9 tests |
| 6 | FlagEvaluatorService | 16 tests |
| 7 | Decorators | 5 tests |
| 8 | FlagContextMiddleware | 3 tests |
| 9 | FeatureFlagService | 14 tests |
| 10 | FeatureFlagGuard | 6 tests |
| 11 | FeatureFlagModule | 2 tests |
| 12 | TestFeatureFlagModule | 3 tests |
| 13 | Barrel export & final build | 1 test |
| **Total** | | **~71 tests** |
