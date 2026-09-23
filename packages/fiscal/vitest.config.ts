import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // `src/testing/fake-backend.test.ts` opens a venue database through `useVenueDb`, which
    // creates the fake backend's two tables in its setup — the only file here that touches a
    // database at all. Vitest's 5s default is thin for that on a cold CI runner, so the bound is
    // raised here, once, rather than arriving later as a flake fix.
    //
    // The number was first written for a PGlite boot that never landed; the fake is hand-written
    // SQLite DDL. Measured 2026-09-23 in this worktree on an otherwise quiet machine:
    // `pnpm --filter @waitron/fiscal exec vitest run --testTimeout=2000` passes all seven files,
    // 186 tests, in 425ms end to end. Thirty seconds is the headroom, not the measurement.
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
