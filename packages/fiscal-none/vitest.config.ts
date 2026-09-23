import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // migrations.test.ts opens a venue database through `useVenueDb` in a beforeAll and applies
    // the core and fiscal-none migration sets. That helper passes its OWN budget to the hook it
    // registers, so `hookTimeout` never bounds the setup; what it bounds is the helper's per-test
    // reset and close, and any hook a test file writes without a timeout of its own. There is no
    // globalSetup: nothing here is shared across test files.
    //
    // Both numbers were sized for a PGlite boot that no longer happens, and were brought down when
    // that was noticed. Measured 2026-09-23 in this worktree on an otherwise quiet machine:
    // `pnpm --filter @waitron/fiscal-none exec vitest run --testTimeout=2000 --hookTimeout=2000`
    // passes all three files, 12 tests, in 568ms end to end. These bounds sit an order of magnitude
    // above that, which is the headroom a cold CI runner gets, and match the small sibling packages
    // that also reach a database through `useVenueDb`.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Keep one worker (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers, and a package this small has a handful of mis-merged branches sink the ratio under
    // threshold. Same finding as the other small packages.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
