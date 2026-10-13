import { defineConfig } from "vitest/config";

// The opt-in Amazon S3 rehearsal: timeouts cover a 15-minute transfer budget plus the 2-minute teardown.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.aws-rehearsal.test.ts"],
    setupFiles: ["src/testing/byte-equality-setup.ts"],
    maxWorkers: 1,
    testTimeout: 900_000,
    hookTimeout: 300_000,
  },
});
