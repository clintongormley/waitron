import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `hookTimeout` bounds only a hook that passes no timeout of its own. `useVenueDb` times its
    // own beforeAll (packages/db/src/testing/venue-db.ts:174, default 60s), so what this bounds is
    // that helper's untimed afterEach/afterAll plus any hook a suite writes for itself.
    // `testTimeout` covers a database opened inside an `it` body.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork, for the @vitest/coverage-v8 branch-merge artifact: v8
    // under-merges BRANCH coverage across fork workers, and this package is small enough that a
    // handful of mis-merged branches sinks the ratio under the threshold. Same finding as
    // packages/payments, packages/scheduler and packages/credentials.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
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
