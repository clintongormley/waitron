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
  restructures `install`.

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
  `database is locked` in the pending-payment sweep (a candidate cause, not verified for the sweep:
  a busy wait on the server's own thread,
  [testing-guide.md](../developers/testing-guide.md#a-test-that-runs-the-server-in-its-own-process-writes-to-the-database-only-while-the-server-is-down));
  and nothing proves `startServer` itself survives a backup duty that cannot start — only
  `backup-supervisor.test.ts` covers that, at the supervisor. Left open by A39 (#671): each stop is written twice, once in the failed-start unwind
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

## A too-short recovery key: the refusals do not link to the button they name, and Change the recovery key cannot finish

**Task 2a** (#557, a recovery key that does not need an archive destination; A538-6d). Open:

- The bucket copy panel's refusal for a too-short key, and the recovery pack's, name a button
  ("Turn on backups" with archives off, "Change the recovery key" with them on) but do not link or
  scroll to it (`#failureText` in `apps/dashboard/src/screens/stream-settings-panel.ts`,
  `#packFailureText` in `apps/dashboard/src/screens/backup-screen.ts`).
- With archives on and a key hand-edited too short in `backup.env`, the panel and the recovery
  pack's refusal name "Change the recovery key", but that form waits for "Show the current key"
  (`#rotateWaiting`, `apps/dashboard/src/screens/backup-screen.ts`), and
  `GET /api/backup/recovery-key` refuses a too-short key with `backup.recovery_key_too_short`
  (`apps/server/src/backup-api.ts`; the case "reports a too-short key in backup.env as set…" in
  `apps/server/src/backup-api.route.test.ts`), so the form cannot finish. The server's rotate
  replaces a too-short key ("rotate replaces a too-short key held with no destination", same
  file). Both cases run with no destination.
  Decision needed: may the key change skip showing the old key when the held key is too
  short, given archives made under the key loaded at start need that key?
- With archives off, until the next status read reports the key too short, "Turn on backups" sends
  no new key (it reuses the held one); after that read the screen makes one.

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
`packages/stream/src/s3-client.ts`). An answer whose headers arrive within three seconds and whose
body then stalls is not bounded by that limit, only by its caller cancelling the call
(`packages/stream/src/s3-store.cancel.test.ts`), so a call nobody cancels can still wait on it (the
settings screen's Test and Save are one, listed in [docs/backlog.md](../backlog.md)); the idle limit
is per request, not per call, so a listing of many pages, or a bucket
answering each request just inside the limit, can take longer; a bucket that takes more than 30
seconds to answer a request whose body is already sent, such as a delete of 1,000 keys, is cut off;
Amazon S3 answered one delete of 1,000 tiny keys in 1,040 ms on 2026-10-14 (A538-10), and other
providers, and larger or busier buckets, were not measured; and the idle limit's tests run the
handler's below-6,000 ms path, while its production path was measured by hand, not by a test.

## The status and `errorName` on the stream's log lines other than the pause check's 403 were shown by reading

**The pause test and the bucket's error reports — what is still open (left by #668, #686, A57, A60
and #723).**

- On 2026-10-14 Amazon S3's 403 to the paused supervisor's listing was logged as
  `stream.pause_check_failed` with `errorCode` `backup.stream_request_failed`, `status` 403 and
  `errorName` `AccessDenied` (A538-10, [receipts](../receipts/a538/README.md)). The status and
  `errorName` on the stream's other log lines were shown by reading, by the store's scripted HTTP
  answers and by the supervisor's injected errors, not against a real bucket; A60's `errorName` list
  (`packages/stream/src/bucket-error-names.ts`) was checked against Amazon's reference only, not
  against the names versitygw gives its errors.

## Backup & restore — carry-forwards (B2)

The image ships with backups OFF, deliberately.

Whole-state-volume capture today: the fatal `RECOVERY_FILES` plus the optional `backup.env` and
`modules.json`; the replacement's private `cloud-recovery.json`, `cloud-replacement.json` and
`cloud-connection.json` stay outside that named capture set and the captured ciphertext archive.
The exclusion set for the deeper change is `backup-staging/`, `restore-staging/`,
`logs/`, the per-hardware `instance.env`, `recovery.json`, and its lock file `recovery.lock` with the `recovery.lock-journal` SQLite keeps beside it while held. Touches BR-2, BR-3 and the recovery
bundle. Named carry-forwards: a stale-`.tmp` sweep; a working-backup boot success-path integration
test; scope the flat `resolvers` map by module when a second `nonDbState` module lands; a
`packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails safe under GCM auth
today); generalise archive entry routing off declared source ids when a second non-DB source lands.

## Box image constraints (B3)

- **A setup box's `/health` returns 503 by design** (no duty loop); a liveness probe must gate on
  `/setup-api/status` (200), or it restart-loops an unprovisioned box.
- **The name-constrained-CA model does NOT protect a personal Android phone** (spike 2026-09-08): a
  user-installed root is trusted for every name on Android, while desktop Chrome and iOS/Safari honour
  the constraint. The service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device
  are still to measure.
- **The box image carries the WireGuard link.**
- **The box image keeps its clock synchronised, with no terminal** (A798). Nothing in `deploy/` sets up
  time synchronisation today (grep for NTP, chrony, timesyncd, timedatectl), and the server's
  `timedatectl` probe reports "unavailable" where the command is absent
  (`apps/server/src/time-health.ts:34-43`). Since A798's revision 5 (owner, 2026-10-19) a box whose clock
  reads earlier than its last recorded sale stops taking payment until the clock is set, so the
  image should also keep time through a power cut (hardware with a battery-backed clock), and set
  it as soon as it is online. A798-B switches the host's synchronisation on at `waitron.sh install`;
  the image makes it standing.
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is PIN-re-prompt v1.
- Kiosk options, none built: Chromium in the box image, now the owner's lean for every box (B3,
  2026-09-29), and, later, Fully Kiosk resale for dedicated tablets. Cloud-managed device enrolment is tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md). The counter till
  boots into the app with no operating-system login — automatic console login, one full-screen
  browser, and the till's own PIN as the boundary. Four traps to establish when the image is built
  (the crash-restore dialog, Chromium's separate certificate store, screen blanking, BIOS power-loss
  behaviour) in
  [2026-09-18-handheld-and-till-hardware-decisions.md](../superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §5.

## A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN

**A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN.** "Later
prepare should use a real SMTP server": a prepare venue would send invitations and password resets
through SMTP instead of capturing them on the box, and the top bar's inbox link (A227) would become
demo-only again. Not built.
(2026-10-03: the owner keeps this item open. A231d's design, below, sends a prepare venue's invoice
email through its mail server when one is set, and adds no way to set one there.)
(2026-10-12: A231q lets the till and the dashboard email a full invoice. In a prepare venue it
still goes through a mail server only when one is set, otherwise to the box's captured inbox
(`resolveInvoiceEmailDelivery`, `apps/server/src/email-delivery.ts`); the setup wizard and the
dashboard's Account email page still cannot set one there (`apps/server/src/email-settings-api.ts`), so
this item stays open.)

## Decisions and deliberate limits

- **Litestream's own requests are outside the Amazon S3 rehearsal's request check (A641, #1704;
  owner 2026-10-14: leave it so).** No Node code sends them, so the check in
  `apps/server/src/testing/aws-send-gate.ts` never sees them; in the pause scenario a proxy admits
  only the run's bucket host, in the loop scenario only the AWS key limits them. The runbook
  `docs/developers/aws-backup-rehearsal.md` says so.

- **The rehearsal's 128 MiB upload budget counts only the runner's own fixtures (A538-7, #1648).**
  Litestream uploads straight to the bucket, so the stream loop's uploads are not counted; the runbook
  `docs/developers/aws-backup-rehearsal.md` says so. On Amazon S3 the loop's frozen-transport timing
  stage is always recorded as skipped: the real service cannot be frozen, and the local frozen-request
  check in `apps/server/src/stream-loop.e2e.test.ts` stays separate.

- **Image identity (A490, owner 2026-10-11):** both Waitron images carry their full source
  commit and UTC build time. `waitron.sh install`, `update` and `status` read the running
  containers' image IDs and report commits, requested ref, local build time and GitHub link. The optional
  `/health` or dashboard display is omitted by default. (2026-10-11: A491 sends the build in an
  `x-waitron-build` header on every main-listener response after `/health`; see
  `docs/backlog/dashboard.md` → Decisions and deliberate limits.)


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

- **A managed Cloud restore keeps both sealed bucket records (owner answer 2026-10-13, A538-4).**
  A restored or replacement box inherits both `backup.archive` and `backup.stream` (bucket keys
  included); `docs/developers/cloud-connection.md` says so. Owner: "Keep as built: a replacement
  box restored from Waitron Cloud reads `backup.archive` and `backup.stream` and carries on backing
  up to the owner's own buckets with no setup. No backlog item for "drop them"."

## Migrating a box drops the change-feed triggers one statement at a time, outside a transaction

**Migrating a box drops the change-feed triggers one statement at a time, outside a
transaction.** `removeChangeFeed` (`packages/db/src/change-feed.ts`, called first by
`applyMigrations`) drops each `waitron_change_*` trigger on its own. A751's probe on the full
schema: 561 drops took 85–180 ms that way and 43–48 ms inside one transaction; A736 measured
53–56 ms against 23–25 ms. Boot migrates at every start (`apps/server/src/boot.ts`), and the
removal is about a quarter of the upgrade walk's processor profile. A product change in
`packages/db`, so A751 (a test-only change) left it.

## The Amazon S3 delete and archive rehearsal's open edges (A538-9)

**The Amazon S3 delete and archive rehearsal's open edges (A538-9).** Left open by #1668, in
`apps/server/src/testing/` (`aws-request-recorder.ts`, `s3-delete-scenario.ts`,
`s3-archive-scenario.ts`) and the runbook `docs/developers/aws-backup-rehearsal.md`:
(1) the archive round trip proves download and decryption from the pack alone
(`downloadArchive`, `decryptArtifactFile`), not a full `waitron-restore restore --from-archive`
placement against Amazon S3; (2) the delete scenario's "a failing listing is recorded" case uses
a stand-in backend, so that failure no longer runs through the real S3 storage code; (3) the
step-name checks compare against hand-written lists, so a step added later is not caught;
(4) the bucket-settings setup and the setup/teardown block are repeated across the four
`*.aws-rehearsal.test.ts` files and the local loop and pause tests — share them.

## The Amazon S3 pause rehearsal's open edges (A538-8)

**The Amazon S3 pause rehearsal's open edges (A538-8).** Left open by #1658, in
`apps/server/src/testing/aws-rehearsal.ts`, `testing/aws-pause-gate.ts` and
`aws-stream-pause.aws-rehearsal.test.ts`: (1) the scenario's
`beforeRestart` hook is called only by the AWS file, so no local test fails if the call goes (the
AWS run would stop with "step 7's restart was never watched"); (2) the held-check evidence counts
a held call at the server's own proxy but cannot say which call it is (TLS hides it) — the later
logged 403 is what ties the refusal to the pause check.

## The Amazon S3 rehearsal runner's open edges (A538-7)

**The Amazon S3 rehearsal runner's open edges (A538-7).** Left open by #1648, all in
`apps/server/src/testing/aws-rehearsal.ts` and its runbook `docs/developers/aws-backup-rehearsal.md`:
(1) after the 60-second settle wait, teardown can still race a scenario stuck in a call that takes
no stop signal (a restore); (2) running the cleanup command again overwrites the previous cleanup
receipt, losing the earlier attempt's teardown ledger; (3) the receipt reader the cleanup uses is
more lenient than the writer.

## Two small leftovers in the Backups destination form (A639, #1695)

**Two small leftovers in the Backups destination form, reported by A639's review and not fixed
there (#1695).** (1) A folder typed in the settings editor and then cancelled can reappear in the
"Turn on backups" form later; it is never sent and never counts as a change. (2) A refusal of the
other bucket's secret that arrives after the owner switched the bucket choice away from "Another
S3-compatible bucket" is dropped, so the next Save asks again. Neither was reproduced outside the
reviewer's run. Separately, an entry of the Save's `destinations` list with an unknown kind is
refused under field `destination`, a name the request no longer has; the dashboard never sends one
(`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`).

## A recovery kit can carry a recovery key its own restore refuses

**A recovery kit can carry a recovery key its own restore refuses.** `parseRecoveryKit`
(`packages/stream/src/kit.ts`) refuses a recovery key holding a C0 control character or DEL, which
the box's key rules (`checkedRecoveryKey`) accept, so a box with such a key hands out a kit whose
restore calls it damaged; the archive recovery pack accepts such keys. Predates A538-5 (kit.ts
last changed in #627). `bench/sqlite-failover/src/probes/restore-time.ts` still computes free
space as `bavail * bsize`, where the server multiplies by `frsize` (`free-bytes.ts`).

## A restore that fails while writing the secrets has already replaced the venue database

**A restore that fails while writing the secrets has already replaced the venue database.**
`placeValidated` (`apps/server/src/restore.ts`) puts the database in place and runs the restore
hooks before `restoreSecrets`, so a full disk or a write error there leaves the archive's
database with the old box's secrets. Measured in A538-5's review with a throwaway case that made
the secrets write fail: the command exited 1 and the live venue's name was already the archive's.
Predates A538-5. Write the secrets into staging before placement, or put the previous database
back on failure. The same step sets `trading.env` aside (as `trading.env.replaced`) before it
moves the database into place, so a full disk at that move leaves the old database without its
active identity file; found by the finish-branch review's run-it seat with an injected ENOSPC,
and it predates A538-5 too (`placeValidated`, `setAsideExistingIdentity`).

## Upgrade testing — blocking before go-live (owner, 2026-09-26)

**A799 design proposal, 19 October 2026:** the [design](../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md)
and [worked-example boards](mockups/a799-real-database-upgrade-testing/README.md) await owner
agreement. Recommend an invented venue captured after an immutable older image writes it through
product paths, with independently frozen facts and a separate candidate copy. Supported captures
begin after A760’s approved squash/reset; this proposal does not execute that operator job or
authorize an upgrade across it. Implementation, an actual pending-migration case and issued-F1
coverage remain open. The existing synthetic walk stays complementary and unchanged. The detail
below records the gap that prompted the design, not a new runtime measurement.

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
    through a foreign key, a trigger on its table, or a trigger body naming its table_. The guard steps over it by applying
    everything up to `0003` in one go, so the next such rebuild fails the guard. Decide the fix.
  - **A real old database.** Every step here is built by this image's own migrator from today's
    change-feed and append-only lists; a snapshot of a box at an earlier release, upgraded by the
    new image, is the test that matches what a box does.

  The synthetic walk's work budget follows its step count (A489) and is spent in its own
  processor time (A751); see
  [the timing receipt](../developers/ci-and-gates.md#the-upgrade-budget-counts-the-walks-own-processor-time).

## `packages/provisioning/README.md` also says only `ES-common` is implemented

- `packages/provisioning/README.md` also says only `ES-common` is implemented (a `GB-vat` run
  exits 0 in `cli.test.ts`), and repeats two reasons #561 deleted from the code's comments: that
  `provisioning.venue_conflict` means a concurrent run committed between plan and apply (the apply
  reads and writes inside one `withTransaction`, `venue-apply.ts`, and whether a second PROCESS can
  interleave was not measured) and that the entry point can only be checked through the built
  bundle (its prompt function runs straight from source).

## `packages/provisioning` code found by #561 and not changed

- `packages/provisioning` code, found by #561 and not changed: the `quoteLiteral` re-export in
  `identifiers.ts` is used only by its own suite; the `action.email === undefined` branch in
  `venue-apply.ts`'s seed-admin cannot run, because the action's `email` is a required string; the
  coverage config leaves `src/bin.ts` out with no reason stated any more, which may hide code a
  test could reach; and `cli.test.ts` test titles still say "before connecting" and "before
  opening a connection", and one title ("rather than opening the working directory") rests on the
  false reason in the empty-venue-directory section above.

## A restore from a backup file derives the archive's key at least three times

Each step below derives the archive's key at least once, with scrypt at N=2^17 (`KDF_BY_VERSION`,
`packages/provisioning/src/artifact-cipher.ts:14`):

- the preview, `previewRecoveryArchive` (`apps/server/src/recovery-backup-preview.ts:99`), through
  `validateArtifact` (line 100), which decrypts the archive (`apps/server/src/restore.ts:168`);
- the staging, `validateArtifact` again from `apps/server/src/boot.ts:1111`;
- the next start's `runStagedRestore` (`apps/server/src/node-entry.ts:389`), whose
  `validateArtifactFile` (`apps/server/src/restore-request.ts:419`) derives it in
  `apps/server/src/artifact-cipher-file.ts:61`. That step runs in a later process.

Deriving it once per restore would save CPU on the box, but the key would have to be carried between
the preview and staging handlers (`apps/server/src/boot.ts:1073` and `:1109`) and across a restart. It is a behaviour change on the restore path and needs its
own tests. A938 cached only the tests' derivations (`apps/server/src/testing/derived-key-cache.ts`).
Left open by A938.
[Receipt](../developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration).

## A transaction opened outside the write queue can let a body's writes after a full disk commit

Left open by A798-B slice 1 (#1936). The store's record of a transaction
the engine ended belongs to the connection pair, not to the body, so an outermost `db.transaction`
opened outside the write queue clears it, and the body's later writes are kept. What was measured,
in two orderings, and the grep behind "no product code is known to open one" are in the
[receipt](../developers/conventions-data.md#a-full-disk-sometimes-ends-the-whole-transaction),
under "Weaker than the rule".

Not closed in slice 1, because product writes go through `withTransaction`, which runs inside
`withWriteLock`. Two ways to close it:

- key the record to the body, which needs a token for the body carried through every nested
  savepoint; or
- a root guard refusing a bare `.transaction(` on the venue database outside `withWriteLock` in
  product code.

## A backup run that is cut off leaves a plaintext copy of the whole venue database

A backup run stages a plaintext copy of the whole venue database (an owner-only file) and its
encrypted copy in `<state>/backup-staging`. The run's own `finally` deletes them
(`apps/server/src/backup-sweep.ts`), so a run that is cut off leaves them behind. Since A798-B slice
2 a start deletes them (`freeSpaceAtStart`, `apps/server/src/start-space.ts`) in two cases: when the
state or venue folder has under 256 MiB free at the start, and after a start whose failure was
classified `storage.disk_full`, whatever the free space (`runAdmittedEntry`'s catch,
`apps/server/src/node-entry.ts`; the slice's plan, decision 7). Either way it keeps them while the
venue folder's holder file shows a fresh heartbeat. Outside those two cases they stay
indefinitely: each backup run deletes only its own files (the dump is named from the run's own
time, `dumpFileName`, and the encrypted copy goes in a fresh `mkdtemp` folder, both in
`apps/server/src/backup-sweep.ts`), and nothing else in the server deletes from `backup-staging`;
a box reset does (`wipe_box`, `deploy/waitron.sh`).
The first case is run on a real disk by the leftovers case of
`apps/server/src/start-full-disk.e2e.test.ts`.

**Owner question:** should every start delete them, whatever the free space? Built default: only
in the two cases above. The design scoped the first (under 256 MiB free); the second is the slice's
plan, decision 7
([design §11](../superpowers/specs/2026-10-19-a798-degraded-trading-design.md#11-found-while-reading-outside-this-design),
[plan decision 16](../superpowers/plans/2026-10-21-a798-2-full-disk-at-start.md#decisions-this-plan-makes-that-the-spec-does-not)).

## A local backup folder inside `<state>/backup-staging` is accepted, and a start's clean-up would delete it

`parseEntry` and `parseDestinations` (`apps/server/src/backup-config.ts`) take any `local-fs`
folder through `resolve`, with no check of where it is. A start's clean-up deletes every entry of
`<state>/backup-staging` recursively (`freeSpaceAtStart`, `apps/server/src/start-space.ts`), so a
backup folder there, or inside it, loses its archives. Refuse such a folder. Read, not run.

## A box whose first setup was retired into a new workspace keeps that workspace's backup staging through the clean-up before the count

When a first-setup resolution chose a new workspace (`binding` not null), the clean-up that
`runEntry` runs before first-setup resolution reads the folders the process was given, not the
workspace's, so a `backup-staging`
inside the workspace's state folder is not deleted by it. The forced clean-up after a start that
failed on a full disk runs inside `runAdmittedEntry` with the workspace's folders, and the count
check uses them too. Accepted for A798-B slice 2 (its plan's decision 15).

