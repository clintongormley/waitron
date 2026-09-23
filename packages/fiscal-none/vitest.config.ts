import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `useVenueDb` passes its own budget to the `beforeAll` that migrates the database, and a hook's
    // own timeout overrides `hookTimeout`, so this one reaches only the helper's per-test reset and
    // close (`packages/db/src/testing/venue-db.ts`) and any untimed hook a test writes. Neither value
    // is sized to a need: measured 2026-09-23 on an 18-core Mac, every test passes under
    // `--testTimeout=2000 --hookTimeout=2000` with the helper's setup budget also cut to 2s; the
    // slowest test took 2ms and the setup 14ms. They are margin for a loaded CI runner.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One worker is kept as a precaution against @vitest/coverage-v8 under-merging branch coverage
    // across workers. This package does not need it on its own: measured 2026-09-23, coverage at
    // `--maxWorkers=1` and `--maxWorkers=3` wrote identical summaries. Whether other packages
    // running at the same time change that is not measured.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        // Re-export barrel: no imperative code, on which v8 reports phantom uncovered branches.
        "src/index.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
