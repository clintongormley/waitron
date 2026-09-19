import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // globalSetup boots ONE shared Postgres container and migrates the `core_scheduler` template every
    // real-PG suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // hookTimeout does NOT bound the PGlite boot. The four PGlite suites boot a WASM PostgreSQL and
    // apply two migration sets, but they ask for it through `useVenueDb`, which hands `beforeAll` its
    // own 60s default (packages/db/src/testing/lifecycle.ts:22, passed at :146), and a timeout passed
    // to a hook overrides this config's (stated at lifecycle.ts:178, measured at :182-183). What
    // hookTimeout bounds instead is the hooks that pass no timeout of their own, among them:
    // `useTemplateDb`'s `beforeAll`, which deliberately takes no default (lifecycle.ts:382), and its
    // `afterAll`, which takes no timeout argument at all (:440) — the `core_scheduler` clone is inside
    // the first of those; the PGlite helper's own per-test reset and close (:148, :153); and each
    // suite's untimed hooks, including store.concurrency.test.ts's
    // `beforeAll` and `afterAll` and the `beforeEach` seeds in run.test.ts and resweep.test.ts. Two
    // costs sit outside it either way: the container boot / image pull, which moved to globalSetup
    // and vitest does NOT bound by hookTimeout, and run.test.ts's own direct PGlite boot, which is
    // inside an `it` and so bounded by testTimeout.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep one worker (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/payments. A consequence, not the reason: one worker also
    // means only ONE test file runs at a time, so the shared cluster's single 100-connection budget is
    // a non-issue here and needs no `maxWorkers` cap — unlike packages/db, which runs multi-fork and
    // caps forks at 4 for exactly that budget.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // Re-export barrels: manifests with no imperative code, on which v8 reports phantom
        // uncovered branches. Their surface is asserted structurally by index.test.ts and
        // schema-ownership.test.ts.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
