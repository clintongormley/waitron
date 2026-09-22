# `@waitron/provisioning`

Two commands under one bundle, `waitron-provision`, matching how `@waitron/credentials` names
`waitron-credentials`. Neither is an executable on your PATH: both are bundles you build and run by
path (below), so each manifest declares its name under `waitron.commands` rather than `bin` —
`scripts/manifest-commands.test.ts` records why.

Design: [`docs/superpowers/specs/2026-07-29-provisioning-tool-design.md`](../../docs/superpowers/specs/2026-07-29-provisioning-tool-design.md).
This document is the operational half of that spec — written for whoever runs the tool, not whoever
reads its source.

> **`venue` does not run on this branch.** It opens a PostgreSQL connection string, and the storage
> switch replaced PostgreSQL with a directory of SQLite files: `@waitron/db` no longer exports
> `createPostgresDb`, which `src/bin.ts` imports to build the connection. This package's own
> `typecheck` script reports it as `TS2305` on `src/bin.ts`.
> Repointing the command at a venue directory is unscheduled work;
> until it happens, stand a venue up through the setup flow
> (`apps/server/src/provision.ts`) or the dev stack (`apps/server/scripts/dev-setup.ts`), and read
> the `venue` section below as a description of the library underneath it (`planVenue` /
> `applyVenue`), which every one of those paths still uses.

The command that **did** stand a deployment up — `waitron-provision instance`, which created a
database, created the `waitron_migrator` and `waitron_app` roles, migrated and stamped it — was
deleted with the PostgreSQL deployment model, along with `status`. With one SQLite directory there
is no server to reach, no database to create and no roles to grant. Older documents that send an
operator to `waitron-provision instance` or `waitron-provision status` are describing a tool that no
longer exists.

## Building and running it

```bash
pnpm --filter @waitron/provisioning build   # bundles src/bin.ts
node packages/provisioning/dist/bin.js <command>
```

`esbuild` produces `dist/bin.js` and that is the whole build. It used to copy every package's
`drizzle/` folder to `dist/drizzle` as well, because the bundle migrated: that was `instance`'s job,
and neither surviving command migrates anything.

## The two commands

| Command   | What it needs                                                         | How often           |
| --------- | --------------------------------------------------------------------- | ------------------- |
| `keyring` | nothing at all — no database, no connection string                    | once per deployment |
| `venue`   | the migrator connection (role option) to a stamped, migrated database | once per venue      |

`venue` creates the taxpayer row, a location, a till, a node and its standard and rectificative
invoice series, then runs each composed module's provisioning seed (the fiscal module's registers the
node as a SIF and starts its chain) — replacing the retired `apps/server/sql/bootstrap-tenant.sql`
(removed 2026-08-04, spec [`2026-08-04-locations-provisioning-design.md`](../../docs/superpowers/specs/2026-08-04-locations-provisioning-design.md)).
`register-till` (`apps/server`) remains the standalone path for an EXISTING node: it runs the same
module seeds against one node — a reimaged node getting a fresh chain, or a node that otherwise has
no fiscal identity.

```text
usage: waitron-provision <command> [options]

  keyring                                            generate the credential key ring
  venue    [--database <name>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]
           [--location-name <name>] [--territory <t>] [--locale <l>]...
           [--operation-description <text>] [--address-line1 <text>] [--address-line2 <text>]
           [--postal-code <code>] [--city <name>] [--province <name>] [--time-zone <tz>]
           [--day-cutover <HH:MM>] [--till-name <name>] [--series-code <code>]
           [--rectificative-code <code>] [--admin-name <name>] [--admin-email <email>]
           [--admin-first-names <names>] [--admin-last-names <names>] [--yes]
```

Every option is prompted for when omitted, so a bare `waitron-provision venue` is a complete
interactive session. The two exceptions are `--admin-first-names` and `--admin-last-names`: they are
read from a flag but never prompted for, so a script that already drives `venue` non-interactively
is not stopped by a question it did not expect.

### `keyring`

Generates the credential key ring `@waitron/credentials` seals every tenant credential under, prints
`WAITRON_CREDENTIALS_KEY` and `WAITRON_CREDENTIALS_KEY_VERSION` **once**, waits for an
acknowledgement, then clears the screen and the scrollback.

There is no way to recover this key. Losing it means re-sealing every certificate and every Stripe
key by hand — which for the fiscal certificate means obtaining it again.

Clearing the scrollback is a real improvement and **not** a guarantee, and the tool says so on
screen rather than implying the key is gone: a terminal configured to log its sessions to disk, or
tmux's own buffer under some configurations, still has it.

### `venue`

Stands a sellable venue up in one transaction: the taxpayer row (`tenants` holds exactly one), an
**admin person**, a location, a till, a node, a standard plus a rectificative invoice series, and
then every composed module's provisioning seed — the fiscal module's registers the node as a
Veri\*Factu SIF and starts its chain. It replaced the retired
`apps/server/sql/bootstrap-tenant.sql`.

`venue` connects to the **target database as `waitron_migrator`** — the role that owns every table —
by opening the admin's `WAITRON_ADMIN_DATABASE_URL` with a session role option
(`options=-c role=waitron_migrator`). `applyVenue` inserts as that owner, and a plain admin
connection could not write the migrator-owned `public` schema. **Nothing in this repository creates
that role any more**: it was `instance`'s, and the database has to have been set up that way by
something else. The database must also already be **stamped and migrated**: a venue against an
unstamped database is refused (`provisioning.database_unstamped`), because one database per
environment is a fiscal invariant and this command does not stamp.

The admin person is seeded with two login secrets, both **required** and both handled exactly like
the admin connection string — read from an environment variable or an echo-off prompt, **never**
from `argv`: a till **PIN** (`WAITRON_ADMIN_PIN`, for the counter POS) and a dashboard **password**
(`WAITRON_ADMIN_PASSWORD`, for the management dashboard, ≥8 characters). Each is hashed at the CLI
boundary (`assertPinLength` / `assertPasswordLength` enforce the same floors the identity package
does), so only the hash ever reaches the plan or the database. The display name (`--admin-name`) and
required email (`--admin-email`) are not secrets, so they stay as flags. So are the admin's optional
real names (`--admin-first-names` / `--admin-last-names`), which land in `persons.first_names` /
`persons.last_names`; omit both and the person is seeded without a real name against them, which the
dashboard can fill in later. This is the ONLY place either secret is set for the FIRST admin:
`setPassword` and passkey enrollment are gated on an already-authenticated management session.

Dashboard management login is **email + password**: `loginManager` resolves the person by email. Both
the setup UI and the bare `venue` CLI require the first admin's email and thread it into `seed-admin`,
so the provisioned admin can sign in immediately. The C2b mirror-bundle adoption route independently
authenticates that admin **by id** via `loginManagerById`, because it is a server-to-server flow
carrying the id rather than the dashboard form.

It reads what would be created, prints the plan headed by `Cluster: <user>@<host>:<port>`, asks for
confirmation (`--yes` skips it), applies, then prints the new `node` id and one
`seeded:` line per module seed that ran (the fiscal module's names its SIF id and installation
number). The SIF's `id_sistema_informatico` is **not** an option — it is the `WAITRON_ID_SISTEMA`
product constant (`W1`, owned by `packages/fiscal-verifactu`), which identifies Waitron's software,
not the venue.

`--territory` currently accepts only `ES-common` (common-territory Spain, Veri\*Factu with IVA); any
other value is refused with `fiscal.regime_not_implemented`. The pure `planVenue` also refuses a
`--locale` count outside one-or-two (`provisioning.invalid_locales`) and equal standard and
rectificative series codes (`provisioning.duplicate_series_code`) before any admin connection is
opened. Before `planVenue` runs, the command reaches the fiscal regime's own venue-field seat, which
refuses a legal name or operation description carrying a character XML forbids, an operation
description over 500 characters, and either series code outside AEAT's character set or longer than
the 38-character base (`setup.request_invalid`, naming the offending field). A concurrent run that
races a conflicting row is caught as `provisioning.venue_conflict`. A run against a database whose
taxpayer row names a different country or tax id is refused with `provisioning.foreign_tenant`, and
refused BEFORE the plan is applied: `venue` reads the stored identity and calls the shared
`assertNoForeignTenant` first (`cli.test.ts` pins that the apply is never reached). `planVenue`
trims and upper-cases both values before that comparison, so a difference of letter case or
surrounding space is the SAME taxpayer and the re-run is the no-op a re-provision should be.
`provisioning.tenant_identity_mismatch` is a second, narrower refusal INSIDE `applyVenue`'s own
transaction, for the case that pre-read cannot see: another run committing a different taxpayer
between this run's read and its write.

## Secrets

Four, handled differently, **none ever in `argv`**.

| Secret                   | How it gets in or out                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Credential key ring      | OUTPUT of `keyring` only. Printed once, acknowledged, then screen and scrollback cleared.          |
| Admin connection string  | INPUT (`venue`). `WAITRON_ADMIN_DATABASE_URL`, or an echo-off prompt. There is no flag.            |
| Admin till PIN           | INPUT (`venue`). `WAITRON_ADMIN_PIN`, or an echo-off prompt. No flag. Hashed at the CLI boundary.  |
| Admin dashboard password | INPUT (`venue`). `WAITRON_ADMIN_PASSWORD`, or an echo-off prompt. No flag. Hashed at the boundary. |

`--admin-url` is **not** an option, and neither is `--password` or `--key`. `argv` is world-readable
in `ps` and lands in shell history, so the parser is `strict` and any such flag is a parse error
rather than something silently accepted — `src/cli.test.ts`'s "refuses any flag that would put a
secret in argv" and "refuses --admin-url as a flag, in both argv forms" are what keep it that way.

Set the environment variable for a non-interactive run:

```bash
WAITRON_ADMIN_DATABASE_URL=postgres://admin:secret@host:5432/postgres \
  node dist/bin.js venue --database waitron --country ES … --yes
```

If neither source supplies one, the run stops with `provisioning.admin_uri_missing` — it does not
fall back to a default. `pg` resolves an **empty** connection string to `localhost:5432` as the OS
user rather than rejecting it, so without that refusal an unset or misspelled variable plus a
non-interactive stdin would have `venue` open whatever cluster answers there and mint a taxpayer, a
node and its invoice series in it.

**It must be a URL** — `postgres://user:pass@host:port/database`. `pg` also accepts a libpq
keyword/value string (`host=… port=… user=…`) and a bare Unix-socket directory path
(`/var/run/postgresql`), and this tool refuses both with `provisioning.admin_uri_not_a_url` before
it connects. That is a real refusal of something that works, not a formatting preference: measured
inside a `postgres:18-alpine` container (PostgreSQL 18.4) with `pg@8.22.0`, the socket
path connected successfully (`select inet_server_addr() is null` → `t`) while
`new URL("/var/run/postgresql")` threw `TypeError: Invalid URL` in the same process. `venue`
re-points the admin string at the target database (`withDatabase`, then `withRole` for the session
role option) and parses it again to name the cluster in its plan summary (`describeAdmin`). Each of
those three is a `new URL`, so a form only `pg` can parse is one this tool cannot carry.

**A socket-only cluster is still reachable** — spell the socket directory as a URL host, libpq's own
percent-encoded form:

```bash
WAITRON_ADMIN_DATABASE_URL='postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/postgres'
```

Run in the same container: `pg` parsed that to `{host:"/var/run/postgresql",user:"postgres"}`,
connected over the socket (`inet_server_addr() is null` → `t`), and it survives this tool's
re-pointing — `withDatabase(…, "waitron_probe_db")` produced
`postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/waitron_probe_db`, which connected to that
database over the same socket. `postgresql://user@localhost/db?host=/var/run/postgresql`
was measured to work the same way. What does **not** work is dropping the user
(`postgresql:///postgres?host=/var/run/postgresql` failed with
`no PostgreSQL user name specified in startup packet`, 28000) or leaving the host empty with a user
present (`postgresql://postgres@/postgres?host=…`, which `new URL` itself rejects).

**The admin's PASSWORD never appears in anything this tool prints**, from either source, and neither
does the connection string as a whole. Its **username, host and port do**, deliberately, in one
place: `venue`'s plan summary prints `Cluster: <user>@<host>:<port>` above the actions.

That is a **narrowing** of what this section used to promise, which was that the username never
appeared either. A confirmation that cannot name the cluster cannot reveal the mistake it exists to
catch, and that mistake is the fiscally expensive one: one database per environment, and a venue
mints a chain and a series in whatever it is pointed at. A username is not a credential on its own,
and the operator supplied it in the first place.

## What it refuses, and what to do about it

Every refusal is a structured code and its params on stderr — never a raw driver message.

| Code                                 | What happened                                                                       | What to do                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provisioning.admin_uri_missing`     | Neither `WAITRON_ADMIN_DATABASE_URL` nor the prompt gave an admin connection string | Set the variable, or answer the prompt. Refused rather than defaulted — see "Secrets" above for what `pg` does with an empty one.                                                                                |
| `provisioning.admin_uri_not_a_url`   | The admin connection string is not a URL `new URL` can parse                        | Spell it `postgres://user:pass@host:port/database`. A libpq keyword/value string or a bare socket path is refused before connecting — see "Secrets" above, including the URL spelling for a socket-only cluster. |
| `provisioning.invalid_identifier`    | A database or role name outside `^[a-z][a-z0-9_]{0,62}$`                            | Rename it. A database called `Waitron Prod` is a permanent papercut for whoever operates it.                                                                                                                     |
| `provisioning.invalid_country`       | `--country` is not two ASCII letters                                                | Type an ISO-3166-1 alpha-2 code, such as `ES`.                                                                                                                                                                   |
| `provisioning.database_unstamped`    | The target database carries no environment stamp                                    | Stamping belongs to whichever path created the database. Point `venue` at one that is stamped and migrated.                                                                                                      |
| `provisioning.state_unreadable`      | The connection could not reach or read the target database. `sqlState` says why     | `28P01`: wrong password. `3D000`: the database does not exist. `42501`: the connection cannot read the target's tables — commonly a missing `SET ROLE` grant on `waitron_migrator`.                              |
| `provisioning.foreign_tenant`        | The database already holds a DIFFERENT taxpayer                                     | Stop. One tenant per database is the isolation boundary — see the fiscal invariants below.                                                                                                                       |
| `provisioning.venue_conflict`        | A concurrent run committed a conflicting row between this run's plan and its apply  | Re-run. A same-venue re-run is a no-op.                                                                                                                                                                          |
| `fiscal.regime_not_implemented`      | `--territory` names a fiscal regime with no module behind it                        | Today only `ES-common` is implemented.                                                                                                                                                                           |
| `provisioning.invalid_locales`       | `--locale` was given no times, or more than twice                                   | Give one or two.                                                                                                                                                                                                 |
| `provisioning.duplicate_series_code` | `--series-code` and `--rectificative-code` are the same                             | Give them different codes; they are two separate series.                                                                                                                                                         |

Waitron is not in production (CLAUDE.md §3, "no backwards-compatibility or data-migration code until
Waitron is in production"), which is the carve-out under which a code has twice been DELETED rather
than deprecated: SP-3c dropped `provisioning.id_sistema_invalid` when the software-id bound moved
into the fiscal module as `sif.id_sistema_invalid`, and the instance-path deletion dropped
`provisioning.role_over_privileged`, `role_unusable`, `role_creation_failed`,
`membership_grant_failed` and `grant_ineffective` along with the only code that threw them. The
never-rename rule stands for the day a venue is live.

The underlying driver error is deliberately not attached, not even as `cause`: Node's default
console formatting recurses into `.cause`, which would put a database's own words one level down
from where they were withheld.

## Known limitations

### An unreachable host is still an opaque failure

A failure carrying no SQLSTATE — a refused socket, a DNS failure — is rethrown untouched and reaches
the operator as `unexpected failure (Error)`. That is deliberate: it is not the database's verdict
on anything, and dressing it up as one would be a claim the code cannot support. Confirmed against a
container by pointing the admin URL at a dead port.

## Fiscal invariants this tool is bound by

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across, so pre-production sales would leave a permanent hole
  in the production series. `venue` reads the target's stamp and refuses an unstamped database
  rather than stamping one itself.
- **One taxpayer per database.** `venue` reads the stored `(country, tax_id)` before it applies and
  refuses a second, different one (`provisioning.foreign_tenant`), with a narrower refusal inside
  the transaction for a taxpayer committed between that read and the write.

## Testing

No suite in this package needs a container. `src/schema-ahead.migrate.test.ts` is the heaviest: it
migrates a real venue directory in a temporary folder, which is what pins drizzle's journal
semantics — the artefact `findAheadSets` reads. Everything else is a pure function, an injected-IO
call, or a `useVenueDb` suite.

```bash
pnpm --filter @waitron/provisioning test:coverage
```

`src/bin.ts` is excluded from coverage deliberately: every decision it could get wrong lives in
`cli.ts`, which is injected and fully tested. What remains — a tty, a readline, a process exit
code — is verified by running the built bundle instead.
