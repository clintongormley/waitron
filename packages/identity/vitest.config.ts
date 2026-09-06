import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core_identity` template
    // every real-PG suite clones (~26ms) instead of each file booting and migrating its own (~1.5s).
    // See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now
    // fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // PGlite setup boots WASM and applies core + identity migrations. PostgreSQL suites clone
    // the migrated template; its container starts in globalSetup, outside hookTimeout.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork, KEPT unchanged from before this change (it predates the
    // shared-container conversion; `git log -S 'singleFork'` dates it to #58, with no stated reason).
    // Across the repo, single-fork guards the @vitest/coverage-v8 cross-fork branch under-merge — v8
    // can report a branch covered only in one worker as uncovered after merging profiles, which sinks
    // packages/payments' `store.ts` from 100% to 83.78% multi-fork. This package does NOT reproduce
    // that today: measured 2026-08-20, `test:coverage` prints 100/100/100/100 under BOTH single-fork
    // and `--poolOptions.forks.singleFork=false` (no module's branch coverage here mis-merges below the
    // gate across workers). So single-fork is not demonstrably load-bearing for identity's threshold
    // right now; it is kept because dropping it is a behaviour change out of scope for a test-wiring
    // refactor, the parallelism it forgoes is minor (identity is a `test-light` shard member, not the
    // CI critical path), and it holds the line if a future test does split a module's branches across
    // files. It is NOT here for the shared cluster's connection budget.
    //
    // A consequence either way: single-fork means only ONE test file runs at a time, so the shared
    // cluster's single 100-connection budget is a non-issue here and needs no `maxForks` cap — even
    // though passkey.concurrency.test.ts opens several backends, no other file runs alongside it.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
