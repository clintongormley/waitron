import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core_payments` template
    // every real-PG suite clones (~26ms) instead of each file booting and migrating its own
    // (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent
    // run now fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The hermetic suites boot PGlite (a WASM PostgreSQL) and apply migrations, and the real-PG
    // suites clone the shared container's migrated template (globalSetup, above); Vitest's 5s
    // default testTimeout is a live risk for both. Each per-suite cost is paid in a beforeAll —
    // the PGlite WASM boot, or the real-PG ~26ms clone — so hookTimeout stays generous for the
    // PGlite boot. The container boot/pull is NOT in a beforeAll: it moved to globalSetup, which
    // vitest does not bound by hookTimeout. testTimeout covers the ordinary risk within a single
    // `it`.
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
