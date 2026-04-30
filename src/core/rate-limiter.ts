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

  async assertAllowed(key: string, options: CheckOptions = {}): Promise<RateLimitDecision> {
    const decision = await this.check(key, options);
    if (!decision.allowed) {
      throw new RateLimitExceededError(decision);
    }

    return decision;
  }

  getStats(): RateLimiterStats {
    return { ...this.stats };
  }

  getPolicy() {
    return {
      capacity: this.options.capacity,
      refillRatePerSecond: this.options.refillRatePerSecond,
      namespace: this.options.namespace,
      failOpen: this.options.failOpen,
      debug: this.options.debug
    };
  }

  private bucketKey(key: string): string {
    return `${this.options.namespace}:${key}`;
  }

  private recordDecision(decision: RateLimitDecision): void {
    if (decision.allowed) {
      this.stats.allowed += 1;
      return;
    }

    this.stats.denied += 1;
  }
}
