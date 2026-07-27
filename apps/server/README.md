# `@waitron/server`

The host process. It boots from environment config, loads the credential vault's key ring, applies
every migration set behind an advisory lock, resolves per-tenant AEAT transports and Stripe
accounts, then runs a loop: `drain` (the fiscal submission duty), the Stripe payments reconcile,
fold the result into a sleep duration, repeat. It serves one unauthenticated route, `GET /health`.

Design: [`docs/superpowers/specs/2026-07-26-server-host-design.md`](../../docs/superpowers/specs/2026-07-26-server-host-design.md).
This document is the operational half of that spec — written for whoever deploys this process, not
whoever reads its source.

**The one thing worth remembering before anything else:** `drain` carries a legal, hourly submission
duty under Spain's Veri\*Factu regulation (art. 16.4). A `/health` that reports `200` is a claim that
no tenant was wholesale abandoned this pass and no Stripe settlement-audit period has been
permanently parked — it is **not** a claim that every individual fiscal record has actually been
accepted by AEAT. A tenant whose records reach AEAT but are individually rejected (a `certKind`
provisioned as the wrong kind, say) reads `200` with `lastOkAt` refreshing every pass; that is
visible only via `recordsHalted`/`incidentsRaised` in the `drain.complete` log line and the
`incidents` table, deliberately, not through this endpoint — see
["What `/health` means"](#what-health-means) below for the exact boundary, and why, before treating
a `503` as noise or its absence as "nothing is wrong."

## Running it

```
DATABASE_URL=postgres://app_user_role@host/db \
WAITRON_CREDENTIALS_KEY=<base64, 32 bytes> \
WAITRON_CREDENTIALS_KEY_VERSION=1 \
node dist/server.js
```

Build with `pnpm --filter @waitron/server build` — this bundles `src/bin.ts` with esbuild AND copies
every migration package's `drizzle/` folder beside the bundle (`scripts/copy-migrations.mjs`), which
`WAITRON_MIGRATIONS_DIR` defaults to finding there. Running `dist/server.js` without that copy step
fails loudly at boot with `server.migrations_missing`, not silently.

Every boot failure exits non-zero, but not all of them reach stdout the same way. A port that will
not bind logs a structured `server.listen_failed` JSON line (see ["Log events"](#log-events)) and
exits `1` directly. Bad config, an unloadable key ring, a failed migration, and an unreachable
database instead **throw**, and `bin.ts` has no `try`/`catch` around `startServer` — Node prints the
`AppError`'s stack to **stderr** as an unhandled rejection and exits non-zero, not as a JSON line on
the stdout stream a log collector reads. (Catching those four in `bin.ts` and logging them
structurally the same way would be a real improvement; it is not done here — check stderr for those,
stdout for a bind failure.) Either way there is no "boots half-configured and retries in the
background": a supervisor (systemd, Docker's restart policy) is expected to restart the process, and
it will keep failing until whatever is wrong is fixed.

## Database roles and grants

Spec §10 requires `DATABASE_URL` to be **the non-superuser deployment role** — not the container's
or provider's superuser/admin user. This section is the concrete answer to "grant that role what,
exactly," because getting it wrong is the single most common way this process fails to boot (C1 of
the 2026-07-26 whole-branch review; `boot.test.ts`'s own `beforeAll` is the source of the
already-migrated grants below — they are empirically checked against a real Postgres container in
this package's own test suite, not merely read off the SQL).

### Two connection strings, one purpose split

| Variable                          | What it is used for                                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                    | The long-running pool every duty pass runs its queries over. **Least privilege**: this is the role spec §10 means.                                                                                                                                             |
| `WAITRON_MIGRATIONS_DATABASE_URL` | The connection `applyMigrations` runs the migration SQL over, once, at boot, behind an advisory lock. **Defaults to `DATABASE_URL`** — a deployment that sets nothing extra keeps one connection string doing both jobs, exactly as before this split existed. |

Splitting them is what makes "the non-superuser deployment role" and "migrations run at every boot"
(spec §11) jointly satisfiable. Against an **already-migrated** database, Drizzle's migrator issues
`CREATE SCHEMA IF NOT EXISTS "public"` and `CREATE TABLE IF NOT EXISTS` per set — and Postgres checks
the privilege for those statements **before** it evaluates whether the object already exists, so a
role with only ordinary duty-level grants (`app_user` membership, nothing else) fails on the very
first statement even though every migration is a no-op. Against an **empty** database, the
migrations that create `app_user`, `sales_coverage_checker`, `envios_drainer`,
`payments_webhook_resolver` and `credentials_enumerator` need `CREATEROLE` and a temporary
ownership-transfer dance that a plain duty-level role cannot do at all. Neither case is satisfiable
by the role spec §10 actually wants running the process day to day — hence the split.

### `DATABASE_URL` — the deployment role, always

Whatever else is true, this role needs to be a member of `app_user` so the tenant-isolation row-level
security policies apply to it (every table `apps/server` reads or writes carries `FORCE ROW LEVEL
SECURITY`, and `app_user` is who the migrations grant table access to):

```sql
create role waitron_app login password '<secret>' in role app_user;
```

Nothing else. If `WAITRON_MIGRATIONS_DATABASE_URL` is left unset (the default, meaning this SAME
role also runs migrations), see the already-migrated grants below and add them too.

### `WAITRON_MIGRATIONS_DATABASE_URL` — against an already-migrated database (the normal case)

**This list covers an idempotent RE-RUN — every migration set already applied, nothing new to do —
not every boot after the first.** The schema exists, every migration set is already recorded in its
own `__drizzle_migrations_*` journal table, and Drizzle only needs to confirm that and stop. The
exact grants below are what `boot.test.ts`'s own real-Postgres suite grants its probe role and then
asserts the whole host boots with — this is not a derived or best-guess list, but it is also not
sufficient for a boot that ships a genuinely NEW migration: Drizzle must `INSERT` a row per applied
migration into the journal table, which only carries `SELECT` below, and any new SQL that `ALTER`s
an existing table or `GRANT`s on one needs the role to own that table (or hold the equivalent
privilege explicitly) — `CREATE ON SCHEMA public` only covers creating objects that don't exist yet,
not modifying ones that do. See the "Practical recommendation" below for what actually satisfies
both cases across a database's lifetime.

```sql
create role waitron_migrator login password '<secret>' in role app_user;
-- Drizzle's migrator issues "CREATE SCHEMA IF NOT EXISTS public" (database-level CREATE) then
-- "CREATE TABLE IF NOT EXISTS" per set (schema-level CREATE) BEFORE it checks whether either
-- already exists — confirmed empirically, not assumed. Both are needed even though every one of
-- these statements is a no-op against a current database.
grant create on database <dbname> to waitron_migrator;
grant create on schema public to waitron_migrator;
-- SELECT on every table, not just the five journal tables by name: this role did not create them
-- (whoever originally bootstrapped the database did), so it does not own them and cannot read them
-- back without an explicit grant — and reading them back is how Drizzle decides nothing new needs
-- applying.
grant select on all tables in schema public to waitron_migrator;
```

`in role app_user` here is only required if this same role is ALSO `DATABASE_URL` (the unset-override
default); a migrations-only role that never runs a duty pass does not need it.

### `WAITRON_MIGRATIONS_DATABASE_URL` — against an empty database (first boot ever)

This case is **not** exercised by this package's own test suite — every test here bootstraps its
container via the container's own default superuser, which is a real but different shape from "a
dedicated, non-superuser migrating role bootstrapping a brand-new database" (`packages/db`'s own
`0001_tenancy_rls.sql` and its siblings are hand-written, custom migrations that create five NOLOGIN
support roles and hand a `SECURITY DEFINER` function's ownership to each one — drizzle-kit generates
no roles or ownership, so none of this is inferred). The grants below were verified by hand against a
real Postgres 18 container while writing this document, not carried over from an existing automated
test — treat them as correct but re-check if a future migration changes the pattern:

```sql
create role waitron_migrator login password '<secret>' createrole;
grant create on database <dbname> to waitron_migrator;
-- WITH GRANT OPTION matters here and did not above: the empty-database migrations temporarily
-- re-grant CREATE ON SCHEMA public to each support role they create (so they can own a function),
-- then revoke it — a grant this role cannot itself pass on fails partway through that dance.
grant create on schema public to waitron_migrator with grant option;
```

`CREATEROLE` is what lets this role run `CREATE ROLE app_user NOLOGIN`, `CREATE ROLE
sales_coverage_checker NOLOGIN NOSUPERUSER`, and the other three — and, because Postgres grants the
creating role admin option on a role it just created, is also what lets the same role run each
migration's `GRANT <support_role> TO CURRENT_USER WITH INHERIT FALSE` / `REVOKE … FROM CURRENT_USER`
pair without any further grant.

**Practical recommendation:** if the same role keeps running every migration for the lifetime of the
database — the common case, and the one that also answers the "new migration" gap noted above from
the other direction — it owns every table and role it created on every boot, including the objects a
FUTURE migration creates, so it never hits the missing-`INSERT`-on-the-journal or
missing-ownership-to-`ALTER` problem either: it just needs the same `CREATEROLE` plus `CREATE`
grants this section already lists, every time, not a widening set over the database's life. The
`SELECT ON ALL TABLES` grant from the already-migrated recipe above is only needed when a DIFFERENT
role (one that did not create the objects) takes over migrating later — and that handoff still only
covers a no-op re-run, not a role change happening in the same boot that also ships new SQL.

If your Postgres provider's bootstrap/admin user is already the database owner, that satisfies the
SCHEMA-level half of the empty-database case (it owns `public` via `pg_database_owner`, so it can
create anything there) but **not necessarily the `CREATEROLE` half** — database ownership does not
imply it; `CREATEROLE` is a separate role attribute Postgres does not grant merely for owning a
database. This is commonly true anyway for a managed provider's master/admin user (RDS, Cloud SQL,
Supabase and similar typically grant their master user createrole-equivalent privileges as part of
their own bootstrapping), but not guaranteed by "is the database owner" alone — a self-hosted
"just made this role the owner" setup may need `alter role <owner> createrole;` added explicitly.
Using that admin user for the very first boot only, then switching `WAITRON_MIGRATIONS_DATABASE_URL`
to a narrower `waitron_migrator` role afterwards, is a reasonable way to avoid keeping `CREATEROLE`
on a long-lived credential either way.

## Environment variables

| Variable                                   | Required | Default                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | yes      | —                                          | The deployment role's pool. See grants above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `WAITRON_MIGRATIONS_DATABASE_URL`          | no       | `DATABASE_URL`                             | The connection migrations run over. See grants above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `WAITRON_CREDENTIALS_KEY`                  | yes      | —                                          | Base64, 32 bytes. Owned by `loadKeyRing` (`packages/credentials`) — see below, not redeclared here.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `WAITRON_CREDENTIALS_KEY_VERSION`          | no       | `1`                                        | Integer ≥ 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS`         | no       | —                                          | Base64, 32 bytes. Set only during a key rotation window; must be set together with the next variable, never alone.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION` | no       | —                                          | Integer ≥ 1, and different from `WAITRON_CREDENTIALS_KEY_VERSION`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WAITRON_AEAT_ENV`                         | no       | `preproduction`                            | `preproduction` \| `production`. **Production numbering can never be reused, even for a test invoice — this default is deliberately the safe one, and production must be typed out.**                                                                                                                                                                                                                                                                                                                                                                     |
| `WAITRON_HTTP_PORT`                        | no       | `8080`                                     | Positive integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `WAITRON_HTTP_HOST`                        | no       | `127.0.0.1`                                | `/health` is unauthenticated (see below) — loopback by default so it is not reachable off the host unless you deliberately widen it (e.g. `0.0.0.0` behind your own network boundary).                                                                                                                                                                                                                                                                                                                                                                    |
| `WAITRON_MIN_TICK_MS`                      | no       | `5000` (5s)                                | Floor on the sleep between passes — stops a hot loop when a duty reports work due `now`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `WAITRON_MAX_TICK_MS`                      | no       | `3600000` (1h)                             | Ceiling on the sleep between passes — a **liveness floor** for `drain`'s hourly duty, not a performance knob. `fiscal.drain`'s staleness budget (`DUTY_BUDGET_MS`, `src/health.ts`) is a fixed 75 minutes (the DEFAULT ceiling plus 15 minutes' slack) regardless of this value, so raising this narrows that margin and, past 75 minutes, eliminates it — reintroducing the exact "an idle host flips 503 by construction" flap I1 of the 2026-07-26 whole-branch review fixed. See `health.ts`'s own comment before setting this above roughly an hour. |
| `WAITRON_SETTLEMENT_LAG_MS`                | no       | unset (the reconciler's own 7-day default) | Passed to `StripeReconcilerOptions.settlementLagMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WAITRON_MIGRATIONS_DIR`                   | no       | `<bundle dir>/drizzle`                     | Where migration SQL is read from. The default only exists in a built artefact (`scripts/copy-migrations.mjs` puts it there); running from source needs this set, or `server.migrations_missing` fails loud.                                                                                                                                                                                                                                                                                                                                               |
| `WAITRON_SCHEDULER_HORIZON_DAYS`           | no       | `30`                                       | `SchedulerDeps.horizonDays`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK`   | no       | `7`                                        | `SchedulerDeps.maxPeriodsPerTick`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WAITRON_SCHEDULER_MAX_ATTEMPTS`           | no       | `3`                                        | `SchedulerDeps.maxAttempts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_SCHEDULER_BACKOFF_BASE_MS`        | no       | `900000` (15m)                             | `SchedulerDeps.backoffBaseMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WAITRON_SCHEDULER_STALE_AFTER_MS`         | no       | `3600000` (1h)                             | `SchedulerDeps.staleAfterMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Every value is validated once, at boot, with a structured `server.config_invalid` /
`server.config_missing` error naming the variable and (for an invalid value) a reason code — never
the value itself, since an operator's mistyped input could be a secret pasted into the wrong place.

### The four `WAITRON_CREDENTIALS_KEY*` variables, in full

These are **not** parsed by this package's own `config.ts` — `src/boot.ts` passes the env it was
given straight to `loadKeyRing` (`packages/credentials/src/keyring.ts`), which owns all four names
and their validation, so this list exists here only so an operator does not have to go looking for
it:

- **`WAITRON_CREDENTIALS_KEY`** (required) — base64-encoded, exactly 32 bytes decoded. The current
  encryption key every credential read/write uses.
- **`WAITRON_CREDENTIALS_KEY_VERSION`** (optional, default `1`) — the version number stamped on rows
  sealed with the current key.
- **`WAITRON_CREDENTIALS_KEY_PREVIOUS`** / **`WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION`** (optional,
  but both-or-neither) — set only during a rotation window, so rows sealed under the previous key
  still decrypt while `rotate` re-seals them under the current one. Setting one without the other is
  a boot-time `credentials.key_ring_incomplete` failure, not a runtime surprise later.

Provisioning and rotating credentials themselves (`fiscal.aeat`, `payments.stripe`) is
`packages/credentials`'s own CLI, not this process — e.g.
`waitron-credentials set --tenant <uuid> --purpose fiscal.aeat` with the JSON payload on stdin. Run
`waitron-credentials` with no arguments for its own usage text (`set` / `list` / `delete` /
`rotate` — `packages/credentials/src/cli.ts`'s `USAGE` constant); there is no `get`, since that CLI
never prints a decrypted credential.

## What `/health` means

`GET /health` is the only route this process serves — no metrics, no auth, no readiness/liveness
split (spec §9). It answers `200` when every duty is within its staleness budget, `503` otherwise:

```json
{
  "ok": false,
  "startedAt": "2026-07-26T08:00:00Z",
  "lastPassAt": "2026-07-26T09:14:02Z",
  "duties": {
    "fiscal.drain": {
      "lastOkAt": "2026-07-26T08:14:02Z",
      "consecutiveFailures": 7,
      "skipped": 1,
      "parked": 0,
      "stale": true
    },
    "payments.reconcile.stripe": {
      "lastOkAt": "2026-07-26T09:14:02Z",
      "consecutiveFailures": 0,
      "skipped": 0,
      "parked": 0,
      "stale": false
    }
  }
}
```

**A `503` is the single most important signal this process can produce.** It means one of four
things — three visible in the body above without needing the logs, one that needs them:

- **`stale: true`, `consecutiveFailures` counting up** — a duty inside the pass is failing every
  time it runs (a database blip, an unreachable AEAT endpoint). Check the logs (below) for the
  `errorCode` on the most recent `duty.failed` line.
- **`stale: true`, `consecutiveFailures` NOT counting up** — rarer, and the one that needs the logs
  to tell apart from the case above: `pass.threw` fired instead, meaning something escaped `runPass`
  itself rather than being contained per-duty. `onPass` (and therefore `recordPass`) never runs on
  that cycle, so `consecutiveFailures` does not increment even though the pass produced nothing —
  check `pass.threw`'s own `errorCode`, not `duty.failed`, which does not exist for this case.
- **`skipped` > 0, but `stale` may still read `false` for a while** — at least one enrolled tenant's
  fiscal work (or, for `payments.reconcile.stripe`, one (tenant, duty) pair's sweep) could not be
  attempted THIS pass, even though the pass itself completed and others were served. This does not
  clear on its own: `consecutiveFailures` increments and `lastOkAt` does not advance for as long as
  ANY tenant is skipped, however many others are healthy — see `src/health.ts`'s own comment on
  `recordPass` for why that is correct rather than an over-broad alarm. Find which tenant and why
  via the `drain.tenant_skipped` / `reconcile.pair_skipped` log lines (next section); the most
  common cause is a missing, unreadable, or stale-shaped credential.
- **`parked` > 0, `payments.reconcile.stripe` only** — a Stripe reconcile run exhausted
  `WAITRON_SCHEDULER_MAX_ATTEMPTS` (default 3) and is now permanently abandoned for that (tenant,
  period): nothing claims it again automatically, unlike a `skipped` pair (which retries next pass)
  or a `failed` one (which retries on its own backoff and does NOT flip this field — see
  `src/pass.ts`'s own comment on why). `fiscal.drain` has no equivalent terminal outcome at all — a
  halted fiscal record is a different, already-persisted signal (the `incidents` table, and
  `recordsHalted`/`incidentsRaised` in `drain.complete`), deliberately not fed into `/health`; see
  the opening section above. Find a park via the error-level `reconcile.run_parked` log line, which
  carries the tenant, duty, period and `errorCode`.

`payments.reconcile.stripe` uses the identical `skipped`/`parked` mechanism with a 26-hour staleness
budget (a daily period plus slack) rather than drain's ~75 minutes, so the same reading applies to
it for Stripe settlement reconciliation instead of a fiscal submission.

**What to do about a `503`:** read the body first — it names which duty and how many tenants or
runs. Then grep stdout for that duty's own skip/failure/park events around `lastOkAt`. For a skipped
`fiscal.drain` tenant, the fix is almost always provisioning or repairing that tenant's `fiscal.aeat`
credential (via `packages/credentials`'s CLI) — credentials are read fresh every pass (spec §6), so
there is no restart needed once the credential is fixed. A skipped tenant reports its own duty due
again `now` (never `null`), which the loop clamps to `WAITRON_MIN_TICK_MS` (5s by default) rather
than waiting out the full cadence, so the very next pass — not the next hour — is what picks the fix
up. A **parked** reconcile run is different: nothing re-attempts it on its own, ever — there is no
remediation UI or re-sweep of an abandoned period (spec §14), so a parked settlement audit needs a
human to investigate directly, via the `reconcile.run_parked` line's tenant/duty/period. If the
WHOLE pass is failing rather than one tenant, restart is unlikely to help either — the process
already retries every pass on its own at that same fast cadence, so a repeating `503` past a few
cycles means the underlying cause (usually the database or an external endpoint) needs fixing, not
the process.

## Log events

One structured JSON line per event on stdout, `{ ...fields, at, level, event }` (`src/logger.ts`).
The ones worth grepping for:

- **`drain.tenant_skipped`** (`warn`) — `{ tenantId, errorCode }`. A tenant this pass could not
  submit fiscal work for at all. This line is the ONLY place this fact exists outside `/health`'s
  `skipped` count — a skipped tenant has no ledger row (`drain` has no per-tenant table of its own)
  and no incident (`incidents.till_id` is `NOT NULL`, and a drain has no till). `errorCode` is
  typically `server.credential_unusable` (a `fiscal.aeat` credential exists but a declared field —
  most often `certKind`, absent from a row sealed before that field joined the purpose registry — is
  missing or unusable) or a credential-store code from `getCredential`
  (`credentials.missing` — no row for this tenant/purpose at all, `credentials.decrypt_failed`,
  `credentials.key_version_unknown`, `credentials.malformed_payload`).
- **`reconcile.pair_skipped`** (`warn`) — `{ tenantId, duty, errorCode }`. The Stripe reconcile
  equivalent, one (tenant, duty) pair abandoned by an infrastructure failure mid-sweep.
- **`reconcile.run_failed`** (`warn`) — `{ tenantId, duty, period, errorCode }`. One claimed
  reconcile run failed this attempt but is still retrying on its own backoff — a `next_attempt_at`
  exists. Never flips `/health`; see the `skipped`/`parked` bullets above.
- **`reconcile.run_parked`** (`error`) — `{ tenantId, duty, period, errorCode }`. One claimed
  reconcile run exhausted `WAITRON_SCHEDULER_MAX_ATTEMPTS` and is now abandoned for that
  (tenant, duty, period) permanently — nothing will claim it again. This is what `/health`'s
  `parked` count (above) is counting.
- **`duty.failed`** (`error`) — `{ duty, errorCode }`. The WHOLE duty threw for this pass (not a
  per-tenant skip) — `fiscal.drain` or `payments.reconcile.stripe` itself, not a tenant within it.
- **`drain.complete`** (`info`) — per-pass summary counters for `fiscal.drain`, including `skipped`
  (a count, matching the body above) and the duty's own `nextDueAt`.
- **`reconcile.complete`** (`info`) — the reconcile equivalent. `ran` is broken down by outcome —
  `{ succeeded, failed, parked }` — rather than a bare total, plus `deferred`, `beyondHorizon`,
  `skipped` (matching the body above) and the duty's own `nextDueAt`.
- **`pass.complete`** (`info`) — one line per pass, both duties' `ok`/`errorCode`, and the folded
  `nextDueAt` the loop is about to sleep on.
- **`loop.sleeping`** (`info`) — `{ sleepMs }`, immediately after `pass.complete`.
- **`pass.threw`** (`error`) — `{ errorCode }`. Something escaped `runPass` itself, rather than
  being contained per-duty by `attempt` — genuinely unforeseen. `onPass` is never called for this
  cycle (it sits inside the same `try` that just threw), so `consecutiveFailures` does **not**
  increment on this line the way it does for a contained `duty.failed` — see
  ["What `/health` means"](#what-health-means) above for how to tell the two apart from the body
  alone. The loop logs this and retries on `WAITRON_MIN_TICK_MS` rather than exiting.
- **`onPass.threw`** (`error`) — `{ errorCode }`. A bug in the health-recording side observer
  itself, not the pass — the pass already succeeded and its real `nextDueAt` is unaffected.
- **`sleep.threw`** (`error`) — `{ errorCode }`. The injected `sleep` rejected for something other
  than the ordinary shutdown abort (`realSleep` narrows to just that case) — logged and the loop
  goes around again rather than ending.
- **`server.listening`** (`info`) — `{ port, aeatEnv }`, logged once the HTTP listener has actually
  bound (not merely been asked to).
- **`server.listen_failed`** (`error`) — `{ port, code }`. The listener failed to bind — `EADDRINUSE`
  (the port is already taken — the common case for a fixed default port) or `EACCES` (a privileged
  port, no permission) are the usual `code` values. The process exits `1` immediately after this
  line; nothing retries a bind failure in the background.
- **`server.stopped`** / **`loop.stopped`** (`info`) — graceful shutdown completed (SIGTERM/SIGINT).

Never prose, and never a secret: every credential-adjacent error reports a structured code and — at
most — a tenant id and a field NAME, never decrypted material, a Stripe secret, or a PFX passphrase.

## Migrations

Applied at boot, every time, behind a Postgres advisory lock (`MIGRATION_LOCK_KEY` in
`src/migrations.ts`) so two replicas starting together cannot race the same journal. Drizzle's
runner is journal-tracked and idempotent, so this is a no-op against a current database — the cost is
the privilege check described above, not any actual DDL. A migration failure is a boot failure: the
process logs and exits non-zero rather than starting half-migrated.

## Build

`pnpm --filter @waitron/server build` runs `scripts/copy-migrations.mjs` (copies every migration
package's `drizzle/` folder to `dist/drizzle/<set-name>`, reading the same
`migrations.manifest.json` `src/migrations.ts` itself reads, so the two cannot name different sets)
and then bundles `src/bin.ts` to `dist/server.js` with esbuild. Run the bundle directly:
`node dist/server.js`.

`scripts/copy-migrations.mjs` also writes `dist/package.json` (`{"type":"module"}`), so `dist/` is
portable as a directory on its own — copied into a Docker image with nothing else from this
package, say. `dist/server.js` is ESM (esbuild's `--format=esm`), and a bare `.js` file's module
system is normally decided by Node walking up from it for the nearest `package.json` — today that
walk finds `apps/server/package.json`'s own `"type": "module"` purely because `dist/` sits two
directories under it, not because the bundle carries that fact itself. Copy `dist/` out on its own
and that walk finds nothing. On a Node build with ES-module syntax detection disabled or
unavailable (`--no-experimental-detect-module`; the flag is real, and disabling it reproduces the
failure), that means CommonJS by default, and `node dist/server.js` fails immediately with `Cannot
use import statement outside a module` rather than this process's own config validation. Where
syntax detection is enabled — this repo's own supported Node range's actual default — Node already
recovers by sniffing the file's `import` syntax, so `dist/package.json` is not fixing an observed
failure on this repo's baseline today; it makes the module type an explicit, declared fact carried
WITH the bundle rather than one inferred from source syntax by whichever Node happens to run it,
matching how every other `package.json` in this repo declares `"type"` rather than relying on
sniffing. Chosen over renaming the bundle to `dist/server.mjs` (which forces the same fact through
the file's extension instead, unconditionally of Node version or flags) because a rename also
touches `package.json`'s `bin` field, the CI gate's smoke-test paths, and this README's own
`node dist/server.js` examples, for no behavioural difference once `dist/package.json` exists.
