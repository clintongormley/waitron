import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `hookTimeout` bounds only hooks with no timeout of their own, so not `useVenueDb`'s setup,
    // which carries its own (`packages/db/src/testing/venue-db.ts`).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One worker: v8 under-merges BRANCH coverage across workers, and in a package this small a
    // handful of mis-merged branches sinks the ratio under threshold.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Test-only plumbing shared by this package's suites.
        "src/testing/**",
        // The process entry point: its shim (the direct-invocation guard and the real stdio) is
        // unreachable without spawning a process. `bin.test.ts` still drives `runBin`.
        "src/bin.ts",
        // Re-export barrels, on which v8 reports phantom uncovered branches. Their surface is
        // asserted by index.test.ts and schema-ownership.test.ts.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
