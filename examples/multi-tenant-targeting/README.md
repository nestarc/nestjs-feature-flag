# Multi-Tenant Targeting Example

Create an override through the Admin API:

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
