import { describe, expect, it } from "vitest";
import { RateLimiterUnavailableError } from "../../src/core/errors.js";
import { RateLimiter } from "../../src/core/rate-limiter.js";
import type {
  RateLimitStore,
  StoreConsumeInput,
  StoreConsumeResult
} from "../../src/core/types.js";
import { MemoryTokenBucketStore } from "../../src/stores/memory-store.js";

class FailingStore implements RateLimitStore {
  async consume(_input: StoreConsumeInput): Promise<StoreConsumeResult> {
    throw new Error("store offline");
  }
}

describe("RateLimiter", () => {
  it("returns denied decisions when a bucket is exhausted", async () => {
    let nowMs = 0;
    const limiter = new RateLimiter({
      store: new MemoryTokenBucketStore(),
      capacity: 1,
      refillRatePerSecond: 1,
      now: () => nowMs
    });

    await expect(limiter.check("client-a")).resolves.toMatchObject({
      allowed: true,
      remaining: 0
    });

    await expect(limiter.check("client-a")).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000
    });

    nowMs = 1000;
    await expect(limiter.check("client-a")).resolves.toMatchObject({
      allowed: true
    });
  });

  it("fails open by default when the store is unavailable", async () => {
    const limiter = new RateLimiter({
      store: new FailingStore(),
      capacity: 10,
      refillRatePerSecond: 1,
      debug: true
    });

    const decision = await limiter.check("client-a");

    expect(decision.allowed).toBe(true);
    expect(decision.decisionSource).toBe("fail-open");
    expect(decision.debug?.failureReason).toBe("store offline");
    expect(limiter.getStats()).toMatchObject({
      storeErrors: 1,
      failOpenAllowed: 1
    });
  });

  it("can fail closed for sensitive routes", async () => {
    const limiter = new RateLimiter({
      store: new FailingStore(),
      capacity: 10,
      refillRatePerSecond: 1,
      failOpen: false
    });

    await expect(limiter.check("client-a")).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});
