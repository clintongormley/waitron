import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Every suite here boots PGlite (a WASM PostgreSQL) and applies `@waitron/db`'s migrations,
    // which routinely takes longer than Vitest's 5s default on a cold CI runner — the identical
    // reasoning packages/core/vitest.config.ts records for the identical cost.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel with no logic of its own, excluded for the same
      // reason packages/core's own vitest.config.ts excludes its identical barrel.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
