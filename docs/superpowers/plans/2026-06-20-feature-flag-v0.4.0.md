# @nestarc/feature-flag v0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the v0.4.0 boolean flag stability and DX release from `docs/superpowers/specs/2026-06-20-feature-flag-v0.4.0-design.md`.

**Architecture:** Keep the existing boolean-first service and repository contract, adding detailed evaluation metadata around it rather than changing persistence. Evaluation details are produced by `FlagEvaluatorService`, orchestration/fallback/events stay in `FeatureFlagService`, and developer-facing typed helpers live in separate registry/testing/openfeature modules.

**Tech Stack:** TypeScript, NestJS, Jest, optional structural OpenFeature provider adapter, no Prisma migration.

---

## File Map

- Modify `src/interfaces/evaluation-context.interface.ts`: add `targetingKey`.
- Create `src/interfaces/evaluation-details.interface.ts`: detailed result, reason, options, source types.
- Create `src/interfaces/flag-registry.interface.ts`: typed registry definitions and lifecycle metadata types.
- Modify `src/interfaces/feature-flag-options.interface.ts`: optional registry in module options.
- Modify `src/interfaces/feature-flag.interface.ts`: guard default value and mutation metadata types.
- Modify `src/events/feature-flag.events.ts`: expose details, exposure event, mutation metadata.
- Modify `src/services/flag-evaluator.service.ts`: reason/source/bucket/targetingKey-aware evaluation.
- Modify `src/services/feature-flag.service.ts`: `evaluateBoolean`, fallback policy, exposure events, audit metadata.
- Modify `src/guards/feature-flag.guard.ts`: invocation-level default fallback.
- Create `src/flag-registry.ts`: `defineFlags`, typed client/decorators, lifecycle helper.
- Modify `src/testing/test-feature-flag.module.ts` and `src/testing/index.ts`: registry-based test controller.
- Create `src/openfeature.ts`: boolean-only OpenFeature provider adapter.
- Modify `src/admin/feature-flag-admin.dto.ts` and `src/admin/feature-flag-admin.controller.ts`: optional evaluate endpoint.
- Modify `src/index.ts`, `package.json`, `README.md`, `CHANGELOG.md`: exports and docs.
- Add or modify focused Jest tests under `test/services`, `test/guards`, `test/testing`, `test/admin`, and root export tests.

## Task 1: Detailed Evaluator Result

**Files:**
- Create: `src/interfaces/evaluation-details.interface.ts`
- Modify: `src/interfaces/evaluation-context.interface.ts`
- Modify: `src/services/flag-evaluator.service.ts`
- Test: `test/services/flag-evaluator.service.spec.ts`

- [ ] **Step 1: Write failing evaluator tests**

Add tests asserting archived reason, matched override id, bucket and targeting key details, `context.targetingKey` priority, metadata/registry `bucketBy`, and `PERCENTAGE_NO_TARGETING_KEY`.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/services/flag-evaluator.service.spec.ts --runInBand`
Expected: FAIL because reason/detail fields and targetingKey support do not exist.

- [ ] **Step 3: Implement evaluator detail types and behavior**

Add `EvaluationReason`, `EvaluationSource`, `BooleanEvaluationDetails`, and evaluator options. Keep `result` as an alias for existing callers while adding `value`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/services/flag-evaluator.service.spec.ts --runInBand`
Expected: PASS.

## Task 2: Service-Level `evaluateBoolean`, Fallback, Exposure

**Files:**
- Modify: `src/services/feature-flag.service.ts`
- Modify: `src/events/feature-flag.events.ts`
- Modify: `src/interfaces/feature-flag-options.interface.ts`
- Test: `test/services/feature-flag.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Cover `evaluateBoolean`, missing flag default priority, repository error fallback, registry defaults, evaluation events with reason/default fields, and opt-in exposure events.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/services/feature-flag.service.spec.ts --runInBand`
Expected: FAIL because `evaluateBoolean` and new event fields do not exist.

- [ ] **Step 3: Implement service orchestration**

Add `evaluateBoolean(flagKey, context?, options?)`, make `isEnabled()` return `evaluateBoolean().value`, preserve `evaluateAll()`, emit structured evaluated events, and emit `FeatureFlagEvents.EXPOSED` only when requested by call, registry, or metadata.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/services/feature-flag.service.spec.ts --runInBand`
Expected: PASS.

## Task 3: Guard Invocation Fallback

**Files:**
- Modify: `src/interfaces/feature-flag.interface.ts`
- Modify: `src/guards/feature-flag.guard.ts`
- Test: `test/guards/feature-flag.guard.spec.ts`

- [ ] **Step 1: Write failing guard tests**

Cover default fail-closed behavior and `@FeatureFlag('KEY', { defaultValue: true })` passing when the service reports a missing/error default.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/guards/feature-flag.guard.spec.ts --runInBand`
Expected: FAIL because guard does not pass `defaultValue`.

- [ ] **Step 3: Implement guard option**

Add `defaultValue?: boolean` to `FeatureFlagGuardOptions` and pass it to `service.isEnabled(flagKey, undefined, { defaultValue })`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/guards/feature-flag.guard.spec.ts --runInBand`
Expected: PASS.

## Task 4: Typed Registry and Lifecycle Helpers

**Files:**
- Create: `src/interfaces/flag-registry.interface.ts`
- Create: `src/flag-registry.ts`
- Modify: `src/index.ts`
- Test: `test/flag-registry.spec.ts`
- Test: `test/index.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover `defineFlags`, `createFeatureFlagClient`, typed decorator defaults at runtime, and `getFlagLifecycleStatus()` active/stale/expired behavior.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/flag-registry.spec.ts test/index.spec.ts --runInBand`
Expected: FAIL because registry helpers are missing.

- [ ] **Step 3: Implement registry helpers**

Create a small runtime helper module. Do not add storage or rule engines.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/flag-registry.spec.ts test/index.spec.ts --runInBand`
Expected: PASS.

## Task 5: Testing Module Registry Controller

**Files:**
- Modify: `src/testing/test-feature-flag.module.ts`
- Modify: `src/testing/index.ts`
- Test: `test/testing/test-feature-flag.module.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover legacy `register()`, `registerRegistry()`, injected `TestFeatureFlagController`, `set`, `reset`, and `getDetails`.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/testing/test-feature-flag.module.spec.ts --runInBand`
Expected: FAIL because registry testing utilities do not exist.

- [ ] **Step 3: Implement test controller and module registration**

Reuse the same in-memory controller for both legacy and registry setup. Provide `evaluateBoolean` on the mocked service.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/testing/test-feature-flag.module.spec.ts --runInBand`
Expected: PASS.

## Task 6: OpenFeature Boolean Adapter

**Files:**
- Create: `src/openfeature.ts`
- Modify: `package.json`
- Test: `test/openfeature.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover boolean resolution, OpenFeature context mapping, missing flag default behavior, and provider metadata.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/openfeature.spec.ts --runInBand`
Expected: FAIL because adapter is missing.

- [ ] **Step 3: Implement structural adapter**

Export a boolean-only provider factory from subpath `./openfeature`. Add optional `@openfeature/server-sdk` peer metadata without importing it.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/openfeature.spec.ts --runInBand`
Expected: PASS.

## Task 7: Admin Evaluation Endpoint and Audit Metadata

**Files:**
- Modify: `src/admin/feature-flag-admin.dto.ts`
- Modify: `src/admin/feature-flag-admin.controller.ts`
- Modify: `src/interfaces/feature-flag.interface.ts`
- Modify: `src/services/feature-flag.service.ts`
- Test: `test/admin/feature-flag-admin.controller.spec.ts`
- Test: `test/services/feature-flag.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Cover `POST :key/evaluate` forwarding context/options to `evaluateBoolean`, and mutation methods accepting metadata and including it in events.

- [ ] **Step 2: Run RED**

Run: `npm test -- test/admin/feature-flag-admin.controller.spec.ts test/services/feature-flag.service.spec.ts --runInBand`
Expected: FAIL because endpoint and metadata parameters do not exist.

- [ ] **Step 3: Implement endpoint and metadata enrichment**

Add DTO validation for context and evaluation options. Add optional `FlagMutationMetadata` parameter to mutation methods and event payloads.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- test/admin/feature-flag-admin.controller.spec.ts test/services/feature-flag.service.spec.ts --runInBand`
Expected: PASS.

## Task 8: Documentation, Build, Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Update docs**

Document `evaluateBoolean`, guard defaults, typed registry, testing utilities, OpenFeature adapter, exposure events, and lifecycle metadata.

- [ ] **Step 2: Run full unit suite**

Run: `npm test -- --runInBand`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`
Expected: only intended v0.4.0 implementation files are changed.
