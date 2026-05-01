# Manual Testing Scenarios

This guide is a hands-on runbook for manually testing Rate Limiter Lab from the terminal. It focuses on visible behavior: HTTP status codes, rate limit headers, JSON responses, debug stats, Redis behavior, and failure modes.

## Prerequisites

Install dependencies:

```bash
npm install
```

Use one terminal for the API server and another terminal for test requests.

For predictable local testing without Redis, start the server in memory mode:

```bash
RATE_LIMIT_STORE=memory RATE_LIMIT_DEBUG=true npm run dev
```

For distributed Redis testing, start Redis first:

```bash
npm run redis:up
RATE_LIMIT_STORE=redis RATE_LIMIT_DEBUG=true npm run dev
```

The examples below assume the API is available at:

```text
http://localhost:3000
```

## Quick Health Check

Run:

```bash
curl -i http://localhost:3000/health
```

Expected result:

- HTTP status is `200`.
- Body includes `ok: true`.
- Body includes the active store, such as `MemoryTokenBucketStore` or `RedisTokenBucketStore`.
- Body includes the `public`, `auth`, and `user` policies.

Also check debug stats:

```bash
curl -i http://localhost:3000/debug/limiter
```

Expected result:

- HTTP status is `200`.
- Body includes `stats` for each limiter.
- On a fresh server, counters should start near zero.

## Scenario 1: Public API Allows Requests Under The Limit

The public route uses capacity `5`, refill `1 token/sec`, and fail-open mode.

Run:

```bash
curl -i http://localhost:3000/api/public
```

Expected result:

- HTTP status is `200`.
- Response includes `RateLimit-Limit: 5`.
- Response includes `RateLimit-Remaining`.
- Response includes `RateLimit-Reset`.
- Body includes `rateLimit.allowed: true`.
- Body includes `rateLimit.decisionSource: "store"`.

Look for headers similar to:

```text
RateLimit-Limit: 5
RateLimit-Remaining: 4
RateLimit-Reset: 1777509691
```

## Scenario 2: Public API Throttles A Burst

Send six immediate requests. The first five should consume the bucket, and the sixth should be throttled.

Run:

```bash
for i in 1 2 3 4 5 6; do
  echo "\n--- request $i ---"
  curl -sS -i http://localhost:3000/api/public | sed -n '1,12p'
done
```

Expected result:

- Requests `1` through `5` return `200`.
- Request `6` returns `429`.
- The throttled response includes `Retry-After`.
- The throttled response includes `RateLimit-Remaining: 0`.

To inspect the throttled body, run one more request immediately:

```bash
curl -sS http://localhost:3000/api/public | jq .
```

Expected JSON shape:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded for key \"::1\". Retry after 1s.",
  "key": "::1",
  "limit": 5,
  "remaining": 0,
  "retryAfterMs": 1000,
  "resetAt": "2026-04-30T00:41:30.155Z"
}
```

The exact key and timestamps may differ by machine and network stack.

## Scenario 3: Public API Refills Over Time

After exhausting `/api/public`, wait for refill.

Run:

```bash
sleep 2
curl -i http://localhost:3000/api/public
```

Expected result:

- HTTP status returns to `200`.
- `RateLimit-Remaining` is greater than or equal to `0`.
- Body has `rateLimit.allowed: true`.

Explanation:

The public route refills `1 token/sec`, so a two-second wait should restore about two tokens, capped by the bucket capacity.

## Scenario 4: User Keys Are Isolated

The profile route uses `x-user-id` when present, so different users get separate buckets.

Run:

```bash
for i in 1 2 3 4 5; do
  echo "\n--- alice request $i ---"
  curl -sS -i -H "x-user-id: alice" http://localhost:3000/api/profile | sed -n '1,12p'
done
```

Expected result:

- Alice should eventually receive `429` after exhausting her bucket.
- The profile route has capacity `4`, so the fifth immediate request should be throttled.

Now test another user:

```bash
curl -i -H "x-user-id: bob" http://localhost:3000/api/profile
```

Expected result:

- Bob receives `200`.
- Bob is not affected by Alice's exhausted bucket.
- Body includes `key: "user:bob"`.

## Scenario 5: IP Fallback Key Works

When `x-user-id` is missing, `/api/profile` falls back to IP.

Run:

```bash
curl -i http://localhost:3000/api/profile
```

Expected result:

- HTTP status is `200` unless the IP bucket is already exhausted.
- Body includes a key starting with `ip:`.

Example:

```json
{
  "key": "ip:::1"
}
```

## Scenario 6: Auth Route Uses A Stricter Policy

The login route uses capacity `3`, refill `0.2 token/sec`, and fail-closed mode.

Run:

```bash
for i in 1 2 3 4; do
  echo "\n--- login request $i ---"
  curl -sS -i -X POST http://localhost:3000/api/login | sed -n '1,14p'
done
```

Expected result:

- Requests `1` through `3` return `200`.
- Request `4` returns `429`.
- The `Retry-After` value is around `5` seconds because refill is `0.2 token/sec`.

## Scenario 7: Debug Stats Reflect Traffic

After running burst tests, inspect limiter stats.

Run:

```bash
curl -sS http://localhost:3000/debug/limiter | jq .
```

Expected result:

- `stats.public.totalChecks` increased after `/api/public` requests.
- `stats.public.denied` increased after public throttling.
- `stats.auth.denied` increased after login throttling.
- `stats.user.denied` increased after profile throttling.

If `jq` is unavailable, use:

```bash
curl -sS http://localhost:3000/debug/limiter
```

## Scenario 8: Learning Scripts Match HTTP Behavior

Run the standalone burst scenario:

```bash
npm run scenario:burst
```

Expected result:

- Requests `1` through `5` show `allowed: true`.
- Requests `6` through `8` show `allowed: false`.
- Output includes `tokensBefore`, `tokensAfter`, `remaining`, and `retryAfterMs`.

Run the steady refill scenario:

```bash
npm run scenario:steady
```

Expected result:

- Most or all requests are allowed because the script waits between requests.
- Token values change gradually instead of jumping by fixed windows.

Run the multi-user scenario:

```bash
npm run scenario:multi-user
```

Expected result:

- `user:alice` can be throttled without throttling `user:bob` or `user:carol`.

## Scenario 9: Redis Store Runs Distributed State

Start Redis mode:

```bash
npm run redis:up
RATE_LIMIT_STORE=redis RATE_LIMIT_DEBUG=true npm run dev
```

In another terminal, run:

```bash
curl -i http://localhost:3000/api/public
curl -i http://localhost:3000/api/public
curl -sS http://localhost:3000/debug/limiter | jq .
```

Expected result:

- Requests behave the same as memory mode.
- `/health` shows `RedisTokenBucketStore`.
- Debug stats increase normally.

Optionally inspect Redis keys:

```bash
docker compose exec redis redis-cli keys 'rate-limiter-lab:*'
```

Expected result:

- Redis contains namespaced bucket keys.
- Keys expire after enough idle time because the Redis store sets `PEXPIRE`.

## Scenario 10: Redis Outage In Fail-Open Mode

Start the API in Redis mode with Redis running:

```bash
npm run redis:up
RATE_LIMIT_STORE=redis RATE_LIMIT_DEBUG=true npm run dev
```

Confirm public route works:

```bash
curl -i http://localhost:3000/api/public
```

Now stop Redis in another terminal:

```bash
npm run redis:down
```

Call the fail-open public route:

```bash
curl -i http://localhost:3000/api/public
```

Expected result:

- Public route still returns `200`.
- Body includes `rateLimit.decisionSource: "fail-open"`.
- Debug data includes a `failureReason`.
- `/debug/limiter` shows `storeErrors` and `failOpenAllowed` increased.

## Scenario 11: Redis Outage In Fail-Closed Mode

With Redis still down, call the auth route:

```bash
curl -i -X POST http://localhost:3000/api/login
```

Expected result:

- HTTP status is `503`.
- Body includes `error: "rate_limiter_unavailable"`.
- This happens because `/api/login` is configured with `failOpen: false`.

## Scenario 12: Optional Live Redis Test

Run the live Redis-backed test suite:

```bash
npm run redis:up
RUN_REDIS_TESTS=true npm test
```

Expected result:

- The Redis store live test runs instead of being skipped.
- The full test suite passes.

## Cleanup

Stop the dev server with `Ctrl+C`.

Stop Redis:

```bash
npm run redis:down
```

## Troubleshooting

If `curl` cannot connect:

- Confirm the dev server is running.
- Confirm the server is listening on port `3000`.
- If port `3000` is busy, start with another port:

```bash
PORT=3001 RATE_LIMIT_STORE=memory RATE_LIMIT_DEBUG=true npm run dev
```

Then use `http://localhost:3001` in requests.

If `jq` is not installed:

- Remove `| jq .` from commands.
- The API still returns JSON; it will just be unformatted.

If Redis mode is slow or returns fail-open decisions:

- Check Redis is running with `docker compose ps`.
- Restart Redis with `npm run redis:down && npm run redis:up`.
- Check `/health` to confirm which store the API is using.

If results differ from expected counts:

- Rate limiter state is time-based and buckets refill continuously.
- Restart the dev server to reset memory buckets.
- For Redis mode, run `npm run redis:down && npm run redis:up` to reset Redis state.
