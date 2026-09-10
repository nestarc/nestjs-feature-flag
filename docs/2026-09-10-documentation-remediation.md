# Documentation remediation — fixed scope

Baseline: the 2026-09-10 documentation audit of local version 0.5.0. The following IDs are the fixed implementation list requested by the user. A completed item must include implementation and verification evidence; a remaining external action is recorded explicitly. Findings discovered while implementing an item are handled within that item rather than silently expanding scope.

| ID | Fixed improvement | Acceptance criterion | Status |
| --- | --- | --- | --- |
| F01 | Preserve explicit rollout context and correct public context comments | targetingKey survives service resolution; explicit tenantId works independently of tenancy; regression tests pass | Complete — service/resolver and SDK null regressions |
| F02 | Apply registry bucketBy consistently | typed client and module registry work in single and bulk evaluation; precedence documented and tested | Complete — actual resolver/client/single/bulk regression tests |
| F03 | Provide working custom repository and tenant DI | synchronous and asynchronous registration accept custom implementations without an unused Prisma client; real Nest DI tests pass | Complete — 18 module tests, all async modes, lifecycle ownership and independent binding verification |
| F04 | Complete module registration examples | event, useFactory, useClass and useExisting dependencies are explicit and executable | Complete — explicit module imports/exports; six guide recipes compile; Nest registration and runnable event example pass |
| F05 | Correct Admin input and response contracts | null/invalid percentage returns 400; active-only listing and evaluation request/response documented | Complete — DTO/repository checks and real HTTP regressions, nullable descriptions and bucketBy contract documented |
| F06 | Correct cache and dependency claims | best-effort invalidation, TTL recovery, async invalidation and required peers described accurately | Complete — README, guide, website and public option comments aligned; cacheTtlMs 0 described as disabling writes |
| F07 | Make performance evidence reproducible | measured flag count matches script; destructive setup is removed or isolated; preparation, environment and limits documented; no unsupported optimal-TTL claim | Complete — isolated schema, exactly 50 flags, 2,000 raw timings, failure cleanup and external-data preservation verified |
| F08 | Reorganize README around first success | descriptive title, TOC, compatibility, complete Quickstart, evaluation truth table and linked detailed reference | Complete — README shortened from 825 to 231 lines with complete tarball-to-HTTP flow and linked consumer reference |
| F09 | Make all example apps runnable and portable | local schema/client, install/build/migrate/seed/start commands, observable HTTP results, tenant targeting and two-instance Redis scenario | Complete — all three tarball consumers passed real DB/HTTP/Redis checks |
| F10 | Clarify versioned API and upgrades | current API, defaults, overrides, OpenFeature limits and 0.5 upgrade entry point documented; historical notes separated | Complete — unreleased boundary in README/guide/changelog; docs index separates historical records; website preserves 0.5.0 API |
| F11 | Verify OpenFeature SDK use | supported SDK provider registration and boolean evaluation tested; unsupported types fail with SDK-compatible errors | Complete — 23 adapter and SDK integration tests |
| F12 | Add consumer/documentation verification to CI | packed package is installed in consumer fixtures; examples and documentation recipes are checked rather than merely src build | Complete — CI checks recipes and all three tarball consumers with PostgreSQL/Redis; release runs docs and consumer builds before publishing |
| F13 | Improve npm discovery and distributed documentation | accurate description/keywords, homepage/issues links, consumer guide and changelog available in pack; verify manifest and exports | Complete — 117 packed files, all public exports, guide/changelog, metadata and installed-document relative links checked |
| F14 | Add usable agent guidance | consumer guide, repository AGENTS instructions, current-vs-historical docs routing and stable document links | Complete — packaged usage guide, repository AGENTS.md, historical index and website versioned agent guide/llms entry |
| F15 | Synchronize official website and agent index | feature-flag pages, API docs, related claims, metadata and existing llms index reflect verified package behavior; site checks pass | Complete — 59 file changes applied to local nestarc.dev; 78 tests, build, API and public HTML checks pass |
| F16 | Complete verification and record delivery | appropriate unit/type/lint/build, DB/Redis integration, consumer and website checks; all IDs have evidence or a precise unresolved dependency | Complete — final lint/build, 353 unit tests, 56 E2E tests, docs, three real consumer apps and website checks pass |

## Delivery boundary

This task implements and verifies local package and website changes. npm publication and production website deployment are separate release actions; version-sensitive instructions must distinguish unreleased fixes from the existing published 0.5.0. No existing public release may be described as already containing these fixes.

## Verification log

Baseline: 23 unit suites / 251 tests passed; current dist matched memory TypeScript output; the audit found missing consumer/example CI despite the passing baseline. Detailed completion evidence will be appended here.

- First integrated code pass: lint and build passed; 24 unit suites / 340 tests passed with 97.74% line and 92.49% branch coverage. Additional Admin bucketBy and OpenFeature null regressions were subsequently added and are included in the final pass below.
- Dedicated Compose project `feature-flag-remediation` uses isolated PostgreSQL/Redis containers, separate from any existing database. Initial E2E pass: 5 suites / 52 tests passed.
- `verify:examples` passed for three standalone projects installed from the actual local npm tarball. It verifies generation, migrations, compilation, guard allow/deny, four tenant contexts, two Redis processes, unauthorized mutation rejection, cache changes before TTL, and process-local events. Its generated PostgreSQL schema, Redis namespace, and temporary files were removed after success.

### Final evidence

- `npm run lint` and `npm run build`: passed after the final runtime changes.
- `npm test -- --runInBand --coverage --silent`: **24 suites / 353 tests passed**. Coverage: 97.76% lines, 92.74% branches, above the existing thresholds. Existing ioredis-mock listener warnings also appeared in the baseline; they did not fail the tests.
- `DATABASE_URL=... REDIS_URL=... npx jest --config jest.e2e.config.ts --runInBand --silent`: **5 suites / 56 tests passed**, using the dedicated PostgreSQL and Redis instances. This includes real Admin HTTP input validation and storage migration checks.
- `npm run verify:docs`: **8 documents, 2 source-linked blocks, 6 directly extracted TypeScript recipes, 3 portable schemas, and 117 npm package files** verified. Recipes use newly generated Prisma types and the built public declarations. Relative links in packed README/usage are checked against the actual package file list.
- `DATABASE_URL=... REDIS_URL=... npm run verify:examples`: **all three examples passed again with the final library code**, installed independently from its npm tarball. Database generation/migrations, compilation, HTTP allow/deny, tenant targeting, Redis propagation before TTL, authorization and local events were exercised.
- [Benchmark instructions](../benchmarks/README.md) and [recorded raw results](../benchmarks/results/2026-09-10.json): four scenarios, 500 measured iterations each, exactly 50 stored flags. Metadata records Node 24.11.1, Prisma 7.9.1, PostgreSQL 16.15, Apple M1 Pro, source revision and dirty checkout. This local memory-cache benchmark does not establish Redis latency or an optimal production TTL. Success, output-file collision, and lost idle SQL connection paths preserve unrelated data and remove the benchmark-owned schema.
- Website source: `/Users/ksy/Documents/GitHub/nestarc.dev`. **59 paths** changed: 23 modified, one agent guide added, and 35 redundant generated example/media files removed. The API generator keeps the immutable **v0.5.0** public API and links a maintained guide instead of duplicating the entire repository README. Site checks passed **78 tests**, 13 API packages / 90 API Markdown files, a production build, and 189 public pages / 190 HTML files. The website Quickstart was separately compiled against actual v0.5.0 source with Prisma 7.9.1. After the final OpenFeature wording correction, the affected contract test, build and HTML checks passed again. All 59 paths in the original site workspace match the verified temporary checkout byte for byte.
- `git diff --check` passed in both repositories. The dedicated `feature-flag-remediation` containers and network were removed after verification.

All F01–F16 items are complete within the local implementation boundary. No commit, npm publication, production deployment, Search Console change, or claim of improved search ranking is included in this completion record.
