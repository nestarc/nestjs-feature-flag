# Redis Cache and Events Example

This example wires `RedisCacheAdapter` for multi-instance cache invalidation and subscribes to `FeatureFlagEvents.EVALUATED`.

Run Redis locally:

```bash
docker run --rm -p 6379:6379 redis:7
```

The app uses `REDIS_URL` when it is present and falls back to `redis://localhost:6379`.
