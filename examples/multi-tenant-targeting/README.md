# NestJS tenant and attribute targeting: runnable example

`GET /checkout` evaluates `EXAMPLE_CHECKOUT` with explicit tenant, user, country, and plan context. Its seed leaves the global flag disabled and adds one enabled override matching **both** `tenantId: tenant-acme` and `plan: pro`.

## Run the current checkout

Requirements: Node.js 20.19+, 22.12+, or 24+, npm, and a local PostgreSQL development database. From the repository root:

```bash
npm ci
npm run build
npm pack
npm run docker:up
cd examples/multi-tenant-targeting
npm install ../../nestarc-feature-flag-0.6.0.tgz
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
npm run prisma:generate
npm run db:migrate
npm run build
npm run seed
PORT=3002 npm start
```

Skip `docker:up` and replace `DATABASE_URL` if you already have a local PostgreSQL database. Migrations and the seed modify that development database. In another terminal:

```bash
curl -s http://127.0.0.1:3002/checkout \
  -H 'x-tenant-id: tenant-acme' -H 'x-plan: pro'
# {"version":"new"}

curl -s http://127.0.0.1:3002/checkout \
  -H 'x-tenant-id: tenant-acme' -H 'x-plan: free'
# {"version":"classic"}

curl -s http://127.0.0.1:3002/checkout \
  -H 'x-tenant-id: tenant-other' -H 'x-plan: pro'
# {"version":"classic"}

curl -s http://127.0.0.1:3002/checkout
# {"version":"classic"}
```

The package uses an explicitly supplied `tenantId` without requiring a tenancy integration. The override requires every stored attribute to match. `x-user-id` and `x-country` are also forwarded but this seed does not restrict them. Headers are convenient demo inputs; production code should obtain trusted tenant and user identity from authentication middleware.

Caching is disabled here so repeat seeding is immediately visible. `npm run seed` resets only `EXAMPLE_CHECKOUT` and its overrides. `npm run seed -- cleanup` removes only that fixture flag and its overrides.

## Standalone files and verification

Copy this entire directory elsewhere and run `npm install` to consume the declared package version, then continue from the database environment command. To verify local library changes, install the packed archive as above. Local Prisma configuration reads `prisma/schema.prisma` and `prisma/migrations`; the generated client lives inside `src/generated/prisma` and is included in `npm run build`. No root repository imports or Nest CLI are needed.

The copied migrations include database constraints not represented completely by the Prisma schema. Run `db:migrate` instead of substituting `prisma db push`.

From the repository root, `npm run verify:examples -- --build-only` checks standalone generation and compilation against the packed package. `DATABASE_URL=... REDIS_URL=... npm run verify:examples` also asserts all four responses above in an isolated PostgreSQL schema, then cleans up the schema and its own Redis keys.
