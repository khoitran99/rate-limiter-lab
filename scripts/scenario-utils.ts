import { Redis } from "ioredis";
import { RateLimiter } from "../src/core/rate-limiter.js";
import type {
  RateLimitDecision,
  RateLimitStore,
  StoreConsumeInput,
  StoreConsumeResult
} from "../src/core/types.js";
import { MemoryTokenBucketStore } from "../src/stores/memory-store.js";
import { RedisTokenBucketStore } from "../src/stores/redis-store.js";

export class FailingStore implements RateLimitStore {
  async consume(_input: StoreConsumeInput): Promise<StoreConsumeResult> {
    throw new Error("simulated cache outage");
  }
}

export function createMemoryLimiter(namespace: string, capacity = 5, refillRatePerSecond = 1) {
  return new RateLimiter({
    store: new MemoryTokenBucketStore(),
    namespace,
    capacity,
    refillRatePerSecond,
    debug: true
  });
}

export async function createRedisLimiter(namespace: string, capacity = 5, refillRatePerSecond = 1) {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 500,
    retryStrategy: () => null
  });
  redis.on("error", () => {});

  try {
    await redis.connect();
  } catch (error) {
    redis.disconnect();
    throw error;
  }

  const store = new RedisTokenBucketStore({
    redis,
    keyPrefix: "rate-limiter-lab:scenario:"
  });

  return {
    limiter: new RateLimiter({
      store,
      namespace,
      capacity,
      refillRatePerSecond,
      debug: true
    }),
    close: () => redis.disconnect()
  };
}

export async function printCheck(
  label: string,
  limiter: RateLimiter,
  key: string
): Promise<RateLimitDecision> {
  const decision = await limiter.check(key);
  console.log(
    JSON.stringify(
      {
        label,
        key,
        allowed: decision.allowed,
        remaining: decision.remaining,
        tokensBefore: round(decision.tokensBefore),
        tokensAfter: round(decision.tokensAfter),
        retryAfterMs: decision.retryAfterMs,
        decisionSource: decision.decisionSource,
        failureReason: decision.debug?.failureReason
      },
      null,
      2
    )
  );
  return decision;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
