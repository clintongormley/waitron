import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the source. Without
    // this exclude Vitest discovers them as real test files, so one interrupted mutation run
    // makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Observed non-deterministic: @vitest/coverage-v8's merge of per-worker coverage occasionally
    // produced a phantom uncovered branch, flipping the coverage gate between green and red across
    // otherwise-identical runs of the same suite.
    fileParallelism: false,
    // A single worker avoids the v8 branch-coverage merge artifact across fork workers.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `exclude` replaces rather than merges, but Vitest 4's own default list is empty, so the
      // spread adds nothing today; keep it so a later non-empty default is not dropped.
      // src/index.ts is a pure re-export barrel with no logic of its own.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
