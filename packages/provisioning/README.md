# `@waitron/provisioning`

Two commands under one bundle, `waitron-provision`, matching how `@waitron/credentials` names
`waitron-credentials`. Neither is an executable on your PATH: both are bundles you build and run by
path (below), so each manifest declares its name under `waitron.commands` rather than `bin` —
`scripts/manifest-commands.test.ts` records why.

Design: [`docs/superpowers/specs/2026-07-29-provisioning-tool-design.md`](../../docs/superpowers/specs/2026-07-29-provisioning-tool-design.md).
This document is the operational half of that spec — written for whoever runs the tool, not whoever
reads its source.

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

| Command   | What it needs                                 | How often           |
| --------- | --------------------------------------------- | ------------------- |
| `keyring` | nothing at all — no venue directory, no files | once per deployment |
| `venue`   | a migrated venue directory                    | once per venue      |

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
  venue    [--venue-dir <path>] [--country <cc>] [--tax-id <nif>] [--legal-name <name>]
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

`venue` opens **one venue directory** — the two SQLite files `openVenueDatabase` opens — and
writes through its venue file, the one every migration set is applied to. There is no
connection string, no cluster, no role and no grant: the directory IS the database. It takes the
path from `--venue-dir`, then from `WAITRON_VENUE_DIR` (the same variable `apps/server` reads, so a
box's own setting is what stands its venue up), then from a prompt.

The directory must already be **migrated** — boot does that (`apps/server/src/boot.ts` →
`applyMigrations`), and nothing here does. A directory nothing has migrated is refused
(`provisioning.database_unmigrated`), which is also what a mistyped path meets: opening a virgin
directory SUCCEEDS — it is created — so a read, not the open, is where a wrong path is caught.

**It STAMPS a migrated directory that carries no environment stamp**, from `WAITRON_ENV`: unset
means `preproduction`, `dev` means `preproduction`, and `production` has to be typed out in full
(CLAUDE.md §5 — a production invoice number is never reused, so the default that a mistake cannot
take back has to be the harmless one). Anything else is refused
(`provisioning.invalid_environment`), never rounded to the nearer of the two. This is what lets an
automated deployment stand a venue up with no browser and no setup wizard, which was the only path
that stamped before.

The stamp goes through `stampDeployment` (`@waitron/db`) — the same primitive the setup wizard's
handler calls in the same position (`provisionVenue`, `apps/server/src/provision.ts`) — so a
directory already stamped for the **other** environment is refused with `deployment.already_stamped`
and nothing is minted, and a directory already stamped for THIS one passes through untouched. It is
written after the confirmation prompt, never before: a stamp is permanent, so an operator who
declines leaves the directory exactly as it was found.

Run against the built bundle on 2026-09-22, each case against its own directory: a virgin one gave
`provisioning.database_unmigrated`; a migrated, unstamped one printed
`stamp this venue directory preproduction — permanent, from WAITRON_ENV`, minted the venue and its
SIF, and read back `"preproduction"`; the same with `WAITRON_ENV=production` read back
`"production"`; one stamped `production` under an unset `WAITRON_ENV` gave
`deployment.already_stamped {"stamped":"production","requested":"preproduction"}`, left the stamp at
`production` and left `tenants` empty; `WAITRON_ENV=prod` gave
`provisioning.invalid_environment {"variable":"WAITRON_ENV","value":"prod"}` without opening
anything; and declining the prompt left the stamp `null`.

The admin person is seeded with two login secrets, both **required** and both read from an
environment variable or an echo-off prompt, **never** from `argv`: a till **PIN** (`WAITRON_ADMIN_PIN`, for the counter POS) and a dashboard **password**
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

It reads what would be created, prints the plan headed by the venue directory and the environment
stamped on it, asks for confirmation (`--yes` skips it), applies, then prints the new `node` id and one
`seeded:` line per module seed that ran (the fiscal module's names its SIF id and installation
number). The SIF's `id_sistema_informatico` is **not** an option — it is the `WAITRON_ID_SISTEMA`
product constant (`W1`, owned by `packages/fiscal-verifactu`), which identifies Waitron's software,
not the venue.

`--territory` currently accepts only `ES-common` (common-territory Spain, Veri\*Factu with IVA); any
other value is refused with `fiscal.regime_not_implemented`. The pure `planVenue` also refuses a
`--locale` count outside one-or-two (`provisioning.invalid_locales`) and equal standard and
rectificative series codes (`provisioning.duplicate_series_code`) before the directory is opened. Before `planVenue` runs, the command reaches the fiscal regime's own venue-field seat, which
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

Three, handled differently, **none ever in `argv`**.

| Secret                   | How it gets in or out                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Credential key ring      | OUTPUT of `keyring` only. Printed once, acknowledged, then screen and scrollback cleared.          |
| Admin till PIN           | INPUT (`venue`). `WAITRON_ADMIN_PIN`, or an echo-off prompt. No flag. Hashed at the CLI boundary.  |
| Admin dashboard password | INPUT (`venue`). `WAITRON_ADMIN_PASSWORD`, or an echo-off prompt. No flag. Hashed at the boundary. |

There used to be a fourth — the admin connection string. The storage switch retired it: a venue is a
directory of SQLite files, so there is no password to carry and `--venue-dir` is an ordinary flag.
`--admin-url` is still **not** an option, and neither is `--password` or `--key`. `argv` is
world-readable in `ps` and lands in shell history, so the parser is `strict` and any such flag is a
parse error rather than something silently accepted — `src/cli.test.ts`'s "refuses any flag that
would put a secret in argv" and "refuses --admin-url as a flag, in both argv forms" are what keep it
that way, the second of those precisely because an operator reaching for the retired flag must not
have their old connection string quietly ignored.

Set the environment variables for a non-interactive run:

```bash
WAITRON_VENUE_DIR=/var/lib/waitron/venue \
  WAITRON_ADMIN_PIN=... WAITRON_ADMIN_PASSWORD=... \
  node dist/bin.js venue --country ES ... --yes
```

If nothing supplies the venue directory — no flag, no variable, and a prompt that answers nothing,
which is what an exhausted stdin or a Ctrl+D gives — the run stops with
`provisioning.venue_dir_missing`. It does not fall back to a default, and specifically not to the
empty string: every path the store builds is `join(directory, ...)`, so an empty one is the RELATIVE
`venue.db` and would mint a taxpayer, a node and its invoice series into whatever directory the
process was started from.

**Nothing this tool prints carries a secret.** The plan summary names the venue directory and the
environment stamped on it, both operator-supplied configuration, and the admin's PIN and password
appear nowhere — not in plaintext, not as a hash.

## What it refuses, and what to do about it

Every refusal is a structured code and its params on stderr — never a raw driver message.

| Code                                 | What happened                                                                                                   | What to do                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provisioning.venue_dir_missing`     | Nothing supplied the venue directory: no `--venue-dir`, no `WAITRON_VENUE_DIR`, and the prompt answered nothing | Set the variable, pass the flag, or answer the prompt. Refused rather than defaulted — see "Secrets" above for where an empty one would have written.                                                                                |
| `provisioning.invalid_country`       | `--country` is not two ASCII letters                                                                            | Type an ISO-3166-1 alpha-2 code, such as `ES`.                                                                                                                                                                                       |
| `provisioning.database_unmigrated`   | Nothing has migrated the venue directory — its venue file holds no `deployment` table                           | Boot the box against that directory first: boot migrates it. Then stop the server, because while it runs it holds the folder and `venue` is refused. This is also what a mistyped path gives, because a virgin directory opens fine. |
| `provisioning.database_in_use`       | Another process, usually the running server, holds the venue folder                                             | Stop that process (on a box, `docker compose stop app`), then re-run. The refusal comes before either database file is opened.                                                                                                       |
| `provisioning.invalid_environment`   | `WAITRON_ENV` is not `production`, `preproduction` or `dev`                                                     | Type one of those, or leave it unset for `preproduction`. `Production` and a space-padded ` production` are refused, never rounded.                                                                                                  |
| `deployment.already_stamped`         | The venue directory is stamped for the OTHER environment (`@waitron/db`'s code, not this package's)             | Stop. One database per environment is a fiscal invariant; a pre-production database that took production numbering leaves a permanent hole in the series. Point at the right directory, or fix `WAITRON_ENV`.                        |
| `provisioning.state_unreadable`      | The venue directory could not be opened, or its stamp could not be read. `reason` is the error's own code       | `ENOTDIR`: the path runs through a regular file. `ERR_SQLITE_ERROR`: the file is there and is not a database — a truncated or corrupt one; restore it from a backup. Both were run against the built bundle.                         |
| `provisioning.foreign_tenant`        | The venue already holds a DIFFERENT taxpayer                                                                    | Stop. One tenant per database is the isolation boundary — see the fiscal invariants below.                                                                                                                                           |
| `provisioning.venue_conflict`        | A concurrent run committed a conflicting row between this run's plan and its apply                              | Re-run. A same-venue re-run is a no-op.                                                                                                                                                                                              |
| `fiscal.regime_not_implemented`      | `--territory` names a fiscal regime with no module behind it                                                    | Today only `ES-common` is implemented.                                                                                                                                                                                               |
| `provisioning.invalid_locales`       | `--locale` was given no times, or more than twice                                                               | Give one or two.                                                                                                                                                                                                                     |
| `provisioning.duplicate_series_code` | `--series-code` and `--rectificative-code` are the same                                                         | Give them different codes; they are two separate series.                                                                                                                                                                             |

Waitron is not in production (CLAUDE.md §3, "no backwards-compatibility or data-migration code until
Waitron is in production"), which is the carve-out under which a code has twice been DELETED rather
than deprecated: SP-3c dropped `provisioning.id_sistema_invalid` when the software-id bound moved
into the fiscal module as `sif.id_sistema_invalid`, and the instance-path deletion dropped
`provisioning.role_over_privileged`, `role_unusable`, `role_creation_failed`,
`membership_grant_failed` and `grant_ineffective` along with the only code that threw them. The
venue command's own repointing dropped two more the same way — `provisioning.admin_uri_missing` and
`admin_uri_not_a_url`, which described a connection string this tool no longer takes, replaced by
`provisioning.venue_dir_missing`. Taking over the stamping dropped a fourth,
`provisioning.database_unstamped`: an unstamped directory is what this command now STAMPS, so
nothing was left to refuse under that name, and the case it really caught — a directory nothing had
migrated — is `provisioning.database_unmigrated`, which says so. The never-rename rule stands for
the day a venue is live.

The underlying driver error is deliberately not attached, not even as `cause`: Node's default
console formatting recurses into `.cause`, which would put a database's own words one level down
from where they were withheld.

## Known limitations

### A failure with no error code is still an opaque failure

A failure carrying no string `code` is rethrown untouched and reaches the operator as
`unexpected failure (Error)`. That is deliberate: it is not the engine's or the filesystem's verdict
on anything, and dressing it up as one would be a claim the code cannot support. The two failures
that DO carry one were measured against the real opener and are in the table above.

## Fiscal invariants this tool is bound by

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across, so pre-production sales would leave a permanent hole
  in the production series. `venue` stamps a directory that carries no stamp, from `WAITRON_ENV`,
  and refuses one stamped for the other environment — the refusal is `stampDeployment`'s own, not a
  second copy of the rule written here.
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
