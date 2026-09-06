import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Shared globalSetup requires Docker for the real-Postgres privilege and concurrency suites.
    // It runs before every worker, so Docker absence also fails PGlite-only test selections.
    globalSetup: ["./src/testing/global-setup.ts"],
    // PGlite boots a WASM PostgreSQL and then applies the whole manifest, and the concurrency /
    // e2e suites clone the shared container's migrated template (globalSetup, above). Each per-suite
    // cost is paid in a beforeAll — the PGlite WASM boot + migrations, or the real-PG ~26ms clone —
    // so hookTimeout stays generous for the PGlite boot. The container boot/pull is NOT in a
    // beforeAll: it moved to globalSetup, which vitest does not bound by hookTimeout. testTimeout
    // covers the ordinary risk of a migration suite booting a second database inside a single `it`.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
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
