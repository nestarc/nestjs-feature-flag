# Basic Guard Example

This example gates a controller route with `@FeatureFlag('NEW_DASHBOARD')`.

The `file:../..` dependency is for running this example inside the repository. If you copy it into another project, replace it with the published `@nestarc/feature-flag` version.

This example uses this package's Prisma 7 schema and migrations through `prisma.config.ts`. Set `DATABASE_URL`, run `npx prisma migrate deploy`, and generate the client with `npx prisma generate` before starting the app. The generated client is shared at `../../generated/prisma` when the example runs inside this repository.

Seed one flag before calling `GET /dashboard`:

```ts
await prisma.featureFlag.create({
  data: {
    key: 'NEW_DASHBOARD',
    enabled: true,
    percentage: 0,
    metadata: {},
  },
});
```
