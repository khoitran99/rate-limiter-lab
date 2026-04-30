import "dotenv/config";
import { Redis } from "ioredis";
import { createApp } from "./demo/app.js";
import type { RateLimitStore } from "./core/types.js";
import { MemoryTokenBucketStore } from "./stores/memory-store.js";
import { RedisTokenBucketStore } from "./stores/redis-store.js";

const port = Number(process.env.PORT ?? 3000);
const debug = process.env.RATE_LIMIT_DEBUG === "true";
const storeMode = process.env.RATE_LIMIT_STORE ?? "redis";

const { store, close } = await createStore();
const app = createApp({
  store,
  debug,
  enableHttpLogger: true
});

const server = app.listen(port, () => {
  console.log(`rate-limiter-lab listening on http://localhost:${port}`);
  console.log(`store=${store.constructor.name} debug=${debug}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function createStore(): Promise<{ store: RateLimitStore; close: () => Promise<void> }> {
  if (storeMode === "memory") {
    return {
      store: new MemoryTokenBucketStore(),
      close: async () => {}
    };
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2000)
  });

  redis.on("error", (error: Error) => {
    console.warn(`redis error: ${error.message}`);
  });

  try {
    await Promise.race([
      redis.connect(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("redis connection timeout")), 1000);
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`redis connection failed at startup; fail-open routes will still serve: ${message}`);
  }

  return {
    store: new RedisTokenBucketStore({ redis }),
    close: async () => {
      redis.disconnect();
    }
  };
}

async function shutdown(): Promise<void> {
  server.close(async () => {
    await close();
    process.exit(0);
  });
}
