import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // TWO projects, ONE merged coverage report, serialized by `sequence.groupOrder`.
    //
    // `replication-arc.e2e.test.ts` boots its OWN two-node real-PostgreSQL cluster (startTwoNodeCluster)
    // and then does heavy POST-boot replication setup in a beforeAll (`provisionAndBootstrapNode` ×2,
    // `createSubscription` with a cross-node COPY) — the same shape as fiscal-verifactu's
    // `replication-fidelity.pg.test.ts`. Under maxForks:4 that setup runs CONCURRENTLY with up to three
    // sibling files that clone the shared container and drive real-PG e2e/boot flows (backup-*, boot.*,
    // …), which starves it — the same real-PG-e2e timing starvation those siblings already show. It gets
    // the property packages/sync gets from singleFork: it runs ALONE, without the other 360+ files being
    // forced singleFork (that would forfeit the maxForks:4 lever the comment on `main` below defends).
    //
    //   - `main` (groupOrder 0, maxForks:4) — every file EXCEPT the two-node suite. Unchanged behaviour.
    //   - `replication` (groupOrder 1, singleFork) — only the two-node suite, run after all of group 0.
    // `sequence.groupOrder` runs groups low-to-high, so group 0 fully finishes before group 1 starts and
    // nothing overlaps the two-node suite; vitest `projects` do NOT otherwise serialize (parallel by
    // default). A single `vitest run --coverage` runs both projects and merges into ONE report at the
    // thresholds below — no coverage-blob merge. The `main` project keeps maxForks:4 unchanged, so the
    // branch-merge measurement below still holds; the two-node file, alone in its own fork, cannot
    // under-merge.
    projects: [
      {
        test: {
          name: "main",
          globals: true,
          // The real-Postgres and mTLS suites pull a container and mint certificates in a beforeAll.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          exclude: [
            ...configDefaults.exclude,
            "**/.stryker-tmp/**",
            "src/**/*.preprod.test.ts",
            "src/replication-arc.e2e.test.ts",
          ],
          // Multi-fork, capped at the CI runner's 4 vCPUs. The @vitest/coverage-v8 branch under-merge that
          // holds packages/payments and packages/scheduler to singleFork is a `pnpm -r` CONTENTION artifact
          // (many packages' forks starving one runner — payments' branches fell to 82% that way), and it
          // cannot reach apps/server, because apps/server NEVER runs multi-fork under contention. Two facts
          // pin that, both a grep to re-check: apps/server is TERMINAL in the workspace graph (`pnpm ls -r`
          // shows nothing depends on @waitron/server), so a topo-sorted `pnpm -r test:coverage` — the
          // pre-push hook (.husky/pre-push runs `pnpm -r … test:coverage`) and the root script — runs it
          // last, essentially alone; and the ONLY `--no-sort` (unordered, high-concurrency) runs are
          // ci.yml's two light shards, which both `--filter "!@waitron/server"`. So it runs alone on the
          // dedicated test-server runner, alone at the tail of `pnpm -r`, and nowhere else. That it merges
          // correctly WHEN alone was measured 2026-08-20 (Docker up, nothing else running): single-fork and
          // multi-fork branch coverage identical to the count — 1619/1637 = 98.9% at maxForks 4, 98.9%
          // (1620/1638) at 18 forks — where an under-merge would drop `covered` while `total` held, the
          // opposite direction. Local wall-clock 48.6s → 24.9s at 4 forks.
          poolOptions: { forks: { maxForks: 4 } },
          // Boots ONE shared container with a `manifest` template migrated through apps/server's
          // production path; the converted real-Postgres suites clone it via `useTemplateDb` instead of
          // booting per-file. See `src/testing/global-setup.ts`.
          globalSetup: ["./src/testing/global-setup.ts"],
          // Group 0: runs to completion before the `replication` group (groupOrder 1) starts.
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "replication",
          globals: true,
          // Boots its OWN two-node cluster, not the shared template, so it needs no globalSetup.
          include: ["src/replication-arc.e2e.test.ts"],
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
      // `src/bin.ts` — the process entry point: a bare `await startServer(process.env)` plus a
      // signal-handler latch, exercised only by a manual end-to-end boot, not by anything hermetic.
      // `scripts/**` and `src/testing/**` are build/test tooling, not this package's own behaviour.
      //
      // `src/boot.ts` is deliberately NOT here: a branch that is genuinely unreachable through
      // `startServer`'s public surface carries its own `v8 ignore` comment in place, never a
      // file-level exclusion.
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
