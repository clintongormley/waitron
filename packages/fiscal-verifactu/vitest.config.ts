import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// The main suites share a PostgreSQL container; the replication suite owns its own pair.
// Run them in separate groups, with one merged coverage report. The pool's fork limit belongs
// on the OUTER test config: Vitest 3's createForksPool reads vitest.config, not project.config.
const twoNodeSuite = "src/replication-fidelity.pg.test.ts";

export default defineConfig({
  test: {
    // Keep at most four fork workers alive. Per-project singleFork still selects
    // the replication suite's serial lane inside this pool.
    poolOptions: { forks: { maxForks: 4 } },
    projects: [
      {
        test: {
          name: "main",
          globals: true,
          // Shared globalSetup requires Docker for the real-Postgres privilege and concurrency suites.
          // It runs once before this project's workers, including for PGlite-only selections.
          globalSetup: ["./src/testing/global-setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", twoNodeSuite],
          // PGlite boots a WASM PostgreSQL and then applies the whole manifest, and the concurrency /
          // e2e suites clone the shared container's migrated template (globalSetup, above). Each per-suite
          // cost is paid in a beforeAll — the PGlite WASM boot + migrations, or the real-PG ~26ms clone —
          // so hookTimeout stays generous for the PGlite boot. The container boot/pull is NOT in a
          // beforeAll: it moved to globalSetup, which vitest does not bound by hookTimeout. testTimeout
          // covers the ordinary risk of a migration suite booting a second database inside a single `it`.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // Group 0: runs to completion before the `replication` group (groupOrder 1) starts.
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "replication",
          globals: true,
          // The two-node cluster boots its OWN pair of containers (startTwoNodeCluster); it does not clone
          // the shared template, so it needs no globalSetup — one fewer shared container to contend with.
          include: [twoNodeSuite],
          exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          // The one replication file runs serially after the main project.
          poolOptions: { forks: { singleFork: true } },
          // Group 1: starts only after every `main` (group 0) file has finished.
          sequence: { groupOrder: 1 },
        },
      },
    ],
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
