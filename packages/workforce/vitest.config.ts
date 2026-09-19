import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // globalSetup boots ONE shared Postgres container and migrates the `core_identity_workforce`
    // template every real-PG suite clones (~26ms) instead of each file booting and migrating its own
    // (~1.5s). See src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run
    // now fails the whole package (that file's header explains the broadening).
    globalSetup: ["./src/testing/global-setup.ts"],
    // The heavy real-Postgres boot+migrate is paid ONCE in globalSetup (above), not per file. What is
    // left in a per-suite beforeAll is either a template clone (the real-PG suites, through
    // `useTemplateDb`) or a PGlite WASM boot + migration sets (the hermetic `useVenueDb` suites).
    // hookTimeout bounds the FORMER and not the latter: `useTemplateDb` registers its beforeAll with
    // `options.timeoutMs`, which no suite here passes, so it falls back to this setting, while
    // `useVenueDb` registers its own `options.timeoutMs ?? 60s`
    // (packages/db/src/testing/lifecycle.ts:431 and :146). It bounds any other hook that passes no
    // timeout of its own by the same rule, both helpers' untimed afterEach/afterAll among them; it
    // does NOT reach globalSetup, which vitest does not bound by it at all. Measured on this
    // package, not read: one run of both files under `--hookTimeout=50` fails
    // src/immutability.test.ts on `useTemplateDb`'s beforeAll — so the ceiling was in force — while
    // src/absences.test.ts passes all ten, and that same run reached both files at all, which it
    // could not have done had the ceiling killed the container boot. Putting `timeoutMs: 50` on the
    // absences call then does fail its beforeAll in 50ms. Only those two beforeAll hooks were put
    // against a ceiling; the afterEach/afterAll clause is the rule, not a measurement. testTimeout
    // covers the ordinary risk of a migration suite booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. This is here for the @vitest/coverage-v8 branch-merge
    // artifact, NOT for the shared cluster's connection budget: v8 under-merges BRANCH coverage
    // across fork workers, and this package is small enough that a handful of mis-merged branches
    // sinks the ratio under the threshold. Same finding as packages/payments, packages/scheduler and
    // packages/credentials.
    //
    // A consequence, not the reason: one worker also means only ONE test file runs at a time, so the
    // shared cluster's single 100-connection budget is a non-issue here and needs no `maxWorkers` cap
    // — even though this package has concurrency suites (chain/clocking/scheduling), only one runs at
    // a time. (packages/db runs multi-fork and caps forks at 4 for exactly that budget.)
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
