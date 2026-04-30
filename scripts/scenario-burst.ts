import { createMemoryLimiter, printCheck } from "./scenario-utils.js";

console.log("Burst scenario: capacity=5, refill=1 token/sec, 8 immediate requests.");

const limiter = createMemoryLimiter("scenario:burst", 5, 1);

for (let requestNumber = 1; requestNumber <= 8; requestNumber += 1) {
  await printCheck(`request-${requestNumber}`, limiter, "client-a");
}
