export type DecisionSource = "store" | "fail-open";

export interface RateLimitPolicy {
  capacity: number;
  refillRatePerSecond: number;
}

export interface StoreConsumeInput extends RateLimitPolicy {
  key: string;
  cost: number;
  nowMs: number;
}

export interface StoreConsumeResult {
  allowed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  retryAfterMs: number;
  resetAfterMs: number;
}

export interface RateLimitDecision extends StoreConsumeResult {
  key: string;
  limit: number;
  remaining: number;
  resetAtMs: number;
  nowMs: number;
  cost: number;
  decisionSource: DecisionSource;
  debug?: RateLimitDebugInfo;
}

export interface RateLimitDebugInfo {
  bucketKey: string;
  capacity: number;
  refillRatePerSecond: number;
  elapsedMs?: number;
  failureReason?: string;
}

export interface RateLimiterStats {
  totalChecks: number;
  allowed: number;
  denied: number;
  storeErrors: number;
  failOpenAllowed: number;
}

export interface RateLimitStore {
  consume(input: StoreConsumeInput): Promise<StoreConsumeResult>;
  reset?(key: string): Promise<void>;
  getDebugState?(key: string): Promise<unknown>;
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  capacity: number;
  refillRatePerSecond: number;
  namespace?: string;
  failOpen?: boolean;
  debug?: boolean;
  now?: () => number;
}

export interface CheckOptions {
  cost?: number;
}
