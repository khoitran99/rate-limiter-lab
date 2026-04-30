import { RateLimiter } from "../src/core/rate-limiter.js";
import { FailingStore, printCheck } from "./scenario-utils.js";

console.log("Redis outage scenario: compare fail-open and fail-closed behavior.");

const failOpenLimiter = new RateLimiter({
  store: new FailingStore(),
  namespace: "scenario:fail-open",
  capacity: 5,
  refillRatePerSecond: 1,
  failOpen: true,
  debug: true
});

const failClosedLimiter = new RateLimiter({
  store: new FailingStore(),
  namespace: "scenario:fail-closed",
  capacity: 5,
  refillRatePerSecond: 1,
  failOpen: false,
  debug: true
});

await printCheck("fail-open request", failOpenLimiter, "client-a");

try {
  await failClosedLimiter.check("client-a");
} catch (error) {
  console.log(
    JSON.stringify(
      {
        label: "fail-closed request",
        error: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
}
