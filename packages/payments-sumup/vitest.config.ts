import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Two projects share one coverage report: the server suites run in Node (real Postgres / PGlite), and
// the dashboard panel's Lit widgets run in real headless Chromium (mirrors packages/bookings). Run Node
// first so Chromium does not compete with this package's PostgreSQL work.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          sequence: { groupOrder: 0 },
          globals: true,
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
          // Keep singleFork (#22): only ONE test file runs at a time, so the shared cluster's single
          // 100-connection budget is a non-issue and needs no `maxForks` cap.
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        // The browser / Lit project — mirrors packages/ui and packages/bookings: real headless Chromium
        // via Playwright, NO globalSetup (a browser test must never boot Docker). Scoped to the
        // `./dashboard` sub-path.
        test: {
          name: "browser",
          sequence: { groupOrder: 1 },
          globals: true,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            fileParallelism: false,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/index.ts",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/dashboard/index.ts",
        // Test-only mount/cleanup helper (the ui and bookings packages exclude their own the same way).
        "src/dashboard/test-helpers.ts",
        // the real HTTP boundary — a thin fetch mapping exercised only by the live sandbox suite
        // against the paired Solo, never the hermetic run; its logic is SumUp's
        "src/sumup-client.ts",
        "src/testing/**",
        "src/**/*.sandbox.test.ts",
        // The nightly sandbox suite's OWN vitest config (a `defineConfig()` call, no logic) — v8's
        // `all`-file scan otherwise picks up this package-root file since it doesn't match the
        // default excludes' `vitest.config.*` token (it's `vitest.sandbox.config.ts`, a distinct
        // file from `vitest.config.ts`).
        "vitest.sandbox.config.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
