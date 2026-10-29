import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // One worker: v8 coverage under-merges across workers under load.
    maxWorkers: 1,
    // Reading a QR code back draws an A4 page at three times its size: about a second a page
    // locally under coverage, and about three on a CI runner, where two pages took 6.1 seconds.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a re-export barrel with no logic.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
