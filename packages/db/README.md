# @waitron/db

Use this package for the PostgreSQL schema and database client. PGlite (embedded WASM PostgreSQL)
and real PostgreSQL use one dialect; there is no SQLite path. See
`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md` §3.

Each database holds one taxpayer, as the single row of `tenants` (`id` pinned to 1). No table
carries a tenant column and no query filters by one: a read that wants "this tenant's rows" reads
the table. `withTransaction(db, fn)` runs your work in one transaction and sets no session
variable, and a write path takes the `tx` it opens rather than opening its own. It does one thing of
its own: after your callback returns it empties the `change_log` table inside the same transaction,
and once the commit has returned it hands those rows to this process's change listeners
(`./src/change-log.ts`).

## Commands

| Command                   | Does                                         |
| ------------------------- | -------------------------------------------- |
| `pnpm test`               | Runs Vitest. No Docker, no global setup.     |
| `pnpm test:coverage`      | Runs the suite with coverage thresholds.     |
| `pnpm typecheck`          | Runs `tsc --noEmit`.                         |
| `pnpm mutation`           | Runs Stryker.                                |
| `pnpm db:generate`        | Generates migrations from the schema barrel. |
| `pnpm db:generate:custom` | Creates a migration for hand-written SQL.    |

## Test setup

A suite asks for its database through `useVenueDb` (`./src/testing/venue-db.ts`), which opens a
SQLite venue directory under `os.tmpdir()`, applies the migration sets it is handed, installs the
append-only triggers and empties the data between tests. That is a written rule (`CLAUDE.md` §4),
enforced by `scripts/venue-db-helper.test.ts`: no `.ts` file under `packages/` or `apps/` may NAME
the retired PGlite helper it replaced, this package included.

Keep `testTimeout: 30_000` in `vitest.config.ts` for the database-backed tests; do not replace it
with the usual 5 s default. **Neither that budget nor the `hookTimeout: 120_000` beside it bounds
the database's own setup**: `useVenueDb` hands its own `beforeAll` a 60-second default
(`src/testing/venue-db.ts:12`, applied at `:196`), and a timeout passed to a hook overrides the
config's. What `hookTimeout` reaches is every `afterEach`/`afterAll` that passes no budget of its
own — which includes this helper's reset and its close. That last sentence has not been re-measured
since the storage switch; the figure it replaced was taken against a test harness that no longer
exists.

## What CI runs

- `pnpm lint` runs ESLint; the CI lint job also runs the root guard tests and `pnpm format:check`.
- `pnpm typecheck` runs `tsc --noEmit` across the workspace.
- DB coverage runs in the `test-heavy` shards with `test:shard`; `test:merge` combines their reports
  and enforces the package thresholds. Locally, `pnpm test:coverage` runs the package with those
  thresholds in one invocation. Plain `pnpm test` does not measure coverage.
- `pnpm mutation` runs Stryker. DB mutation testing is scheduled weekly or dispatched through
  `mutation.yml`; it is not a merge gate. The weekly run DOES gate: its `mutation-db-aggregate` job
  merges the ten shard reports and fails below 90. A local `pnpm mutation` prints a score and
  fails at nothing — the bar is deliberately not in this package's stryker config, because CI
  passes each shard its own `--mutate` list and a bar there would gate one slice.
- `db:generate` and `db:generate:custom` create migration artifacts; they are authoring commands,
  not CI test commands.

## Migrations

Core has two baselines: `0000_db_baseline.sql` contains the generated schema, and
`0001_db_baseline_sql.sql` contains the additional tables, constraints, grants, functions and
triggers. `app_user` is a non-login role; it receives only the grants in the custom baseline.
Migrations `0030`–`0032` drop the tenant column from this set and `0033`–`0034` make `tenants` a
one-row table; the baselines above still create the column, because a drizzle migration is never
edited after it ships.

Keep `out: "./drizzle"` in `drizzle.config.ts` as a **single string**, not an array. One config
produces one folder and one journal; each package that owns tables has its own config and journal.

The generated snapshot covers the schema barrel. Triggers, grants and the append-only triggers'
`ENABLE ALWAYS` state are hand-written into the `…_baseline_sql` custom migration; they survive
later `generate` runs because drizzle-kit diffs against its own snapshot, which has no concept of
them, so you maintain them by hand when changing a constraint, trigger or table Drizzle does not
generate.
`runMigrations` requires the module's journal table name; core uses `__drizzle_migrations_db`.
The caller orders migration sets from different modules.
