import { defineConfig } from "vitest/config";

// The nightly Stripe test-mode suite, which the normal config excludes. Long timeouts: it waits on
// a real Stripe round trip.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.sandbox.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
