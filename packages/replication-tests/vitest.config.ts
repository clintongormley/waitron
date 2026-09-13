import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Every suite here boots its own PostgreSQL node or pair (src/testing/replication-node.ts and
// @waitron/db's two-node fixtures) — there is no shared-container globalSetup. One fork runs one
// file at a time, so two suites' clusters never compete for the runner. Locally the real-PG tier
// needs TESTCONTAINERS_RYUK_DISABLED=true or container startup hangs (CLAUDE.md §4).
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    poolOptions: { forks: { singleFork: true } },
    // Nothing here is product code and src/testing is excluded, so coverage measures no files: run
    // locally on 2026-09-13 it printed 0% and exited 0. The thresholds literal is the floor
    // scripts/coverage-thresholds.test.ts requires of every tested package.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/testing/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
