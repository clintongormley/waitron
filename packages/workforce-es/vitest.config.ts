import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots one shared Postgres container and makes the migrated
    // `core_identity_workforce_es` template available. The retained suites use PGlite;
    // globalSetup still precedes every worker, so a Docker-absent run fails the whole package.
    // See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // `testTimeout` covers work inside an individual test. `hookTimeout` bounds a hook that passes
    // no timeout of its OWN; a hook given one overrides this config (the receipt is at
    // `packages/db/src/testing/lifecycle.ts:178`). So it does NOT bound the PGlite boot and
    // migrations, which run under `usePgliteDb`'s own 60s default; what it bounds here is the bare
    // afterEach reset and afterAll close the helper registers per suite, plus any hook a test file
    // writes for itself. The container boot/image pull runs in globalSetup, outside both.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // A single worker avoids the v8 branch-coverage merge artifact across fork workers.
    // The suites use PGlite, so they need no shared-cluster connection cap.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
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
