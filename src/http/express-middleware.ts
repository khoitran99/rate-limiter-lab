import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { RateLimitExceededError, RateLimiterUnavailableError } from "../core/errors.js";
import { RateLimiter } from "../core/rate-limiter.js";
import type { RateLimitDecision } from "../core/types.js";

declare module "express-serve-static-core" {
  interface Request {
    rateLimit?: RateLimitDecision;
    rateLimitKey?: string;
  }
}

export type KeyResolver = (request: Request) => string | Promise<string>;
export type CostResolver = (request: Request) => number | Promise<number>;

export interface RateLimitMiddlewareOptions {
  limiter: RateLimiter;
  keyResolver?: KeyResolver;
  costResolver?: CostResolver;
  onDecision?: (decision: RateLimitDecision, request: Request) => void | Promise<void>;
}

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): RequestHandler {
  const keyResolver = options.keyResolver ?? defaultKeyResolver;
  const costResolver = options.costResolver ?? (() => 1);

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const key = await keyResolver(request);
      const cost = await costResolver(request);
      const decision = await options.limiter.check(key, { cost });

      request.rateLimit = decision;
      request.rateLimitKey = key;
      setRateLimitHeaders(response, decision);
      await options.onDecision?.(decision, request);

      if (!decision.allowed) {
        next(new RateLimitExceededError(decision));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function defaultKeyResolver(request: Request): string {
  return request.ip || request.socket.remoteAddress || "anonymous";
}

export function setRateLimitHeaders(response: Response, decision: RateLimitDecision): void {
  response.setHeader("RateLimit-Limit", String(decision.limit));
  response.setHeader("RateLimit-Remaining", String(decision.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(decision.resetAtMs / 1000)));

  if (!decision.allowed && decision.retryAfterMs > 0) {
    response.setHeader("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
  }
}

export const rateLimitErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (error instanceof RateLimitExceededError) {
    setRateLimitHeaders(response, error.decision);
    response.setHeader("Retry-After", String(Math.ceil(error.decision.retryAfterMs / 1000)));
    response.status(error.statusCode).json(error.toJSON());
    return;
  }

  if (error instanceof RateLimiterUnavailableError) {
    response.status(error.statusCode).json({
      error: "rate_limiter_unavailable",
      message: error.message
    });
    return;
  }

  next(error);
};
