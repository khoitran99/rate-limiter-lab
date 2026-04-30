# Failure Modes

Production rate limiters sit on the request path, so store failures must be handled deliberately.

## Default: Fail Open

The default `RateLimiter` behavior is fail-open. If Redis is unavailable or the store throws, the limiter allows the request and records the failure in stats.

Fail-open protects availability. The service keeps serving traffic even when the cache layer is degraded.

In a fail-open decision:

```json
{
  "allowed": true,
  "decisionSource": "fail-open",
  "debug": {
    "failureReason": "store offline"
  }
}
```

Use `/debug/limiter` to watch `storeErrors` and `failOpenAllowed`.

## Optional: Fail Closed

Some sensitive endpoints, such as login, password reset, or payment confirmation, may prefer fail-closed behavior. In this project, `POST /api/login` is configured with `failOpen: false`.

When the store fails in fail-closed mode, `RateLimiter` throws `RateLimiterUnavailableError`, and the Express error handler returns HTTP `503`.

## Redis Offline at Startup

The server tries to connect to Redis during startup. If Redis is down, startup continues. Fail-open routes continue serving, while fail-closed routes return `503` until Redis becomes usable.

## Redis Offline During Traffic

The Redis client is configured with:

```text
maxRetriesPerRequest = 1
enableOfflineQueue = false
```

This keeps latency bounded. Requests should fail quickly into the limiter fallback path instead of waiting behind an offline queue.

## Memory Store Caveat

The memory store is useful for local development and tests, but it is process-local. Multiple Node processes will each have separate buckets, so memory mode is not distributed.

Use Redis mode when running multiple server instances.
