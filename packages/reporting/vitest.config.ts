import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `hookTimeout` does NOT bound the database setup: `useVenueDb` times its own `beforeAll`
    // (`packages/db/src/testing/venue-db.ts`) and the call sites in this package pass
    // `timeoutMs: 60_000`, so 60s is the number that applies there and this one never is. What it
    // DOES bound is the hooks left untimed: the helper's per-test reset and close, and this
    // package's own `beforeEach` seeds. `testTimeout` covers work inside an individual test,
    // including a migration suite opening a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Run the whole suite in ONE fork, for the @vitest/coverage-v8 branch-merge artifact: v8
    // under-merges BRANCH coverage across fork workers, and this package is small enough that a
    // handful of mis-merged branches sinks the ratio below threshold. Same finding as
    // packages/workforce, payments, scheduler and credentials.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // A pure re-export barrel, excluded for the same reason packages/core's config excludes its
        // identical one.
        "src/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
