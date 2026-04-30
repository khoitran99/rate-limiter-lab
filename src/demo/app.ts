import express, { type Request } from "express";
import { pinoHttp } from "pino-http";
import { RateLimiter } from "../core/rate-limiter.js";
import type { RateLimitDecision, RateLimitStore } from "../core/types.js";
import {
  createRateLimitMiddleware,
  defaultKeyResolver,
  rateLimitErrorHandler
} from "../http/express-middleware.js";
import { MemoryTokenBucketStore } from "../stores/memory-store.js";

export interface CreateAppOptions {
  store?: RateLimitStore;
  debug?: boolean;
  enableHttpLogger?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const store = options.store ?? new MemoryTokenBucketStore();
  const debug = options.debug ?? false;
  const app = express();

  app.use(express.json());
  if (options.enableHttpLogger ?? process.env.NODE_ENV !== "test") {
    app.use(pinoHttp());
  }

  const publicLimiter = new RateLimiter({
    store,
    capacity: 5,
    refillRatePerSecond: 1,
    namespace: "public-api",
    failOpen: true,
    debug
  });

  const authLimiter = new RateLimiter({
    store,
    capacity: 3,
    refillRatePerSecond: 0.2,
    namespace: "auth-api",
    failOpen: false,
    debug
  });

  const userLimiter = new RateLimiter({
    store,
    capacity: 4,
    refillRatePerSecond: 0.5,
    namespace: "user-api",
    failOpen: true,
    debug
  });

  const limiters = {
    public: publicLimiter,
    auth: authLimiter,
    user: userLimiter
  };

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      store: store.constructor.name,
      policies: Object.fromEntries(
        Object.entries(limiters).map(([name, limiter]) => [name, limiter.getPolicy()])
      )
    });
  });

  app.get("/debug/limiter", (_request, response) => {
    response.json({
      store: store.constructor.name,
      stats: Object.fromEntries(
        Object.entries(limiters).map(([name, limiter]) => [name, limiter.getStats()])
      ),
      policies: Object.fromEntries(
        Object.entries(limiters).map(([name, limiter]) => [name, limiter.getPolicy()])
      )
    });
  });

  app.get(
    "/api/public",
    createRateLimitMiddleware({
      limiter: publicLimiter,
      onDecision: logDecisionWhenDebug(debug)
    }),
    (request, response) => {
      response.json({
        ok: true,
        route: "public",
        message: "Public endpoint allowed by the token bucket.",
        rateLimit: summarizeDecision(request.rateLimit)
      });
    }
  );

  app.post(
    "/api/login",
    createRateLimitMiddleware({
      limiter: authLimiter,
      keyResolver: (request) => `login:${request.ip ?? "anonymous"}`,
      onDecision: logDecisionWhenDebug(debug)
    }),
    (_request, response) => {
      response.json({
        ok: true,
        route: "login",
        message: "Login attempt accepted. Auth routes use fail-closed mode."
      });
    }
  );

  app.get(
    "/api/profile",
    createRateLimitMiddleware({
      limiter: userLimiter,
      keyResolver: userOrIpKey,
      onDecision: logDecisionWhenDebug(debug)
    }),
    (request, response) => {
      response.json({
        ok: true,
        route: "profile",
        key: request.rateLimitKey,
        message: "Profile endpoint uses x-user-id when present and IP otherwise.",
        rateLimit: summarizeDecision(request.rateLimit)
      });
    }
  );

  app.use(rateLimitErrorHandler);

  return app;
}

function userOrIpKey(request: Request): string {
  const userId = request.header("x-user-id");
  if (userId) {
    return `user:${userId}`;
  }

  return `ip:${defaultKeyResolver(request)}`;
}

function summarizeDecision(decision?: RateLimitDecision) {
  if (!decision) {
    return null;
  }

  return {
    allowed: decision.allowed,
    key: decision.key,
    limit: decision.limit,
    remaining: decision.remaining,
    retryAfterMs: decision.retryAfterMs,
    resetAt: new Date(decision.resetAtMs).toISOString(),
    decisionSource: decision.decisionSource,
    debug: decision.debug
  };
}

function logDecisionWhenDebug(debug: boolean) {
  return (decision: RateLimitDecision, request: Request) => {
    if (!debug) {
      return;
    }

    request.log?.info(
      {
        rateLimit: summarizeDecision(decision),
        method: request.method,
        path: request.path
      },
      "rate limiter decision"
    );
  };
}
