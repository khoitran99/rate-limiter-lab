import type { RateLimitDecision } from "./types.js";

export class RateLimitExceededError extends Error {
  readonly statusCode = 429;
  readonly decision: RateLimitDecision;

  constructor(decision: RateLimitDecision) {
    const retrySeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    super(`Rate limit exceeded for key "${decision.key}". Retry after ${retrySeconds}s.`);
    this.name = "RateLimitExceededError";
    this.decision = decision;
  }

  toJSON() {
    return {
      error: "rate_limit_exceeded",
      message: this.message,
      key: this.decision.key,
      limit: this.decision.limit,
      remaining: this.decision.remaining,
      retryAfterMs: this.decision.retryAfterMs,
      resetAt: new Date(this.decision.resetAtMs).toISOString()
    };
  }
}

export class RateLimiterUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(message = "Rate limiter is unavailable and fail-open is disabled.") {
    super(message);
    this.name = "RateLimiterUnavailableError";
  }
}
