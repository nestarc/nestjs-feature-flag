# NestJS feature flag guard: runnable example

Protect `GET /dashboard` with `@FeatureFlag(FLAG_KEY)`. A seeded flag permits the request; switching it off returns HTTP 403. Caching is disabled in this example so direct seed changes appear on the next request.

## Run the current checkout

Requirements: Node.js 20.19+, 22.12+, or 24+, npm, and PostgreSQL. Use a local development database: the commands below apply migrations and write the example flag. Run from the repository root:

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

`docker:up` starts this repository's PostgreSQL test service on port 5499. If PostgreSQL is already available, skip that command and use its connection URL. The app binds to `127.0.0.1:3000`; set `PORT` to change the port.

In another terminal:

```bash
curl -i http://127.0.0.1:3000/dashboard
# HTTP 200
# {"message":"New dashboard is enabled"}

# From examples/basic-guard, with the same DATABASE_URL:
npm run seed -- off
curl -i http://127.0.0.1:3000/dashboard
# HTTP 403
```

`npm run seed -- on` re-enables access. `npm run seed -- cleanup` removes only `EXAMPLE_DASHBOARD` and its overrides. Seed commands are development fixtures; application mutations should use `FeatureFlagService` to invalidate caches and emit configured events.

## Copy into another project

This directory is self-contained. Copy it anywhere, run `npm install` to use the declared package version, and continue from `export DATABASE_URL` above. To verify local library changes, install the packed archive as shown above. There are no imports or Prisma paths pointing outside this directory, and the Nest CLI is not required.

The local `prisma/schema.prisma` generates TypeScript into `src/generated/prisma`; `npm run build` compiles the app and generated client into `dist`. `prisma/migrations` copies the package's migrations, including the JSONB uniqueness index and non-empty attributes constraint. Use `db:migrate`, rather than `prisma db push`, to preserve those database constraints.

`PrismaModule` exports the injected `PrismaService`; `AppModule` imports it inside `FeatureFlagModule.forRootAsync`. The controller uses the public package decorator. The optional `x-user-id` extractor illustrates where an authenticated user ID can enter evaluation. A real application should derive identity from its authentication layer.

## Automated verification

From the repository root, `npm run verify:examples -- --build-only` packs this checkout, installs it into standalone temporary copies, generates Prisma clients, and builds all examples. For HTTP checks too, supply `DATABASE_URL` and `REDIS_URL` and run `npm run verify:examples`. The runner creates and removes its own randomly named PostgreSQL schema and Redis keys; it does not reset the supplied database.
