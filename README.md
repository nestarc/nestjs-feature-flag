# @nestarc/feature-flag

DB-backed feature flags for NestJS + Prisma + PostgreSQL -- tenant-aware overrides, percentage rollouts, and zero external dependencies.

## Features

- **Database-backed** -- flags stored in PostgreSQL via Prisma, no external service required
- **Tenant / user / environment overrides** -- granular control per tenant, user, or deployment environment
- **Percentage rollouts** -- deterministic hashing (murmurhash3) for consistent per-user bucketing
- **Guard decorator** -- `@FeatureFlag()` automatically gates routes and controllers
- **Bypass decorator** -- `@BypassFeatureFlag()` exempts health checks and public endpoints
- **Programmatic evaluation** -- `isEnabled()` and `evaluateAll()` for service-layer logic
- **Built-in caching** -- configurable TTL with manual invalidation
- **Event system** -- optional integration with `@nestjs/event-emitter` for audit and observability
- **Testing utilities** -- drop-in `TestFeatureFlagModule` for unit and integration tests

## Installation

```bash
npm install @nestarc/feature-flag
```

### Peer dependencies

```bash
npm install @nestjs/common @nestjs/core @prisma/client rxjs reflect-metadata
```

### Optional

```bash
# Required only if you enable emitEvents
npm install @nestjs/event-emitter
```

## Prisma Schema

Add the following models to your `schema.prisma`:

```prisma
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

  @@index([flagId], map: "idx_override_flag_id")
  @@map("feature_flag_overrides")
}
```

### Partial unique indexes for overrides

PostgreSQL treats `NULL != NULL` in standard unique constraints, which means a simple `UNIQUE(flag_id, tenant_id, user_id, environment)` would allow duplicate rows when any nullable column is `NULL`. To enforce true uniqueness across all combinations, apply the following migration that creates one partial index per NULL/NOT-NULL pattern:

```sql
-- Drop the old unique constraint that does not handle NULLs correctly
ALTER TABLE feature_flag_overrides
  DROP CONSTRAINT IF EXISTS uq_override_context;

-- Global override (all nullable columns NULL)
CREATE UNIQUE INDEX uq_override_000
  ON feature_flag_overrides (flag_id)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NULL;

-- Only environment is NOT NULL
CREATE UNIQUE INDEX uq_override_001
  ON feature_flag_overrides (flag_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NULL AND environment IS NOT NULL;

-- Only user_id is NOT NULL
CREATE UNIQUE INDEX uq_override_010
  ON feature_flag_overrides (flag_id, user_id)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NULL;

-- user_id + environment
CREATE UNIQUE INDEX uq_override_011
  ON feature_flag_overrides (flag_id, user_id, environment)
  WHERE tenant_id IS NULL AND user_id IS NOT NULL AND environment IS NOT NULL;

-- Only tenant_id is NOT NULL
CREATE UNIQUE INDEX uq_override_100
  ON feature_flag_overrides (flag_id, tenant_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NULL;

-- tenant_id + environment
CREATE UNIQUE INDEX uq_override_101
  ON feature_flag_overrides (flag_id, tenant_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NULL AND environment IS NOT NULL;

-- tenant_id + user_id
CREATE UNIQUE INDEX uq_override_110
  ON feature_flag_overrides (flag_id, tenant_id, user_id)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NULL;

-- All three NOT NULL
CREATE UNIQUE INDEX uq_override_111
  ON feature_flag_overrides (flag_id, tenant_id, user_id, environment)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND environment IS NOT NULL;
```

This SQL is included in the initial migration at `prisma/migrations/20260405000000_init/migration.sql`.

## Module Registration

### forRoot (synchronous)

```typescript
import { FeatureFlagModule } from '@nestarc/feature-flag';

@Module({
  imports: [
    FeatureFlagModule.forRoot({
      environment: 'production',
      prisma: prismaService,
      userIdExtractor: (req) => req.headers['x-user-id'] as string,
      emitEvents: true,
      cacheTtlMs: 30_000,
    }),
  ],
})
export class AppModule {}
```

### forRootAsync (with useFactory)

```typescript
import { FeatureFlagModule } from '@nestarc/feature-flag';

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) => ({
        environment: config.get('NODE_ENV'),
        prisma,
        userIdExtractor: (req) => req.headers['x-user-id'] as string,
      }),
    }),
  ],
})
export class AppModule {}
```

### forRootAsync (with useClass)

```typescript
@Injectable()
class FeatureFlagConfigService implements FeatureFlagModuleOptionsFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  createFeatureFlagOptions() {
    return {
      environment: this.config.get('NODE_ENV'),
      prisma: this.prisma,
    };
  }
}

@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      imports: [ConfigModule, PrismaModule],
      useClass: FeatureFlagConfigService,
    }),
  ],
})
export class AppModule {}
```

### forRootAsync (with useExisting)

```typescript
@Module({
  imports: [
    FeatureFlagModule.forRootAsync({
      useExisting: FeatureFlagConfigService,
    }),
  ],
})
export class AppModule {}
```

## Feature Flag Guard

The `@FeatureFlag()` decorator automatically applies `UseGuards(FeatureFlagGuard)`, so you do not need to add `@UseGuards()` yourself.

### Method-level

```typescript
import { FeatureFlag } from '@nestarc/feature-flag';

@Controller('dashboard')
export class DashboardController {
  @FeatureFlag('NEW_DASHBOARD')
  @Get()
  getDashboard() {
    return { message: 'Welcome to the new dashboard' };
  }
}
```

### Class-level

```typescript
@FeatureFlag('BETA_API')
@Controller('beta')
export class BetaController {
  @Get('feature-a')
  featureA() { /* guarded */ }

  @Get('feature-b')
  featureB() { /* guarded */ }
}
```

### Custom status code and fallback

```typescript
@FeatureFlag('PREMIUM_FEATURE', {
  statusCode: 402,
  fallback: { message: 'Upgrade required' },
})
@Get('premium')
getPremiumContent() { ... }
```

When the flag is disabled, the guard responds with the given `statusCode` (default `403`) and optional `fallback` body.

### Bypassing the guard

Use `@BypassFeatureFlag()` on methods that should always be accessible, even when a class-level flag is applied:

```typescript
import { BypassFeatureFlag } from '@nestarc/feature-flag';

@FeatureFlag('BETA_API')
@Controller('beta')
export class BetaController {
  @Get('docs')
  betaDocs() { /* guarded by BETA_API */ }

  @BypassFeatureFlag()
  @Get('health')
  healthCheck() {
    return { status: 'ok' };
  }
}
```

## Programmatic Evaluation

Inject `FeatureFlagService` for service-layer checks outside the HTTP request cycle:

```typescript
import { FeatureFlagService } from '@nestarc/feature-flag';

@Injectable()
export class PaymentService {
  constructor(private readonly flags: FeatureFlagService) {}

  async processPayment(order: Order) {
    const useNewGateway = await this.flags.isEnabled('NEW_PAYMENT_GATEWAY');

    if (useNewGateway) {
      return this.newGateway.process(order);
    }
    return this.legacyGateway.process(order);
  }
}
```

### Evaluate all flags at once

```typescript
const allFlags = await this.flags.evaluateAll();
// { NEW_DASHBOARD: true, PREMIUM_FEATURE: false, ... }
```

### Explicit evaluation context

Both `isEnabled()` and `evaluateAll()` accept an optional `EvaluationContext` to override the auto-detected context:

```typescript
const enabled = await this.flags.isEnabled('MY_FLAG', {
  userId: 'user-123',
  tenantId: 'tenant-abc',
  environment: 'staging',
});
```

Passing `null` explicitly clears that dimension, suppressing any ambient value from the request context:

```typescript
// Evaluate as if no user is present, even within a request with x-user-id
const globalResult = await this.flags.isEnabled('MY_FLAG', { userId: null });
```

## Overrides

Set context-specific overrides that take precedence over the global flag value:

```typescript
// Enable for a specific tenant
await this.flags.setOverride('MY_FLAG', {
  tenantId: 'tenant-1',
  enabled: true,
});

// Disable for a specific user
await this.flags.setOverride('MY_FLAG', {
  userId: 'user-42',
  enabled: false,
});

// Enable only in staging
await this.flags.setOverride('MY_FLAG', {
  environment: 'staging',
  enabled: true,
});

// Combine dimensions
await this.flags.setOverride('MY_FLAG', {
  tenantId: 'tenant-1',
  userId: 'user-42',
  environment: 'production',
  enabled: true,
});
```

## Events

Enable event emission to observe flag lifecycle changes. Requires `@nestjs/event-emitter` as an optional peer dependency.

**Important:** You must import `EventEmitterModule.forRoot()` in your app module. The feature-flag module reuses the same `EventEmitter2` singleton that NestJS manages, so `@OnEvent()` listeners work out of the box.

### Setup

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot(),   // must be imported
    FeatureFlagModule.forRoot({
      environment: 'production',
      prisma: prismaService,
      emitEvents: true,
    }),
  ],
})
export class AppModule {}
```

### Event types

| Event constant                           | Event string                       | Payload type         |
| ---------------------------------------- | ---------------------------------- | -------------------- |
| `FeatureFlagEvents.EVALUATED`            | `feature-flag.evaluated`           | `FlagEvaluatedEvent` |
| `FeatureFlagEvents.CREATED`              | `feature-flag.created`             | `FlagMutationEvent`  |
| `FeatureFlagEvents.UPDATED`              | `feature-flag.updated`             | `FlagMutationEvent`  |
| `FeatureFlagEvents.ARCHIVED`             | `feature-flag.archived`            | `FlagMutationEvent`  |
| `FeatureFlagEvents.OVERRIDE_SET`         | `feature-flag.override.set`        | `FlagOverrideEvent`  |
| `FeatureFlagEvents.OVERRIDE_REMOVED`     | `feature-flag.override.removed`    | `FlagOverrideEvent`  |
| `FeatureFlagEvents.CACHE_INVALIDATED`    | `feature-flag.cache.invalidated`   | `{}`                 |

### Listening to events

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { FeatureFlagEvents, FlagEvaluatedEvent } from '@nestarc/feature-flag';

@Injectable()
export class FlagAuditListener {
  @OnEvent(FeatureFlagEvents.EVALUATED)
  handleEvaluation(event: FlagEvaluatedEvent) {
    console.log(`Flag ${event.flagKey} = ${event.result} (source: ${event.source})`);
  }
}
```

## Testing

Import `TestFeatureFlagModule` from the `/testing` subpath to stub flag values in tests without a database connection:

```typescript
import { TestFeatureFlagModule } from '@nestarc/feature-flag/testing';

describe('DashboardController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestFeatureFlagModule.register({
          NEW_DASHBOARD: true,
          PREMIUM_FEATURE: false,
        }),
      ],
      controllers: [DashboardController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('should allow access when flag is enabled', () => {
    return request(app.getHttpServer())
      .get('/dashboard')
      .expect(200);
  });
});
```

`TestFeatureFlagModule.register()` provides a global mock of `FeatureFlagService` where `isEnabled(key)` returns the boolean you specified (defaulting to `false` for unregistered keys) and `evaluateAll()` returns the full map.

## Evaluation Priority

When `isEnabled()` is called, flags are evaluated through a 6-layer cascade. The first matching layer wins:

| Priority | Layer                  | Description                                                        |
| -------- | ---------------------- | ------------------------------------------------------------------ |
| 1        | **Archived**           | If the flag has `archivedAt` set, evaluation always returns `false` |
| 2        | **User override**      | Override matching the current `userId` (most specific)              |
| 3        | **Tenant override**    | Override matching the current `tenantId`                            |
| 4        | **Environment override**| Override matching the current `environment`                        |
| 5        | **Percentage rollout** | Deterministic hash of `flagKey + userId` (or `tenantId`) mod 100   |
| 6        | **Global default**     | The flag's `enabled` field                                         |

Percentage rollout uses murmurhash3 for deterministic bucketing: the same user always gets the same result for a given flag, ensuring a consistent experience across requests.

## Configuration Reference

### FeatureFlagModuleOptions

| Option              | Type                              | Default   | Description                                                     |
| ------------------- | --------------------------------- | --------- | --------------------------------------------------------------- |
| `environment`       | `string`                          | *required*| Deployment environment (e.g. `'production'`, `'staging'`)       |
| `cacheTtlMs`        | `number`                          | `30000`   | Cache TTL in ms. Set to `0` to disable caching                  |
| `userIdExtractor`   | `(req: Request) => string \| null`| `undefined`| Extracts user ID from the incoming request                     |
| `defaultOnMissing`  | `boolean`                         | `false`   | Value returned when a flag key does not exist in the database   |
| `emitEvents`        | `boolean`                         | `false`   | Emit lifecycle events via `@nestjs/event-emitter`               |

### FeatureFlagModuleRootOptions

Extends `FeatureFlagModuleOptions` with:

| Option  | Type  | Description                    |
| ------- | ----- | ------------------------------ |
| `prisma`| `any` | Prisma client instance         |

## CRUD Operations

`FeatureFlagService` also exposes methods for managing flags programmatically:

```typescript
// Create a flag
const flag = await this.flags.create({
  key: 'NEW_FEATURE',
  description: 'Enables the new feature',
  enabled: false,
  percentage: 0,
});

// Update a flag
await this.flags.update('NEW_FEATURE', {
  enabled: true,
  percentage: 50,
});

// Archive a flag (soft delete -- evaluations return false)
await this.flags.archive('OLD_FEATURE');

// List all active (non-archived) flags
const allFlags = await this.flags.findAll();

// Manually invalidate the cache
this.flags.invalidateCache();
```

## License

MIT
