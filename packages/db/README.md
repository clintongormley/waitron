# @waitron/db

Postgres schema and client for both deployment modes: PGlite (embedded WASM PostgreSQL)
standalone, real PostgreSQL in the cloud. **One dialect.** There is no SQLite path — see
`docs/superpowers/specs/2026-07-19-sales-spine-and-fiscal-layer-design.md` §3.

## Commands

| Command                   | Does                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `pnpm test`               | Vitest. Skips the real-Postgres target if Docker is absent, loudly. |
| `pnpm test:coverage`      | The same, under V8 coverage thresholds. What CI runs.               |
| `pnpm typecheck`          | `tsc --noEmit`                                                      |
| `pnpm mutation`           | Stryker. Weekly in CI, not a merge gate.                            |
| `pnpm db:generate`        | Regenerates `drizzle/` from `src/schema/*.ts`.                      |
| `pnpm db:generate:custom` | An empty numbered migration for hand-written SQL (triggers, RLS).   |

## Three things that will waste your afternoon

**Every test boots a WASM PostgreSQL.** That is why `testTimeout` is 30s here and 5s everywhere
else. Do not lower it.

**PGlite runs as superuser, and superusers always bypass RLS** — with `ENABLE` and with `FORCE`.
Every RLS test must `set local role app_user` via `asAppUser()` (from Task 4). A suite that omits
it passes green while asserting nothing.

**PGlite cannot test lock contention.** Concurrent queries serialise onto one backend, so
`FOR UPDATE` parses and runs but never blocks. Anything about concurrent chain appends goes in
the real-Postgres suite, never PGlite. Run with Docker available, or set `REQUIRE_DOCKER=1` to
turn a missing daemon into a failure.

## Migrations

`drizzle.config.ts` has `out: "./drizzle"` — a **single string**, not an array, whatever the
docs render. One config, one folder, one journal table (`__drizzle_migrations_db`). Each package
that owns tables gets its own config and its own journal; `runMigrations` takes the table name
with no default for exactly that reason. Ordering across packages is the runtime's job.

Drizzle has no trigger support in `pg-core`. Triggers and `FORCE ROW LEVEL SECURITY` are
hand-written into a `--custom` migration; they survive later `generate` runs because drizzle-kit
diffs against its own snapshot, which has no concept of either.
