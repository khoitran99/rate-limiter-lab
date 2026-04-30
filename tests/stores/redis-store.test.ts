import { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import {
  CONSUME_TOKEN_BUCKET_LUA,
  RedisTokenBucketStore
} from "../../src/stores/redis-store.js";

class FakeRedis {
  definedCommand?: {
    name: string;
    numberOfKeys: number;
    lua: string;
  };
  calls: unknown[][] = [];
  del = vi.fn(async () => 1);
  hgetall = vi.fn(async () => ({ tokens: "1", updatedAtMs: "100" }));

  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }) {
    this.definedCommand = {
      name,
      ...definition
    };
    Object.assign(this, {
      [name]: async (...args: unknown[]) => {
        this.calls.push(args);
        return ["1", "2", "1", "0", "1000"];
      }
    });
  }
}

describe("RedisTokenBucketStore", () => {
  it("registers the atomic Lua token bucket command", () => {
    const fakeRedis = new FakeRedis();
    new RedisTokenBucketStore({
      redis: fakeRedis as unknown as Redis
    });

    expect(fakeRedis.definedCommand).toMatchObject({
      name: "consumeTokenBucket",
      numberOfKeys: 1
    });
    expect(fakeRedis.definedCommand?.lua).toContain("HSET");
    expect(fakeRedis.definedCommand?.lua).toContain("PEXPIRE");
    expect(CONSUME_TOKEN_BUCKET_LUA).toContain("tokensBefore");
  });

  it("calls Redis with the prefixed key and parses the Lua result", async () => {
    const fakeRedis = new FakeRedis();
    const store = new RedisTokenBucketStore({
      redis: fakeRedis as unknown as Redis,
      keyPrefix: "test-prefix:"
    });

    const result = await store.consume({
      key: "bucket-a",
      capacity: 2,
      refillRatePerSecond: 1,
      cost: 1,
      nowMs: 123
    });

    expect(fakeRedis.calls[0]).toEqual(["test-prefix:bucket-a", 123, 2, 1, 1, 4000]);
    expect(result).toEqual({
      allowed: true,
      tokensBefore: 2,
      tokensAfter: 1,
      retryAfterMs: 0,
      resetAfterMs: 1000
    });
  });

  const maybeLiveRedisTest = process.env.RUN_REDIS_TESTS === "true" ? it : it.skip;

  maybeLiveRedisTest("updates one bucket atomically against a live Redis server", async () => {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1
    });
    const prefix = `rate-limiter-lab:test:${Date.now()}:`;
    const store = new RedisTokenBucketStore({
      redis,
      keyPrefix: prefix
    });

    try {
      const first = await store.consume({
        key: "bucket-a",
        capacity: 1,
        refillRatePerSecond: 1,
        cost: 1,
        nowMs: 0
      });
      const second = await store.consume({
        key: "bucket-a",
        capacity: 1,
        refillRatePerSecond: 1,
        cost: 1,
        nowMs: 0
      });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
    } finally {
      await redis.del(`${prefix}bucket-a`);
      redis.disconnect();
    }
  });
});
