import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `useVenueDb` times its own `beforeAll` (`packages/db/src/testing/venue-db.ts`, 60s unless a
    // suite passes `timeoutMs`), so `hookTimeout` bounds only the hooks left untimed: that helper's
    // per-test reset and close, and any hook a test file writes for itself. `testTimeout` covers a
    // test body that opens a database of its own (`src/migrations.test.ts`).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One worker, for coverage: v8 has under-merged BRANCH coverage across parallel workers,
    // reporting a branch covered in one worker but not another as uncovered.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        "src/reconciliation-schedule/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
