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
    // One worker: v8 under-merges branch coverage across workers.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Re-export barrels, on which v8 reports phantom uncovered branches.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
