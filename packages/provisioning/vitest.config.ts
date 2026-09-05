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
      // `src/bin.ts` is the process entry point: every decision it could get wrong lives in
      // `cli.ts`, which is injected and fully tested, and what remains — a tty, a readline, a
      // process exit code — is verifiable only by running the built bundle, which the plan does
      // rather than a test. `scripts/**` is a BUILD step (`copy-migrations.mjs`), not something
      // this package's tests load at all; `apps/server/vitest.config.ts:41` excludes its own for
      // the same reason.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "scripts/**",
        "src/bin.ts",
        "src/index.ts",
        "src/testing/**",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
