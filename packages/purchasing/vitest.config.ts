import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots ONE shared Postgres container and migrates the `core` template the real-PG
    // (RLS) suite clones (~26ms) instead of that file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suite (operations.test.ts) boots PGlite (a WASM PostgreSQL) and applies `@waitron/db`'s
    // migrations, longer than Vitest's 5s default on a cold CI runner; the real-PG (RLS) suite now
    // clones the shared container's migrated `core` template (globalSetup, above). Each per-suite cost
    // is paid in a beforeAll — the PGlite WASM boot, or the real-PG ~26ms clone — so hookTimeout stays
    // generous for the PGlite boot; the ~26ms clone is a harmless ceiling under it. The container boot /
    // image pull is NOT in a beforeAll: it moved to globalSetup, which vitest does NOT bound by
    // hookTimeout.
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // NO poolOptions: this package stays MULTI-FORK, deliberately. It is not held to `singleFork` for
    // the @vitest/coverage-v8 branch-merge artifact (unlike scheduler/credentials/workforce-es):
    // purchasing had no `poolOptions` before this branch, so it has been multi-fork on `main` all along
    // and passes the unfiltered `main` merge's `pnpm -r` coverage that way — this batch changes where
    // the DB comes from, not how coverage merges across forks, so it neither introduces nor worsens the
    // artifact (an isolated `test:coverage` here proves nothing about the concurrent case, per
    // CLAUDE.md §2; the pre-existing main history is the evidence). It needs no `maxForks` connection
    // cap either: only ONE real-PG file runs here, opening a handful of `connectAs` backends, far under
    // the shared cluster's ~100-connection budget.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel; src/testing/** and test/** hold the DB harness and
      // fixtures. All are test infrastructure, not measured product code (the same exclusions
      // packages/recipes records).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
