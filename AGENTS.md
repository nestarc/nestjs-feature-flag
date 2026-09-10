# Repository instructions

This repository builds `@nestarc/feature-flag`, a NestJS library. Consumer applications should start with `README.md`, `docs/usage.md`, and `examples/`; this file describes how to modify the library.

## Sources and version boundaries

- `src/index.ts`, `src/testing/index.ts`, and `src/openfeature.ts` define the public package entry points. Preserve public behavior unless a change explicitly requires otherwise.
- Read `package.json` and `CHANGELOG.md` before adding versioned guidance. A local fix is unreleased until a versioned release includes it; do not claim it is available in an existing npm version.
- `prisma/schema.prisma` and `prisma/migrations/` define the default PostgreSQL storage contract. Some constraints exist only in SQL migrations. Keep example schemas and migrations aligned when storage changes.
- `docs/README.md` distinguishes current usage from historical plans and reports. Historical descriptions are not the current API contract.

## Implementation and documentation

- Evaluation flows through `FlagContextResolver`, `FlagEvaluatorService`, and `FeatureFlagService`. Keep explicit null semantics, override ordering, bucket selection, and defaults consistent between service and registry entry points.
- Use the module's `repository` and `tenantContextProvider` options for custom providers. Test Nest module registration with real `Test.createTestingModule()` dependency resolution when changing DI.
- Document individual versus bulk evaluation behavior and optional integration requirements accurately. `emitEvents`, exposure tracking, and event context inclusion are separate settings.
- Await cache APIs. Mutation invalidation is best effort; avoid claims of immediate cross-instance consistency or universally optimal TTL.
- Put consumer detail in `docs/usage.md` and runnable examples. Keep README concise and link to those sources. Update relevant public type comments and the changelog when behavior changes.
- A Markdown fence preceded by `&lt;!-- source: path/to/file.ts --&gt;` must exactly match that source file. Run documentation verification after changing either side.
- Full TypeScript recipes marked with `typecheck: recipe.ts` are extracted from the consumer guide and compiled by `scripts/verify-doc-snippets.mjs`; keep marked blocks complete and their shared imports resolvable.
- Keep examples independent of repository-generated imports: install the packed package, generate their own Prisma clients, and use their documented local schema/migrations. Include seed inputs and expected HTTP results for changed flows.
- Website documentation is maintained separately. If public API or documented behavior changes, update the corresponding site source when it is part of the task or identify the specific follow-up in the change description.

## Verification

Install dependencies with `npm ci`. For library changes, run the relevant focused tests, then the project checks appropriate to the change:

```bash
npm run lint
npm test -- --runInBand
npm run build
npm run verify:docs
npm run verify:examples -- --build-only
```

For storage, HTTP, cache, or runnable-example changes, also run applicable integration checks with the documented development services:

```bash
npm run test:e2e
npm run verify:examples
```

`test:e2e` prepares Prisma, Docker Compose, and the test database through its pre-script. Read `.env.test`, `docker-compose.yml`, and the example verification script before database preparation; use development/test databases. Full example verification uses `DATABASE_URL` and `REDIS_URL` as documented by its script and example READMEs.

Check `npm pack --dry-run` when changing package contents or exports. Consumer verification must install the tarball and resolve public entry points, rather than relying only on imports from this repository's `src` or an old `dist` build.

Report what was run and its outcome. Distinguish successful checks, skipped infrastructure-dependent checks, and failures; do not reuse historical test counts as current evidence.
