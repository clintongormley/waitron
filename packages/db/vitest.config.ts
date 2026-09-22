import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // A crashed Stryker run leaves .stryker-tmp holding mutated copies of the
    // source. Without this exclude Vitest discovers them as real test files, so
    // one interrupted mutation run makes every later test run fail confusingly.
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    // Vitest's 5s default is too short for this package's database-backed tests: each `it` runs
    // real SQL against a SQLite file the suite opens under `os.tmpdir()`. Not every test here is
    // one: a minority of the package's test files open no database at all, and which ones is a
    // property to recompute rather than a number to remember —
    // `grep -rL useVenueDb --include="*.test.ts" src` lists them. That grep measures which DOOR a
    // suite uses, not whether it touches a database.
    //
    // What this setting does NOT bound is the database's own setup. `useVenueDb` hands its
    // `beforeAll` a 60s default (`src/testing/venue-db.ts`), and a timeout passed to a hook
    // overrides the config's.
    //
    // Keep the headroom: a bound that fires under CI load produces a flaky suite people learn to
    // rerun, and a suite people rerun is a suite that no longer gates.
    testTimeout: 30_000,
    // What `hookTimeout` reaches here has not been measured. `useVenueDb` passes its own budget to
    // its `beforeAll` (`src/testing/venue-db.ts`), which overrides this; its `afterEach` reset and
    // its `afterAll` close pass none, so those are the hooks this bound plausibly covers. Left at
    // two minutes rather than tightened to a figure nobody has taken.
    hookTimeout: 120_000,
    // NO `globalSetup`: nothing in this package is shared across test files. Each suite opens its
    // own SQLite file under `os.tmpdir()` through `useVenueDb` (`src/testing/venue-db.ts`).
    //
    // BOUNDED multi-fork — a cap, not an unbounded default and not `maxWorkers: 1`. There is no
    // shared resource left for the forks to crowd; the cap is kept because 4 is CI's core count
    // (`test-heavy` on a 2-4 vCPU runner), so it costs the gate essentially nothing. It is
    // measured against nothing today, and raising it is a question nobody has asked the machine.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // src/testing/** is measured, not excluded: it was once excluded
      // wholesale as "harness code, not product code", and that hid three
      // helpers in it that no test executed at all. It is held to the same
      // thresholds as the rest of src/.
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
      // was run rather than reasoned about — on 2026-08-01, when
      // src/schema/series.test.ts still imported `findSpanish`; SP-3b removed
      // that importer, so row 2 below is history, not a state this tree can
      // reproduce. Three states of `pnpm --filter @waitron/db test:coverage`,
      // statements / branches / functions / lines, all re-run on 2026-08-01:
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
      ],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
