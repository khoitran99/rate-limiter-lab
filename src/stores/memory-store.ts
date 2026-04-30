import { calculateTokenBucketDecision, type TokenBucketState } from "../core/token-bucket.js";
import type { RateLimitStore, StoreConsumeInput, StoreConsumeResult } from "../core/types.js";

export interface MemoryTokenBucketStoreOptions {
  cleanupIntervalMs?: number;
  idleTtlMs?: number;
}

interface BucketRecord extends TokenBucketState {
  lastSeenMs: number;
}

export class MemoryTokenBucketStore implements RateLimitStore {
  private readonly buckets = new Map<string, BucketRecord>();
  private readonly cleanupIntervalMs: number;
  private readonly idleTtlMs: number;
  private lastCleanupAtMs = 0;

  constructor(options: MemoryTokenBucketStoreOptions = {}) {
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
    this.idleTtlMs = options.idleTtlMs ?? 5 * 60_000;
  }

  async consume(input: StoreConsumeInput): Promise<StoreConsumeResult> {
    this.cleanup(input.nowMs);

    const previous = this.buckets.get(input.key);
    const decision = calculateTokenBucketDecision({
      ...input,
      previous: previous
        ? {
            tokens: previous.tokens,
            updatedAtMs: previous.updatedAtMs
          }
        : undefined
    });

    this.buckets.set(input.key, {
      ...decision.nextState,
      lastSeenMs: input.nowMs
    });

    return {
      allowed: decision.allowed,
      tokensBefore: decision.tokensBefore,
      tokensAfter: decision.tokensAfter,
      retryAfterMs: decision.retryAfterMs,
      resetAfterMs: decision.resetAfterMs
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  async getDebugState(key: string): Promise<unknown> {
    return this.buckets.get(key) ?? null;
  }

  size(): number {
    return this.buckets.size;
  }

  private cleanup(nowMs: number): void {
    if (nowMs - this.lastCleanupAtMs < this.cleanupIntervalMs) {
      return;
    }

    this.lastCleanupAtMs = nowMs;
    for (const [key, record] of this.buckets) {
      if (nowMs - record.lastSeenMs > this.idleTtlMs) {
        this.buckets.delete(key);
      }
    }
  }
}
