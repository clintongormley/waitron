import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The real-database replication suites live in packages/replication-tests; everything here is
    // hermetic.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, which sinks the
    // ratio on a small package. Same finding and same fix as packages/migrations/vitest.config.ts.
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
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
