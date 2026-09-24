import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `useVenueDb` passes its own budget to the `beforeAll` that migrates the database, and a hook's
    // own timeout overrides `hookTimeout`, so this one reaches only the helper's per-test reset and
    // close (`packages/db/src/testing/venue-db.ts`) and any untimed hook a test writes. Neither value
    // is sized to a need: both are margin for a loaded CI runner.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One worker is kept as a precaution against @vitest/coverage-v8 under-merging branch coverage
    // across workers.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
