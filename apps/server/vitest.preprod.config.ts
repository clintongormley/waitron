import { defineConfig } from "vitest/config";

// The AEAT pre-production probe, run deliberately and never by `pnpm test`. Same shape as
// packages/payments-stripe/vitest.sandbox.config.ts: a real external service, real credentials,
// no coverage thresholds, and a timeout that tolerates a government SOAP endpoint.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.preprod.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
