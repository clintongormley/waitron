import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep singleFork (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers under the hook's whole-workspace `pnpm -r test:coverage`, and a package this small has
    // a handful of mis-merged branches sink the ratio under threshold. Same finding as the other
    // small packages (shared, fiscal-none, payments).
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
