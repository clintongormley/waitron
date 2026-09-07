import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// TWO projects, ONE merged coverage report at the floor bar.
//
// The bookings package is a server/data module (real-Postgres + PGlite suites) AND, since SP2, ships a
// browser-safe `./dashboard` sub-path (Lit widgets tested in real headless Chromium). Those two suites
// cannot share a config: the Node project's Postgres `globalSetup` boots containers for every worker,
// which a pure-browser test must not trigger, and the browser project needs `@vitest/browser` +
// Playwright, which the Node suites must not carry. So each is its own project, scoped by path, and
// `test:coverage` (a single `vitest run --coverage`) runs both and merges them against the one
// threshold block below.
export default defineConfig({
  test: {
    projects: [
      {
        // The existing Node / Postgres project — unchanged config, scoped to everything EXCEPT the
        // browser sub-path.
        test: {
          name: "node",
          globals: true,
          // Shared globalSetup migrates the container templates once for the real-Postgres suites
          // (schema, verbs, routes, privileges, migration-split). It runs before every worker.
          globalSetup: ["./src/testing/global-setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"],
          // The PGlite verb suite boots a WASM PostgreSQL and applies [core, bookings] in a beforeAll;
          // the real-PG suites clone the shared template. The container boot/pull is in globalSetup,
          // which vitest does not bound by hookTimeout.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Keep singleFork (CLAUDE.md §4): @vitest/coverage-v8 under-merges BRANCH coverage across
          // fork workers, and a package this size has few enough branches that a handful of mis-merged
          // ones sink the ratio under the branch gate.
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        // The browser / Lit project — mirrors packages/ui: real headless Chromium via Playwright, NO
        // globalSetup (a browser test must never boot Docker). Scoped to the `./dashboard` sub-path.
        test: {
          name: "browser",
          globals: true,
          include: ["src/dashboard/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
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
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
        // Test-only mount/cleanup helper (the ui package excludes its own the same way).
        "src/dashboard/test-helpers.ts",
      ],
      // The floor bar: bookings is a domain module, not one of the owner's six high-bar packages
      // (CLAUDE.md §2). Pinned by scripts/coverage-thresholds.test.ts.
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
