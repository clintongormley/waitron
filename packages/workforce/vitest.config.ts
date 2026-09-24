import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `useVenueDb` times its own beforeAll, so `hookTimeout` bounds its untimed afterEach/afterAll
    // and a suite's own hooks; `testTimeout` covers a database opened inside an `it` body.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One worker: v8 under-merges BRANCH coverage across fork workers, enough to sink this
    // package under its threshold.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Re-export barrels, on which v8 reports phantom uncovered branches; index.test.ts and
        // schema-ownership.test.ts assert their surface.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
