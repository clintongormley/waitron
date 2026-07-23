import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // PGlite boots a WASM PostgreSQL and applies two migration sets, and payments.rls.test.ts /
    // wiring.test.ts additionally pull and start a real Postgres container via Testcontainers.
    // Vitest's default 5s testTimeout is a live risk for both reasons. Both costs are one-off, paid
    // in a beforeAll, so hookTimeout — raised further than testTimeout, to a container cold pull on
    // a slow CI runner — is the one that has to be generous; testTimeout covers the ordinary risk
    // of a migration suite booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork. @vitest/coverage-v8 under-merges BRANCH coverage across fork
    // workers: a branch this package's tests cover in one worker but not in another is reported
    // uncovered after the merge — proven, store.ts is 100% branch when store.test.ts runs alone but
    // 83.78% in the parallel full run, and single-fork restores it to 100%. fiscal-verifactu hits
    // the same v8 artifact but has thousands of real branches that dilute it below notice; this
    // package is small enough that a handful of mis-merged branches sinks the ratio under the
    // threshold. One fork = one coverage profile = an exact merge, at the cost of running the two
    // container tests back-to-back rather than in parallel (a few seconds on a suite this size).
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
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
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
