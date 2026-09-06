# `@waitron/provisioning`

Stands up a Waitron deployment: one bin, `waitron-provision`, matching how `@waitron/credentials`
ships `waitron-credentials`.

Design: [`docs/superpowers/specs/2026-07-29-provisioning-tool-design.md`](../../docs/superpowers/specs/2026-07-29-provisioning-tool-design.md).
This document is the operational half of that spec — written for whoever runs the tool, not whoever
reads its source.

**The thing to know before anything else:** `instance` **generates** the two logins' passwords and
prints each one **once**, in a connection string, at the end of the run. Nothing stores them. This
deliberately corrects the design spec's §5, which says `instance` "involve[s] no secrets at all" —
not achievable, because a LOGIN role needs a password. The spirit of §5 is kept and is the actual
rule here: **secrets are OUTPUT, never input, and never in `argv`.**

## Building and running it

```bash
pnpm --filter @waitron/provisioning build   # copies the migrations, then bundles src/bin.ts
node packages/provisioning/dist/bin.js <command>
```

The build does two things, and both are needed. `esbuild` produces `dist/bin.js`, and
`scripts/copy-migrations.mjs` copies every package's `drizzle/` folder to `dist/drizzle` — which is
where the bundle looks, because esbuild collapses every module's `import.meta.url` onto the bundle's
own location. Running `dist/bin.js` without that copy step does not fail silently: `instance` throws
`migrations.set_missing` naming the folder it looked in.

Running from source (`vitest`, `tsx`) needs no copy step — `bin.ts` detects that `dist/drizzle` is
absent and lets `@waitron/migrations` resolve each set from `packages/migrations` instead.

## The four commands

| Command    | What it needs                                              | How often           |
| ---------- | ---------------------------------------------------------- | ------------------- |
| `keyring`  | nothing at all — no database, no connection string         | once per deployment |
| `instance` | an admin connection with `CREATEDB` and `CREATEROLE`       | once per deployment |
| `status`   | the same admin connection; reads only                      | any time            |
| `venue`    | the owner-admin connection to a stamped, migrated database | once per venue      |

`venue` creates a tenant, a location, a till, a node and its standard and rectificative invoice
series, then runs each composed module's provisioning seed (the fiscal module's registers the node as
a SIF and starts its chain) — replacing the retired `apps/server/sql/bootstrap-tenant.sql` (removed
2026-08-04, spec [`2026-08-04-locations-provisioning-design.md`](../../docs/superpowers/specs/2026-08-04-locations-provisioning-design.md)).
`register-till` (`apps/server`) remains the standalone path for an EXISTING node: it runs the same
module seeds against one node — a reimaged node getting a fresh chain, or a node that otherwise has no
fiscal identity.

```text
usage: waitron-provision <command> [options]

  keyring                                            generate the credential key ring
  instance [--database <name>] [--environment <env>] [--yes]
  status   [--database <name>]
  venue    [--database <name>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]
           [--location-name <name>] [--territory <t>] [--locale <l>]...
           [--operation-description <text>] [--address-line1 <text>] [--address-line2 <text>]
           [--postal-code <code>] [--city <name>] [--province <name>] [--time-zone <tz>]
           [--day-cutover <HH:MM>] [--till-name <name>] [--series-code <code>]
           [--rectificative-code <code>] [--admin-name <name>] [--yes]
```

Every option is prompted for when omitted, so a bare `waitron-provision instance` is a complete
interactive session.

### `keyring`

Generates the credential key ring `@waitron/credentials` seals every tenant credential under, prints
`WAITRON_CREDENTIALS_KEY` and `WAITRON_CREDENTIALS_KEY_VERSION` **once**, waits for an
acknowledgement, then clears the screen and the scrollback.

There is no way to recover this key. Losing it means re-sealing every certificate and every Stripe
key by hand — which for the fiscal certificate means obtaining it again.

Clearing the scrollback is a real improvement and **not** a guarantee, and the tool says so on
screen rather than implying the key is gone: a terminal configured to log its sessions to disk, or
tmux's own buffer under some configurations, still has it.

### `instance`

Takes a cluster to a migrated, stamped, granted database with the two logins the host and this tool
need:

| Role               | What it is for                                                      |
| ------------------ | ------------------------------------------------------------------- |
| `waitron_migrator` | `WAITRON_MIGRATIONS_DATABASE_URL` — runs the migrations             |
| `waitron_app`      | `DATABASE_URL` — the least-privilege role every duty pass runs over |

It reads what already exists, prints the plan — headed by `Cluster: <user>@<host>:<port>`, so the
operator confirming it can see which cluster is about to be written to — asks for confirmation
(`--yes` skips that), applies, then prints the roles.

**What it prints once.** One connection string per role **it created on this run**, then the same
"stored nowhere, cannot be recovered" framing and screen clear `keyring` uses. A role that **already
existed** gets a line saying so and **no connection string** — this tool did not generate that
role's password, cannot read one back out of `pg_authid`, and a connection string with a wrong
password is worse than none, because it looks usable and fails at the host's first connect.

**Idempotency.** Running it twice is safe. The second run creates nothing; it re-runs the migrator
and re-issues the two grants — the plan is never empty, because all three are emitted
unconditionally rather than diffed, and `src/instance-plan.ts` gives a separate reason for each.
(For `migrate`: journal-table existence is not "the set finished". For the grants:
`information_schema.role_table_grants` does not cover database- or schema-level `CREATE` at all.)
Re-running the migrator applies nothing when nothing is pending, but it is **not privilege-free** —
see wall 4 under "When the admin did not create the database" for what it costs an admin that lacks
`CREATE` on the database.

#### `instance` is a schema-changing command against a LIVE deployment

This is new, and it is the operational consequence of the paragraph above. Read it before pointing
`instance` at a database a shop is trading on.

The planner emits `migrate` on every run. A journal table can survive a rolled-back migration,
so its existence does not establish that a set finished. `src/instance-apply.pg.test.ts` leaves
the last set's journal present and its schema absent, then runs the plan and checks that the
schema was created.

**The SQL it applies is the BUNDLE's own, not the deployed host's.** `scripts/copy-migrations.mjs`
copies every package's `drizzle/` folder into `dist/drizzle` when **this** package is built, and
`src/bin.ts` picks that folder as `migrationsRoot` (`BUNDLED_MIGRATIONS`, selected by `existsSync`),
which `migrationOptionsFor` resolves per set as `<root>/<set name>`. So a `waitron-provision` build
newer than the `apps/server` build actually running carries migrations the running host has never
applied — and `instance` will apply them. The scenario is not exotic: re-creating a dropped
`waitron_app`, re-issuing grants after a manual `REVOKE`, or simply taking `status`'s own advice
("Re-running `waitron-provision instance` applies anything still pending") is enough to reach it.

**What that costs a trading shop.** An `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on the table
and every later query on it queues behind that lock. Measured on `postgres:18-alpine` (PostgreSQL
18.4) rather than cited, for the one statement shape that was run: with
`begin; alter table sales add column c int;` held open in one session, `pg_locks` joined to
`pg_stat_activity` showed `AccessExclusiveLock` / `granted = t` on `sales`; a plain
`select count(*) from sales` in a second session, with `set statement_timeout='3s'`, returned
`ERROR: canceling statement due to statement timeout` instead of a row. Other statement shapes take
weaker modes and were not measured. And the lock is not held
for one statement: Drizzle runs a whole set's migrations inside a single transaction
(`drizzle-orm@0.45.2/pg-core/dialect.js:60`), so every lock it takes is held until that set commits.
So this is a **maintenance window**, and wants planning like one.

An earlier version of this paragraph closed by citing `CLAUDE.md` §5, "nothing may block a sale", as
though it settled the matter. It does not, and the citation was quoting the rule's headline while
dropping the clause that scopes it: §5 reads _"Nothing may block a sale **on anything but the sale
itself**… Fiscal submission is an outbox, never inline."_ That is an architectural rule about what
the sale PATH may depend on — it is what makes AEAT submission asynchronous — not a claim that no
operation may ever take a lock. Every deployment has downtime. Migrating under a live POS is an
ordinary operational risk to be scheduled, and it needs no appeal to a fiscal invariant to be worth
scheduling.

**The advisory lock does not cover this, and must not be read as if it did.** `applyMigrations` takes
`pg_advisory_lock` on a fixed key over a dedicated `pg.Client` opened from the same connection string
(`packages/migrations/src/apply.ts:32-55`), `instance` and `apps/server` migrate against the same
database, and `packages/migrations/src/apply.concurrency.test.ts` is a real receipt for two racing
migrators. What it serialises is **two MIGRATORS**. `MIGRATION_LOCK_KEY` occurs nowhere but
`apply.ts` (`grep -rn advisory` across `packages` and `apps`), so the host's long-lived duty pool —
`createPostgresDb(config.databaseUrl)`, `apps/server/src/boot.ts:120` — never takes it, and the duty
pool is exactly what a DDL lock queue blocks. Two migrators not colliding says nothing about the POS.

**The operator's control is the confirmation prompt, and `--yes` removes it.** The plan summary
prints `apply any pending migrations, in every set` above `Apply this plan? [y/N]`
(`src/cli.ts:189-195`); with `--yes` that prompt is not shown at all, which is the documented
non-interactive shape under "Secrets" above. There is **no** flag for "provision but do not migrate",
and no refusal keyed on the deployment being live: adding either is a product decision and is
deliberately not made here. Until one exists, the rule is operational rather than enforced — run
`instance` against a production database from the same build as the `apps/server` being deployed, or
in a window where no till is selling.

**Use a non-superuser admin.** `src/instance-apply.pg.test.ts` runs `applyInstance` against a
blank PostgreSQL container as a login with `CREATEDB` and `CREATEROLE`. It checks `rolsuper = false`,
applies the full manifest, creates the two logins, reads the database/schema ACLs and memberships
back, and checks the deployment stamp. `src/venue-apply.pg.test.ts` then exercises the venue flow as
the non-superuser table owner.

### `status`

Prints what the deployment has: whether the database exists, each role's attributes and memberships,
which migration sets have a journal, and the deployment stamp. Reads only; writes nothing. It carries
no secret by construction — see `src/status-command.ts`'s doc comment for the field-by-field
argument.

**`journal present` is not `applied`, and the report says so.** All this command can read is whether
each set's journal TABLE exists. Drizzle creates that table _before_ running the set's migrations
(`drizzle-orm@0.45.2/pg-core/dialect.js:54-60`), so an `instance` interrupted inside the last set
leaves every journal present and that set incomplete. `status` cannot tell that apart from a complete
deployment — but re-running `instance` repairs it, because the planner emits `migrate` on every run
rather than only when a journal is missing. The host does the same at its next boot
(`apps/server/src/boot.ts:116`). Nothing here is dangerous; it is simply less than "applied" would
claim.

It is also the tool to reach for after a failed `instance`: it names which roles exist.

### `venue`

Stands a sellable venue up in one transaction: a tenant, an **admin person**, a location, a till, a
node, a standard plus a rectificative invoice series, and then every composed module's provisioning
seed — the fiscal module's registers the node as a Veri\*Factu SIF and starts its chain. It replaced
the retired `apps/server/sql/bootstrap-tenant.sql`.

Unlike `instance`, which talks to the cluster admin, `venue` connects to the **target database as the
owner-admin** — the role that created the tables when it ran `instance` — over the same
`WAITRON_ADMIN_DATABASE_URL`. `applyVenue` inserts as the table owner, so there is no
second role and no grant to widen. The database must already be **stamped and migrated**: a venue
against an unstamped database is refused (`provisioning.database_unstamped`), because stamping is
`instance`'s job and one database per environment is a fiscal invariant.

The admin person is seeded with two login secrets, both **required** and both handled exactly like the
admin connection string — read from an environment variable or an echo-off prompt, **never** from
`argv`: a till **PIN** (`WAITRON_ADMIN_PIN`, for the counter POS) and a dashboard **password**
(`WAITRON_ADMIN_PASSWORD`, for the management dashboard, ≥8 characters). Each is hashed at the CLI
boundary (`assertPinLength` / `assertPasswordLength` enforce the same floors the identity package
does), so only the hash ever reaches the plan or the database, and the display name (`--admin-name`) is
the only non-secret, so it stays a flag. This is the ONLY place either secret is set for the FIRST
admin: `setPassword` and passkey enrollment are gated on an already-authenticated management session.

**Whether the seeded admin can sign in to the dashboard depends on how it was seeded.** Dashboard
(management) login is **email + password** — `loginManager` resolves the person by email. The
`seed-admin` insert now names an `email` column (written when the request supplies one; `email ?? null`
otherwise), and **onboarding via the setup UI** (`apps/setup` → `setup-api.ts`) captures the admin email
as a **required** field, so an **onboarding-provisioned admin signs in to the dashboard immediately**.
The bare `venue` CLI has no `--admin-email` flag, so it seeds the admin **emailless** (email is OPTIONAL
in provisioning), and such an admin has no email sign-in path until an email is set out-of-band
(`setEmail` is gated on an already-authenticated management session); today only the demo bootstrap
(`apps/server/scripts/dev-setup.ts`) does that. Independent of the email, the provisioned password is
not idle — the C2b mirror-bundle adoption route authenticates the admin **by id** via `loginManagerById`
(a server-to-server flow carrying the id, not the email form), regardless of whether it has an email.

It reads what would be created, prints the plan headed by `Cluster: <user>@<host>:<port>`, asks for
confirmation (`--yes` skips it), applies, then prints the new `tenant` and `node` ids and one
`seeded:` line per module seed that ran (the fiscal module's names its SIF id and installation
number). The SIF's `id_sistema_informatico` is **not** an option — it is the `WAITRON_ID_SISTEMA`
product constant (`W1`, owned by `packages/fiscal-verifactu`), which identifies Waitron's software,
not the venue.

`--territory` currently accepts only `ES-common` (common-territory Spain, Veri\*Factu with IVA); any
other value is refused with `fiscal.regime_not_implemented`. The pure `planVenue` also refuses a
`--locale` count outside one-or-two (`provisioning.invalid_locales`) and equal standard and
rectificative series codes (`provisioning.duplicate_series_code`) before any admin connection is
opened; a concurrent run that races a conflicting row is caught as `provisioning.venue_conflict`.

A worked invocation with the full option set is in
[`apps/server/README.md`](../../apps/server/README.md#provisioning-a-venue).

## Secrets

Five, handled differently, **none ever in `argv`**.

| Secret                   | How it gets in or out                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Credential key ring      | OUTPUT of `keyring` only. Printed once, acknowledged, then screen and scrollback cleared.          |
| Role passwords           | OUTPUT of `instance` only. Generated here, printed once in a connection string, stored nowhere.    |
| Admin connection string  | INPUT. `WAITRON_ADMIN_DATABASE_URL`, or an echo-off prompt. There is no flag.                      |
| Admin till PIN           | INPUT (`venue`). `WAITRON_ADMIN_PIN`, or an echo-off prompt. No flag. Hashed at the CLI boundary.  |
| Admin dashboard password | INPUT (`venue`). `WAITRON_ADMIN_PASSWORD`, or an echo-off prompt. No flag. Hashed at the boundary. |

`--admin-url` is **not** an option, and neither is `--password` or `--key`. `argv` is world-readable
in `ps` and lands in shell history, so the parser is `strict` and any such flag is a parse error
rather than something silently accepted — `src/cli.test.ts`'s "refuses any flag that would put a
secret in argv" and "refuses --admin-url as a flag, in both argv forms" are what keep it that way. The
admin PIN and dashboard password (`venue`) are read the same way: from `WAITRON_ADMIN_PIN` /
`WAITRON_ADMIN_PASSWORD` or an echo-off prompt, and from nowhere else.

Set the environment variable for a non-interactive run:

```bash
WAITRON_ADMIN_DATABASE_URL=postgres://admin:secret@host:5432/postgres \
  node dist/bin.js instance --database waitron --environment preproduction --yes
```

If neither source supplies one, the run stops with `provisioning.admin_uri_missing` — it does not
fall back to a default. `pg` resolves an **empty** connection string to `localhost:5432` as the OS
user rather than rejecting it, so without that refusal an unset or misspelled variable plus a
non-interactive stdin would have `instance` create, migrate and **stamp** a database on whatever
cluster answers there.

**It must be a URL** — `postgres://user:pass@host:port/database`. `pg` also accepts a libpq
keyword/value string (`host=… port=… user=…`) and a bare Unix-socket directory path
(`/var/run/postgresql`), and this tool refuses both with `provisioning.admin_uri_not_a_url` before
it connects. That is a real refusal of something that works, not a formatting preference: measured
inside a `postgres:18-alpine` container (PostgreSQL 18.4) with this repo's `pg@8.22.0`, the socket
path connected successfully (`select inet_server_addr() is null` → `t`) while
`new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the same process. `instance`
re-points the admin string at the target database — for the state read, for the migrator's URL and
for each role's printed connection string — and every one of those is a `new URL`, so a form only
`pg` can parse is one this tool cannot carry. Re-serialising a keyword/value string with a
different database, user and password is the alternative, and getting it wrong points `migrate` and
`stamp` at the wrong database, which one-database-per-environment makes unrecoverable.

**A socket-only cluster is still reachable** — spell the socket directory as a URL host, libpq's own
percent-encoded form:

```bash
WAITRON_ADMIN_DATABASE_URL='postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/postgres'
```

Run in the same container: `pg` parsed that to `{host:"/var/run/postgresql",user:"postgres"}`,
connected over the socket (`inet_server_addr() is null` → `t`), and it survives this tool's
re-pointing — `withDatabase(…, "waitron_probe_db")` produced
`postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/waitron_probe_db`, which connected to that
database over the same socket, and `roleUri` produced
`postgresql://waitron_app:pw@%2Fvar%2Frun%2Fpostgresql/waitron_probe_db`, which `pg` parsed back to
the right host, user, password and database. `postgresql://user@localhost/db?host=/var/run/postgresql`
was measured to work the same way. What does **not** work is dropping the user
(`postgresql:///postgres?host=/var/run/postgresql` failed with
`no PostgreSQL user name specified in startup packet`, 28000) or leaving the host empty with a user
present (`postgresql://postgres@/postgres?host=…`, which `new URL` itself rejects).

**The admin's PASSWORD never appears in anything this tool prints**, from either source, and neither
does the connection string as a whole. Its **username, host and port do**, deliberately, in two
places: `instance`'s plan summary prints `Cluster: <user>@<host>:<port>` above the actions, and each
role connection string is the admin's own URI with the userinfo and the database path replaced, so
the host, the port and any query string (`sslmode=require`, say) are carried through — which is what
makes the printed string one the host can actually connect with.

That is a **narrowing** of what this section used to promise, which was that the username never
appeared either. A confirmation that cannot name the cluster cannot reveal the mistake it exists to
catch, and that mistake is the fiscally expensive one: one database per environment, and `instance`
stamps whatever it is pointed at. A username is not a credential on its own, the operator supplied it
in the first place, and the printed role strings carry usernames regardless.

## What it refuses, and what to do about it

Every refusal is a structured code and its params on stderr — never a raw driver message, which for
this package would quote a `CREATE ROLE … PASSWORD '<generated>'` statement back verbatim.

| Code                                   | What happened                                                                                                                                                                                                                                                                                                                                                     | What to do                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provisioning.admin_uri_missing`       | Neither `WAITRON_ADMIN_DATABASE_URL` nor the prompt gave an admin connection string                                                                                                                                                                                                                                                                               | Set the variable, or answer the prompt. Refused rather than defaulted — see "Secrets" above for what `pg` does with an empty one.                                                                                                                                                                                                                                                                 |
| `provisioning.admin_uri_not_a_url`     | The admin connection string is not a URL `new URL` can parse                                                                                                                                                                                                                                                                                                      | Spell it `postgres://user:pass@host:port/database`. A libpq keyword/value string or a bare socket path is refused before connecting — see "Secrets" above, including the URL spelling for a socket-only cluster.                                                                                                                                                                                  |
| `provisioning.invalid_identifier`      | A database or role name outside `^[a-z][a-z0-9_]{0,62}$`                                                                                                                                                                                                                                                                                                          | Rename it. A database called `Waitron Prod` is a permanent papercut for whoever operates it.                                                                                                                                                                                                                                                                                                      |
| `deployment.unknown_environment`       | `--environment` was not `production` or `preproduction`                                                                                                                                                                                                                                                                                                           | Type one of the two.                                                                                                                                                                                                                                                                                                                                                                              |
| `deployment.already_stamped`           | The database is stamped for the OTHER environment                                                                                                                                                                                                                                                                                                                 | Stop. A pre-production database is never promoted — see the fiscal invariants below.                                                                                                                                                                                                                                                                                                              |
| `provisioning.role_over_privileged`    | A `waitron_*` role already exists carrying `SUPERUSER`                                                                                                                                                                                                                                                                                                            | Refused, not adopted: a superuser can disable the append-only triggers. Drop or fix the role.                                                                                                                                                                                                                                                                                                     |
| `provisioning.role_unusable`           | A `waitron_*` role exists but is `NOLOGIN`, or lacks `CREATEROLE`                                                                                                                                                                                                                                                                                                 | Refused rather than `ALTER`ed — this tool did not create it. Fix it by hand, or drop it and re-run.                                                                                                                                                                                                                                                                                               |
| `provisioning.state_unreadable`        | The admin connection could not reach or read the deployment. `sqlState` says why                                                                                                                                                                                                                                                                                  | `28P01`: wrong password. `42501`: see "When the admin did not create the database" below.                                                                                                                                                                                                                                                                                                         |
| `provisioning.role_creation_failed`    | `CREATE ROLE` failed. `sqlState` says why                                                                                                                                                                                                                                                                                                                         | `42710`: the role already exists. `42704`: a membership target does not. `42501`: this admin may not — see below.                                                                                                                                                                                                                                                                                 |
| `provisioning.grant_ineffective`       | Every statement ran, and a privilege in `missing` is still absent afterwards                                                                                                                                                                                                                                                                                      | Almost always the admin lacks grant option on the database or on `public` — see "When the admin did not create the database" below. If the same run also CREATED a role, read "A failed `instance` can orphan a role" before re-running.                                                                                                                                                          |
| `provisioning.membership_grant_failed` | `GRANT <memberOf> TO <role>` failed. `sqlState` says why                                                                                                                                                                                                                                                                                                          | `42501`: this admin holds no ADMIN OPTION on the role it is granting — see below.                                                                                                                                                                                                                                                                                                                 |
| `unexpected failure (Error)` — no code | Not a refusal at all. `instance-apply.ts` wraps only `create-role` and `grant-membership` in a `try`/`catch`; `create-database`, `grant-database-create`, `grant-schema-create`, `migrate` and `stamp` are all uncaught, so a driver failure in **any of those five** reaches `bin.ts`'s top-level catch unclassified: no database named, no SQLSTATE, no remedy. | The shape exercised by `instance-apply.pg.test.ts` is `permission denied for database <db>` (42501) on Drizzle's opening `CREATE SCHEMA IF NOT EXISTS "public"` — the tool does not print it, the server log does. Fix that one with the statements under "When the admin did not create the database" below; the real-Postgres suite checks that procedure against an already-migrated database. |

Every other row is a structured code; that last one is a gap, recorded rather than dressed up.
Reclassifying it into a `provisioning.*` code is a separate change, because a code is permanent once
shipped. Nothing here is shipped yet, though — Waitron is not in production (CLAUDE.md §3, "no
backwards-compatibility or data-migration code until Waitron is in production") — which is the
carve-out under which SP-3c DELETED `provisioning.id_sistema_invalid` outright instead of
deprecating it: the software-id bound moved into the fiscal module, where the same concept is now
`sif.id_sistema_invalid`. The rule stands for the day a venue is live.

The uncaught cases also include failures before migration: an admin lacking `CREATEDB` fails on
`create-database`, and an object grant can fail with `42501` when its grantor holds no privilege
on the object. The CLI does not classify those errors.

The underlying driver error is deliberately not attached, not even as `cause`: Node's default
console formatting recurses into `.cause`, which would put a generated password one level down from
where it was withheld.

## Known limitations

### When the admin did not create the database

`instance` and `status` are best run as the admin that created the database. A **different**
`login createdb createrole` admin hits four walls in turn, and only the first two are reported
clearly. Each of the following was reproduced through the built bundle against `postgres:18-alpine`,
with two admins `adm_a` (which provisioned) and `adm_b` (which did not):

1. **It cannot read the state.** Tables inside the database are owned by whoever created them, so
   the deployment-stamp read fails and `instance` prints
   `provisioning.state_unreadable {"database":"wp","sqlState":"42501"}`.
2. **It cannot create a role that is a member of `app_user`.** PostgreSQL requires ADMIN OPTION on a
   role to grant it, and an admin that did not create `app_user` holds none:
   `provisioning.role_creation_failed {"role":"waitron_app","sqlState":"42501"}`. The repair path
   for an already-existing role reports `provisioning.membership_grant_failed` with the same code.
3. **Its grants take effect nowhere, and PostgreSQL calls that success.** A `GRANT` from a grantor
   that holds some privilege on the object but no grant option raises a **WARNING, not an error** —
   observed directly: as a non-owning admin, `grant create on database acl_db to r_app` printed
   `WARNING: no privileges were granted for "acl_db"` followed by the command tag `GRANT`, and
   `pg_database.datacl` afterwards still read `{=Tc/owner_a,owner_a=CTc/owner_a,r_mig=C/owner_a}`
   with no `r_app` entry at all. The driver reports success, so nothing can be caught. A grantor
   holding _nothing_ on the object errors instead (42501), but on a database that case needs
   `PUBLIC`'s default `CONNECT` revoked first, so the silent path is the one an admin normally hits.
   Two quieter variants: a partly-grantable list warns `not all privileges were granted` and still
   applies the grantable part, and `GRANT ALL PRIVILEGES` in the same situation prints nothing at
   all.

   **This is now detected and refused**, not merely documented. After running its plan,
   `instance` reads the ACLs back **directly** — `pg_database.datacl`, `pg_namespace.nspacl`
   (including the trailing `*` that is WITH GRANT OPTION) and `pg_auth_members` — and raises
   `provisioning.grant_ineffective` naming every privilege that is not there. Direct ACL inspection
   is used rather than `has_database_privilege`/`has_schema_privilege` deliberately: those answer
   for the RECURSIVE closure, so a role holding CREATE only through a group reads as satisfied when
   the direct grant is absent. (They report WITH GRANT OPTION perfectly well, via the
   `'CREATE WITH GRANT OPTION'` privilege spelling — an earlier version of this paragraph said they
   could not. The closure is the reason; the option is not.)

4. **It cannot run the migrator, and that failure carries no code.** `instance` plans
   `migrate` on **every** run — it stopped gating on journal presence, see "Idempotency" above — and
   Drizzle's migrator opens each set with `CREATE SCHEMA IF NOT EXISTS "public"`
   (`drizzle-orm@0.45.2/pg-core/dialect.js:54`). That statement needs **database-level `CREATE`**
   whether or not the schema already exists, because PostgreSQL checks the privilege before it
   evaluates existence — the receipt is in `apps/server/README.md`'s "Two connection strings, one
   purpose split". An admin without it stops here, and `instance-apply.ts`'s `migrate` case has no
   `try`/`catch` — like every action except `create-role` and `grant-membership`, so this is the
   shared gap the error table records rather than one peculiar to `migrate` — so what the operator
   sees is `unexpected failure (Error)` and exit 1, the last row of that table. Wall 3's own hard
   42501 lands in the same place, uncoded, for the same reason.

Run `instance` as the admin that created the database. If you delegate an already-migrated
database to another admin, that role needs to read the journals, administer `app_user` membership,
and issue the database and schema grants. The role that owns those objects or holds their grant
options can delegate those privileges:

```sql
-- inside <db>:
grant select on all tables in schema public to <new_admin>;
grant app_user to <new_admin> with admin option;
grant create on database <db> to <new_admin> with grant option;
grant create on schema public to <new_admin> with grant option;
```

These grants do not transfer table ownership or authorize future migrations that alter existing
tables. Use the original owner for that work. `instance-apply.pg.test.ts` exercises membership
refusal, ineffective grants, and this delegation procedure with direct ACL read-back. The tool reads each
grantor's ACL entry: a grantee can have several entries, and a privilege held through another role
does not substitute for the direct grant the plan promised.

### A second database on the same cluster prints no connection strings

Roles are **cluster-global**; databases are not. So an `instance` against a _new_ database on a
cluster that already carries `waitron_migrator` and `waitron_app` plans no
`create-role` at all, and the run ends with "already existed — no connection string" for both
and exit 0. The database is created, migrated, granted and stamped correctly — what is missing is any
way to connect to it, unless the strings printed by the **first** provision were kept. Those roles do
work against the new database with their original passwords; this tool simply cannot re-print them,
because `pg_authid` stores only a hash.

Not a fiscal hazard: stamps are per-database and `stampDeployment` refuses a disagreeing one
independently of the planner. It is, however, one credential across two databases — PostgreSQL grants
`CONNECT` to `PUBLIC` by default (the `=Tc/owner_a` entry in the `datacl` transcript above), so the
same `DATABASE_URL` reaches both. For a production and a pre-production deployment, use separate
clusters.

### A failed `instance` can orphan a role

`applyInstance` is not one transaction and cannot be — PostgreSQL refuses `CREATE DATABASE` inside a
transaction block. If a run fails after creating a role, that role exists carrying a password this
run generated in memory and never printed. A re-run will not recreate it: the planner sees it and
leaves it alone.

**`provisioning.grant_ineffective` is one of the ways to get here**, and the least obvious, because
every statement in the plan "succeeded" — the verification that follows them is what fails. On a
first provision the roles are created before the grants, so a plan that trips it has already minted
two passwords it will now never print. Treat it like any other mid-plan failure.

The tool says so on the failure path rather than leaving it to be discovered. The way back is what
it prints: run `status`, `DROP ROLE` every `waitron_*` role listed as present that you have no
connection string for, and run `instance` again.

### An unreachable host is still an opaque failure

A failure carrying no SQLSTATE — a refused socket, a DNS failure — is rethrown untouched and reaches
the operator as `unexpected failure (Error)`. That is deliberate: it is not the database's verdict
on anything, and dressing it up as one would be a claim the code cannot support. Confirmed against a
container by pointing the admin URL at a dead port.

## Fiscal invariants this tool is bound by

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across, so pre-production sales would leave a permanent hole
  in the production series. `instance` refuses a database already stamped for the other environment,
  and `stampDeployment` refuses it again independently.
- **`preproduction` is the default everywhere; `production` must be typed out.** This tool has no
  default at all — `--environment` is prompted for when omitted, because the mistake is
  irreversible.

## Testing

Three suites need a real Postgres container — `src/instance-apply.pg.test.ts`,
`src/instance-state.test.ts` and `src/venue-apply.pg.test.ts`: `instance` creates databases and
roles and reads `pg_roles` attributes, none of which PGlite's bundled single-superuser server can
reproduce. Everything else — the planner, the formatter, the whole CLI — is a pure function, an
injected-IO call, or a PGlite suite.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
```

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally; without it the container suites hang until
the hook timeout fires.

`src/bin.ts` is excluded from coverage deliberately: every decision it could get wrong lives in
`cli.ts`, which is injected and fully tested. What remains — a tty, a readline, a process exit
code — is verified by running the built bundle instead.
