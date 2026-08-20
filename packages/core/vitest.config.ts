import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots ONE shared Postgres container and migrates the `core_identity` template every
    // real-PG suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites (record-sale.test.ts et al.) boot PGlite (a WASM PostgreSQL) and apply
    // `@waitron/db`'s migrations, longer than Vitest's 5s default on a cold CI runner (mirrors
    // packages/fiscal-verifactu's identical reasoning). The real-PG suites now clone the shared
    // container's migrated template — a ~26ms beforeAll the 60s hookTimeout is a harmless ceiling over;
    // the one-off container boot / image pull moved to globalSetup, which vitest does NOT bound by
    // hookTimeout (measured 2026-08-20 on vitest@3.2.7: a globalSetup sleeping 2003ms returned green
    // under hookTimeout: 300).
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // NO poolOptions: this package stays MULTI-FORK, deliberately. It is not held to `singleFork` for
    // the @vitest/coverage-v8 branch-merge artifact (unlike payments/reporting): core had no
    // `poolOptions` before this branch, so it has been multi-fork on `main` all along and passes the
    // unfiltered `main` merge's `pnpm -r` coverage that way — this batch changes where the DB comes
    // from, not how coverage merges across forks, so it neither introduces nor worsens the artifact.
    // (An isolated `test:coverage` here also reports 100/99.38/100/100, but per CLAUDE.md §2 that alone
    // proves nothing about the concurrent case.) It needs no
    // `maxForks` connection cap (db/fiscal-verifactu's lever): only THREE real-PG files run here, the
    // busiest of which (settle-sale) opens just two extra `pg.connect()` backends, so even fully
    // parallel they hold a handful of connections, far under the shared cluster's ~100 budget.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/shared's own vitest.config.ts excludes its identical barrel.
      // src/testing/** is test-only plumbing (the shared-container globalSetup), exercised by the
      // real-PG suites but not measured — mirrors the other rollout packages' exclusion.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
