import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots one shared Postgres container and makes the migrated `core` template
    // available. The retained suites use PGlite; globalSetup still precedes every worker, so a
    // Docker-absent run fails the whole package. See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // `testTimeout` covers work inside an individual test. `hookTimeout` bounds a hook that passes
    // no timeout of its OWN; a hook given one overrides this config (the receipt is at
    // `packages/db/src/testing/lifecycle.ts:178`). So it does NOT bound the PGlite boot and
    // migrations, which run under the 60s default `useVenueDb` forwards to
    // (`packages/db/src/testing/lifecycle.ts:22`, applied at `:146`). The container boot/image pull
    // runs in globalSetup, outside both.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The suites use PGlite and do not open PostgreSQL backend pools, so they need no
    // shared-cluster connection cap. Coverage merges across the default fork workers.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own; src/testing/** and test/**
      // hold the DB harness/fixtures. All three are test infrastructure, not measured product code, so
      // they are excluded from the coverage thresholds below (the same barrel exclusion
      // packages/catalogue's own vitest.config.ts records).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
