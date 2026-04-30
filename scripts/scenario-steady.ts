import { createMemoryLimiter, printCheck, sleep } from "./scenario-utils.js";

console.log("Steady scenario: capacity=3, refill=2 tokens/sec, one request every 600ms.");

const limiter = createMemoryLimiter("scenario:steady", 3, 2);

for (let requestNumber = 1; requestNumber <= 8; requestNumber += 1) {
  await printCheck(`request-${requestNumber}`, limiter, "client-a");
  await sleep(600);
}
