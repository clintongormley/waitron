# The box: backups, upgrades and recovery — detail

The open entries are listed in [the backlog](../backlog.md), under "The box: backups, upgrades and recovery". This file holds
their full text.

## The box the customer buys probably doubles as a till, so the image ships a screen and a browser

**The box the customer buys probably doubles as a till, so the image ships a screen and a browser**
(owner, 2026-09-29: "we probably want the server the customer buys to also serve as a till, which
means that we need to ship Debian with a UI and chromium"). A lean then; **decided 2026-10-21 in
B3's answers**: every box carries Chromium under `cage`, no desktop, and its screen opens the
dashboard after setup and can become a till
([B3 design §9](../superpowers/specs/2026-10-21-b3-usb-installer-design.md)). The rest of this entry
is the lean as it was recorded. The hardware
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

Belongs with it: **a local maintenance account on each box**. The 2026-09-11 discussion record
proposed a password printed on a sealed card
([box maintenance and remote support](../superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md),
not an approved spec); B3's revision (2026-10-21) replaces the card for a stick-installed box with a
one-time password an admin opens from the dashboard, used only at the box's own console (B3 design
§11). Its remote-support half is tracked in Cloud and not approved.

## A1016. Keep every box current and backed up

**Owner, 2026-10-22:** "Another super important part of the story especially for on prem is
automated backups. We need to make it incredibly easy for users to upgrade, hopefully even
automatically, and to give them good reasons not to fall too far behind, so that we don't end up
supporting ancient buggy versions."

Three parts:

- **Upgrading takes no effort.** The automatic upgrade below (snapshot, upgrade, check, roll back
  until the first order) is the mechanism. Still to decide: whether automatic upgrades are on by
  default, and when they run (the quiet hour B3 gives A950).
- **Reasons not to fall behind.** Nothing defines how far behind a box may be. To decide: how many
  versions or months back are still supported; what a box beyond that is told, and where (the
  dashboard, the till, an email); and what it loses: Cloud services, new features, help with
  problems. Whatever is decided, a box that falls behind must keep trading, because nothing
  external may block a sale (CLAUDE.md §5).
- **Backups need no setup.** Today the tour's step 13, "Backups: a copy off the box", ticks and
  never blocks (`docs/backlog/setup.md`), so a venue can trade with no copy anywhere but the box.
  To decide: whether a copy off the box is set up by default (Waitron Cloud's backups as the
  one-step choice, a bucket of the owner's as the other), and how loudly a box with no copy, or a
  stale one, says so.

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
  disk out, so it can put the folder holding Docker's volumes on btrfs — inside an encrypted
  container since B3's revision (2026-10-21, B3 design §6–§7), which A950's snapshots do not see:
  they are btrfs operations on the unlocked filesystem (B3's reading; its slice 1 tries a rollback on
  the encrypted disk). B3 also gives A950 the host service it needs (§8) and holds the packages that
  change the box's start-up back for A950's quiet hour, with a step that re-seals the disk key
  (§7.4). What it should buy, none of
  it measured yet: taking and restoring a snapshot costs about the same whatever the size of
  `venue.db`, which holds the product photos, where a file copy grows with it; and it takes every
  volume at once, so nobody keeps a list of the files a restore needs (the hand-kept list already
  went stale once — B2's whole-state-volume bullet). What it does not cover:
  - the old image, which is not in the snapshot: `waitron.sh install` deletes it once the new box
    comes up healthy, and on Docker's containerd image store Docker has already deleted it
    (`deploy/README.md`, Updating and operating);
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
- **The box image keeps its clock synchronised, with no terminal** (A798). The server's
  `timedatectl` probe reports "unavailable" where the command is absent
  (`apps/server/src/time-health.ts:34-43`). Since A798's revision 5 (owner, 2026-10-19) a box whose clock
  reads earlier than its last recorded sale stops taking payment until the clock is set, so the
  image should also keep time through a power cut (hardware with a battery-backed clock), and set
  it as soon as it is online. Since A798-B slice 10, `waitron.sh install` runs `timedatectl
  set-ntp true` and says so, or says that unless another time service runs nothing keeps the clock
  right; the image makes it standing.
- **Identity on a standby:** `persons` and `webauthn_credentials` are `state`, so a standby can
  authenticate the venue's people on failover; re-establishment is PIN-re-prompt v1.
- Kiosk options, none built: Chromium in the box image, every box (the owner's decision in B3's
  answers, 2026-10-21, B3 design §9), and, later, Fully Kiosk resale for dedicated tablets. Cloud-managed device enrolment is tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md). The counter till
  boots into the app with no operating-system login — automatic console login, one full-screen
  browser, and the till's own PIN as the boundary. Four traps to establish when the image is built
  (the crash-restore dialog, Chromium's separate certificate store, screen blanking, BIOS power-loss
  behaviour) in
  [2026-09-18-handheld-and-till-hardware-decisions.md](../superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §5.

## A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN

**A987: build the approved local email route.** The owner approved the two-route design on
2026-10-22: use Waitron Cloud or your own SMTP server, with no Cloud account required for SMTP.
The [dated design amendment](../superpowers/specs/2026-10-22-a987-prepare-venue-email-design.md)
and [implementation plan](../superpowers/plans/2026-10-22-a987-prepare-venue-email.md) govern the
build; the original design's unanswered questions and earlier permission descriptions are historical.

Prepare requires a usable route before setup completes outside development. Live asks again;
configuration export carries no mail settings or secrets. Settings → Email serves Prepare and
Live; saved-relay changes and captured messages remain admin-only. The sender display uses the
venue location's name. Keep current invoice documents, outbox outcomes and public reset privacy.

Cut A supplies the structured failure classifier, bounded account sends and reminder adapters;
its diagnostics preserve rejected versus unknown outcomes. Continue at Cut B's diagnostic screens,
then the settings and atomic Prepare wizard/routing cut, checking source reservations before each.
Cloud delivery, including Demo with a Cloud account, waits for D102's released interface and
joint tests. An unavailable Cloud route cannot satisfy setup or silently fall back to capture.
The setup-test network-target issue below remains separate open work.

## Support an office SMTP server's own certificate authority

**OPEN.** Owner decision O3A, 2026-10-22: A987 does not add support for an office SMTP server whose
certificate the box does not trust. Keep certificate verification and encrypted submission on.
A later design must specify how an admin supplies trust and how it is stored and replaced;
no insecure bypass is approved.

## The setup wizard's email test connects wherever an unauthenticated caller points it (A987 review, 2026-10-22) — OPEN

**The setup wizard's email test connects wherever an unauthenticated caller points it (A987 review,
2026-10-22) — OPEN.** While a box is in setup mode, `POST /setup-api/email-test` without the setup
owner's header (`apps/server/src/setup-first-fiscal-api.ts:182-184`) reaches a route that checks no
sign-in, takes the recipient from the request's `venue.admin.email` and connects to whatever host and
port the request names (`apps/server/src/setup-email-api.ts:25-38`). Anyone who can reach such a box
can make it send a short test message to any address through any mail server it can reach, including
one on the venue's network that accepts local mail without a login. Run 2026-10-22: a preproduction
setup-mode boot answered a no-header request with 200 and a local Mailpit received the message; with
an owner-held setup claimed the same request was refused 409 `setup.attempt_conflict`. The wizard's
Live path has it today;
A987's design does not change the route
([§7](../superpowers/specs/2026-10-22-a987-prepare-venue-email-design.md#7-security)).

## Loose ends left by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).

- **Loose ends left by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).**
  - `pragma integrity_check` is one blocking statement, and the venue watchdog kills a process
    after 120 seconds without a timer turn. The review measured 6.0 s on a 1.36 GB database on
    NVMe; box storage has not been measured.
  - A copy with no `tenants` row reads an empty tax id, which neither the command line nor the
    setup wizard ever accepts as confirmed, so it cannot be restored; no dedicated error code
    names that case.
  - An interrupted bucket rebuild, archive check or archive download leaves its scratch folder —
    a full copy of the venue database, or the encrypted archive (`archive-download-`, inside
    `restore-staging`) — under the state folder; the next run makes a new one and does not remove
    it. Also left open by A538-5. The same holds for the `archive-validate-` folders (a decrypted
    `venue.db`) and `restore-admission-` folders made directly in `restore-staging`
    (`apps/server/src/restore.ts`) when the process is killed partway, the setup wizard's preview
    included; neither boot nor the start's clean-up removes them, and the restore command uses the
    same names from another process. Found by reading (A1038's review), not run.
  - A `.venue.db-replaced-` folder left in the venue folder is removed by the box's next start
    (`clearReplacedDatabases`, A31) only from the container's entry: a server started any other
    way (the dev stack) does not.
  - Open question: the first start's pointer read and the bucket rebuild's calls (the command
    line's `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15
    seconds and 60 seconds) and report different codes (`restore.pointer_unreadable` and
    `backup.stream_request_failed`). The code does not say why they differ.

## Loose ends left by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).

- **Loose ends left by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).**
  - From #608: the recovery level is read before `recovery.lock`, so the pre-boot count another
    start writes can still push a server restarting at that moment onto the recovery page.
  - From #573's review, the owner's call: only an unwrapped `provisioning.database_in_use` is
    recognised — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path
    wraps them today).
  - From #608, no behaviour change decided: the watchdog appends its line to `waitron.log` without
    creating the log folder, so on a machine with no such folder that line is lost; only a store's
    `close()` waits for the watchdog thread to end, not a bare `release()`.
  - From #566's review: the migrator's lock and the venue lock use one technique in two copies,
    and the test helper that holds the lock from another process is copied into several test
    files.

## Loose ends left by the Amazon S3 rehearsal's cleanup and send check (A641, #1704).

- **Loose ends left by the Amazon S3 rehearsal's cleanup and send check (A641, #1704).**
  - The rehearsal does not track the Litestream processes a restore starts
    (`packages/stream/src/restore.ts`), so neither its teardown nor its keeper can stop one still
    running.
  - When teardown fails to delete the bucket and then fails to write the ownership marker again,
    the cleanup command refuses (`ownership-unproven`); the runbook says to delete it by hand.
  - A keeper that cannot reach Amazon S3 when it cleans up after a killed run gives no cleanup
    command: it reports a bucket the journal says the run owned as of unknown ownership and
    deletes nothing (`apps/server/src/testing/aws-rehearsal-keeper.ts`).
  - A journal the keeper refuses leaves the run's scratch folder, so a box's `secrets.env` and
    `recovery-kit.txt` stay on disk until a person deletes them (`readJournalAt`). The refusal is
    by design; the folder it leaves is the open part.
  - A process whose start time could not be read when the rehearsal tracked it is neither stopped
    by the keeper nor listed as left behind — only a log note says so (the `startTime === null`
    branch). Decide whether it should be listed as left behind.
  - The send check's `record` mode is used by no run (`aws-send-gate.ts`): delete it, or document
    how it refreshes the scenarios' request lists.
  - The keeper and the cleanup command each read the ownership marker with their own rules
    (`aws-rehearsal-keeper.ts`, `cleanupFromReceipt` in `aws-rehearsal.ts`); share one reader.
  - The list of tests that need versitygw is kept in three places in `.github/workflows/ci.yml`,
    so each new such test edits all three; derive them from one list.

## A backup destination that fails to build leaves archives reported as on.

- **A backup destination that fails to build leaves archives reported as on.** In
  `BackupSupervisor.reload()` (`apps/server/src/backup-supervisor.ts`) the venue handle is assigned
  before `buildBackupBackend` runs for each destination, so a throw there leaves `current().enabled`
  true with no sweep running. Reported by A538-4's second Codex review; the driver read the order
  but did not reproduce the throw. Build the backends before adopting the handle, or undo on failure.

## The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.

- **The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.**
  `GET /api/backup/stream` (`readStored`, called by `view`, in `apps/server/src/stream-api.ts`) tolerates only
  `server.credential_unusable`; `credentials.decrypt_failed`, `credentials.malformed_payload` and
  `credentials.key_version_unknown` fail the read (400 with the raw code), so the panel shows an
  error and no form, although the bucket copy's Save would replace the record. Treat all four the
  way `UNREADABLE_CREDENTIAL` (`apps/server/src/credentials.ts`) groups them. Predates A538-4; found
  by its review.

## Nothing checks that the error codes in the dashboard's `backup_stop` word list are still real.

- **Nothing checks that the error codes in the dashboard's `backup_stop` word list are still real.**
  `apps/dashboard/src/i18n/alert-messages.ts` gives `backup.staging_space_low` and
  `recovery.state_incomplete` their own sentence on the `backup.run_stopped` alert; a renamed code
  would quietly fall back to "Contact support.". The printer word list has such a check
  (`scripts/a4-hold-code-copies.test.ts`). Left open by A595 (#1675).

## No test covers the supervisor ignoring results from a backup run a reload replaced.

- **No test covers the supervisor ignoring results from a backup run a reload replaced.**
  `backup-supervisor.ts` drops `onUploaded`/`onDestinationResult` reports once that run's
  controller is aborted; removing both checks left the supervisor suites green in A538-3's review,
  because a reload starts a fresh record only after the old run has finished. The checks matter for
  a status read that began before the reload, or one made after `stop()`; a test needs one of those
  shapes. Left open by A538-3.

## Backup destination failures log no elapsed time or operation phase.

- **Backup destination failures log no elapsed time or operation phase.**
  `runOnce` in `apps/server/src/backup-sweep.ts` reports the destination, error code and errno,
  so a timed-out upload cannot be distinguished from time spent waiting on local filesystem work
  by those fields. Add non-sensitive phase and elapsed-time diagnostics when investigating real
  destination timeouts. A1035 reproduced the main test's folder timeout under controlled load;
  the original CI delay remains unmeasured.
  [Test timing guidance](../developers/testing-guide.md#a-deadline-test-must-separate-timer-ordering-from-filesystem-speed).

## Public TLS repair refuses linked layouts.

- **Public TLS repair refuses linked layouts.** Healthy linked `tls/` folders still serve HTTPS,
  but a damaged linked folder or managed file cannot be repaired through the public guide.
  Decide whether to support links contained within the state folder while retaining archive,
  exclusion and path-containment checks; cover the restored-layout startup and repair path.
  Found by A733's whole-branch review; see the server README's secure-connection section.

## On a full disk, a box whose kept certificates cannot be used shows the connection set-up page, with no word of the full disk.

- **On a full disk, a box whose kept certificates cannot be used shows the connection set-up page,
  with no word of the full disk.** The connection-bootstrap branch (`needsConnectionBootstrap`,
  `apps/server/src/node-entry.ts`) returns before the count check, as A798-B slice 2's plan
  decided. Its pre-merge review ran `runEntry` on a filled 32 MiB HFS+ image with an empty TLS
  folder, and `/` answered "Set up secure connection" and did not contain "disk is full". Open:
  should that page also say the disk is full and show the free space?

## Guide replacement address settings after a cold restore.

- **Guide replacement address settings after a cold restore.** Replace manual configuration of
  the advertised origin and dashboard origin/passkey domain with a recovery step that checks they
  match the replacement's address. Local certificate repair and authenticated restore entry already
  have surfaces; Cloud tunnel and staff-certificate installation remain under the Cloud integration
  loose ends below. Coordinate naming with A917 and failover addressing with A947.
  [Tested steps and remaining limits](../developers/cold-restore-surfaces.md).

## Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive destination).

- **Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive
  destination).**
  - The status watcher does not retry its own failed mint (the mint is a POST, never passive
    session activity), so the screen then offers no key until it is reopened.
  - The edit-settings form can meet `backup.recovery_key_exists` when a rotate (from another tab
    or admin) lands after it fetched the key.

## Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

- **Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).**
  - Which real providers other than Amazon S3 lack S3's multi-object delete, and what each
    answers, is not established; Amazon S3 answered batches of 1,000 and 5 keys with 200 and no
    per-key errors on 2026-10-14 ([receipts](../receipts/a538/README.md), A538-10). A provider that
    refuses it with a status other than 501 fails the day's prune (`stream.prune_failed`).
    `probeBucket` deletes one object at a time, so it cannot reveal such a provider; having it
    delete its test object through `deleteMany` would.
  - Amazon S3 is the only real provider's bucket the package has run against (the 2026-10-14
    rehearsal, [receipts](../receipts/a538/README.md), A538-10); the unit tests drive the real S3
    client over a scripted network, and the loop test drives it against versitygw.
  - Every synchronous `deriveKey` caller still blocks the event loop while it derives.
    [Detail](../backlog/box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives)

## Loose ends left by SQLite slice 2 Task 6 (#590, the Litestream supervisor).

- **Loose ends left by SQLite slice 2 Task 6 (#590, the Litestream supervisor).**
  - A pointer write from a process that has since died, landing after the restart, can still make
    the box refuse itself, because a restarted process starts with an empty record. In both cases
    the owner's alert (`backup.stream_refused`) still says another box is writing.
    [Detail](../backlog/box.md#a-pointer-write-from-a-process-that-has-since-died-landing-after-the-restart-can-still-make-the-box-refuse-itself)
  - The server's 8-second shutdown stops the stream last, after the Cloud snapshot loop, so on a
    large database Litestream may not finish its last upload (it is still told to stop and does
    not outlive the server).
  - `pnpm setup:litestream` skips the download when the installed binary already reports the
    pinned version, so the checksum protects fresh downloads only.

## Loose ends left by SQLite slice 2 Task 7 (#619, how current the bucket copy is).

- **Loose ends left by SQLite slice 2 Task 7 (#619, how current the bucket copy is).**
  - A commit that changes no row but writes to the side file, such as a schema change or a pragma
    such as `user_version`, is not reported, so the lag can read low.
  - An update that writes the same value, straight after a schema-only commit, is still reported,
    although it adds nothing for the bucket (a test pins it).
  - The check that the side file changed was measured on the Mac's filesystem only, not the box's
    Linux one; a commit landing in the same file-time tick after a side-file restart is missed.
  - A sale whose write transaction began before the supervisor first subscribed after boot is not
    counted, so the lag reads low for it.
  - Whether Litestream uploads anything while the side file is unchanged is not measured.

## Loose ends left by A549.

- **Loose ends left by A549.**
  - While the bucket is away, Litestream's local level-0 folder grows with nothing measuring or
    limiting it (`.venue.db-litestream/ltx/0/`): 61 MB over 1,595 sales in about 60 s, with the
    stream pause test's sellers slowed to about CI's rate (an 80 ms wait before each sale) on the
    owner's Mac. A venue's real rate and the box's disk were not measured.
  - Whether the side file grows, and the pause fires, in a real network outage was not run. A549
    stopped the bucket server; with a refused or timed-out connection, Litestream's start-up check
    errors and drops its read transaction to retry (`db.go` v0.5.17, `init`).

## Loose ends left by #668, #686, A57, A60 and #723 (the pause test and the bucket's error reports).

- **Loose ends left by #668, #686, A57, A60 and #723 (the pause test and the bucket's error
  reports).**
  - The wizard route answers `backup.stream_name_invalid` 400, where other bucket failures answer
    502 — the status table in `apps/server/src/setup-api.ts` maps the code as one, and the same
    code also covers a bad value in the recovery kit, where 400 is right.
  - A batch delete's `backup.stream_request_failed` still carries the file's name as the bucket
    listed it in `key` (the `deleteMany` refusal in `packages/stream/src/s3-store.ts`); that the
    prune logger drops it is a review seat's reading and one run, not a guard.
  - The status and `errorName` on the stream's log lines other than the pause check's 403 were
    shown by reading, by the store's scripted HTTP answers and by the supervisor's injected
    errors, not against a real bucket. Amazon S3's 403 to the pause check was logged with
    `backup.stream_request_failed`, 403 and `AccessDenied` (A538-10).
    [Detail](../backlog/box.md#the-status-and-errorname-on-the-streams-log-lines-other-than-the-pause-checks-403-were-shown-by-reading)

## Transactions opened outside the write queue at the same time get a wrong error message.

**Transactions opened outside the write queue at the same time get a wrong error message.** When
two callers open a `db.transaction` outside the queue concurrently (unsupported: they share one
writer connection), one caller's commit ends the shared transaction, and the other is told "the
engine ended the transaction this savepoint was in", though the engine did not. Later writes are
served normally. Found by #1936's review; no product code is known to do this. Next step: decide
whether the store should refuse a second outside transaction outright, or only word the error
for this case (`packages/store/src/node-sqlite-adapter.ts`).

## Recovery actions the 2026-09-08 node-containers design handed on

**Recovery actions the 2026-09-08 node-containers design handed on** (§9.3, §12) — starting without
a module that fails at start, undoing the last module change, and a migration that applied only in
part. Not designed. Only undoing the last module change waits for modules that can be installed on
a running box; a migration that applies only in part can happen on any upgrade today. A798 covers a
box that is still trading.

## The Backups screen's bucket fields copy the bucket copy panel's.

**The Backups screen's bucket fields copy the bucket copy panel's.** The field table, the
required checks and the reveal button exist in both `apps/dashboard/src/screens/backup-screen.ts`
(`CUSTOM_FIELDS`) and `stream-settings-panel.ts` (`FIELDS`), and `normalisePrefix` in
`backup-destination-model.ts` copies the stream package's (`packages/stream/src/names.ts`). Share
them. Left open by A538-6.

## The refund guide does not say that recording a separate-terminal refund is refused during a full-disk stop.

**The refund guide does not say that recording a separate-terminal refund is refused during a
full-disk stop.** `apps/server/src/guide/en/table-service.md` `{#separate-terminal}` (and its
Spanish twin, both new from A803) tells staff to refund on the separate terminal and then record it
in Waitron; while the stop holds, that recording is refused after the money has gone back. One
sentence in each language, as the kitchen-service guide already has. Raised by #1950's rebase
review, 2026-10-22.

## Cloud backup qualification and target-bound recovery: integrate the released Waitron verifier.

**Cloud backup qualification and target-bound recovery: integrate the released Waitron verifier.**
Wire Cloud to the boot-free `backup-verification.js` bundle and its generated owner inventory,
with worker threads denied (A1004 provides the copy-only lock scope), then negotiate recovery v2
before enabling the qualified caller. Preserve the separate fiscal
authority checks. Snapshots remain unavailable until the pinned capture, publication, full data
verification, cleanup, current-claim admission and recovery proof passes with the continuous
source absent. Qualify timeout, resource limits, wrong/missing keys, unsupported public trust,
stale/forged output and uncertain cleanup under the existing limits. Cloud owns its child,
catalogue and deployment gates; see the
[Waitron implementation and release handoff](../superpowers/plans/2026-10-20-a850-backup-verification.md#task-27-finish-evidence-branch-review-and-release-handoff)
and [box limits](../backlog/box.md#backup-data-verification-and-cloud-release).
A1017 qualified the existing [authorised ordinary-restore fixture](../developers/authorised-cloud-restore-fixture.md)
separately (99 existing restore tests passed). Cloud still needs its own same-run proof and
must distinguish verifier non-activation from the ordinary restore's authorised fiscal recovery.

## A917 — the owner chooses the server's `.local` name instead of `waitron.local`

**A917 — the owner chooses the server's `.local` name instead of `waitron.local`** — DESIGNED
2026-10-20 (revised after review rounds 1–3), waiting for the owner's answers to three questions
(where the name is set, the certificate authority, the old name during a rename;
[design](../superpowers/specs/2026-10-20-a917-box-local-name-design.md), pictures in
[mockups/a917-box-local-name/](../backlog/mockups/a917-box-local-name/)); not built. Recommended:
named once on the server's first page, before its certificate authority is made; a later rename is
a planned "re-trust every device" event — devices pair again in place of their old entries, and the
old name only points at the new one for 14 days. Five slices; no migration.

## B3. The bootable USB installer

**B3. The bootable USB installer** — DESIGNED 2026-10-21 and REVISED the same day for the
owner's five answers and W60; waiting for the owner to approve the revision and answer one new
question: [design](../superpowers/specs/2026-10-21-b3-usb-installer-design.md) §18,
[pictures](../backlog/mockups/b3-usb-installer/). A small stick boots an installer that, with nobody
at the box, fetches the newest release, checks its signature, and writes a ready-made Waitron disk
(Debian 13, Docker, the release's images; btrfs subvolumes for A950) inside an encrypted container
whose key the box's security chip holds, with a printed recovery key. The owner's three guards: the
box's own disk first in the boot order, no restart until the stick is out, and a stick that finds
Waitron starts the box unless a key is pressed. The box's screen runs Chromium with no desktop:
the setup wizard, then the dashboard, which can make the screen a till; its settings are a Waitron
page; a one-time maintenance login comes from the dashboard. A setup code stops a stranger setting
up a new box first (W60). Built and booted in CI for every release. Not built. Box image
constraints under [Box image constraints (B3)](../backlog/box.md#box-image-constraints-b3). The
design's §17 lists what it leaves open, each to become its own entry once the revision is approved
(among them moving a box from Debian 13 to 14 before Chromium's fixes stop, and notes for A940,
A947 and A798).

## A1049. The updater honours a version Waitron Cloud marks held (2026-10-24).

**A1049. The updater honours a version Waitron Cloud marks held (2026-10-24).** Cloud's
approved [monitoring design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) (section 10) holds a version when a new error spreads
after its release. Cloud cannot stop an on-prem upgrade (C41 keeps that consent in Waitron),
so the updater must read the hold before offering or applying the version, and offer the fix
once released. Belongs with A1016.

## Decisions and deliberate limits

- **Cloud verification keeps worker threads denied (owner, 2026-10-22, A1004).** Only the fresh
  disposable venue copy omits its watchdog; it still takes the venue lock. Ordinary server and
  restore opens retain monitoring. Cloud must pin the implementing release and requalify its
  genuine capture/verification flow before snapshots become available.

- **A counter Send pressed again during a full-disk stop is refused like any write (A798-B slice 3,
  #1950; owner 2026-10-22: choice (a)).** The gate refuses the resend before `placeOrder` can answer
  it with the first placement (`TILL_OPEN_WHILE_DISK_FULL`, `apps/server/src/till-api.ts`), so the
  till says "Not saved" although the kitchen may already have the order; the order is still on the
  bill once space is back. The owner kept this rather than opening the place route at the gate.
  Likewise (choice (a)) the pay, bill and collect screens keep the sale's own sentence, and every
  other screen shows the single full-disk sentence.

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


- **Every start deletes a cut-off backup run's leftovers in backup staging, whatever the free space
  (A978, owner 2026-10-21).** A backup run stages a plaintext copy of the whole venue database and
  its encrypted copy in `<state>/backup-staging`, and its own `finally` deletes them
  (`apps/server/src/backup-sweep.ts`), so a run that is cut off leaves them behind. Owner: "Every
  start deletes them, whatever the free space — so a plaintext copy never outlives a restart. (The
  start never deletes them while a running server holds the venue folder.)" Built in
  `freeSpaceAtStart` (`apps/server/src/start-space.ts`), which keeps them while another
  process holds the venue folder's lock. The limits that remain: a cut-off run's copy stays until
  the next start, or a Free press on the Box status page while no backup run holds or waits for
  the staging turn (A798-B slice 7); where the lock cannot be taken for another reason (measured on a full disk with
  no other holder), the holder file's heartbeat decides, so a holder that died less than 30 s
  before keeps it until a later start (`docs/developers/conventions-data.md`, "Every start takes
  the venue lock"); a box reset also deletes it (`wipe_box`, `deploy/waitron.sh`). On a box whose first
  setup was retired into a new workspace, the start also deletes them in the workspace's state
  folder (`runEntry`, `apps/server/src/node-entry.ts`; run on a full disk by
  `apps/server/src/start-full-disk.e2e.test.ts`).

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

## 2026-10-23 A799 build authority and history selection

**Cut 3, 23 October 2026:** restricted gzip framing, external-inventory checks,
bounded retrieval, release/source/asset binding and credential-closure contracts
are implemented with injected HTTP and placement adapters. The [archive contract](../../bench/real-upgrade/README.md#admit-sealed-archives-before-candidate-access)
names the conservative private modes, supplied inode reports and later adapter
obligations. No real private download, filesystem placement, image or capture is
qualified. Four further cuts and the separate execution gates remain open.
The following cut-2 and cut-1 paragraphs retain their earlier checkpoint status.

**Cut 2, 23 October 2026:** pure typed facts, issued-F1 coverage declarations,
keyed record/relationship comparisons and complete schema-definition comparison
are implemented. Exact reviewed nullable-field, table-rename and schema mappings
require explicit source/candidate/migration context. The [comparison contract](../../bench/real-upgrade/README.md#compare-original-records-before-making-another-sale)
describes the accepted shapes and their limits. No database or image is opened by
these functions. The remaining five cuts, qualifying captures and execution gates
remain open. The first-cut status below records its earlier checkpoint.

The owner authorised building every published A799 plan cut on 23 October 2026
with “Go ahead and build.” This supersedes the earlier planning-only authority
below; runtime, capture, A760 reset, migration, upload, provider and trusted CI
activation retain their separate gates.

The first cut adds metadata admission, required release selection and pending SQL
classification. The [rig README](../../bench/real-upgrade/README.md) records its
executable examples, the trusted ancestry input boundary and two plan adjustments:
`classifyWork` takes a set-qualified epoch explicitly to reject missing baseline hashes, and
`parseFacts` travels with cut 2's typed facts/schema/coverage model rather than a
shallow placeholder in cut 1. Pending journal IDs remain explicitly unknown until
observed. These changes add no product writer or execution path.

Keep A799 open. The qualification index is empty; the remaining six cuts and their
real capture, issued-full-invoice, migration, continued-sale and containment/access
checks remain unqualified. Historical approval records below retain their dated
meaning.

## 2026-10-22 current A799 approval: design agreed for plan preparation

**A799 planning milestone, 22 October 2026:** you approved the complete design
for preparing the [implementation plan](../superpowers/plans/2026-10-22-a799-real-upgrade-testing.md)
only (owner answer relayed at approximately 17:25). The plan is a separate approval
artifact. Build, historical capture, image execution, migration, A760 reset, upload
and F1 enablement remain outside that planning authority. Keep A799 open until the
plan's preservation, issued-F1 and real pending-migration checks have run. The dated
proposal below remains historical.

This addendum takes precedence over the earlier A799 approval questions below.
Earlier content is retained unchanged as history.

## 2026-10-22 CURRENT A799 addendum: F answered; complete design for planning review

This addendum takes precedence over the previous CURRENT A799 addendum and historical
Upgrade testing area below. The entire earlier file remains unchanged apart from this
insertion. **Only A–F's precise scopes are agreed; the full design, plan and build remain
unapproved.** Earlier unanswered questions and alternatives are historical, not live choices.

The owner answered F on 22 October at approximately 12:30 in Lane F's `questions.md`:
every candidate runs from the oldest supported release and previous retained source release,
counting equal endpoints once. The oldest stays required until the owner explicitly retires
it and names its replacement. **No automatic rolling window.** Keep every original release
bundle and expectation set, including retired sources.

Imagine qualified R1/R2/R3/R4 sources and candidate R5 within one post-A760-reset history.
Without an actual retirement, require **R1 to R5 and R4 to R5**. A hypothetical explicit
owner decision retiring R1 and naming R2 as replacement effective for R5 would require
**R2 to R5 and R4 to R5**. No specific retirement is approved. Retain every R1–R4 original
and expectation set. Endpoint runs supply no passing result for unrun releases; retirement
changes neither exact comparisons nor any published support guarantee.

A–E remain unchanged: invented venue history written by the frozen older product through
normal supported paths; B's required endpoints; each bundle/facts in its own Waitron GitHub
Release with checksums in Git and private CI download verification through existing access
still pending; required issued F1 preservation of its original recorded customer name/address;
and exact old-product-assigned IDs, invoice numbers, dates and timestamps. A fresh capture
with different values gets its own version and independently reviewed expectations. The
candidate never supplies expectations. If the old product cannot issue F1 normally, identify
the prerequisite from evidence and leave A799 open. No unpaid order, F2, restart, new sale,
new writer or F1 enablement replaces that check.

The [complete design for review](../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md)
keeps A760 execution/reset authority separate, requires a qualifying post-reset capture and
a distinct later candidate applying pending migrations through normal boot in that same
history. Same-image runs are restart-only. Keep optional-module-off cases, independently
frozen expectations, exact raw fiscal bytes and node/SIF/series identity, whole stopped-state
capture, isolated disposable copies, exact comparisons and a separate new-sale result.
Missing required inputs or prerequisites block runtime work rather than loosen requirements.

**One next question: do you approve this complete design for preparing the implementation
plan, with all conditions preserved?** Recommend yes. That authorises **PLAN ONLY**, a
documentation-only plan separately reviewed and landed before a later build decision.
It approves no unwritten plan, build, capture, runtime probe, migration, reset, upload,
release-bundle publication, fiscal change or F1 enablement. Landing the plan grants none
of those authorities. The future plan must evaluate actual interfaces/identity seams,
availability, budgets, containment and private CI access through existing permissions.

[Static F/design boards](mockups/a799-real-database-upgrade-testing/revision-f-and-complete-design/README.md)
were rendered and individually inspected in both languages, themes and widths. Native SVG
text-bounds and overlap checks passed. Source observations at
`87f19d4bc98d2fb7925e886228430cabfc490a9b` remain historical and **UNVERIFIED at runtime**.
This documentation answer supplies no runtime, capture, upgrade, new-sale, size or access
result and makes no A799 completion claim.

---
## 2026-10-22 CURRENT A799 addendum: assigned values agreed; support boundary open

This addendum takes precedence over the historical Upgrade testing area immediately
below, which remains byte-for-byte intact. **Only A–E's precise scopes are approved;
the full design, plan and build remain unapproved.**

The owner answered **KEEP THE ASSIGNED VALUES** on 19 October at approximately
21:22 in Lane F's `questions.md`. Keep each capture's old-product-assigned IDs,
invoice numbers, dates and timestamps, comparing those exact facts on every upgrade.
A fresh capture with different values is a new versioned bundle with independently
reviewed expectations. Keep every original; the candidate never supplies expectations.

[Question F and worked R1–R5 example](../superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md):
keep the oldest supported baseline in the same post-reset history until explicit
owner retirement with a named replacement (recommended), or propose a rolling window
of the three most recent retained source releases? **Neither boundary is approved.**
B still selects oldest supported plus previous retained: R1/R4 for R5 without
retirement, or R2/R4 under the proposed R2/R3/R4 window. Deduplicate equal endpoints.
Retirement removes a supported test starting point, never its original bundle or
expectations. It changes no exact comparison or published guarantee; an unrun release
has no passing evidence. [Static E/F boards](mockups/a799-real-database-upgrade-testing/revision-e-and-support-boundary/README.md)
were rendered and individually inspected in both languages, themes and widths. Native SVG
checks found no text outside the canvas or overlapping text. Ask only F next.

A keeps an invented venue written through the frozen older product's normal paths.
C keeps bundles/facts in their own Waitron GitHub Releases, checksums in Git and
private CI access verification through existing access still pending. D requires an
issued F1's original customer name/address to survive before A799 closes. If the old
product cannot issue it normally, identify the evidence-based prerequisite and leave
A799 open. No unpaid order, F2, restart, new sale or new fiscal writer fills that gap.

A760 execution/reset remains separate. Qualifying post-reset capture and a distinct
later candidate applying pending migrations remain required, as do optional-module-off
cases, independent expectations, raw fiscal bytes and node/SIF/series identity.
Preservation and a separate new sale stay distinct. Source reads at
`87f19d4bc98d2fb7925e886228430cabfc490a9b` remain historical and **UNVERIFIED at
runtime**. This revision supplies no runtime evidence or authority to capture or migrate.

---

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

## Till write surfaces not checked for a full-disk refusal's words

Left open by A798-B slice 6 (#1977), from design §4.6 item 2. Since slice 3, once a
save has failed for a full disk, or the box started with less than 16 MiB free, every till write
except the open ones answers `507 storage.disk_full` until the venue folder has 16 MiB free
([conventions-data.md](../developers/conventions-data.md#a-full-disk-stops-the-tills-writes)). The
draft save's refusals and the unpaid departure already say "Not saved: the box is out of disk
space…" (measured 2026-10-22, slice 6's plan), and since slice 6 the station screen does too, on a
kitchen display and on a till's Station tab. The rest were not checked: audit the catch sites in
`apps/till/src` that do not fall back to `codeMessage(code)`. The pass screens on a kitchen display,
which has no strip, were not checked either.

## On a full disk, a till read whose route opens a withTransaction is refused while a change waits

Left open by A798-B slice 6 (#1977). `withTransaction` ends every body with the
change-log drain (`delete from change_log returning payload`, `packages/db/src/change-log.ts`),
which is a write. Measured 2026-10-22 on a migrated venue on a small full disk, with one
`change_log` row waiting: a read-only `withTransaction` was refused `storage.disk_full`, a write-lock
turn holding the same read answered, and a turn holding only the drain's statement was refused. So
the equipment read, which reads in turns, answers; `GET /api/till`, which opens its own
`withTransaction` around `readTillSetup`, and the session-checked till reads (`GET
/api/working-orders` among them) answered `507` with a change waiting — with no change waiting, and
since slice 6 even with a last-seen stamp due, they answer 200. For `GET /api/working-orders`, the 507 came
from the route's own `withTransaction` (`listHeldOrders`) after `requireSession` had caught its own
drain's refusal; for `GET /api/till` it was not isolated
([conventions-data.md](../developers/conventions-data.md#a-read-on-a-full-disk-must-not-fail-on-its-own-housekeeping-write)). PIN sign-in is refused on a full disk in every case, with no session
written.

## On a box with card payments off, the card-reader battery check may raise alert.source_unavailable on every bell read

Left open by A798-B slice 7. `batteryAlertSource` is registered in `bootServer`'s alert
sources whatever the module (`apps/server/src/boot.ts`), and reads `card_readers`, which does not
exist when the payments module is off (A798-B slice 7 plan, M9: `select … from card_readers` threw
`no such table` with the payments set left out); the registry turns a failing source into that
alert (design §5). Read, not run on a booted box. The Box status page leaves its card readers row
out in that case.

## Every start's clean-up deletes a backup folder configured inside backup staging under a backup-encrypt- name

Left open by A798-B slice 7. A `local-fs` backup destination whose folder is
`<stateDir>/backup-staging/backup-encrypt-…`, or sits below one, is accepted by the settings
(`WAITRON_BACKUP_DIR`, `WAITRON_BACKUP_DESTINATIONS`, the Backups screen). The clean-up that
`runEntry` runs at every start (`freeSpaceAtStart`, `apps/server/src/start-space.ts`) deletes that
folder with its archives whatever the free space, unless another process holds the venue folder,
because it reads no backup settings
(`start-space.test.ts`, "deletes backup staging, and keeps rotated logs and old crash reports",
deletes a `backup-encrypt-x` folder above the floor). The Box status page's Free no longer does: it
skips a configured destination folder and any folder holding one, except while the box holds no
backup settings (they cannot be read, or a reload could not open the database). Until then the
user guide's "never touches … your backups" (`box-status.md#free-space`, English and Spanish) does
not hold for such a folder. A fix could refuse such a folder when the settings are saved.

## AEAT's time for a confirmation comes from its QR validation host, not from a `consultar` reply

Whether a certificate-authenticated `consultar` reply carries a `Date` header is not measured. The
`verifactu` repository's live workflow can measure it without filing: a manual run in its
`consult` mode sends one `consultar` (`scripts/live-aeat.mjs:2567-2578` at `754f633`), and one
added line in its `certificateFetch` wrapper (`:195-223`) writing the raw reply's
`response.headers.date` to its output would print it. The wrapper hands back a new `Response`
built without the reply's headers, so reading `date` from what it returns would print nothing.
The production QR host was not tried either. Left open by A798-B slice 9 (#2025).

## Backup data verification and Cloud release

The A850 interface checks a private restored copy without running ordinary restore hooks or
acquiring fiscal authority. The server builds `dist/backup-verification.js`; the production
image copies it and its dependency notices. Its local authority tests use an encrypted archive
with actual sale history and every generated owner. These checks do not qualify Cloud's
container or catalogue admission.

Keep Cloud snapshots unavailable until its integration uses the implementing pinned release,
validates the complete private result, confirms its own child and scratch cleanup, and admits
only a current claim. The opt-in target-bound recovery client uses version 2; the running setup
caller stays on version 1 until Cloud implements that exchange. Joint acceptance must include
recovery with the continuous source absent. Separate recovery authority still applies.

**A1017, 2026-10-22:** the existing `archiveHost()` / `archiveCommand()` fixture is qualified
for a separately authorised ordinary restore at Waitron `0ee4ec275461cae439b74ef62bfba884b9466d12`.
Its three unchanged recovery-placement suites passed all 99 tests, including the ordinary
command, wrong-key and missing-preparation controls. Use the
[fixture recipe and qualification limits](../developers/authorised-cloud-restore-fixture.md).
Cloud's same-run capture-to-recovery proof remains open. Its evidence must distinguish the
verifier's non-activation from the ordinary restore's authorised fresh fiscal allocation;
the existing Cloud refusal is retained, not converted to a pass by this independent receipt.

The current release trust list contains no historical Cloud or paper public roots. A historical
signature requiring an absent reviewed root remains unsupported. External vault-key custody
also needs its separately versioned archive contract. Full-history work under the configured
resource limits and Cloud's actual isolation, deletion and admission remain joint release checks.
See [the plan's release gates](../superpowers/plans/2026-10-20-a850-backup-verification.md#exact-remaining-owner-and-release-gates).

## The Box status page reads the wrongly-dated-sales alerts' params through a cast

`readMisdatedOpen` (`apps/server/src/box-health.ts`) finds the open `clock.records_misdated` alerts
by their code name and reads each alert's params as `MisdatedOpen` behind an `as unknown as` cast,
so the server keeps its own copy of a shape the Veri\*Factu module writes, and nothing checks the
two agree. A fiscal seat method (for example `openMisdated(tx)`) answering the typed list would
remove the copy. Naming a code as a string in `apps/server` is house practice
(`apps/server/src/payments-api.ts`'s status map), so the code name alone is not the problem.
