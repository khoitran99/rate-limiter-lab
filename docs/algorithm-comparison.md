# Algorithm Comparison

## Token Bucket

Token bucket keeps one small state record per key: current tokens and last update time. That makes it memory-light and fast. It also supports bursts, because a full bucket lets several requests pass immediately.

This project uses token bucket because it matches the main requirements:

- accurate enough to stop excessive traffic,
- low latency,
- low memory,
- distributed support with one Redis Lua command,
- simple debug output for learning.

## Fixed Window Counter

Fixed window counts requests in a time window, such as `100 requests per minute`. It is simple and memory-light, but it has a boundary problem. A client can send 100 requests at the end of one minute and 100 more at the start of the next minute, causing a short burst of 200 requests.

Fixed window is useful for simple quotas, but it is less smooth for user-facing APIs.

## Sliding Window Counter

Sliding window counter approximates a rolling window by weighting the previous and current fixed windows. It is smoother than fixed window and still memory-light, but it is approximate.

Sliding window counter is a good choice when teams want a "requests per rolling minute" mental model and can accept approximation.

## Sliding Log

Sliding log stores timestamps for each request and removes old timestamps outside the window. It is very accurate, but it uses more memory and does more work for busy keys.

Sliding log is useful for strict audit-style limits, but it is usually too expensive for high-throughput API rate limiting.

## Why Redis Lua

Distributed rate limiting needs atomic read-modify-write behavior. Without atomicity, two servers can read the same bucket state, both decide a request is allowed, and over-allow traffic.

The Redis store runs refill, consume, state update, and TTL update inside one Lua command. Redis executes that script atomically, so all app instances share a consistent bucket.
