import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // globalSetup boots ONE shared Postgres container and migrates the `core_credentials`
    // template the real-PG suite clones (~26ms) instead of that file booting and migrating its
    // own (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a
    // Docker-absent run now fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // `testTimeout` covers work inside an individual test. `hookTimeout` bounds a hook that passes
    // no timeout of its OWN; a hook given one overrides this config (stated at
    // `packages/db/src/testing/lifecycle.ts:178`, measured at `:182-183`). So it does NOT bound the
    // PGlite boot and migrations the four PGlite suites pay in a beforeAll, which run under
    // `usePgliteDb`'s own 60s default; what it bounds here is the real-PG suite's clone of
    // globalSetup's already-migrated `core_credentials` template — `useTemplateDb` deliberately
    // carries no default — and both helpers' bare afterEach reset and afterAll close, plus any hook
    // a test file writes for itself. The container boot/image pull runs in globalSetup, outside both.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Keep one worker (unchanged from this package's original config). It is here for the
    // @vitest/coverage-v8 branch-merge artifact: v8 under-merges BRANCH coverage across fork workers,
    // and this package is small enough that a handful of mis-merged branches sinks the ratio under
    // threshold. Same finding as packages/payments and packages/scheduler. A consequence, not the
    // reason: one worker also means only ONE test file runs at a time, so the shared cluster's single
    // 100-connection budget is a non-issue here and needs no `maxWorkers` cap — unlike packages/db, which
    // runs multi-fork and caps forks at 4 for exactly that budget.
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
        // The process entry point: argv, env, stdin, stdout and a real connection, and nothing
        // else. Every decision it could get wrong lives in `cli.ts`, which is injected and fully
        // tested; what remains here is the wiring that can only be exercised by running the built
        // bundle. Excluded on the same grounds as packages/payments-stripe's `stripe-client.ts` —
        // a thin boundary whose logic belongs to something else.
        "src/bin.ts",
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
