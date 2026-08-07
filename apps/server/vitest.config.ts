import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // The real-Postgres and mTLS suites pull a container and mint certificates in a beforeAll.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/**/*.preprod.test.ts"],
    // One fork: @vitest/coverage-v8 under-merges BRANCH coverage across fork workers. Same
    // finding as packages/payments and packages/scheduler.
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` — the process entry point: a bare `await startServer(process.env)` plus a
      // signal-handler latch, exercised only by the manual end-to-end boot Task 11's report
      // records, not by anything hermetic. `scripts/**` and `src/testing/**` are build/test
      // tooling, not this package's own behaviour.
      //
      // `src/boot.ts` is deliberately NOT here. It was the one file with no test subject at all
      // when this threshold was added; `boot.test.ts` (a real `startServer` + `close()` against a
      // real container, as the deployment role) closed that. `boot.ts` reports 100%
      // statements/lines/branches and — since Task 3 (integrated card terminal) — ~90% FUNCTIONS:
      // `buildCardProvider`'s `resolveReader: () => Promise.resolve(readerId)` closure is invoked
      // only by the Task-8 card-collect flow, so no suite here calls it yet and that ONE function
      // stays uncovered. The `apps/server` aggregate still clears the 98/98/98/95 thresholds below
      // (~98.1% functions) WITHOUT an exclusion, which is why `boot.ts` stays off this list rather
      // than gaining a `resolveReader`-shaped one — a real exclusion would be paper over a gap Task 8
      // closes for real, the opposite of the "cover it, don't exclude it" posture the rest of this
      // comment records. `server.close()`'s own callback rejecting (`try { … server.close((error)
      // => error ? reject(error) : resolve()) } finally { db.close() }`) was, for a while, the one
      // branch nothing reached: Node only invokes that callback with an error when the raw HTTP
      // server is closed while not listening, which needs the server stopped out from under
      // `StartedServer.close()`'s own idempotency guard. The whole-branch review's I5 fix
      // (`server.listen_failed`, boot.ts) produces exactly that state for real, not by forging it —
      // a bind failure (EADDRINUSE/ENOTFOUND) leaves the raw server never listening, and
      // `boot.test.ts`'s two listen-failure cases both call `close()` on it and assert the
      // rejection. Three genuinely unreachable branches of this same shape are left in the package,
      // each marked with its own `v8 ignore` comment rather than folded into an exclusion here:
      // `loop.ts`'s `realSleep` rethrow, `boot.ts`'s `error.code ?? "unknown"` fallback (I5 itself
      // added the second one — reaching it needs a synthetic bind error with no `code`, which
      // nothing producible through `startServer`'s public surface can construct), and `boot.ts`'s
      // `if (bound) return` guard on the server's `'error'` handler (a 2026-07-27 pre-merge review
      // fix — reaching it needs a synthetic 'error' event on the raw `http.Server` AFTER it is
      // listening, and that object is never exposed on `StartedServer` for a test to reach either).
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
