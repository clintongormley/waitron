import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Headroom for the container suites `instance` will need (it creates databases and roles, which
    // PGlite's single-superuser server cannot reproduce). Every test in this package TODAY is a pure
    // function or an injected-IO call and finishes in milliseconds — these ceilings are not load-
    // bearing yet, and nothing here boots a database.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers, and this
    // package is small enough that a handful of mis-merged branches sinks the ratio. Same finding
    // as packages/payments and packages/scheduler.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` and `src/testing/**` are listed ahead of existing: the process entry point
      // and the container helper arrive with `instance`. A path that matches nothing is inert.
      exclude: [...coverageConfigDefaults.exclude, "src/bin.ts", "src/index.ts", "src/testing/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
