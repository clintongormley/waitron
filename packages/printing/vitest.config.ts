import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // globalSetup boots ONE shared Postgres container and migrates the `core` template every real-PG
    // suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run fails the
    // whole package — the same broadening the sibling real-PG packages (db, identity) accepted.
    globalSetup: ["./src/testing/global-setup.ts"],
    // The real-PG suites clone the shared container's already-migrated `core` template (globalSetup),
    // so their beforeAll is a ~26ms CREATE DATABASE … TEMPLATE, not a per-file container boot+migrate;
    // the container's one-off boot is paid once in globalSetup, off this timeout. hookTimeout stays
    // generous mainly for globalSetup's own image pull on a cold CI runner; testTimeout covers the
    // ordinary risk of the concurrency suite opening several backends.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork, matching the sibling real-PG packages. Single-fork guards the
    // @vitest/coverage-v8 cross-fork branch under-merge (a branch covered only in one worker can read
    // as uncovered after merging profiles), and — because only ONE test file runs at a time — the
    // shared cluster's single connection budget is a non-issue, so the concurrency suite's extra
    // backends never race another file's.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel (excluded like packages/layouts/purchasing exclude
      // theirs); src/testing/** is the globalSetup harness. errors.ts IS measured — it erases to a
      // single `import "@waitron/shared"` that executes when the barrel is imported, so it covers
      // trivially; agent.ts is the real subject of this package's suites.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
