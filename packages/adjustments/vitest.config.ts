import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `useVenueDb` times its own beforeAll, so `hookTimeout` bounds its untimed afterEach/afterAll
    // and a suite's own hooks.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One worker: v8 under-merges BRANCH coverage across fork workers.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
