import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core_identity_workforce`
    // template every real-PG suite clones (~26ms) instead of each file booting and migrating its own
    // (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run
    // now fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The heavy real-Postgres boot+migrate is paid ONCE in globalSetup (above), not per file. What is
    // left in a per-suite beforeAll is either a ~26ms template clone (the real-PG suites) or a PGlite
    // WASM boot + migration sets (the hermetic usePgliteDb suites) — the latter is why hookTimeout
    // stays generous (180s, comfortably over a WASM cold boot on a slow CI runner). testTimeout covers
    // the ordinary risk of a migration suite booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. This is here for the @vitest/coverage-v8 branch-merge
    // artifact, NOT for the shared cluster's connection budget: v8 under-merges BRANCH coverage
    // across fork workers, and this package is small enough that a handful of mis-merged branches
    // sinks the ratio under the threshold. Same finding as packages/payments, packages/scheduler and
    // packages/credentials.
    //
    // A consequence, not the reason: singleFork also means only ONE test file runs at a time, so the
    // shared cluster's single 100-connection budget is a non-issue here and needs no `maxForks` cap
    // — even though this package has concurrency suites (chain/clocking/scheduling), only one runs at
    // a time. (packages/db runs multi-fork and caps forks at 4 for exactly that budget.)
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
