import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";

export default defineConfig({
  test: {
    // scripts/fiscal-test-budget.test.ts pins this; outer, never inside a project.
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: "node",
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          // `hookTimeout` bounds only a hook that passes no timeout of its own. `useVenueDb` times its
          // own beforeAll (packages/db/src/testing/venue-db.ts, default 60s), so what this bounds is
          // that helper's untimed afterEach/afterAll plus any hook a suite writes for itself.
          // `testTimeout` covers a database opened inside an `it` body.
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: "browser",
          sequence: { groupOrder: 2 },
          globals: true,
          clearMocks: false,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          // Vitest 4 fills `browser.fileParallelism` from this project-level key.
          fileParallelism: false,
          browser: {
            enabled: true,
            // West of UTC and of Madrid, so a date or time drawn in the browser's zone instead of
            // the venue's reads differently. On the provider: Vitest 4 ignores an instance's `context`.
            provider: playwright({ contextOptions: { timezoneId: "America/New_York" } }),
            headless: true,
            instances: [{ browser: "chromium" }],
            // The a11y suites import @waitron/ui's a11y-helpers.ts, whose beforeEach runs this command.
            commands: { ...parkPointerCommands },
          },
        },
      },
    ],
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
