import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    clearMocks: false,
    // `useVenueDb` times its own `beforeAll` (`packages/db/src/testing/venue-db.ts`, 60s unless a
    // suite passes `timeoutMs`), so `hookTimeout` bounds the hooks left untimed: that helper's
    // per-test reset and close, and any hook a test file writes for itself.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.preprod.test.ts"],
    // Multi-fork, capped at the CI runner's 4 vCPUs. The @vitest/coverage-v8 branch under-merge that
    // holds packages/payments and packages/scheduler to one worker is a `pnpm -r` CONTENTION artifact
    // (many packages' forks starving one runner — payments' branches fell to 82% that way), and it
    // cannot reach apps/server, because apps/server NEVER runs multi-fork under contention. Two facts
    // pin that, both a grep to re-check: apps/server is TERMINAL in the workspace graph (`pnpm ls -r`
    // shows nothing depends on @waitron/server), so the root script's topo-sorted
    // `pnpm -r test:coverage` runs it last, essentially alone; and the ONLY `--no-sort` (unordered, high-concurrency) runs are
    // ci.yml's two light shards, which both `--filter "!@waitron/server"`. So it runs alone on the
    // dedicated test-server runner, alone at the tail of `pnpm -r`, and nowhere else. That it merges
    // correctly WHEN alone was measured 2026-08-20 (Docker up, nothing else running): single-fork and
    // multi-fork branch coverage identical to the count — 1619/1637 = 98.9% at maxWorkers 4, 98.9%
    // (1620/1638) at 18 forks — where an under-merge would drop `covered` while `total` held, the
    // opposite direction. Local wall-clock 48.6s → 24.9s at 4 forks.
    //
    // This cap used to be one of the two levers against a shard exiting 1 with every test passing. It
    // is not one any more: that symptom came from the worker-to-main reporting timeout, and Vitest 4
    // switches that timeout off — 4.1.11 passes `timeout: -1` to birpc (dist/chunks/rpc.MzXet3jl.js:117)
    // where 3.2.7 passed none and birpc's 60s default applied. See docs/developers/ci-and-gates.md →
    // "A shard can exit 1 with every one of its tests passing".
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` — the process entry point: a bare `await startServer(process.env)` plus the
      // wiring call into `run-server.ts`, exercised only by a manual end-to-end boot, not by
      // anything hermetic. `run-server.ts`'s own shutdown logic is unit-tested and stays counted;
      // only its `DEFAULT_DEPS` (the real process bindings) carry their own `v8 ignore` there.
      // `scripts/**` and `src/testing/**` are build/test tooling, not this package's own behaviour.
      //
      // `src/boot.ts` is deliberately NOT here: a branch that is genuinely unreachable through
      // `startServer`'s public surface carries its own `v8 ignore` comment in place, never a
      // file-level exclusion.
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
