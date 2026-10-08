# Alerts, logging and diagnostics — detail

The open entries are listed in [the backlog](../backlog.md), under "Alerts, logging and diagnostics". This file holds
their full text.

## `redact-secrets.ts` was written against the PostgreSQL connection-string parser

- Found by #620 (`apps/server` part h1), not fixable in a comments-only change.
  `redact-secrets.ts` was written against the PostgreSQL connection-string parser, and `pg` is now
  installed only for `bench/pglite-throughput`; whether a credential-bearing URL can still reach
  the log is unchecked. `apps/server/vitest.config.ts`'s `coverage.exclude` lists `scripts/**`,
  which its `src/**/*.ts` include already leaves out (read only). The adoption-pending entry below
  still gives PostgreSQL's SQLSTATE 23503 on `nodes_location_id_locations_id_fk` as evidence; this
  engine reports `FOREIGN KEY constraint failed` and names no constraint. Test titles #620 could
  not touch: "(design §3b(2))" in `set-table-status.test.ts`, "(owner decision 2026-08-02)" in
  `workforce-api.test.ts`, "(guard by deletion)" in `seed-sales.test.ts`.
