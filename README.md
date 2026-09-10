# NestJS feature flags with Prisma and PostgreSQL

[![npm version](https://img.shields.io/npm/v/@nestarc/feature-flag.svg)](https://www.npmjs.com/package/@nestarc/feature-flag)
[![npm downloads](https://img.shields.io/npm/dm/@nestarc/feature-flag.svg)](https://www.npmjs.com/package/@nestarc/feature-flag)
[![CI](https://github.com/nestarc/nestjs-feature-flag/actions/workflows/ci.yml/badge.svg)](https://github.com/nestarc/nestjs-feature-flag/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

`@nestarc/feature-flag` stores feature flags in your PostgreSQL database and evaluates them inside your NestJS application. Use route guards, exact attribute targeting, and deterministic percentage rollouts without a separate feature flag service. NestJS, Prisma, and other [peer dependencies](#installation-and-compatibility) are required.

**Version scope:** these docs describe **0.6.0**. It includes targeting-key and registry fixes, custom module provider options, and an SDK-compatible OpenFeature provider that are absent from `0.5.0`. See the [0.6.0 changes and upgrade notes](CHANGELOG.md), and consult the [0.5.0 source](https://github.com/nestarc/nestjs-feature-flag/tree/v0.5.0) when working on that release.

## Contents

- [Installation and compatibility](#installation-and-compatibility)
- [Quickstart](#quickstart)
- [Evaluate a flag](#evaluate-a-flag)
- [How a flag resolves](#how-a-flag-resolves)
- [Target users and tenants](#target-users-and-tenants)
- [Manage flags](#manage-flags)
- [Caching, events, and integrations](#caching-events-and-integrations)
- [Documentation and examples](#documentation-and-examples)
- [For AI agents](#for-ai-agents)

## Installation and compatibility

Install 0.6.0 in an existing NestJS application:

```bash
npm install @nestarc/feature-flag@0.6.0
npm install @prisma/client@^7 @prisma/adapter-pg@^7 pg class-transformer@^0.5.1 class-validator@^0.15.0
npm install --save-dev prisma@^7
```

Keep the Prisma CLI, client, and PostgreSQL adapter on matching versions. The quickstart below uses a locally packed archive to verify this repository checkout.

| Requirement | Supported range / purpose |
| --- | --- |
| Node.js | `^20.19.0`, `^22.12.0`, or `>=24.0.0` |
| NestJS | `@nestjs/common` and `@nestjs/core` 10 or 11 |
| Prisma | `@prisma/client` 7; Prisma CLI and `@prisma/adapter-pg` for PostgreSQL setup |
| PostgreSQL | Default persistence backend; integration tests use PostgreSQL 16 |
| Other required peers | `class-transformer` 0.5, `class-validator` 0.14/0.15, `rxjs` 7, `reflect-metadata` 0.1/0.2 |
| Optional integrations | `ioredis` 5 for Redis; `@nestjs/event-emitter` for events; `@openfeature/server-sdk` ^1.23.0 for OpenFeature |

A standard Nest application already supplies NestJS, RxJS, reflection support, and an HTTP platform adapter. The [consumer guide](docs/usage.md#database-setup) contains the Prisma schema, SQL constraints, and generated-client setup.

## Quickstart

The [complete basic guard example](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/basic-guard/README.md) includes its own Prisma schema, migrations, seed data, and startup script. To run this checkout from the repository root, use Node.js from the supported range and a local PostgreSQL database. `npm run docker:up` starts the repository's PostgreSQL and Redis development services if you use Docker.

```bash
npm ci
npm run build
npm pack
npm run docker:up
cd examples/basic-guard
npm install ../../nestarc-feature-flag-0.6.0.tgz
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
npm run prisma:generate
npm run db:migrate
npm run build
npm run seed -- on
npm start
```

The tarball contains the local checkout, including any local changes. The database URL above is for the repository's development Compose service; substitute your own empty development database if needed. In another terminal:

```bash
curl -i http://127.0.0.1:3000/dashboard
# HTTP 200; {"message":"New dashboard is enabled"}

# From examples/basic-guard, with the same DATABASE_URL:
npm run seed -- off
curl -i http://127.0.0.1:3000/dashboard
# HTTP 403
```

The example disables caching so direct seed changes are visible on the next request. Its complete module registration is:

<!-- source: examples/basic-guard/src/app.module.ts -->
```typescript
import { Module } from '@nestjs/common';
import { FeatureFlagModule } from '@nestarc/feature-flag';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    PrismaModule,
    FeatureFlagModule.forRootAsync({
      imports: [PrismaModule],
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({
        prisma,
        cacheTtlMs: 0, // Let local seed changes appear on the next request.
        environment: process.env.NODE_ENV ?? 'development',
        userIdExtractor: (req) => {
          const userId = req.headers['x-user-id'];
          return Array.isArray(userId) ? (userId[0] ?? null) : (userId ?? null);
        },
      }),
    }),
  ],
  controllers: [DashboardController],
})
export class AppModule {}
```

The imported [PrismaModule](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/basic-guard/src/prisma.module.ts), [PrismaService](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/basic-guard/src/prisma.service.ts), and [DashboardController](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/basic-guard/src/dashboard.controller.ts) are included in the example. `PrismaModule` exports `PrismaService`; including that module in `forRootAsync.imports` makes the service available to the factory. Events are disabled in this basic configuration.

For an existing app, follow the [database setup and complete synchronous registration recipe](docs/usage.md#database-setup), or reuse the example's Prisma module with `forRootAsync`.

## Evaluate a flag

`@FeatureFlag()` adds its guard automatically. A disabled flag returns HTTP 403 by default:

```typescript
import { Controller, Get } from '@nestjs/common';
import { FeatureFlag } from '@nestarc/feature-flag';

@Controller('dashboard')
export class DashboardController {
  @Get()
  @FeatureFlag('EXAMPLE_DASHBOARD')
  getDashboard() {
    return { message: 'Welcome to the new dashboard' };
  }
}
```

For service logic, inject `FeatureFlagService` and await the result:

```typescript
import { Injectable } from '@nestjs/common';
import { FeatureFlagService } from '@nestarc/feature-flag';

@Injectable()
export class CheckoutService {
  constructor(private readonly flags: FeatureFlagService) {}

  async checkoutVersion(tenantId: string): Promise<string> {
    const enabled = await this.flags.isEnabled('NEW_CHECKOUT', { tenantId });
    return enabled ? 'new' : 'classic';
  }
}
```

Use `evaluateBoolean()` for the value and explanation (`source`, `reason`, `defaultUsed`, and optional bucket details). `evaluateAll()` returns the values of active, stored flags; it does not create entries for registry-only keys, emit evaluation/exposure events, or convert errors to defaults. See the [evaluation reference](docs/usage.md#evaluation-and-defaults).

## How a flag resolves

Evaluation checks **archived status → matching override → percentage rollout → global `enabled`** in that order. In particular, `enabled: false` does not cancel overrides or a percentage rollout.

| Condition | Result |
| --- | --- |
| Archived | `false`, regardless of other settings |
| An attribute override matches | The winning override's `enabled` value |
| No override, `percentage: 100` | `true`, even without a user or tenant |
| No override, `percentage: 1–99`, usable bucket key | Whether the deterministic bucket is below the percentage; global `enabled` is ignored |
| No override, `percentage: 1–99`, no usable bucket key | Global `enabled` |
| No override, `percentage: 0` | Global `enabled` |
| Missing flag or individual evaluation error | Invocation default → module registry default → `defaultOnMissing` → `false` |

For a gradual rollout, use `enabled: false` and a percentage between 1 and 99. To make an active flag false for everyone, set `enabled: false`, set `percentage: 0`, and remove any enabling overrides. Archiving also makes evaluation false, and removes the flag from active listings.

A non-empty `targetingKey` takes precedence for bucketing. Otherwise the evaluator uses the selected `bucketBy` attribute, then falls back to `userId ?? tenantId`. The [reference](docs/usage.md#percentage-bucketing) defines configuration precedence and missing-attribute behavior. Explicit `targetingKey` handling and consistent registry bucketing are fixed in 0.6.0.

## Target users and tenants

Overrides use exact attribute matches. Every attribute in an override must match; string `"1"` and number `1` are different values.

```typescript
// `flags` is an injected FeatureFlagService.
await flags.setOverride('NEW_CHECKOUT', {
  attributes: { tenantId: 'tenant-acme', plan: 'pro' },
  enabled: true,
  priority: 10,
});

const enabled = await flags.isEnabled('NEW_CHECKOUT', {
  tenantId: 'tenant-acme',
  attributes: { plan: 'pro' },
});
```

If several overrides match, the winner has more attributes, then higher priority, then earlier creation time, then the lower ID. Top-level `userId`, `tenantId`, and `environment` become targeting attributes and take precedence over same-named entries in `attributes`. Explicit `null` suppresses the corresponding ambient value; it remains a `null` targeting attribute. A provided `tenantId` works without a tenancy package.

The [registry guide](docs/usage.md#typed-registry) covers typed keys and defaults. Registry entries describe evaluation behavior; they do not create database flags or automatically archive expired flags.

## Manage flags

```typescript
// `flags` is an injected FeatureFlagService.
await flags.create({ key: 'NEW_CHECKOUT', enabled: false, percentage: 0 });
await flags.update('NEW_CHECKOUT', { percentage: 20 });
const activeFlags = await flags.findAll();
await flags.archive('OLD_CHECKOUT');
await flags.invalidateCache();
```

The optional [Admin REST API](docs/usage.md#admin-rest-api) exposes creation, updates, active listings, evaluation, and overrides. Registration requires an application-supplied authentication/authorization guard. Request bodies, response examples, status codes, and errors are documented in the guide.

## Caching, events, and integrations

The default cache is in memory with a 30,000 ms TTL. Set `cacheTtlMs: 0` to disable writes to the cache, or use Redis for shared storage and Pub/Sub invalidation across instances. Mutation invalidation is best effort: a database write can succeed while cache invalidation fails. TTL expiry limits how long an existing stale entry remains; concurrent reads and failures mean this is not an immediate-consistency guarantee. Choose TTL based on your acceptable staleness and measured workload.

- [Redis and cache lifecycle](docs/usage.md#caching): adapter setup, invalidation, and connection ownership.
- [Events](docs/usage.md#events): import `EventEmitterModule.forRoot()` **and** set `emitEvents: true`; exposure tracking also needs an opt-in setting.
- [Custom persistence and tenancy](docs/usage.md#custom-persistence-and-tenancy): use module options and Nest factories; these options are new in 0.6.0.
- [OpenFeature](docs/usage.md#openfeature): boolean evaluation through the optional SDK integration; no string, numeric, or object flag values.
- [Testing utilities](docs/usage.md#testing): `/testing` provides controlled boolean stubs; targeting behavior should be tested with the actual evaluator.

## Documentation and examples

- [Consumer guide](docs/usage.md): schema, complete registration, API semantics, integrations, and troubleshooting.
- [Basic route guard](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/basic-guard/README.md), [tenant and plan targeting](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/multi-tenant-targeting/README.md), and [Redis with events](https://github.com/nestarc/nestjs-feature-flag/blob/main/examples/redis-events/README.md): runnable applications with seed data and expected HTTP results.
- [Changelog and 0.5 upgrade notes](CHANGELOG.md): Prisma 7 adapter, generated import path, and configuration changes.
- [Benchmark method](https://github.com/nestarc/nestjs-feature-flag/blob/main/benchmarks/README.md): reproducible commands and measurement limits; latency depends on your workload and environment.
- [Documentation index](https://github.com/nestarc/nestjs-feature-flag/blob/main/docs/README.md): current guides versus historical designs and validation reports.
- [Website](https://nestarc.dev/packages/feature-flag/) and [issue tracker](https://github.com/nestarc/nestjs-feature-flag/issues).

## For AI agents

Check the installed package version and its `.d.ts` exports first, then use [docs/usage.md](docs/usage.md) for consumer implementation. It identifies the 0.6.0 APIs, version boundaries, prerequisites, context/default semantics, and executable examples. The guide and changelog are included in the package so installed-package workflows can read them without relying on search results. Use the documented `/testing` and `/openfeature` entry points instead of importing internal `dist` paths.

For changes to this repository, follow [AGENTS.md](https://github.com/nestarc/nestjs-feature-flag/blob/main/AGENTS.md). Historical design documents are not the current API contract.

## License

[MIT](LICENSE)
