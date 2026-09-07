import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // migrations.test.ts boots PGlite (a WASM PostgreSQL) in a beforeAll and applies the migration
    // sets, longer than Vitest's 5s default on a cold CI runner. No real-PG (Testcontainers) suite
    // lives here — this module owns no tables — so there is no globalSetup.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Keep singleFork (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers, and a package this small has a handful of mis-merged branches sink the ratio under
    // threshold. Same finding as the other small packages.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
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
