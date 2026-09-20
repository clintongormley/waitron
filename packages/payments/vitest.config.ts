import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // globalSetup boots ONE shared Postgres container and migrates the `core_payments` template every
    // real-PG suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run now fails
    // the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // PGlite boots a WASM PostgreSQL and applies two migration sets, and the real-Postgres suites
    // clone the shared container's migrated template (globalSetup, above). Each per-suite cost is
    // paid in a beforeAll — the PGlite WASM boot + migrations, or the real-PG ~26ms clone.
    //
    // `hookTimeout` does NOT bound that PGlite boot. `useVenueDb` times its own `beforeAll`
    // (`packages/db/src/testing/lifecycle.ts:146`), and no call site in this package passes a
    // `timeoutMs`, so the helper's own 60s default applies there and this setting never does. What
    // it DOES bound is the hooks left untimed: the helper's per-test reset and close
    // (`lifecycle.ts:148` and `:153`, each reached through `venue-db.ts:26`), a suite's own
    // `beforeEach`, and the template clone the real-PG suites take without a `timeoutMs` of their
    // own (`lifecycle.ts:422`).
    //
    // Measured in both directions in one run —
    // `vitest run src/policy.test.ts src/store.pg.test.ts --hookTimeout=1`. The PGlite boot
    // survives it: all eight of `src/policy.test.ts`'s tests RUN, and the failures land in hooks
    // that only fire after a successful boot — that file's own `beforeEach` (`:37`) and the
    // helper's reset and close. A `beforeAll` that really does time out SKIPS its tests instead,
    // which is what the real-PG file in the same run does: it fails in `lifecycle.ts:422`, its
    // clone, and all seven of its tests are skipped. Run-versus-skip is the discriminator; the
    // collected count is not, because both files collect either way.
    //
    // The container boot/pull is NOT in a beforeAll: it moved to globalSetup, which vitest does not
    // bound by hookTimeout. testTimeout covers the ordinary risk of a migration suite booting a
    // second database inside a single `it` (`src/migrations.test.ts:27`) — a test body, which
    // hookTimeout does not reach either.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. This is here for the @vitest/coverage-v8 branch-merge
    // artifact, NOT for the shared cluster's connection budget: v8 under-merges BRANCH coverage
    // across fork workers, so a branch this package's tests cover in one worker but not another is
    // reported uncovered after the merge — proven, store.ts is 100% branch when store.test.ts runs
    // alone but 83.78% in the parallel full run, and single-fork restores it to 100%.
    // fiscal-verifactu hits the same v8 artifact but has thousands of real branches that dilute it
    // below notice; this package is small enough that a handful of mis-merged branches sinks the
    // ratio under the threshold. One fork = one coverage profile = an exact merge, at the cost of
    // running the container tests back-to-back rather than in parallel (a few seconds on a suite
    // this size).
    //
    // A consequence, not the reason: one worker also means only ONE test file runs at a time, so the
    // shared cluster's single 100-connection budget is a non-issue here and needs no `maxWorkers` cap
    // — unlike packages/db, which runs multi-fork and caps forks at 4 for exactly that budget.
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
        // The two public re-export barrels. They are manifests — `export { … } from "./x.js"` with
        // no imperative code — and v8 reports phantom uncovered branches/functions on the re-export
        // bindings themselves (a barrel binding registers as "called" only when imported THROUGH
        // the barrel, but every consumer in this package imports the deep path). Nothing in them is
        // testable by line or branch; their surface is asserted structurally by src/index.test.ts
        // (which checks the exported names) and schema-ownership.test.ts. Excluding them keeps the
        // branch/function metric measuring real logic (store.ts, the schema constraint callbacks)
        // rather than a v8 artifact. The neutral packages/fiscal barrel escapes this only because it
        // is a single value re-export; this package's root barrel re-exports the whole store surface.
        "src/index.ts",
        "src/schema/index.ts",
        // manual.ts is a branchless thin-wrapper module (two straight-line async functions over the
        // store, no conditionals at all). v8 still invents a phantom "branch" and attributes it to
        // the import line, and — unlike the barrels above — the count is environment-dependent: 100%
        // branch locally but 66.66% (1 of 3 invented branches "uncovered") under CI's Linux V8,
        // which sank the package's aggregate below the 95% branch gate. Every line/function IS
        // exercised by manual.test.ts + manual.wiring.test.ts, so the exclusion drops only the v8
        // artifact, not real coverage. Remove this line if manual.ts ever grows genuine branching
        // logic (then it has real branches worth gating).
        "src/manual.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
