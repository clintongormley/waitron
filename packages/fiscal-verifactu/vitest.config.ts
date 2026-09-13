import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Keep at most four fork workers alive; scripts/fiscal-test-budget.test.ts pins it.
    poolOptions: { forks: { maxForks: 4 } },
    // Shared globalSetup requires Docker for the real-Postgres privilege and concurrency suites.
    // It runs once before the workers, including for PGlite-only selections.
    globalSetup: ["./src/testing/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // PGlite boots a WASM PostgreSQL and then applies the whole manifest, and the concurrency /
    // e2e suites clone the shared container's migrated template (globalSetup, above). Each per-suite
    // cost is paid in a beforeAll — the PGlite WASM boot + migrations, or the real-PG ~26ms clone —
    // so hookTimeout stays generous for the PGlite boot. The container boot/pull is NOT in a
    // beforeAll: it moved to globalSetup, which vitest does not bound by hookTimeout. testTimeout
    // covers the ordinary risk of a migration suite booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle.config.ts",
        "drizzle/**",
        "src/testing/**",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
