# NestJS Redis cache invalidation and events: runnable example

Run two local app processes against the same PostgreSQL database and Redis namespace. Warm a cached disabled flag in both, update it through process A, then evaluate through process B. The example also reports Nest evaluation and mutation events.

## Install, migrate, and seed

Requirements: Node.js 20.19+, 22.12+, or 24+, npm, PostgreSQL, and Redis. Run from the repository root:

```bash
npm ci
npm run build
npm pack
npm run docker:up
cd examples/redis-events
npm install ../../nestarc-feature-flag-0.6.0.tgz
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
export REDIS_URL='redis://localhost:6399'
npm run prisma:generate
npm run db:migrate
npm run build
npm run seed -- off
```

Skip the container commands and set the URLs if you already run local development services. Migrations and the seed modify the selected database. Seed before starting the processes: this seed writes directly to Prisma, so re-seeding a running cached app is not a substitute for a service mutation.

## Start two processes

In two terminals inside this example directory, export the same `DATABASE_URL`, `REDIS_URL`, and `DEMO_TOKEN`, then start one process per terminal:

```bash
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
export REDIS_URL='redis://localhost:6399'
export DEMO_TOKEN='local-example-token'
PORT=3000 npm start
```

```bash
export DATABASE_URL='postgresql://test:test@localhost:5499/feature_flag_test'
export REDIS_URL='redis://localhost:6399'
export DEMO_TOKEN='local-example-token'
PORT=3001 npm start
```

The app binds only to `127.0.0.1`, requires a nonempty `DEMO_TOKEN`, and refuses to start with `NODE_ENV=production`. The fixed demo mutation endpoint requires `x-demo-token`; it is a local learning tool. A deployed management API needs your application's authentication and authorization policy.

## Observe requests and events

In a third terminal:

```bash
curl -s http://127.0.0.1:3000/demo/evaluate
# {"enabled":false,"instance":"3000"}
curl -s http://127.0.0.1:3001/demo/evaluate
# {"enabled":false,"instance":"3001"}

curl -i -X POST http://127.0.0.1:3000/demo/flag \
  -H 'content-type: application/json' \
  -H 'x-demo-token: local-example-token' \
  -d '{"enabled":true}'
# HTTP 201, {"enabled":true}

curl -s http://127.0.0.1:3001/demo/evaluate
# {"enabled":true,"instance":"3001"} after successful invalidation

curl -s http://127.0.0.1:3000/demo/events
# {"evaluated":1,"updated":1} for the requests above
curl -s http://127.0.0.1:3001/demo/events
# {"evaluated":2,"updated":0} for the requests above
```

The update calls `FeatureFlagService.update`, which writes the database and invalidates the shared Redis cache. The adapter also publishes invalidation messages. This demonstrates the successful path, not strict consistency during Redis failures or concurrent writes. Cache TTL is 60 seconds in this example. Omitting the mutation token returns HTTP 401; an invalid `enabled` value returns HTTP 400.

Each process logs evaluated events. The updated event appears only in the process that performs the mutation: Nest events are local; Redis invalidation does not forward application events. `/demo/events` counters accumulate for the lifetime of each process.

## Configuration, portability, and cleanup

The default Redis namespace is `feature-flag-example:` and the channel is `feature-flag-example:invalidate`. To isolate runs, set identical `EXAMPLE_REDIS_PREFIX` and `EXAMPLE_REDIS_CHANNEL` in both processes. `EXAMPLE_FLAG_KEY` optionally changes the fixture key; by default it is `EXAMPLE_REDIS`.

After 0.6.0 is published, copy this directory anywhere and run `npm install` to use the declared package version. Until publication, install the packed 0.6.0 archive above. Prisma schema, migrations, and generated client paths are local. Run `db:migrate` to preserve the copied migrations' JSONB uniqueness and non-empty attributes constraints. `npm run build` compiles the app and generated client; no Nest CLI is required.

Stop both processes before `npm run seed -- cleanup`, which removes only the example flag and its overrides. Its cached value expires within the 60-second TTL. Stop the repository test services with `npm run docker:down` from the repository root when finished.

From the repository root, `DATABASE_URL=... REDIS_URL=... npm run verify:examples` installs the packed library into independent temporary consumers and asserts both processes, cache refresh before TTL expiry, token checks, and event counters. It uses a randomly named PostgreSQL schema and Redis namespace and deletes only its own resources. `npm run verify:examples -- --build-only` checks installation, Prisma generation, and compilation without database services.
