# The box: backups, upgrades and recovery — detail

The open entries are listed in [the backlog](../backlog.md), under "The box: backups, upgrades and recovery". This file holds
their full text.

## The box the customer buys probably doubles as a till, so the image ships a screen and a browser

**The box the customer buys probably doubles as a till, so the image ships a screen and a browser**
(owner, 2026-09-29: "we probably want the server the customer buys to also serve as a till, which
means that we need to ship Debian with a UI and chromium"). A lean, not yet a decision. The hardware
decisions already put the deli's box under the counter driving the counter touchscreen (O5,
[handheld and till hardware §5](../superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)),
but as a machine built by hand; this makes it how every box ships. What it asks of the image B3 lays
down, none of it built:

- **Debian with a graphical session and Chromium**, not a server-only install. Spec §5's lean is the
  smallest one: automatic login on the console, then one full-screen Chromium under `cage` (a Wayland
  compositor that runs a single application), restarted as a service, with no desktop environment.
  Whether "a UI" means only that or a fuller desktop is not yet settled.
- **The four traps spec §5 lists, each established on the first real build:** the "restore pages?"
  bubble after a power cut, Chromium's own certificate store (the box's root certificate is installed
  there separately), screen blanking and sleep, and the BIOS set to power on when mains returns.
- **The box is specified for both jobs** — server, database and browser — which spec §5 and §6 already
  say; spec §6's memory figure for a page-only machine is reasoning, not a measurement.
- **Open:** whether the box's own screen enrols as a till like any other device or is treated
  differently because it is local, and what address it opens the till at.
- **Related:** the print-agent's AppArmor policy (A129, #862) was chosen on the owner's "we'll be
  shipping with our own OS"; the licence notices for what an OS image adds (Debian packages, Chromium,
  `cage`) need an answer too, beside the container image's `/app/third-party/`.

## a local maintenance account on each box

Belongs with it: **a local maintenance account on each box**, its password printed on a sealed card
and set when the box is imaged, with procedures for a lost card, a change of owner and a reinstall
([box maintenance and remote support](../superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md),
a discussion record, not an approved spec). Its remote-support half is tracked in Cloud and not
approved.

## Upgrade testing — blocking before go-live (owner, 2026-09-26)

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).**
  `scripts/migration-upgrade.test.ts` walks one database through every shipped migration in date
  order, with the change feed installed between steps, and since A164 (#970) carries two synthetic
  rows per table through every step. The steps that cannot carry those rows are listed in the test's
  `RESETS`, where the walk restarts from an empty database. One is a real loss rather than a refusal:
  core `0012_printer_calibration` rebuilds `drawer_opens` without copying its rows (read from the
  migration; the guard's two rows were gone after it), so a box holding drawer-open records when it
  took that migration would have lost them — inferred, not run on a box. Whether the owner's box held
  any then was not checked.

  What it still does not cover, each needed before a real venue is live:
  - **Rows.** Still open: rows the product itself writes. The synthetic rows hold a few generic
    values, so a migration that fails only on values the product writes and they lack passes — a
    unique index two real rows break where these two differ, a required column real rows leave empty
    while these hold a value. Seed a realistic venue (the demo seed at least) at each step for that;
    the product's writers name today's columns; whether they can write an older step's schema was
    not tried.
  - **A rebuild of a table another set's trigger BODY reads is still refused** on a box that has
    the trigger — core `0003` on `products`, recorded in
    [conventions-data.md](../developers/conventions-data.md) → _A migration set depends on another
    through a foreign key, a trigger on its table, or a trigger body naming its table_, and in Track
    A, the paragraph opening **Task 1 LANDED as #511**. The guard steps over it by applying
    everything up to `0003` in one go, so the next such rebuild fails the guard. Decide the fix.
  - **A real old database.** Every step here is built by this image's own migrator from today's
    change-feed and append-only lists; a snapshot of a box at an earlier release, upgraded by the
    new image, is the test that matches what a box does.

## Automatic upgrades that can be undone until the first order

- **Automatic upgrades that can be undone until the first order** (owner, 2026-10-02). Today an
  upgrade is `waitron.sh install`, run by hand at the box's terminal: it pulls the new images,
  restarts, and waits about three minutes for the app to report healthy (`wait_healthy`,
  `deploy/waitron.sh`). It takes no backup first, and once the new image has migrated the database
  there is no way back — an older image then refuses to start with `provisioning.database_ahead`
  (`deploy/README.md`, "It can migrate the box's database one way"). Wanted: the box upgrades
  itself, in this order:
  1. stop the app and take a snapshot of the box's state;
  2. start the new image and let it migrate, with sales refused;
  3. check that it started properly;
  4. only then take orders. If the check fails, put back the snapshot and the old image, and
     report the failure.

  **Rolling back is not a fix** (owner, 2026-10-02): it keeps the venue trading on the version that
  worked while the failed upgrade is reported and fixed. The point of no return is the first order
  taken on the new version, not the restart: rolling back after that would lose the order.

  **The snapshot is a filesystem snapshot where the disk allows it** (owner, 2026-10-02). Debian's
  default filesystem, ext4, has none; btrfs (in Debian's own kernel) and LVM thin volumes do. ZFS
  does too but is built outside Debian's kernel because of its licence. The B3 installer lays the
  disk out, so it can put the folder holding Docker's volumes on btrfs. What it should buy, none of
  it measured yet: taking and restoring a snapshot costs about the same whatever the size of
  `venue.db`, which holds the product photos, where a file copy grows with it; and it takes every
  volume at once, so nobody keeps a list of the files a restore needs (the hand-kept list already
  went stale once — B2's whole-state-volume bullet). What it does not cover:
  - the old image, which is kept by its tag, not in the snapshot;
  - a box whose disk the installer did not lay out (ext4), which needs a fallback copy;
  - the failed attempt's own logs, which a rollback of the logs volume would erase — keep them out
    of the rollback, or send the report before rolling back.

  Questions to settle in the brainstorm:
  - **Where the failure is reported.** To the owner, as a dashboard alert once the old version is
    back; to Waitron as well, which needs the one-touch bug report (A9, Logging Slice 2) or
    something like it.
  - **What counts as "started properly".** `/health` returning 200 says the duty loop runs; that
    may be too little — every module opened, the fiscal chain read back and checked, the till able
    to load its menu.
  - **Nothing fiscal before the check passes.** The new version must not file a record with AEAT
    or use an invoice number before step 4, or a rollback would leave AEAT holding a record the
    restored database does not, or a gap in the series.
  - **The bucket stream.** The new version streams `venue.db` while it starts; a rollback must not
    put back a copy that the bucket's newer data then overrides, or the reverse.
  - **When it runs and who starts it.** A quiet hour outside trading, and something outside the app
    container, since it replaces that container (a timer on the host running `waitron.sh`, or a
    small updater with access to Docker). Where the box learns a release exists is B3's open
    question, "unattended updates for a box we did not sell".
  - **Upgrade testing above still comes first**: a rollback keeps the venue trading through a
    failed migration; it does not prevent one.

## Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check

- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.**
  `conventions-data.md` holds the full list — among them a
  readiness runner and the dev, demo and Cloud fixture scripts under `apps/server/scripts`, two of
  the Cloud fixture scripts migrating through `restore.ts` rather than calling `applyMigrations`
  themselves, which a grep for that name alone does not find.

## What `waitron.sh install`'s self-refresh (C83, #890) left open

- **What `waitron.sh install`'s self-refresh (C83, #890) left open:** installing a ref whose script
  predates the refresh puts back a copy that does not update itself (`deploy/README.md` says to
  download it again); a copy another user owns in `/tmp` is not updated under `sudo`, because
  systemd's `fs.protected_regular` setting stops root writing the fetched script into the temp file
  beside it (install reports a failed fetch; the README says to download to the home folder
  instead); nothing checks a fetched script before running it beyond what the fetch of `compose.yml`
  already trusts — the same GitHub URL over HTTPS. No case in `scripts/waitron-sh.test.mjs` covers a
  script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter,
  or a box with neither curl nor wget.

## What `waitron.sh --reset install` (#1122) left open

- **What `waitron.sh --reset install` (#1122) left open:** a build or pull that fails still leaves
  the box's files changed, as a plain `install` always has. `fetch_box_files` replaces `compose.yml`
  before any image work, and an install of `main` removes the image lines from `.env` before its
  pull, so after a failure the box's files name the new ref while its running containers are the
  old ones. Nothing has been taken down or wiped at that point, and the error asks for a re-run;
  making it leave the files untouched means fetching into a temporary folder and moving the files
  into place only once the images are in. Raised by the run-it review and not taken because it
  restructures `install`. Also open: the simplify review suggested `waitron.sh reset … --install
[ref]` instead of `--reset … install [ref]`, reusing reset's own option reading; the form shipped
  is the one the owner asked for, so that is the owner's call.

## What showing the failed start's reason (#695) left

- **What showing the failed start's reason (#695) left:** a failed migration's report names the SET
  (`migrations.apply_failed`, `{ set }`), not the migration file, though the refused statement shows
  in the detail; the start-up's own log writer ignores `WAITRON_LOG_MAX_BYTES`/`WAITRON_LOG_MAX_FILES`
  (it only appends, so they do not apply); the two restore errors' text quotes the "Why the last start
  failed" heading with nothing tying the quote to the heading; and no staged restore has been run
  through the real migrator to see it end in `migrations.apply_failed`.

## The recovery page's secret bound is a convention, not a guard

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on
  every log line — the connection-string shape and nothing else. A secret in any other shape still
  reaches the unauthenticated page two ways — through the log tail, and through the failed start's
  full detail under "Why the last start failed" (stacks with file paths, the message of each cause
  down to five levels, an `AppError`'s params) — bounded only by the convention that an `AppError`'s params
  carry none.

## Resetting a box without a terminal

- **Resetting a box without a terminal** (owner, 2026-10-02). An operator who set the box up in
  Demo and now wants to Prepare has to wipe Demo away first, and the only wipe is
  `waitron.sh reset` or `waitron.sh --reset install` (`wipe_box`, `deploy/waitron.sh`), run with `sudo` at the box's terminal —
  which a box operator does not have. Going from Prepare to Live needs a fresh database too (one
  database per environment, CLAUDE.md §5): the Backups screen can export the venue's configuration
  and setup can import it (`apps/server/src/configuration-export-api.ts`,
  `apps/server/src/configuration-import.ts`), but the wipe between them is again only the script.
  Wanted: a reset offered on the dashboard, and probably on the recovery page as well, because a
  box that will not start is the one an operator most wants to reset. It keeps the script's rules:
  refused on a production box, confirmed by typing a word, and keeping the box's certificate so
  devices need not trust it again. Open: who may press it (the owner only?), and whether a reset
  started from inside the app container can remove the Docker volumes the script removes, or has
  to empty them instead.

## Two concurrent first provisions can still race past the venue guard

- **Two concurrent first provisions can still race past the venue guard** (2026-09-14). Both can
  pass the empty-`locations` check and carry on down the venue path; `apps/server/src/provision.ts`
  says in as many words that callers must serialise provisioning, and nothing enforces it — the
  setup route's latch is process-local. #378 closed only the taxpayer row's part of
  it (the second insert now loses to the singleton primary key), and its test claims only that
  neither plan dies on a `tenants_*` key. **Next action:** decide where the lock belongs — a
  database advisory lock around guard→stamp→apply is the obvious home — and prove it with two
  concurrent provisions against a real database, not with the row-level check alone.

## `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the staging folder

- Found by #658 (`apps/server` part h2: the remaining held-back files), not fixable in a
  comments-only change. `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged,
  and nothing chmods the staging folder that the archive restore's two entries outside `secrets/`
  (`manifest.json` and `db.dump`) are checked against; it receives nothing and keeps an existing
  folder's mode. Still open, not fixed, by the owner's choice: `unpackBundleToDir`'s walk and file
  write go by path, so a folder inside the destination swapped for a symlink during the unpack is
  followed. The A41 run-it review reproduced an outside folder being set to 0700 and receiving the
  secret that way. It needs someone able to write inside the destination. `tightenTlsDir`
  (`box-secrets.ts`, A52) leaves a linked `tls/` and the folder it points to as found, by the
  owner's choice, and a link swapped in for the state folder or a folder above it is followed; a
  folder its owner cannot read is changed by path after an `lstat`, and a link swapped in between
  the two would be followed. The restore itself (`restoreSecrets`) keeps none of `waitron-recovery
unpack`'s destination refusals (a symbolic link, another user's folder, not a folder) on the
  state folder it is given. The lock-file measurement kept in `db-wipe.ts` names no engine version
  or platform.

## `apps/server/src/errors.ts` still cites CLAUDE.md §5 for things §5 does not say

- Found by #656 (`apps/server` part e2: the backup and restore files), outside its files or not
  fixable in a comments-only change. `apps/server/src/errors.ts` still cites CLAUDE.md §5 for
  things §5 does not say, on `backup.recovery_key_unstorable` ("unrecoverable (CLAUDE.md §5)") and
  `restore.unexpected_entry` ("the cold-recovery path (CLAUDE.md §5)"). Test titles that still say
  "R3" or "rejoin", though rejoin no longer calls `restore.ts` (`rejoin-command.ts` does not import
  it): `restore.test.ts`'s `validateArtifact / writeValidated (R3 validate-before-wipe split)` and
  `restore steps (R3 composition)` describes and its three `skipSecrets` "rejoin" cases, and
  `restore-fiscal-e2e.test.ts`'s "skipSecrets:true (the rejoin shape)" control. No production
  caller sets `skipSecrets` any more, so whether the option should go is open. **Decided (owner,
  2026-09-25): leave `keyFingerprint` as it is** — the first 8 hex characters of the recovery
  key's SHA-256 (`backup-supervisor.ts`), shown in the backup status, so anyone who can read the
  status can test a guessed key against it.

## `apps/server/README.md` (near line 230, the `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp can round a value "past" a bound, which it cannot

- Found by #653 (`apps/server` part c2: `boot.ts`, `boot.test.ts`, `config.ts`), outside its
  files or not fixable in a comments-only change. `apps/server/README.md` (near line 230, the
  `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp can round a value "past" a bound, which it
  cannot (`sleepMsFor` in `loop.ts` is `Math.min(max, Math.max(min, wait))`, and config refuses
  `minTickMs > maxTickMs`); `config.test.ts`'s test title (near line 572) says "round back down
  past the floor" where it means "to the floor". The restore question A38 (#669) raised about
  `readNodeMembership`'s callers trusting the row is open under Task 9a. Two notes #653's prune
  deleted and nothing else recorded: nobody knows why the 5-second busy timeout did not absorb a
  `database is locked` in the pending-payment sweep; and nothing proves `startServer` itself
  survives a backup duty that cannot start — only `backup-supervisor.test.ts` covers that, at the
  supervisor. Left open by A39 (#671): each stop is written twice, once in the failed-start unwind
  list and once in the mode's `stopWork`; sharing one list was declined because it would change
  the normal shutdown order, which no test pins either.
  Test titles #653 could not touch in `boot.test.ts` carry the history tags
  "(SP-1a)", "(SP-1b)", "(SP-1b spec §3)", "(SP-1c)", "(slice 3)" and "SP-C dev override".

## The empty-venue-directory reason #561 deleted from `packages/provisioning` … is false there

- The empty-venue-directory reason #561 deleted from `packages/provisioning` ("an empty value would
  stand a venue up in the working directory") is false there: measured 2026-09-24 on Node v26.7.0,
  `openVenueDatabase("")` fails `ENOENT: no such file or directory, mkdir ''`, and a real path as
  the control created `venue.db` and `node.db`. The same reason still stands in
  `packages/provisioning/README.md` and in `docs/developers/conventions-data.md` (the paragraph
  on `resolveVenueDir`, "an empty directory is the RELATIVE `venue.db`"). The test title in
  `packages/credentials/src/bin.test.ts` that states the empty-folder behaviour still does (a
  title is code, so a pruning PR cannot rename it).

## `packages/provisioning/README.md` also says only `ES-common` is implemented

- `packages/provisioning/README.md` also says only `ES-common` is implemented (a `GB-vat` run
  exits 0 in `cli.test.ts`), and repeats two reasons #561 deleted from the code's comments: that
  `provisioning.venue_conflict` means a concurrent run committed between plan and apply (the apply
  reads and writes inside one `withTransaction`, `venue-apply.ts`, and whether a second PROCESS can
  interleave was not measured) and that the entry point can only be checked through the built
  bundle (its prompt function runs straight from source). `docs/developers/conventions-data.md`
  cites `packages/provisioning/src/errors.ts` as spelling engine errors by `errcode`; it no longer
  does.

## `quoteIdent` has no caller outside its own suite

- `packages/provisioning` code, found by #561 and not changed: `quoteIdent` has no
  caller outside its own suite, and the `quoteLiteral` re-export in `identifiers.ts` is used only
  by that suite; the `action.email === undefined` branch in `venue-apply.ts`'s seed-admin cannot
  run, because the action's `email` is a required string; the coverage config leaves `src/bin.ts`
  out with no reason stated any more, which may hide code a test could reach; and `cli.test.ts`
  test titles still say "before connecting" and "before opening a connection", and one title
  ("rather than opening the working directory") rests on the false reason above.

## The bucket copy panel's refusal for a too-short key names the "Turn on backups" button but does not link or scroll to it

**Task 2a** (#557, a recovery key that does not need an archive destination). Open:

- The bucket copy panel's refusal for a too-short key names the "Turn on backups" button but does
  not link or scroll to it. The panel picks its message from `managedByEnvironment` alone, so with a
  key hand-edited too short in `backup.env` it can name a button that does not help: with archives
  on it names a button that is not shown; with archives off, until the next status read reports the
  key too short, the button sends no new key (it reuses the held one) — after that read the screen
  makes one.

## Every synchronous `deriveKey` caller still blocks the event loop while it derives

**Task 5** (#569, `@waitron/stream`). Open:

- Every synchronous `deriveKey` caller still blocks the event loop while it derives:
  `encodeConfigurationBundle` (through `encryptArtifact`); everything reaching `decryptArtifact`
  (`apps/server/src/artifact-cipher.ts`) — `decodeConfigurationBundle` (on the request path),
  `validateArtifact` (`apps/server/src/restore.ts`) and `unsealNodeState`
  (`apps/server/src/sealed-state.ts`); and the recovery bundle's `encryptBundle` and
  `decryptBundle` (`apps/server/src/recovery-bundle.ts`).

## A pointer write from a process that has since died, landing after the restart, can still make the box refuse itself

**Task 6** (#590, the Litestream supervisor). Open:

- A pointer write from a process that has since died, landing after the restart, can still make the
  box refuse itself, because a restarted process starts with an empty record; so does a
  `current.json` deleted after the supervisor read it, on a bucket that answers a conditional write
  to a missing object with 412 (SeaweedFS; the in-memory test store). In both cases the owner's alert
  (`backup.stream_refused`) still says another box is writing. On a bucket that answers that write
  with 404 instead (AWS, as it documents; versitygw, as measured), the deleted pointer surfaces as
  `backup.stream_request_failed` and `#movePointer` (`packages/stream/src/supervisor.ts`) logs
  `stream.pointer_write_failed` and retries every `OPEN_RETRY_MS` until the supervisor stops, never
  reaching `refused`.

## When the key rename and the put-back both fail, the new certificate is left beside the old key

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- When the key rename and the put-back both fail, the new certificate is left beside the old key
  (the listener refuses the pair) and `server.crt.previous` holds the old certificate until the
  next reissue. The next start repairs it, because the marker stays — unless that start defers the
  first start. Publishing the pair through one atomic switch (for example a directory swapped by a
  single rename) would remove this case.

## A copy over 2 GiB cannot be restored

**Task 9b** (#642, `waitron-restore restore --from-bucket`, `apps/server/src/restore-stream.ts`).
Open:

- A copy over 2 GiB cannot be restored: `restoreFromStream` reads the downloaded file whole, and
  Node refuses a file that size (`ERR_FS_FILE_TOO_LARGE`). Archive creation has the same limit
  (`apps/server/src/backup-sweep.ts`). The root is that placement (`restoreDatabase`) takes bytes,
  not a file. Letting it take a source path and rename it into place on the same filesystem would
  remove the read into memory on the bucket path, and also the archive form's extra full copy:
  `refuseIfArchiveSourceLive` writes the whole database to a scratch folder only to read the bucket
  settings from it.

## Litestream at trace logging deadlocked sales for five seconds

**A130, A133 and A135 — a sale can wait behind Litestream's own checkpoint (DONE: A130 #868, A133 #889,
A135 #907 and #917).** A probe that reproduced the pause test's one failure on `main` (run 36559470238) on one runner in 20 found the CI runner's disk stalling, not the bucket, and the stream
tests' CI step now sets `TMPDIR=/dev/shm`. The figures are in
[testing-guide.md](../developers/testing-guide.md), "A sale can wait behind Litestream's own
checkpoint".

- **Open: Litestream at trace logging deadlocked sales for five seconds.** The probe first ran it at
  trace level by mistake, and 13 of 24 runs failed with a 500, each one looked at being
  `begin immediate` failing `database is locked` after 5,006 to 5,008 ms. The inferred mechanism:
  Litestream held the write lock while blocked writing its log to a pipe that only the server's main
  thread reads, and the main thread was waiting for that lock. At the normal level Litestream writes
  too little to fill the pipe; that is inferred, not measured. **Next:** check whether any setting
  lets an operator raise Litestream's log level, and read the pipe on a thread that does not wait on
  the database if so.

## The bucket client's limits (A44, #676) — what is still open

**The bucket client's limits (A44, #676) — what is still open.** `createS3ObjectStore` gives a
request up when it has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
`packages/stream/src/s3-store.ts`). An answer whose headers arrive within three seconds and whose
body then stalls is not bounded; the deadline on the pause and the freshness read cannot cancel a
listing whose answer keeps arriving; the idle limit is per request, not per call, so a listing of
many pages, or a bucket answering each request just inside the limit, can take longer; a bucket that
takes more than 30 seconds to answer a request whose body is already sent, such as a delete of 1,000
keys, is cut off, and how long real providers take for one was not measured; and the tests run the
handler's below-6,000 ms path, while its production path was measured by hand, not by a test.

## That a real bucket's 403 to the pause's listing reads that code, and the status and `errorName` on each line, were shown by reading

**The pause test and the bucket's error reports — what is still open (left by #668, #686, A57, A60
and #723).**

- That a real bucket's 403 to the pause's listing reads that code, and the status and `errorName` on
  each line, were shown by reading, by the store's scripted HTTP answers and by the supervisor's
  injected errors, not against a real bucket; A60's `errorName` list
  (`packages/stream/src/bucket-error-names.ts`) was checked against Amazon's reference only, not
  against the names versitygw gives its errors.

## Decisions and deliberate limits

- **Guided Cloud snapshot recovery for test venues is built.** Cloud approval alone does not
  authorize trading or stop another server.

- **Reading a credential does not re-check it against `PURPOSES` — owner decision 2026-09-15.**
  `getCredential`/`tryGetCredential` (`packages/credentials/src/store.ts`) return what was sealed,
  rather than refuse the read, which would stop every venue holding that kind of secret the moment
  a field is added; each reader must check the fields it uses instead. `rotate` re-checks a secret
  against the current list only when it re-seals one: it skips a secret already on the current key
  (`rotateCredentials`, `packages/credentials/src/store.ts`), so an out-of-date one stops a key
  rotation only when it is on an older key, until it is re-entered.

**Task 2b** (#560, the box's own state files locked with the recovery key in `node_sealed_state`).
Every node writes its own row at every start, standby and mirror nodes included, while the backup
job runs only on the primary — kept by design (owner, 2026-09-24).

From SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`):

- A setup-wizard restore whose placement fails is not retried and is not reported on the setup
  screen, nor normally on the recovery page; the code and which database was kept are only in the
  server's own output and in `waitron.log`. **Owner decision 2026-09-25: leave it as it is.**
