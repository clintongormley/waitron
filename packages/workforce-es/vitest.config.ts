import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots one shared Postgres container and makes the migrated
    // `core_identity_workforce_es` template available. The retained suites use PGlite;
    // globalSetup still precedes every worker, so a Docker-absent run fails the whole package.
    // See src/testing/global-setup.ts.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so hookTimeout
    // covers that setup. The container boot/image pull runs in globalSetup, outside hookTimeout.
    // testTimeout covers work inside an individual test.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
        // The PGlite suites boot a WASM PostgreSQL and apply migrations in beforeAll, so
        // hookTimeout covers that setup. The container boot/image pull runs in globalSetup,
        // outside hookTimeout. testTimeout covers work inside an individual test.
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
