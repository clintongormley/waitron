import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The real-Postgres and mTLS suites pull a container and mint certificates in a beforeAll.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.preprod.test.ts"],
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
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` — the process entry point: a bare `await startServer(process.env)` plus a
      // signal-handler latch, exercised only by a manual end-to-end boot, not by anything hermetic.
      // `scripts/**` and `src/testing/**` are build/test tooling, not this package's own behaviour.
      //
      // `src/boot.ts` is deliberately NOT here: `boot.test.ts` covers it against a real container as
      // the deployment role. A branch that is genuinely unreachable through `startServer`'s public
      // surface carries its own `v8 ignore` comment in place, never a file-level exclusion here.
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
      thresholds: { statements: 90, lines: 90, functions: 85, branches: 85 },
    },
  },
});
