import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Most suites here boot PGlite (a WASM PostgreSQL) and apply `@waitron/db`'s migrations, longer
    // than Vitest's 5s default on a cold CI runner; `record-daily-close.rls.test.ts` additionally
    // pulls and starts a real Postgres container via Testcontainers for its concurrency proof. Both
    // costs are one-off, paid in a beforeAll, so hookTimeout is the generous one (a container cold
    // pull on a slow runner) while testTimeout covers a migration suite booting inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding as
    // packages/workforce, payments, scheduler and credentials. It also serialises the one container
    // suite against the PGlite ones rather than racing two databases up at once.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // A pure re-export barrel, excluded for the same reason packages/core's config excludes its
        // identical one.
        "src/index.ts",
        // The real-Postgres container starter is test-only plumbing (mirrors workforce/fiscal
        // excluding their own src/testing/**); it is exercised by the .rls suite, not measured.
        "src/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
