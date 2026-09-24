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
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own; test/** holds the database
      // fixtures.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "test/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
