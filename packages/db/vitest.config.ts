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
    // Boots ONE shared container and migrates a `core` template through this package's own
    // `runMigrationSets` path; `describeEachTarget` and the converted `useRealPostgres` suites clone
    // it (~26ms) instead of booting per file/per test. See `src/testing/global-setup.ts`.
    globalSetup: ["./src/testing/global-setup.ts"],
    // BOUNDED multi-fork — a cap, not this package's previous UNBOUNDED default and not `singleFork`.
    // The shared container is ONE cluster on the default 100-connection budget (postgres.ts starts it
    // with no override) where the old per-file containers each had their own 100. `createPostgresDb`
    // pools to 10 connections each, and three suites open many backends against one clone: the
    // lock-contention pair `allocate-order-number` (~20 separate `suite.pg.connect()` pools) and
    // `append-order-amendment` (~10), plus `allocate-number`'s 20-concurrent-allocator test (~10, all
    // on ONE pool, so capped at pool max). UNBOUNDED forks crowd the one budget — measured worst case
    // ~94/100 at 18 forks, too close to rely on (the passes-once / fails-under-load flake). Capping at
    // 4 keeps the worst case ~46-50 (~21 + ~11 + ~11 + a normal fork's ~3) with wide margin at the
    // default ceiling, so it needs no `max_connections` change to the shared `startPostgresContainer`
    // primitive — and 4 is ALSO CI's core count (`test-heavy` on a 2-4 vCPU runner), so the cap costs
    // the CI gate essentially nothing while recovering most of the ~2.6x `singleFork` left on the table
    // (measured 137s→50s at 4 forks / 42s at 18 forks locally). NOT the `@vitest/coverage-v8`
    // branch-merge reason apps/server/payments/scheduler carry: this shard runs alone and passed
    // coverage multi-fork at far more than 4 forks for its whole history.
    poolOptions: { forks: { maxForks: 4 } },
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
      //
      // src/english-only.ts is measured by the ROOT Vitest project instead
      // (see the repo-root vitest.config.ts), because that is where its
      // suite now lives: scripts/english-only.test.ts, moved out of this
      // package on 2026-08-01 so that a push touching only packages/ui or
      // only packages/payments still runs it. Nothing in this package
      // imports it any more; it stays under src/ so this package's
      // typecheck covers it (the root project typechecks nothing).
      //
      // Excluded rather than left to be measured here, and the difference
      // was run rather than reasoned about. Three states of `pnpm --filter
      // @waitron/db test:coverage`, statements / branches / functions /
      // lines, all re-run on 2026-08-01:
      //
      //   1  suite still here, i.e. this branch's merge base 6d30ed2
      //      99.75 / 96.02 / 100 / 99.75, exit 0, with english-only.ts itself
      //      at 100 / 93.33 / 100 / 100
      //   2  suite moved, no exclusion
      //      98.27 / 95.8 / 96.36 / 98.27, exit 1, `Coverage for functions
      //      (96.36%) does not meet global threshold (98%)`, with
      //      english-only.ts at 92.25 / 85.71 / 66.66 / 92.25
      //   3  suite moved, this line
      //      99.69 / 96.32 / 100 / 99.69, exit 0
      //
      // WHAT THIS LINE DOES is 2 → 3, and only that pair says so: they are the
      // same tree differing in this one line, so the whole difference is its
      // doing. It buys 1.42 on statements, 0.52 on branches and 3.64 on
      // functions, and it is the difference between exit 1 and exit 0 rather
      // than a rounding adjustment. All three axes move the same way because
      // with its own suite gone the module is BELOW this package on every one
      // of them.
      //
      // 1 → 3 is a different question and must not be read as this one. Those
      // two rows differ in TWO ways at once — the suite left the package AND
      // the file is excluded — so no part of the gap between them is
      // attributable to the exclusion alone. An earlier version of this
      // comment made exactly that reading and concluded the exclusion "costs
      // 0.06 on statements and buys 0.30 on branches"; row 1's branch figure is
      // in any case the one number here that did not reproduce, two runs at
      // 6d30ed2 giving 96.02 (145/151) and 96.00 (144/150) while every other
      // figure above repeated exactly, so a 0.3 delta read off it was inside
      // the run-to-run spread.
      //
      // english-only.ts's own statement figure in row 2 read 92.45 until this
      // re-run. That was measured when the file was 159 statements long; it is
      // 155 since this branch's second commit shortened `SELF` to one line
      // (both counts read off `coverage-summary.json`, at 6d30ed2 and here).
      exclude: [
        ...coverageConfigDefaults.exclude,
        "drizzle/**",
        "drizzle.config.ts",
        "src/english-only.ts",
        // The globalSetup runs in the main process, before/outside the worker coverage collection, so
        // it is test tooling that never appears in (and must not be held to) the per-test coverage —
        // the same role apps/server excludes its whole `src/testing/**` for. The rest of
        // `src/testing/**` stays measured here, deliberately (see the note above on describeEachTarget).
        "src/testing/global-setup.ts",
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
