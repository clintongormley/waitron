import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots ONE shared Postgres container and migrates the `core_identity` template the
    // one real-PG suite (store.rls.test.ts) clones (~26ms) instead of that file booting and migrating
    // its own (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a
    // Docker-absent run now fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // This package has NO PGlite suites — store.rls.test.ts is the only DB-backed file, and it now
    // clones the shared container's migrated `core_identity` template in a ~26ms beforeAll (the
    // container boot / image pull moved to globalSetup, which vitest does NOT bound by hookTimeout).
    // So hookTimeout is just a harmless ceiling far above that clone, not a budget for any WASM boot;
    // errors.test.ts and validate.test.ts are hermetic unit tests. testTimeout covers the several DB
    // round-trips a single `it` makes, well under 30s.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // NO poolOptions: this package stays MULTI-FORK, deliberately. It is not held to `singleFork` for
    // the @vitest/coverage-v8 branch-merge artifact (unlike scheduler/credentials/workforce-es):
    // layouts had no `poolOptions` before this branch, so it has been multi-fork on `main` all along
    // and passes the unfiltered `main` merge's `pnpm -r` coverage that way — this batch changes where
    // the DB comes from, not how coverage merges across forks, so it neither introduces nor worsens the
    // artifact (an isolated `test:coverage` here proves nothing about the concurrent case, per
    // CLAUDE.md §2; the pre-existing main history is the evidence). It needs no `maxForks` connection
    // cap either: only ONE real-PG file runs here, and it opens a single admin connection to its clone,
    // far under the shared cluster's ~100-connection budget.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/catalogue's own vitest.config.ts excludes its identical barrel. src/testing/**
      // is the shared-container globalSetup — test-only plumbing that runs before every worker and
      // reads 0%, so it must not be measured (mirrors the other rollout packages' exclusion).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
