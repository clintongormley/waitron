import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the source. Without
    // this exclude Vitest discovers them as real test files, so one interrupted mutation run
    // makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Observed non-deterministic: @vitest/coverage-v8 merges per-worker V8 coverage across the
    // parallel workers Vitest normally runs one test file per. With several small test files all
    // importing the same shared module (errors.ts, ids.ts), that merge occasionally produces a
    // phantom branch entry with no corresponding source location (confirmed by inspecting
    // coverage-final.json's branchMap directly: an extra entry attributed to line 1 with a
    // fnMap name of "get" that appears in no source file in this package) and reports it as
    // uncovered, flipping the coverage gate between green and red across otherwise-identical
    // runs of the same suite. This package is small enough (under 300ms) that running its test
    // files sequentially costs nothing meaningful and removes the race entirely — reproduced
    // clean across 5 consecutive runs with this set, versus failing roughly every other run
    // without it.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `exclude` replaces rather than merges, so the defaults must be spread back in.
      // src/index.ts is a pure re-export barrel with no logic of its own (see its own header
      // comment) and is excluded for the same reason packages/db excludes drizzle.config.ts and
      // packages/ui excludes its test-helpers: nothing here is worth gating on. It is also,
      // independently, the one file in this package where @vitest/coverage-v8 has proven
      // non-deterministic — an in-source `v8 ignore file` comment was tried first and did not
      // reliably suppress it (see src/index.ts), which is why the exclusion lives here instead.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
