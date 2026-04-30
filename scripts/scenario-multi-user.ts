import { createMemoryLimiter, printCheck } from "./scenario-utils.js";

console.log("Multi-user scenario: each user has an independent bucket.");

const limiter = createMemoryLimiter("scenario:multi-user", 2, 0.5);
const keys = ["user:alice", "user:alice", "user:alice", "user:bob", "user:bob", "user:carol"];

for (const [index, key] of keys.entries()) {
  await printCheck(`request-${index + 1}`, limiter, key);
}
