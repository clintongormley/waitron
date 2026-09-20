import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // globalSetup boots ONE shared Postgres container and migrates the `core` template every real-PG
    // suite clones (~26ms) instead of each file booting and migrating its own (~1.5s). See
    // src/testing/global-setup.ts. Because it precedes every worker, a Docker-absent run fails the
    // whole package — the same broadening the sibling real-PG packages (db, identity) accepted.
    globalSetup: ["./src/testing/global-setup.ts"],
    // `testTimeout` covers work inside an individual test, including the concurrency suite opening
    // several backends and this package's seeding, which every test does for itself rather than in a
    // hook. `hookTimeout` bounds a hook that passes no timeout of its OWN; a hook given one overrides
    // this config (the receipt is at `packages/db/src/testing/lifecycle.ts:178`). So it DOES bound the
    // real-PG suites' beforeAll — a CREATE DATABASE … TEMPLATE against globalSetup's already-migrated
    // `core` template, and `useTemplateDb` deliberately carries no default — and it bounds both
    // helpers' bare afterEach reset and afterAll close, the PGlite suites' included. The one database
    // hook it does NOT bound is the PGlite boot and migrations, which run under the 60s default
    // `useVenueDb` forwards to (`packages/db/src/testing/lifecycle.ts:22`, applied at `:146`). The container boot/image pull runs in globalSetup, outside both.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Run the whole suite in ONE fork, matching the sibling real-PG packages. Single-fork guards the
    // @vitest/coverage-v8 cross-fork branch under-merge (a branch covered only in one worker can read
    // as uncovered after merging profiles), and — because only ONE test file runs at a time — the
    // shared cluster's single connection budget is a non-issue, so the concurrency suite's extra
    // backends never race another file's.
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/index.ts is a pure re-export barrel (excluded like packages/layouts/purchasing exclude
      // theirs); src/testing/** is the globalSetup harness. errors.ts IS measured — it erases to a
      // single `import "@waitron/shared"` that executes when the barrel is imported, so it covers
      // trivially; agent.ts is the real subject of this package's suites.
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts", "src/testing/**"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
