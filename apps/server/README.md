# `@waitron/server`

The host process. It boots from environment config, loads the credential vault's key ring, applies
every migration set behind an advisory lock, resolves per-tenant AEAT transports and Stripe
accounts, then runs a loop: `drain` (the fiscal submission duty), the Stripe payments reconcile,
fold the result into a sleep duration, repeat. It also serves several HTTP routes on one Hono app:
`GET /health` (unauthenticated), the till API under `/api/*`, the management-dashboard API under
`/management-api/*`, and the inbound Stripe payments webhook at `POST /webhooks/stripe/:tenantId`.

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
fails loudly at boot with `migrations.set_missing`, not silently.

Every boot failure exits non-zero, but not all of them reach stdout the same way. A port that will
not bind logs a structured `server.listen_failed` JSON line (see ["Log events"](#log-events)) and
exits `1` directly. Bad config, an unloadable key ring, a mismatched deployment environment (see below), a
failed migration, and an unreachable database instead **throw**, and `bin.ts` has no `try`/`catch` around `startServer` — Node prints the
`AppError`'s stack to **stderr** as an unhandled rejection and exits non-zero, not as a JSON line on
the stdout stream a log collector reads. (Catching those five in `bin.ts` and logging them
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
first statement even though every migration is a no-op. Against an **empty** database, the core baseline also creates
`app_user NOLOGIN`, which needs `CREATEROLE`. Keep these schema-changing privileges on your
migration connection and use `app_user` membership for the day-to-day pool.

### `DATABASE_URL` — the deployment role, always

Make this login a member of `app_user`, the NOLOGIN role that receives the migrations' table
grants — and nothing more: `app_user` cannot update or delete a fiscal record, a sale or a tender,
because the grants and triggers say so and `privileges.test.ts` pins it. The application login
inherits those grants:

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
-- SELECT on every table includes the migration journals: this role did not create them
-- (whoever originally bootstrapped the database did), so it does not own them and cannot read them
-- back without an explicit grant — and reading them back is how Drizzle decides nothing new needs
-- applying.
grant select on all tables in schema public to waitron_migrator;
```

`in role app_user` here is only required if this same role is ALSO `DATABASE_URL` (the unset-override
default); a migrations-only role that never runs a duty pass does not need it.

### `WAITRON_MIGRATIONS_DATABASE_URL` — against an empty database (first boot ever)

Use [`waitron-provision instance`](../../packages/provisioning/README.md) to bootstrap the
database. It creates the database, applies the full migration manifest as the admin, then creates
exactly two logins: `waitron_migrator` and `waitron_app`. Both join `app_user`; only the migrator
gets `CREATEROLE`, database CREATE and schema CREATE WITH GRANT OPTION. It writes the deployment
stamp and prints each newly created login's connection string once. Keep those strings: a rerun
preserves existing passwords and cannot print them again.

The admin that ran `instance` owns the migrated objects. The generated migrator login's CREATE
grants do not make it their owner or give it journal SELECT. Use the original owner connection for
later schema changes. If you use the generated login only to check an already-current database,
the SELECT grant in the preceding recipe supplies the journal reads; that recipe does not authorize
future changes to existing tables.

`packages/provisioning/src/instance-apply.pg.test.ts` checks the bootstrap against a real Postgres
container. Its first test reads `current_user = prov_admin` and `rolsuper = false`; setup creates
that login with `CREATEDB` and `CREATEROLE`. The next test runs the full plan through that admin's
connection string and checks the database exists, every listed manifest journal is present, the
stamp is `preproduction`, and the role keys are exactly `waitron_app` and `waitron_migrator`.
It checks CREATEROLE is true for the migrator and false for the app, and that the app's direct
membership is exactly `["app_user"]`. It checks the migrator's effective database/schema CREATE
and reads its schema ACL entry directly for `C*`, the grant-option marker.

That test then checks a second plan has no role creation or stamp, still includes migration, and
applies it without throwing. It does not count newly applied migrations. The separate
`packages/migrations/src/apply.concurrency.test.ts` checks that a repeated migration leaves one
journal's row count unchanged. Neither receipt means a rerun is privilege-free: Drizzle still
issues its schema/table setup statements before reading each journal.

Read direct grants from the ACL, as the provisioning test does. Effective privilege checks also
count inherited grants, so they cannot tell you whether the specific direct grant you issued took
effect. The provisioning suite tests membership repair and delegated grants separately. Its
bootstrap test checks the role/grant shape; the server's `boot.test.ts` exercises the running host.

For a manual first boot, create a separate migration login and grant it CREATE on the target
database and schema from the database owner:

```sql
create role waitron_migrator login password '<secret>' createrole;
grant create on database <dbname> to waitron_migrator;
grant create on schema public to waitron_migrator with grant option;
```

The grant option matches the tool's current grant shape. No baseline currently re-grants schema
CREATE; its necessity has not been established. It remains a candidate for removal after a
separate privilege review. `CREATEROLE` permits creation of `app_user` on an empty cluster.
After the migrations create `app_user`, create the application login with the membership shown
above. Business rows are a separate step: `waitron-provision venue` creates the tenant, location,
till, node, invoice series and composed module seeds. The retired `bootstrap-tenant.sql` script is
not a fallback for that flow.

**Keep the same owner for later migrations.** If the manual migration login creates the tables
and journals, retaining that connection preserves the ownership needed to modify them. Switching
to a different login requires a separate review of object ownership and grants; the
already-migrated recipe only covers a rerun with no pending migration. Database ownership itself
does not imply the `CREATEROLE` attribute, so check the actual login before the first migration.

### The deployment-environment check needs no grant beyond the above

Before `applyMigrations` runs, `startServer` opens a short-lived connection over
`WAITRON_MIGRATIONS_DATABASE_URL` and compares this host's `WAITRON_ENV` against the `deployment`
table's own stamp, throwing `deployment.environment_mismatch` (see "Running it" above) rather than
letting a host boot against another environment's database. This needs nothing beyond what the
already-migrated grants above already give `waitron_migrator`: `to_regclass` (checking whether
`deployment` exists at all) needs no object privilege, and reading the row once the table exists is
covered by the blanket `grant select on all tables in schema public` — there is no separate grant to
add for this table.

**What actually writes the stamp.** `waitron-provision instance` does, as the last action of its
plan: it calls the programmatic `stampDeployment` (`@waitron/db`).
`packages/provisioning/src/instance-apply.pg.test.ts` asserts the stamp is present after a real run
against a container, so this is an automated provisioning path that runs it against a real database.
Nothing else writes it in an automated path — in particular `waitron-provision venue` **refuses** a
database that carries no stamp (`provisioning.database_unstamped`) rather than stamping one itself,
because stamping is `instance`'s job and one database per environment is a fiscal invariant. (The
retired `apps/server/sql/bootstrap-tenant.sql` used to write the stamp too, via an
`insert into deployment (id, environment) values (1, :'environment') on conflict (id) do nothing`; it
was removed on 2026-08-04.)

Concretely, a database is stamped if and only if someone ran `waitron-provision instance` (or called
`stampDeployment` by hand). Every database that predates this feature, and every database provisioned
without doing so — including any set up before this note was written — has never been stamped: it
reads `deployment` as `null` and **boots normally, with this check inert**, exactly as if the check
did not exist. Only a database stamped for the OTHER environment refuses.

## Provisioning a venue

`waitron-provision venue` creates the business rows a sellable venue needs — a tenant, a location, a
till, a node, and a standard plus a rectificative invoice series — and runs every enabled module's
seed for that node, the fiscal one registering it as a Veri\*Factu SIF, in one transaction. It replaced the retired `apps/server/sql/bootstrap-tenant.sql` (see "What actually
writes the stamp" above for why that file was removed).

It runs **against a database `instance` has already migrated and stamped**. A venue cannot be filed
against an unstamped database — it is refused with `provisioning.database_unstamped`, because one
database per environment is a fiscal invariant and stamping is `instance`'s job. It connects to that
target database as the **owner-admin** (the role that created the tables when it ran `instance`) over
`WAITRON_ADMIN_DATABASE_URL`, the same admin connection string `instance` reads; there is no separate
role and no grant to widen: `applyVenue` inserts as the table owner in one transaction, with
explicit tenant ids.

```bash
pnpm --filter @waitron/provisioning build   # once — produces dist/bin.js and copies the migrations
WAITRON_ADMIN_DATABASE_URL=postgres://owner_admin:secret@host:5432/waitron \
WAITRON_ADMIN_PIN=1234 \
WAITRON_ADMIN_PASSWORD='choose-a-strong-one' \
  node packages/provisioning/dist/bin.js venue \
    --database waitron \
    --country ES --tax-id B12345678 --legal-name 'Deli SL' \
    --location-name Mostrador --territory ES-common --locale es-ES \
    --operation-description 'Venta en establecimiento' \
    --address-line1 'Calle Mayor 1' --postal-code 28001 --city Madrid --province Madrid \
    --time-zone Europe/Madrid --day-cutover 06:00 \
    --till-name 'Caja 1' --series-code A --rectificative-code R \
    --admin-name 'Owner' \
    --yes
```

The command seeds the venue's first **admin** person. `--admin-name` is the display name (not a secret,
so it stays a flag), while the admin's two login secrets are read only from the environment or an
echo-off prompt, never from `argv`: `WAITRON_ADMIN_PIN` (the till PIN) and `WAITRON_ADMIN_PASSWORD` (the
dashboard password, ≥8 characters), both required.

**Whether this admin can sign in to the dashboard depends on how it was seeded.** Dashboard
(management) login is **email + password** — the login screen POSTs an `{ email }`, and `loginManager`
resolves the person by email. Onboarding via the **setup UI** (`apps/setup` → `setup-api.ts`) captures
the admin email as a **required** field and threads it into `seed-admin`, whose insert now names
`email` (`packages/provisioning/src/venue-apply.ts`), so an **onboarding-provisioned admin signs in to
the dashboard immediately**. The bare `venue` CLI shown above has no `--admin-email` flag, so it seeds
the admin **emailless** — `email` is OPTIONAL in provisioning (`email ?? null`) — and such an admin has
no email sign-in path until an email is set for it out-of-band (`setEmail` requires an
already-authenticated management session). Today only the demo bootstrap
(`apps/server/scripts/dev-setup.ts`, via `seedStaff`) does that, giving its admin
`owner@demo.waitron.local`. Independent of the email, the provisioned **password** is still exercised:
it is what the C2b mirror-bundle adoption route authenticates **by id** (via `loginManagerById`, a
server-to-server flow carrying the admin's id, not the email form) and what `venue-apply.e2e.test.ts`
authenticates by id.

Every option is prompted for when omitted, so a bare `venue` is a complete interactive session;
`--yes` skips the confirmation for a non-interactive run. `--territory` currently accepts only
`ES-common` (common-territory Spain, filing under Veri\*Factu with IVA); any other territory is
refused with `fiscal.regime_not_implemented`. The SIF's `id_sistema_informatico` is **not** an
option — it is the `WAITRON_ID_SISTEMA` product constant (`W1`), because it identifies Waitron's
software, not the venue. The admin connection string is read only from `WAITRON_ADMIN_DATABASE_URL`
or an echo-off prompt, never from `argv`, so it stays out of `ps` and shell history. See
[`packages/provisioning/README.md`](../../packages/provisioning/README.md) for the full option list,
what the command prints, and what it refuses.

## Environment variables

| Variable                                   | Required | Default                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | yes      | —                                          | The deployment role's pool. See grants above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `WAITRON_MIGRATIONS_DATABASE_URL`          | no       | `DATABASE_URL`                             | The connection migrations run over. See grants above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WAITRON_CREDENTIALS_KEY`                  | yes      | —                                          | Base64, 32 bytes. Owned by `loadKeyRing` (`packages/credentials`) — see below, not redeclared here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `WAITRON_CREDENTIALS_KEY_VERSION`          | no       | `1`                                        | Integer ≥ 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS`         | no       | —                                          | Base64, 32 bytes. Set only during a key rotation window; must be set together with the next variable, never alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION` | no       | —                                          | Integer ≥ 1, and different from `WAITRON_CREDENTIALS_KEY_VERSION`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_ENV`                              | no       | `preproduction`                            | `preproduction` \| `production`. **One setting for the whole deployment, not one per provider** — it selects both the AEAT endpoint family `aeatEndpointFor` resolves to and the Stripe key mode (`sk_live_` vs `sk_test_`) a tenant's `payments.stripe` credential must match (a mismatch there is a per-tenant `payment.credential_environment_mismatch`, not a boot failure — see ["Log events"](#log-events)). Also checked against the database itself at boot, before any migration runs — see "Database roles and grants" above. **Production numbering can never be reused, even for a test invoice — this default is deliberately the safe one, and production must be typed out.** **Rollback warning:** `deploymentEnvironment` reads ONLY this variable — the pre-branch code read ONLY `WAITRON_AEAT_ENV`, and both default to `preproduction`. During any window in which a rollback to a pre-`WAITRON_ENV` build remains possible, keep `WAITRON_AEAT_ENV` set to the SAME value as `WAITRON_ENV`. Left unset while only `WAITRON_ENV=production` is configured, a rolled-back host silently resolves `preproduction`, submits this deployment's `production`-generated fiscal records to AEAT's PRE-PRODUCTION endpoint, and AEAT accepts them there — written terminal `aceptado`, never retried, while the real AEAT never receives them and those invoice numbers are permanently spent. This is a deploy-config safeguard for the rollback window only, not a code change: the resolver must NOT fall back to `WAITRON_AEAT_ENV`, or the two-variables-that-must-agree problem this branch exists to remove would simply come back.                                                                         |
| `WAITRON_HTTP_PORT`                        | no       | `8080`                                     | Positive integer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `WAITRON_HTTP_HOST`                        | no       | `127.0.0.1`                                | `/health` is unauthenticated (see below) — loopback by default so it is not reachable off the host unless you deliberately widen it (e.g. `0.0.0.0` behind your own network boundary).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `WAITRON_MIN_TICK_MS`                      | no       | `5000` (5s)                                | Floor on the sleep between passes — stops a hot loop when a duty reports work due `now`. **Must not exceed `WAITRON_SKIP_RETRY_MS`** — raising this past that value fails boot the other way round; see that row's own constraint below before widening this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `WAITRON_MAX_TICK_MS`                      | no       | `3600000` (1h)                             | Ceiling on the sleep between passes — a **liveness floor** for `drain`'s hourly duty, not a performance knob. `fiscal.drain`'s staleness budget (`DUTY_BUDGET_MS`, `src/health.ts`) is a fixed 75 minutes (the DEFAULT ceiling plus 15 minutes' slack) regardless of this value, so raising this narrows that margin — and **`boot.ts` refuses to start at or past 75 minutes**, rather than merely eliminating the margin: a structured `server.config_invalid` with `reason: "at_or_above_drain_budget"`, before any infrastructure is touched. This is enforced, not advisory — grep the reason code above if you hit it. See `health.ts`'s own comment before setting this above roughly an hour. **Must be `>= WAITRON_SKIP_RETRY_MS`** — lowering this past that value fails boot the other way round, `reason: "above_max_tick"` (the SAME reason code the `WAITRON_MIN_TICK_MS > WAITRON_MAX_TICK_MS` guard above uses, not a near-synonym); see `WAITRON_SKIP_RETRY_MS`'s own row below before narrowing this one. Not a cosmetic pairing: setting ONLY this variable to something below `WAITRON_SKIP_RETRY_MS`'s default — `5000`, say — used to boot clean and then silently clamp the skip-retry interval back down toward the 5-second floor at runtime (`sleepMsFor`, `src/loop.ts`), restoring the exact spin this whole design exists to remove with no error anywhere. See `docs/superpowers/specs/2026-07-27-degraded-pass-design.md` §2.3's final amendment for the full arithmetic.                                                                                                                                                                                                                        |
| `WAITRON_SKIP_RETRY_MS`                    | no       | `300000` (5m)                              | How long after a **skipped** tenant (`fiscal.drain`) or (tenant, duty) pair (`payments.reconcile.stripe`) either duty reports work due again. One value for both duties, sourced from `@waitron/scheduler`'s own `DEFAULTS.skipRetryMs`. Folded as a _minimum_ against whatever a successful tenant or pair computed this same pass, so a healthy tenant's earlier gate still wins — this can only pull the reported instant earlier, never later. Before this existed, a skip reported work due `now`, which `WAITRON_MIN_TICK_MS` turned into a 5-second retry **forever** for a tenant whose certificate only a human can provision — ~86,400 log lines a day (five per pass, 17,280 passes a day at the old floor) for a wait no retry could shorten, and the expected state of the first deployment, not a corner case. **Must be `>= WAITRON_MIN_TICK_MS` and `<= WAITRON_MAX_TICK_MS`** — `loadConfig` (`src/config.ts`) refuses to boot below the floor or above the ceiling, rather than letting `sleepMsFor`'s clamp (`src/loop.ts`) silently round it back to (or past) either bound — which would reproduce the exact 5-second-forever spin described above with no error anywhere, from the ceiling side just as much as the floor side; the two guards are symmetric. A structured `server.config_invalid` with `reason: "below_min_tick"` (below the floor) or `reason: "above_max_tick"` (above the ceiling — the same reason string the `WAITRON_MIN_TICK_MS > WAITRON_MAX_TICK_MS` guard uses) — grep either reason code if you hit it; both name the OTHER variable and its effective value too, so the error is actionable whichever of the pair you actually set. Equal to either bound is fine and boots. |
| `WAITRON_SETTLEMENT_LAG_MS`                | no       | unset (the reconciler's own 7-day default) | Passed to `StripeReconcilerOptions.settlementLagMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WAITRON_MIGRATIONS_DIR`                   | no       | `<bundle dir>/drizzle`                     | Where migration SQL is read from. The default only exists in a built artefact (`scripts/copy-migrations.mjs` puts it there); running from source needs this set, or `migrations.set_missing` fails loud.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `WAITRON_SCHEDULER_HORIZON_DAYS`           | no       | `30`                                       | `SchedulerDeps.horizonDays`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK`   | no       | `7`                                        | `SchedulerDeps.maxPeriodsPerTick`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WAITRON_SCHEDULER_MAX_ATTEMPTS`           | no       | `3`                                        | `SchedulerDeps.maxAttempts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `WAITRON_SCHEDULER_BACKOFF_BASE_MS`        | no       | `900000` (15m)                             | `SchedulerDeps.backoffBaseMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `WAITRON_SCHEDULER_STALE_AFTER_MS`         | no       | `3600000` (1h)                             | `SchedulerDeps.staleAfterMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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

`GET /health` is unauthenticated — no metrics, no auth, no readiness/liveness split (spec §9). It is
one of several routes the process serves (the till API under `/api/*`, the management-dashboard API
under `/management-api/*`, and the Stripe webhook at `POST /webhooks/stripe/:tenantId` share the same
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
  period): nothing claims it again automatically, unlike a `skipped` pair (which retries within one
  `WAITRON_SKIP_RETRY_MS` interval, folded as a minimum against an earlier gate — see the env-var
  table above) or a `failed` one (which retries on its own backoff and does NOT flip this field —
  see `src/pass.ts`'s own comment on why). `fiscal.drain` has no equivalent terminal outcome at
  all — a halted fiscal record is a different, already-persisted signal (the `incidents` table, and
  `recordsHalted`/`incidentsRaised` in `drain.complete`), deliberately not fed into `/health`; see
  the opening section above. Find a park via the error-level `reconcile.run_parked` log line, which
  carries the tenant, duty, period and `errorCode`.

`payments.reconcile.stripe` uses the identical `skipped`/`parked` mechanism with a 26-hour staleness
budget (a daily period plus slack) rather than drain's ~75 minutes, so the same reading applies to
it for Stripe settlement reconciliation instead of a fiscal submission.

**What to do about a `503`:** read the body first — it names which duty and how many tenants or
runs. Then grep stdout for that duty's own `duty.degraded` line — it names the duty, its
`consecutiveFailures`, `skipped` and `parked` counts, whether it is `stale`, and its `lastOkAt`, all
in one line, and is the fastest way to see why a duty reads unhealthy without correlating individual
skip/failure/park events yourself. For a skipped
`fiscal.drain` tenant, the fix is almost always provisioning or repairing that tenant's `fiscal.aeat`
credential (via `packages/credentials`'s CLI) — credentials are read fresh every pass (spec §6), so
there is no restart needed once the credential is fixed. A skipped tenant reports its own duty due
again `now + WAITRON_SKIP_RETRY_MS` (5 minutes by default, never `null`) rather than `now` — folded
as a minimum against whatever a healthy tenant computed the same pass, so it can only come in
sooner, never later. That means the fix lands within one skip-retry interval, not necessarily the
very next pass as it would for a whole-duty failure below — still comfortably inside `drain`'s
hourly legal cadence, and no longer the 5-second-forever loop a missing certificate used to produce
(see `WAITRON_SKIP_RETRY_MS` in the table above). A **parked** reconcile run is different: nothing
re-attempts it on its own, ever — there is no
remediation UI or re-sweep of an abandoned period (spec §14), so a parked settlement audit needs a
human to investigate directly, via the `reconcile.run_parked` line's tenant/duty/period. If the
WHOLE pass is failing rather than one tenant, restart is unlikely to help either — the process
already retries every pass on its own at `WAITRON_MIN_TICK_MS`'s fast cadence (unlike a skip, a
whole-duty throw still reports `now`), so a repeating `503` past a few cycles means the underlying
cause (usually the database or an external endpoint) needs fixing, not the process.

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
  equivalent, one (tenant, duty) pair abandoned mid-sweep — an infrastructure failure, a credential
  code as above, or `payment.credential_environment_mismatch` (this tenant's `payments.stripe` key's
  `sk_live_`/`sk_test_` prefix disagrees with this host's `WAITRON_ENV`).
- **`reconcile.run_failed`** (`warn`) — `{ tenantId, duty, period, errorCode }`. One claimed
  reconcile run failed this attempt but is still retrying on its own backoff — a `next_attempt_at`
  exists. Never flips `/health`; see the `skipped`/`parked` bullets above.
- **`reconcile.run_parked`** (`error`) — `{ tenantId, duty, period, errorCode }`. One claimed
  reconcile run exhausted `WAITRON_SCHEDULER_MAX_ATTEMPTS` and is now abandoned for that
  (tenant, duty, period) permanently — nothing will claim it again. This is what `/health`'s
  `parked` count (above) is counting.
- **`duty.failed`** (`error`) — `{ duty, errorCode }`. The WHOLE duty threw for this pass (not a
  per-tenant skip) — `fiscal.drain` or `payments.reconcile.stripe` itself, not a tenant within it.
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
- **`transport.close_failed`** (`warn`) — `{ tenantId, errorCode, message }`. One tenant's mTLS
  `Agent` failed to close gracefully at the end of a pass (`aeatClientResolver`'s `closeAll`,
  `src/aeat-transport.ts`). `message` is the raw `Error#message` — safe to log here, unlike
  `server.shutdown_failed`'s `pg`-driver errors, because `Agent.close()` can only ever throw a
  socket-layer error, never one carrying a connection string or other secret. Every other tenant's
  `Agent` is still released concurrently, regardless of this one failing — it does not stop the
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
most — a tenant id and a field NAME, never decrypted material, a Stripe secret, or a PFX passphrase.

## Migrations

Applied at boot, every time, behind a Postgres advisory lock (`MIGRATION_LOCK_KEY` in
`@waitron/migrations`'s `apply.ts`) so two replicas starting together cannot race the same journal.
Drizzle's runner is journal-tracked and idempotent, so this is a no-op against a current database —
the cost is the privilege check described above, not any actual DDL. A migration failure is a boot
failure: the process logs and exits non-zero rather than starting half-migrated.

## Build

`pnpm --filter @waitron/server build` runs `scripts/copy-migrations.mjs` (copies every migration
package's `drizzle/` folder to `dist/drizzle/<set-name>`, reading the same
`migrations.manifest.json` `@waitron/migrations` itself reads, so the two cannot name different sets)
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
