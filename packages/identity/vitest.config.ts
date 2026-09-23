import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A hook given its OWN timeout overrides `hookTimeout` rather than narrowing it, so this bounds
    // only hooks written without one — `useVenueDb`'s afterEach reset and afterAll close
    // (`packages/db/src/testing/venue-db.ts:176` and `:183`) and any untimed hook a test file writes.
    // It does not bound that helper's setup, which carries its own 60s budget (`venue-db.ts:174`).
    // testTimeout covers work inside an individual test.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. Across the repo, one worker guards the @vitest/coverage-v8
    // cross-fork branch under-merge — v8 can report a branch covered only in one worker as uncovered
    // after merging profiles (packages/payments and packages/scheduler pin one worker for that).
    // Whether identity's own thresholds need it has not been re-measured on this branch; it is kept
    // because dropping it is a behaviour change, and the parallelism forgone is minor.
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
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
