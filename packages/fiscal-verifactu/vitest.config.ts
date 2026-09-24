import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // scripts/fiscal-test-budget.test.ts pins this.
    maxWorkers: 4,
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `hookTimeout` bounds only a hook that passes no timeout of its own. `useVenueDb` times its
    // own beforeAll (packages/db/src/testing/venue-db.ts, default 60s), so what this bounds is
    // that helper's untimed afterEach/afterAll plus any hook a suite writes for itself.
    // `testTimeout` covers a database opened inside an `it` body.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
