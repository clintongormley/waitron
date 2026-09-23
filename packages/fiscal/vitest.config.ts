import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Only `src/testing/fake-backend.test.ts` opens a database, through `useVenueDb`, whose setup
    // carries its own budget. Thirty seconds is margin, not a need: measured 2026-09-23, every test
    // passes under `--testTimeout=2000` with that setup budget also cut to 2s; the slowest test took
    // 2ms and the setup 5ms.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
