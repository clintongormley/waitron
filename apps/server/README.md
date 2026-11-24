# `@waitron/server`

The host process. It boots from environment config, loads the credential vault's key ring, applies
every migration set behind the venue directory's own migration lock, resolves the AEAT transport and the card-provider
accounts, then runs fiscal submission and payment audits. An independent card loop
checks pending provider outcomes, recovers automatic captures through the existing till path,
releases stale payment marks and completes pending bill payments. It runs immediately and sleeps
at most one minute between passes; slow provider requests can extend a pass. Sale recovery and bill
completion run only on the primary. It also serves several HTTP routes on one Hono app:
`GET /health` (unauthenticated), the till API under `/api/*`, the management-dashboard API under
`/management-api/*`, and the inbound Stripe payments webhook at `POST /webhooks/stripe`.

This document is written for whoever deploys this process, not whoever reads its source.

**The one thing worth remembering before anything else:** `drain` carries a legal, hourly submission
duty under Spain's Veri\*Factu regulation (art. 16.4). On the main box, a `/health` response of `200`
with a `duties` object means a pass finished and each duty had a clean pass within its budget. A parked
payment-audit period reaches the status code only when the duty has had no clean pass since this
process started or within its budget, and the body's `parked` count shows it
only until the next recorded pass replaces it. The error-level `reconcile.run_parked` log line,
written by the pass that parks, is the signal to look for afterwards. It is **not** a claim that
every individual fiscal record has actually been accepted by AEAT. A database whose records reach AEAT but are individually rejected reads `200` with
`lastOkAt` refreshing every pass; that is visible only via `recordsHalted`/`incidentsRaised` in the
`drain.complete` log line, the `incidents` table, the case columns on `verifactu_submissions`, and the dashboard's alerts
bell and Alerts screen (as `fiscal.` alerts, among them `fiscal.filing_cases_open`, to anyone
holding `fiscal.view`), deliberately, not through this endpoint — see
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
every migration package's `drizzle/` folder beside the bundle, and ui-core's two token files under
`dist/node_modules/@waitron/ui-core/` (`scripts/copy-migrations.mjs`); `WAITRON_MIGRATIONS_DIR`
defaults to finding the folders there. Running `dist/server.js` without that copy step stops with an
error as it starts, not silently.

If your first setup is interrupted, direct and supervised startup can serve a restricted recovery
API before ordinary database opens or staged restore/reset work. It offers inspection
(`GET /setup-api/first-setup/resolution`), Start again's summary and Start again
(`apps/server/src/first-setup-entry.ts`, `mountFirstSetupResolutionApi`). Start again runs
over HTTPS only: it deletes the interrupted attempt, keeping no record of the invoice series names
it chose, and ends the process so its supervisor starts it again.
It needs no password. With the venue database missing it needs a confirmation that nothing was
filed or sold; with it partly unreadable, it needs the summary the page showed sent back unchanged.
The ordinary setup server serves only the stop (`POST /setup-api/first-setup/resolution/stop`,
`apps/server/src/setup-first-fiscal-api.ts`), over HTTPS: it refuses what Start again's summary
would refuse, marks a setup still at its `claimed` or `consumption-intent` step abandoned, deletes
nothing, and restarts the server, which then serves the repair page
(`stopForStartAgain`, `apps/server/src/first-setup-resolution.ts`).

Ordinary boot failures exit non-zero, but not all of them reach stdout the same way. A port that will
not bind logs a structured `server.listen_failed` JSON line (see ["Log events"](#log-events)) and
exits `1` directly. Bad config, an unloadable key ring, a mismatched deployment environment (see below), a
failed migration, and a venue directory that cannot be opened instead **throw**, and `bin.ts` has no `try`/`catch` around `startServerOrFirstSetupResolution` — Node prints the
`AppError`'s stack to **stderr** as an unhandled rejection and exits non-zero, not as a JSON line on
the stdout stream a log collector reads. (Catching those five in `bin.ts` and logging them
structurally the same way would be a real improvement; it is not done here — check stderr for those,
stdout for a bind failure.) Either way there is no "boots half-configured and retries in the
background": a supervisor (systemd, Docker's restart policy) is expected to restart the process, and
it will keep failing until whatever is wrong is fixed.

## Repairing the secure connection

If your box cannot serve its saved connection certificate, open its known HTTP address on the
venue network and choose **Set up secure connection**. The public page is also at
`/setup/connection`; interrupted setup opens it in a separate tab so your password draft stays in
place. The HTTP page offers managed certificate repair, a read-only **Check again** and **Stop**
for the current browser attempt. Do not enter a password, recovery key, box key or private certificate there.

Repair keeps the existing certificate authority when its certificate and signing key remain usable.
If your device already trusts that authority, keep its installed certificate. If the authority is lost
or unusable, the page tells you to install and trust the new public certificate on each device.
Follow the device's installation help, then open the HTTPS link and check that the page it opens
has no certificate warning before recovering setup. With a separately installed certificate,
check the HTTPS address and stop on a warning; this page cannot replace that certificate.
If your device blocks installation, use a venue device that permits it.

**Check again** reloads the public inspection without sending repair. **Stop** hides this attempt's
actions without another request; you can close the tab or check again. Both controls wait while a
repair request is pending. Without JavaScript, the page hides script-only actions and explains
how to enable them. If repair keeps failing, stop here: some certificate problems need a
repair this page does not offer. Authenticated certificate diagnosis/replacement and linked-layout
repair remain [open work](../../docs/backlog/box.md#authenticated-server-certificate-recovery).

Repair keeps its progress and private candidate in `flows/tls-repair/` and replaces the
previous repair copy in `tls/repair/`. A start that stays healthy for two minutes removes
both folders. The certificate and its private key share `tls/server.pem`, with the certificate
first, so replacing the leaf takes one file replacement. It does not recreate the vault or change the
setup attempt, recovery records or fiscal identity. The public HTTP guide stays available while you download
and install the certificate, even if the repair answer was lost. Choose **Reconnect** when you are
ready. A supervised process then restarts after sending that answer; a direct process repeats its
admission checks internally. The guide retains its public certificate download when you open HTTPS.
If that handoff fails,
reopen the public page and choose **Reconnect**. Healthy certificate files are not rotated by that
retry. Other boot failures can still prevent the application from starting.

HTTP does not authenticate the server or the person requesting repair. The Origin and empty-body
checks reject ordinary cross-site browser submissions; they do not protect against a hostile network
participant or an arbitrary HTTP client. Use your known server address on the venue network, and
keep all private recovery work on trusted HTTPS. Filesystem flushes and the shared recovery lock
coordinate Waitron writers, not an administrator editing the files or a failed disk.
Repair refuses a linked TLS folder or linked managed file. A healthy linked folder can still serve
HTTPS; repairing a damaged linked layout from this page remains an open limitation.

A new network address alone does not block startup when the saved certificate still covers the
box's fixed hostnames. Use its hostname to reconnect; the public repair action can add current
addresses under the retained authority. An interrupted repair refreshes an outdated saved leaf
under the same reserved authority before continuing.

## The venue directory

There is no database server, no connection string and no database role. One process opens **one
directory**, and that directory is the whole database: `openVenueStore`
(`packages/store/src/index.ts`) creates `venue.db` and `node.db` inside it, each with write-ahead
journalling, foreign keys on and a busy timeout. The operating-system permissions on that directory
are the whole of the access control; there is nothing to `GRANT`, and nothing that could be granted
too widely. While a primary streams to a bucket, the server's own Litestream child
also opens `venue.db`, and takes no lock ([conventions-data.md](../../docs/developers/conventions-data.md), "Litestream is a second
process on `venue.db`").

**The node migration set is applied to `node.db`, and every other set to `venue.db`**
(`packages/migrations/src/apply.ts`). `node.db` holds what this box must remember about itself:
its mode and singleton role, its link to the main box, the main box's key it pinned when it joined,
its recovery-key check, its sealed signing key, and its records of the handovers it took part in
(`packages/node-db`). So a spare holding a copy of
the main box's `venue.db` still knows who it is. Only `venue.db` is streamed to a bucket; a backup
file carries `node.db` whole as `node.dump`. Every other `local` table sits in `venue.db`
([conventions-data.md](../../docs/developers/conventions-data.md), "A `local` row belongs to one
node").

The box keeps these databases in `venue` under `WAITRON_STATE_DIR`. Put the state folder on durable,
protected storage: it holds the fiscal records. For development, `WAITRON_VENUE_DIR` can override
the venue folder through the process environment; the box's persisted environment files do not
supply that override (`box-env.ts`).

Migrations run at every boot, over that directory. Two migrators starting together queue on a
third SQLite file, `migrations.lock`, which the migrator holds an open transaction on for the
length of the run — a second migrator waits up to two minutes and is then refused
`database is locked`. It is a SQLite file rather than an exclusively-created lock file on purpose:
closing the connection releases it, and so does killing the process, where a plain lock file would
survive the crash and wedge every later boot. #489's version of `packages/migrations/src/apply.ts` records
the races run to decide both. Only the migrate step waits: opening the folder is guarded separately
by `venue.lock`, so a second process that opens it WITH the lock while another holds it, a second
server included, is refused `provisioning.database_in_use`; the tools meant to run beside the server
open it without the lock ([conventions-data.md](../../docs/developers/conventions-data.md), "One process per venue folder").

`applyMigrations` also installs each set's **append-only triggers** as it goes, from the table names
that set declares. Those are SQLite `RAISE(ABORT)` triggers (`packages/store/src/append-only.ts`),
and they are what makes a ledger row unrewritable now that there is no `REVOKE` to lean on. It
removes the live-update triggers (`removeChangeFeed`) before migrating, and `installChangeFeed` in
`apps/server/src/boot.ts` installs them again.

### The deployment-environment check

Before `applyMigrations` runs — before any write at all — `startServer` opens the venue directory
on its own short-lived handle and compares this host's `WAITRON_ENV` against the `deployment`
table's own stamp, throwing `deployment.environment_mismatch` (see "Running it" above) rather than
letting a host boot against another environment's database. That probe is closed again before
migrations start. With `WAITRON_ENV` unset, a box whose join to another box stopped after its first
write compares the environment that join recorded instead (`withUnfinishedJoinEnvironment`,
`apps/server/src/unfinished-join.ts`), so it starts in setup, where the join can be reset.

**What actually writes the stamp.** Three paths do, and all call the same programmatic
`stampDeployment` (`@waitron/db`) rather than writing the row themselves. The browser setup wizard's
provision handler does it (`provisionVenue`, `apps/server/src/provision.ts`), from the demo/live
choice the operator made. Its adopt handler does it (`adoptFromPrimary`, `apps/server/src/adopt.ts`),
from the environment in the primary's bundle. `waitron-provision venue` does it for a directory that
carries no stamp, from `WAITRON_ENV` — unset means `preproduction` and `production` has to be typed
out in full — which is what lets an automated deployment stand a venue up with no browser. None can
move a stamp that is already there: `stampDeployment` refuses a different value with
`deployment.already_stamped`, and provision and `waitron-provision venue` let it propagate; adopt
reads the stamp first and throws that code itself, before its first write.

An unstamped database still permits an empty setup. On a production start, the enabled fiscal
module also reads its retained history before migrations. Veri\*Factu refuses a record generated
for preproduction or with no recorded environment, using `deployment.environment_mismatch`.
This prevents you from promoting test invoices into a production series. Production-only history
passes this probe. Run `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts`
for the empty-setup, both history controls and the real boot refusal that preserves the rows.

## Provisioning a venue

`waitron-provision venue` creates the business rows a sellable venue needs — the taxpayer row, the
venue, a node, and the invoice series for simplified invoices (tickets), full invoices and the correctives of each — and runs every enabled module's
seed for that node, the fiscal one registering it as a Veri\*Factu SIF, in one transaction. It replaced the retired `apps/server/sql/bootstrap-tenant.sql` (see "What actually
writes the stamp" above for why that file was removed).

On the A679 candidate, set `WAITRON_STATE_DIR` and choose an absolute `--recovery-pdf`
destination outside state and venue storage. The command owns the setup attempt and asks the box's
internet time service whether it is synchronised; it asks nothing about the clock or recent setups, and when the name
must wait it prints the time it carries on at and waits in the same run. The destination must not
already hold a file: the command never writes over one, and refuses before it records anything. It
requires password and kept-PDF confirmation; `--yes` does not answer the retention question, and a supplied JSON allocation is
not Live authority.
Follow the [current setup procedure](../../docs/operations/first-live-fiscal-setup.md).

It runs **against a directory something has already migrated**, and stamps that directory itself
when it carries no stamp (see "What actually writes the stamp" above). Stop the server first: while
another process (usually the server) has the folder open, `venue` is refused with `provisioning.database_in_use`. A directory nothing has
migrated is refused with `provisioning.database_unmigrated`, and one stamped for the other
environment with `deployment.already_stamped` — one database per environment is a fiscal invariant. It opens the venue
**directory** — `--venue-dir`, else `WAITRON_VENUE_DIR` (the same variable this server reads, so a
box's own setting is what stands its venue up), else a prompt — and writes through `venue.db`. There
is no connection string, no role and no grant to widen: `applyVenue` writes in one transaction. A database
already holds one taxpayer, so a run naming a different country or tax id is refused with
**`provisioning.foreign_taxpayer`** — that is the code an operator who mistyped a NIF on a re-run
sees, and the refusal happens before anything is applied. The country and tax id are trimmed and
upper-cased before that check, so a difference of letter case or surrounding space is the same
taxpayer and the re-run is a no-op. (`provisioning.taxpayer_identity_mismatch` is a different,
narrower refusal, raised inside the apply transaction only when another run commits a different
taxpayer between this one's read and its write. A mistyped NIF is `foreign_taxpayer`, not this.)

```bash
pnpm --filter @waitron/provisioning build   # once — produces dist/bin.js, and that is the whole build
WAITRON_VENUE_DIR=/var/lib/waitron/state/venue \
WAITRON_ADMIN_PIN=1234 \
WAITRON_ADMIN_PASSWORD='choose-a-strong-one' \
  node packages/provisioning/dist/bin.js venue \
    --country ES --tax-id B12345678 --legal-name 'Deli SL' \
    --taxpayer-domicile '8 Taxpayer Street, 28013 Madrid' \
    --venue-name Counter --territory ES-common --locale es-ES \
    --address-line1 '1 Main Street' --postal-code 28001 --city Madrid --province Madrid \
    --time-zone Europe/Madrid --day-cutover 06:00 \
    --series-code A --full-series-code FF --corrective-series-code R \
    --full-corrective-series-code RF \
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
so the provisioned admin can sign in immediately.

Most options are prompted for when omitted. `--full-series-code` (default `F`),
`--full-corrective-series-code` (default `FR`), `--admin-first-names` and `--admin-last-names` are
never prompted for, so an existing non-interactive script gains no new question. `--yes` skips the
confirmation for a non-interactive run. The SIF's `id_sistema_informatico` is **not** an
option — it is the `WAITRON_ID_SISTEMA` product constant (`W1`), because it identifies Waitron's
software, not the venue. The venue directory carries no password, so it is an ordinary
`--venue-dir` flag; the two login secrets stay out of `argv`, and the parser rejects the retired
`--admin-url` outright rather than ignoring it, so an operator reaching for the old connection
string is told instead of having it dropped on the floor. See
[`packages/provisioning/README.md`](../../packages/provisioning/README.md) for the full option list,
what the command prints, and what it refuses.

## Rejoining a returned box

A replaced main box is normally reset from the new main box: **Wipe and remove** on its row in
**Servers** orders the reset, and the old box carries it out the next time it reaches the main
box ([guide](src/guide/en/servers.md#old-box-returns)). Ordered before its invoice records and working hours are
all back, the order accepts the loss: the old box tries once more to send them, then sets its databases
aside instead of deleting them.
A box that never receives the reset order — one removed from the venue, or one whose order stayed
on a main box that was itself replaced — is reset from a terminal with
`sudo bash waitron.sh reset --force-production` (see
[`deploy/README.md`](../../deploy/README.md#resetting-a-box)), which wipes it back to setup's
first page.

When a failed on-prem box is replaced by a promoted cloud primary and later comes back, it returns as a
FENCED ex-primary (membership rejoin R1) — it cannot sell, because the cloud is now the serving primary.
`waitron-rejoin rejoin` wipes that box's local database so you can re-adopt it as a secondary of the
current primary. After checking the held chart, it removes any pending restored-first-start marker
before wiping the database. If that removal fails, your database and `trading.env` stay in place.
There is no artifact input: the wipe deletes both database files, their write-ahead
sidecars and Litestream's `.venue.db-litestream/` folder out of the venue directory
(`src/db-wipe.ts`; a committed row can live in a `-wal` file alone, so the sidecars go too — see
`SIDE_FILE_SUFFIXES` in `packages/store/src/index.ts`),
re-migrates the directory from source and clears `trading.env`. You then re-adopt the box from setup. The old restore must not reissue a certificate or
sign another membership term for the replacement database.
The whole command runs holding the venue folder's lock (`venue.lock`). `migrations.lock` and
`venue.lock` (with `venue.lock-journal` while it is held) are deliberately left in place: they hold no
data, and removing either would let a second process take a fresh lock beside the one holding it.
`venue.holder.json`, which names the process holding `venue.lock`, is left in place too.

```
waitron-rejoin rejoin [--accept-loss]
```

It reads its own boot env — `WAITRON_STATE_DIR`, `WAITRON_VENUE_DIR` (both resolved exactly as
`config.ts` resolves them, so an empty value takes the default rather than the working directory),
`WAITRON_ENV` and `WAITRON_NODE_ID`. Three ordered refusals come before the wipe:

- **`provisioning.database_in_use`** — another process, usually the running server, is using the venue
  folder. Refused before anything is read or wiped; stop the server first.
- **`rejoin.not_fenced`** — the box is not a fenced ex-primary; only a fenced one is safe to wipe.
- **`rejoin.no_carrier`** — the held membership chart names no serving-primary to re-adopt from, so there
  is nowhere to rejoin.

The last two refuse LOUD rather than wipe a box that is not safe to wipe.

**What this command does not check.** It does not confirm, before wiping, that every row this box
originated has reached the carrier (`rejoinAsSecondary`, `apps/server/src/rejoin.ts`). So rejoin
wipes without that confirmation, and `--accept-loss` waives nothing: it only records the operator's
acknowledgement in the log. The wipe is irreversible (CLAUDE.md §5).

## Remote staff entrance

Connect your test box to Cloud. Cloud assigns the staff hostname.
The box requests and renews its certificate with a key kept under `WAITRON_STATE_DIR`.
On the box, Compose sets `WAITRON_STAFF_SOCKET` to a socket in the tunnel's shared volume.
For a standalone server that uses TCP, set `WAITRON_STAFF_HOST` and `WAITRON_STAFF_PORT`.
They default to loopback and 8443.

The staff listener starts with a valid installed chain, or after the first certificate arrives.
While a renamed certificate is pending, it keeps the last accepted name and chain, including after
a restart. Once the replacement is accepted, new requests use its name. When remote access is off,
withdrawn or revoked, every staff HTTP request returns 404; an existing listener still completes TLS.
Production boxes and mirrors do not open this entrance.

The separate HTTPS listener serves dashboard pages at `/` and their root paths directly from the built app.
It forwards the management API, the dashboard's box and backup API groups, theme and content-language
reads, help and legal pages, and `GET /public/availability` (Cloud's public gate asks it there) to the main app. Till and setup paths return 404, as does a request for another origin. Requests through it are remote even when the gateway connects over
loopback. Use your usual password; enrol passkeys separately for the staff hostname. The staff roster
requires a signed-in session through this entrance. Dashboard images are served read-only;
membership, box joins and promotion operations stay off it. Sign-in bodies are limited to
64 KiB and the entrance permits twenty anonymous passkey challenges per minute. Password
backoff is shared with LAN sign-in: remote wrong guesses can temporarily block local password
sign-in for that same email address. Register the staff origin's `/management-api/google/callback`
with Google before using Google sign-in there.

Before the first automatic certificate arrives, the staff entrance waits quietly. A broken TLS
file or a staff port that will not bind is logged as `server.listen_failed` with `listener: staff`;
it does not stop the local listener. A later certificate pass retries a failed staff port. The staff listener closes with the server.
Setup, recovery, restricted starts and mirrors do not open it. The companion waits for the staff
socket before accepting connections. Public demo qualification of certificate renewal remains open
in A951-S.

## Environment variables

Use the [environment inventory](../../packages/shared/src/environment-variables.ts) to find a
setting's source, default and accepted values. The [print agent's inventory](../print-agent/src/config.ts)
covers its own settings.

A box keeps its deployment identity in `trading.env`, its credential keys in `secrets.env`, and
its backup recovery key and rotation date in `backup.env`. Each file supplies only the names it
owns. A non-empty process value takes precedence over a value from a file.

`WAITRON_ENV` defaults to `preproduction`. Set `production` explicitly for a Live deployment.
The environment selects the fiscal endpoints and the card credential mode. At startup, the box
checks it against the database. A build without a numbered release version refuses a production
start with `server.unreleased_build`. See [The venue directory](#the-venue-directory).

Preproduction fiscal submission is off by default. A dedicated integration target can set
`WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`; a Demo or Prepare installation still refuses to drain even
with that switch present. Production always runs the fiscal drain. On a Demo or Prepare box, or a
preproduction box without that switch, the dashboard leaves out the records-waiting alert
(`fiscal.submission_delayed`); the stopped, filing-case and repeated-refusal alerts still show.

Demo and Prepare use the local card simulator by default. To exercise a card provider's test
account on a Prepare box, configure its test credentials in **Modules**. On **Card payments**,
open **Settings**, turn on **Use card providers' test accounts** and save. Demo uses the simulator.

### The four `WAITRON_CREDENTIALS_KEY*` variables, in full

These are **not** parsed by this package's own `config.ts`: `loadKeyRing`
(`packages/credentials/src/keyring.ts`) owns all four names and their validation, so this list
exists here only so an operator does not have to go looking for it:

- **`WAITRON_CREDENTIALS_KEY`** (required) — base64-encoded, exactly 32 bytes decoded. The current
  encryption key every credential read/write uses.
- **`WAITRON_CREDENTIALS_KEY_VERSION`** (optional, default `1`) — the version number stamped on rows
  sealed with the current key.
- **`WAITRON_CREDENTIALS_KEY_PREVIOUS`** / **`WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION`** (optional,
  but both-or-neither) — set only during a rotation window, so rows sealed under the previous key
  still decrypt while `rotate` re-seals them under the current one. Setting one without the other is
  a boot-time `credentials.key_ring_incomplete` failure, not a runtime surprise later.

Any of the four set non-empty in the environment wins over `secrets.env` at every start, in setup
mode as in trading (`loadBoxEnv`, `src/box-env.ts`). So joining another box as its spare refuses
`mirror.vault_key_differs`, before writing anything, while one of them differs from the main
box's ring, and a Start again Move's copy of the ring holds the environment's values.

Use `waitron-credentials` to provision and rotate credentials (`fiscal.aeat`,
`payments.stripe`, `payments.sumup`), for example
`waitron-credentials set --purpose fiscal.aeat` with the JSON payload on stdin. That CLI refuses a
`--tenant` flag because one database holds one taxpayer. Run
`waitron-credentials` with no arguments for its own usage text (`set` / `list` / `delete` /
`rotate` — `packages/credentials/src/cli.ts`'s `USAGE` constant); there is no `get`, since that CLI
never prints a decrypted credential. A `fiscal.aeat` certificate written with this CLI records no
install; see
["Installing or replacing the AEAT certificate after setup"](#installing-or-replacing-the-aeat-certificate-after-setup)
for what that leaves out of date.

For outgoing mail, you can read a Prepare or Live trading server's redacted settings through
`GET /management-api/email/settings` with `system.manage`. An admin can save settings with `PUT`
or remove the saved relay with `DELETE` at the same address. Removal returns `{ removed: true }`,
including when no relay is saved. `POST /management-api/email/settings/test` requires
`system.manage` and sends a test to the signed-in person's address without saving the proposal.
The read omits authentication secrets and shows saved settings even when development invoice email
is captured locally. Demo refuses settings changes, including removal.
The Prepare and Live setup test endpoint is `POST /setup-api/email-test`; it refuses settings with no
`user` (`email.settings_invalid`, field `user`) before connecting, and answers
`email.test_login_required` without sending when the server offers no login. Outside development, Prepare and Live provisioning require an `email` object with
`server`, numeric `port`, `encryption` (`starttls` or `tls`), `from`, and optional `user` and
`password`. Use the same values you tested. Before publishing the trading configuration, the
server seals the connection URL under `email.smtp` and saves the sender address in the `mail`
settings document in the same transaction. Missing settings answer `setup.email_required`, naming
`email`; malformed settings name the offending field. Demo refuses supplied settings,
and development provisioning may omit them. You can enter these settings in the Prepare or Live wizard
or, as an admin, on the dashboard's **System → Email** page (`/email`). Managers can view
the redacted settings there. The dashboard shows the server and sender
without returning the saved password; you enter fresh credentials to change an authenticated
gateway, or explicitly switch authentication off.

### Installing or replacing the AEAT certificate after setup

The setup wizard installs the first AEAT certificate. After that, a manager or administrator
installs or replaces it on the dashboard, under Venue settings → Venue details → AEAT certificate.
The card behind it uses `GET /management-api/fiscal-certificate`, which needs `fiscal.view`, and
`POST /management-api/fiscal-certificate`, which needs `system.manage`
(`src/fiscal-certificate-api.ts`). Boot mounts both only when the enabled fiscal module offers a
certificate seat, which today means Veri\*Factu. The read answers `filing: false` on a box that does
not send records to AEAT: a Demo or Prepare box, a preproduction box without
`WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`, or a node that is not the primary. On such a box the POST
is refused with `fiscal.certificate_not_used` (409).

The POST body carries `pfxBase64`, `passphrase`, `certKind` (`sello` or `representante`) and
`expectedRevision`, the revision the card read. Before anything is replaced it checks, in order
(`installCertificate`, `packages/fiscal-verifactu/src/certificate-install.ts`):

1. the file is at most 100 KiB;
2. it opens with the passphrase, is not encrypted with the old RC2 scheme, and holds a private key;
3. it is already valid and not yet expired;
4. it is not the certificate already installed;
5. the company tax ID it carries, when it carries one, is the taxpayer's;
6. AEAT answers a read-only query (a `consultar`, which files nothing) made with it, at the address
   for this environment and certificate type, within 30 seconds.

A refusal is the request's normal answer, `outcome: "refused"` with a `reason` and, where it
belongs, the `field` it concerns. When every check passes, one transaction seals the certificate
under `fiscal.aeat` and records the install, unless the vault changed after the card was read, which
is refused with `fiscal.certificate_changed` (409). The next filing pass reads the new certificate,
so no restart is needed.

`waitron-credentials set --purpose fiscal.aeat` still writes the certificate, but it records no
install. The dashboard card, the expiry alerts and the reminder emails read the latest install
record, so after a write from the command line they go on describing the previous certificate. Use
the dashboard unless you have no other way in.

You can also open **Diagnose connection** from the card or a refused replacement. **Read again**
inspects the selected material locally; **Run check** sends one read-only query. Both use
`POST /management-api/fiscal-certificate/diagnose`, mounted only when the seat supplies both
diagnostic methods and boot supplies its runner. This route requires `system.manage` and filing
eligibility, checks authority before admission and before releasing evidence, and does not update
the session's last-seen stamp. The ordinary card GET remains a separate read.

The diagnostic child has 30 seconds for opening, connecting and reading, a 1 MiB reply cap and two
seconds for cleanup. Stop, disconnect and session expiry cancel the attempt. The runner keeps
admission until the recorded child exits; a second attempt is refused rather than queued.
Diagnosis does not install material, drain fiscal records or repair network settings. Copy returns
a fixed diagnostic summary without raw errors, certificate subjects or secret material. An HTTP
status or a completed query does not establish the cause of a refusal or a later filing's outcome.
Use the separate editor's Save to install; it still runs its own checks.

To check a real certificate against AEAT with the same code an install runs, without installing it,
run the operator harness `src/aeat-certificate-check.preprod.test.ts`. It sends one read-only
`consultar` and files nothing. Set:

- `WAITRON_CERT_CHECK_PFX_BASE64`: the .p12/.pfx file, base64-encoded
- `WAITRON_CERT_CHECK_PASSPHRASE`: its passphrase
- `WAITRON_CERT_CHECK_KIND`: `sello` or `representante`
- `WAITRON_CERT_CHECK_ENVIRONMENT`: `preproduction` or `production`
- `WAITRON_CERT_CHECK_NIF`: the taxpayer's tax ID
- `WAITRON_CERT_CHECK_LEGAL_NAME`: the taxpayer's legal name
- `WAITRON_CERT_CHECK_ADDRESS_KIND` (optional): `sello` or `representante`, to send to that type's
  address instead and see how AEAT answers the wrong type

```sh
pnpm --filter @waitron/server test:preprod --reporter=default src/aeat-certificate-check.preprod.test.ts
```

`--reporter=default` is there because under an AI agent Vitest hides a passing test's console
output, which is all this suite produces. With any required variable unset or empty the suite is
skipped and makes no network call.

### Account email

Password-reset, invitation and email-change messages are queued and sent by the box’s mail sender; each link or code is made when it is sent.

Outside development, Demo captures account email, reminders and alerts in Mailpit even when an SMTP relay is saved. Sign in as an admin and open the
**Email inbox** link in the dashboard's top bar to read a message and follow its account link.
Prepare and Live use the saved SMTP relay; without one, account email is unavailable. Development
boxes use the saved relay for account email when present and capture it otherwise. The inbox is served through Waitron's authenticated API;
Mailpit's own ports bind to the box loopback only.

Captured account email is visible only to admins because it carries password-reset and invitation
links. Managers see the delivery mode without captured messages. Changing the saved SMTP relay
also needs an admin: account links go through that relay. Managers can read its redacted settings
and send a test to their own address.

Changing a role to or from admin retires unused account links, so an earlier invitation or reset
cannot gain admin access. Send a new invitation or request a new reset after the role change.

`pnpm dev:setup`, `pnpm dev:reset`, `pnpm dev:onboard`, `pnpm dev:reset:onboard`, and the `wa-wt`
worktree launcher also start Mailpit. During local development you can inspect its own UI at
`http://127.0.0.1:8025`. The development venue is a directory of SQLite files under the same state
directory the server resolves, and `dev:reset` removes that directory so the next run provisions
from scratch. Nothing in Compose holds venue data, so no `docker compose` command resets anything.

Fresh developer venues use English administrator and device names. Reusing a saved demo keeps its
recorded names, while the terminal lists the names from the current seed. To rebuild that demo's
practice data with the current names, run `wa-wt reset demo <worktree-name>` (Claude, for its own
copy: `wa-wt reset own demo <worktree-name>`).

For a new Prepare or Live venue outside development, the setup wizard asks for the mail server
settings and sends a test message to your administrator address. Continue becomes available when
the server accepts a test of the current settings. In Prepare on a configured test box, you can
choose Cloud staff email and leave the mail server blank. When you enter a mail server, final
setup seals the connection URL in the credential vault and saves the sender address in the mail
settings document.

Ordinary outgoing SMTP mail and the Settings test use the venue name as the sender display name,
keeping the configured mailbox. Settings shows the saved From value so you can repair it when
it cannot be used for delivery. Setup tests and local capture keep their own sender.

Set up SMTP through the wizard; use the dashboard's **Email** settings to change or remove it.
The credentials tool refuses SMTP changes because the connection URL and sender address must
be saved or removed together.

The server reads this credential when it sends, so rotating it does not require a restart. Configured
SMTP takes precedence over local account-email capture in development. Ordinary Prepare and Live
installations never fall back to Mailpit: if SMTP
is missing or the relay is unavailable, creating a person still succeeds and reports that the
invitation was not sent; password-reset requests continue to return their generic accepted response.
Once SMTP is restored, request another reset or resend the invitation from Users.

`WAITRON_MANAGEMENT_ORIGIN` determines the link host. It must use HTTPS unless it is a loopback
development origin; the server refuses an insecure LAN or public origin at boot.

Waitron shows the restaurant's privacy notice page in the emails it sends staff to set up an
account, reset a password or confirm a new email address, on the dashboard's sign-in page and the
pages an email's link opens to set up an account or reset a password, in **Account settings** and
in the `README.txt` of a data download. It is set on the **Privacy** card in **Venue settings →
Venue details**; there is no environment setting for it. The Privacy card's email and page also
appear in the email that sends a full invoice.

### Optional Google login

Set `WAITRON_GOOGLE_CLIENT_ID` and `WAITRON_GOOGLE_CLIENT_SECRET` together to offer Google login.
Create a web OAuth client in Google and register this exact redirect URI:

```text
<WAITRON_MANAGEMENT_ORIGIN>/management-api/google/callback
```

The server refuses a partial client configuration. A person links Google from **Account
settings** before the public Google button can identify their Waitron account. Waitron stores
Google's stable subject identifier and does not retain Google access or refresh tokens. Password,
passkey and PIN login keep working when Google is unavailable.

## Backup archive settings

Configure encrypted backup archives on the dashboard. Save stores the destinations, schedule,
retention and time limit in the venue database's `backup` settings document. Bucket-copy choices
share that document. Only each bucket's access key and secret key are sealed as credentials. With no saved record, no archive runs. The stale threshold is two days.

Use **Backups** to save or remove these settings. The credentials tool refuses backup changes
because the bucket keys and the backup choices must be saved or removed together.

The dashboard writes the recovery key and its rotation time to `backup.env` under `WAITRON_STATE_DIR`.
The box reads that file along with its other env files; a process-environment key still takes precedence.

Rotating the recovery key from the dashboard writes the new key and rotation time to `backup.env`,
then stores the same archive settings again under a new revision, so every destination and the
schedule are kept. If that second write fails, the new key is already in effect: the route answers
`backup.rotation_metadata_failed` and the old key is not put back. A stored record that cannot be
read is never rewritten: rotation then changes only the key, and answers the read's error code as
`loadErrorCode`.

The stream tests (`src/stream-loop.e2e.test.ts` and `src/stream-pause.e2e.test.ts`) run the bucket
copy against versitygw, a local stand-in for S3. The same loop runs against Amazon S3 itself only in
the hand-run rehearsal: see [aws-backup-rehearsal.md](../../docs/developers/aws-backup-rehearsal.md).

Duty timings and scheduler limits use `DEFAULT_DUTY_TIMINGS` in `src/config.ts`.
The box uses those defaults; tests can pass a partial `timings` option as the third argument to
`startServer`. Log rotation uses `LOG_MAX_BYTES` (10 MB) and `LOG_MAX_FILES` (five files).

## What `/health` means

`GET /health` is unauthenticated — no metrics, no auth, no readiness/liveness split. It is
one of several routes the process serves (the till API under `/api/*`, the management-dashboard API
under `/management-api/*`, and the Stripe webhook at `POST /webhooks/stripe` share the same
Hono app). If the response contains `duties`, the main box returns `200` after the first pass if
each duty has succeeded within its staleness budget. A joined spare completes an empty first pass,
then returns `200` with both duties marked `stale: false` in that response. During the join, follow
copy progress at `/api/box/status`. After restart, read the copy's size and time in the
`spare.first_copy_ready` log line.

For example, a main box with stale filing work responds with `503`.

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
    "payments.reconcile": {
      "lastOkAt": "2026-07-26T09:14:02Z",
      "consecutiveFailures": 0,
      "skipped": 0,
      "parked": 0,
      "stale": false
    }
  },
  "jobs": {
    "menu.activation": {
      "kind": "job",
      "detail": null,
      "state": "waiting",
      "judged": false,
      "lastTurnAt": "2026-07-26T09:14:02Z",
      "lastRunAt": "2026-07-26T09:14:02Z",
      "lastOkAt": "2026-07-26T09:14:02Z",
      "consecutiveFailures": 0,
      "failingSince": null,
      "throwsSinceClean": 0,
      "throwingSince": null,
      "nextDueAt": null
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

A box that takes no sales answers `200` with only `{ "ok": true, "tradingAvailable": false }`:
trading is not admitted yet, the box has stepped down and started restricted
(`src/restricted-start.ts`), or it is waiting for the other box (`src/waiting-start.ts`).

Use `jobs` to see the runner's recurring work. Scheduled menu activation runs there,
with retries after a failure starting at five seconds and doubling up to five minutes.
Scheduled archives run as `backups.scheduled` on the primary. Saving backup settings wakes
that job; its first pass after a reload takes a copy, then waits for the next scheduled time.
The copy still runs on the main thread.
The sealed-key copy runs as `backups.sealed_state`, woken by node database commits.
Closing refreshes that copy once more before closing the node database.
Services appear in the same map with `kind: "service"`. The bucket copy is `stream`:
`running` means its host has started a copy, `waiting` means it applies but cannot run
(the reason is in `detail`), and `not_applicable` means it is inactive on this box.
Jobs have `detail: null`. Role-dependent jobs recheck the role on each turn. Services recheck
whether they apply once a minute. A mirror that takes over also restarts. When the duty table
closes, runner jobs stop together first and services stop last, so the bucket copy can finish
copying writes made during close.
A commit that queues a new local fiscal record wakes `fiscal.drain`. A manager's retry and the
arrival of returned invoices wake the same job. Payment reconciliation runs as `payments.reconcile`,
so filing can carry on during a slow payment check. The optional `fiscal.reconciliation` job checks
the tax agency's copy on a filing primary.

Job state omits error and alert codes. `duties` and `lastPassAt` decide the health status.
`lastPassAt` records when the most recently completed filing pass began, including an empty
pass on a secondary.

`venueHolder` is read from `venue.holder.json`, the file a monitored venue holder
keeps beside `venue.lock`. It gives the holder's kind, when it took the folder, its last heartbeat,
and whether that heartbeat is stale, meaning 30 seconds or more away from the current time in
either direction. That is the parser and the limit a refused start uses (`src/node-entry.ts`). It is `null` when there is no readable file, carries no process id or host,
and never changes the status code.

`stream` is the bucket copy. It reads `{ "state": "off" }` when no bucket copy is set up on this box,
or the box is not the primary. When one is set up but did not start it reads `off` with a `reason`
(`no_membership`, `start_failed`, `reseal_required` until the sealed secrets can be refreshed,
or `first_start_pending` while a restore's first start is
unfinished, which holds the copy) and a `stateSince`. Otherwise it is the running copy's own status:
its `state` (`opening`, `streaming`, `paused`, `refused`, or `off` with the reason it stopped),
`lagMs` (how long the oldest change not yet in the bucket has waited), `lastConfirmedUploadAt` (the
newest file seen in the bucket, by the bucket's clock) and `bucketProblem`. The name of the
generation being written is left out, because it carries the node id. `stream` never changes the
status code: the container's healthcheck reads it (`deploy/compose.yml`), and an install or update
waits for a healthy container (`deploy/waitron.sh`), so a bucket outage must not hold either. The
dashboard's alerts report the bucket copy instead.

A `503` means the filing job has yet to complete its first pass, or a duty reads
`stale: true` because its last success was outside its budget or it has never succeeded. If the
duty's `consecutiveFailures` is rising, check for a skipped or parked item and look for
`duty.failed` and the matching code in the logs. If its job still shows `running`, the pass
has yet to finish. Compare its last successful run with the most recent `drain.complete` or
`reconcile.complete` line.

**`skipped` > 0 is not a `503` by itself while the duty's last success is within its budget.** A
duty that has skipped on every pass since this process started has no `lastOkAt`, so it reads stale
and answers `503` at once. A skip means this database's due fiscal
work (or, for `payments.reconcile`, one duty's sweep) could not be attempted THIS pass,
even though the pass itself completed and the other duty was served. `consecutiveFailures`
increments and `lastOkAt` does not advance for as long as anything is skipped. Find why
via the `drain.skipped` / `reconcile.pair_skipped` log lines (next section); the most
common cause is a missing, unreadable, or stale-shaped credential.

**`parked` > 0, `payments.reconcile` only, is not a `503` by itself while the duty's last
success is within its budget.** The pass that parks counts as a failure (`consecutiveFailures` goes
up and `lastOkAt` does not advance), and the next clean pass clears it. The status code turns `503`
when no clean pass comes within the duty's 26-hour budget, or at once if the duty has had no clean
pass since this process started. A park means a payment-audit run exhausted
`DEFAULT_DUTY_TIMINGS.scheduler.maxAttempts` (default 3) for that (duty, period), and a fresh run of the same
period is queued for a day later (`retryParkedAfterMs`, `src/reconcile-duty.ts`), unlike a
`skipped` pair (which retries within one
`DEFAULT_DUTY_TIMINGS.skipRetryMs` interval, folded as a minimum against an earlier gate) or a `failed` one (which retries on its own backoff and does NOT flip this field —
see `src/pass.ts`'s own comment on why). `fiscal.drain` has no equivalent terminal outcome at
all — a rejected or held fiscal record is a different, already-persisted signal, deliberately not
fed into `/health`: a record AEAT rejected, or a cancellation set aside because AEAT rejected its original, gets a row in the
`incidents` table and a filing case on the submission row (open ones raise the `fiscal.filing_cases_open`
alert), except that the hourly retry of a chain held by a run of rejections, rejected again with
the run's code, gets the filing case and no incident; a record held behind it gets neither, and shows in the `fiscal.submission_stopped` alert
(and, when a run of rejections with one error code holds its chain, in the
`fiscal.refusals_repeated` alert) and in `recordsHalted` in `drain.complete`; see
the opening section above. Find a park via the error-level `reconcile.run_parked` log line, which
carries the duty, period and `errorCode`.

`payments.reconcile` uses the identical `skipped`/`parked` mechanism with a 26-hour staleness
budget (a daily period plus slack) rather than drain's ~75 minutes, so the same reading applies to
it for payment audits instead of a fiscal submission. This `/health` label covers the selected
Stripe and SumUp duties together. Each run's row in `reconciliation_runs` keeps its provider's own
`duty` key, `payments.reconcile.stripe` or `payments.reconcile.sumup`. Each provider's check runs
only while the `payments` module is on and its own credential is provisioned; credentials are
checked each pass. The first SumUp audit for a UTC day is due at 01:00 UTC the next day, allowing
time for manual backup entries and other possible matches across midnight.

The SumUp audit compares gross EUR charges with local captures and looks up locally failed
payments by their saved references. An alert can identify a charge whose reply was lost, but the
audit makes no refund, hold, payment or sale change. Unlinked app/reader charges appear only in
the run summary. This check establishes neither bank arrival nor refunds made outside Waitron.

**What to do about a `503`:** read the body first — it names which duty and how many skipped or
parked runs. Then grep stdout for that duty's own `duty.degraded` line — it names the duty, its
`consecutiveFailures`, `skipped` and `parked` counts, whether it is `stale`, and its `lastOkAt`, all
in one line, and is the fastest way to see why a duty reads unhealthy without correlating individual
skip/failure/park events yourself. For a skipped
`fiscal.drain` pass, the fix is almost always provisioning or repairing the venue's `fiscal.aeat`
credential, on the dashboard's AEAT certificate card (see
["Installing or replacing the AEAT certificate after setup"](#installing-or-replacing-the-aeat-certificate-after-setup))
or with `packages/credentials`'s CLI — credentials are read fresh every pass, so
there is no restart needed once the credential is fixed. The exception is a skip logged beside
`drain.restart_reset_failed`: the restart reset failed before any work was looked for, and the cause
is the database, not the credential. A skipped duty reports itself due
again `now + DEFAULT_DUTY_TIMINGS.skipRetryMs` (5 minutes by default, never `null`) rather than `now` — folded
as a minimum against whatever a healthy duty computed the same pass, so it can only come in
sooner, never later. That means the fix lands within one skip-retry interval, not necessarily the
very next pass as it would for a whole-duty failure below — still comfortably inside `drain`'s
hourly legal cadence, and no longer the 5-second-forever loop a missing certificate used to produce
(`DEFAULT_DUTY_TIMINGS.skipRetryMs` in `src/config.ts`). A **parked** reconcile run is different: it is tried
again a day after it parked, as a new run with fresh attempts, and again a day after each later
park, so a cause that does not clear on its own needs a human to investigate, via the
`reconcile.run_parked` line's duty/period. If the
WHOLE pass is failing rather than one duty, restart is unlikely to help either — the process
already retries every pass on its own at `DEFAULT_DUTY_TIMINGS.minTickMs`'s fast cadence (unlike a skip, a
whole-duty throw still reports `now`), so a repeating `503` past a few cycles means the underlying
cause (usually the database or an external endpoint) needs fixing, not the process.

## Log events

One structured JSON line per event on stdout, `{ ...fields, at, level, event }` (`src/logger.ts`).
The ones worth grepping for:

- **`config.unknown_variables`** (`warn`) reports unrecognised process variable names in
  `unknown` and names skipped by each box file in `ignoredInBoxFiles`. The box emits one line
  when either list has entries. The line carries setting names only.
- **`drain.skipped`** (`warn`) — `{ errorCode }`. The pass had due fiscal work and could not
  submit any of it — unless `drain.restart_reset_failed` is also logged, in which case the restart
  reset failed before any work was looked for, and the cause is the database, not the credential.
  There is at most one of these per pass: one database files for one taxpayer. This line is the
  ONLY place this fact exists outside `/health`'s `skipped` count — a skipped drain has no ledger
  row (`drain` has no table of its own) and raises no incident. `errorCode` is `credentials.unusable`
  when the saved AEAT certificate material has a missing field, an unrecognised certificate kind or
  base64 data that decodes to zero bytes. It can also carry a code thrown by
  `getCredential` (`credentials.missing` — no row for that purpose at all,
  `credentials.decrypt_failed`, `credentials.key_version_unknown`, `credentials.malformed_payload`).
  The event NAME still reads `taxpayer`, and stays that way: a log event is a name operators grep
  for, so it is renamed deliberately or not at all.
- **`drain.restart_reset_failed`** (`error`) — `{ errorCode }`. Before this process's first drain,
  the reset that returns a previous run's in-flight submissions to the queue failed
  (`src/restart-reset.ts`), so no drain ran. Logged once per failed attempt; each pass that waited
  on it also logs `drain.skipped` with the same `errorCode` (`unknown` for a raw database
  error), and the next pass tries the reset again.
- **`reconcile.pair_skipped`** (`warn`) — `{ duty, errorCode }`. The payment-audit
  equivalent, one duty abandoned mid-sweep — an infrastructure failure, a credential
  code as above, or `payment.credential_environment_mismatch` (the `payments.stripe` key's
  `sk_live_`/`sk_test_` prefix disagrees with this host's `WAITRON_ENV`).
- **`reconcile.run_failed`** (`warn`) — `{ duty, period, errorCode }`. One claimed
  reconcile run failed this attempt but is still retrying on its own backoff — a `next_attempt_at`
  exists. Never flips `/health`; see `skipped` and `parked` under
  ["What `/health` means"](#what-health-means).
- **`reconcile.run_parked`** (`error`) — `{ duty, period, errorCode }`. One claimed
  reconcile run exhausted `DEFAULT_DUTY_TIMINGS.scheduler.maxAttempts`; a fresh run of that (duty, period) is
  due a day later. This is what `/health`'s
  `parked` count (above) is counting.
- **`duty.failed`** (`error`) — `{ duty, errorCode }`. The WHOLE duty threw for this pass (not a
  contained skip) — `fiscal.drain` or `payments.reconcile` itself.
- **`duty.degraded`** (`error` when the duty is stale, `warn` otherwise) —
  `{ duty, consecutiveFailures, skipped, parked, stale, lastOkAt }`. One line per DEGRADED duty,
  per pass —
  `ok: false`, or `ok: true` with `skipped > 0` or `parked > 0`, as `health.ts`'s `recordPass`
  computes it; a degraded pass leaves the duty's `lastOkAt` where it was. The level comes from
  `stale`, not from `consecutiveFailures`: the same `isStale` test `/health`'s `200`/`503` verdict
  uses, but taken at the pass, while `/health` takes it at each request, so a duty can go stale
  between passes and answer `503` before any `error` line. A duty that fails on the first pass after
  boot logs `error` immediately (`lastOkAt === null` reads as stale). This is the
  single fastest line to grep for a degraded duty — see ["What to do about a `503`"](#what-health-means)
  above.
- **`drain.complete`** (`info`) — per-pass summary counters for `fiscal.drain`, including `skipped`
  (a count, matching the body above) and the duty's own `nextDueAt`.
- **`reconcile.complete`** (`info`) — the reconcile equivalent. `ran` is broken down by outcome —
  `{ succeeded, failed, parked }` — rather than a bare total, plus `deferred`, `beyondHorizon`,
  `skipped` (matching the body above) and the duty's own `nextDueAt`.
- **`resolve_pending.failed`** (`warn`) — `{ error }`, plus `provider` when one provider's check
  threw. These entries cover failures to list the providers, identify this box's payments or check a
  provider's pending payments. The card follow-up job reports a failed pass as `job.failed`. A
  lasting failure raises a `job.failing` box alert. This job does not change the `/health` result.
- **`resolve_pending.complete`** carries `{ captured, failed, incidentsRaised, nextDueAt }`.
  This box logs an empty card sweep at `debug`. Pending work, captures, failures and incidents
  appear at `info`. The incidents are `payment.pending_outcome_unactionable` and
  `payment.capture_mismatch`.
- **`tender_refund.recovery_failed`** (`error`) carries `errorCode`. A `refundId` identifies
  a failed refund row. The other card checks keep their schedule in that case.
- **`bill_request.clear_failed`** (`warn`) — `{ billId, partyId, error }`. A payment left nothing of
  the party's family to pay, but taking away the party's bill request was refused
  (`clearBillRequestIfPaid`, `src/bill-request.ts`). The payment went through; the bill request
  stays up until staff take it back, a later payment clears it, or the party is closed (Finish
  table, or merged into another). It raises no alert.
- **`transport.close_failed`** (`warn`) — `{ errorCode, message }`. An mTLS
  `Agent` failed to close gracefully at the end of a pass (`aeatClientResolver`'s `closeAll`,
  `packages/fiscal-verifactu/src/aeat-transport.ts`). `message` is the raw `Error#message` — safe to log here, unlike
  `server.shutdown_failed`, which reports only a structured code for the value it caught, because
  `Agent.close()` can only ever throw a socket-layer error, never one carrying a secret. Any other
  `Agent` the pass opened is still released concurrently, regardless of this one failing — it does not stop the
  sweep, does not stop the pass, and does not flip `/health`.
- **`http.request`** carries the method, matched route, status, duration and request ID. On selected
  order, sale and delivery routes it includes UUIDs. A query appears as `?***`. Requests with a
  recorded refusal code include it at warn. Other request lines are debug.
- **`payment.collection_failed`** (`warn`) records the order ID, request ID and fixed payment outcome
  when a till's card collection answers with a decline, failure, timeout or network unavailability.
- **Attendance, mail and certificate-reminder job failures** log `job.failed` with `job`,
  `errorCode` and `consecutiveFailures`. Use the `job` field to distinguish `attendance.end_of_day`,
  `mail.send` and `fiscal.certificate_reminders` from other runner jobs.
  The certificate job queues expiry reminders for managers and administrators. The shared mail
  sender sends the messages, with saved SMTP taking priority over opted-in Cloud delivery.
- **`server.listening`** (`info`) — `{ port, environment }`, logged once the HTTP listener has
  actually bound (not merely been asked to). A spare's store listener logs
  `{ listener: spare_store, port }` instead.
- **`server.listen_failed`** (`error`) — `{ port, code }`. The listener failed to bind — `EADDRINUSE`
  (the port is already taken — the common case for a fixed default port) or `EACCES` (a privileged
  port, no permission) are the usual `code` values. The process exits `1` immediately after this
  line; nothing retries a bind failure in the background. A spare's store listener carries
  `listener: spare_store`: its bind failure fails the start, and an error after it is listening is
  logged at `warn` while it keeps serving.
- **`server.shutdown_step_overran`** (`warn`) — the final stream-stop reserve arrived while
  shutdown was waiting on `step` (or `shutdown_preparation` before boot reached a named wait).
  The stream host is asked to stop then; `streamState` says whether the copy was streaming,
  opening, paused, refused or off. The warning can also describe a slow wait on a box with no
  bucket copy configured. Remaining cleanup is still awaited. Requests or late duties committing
  after this point can miss the final upload.
- **`server.stopped`** (`info`) — graceful shutdown completed (SIGTERM/SIGINT).

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
`migrations.manifest.json` `@waitron/migrations` itself reads, so the two cannot name different sets;
it also copies ui-core's `package.json` and its two token files, `src/tokens/colors.css` and
`src/tokens/structure.css`, under `dist/node_modules/@waitron/ui-core/`) and then bundles
`src/bin.ts` to `dist/server.js` with esbuild. Run the bundle directly: `node dist/server.js`.
`node dist/server.js check-producer` runs each fiscal module's check of the producer settings and
exits without starting a server. `node dist/server.js check-release <version>` exits 0 only when the
bundle is stamped with that release version and the declaration folder beside it (`declaration/`,
which the image renders for a release build) is that release's; otherwise it prints which of the two
differs and exits 1. Any other argument is refused.

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

### Regional developer demos

For a fresh practice venue in Catalonia, run
`WAITRON_DEMO_REGION=catalonia wa-wt demo <worktree-name>`. Use `balearic` for
Palma, `valencia` for València, `galicia` for A Coruña, or `madrid` for the Madrid demo. An unset, empty or whitespace-only selector
uses Madrid; an unknown selector refuses before database or settings work.

Catalonia and the Balearic Islands share Can Delgado's regional dishes and cava.
The Valencian preset uses Casa Delgado de l'Horta; Galicia uses A Casa Delgado,
with regional dishes and Albariño. Staff and kitchen names, menus, departments
and stations follow the seed's English or Spanish language.
Customer wording keeps each region's translations. A new Catalonia venue uses
Catalan receipts; the Madrid, Balearic, Valencian and Galician presets use Spanish receipts.
Screens remain English or Spanish.

Changing `WAITRON_DEMO_REGION` keeps an existing venue's stored geography and data.
To replace a throwaway venue you own, run
`WAITRON_DEMO_REGION=catalonia wa-wt reset demo <worktree-name>` (the owner's shared demo venue), or,
from Claude, `WAITRON_DEMO_REGION=catalonia wa-wt reset own demo <worktree-name>` (Claude's own copy).
