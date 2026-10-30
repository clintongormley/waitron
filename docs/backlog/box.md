# The box: backups, upgrades and recovery — detail

The open entries are listed in [the backlog](../backlog.md), under "The box: backups, upgrades and recovery". This file holds
their full text.

## The box the customer buys probably doubles as a till, so the image ships a screen and a browser

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

The 2026-09-11 discussion record
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

- **Upgrading takes no effort.** The approved A950 design below keeps rollback available until a clean,
  running restart. Automatic updates start on, with an editable 03:00–05:00 local window
  (owner, 2026-10-29). Its plan awaits owner approval; build and qualification remain open.
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

<a id="automatic-upgrades-that-can-be-undone-until-the-first-order"></a>

## Automatic upgrades with rollback until a clean, running restart

**A950 design and implementation plan approved, 2026-10-29; build eligible cuts separately.**
The [approved design](../superpowers/specs/2026-10-27-a950-automatic-upgrades-design.md) follows the
owner's 28 October answer: rollback closes automatically only after a successful restart of
the new version, a confirmed clean database upgrade and confirmation that the system is running
and answering. This supersedes the earlier “until the first order” title and sequence, including
older summaries elsewhere in this file. Automatic rollback remains required before go-live
(owner, 2026-10-21). “Rolling back is not a fix.”

The host keeps business writes and external effects suppressed during validation, durably records
closure after fresh successful checks, then releases normal requests and duties. No first order,
first real change, scheduled action or acceptance button closes rollback. A healthy checked version
does not wait overnight for staff. Sign-in, clock-ins, PIN changes, refunds, filing and qualified
backup publication are no longer held by the updater after closure. A later failure preserves
current state and needs repair; the saved old state is never offered after closure.

Approved clean-database requirements cover the actual packaged enabled migration sets and dependencies,
no incomplete/ahead sets, database integrity, foreign keys, full protection definitions and
identity/fiscal/workforce/history/allocation preservation. Running checks require fresh local
TLS/listener and representative passive menu/config/history responses bound to the same candidate,
boot and attempt. Health/setup/recovery 200 or a started process alone is insufficient. No venue
test sale or forced staff login is required. These are **UNVERIFIED acceptance requirements**.
The 29 October owner approval sets automatic-on with an editable **03:00–05:00 local**
default for every venue. No initial administrator selection is needed. Both fields remain
required as a valid pair when configured; clearing both explicitly saves an unset window,
which blocks automatic and manual application without affecting downloads or sales. Defaults
never overwrite that saved choice. Pause keeps the saved hours. The end is the latest reopening boundary.
Verified downloads and ordinary sales continue while application waits. Wait for actual close/report and archive completion for that day’s close
episode on the actual primary, then all quiet checks and the full trial plus rollback budgets.
Late/failed/missing/unknown work defers application without cancelling it or gating sales.

The designed timeline distinguishes the configured business-day start and dated labels, reports
on close with no fixed scheduled time, selected backup schedule, actual next due and completed
status, update window and reopening boundary. Source-only inspection at
`288213aef2b66189480c341954dc7dfaea256fdd` supplements the unchanged historical inventory in
the design: backup `auto` uses the business-day boundary +30 minutes + stable 0–10 minute jitter;
it does not prove close/report completion. The inspected daily-report read is on demand and the
frozen-close function has no production app caller in that inspection. No rollover report
scheduler is assumed or proposed. The design cites source lines and the caller search.

Approved contracts require qualified day/node/term/settings/data-bound completion receipts and a
final admission fence, on-demand close/report completion where no job is scheduled, and deferral
when required reporting or backups are disabled/unavailable. A local snapshot or standby’s
disabled archive duty cannot stand in for the primary’s completed archive. Cross-midnight/DST,
clock/cutover edits and stale-day evidence have explicit deferral rules. Automatic-on, bounded
attempts/quarantine, spare-first and these receipt/policy choices have whole-design approval.

The design retains B3's five encrypted subvolumes, complete stopped-state inventory, old images
by immutable digest plus container references, logs/host evidence outside rollback and the
monotonic start-again overlay (2026-10-29, A1206: the start-again note it builds on is retired;
re-plan the overlay before building). Closure/rollback races and lost completion answers use a durable
host journal; uncertain evidence stops admission rather than guessing. RESTORED retires that
attempt's restore permission before old service reopens. Normal work needs no per-operation
updater roundtrip. Bucket/spare publication stays frozen during validation, with qualified
handoff after closure. The spare closes its own boundary before following newer primary data;
the primary keeps selling while it validates. Mixed-version contracts and A947 membership remain
gates. External outages do not block successful local closure or ordinary sales.

App updates remain separate from B3 host/TPM updates. Signed manifest/A1049 Cloud hold checks
precede freeze without putting Cloud on the sale path. Non-B3 disks need a separately qualified
whole-state copy adapter. Failure reporting stays local with existing authorised
notifications; A9/Cloud reporting and A1016 backup/support choices remain separate.

The source inventory is explicitly historical READ evidence at
`9d5853c310e691ed558d80a8a12d0dbddccab2e7`, not today's runtime. Later source changes prove no
A950 behaviour. No A950 Linux, VM, TPM, btrfs, bucket or two-box runtime qualification has run;
A799 historical qualification and B3 hardware/trust holds remain gates; owner option A supplies build authority for eligible cuts.
The [mockup brief and EN/ES copy](mockups/a950-automatic-upgrades/README.md) retain the existing
validation/restoration/completion views and add eight rendered and visually inspected window-settings
views. The [sliced implementation plan](../superpowers/plans/2026-10-29-a950-automatic-upgrades.md)
has owner approval (option A). Cuts 1–2 add isolated settings, dated-window, bounded-discovery, attempt-journal and startup-decision libraries. After cancellation, discovery waits for one immediate callback and one timer callback before deciding whether to retry; unfinished work keeps the discovery slot. Its fake-clock cancellation and cooperative-deadline tests wait for each attempt and deadline to be armed before advancing time; native cancellation cleanup runs between advances. The journal retains one attempt’s immutable hash-linked records and terminal facts behind an injected fixed-root, exclusive-turn, no-follow IO contract. A publication marker keeps failed flushes/read-back under inspection. Startup decisions cover design §6 and require further checks or recorded transitions; they issue no trading permit. The verifier, hold and journal IO boundaries have no production adapters, and no installed updater or timer calls them. B3 must qualify actual root/disk/mount identity, caller authentication, exclusion, IO and power-loss durability. Later controller work must preserve terminal evidence when allocating another attempt namespace, resolve interrupted publication through authoritative evidence, and rebind fresh terminal startup checks before issuing any new-boot release. Floor/publication/input digest references still need their real immutable documents from cuts 3/5. An intact incomplete freeze must be durably abandoned before the old service reopens; elapsed restore budgets now lead to inspection. JournalIo reserves `.turn` inside its namespace: a future production adapter must use that name or keep its lock outside the namespace. Remaining work includes the production close/report receipt
producer, archive completion integration, account-free Cloud hold contract, B3 host/image/trust
qualification, A799 historical evidence, and released A947 stream/spare/membership interfaces.
Host binding also needs diagnostics for missing Temporal, canonical zone handling and an explicit policy for an already-installed candidate.
Application stays disabled until its exact release and platform pass every required gate.
All A950 runtime qualification remains **UNVERIFIED / NOT RUN**.

## Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check

`conventions-data.md` holds the full list — among them a
readiness runner and the dev, demo and Cloud fixture scripts under `apps/server/scripts`, two of
the Cloud fixture scripts migrating through `restore.ts` rather than calling `applyMigrations`
themselves, which a grep for that name alone does not find.

## What `waitron.sh install`'s self-refresh (C83, #890) left open

Installing a ref whose script
predates the refresh puts back a copy that does not update itself (`deploy/README.md` says to
download it again); a copy another user owns in `/tmp` is not updated under `sudo`, because
systemd's `fs.protected_regular` setting stops root writing the fetched script into the temp file
beside it (install reports a failed fetch; the README says to download to the home folder
instead); nothing checks a fetched script before running it beyond what the fetch of `compose.yml`
already trusts — the same GitHub URL over HTTPS. No case in `scripts/waitron-sh.test.mjs` covers a
script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter,
or a box with neither curl nor wget.

## What `waitron.sh --reset install` (#1122) left open

A build or pull that fails still leaves
the box's files changed, as a plain `install` always has. `fetch_box_files` replaces `compose.yml`
before any image work, and an install of `main` removes the image lines from `.env` before its
pull, so after a failure the box's files name the new ref while its running containers are the
old ones. Nothing has been taken down or wiped at that point, and the error asks for a re-run;
making it leave the files untouched means fetching into a temporary folder and moving the files
into place only once the images are in.

## What showing the failed start's reason (#695) left

A failed migration's report names the SET
(`migrations.apply_failed`, `{ set }`), not the migration file, though the refused statement shows
in the detail; the start-up's own log writer ignores `WAITRON_LOG_MAX_BYTES`/`WAITRON_LOG_MAX_FILES`
(it only appends, so they do not apply); the two restore errors' text quotes the "Why the last start
failed" heading with nothing tying the quote to the heading; and no staged restore has been run
through the real migrator to see it end in `migrations.apply_failed`.

## The recovery page's never-wipe test misses Spanish subjunctive forms

`apps/server/src/recovery-surface.test.ts:386-394`, "never suggests wiping anything, in either
language", checks the Spanish actions against `NEVER_WIPE_ES` (`:182`), which matches
`\brestablece` but not `restablezca` or `restablezcas`. Run on 2026-10-25 in Node against the same
expression: `borre`, `elimine`, `resetee`, `formatee` and `vacíe` slip past it too, while
`restablece`, `borra` and `elimina` are caught. Tightening it changes an existing assertion, so
the owner approves that change.

## start-space.ts's `logDir: null` option is dead since A1042

`freeSpaceAtStart` (`apps/server/src/start-space.ts`) still accepts `logDir: null`, meaning "no
logs folder of its own"; both its calls in `apps/server/src/node-entry.ts` pass a folder now that
the start no longer cleans a first-setup workspace. Removing it deletes
the case "with no logs folder of its own, deletes no logs or crash reports below the floor, and
still deletes staging" (`apps/server/src/start-space.test.ts:163`), a changed assertion, so the
owner approves the removal.

## The recovery page's secret bound is a convention, not a guard

#310 masks URL credentials on
every log line — the connection-string shape and nothing else. A secret in any other shape still
reaches the unauthenticated page two ways — through the log tail, and through the failed start's
full detail under "Why the last start failed" (stacks with file paths, the message of each cause
down to five levels, an `AppError`'s params) — bounded only by the convention that an `AppError`'s params
carry none.

## Resetting a box without a terminal

- (owner, 2026-10-02). An operator who set the box up in
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

- (2026-09-14). Both can
  pass the empty-`locations` check and carry on down the venue path; `apps/server/src/provision.ts`
  says in as many words that callers must serialise provisioning, and nothing enforces it — the
  setup route's latch is process-local. #378 closed only the taxpayer row's part of
  it (the second insert now loses to the singleton primary key), and its test claims only that
  neither plan dies on a `tenants_*` key. **Next action:** decide where the lock belongs — a
  database advisory lock around guard→stamp→apply is the obvious home — and prove it with two
  concurrent provisions against a real database, not with the row-level check alone.

## `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the staging folder

- `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged,
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

- `apps/server/src/errors.ts` still cites CLAUDE.md §5 for
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

- `sleepMsFor` in `loop.ts` is `Math.min(max, Math.max(min, wait))`, and config refuses
  `minTickMs > maxTickMs`; `config.test.ts`'s test title (near line 572) says "round back down
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

- The bucket copy panel's refusal for a too-short key names a button ("Turn on backups" with
  archives off, "Change the recovery key" with them on) but does not link or scroll to it
  (`#failureText` in `apps/dashboard/src/screens/stream-settings-panel.ts`).
- With archives on and a key hand-edited too short in `backup.env`, the panel's refusal names
  "Change the recovery key", but that form waits for "Show the current key"
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

- Every synchronous `deriveKey` caller still blocks the event loop while it derives:
  `encodeConfigurationBundle` (through `encryptArtifact`); everything reaching `decryptArtifact`
  (`apps/server/src/artifact-cipher.ts`) — `decodeConfigurationBundle` (on the request path),
  `validateArtifact` (`apps/server/src/restore.ts`) and `unsealNodeState`
  (`apps/server/src/sealed-state.ts`); and the recovery bundle's `encryptBundle` and
  `decryptBundle` (`apps/server/src/recovery-bundle.ts`).

## A pointer write from a process that has since died, landing after the restart, can still make the box refuse itself

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

- The probe first ran it at
  trace level by mistake, and 13 of 24 runs failed with a 500, each one looked at being
  `begin immediate` failing `database is locked` after 5,006 to 5,008 ms. The inferred mechanism:
  Litestream held the write lock while blocked writing its log to a pipe that only the server's main
  thread reads, and the main thread was waiting for that lock. At the normal level Litestream writes
  too little to fill the pipe; that is inferred, not measured. **Next:** check whether any setting
  lets an operator raise Litestream's log level, and read the pipe on a thread that does not wait on
  the database if so.

## The bucket client's limits (A44, #676) — what is still open

`createS3ObjectStore` gives a
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
- **Android certificate trust needs actual-device qualification.** The 2026-09-08 receipt
  (`75f17f9e36125af3a620266a584507420e7197de`) records one Android phone accepting a matching-name,
  outside-CA-subtree leaf; Android/Chrome versions were not captured. It did not measure the
  recovery leaf's hostname boundary. The desktop receipt (`fb47efd683fa8aa2cf919fa012f66e580b9c4f28`)
  records Chrome 152 and macOS SecTrust refusals; an iOS device and the service-worker/PWA/WebAuthn
  trust cases remain unmeasured. [B3 §7.5](../superpowers/specs/2026-10-21-b3-usb-installer-design.md)
  requires separate hostname/CA-subtree negatives and a same-device correct-name positive.
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

While a box is in setup mode, `POST /setup-api/email-test` without the setup
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

In
`BackupSupervisor.reload()` (`apps/server/src/backup-supervisor.ts`) the venue handle is assigned
before `buildBackupBackend` runs for each destination, so a throw there leaves `current().enabled`
true with no sweep running. Reported by A538-4's second Codex review; the driver read the order
but did not reproduce the throw. Build the backends before adopting the handle, or undo on failure.

## The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.

`GET /api/backup/stream` (`readStored`, called by `view`, in `apps/server/src/stream-api.ts`) tolerates only
`server.credential_unusable`; `credentials.decrypt_failed`, `credentials.malformed_payload` and
`credentials.key_version_unknown` fail the read (400 with the raw code), so the panel shows an
error and no form, although the bucket copy's Save would replace the record. Treat all four the
way `UNREADABLE_CREDENTIAL` (`apps/server/src/credentials.ts`) groups them. Predates A538-4.

## Nothing checks that the error codes in the dashboard's `backup_stop` word list are still real.

`apps/dashboard/src/i18n/alert-messages.ts` gives `recovery.state_incomplete` its own sentence on
the `backup.run_stopped` alert; a renamed code would quietly fall back to "Contact support.". The printer word list has such a check
(`scripts/a4-hold-code-copies.test.ts`). Left open by A595 (#1675).

## No test covers the supervisor ignoring results from a backup run a reload replaced.

`backup-supervisor.ts` drops `onUploaded`/`onDestinationResult` reports once that run's
controller is aborted; removing both checks left the supervisor suites green in A538-3's review,
because a reload starts a fresh record only after the old run has finished. The checks matter for
a status read that began before the reload, or one made after `stop()`; a test needs one of those
shapes. Left open by A538-3.

## Backup destination failures log no elapsed time or operation phase.

`runOnce` in `apps/server/src/backup-sweep.ts` reports the destination, error code and errno,
so a timed-out upload cannot be distinguished from time spent waiting on local filesystem work
by those fields. Add non-sensitive phase and elapsed-time diagnostics when investigating real
destination timeouts. A1035 reproduced the main test's folder timeout under controlled load;
the original CI delay remains unmeasured.
[Test timing guidance](../developers/testing-guide.md#a-deadline-test-must-separate-timer-ordering-from-filesystem-speed).

## Authenticated server-certificate recovery

The public connection page can retry managed certificate repair, reread its inspection and stop
this browser attempt. It cannot replace a separately supplied certificate or diagnose every
persistent certificate-file refusal. A successful reinspection does not establish that a
separately supplied certificate has been replaced: its HTTPS address must open without warnings.

Build a secure owner-authenticated repair route with sign-in at the action, cause-specific
choices and a safe Stop before replacement. Keep keys and filesystem details off the public
HTTP page; do not add password entry there. Cover persistent refusal and separately supplied
certificate replacement through their real startup paths. Linked-layout repair is the separate
entry below. These workflows remain open after the A1089 public-page rework.

## Public TLS repair refuses linked layouts.

Healthy linked `tls/` folders still serve HTTPS,
but a damaged linked folder or managed file cannot be repaired through the public guide.
Decide whether to support links contained within the state folder while retaining archive,
exclusion and path-containment checks; cover the restored-layout startup and repair path.
The public page offers retry, read-only Check again and Stop (A1089); support for repairing
linked layouts remains open. Found by A733's whole-branch review; see the server README's
secure-connection section.

## On a full disk, a box whose kept certificates cannot be used shows the connection set-up page, with no word of the full disk.

The connection-bootstrap branch (`needsConnectionBootstrap`,
`apps/server/src/node-entry.ts`) returns before the count check, as A798-B slice 2's plan
decided. Its pre-merge review ran `runEntry` on a filled 32 MiB HFS+ image with an empty TLS
folder, and `/` answered "Set up secure connection" and did not contain "disk is full". Open:
should that page also say the disk is full and show the free space?

## Guide replacement address settings after a cold restore.

Replace manual configuration of
the advertised origin and dashboard origin/passkey domain with a recovery step that checks they
match the replacement's address. Local certificate repair and authenticated restore entry already
have surfaces; Cloud tunnel and staff-certificate installation remain under the Cloud integration
loose ends below. Coordinate naming with A917 and failover addressing with A947.
[Tested steps and remaining limits](../developers/cold-restore-surfaces.md).

## Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive destination).

- The status watcher does not retry its own failed mint (the mint is a POST, never passive
  session activity), so the screen then offers no key until it is reopened.
- The edit-settings form can meet `backup.recovery_key_exists` when a rotate (from another tab
  or admin) lands after it fetched the key.

## Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

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

- While the bucket is away, Litestream's local level-0 folder grows with nothing measuring or
  limiting it (`.venue.db-litestream/ltx/0/`): 61 MB over 1,595 sales in about 60 s, with the
  stream pause test's sellers slowed to about CI's rate (an 80 ms wait before each sale) on the
  owner's Mac. A venue's real rate and the box's disk were not measured.
- Whether the side file grows, and the pause fires, in a real network outage was not run. A549
  stopped the bucket server; with a refused or timed-out connection, Litestream's start-up check
  errors and drops its read transaction to retry (`db.go` v0.5.17, `init`).

## Loose ends left by #668, #686, A57, A60 and #723 (the pause test and the bucket's error reports).

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

When
two callers open a `db.transaction` outside the queue concurrently (unsupported: they share one
writer connection), one caller's commit ends the shared transaction, and the other is told "the
engine ended the transaction this savepoint was in", though the engine did not. Later writes are
served normally. Found by #1936's review; no product code is known to do this. Next step: decide
whether the store should refuse a second outside transaction outright, or only word the error
for this case (`packages/store/src/node-sqlite-adapter.ts`).

## Recovery actions the 2026-09-08 node-containers design handed on

(§9.3, §12) — starting without
a module that fails at start, undoing the last module change, and a migration that applied only in
part. Not designed. Only undoing the last module change waits for modules that can be installed on
a running box; a migration that applies only in part can happen on any upgrade today. A798 covers a
box that is still trading.

## The Backups screen's bucket fields copy the bucket copy panel's.

The field table, the
required checks and the reveal button exist in both `apps/dashboard/src/screens/backup-screen.ts`
(`CUSTOM_FIELDS`) and `stream-settings-panel.ts` (`FIELDS`), and `normalisePrefix` in
`backup-destination-model.ts` copies the stream package's (`packages/stream/src/names.ts`). Share
them. Left open by A538-6.

## The refund guide does not say that recording a separate-terminal refund is refused during a full-disk stop.

`apps/server/src/guide/en/table-service.md` `{#separate-terminal}` (and its
Spanish twin, both new from A803) tells staff to refund on the separate terminal and then record it
in Waitron; while the stop holds, that recording is refused after the money has gone back. One
sentence in each language, as the kitchen-service guide already has. Raised by #1950's rebase
review, 2026-10-22.

## Cloud backup qualification and target-bound recovery: integrate the released Waitron verifier.

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
separately. Cloud still needs its own same-run proof and
must distinguish verifier non-activation from the ordinary restore's authorised fiscal recovery.

## A917 — the owner chooses the server's `.local` name instead of `waitron.local`

DESIGNED
2026-10-20 and its three questions answered (where the name is
set, the certificate authority, the old name during a rename;
[design](../superpowers/specs/2026-10-20-a917-box-local-name-design.md), pictures in
[mockups/a917-box-local-name/](../backlog/mockups/a917-box-local-name/)); not built. **Not
scheduled:** on 2026-10-25 the owner said "Put it on the backlog. I'm not sure I want to allow that
change", so whether the name should be changeable at all is open again. Recommended in the design:
named once on the server's first page, before its certificate authority is made; a later rename is
a planned "re-trust every device" event — devices pair again in place of their old entries, and the
old name only points at the new one for 14 days. Five slices; no migration.

## B3. The bootable USB installer

APPROVED WITH CHANGES, owner 2026-10-26 ~12:15:
“We don't need the configuration code. It's not a concern. The rest approved.”
[Design](../superpowers/specs/2026-10-21-b3-usb-installer-design.md),
[plan](../superpowers/plans/2026-10-26-b3-usb-installer.md),
[pictures/status](../backlog/mockups/b3-usb-installer/). Planning slices 1, 2, 3, 5, 6 and 8 is
authorised; no build. Q2 stays answered: Prepare on the SAME box, then an admin freshly
reauthenticates before destructive cutover, saves allowed configuration and starts fresh Live
without USB, OS reinstall, disk/encryption reset or practice database promotion. The encrypted,
host-owned durable handoff and audit survive outside the removed venue. Interruptions continue
the recorded operation and never erase a newly created Live venue. No setup code, private preview,
setup/resume/recovery grant or credential reserves that fresh setup; LAN first claim, including
pending fresh Live, is explicitly accepted. W60's first-claim concern is closed by that decision;
its production-mode restriction stays. Blank stick boxes offer Prepare/Live/existing-venue,
without Demo; production-started boxes offer neither Demo nor Prepare.

The small downloading stick and three guards stay: disk first in boot order, mandatory USB
removal before restart because firmware can ignore that order, and a stick that finds Waitron
starts it after 15 seconds unless a key is pressed. The encrypted disk, Chromium under `cage`,
no desktop, dashboard/till choice and separate later maintenance feature remain in the design.
The local-screen marker only displays the till card; a foreign browser lacks it. Even a forged
marker still needs `device.manage` and manager acceptance.

Every first/later recovery sheet includes the correct disk key and LUKS UUID; restore/spare add a
separate page for the actual destination disk. Proposed storage is a host-root-only `0600` file
under `/var/lib/waitron-host/disk-recovery/` on separate encrypted `@host-state`, outside OS/venue rollback, the database, backups,
bucket, configuration export and snapshotted `@volumes`. First delivery uses a protected internal
host channel without requiring a pre-existing admin; later copies require fresh admin proof and
audit. The cost is that privileged running-host compromise can obtain the retained key; “kept”
no longer erases it. Reinstall makes a new disk/key; configuration cutover keeps the old pair.
The USB never carries it. §7.5 replaces the terminal fallback with a Spanish/English Waitron
preboot screen, local and LAN-reachable. The owner's 2026-10-26 ~13:45/~14:00 CET answers settle
reachability/Wi-Fi and supersede the A/B/C picker. Locked HTTP `waitron.local` redirects straight to
trusted `https://unlock-<installation-id>.waitron.local`; locked HTTPS `waitron.local` uses a
deliberately untrusted redirect-only certificate NOT signed by the box CA. The owner accepts
that one warning only to reach the redirect, never a key form there. The actual disk key is entered
only locally or at the verified trusted recovery hostname. Full URL and fingerprints stay on the
sheet. Normal server certificate/private key and CA signing key stay encrypted; the separate
CA-signed recovery leaf private key and untrusted redirect leaf key stay outside encryption.

The minimal normal Wi-Fi SSID/password and required join fields may be copied unencrypted to
boot; no separate recovery SSID or unlock hotspot. Accepted cost: someone holding the box can
extract the Wi-Fi password. The operator guide must tell the venue to change it after theft.
§7.5 proposes a host-owned fixed-path, durable/atomic update on every Wi-Fi change and cable-only
removal/obsolete-copy cleanup, outside boot-loader-measured bytes. No arbitrary paths, logs, disk
keys, other credentials or credential-bearing URLs. Missing/stale/corrupt/unjoinable copies,
failed updates and power cuts offer honest cable/local-display fallback, not a working-Wi-Fi
promise. The shared 2/4/8/16/32/60-second delay, cap 60 and reboot reset remain the plan proposal,
not numbers explicitly chosen by those owner answers. No sign-in or first-claim authority is added.

Actual Android Chrome qualification is **UNVERIFIED / NOT RUN**. Literal commit
`75f17f9e36125af3a620266a584507420e7197de` records one Android phone accepting a CA-signed
outside-subtree leaf on 2026-09-08, without Android/Chrome versions. That is historical negative
evidence, not proof the recovery leaf passes a hostname mismatch or a current-device pass. The
affected trust design/release is held for requalification: same-device/build explicit-CA-trust
controls must reject the actual recovery leaf at `waitron.local`, reject a matching outside-subtree
leaf, and accept the correct recovery hostname. Retain device/build/trust-store and actual leaf
metadata; Node TLS probes do not qualify Android. Failed negatives block release and any changed
approved behavior needs an owner decision, never silently weaker checks. No new approval question
is pending unless review/Android changes approved behavior. An unsigned startup image still cannot
prove itself honest. [FYI](mockups/b3-usb-installer/question.txt) replaces the policy question.

§12 retains the full copy/reconnect inventory, suspended staff, stripped credentials, inactive
printers and missing device enrolments. A989's required-language/import readiness must pass before
removal. Reorient and bind actual reset/ownership calls after A1042's release; no stale reset API
is selected here. A940 production releases and actual Linux/VM/TPM/firmware evidence remain gates;
Local Docker availability must be checked before qualification; mocks cannot replace that evidence. Six slices
remain the go-live minimum; no unqualified boot image is published. Time zone still comes from
the setup area and venue details under its history limits, separate from the clock's time instant
(§10, retaining A798's dated pointer). §17's remaining follow-ups stay open, including Debian 14,
large release assets and the A940/A947/A798 coordination. Nothing built.

## A1049. The updater honours a version Waitron Cloud marks held (2026-10-24).

Cloud's
approved [monitoring design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) (section 10) holds a version when a new error spreads
after its release. Cloud cannot stop an on-prem upgrade (C41 keeps that consent in Waitron),
so the updater must read the hold before offering or applying the version, and offer the fix
once released. Belongs with A1016.

## Decisions and deliberate limits

**A798-B clock, disk and printer decisions.**

The owner's four answers: no reserved
  space on the disk (2026-10-28, A1127: the box now keeps an 8 MiB spare file, released by a start on a nearly full disk, by a start emptying a discarded backup recovery and by the setup repair page's Start again (`waitron.sh reset` also deletes it); a release leaves a marker that holds the till stop until the spare is written back; a trading server never releases it. See [conventions-data.md, "The box's spare file"](../developers/conventions-data.md#the-boxs-spare-file)), a warning and an email at 2 GB free; when a printer stops, every till and
  handheld is told at two minutes; while the box's clock reads earlier than its last recorded
  sale, every action that takes or gives back money, or would write a fiscal record, stops on every
  device — reversing D8 and A364 for that case only — until the clock is set (design §4.8; the
  defaults that answer left open are in §6); and payments restart only on fresh proof that the clock
  is right. On 2026-10-24 the owner replaced that last answer's manager's restart, at most 24 hours
  behind (question 4, 2026-10-20): payments restart by themselves, whatever the gap, once AEAT, two
  devices from two network addresses or an administrator's own device confirms the clock, and the
  sales a clock running ahead dated wrongly are listed for the owner and the tax adviser (design
  §4.9).

**Full-disk write stop (owner, 2026-10-21, A798-B slice 3, #1950):** refusing before the card reader on a full disk or a clock before 28-10-2024, and every till write once a save has failed for a full disk or the box started with less than 16 MiB free — the design's wider stop, which the owner chose on 2026-10-21.

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


- **Backups make room for themselves (A1167, owner 2026-10-28 and 2026-10-29).** Owner, 2026-10-28:
  "our backup policy needs to delete old backups automatically when we're running out of disk space,
  plus alert the administrator, plus refuse to do a backup if there still isn't enough space, and
  alert the manager." Design:
  [2026-10-28-a1167-backups-make-room-design.md](../superpowers/specs/2026-10-28-a1167-backups-make-room-design.md),
  its four questions answered in `~/waitron-campaign/questions.md` ("OWNER ANSWERS — A1167"). On
  2026-10-29 the owner chose that the deletion words give the days the deleted backups were taken
  (the oldest and newest when they differ), and that both backup emails' subjects start with the
  venue's name. How the run, the free-space watch and the start delete:
  [conventions-data.md](../developers/conventions-data.md#a-backup-run-makes-room-for-itself-or-is-refused-before-it-copies)
  and [the backup room note](../developers/conventions-data.md#the-backup-room-note).

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
  the venue lock"); a box reset also deletes it (`wipe_box`, `deploy/waitron.sh`). On a box where a
  backup recovery from the setup repair page has selected its own folders, the start deletes them
  in that recovery's state folder instead (`runEntry`, `apps/server/src/node-entry.ts`; read, not
  run).

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

`removeChangeFeed` (`packages/db/src/change-feed.ts`, called first by
`applyMigrations`) drops each `waitron_change_*` trigger on its own. A751's probe on the full
schema: 561 drops took 85–180 ms that way and 43–48 ms inside one transaction; A736 measured
53–56 ms against 23–25 ms. Boot migrates at every start (`apps/server/src/boot.ts`), and the
removal is about a quarter of the upgrade walk's processor profile.

## The Amazon S3 delete and archive rehearsal's open edges (A538-9)

Left open by #1668, in
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

Left open by #1658, in
`apps/server/src/testing/aws-rehearsal.ts`, `testing/aws-pause-gate.ts` and
`aws-stream-pause.aws-rehearsal.test.ts`: (1) the scenario's
`beforeRestart` hook is called only by the AWS file, so no local test fails if the call goes (the
AWS run would stop with "step 7's restart was never watched"); (2) the held-check evidence counts
a held call at the server's own proxy but cannot say which call it is (TLS hides it) — the later
logged 403 is what ties the refusal to the pause check.

## The Amazon S3 rehearsal runner's open edges (A538-7)

Left open by #1648, all in
`apps/server/src/testing/aws-rehearsal.ts` and its runbook `docs/developers/aws-backup-rehearsal.md`:
(1) after the 60-second settle wait, teardown can still race a scenario stuck in a call that takes
no stop signal (a restore); (2) running the cleanup command again overwrites the previous cleanup
receipt, losing the earlier attempt's teardown ledger; (3) the receipt reader the cleanup uses is
more lenient than the writer.

## Two small leftovers in the Backups destination form (A639, #1695)

(1) A folder typed in the settings editor and then cancelled can reappear in the
"Turn on backups" form later; it is never sent and never counts as a change. (2) A refusal of the
other bucket's secret that arrives after the owner switched the bucket choice away from "Another
S3-compatible bucket" is dropped, so the next Save asks again. Neither was reproduced outside the
reviewer's run. Separately, an entry of the Save's `destinations` list with an unknown kind is
refused under field `destination`, a name the request no longer has; the dashboard never sends one
(`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`).

## A recovery kit can carry a recovery key its own restore refuses

`parseRecoveryKit`
(`packages/stream/src/kit.ts`) refuses a recovery key holding a C0 control character or DEL, which
the box's key rules (`checkedRecoveryKey`) accept, so a box with such a key prints a bucket copy code
in its recovery pack whose restore calls it damaged; the pack's archive code accepts such keys. Predates A538-5 (kit.ts
last changed in #627). `bench/sqlite-failover/src/probes/restore-time.ts` still computes free
space as `bavail * bsize`, where the server multiplies by `frsize` (`free-bytes.ts`).

## A restore that fails while writing the secrets has already replaced the venue database

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

- A `GB-vat` run
  exits 0 in `cli.test.ts`; the README repeats two reasons #561 deleted from the code's comments: that
  `provisioning.venue_conflict` means a concurrent run committed between plan and apply (the apply
  reads and writes inside one `withTransaction`, `venue-apply.ts`, and whether a second PROCESS can
  interleave was not measured) and that the entry point can only be checked through the built
  bundle (its prompt function runs straight from source).

## `packages/provisioning` code found by #561 and not changed

- The `quoteLiteral` re-export in
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
Use the
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

`readMisdatedOpen`, `readMisdatedHandled` and `readMisdatedEpisode` (`apps/server/src/box-health.ts`)
find the `clock.records_misdated` alerts (open, handled, and one by id for the download) by their
code name and read each alert's params through one `as unknown as` cast (`misdatedParams`), so the
server keeps its own copy of a shape the Veri\*Factu module writes. The compiler does not
check the two agree; only the field checks in `apps/server/src/clock-confirm.route.test.ts`, where
the real module writes the alert, do. A fiscal seat method (for example `openMisdated(tx)`)
answering the typed lists would remove the copy. Naming a code as a string in `apps/server` is house
practice (`apps/server/src/payments-api.ts`'s status map), so the code name alone is not the
problem.

## Some sales dated wrongly are in no list

Two kinds of sale dated wrongly reach no list on the Box status page and no file for the adviser
(design §4.9 f):

- **A clock put right from little more than a minute ahead.** A clock that ran ahead while a clock
  check waited is caught when putting it right brings the payment stop back, but only when the box's
  15-second look sees the stop return, which it can miss when the clock was little more than a
  minute ahead; the sales that clock dated are then in no list.
- **A stop the box "cannot tell" about.** When the stop ended by itself but nothing confirmed the
  box's clock, the alert asks the manager to go through every sale since the stop began,
  but the box lists none of them, so the page shows no table and offers no download
  (`apps/dashboard/src/screens/box-status-screen.ts`, the actions row; the download route answers
  `alert.not_found` for it, `apps/server/src/box-health-api.ts`).

Left open by A1088.

## The adviser's file is comma-separated in both languages

The file for the adviser (`apps/server/src/misdated-sales-csv.ts`) joins its cells with `,` whatever
the venue's language, and writes a Spanish amount with a decimal comma inside a quoted cell
(`12,30`). LibreOffice set to es-ES opened the Spanish file in columns (A1088 visual check,
2026-10-25). A spreadsheet set to expect `;` may open it in one column;
Excel is not installed on the machine that checked, so Excel in Spain is untested. The working-time
export (`apps/server/src/attendance-export-csv.ts`) also joins with `,` in every language. Whether
the `es` file should use `;` is the owner's decision.

Two smaller points from the same check, in LibreOffice:

- Amounts are shown without fixed decimals: `12.30` shows as `12.3` and `-5.00` as `-5`. The file
  holds both places; the spreadsheet drops them.
- A cell the shared formula guard protects shows its apostrophe: `=1+1` shows as `'=1+1`. The guard
  (`csvCell`, `apps/server/src/attendance-export-csv.ts`) puts an apostrophe before text that starts,
  after any spaces, with `=`, `+`, `-` or `@`, or with a tab or a carriage return, so the
  spreadsheet does not run it as a formula.

Left open by A1088.

## A device's or an administrator's time is self-reported.

Whatever their browser sends counts:
  a scripted request can send any time, and "nobody types a time" is true of the screen only. In
  slice 9 that can lift a stop, never set the clock. What limits it: devices must be enrolled and
  come from two different network addresses; an administrator must be signed in and, outside
  development, not on the box;
  every confirmation is kept with its proof; the sales listed as dated wrongly go to the owner.
  Slice 9b is to add an alert and an email for every clock change the box makes. Left open by
  A798-B slice 9 (#2025).

## The box sends AEAT's QR host a HEAD once a minute by its steady clock (on every look when that clock cannot be read or went backwards) while the Veri\*Factu module reports the box's clock behind the latest sale — during a stop, and under a confirmation that lifted it — or while a clock check whose stop has ended waits for its witness

This applies on a primary that files records. The module reports no stop while the clock reads
a date before 28-10-2024, so no HEAD is sent then.
  Left open by A798-B slice 9 (#2025).

## AEAT's time outranks the devices.

AEAT agreeing with the box restarts payments even if two
  devices disagree (the bell still shows their `clock.disagrees`); AEAT disagreeing blocks the
  devices and an administrator for the rest of the stop, even after a step of the clock that leaves
  the stop on, since in slice 9 the box cannot set its clock. The disagreement is kept in memory,
  so restarting the server forgets it. Slice 8's own ways out remain: the clock put right, or real
  time passing the record. The owner may prefer it to lapse at a step (owner FYI 6). Left open by A798-B slice 9 (#2025).

## `clock_stop_restarts` is written by nothing: drop it, and its two backup-check links, in the go-live migration squash (A760).

Slice 9 kept the shipped append-only table rather than
  rebuild or drop it; the backup check still checks its links to `nodes` and
  `registros_facturacion` (`packages/fiscal-verifactu/src/backup-verification-history.ts`). First
  move its latest-record query-plan case (`clock-stop-restarts.test.ts`, "reads the latest record
  through the time index…") into `clock-behind.test.ts`, and update the pointer in
  `docs/developers/conventions-data.md`. Left open by A798-B slice 9 (#2025).

## The bell's printer check reads every print job.

`EXPLAIN QUERY PLAN` shows `SCAN
  print_jobs`: 0.25 ms with no printed jobs, 3.7 ms with 50 000 (slice 10 plan P4). A redundant
  status condition did not change the plan; why SQLite scans is not established. The bell pays it
  on every read; the till's printer notices share one read per ten seconds. Left open by A798-B
  slice 10.

## The email about a clock set before 28 October 2024 rarely leaves the box.

With a date that
  early the box cannot check a mail server's certificate (`CERT_NOT_YET_VALID`, slice 10 plan P8),
  so the email waits until the clock is fixed, when there is nothing left to say. A plain relay or
  the practice box's local capture does receive it. For the owner to know. Left open by A798-B
  slice 10.

## The till's card-charged sentence for the clock says "press Pay", which does not fit a bill's card.

For a card taken from a bill's payment options (Whole bill, Pay items, Contribute, Split
  equally), Pay answers `order.payment_in_flight` until the box records the pending payment itself
  (probed during the build: a second card contribution on the charged bill was refused 409 and
  charged nothing). A bill variant of the sentence is open. Left open by A798-B slice 8 (#2012).

## The Clock row says 'connect the box to the internet' where that may not help.

On a box that
  does not keep its clock in step with internet time (since A798-B slice 10, `waitron.sh install`
  switches synchronisation on where the system provides it, and says so where it cannot);
  and on one that does, the same advice shows where the clock is right and the latest record's time
  was wrong — neither half clears the stop. The `clock.unusable` email
  (`apps/server/src/i18n/box-emails.ts`) also tells the managers to connect the box to the internet
  first. Left open by A798-B slice 8 (#2012).

## 'Equipo' names two things in the Spanish dashboard.

The bell's new area for the box is
  'Equipo' (design §4.3), and so is the sidebar's staff group (`nav.group.team`,
  `apps/dashboard/src/i18n/strings.ts`); since A798-B slice 7 the Box status page is «Estado del
  equipo» too (`nav.box_status`). The owner's picture 3 shows the first two. Not yet put to the
  owner. Raised by A798-B slice 5's plan.

## An alert source that writes would take the whole bell read down on a full disk.

The bell's
  full-disk retry reads every source that runs in the request's transaction in one `withWriteLock`
  turn with no drain, the arrangement M2 measured failing for notice sources
  ([conventions-data.md](../developers/conventions-data.md#a-read-on-a-full-disk-must-not-fail-on-its-own-housekeeping-write));
  the equipment read gives each notice source a turn of its own. No core alert source writes today
  (convention review, 2026-10-22, a grep for `.insert(`, `.update(` and `.delete(`). Left open by
  A798-B slice 7.

## A798-B. Build "degraded but trading": what the box does, and tells staff, when a part fails but it can still sell.

Design revision 7 (2026-10-24); every owner question answered except one the slice 9b outline
  keeps for when 9b is planned. The remaining build follows the design's §8 slices:
  [plan](../superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md),
  [design](../superpowers/specs/2026-10-19-a798-degraded-trading-design.md),
  [mock-ups](../backlog/mockups/a798-degraded-trading/README.md).

Two slices from those answers are open, each its own later pull request: 9b, the box sets its own clock from a confirmed source and watches its time service ([outline](../superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md)); and 9c, a clock check at every start and after every change of the clock, with selling stopped while it waits ([outline](../superpowers/plans/2026-10-24-a798-9c-clock-check-at-start-and-change.md)). Open asesor questions:
  [Q51](../compliance/asesor-questions.md#q51-a-chain-whose-record-times-step-back-once-when-the-boxs-clock-is-confirmed-added-2026-10-21-revised-2026-10-24),
  [Q52](../compliance/asesor-questions.md#q52-sales-recorded-under-a-restart-whose-clock-later-proved-wrong-added-2026-10-21)
  and
  [Q60](../compliance/asesor-questions.md#q60-sales-dated-later-than-the-real-time-by-a-clock-that-ran-ahead-added-2026-10-24).
