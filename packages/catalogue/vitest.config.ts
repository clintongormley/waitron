import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots one shared Postgres container and makes the migrated `core` template
    // available. The retained suites use PGlite; globalSetup still precedes every worker, so a
    // Docker-absent run fails the whole package. See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // NO poolOptions: this package stays MULTI-FORK, deliberately. It is not held to `singleFork` for
    // the @vitest/coverage-v8 branch-merge artifact (unlike scheduler/credentials/workforce-es):
    // catalogue had no `poolOptions` before this branch, so it has been multi-fork on `main` all along
    // and passes the unfiltered `main` merge's `pnpm -r` coverage that way — this batch changes where
    // the DB comes from, not how coverage merges across forks, so it neither introduces nor worsens the
    // artifact (an isolated `test:coverage` here proves nothing about the concurrent case, per
    // CLAUDE.md §2; the pre-existing main history is the evidence). It needs no `maxForks` connection
    // cap either: only ONE real-PG file runs here, opening a handful of `connectAs` backends, far under
    // the shared cluster's ~100-connection budget.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/reporting's own vitest.config.ts excludes its identical barrel. src/testing
      // and test hold Task 5's harness/integration scaffolding, measured by their own suites.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
