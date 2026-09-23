import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `testTimeout` covers work inside an individual test. `hookTimeout` bounds only a hook that
    // passes no timeout of its OWN, so it does NOT bound the database setup: `useVenueDb` hands its
    // own timeout to `beforeAll` (60s unless the suite overrides it;
    // `packages/db/src/testing/venue-db.ts`).
    testTimeout: 30_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel; test/** holds the database fixtures. Both are test
      // infrastructure, not measured product code (the same exclusions packages/recipes records).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
