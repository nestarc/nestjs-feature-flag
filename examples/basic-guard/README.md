# Basic Guard Example

This example gates a controller route with `@FeatureFlag('NEW_DASHBOARD')`.

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
