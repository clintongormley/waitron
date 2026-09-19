import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// Two projects share one coverage report: the server suites run in Node (real Postgres / PGlite), and
// the dashboard panel's Lit widgets run in real headless Chromium (mirrors packages/bookings). Run Node
// first so Chromium does not compete with this package's PostgreSQL work.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Numbered from 1, not 0: Vitest 4 lifts a groupOrder-0 project that runs one isolated
          // worker out of its group and appends it after every other group, which put Chromium
          // ahead of this project. Measured on packages/bookings, against the same run on Vitest 3:
          // with 0/1 the browser project's first test precedes this project's, with 1/2 it follows.
          sequence: { groupOrder: 1 },
          globals: true,
          clearMocks: false,
          // globalSetup boots ONE shared Postgres container and migrates the `core_payments` template
          // every real-PG suite clones (~26ms) instead of each file booting and migrating its own
          // (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent
          // run now fails the whole project (that file's header explains the broadening).
          globalSetup: ["./src/testing/global-setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            "**/.stryker-tmp/**",
            "src/**/*.sandbox.test.ts",
            // The dashboard panel is browser-mode; it runs in the project below, never boots Docker.
            "src/dashboard/**",
          ],
          // The hermetic suites boot PGlite (a WASM PostgreSQL) and apply migrations, and the real-PG
          // suites clone the shared container's migrated template (globalSetup); Vitest's 5s default
          // testTimeout is a live risk for both. The container boot/pull is NOT in a beforeAll: it moved
          // to globalSetup, which vitest does not bound by hookTimeout.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Keep one worker (#22): only ONE test file runs at a time, so the shared cluster's single
          // 100-connection budget is a non-issue and needs no `maxWorkers` cap.
          maxWorkers: 1,
        },
      },
      {
        // The browser / Lit project — mirrors packages/ui and packages/bookings: real headless Chromium
        // via Playwright, NO globalSetup (a browser test must never boot Docker). Scoped to the
        // `./dashboard` sub-path.
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
        // The real Stripe SDK boundary — a thin call-mapping wrapper exercised only by the nightly
        // sandbox suite (real test-mode), never the hermetic run. Its logic is the SDK's; excluding
        // it keeps the branch metric on our own logic (the provider, client.ts's `toMinorUnits`,
        // errors) rather than the SDK boundary; the `FakeStripe` test double lives under
        // `src/testing/**` and is excluded like all test infra.
        "src/stripe-client.ts",
        // The real on-device SDK boundary — server-side calls exercised only by the nightly sandbox;
        // the device-side collect/offline-queue run in the device SDK, proven by FakeStripeDevice.
        "src/stripe-device-client.ts",
        // The real Checkout/webhooks SDK boundary — createCheckoutSession exercised only by the
        // nightly sandbox; constructWebhookEvent's mapping is proven through FakeStripeHosted.
        "src/stripe-hosted-client.ts",
        // The real balance-transaction / Checkout-session SDK boundary — paging and field mapping
        // exercised only by the nightly sandbox; the report source's own logic is proven through
        // FakeStripeReport.
        "src/stripe-report-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
