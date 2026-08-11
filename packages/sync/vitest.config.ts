import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The gate suites this package's later tasks add start a real Postgres container via
    // Testcontainers (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md,
    // Tasks 2/4/6): PGlite is a false pass for RLS/non-superuser/concurrency (CLAUDE.md §4). The
    // container pull + boot is a one-off cost paid in a beforeAll, so the hook window is the long
    // one; locally those suites need TESTCONTAINERS_RYUK_DISABLED=true or they hang at this timeout.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, which sinks the
    // ratio on a small package. Same finding and same fix as packages/migrations/vitest.config.ts.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Re-export barrel: no imperative code, and v8 reports phantom uncovered branches on it. Its
      // reachability is asserted structurally by errors.reachability.test.ts. Same exclusion as
      // packages/migrations/vitest.config.ts.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
