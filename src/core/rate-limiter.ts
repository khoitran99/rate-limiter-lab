import { RateLimitExceededError, RateLimiterUnavailableError } from "./errors.js";
import { roundRemainingTokens, validateCost, validatePolicy } from "./token-bucket.js";
import type {
  CheckOptions,
  RateLimitDecision,
  RateLimiterOptions,
  RateLimiterStats
} from "./types.js";

const DEFAULT_NAMESPACE = "rate-limit";

export class RateLimiter {
  private readonly options: Required<Omit<RateLimiterOptions, "namespace">> & {
    namespace: string;
  };
  private readonly stats: RateLimiterStats = {
    totalChecks: 0,
    allowed: 0,
    denied: 0,
    storeErrors: 0,
    failOpenAllowed: 0
  };

  /**
   * Builds a limiter with one policy and one backing store.
   * Defaults favor availability: fail-open is enabled unless a route opts out.
   */
  constructor(options: RateLimiterOptions) {
    validatePolicy(options);

    this.options = {
      store: options.store,
      capacity: options.capacity,
      refillRatePerSecond: options.refillRatePerSecond,
      namespace: options.namespace ?? DEFAULT_NAMESPACE,
      failOpen: options.failOpen ?? true,
      debug: options.debug ?? false,
      now: options.now ?? Date.now
    };
  }

  /**
   * Evaluates one request against the configured bucket policy.
   * Returns a decision instead of throwing so HTTP middleware can choose how to respond.
   */
  async check(key: string, checkOptions: CheckOptions = {}): Promise<RateLimitDecision> {
    const cost = checkOptions.cost ?? 1;
    validateCost(cost);
    this.stats.totalChecks += 1;

    const nowMs = this.options.now();
    const bucketKey = this.bucketKey(key);

    try {
      const consumed = await this.options.store.consume({
        key: bucketKey,
        capacity: this.options.capacity,
        refillRatePerSecond: this.options.refillRatePerSecond,
        cost,
        nowMs
      });

      const decision: RateLimitDecision = {
        ...consumed,
        key,
        limit: this.options.capacity,
        remaining: roundRemainingTokens(consumed.tokensAfter),
        resetAtMs: nowMs + consumed.resetAfterMs,
        nowMs,
        cost,
        decisionSource: "store",
        debug: this.options.debug
          ? {
              bucketKey,
              capacity: this.options.capacity,
              refillRatePerSecond: this.options.refillRatePerSecond
            }
          : undefined
      };

      this.recordDecision(decision);
      return decision;
    } catch (error) {
      this.stats.storeErrors += 1;

      if (!this.options.failOpen) {
        throw new RateLimiterUnavailableError(
          error instanceof Error ? error.message : "Rate limiter store failed"
        );
      }

      const decision: RateLimitDecision = {
        allowed: true,
        key,
        limit: this.options.capacity,
        remaining: this.options.capacity,
        tokensBefore: this.options.capacity,
        tokensAfter: this.options.capacity,
        retryAfterMs: 0,
        resetAfterMs: 0,
        resetAtMs: nowMs,
        nowMs,
        cost,
        decisionSource: "fail-open",
        debug: this.options.debug
          ? {
              bucketKey,
              capacity: this.options.capacity,
              refillRatePerSecond: this.options.refillRatePerSecond,
              failureReason: error instanceof Error ? error.message : String(error)
            }
          : undefined
      };

      this.stats.allowed += 1;
      this.stats.failOpenAllowed += 1;
      return decision;
    }
  }

  /**
   * Convenience wrapper for callers that prefer exception-based control flow.
   * Throws RateLimitExceededError when the request is throttled.
   */
  async assertAllowed(key: string, options: CheckOptions = {}): Promise<RateLimitDecision> {
    const decision = await this.check(key, options);
    if (!decision.allowed) {
      throw new RateLimitExceededError(decision);
    }

    return decision;
  }

  /**
   * Returns a defensive copy of runtime counters for debug endpoints and observability.
   */
  getStats(): RateLimiterStats {
    return { ...this.stats };
  }

  /**
   * Exposes the active policy without leaking the internal store or clock implementation.
   */
  getPolicy() {
    return {
      capacity: this.options.capacity,
      refillRatePerSecond: this.options.refillRatePerSecond,
      namespace: this.options.namespace,
      failOpen: this.options.failOpen,
      debug: this.options.debug
    };
  }

  /**
   * Adds the limiter namespace so different routes can share a store without sharing buckets.
   */
  private bucketKey(key: string): string {
    return `${this.options.namespace}:${key}`;
  }

  /**
   * Updates success and throttle counters after a store-backed decision.
   */
  private recordDecision(decision: RateLimitDecision): void {
    if (decision.allowed) {
      this.stats.allowed += 1;
      return;
    }

    this.stats.denied += 1;
  }
}
