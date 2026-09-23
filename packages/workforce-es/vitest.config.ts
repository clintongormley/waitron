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
    // A single worker avoids the v8 branch-coverage merge artifact across fork workers.
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
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
