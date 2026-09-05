import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots ONE shared Postgres container and migrates the `core` template every real-PG
    // suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // Most suites here boot PGlite (a WASM PostgreSQL) and apply `@waitron/db`'s migrations, longer
    // than Vitest's 5s default on a cold CI runner; the real-PG suites now clone the shared
    // container's migrated `core` template (globalSetup, above). Each per-suite cost is paid in a
    // beforeAll — the PGlite WASM boot + migrations, or the real-PG ~26ms clone — so hookTimeout stays
    // generous for the PGlite boot. The container boot/pull is NOT in a beforeAll: it moved to
    // globalSetup, which vitest does not bound by hookTimeout. testTimeout covers a migration suite
    // booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Run the whole suite in ONE fork. This is here for the @vitest/coverage-v8 branch-merge artifact,
    // NOT for the shared cluster's connection budget: v8 under-merges BRANCH coverage across fork
    // workers, and this package is small enough that a handful of mis-merged branches sinks the ratio
    // below threshold. Same finding as packages/workforce, payments, scheduler and credentials.
    //
    // A consequence, not the reason: singleFork also means only ONE test file runs at a time, so the
    // shared cluster's single 100-connection budget is a non-issue here and needs no `maxForks` cap —
    // unlike packages/db, which runs multi-fork and caps forks at 4 for exactly that budget.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // A pure re-export barrel, excluded for the same reason packages/core's config excludes its
        // identical one.
        "src/index.ts",
        // The shared-container globalSetup is test-only plumbing (mirrors workforce/fiscal excluding
        // their own src/testing/**); it runs in the main process before every worker, so it reads 0%
        // and must not be measured.
        "src/testing/**",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
