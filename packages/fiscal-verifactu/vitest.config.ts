import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  optimizeDeps: { include: ["lit", "lit/decorators.js", "lit/directives/live.js", "axe-core"] },
  test: {
    globals: true,
    clearMocks: false,
    // scripts/fiscal-test-budget.test.ts pins this.
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.browser.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          globals: true,
          clearMocks: false,
          include: ["src/**/*.browser.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          browser: {
            enabled: true,
            provider: playwright({}),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
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
