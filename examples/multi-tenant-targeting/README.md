# Multi-Tenant Targeting Example

The `file:../..` dependency is for running this example inside the repository. If you copy it into another project, replace it with the published `@nestarc/feature-flag` version.

This example uses this package's Prisma schema and migrations through `prisma.config.ts`. Set `DATABASE_URL`, run `npx prisma migrate deploy`, and generate the client with `npx prisma generate` before starting the app.

Create an override with your Admin API or service:

```http
POST /feature-flags/NEW_CHECKOUT/overrides
Content-Type: application/json

{
  "attributes": {
    "tenantId": "tenant-1",
    "plan": "pro",
    "country": "KR"
  },
  "enabled": true,
  "priority": 10
}
```

Evaluate with a hybrid context:

```ts
await flags.isEnabled('NEW_CHECKOUT', {
  userId: 'user-1',
  tenantId: 'tenant-1',
  attributes: {
    plan: 'pro',
    country: 'KR'
  }
});
```
