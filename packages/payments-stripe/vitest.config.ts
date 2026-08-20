import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core_payments` template every
    // real-PG (RLS) suite clones (~26ms) instead of each file booting and migrating its own (~1.5s).
    // See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails
    // the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The hermetic suites boot PGlite (a WASM PostgreSQL) and apply migrations, and the RLS suites
    // clone the shared container's migrated template (globalSetup, above); Vitest's 5s default
    // testTimeout is a live risk for both. Each per-suite cost is paid in a beforeAll — the PGlite
    // WASM boot, or the real-PG ~26ms clone — so hookTimeout stays generous for the PGlite boot. The
    // container boot/pull is NOT in a beforeAll: it moved to globalSetup, which vitest does not bound
    // by hookTimeout. testTimeout covers the ordinary risk within a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.sandbox.test.ts"],
    // Keep singleFork (unchanged from this package's original config, #22). Its relevant consequence
    // for the shared-container migration: only ONE test file runs at a time, so the shared cluster's
    // single 100-connection budget is a non-issue and needs no `maxForks` cap — unlike packages/db,
    // which runs multi-fork and caps forks at 4 for exactly that budget.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
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
        // The nightly sandbox suite's OWN vitest config (a `defineConfig()` call, no logic) — v8's
        // `all`-file scan otherwise picks up this package-root file since it doesn't match the
        // default excludes' `vitest.config.*` token (it's `vitest.sandbox.config.ts`, a distinct
        // file from `vitest.config.ts`).
        "vitest.sandbox.config.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
