import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Separate Node and browser projects share one coverage report. Run Node first so Chromium
// does not compete with this package's PostgreSQL/PGlite work, and bound browser concurrency.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          sequence: { groupOrder: 0 },
          globals: true,
          // Migrate the shared templates once before this project's workers start.
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
