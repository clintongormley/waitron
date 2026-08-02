import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding as
    // packages/workforce and the other small packages.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Re-export barrel: a manifest with no imperative code, on which v8 reports phantom
        // uncovered branches. Its surface is asserted structurally by index.test.ts.
        "src/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
