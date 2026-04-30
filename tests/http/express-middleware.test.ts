import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/core/rate-limiter.js";
import type {
  RateLimitStore,
  StoreConsumeInput,
  StoreConsumeResult
} from "../../src/core/types.js";
import {
  createRateLimitMiddleware,
  rateLimitErrorHandler
} from "../../src/http/express-middleware.js";
import { MemoryTokenBucketStore } from "../../src/stores/memory-store.js";

class FailingStore implements RateLimitStore {
  async consume(_input: StoreConsumeInput): Promise<StoreConsumeResult> {
    throw new Error("store offline");
  }
}

describe("createRateLimitMiddleware", () => {
  it("sets rate limit headers and returns 429 JSON when throttled", async () => {
    const app = express();
    const limiter = new RateLimiter({
      store: new MemoryTokenBucketStore(),
      capacity: 2,
      refillRatePerSecond: 0.001
    });

    app.get("/limited", createRateLimitMiddleware({ limiter }), (_request, response) => {
      response.json({ ok: true });
    });
    app.use(rateLimitErrorHandler);

    await request(app).get("/limited").expect(200);
    const second = await request(app).get("/limited").expect(200);
    const third = await request(app).get("/limited").expect(429);

    expect(second.header["ratelimit-limit"]).toBe("2");
    expect(second.header["ratelimit-remaining"]).toBe("0");
    expect(third.body).toMatchObject({
      error: "rate_limit_exceeded",
      limit: 2,
      remaining: 0
    });
    expect(Number(third.header["retry-after"])).toBeGreaterThan(0);
  });

  it("supports custom key resolution", async () => {
    const app = express();
    const limiter = new RateLimiter({
      store: new MemoryTokenBucketStore(),
      capacity: 1,
      refillRatePerSecond: 0.001
    });

    app.get(
      "/user-limited",
      createRateLimitMiddleware({
        limiter,
        keyResolver: (req) => req.header("x-user-id") ?? "anonymous"
      }),
      (_request, response) => {
        response.json({ ok: true });
      }
    );
    app.use(rateLimitErrorHandler);

    await request(app).get("/user-limited").set("x-user-id", "alice").expect(200);
    await request(app).get("/user-limited").set("x-user-id", "alice").expect(429);
    await request(app).get("/user-limited").set("x-user-id", "bob").expect(200);
  });

  it("allows traffic when store failures happen in fail-open mode", async () => {
    const app = express();
    const limiter = new RateLimiter({
      store: new FailingStore(),
      capacity: 1,
      refillRatePerSecond: 1,
      failOpen: true,
      debug: true
    });

    app.get("/fail-open", createRateLimitMiddleware({ limiter }), (req, response) => {
      response.json({
        ok: true,
        source: req.rateLimit?.decisionSource,
        failureReason: req.rateLimit?.debug?.failureReason
      });
    });
    app.use(rateLimitErrorHandler);

    const response = await request(app).get("/fail-open").expect(200);

    expect(response.body).toEqual({
      ok: true,
      source: "fail-open",
      failureReason: "store offline"
    });
  });

  it("returns 503 when store failures happen in fail-closed mode", async () => {
    const app = express();
    const limiter = new RateLimiter({
      store: new FailingStore(),
      capacity: 1,
      refillRatePerSecond: 1,
      failOpen: false
    });

    app.get("/fail-closed", createRateLimitMiddleware({ limiter }), (_req, response) => {
      response.json({ ok: true });
    });
    app.use(rateLimitErrorHandler);

    const response = await request(app).get("/fail-closed").expect(503);

    expect(response.body).toMatchObject({
      error: "rate_limiter_unavailable",
      message: "store offline"
    });
  });
});
