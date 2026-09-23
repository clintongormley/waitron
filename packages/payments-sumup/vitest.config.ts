import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Two projects share one coverage report: the server suites run in Node, and the dashboard panel's
// Lit widgets run in real headless Chromium (mirrors packages/bookings). The `groupOrder`s below run
// the Node project first.
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
          exclude: [
            ...configDefaults.exclude,
            "**/.stryker-tmp/**",
            "src/**/*.sandbox.test.ts",
            // The dashboard panel is browser-mode; it runs in the project below.
            "src/dashboard/**",
          ],
          // `useVenueDb` times its own `beforeAll` (`packages/db/src/testing/venue-db.ts`, 60s
          // unless a suite passes `timeoutMs`), so `hookTimeout` bounds only the hooks left
          // untimed: that helper's per-test reset and close, and any hook a test file writes for
          // itself. `testTimeout` bounds a test body.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Keep one worker (#22): the Node project runs one test file at a time.
          maxWorkers: 1,
        },
      },
      {
        // The browser / Lit project — mirrors packages/ui and packages/bookings: real headless
        // Chromium via Playwright, scoped to the `./dashboard` sub-path.
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
        "src/index.ts",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/dashboard/index.ts",
        // Test-only mount/cleanup helper (the ui and bookings packages exclude their own the same way).
        "src/dashboard/test-helpers.ts",
        // The real HTTP boundary to SumUp. Its hermetic tests are in src/sumup-client.test.ts.
        "src/sumup-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
