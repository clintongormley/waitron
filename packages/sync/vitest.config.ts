import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The two native-replication suites each boot their OWN node(s) in beforeAll
    // (src/testing/replication-node.ts) — no shared-container globalSetup. The timeouts stay at the
    // per-file-container budget as a harmless ceiling; nothing in the hooks or tests approaches them,
    // so narrowing buys nothing. Locally the real-PG tier needs TESTCONTAINERS_RYUK_DISABLED=true or
    // container startup hangs (CLAUDE.md §4).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, which sinks the
    // ratio on a small package. Same finding and same fix as packages/migrations/vitest.config.ts.
    // A consequence, not the reason: singleFork also runs only ONE test file at a time, so the shared
    // cluster's single connection budget is a non-issue here and needs no `maxForks` cap — unlike
    // packages/db, which runs multi-fork and caps forks for exactly that budget.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Re-export barrel: no imperative code, and v8 reports phantom uncovered branches on it. Its
        // reachability is asserted structurally by errors.reachability.test.ts. Same exclusion as
        // packages/migrations/vitest.config.ts.
        "src/index.ts",
        // The shared-container globalSetup runs in the main process, before/outside the worker
        // coverage collection, so it always reads as 0% and would sink the thresholds. It is
        // typechecked by `pnpm -r typecheck` (which includes all of src) and exercised by every
        // real-PG suite's boot. Same exclusion as packages/payments/vitest.config.ts.
        "src/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
