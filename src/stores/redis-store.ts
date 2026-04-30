import type { Redis } from "ioredis";
import type { RateLimitStore, StoreConsumeInput, StoreConsumeResult } from "../core/types.js";

const CONSUME_TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillRatePerSecond = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local bucket = redis.call("HMGET", key, "tokens", "updatedAtMs")
local tokens = tonumber(bucket[1])
local updatedAtMs = tonumber(bucket[2])

if tokens == nil or updatedAtMs == nil then
  tokens = capacity
  updatedAtMs = nowMs
end

local elapsedMs = math.max(0, nowMs - updatedAtMs)
local refillAmount = (elapsedMs / 1000) * refillRatePerSecond
local tokensBefore = math.min(capacity, tokens + refillAmount)
local allowed = 0
local tokensAfter = tokensBefore

if tokensBefore >= cost then
  allowed = 1
  tokensAfter = tokensBefore - cost
end

local retryAfterMs = 0
if allowed == 0 then
  retryAfterMs = math.ceil(((cost - tokensAfter) / refillRatePerSecond) * 1000)
end

local resetAfterMs = math.ceil(((capacity - tokensAfter) / refillRatePerSecond) * 1000)

redis.call("HSET", key, "tokens", tokensAfter, "updatedAtMs", nowMs)
redis.call("PEXPIRE", key, ttlMs)

return {
  tostring(allowed),
  tostring(tokensBefore),
  tostring(tokensAfter),
  tostring(retryAfterMs),
  tostring(resetAfterMs)
}
`;

export interface RedisTokenBucketStoreOptions {
  redis: Redis;
  keyPrefix?: string;
  commandName?: string;
  ttlMultiplier?: number;
}

type RedisWithCommand = Redis & {
  [commandName: string]: (...args: Array<string | number>) => Promise<string[]>;
};

export class RedisTokenBucketStore implements RateLimitStore {
  private readonly redis: RedisWithCommand;
  private readonly keyPrefix: string;
  private readonly commandName: string;
  private readonly ttlMultiplier: number;

  constructor(options: RedisTokenBucketStoreOptions) {
    this.redis = options.redis as RedisWithCommand;
    this.keyPrefix = options.keyPrefix ?? "rate-limiter-lab:";
    this.commandName = options.commandName ?? "consumeTokenBucket";
    this.ttlMultiplier = options.ttlMultiplier ?? 2;

    this.redis.defineCommand(this.commandName, {
      numberOfKeys: 1,
      lua: CONSUME_TOKEN_BUCKET_LUA
    });
  }

  async consume(input: StoreConsumeInput): Promise<StoreConsumeResult> {
    const ttlMs = this.calculateTtlMs(input);
    const raw = await this.redis[this.commandName](
      this.redisKey(input.key),
      input.nowMs,
      input.capacity,
      input.refillRatePerSecond,
      input.cost,
      ttlMs
    );

    return this.parseConsumeResult(raw);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.redisKey(key));
  }

  async getDebugState(key: string): Promise<unknown> {
    return this.redis.hgetall(this.redisKey(key));
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private calculateTtlMs(input: StoreConsumeInput): number {
    const timeToFillMs = Math.ceil((input.capacity / input.refillRatePerSecond) * 1000);
    return Math.max(1000, timeToFillMs * this.ttlMultiplier);
  }

  private parseConsumeResult(raw: string[]): StoreConsumeResult {
    if (!Array.isArray(raw) || raw.length !== 5) {
      throw new Error(`Unexpected Redis token bucket response: ${JSON.stringify(raw)}`);
    }

    const [allowed, tokensBefore, tokensAfter, retryAfterMs, resetAfterMs] = raw;
    return {
      allowed: allowed === "1",
      tokensBefore: Number(tokensBefore),
      tokensAfter: Number(tokensAfter),
      retryAfterMs: Number(retryAfterMs),
      resetAfterMs: Number(resetAfterMs)
    };
  }
}

export { CONSUME_TOKEN_BUCKET_LUA };
