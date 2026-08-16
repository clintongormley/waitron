import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // The DB-backed suites (operations.test.ts) boot PGlite (a WASM PostgreSQL) and apply
    // `@waitron/db`'s migrations, which routinely takes longer than Vitest's 5s default on a cold CI
    // runner; the RLS suite additionally pulls and starts a real Postgres container. Same reasoning
    // as packages/recipes/vitest.config.ts.
    testTimeout: 30_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel; src/testing/** and test/** hold the DB harness and
      // fixtures. All are test infrastructure, not measured product code (the same exclusions
      // packages/recipes records).
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**", "test/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
