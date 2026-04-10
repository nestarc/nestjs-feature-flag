# SOLID Validation Report

Date: 2026-04-10
Target: `@nestarc/feature-flag@0.2.0`
Verdict: `PARTIALLY ALIGNED`

## Review Team

- SRP/OCP/DIP reviewer: core module, service composition, dependency wiring
- ISP/LSP reviewer: interfaces, adapters, testing doubles, substitutability
- Cross-cutting reviewer: guard, middleware, admin module, optional integrations
- Main agent: execution validation and final synthesis

## Executive Summary

이 프로젝트는 SOLID를 전혀 지키지 않은 구현은 아니다. 특히 평가 로직을 `FlagEvaluatorService`로 분리했고, 캐시를 `CacheAdapter` 추상화로 분리한 점은 OCP/DIP 측면에서 좋은 출발이다.

다만 현재 상태를 "SOLID에 맞게 잘 설계되었다"라고 강하게 판정하기는 어렵다. 핵심 문제는 다음 세 가지다.

1. 관리자 모듈이 Nest의 공식 조합 API 대신 런타임 메타데이터 변조에 의존한다.
2. 테스트용 `FeatureFlagService` 대체 구현이 실제 서비스 계약을 충분히 만족하지 못한다.
3. `FeatureFlagService`가 평가, 조회, CRUD, 오버라이드 관리, 캐시 무효화, 이벤트 발행, tenancy 조회까지 한 클래스에 집중되어 있다.

## Findings

### 1. Major: `FeatureFlagAdminModule` is extended by mutating controller metadata at runtime

Evidence:

- `src/admin/feature-flag-admin.module.ts:17-18`

Details:

- `Reflect.defineMetadata('path', path, FeatureFlagAdminController)`와 `Reflect.defineMetadata('__guards__', [options.guard], FeatureFlagAdminController)`가 공유 컨트롤러 클래스의 메타데이터를 직접 변경한다.
- 이 방식은 Nest의 안정적인 공개 조합 API보다 내부 메타데이터 계약에 더 강하게 결합된다.
- 동일 프로세스에서 경로나 가드를 달리해 여러 번 등록하려 하면 마지막 등록이 앞선 설정을 덮어쓸 수 있다.

SOLID impact:

- OCP: 기능 확장을 "새 구성 추가"가 아니라 "기존 클래스 메타데이터 변경"으로 처리한다.
- DIP: 프레임워크의 공식 추상화보다 내부 메타데이터 키에 의존한다.

### 2. Major: `TestFeatureFlagModule` is not fully substitutable for `FeatureFlagService`

Evidence:

- `src/testing/test-feature-flag.module.ts:13-29`
- `src/services/feature-flag.service.ts:70-219`

Details:

- 실제 서비스의 `create()`, `update()`, `archive()`는 `FeatureFlagWithOverrides`를 반환하지만 테스트 더블은 빈 객체 `{}`를 반환한다.
- `findByKey()`도 실제 구현과 달리 `id`, `description`, `percentage`, `metadata`, `archivedAt`, `createdAt`, `updatedAt` 없이 부분 객체만 반환한다.
- 소비자 코드가 실제 서비스 계약을 전제로 작성되어 있으면 테스트 환경에서만 다른 동작을 하거나 누락 필드로 실패할 수 있다.

SOLID impact:

- LSP: 테스트 대체 구현이 실제 구현과 동일 계약을 보장하지 못한다.
- ISP: 소비자는 단순한 on/off 조회만 필요해도 광범위한 서비스 계약 전체에 묶인다.

### 3. Moderate: `FeatureFlagService` has too many reasons to change

Evidence:

- `src/services/feature-flag.service.ts:33-67`
- `src/services/feature-flag.service.ts:70-219`
- `src/services/feature-flag.service.ts:221-265`

Details:

- 한 클래스가 평가 진입점, 전체 조회, 플래그 CRUD, 오버라이드 관리, 캐시 조회/저장/무효화, 이벤트 발행, ambient context 구성, optional tenancy 조회를 모두 담당한다.
- persistence 규칙이 바뀌어도 수정되고, context 정책이 바뀌어도 수정되며, event 정책이 바뀌어도 수정된다.
- 현재 테스트는 충분히 갖춰져 있지만, 변경 축이 계속 늘어날수록 응집도가 약해질 가능성이 높다.

SOLID impact:

- SRP: 책임이 평가 orchestration, application service, integration glue로 혼합되어 있다.
- OCP: 새 context source나 event policy를 추가할 때 기존 클래스를 반복 수정하게 된다.

### 4. Moderate: dependency inversion is only partial around persistence and tenant resolution

Evidence:

- `src/feature-flag.module.ts:23-30`
- `src/feature-flag.module.ts:67-73`
- `src/interfaces/feature-flag-options.interface.ts:25-35`
- `src/services/feature-flag.service.ts:21`
- `src/services/feature-flag.service.ts:258-265`

Details:

- Prisma dependency가 `prisma: any`와 `'PRISMA_SERVICE'` 문자열 토큰으로 전달되어 정적 계약이 약하다.
- tenant 조회는 명시적 포트 주입이 아니라 `require('@nestarc/tenancy')` + `ModuleRef.get(...)` 서비스 로케이터 패턴으로 처리된다.
- 캐시 쪽은 추상화가 잘 되어 있지만, persistence/context integration은 아직 구체 구현 의존이 남아 있다.

SOLID impact:

- DIP: 고수준 정책이 명시적 포트 대신 런타임 조회와 `any` 타입에 의존한다.

## Principle-by-Principle Assessment

### S: Single Responsibility Principle

- Good: 평가 규칙이 `FlagEvaluatorService`로 분리되어 있다.
- Weak: `FeatureFlagService` 하나에 너무 많은 변경 이유가 몰려 있다.

### O: Open/Closed Principle

- Good: 새 캐시 구현은 `CacheAdapter`를 통해 추가할 수 있다.
- Weak: 관리자 모듈 확장이 컨트롤러 메타데이터 변조 방식이라 안전한 확장보다 기존 구성 수정에 가깝다.

### L: Liskov Substitution Principle

- Good: `MemoryCacheAdapter`와 `RedisCacheAdapter`는 현재 계약 테스트를 통과한다.
- Weak: `TestFeatureFlagModule`의 서비스 대체 구현은 실제 반환 계약과 일치하지 않는다.

### I: Interface Segregation Principle

- Good: `CacheAdapter`는 현재 소비자인 `FeatureFlagService` 기준으로는 과도하게 크지 않다.
- Weak: `RemoveOverrideInput`이 cache adapter 인터페이스 파일에 위치해 있어 경계 응집도가 다소 흐린 편이다.

### D: Dependency Inversion Principle

- Good: 캐시 계층은 명확하게 추상화되어 있다.
- Weak: Prisma와 tenancy는 포트 인터페이스보다 런타임 lookup과 `any` 타입 의존이 크다.

## Validation Results

Executed:

- `npm run lint`
- `npm run build`
- `npm test -- --runInBand`
- `npm run test:e2e`

Result:

- lint: passed
- build: passed
- unit tests: passed (`16/16` suites, `153/153` tests)
- e2e tests: passed (`4/4` suites, `36/36` tests)

Observation:

- unit test 실행 중 `test/cache/cache-adapter.contract.spec.ts`와 `test/cache/redis-cache.adapter.spec.ts` 경로에서 `MaxListenersExceededWarning`이 관찰되었다.
- 현재는 실패로 이어지지 않았지만, Redis mock 기반 listener lifecycle은 추가 점검 가치가 있다.

## Recommendation

1. `FeatureFlagService`를 최소한 `FlagQueryService`, `FlagMutationService`, `ContextResolver` 또는 `TenantContextProvider`, `FeatureFlagEventPublisher` 수준으로 분리한다.
2. `FeatureFlagAdminModule`은 런타임 메타데이터 수정 대신 명시적 controller/provider 조합 방식으로 재구성한다.
3. `TestFeatureFlagModule`의 mock 서비스가 실제 반환 타입을 충족하도록 계약 기반 fixture를 제공한다.
4. Prisma와 tenancy는 문자열 토큰 + `any` 대신 명시적 인터페이스 포트로 역전시킨다.
