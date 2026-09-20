import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots ONE shared Postgres container and migrates the `core` template every real-PG
    // suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails the
    // whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // Most suites here boot PGlite (a WASM PostgreSQL) and apply `@waitron/db`'s migrations, longer
    // than Vitest's 5s default on a cold CI runner; the real-PG suites clone the shared container's
    // migrated `core` template (globalSetup, above).
    //
    // `hookTimeout` does NOT bound that PGlite boot. `useVenueDb` times its own `beforeAll`
    // (`packages/db/src/testing/lifecycle.ts:146`) and all fourteen call sites in this package pass
    // `timeoutMs: 60_000`, so 60s is the number that applies there and this one never is. What it
    // DOES bound is the hooks left untimed: the helpers' per-test reset and close, this package's
    // own `beforeEach` seeds, and the template clone the two real-PG suites take without a
    // `timeoutMs` of their own.
    //
    // Measured in both directions in one run —
    // `vitest run src/counts.test.ts src/record-daily-close.pg.test.ts --hookTimeout=1`. The PGlite
    // boot survives it: `src/counts.test.ts`'s three tests RUN, and fail in hooks that only fire
    // after a successful boot — that file's own untimed `beforeEach` (`:12`) and `lifecycle.ts:148`
    // and `:153`, the reset and the close, each reached through `venue-db.ts:26`. A `beforeAll` that
    // DOES time out skips its tests instead, which is what the real-PG file in the same run does: it
    // fails in `lifecycle.ts:422`, its clone, and its four tests are skipped. Run-versus-skip is the
    // discriminator; the collected count is not, because both files collect either way.
    //
    // The container boot/pull is NOT in a beforeAll: it moved to globalSetup, which vitest does not
    // bound by hookTimeout. testTimeout covers a migration suite booting a second database inside a
    // single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Run the whole suite in ONE fork. This is here for the @vitest/coverage-v8 branch-merge artifact,
    // NOT for the shared cluster's connection budget: v8 under-merges BRANCH coverage across fork
    // workers, and this package is small enough that a handful of mis-merged branches sinks the ratio
    // below threshold. Same finding as packages/workforce, payments, scheduler and credentials.
    //
    // A consequence, not the reason: one worker also means only ONE test file runs at a time, so the
    // shared cluster's single 100-connection budget is a non-issue here and needs no `maxWorkers` cap —
    // unlike packages/db, which runs multi-fork and caps forks at 4 for exactly that budget.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // A pure re-export barrel, excluded for the same reason packages/core's config excludes its
        // identical one.
        "src/index.ts",
        // The shared-container globalSetup is test-only plumbing (mirrors workforce/fiscal excluding
        // their own src/testing/**); it runs in the main process before every worker, so it reads 0%
        // and must not be measured.
        "src/testing/**",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
