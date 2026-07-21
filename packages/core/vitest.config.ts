import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // record-sale.test.ts boots PGlite (a WASM PostgreSQL) and then applies `@waitron/db`'s own
    // migrations, which routinely takes longer than Vitest's 5s default on a cold CI runner —
    // mirrors packages/fiscal-verifactu/vitest.config.ts's identical reasoning for the identical
    // cost.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/shared's own vitest.config.ts excludes its identical barrel.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
