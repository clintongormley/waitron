import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `hookTimeout` does NOT bound the database setup. Every suite here asks for it through
    // `useVenueDb`, none passes a `timeoutMs` of its own, and the helper hands `beforeAll` its 60s
    // default (`packages/db/src/testing/venue-db.ts`) — a timeout passed to a hook overrides this
    // config's. What `hookTimeout` bounds instead is the hooks that pass no timeout at all: the
    // helper's per-test reset and close, and each suite's own untimed hooks, among them
    // store.concurrency.test.ts's `beforeAll` and `afterAll` and the `beforeEach` seeds in
    // run.test.ts and resweep.test.ts. `testTimeout` covers work inside an individual test.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep one worker (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/payments.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Test-only plumbing: src/testing/fake-duty.ts.
        "src/testing/**",
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
