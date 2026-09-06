import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // globalSetup boots one shared Postgres container and makes the migrated `core` template
    // available. The retained suites use PGlite; globalSetup still precedes every worker, so a
    // Docker-absent run fails the whole package. See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so
      // hookTimeout covers that setup. The container boot/image pull runs in globalSetup, outside
      // hookTimeout. testTimeout covers work inside an individual test.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
