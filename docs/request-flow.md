# Request Flow

This project uses a token bucket limiter. Each key, such as an IP address or user ID, owns a bucket. The bucket has a maximum `capacity` and refills at `refillRatePerSecond`.

## One Request

1. Express receives the HTTP request.
2. The middleware resolves a limiter key. The default key is the client IP, while demo routes can use headers such as `x-user-id`.
3. The middleware asks `RateLimiter.check(key)` for a decision.
4. `RateLimiter` adds the route namespace to the key, validates the request cost, and calls the configured store.
5. The store refills the bucket based on elapsed time.
6. If enough tokens exist, the store consumes the request cost and returns `allowed: true`.
7. If not enough tokens exist, the store keeps the current tokens and returns `allowed: false` with `retryAfterMs`.
8. The middleware writes `RateLimit-*` headers.
9. Allowed requests continue to the route handler. Denied requests become a `RateLimitExceededError`, and the error handler returns HTTP `429`.

## Token Bucket Example

Assume:

```text
capacity = 5
refillRatePerSecond = 1
cost = 1
```

Five immediate requests are allowed because the bucket starts full. The sixth immediate request is denied because the bucket has no tokens left. After one second, one token refills and one more request can pass.

## Headers

Every checked response includes:

```text
RateLimit-Limit      Maximum bucket capacity
RateLimit-Remaining  Whole tokens remaining after this request
RateLimit-Reset      Unix timestamp when the bucket is expected to be full
```

Throttled responses also include:

```text
Retry-After          Seconds until the next request can likely pass
```

## Debug Fields

When `debug` is enabled, each decision can include:

```text
bucketKey            Namespaced key used by the store
capacity             Bucket capacity
refillRatePerSecond  Token refill speed
failureReason        Store failure message when fail-open was used
```

The demo API returns this information in route responses and `/debug/limiter`.
