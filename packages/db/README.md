# @waitron/db

Use this package for the PostgreSQL schema and database client. PGlite (embedded WASM PostgreSQL)
and real PostgreSQL use one dialect; there is no SQLite path. See
`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md` §3.

Each database holds one tenant.
`withTenant(db, tenantId, fn, opts?)` runs your work in one transaction and keeps the tenant argument
explicit at call sites. It sets `app.node_id` when you supply `opts.nodeId`, so capture triggers can
record the producing node. It does not set a tenant session variable.

## Commands

| Command                   | Does                                           |
| ------------------------- | ---------------------------------------------- |
| `pnpm test`               | Runs Vitest; the global setup requires Docker. |
| `pnpm test:coverage`      | Runs the suite with coverage thresholds.       |
| `pnpm typecheck`          | Runs `tsc --noEmit`.                           |
| `pnpm mutation`           | Runs Stryker.                                  |
| `pnpm db:generate`        | Generates migrations from the schema barrel.   |
| `pnpm db:generate:custom` | Creates a migration for hand-written SQL.      |

Use PGlite for schema and query behaviour. Use real PostgreSQL for privileges and concurrency:
PGlite connects as superuser and serialises queries onto one backend, so it cannot measure lock
contention. Set `TESTCONTAINERS_RYUK_DISABLED=true` for local container runs.

## Test setup

Keep `testTimeout: 30_000` in `vitest.config.ts` for the PGlite-backed tests; do not replace it
with the usual 5 s default. Setup hooks have a separate `hookTimeout: 120_000` budget for booting
and migrating PostgreSQL. Shared-fixture suites migrate once.

## What CI runs

- `pnpm lint` runs ESLint; the CI lint job also runs the root guard tests and `pnpm format:check`.
- `pnpm typecheck` runs `tsc --noEmit` across the workspace.
- DB coverage runs in the `test-heavy` shards with `test:shard`; `test:merge` combines their reports
  and enforces the package thresholds. Locally, `pnpm test:coverage` runs the package with those
  thresholds in one invocation. Plain `pnpm test` does not measure coverage.
- `pnpm mutation` runs Stryker. DB mutation testing is scheduled weekly or dispatched through
  `mutation.yml`; it is not a merge gate.
- `db:generate` and `db:generate:custom` create migration artifacts; they are authoring commands,
  not CI test commands.

## Migrations

Core has two baselines: `0000_db_baseline.sql` contains the generated schema, and
`0001_db_baseline_sql.sql` contains the additional tables, constraints, grants, functions and
triggers. `app_user` is a non-login role; it receives only the grants in the custom baseline.
You still supply `tenant_id` on writes, and composite foreign keys still reject inconsistent
references between tenants.

Keep `out: "./drizzle"` in `drizzle.config.ts` as a **single string**, not an array. One config
produces one folder and one journal; each package that owns tables has its own config and journal.

The generated snapshot covers the schema barrel. Triggers, grants and the append-only triggers'
`ENABLE ALWAYS` state are hand-written into the `…_baseline_sql` custom migration; they survive
later `generate` runs because drizzle-kit diffs against its own snapshot, which has no concept of
them, so you maintain them by hand when changing a constraint, trigger or table Drizzle does not
generate.
`runMigrations` requires the module's journal table name; core uses `__drizzle_migrations_db`.
The caller orders migration sets from different modules.
