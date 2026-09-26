# `@waitron/server`

The host process. It boots from environment config, loads the credential vault's key ring, applies
every migration set behind the venue directory's own migration lock, resolves the AEAT transport and the Stripe
account, then runs a loop: `drain` (the fiscal submission duty), the Stripe payments reconcile, the
per-tick card `resolvePending` sweep (this node's own `attempting` card rows), fold the result into
a sleep duration, repeat. It also serves several HTTP routes on one Hono app:
`GET /health` (unauthenticated), the till API under `/api/*`, the management-dashboard API under
`/management-api/*`, and the inbound Stripe payments webhook at `POST /webhooks/stripe`.

Design: [`docs/superpowers/specs/2026-07-26-server-host-design.md`](../../docs/superpowers/specs/2026-07-26-server-host-design.md).
This document is the operational half of that spec — written for whoever deploys this process, not
whoever reads its source.

**The one thing worth remembering before anything else:** `drain` carries a legal, hourly submission
duty under Spain's Veri\*Factu regulation (art. 16.4). A `/health` that reports `200` is a claim that
the pass was not wholesale abandoned and no Stripe settlement-audit period has been
permanently parked — it is **not** a claim that every individual fiscal record has actually been
accepted by AEAT. A database whose records reach AEAT but are individually rejected reads `200` with
`lastOkAt` refreshing every pass; that is visible only via `recordsHalted`/`incidentsRaised` in the
`drain.complete` log line, the `incidents` table, and the dashboard's alerts bell and Alerts screen
(as `fiscal.` alerts, to anyone holding `fiscal.view`), deliberately, not through this endpoint — see
["What `/health` means"](#what-health-means) below for the exact boundary, and why, before treating
a `503` as noise or its absence as "nothing is wrong."

## Running it

```
WAITRON_STATE_DIR=/var/lib/waitron/state \
WAITRON_CREDENTIALS_KEY=<base64, 32 bytes> \
WAITRON_CREDENTIALS_KEY_VERSION=1 \
node dist/server.js
```

There is no connection string. The whole database is a **directory** — see
["The venue directory"](#the-venue-directory) below — and unless you name one with
`WAITRON_VENUE_DIR`, it is `venue` under whatever `WAITRON_STATE_DIR` names.

Build with `pnpm --filter @waitron/server build` — this bundles `src/bin.ts` with esbuild AND copies
every migration package's `drizzle/` folder beside the bundle (`scripts/copy-migrations.mjs`), which
`WAITRON_MIGRATIONS_DIR` defaults to finding there. Running `dist/server.js` without that copy step
fails loudly at boot with `migrations.set_missing`, not silently.

Every boot failure exits non-zero, but not all of them reach stdout the same way. A port that will
not bind logs a structured `server.listen_failed` JSON line (see ["Log events"](#log-events)) and
exits `1` directly. Bad config, an unloadable key ring, a mismatched deployment environment (see below), a
failed migration, and a venue directory that cannot be opened instead **throw**, and `bin.ts` has no `try`/`catch` around `startServer` — Node prints the
`AppError`'s stack to **stderr** as an unhandled rejection and exits non-zero, not as a JSON line on
the stdout stream a log collector reads. (Catching those five in `bin.ts` and logging them
structurally the same way would be a real improvement; it is not done here — check stderr for those,
stdout for a bind failure.) Either way there is no "boots half-configured and retries in the
background": a supervisor (systemd, Docker's restart policy) is expected to restart the process, and
it will keep failing until whatever is wrong is fixed.

## The venue directory

There is no database server, no connection string and no database role. One process opens **one
directory**, and that directory is the whole database: `openVenueStore`
(`packages/store/src/index.ts`) creates `venue.db` and `node.db` inside it, each with write-ahead
journalling, foreign keys on and a busy timeout. The operating-system permissions on that directory
are the whole of the access control; there is nothing to `GRANT`, and nothing that could be granted
too widely. While a primary streams to a bucket, the server's own Litestream child
also opens `venue.db`, and takes no lock ([conventions-data.md](../../docs/developers/conventions-data.md), "Litestream is a second
process on `venue.db`").

**Every migration set is applied to `venue.db`, and `node.db` is created and left empty**
(`packages/migrations/src/apply.ts`, and `useVenueDb`'s own note in
`packages/db/src/testing/venue-db.ts`). A table's class does not choose a file: a `local` table's
rows each belong to one node and sit in `venue.db` beside every other table. `node.db` is reserved
for a later slice (slice-2 spec §2).

`WAITRON_VENUE_DIR` names the directory. Left unset — or set to the empty string, which counts as
unset everywhere in this codebase — it is `venue` under `WAITRON_STATE_DIR`, so the databases live
beside the box's other persisted state (`config.ts`, `ServerConfig.venueDir`). Put it on durable,
protected storage: it holds the fiscal records.

Migrations run at every boot, over that directory. Two migrators starting together queue on a
third SQLite file, `migrations.lock`, which the migrator holds an open transaction on for the
length of the run — a second migrator waits up to two minutes and is then refused
`database is locked`. It is a SQLite file rather than an exclusively-created lock file on purpose:
closing the connection releases it, and so does killing the process, where a plain lock file would
survive the crash and wedge every later boot. `packages/migrations/src/apply.ts` carries the races
that were run to decide both. Only the migrate step waits: opening the folder is guarded separately
by `venue.lock`, so a second process that opens it WITH the lock while another holds it, a second
server included, is refused `provisioning.database_in_use`; the tools meant to run beside the server
open it without the lock ([conventions-data.md](../../docs/developers/conventions-data.md), "One process per venue folder").

`applyMigrations` also installs each set's **append-only triggers** as it goes, from the table names
that set declares. Those are SQLite `RAISE(ABORT)` triggers (`packages/store/src/append-only.ts`),
and they are what makes a ledger row unrewritable now that there is no `REVOKE` to lean on.

### The deployment-environment check

Before `applyMigrations` runs — before any write at all — `startServer` opens the venue directory
on its own short-lived handle and compares this host's `WAITRON_ENV` against the `deployment`
table's own stamp, throwing `deployment.environment_mismatch` (see "Running it" above) rather than
letting a host boot against another environment's database. That probe is closed again before
migrations start.

**What actually writes the stamp.** Three paths do, and all call the same programmatic
`stampDeployment` (`@waitron/db`) rather than writing the row themselves. The browser setup wizard's
provision handler does it (`provisionVenue`, `apps/server/src/provision.ts`), from the demo/live
choice the operator made. Its adopt handler does it (`adoptFromPrimary`, `apps/server/src/adopt.ts`),
from the environment in the primary's bundle. `waitron-provision venue` does it for a directory that
carries no stamp, from `WAITRON_ENV` — unset means `preproduction` and `production` has to be typed
out in full — which is what lets an automated deployment stand a venue up with no browser. None can
move a stamp that is already there: `stampDeployment` refuses a different value with
`deployment.already_stamped`, and provision and `waitron-provision venue` let it propagate; adopt
reads the stamp first and throws that code itself, before its first write. (`waitron-provision
instance`, which used to be the only stamping path, was deleted with the PostgreSQL deployment
model. So was the retired `apps/server/sql/bootstrap-tenant.sql`, removed on 2026-08-04, which
wrote the row by hand.)

A database nobody has stamped reads `deployment` as `null` and **boots normally, with this check
inert**, exactly as if the check did not exist. Only a database stamped for the OTHER environment
refuses.

## Provisioning a venue

`waitron-provision venue` creates the business rows a sellable venue needs — the taxpayer row, a
location, a till, a node, and a standard plus a rectificative invoice series — and runs every enabled module's
seed for that node, the fiscal one registering it as a Veri\*Factu SIF, in one transaction. It replaced the retired `apps/server/sql/bootstrap-tenant.sql` (see "What actually
writes the stamp" above for why that file was removed).

It runs **against a directory something has already migrated**, and stamps that directory itself
when it carries no stamp (see "What actually writes the stamp" above). Stop the server first: while
another process (usually the server) has the folder open, `venue` is refused with `provisioning.database_in_use`. A directory nothing has
migrated is refused with `provisioning.database_unmigrated`, and one stamped for the other
environment with `deployment.already_stamped` — one database per environment is a fiscal invariant. It opens the venue
**directory** — `--venue-dir`, else `WAITRON_VENUE_DIR` (the same variable this server reads, so a
box's own setting is what stands its venue up), else a prompt — and writes through `venue.db`. There
is no connection string, no role and no grant to widen: `applyVenue` writes in one transaction. A database
already holds one taxpayer, so a run naming a different country or tax id is refused with
**`provisioning.foreign_tenant`** — that is the code an operator who mistyped a NIF on a re-run
sees, and the refusal happens before anything is applied. The country and tax id are trimmed and
upper-cased before that check, so a difference of letter case or surrounding space is the same
taxpayer and the re-run is a no-op. (`provisioning.tenant_identity_mismatch` is a different,
narrower refusal, raised inside the apply transaction only when another run commits a different
taxpayer between this one's read and its write. A mistyped NIF is `foreign_tenant`, not this.)

```bash
pnpm --filter @waitron/provisioning build   # once — produces dist/bin.js, and that is the whole build
WAITRON_VENUE_DIR=/var/lib/waitron/state/venue \
WAITRON_ADMIN_PIN=1234 \
WAITRON_ADMIN_PASSWORD='choose-a-strong-one' \
  node packages/provisioning/dist/bin.js venue \
    --country ES --tax-id B12345678 --legal-name 'Deli SL' \
    --location-name Mostrador --territory ES-common --locale es-ES \
    --operation-description 'Venta en establecimiento' \
    --address-line1 'Calle Mayor 1' --postal-code 28001 --city Madrid --province Madrid \
    --time-zone Europe/Madrid --day-cutover 06:00 \
    --till-name 'Caja 1' --series-code A --rectificative-code R \
    --admin-name 'Owner' --admin-email 'owner@example.com' \
    --yes
```

The command seeds the venue's first **admin** person. `--admin-name`, the required `--admin-email`
and the optional `--admin-first-names` / `--admin-last-names` are not secrets, so they stay as
flags. The admin's two login secrets are read only from the environment or an echo-off prompt, never
from `argv`: `WAITRON_ADMIN_PIN` (the till PIN) and `WAITRON_ADMIN_PASSWORD` (the dashboard
password, ≥8 characters), both required.

Dashboard management login is **email + password**: `loginManager` resolves the person by email. Both
the setup UI and the bare `venue` CLI require the first admin's email and thread it into `seed-admin`,
so the provisioned admin can sign in immediately. The provisioned password is also what the C2b
mirror-bundle adoption route authenticates **by id** via `loginManagerById`, because that
server-to-server flow carries the admin's id rather than the dashboard form.

Every option is prompted for when omitted, so a bare `venue` is a complete interactive session; the
exceptions are `--admin-first-names` and `--admin-last-names`, which are read from a flag but never
prompted for, so an existing non-interactive script gains no new question. `--yes` skips the
confirmation for a non-interactive run. `--territory` currently accepts only
`ES-common` (common-territory Spain, filing under Veri\*Factu with IVA); any other territory is
refused with `fiscal.regime_not_implemented`. The SIF's `id_sistema_informatico` is **not** an
option — it is the `WAITRON_ID_SISTEMA` product constant (`W1`), because it identifies Waitron's
software, not the venue. The venue directory carries no password, so it is an ordinary
`--venue-dir` flag; the two login secrets stay out of `argv`, and the parser rejects the retired
`--admin-url` outright rather than ignoring it, so an operator reaching for the old connection
string is told instead of having it dropped on the floor. See
[`packages/provisioning/README.md`](../../packages/provisioning/README.md) for the full option list,
what the command prints, and what it refuses.

## Rejoining a returned box

When a failed on-prem box is replaced by a promoted cloud primary and later comes back, it returns as a
FENCED ex-primary (membership rejoin R1) — it cannot sell, because the cloud is now the serving primary.
`waitron-rejoin rejoin` WIPES that box's local database and re-adopts it as a secondary of the current
primary. There is no artifact input: the wipe deletes both database files, their write-ahead
sidecars and Litestream's `.venue.db-litestream/` folder out of the venue directory
(`src/db-wipe.ts` — a committed row can live in a `-wal` file alone, so the sidecars go too),
re-migrates the directory from source, then adopts in setup mode.
The whole command runs holding the venue folder's lock (`venue.lock`). `migrations.lock` and
`venue.lock` (with `venue.lock-journal` while it is held) are deliberately left in place: they hold no
data, and removing either would let a second process take a fresh lock beside the one holding it.

```
waitron-rejoin rejoin [--accept-loss]
```

It reads its own boot env — `WAITRON_STATE_DIR`, `WAITRON_VENUE_DIR` (both resolved exactly as
`config.ts` resolves them, so an empty value takes the default rather than the working directory),
`WAITRON_ENV`, and the four `WAITRON_TILL_*_ID`. Three ordered refusals come before the wipe:

- **`provisioning.database_in_use`** — another process, usually the running server, is using the venue
  folder. Refused before anything is read or wiped; stop the server first.
- **`rejoin.not_fenced`** — the box is not a fenced ex-primary; only a fenced one is safe to wipe.
- **`rejoin.no_carrier`** — the held membership chart names no serving-primary to re-adopt from, so there
  is nowhere to rejoin.

The last two refuse LOUD rather than wipe a box that is not safe to wipe.

**What this command no longer checks.** It used to confirm, before wiping, that every row this box
originated had reached the carrier — a check built on PostgreSQL replication, which has been removed and
whose replacement has not landed. So rejoin now wipes without that confirmation, and `--accept-loss`
waives nothing: it only records the operator's acknowledgement in the log. The wipe is irreversible
(CLAUDE.md §5).

## Environment variables

| Variable                                   | Required | Default                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITRON_STATE_DIR`                        | no       | a `state` folder beside the running module | The durable, protected directory the box keeps its own secrets, TLS material, logs and databases under. Deployment sets it to a real path (`deploy/Dockerfile` sets `/var/lib/waitron/state`); the development default sits beside the running module and is gitignored, because it holds secrets. An unset OR EMPTY value takes the default — never the working directory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `WAITRON_VENUE_DIR`                        | no       | `venue` under `WAITRON_STATE_DIR`          | The directory holding this venue's `venue.db` and `node.db` — the whole database. See ["The venue directory"](#the-venue-directory) above. An unset OR EMPTY value takes the default; an override is resolved to an absolute path at load, because these files are opened by path for the life of the process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `WAITRON_CREDENTIALS_KEY`                  | yes      | —                                          | Base64, 32 bytes. Owned by `loadKeyRing` (`packages/credentials`) — see below, not redeclared here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `WAITRON_CREDENTIALS_KEY_VERSION`          | no       | `1`                                        | Integer ≥ 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS`         | no       | —                                          | Base64, 32 bytes. Set only during a key rotation window; must be set together with the next variable, never alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION` | no       | —                                          | Integer ≥ 1, and different from `WAITRON_CREDENTIALS_KEY_VERSION`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WAITRON_ENV`                              | no       | `preproduction`                            | `preproduction` \| `production`. **One setting for the whole deployment, not one per provider** — it selects both the AEAT endpoint family `aeatEndpointFor` resolves to and the Stripe key mode (`sk_live_` vs `sk_test_`) the `payments.stripe` credential must match (a mismatch there is a `payment.credential_environment_mismatch` on the reconcile duty, not a boot failure — see ["Log events"](#log-events)). Also checked against the database itself at boot, before any migration runs — see ["The venue directory"](#the-venue-directory) above. **Production numbering can never be reused, even for a test invoice — this default is deliberately the safe one, and production must be typed out.** **Rollback warning:** `deploymentEnvironment` reads ONLY this variable — the pre-branch code read ONLY `WAITRON_AEAT_ENV`, and both default to `preproduction`. During any window in which a rollback to a pre-`WAITRON_ENV` build remains possible, keep `WAITRON_AEAT_ENV` set to the SAME value as `WAITRON_ENV`. Left unset while only `WAITRON_ENV=production` is configured, a rolled-back host silently resolves `preproduction`, submits this deployment's `production`-generated fiscal records to AEAT's PRE-PRODUCTION endpoint, and AEAT accepts them there — written terminal `aceptado`, never retried, while the real AEAT never receives them and those invoice numbers are permanently spent. This is a deploy-config safeguard for the rollback window only, not a code change: the resolver must NOT fall back to `WAITRON_AEAT_ENV`, or the two-variables-that-must-agree problem this branch exists to remove would simply come back.                                           |
| `WAITRON_HTTP_PORT`                        | no       | `8080`                                     | Positive integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `WAITRON_HTTP_HOST`                        | no       | `127.0.0.1`                                | `/health` is unauthenticated (see below) — loopback by default so it is not reachable off the host unless you deliberately widen it (e.g. `0.0.0.0` behind your own network boundary).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `WAITRON_MIN_TICK_MS`                      | no       | `5000` (5s)                                | Floor on the sleep between passes — stops a hot loop when a duty reports work due `now`. **Must not exceed `WAITRON_SKIP_RETRY_MS`** — raising this past that value fails boot the other way round; see that row's own constraint below before widening this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `WAITRON_MAX_TICK_MS`                      | no       | `3600000` (1h)                             | Ceiling on the sleep between passes — a **liveness floor** for `drain`'s hourly duty, not a performance knob. `fiscal.drain`'s staleness budget (`DUTY_BUDGET_MS`, `src/health.ts`) is a fixed 75 minutes (the DEFAULT ceiling plus 15 minutes' slack) regardless of this value, so raising this narrows that margin — and **`boot.ts` refuses to start at or past 75 minutes**, rather than merely eliminating the margin: a structured `server.config_invalid` with `reason: "at_or_above_drain_budget"`, before any infrastructure is touched. This is enforced, not advisory — grep the reason code above if you hit it. See `health.ts`'s own comment before setting this above roughly an hour. **Must be `>= WAITRON_SKIP_RETRY_MS`** — lowering this past that value fails boot the other way round, `reason: "above_max_tick"` (the SAME reason code the `WAITRON_MIN_TICK_MS > WAITRON_MAX_TICK_MS` guard above uses, not a near-synonym); see `WAITRON_SKIP_RETRY_MS`'s own row below before narrowing this one. Not a cosmetic pairing: setting ONLY this variable to something below `WAITRON_SKIP_RETRY_MS`'s default — `5000`, say — used to boot clean and then silently clamp the skip-retry interval back down toward the 5-second floor at runtime (`sleepMsFor`, `src/loop.ts`), restoring the exact spin this whole design exists to remove with no error anywhere. See `docs/superpowers/specs/2026-07-27-degraded-pass-design.md` §2.3's final amendment for the full arithmetic.                                                                                                                                                                                                                |
| `WAITRON_SKIP_RETRY_MS`                    | no       | `300000` (5m)                              | How long after a **skipped** `fiscal.drain` pass or a skipped `payments.reconcile.stripe` duty either duty reports work due again. One value for both duties, sourced from `@waitron/scheduler`'s own `DEFAULTS.skipRetryMs`. Folded as a _minimum_ against whatever a successful drain or reconcile pair computed this same pass, so a healthy duty's earlier gate still wins — this can only pull the reported instant earlier, never later. Before this existed, a skip reported work due `now`, which `WAITRON_MIN_TICK_MS` turned into a 5-second retry **forever** on a box whose certificate only a human can provision — ~86,400 log lines a day (five per pass, 17,280 passes a day at the old floor) for a wait no retry could shorten, and the expected state of the first deployment, not a corner case. **Must be `>= WAITRON_MIN_TICK_MS` and `<= WAITRON_MAX_TICK_MS`** — `loadConfig` (`src/config.ts`) refuses to boot below the floor or above the ceiling, rather than letting `sleepMsFor`'s clamp (`src/loop.ts`) silently round it back to (or past) either bound — which would reproduce the exact 5-second-forever spin described above with no error anywhere, from the ceiling side just as much as the floor side; the two guards are symmetric. A structured `server.config_invalid` with `reason: "below_min_tick"` (below the floor) or `reason: "above_max_tick"` (above the ceiling — the same reason string the `WAITRON_MIN_TICK_MS > WAITRON_MAX_TICK_MS` guard uses) — grep either reason code if you hit it; both name the OTHER variable and its effective value too, so the error is actionable whichever of the pair you actually set. Equal to either bound is fine and boots. |
| `WAITRON_SETTLEMENT_LAG_MS`                | no       | unset (the reconciler's own 7-day default) | Passed to `StripeReconcilerOptions.settlementLagMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `WAITRON_MIGRATIONS_DIR`                   | no       | `<bundle dir>/drizzle`                     | Where migration SQL is read from. The default only exists in a built artefact (`scripts/copy-migrations.mjs` puts it there); running from source needs this set, or `migrations.set_missing` fails loud.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `WAITRON_LITESTREAM_BIN`                   | no       | `litestream`, found on `PATH`              | The Litestream binary the bucket copy runs (`resolveLitestreamBin`, `@waitron/stream`). The box image puts the pinned one on `PATH`; from source, `pnpm setup:litestream` downloads it to `.bin/litestream` and prints the value to set. Empty counts as unset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `WAITRON_SCHEDULER_HORIZON_DAYS`           | no       | `30`                                       | `SchedulerDeps.horizonDays`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK`   | no       | `7`                                        | `SchedulerDeps.maxPeriodsPerTick`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `WAITRON_SCHEDULER_MAX_ATTEMPTS`           | no       | `3`                                        | `SchedulerDeps.maxAttempts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WAITRON_SCHEDULER_BACKOFF_BASE_MS`        | no       | `900000` (15m)                             | `SchedulerDeps.backoffBaseMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `WAITRON_SCHEDULER_STALE_AFTER_MS`         | no       | `3600000` (1h)                             | `SchedulerDeps.staleAfterMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Every value boot reads is validated once, at boot, with a structured `server.config_invalid` /
`server.config_missing` error naming the variable and (for an invalid value) a reason code — never
the value itself, since an operator's mistyped input could be a secret pasted into the wrong place.

Preproduction fiscal submission is off by default. A dedicated integration target can set
`WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`; a Demo or Prepare installation still refuses to drain even
with that switch present. Production always runs the fiscal drain.

Demo and Prepare use the local card simulator by default. To exercise the configured Stripe test
provider on a Prepare node, set `WAITRON_PAYMENT_TEST_PROVIDERS=enabled` and provision a Stripe test
credential (`sk_test_…`). Demo always remains on the simulator.

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

Provisioning and rotating credentials themselves (`fiscal.aeat`, `payments.stripe`, `payments.sumup`,
`email.smtp`) is
`packages/credentials`'s own CLI, not this process — e.g.
`waitron-credentials set --purpose fiscal.aeat` with the JSON payload on stdin (that CLI refuses a
`--tenant` flag: one database holds one taxpayer). Run
`waitron-credentials` with no arguments for its own usage text (`set` / `list` / `delete` /
`rotate` — `packages/credentials/src/cli.ts`'s `USAGE` constant); there is no `get`, since that CLI
never prints a decrypted credential.

### Account email

Demo and Prepare capture invitation and password-reset email in Mailpit when you have not configured
SMTP. Sign in as a manager and open **Configuration → Test inbox** to read a message and follow its
account link. The inbox is served through Waitron's authenticated API; Mailpit's own ports bind to
the box loopback only.

`pnpm dev:setup`, `pnpm dev:reset`, `pnpm dev:onboard`, `pnpm dev:reset:onboard`, and the `wa-wt`
worktree launcher also start Mailpit. During local development you can inspect its own UI at
`http://127.0.0.1:8025`. The development venue is a directory of SQLite files under the same state
directory the server resolves, and `dev:reset` removes that directory so the next run provisions
from scratch. Nothing in Compose holds venue data, so no `docker compose` command resets anything.

For a production or on-prem venue, put its SMTP relay in the encrypted credential vault. Write the
payload to a permission-restricted file rather than putting its password in a shell argument:

```json
{
  "url": "smtps://user:password@smtp.example.com:465",
  "from": "Waitron <no-reply@example.com>"
}
```

```bash
waitron-credentials set --purpose email.smtp --file /secure/path/smtp.json
```

The server reads this credential when it sends, so rotating it does not require a restart. Configured
SMTP takes precedence over local capture. A live installation never falls back to Mailpit: if SMTP
is missing or the relay is unavailable, creating a person still succeeds and reports that the
invitation was not sent; password-reset requests continue to return their generic accepted response.
Once SMTP is restored, request another reset or resend the invitation from Users.

`WAITRON_MANAGEMENT_ORIGIN` determines the link host. It must use HTTPS unless it is a loopback
development origin; the server refuses an insecure LAN or public origin at boot.

### Optional Google login

Set `WAITRON_GOOGLE_CLIENT_ID` and `WAITRON_GOOGLE_CLIENT_SECRET` together to offer Google login.
Create a web OAuth client in Google and register this exact redirect URI:

```text
<WAITRON_MANAGEMENT_ORIGIN>/management-api/google/callback
```

Set `WAITRON_PRIVACY_NOTICE_URL` to the restaurant's published privacy notice. Waitron shows the
link in invitation emails, account setup and **Your profile**. The value must be an absolute HTTP or
HTTPS URL; leave it unset only while the restaurant's notice has not been published.

The server refuses a partial client configuration. A person links Google from Your profile before
the public Google button can identify their Waitron account. Waitron stores Google's stable subject
identifier and does not retain Google access or refresh tokens. Password, passkey and PIN login keep
working when Google is unavailable.

## What `/health` means

`GET /health` is unauthenticated — no metrics, no auth, no readiness/liveness split (spec §9). It is
one of several routes the process serves (the till API under `/api/*`, the management-dashboard API
under `/management-api/*`, and the Stripe webhook at `POST /webhooks/stripe` share the same
Hono app); this endpoint answers `200` when every duty is within its staleness budget, `503`
otherwise:

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
  },
  "venueHolder": {
    "kind": "server",
    "lockedAt": "2026-07-26T08:00:00Z",
    "heartbeatAt": "2026-07-26T09:14:00Z",
    "stale": false
  },
  "stream": {
    "state": "streaming",
    "reason": null,
    "stateSince": "2026-07-26T08:00:03Z",
    "bucketProblem": null,
    "lagMs": 0,
    "lastConfirmedUploadAt": "2026-07-26T09:13:58Z"
  }
}
```

`venueHolder` is read from `venue.holder.json`, the file whichever process holds the venue folder
keeps beside `venue.lock`. It gives the holder's kind, when it took the folder, its last heartbeat,
and whether that heartbeat is stale, meaning 30 seconds or more away from the current time in
either direction. That is the parser and the limit a refused start uses (`src/node-entry.ts`). It is `null` when there is no readable file, carries no process id or host,
and never changes the status code.

`stream` is the bucket copy. It reads `{ "state": "off" }` when no bucket copy is set up on this box,
or the box is not the primary. When one is set up but did not start it reads `off` with a `reason`
(`no_membership`, `start_failed`, or `first_start_pending` while a restore's first start is
unfinished, which holds the copy) and a `stateSince`. Otherwise it is the running copy's own status:
its `state` (`opening`, `streaming`, `paused`, `refused`, or `off` with the reason it stopped),
`lagMs` (how long the oldest change not yet in the bucket has waited), `lastConfirmedUploadAt` (the
newest file seen in the bucket, by the bucket's clock) and `bucketProblem`. The name of the
generation being written is left out, because it carries the node id. `stream` never changes the
status code: the container's healthcheck reads it (`deploy/compose.yml`), and an install or update
waits for a healthy container (`deploy/waitron.sh`), so a bucket outage must not hold either. The
dashboard's alerts report the bucket copy instead.

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
- **`skipped` > 0, but `stale` may still read `false` for a while** — this database's due fiscal
  work (or, for `payments.reconcile.stripe`, one duty's sweep) could not be attempted THIS pass,
  even though the pass itself completed and the other duty was served. This does not
  clear on its own: `consecutiveFailures` increments and `lastOkAt` does not advance for as long as
  anything is skipped — see `src/health.ts`'s own comment on
  `recordPass` for why that is correct rather than an over-broad alarm. Find why
  via the `drain.tenant_skipped` / `reconcile.pair_skipped` log lines (next section); the most
  common cause is a missing, unreadable, or stale-shaped credential.
- **`parked` > 0, `payments.reconcile.stripe` only** — a Stripe reconcile run exhausted
  `WAITRON_SCHEDULER_MAX_ATTEMPTS` (default 3) and is now permanently abandoned for that (duty,
  period): nothing claims it again automatically, unlike a `skipped` pair (which retries within one
  `WAITRON_SKIP_RETRY_MS` interval, folded as a minimum against an earlier gate — see the env-var
  table above) or a `failed` one (which retries on its own backoff and does NOT flip this field —
  see `src/pass.ts`'s own comment on why). `fiscal.drain` has no equivalent terminal outcome at
  all — a halted fiscal record is a different, already-persisted signal (the `incidents` table, the
  dashboard's alerts bell and Alerts screen, and `recordsHalted`/`incidentsRaised` in `drain.complete`),
  deliberately not fed into `/health`; see
  the opening section above. Find a park via the error-level `reconcile.run_parked` log line, which
  carries the duty, period and `errorCode`.

`payments.reconcile.stripe` uses the identical `skipped`/`parked` mechanism with a 26-hour staleness
budget (a daily period plus slack) rather than drain's ~75 minutes, so the same reading applies to
it for Stripe settlement reconciliation instead of a fiscal submission.

**What to do about a `503`:** read the body first — it names which duty and how many skipped or
parked runs. Then grep stdout for that duty's own `duty.degraded` line — it names the duty, its
`consecutiveFailures`, `skipped` and `parked` counts, whether it is `stale`, and its `lastOkAt`, all
in one line, and is the fastest way to see why a duty reads unhealthy without correlating individual
skip/failure/park events yourself. For a skipped
`fiscal.drain` pass, the fix is almost always provisioning or repairing the venue's `fiscal.aeat`
credential (via `packages/credentials`'s CLI) — credentials are read fresh every pass (spec §6), so
there is no restart needed once the credential is fixed. The exception is a skip logged beside
`drain.restart_reset_failed`: the restart reset failed before any work was looked for, and the cause
is the database, not the credential. A skipped duty reports itself due
again `now + WAITRON_SKIP_RETRY_MS` (5 minutes by default, never `null`) rather than `now` — folded
as a minimum against whatever a healthy duty computed the same pass, so it can only come in
sooner, never later. That means the fix lands within one skip-retry interval, not necessarily the
very next pass as it would for a whole-duty failure below — still comfortably inside `drain`'s
hourly legal cadence, and no longer the 5-second-forever loop a missing certificate used to produce
(see `WAITRON_SKIP_RETRY_MS` in the table above). A **parked** reconcile run is different: nothing
re-attempts it on its own, ever — there is no
remediation UI or re-sweep of an abandoned period (spec §14), so a parked settlement audit needs a
human to investigate directly, via the `reconcile.run_parked` line's duty/period. If the
WHOLE pass is failing rather than one duty, restart is unlikely to help either — the process
already retries every pass on its own at `WAITRON_MIN_TICK_MS`'s fast cadence (unlike a skip, a
whole-duty throw still reports `now`), so a repeating `503` past a few cycles means the underlying
cause (usually the database or an external endpoint) needs fixing, not the process.

## Log events

One structured JSON line per event on stdout, `{ ...fields, at, level, event }` (`src/logger.ts`).
The ones worth grepping for:

- **`drain.tenant_skipped`** (`warn`) — `{ errorCode }`. The pass had due fiscal work and could not
  submit any of it — unless `drain.restart_reset_failed` is also logged, in which case the restart
  reset failed before any work was looked for, and the cause is the database, not the credential.
  There is at most one of these per pass: one database files for one taxpayer. This line is the
  ONLY place this fact exists outside `/health`'s `skipped` count — a skipped drain has no ledger
  row (`drain` has no table of its own) and no incident (`incidents.till_id` is `NOT NULL`, and a
  drain has no till). `errorCode` is typically `server.credential_unusable` (a `fiscal.aeat`
  credential exists but a declared field — most often `certKind`, absent from a row sealed before
  that field joined the purpose registry — is missing or unusable) or a credential-store code from
  `getCredential` (`credentials.missing` — no row for that purpose at all,
  `credentials.decrypt_failed`, `credentials.key_version_unknown`, `credentials.malformed_payload`).
  The event NAME still reads `tenant`, and stays that way: a log event is a name operators grep
  for, so it is renamed deliberately or not at all.
- **`drain.restart_reset_failed`** (`error`) — `{ errorCode }`. Before this process's first drain,
  the reset that returns a previous run's in-flight submissions to the queue failed
  (`src/restart-reset.ts`), so no drain ran. Logged once per failed attempt; each pass that waited
  on it also logs `drain.tenant_skipped` with the same `errorCode` (`unknown` for a raw database
  error), and the next pass tries the reset again.
- **`reconcile.pair_skipped`** (`warn`) — `{ duty, errorCode }`. The Stripe reconcile
  equivalent, one duty abandoned mid-sweep — an infrastructure failure, a credential
  code as above, or `payment.credential_environment_mismatch` (the `payments.stripe` key's
  `sk_live_`/`sk_test_` prefix disagrees with this host's `WAITRON_ENV`).
- **`reconcile.run_failed`** (`warn`) — `{ duty, period, errorCode }`. One claimed
  reconcile run failed this attempt but is still retrying on its own backoff — a `next_attempt_at`
  exists. Never flips `/health`; see the `skipped`/`parked` bullets above.
- **`reconcile.run_parked`** (`error`) — `{ duty, period, errorCode }`. One claimed
  reconcile run exhausted `WAITRON_SCHEDULER_MAX_ATTEMPTS` and is now abandoned for that
  (duty, period) permanently — nothing will claim it again. This is what `/health`'s
  `parked` count (above) is counting.
- **`duty.failed`** (`error`) — `{ duty, errorCode }`. The WHOLE duty threw for this pass (not a
  contained skip) — `fiscal.drain` or `payments.reconcile.stripe` itself.
- **`duty.degraded`** (`error` when the duty is stale, `warn` otherwise) —
  `{ duty, consecutiveFailures, skipped, parked, stale, lastOkAt }`. One line per DEGRADED duty,
  per pass —
  `ok: false`, or `ok: true` with `skipped > 0` or `parked > 0`: the same condition, computed once in
  `health.ts`'s `recordPass`, that decides whether `/health` reads unhealthy for that duty, so this
  line and a `503` can never disagree about what "degraded" means. The level comes from `stale`, not
  from `consecutiveFailures` — `stale` is already the exact criterion `/health`'s `200`/`503` verdict
  uses (a count means a different amount of elapsed time at a different `WAITRON_SKIP_RETRY_MS`), so
  an `error` line and a `503` are the same condition by construction, and a duty that fails on the
  first pass after boot logs `error` immediately (`lastOkAt === null` reads as stale). This is the
  single fastest line to grep for a degraded duty — see ["What to do about a `503`"](#what-health-means)
  above.
- **`drain.complete`** (`info`) — per-pass summary counters for `fiscal.drain`, including `skipped`
  (a count, matching the body above) and the duty's own `nextDueAt`.
- **`reconcile.complete`** (`info`) — the reconcile equivalent. `ran` is broken down by outcome —
  `{ succeeded, failed, parked }` — rather than a bare total, plus `deferred`, `beyondHorizon`,
  `skipped` (matching the body above) and the duty's own `nextDueAt`.
- **`resolve_pending.failed`** (`warn`) — `{ error }`. This node's per-tick card `resolvePending`
  sweep threw. The sweep is deliberately NOT health-tracked (`withPendingSweep`, `src/boot.ts`), so
  this line is the SOLE operator signal of a stuck card sweep — grep it. A card-settlement backstop,
  not a fiscal-legal or process-liveness signal; it does not flip `/health`.
- **`resolve_pending.complete`** (`info`) — `{ captured, failed, incidentsRaised, nextDueAt }`. The
  per-tick summary of this node's card sweep: rows it captured, rows it resolved `failed`, and any
  `payment.pending_outcome_unactionable` incidents raised for a human.
- **`payment_attempt.released`** (`info`) — `{ released }`. After a pass, the loop cleared the "a
  card is paying this order" mark on that many open orders: each one's card attempt is not running
  in this process, and the order has no payment still `attempting`, nor a `captured` or
  `accepted_offline` one no sale records (`releaseStalePaymentAttempts`, `src/till-sale.ts`, run by
  `withStalePaymentRelease`, `src/boot.ts`). The loop's first pass runs at start, before any sleep;
  after that, the sleep between passes is at most `WAITRON_MAX_TICK_MS`. Until its mark is cleared,
  the till refuses changes to that order with `order.payment_in_flight`.
- **`payment_attempt.release_failed`** (`warn`) — `{ error }`, plus `workingOrderId` when it is the
  clear that follows a card attempt which filed nothing (`releasePaymentAttempt`,
  `src/till-sale.ts`). That clear threw; the till still gets the attempt's own outcome, and the
  loop's next release tries again. It does not flip `/health`.
- **`transport.close_failed`** (`warn`) — `{ errorCode, message }`. An mTLS
  `Agent` failed to close gracefully at the end of a pass (`aeatClientResolver`'s `closeAll`,
  `packages/fiscal-verifactu/src/aeat-transport.ts`). `message` is the raw `Error#message` — safe to log here, unlike
  `server.shutdown_failed`, which reports only a structured code for the value it caught, because
  `Agent.close()` can only ever throw a socket-layer error, never one carrying a secret. Any other
  `Agent` the pass opened is still released concurrently, regardless of this one failing — it does not stop the
  sweep, does not stop the pass, and does not flip `/health`.
- **`pass.complete`** (`info`) — one line per pass: both duties' `ok`/`errorCode`/`durationMs` (the
  per-duty elapsed time, from an injected monotonic clock), the pass's OWN `durationMs` (the whole
  pass, both duties included), and the folded `nextDueAt` the loop is about to sleep on.
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
- **`server.listening`** (`info`) — `{ port, environment }`, logged once the HTTP listener has
  actually bound (not merely been asked to).
- **`server.listen_failed`** (`error`) — `{ port, code }`. The listener failed to bind — `EADDRINUSE`
  (the port is already taken — the common case for a fixed default port) or `EACCES` (a privileged
  port, no permission) are the usual `code` values. The process exits `1` immediately after this
  line; nothing retries a bind failure in the background.
- **`server.stopped`** / **`loop.stopped`** (`info`) — graceful shutdown completed (SIGTERM/SIGINT).

Never prose, and never a secret: every credential-adjacent error reports a structured code and — at
most — a purpose and a field NAME, never decrypted material, a Stripe secret, or a PFX passphrase.

## Migrations

Applied at boot, every time, behind the venue directory's own `migrations.lock` file
(`@waitron/migrations`'s `apply.ts`) so two migrators starting together cannot race the same
journal. Only the migrate step waits on it; a second process opening the folder WITH the lock is
refused `provisioning.database_in_use` by `venue.lock`, while the tools meant to run beside the
server open it without the lock ([conventions-data.md](../../docs/developers/conventions-data.md), "One process per venue folder"). Drizzle's runner is journal-tracked and idempotent, so this is a no-op against a current
database — the cost is opening the files and reading each journal, not any actual DDL. A migration
failure is a boot failure: the process logs and exits non-zero rather than starting half-migrated.
Each set's append-only triggers are installed in the same run; see
["The venue directory"](#the-venue-directory) above.

## Build

`pnpm --filter @waitron/server build` runs `scripts/copy-migrations.mjs` (copies every migration
package's `drizzle/` folder to `dist/drizzle/<set-name>`, reading the same
`migrations.manifest.json` `@waitron/migrations` itself reads, so the two cannot name different sets)
and then bundles `src/bin.ts` to `dist/server.js` with esbuild. Run the bundle directly:
`node dist/server.js`.

`scripts/copy-migrations.mjs` also writes `dist/package.json` (`{"type":"module"}`), so `dist/` is
portable as a directory on its own — copied into a Docker image with nothing else from this
package, say — with one exception: sharp is left out of the bundle and must be installed beside it
(`deploy/Dockerfile` puts it in `/app/node_modules`); it is loaded only when a photo is first
prepared. `dist/server.js` is ESM (esbuild's `--format=esm`), and a bare `.js` file's module
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
touches `package.json`'s `waitron.commands` entry, the CI gate's smoke-test paths, and this README's own
`node dist/server.js` examples, for no behavioural difference once `dist/package.json` exists.
