# @waitron/db

Use this package for the venue schema and the database client. The engine is **SQLite** — Node's
own built-in `node:sqlite`, driven by Drizzle's SQLite dialect through a small adapter
(`@waitron/store`). A whole database is a directory of
files, opened by path; there is no connection string, no server and no role. The switch to SQLite
landed in #489.

Each database holds one taxpayer, as the single row of `tenants` (`id` pinned to 1). No table
carries a tenant column and no query filters by one: a read that wants "this tenant's rows" reads
the table. `withTransaction(db, fn)` runs your work in one transaction and sets no session
variable, and a write path takes the `tx` it opens rather than opening its own. It does one thing of
its own: after your callback returns it empties the `change_log` table inside the same transaction,
and once the commit has returned it hands those rows to this process's change listeners
(`./src/change-log.ts`).

## Commands

| Command              | Does                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `pnpm test`          | Runs Vitest. No Docker, no global setup.                                 |
| `pnpm test:coverage` | Runs the suite with coverage thresholds.                                 |
| `pnpm typecheck`     | Runs `tsc --noEmit`.                                                     |
| `pnpm mutation`      | Runs Stryker.                                                            |
| `pnpm db:generate`   | Rebuilds the starting migration from the schema and `triggers/core.sql`. |

## Test setup

A suite asks for its database through `useVenueDb` (`./src/testing/venue-db.ts`), which opens a
SQLite venue directory under `os.tmpdir()`, applies the migration sets it is handed, installs the
append-only triggers, empties the data between tests and gives the event loop one real timer turn
after every test. That is a written rule (`CLAUDE.md` §4),
enforced by `scripts/venue-db-helper.test.ts`: no `.ts` file under `packages/` or `apps/` may NAME
the retired helper `usePgliteDb`, this package included.

`./src/testing/` also publishes `describeSchemaConformance`
(`./src/testing/schema-conformance.ts`), a suite factory that declares a whole database-backed suite
holding one migration set's tables to the drizzle declarations that are supposed to have built them.
The core set calls it from `./src/schema/schema-conformance.test.ts`, and module packages call it
through the `exports` entry `@waitron/db/testing/schema-conformance.js` —
`ls packages/*/src/schema/schema-conformance.test.ts` lists which. What a call site has to
state, and how to work out a set's prerequisites, is in
`docs/developers/testing-guide.md`. **Everything under `./src/testing/` that is not itself a
`.test.ts` is measured for coverage and mutated** — it is ordinary source as far as both gates are
concerned — so code moved in here arrives under this package's full thresholds. The coverage
exclusion list in `vitest.config.ts` deliberately leaves this directory in, and says why.

The `testTimeout: 30_000` in `vitest.config.ts` is margin for a loaded CI runner, not a need: on
2026-09-23, on an 18-core Mac with no other package running, every test passed with `testTimeout`,
`hookTimeout` and `useVenueDb`'s default setup budget all cut to 2s. **Neither that budget nor the
`hookTimeout: 120_000` beside it bounds the database's own setup**: `useVenueDb` hands its own
`beforeAll` a 60-second default (`src/testing/venue-db.ts`), and a timeout passed to a hook
overrides the config's. What `hookTimeout` reaches is any hook that passes no budget of its own —
which includes this helper's reset and its close.

## What CI runs

- `pnpm lint` runs ESLint; the CI `lint` job also runs `pnpm format:check`, and the `root-guards` job runs the root guard tests.
- `pnpm typecheck` runs `tsc --noEmit` across the workspace.
- DB coverage runs in the `test-heavy` shards with `test:shard`; `test:merge` combines their reports
  and enforces the package thresholds. Locally, `pnpm test:coverage` runs the package with those
  thresholds in one invocation. Plain `pnpm test` does not measure coverage.
- `pnpm mutation` runs Stryker. DB mutation testing runs nightly or is dispatched through
  `mutation.yml`; it is not a merge gate. That run DOES gate: its `mutation-db-aggregate` job
  merges the thirteen shard reports and fails below 90. A local `pnpm mutation` prints a score and
  fails at nothing — the bar is deliberately not in this package's stryker config, because CI
  passes each shard its own `--mutate` list and a bar there would gate one slice.
- `db:generate` rebuilds the starting migration; write hand-written SQL in `triggers/core.sql`.

## Migrations

Core's set is one migration, `0000_baseline.sql`: the schema drizzle-kit generates from the barrel,
plus the triggers a schema cannot declare, for core's own tables and for those of the modules whose
tables live in core's set. No migration contains a `GRANT`, a role or an `ENABLE ALWAYS`: there is
no database role to grant anything to, and file permissions on the venue directory are the access
control.

A paid (`settled`) line may change only its kitchen group;
all other columns must stay unchanged in that write. The existing served-mark and first-sent-stamp
exceptions remain separate. `scripts/behavioural-triggers.test.ts` checks the allowed group change
and rejects a group change combined with any other column change.

The **append-only** triggers are not in any of these files. They are installed at runtime by
`installAppendOnlyTriggers` (`@waitron/store`), called by `applyMigrations`, from the
`appendOnlyTables` each set hands it, which a `migrationOptionsFor(...)` result always carries; a
plain options array carries none and gets none (`scripts/apply-migrations-callers.test.ts` holds
every non-test caller to `migrationOptionsFor`).

Keep `out: "./drizzle"` in `drizzle.config.ts` as a **single string**, not an array. One config
produces one folder and one journal; each package that owns a migration set has its own config and journal.

The generated snapshot covers the schema barrel. Write hand-written triggers in `triggers/core.sql`
and run `pnpm db:generate` after changing the schema or those triggers. This rebuilds the starting
migration and resets every venue. On a rebase conflict, take main's generated files and rebuild
from your schema and trigger source. `scripts/starting-migrations.test.ts` checks every set.
`runMigrations` requires the module's journal table name; core uses `__drizzle_migrations_db`.
The caller orders migration sets from different modules.
