# Rate Limiter Lab

Production-grade rate limiter learning project built with TypeScript, Express, Redis, and a token bucket algorithm.

The project is intentionally split into a reusable library and a demo API. The library shows the production path: a small `RateLimiter` core, a pluggable `RateLimitStore`, Redis Lua for distributed atomic updates, explicit throttling errors, and fail-open behavior when the backing store is unavailable. The demo API and scripts show the flow step by step.

## Quick Start

```bash
npm install
npm run redis:up
npm run dev
```

The API starts on `http://localhost:3000`.

Useful requests:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/debug/limiter
curl -i http://localhost:3000/api/public
curl -i -X POST http://localhost:3000/api/login
curl -i -H "x-user-id: alice" http://localhost:3000/api/profile
```

Use memory mode when you want to run without Redis:

```bash
RATE_LIMIT_STORE=memory npm run dev
```

Enable debug traces:

```bash
RATE_LIMIT_DEBUG=true npm run dev
```

## Project Shape

```text
src/core        Reusable rate limiter, token bucket math, errors, and public types
src/stores      Memory and Redis store implementations
src/http        Express middleware and error handler
src/demo        Demo HTTP app with multiple policies
scripts         Learning scenarios that print limiter decisions
tests           Unit, middleware, store, and fault-tolerance tests
docs            Request flow, algorithm comparison, and failure-mode notes
```

## Public API

```ts
import {
  MemoryTokenBucketStore,
  RateLimiter,
  createRateLimitMiddleware
} from "./src/index.js";

const limiter = new RateLimiter({
  store: new MemoryTokenBucketStore(),
  capacity: 100,
  refillRatePerSecond: 10,
  namespace: "api",
  failOpen: true,
  debug: true
});

app.use(
  createRateLimitMiddleware({
    limiter,
    keyResolver: (req) => req.header("x-user-id") ?? req.ip ?? "anonymous"
  })
);
```

## Demo Routes

`GET /api/public` uses a normal public API policy: capacity `5`, refill `1 token/sec`, fail-open enabled.

`POST /api/login` uses a stricter auth policy: capacity `3`, refill `0.2 token/sec`, fail-closed enabled. This shows how sensitive routes can reject traffic when the limiter store is unavailable.

`GET /api/profile` uses `x-user-id` when present and falls back to IP. This shows how key choice changes fairness.

`GET /debug/limiter` returns limiter stats and policies so you can inspect total checks, allowed requests, denied requests, store errors, and fail-open allows.

## Scenarios

```bash
npm run scenario:burst
npm run scenario:steady
npm run scenario:multi-user
npm run scenario:redis-outage
npm run scenario:compare-stores
```

These scenarios print every limiter decision with tokens before, tokens after, retry timing, and the decision source.

## Verification

```bash
npm test
npm run build
```

Redis integration is optional in the default test run. To run the live Redis test:

```bash
npm run redis:up
RUN_REDIS_TESTS=true npm test
```

## Further Reading

- [New developer guide](docs/new-developer-guide.md)
- [Manual testing scenarios](docs/manual-testing-scenarios.md)
- [Request flow](docs/request-flow.md)
- [Algorithm comparison](docs/algorithm-comparison.md)
- [Failure modes](docs/failure-modes.md)
