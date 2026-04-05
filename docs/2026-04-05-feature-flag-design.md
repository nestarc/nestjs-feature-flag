# @nestarc/feature-flag — Design Spec

Date: 2026-04-05
Status: Draft

## Goal

NestJS + Prisma + PostgreSQL 환경을 위한 DB 기반 피처 플래그 모듈. 외부 SaaS(LaunchDarkly, Unleash 등)에 의존하지 않고 자체 PostgreSQL에 플래그를 저장하며, Guard 데코레이터와 서비스 API로 기능 게이팅을 제공한다. `@nestarc/tenancy`와 연동하여 테넌트별/가격 티어별 기능 제어를 지원한다.

## Market Gap

현재 NestJS 피처 플래그 솔루션 현황:

| 카테고리 | 예시 | 문제점 |
|---------|------|--------|
| 외부 SaaS SDK | LaunchDarkly, ConfigCat, Tggl | 비용, 외부 의존성, 셀프호스팅 불가 |
| 추상 레이어 | OpenFeature SDK | 구현체(provider)를 직접 만들어야 함 |
| 셀프호스팅 서버 | Unleash, Flagsmith | 별도 서버 운영 필요. NestJS 네이티브 아님 |
| 블로그/튜토리얼 | 다수 존재 | 패키지화되지 않음. 복붙 코드 |

**npm에 PostgreSQL DB 기반 경량 피처 플래그 NestJS 모듈이 존재하지 않음.**

핵심 pain points:
1. 작은 SaaS에서 LaunchDarkly 비용이 과도함
2. Unleash 같은 별도 서버 운영은 인프라 부담
3. NestJS Guard/Decorator로 자연스럽게 통합되는 솔루션 부재
4. 테넌트별 피처 오버라이드 지원하는 플래그 시스템 부재
5. 환경 변수 기반 플래그는 배포 없이 변경 불가

## Design Decisions

| 결정 | 선택 | 이유 |
|------|------|------|
| 저장소 | 같은 PostgreSQL DB | 추가 인프라 불필요. Prisma 네이티브 |
| 캐시 | 인메모리 Map + TTL | Redis 의존 없이 단일 인스턴스에서 빠른 평가. v0.2.0에서 Redis 옵션 추가 |
| 평가 방식 | 서버 사이드 전용 | 클라이언트 SDK는 scope 밖. REST API로 프론트엔드 지원 |
| tenancy 연동 | optional peer dep | 미설치 시 테넌트 오버라이드 무시. graceful degradation |
| 오버라이드 계층 | global → environment → tenant → user | 가장 구체적인 오버라이드가 우선 |
| 퍼센트 롤아웃 | 결정론적 해시 | userId/tenantId 기반 MurmurHash → 동일 사용자는 항상 동일 결과 |

## Evaluation Hierarchy

플래그 평가는 **가장 구체적인 오버라이드가 우선**하는 계층 구조를 따른다:

```
1. User Override       (특정 사용자에게 강제 ON/OFF)
   ↓ 없으면
2. Tenant Override     (특정 테넌트에게 강제 ON/OFF)
   ↓ 없으면
3. Environment Override (staging/production별 설정)
   ↓ 없으면
4. Percentage Rollout  (글로벌 percentage > 0이면 해시 기반 판정)
   ↓ 없으면
5. Global Default      (flags.enabled 값)
```

이 구조가 SaaS에서 필수적인 이유:
- **User Override**: 내부 QA 팀에게만 beta 기능 ON
- **Tenant Override**: Enterprise 고객(A사)에게 신기능 조기 제공, 무료 티어(B사)에서 OFF
- **Environment Override**: staging에서는 ON, production에서는 OFF
- **Percentage Rollout**: 전체 사용자의 10%에게 점진적 배포

## Module API

### Registration

```typescript
@Module({
  imports: [
    FeatureFlagModule.forRoot({
      // 현재 환경 (플래그 환경별 오버라이드에 사용)
      environment: process.env.NODE_ENV ?? 'development',

      // 캐시 TTL (밀리초). 0이면 캐시 비활성화
      cacheTtlMs: 30_000, // 기본값: 30초

      // 평가 컨텍스트에서 사용자 ID 추출
      // 퍼센트 롤아웃과 사용자별 오버라이드에 사용
      userIdExtractor: (req: Request) => req.user?.id ?? null,

      // 플래그가 존재하지 않을 때 기본값 (기본: false)
      defaultOnMissing: false,

      // 플래그 평가 이벤트 발행 여부 (기본: false)
      emitEvents: false,
    }),
  ],
})
export class AppModule {}
```

`forRootAsync`도 지원 (ConfigService 주입 등):

```typescript
FeatureFlagModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    environment: config.get('NODE_ENV'),
    cacheTtlMs: config.get('FEATURE_FLAG_CACHE_TTL', 30_000),
    userIdExtractor: (req: Request) => req.user?.id ?? null,
  }),
})
```

### Guard Decorator

```typescript
@Controller('marketplace')
export class MarketplaceController {
  // 플래그가 OFF이면 403 Forbidden 반환
  @FeatureFlag('MARKETPLACE_V2')
  @Get()
  listProducts() {
    return this.marketplaceService.list();
  }

  // 커스텀 fallback 응답
  @FeatureFlag('ADVANCED_SEARCH', {
    fallback: { message: 'This feature is not available on your plan.' },
    statusCode: 402,
  })
  @Get('search/advanced')
  advancedSearch() { ... }
}
```

클래스 레벨도 지원:

```typescript
@FeatureFlag('ANALYTICS_MODULE')
@Controller('analytics')
export class AnalyticsController {
  // 이 컨트롤러의 모든 엔드포인트가 ANALYTICS_MODULE 플래그에 의해 게이팅됨
}
```

### Service API — Programmatic Evaluation

```typescript
@Injectable()
export class BillingService {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  async generateInvoice(userId: string) {
    // 단순 boolean 평가
    const showNewPricing = await this.featureFlags.isEnabled('NEW_PRICING_MODEL');

    // 컨텍스트 명시적 전달 (미들웨어 밖에서 사용 시)
    const enabled = await this.featureFlags.isEnabled('BETA_BILLING', {
      userId: 'user-123',
      tenantId: 'tenant-456',
    });

    // 여러 플래그 일괄 평가
    const flags = await this.featureFlags.evaluateAll({
      userId,
    });
    // → { MARKETPLACE_V2: true, NEW_PRICING_MODEL: false, ... }

    if (showNewPricing) {
      return this.newPricingLogic();
    }
    return this.legacyPricingLogic();
  }
}
```

### Admin API — 플래그 관리

```typescript
@Injectable()
export class AdminService {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  async setupFeatures() {
    // 플래그 생성
    await this.featureFlags.create({
      key: 'DARK_MODE',
      description: '다크 모드 UI 테마',
      enabled: false,
      percentage: 0,
      metadata: { owner: 'frontend-team', ticket: 'FEAT-123' },
    });

    // 플래그 업데이트
    await this.featureFlags.update('DARK_MODE', {
      enabled: true,
      percentage: 25, // 25% 롤아웃
    });

    // 테넌트 오버라이드 설정
    await this.featureFlags.setOverride('DARK_MODE', {
      tenantId: 'enterprise-tenant',
      enabled: true, // 이 테넌트는 100% ON
    });

    // 사용자 오버라이드 설정
    await this.featureFlags.setOverride('DARK_MODE', {
      userId: 'qa-user-1',
      enabled: true, // QA 사용자는 항상 ON
    });

    // 환경 오버라이드 설정
    await this.featureFlags.setOverride('DARK_MODE', {
      environment: 'staging',
      enabled: true, // staging에서는 항상 ON
    });

    // 플래그 목록 조회
    const flags = await this.featureFlags.findAll();

    // 캐시 수동 무효화 (배포 시 유용)
    this.featureFlags.invalidateCache();

    // 플래그 삭제 (소프트 삭제 — archived로 마킹)
    await this.featureFlags.archive('LEGACY_CHECKOUT');
  }
}
```

### Decorators

```typescript
// 특정 라우트에서 플래그 평가 건너뛰기 (health check 등)
@BypassFeatureFlag()
@Get('health')
healthCheck() { ... }
```

## Data Model

```sql
-- 피처 플래그 정의
CREATE TABLE feature_flags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  description   TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  percentage    INTEGER NOT NULL DEFAULT 0
                  CHECK (percentage >= 0 AND percentage <= 100),
  metadata      JSONB DEFAULT '{}',
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 오버라이드 (테넌트/사용자/환경별)
CREATE TABLE feature_flag_overrides (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id       UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  tenant_id     TEXT,
  user_id       TEXT,
  environment   TEXT,
  enabled       BOOLEAN NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 같은 컨텍스트에 중복 오버라이드 방지
  CONSTRAINT uq_override_context
    UNIQUE NULLS NOT DISTINCT (flag_id, tenant_id, user_id, environment)
);

-- Query performance indexes
CREATE INDEX idx_flags_key ON feature_flags (key) WHERE archived_at IS NULL;
CREATE INDEX idx_overrides_flag ON feature_flag_overrides (flag_id);
CREATE INDEX idx_overrides_tenant ON feature_flag_overrides (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_overrides_user ON feature_flag_overrides (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_overrides_env ON feature_flag_overrides (environment) WHERE environment IS NOT NULL;
```

### Fields — feature_flags

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | PK |
| `key` | TEXT | 플래그 고유 키. SCREAMING_SNAKE_CASE 권장 |
| `description` | TEXT | 플래그 설명 |
| `enabled` | BOOLEAN | 글로벌 활성화 여부 (percentage 0일 때 이 값이 기본) |
| `percentage` | INTEGER | 0~100. 0이면 enabled 그대로, 1~100이면 해시 기반 롤아웃 |
| `metadata` | JSONB | 자유 형식 (owner, ticket, expiry 등) |
| `archived_at` | TIMESTAMPTZ | 소프트 삭제 시점. null이면 활성 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | 최종 수정 시각 |

### Fields — feature_flag_overrides

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | PK |
| `flag_id` | UUID | FK → feature_flags.id |
| `tenant_id` | TEXT | 테넌트 ID (null이면 테넌트 오버라이드 아님) |
| `user_id` | TEXT | 사용자 ID (null이면 사용자 오버라이드 아님) |
| `environment` | TEXT | 환경명 (null이면 환경 오버라이드 아님) |
| `enabled` | BOOLEAN | 이 컨텍스트에서의 강제 값 |
| `created_at` | TIMESTAMPTZ | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | 최종 수정 시각 |

### Prisma Schema

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

  @@unique([flagId, tenantId, userId, environment], map: "uq_override_context")
  @@map("feature_flag_overrides")
}
```

## Architecture

### File Structure

```
src/
├── feature-flag.module.ts              # DynamicModule (forRoot/forRootAsync)
├── feature-flag.constants.ts           # 인젝션 토큰, 기본값
├── interfaces/
│   ├── feature-flag-options.interface.ts   # FeatureFlagModuleOptions
│   ├── feature-flag.interface.ts          # FeatureFlag, FlagOverride
│   └── evaluation-context.interface.ts    # EvaluationContext
├── services/
│   ├── feature-flag.service.ts         # 공개 API: isEnabled(), create(), etc.
│   ├── flag-cache.service.ts           # 인메모리 캐시 + TTL
│   ├── flag-evaluator.service.ts       # 평가 로직 (계층 해석, 퍼센트 해시)
│   └── flag-context.ts                 # AsyncLocalStorage — userId 컨텍스트
├── guards/
│   └── feature-flag.guard.ts           # CanActivate 구현
├── middleware/
│   └── flag-context.middleware.ts      # 요청에서 userId 추출 → context
├── decorators/
│   ├── feature-flag.decorator.ts       # @FeatureFlag('FLAG_KEY')
│   └── bypass-feature-flag.decorator.ts # @BypassFeatureFlag()
├── utils/
│   └── hash.ts                         # MurmurHash3 — 퍼센트 롤아웃
├── testing/
│   ├── test-feature-flag.module.ts     # 테스트용 경량 모듈
│   └── index.ts
└── index.ts                            # 배럴 export
```

### Data Flow — Guard Evaluation

```
HTTP Request
  → FlagContextMiddleware (userId 추출 → AsyncLocalStorage)
    → TenantMiddleware (tenant 추출 — @nestarc/tenancy, optional)
      → FeatureFlagGuard (@FeatureFlag 데코레이터 확인)
        → FeatureFlagService.isEnabled(flagKey)
          → FlagCacheService.get(flagKey)
            ↓ 캐시 미스 시
          → Prisma: flag + overrides 조회
          → FlagCacheService.set(flagKey, data, ttl)
          → FlagEvaluatorService.evaluate(flag, overrides, context)
            → Override 계층 해석 (user → tenant → env → percentage → global)
          → boolean 반환
        → true: next() / false: 403 또는 커스텀 fallback
```

### Data Flow — Service Evaluation

```
Service 내부 호출
  → FeatureFlagService.isEnabled('FLAG_KEY', context?)
    → context 없으면 AsyncLocalStorage에서 userId/tenantId 자동 추출
    → FlagCacheService.get(flagKey)
    → FlagEvaluatorService.evaluate(flag, overrides, context)
    → boolean 반환
```

## Component Details

### FlagContextMiddleware

```typescript
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

### FlagContext (AsyncLocalStorage)

```typescript
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

interface FlagStore {
  userId: string | null;
}
```

### FlagEvaluatorService — Evaluation Logic

```typescript
@Injectable()
export class FlagEvaluatorService {
  evaluate(
    flag: FeatureFlagWithOverrides,
    context: EvaluationContext,
  ): boolean {
    // 1. Archived → always false
    if (flag.archivedAt) return false;

    // 2. User override (가장 구체적)
    if (context.userId) {
      const userOverride = flag.overrides.find(
        o => o.userId === context.userId
          && (o.tenantId === null || o.tenantId === context.tenantId)
          && (o.environment === null || o.environment === context.environment),
      );
      if (userOverride) return userOverride.enabled;
    }

    // 3. Tenant override
    if (context.tenantId) {
      const tenantOverride = flag.overrides.find(
        o => o.tenantId === context.tenantId
          && o.userId === null
          && (o.environment === null || o.environment === context.environment),
      );
      if (tenantOverride) return tenantOverride.enabled;
    }

    // 4. Environment override
    if (context.environment) {
      const envOverride = flag.overrides.find(
        o => o.environment === context.environment
          && o.tenantId === null
          && o.userId === null,
      );
      if (envOverride) return envOverride.enabled;
    }

    // 5. Percentage rollout
    if (flag.percentage > 0 && flag.percentage < 100) {
      const hashKey = context.userId ?? context.tenantId ?? '';
      if (!hashKey) return flag.enabled; // 식별자 없으면 글로벌 기본값
      const bucket = murmurhash3(flag.key + hashKey) % 100;
      return bucket < flag.percentage;
    }

    // 6. 100% rollout
    if (flag.percentage === 100) return true;

    // 7. Global default
    return flag.enabled;
  }
}
```

### FlagCacheService — In-Memory Cache

```typescript
@Injectable()
export class FlagCacheService {
  private cache = new Map<string, CacheEntry>();
  private allFlagsCache: CacheEntry | null = null;

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
    if (this.options.cacheTtlMs === 0) return; // 캐시 비활성화
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.options.cacheTtlMs,
    });
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

interface CacheEntry {
  data: FeatureFlagWithOverrides;
  expiresAt: number;
}
```

### Percentage Rollout — Deterministic Hash

MurmurHash3를 사용하여 동일한 (flagKey + userId) 조합이 항상 동일한 버킷에 배치되도록 한다:

```typescript
// utils/hash.ts
export function murmurhash3(key: string, seed: number = 0): number {
  // MurmurHash3 32-bit 구현
  // 외부 의존성 없이 순수 JS로 구현 (~30줄)
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
  return h >>> 0; // unsigned 32-bit
}
```

**왜 MurmurHash3인가:**
- 결정론적: 같은 입력 → 같은 출력. 사용자 경험 일관성 보장
- 균등 분포: 퍼센트 버킷이 고르게 분포
- 빠름: 순수 JS로 ~30줄, 외부 의존성 없음
- 업계 표준: LaunchDarkly, Unleash 등 동일 방식 사용

## @nestarc/tenancy Integration

```typescript
// feature-flag.service.ts 내부
private getTenantId(): string | null {
  try {
    const { TenancyService } = require('@nestarc/tenancy');
    const tenancyService = this.moduleRef.get(TenancyService, { strict: false });
    return tenancyService?.getCurrentTenant() ?? null;
  } catch {
    return null; // @nestarc/tenancy 미설치
  }
}
```

tenancy가 설치되어 있으면:
- `isEnabled()` 호출 시 현재 테넌트 ID 자동 주입
- 테넌트 오버라이드가 평가 계층에 포함
- 별도 설정 불필요

tenancy 미설치 시:
- 테넌트 오버라이드 무시 (user → env → percentage → global)
- 경고 없음, 에러 없음

## Event System

`emitEvents: true` 설정 시, `@nestjs/event-emitter`와 연동:

```typescript
export const FeatureFlagEvents = {
  EVALUATED: 'feature-flag.evaluated',
  CREATED: 'feature-flag.created',
  UPDATED: 'feature-flag.updated',
  ARCHIVED: 'feature-flag.archived',
  OVERRIDE_SET: 'feature-flag.override.set',
  OVERRIDE_REMOVED: 'feature-flag.override.removed',
  CACHE_INVALIDATED: 'feature-flag.cache.invalidated',
} as const;

// 평가 이벤트 페이로드
interface FlagEvaluatedEvent {
  flagKey: string;
  result: boolean;
  context: EvaluationContext;
  source: 'user_override' | 'tenant_override' | 'env_override' | 'percentage' | 'global';
  evaluationTimeMs: number;
}
```

평가 이벤트는 A/B 테스트 분석, 사용 현황 모니터링, 감사 로그 연동에 활용할 수 있다.

## Interfaces

### FeatureFlagModuleOptions

```typescript
export interface FeatureFlagModuleOptions {
  /** 현재 환경 (예: 'development', 'staging', 'production') */
  environment: string;

  /** 캐시 TTL (밀리초). 0이면 캐시 비활성화. 기본: 30000 */
  cacheTtlMs?: number;

  /** 요청에서 사용자 ID 추출. null이면 사용자 오버라이드/퍼센트 롤아웃 불가 */
  userIdExtractor?: (req: Request) => string | null;

  /** 존재하지 않는 플래그 평가 시 기본값. 기본: false */
  defaultOnMissing?: boolean;

  /** 평가 이벤트 발행 여부 (@nestjs/event-emitter 필요). 기본: false */
  emitEvents?: boolean;
}
```

### EvaluationContext

```typescript
export interface EvaluationContext {
  /** 사용자 ID — 사용자 오버라이드 및 퍼센트 해시에 사용 */
  userId?: string | null;

  /** 테넌트 ID — 테넌트 오버라이드에 사용. tenancy 미설치 시 무시 */
  tenantId?: string | null;

  /** 환경 — 모듈 옵션에서 자동 주입. 명시적 전달로 오버라이드 가능 */
  environment?: string;
}
```

### FeatureFlagGuard Options

```typescript
export interface FeatureFlagGuardOptions {
  /** 플래그 OFF일 때 반환할 HTTP 상태 코드. 기본: 403 */
  statusCode?: number;

  /** 플래그 OFF일 때 반환할 응답 본문 */
  fallback?: Record<string, unknown>;
}
```

## Performance Considerations

- **캐시 히트 시 평가 시간**: < 0.1ms (Map.get + 오버라이드 순회)
- **캐시 미스 시**: 1 DB 쿼리 (flag + overrides JOIN) + 캐시 저장
- **TTL 기본 30초**: 대부분의 SaaS에서 30초 지연은 허용 가능
- **`evaluateAll()`**: 전체 플래그를 한 번의 쿼리로 로드 → 별도 캐시 키
- **메모리 사용량**: 플래그 100개 × 오버라이드 1000개 기준 ~100KB 이하
- **`invalidateCache()`**: 배포 스크립트에서 호출하여 즉시 반영

### v0.2.0에서 고려할 최적화

- Redis 캐시 옵션 (다중 인스턴스 환경)
- PostgreSQL LISTEN/NOTIFY 기반 캐시 무효화 (관리자가 플래그 변경 시 즉시 반영)
- Bulk evaluation 쿼리 최적화 (materialized view)

## Security

- **SQL injection**: Prisma 쿼리 빌더 사용. Raw SQL 없음.
- **테넌트 격리**: tenancy RLS 적용 시 오버라이드도 테넌트 간 격리 가능. 글로벌 플래그 테이블은 sharedModels로 등록.
- **Admin API 접근 제어**: FeatureFlagService의 create/update/archive/setOverride는 앱 레벨에서 인가 처리. 라이브러리는 인가를 강제하지 않음.
- **캐시 poisoning**: 캐시는 인메모리 전용. 외부에서 조작 불가.

## Testing Utilities

```typescript
// testing/test-feature-flag.module.ts
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
          },
        },
      ],
      exports: [FeatureFlagService],
    };
  }
}

// 사용 예:
const module = await Test.createTestingModule({
  imports: [
    TestFeatureFlagModule.register({
      MARKETPLACE_V2: true,
      DARK_MODE: false,
    }),
  ],
}).compile();
```

## CLI Integration

`@nestarc/tenancy`의 CLI 패턴을 따라, Prisma 스키마 scaffolding 지원:

```bash
npx @nestarc/feature-flag init
```

이 명령은:
1. Prisma 스키마에 `FeatureFlag`, `FeatureFlagOverride` 모델 추가
2. 마이그레이션 SQL 생성 (인덱스, 제약조건 포함)
3. 설정 안내 출력

## Out of Scope (v0.1.0)

- REST API 컨트롤러 (Admin UI용 엔드포인트) — v0.2.0
- Redis 캐시 어댑터 — v0.2.0
- PostgreSQL LISTEN/NOTIFY 실시간 캐시 무효화 — v0.2.0
- A/B 테스트 variants (boolean이 아닌 다중 값) — v0.3.0
- 스케줄 기반 자동 활성화/비활성화 — v0.3.0
- 플래그 의존성 (A가 ON일 때만 B 평가) — v0.3.0
- Webhook on flag change — v0.3.0
- 임베디드 Admin UI — scope 밖
- 클라이언트 SDK (React, etc.) — scope 밖
- Segment/cohort 기반 타겟팅 — scope 밖

## Package Metadata

```json
{
  "name": "@nestarc/feature-flag",
  "version": "0.1.0",
  "description": "DB-backed feature flags for NestJS + Prisma + PostgreSQL with tenant-aware overrides",
  "peerDependencies": {
    "@nestjs/common": "^10.0.0 || ^11.0.0",
    "@nestjs/core": "^10.0.0 || ^11.0.0",
    "@prisma/client": "^5.0.0 || ^6.0.0",
    "@types/express": "^4.17.0 || ^5.0.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0",
    "rxjs": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@nestarc/tenancy": { "optional": true },
    "@nestjs/event-emitter": { "optional": true }
  }
}
```

## Success Criteria

- `npm run build` 통과
- 유닛 테스트: 90%+ 커버리지 (특히 평가 계층 로직)
- E2E 테스트: 실제 PostgreSQL에서 CRUD + 오버라이드 + 퍼센트 롤아웃 검증
- `@nestarc/tenancy` 미설치 상태에서도 정상 동작
- 퍼센트 롤아웃 균등 분포 테스트 (10,000회 평가 시 ±2% 이내)
- 캐시 TTL 동작 검증 (만료 후 DB 재조회)
- README: Quick Start 5분 이내 완료 가능

## Migration from External Services

LaunchDarkly/Unleash에서 마이그레이션하는 사용자를 위한 가이드 제공:

```typescript
// LaunchDarkly의 variation() 호출을 대체
// Before: ldClient.variation('my-flag', user, false)
// After:
const enabled = await featureFlags.isEnabled('MY_FLAG');

// Unleash의 isEnabled() 호출을 대체
// Before: unleash.isEnabled('my-flag', { userId })
// After: (동일 시그니처)
const enabled = await featureFlags.isEnabled('MY_FLAG', { userId });
```
