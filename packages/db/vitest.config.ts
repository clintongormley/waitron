import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Thirty seconds is margin, not a need. A bound that fires under CI load makes a suite people
    // learn to rerun, and a suite people rerun no longer gates.
    testTimeout: 30_000,
    // `useVenueDb` passes its own budget to the `beforeAll` that migrates the database
    // (`src/testing/venue-db.ts`), and a hook's own timeout overrides this one, so this reaches only
    // the helper's `afterEach` reset and `afterAll` close and any untimed hook.
    hookTimeout: 120_000,
    // A cap on workers, not a need for exactly four. CI's `test-heavy` shards pass no worker count
    // of their own (`.github/workflows/ci.yml`), so they run with this one.
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
      // this package's typecheck covers it, since the root project typechecks nothing.
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
