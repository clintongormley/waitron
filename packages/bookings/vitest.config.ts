import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Separate Node and browser projects share one coverage report. Run Node first so Chromium
// does not compete with this package's database work, and bound browser concurrency.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Numbered from 1, not 0: Vitest 4 lifts a groupOrder-0 project that runs one isolated
          // worker out of its group and appends it after every other group, which puts Chromium ahead
          // of a node project numbered 0. Measured on packages/bookings, against the same run on
          // Vitest 3: with 0/1 the browser project's first test precedes the node project's, with 1/2
          // it follows. bookings, payments-stripe, payments-sumup and venue-service carry this
          // identical shape; packages/media and apps/dashboard split into projects too but pin no
          // project-level worker limit, so the lift never reached them.
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          // `hookTimeout` bounds only a hook that passes no timeout of its own. `useVenueDb` times
          // its own beforeAll (packages/db/src/testing/venue-db.ts, default 60s), so what this
          // bounds is that helper's untimed afterEach/afterAll plus any hook a suite writes itself.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Keep one worker: @vitest/coverage-v8 under-merges BRANCH coverage across
          // fork workers, and a package this size has few enough branches that a handful of mis-merged
          // ones sink the ratio under the branch gate.
          maxWorkers: 1,
        },
      },
      {
        // The browser / Lit project — mirrors packages/ui: real headless Chromium via Playwright.
        // Scoped to the `./dashboard` sub-path.
        test: {
          name: "browser",
          sequence: { groupOrder: 2 },
          globals: true,
          clearMocks: false,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          // The project's own `fileParallelism` is where Vitest 4 reads this: it fills
          // `browser.fileParallelism` from this key when the browser block does not set it.
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
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
        // Test-only mount/cleanup helper (the ui package excludes its own the same way).
        "src/dashboard/test-helpers.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
