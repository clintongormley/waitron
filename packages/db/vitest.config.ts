import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Most test files here run real SQL against a SQLite file under `os.tmpdir()`.
    // `grep -rL useVenueDb --include="*.test.ts" src` lists the ones that do not open it through
    // `useVenueDb`, which is not the same as the ones touching no database.
    //
    // Thirty seconds is margin, not a need: measured 2026-09-23, every test passes under
    // `--testTimeout=2000 --hookTimeout=2000` with `useVenueDb`'s default setup budget also cut to
    // 2s; the slowest test took 74ms and the slowest setup 83ms. A bound that fires under CI load
    // makes a suite people learn to rerun, and a suite people rerun no longer gates.
    testTimeout: 30_000,
    // `useVenueDb` passes its own budget to the `beforeAll` that migrates the database
    // (`src/testing/venue-db.ts`), and a hook's own timeout overrides this one, so this reaches only
    // the helper's `afterEach` reset and `afterAll` close and any untimed hook. Also margin: those
    // passed in the 2s run above.
    hookTimeout: 120_000,
    // No `globalSetup`: each suite opens its own database through `useVenueDb`.
    //
    // A cap on workers, not a need for exactly four: measured 2026-09-23 on an 18-core Mac, the suite
    // took 20.3s at one worker, 6.4s at four and 5.9s at eight, and `test:coverage` at one and at
    // four workers gave the same covered and total counts for every file.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/testing/** is measured like the rest of src/: excluding it once hid helpers no test ran.
      //
      // drizzle.config.ts is a drizzle-kit CLI input, never imported at runtime.
      //
      // src/english-only.ts is measured by the ROOT Vitest project, where its only suite lives
      // (scripts/english-only.test.ts); nothing in this package imports it. It stays under src/ so
      // this package's typecheck covers it, since the root project typechecks nothing. The coverage
      // runs behind this exclusion are in the commit that added it (f8d6097d0, PR #35).
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle/**",
        "drizzle.config.ts",
        "src/english-only.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
