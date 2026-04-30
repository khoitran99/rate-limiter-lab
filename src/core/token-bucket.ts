import type { RateLimitPolicy, StoreConsumeResult } from "./types.js";

export interface TokenBucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface TokenBucketDecision extends StoreConsumeResult {
  nextState: TokenBucketState;
  elapsedMs: number;
}

export interface CalculateTokenBucketInput extends RateLimitPolicy {
  previous?: TokenBucketState;
  nowMs: number;
  cost: number;
}

export function validatePolicy(policy: RateLimitPolicy): void {
  if (!Number.isFinite(policy.capacity) || policy.capacity <= 0) {
    throw new Error("capacity must be a positive number");
  }

  if (!Number.isFinite(policy.refillRatePerSecond) || policy.refillRatePerSecond <= 0) {
    throw new Error("refillRatePerSecond must be a positive number");
  }
}

export function validateCost(cost: number): void {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error("cost must be a positive number");
  }
}

export function calculateTokenBucketDecision(input: CalculateTokenBucketInput): TokenBucketDecision {
  validatePolicy(input);
  validateCost(input.cost);

  const previous = input.previous ?? {
    tokens: input.capacity,
    updatedAtMs: input.nowMs
  };
  const elapsedMs = Math.max(0, input.nowMs - previous.updatedAtMs);
  const refillAmount = (elapsedMs / 1000) * input.refillRatePerSecond;
  const tokensBefore = Math.min(input.capacity, previous.tokens + refillAmount);
  const allowed = tokensBefore >= input.cost;
  const tokensAfter = allowed ? tokensBefore - input.cost : tokensBefore;
  const missingTokens = Math.max(0, input.cost - tokensAfter);
  const retryAfterMs = allowed ? 0 : Math.ceil((missingTokens / input.refillRatePerSecond) * 1000);
  const resetAfterMs = Math.ceil(((input.capacity - tokensAfter) / input.refillRatePerSecond) * 1000);

  return {
    allowed,
    tokensBefore,
    tokensAfter,
    retryAfterMs,
    resetAfterMs,
    elapsedMs,
    nextState: {
      tokens: tokensAfter,
      updatedAtMs: input.nowMs
    }
  };
}

export function roundRemainingTokens(tokens: number): number {
  return Math.max(0, Math.floor(tokens));
}
