import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // Headroom for the suites that open and migrate a venue directory — the two `useVenueDb`
    // callers, and `schema-ahead.migrate.test.ts`, which owns its own directory. `hookTimeout`
    // below bounds a hook that passes no timeout of its OWN; a hook given one overrides this config
    // (`@vitest/runner@4.1.11/dist/chunk-artifact.js:668`). So it does not bound
    // `schema-ahead.migrate.test.ts`, which sets a timeout at its own `beforeAll`, and it does not
    // bound `useVenueDb` setup, which runs under the 60s default that helper forwards to
    // (`packages/db/src/testing/venue-db.ts:12`, applied at `:196`).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding
    // as packages/payments and packages/scheduler.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` is the process entry point: every decision it could get wrong lives in
      // `cli.ts`, which is injected and fully tested, and what remains — a tty, a readline, a
      // process exit code — is verifiable only by running the built bundle, which the plan does
      // rather than a test.
      exclude: [...coverageConfigDefaults.exclude, "src/bin.ts", "src/index.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
