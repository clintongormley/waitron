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
    // Multi-fork, capped at the CI runner's 4 vCPUs. The coverage-v8 branch under-merge that holds
    // some packages to one worker comes from `pnpm -r` contention, and apps/server never runs under
    // it: nothing depends on it, so `pnpm -r` runs it last, and ci.yml's `--no-sort` light shards
    // filter it out.
    //
    // It is not a lever against a shard exiting 1 with every test passing: Vitest 4.1.11 passes
    // `timeout: -1` to birpc for the worker-to-main reporting call
    // (dist/chunks/rpc.MzXet3jl.js:117), so that call has no timeout. See
    // docs/developers/ci-and-gates.md → "A shard can exit 1 with every one of its tests passing".
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      // `src/bin.ts` is the process entry point, exercised only by a manual end-to-end boot.
      // `src/boot.ts` is deliberately NOT here: an unreachable branch carries its own `v8 ignore`
      // in place, never a file-level exclusion.
      exclude: [...coverageConfigDefaults.exclude, "scripts/**", "src/testing/**", "src/bin.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
