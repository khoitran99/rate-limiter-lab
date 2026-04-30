import { describe, expect, it } from "vitest";
import { MemoryTokenBucketStore } from "../../src/stores/memory-store.js";

describe("MemoryTokenBucketStore", () => {
  it("consumes and refills tokens for a key", async () => {
    const store = new MemoryTokenBucketStore();
    const base = {
      key: "bucket-a",
      capacity: 2,
      refillRatePerSecond: 1,
      cost: 1
    };

    await expect(store.consume({ ...base, nowMs: 0 })).resolves.toMatchObject({
      allowed: true,
      tokensBefore: 2,
      tokensAfter: 1
    });

    await expect(store.consume({ ...base, nowMs: 0 })).resolves.toMatchObject({
      allowed: true,
      tokensBefore: 1,
      tokensAfter: 0
    });

    await expect(store.consume({ ...base, nowMs: 0 })).resolves.toMatchObject({
      allowed: false,
      retryAfterMs: 1000
    });

    await expect(store.consume({ ...base, nowMs: 1000 })).resolves.toMatchObject({
      allowed: true,
      tokensBefore: 1,
      tokensAfter: 0
    });
  });

  it("keeps independent buckets per key", async () => {
    const store = new MemoryTokenBucketStore();
    const base = {
      capacity: 1,
      refillRatePerSecond: 1,
      cost: 1,
      nowMs: 0
    };

    await expect(store.consume({ ...base, key: "a" })).resolves.toMatchObject({ allowed: true });
    await expect(store.consume({ ...base, key: "a" })).resolves.toMatchObject({ allowed: false });
    await expect(store.consume({ ...base, key: "b" })).resolves.toMatchObject({ allowed: true });
  });

  it("removes idle buckets during cleanup", async () => {
    const store = new MemoryTokenBucketStore({
      cleanupIntervalMs: 1,
      idleTtlMs: 10
    });

    await store.consume({
      key: "old",
      capacity: 1,
      refillRatePerSecond: 1,
      cost: 1,
      nowMs: 0
    });
    await store.consume({
      key: "new",
      capacity: 1,
      refillRatePerSecond: 1,
      cost: 1,
      nowMs: 20
    });

    expect(store.size()).toBe(1);
  });
});
