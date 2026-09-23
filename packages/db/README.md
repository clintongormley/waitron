# @waitron/db

Use this package for the venue schema and the database client. The engine is **SQLite** — Node's
own built-in `node:sqlite`, driven by Drizzle's SQLite dialect through a small adapter
(`@waitron/store`). There is no PostgreSQL path and no PGlite. A whole database is a directory of
files, opened by path; there is no connection string, no server and no role. See
`docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` for the switch, and
`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md` §3 for the schema this
package holds.

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

`./src/testing/` also publishes `describeSchemaConformance`
(`./src/testing/schema-conformance.ts`), a suite factory that declares a whole database-backed suite
holding one migration set's tables to the drizzle declarations that are supposed to have built them.
The core set calls it from `./src/schema/schema-conformance.test.ts`, and four module packages call
it through the `exports` entry `@waitron/db/testing/schema-conformance.js`. What a call site has to
state, and how to work out a set's prerequisites, is in
`docs/developers/testing-guide.md`. **Everything under `./src/testing/` that is not itself a
`.test.ts` is measured for coverage and mutated** — it is ordinary source as far as both gates are
concerned — so code moved in here arrives under this package's full thresholds. The coverage
exclusion list in `vitest.config.ts` deliberately leaves this directory in, and says why.

Keep `testTimeout: 30_000` in `vitest.config.ts` for the database-backed tests; do not replace it
with the usual 5 s default. **Neither that budget nor the `hookTimeout: 120_000` beside it bounds
the database's own setup**: `useVenueDb` hands its own `beforeAll` a 60-second default
(`src/testing/venue-db.ts:12`, applied at `:232`), and a timeout passed to a hook overrides the
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

Core has two migrations, both written for the storage switch: `0000_baseline.sql` is the schema
drizzle-kit generates from the barrel, and `0001_behavioural_triggers.sql` is a `--custom`
migration carrying the nine behavioural rules this package used to enforce with hand-written
PostgreSQL triggers, restored as SQLite triggers. Neither file contains a `GRANT`, a role or an
`ENABLE ALWAYS`: there is no database role to grant anything to, and file permissions on the venue
directory are the access control.

The **append-only** triggers are not in either file. They are installed at runtime by
`installAppendOnlyTriggers` (`@waitron/store`), from the table names each migration set declares,
which is why every migrating path gets them without having to remember to.

Keep `out: "./drizzle"` in `drizzle.config.ts` as a **single string**, not an array. One config
produces one folder and one journal; each package that owns tables has its own config and journal.

The generated snapshot covers the schema barrel. Triggers are hand-written into a `--custom`
migration; they survive later `generate` runs because drizzle-kit diffs against its own snapshot,
which has no concept of them, so you maintain them by hand when changing a constraint, trigger or
table Drizzle does not generate.
`runMigrations` requires the module's journal table name; core uses `__drizzle_migrations_db`.
The caller orders migration sets from different modules.
