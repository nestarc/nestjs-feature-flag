# @nestarc/feature-flag consumer guide

This guide is for application developers and AI agents consuming the package. Start with the [README quickstart](../README.md#quickstart) for a complete running app.

**Version scope:** this guide describes **0.6.0 (pending publication)**. It adds `repository` / `tenantContextProvider` module options, invocation `bucketBy`, explicit targeting-key propagation, consistent registry bucketing, Admin null-percentage validation, and full OpenFeature SDK registration. These changes are absent from npm `0.5.0`; use the locally packed 0.6.0 checkout until publication. See the [changelog](../CHANGELOG.md) for version boundaries. When using 0.5.0, inspect its declarations and [tagged source](https://github.com/nestarc/nestjs-feature-flag/tree/v0.5.0).

## Contents

- [Database setup](#database-setup)
- [Module registration](#module-registration)
- [Evaluation and defaults](#evaluation-and-defaults)
- [Context and targeting](#context-and-targeting)
- [Percentage bucketing](#percentage-bucketing)
- [Typed registry](#typed-registry)
- [Route guards](#route-guards)
- [Flag management](#flag-management)
- [Admin REST API](#admin-rest-api)
- [Caching](#caching)
- [Events](#events)
- [Custom persistence and tenancy](#custom-persistence-and-tenancy)
- [OpenFeature](#openfeature)
- [Testing](#testing)
- [Upgrades and troubleshooting](#upgrades-and-troubleshooting)
- [Agent implementation checklist](#agent-implementation-checklist)

## Database setup

Use Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` with NestJS 10/11 and Prisma 7. The default repository needs PostgreSQL and a Prisma client with `featureFlag` and `featureFlagOverride` models. Required package peers are listed in `package.json`; `@prisma/adapter-pg`, `pg`, the Prisma CLI, and `dotenv` below are application setup dependencies.

After 0.6.0 is published, install it in an existing Nest application with matching versions of Prisma CLI, client, and adapter:

```bash
npm install @nestarc/feature-flag@0.6.0
npm install @prisma/client@^7 @prisma/adapter-pg@^7 pg dotenv class-transformer@^0.5.1 class-validator@^0.15.0
npm install --save-dev prisma@^7
```

Before publication, build this repository with `npm ci` and `npm run build`, run `npm pack`, then install the resulting `nestarc-feature-flag-0.6.0.tgz` in your app with `npm install /path/to/nestarc-feature-flag-0.6.0.tgz`. The [standalone examples](https://github.com/nestarc/nestjs-feature-flag/tree/main/examples) document this path.

For a new development database with no existing Prisma migrations:

```bash
mkdir -p prisma
cp node_modules/@nestarc/feature-flag/prisma/schema.prisma prisma/schema.prisma
cp -R node_modules/@nestarc/feature-flag/prisma/migrations prisma/migrations
```

In the copied schema, set the generator output for an application whose TypeScript sources live in `src`:

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}
```

Keep both copied models, `FeatureFlag` and `FeatureFlagOverride`. Configure the connection URL in `prisma.config.ts`:

<!-- source: examples/basic-guard/prisma.config.ts -->
```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

Set `DATABASE_URL` to your development PostgreSQL database, then run:

```bash
npx prisma generate
npx prisma migrate deploy
```

In an existing Prisma app, merge the two models and create a migration in your own migration history instead of replacing its schema or migration directory. The included SQL migrations also define constraints that Prisma schema alone does not express:

```sql
CREATE UNIQUE INDEX "uq_feature_flag_override_attributes"
  ON "feature_flag_overrides"("flag_id", "attributes");

ALTER TABLE "feature_flag_overrides"
  ADD CONSTRAINT "chk_feature_flag_override_attributes_non_empty"
  CHECK (jsonb_typeof("attributes") = 'object' AND "attributes" <> '{}'::jsonb);
```

Add these only if your database does not already have the equivalent constraints. They require unique override attributes per flag and reject empty/non-object override attributes. The existing migrations apply them for you.

### Complete synchronous registration

After the preceding client generation, this `src/main.ts` defines its imports, client, lifecycle cleanup, module, and one guarded route. It uses the default Express Nest platform, so the app also needs `@nestjs/platform-express`. Enable `experimentalDecorators`, `emitDecoratorMetadata`, and `esModuleInterop` in TypeScript, as in a standard Nest project.

<!-- typecheck: main.ts -->
```typescript
import 'reflect-metadata';
import 'dotenv/config';
import { Controller, Get, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { FeatureFlag, FeatureFlagModule } from '@nestarc/feature-flag';
import { PrismaClient } from './generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

@Injectable()
class PrismaLifecycle implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await prisma.$disconnect();
  }
}

@Controller('dashboard')
class DashboardController {
  @Get()
  @FeatureFlag('EXAMPLE_DASHBOARD')
  getDashboard() {
    return { message: 'New dashboard is enabled' };
  }
}

@Module({
  imports: [FeatureFlagModule.forRoot({ prisma, environment: 'development' })],
  controllers: [DashboardController],
  providers: [PrismaLifecycle],
})
class AppModule {}

async function bootstrap(): Promise<void> {
  await prisma.$connect();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000);
}

void bootstrap();
```

Until the database contains an enabled `EXAMPLE_DASHBOARD`, `GET /dashboard` returns 403. Create it through a trusted application seed script or the guarded Admin API. The [basic example](https://github.com/nestarc/nestjs-feature-flag/tree/main/examples/basic-guard) provides an idempotent seed and executable `on` / `off` flow.

## Module registration

Register `FeatureFlagModule` once in the application; it exports `FeatureFlagService` globally. The application owns the Prisma connection lifecycle.

| Option | Default | Meaning |
| --- | --- | --- |
| `environment` | Required | Ambient environment used for targeting |
| `prisma` | Required unless `repository` supplied | Prisma client for the default repository |
| `cacheTtlMs` | `30000` | TTL in milliseconds; `0` skips writes to cache |
| `userIdExtractor` | None | `(req) => string \| null`; reads the request before the route guard |
| `defaultOnMissing` | `false` | Fallback for individual missing/error evaluations |
| `emitEvents` | `false` | Enables publishing when Nest's event emitter is configured |
| `cacheAdapter` | `MemoryCacheAdapter` | Cache implementation |
| `flags` | None | Registry defaults, bucket selection, and exposure settings |
| `repository` | Prisma repository | Custom repository instance; added in 0.6.0 |
| `tenantContextProvider` | Default tenant provider | Custom ambient tenant resolver instance; added in 0.6.0 |

### Asynchronous factories and reusable option providers

Every dependency used in `inject` or a factory class constructor must be exported by a module included in `forRootAsync.imports`, unless it is already globally available. Registering a provider only in the parent `AppModule.providers` does not make it visible inside this dynamic module.

The following complete module file defines the Prisma service and exports needed by all three async forms. It assumes the generated client path from [database setup](#database-setup).

<!-- typecheck: database.module.ts -->
```typescript
import 'dotenv/config';
import { Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  FeatureFlagModule,
  FeatureFlagModuleOptionsFactory,
  FeatureFlagModuleRootOptions,
} from '@nestarc/feature-flag';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    super({ adapter: new PrismaPg({ connectionString }) });
  }
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}

@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

@Injectable()
export class FeatureFlagConfigService implements FeatureFlagModuleOptionsFactory {
  constructor(private readonly prisma: PrismaService) {}
  createFeatureFlagOptions(): FeatureFlagModuleRootOptions {
    return { prisma: this.prisma, environment: process.env.NODE_ENV ?? 'development' };
  }
}

@Module({
  imports: [PrismaModule],
  providers: [FeatureFlagConfigService],
  exports: [FeatureFlagConfigService],
})
export class FlagConfigurationModule {}

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: process.env.NODE_ENV ?? 'development',
      }),
    }),
  ],
})
export class AppModule {}
```

Choose exactly one registration form. In that file, the alternatives replace the `FeatureFlagModule.forRootAsync(...)` entry in `AppModule.imports`:

```typescript
// useClass: FeatureFlagModule constructs this class with an imported PrismaService.
FeatureFlagModule.forRootAsync({
  imports: [PrismaModule],
  useClass: FeatureFlagConfigService,
});

// useExisting: reuse the instance exported by FlagConfigurationModule.
FeatureFlagModule.forRootAsync({
  imports: [FlagConfigurationModule],
  useExisting: FeatureFlagConfigService,
});
```

An asynchronous `useFactory` or `createFeatureFlagOptions()` can return a promise. The options factory is invoked once per module registration. To enable events, also configure the separate [event emitter module](#events).

## Evaluation and defaults

The service methods have different contracts:

| Method | Return / error behavior | Evaluation events |
| --- | --- | --- |
| `isEnabled(key, context?, options?)` | `Promise<boolean>`; individual missing/error fallback | Same as `evaluateBoolean()` |
| `evaluateBoolean(key, context?, options?)` | `Promise<BooleanEvaluationDetails>`; individual missing/error fallback | Evaluated; exposed if opted in and event emission is enabled |
| `evaluateAll(context?)` | `Promise<Record<string, boolean>>` of active stored flags; read/context/evaluation errors reject | None |

A boolean detail result includes `flagKey`, `value`, `result` (alias of `value`), `source`, `reason`, `defaultUsed`, and `evaluationTimeMs`. `matchedOverrideId`, `bucket`, and `targetingKey` appear when applicable. Error defaults include `errorCode` and `errorMessage`.

```typescript
// `flags` is an injected FeatureFlagService.
const details = await flags.evaluateBoolean(
  'NEW_CHECKOUT',
  { tenantId: 'tenant-acme', targetingKey: 'tenant-acme' },
  { defaultValue: false, trackExposure: true, includeContextInEvent: false },
);
console.log(details.value, details.source, details.reason);
```

Evaluation follows archived status, matching override, percentage, then global `enabled`. See the [README decision table](../README.md#how-a-flag-resolves). An archived flag returns false with `ARCHIVED`, not a fallback. A missing flag uses `FLAG_NOT_FOUND`; a caught evaluation failure uses `ERROR`.

For individual evaluation the selected default is the first defined value:

1. Invocation `options.defaultValue` (including the value passed by a typed client or decorator).
2. The module registry entry's `defaultValue`.
3. Module `defaultOnMissing`.
4. `false`.

Defaults do not override a stored flag's normal result. Registry-only flags are absent from `evaluateAll()`. Bulk evaluation applies the module registry's `bucketBy` in 0.6.0, but it has no invocation options or per-key fallback on failure.

## Context and targeting

```typescript
// `flags` is an injected FeatureFlagService.
await flags.isEnabled('NEW_CHECKOUT', {
  userId: 'user-123',
  tenantId: 'tenant-acme',
  environment: 'production',
  attributes: { plan: 'pro', country: 'KR' },
});
```

The resolver obtains `userId` from request middleware, `tenantId` from the tenant provider, and `environment` from module options. Explicit top-level values override them. `undefined` allows ambient resolution; explicit `null` suppresses that ambient value and remains a null-valued targeting attribute. For example, `{ userId: null }` can match an override with `{ userId: null }`; it does not remove the attribute altogether.

Top-level resolved `userId`, `tenantId`, and `environment` overwrite same-named entries in `attributes`, including when the resolved value is null. Supply these dimensions at the top level. A `tenantId` passed explicitly works even when `@nestarc/tenancy` is not installed. The default provider attempts to obtain the current tenant from that integration and otherwise returns null.

Targeting attributes are scalar strings, finite numbers, booleans, or null. Overrides require a non-empty object. All attributes in an override must match exactly; there is no substring, regex, range, or segment-rule evaluation. Nested objects and arrays are not override values.

When more than one override matches, order is: more attributes, higher `priority`, earlier `createdAt`, then lower ID. An empty override is invalid; use the flag's `enabled` value for a global fallback.

## Percentage bucketing

Percentage must be an integer from 0 through 100. A percentage of 100 returns true after override handling without requiring a bucket key. A percentage of 0 uses global `enabled`. Between 1 and 99, a usable key produces `murmurhash3(flag.key + targetingKey) % 100`; the flag is true if the result is below `percentage`. This is a deterministic distribution, not a guarantee that exactly that fraction of a small population is enabled.

Key selection in 0.6.0 is:

1. Non-empty explicit `context.targetingKey`.
2. Read the attribute named by the chosen `bucketBy`: invocation option, then module registry, then flag `metadata.bucketBy`.
3. If no configured key value is usable, use `context.userId ?? context.tenantId ?? ''`.

A typed client passes its own registry `bucketBy` as an invocation option; explicit call options override that value. If the selected attribute is absent, the evaluator goes directly to the legacy user/tenant fallback; it does not retry a lower-priority `bucketBy` configuration. Custom scalar attribute values are converted to strings. Null or an empty `targetingKey` allows normal fallback. Avoid empty user IDs: legacy nullish fallback preserves an empty `userId` rather than moving on to `tenantId`.

When no usable key remains, the result is global `enabled` with `PERCENTAGE_NO_TARGETING_KEY`. Use a stable, non-empty key for consistent allocation. Changing the key, chosen bucket attribute, or flag key can change allocation.

```typescript
// Invocation bucketBy is new in 0.6.0; `flags` is an injected FeatureFlagService.
await flags.evaluateBoolean(
  'NEW_CHECKOUT',
  { tenantId: 'tenant-acme', userId: 'user-123' },
  { bucketBy: 'tenantId' },
);
```

## Typed registry

```typescript
import { createFeatureFlagClient, defineFlags } from '@nestarc/feature-flag';

export const flagDefinitions = defineFlags({
  NEW_CHECKOUT: {
    defaultValue: false,
    bucketBy: 'tenantId',
    trackExposure: true,
    owner: 'payments',
    type: 'release',
    tags: ['checkout'],
    staleAt: '2026-12-01',
    expiresAt: '2027-01-01',
  },
});

// `service` is the injected FeatureFlagService.
const client = createFeatureFlagClient(service, flagDefinitions);
const enabled = await client.isEnabled('NEW_CHECKOUT', { tenantId: 'tenant-acme' });
```

Pass `flags: flagDefinitions` alongside `environment` and persistence options at module registration to apply registry settings to direct service calls. The typed client's own registry is local to that client and does not register module-wide settings or affect separate `evaluateAll()` calls. Registry bucket propagation in the typed client and bulk evaluation is fixed in 0.6.0.

`defineFlags()` retains typed keys; it does not seed or synchronize database records. Lifecycle metadata (`owner`, `type`, `tags`, `staleAt`, `expiresAt`) is descriptive. `getFlagLifecycleStatus()` calculates active/stale/expired status; it does not archive records, prevent evaluation, or schedule cleanup. `createFeatureFlagDecorators(registry)` constrains keys and supplies registry defaults to decorators; use the module registry for guard bucketing/exposure defaults.

## Route guards

`@FeatureFlag(key, options?)` applies `FeatureFlagGuard` automatically to a method or controller. A method's flag configuration takes precedence over its controller's flag configuration. `@BypassFeatureFlag()` exempts a method from a controller-level flag.

<!-- typecheck: route-guard.ts -->
```typescript
import { Controller, Get } from '@nestjs/common';
import { BypassFeatureFlag, FeatureFlag } from '@nestarc/feature-flag';

@FeatureFlag('BETA_API')
@Controller('beta')
export class BetaController {
  @Get('preview')
  @FeatureFlag('OPTIONAL_PREVIEW', { defaultValue: true })
  preview() { return { preview: true }; }

  @Get('health')
  @BypassFeatureFlag()
  health() { return { status: 'ok' }; }
}
```

Guard options are `statusCode` (default 403), `fallback` (optional response object), and `defaultValue` (individual missing/error fallback). For example, `{ statusCode: 402, fallback: { message: 'Upgrade required' } }` customizes a disabled response. Feature flags make rollout decisions; the application still supplies authentication and authorization.

## Flag management

`create`, `update`, `archive`, and `findByKey` return `FeatureFlagWithOverrides`; `findAll()` returns active flags only. Archived flags remain available by key and always evaluate false. Their keys remain reserved; archiving is a soft delete. `setOverride()` and `removeOverride()` return `Promise<void>`.

```typescript
// `flags` is an injected FeatureFlagService.
await flags.create({ key: 'NEW_CHECKOUT', enabled: false, percentage: 0 });
await flags.update('NEW_CHECKOUT', { percentage: 20 }, {
  actorId: 'operator-1', actorType: 'user', reason: 'Start rollout',
});
await flags.setOverride('NEW_CHECKOUT', {
  attributes: { tenantId: 'tenant-acme', plan: 'pro' },
  enabled: true,
  priority: 10,
});
await flags.removeOverride('NEW_CHECKOUT', {
  attributes: { tenantId: 'tenant-acme', plan: 'pro' },
});
await flags.invalidateCache();
```

An override's entire attributes object identifies it within a flag. Setting the same attributes updates its value and priority; removing uses the same complete attributes object. Omitted priority is 0, including when updating an existing override. Removing a nonexistent override is idempotent if the flag exists.

Optional mutation metadata fields are `actorId`, `actorType`, `reason`, `requestId`, and `correlationId`. They are emitted in lifecycle events when enabled; the package does not persist an audit log. Descriptions accept a string or null (null clears an existing description). Direct service calls rely on TypeScript input contracts and repository validation; HTTP DTO validation is specific to the Admin controller.

## Admin REST API

Import `FeatureFlagAdminModule.register({ guard: AdminAuthGuard })` in the application that already registers `FeatureFlagModule`. A guard class is mandatory; its authentication policy is supplied by your application. `path` defaults to `feature-flags`. The module registers the guard class internally; any injected guard dependencies must be visible there (for example through an application-global authentication module).

The following guard reads an authenticated user established by your application's authentication middleware:

<!-- typecheck: admin.ts -->
```typescript
import { CanActivate, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { FeatureFlagAdminModule } from '@nestarc/feature-flag';

@Injectable()
class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { isAdmin?: boolean } }>();
    return request.user?.isAdmin === true;
  }
}

@Module({
  imports: [FeatureFlagAdminModule.register({ guard: AdminAuthGuard })],
})
export class FlagAdminModule {}
```

Import `FlagAdminModule` into the root app alongside its feature flag registration. Without authenticated `request.user.isAdmin === true`, this sample denies access. The controller uses a validation pipe that rejects unknown top-level body fields.

| Method / route | Body | Success response | Application errors |
| --- | --- | --- | --- |
| `POST /feature-flags` | `key`, optional `description`, `enabled`, `percentage`, `metadata` | 201, flag object | 400 invalid body/percentage; 409 duplicate key |
| `GET /feature-flags` | None | 200, active flag array | Guard may deny access |
| `GET /feature-flags/:key` | None | 200, flag object (including archived) | 404 missing flag |
| `PATCH /feature-flags/:key` | Optional `description`, `enabled`, `percentage`, `metadata` | 200, updated flag | 400 invalid body/percentage; 404 missing flag |
| `DELETE /feature-flags/:key` | None | 200, archived flag object | 404 missing flag |
| `POST /feature-flags/:key/evaluate` | Optional `context`, `defaultValue`, `bucketBy`, `trackExposure`, `includeContextInEvent` | 201, evaluation details | 400 invalid body; missing flag is a default result |
| `POST /feature-flags/:key/overrides` | `attributes`, `enabled`, optional `priority` | 201, empty body | 400 invalid attributes/body; 404 missing flag |
| `DELETE /feature-flags/:key/overrides` | `attributes` | 200, empty body | 400 invalid attributes/body; 404 missing flag |

These are Nest's default success status codes; override endpoints do not return a flag object or 204. Authentication errors depend on the supplied guard. Infrastructure errors may still return 500. The evaluation endpoint shares the service's event behavior, so `trackExposure: true` can emit an event without a database mutation. The `bucketBy` option added in 0.6.0 also works through this endpoint and must be a non-empty string; null, empty, and non-string values return 400.

Create request:

```http
POST /feature-flags
Content-Type: application/json

{"key":"NEW_CHECKOUT","enabled":false,"percentage":0}
```

Example 201 response (IDs and timestamps vary):

```json
{
  "id": "1b4b788f-13eb-470e-a690-c34e8796f528",
  "key": "NEW_CHECKOUT",
  "description": null,
  "enabled": false,
  "percentage": 0,
  "metadata": {},
  "archivedAt": null,
  "createdAt": "2026-09-10T00:00:00.000Z",
  "updatedAt": "2026-09-10T00:00:00.000Z",
  "overrides": []
}
```

Evaluate that flag:

```http
POST /feature-flags/NEW_CHECKOUT/evaluate
Content-Type: application/json

{"context":{"tenantId":"tenant-acme","attributes":{"plan":"pro"}},"defaultValue":true}
```

```json
{
  "flagKey": "NEW_CHECKOUT",
  "value": false,
  "result": false,
  "source": "global",
  "reason": "GLOBAL",
  "defaultUsed": false,
  "evaluationTimeMs": 0
}
```

The example timing is illustrative. `defaultValue: true` does not replace a stored false result. A missing key produces `value: true`, `source: "default"`, `reason: "FLAG_NOT_FOUND"`, and `defaultUsed: true` with this request.

Percentages must be integers 0–100. The 0.6.0 validation fix rejects explicit `null` as well as strings, fractions, and out-of-range values with 400; omission uses the create default or leaves an update unchanged. Legacy override bodies such as `{"tenantId":"tenant-acme","enabled":true}` are rejected: use `{"attributes":{"tenantId":"tenant-acme"},"enabled":true}`. Evaluation `context` is checked as an object, not deeply validated as a nested DTO; follow the [context contract](#context-and-targeting).

## Caching

The default `MemoryCacheAdapter` stores definitions per process. Evaluations, not final boolean decisions, are recomputed from those definitions and the current context. The default TTL is 30,000 ms. A TTL of 0 skips writes to the built-in caches; it does not clear entries another instance already populated in a shared Redis cache.

Successful mutations attempt invalidation before returning. Those invalidation errors are caught because the database write has already succeeded. An existing stale entry can remain until its TTL expires; write/read races and unavailable infrastructure prevent an immediate-consistency guarantee. A direct database edit does not trigger library invalidation. Use the service mutation APIs, await `invalidateCache()`, or accept TTL-based refresh when making external edits.

`await flags.invalidateCache()` clears the cache through the adapter and propagates an invalidation error to its caller, unlike mutation-path best effort. Independent in-memory instances do not notify one another. Redis provides shared cache entries and Pub/Sub invalidation:

<!-- typecheck: cache.ts -->
```typescript
import { RedisCacheAdapter } from '@nestarc/feature-flag';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const cacheAdapter = new RedisCacheAdapter({
  client: redis,
  keyPrefix: 'my-app:production:feature-flag:',
  channel: 'my-app:production:feature-flag:invalidate',
});

// Add cacheAdapter to the root options alongside prisma and environment.
// On app shutdown, close the app (which destroys the adapter), then redis.quit().
```

Install `ioredis` separately. Use the same prefix and channel for instances sharing flags, and separate namespaces for unrelated applications/databases. The adapter creates a subscriber using `client.duplicate()` unless one is supplied. It unsubscribes and closes its owned subscriber on module destruction; it does not close the supplied client or a caller-owned subscriber. Arrange application cleanup for those connections and call `app.enableShutdownHooks()` if using process signals. The [Redis example](https://github.com/nestarc/nestjs-feature-flag/tree/main/examples/redis-events) includes lifecycle cleanup and two running instances.

Choose TTL from acceptable staleness and measured load. The [benchmark method](https://github.com/nestarc/nestjs-feature-flag/blob/main/benchmarks/README.md) describes a reproducible local measurement; it does not establish a universally optimal TTL or production latency.

## Events

Install `@nestjs/event-emitter`, register `EventEmitterModule.forRoot()`, and set `emitEvents: true`. The module uses Nest's emitter instance. The following changes apply to the PrismaModule/PrismaService from the async registration recipe:

<!-- typecheck: events.ts -->
```typescript
import { Injectable, Module } from '@nestjs/common';
import { EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import {
  FeatureFlagEvents,
  FeatureFlagModule,
  FlagEvaluatedEvent,
} from '@nestarc/feature-flag';
import { PrismaModule, PrismaService } from './database.module';

@Injectable()
class FlagAuditListener {
  @OnEvent(FeatureFlagEvents.EVALUATED)
  onEvaluated(event: FlagEvaluatedEvent): void {
    console.log(event.flagKey, event.value, event.reason);
  }
}

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    FeatureFlagModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        environment: 'production',
        emitEvents: true,
      }),
    }),
  ],
  providers: [FlagAuditListener],
})
export class AppModule {}
```

Save the reusable Prisma service/module definitions as `database.module.ts` for that import, or use the separate files in the [Redis events example](https://github.com/nestarc/nestjs-feature-flag/tree/main/examples/redis-events). For synchronous registration, include `EventEmitterModule.forRoot()` alongside `FeatureFlagModule.forRoot({ prisma, environment, emitEvents: true })` using your constructed client.

| Constant | Event string |
| --- | --- |
| `EVALUATED` | `feature-flag.evaluated` |
| `EXPOSED` | `feature-flag.exposed` |
| `CREATED` / `UPDATED` / `ARCHIVED` | `feature-flag.created` / `feature-flag.updated` / `feature-flag.archived` |
| `OVERRIDE_SET` / `OVERRIDE_REMOVED` | `feature-flag.override.set` / `feature-flag.override.removed` |
| `CACHE_INVALIDATED` | `feature-flag.cache.invalidated` |

All constants are properties of `FeatureFlagEvents`. `CACHE_INVALIDATED` is emitted by explicit `invalidateCache()`; mutation events accompany mutation-path invalidation. Failed mutation invalidation uses the string `feature-flag.cache.invalidation-failed`, with `key` and `error`, when events are enabled.

Exposure opt-in precedence is invocation `trackExposure`, module registry `trackExposure`, flag metadata `trackExposure`, then false. A typed client forwards its registry setting as an invocation option. These settings only request an event; `emitEvents: true` and the emitter setup are still needed. Error fallback can use invocation/module registry exposure settings; flag metadata cannot be relied on when fetching the flag failed. `evaluateAll()` emits neither event.

| `includeContextInEvent` | Evaluated event context | Exposed event context |
| --- | --- | --- |
| Omitted | Included | Omitted |
| `true` | Included | Included |
| `false` | Omitted | Omitted |

Event listeners decide sampling, persistence, and analytics. Lifecycle and exposure metadata are not automatically stored as audit logs or analytics records.

## Custom persistence and tenancy

**Added in 0.6.0:** pass implementation instances through module options. A custom repository removes the need for a Prisma instance at module initialization; if both are supplied, `repository` takes precedence. Omitting both throws a configuration error. This does not change npm's declared peer dependencies. Your application owns custom instance lifecycle: Nest manages injected providers in their declaring module; initialize and close manually constructed instances yourself. Exported repository/tenant tokens expose interface delegates, so do not rely on identity with your supplied object.

For implementations already constructed by your app:

```typescript
// repository implements FeatureFlagRepository; tenantContextProvider implements
// TenantContextProvider. Both are application-owned instances.
FeatureFlagModule.forRoot({
  environment: 'production',
  repository,
  tenantContextProvider,
});
```

For injectable implementations, export them from their defining module and return their injected instances from the root-options factory:

```typescript
import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { MyFlagRepository } from './my-flag.repository';
import { MyTenantProvider } from './my-tenant.provider';

@Module({
  providers: [MyFlagRepository, MyTenantProvider],
  exports: [MyFlagRepository, MyTenantProvider],
})
class FlagInfrastructureModule {}

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      imports: [FlagInfrastructureModule],
      inject: [MyFlagRepository, MyTenantProvider],
      useFactory: (repository: MyFlagRepository, tenantContextProvider: MyTenantProvider) => ({
        environment: 'production',
        repository,
        tenantContextProvider,
      }),
    }),
  ],
})
export class AppModule {}
```

The two imported classes are application implementations, not exports from this package. `TenantContextProvider` has one synchronous method: `getCurrentTenantId(): string | null`. Resolve the current request's tenant through your application's context mechanism. `FeatureFlagRepository` specifies flag CRUD, active-only listing, and override lookup/create/update/delete methods; implement its exported interface and preserve the error/uniqueness contracts your application requires. The injected Prisma repository is the reference implementation.

Do not attempt to replace these internal providers by placing an identical token in a parent module's `providers` array: Nest module encapsulation prevents that from overriding the provider inside `FeatureFlagModule`. Test overrides through Nest's testing builder are a separate testing mechanism.

## OpenFeature

**SDK integration in 0.6.0:** install `@openfeature/server-sdk@^1.23.0` and register the provider through the SDK. The adapter has no SDK runtime import, but its public TypeScript provider declaration references SDK types, so install the optional SDK when using this entry point.

```typescript
import { OpenFeature } from '@openfeature/server-sdk';
import { FeatureFlagService } from '@nestarc/feature-flag';
import { createOpenFeatureBooleanProvider } from '@nestarc/feature-flag/openfeature';

// `app` is your initialized Nest application with FeatureFlagModule registered.
await OpenFeature.setProviderAndWait(
  createOpenFeatureBooleanProvider(app.get(FeatureFlagService)),
);
const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue('NEW_CHECKOUT', false, {
  targetingKey: 'user-123',
  tenantId: 'tenant-acme',
  plan: 'pro',
});
```

The SDK's invocation default is forwarded to individual service evaluation. Known top-level keys map to library context; extra scalar context keys such as `plan` become targeting attributes. Object/array values are ignored. The provider supports booleans only. String, numeric, and object SDK getters return the caller's default with reason `ERROR` and `TYPE_MISMATCH`; they do not implement variant flags or remote configuration.

| Library result | SDK result reason / error |
| --- | --- |
| Override | `TARGETING_MATCH` |
| Percentage match or miss | `SPLIT` |
| Global value | `STATIC` |
| Archived | `DISABLED` |
| Percentage without a usable key | `DEFAULT`, global enabled fallback, no error |
| Missing flag | `ERROR`, `FLAG_NOT_FOUND`, caller default |
| Evaluation failure | `ERROR`, `GENERAL`, caller default |

The existing npm 0.5.0 adapter is not the SDK-compatible provider described here. Use the packed 0.6.0 checkout until that version is published. For exposure event controls, use the library's evaluation API or module registry.

## Testing

The `/testing` entry point supplies a database-free service stub for code that consumes booleans:

```typescript
import { Test } from '@nestjs/testing';
import { FeatureFlagService } from '@nestarc/feature-flag';
import { TestFeatureFlagController, TestFeatureFlagModule } from '@nestarc/feature-flag/testing';

const moduleRef = await Test.createTestingModule({
  imports: [TestFeatureFlagModule.register({ NEW_CHECKOUT: false })],
}).compile();
const flags = moduleRef.get(FeatureFlagService);
const controls = moduleRef.get(TestFeatureFlagController);

controls.set('NEW_CHECKOUT', true);
expect(await flags.isEnabled('NEW_CHECKOUT')).toBe(true);
controls.reset();
expect(await flags.isEnabled('NEW_CHECKOUT')).toBe(false);
await moduleRef.close();
```

`registerRegistry(registry, { overrides })` starts from registry defaults with optional test overrides. `reset()` restores registry/default values, not the initially supplied overrides. Unknown keys default to the invocation default or false.

The stub does not evaluate context, percentage rollouts, override precedence, or emit events. Its CRUD methods return stub objects; they do not simulate persistence or mutate the controller's values. Use `TestFeatureFlagController.set()` to change a test decision. Test actual targeting and infrastructure behavior with the real module/evaluator and an appropriate repository. Close test apps/modules and owned connections after each test.

## Upgrades and troubleshooting

For 0.5.0 → 0.6.0, no Prisma schema migration is required. Review the [0.6.0 migration notes](../CHANGELOG.md) for custom provider registration and OpenFeature SDK types. Corrected `targetingKey` and registry `bucketBy` handling can change existing partial-rollout assignments when those settings were previously ignored.

For 0.5.0, follow the [changelog's migration notes](../CHANGELOG.md): Prisma 7 needs `@prisma/adapter-pg`, a generated-client output import, and the URL in `prisma.config.ts`. This upgrade does not require a feature-flag database migration.

For 0.2 → 0.3, the SQL migration moves legacy `tenant_id`, `user_id`, and `environment` into override `attributes`. It deletes rows whose legacy columns are all null. Rows that collide after conversion are deduplicated by latest `updated_at`, then latest `created_at`, then highest ID. Review that data transformation before deploying it. Replace legacy override request fields with a non-empty `attributes` object. Later runtime fixes do not undo this migration's data transformations.

| Symptom | Check |
| --- | --- |
| Nest cannot resolve `PrismaService` or a factory dependency | Export it from its module and include that module in `forRootAsync.imports` |
| `useExisting` cannot resolve the options factory | Import a module that provides and exports that factory class |
| An event listener receives nothing | Install the event package, import `EventEmitterModule.forRoot()`, register the listener, and set `emitEvents: true`; exposure also requires opt-in |
| A false flag still enables a route | Check matching overrides and nonzero percentage before global `enabled` |
| Percentage rollout does not use a supplied targeting key | Check installed version; explicit propagation is fixed in 0.6.0 |
| A seeded change is not visible | Direct DB changes do not invalidate library caches; await manual invalidation or wait for TTL |
| A tenant override fails without the tenancy package | Supply top-level `tenantId` explicitly; no tenancy dependency is needed for explicit context |
| A custom provider in `AppModule.providers` is ignored | Use the 0.6.0 module options with imported/injected implementations |
| `evaluateAll()` omits a registry key | Bulk results contain active database flags only; seed the record explicitly |
| Prisma client import is missing | Generate the client and match its configured output path; 0.5 uses Prisma 7's generated import |

## Agent implementation checklist

1. Inspect the installed `package.json`, changelog, and public `.d.ts` files. Distinguish released 0.5.0 from 0.6.0, which is pending publication and available as a packed checkout.
2. Use `@nestarc/feature-flag`, `@nestarc/feature-flag/testing`, and `@nestarc/feature-flag/openfeature`. Avoid private `dist/*` or repository `src/*` imports.
3. Choose the complete basic example or the registration recipe above. Supply database schema/migrations, a generated Prisma client, exported Nest dependencies, environment values, and a seeded flag.
4. Use top-level user/tenant/environment context, explicit stable bucket identity, and an appropriate missing/error default. Do not treat registry declarations as database creation.
5. Add Redis, events, Admin routes, or OpenFeature only with their documented dependencies and lifecycle setup.
6. Build the consumer against the installed package and verify an enabled and disabled result. Use real evaluation for targeting behavior; boolean stubs only verify consuming branches.
7. When changing the library repository itself, use its [AGENTS.md](https://github.com/nestarc/nestjs-feature-flag/blob/main/AGENTS.md) and documentation verification commands. Historical plans do not supersede current declarations and executable examples.
