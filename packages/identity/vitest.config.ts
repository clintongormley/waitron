import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `useVenueDb` passes its own budget to the `beforeAll` that migrates the database, and a hook's
    // own timeout overrides `hookTimeout`, so this one reaches only the helper's `afterEach` reset and
    // `afterAll` close (`packages/db/src/testing/venue-db.ts`) and any untimed hook a test writes.
    // Neither value is sized to a need: measured 2026-09-23, every test passes under
    // `--testTimeout=2000 --hookTimeout=2000` with the helper's setup budget also cut to 2s; the
    // slowest test took 185ms and the slowest setup 49ms. They are margin for a loaded CI runner.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // One worker is kept as a precaution against @vitest/coverage-v8 under-merging branch coverage
    // across workers. This package does not need it on its own: measured 2026-09-23, `test:coverage`
    // at one worker (22.3s) and with `--maxWorkers=6` (6.2s) gave the same covered and total counts
    // for every file. Whether other packages running at the same time change that is not measured.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/index.ts",
        "src/schema/index.ts",
      ],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
