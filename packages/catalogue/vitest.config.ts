import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // A hook given its OWN timeout overrides `hookTimeout` rather than narrowing it, so this bounds
    // only hooks written without one — `useVenueDb`'s afterEach reset and afterAll close
    // (`packages/db/src/testing/venue-db.ts:176` and `:183`) and any untimed hook a test file writes.
    // It does not bound that helper's setup, which carries its own 60s budget (`venue-db.ts:174`).
    // testTimeout covers work inside an individual test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/reporting's own vitest.config.ts excludes its identical barrel. test/ holds
      // shared test fixtures, not package source.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
