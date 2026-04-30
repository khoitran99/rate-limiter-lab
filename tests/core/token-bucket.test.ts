import { describe, expect, it } from "vitest";
import { calculateTokenBucketDecision } from "../../src/core/token-bucket.js";

describe("calculateTokenBucketDecision", () => {
  it("allows a request when a new bucket has enough tokens", () => {
    const decision = calculateTokenBucketDecision({
      capacity: 3,
      refillRatePerSecond: 1,
      nowMs: 0,
      cost: 1
    });

    expect(decision.allowed).toBe(true);
    expect(decision.tokensBefore).toBe(3);
    expect(decision.tokensAfter).toBe(2);
    expect(decision.retryAfterMs).toBe(0);
    expect(decision.resetAfterMs).toBe(1000);
  });

  it("denies when the bucket lacks enough tokens and reports retry timing", () => {
    const decision = calculateTokenBucketDecision({
      capacity: 3,
      refillRatePerSecond: 2,
      previous: {
        tokens: 0,
        updatedAtMs: 0
      },
      nowMs: 100,
      cost: 1
    });

    expect(decision.allowed).toBe(false);
    expect(decision.tokensBefore).toBeCloseTo(0.2);
    expect(decision.tokensAfter).toBeCloseTo(0.2);
    expect(decision.retryAfterMs).toBe(400);
  });

  it("refills based on elapsed time but never above capacity", () => {
    const decision = calculateTokenBucketDecision({
      capacity: 5,
      refillRatePerSecond: 1,
      previous: {
        tokens: 4,
        updatedAtMs: 0
      },
      nowMs: 10_000,
      cost: 2
    });

    expect(decision.allowed).toBe(true);
    expect(decision.tokensBefore).toBe(5);
    expect(decision.tokensAfter).toBe(3);
  });

  it("handles exact boundary timing when one token refills", () => {
    const decision = calculateTokenBucketDecision({
      capacity: 1,
      refillRatePerSecond: 1,
      previous: {
        tokens: 0,
        updatedAtMs: 0
      },
      nowMs: 1000,
      cost: 1
    });

    expect(decision.allowed).toBe(true);
    expect(decision.tokensBefore).toBe(1);
    expect(decision.tokensAfter).toBe(0);
  });
});
