import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// TWO projects, ONE merged coverage report, serialized by `sequence.groupOrder`.
//
// `replication-fidelity.pg.test.ts` boots its OWN two-node real-PostgreSQL cluster and then does heavy
// POST-boot replication setup in a beforeAll (`provisionAndBootstrapNode` ×2, `createPublications`, a
// cross-node COPY `createSubscription`, `seedTill`). That setup is not bounded by the two-node fixture's
// boot retry, so when it runs CONCURRENTLY with sibling container/connection-heavy files (the
// concurrency and e2e suites open ~70-80 backends against the ONE shared cluster plus heavy CPU) it is
// starved and hangs to the 300s hook timeout. It needs the property `packages/sync` gets from
// singleFork: it must run ALONE within this package. But the other 32 AEAT files must stay on the
// maxForks:4 connection-budget lever (below); making the whole package singleFork is not allowed.
//
// So the two-node suite is a SEPARATE project pinned to run after everything else:
//   - `main` (groupOrder 0, maxForks:4) — every file EXCEPT the two-node suite. Unchanged behaviour.
//   - `replication` (groupOrder 1, singleFork) — only the two-node suite.
// `sequence.groupOrder` runs groups low-to-high, so ALL of group 0 finishes before group 1 starts;
// nothing overlaps the two-node suite. Verified empirically from the run's file interleaving (the
// suite's `✓` line appears only after every other file's, never between them) — vitest `projects` do
// NOT otherwise serialize against each other (they run in parallel by default), which groupOrder fixes.
// A single `vitest run --coverage` still runs both projects and merges into ONE report at the
// thresholds below, so no coverage-blob merge is needed.
//
// `restore.pg.test.ts` is a PGlite suite (no container, lightweight) and stays in `main`; only the
// two-node cluster suite needs isolation. A future suite that boots its own `startTwoNodeCluster`
// belongs in the `replication` project's include.
const twoNodeSuite = "src/replication-fidelity.pg.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "main",
          globals: true,
          // Shared globalSetup requires Docker for the real-Postgres privilege and concurrency suites.
          // It runs before every worker, so Docker absence also fails PGlite-only test selections.
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
          // BOUNDED multi-fork — the connection-budget lever, the same reason `packages/db` caps its own
          // forks, NOT `singleFork`/coverage-v8. Unlike packages/payments, this package does NOT need
          // `singleFork` for the @vitest/coverage-v8 branch-merge artifact: it has thousands of real
          // branches that dilute that mis-merge below the 95% gate (payments' config note records the same
          // asymmetry from the other side — a small package where a handful of mis-merged branches sinks
          // the ratio). So it runs multi-fork, and its concurrency suites open many backends against the
          // ONE shared cluster's default 100-connection budget the old per-file containers did not share.
          // The peak driver: chain.concurrency and chain.node-rekey.concurrency each open `WRITERS = 20`
          // pools at once, and `createPostgresDb` EAGERLY probes+releases one backend per pool
          // (client.ts:118) which lingers idle (~10s), so all 20 are held live across the test window; those
          // files' admin pools also fan out toward their max of 10 under concurrent seeding, so a heavy file
          // peaks ~30. Pinning the exact cross-fork peak is fragile (many short-lived pools with idle
          // retention); a conservative worst case at maxForks: 4 — two ~30 heavy files plus a couple of
          // lighter ones — lands around 70-80, under the EFFECTIVE budget of ~97 (the stock 100 minus
          // superuser_reserved_connections=3), so 4 needs no `max_connections` bump to the shared
          // `startPostgresContainer`. That margin is thinner than packages/db's, so the verification is
          // deliberately EMPIRICAL, not this arithmetic and not an isolated local pass: the full suite passes
          // green under maxForks: 4, and the unfiltered `main` run is where a real exhaustion ("too many
          // clients already") would surface. 4 also matches CI's ubuntu-latest runner vCPU count (this
          // package runs on the `test-light` shard). Same lever and cap as packages/db.
          poolOptions: { forks: { maxForks: 4 } },
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
          // Runs ALONE — one file, one fork — so its heavy post-boot replication setup is never starved.
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
