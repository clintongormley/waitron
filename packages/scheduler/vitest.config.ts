import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core_scheduler` template every
    // real-PG suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites (store.test.ts, resweep.test.ts et al.) boot PGlite (a WASM PostgreSQL) and
    // apply two migration sets, longer than Vitest's 5s default on a cold CI runner; the real-PG
    // suites now clone the shared container's migrated `core_scheduler` template (globalSetup, above).
    // Each per-suite cost is paid in a beforeAll — the PGlite WASM boot, or the real-PG ~26ms clone —
    // so hookTimeout stays generous for the PGlite boot; the ~26ms clone is a harmless ceiling under
    // it. The container boot / image pull is NOT in a beforeAll: it moved to globalSetup, which vitest
    // does NOT bound by hookTimeout. testTimeout covers the ordinary risk within a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep singleFork (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/payments. A consequence, not the reason: singleFork also
    // means only ONE test file runs at a time, so the shared cluster's single 100-connection budget is
    // a non-issue here and needs no `maxForks` cap — unlike packages/db, which runs multi-fork and
    // caps forks at 4 for exactly that budget.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // Re-export barrels: manifests with no imperative code, on which v8 reports phantom
        // uncovered branches. Their surface is asserted structurally by index.test.ts and
        // schema-ownership.test.ts.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
