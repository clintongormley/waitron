# @waitron/db

Use this package for the PostgreSQL schema and database client. Each database holds one tenant.
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

## Migrations

Core has two baselines: `0000_db_baseline.sql` contains the generated schema, and
`0001_db_baseline_sql.sql` contains the additional tables, constraints, grants, functions and
triggers. `app_user` is a non-login role; it receives only the grants in the custom baseline.
You still supply `tenant_id` on writes, and composite foreign keys still reject inconsistent
references between tenants.

The generated snapshot covers the schema barrel. Custom SQL stays outside that snapshot, so you
must maintain it when changing a constraint, trigger or table that Drizzle does not generate.
`runMigrations` requires the module's journal table name; core uses `__drizzle_migrations_db`.
The caller orders migration sets from different modules.
