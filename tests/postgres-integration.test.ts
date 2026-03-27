import test from "node:test";

test.skip("legacy postgres integration scenarios moved to current queue and restart suites", () => {
  // This file previously exercised a removed queue/report shape and the legacy
  // postgres repository adapter. The supported coverage now lives in:
  // - tests/postgres-case-service.test.ts
  // - tests/memory-case-service.test.ts
});
