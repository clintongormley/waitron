import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Vitest's 5s default is a live risk in this package and nowhere else in
    // the repo: every test here boots a WASM PostgreSQL. The figure comes from
    // docs/research/2026-07-20-pglite-throughput.md — cold boot plus schema
    // plus seed, with an order of magnitude of headroom, because a timeout
    // that fires under CI load produces a flaky suite that people learn to
    // rerun, and a suite people rerun is a suite that no longer gates.
    testTimeout: 30_000,
    // Separately and much larger: beforeAll starts a Testcontainers Postgres,
    // and on a cold runner that includes pulling the image. That is a network
    // download, not a boot, and it is the only thing in this package measured
    // in minutes.
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // src/testing/** used to be excluded wholesale as "harness code, not
      // product code" — but that hid the fact that describeEachTarget,
      // postgresTarget, and migrated were never executed by any test (fixed
      // by harness.test.ts's Target.create() smoke test). Only
      // dockerAvailable's Docker-absent branch is genuinely unreachable by
      // construction on a machine where Docker is present — mocking it would
      // measure the mock, not this code — so that one branch is ignored
      // in-place with a `v8 ignore` comment instead, and the rest of
      // src/testing/** is now held to the same thresholds as src/.
      //
      // drizzle.config.ts is a drizzle-kit CLI input, never imported at
      // runtime — the same role as the vite/vitest/etc. configs
      // coverageConfigDefaults already excludes, just for a tool whose name
      // isn't on that default list.
      exclude: [...coverageConfigDefaults.exclude, "drizzle/**", "drizzle.config.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
