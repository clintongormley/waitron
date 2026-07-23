import { defineConfig } from "vitest/config";

// A SEPARATE config from vitest.config.ts, scoped to only the nightly Stripe test-mode sandbox
// suite (`src/**/*.sandbox.test.ts`) — the file the normal config's `exclude` keeps out of every
// PR run. Long timeouts: this suite waits on a real Stripe Terminal simulated-reader round trip,
// not an in-process fake.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.sandbox.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
