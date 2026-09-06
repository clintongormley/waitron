import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots one shared Postgres container and makes the migrated
    // `core_identity_workforce_es` template available. The retained suites use PGlite;
    // globalSetup still precedes every worker, so a Docker-absent run fails the whole package.
    // See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep singleFork (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/workforce and the other small packages. A consequence, not
    // the reason: singleFork also means only ONE test file runs at a time, so the shared cluster's
    // single 100-connection budget is a non-issue here and needs no `maxForks` cap — unlike
    // packages/db, which runs multi-fork and caps forks at 4 for exactly that budget.
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
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
