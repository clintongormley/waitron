import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `testTimeout` covers work inside an individual test. `hookTimeout` bounds a hook that passes
    // no timeout of its OWN; a hook given one overrides this config (stated at
    // `packages/db/src/testing/lifecycle.ts:178`, measured at `:182-183`). So it does NOT bound
    // `useVenueDb`'s setup, which carries its own 60s budget (`packages/db/src/testing/venue-db.ts:174`);
    // what it bounds is that helper's untimed afterEach reset and afterAll close (`venue-db.ts:176`
    // and `:183`), plus any hook a test file writes for itself.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep one worker (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/payments and packages/scheduler.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Test-only plumbing: src/testing/captured.ts, shared by this package's suites.
        "src/testing/**",
        // The process entry point: argv, env, stdin, stdout and a real connection, and nothing
        // else. Every decision it could get wrong lives in `cli.ts`, which is injected and fully
        // tested; what remains here is the wiring that can only be exercised by running the built
        // bundle. Excluded on the same grounds as packages/payments-stripe's `stripe-client.ts` —
        // a thin boundary whose logic belongs to something else.
        "src/bin.ts",
        // Re-export barrels: manifests with no imperative code, on which v8 reports phantom
        // uncovered branches. Their surface is asserted structurally by index.test.ts and
        // schema-ownership.test.ts.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
