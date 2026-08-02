# Redis Cache and Events Example

This example wires `RedisCacheAdapter` for multi-instance cache invalidation and subscribes to `FeatureFlagEvents.EVALUATED`.

The `file:../..` dependency is for running this example inside the repository. If you copy it into another project, replace it with the published `@nestarc/feature-flag` version.

This example uses this package's Prisma 7 schema and migrations through `prisma.config.ts`. Set `DATABASE_URL`, run `npx prisma migrate deploy`, and generate the client with `npx prisma generate` before starting the app. The generated client is shared at `../../generated/prisma` when the example runs inside this repository.

Run Redis locally:

```bash
docker run --rm -p 6379:6379 redis:7
```

The app uses `REDIS_URL` when it is present and falls back to `redis://localhost:6379`.
