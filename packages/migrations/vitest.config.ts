import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The concurrency suite starts a real Postgres container and races two migrators against it.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding
    // as packages/payments, packages/scheduler and packages/credentials.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
