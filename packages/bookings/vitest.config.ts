import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Shared globalSetup migrates the container templates once for the real-Postgres suites
    // (schema, verbs, routes, privileges, migration-split). It runs before every worker, so Docker
    // absence also fails a PGlite-only selection — the same posture the fiscal-verifactu package takes.
    globalSetup: ["./src/testing/global-setup.ts"],
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // The PGlite verb suite boots a WASM PostgreSQL and applies [core, bookings] in a beforeAll;
    // the real-PG suites clone the shared template (~26ms). The container boot/pull is in
    // globalSetup, which vitest does not bound by hookTimeout.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Keep singleFork (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers, and a package this size has few enough branches that a handful of mis-merged ones
    // sink the ratio under the 95% gate. Same finding as the other small data-layer packages.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
      ],
      // The six-package high bar: @waitron/bookings is a data-layer module with its own migration
      // set (CLAUDE.md §2; scripts/coverage-thresholds.test.ts pins it in HIGH_BAR_PACKAGES).
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
