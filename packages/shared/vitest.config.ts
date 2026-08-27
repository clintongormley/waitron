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
    // `fileParallelism: false` removes the within-package race, but under the pre-push hook's
    // whole-workspace `pnpm -r test:coverage` this package still runs concurrently WITH the other
    // packages under pnpm's oversubscription, and @vitest/coverage-v8's cross-fork merge under-counts
    // this package's branches (an intermittent ~80% vs the real 100% in isolation — the same v8
    // fork-merge under-count the `packages/payments` config documents). Pinning to a single fork
    // removes that cross-fork merge entirely, so the gate is deterministic under `-r` load too. The
    // suite is tiny (<300ms), so one fork costs nothing.
    poolOptions: { forks: { singleFork: true } },
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
