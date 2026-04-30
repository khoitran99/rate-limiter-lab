import { createMemoryLimiter, createRedisLimiter, printCheck } from "./scenario-utils.js";

console.log("Store comparison scenario: memory always runs; Redis runs when available.");

const memoryLimiter = createMemoryLimiter("scenario:compare:memory", 2, 1);
await printCheck("memory request 1", memoryLimiter, "client-a");
await printCheck("memory request 2", memoryLimiter, "client-a");
await printCheck("memory request 3", memoryLimiter, "client-a");

try {
  const { limiter: redisLimiter, close } = await createRedisLimiter("scenario:compare:redis", 2, 1);
  try {
    await printCheck("redis request 1", redisLimiter, "client-a");
    await printCheck("redis request 2", redisLimiter, "client-a");
    await printCheck("redis request 3", redisLimiter, "client-a");
  } finally {
    close();
  }
} catch (error) {
  console.log(
    JSON.stringify(
      {
        label: "redis skipped",
        reason: error instanceof Error ? error.message : String(error),
        hint: "Run `npm run redis:up` and retry this scenario to see distributed storage."
      },
      null,
      2
    )
  );
}
