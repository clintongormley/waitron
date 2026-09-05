import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Task 11 adds a PGlite-backed fake, and PGlite boots a WASM Postgres that routinely takes
    // longer than Vitest's 5s default on a cold CI runner. Raised here rather than in Task 11
    // so the value is set once, deliberately, instead of appearing as a flake fix later.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
