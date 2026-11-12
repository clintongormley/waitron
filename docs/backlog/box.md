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

- **Upgrading takes no effort.** The shorter A950 plan below is approved (owner, 2026-11-09 22:04).
  Lane F builds manual recovery first after A739 and A840/A842/A848; build and qualification
  remain open. Later automation defaults on once activated, with an editable 03:00–05:00 local window.
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

**2026-11-09:** A950 is go-live work again. The [two-group plan](../superpowers/plans/2026-11-09-a950-shorter-upgrades.md) is approved (owner, 22:04); Lane F builds its first group after A739 and A840/A842/A848. The owner chose steps 2/3/4/8 first, with no other-project dependency: copy/restore, readiness and a real sale on a disposable copy, online trial migration (A799), and safe manual install-fix-now from current data. Later: signed releases (A940/B3), timer/window, status/email, then pairs needing a new A947 upgrade-hold decision. No btrfs requirement. First-group host status/logs do not promise email; the owner accepts no email when neither version starts. Any copy-sale refusal fails readiness. Manual failure offers restore/keep; automatic failure restores by itself. Cloud hold, password-checked manual go-back, proof-of-close and backup-stream handoff are after-first-venue work. Full venue upgrade qualification remains UNVERIFIED / NOT RUN.

**Remaining first-group work:** connect the contained data-check entry to host readiness, start the print agent without sending jobs, qualify the mandatory sale on a disposable copy and Linux interruptions (3b), add the online trial (4), then activate manual commands with the replacement restart/recovery services and installed-recipe integration (8). The stopped-tree controller, host image/recovery adapter, pinned host-runtime bootstrap and contained data-check library are dormant foundations; no installed command or service uses them. The library checks packaged migrations, both SQLite files, append-only protection, configured fiscal history, menu structures, an Orders page and its details, and the configured TLS listener while refusing requests. It reports data checks only; no test sale is implemented yet. Full venue upgrades, readiness, test sales and power loss remain unqualified.

**Historical design summary, 2026-10-29; retained receipts, superseded delivery requirements.**
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
B3 hardware/trust holds remain gates (A799 is folded into A950's new plan, owner 2026-11-09).
The mockup brief and EN/ES copy (removed from the repository on 2026-11-02) retained the existing
validation/restoration/completion views and added eight rendered and visually inspected window-settings
views. The [sliced implementation plan](../superpowers/plans/2026-10-29-a950-automatic-upgrades.md)
has owner approval (option A). Cuts 1–2 add isolated settings, dated-window, bounded-discovery, attempt-journal and startup-decision libraries. After cancellation, discovery waits for one immediate callback and one timer callback before deciding whether to retry; unfinished work keeps the discovery slot. Its fake-clock cancellation and cooperative-deadline tests wait for each attempt and deadline to be armed before advancing time; native cancellation cleanup runs between advances. The cancellation test polls with a zero interval and checks that synchronisation leaves its fake clock unchanged. The cooperative cases also cover an adapter admitted on the next event-loop turn. Both fixture groups abort and await their discovery in `finally`; forced-assertion controls leave the following discovery able to run. The separate uncooperative-timeout fixture still needs `finally` cleanup that settles its deliberately non-cancelling adapter after a failed assertion. The journal retains one attempt’s immutable hash-linked records and terminal facts behind an injected fixed-root, exclusive-turn, no-follow IO contract. A publication marker keeps failed flushes/read-back under inspection. Startup decisions cover design §6 and require further checks or recorded transitions; they issue no trading permit. The verifier, hold and journal IO boundaries have no production adapters, and no installed updater or timer calls them. B3 must qualify actual root/disk/mount identity, caller authentication, exclusion, IO and power-loss durability. Later controller work must preserve terminal evidence when allocating another attempt namespace, resolve interrupted publication through authoritative evidence, and rebind fresh terminal startup checks before issuing any new-boot release. Floor/publication/input digest references still need their real immutable documents from cuts 3/5. An intact incomplete freeze must be durably abandoned before the old service reopens; elapsed restore budgets now lead to inspection. JournalIo reserves `.turn` inside its namespace: a future production adapter must use that name or keep its lock outside the namespace. Remaining work includes the production close/report receipt
producer, archive completion integration, account-free Cloud hold contract, B3 host/image/trust
qualification, and released A947 stream/spare/membership interfaces in that historical route.
For the next build, follow the new plan above rather than those superseded dependencies. Reuse settings/window policy after removing retired clock-digest inputs; keep old discovery/journal/admission and A799 download helpers unwired instead of fabricating their inputs. A799 has no separate delivery. Activate only after the new route's applicable real checks pass on the exact releases and platform.
All A950 runtime qualification remains **UNVERIFIED / NOT RUN**.

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

## `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the staging folder

- `resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged,
  and nothing chmods the staging folder that the archive restore's two entries outside `secrets/`
  (`manifest.json` and `db.dump`) are checked against; it receives nothing and keeps an existing
  folder's mode. Still open, not fixed, by the owner's choice: `unpackStateFiles`'s walk and file
  write go by path, so a folder inside the destination swapped for a symlink during the unpack is
  followed. The A41 run-it review reproduced an outside folder being set to 0700 and receiving the
  secret that way. It needs someone able to write inside the destination. `tightenTlsDir`
  (`box-secrets.ts`, A52) leaves a linked `tls/` and the folder it points to as found, by the
  owner's choice, and a link swapped in for the state folder or a folder above it is followed; a
  folder its owner cannot read is changed by path after an `lstat`, and a link swapped in between
  the two would be followed. The restore itself (`stageSecrets`, `restore-secrets.ts`) refuses none of these on the state folder it is given: a symbolic link, another user's
  folder, or something that is not a folder. The lock-file measurement kept in `db-wipe.ts` names no engine version
  or platform.

## Server comment pruning notes

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

The restore question A38 (#669) raised about `readNodeMembership`'s callers trusting the row is open under Task 9a. Two notes #653's prune
deleted and nothing else recorded: nobody knows why the 5-second busy timeout did not absorb a
`database is locked` in the pending-payment sweep (a candidate cause, not verified for the sweep:
a busy wait on the server's own thread,
[testing-guide.md](../developers/testing-guide.md#a-test-that-runs-the-server-in-its-own-process-writes-to-the-database-only-while-the-server-is-down));
and nothing proves `startServer` itself survives a backup duty that cannot start — only
`backup-supervisor.test.ts` covers that, at the supervisor. Left open by A39 (#671): each stop is written twice, once in the failed-start unwind
list (`undoOnFailure`, `boot.ts`) and once in the background-duties table
(`background-duties.ts`), whose order `background-duties.test.ts` pins.
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
  (`apps/server/src/sealed-state.ts`).

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
`modules.json`; the replacement's private `cloud/recovery.json`, `cloud/replacement.json` and
`cloud/connection.json` stay outside that named capture set and the captured ciphertext archive.
The exclusion set for the deeper change is `scratch/`,
`logs/`, the per-hardware `instance.env`, `recovery.json`, and its lock file `recovery.lock` with the `recovery.lock-journal` SQLite keeps beside it while held. Touches BR-2, BR-3 and the recovery
bundle. Named carry-forwards: a stale-`.tmp` sweep; a working-backup boot success-path integration
test; scope the flat `resolvers` map by module when a second `nonDbState` module lands; a
`packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails safe under GCM auth
today); generalise archive entry routing off declared source ids when a second non-DB source lands.
Database placement durability: sync both incoming database files and the venue folder, then
qualify power loss during placement; A1415's process-kill tests establish restart decisions only.

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
- **The box image keeps its clock synchronised, with no terminal** (A798). The server reads
  the time service through the box's host service (`apps/server/src/box-host-client.ts`) and
  reports "unavailable" when that service does not answer. Since A798's revision 5 (owner, 2026-10-19) a box whose clock
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
The [account-delivery amendment](../superpowers/plans/2026-11-08-a987-account-delivery-details.md)
covers the account result messages and recovery actions.

Prepare requires a usable route before setup completes outside development. Live asks again;
configuration export carries no mail settings or secrets. Settings → Email serves Prepare and
Live; saved-relay changes and captured messages remain admin-only. The sender display uses the
venue's name. Keep current invoice documents, outbox outcomes and public reset privacy.

Cut A supplies the structured failure classifier, bounded account sends and reminder adapters;
its diagnostics preserve rejected versus unknown outcomes. Cut B shows those diagnostics beside
the relevant field or at the bottom of both SMTP forms, with the matching English and Spanish
guide. Cut C opens Prepare settings, adds admin removal and Settings navigation, and shows stored
settings separately from invoice capture on development boxes. The Prepare wizard now collects and
tests SMTP outside development; ordinary Prepare uses the relay or reports unavailable mail. Demo's
inbox link is offered publicly and to signed-in admins. Users and Account settings distinguish queued, captured and unconfigured
account mail; throttled invitation actions say nothing changed.
Ordinary SMTP and the Settings test use the venue name with the configured mailbox; setup tests
retain their own sender. Outside development, Demo captures account mail, reminders and alerts
even with a saved relay; development keeps its saved-relay preference.
Cloud delivery, including Demo with a Cloud account, waits for D102's released interface and
joint tests. An unavailable Cloud route cannot satisfy setup or silently fall back to capture.
The setup-test network-target issue below remains separate open work.

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

## The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.

`GET /api/backup/stream` (`readStored`, called by `view`, in `apps/server/src/stream-api.ts`) tolerates only
`server.credential_unusable`; `credentials.decrypt_failed`, `credentials.malformed_payload` and
`credentials.key_version_unknown` fail the read (400 with the raw code), so the panel shows an
error and no form, although the bucket copy's Save would replace the record. Treat all four the
way `UNREADABLE_CREDENTIAL` (`apps/server/src/credentials.ts`) groups them. Predates A538-4.

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
  large database Litestream may not finish its last upload (it is still told to stop). Litestream's
  `shutdown-timeout: 4500ms` (`litestreamConfig`) caps its own stop at 4.5 seconds, before the
  5-second forced kill, and that counts against the 8.
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
  errors and drops its read transaction to retry (`db.go`, `init`, the same in v0.5.17 and
  v0.5.18). On 0.5.18 a refused connection gets there after about 7 seconds, so a Litestream
  started during such an outage did not bring the side file to the limit in the rig's paced runs
  (87 and 134 MB after 40,000 sales, with SQLite's automatic fold-back on); selling flat out
  reached 236 MB in a shorter run. A connection accepted and never answered gave no error in 200
  seconds on either version, and the side file kept growing
  ([measured 2026-11-06](../research/2026-09-16-sqlite-failover-prototype.md#re-run-on-litestream-0518-2026-11-06)).

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

## Till changes do not check which page sent them

OPEN (left open by A1371, #2507). The till's sign-in cookie and the device cookie are `SameSite=Strict`
(`apps/server/src/till-session.ts:45-51`, `apps/server/src/device-session.ts:60-67`), and SameSite
ignores the port, so a page on another port of the box's name is sent them with a change it posts
to a till route. The server-wide page check judges only a change that carries the dashboard's
sign-in cookie (`apps/server/src/own-page.ts`), so it lets such a post through; whether any till
route checks the page itself was not surveyed. A fix needs a till-side list of trusted pages that
keeps the venue's other servers (the CORS allow-list, `apps/server/src/allowed-origins.ts`) and the
device cookie shared across the tenant's domain working.

## A917 — the owner chooses the server's `.local` name instead of `waitron.local`

DESIGNED
2026-10-20 and its three questions answered (where the name is
set, the certificate authority, the old name during a rename;
[design](../superpowers/specs/2026-10-20-a917-box-local-name-design.md)); not built. **Not
scheduled:** on 2026-10-25 the owner said "Put it on the backlog. I'm not sure I want to allow that
change", so whether the name should be changeable at all is open again. Recommended in the design:
named once on the server's first page, before its certificate authority is made; a later rename is
a planned "re-trust every device" event — devices pair again in place of their old entries, and the
old name only points at the new one for 14 days. Five slices; no migration.

## A1483. Native ARM image and installer before go-live

The owner asked on 2026-11-10 at 17:17: “for go live we should support ARM too”. At 21:45: “arm is slow to build and can wait until we are ready to go live. backlog it for now”. Start when go-live is near.

The 10 November `docker manifest inspect ghcr.io/clintongormley/waitron:main` result lists linux/amd64 and an unknown/unknown descriptor, with no arm64 entry. Image builds select `linux/amd64` in `.github/workflows/ci.yml:4475`, `:4528`, `:4547` and `.github/workflows/image-smoke.yml:144`, `:159`. The installer selects amd64 packages in `deploy/box/mkosi.conf:13` and `:24`, an amd64 repository in `deploy/box/build.sh:17`, and x86 firmware in `deploy/box/firmware-image.sh:26`.

Plan one multi-platform application image with arm64 smoke, and an arm64 installer that reaches setup in its emulator. Measure build cost and name the shared CI caches it competes with. Keep actual ARM hardware qualification distinct from emulator results.

## B3. The bootable USB installer

The [network display](../superpowers/plans/2026-11-12-b3-20-network-screen.md) shows the installed host’s wired and Wi-Fi observation on Settings → Box status. Network controls, scan/join/forget and Wi-Fi boot-copy reconciliation remain to be built.

The development console shows Spanish and English together, names the checked venue and warns when its tag marks it Live; missing or unusable tags leave Live status unknown. It returns through a one-time EFI boot choice after 15 seconds. Keys pause it until 120 seconds without typing. The `existing-stick` rig completes Prepare, waits for the real startup counter to clear, and requires a continuous return with USB attached, unchanged disk hash before installed startup, unchanged chip unlock and `/health`. The graphical warning, reinstall controls and physical qualification remain open. [Return cut](../superpowers/plans/2026-11-11-b3-18b-firmware-return.md).

**2026-11-11 development rehearsal:** the [recipe and installed boot checks](../../bench/box-installer/README.md)
install five btrfs areas inside LUKS2 onto a second virtual disk. The first disk boot retains a recovery
key and seals against a virtual TPM, then requests a restart with Docker stopped. Two subsequent
chip-unlocked boots must remove the empty password and reach setup; the rig independently checks
that the retained key opens the disk read-only. Setup hides/refuses Demo and retains Prepare, Live
and Join or recover; the rehearsal opens Prepare’s administrator form.
This remains an unsigned, disposable development image, with no theft-protection or release-readiness
claim. Signed boot/Secure Boot, parent experiments (b) and (i), failure/recovery screens, key sheets,
update resealing and real stick/box/Android checks remain release gates. B3 remains 0/6 parent slices
complete. A1187 part 3 and A950 cuts 4+ can reassess their startup dependency once this cut lands;
other prerequisites still apply. [Startup plan](../superpowers/plans/2026-11-10-b3-15-retained-key-startup.md).

The [11 November firmware measurement](../superpowers/plans/2026-11-11-b3-17-existing-stick.md#measured-on-11-november-2026)
observed one guest-requested restart into an exact target EFI entry, with the USB attached and
first, BootNext consumed, BootOrder unchanged and both read-only disk hashes unchanged.
That measurement preceded the [development console return](../superpowers/plans/2026-11-11-b3-18b-firmware-return.md).
Physical-box checks remain unqualified.

APPROVED WITH CHANGES, owner 2026-10-26 ~12:15:
“We don't need the configuration code. It's not a concern. The rest approved.”
[Design](../superpowers/specs/2026-10-21-b3-usb-installer-design.md),
[plan](../superpowers/plans/2026-10-26-b3-usb-installer.md).
Planning slices 1, 2, 3, 5, 6 and 8 is
authorised, and on 2026-11-01 the owner authorised the build, cut one pull request at a time
(see "Built so far" below). Q2 stays answered: Prepare on the SAME box, then an admin freshly
reauthenticates before destructive cutover, saves allowed configuration and starts fresh Live
without USB, OS reinstall, disk/encryption reset or practice database promotion. The encrypted,
host-owned durable handoff and audit survive outside the removed venue. Interruptions continue
the recorded operation and never erase a newly created Live venue. No setup code, private preview,
setup/resume/recovery grant or credential reserves that fresh setup; LAN first claim, including
pending fresh Live, is explicitly accepted. W60's first-claim concern is closed by that decision.
Remaining mode work: Live or restored production venues cannot start same-box re-setup;
installed-box choices use the deployment state. Setup explicitly started with `WAITRON_ENV=production` already hides Demo/Prepare and now
refuses both at the provision route, including supplied operations.

The small downloading stick and three guards stay: disk first in boot order, mandatory USB
removal before restart because firmware can ignore that order, and a stick that finds Waitron
starts it after 15 seconds unless a key is pressed. The encrypted disk, Chromium under `cage`,
no desktop, dashboard/till choice and separate later maintenance feature remain in the design.
The local-screen marker only displays the till card; a foreign browser lacks it. Even a forged
marker still needs `hardware.manage` and manager acceptance.

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
prove itself honest.

§12 retains the full copy/reconnect inventory, suspended staff, stripped credentials, inactive
printers and missing device enrolments. A989's required-language/import readiness must pass before
removal. Reorient and bind actual reset/ownership calls after A1042's release; no stale reset API
is selected here. A940 production releases and actual Linux/VM/TPM/firmware evidence remain gates;
Local Docker availability must be checked before qualification; mocks cannot replace that evidence. Six slices
remain the go-live minimum; no unqualified boot image is published. Time zone still comes from
the setup area and venue details under its history limits, separate from the clock's time instant
(§10, retaining A798's dated pointer). §17's remaining follow-ups stay open, including Debian 14,
large release assets and the A940/A947/A798 coordination.

**Built so far (2026-11-01).** [PR 1](../superpowers/plans/2026-11-01-b3-1-encrypted-disk.md)
(#2370) adds three host libraries under `scripts/box/`, none called yet:

- `disk-state.mjs`: `classifyDisk`, the installer's decision about which disk it may erase, from a
  whole-machine observation. TPM and Secure Boot come back in a separate `hardware` field.
- `rig-contract.mjs`: the bench rig's argument and run-folder rules, and a write-ahead ledger whose
  cleanup removes only what the run recorded.
- `disk-key.mjs`: the retained disk-key store under `/var/lib/waitron-host/disk-recovery/`,
  checking the `@host-state` mount before any file call, storing once per disk UUID, never
  replacing. A sweep checks that the key appears in no returned value, error, log line or other file.

**Built so far (2026-11-03).** [PR 2](../superpowers/plans/2026-11-03-b3-2-preboot-logic.md)
(#2423) adds three more host libraries under `scripts/box/`, none called yet:

- `preboot.mjs`: the preboot unlock gate. `freezeUnlockTarget` decides, once, from PR 1's
  whole-machine observation, which disk may be opened: the one Waitron disk whose encryption UUID
  matches the expected one, carried by nothing else on any attachment, after first start is
  complete. `createUnlockGate` runs one check at a time, and every route that holds the same gate
  shares its wait: the proposed 2/4/8/16/32/60 seconds (`UNLOCK_DELAYS_MS`, spec §7.5, not the
  owner's choice). It zeroes the caller's key array before `submit` returns, and its own copy when
  the attempt ends. The tests cannot see a copy kept in the gate's private variables, and say
  nothing about what an adapter, the browser or the operating system keeps. The fixed `prebootUnlockGate` refuses
  with `adapter-missing` until the Linux adapters exist.
- `preboot-locked.mjs`: what a locked box answers. `freezeLockedTarget` checks the two
  certificates before anything listens: the recovery certificate is signed by the box's CA (by
  signature), names only `unlock-<installationId>.waitron.local` and has its own key; neither it
  nor the CA carries an extended key usage that leaves out server authentication, and the CA's
  validity has begun; the redirect
  certificate is self-signed, names only `waitron.local`, and does not share the recovery
  certificate's key (one carrying the CA's key is already refused as CA-signed or not
  self-signed). `decideLockedRequest` sends `waitron.local` to the one recovery address with a 302,
  refuses other methods (405) and other names (421), and answers plain-HTTP GET and HEAD with 503
  `unlock.remote_unavailable` when `freezeLockedTarget` refuses the set. Host and TLS names outside printable ASCII match nothing.
  Not checked: the recovery certificate's key usage extension (the key operations it allows,
  separate from the extended key usage above). `X509Certificate` has no property for it, and this
  module does not decode the certificate's bytes. A real Node handshake failed for an EC leaf whose key usage was `nonRepudiation` alone
  (TLS 1.2 and 1.3) or `keyEncipherment` or `keyAgreement` alone (TLS 1.2), and such a set still
  answers ready.
- `wifi-record.mjs`: version 1 of the boot copy's Wi-Fi record. `parseWifiRecord` accepts only
  `wpa-psk` and `sae` networks; `createWifiRecordReader` reads only
  `waitron-recovery/wifi.json` under the boot root it is given, never the staging copy
  `wifi.json.next`, after checking that boot mount. A mount check that throws, or whose answer
  throws when read, is `mount-unverified`. The fixed `readActiveWifiRecord` uses `/boot`, which the
  Linux pull request confirms, and answers `mount-unverified` with no file call until that pull
  request adds the mount check.

**Built so far (2026-11-03), PR 3.** [PR 3](../superpowers/plans/2026-11-03-b3-3-installer-policy.md)
(#2426) adds two more host libraries under `scripts/box/`, none called yet. Both are pure decisions:
they take events (a key pressed, a timer firing, an adapter's report) and answer what to do next,
and the real screen, network and disk adapters come with the Linux pull request.

- `installer-policy.mjs`: the installer's decisions. `nextInstallerStep` picks the disk with PR 1's
  `classifyDisk`; no internal disk or more than one is refused. A disk already holding Waitron
  starts the installed box after 15 seconds; a key pressed before then opens the reinstall screen,
  which goes back to starting the installed box after two minutes with no typing. Erasing that disk
  needs the venue's name from its name tag typed (compared after NFC normalisation, which makes the
  composed and decomposed spellings of an accented letter equal), or the erase word, compared
  exactly as typed, when the tag cannot be read. A disk it cannot classify, or a blank or Windows
  disk whose attachment is unclear, also needs the erase word. A box whose TPM (the security chip) or Secure Boot is off
  still starts an installed Waitron, but any install or reinstall on it is refused. The stick may
  come out only once the installer is wholly in memory; taken out earlier, the installer stops. The
  clock is set from the network before anything is downloaded; a failed setting, or a time earlier
  than the floor the installer is started with (`clockFloorMs`), is tried again a minute later, as
  is a download that is unavailable or cut short. Only a release that checked out leads to a write; a disk
  erased with no question waits 60 seconds after that check, and a key stops it and offers the choices to
  install now or power off (the spec's «Instalar ahora» and «Apagar»). Each request to find the
  network, set the clock or download carries a new number, and its answer must carry the same number
  back; an answer with any other number stops the installer as out of order (`sequence-invalid`), so
  a late answer to an earlier download cannot lead to an erase. After the write the installer restarts into the box only once the stick is
  out. `installerStatus` gives the public status page the step, whether the stick can come out, the
  stop reason, the firmware setting that is off and, for a too-old installer, the release's
  version; never a disk id, the venue's name or typed text. The four waits are the spec's calls, in
  one constant (`INSTALLER_TIMINGS_MS`).
- `installer-network.mjs`: the network fallback's decisions. `nextNetworkStep` opens the
  installer's own Wi-Fi network (a hotspot) when no internet has been found after one minute, and
  while it is open tries the internet again every minute. A join a person asks for that fails, or
  gives no internet within a minute, reopens the hotspot, and `networkStatus` says which of the two
  happened. Each join carries a new number, and its result must carry it back; a result for an
  earlier join of the same network state, for example one that arrives after that join ran out of
  time, is ignored. The decisions name the network to join but never carry its password, which stays with
  the adapter. The waits are in `NETWORK_TIMINGS_MS`.

The development recipe and `recipe-setup` rig case were run through TCG emulation on an arm64
Mac with Docker Desktop on 2026-11-10. Later that day,
[B3-13](https://github.com/clintongormley/waitron/pull/2737) added `installed-refusals` and
`installed-setup`, including USB-source installation and two disk-only starts. The other
declared rig cases still need their runners. The 11 November B3-15 development cut adds a virtual
TPM to `installed-setup`, encrypted-root mount checks and actual retained-key enrollment/unlock
adapters. Signed boot/Secure Boot, root ownership qualification beyond this disposable rig,
real power cuts, the remaining seal experiments and slice-1 measurements stay open.
PR 2 left for later, from its plan's "Out": the preboot screen and the words for the `explain`
answer; the public CA download and its help page; the key-use record
and the startup-fingerprint check before resealing; the real `cryptsetup`, observation,
boot-mount, certificate-file and listener adapters; joining Wi-Fi; the address fallback; the four
preboot rig cases; and the key-memory measurements.
PR 3 left for later, from its plan's "Out", among them: the installer's screens, words, `LEEME`, printed card
and progress figures; typing the recovery key on the reinstall screen to see the disk's last sale
and unsent records; the real in-memory, stick, keyboard, clock, download, write, boot and hotspot
adapters and the `waitron-instalar.local` status page; joining Wi-Fi and calling PR 5's publisher
for the first Wi-Fi boot copy; and the source-history floor on reinstall, still gated on A1042.

**Built so far (2026-11-03), PR 4.** [PR 4](../superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md)
(#2430) adds one host library under `scripts/box/` and extends PR 2's Wi-Fi record module, none of
it called yet. Like PR 3's, both are pure: they read bytes or settings handed to them and answer
bytes or a plan, and nothing in this pull request reads or writes a real disk header, a boot
folder or NetworkManager.

- `name-tag.mjs`: the name tag is one LUKS2 token (a small JSON record in the encrypted disk's
  header, readable and writable without the key) of type `waitron-name-tag`, version 1, assigned to
  no keyslot, never the header's label or subsystem field. `encodeNameTag` writes its one byte
  form; `decodeNameTag` accepts only that byte form and answers `null` for anything else.
  `findNameTag` reads it from `cryptsetup luksDump --dump-json-metadata` output and answers `null`
  for none, for two or more, and for output it cannot read. `planNameTagWrite` names only
  Waitron's own tokens or a free token number, replaces before it removes, refuses when all 32
  token numbers are taken, and refuses a header holding a token number written other than "0" to
  "31" (for example "007" or "32"). For a
  venue name the tag cannot hold (empty, over 256 code points, or with a control character such as
  a tab) the plan writes no tag and removes any that is there, and the installer's decisions (PR
  3) ask for the erase word on a disk with no readable tag. `usableVenueName` is that name rule;
  the installer's decisions now take it, with its 256-code-point limit
  (`NAME_TAG_MAX_CODE_POINTS`), and the text check under it (`usableText`), which the erase-word
  check uses too, from `name-tag.mjs` instead of their own copy.
- `wifi-record.mjs`: `formatWifiRecord` writes version 1 only in the form `parseWifiRecord` loads,
  from the values it checked, and refuses anything else. `decideWifiBootCopy` turns the box's
  NetworkManager settings, as an adapter would hand them over, into a copy to write or a named
  reason for none: cable only; an open network; NetworkManager's `none` (open or static WEP);
  dynamic WEP; OWE; enterprise; any other security type; a password the host cannot read; a WPA2
  password of 8 to 63 characters outside printable ASCII; a well-formed WPA3 password over 256 bytes
  with no C0 control character or DEL; or another password the
  reader would refuse (`password-invalid`). The reader's three refusals are what become password
  reasons; an error the reader throws is not caught and reaches the caller.

**Built so far (2026-11-03), PR 5.** [PR 5](../superpowers/plans/2026-11-03-b3-5-wifi-publication.md)
(#2432) adds one host library under `scripts/box/`, none of it called yet. Unlike PR 4's, it writes
and removes real files, through file operations a test can replace.

- `disk-key.mjs` exports its default file operations as `hostFileIo`, so both modules share one
  set of default file operations; nothing else in it changed.
- `wifi-boot-copy.mjs`: `createWifiBootCopyPublisher` takes `decideWifiBootCopy`'s answer (PR 4)
  and checks it first: a copy whose bytes `parseWifiRecord` does not load, a reason not on
  `WIFI_NO_COPY_REASONS` (now exported by `wifi-record.mjs`), or any other shape is rejected with
  `wifi_copy.decision_invalid`, before any file call. It runs PR 2's reader first, so the boot
  mount, folder and record rules are the reader's; a copy the reader finds damaged (corrupt,
  unsupported or oversized) is replaced or removed, not refused. It then checks the folder again
  and the staging name `wifi.json.next`. Anything but a regular single-link file at `wifi.json` or
  `wifi.json.next` (a symbolic link, folder, named pipe or second hard link), a symbolic link or
  non-folder at the folder, or a wrong owner or wrong permissions at any of the three refuses with
  no write (`failed`, with the reason), for a removal as for a write. A copy is written to
  `wifi.json.next` with the `wx` flag (fail if the name exists) and mode `0600`, flushed, renamed
  to `wifi.json`, the folder flushed, and read back; a missing folder is made with mode `0700`
  first. An unchanged copy with no leftover staging file is not rewritten, only the two folders
  flushed. Every "no copy" answer, not only cable-only, removes `wifi.json` and any
  `wifi.json.next`, flushes the folder and checks both are gone; with no folder it answers `absent`
  with no write. The folder is never removed, and no other name in it is touched. A failed step
  stops there with no clean-up, and the next publication removes what it left (tested after a stop
  at every step). `status()` answers `pending`, `current`, `absent` or `failed`, with the "no copy"
  reason and the failure, and nothing about whether the box is connected; it is `pending` until the
  first publication finishes and while one runs. Publications run one at a time, in call order.
  The fixed `publishWifiBootCopy` answers a valid decision with `failed` / `mount-unverified` and no
  file call until the Linux pull request adds the boot-mount check.

**Built so far (2026-11-03), PR 6.** [PR 6](../superpowers/plans/2026-11-03-b3-6-disk-key-letters.md)
(#2433) adds `scripts/box/disk-recovery-key.mjs`, called by nothing yet. It turns the disk recovery key
between the 32 bytes the box keeps and the 64 letters a person reads and types, using systemd's
16-letter set in systemd's order (`DISK_KEY_LETTERS`).

- `formatDiskRecoveryKey`: 32 bytes to systemd's 64 lower-case letters in eight groups of eight
  joined by hyphens, for the sheet.
- `diskRecoveryKeyPassphrase`: the same 71 characters as bytes, in a new array the caller zeroes.
  That text is exactly the passphrase `systemd-cryptenroll` enrols, so the unlock adapter sends
  these bytes rather than what was typed.
- `parseDiskRecoveryKey`: typed text to 32 bytes, in a new array the caller zeroes. Letters are
  read in either case, ASCII only; hyphen-minus, ASCII space, tab, carriage return and line feed are
  ignored anywhere. The first other character is refused as `{ reason: "letter", position }`, its
  place counted in characters (code points) from 1;
  a count of letters other than 64 is refused as `{ reason: "length", letters }`; text over 4096
  UTF-16 code units (`DISK_KEY_TEXT_MAX`) is refused unread, with `letters: null`. A value that is not
  text throws `disk_recovery_key.invalid`. No answer holds a typed character or a key letter.
- Both byte inputs take exactly 32 bytes in a genuine `Uint8Array` (a `Buffer` is accepted),
  checked as the unlock gate checks them, and anything else throws `disk_recovery_key.invalid`.

**Built so far (2026-11-05), PR 7.** [PR 7](../superpowers/plans/2026-11-05-b3-7-host-protocol.md)
(#2474) adds `scripts/box/host-protocol.mjs`, called by nothing yet (2026-11-06: PR 8's client calls
its request writer and reply reader; PR 9's routes call that client): what the server may ask B3's
host service and what the host may answer, as a pure module with no socket, root or NetworkManager.

- Seven requests from Task 3.1's list (`HOST_VERBS`; `first-start.status` is left to the installed
  first-start service); `clock.status` and `clock.set` stay slice 9b's shell handler's (`SHELL_VERBS`), and this
  module answers them `unknown_request`.
- A request is one line: the verb, one space and one JSON object of the request's fields and then
  `actor`, printable ASCII only, at most 4096 characters, and accepted only in the exact form
  `formatHostRequest` writes, so a duplicate key, another key order, extra spaces or an upper-case
  escape is refused. Refusals: `request_invalid`, `unknown_request`, `actor_invalid`,
  `fields_invalid`. The verb is read before the space is looked for: an empty verb is
  `request_invalid`, a verb not on `HOST_VERBS` is `unknown_request`, and only then is a listed
  verb with nothing after it `request_invalid`.
- The actor is ids only: `{"source":"person","person":<id>}` (1–64 of `A–Z a–z 0–9 -`) or
  `{"source":"server"}`, each request accepting only its listed sources. The host checks the form
  and never a permission; the log entry names the verb's permission (`system.manage`) from the
  module's own table for a person, and `null` for the server.
- Fields: a join takes exactly what the boot-copy writer accepts (`formatWifiRecord`: WPA2 or WPA3
  personal), with the SSID as hex (`isSsidHex`, now exported by `wifi-record.mjs`); a forget names
  one SSID as hex, and whether it is the saved one is the adapter's (`not_saved`); the start screen
  is `dashboard` or `till`; the name tag is `null` or a name `usableVenueName` leaves unchanged,
  with `live` true or false.
- The join check zeroes the byte array `formatWifiRecord` returns, and nothing else. The copy
  `parseWifiRecord` builds to compare against, the WPA3 password's size check and the record built
  for a refused password are left for the garbage collector unzeroed, and the password arrives and
  leaves as a JavaScript string, which cannot be zeroed at all. So the module makes no claim that a
  password is wiped from memory.
- Replies: each request's reply is checked when written and when read back (`formatHostReply`,
  `parseHostReply`), so the server's client can check what it receives by the same rules. A join
  or forget answers only `{"ok":true}` or a refusal, and `network.read` reports the latest change
  and the boot copy's state (PR 5's, its lists now exported by `wifi-boot-copy.mjs`) side by side.
  A scan lists at most 32 networks: 32 of the longest kind make a reply of 3641 bytes with its
  newline, under the client's 4096.
- A wired address is one Node's `net.isIP` accepts, with no `%`; the code has no length limit of
  its own. On Node v26.13.0 `net.isIP` accepted no form longer than 45 characters among those
  tried (the hand cases, and 200,000 random IPv6 shapes).
- `handleHostRequest(line, adapters)` checks that `adapters` holds exactly the eight functions,
  reading each once, then logs the verb and actor, calls the one adapter as a plain function (no
  `this`) with only the checked fields, copies and checks its answer, and answers the fixed
  `host_failed` for any adapter failure or wrong answer, with no adapter error text in it. A canary
  sweep finds the Wi-Fi password only in the join adapter's argument.

**Built so far (2026-11-06), PR 8 (#2495).** [PR 8](../superpowers/plans/2026-11-06-b3-8-host-client.md)
adds `boxHostRequests()` to `apps/server/src/box-host-client.ts`, beside the clock client, called by
nothing yet: one typed method for each of PR 7's seven requests.

- Each request line is the one `formatHostRequest` writes, and each reply is read by
  `parseHostReply`, imported from `scripts/box/host-protocol.mjs` by relative path. A request the
  protocol refuses to write answers `invalid`, and nothing is sent. `tagWrite` always sends the
  server as its actor.
- Every failure is an answer with `available: false`, never a throw: `refused` with the host's own
  word from that request's list, `unsupported`, `missing`, `lost`, `timeout`, `malformed` or
  `invalid`. A reply over 4096 bytes (`HOST_REPLY_MAX`) is `malformed`.
- `unsupported` answers `unknown_request`, for that request only, and `request_invalid` to a line
  over 700 characters, the longest the clock handler reads (`deploy/box/waitron-box.sh:161`). Any
  other refusal, `request_invalid` to a shorter line included, stays a refusal.
- A whole reply line that arrives before the connection breaks is the answer for
  `boxHostRequests()` only; the clock client still answers `lost` there. Tests with a stand-in
  connection and with the real shell handler cover it; on Linux the handler answers a line over 700
  characters and then resets the connection (measured in Docker, the plan's re-map finding 9).
**11 November update:** the development shell uses the longer 4096-character read only when its tag adapter is installed; clock requests still have the 700-character limit. A clock-only installation retains its original short read and Linux reset. The unchanged real-shell client assertions cover that legacy path; the forwarding test covers a complete long tag. [Console cut](../superpowers/plans/2026-11-11-b3-18a-name-notice.md).

- The two reads wait 5 seconds, the five other requests 20; `readMs` and `changeMs` override them,
  and the tests run both defaults on fake timers.
- Both clients, the clock one included, now treat an empty socket path as no path and ask
  `/run/waitron-box/box.sock` (`isUnset`), and answer `missing` with the error's code for a path the
  connection refuses at once. On Node v26.13.0, `net.createConnection` threw `ERR_SOCKET_BAD_PORT`
  for both `""` and `" "` before connecting, so until this pull request the clock client's promise
  rejected for both (`apps/server/src/box-host-client.empty-path.test.ts`).
- TypeScript reads no types from the `.mjs` module, so `apps/server/src/box-scripts.d.ts` declares
  the exports the server uses; TypeScript does not check it against the module's code (the plan's
  D1): the server's build refuses an export `box-host-client.ts` uses that the module lacks, and the
  types test reads each list it declares. `box-scripts.d.ts` also declares `wifi-record.mjs` and
  `wifi-boot-copy.mjs`, which only the types test imports (2026-11-06: PR 9's `box-host-api.ts`
  imports `wifi-record.mjs`'s `isSsidHex`).
- `host-protocol.mjs` now exports its reply value lists, frozen.
  `apps/server/src/box-host-client.types.test.ts` holds each of the server's value types to the
  matching list, in any order, both through the typecheck and at run time, and sends every listed
  value through the client. `host_failed` is held only as a literal in that test, and `keyMgmt`'s
  two values are not held to any list.
- `ROOT_SCOPE_CONSUMERS` (`scripts/changed-scope.mjs`) names `apps/server` for `host-protocol.mjs`,
  `wifi-record.mjs` and `wifi-boot-copy.mjs`.
- `boot.ts` imports the clock client from the same file, so the server's bundle now carries
  `host-protocol.mjs` and the five modules it reaches (`pnpm --filter @waitron/server build`, then
  `/usr/bin/grep -n "^// \.\./\.\./scripts/box" apps/server/dist/server.js`, on 2026-11-06).

**Built so far (2026-11-06), PR 9.** [PR 9](../superpowers/plans/2026-11-06-b3-9-host-routes.md)
adds six routes in `apps/server/src/box-host-api.ts` that ask the box's host service through PR 8's
client. No screen calls them yet.

- `GET /api/box/network` (`network.read`, answers `{ wired, wifi, change, bootCopy }`),
  `POST /api/box/network/scan` (`{ networks }`), `POST /api/box/network/join`
  (body `{ ssidHex, keyMgmt, psk, hidden }`, answers `{}`), `POST /api/box/network/forget`
  (`{ ssidHex }`, answers `{}`), `GET /api/box/screen` (`{ start }`) and `POST /api/box/screen`
  (`{ start }`, answers `{ start }`).
- All six, the reads included, need a session holding `system.manage`, checked through
  `authorizeSystemManager` before the body's type and keys are checked and before the host is asked
  (on the four POST routes, after the page checks below and the 4096-byte limit), now exported from
  `box-health-api.ts` unchanged, so the full-disk fallback (the same checks again as reads only)
  covers these routes too. Each request names the signed-in person as its actor; a person id that is
  not a UUID is a fault (500) and reaches no host.
- Each body must be a JSON object with exactly its keys, sent as `Content-Type: application/json`;
  anything else answers `management.request_invalid` with `field` set to the first missing or
  wrong key, or to `body` (an extra key's own name never reaches the log, and a body of another type
  names `body`). The type is checked after the session, on the join, the forget and the start
  screen; the scan reads no body and checks no type. The SSID is checked with `isSsidHex`, now
  declared in `box-scripts.d.ts`. Bodies over 4096 bytes are refused the same way.
- The client's answers map to these codes: `missing` and `unsupported` answer 409
  `box_host.unavailable` (`reason` and `detail` kept); `lost`, `timeout`, `malformed` and the
  protocol's four refusals answer 502 `box_host.failed` with that word as `reason`; the host's own
  `busy`, `no_wifi` and `not_saved` answer 409 `box_network.busy`, `box_network.no_wifi` and
  `box_network.not_saved`; `invalid` on the join answers 400 `box_network.password_invalid`
  `{ field: "psk", keyMgmt }`, and on any other route is a 500 fault.
- The join is taken only over an encrypted connection from the box's own page: a socket that is not
  an encrypted `TLSSocket`, another `Origin`, or a `Sec-Fetch-Site` other than `same-origin` or
  `none` answers 403 `box_network.join_connection_insecure` `{ reason: "unencrypted" |
  "other_origin" }`. That check is a middleware that runs before the body-size limit and the session
  check, so a refused join has read none of its body; a test counts the body stream's reads at zero
  both on the routes alone and in a started server, where boot's own middleware runs first. In a
  started server, a join carrying the dashboard's sign-in cookie from a page that is not trusted is
  refused earlier still, by the server-wide check described next. A
  `Content-Type` other than `application/json` is refused after the session check, as
  `management.request_invalid` `{ field: "body" }`.
- The other three changes (the scan, the forget and the start screen) have no page check of their
  own. The server-wide check (`requireManagementChangeFromOwnPage`, `apps/server/src/own-page.ts`)
  refuses a change that carries the dashboard's sign-in cookie from a page that is neither the box's
  own nor a trusted one, with 403 `management.origin_refused`, logged at warn, before any route code
  runs, so it asks the host nothing and reads none of the body. Trusted pages on another address
  are taken ([which ones](../developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)). Of the box's
  network and screen routes, only the join still demands the box's own page. None of the three
  needs an encrypted connection, since none carries a secret. A change from another page that
  carries no dashboard cookie passes that check and is refused by the session check as 401
  `management_session.required`, or, when its body is over the size limit, by that limit first as
  400 `management.request_invalid` `{ field: "body" }` (the limit runs ahead of the session check,
  `apps/server/src/box-host-api.ts:173-174`, and reads a body sent without a `Content-Length` to
  measure it); either way the host is asked nothing. The
  reads are not checked: another page cannot read their answers. Why: SameSite ignores the port,
  so a page served on another port of the box's own name is sent the manager's cookie; a review run
  in real Chromium showed such a page changing the start screen and forgetting the saved network
  with a plain-text body, which no preflight stops, before these checks. In a started server,
  boot's CORS middleware answers that page's preflight with no `Access-Control-Allow-Origin` (a
  test asks for each of the three).
- No part of the join's body is logged or answered. A canary sweep sends a password through every
  outcome (success through a stand-in and through the real client, `busy`, `missing`, `lost`,
  `host_failed`, a refused short password, a stand-in that throws with the password as its message,
  no session, a supervisor, plain HTTP, another origin, an extra key, a refused SSID, a body over the
  limit, malformed JSON and a text body), and finds neither the password, its first 6 or last 8
  characters, nor the short password in any log call or answer, and no console call at all; through
  the real client the password appears once, in the line the host received.
- At most two host calls from the routes at once (`BOX_HOST_ROUTE_CALLS = 2`): a third answers 409
  `box_host.busy` without asking the host, a call frees its place however it ends, and a request
  refused before the host is asked takes no place. No host call runs inside a transaction or a write
  lock: tests take both while a host call waits.
- `boot.ts` builds `boxHostRequests()` (seam `boxHostRequests`) and mounts the routes after
  `mountBoxHealthApi`. A started server with no stand-in answers `GET /api/box/network` with
  `box_host.unavailable` `{ reason: "missing", detail: "ENOENT" }` on a machine with no
  `/run/waitron-box/box.sock`.
- On a mirror or a fenced box the read-only gate refuses the four POST routes with `node.read_only`;
  no exemption was added, and no test of this pull request runs them there.
- Left in the code, for whoever touches it next: `askHost` keeps one cast, `refusal as
  ProtocolRefusal`, where the protocol's refusals go to `box_host.failed`; and on a route whose own
  refusal set is empty (the reads and the start screen), an extra own word passed to `askHost` still
  compiles, where on the scan, join and forget it does not.

**A box that already holds Waitron, with its TPM or Secure Boot switched off:** the owner decided on 2026-11-03; see [Decisions and deliberate limits](#decisions-and-deliberate-limits).

**For later slices, from PR 1's re-map against main:**

- `bench/` is measured by no test or coverage glob, so the rig's rules live in
  `scripts/box/rig-contract.mjs` and `run.mjs` must stay a thin wrapper over them.
- `classifyDisk` takes a whole-machine observation, not one disk; `kind` has no `refuse-hardware`
  and gains `none`.
- The store's fixed entry points take no path, and there is no replace operation.
- The spec's `deploy/waitron.sh` line numbers have moved; the recipe pull request re-reads them.
- Slice 8's recovery-document files are gone (A1187 part 1 replaced them with the recovery pack);
  slice 8 re-maps onto `backup-recovery-pack-*.ts` and `recovery-pack-card.ts`.
- A lone disk whose attachment is `unknown` counts as internal; PR 3's decisions never erase one
  without something typed (D3). A Waitron disk whose two partition tables were both wiped reads as
  blank; the Linux observation adapter decides how to look for an encryption header in that case.

**For later slices, from PR 2's [re-map against main](../superpowers/plans/2026-11-03-b3-2-preboot-logic.md#re-map-against-main-on-2026-11-03):**

- The installation id in the recovery address must be a new per-disk value made at first start,
  never Waitron Cloud's `installationId` or the fiscal `installationIdentity` (re-map finding 7).
- Task 3.1's host service shows the publisher's state (PR 5) with its reason, because open, WEP,
  OWE and enterprise networks and the password cases get no Wi-Fi unlock in version 1.
- The address fallback widens `freezeLockedTarget`'s one-name rule for the recovery certificate
  and `decideLockedRequest`'s host rule together.

**For later slices, from PR 3's [re-map against main](../superpowers/plans/2026-11-03-b3-3-installer-policy.md#re-map-against-main-on-2026-11-03):**

- The signed release list waits for two things not on main: A940's release version (its slices 2
  and 4) and a chosen signature format (algorithm, key encoding, signed byte layout). It is shared
  with slice 5 and with A950's `verifyManifest`, carries the fields A950's `parseVerifiedRelease`
  reads, and must name the oldest installer a release accepts, which needs an installer version
  scheme nobody has defined yet. Who holds the signing keys gates publication (parent Task 5.1),
  not the verifier.
- The Linux installer fills `DiskObservation.nameTag` with `findNameTag` of the frozen internal
  disk's own `luksDump --dump-json-metadata` output and hands the policy
  `nameTag === null ? null : decodeNameTag(nameTag)`, for that disk and no other.
- The write adapter re-checks the frozen disk's partition table and the disk's size before its
  first write, because the survey has no size field.
- The rig cases `install`, `existing-stick`, `damaged-marker`, `two-disks`, `cut-header`,
  `remove-usb`, `disk-write-cut` and `network-fallback` join `RIG_CASES` with the runner that can
  run them.
- Slice 3's host service raises an alert on an installed box whose TPM or Secure Boot is off (the
  owner's decision of 2026-11-03).
- The Linux pull request's translation file words `installer.waitron_found` when its `hardware` is
  set: the spec's firmware messages end «…vuelve a empezar» and are written for installing, not for
  a box that goes on to start.
- The Linux pull request's translation file sets the erase word (the spec's «BORRAR»), passed as
  `eraseWord`. It is one word for both the Spanish and the English screen: a different English word
  would need the policy's option to change (for example, to a list of accepted words), not only the
  translation file (D7). That file also supplies the disk's model and size for the 60-second
  message.
- The network adapter reports `link` whenever a route appears, unasked. Otherwise a cable plugged
  in after the start is seen only at the first probe, a minute after the hotspot opens (two minutes
  in), and a join whose one
  probe is answered before the box has its address reopens the hotspot when the join's minute runs
  out. It never sends the installer an `online` it did not ask for: an `online` outside the
  network step, for example during the 60-second wait, stops the install as out of order
  (`sequence-invalid`), which is safe but ends the run.
- Every adapter result echoes the number of the request it answers: `online`, `clock-set` and
  `release-checked` carry the `requestId` of the `find-network`, `set-clock` or `download` decision
  that asked for them, and `join-result` carries the `joinId` of its `join`. In the installer's
  decisions, an answer to an earlier request that arrives after a newer one stops the install; in
  the network decisions, an answer to an earlier join is ignored. Join numbers start again at 0 in
  each new network state, so the adapter drops any join result left over from an earlier one.
- The boot adapter checks for the stick again just before restarting: a stick put back in after
  the policy has ordered the start is not seen by the policy (guard 3 then catches the restart with
  the stick in).
- On a refusal with no setting of its own (`sequence-invalid`, `usb-removed-early`), the status page
  still shows which firmware setting is off, beside the stop reason. The page's wording must not
  present the setting as the cause.
- Decisions recorded for review: a lone blank or Windows disk of unknown attachment needs the erase word (D3); a
  Waitron disk with a foreign encrypted partition is never erased unattended (D18); a typed venue
  name is compared after NFC normalisation, and the erase word exactly as typed (D7).

**For later slices, from PR 4's [re-map against main](../superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md#re-map-against-main-on-2026-11-03):**

- Slice 3's `tag.write` runs `planNameTagWrite`'s steps with `cryptsetup token import --token-id <n>`
  (`--token-replace` for a replace) and `cryptsetup token remove --token-id <n>`, never
  `--key-slot`, inside the host's one header-write turn (so no other header write runs at the same
  time). On "Token <n> in use" it reads the header and plans again. A step refused for lack of
  space is reported, because the plan does not estimate free space (D8).
- Slice 3 writes the tag at installation handoff and whenever the venue's name or Live state
  changes, and chooses which name it holds: the legal name the dashboard banner shows, or a trading
  name.
- Slice 1's recipe: `systemd-repart` v257, read in its source and not run, sets the LUKS2 label to
  the partition's label and sets no subsystem, so the `waitron-box-1` subsystem marker PR 1
  recognises needs its own step. The installed-image writer and header reader remain unbuilt;
  the disposable-header measurements are linked above.
- Decisions recorded for review: a name the tag cannot hold gets no tag, never a cut-down one
  (D4); a power cut while removing a doubled tag can leave one old tag readable until the next
  write (D7).

**For later slices, from PR 5's [re-map against main](../superpowers/plans/2026-11-03-b3-5-wifi-publication.md#re-map-against-main-on-2026-11-03):**

- Slice 3's host service publishes at every unlocked start, before it reports the copy state, and
  after every Wi-Fi change it applies or sees, with `decideWifiBootCopy` of NetworkManager's
  current settings; slice 2's installer publishes the first copy at handoff. Until then the state
  is `pending`.
- The durable pending intent on `@host-state` (the separate host mount inside the encrypted disk)
  is slice 3's, beside the live NetworkManager change it covers. Proposed (D11): it records only
  that a change began and ended, with no password, so it cannot replay an obsolete one and needs no
  key beyond the disk encryption that already holds `@host-state`. Its shape waits for the live
  NetworkManager change it covers, not for a way to test it: PR 1's store shows an `@host-state`
  record can be built and tested with an injected mount check.
- The host reports a live-network change and the copy's state as two outcomes, with recovery
  availability separately (spec §7.5), and treats Wi-Fi unlock as available only when the state is
  `current` (proposed).
- Rig checks: that the flushes keep a new copy and a removal through a power cut on the boot
  partition's real ext4; that no boot-loader-measured byte changes across publications; preboot
  with old, new, missing and corrupt copies after a cut at every step.
- `unlink` of a folder answered `EPERM` on macOS and `EISDIR` on Linux in the plan's probe
  (2026-11-03), so no box code may read a folder from `unlink`'s error.
- Decisions recorded for review: a `wifi.json.next` that is a symbolic link or not a regular file
  refuses with no write, where PR 1's store removes a leftover link, and an unsafe `wifi.json` or
  `wifi.json.next` refuses a removal too, so after a switch to cable-only an obsolete password can
  stay where preboot reads it until root clears the fault (D4); a file operation that throws while
  writing, flushing or removing is `io-failed`, before or after the rename, and any failure or
  mismatch during the read-back or the removal check, its own reads included, is
  `publication-unverified` (D8); every "no copy" answer removes the active copy, not only
  cable-only (D7); a failed step makes no clean-up (D8).
- The publisher works on paths, and `node:fs` on Node 26.13 offers no folder-relative calls
  (`openat`, `renameat`, `unlinkat`). So another process able to write in the boot root (root, on
  a box) that swaps `waitron-recovery` for a link or another folder between the publisher's checks
  and its writes redirects the write or removal there; a redirected removal can then answer
  `absent` with the old copy still under the boot root, and an unchanged copy answers `current`
  without reading the copy again. The finish-branch run-it review reproduced all four on real files
  with the swap injected into a file operation (2026-11-03): the new password written outside the
  boot root, an outside file removed, `current` over a different copy, and `absent` with the old
  password left under the boot root. Slice 3 must keep every other writer out of the boot root
  while it publishes, or the Linux adapter must use folder-relative calls.

**For later slices, from PR 6's [re-map against main](../superpowers/plans/2026-11-03-b3-6-disk-key-letters.md#re-map-against-main-on-2026-11-03):**

- The unlock adapter calls `diskRecoveryKeyPassphrase` on the gate's bytes, sends exactly those 71
  bytes to `cryptsetup` with `--key-file=-` and no newline, and zeroes them; it never sends a typed
  spelling. That LUKS reads standard input without stripping anything is a rig check.
- A refused text never reaches the unlock gate, so it starts none of the gate's waits.
- First start either reads `systemd-cryptenroll --recovery-key`'s printed text back with
  `parseDiskRecoveryKey`, or enrols `diskRecoveryKeyPassphrase` of its own 32 random bytes; both
  routes put the formatted text in the key slot as its passphrase.
- Slice 8's disk-key page is drawn by the host, and `apps/server` receives document bytes only (the
  parent plan's `DiskDocumentDeps`). Proposed: the host draws it with `formatDiskRecoveryKey`'s
  text and a QR code holding that same text, so `parseDiskRecoveryKey` reads a scan of it.
- The screen's words for the `letter` and `length` refusals, in Spanish and English, come with the
  preboot screen.
- The key-use record and the startup-fingerprint check before resealing wait for the encrypted
  installed root’s release-qualified startup route; B3-15 exercises virtual-TPM startup in the disposable development recipe.
- `disk-key.mjs`'s store (reading the record, and writing the key with `writeFile` and `rename`)
  and `wifi-record.mjs`'s reader check their folder and then use the file by path, so a root
  process can swap the folder in between. The installed host's Linux adapters must either open relative to
  the checked folder (`node:fs` on Node 26.13 has no such call, as PR 5's note says) or keep every
  other writer out of those folders while they are used; the Wi-Fi folder is the one PR 5's
  publisher writes, whose other writers PR 5's note leaves to slice 3.
- Decisions recorded for review: a typed text is read more widely than systemd's own normaliser
  (one with a hyphen missing still reads, since separators are ignored anywhere, and the screen
  re-forms it through bytes before `cryptsetup` sees it) (D3); the
  first unreadable character wins over a wrong count, and text over 4096 code units is refused
  unread (D4).

**For later slices, from PR 7's [re-map against main](../superpowers/plans/2026-11-05-b3-7-host-protocol.md#re-map-against-main-on-2026-11-05):**

- The development handler forwards `tag.write` through its installed Node adapter, up to 4096 characters, while retaining the clock's 700-character rule. The other host verbs still need their adapters. A handler without the tag module keeps its older unknown/request-invalid answers.
- Every connection's instance stops at `RuntimeMaxSec=15`. A join and a forget are meant to answer
  once the change has started (D8), so each exchange stays short; how long a scan takes on the
  box's radio, and a join with its address, are rig measurements.
- The Linux adapters are called as plain functions, never with `this` (the dispatcher reads each
  once and calls what it checked), so none may rely on `this`: an adapter that needs state takes
  it through a closure or a bound function.
- The host service holds the latest change, serialises changes (one at a time, `busy` otherwise)
  and publishes the boot copy after each, keeping the two outcomes separate in `network.read`.
- Nothing zeroes the Wi-Fi password end to end (PR 7's note above), so the host service and its
  adapters make no claim that it is wiped from memory unless a later pull request builds and tests
  that.
- `first-start.status`, in Task 3.1's list, is left to the installed first-start service: nothing
  defines its answer or reads it, because the host itself serves first start's failure page while
  Waitron is not yet running (spec §7.3 item 3). That pull request decides whether the request
  exists, and if it does, its answer and who reads it.
- Decisions recorded for review: the permission is named by the verb on the host, not carried on
  the wire, narrowing spec §8's "carries the person and permission" (D7); a join takes WPA2 and
  WPA3 personal networks only, so open, OWE and enterprise networks cannot be joined from Red (D9);
  `tag.write` takes no person actor, narrowing spec §8's "carries the person" (D6).
- `scripts/box/wifi-boot-copy.test.mjs`'s last case, "the copy's states and failures match what the
  cases observe", skips itself when any other case in the file is not set to run, so a `.skip` or
  `.only` left in that file turns it off with no failure. Left open by #2474's review, which
  suggested failing instead of skipping when `CI` is set.

**For later slices, from PR 8's [re-map against main](../superpowers/plans/2026-11-06-b3-8-host-client.md#re-map-against-main-on-2026-11-06):**

- The installed tag duty adds one pending socket request to the routes' two and the clock side, whose concurrent count is still unmeasured. Recount the combined demand against `MaxConnections=4` and measure a fifth connection. Tag failures retry with the existing job backoff and are logged; a dedicated alert policy remains open.
- The socket's four connections (`MaxConnections=4`): PR 9's routes take at most two (its D7);
  what a connection over four meets is a Linux measurement, in PR 9's list below.
- CI's `bundle-smoke` builds and starts a server bundle carrying the host protocol, so an export
  `box-host-client.ts` uses that the module lacks fails that build (the plan's finding 13). The
  routes now call the client, but `bundle-smoke` requests none of them: it waits for
  `server.listening` and stops the bundle (`.github/workflows/ci.yml`, the job's two start steps).
- Network/screen forwarding still needs its Linux adapters and measurements against the client's 5- and 20-second waits. The tag adapter is a child of the existing shell instance, sharing its 15-second unit limit; the clock's 700-character rule stays.

- Open: the clock client still answers `lost` to a whole reply followed by a broken connection
  (the plan's D5). Its lines stay under 700 characters, so the shell handler reads them whole, but a
  later host could break the connection after answering; whether the clock client should read that
  reply too is undecided.
- Open: `upgrades/contracts.mjs` and `disk-key.mjs` select no package in CI when
  they alone change, though the server's bundle carries them (the plan's D11; the root-scope guard
  states this gap in its header).
- Decisions recorded for review: importing the module with a declaration in the server rather than
  `allowJs`, a package or a TypeScript twin (D1); `unsupported` and `invalid` as the client's own
  words (D3); reading a reply before a broken connection for B3's requests only (D5); the 5- and
  20-second waits (D6).

**For later slices, from PR 9's [re-map against main](../superpowers/plans/2026-11-06-b3-9-host-routes.md#re-map-against-main-on-2026-11-06):**

- The screen pull request (Task 3.2): English and Spanish words for `box_host.unavailable` (both
  reasons), `box_host.failed` (saying that after `lost` or `timeout` a change may still have
  happened), `box_host.busy`, `box_network.busy`, `box_network.no_wifi`,
  `box_network.not_saved`, `box_network.password_invalid` (per `keyMgmt`) and
  `box_network.join_connection_insecure`; keeping a read's and an action's failure apart on one
  screen (the parent plan's "preserved action failure across read recovery"). When a real box
  refuses a join with `box_network.join_connection_insecure` (a box with no certificate, or a page
  not opened over HTTPS), the page says what happened and what each choice it offers does, per
  CLAUDE.md's refusal rule. A dev stack served over plain HTTP answers every join with that code.
- The Linux and kiosk pull requests: the box's own screen must open Waitron over HTTPS with the
  box's certificate authority trusted, or its manager cannot join Wi-Fi from it (PR 9's D6).
  Measure what a connection over `MaxConnections=4` meets, and whether the client reads it as
  `lost` (for a join, a false "a change may have happened"); whether the clock side ever holds more
  than two connections (a read started after a set clears the cache, PR 9's re-map finding 11); and
  how long handler instances outlive the client's timeout (up to `RuntimeMaxSec=15` against a read's
  5 seconds), which lets the routes' two places and the socket's four drift apart (PR 9's D7).
  `EACCES` on a real box reaches the screen only as `box_host.unavailable`'s `detail`, so a box
  whose app is not in the socket's group looks like a box without the service.
- Open: whether a fenced physical box needs Red (today the read-only gate refuses its network
  changes; an exemption would be a row in `READ_ONLY_EXEMPTIONS`). The SMTP and bucket settings
  routes take credentials over any connection, where the join refuses one that is not encrypted.
- Open, optional: the encrypted-connection test on the socket (a `TLSSocket` whose `encrypted` is
  true) is still written out at each site that needs it: `box-host-api.ts`'s `insecureJoin`,
  `backup-recovery-pack-api.ts`'s `requireSecurePackRequest`, `node-operation-https.ts`,
  `setup-recovery-preparation-api.ts`'s `assertOwnerTransport`, `recovery-start-again.ts`'s
  `isSecure` and several routes in `setup-first-fiscal-api.ts`; one shared helper would stop them
  drifting apart. The page half is already shared, through `sentFromThisOrigin` in
  `apps/server/src/own-page.ts`.
- Decisions recorded for review: reads under `system.manage`, with the person as actor (D2); the
  answer table (D4); the protocol owning the password rules, with the route naming the field (D5);
  the join's encrypted same-page connection (D6); two places, refused rather than queued (D7); no
  socket-path setting (D8); no read-only exemption (D9); no server-side change log (D10).

**Left open by PR 1's review (#2370):**

- Another process running as the same user can create a recorded file or pid file path before the
  step makes it (or any time before cleanup, if the step never makes it), and cleanup would then
  delete it. Stated in `scripts/box/rig-contract.mjs` and the plan; the Linux rig decides whether a
  separate user or folder closes it.
- The Linux cleanup adapter must check that a VM's process is the one this run started, and that a
  mount at a recorded target is one this run made, before stopping or unmounting it. The library
  cannot check either.
- Each VM boot needs its own pid file path: recording the same path twice is refused.
- If the code holding the disk key calls the store again and that inner call is refused, the outer
  call reports `consumer-failed`, not the inner reason (the store never passes a consumer's error
  through, because it may hold the key).

## A1049. The updater honours a version Waitron Cloud marks held (2026-10-24).

Cloud's
approved [monitoring design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) (section 10) holds a version when a new error spreads
after its release. Cloud cannot stop an on-prem upgrade (C41 keeps that consent in Waitron),
so the updater must read the hold before offering or applying the version, and offer the fix
once released. Belongs with A1016.

## A1187 part 2: the recovery pack's emergency start page (owner, 2026-10-29).

- **A1187 part 2: the recovery pack's emergency start page (owner, 2026-10-29).** Waits for A1188
  part 1, whose card facts the page prints, for people holding `node.manage`. Part 1 landed in
  pull requests from #2250 to setup's first pack (PR E): one PDF holding the bucket copy, the
  archives and the server key, made from the Backups card or by setup.
  [Design](../superpowers/specs/2026-10-29-a1187-one-recovery-pack-design.md), [how part 1 leaves room](../superpowers/plans/2026-10-29-a1187-recovery-pack-part-1.md#how-part-1-leaves-room-for-parts-2-and-3).

## A1187: wording part 1's reviews left on the restore command and setup.

- **A1187: wording part 1's reviews left on the restore command and setup.** `waitron-restore`'s
  usage line still says `<pack-file>` for `--from-archive`, and its refusals for a file holding no
  kit or no archive pack still name the kit file and the archive recovery pack file, though both
  forms take the pack PDF; tests pin both word for word. Setup's pack refusals say "paste the code"
  where the field's help says "paste the kit".
  [Detail](box.md#a1187-part-1-what-its-reviews-left-open)

## A1187: code part 1 built twice.

- **A1187: code part 1 built twice.** The encrypted-connection check is copied across several routes,
  and `promote-api.ts` still answers a plain-HTTP or cross-site request with
  `authorization.not_permitted`. The archive code, the backup-key check, the bucket recovery kit,
  the server key's name and its created date are each built in more than one place.
  [Detail](box.md#a1187-part-1-what-its-reviews-left-open)

## A1187: looks nobody has taken.

- **A1187: looks nobody has taken.** The Backups card after a real setup (pack 1 recorded, then a
  bucket copy set up) has not been looked at on a running box: Docker Desktop was unresponsive for
  PR D and PR E. Nobody has looked at the card since #2276 lengthened its unreceived sentences. The
  look images for #2250 were taken before its review changed the "not a pack" refusal and added the
  space mark.

## Backups says "try again" after a saved-settings failure it has no words for.

- **Backups says "try again" after a saved-settings failure it has no words for.** The "Backups
  are off because the saved settings can't be used" line appends the code's dashboard message
  (`backup-screen.ts`, from #1642), and a code with none, such as `credentials.decrypt_failed`,
  falls back to "Something went wrong, try again". That names nothing to try, beside a "What the box
  recorded" panel saying Read again turns nothing on.

## A route whose failure is the system's `ENOSPC` still answers `server.internal`.

- **A route whose failure is the system's `ENOSPC` still answers `server.internal`.** `diskFullIn`
  (`@waitron/shared`) knows a full disk by code 13 or `storage.disk_full`, never `ENOSPC`; `fullDiskFailure`
  (`apps/server/src/boot-failure.ts`) names `ENOSPC` a full disk at start, and on the repair page's
  recover, summary and start-again routes and its inspection read (A1127); every other route still answers
  `server.internal`, because adding it to `diskFullIn` changes every route's answer.

## The full-disk bar waits for the owner's answers.

- **The full-disk bar waits for the owner's answers.** Its words; naming a deletion only from an
  open alert under a day old (so a fresh deletion is not named while an older alert stays
  unhandled); not saying "every backup it may"; a red edge and border rather than a filled bar; the
  bar beside the bell's toast; and reading the queue's "no button" as the dropped Box status button.
  The seven questions are in #2223's description. Left open by A1127 slice 3 (#2223).

## Bundle: Finish the clock work: a check at every start and every change

3 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A798-B. Build "degraded but trading": what the box does, and tells staff, when a part fails but
  it can still sell.**
  Design revision 7 (2026-10-24).
  [Detail](box.md#a798-b-build-degraded-but-trading-what-the-box-does-and-tells-staff-when-a-part-fails-but-it-can-still-sell)
- **The box's certificate issued under a wrong clock.**
  [Detail](box.md#the-boxs-certificate-issued-under-a-wrong-clock)
- **What slice 9b leaves to slice 9c and to a restart.**
  [Detail](box.md#what-slice-9b-leaves-to-slice-9c-and-to-a-restart)

## Bundle: Qualify clock confirmation through remote access

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Qualify a remote administrator's clock confirmation through the staff entrance.** A951-S
  marks staff requests remote before the own-box check. Its listener test observes `box: false`
  for a remote request and `box: true` for the unmarked control. That boundary check does not
  exercise the clock-confirm route. Run the real route before closing this qualification.
  Left open by A798-B slice 9 (#2025), narrowed by the A951-S retirement review on 7 November.
- **A future cloud or proxied primary needs its own clock-witness rule.** Today a venue has no
  cloud primary. Qualify how a future one distinguishes its own device from remote devices
  (design §4.9 h, point 3). Left open by A798-B slice 9 (#2025).

## Bundle: Full disk: the till read that fails, and the words

13 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **On a full disk, a box whose kept certificates cannot be used shows the connection set-up page,
  with no word of the full disk.**
  Open: should that page also say the disk is full and show the free space?
  [Detail](box.md#on-a-full-disk-a-box-whose-kept-certificates-cannot-be-used-shows-the-connection-set-up-page-with-no-word-of-the-full-disk)
- **A route whose failure is the system's `ENOSPC` still answers `server.internal`.**
  [Detail](box.md#a-route-whose-failure-is-the-systems-enospc-still-answers-serverinternal).
- **The recovery page served at once on a full disk does not notice freed space by itself.** It
  shows the free space as it is on every load, but only Retry, which restarts the app, tries the
  start again (A798-B slice 2).
- **The dashboard shell's other first reads were not checked on a full disk.** Slice 7 made the
  Box status read and the bell's alert reads answer there; the shell's other reads at sign-in were
  not tried. Left open by A798-B slice 7.
- **Till write surfaces other than the draft save, the unpaid departure and the station screen were
  not checked for a full-disk refusal's words**
  [Detail](box.md#till-write-surfaces-not-checked-for-a-full-disk-refusals-words)
- **On a full disk, a till read whose route opens a `withTransaction` is refused while a change
  waits.**
  [Detail](box.md#on-a-full-disk-a-till-read-whose-route-opens-a-withtransaction-is-refused-while-a-change-waits)
- **A failed staff-notice check is seen in the log and as a note on the Box status page; the bell
  does not show it.** A bell alert would tell the manager when the unsent count cannot be worked
  out. Left open by A798-B slice 6 (#1977).
- **The strip draws no tinted background and no coloured words, unlike picture 2.** No token is
  named for the tints and `color-mix()` is refused; tint tokens with their contrast checks would let
  it. Left open by A798-B slice 6 (#1977).
- **No strip on the clock-in and attendance pages.** `till-app` draws them instead of the shell.
  Left open by A798-B slice 6 (#1977).
- **A till nobody has signed in to shows no strip on a full disk, and PIN sign-in is refused
  then.** The sign-in page shows only the refusal's own sentence. Left open by A798-B slice 6
  (#1977).
- **A kitchen screen on a full disk can be reported dark while it works.** Since slice 6 its
  requests are served on a full disk but its last-seen time is not saved, so the dark-screen check
  (`SCREEN_DARK_MS`, `apps/server/src/station-outputs-down.ts`) raises it after three minutes,
  beside the full disk's own alert. Left open by A798-B slice 6 (#1977).
- **The refund guide does not say that recording a separate-terminal refund is refused during a
  full-disk stop.** One sentence in each language, as the kitchen-service guide already has.
  [Detail](box.md#the-refund-guide-does-not-say-that-recording-a-separate-terminal-refund-is-refused-during-a-full-disk-stop)
- **The full-disk bar waits for the owner's answers.**
  The seven questions are in #2223's description. Left open by A1127 slice 3 (#2223).
  [Detail](box.md#the-full-disk-bar-waits-for-the-owners-answers).

## Bundle: What pack part 1's reviews left

10 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1187 part 1's defaults, which the owner has not confirmed.** The plan settled each question
  the design left open with a conservative default, among them the keep-until date counting from
  the key's change time (a stated departure from design §4) and Make offered wherever the old
  Recovery PDF card was. [The list](../superpowers/plans/2026-10-29-a1187-recovery-pack-part-1.md#questions-the-design-leaves-open).
- **A1187: wording part 1's reviews left on the restore command and setup.**
  Setup's pack refusals say "paste the code" where the field's help says "paste the kit".
  [Detail](box.md#a1187-wording-part-1s-reviews-left-on-the-restore-command-and-setup).
- **A1187: code part 1 built twice.**
  The archive code, the backup-key check, the bucket recovery kit, the server key's name and its created date are each built in more than one place.
  [Detail](box.md#a1187-code-part-1-built-twice).
- **A1187: a credentials-only change to environment-managed archive settings does not make a pack
  out of date.** The pack record holds a digest of the non-secret settings only.
- **A1187: the pack PDF's presentation.** It uses one regular-weight font: no bold, and codes not
  in a fixed-width face, so l and I look alike. The cover says "The dashboard's Backups screen shows
  the same checks" beside a check value (`key of <day> · rev <8 characters>`) that no part of the
  Backups screen shows.
- **A1187: the Backups card's reads and receipts.** [Detail](box.md#a1187-part-1-what-its-reviews-left-open)
- **A1187: looks nobody has taken.**
  Nobody has looked at the card since #2276 lengthened its unreceived sentences.
  [Detail](box.md#a1187-looks-nobody-has-taken).
- **A1187: setup's command-line pack is not run under the source loader or from the bundle.**
  `apps/server/src/recovery-pdf-source.test.ts` and `packages/fiscal-verifactu/src/recovery-pdf-node.test.ts`
  still draw the old recovery sheet through `recovery-pdf-node.ts`; the command path's real renderer,
  `renderSetupRecoveryPack`, is tested only inside Vitest.
- **A1187: "sheet" wording left after the pack replaced the sheet.** Setup's key picker says "Enter
  the key from the sheet below." (`packages/fiscal-verifactu/src/setup/recovery-key.ts`), and
  `docs/operations/hour-recovery.md` is titled "Recover a box with its recovery sheet". Older sheets
  are still read, so each needs the pack named beside the sheet, not in its place.
- **A1187: the data-protection guide says a pack made on Backups "opens" the backups.** It does not
  when the pack's bucket or archive page failed, nor for backups made under an older key (the guide
  covers older keys further down). Narrow the sentence in English and Spanish.

## Bundle: Wrongly dated sales list and the adviser's file

7 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Some sales dated wrongly are in no list**: those of a clock put right from little more than a
  minute ahead, and those of a stop the box "cannot tell" about, which has no list and no download.
  Left open by A1088 (design §4.9 f).
  [Detail](box.md#some-sales-dated-wrongly-are-in-no-list)
- **The real time of a sale dated wrongly is unknown**: the adviser's file says "Unknown" on every
  row and gives a time each sale was made before instead (A1088 decision 8). Slice 9c's clock
  checks are the first place a real time could be worked out. Left open by A1088.
- **Box status's "cannot tell" sentence, and the note dialog's summary of it, write the stop's start
  in the browser's time zone**, while the section's tables and the adviser's file write each sale's
  time at its stored offset: the sentence is the shared `alertMessage` wording. Left open by A1088.
- **An open list of wrongly dated sales whose list read failed shows no Download** until a later
  read of the lists answers. A list the box restarted during still shows its sentence and Mark
  handled; a plain one shows neither. Left open by A1088.
- **The Box status page's Handled lists fold reads every handled list when opened, with no
  limit** (A1088 decision 1); page it if a venue gathers many. Left open by A1088.
- **The adviser's file is comma-separated in both languages, and a spreadsheet set to expect
  semicolons may open the Spanish file in one column.** Excel in Spain is untested; whether `es`
  should use `;` is the owner's decision. Left open by A1088.
  [Detail](box.md#the-advisers-file-is-comma-separated-in-both-languages)
- **The Box status page reads the wrongly-dated-sales alerts' params through a cast**, keeping its
  own copy of a shape the Veri\*Factu module writes; a fiscal seat method answering the typed list
  would remove it. Left open by A798-B slice 9 (#2025).
  [Detail](box.md#the-box-status-page-reads-the-wrongly-dated-sales-alerts-params-through-a-cast)

## Bundle: Bucket copy: silent stops and a real outage

5 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The bucket stream prunes nothing, and says nothing, while it cannot read its marker.**
  [Detail](box.md#the-bucket-stream-prunes-nothing-and-says-nothing-while-it-cannot-read-its-marker)
- **Loose ends left by SQLite slice 2 Task 6 (#590, the Litestream supervisor).**
  `pnpm setup:litestream` skips the download when the installed binary already reports the
  pinned version, so the checksum protects fresh downloads only.
  [Detail](box.md#loose-ends-left-by-sqlite-slice-2-task-6-590-the-litestream-supervisor)
- **Loose ends left by SQLite slice 2 Task 7 (#619, how current the bucket copy is).**
  Whether Litestream uploads anything while the side file is unchanged is not measured.
  [Detail](box.md#loose-ends-left-by-sqlite-slice-2-task-7-619-how-current-the-bucket-copy-is)
- **Loose ends left by A549.**
  Whether the side file grows, and the pause fires, in a real network outage was not run.
  [Detail](box.md#loose-ends-left-by-a549)
- **Loose ends left by #668, #686, A57, A60 and #723 (the pause test and the bucket's error
  reports).**
  [Detail](box.md#loose-ends-left-by-668-686-a57-a60-and-723-the-pause-test-and-the-buckets-error-reports)

## Bundle: One word for the box, one name for the key

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1187: one key has three names.** "Recovery key" (the key-change dialog), "backup key" (the
  card and the PDF), and in Spanish "clave de las copias" beside "Clave de copia".
- **Backups' Spanish names the box both "caja" and "equipo".** Both words appear across its
  strings (`strings.ts` `backup.*`) and its error messages (`codes.ts` `backup.*`); its alerts
  (`alert-messages.ts`) and the settings-evidence panel say "equipo". Pick one word across the
  screen; elsewhere "caja" also means the till.
- **The Backups screen's Spanish names the bucket copy two ways.** The bucket choice's option says
  "El bucket de la copia continua" (`backup.destination.choice_stream`), while the hints beside it
  and the rest of the screen say "la copia en el bucket". From A538-6 (#1642); seen in A639's
  screenshots, not changed there.
- **'Equipo' names two things in the Spanish dashboard.**
  [Detail](box.md#equipo-names-two-things-in-the-spanish-dashboard)

## Bundle: Card reader alerts

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A card reader whose status the provider could not read raises nothing.** SumUp and Stripe
  answer `{ online: false, unreachable: true }` rather than throwing, so
  `reader.status_unavailable` comes only from a throw or the 45 s deadline (slice 10 plan P2). Left
  open by A798-B slice 10.
- **On a box with card payments off, the card-reader battery check may raise
  `alert.source_unavailable` on every bell read.**
  [Detail](box.md#on-a-box-with-card-payments-off-the-card-reader-battery-check-may-raise-alertsource_unavailable-on-every-bell-read)

## Bundle: Backups screen leftovers

9 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **At 390 px wide, the configuration export's password label overlaps its Show password button.**
  Found while looking at the Backups screen for A1187 PR D. The markup came with #296 and is
  believed to predate that branch; nobody photographed it before.
- **Backups says "try again" after a saved-settings failure it has no words for.**
  That names nothing to try, beside a "What the box recorded" panel saying Read again turns nothing on.
  [Detail](box.md#backups-says-try-again-after-a-saved-settings-failure-it-has-no-words-for).
- **`backup.archive_settings_unusable` is worded only as an alert** (`alert-messages.ts`), not on
  the Backups screen. Left open by A538-4.
- **Two small leftovers in the Backups destination form, reported by A639's review and not fixed
  there (#1695).** Neither was reproduced outside the reviewer's run.
  [Detail](box.md#two-small-leftovers-in-the-backups-destination-form-a639-1695)
- **The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.**
  [Detail](box.md#the-bucket-copys-settings-screen-cannot-repair-a-stored-record-that-cannot-be-decrypted)
- **A too-short recovery key's refusals do not link to the button they name**
  [Detail](box.md#a-too-short-recovery-key-the-refusals-do-not-link-to-the-button-they-name-and-change-the-recovery-key-cannot-finish)
- **The Backups screen's bucket fields copy the bucket copy panel's.**
  Share them. Left open by A538-6.
  [Detail](box.md#the-backups-screens-bucket-fields-copy-the-bucket-copy-panels)
- **Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive
  destination).**
  [Detail](box.md#loose-ends-left-by-sqlite-slice-2-task-2a-557-a-recovery-key-that-does-not-need-an-archive-destination)
- **A blank "Time of day" on the backup screen sends `{ hour: 0, minute: NaN }`** — left open by
  A178 (#1010 to #1019), seen while building, not changed: the same parsing is on `main` before
  A178b (`#buildSchedule`'s `split(":")`); what the server does with it was not checked.

## Bundle: Box status rows

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The Clock row says 'connect the box to the internet' where that may not help.**
  [Detail](box.md#the-clock-row-says-connect-the-box-to-the-internet-where-that-may-not-help)
- **The clock stop's look differs from pictures 8 and 9.** The counter refusal shows in the till's
  top banner, not under the strip; the Clock row's fix advice follows " · " on the comparison line
  rather than on a line of its own; the Box status page shows the alert sentence "Sort it out on the
  Box status page" while on that page. Left open by A798-B slice 8 (#2012).
- **The Tax agency row does not say since when sends have failed.** Picture 4 draws «los envíos
  fallan desde 17:31»; the row shows the last acceptance. The technical incident's open time could
  carry it. Left open by A798-B slice 7b (#2030).
- **The recovery page says the start "deleted what it could make again"; the Box status page says
  "files the box no longer needs".** One wording for the same set. Left open by A798-B slice 7.

## Bundle: Refuse folders that cannot be safe

1 entry, size S. Its text is unchanged from the index it came from (backlog review, 2026-11-06).

- **A relative backup folder is accepted.** The Backups screen's hint asks for a full path, but
  the server resolves whatever it is given (`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`),
  so `backups-relative` saved as a folder under the server's working directory (seen on the dev
  stack during A538-6's visual check). That line came in with #1628 (A538-4).

## Decisions and deliberate limits

### The bucket client's limits (A44, #676)

Recorded as limits by the campaign watcher on 2026-11-11 (A1508), open to the owner.
`createS3ObjectStore` gives a request up when it has had no reply 30 seconds after it started
(`BUCKET_IDLE_MS`, `packages/stream/src/s3-client.ts`). An answer whose headers arrive within three seconds and whose
body then stalls is not bounded by that limit, only by its caller cancelling the call
(`packages/stream/src/s3-store.cancel.test.ts`), so a call nobody cancels can still wait on it;
the idle limit is per request, not per call, so a listing of many pages, or a bucket
answering each request just inside the limit, can take longer; a bucket that takes more than 30
seconds to answer a request whose body is already sent, such as a delete of 1,000 keys, is cut off;
Amazon S3 answered one delete of 1,000 tiny keys in 1,040 ms on 2026-10-14 (A538-10), and other
providers, and larger or busier buckets, were not measured; and the idle limit's tests run the
handler's below-6,000 ms path, while its production path was measured by hand, not by a test.
The settings screen's bucket Test, and Save's bucket and customer-key checks together, end after
a minute or when the browser drops the request (`PROBE_LIMIT_MS`, `apps/server/src/stream-api.ts`).
A check cut off this way, even during its clean-up, can leave its one test object in the bucket,
under `waitron-probe/` inside the configured prefix, since its clean-up runs under the same signal
(`probeBucket`, `packages/stream/src/probe.ts`; `prepareBucketEncryption`,
`packages/stream/src/sse-c.ts`).

### Quiet-box backup read limits

The owner approved [#2524](https://github.com/clintongormley/waitron/pull/2524) for landing on 2026-11-07: a quiet box reads the bucket every ten minutes and Litestream checks for old pieces every five minutes. This accepts up to ten minutes before a quiet box notices a failed bucket, displays an upload its change tracker missed, or starts a daily bucket check after it is due. Old level-0 pieces can stay listed up to five minutes longer.

- **What the box does when its clock is wrong (owner, 2026-11-06, for slice 9c and A1407).** Setting the clock from an accepted source counts as confirming it, so trading carries on, and records dated in the future beyond the margin are flagged for correction. AEAT refusing the latest record as too far in the future stops trading until the clock is reset. Any accepted source showing the clock outside the margin stops trading until it is corrected, and AEAT disagreeing during normal trading is such a source. A start with no internet whose latest record is in the future beyond the margin needs the time confirmed first. Being unable to reach AEAT never stops trading. The margin is one minute. A box whose time service says it is in sync raises an alert rather than stopping when AEAT disagrees.
  - **Superseded in part (owner, 2026-11-10, A1420).** "Being unable to reach AEAT never stops trading" is replaced by: AEAT is not asked at a start; on a box that files records, a start whose time service is not synchronised takes no payment until two devices agree with its clock or a person confirms or corrects its date and time. "A start with no internet whose latest record is in the future beyond the margin needs the time confirmed first" is replaced by: every start with no internet needs its time confirmed first, wherever its latest record is. "A box whose time service says it is in sync raises an alert rather than stopping when AEAT disagrees" (never built) is replaced by: a box whose time service is synchronised is trusted; its start is confirmed without asking AEAT, and AEAT refusing a sale as dated in the future does not stop it (owner, 2026-11-10: "NTP is the answer for now"; A1420 D5, D9); a restore still compares AEAT's time until A1420 PR 3. "…and records dated in the future beyond the margin are flagged for correction" is replaced by: invoices AEAT refuses as dated in the future are to be corrected (A1407); a wrong date AEAT accepts or never sees is not (owner, 2026-11-10). Built by A1420 PR 1a: the start's check and its wait ([detail](../developers/conventions-data.md#every-start-confirms-the-boxs-time-before-it-trades)).
- **A restart may forget that AEAT disagreed with the clock (owner, 2026-11-06).** The disagreement is kept in memory only, and this stays. It matters only if the box's own correction fails, the server restarts, AEAT is out of reach and a device matches the wrong clock, and misdated sales have a remedy (A1407).
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

- **A box that already holds Waitron but has its TPM or Secure Boot switched off still starts (owner, 2026-11-03).** The stick starts the installed Waitron after 15 seconds so the venue keeps selling; the installer's message and the status page carry the setting that is off; slice 3's host service raises the alert; a reinstall on that box stays refused. Built as the installer's decision D2 in B3 PR 3 (`scripts/box/installer-policy.mjs`, #2426) and kept as built. The 15 seconds, two minutes, 60 seconds and one minute stay the spec's proposals; the owner was not asked about them. ([B3 PR 4's plan](../superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md), D13.)
- **B3 keeps slice 9b's clock requests on their wire and shell handler (B3 PR 7's D1; the lane's decision of 2026-11-05, open to the owner).** They have landed, the clock-behind stop and the clock confirmation use them, and a box installed by `waitron.sh` has no Node on its host. B3's requests will share the socket, the one-line framing and `apps/server/src/box-host-client.ts`; the shell handler is to forward them to the Node host in slice 3's Linux pull request. The host knows its caller by the socket alone (D2): only root and the app's group can connect, one request per connection, so there is no token to replay; the server is to mint an ids-only actor from a session it authorised, and the host checks its form and logs it, and a compromised server can send any actor, as with slice 9b's requester. ([PR 7's plan](../superpowers/plans/2026-11-05-b3-7-host-protocol.md), D1, D2.)
- **The box's network and screen routes send at most two requests to the host service at once, and refuse a third with `box_host.busy` rather than queue it (B3 PR 9's D7; the lane's decision of 2026-11-06, open to the owner).** The host's socket serves four connections (`deploy/box/waitron-box.socket`, `MaxConnections=4`) and how many the clock side holds at once is not measured (PR 9's plan, finding 11). Two rather than one, so a page's read is not refused while a scan runs; refused rather than queued, so no request waits behind a change, which can hold its place for up to 20 seconds. Two places do not hold the total to four; what is still to measure on Linux is in [PR 9's plan](../superpowers/plans/2026-11-06-b3-9-host-routes.md), D7.
- **The server-wide page check looks only at whether a change carries the dashboard's sign-in cookie, not at whether its session is live (A1371, 2026-11-06).** Checking the session would cost a database read on every change, and nothing but a browser sends that cookie: outside tests, its name appears only in `packages/server-kit/src/management-cookie.ts` and that package's index (a search of `apps`, `packages` and `scripts`, 2026-11-06), and `git grep` for it in Waitron Cloud's repository at `6eeb0d953` printed nothing. A change without the cookie passes, so a till on another server, Stripe's webhook and the print agent keep working. [Detail](../developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)
- **The page check leaves `GET`, `HEAD` and `OPTIONS` alone (A1371, 2026-11-06).** Another page cannot read their answers, and a CORS preflight must reach the CORS middleware. Two kinds of `GET` still change something when another page sends them: every signed-in `GET` that is not a passive read moves the session's last-seen time (`packages/identity/src/management-session.ts:86-91`), so a page on another port left open in the same browser can keep a session from going idle, though it changes no venue data; and the Google sign-in's return, `GET /management-api/google/callback`, sets a session cookie, as a sign-in arriving from Google must, guarded by its own state cookie. No route takes a WebSocket. [Detail](../developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)
- **Four routes keep their own stricter page check (A1371, 2026-11-06).** `cloud-api.ts`, `content-suggestions-api.ts`, `content-translations-api.ts` and `venue-zone-repair-api.ts` (all in `apps/server/src/`) require `Origin` to be exactly `managementOrigin`, so they also refuse a tool that sends no `Origin`, and the box's own address when it is not `managementOrigin`. Loosening them to the shared check was not part of A1371. [Detail](../developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)
- **A page served by another of the venue's servers is trusted through the CORS allow-list, and no started-server test sends one (A1371, 2026-11-06).** The page check trusts every routable server address in the held membership document (`apps/server/src/allowed-origins.ts`), because a till may be served by another of the venue's servers under a shared domain and carry this server's dashboard cookie. Only the allow-list's own unit test sends such an address (`apps/server/src/allowed-origins.test.ts`, "allows the advertised origin and every contactUrl origin, and nothing else"). [Detail](../developers/conventions-data.md#a-change-carrying-the-dashboards-sign-in-cookie-is-checked-for-the-page-that-sent-it)
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

- **Backup status reads keep their own storage client per destination (the watcher's decision of
  2026-11-07, A1391, open to the owner).** The status read holds one client per destination
  (`StatusClients`, `apps/server/src/backup-status-clients.ts`, owned by `BackupSupervisor`), built
  on the first read and lent to every later one; it shares nothing with the running backup's
  clients. A destination whose settings differ by value from the client's (any field, the secret
  included) gets a new client at its next read. A destination no longer configured loses its
  client at the reload, and every destination does when a reload finds no usable settings, or
  settings switched off, or cannot open the venue: then status reads no destination. While status still
  reads one (on a box that is not the primary, without a recovery key, or after a destination
  failed to build) its client is kept. All are closed when the supervisor stops, and reads after
  that build a client each and close it. A replaced or removed client is closed only once
  every listing lent from it has settled, so a read under way on it still answers. Measured in
  `apps/server/src/backup-status-clients.test.ts` against a local HTTPS server: two reads in a row
  on the kept client opened one connection, and two reads each on a new client opened two. That
  test trusts its certificate through the client's own keep-alive agent, and its reads are back to
  back; whether a real bucket keeps the connection open across the Backups screen's 10-second
  reads was not measured.

- **A stored bucket-copy record is not re-checked for a user name, password, query or fragment in
  its address (A1391 plan D1; the lane's decision of 2026-11-07, open to the owner).** Every save
  path but one refuses one (`readBucketConfig`, `packages/stream/src/bucket-config.ts`). The
  exception, `waitron-credentials set`, checks only that each named field is non-empty text, and
  the stored record is read field by field (`readStreamSettingsIn`, `apps/server/src/stream-host.ts`),
  so a record it wrote is sent back by `GET /api/backup/stream` as stored.

- **Every start deletes a cut-off backup run's leftovers in backup staging, whatever the free space
  (A978, owner 2026-10-21).** A backup run stages a plaintext copy of the whole venue database and
  its encrypted copy in `<state>/scratch/backup`, and its own `finally` deletes them
  (`apps/server/src/backup-sweep.ts`), so a run that is cut off leaves them behind. Owner: "Every
  start deletes them, whatever the free space — so a plaintext copy never outlives a restart. (The
  start never deletes them while a running server holds the venue folder.)" Built in
  `freeSpaceAtStart` (`apps/server/src/start-space.ts`), which keeps them while another
  process holds the venue folder's lock. The limits that remain: a cut-off run's copy stays until
  the next start, or a Free press on the Box status page while no backup run holds or waits for
  the staging turn (A798-B slice 7); where the lock cannot be taken for another reason (measured on a full disk with
  no other holder), the holder file's heartbeat decides, so a holder that died less than 30 s
  before keeps it until a later start (`docs/developers/conventions-data.md`, "Every start takes
  the venue lock"); a box reset also deletes it (`wipe_box`, `deploy/waitron.sh`).

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

- **A server started outside the box's entry does not clear `.venue.db-replaced-` folders.
  Decided by the campaign watcher on 2026-11-07 (A1390 question 1): the dev stack is not a
  venue.** Only the box's entry clears them, before the server opens `venue.db`; the dev stack
  starts `src/bin.ts` and leaves them. Boot cannot clear them instead, because its first open
  creates `venue.db` (`clearReplacedDatabases`, `apps/server/src/restore.ts`).
- **The first start's bucket pointer read and an operator's restore keep their own time limits and
  codes. Decided by the campaign watcher on 2026-11-07 (A1390 question 2).** 15 seconds and
  `restore.pointer_unreadable` for the read that holds a restored box's first start (it is tried
  again at the next start); 60 seconds and `backup.stream_request_failed` for each bucket call of a
  restore an operator starts. Neither number was measured (`POINTER_READ_TIMEOUT_MS`,
  `apps/server/src/rebuild-first-start.ts`; `BUCKET_CALL_TIMEOUT_MS`,
  `apps/server/src/bounded-store.ts`).
- **A restore that fails at the migration or module step, after the database is placed, keeps the
  restored database with the old identity set aside; there is no second undo path. Default taken
  pending the owner (A1390 question 3, 2026-11-07), checked by running it the same day.** Only a
  failure to move the database into place puts the identity back (`placeValidated`,
  `apps/server/src/restore.ts`). What the runs showed, restoring a fiscal venue's archive with
  its recovery operation over a box holding its own database and identity: a broken migration file
  (run through the command line) failed first on the copy the restore checks before placing, so
  nothing on the box changed; only a migration failure that strikes the placed copy alone
  (injected for the run) reaches the step after placement, as does a failing restore hook. There, neither identity starts beside the wrong data: no `trading.env` is left, and the old
  one is kept as `trading.env.replaced`. The command line then prints, for a migration,
  `restore failed: migrations.apply_failed — …; install a version that fixes this, then run the
  same command again: it starts the restore over` (the disk-full line when the engine reported a
  full disk), or `restore failed: restore.hook_failed (module …)` for a hook; a server started now
  comes up in setup mode, and once the cause is gone the same command finishes the restore (pinned in
  `apps/server/src/hour-recovery-placement-1.test.ts`). A restore staged for the box's next start
  now starts from its retained source on every attempt (owner, 2026-11-11, A1308-fl5b), replacing
  A1415's saved-activation decision. Once marked `placing`, retry removes the unfinished
  databases first; a corrupt partial copy does not require a manual move. Every failure keeps
  the request and stops the server, including Cloud completion. Completion removes the request
  last and keeps the independent first-start obligation. An unreadable request stops the box while
  its saved-hashes attachment remains. Boot removes it before serving; damage to a retained record
  after that keeps first start pending without preventing boot.
  The HTTPS recovery page offers **Throw this restore away**, authenticated with an administrator
  password from the selected backup. Once copying began this removes the partial data and both
  identity files, so you can restore again or set up; it does not recover the previous database.
  Physical power-loss durability remains in
  the [B2 carry-forwards](#backup--restore--carry-forwards-b2).

- **A managed Cloud restore keeps both sealed bucket records (owner answer 2026-10-13, A538-4).**
  A restored or replacement box inherits both `backup.archive` and `backup.stream` (bucket keys
  included); `docs/developers/cloud-connection.md` says so. Owner: "Keep as built: a replacement
  box restored from Waitron Cloud reads `backup.archive` and `backup.stream` and carries on backing
  up to the owner's own buckets with no setup. No backlog item for "drop them"."

- **A917 — the owner chooses the server's `.local` name instead of `waitron.local`** — DESIGNED; not scheduled; not built.
  [Detail](box.md#a917--the-owner-chooses-the-servers-local-name-instead-of-waitronlocal)
- **A device's or an administrator's time is self-reported.**
  [Detail](box.md#a-devices-or-an-administrators-time-is-self-reported)
- **The box sends AEAT's QR host a HEAD once a minute by its steady clock (on every look when that clock cannot be read or went backwards) while the Veri\*Factu module reports the box's clock behind the latest sale — during a stop, and under a confirmation that lifted it — or while a clock check whose stop has ended waits for its witness**
  [Detail](box.md#the-box-sends-aeats-qr-host-a-head-once-a-minute-by-its-steady-clock-on-every-look-when-that-clock-cannot-be-read-or-went-backwards-while-the-verifactu-module-reports-the-boxs-clock-behind-the-latest-sale--during-a-stop-and-under-a-confirmation-that-lifted-it--or-while-a-clock-check-whose-stop-has-ended-waits-for-its-witness)
- **AEAT's time outranks the devices.**
  [Detail](box.md#aeats-time-outranks-the-devices)
- **A malformed confirmation covers nothing.** A row of the append-only `clock_confirmations`
  whose chain heads are unreadable, not whole numbers of zero or more, or past the chain's current
  ones lifts no stop; a fresh confirmation of the same record can lift it (slice 9 decision 21).
  Left open by A798-B slice 9 (#2025).
- **The email about a clock set before 28 October 2024 rarely leaves the box.**
  [Detail](box.md#the-email-about-a-clock-set-before-28-october-2024-rarely-leaves-the-box)
- **`resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the
  staging folder**
  [Detail](box.md#resolvesafeentrypath-appsserversrcstate-secretsts-is-unchanged-and-nothing-chmods-the-staging-folder)
- **A950 is go-live work, and A799 is folded into it (owner, 2026-11-09; supersedes the 2026-11-06 decision that both come after the first venue).** Owner: "it's required for go live and needs to be bullet proof. i don't want to lose this one. the first live venue is going to be remote so it will be difficult for me to fix. i need upgrades to be solid." A799's trial of the new release's database changes on a copy of the live data is A950's step 4, now; testing against real older releases is kept from go-live onwards. After the first venue, as points under A950: the Cloud release check, the password-checked go-back button, proof-of-close, and the backup-stream handoff.

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

## Two small leftovers in the Backups destination form (A639, #1695)

(1) A folder typed in the settings editor and then cancelled can reappear in the
"Turn on backups" form later; it is never sent and never counts as a change. (2) A refusal of the
other bucket's secret that arrives after the owner switched the bucket choice away from "Another
S3-compatible bucket" is dropped, so the next Save asks again. Neither was reproduced outside the
reviewer's run. Separately, an entry of the Save's `destinations` list with an unknown kind is
refused under field `destination`, a name the request no longer has; the dashboard never sends one
(`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`).

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

Static F/design boards (removed from the repository on 2026-11-02)
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
has no passing evidence. Static E/F boards (removed from the repository on 2026-11-02)
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
and worked-example boards (removed from the repository on 2026-11-02) await owner
agreement. Recommend an invented venue captured after an immutable older image writes it through
product paths, with independently frozen facts and a separate candidate copy. Supported captures
begin after A760’s approved squash/reset; this proposal does not execute that operator job or
authorize an upgrade across it. Implementation, an actual pending-migration case and issued-F1
coverage remain open. The existing synthetic walk stays complementary and unchanged. The detail
below records the gap that prompted the design, not a new runtime measurement.

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).**
  (2026-11-07, A1422) Since A760 the walk starts at the squash epoch and `RESETS` is empty; the old
  steps named below are history, readable with
  `git show f519799de0:scripts/fixtures/a760-history/<set>/<file>`.
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
draft save's refusals and the unpaid departure already say "Not saved: the server is out of
disk space…" (the paths measured 2026-10-22, slice 6's plan; the words since A1382), and since slice 6 the station screen does too, on a
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
export (`apps/server/src/attendance-export-csv.ts`) also joins with `,` in every language. The accountant's
file of deferred payments (`apps/server/src/deferred-payment-export.ts`, A275) is written the
same way, through the same `csvCell` and `amountCell`. Whether the `es` file should use `;` is the
owner's decision.

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
  Slice 9b (#2331) changed what such a time can do: an administrator's time, and during a stop
  found at start-up a till's time confirmed by the staff member signed in on it, can now SET the
  box's clock, while two devices alone no longer can, and slice 9b alerts and emails every step it
  verifies or sees move the clock by more than a second. A scripted request from any staff member
  signed in on an enrolled till during such a stop can set any time from 28-10-2024 to 2100, with
  that person named ([Q61](../compliance/asesor-questions.md#q61-a-system-that-corrects-its-own-clock-from-a-tills-clock-when-it-has-no-internet-added-2026-11-01)). Left open by A798-B slice 9 (#2025).

## The box sends AEAT's QR host a HEAD once a minute by its steady clock (on every look when that clock cannot be read or went backwards) while the Veri\*Factu module reports the box's clock behind the latest sale — during a stop, and under a confirmation that lifted it — or while a clock check whose stop has ended waits for its witness

This applies on a primary that files records. The module reports no stop while the clock reads
a date before 28-10-2024, so no HEAD is sent then.
  Left open by A798-B slice 9 (#2025).

## The start on a full disk deletes backups by stamp alone after a clock step.

Making room before a backup run, and the free-space watch, offer last the backups a recent step of
the box's clock holds (stamped before the step, or more than a minute ahead). The start on a full disk (`apps/server/src/start-backup-room.ts`) has no database, so it
reads only `backup-room-note.json`'s installation start and deletes oldest by stamp, never the newest by
stamp: after a −400-day step it can delete the real newest backups and keep the ones dated by the
wrong clock. The note is written when backup settings load (`backup-supervisor.ts`), not when the
clock steps, so carrying the step means a new note field and a rewrite on every step. Left open by
A798-B slice 9b, Task 14a.

## Closing a pay period trusts the box's clock.

`closePayPeriod` (`packages/workforce/src/pay-period-close.ts`) refuses `pay_period.not_due` until
the clock passes the period's end. A clock wrongly days ahead could close a period that has not
ended, and the closure is append-only. No production code calls it yet; the caller that is added
needs a clock check (the fiscal clock-behind stop's shape, or a confirmed reading). Left open by
A798-B slice 9b, Task 15 (its audit table, `docs/developers/conventions-data.md`).

## A1268 part 2: pair a person's entries by write order after a backward clock step.

After a backward step the hours read,
the end-of-day pass (`intervalsFor` in `end-of-day.ts`) and the correction check
(`validateSequence` in `corrections.ts`) still order a person's entries by `compareEvents`, so a
session reads as written (negative or missing) and every other correction for that person is
refused `correction.invalid` `unmatched_out` until a manager retimes the clock-in. Read, not run,
except the retime. Left open by A798-B slice 9b, Task 15a. Design:
[A1268 design §4](../superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md#4-part-2--readings-that-order-entries-by-time-after-a-backward-clock-step).

## The bucket stream prunes nothing, and says nothing, while it cannot read its marker.

Since slice 9b the daily prune of old stream generations ages them by the bucket's clock, read from
the marker the stream writes when a generation opens (`#readBucketClock`,
`packages/stream/src/supervisor.ts`). While the bucket's listing does not show that marker, the
prune deletes nothing, every day, and logs nothing (a read that fails logs `stream.prune_failed`),
so old generations can pile up in the bucket with no alert. Also not tested: a later generation whose marker cannot be read after an
earlier one's could (read, not run). Left open by A798-B slice 9b, Task 15.

## What slice 9b leaves to slice 9c and to a restart.

- A clock wrong forward at start, or wrong backward by less than the gap to the last sale, asks
  nobody until slice 9c's start check (slice 9b plan, decision 14).
- A node promoted while running gets no start-up window, so no till's time can set its clock, until
  it restarts; and a start-up window stays open while every read of the stop keeps failing
  (decision 14; stated, not fixed).

Left open by A798-B slice 9b.

## timesyncd's clock file after a backward set has not been watched across a reboot.

The host handler moves the time of timesyncd's clock file (`/var/lib/systemd/timesync/clock`) back
with a backward set (slice 9b plan, M8′). The measurement runner runs chrony, not timesyncd, so the file was made for the measurement (slice 9b
plan, M8 and M8′); what timesyncd does with it at the next boot has not been watched. Measure it on a
real box. Left open by A798-B slice 9b, Task 1.

## The box's certificate issued under a wrong clock.

The box's leaf (`apps/server/src/self-signed-cert.ts`, `notBefore` the clock less a day) issued
while the clock was more than a day ahead is refused by every device whose clock is right. The box's
repair route reissues a leaf the box itself sees as not healthy; whether a device that refuses the
certificate can reach that route is not checked. Slice 9c should refuse a certificate issue while a
clock check waits. Read, not run. Left open by A798-B slice 9b, Task 15.

## AEAT's time outranks the devices.

AEAT agreeing with the box restarts payments even if two
  devices disagree (the bell still shows their `clock.disagrees`); AEAT disagreeing blocks the
  devices and an administrator until the stop ends or the box next sets its clock (a set the box
  verifies, or that moves the clock by more than a second, empties the stored readings,
  `apps/server/src/clock-correction.ts`). Since slice 9b the box sets its clock from
  AEAT's disagreeing time itself, and an administrator's set is refused `witnessed`. The disagreement is kept in memory,
  so restarting the server forgets it (kept that way: owner, 2026-11-06, under Decisions). Slice 8's own ways out remain: the clock put right, or real
  time passing the record. The owner may prefer it to lapse at a step (owner FYI 6). Left open by A798-B slice 9 (#2025).

## `clock_stop_restarts` is written by nothing: drop it, and its two backup-check links, when A1308 rewrites the starting migrations.

A760 kept every table's shape, so the table survived the squash; A1308's slices edit the starting
migrations ([design](../superpowers/specs/2026-11-02-rationalisation/README.md)).

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

With a date that early the box cannot check a mail server's certificate (`CERT_NOT_YET_VALID`,
slice 10 plan P8). That failure comes before the email is handed over, so the queue retries it on
the box alert waits for a day, by the box's own clock; once the clock is set right the email is past
its day and is dropped unsent. The alert stays in the bell. A plain relay or the practice box's
local capture does receive it. For the owner to know. Read, not run: no TLS relay with a
future-dated certificate was used in 3b-ii.

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
  owner. Raised by A798-B slice 5's plan. The Servers screen's handover strings (`servers.handover_*`) call the
  boxes «equipo» («este equipo», «el de reserva», «los dos equipos») and its guide
  (`apps/server/src/guide/es/servers.md`) says «equipo de reserva», while the same screen's
  `servers.intro` says «servidor en espera» and the handover page and the setup app say «servidor»
  (A1466), except the setup app's start-up messages `shell.first_setup.workspace_unsupported`,
  `disk_full` and `disk_full_restart_unknown` and its configuration-import messages
  `shell.configuration.outdated` and `shell.configuration.privacy_*`
  (`apps/setup/src/i18n/strings/shell.ts`), which still say «equipo».

## A798-B. Build "degraded but trading": what the box does, and tells staff, when a part fails but it can still sell.

Design revision 7 (2026-10-24); every owner question answered except one the slice 9b outline
  keeps for when 9b is planned. The remaining build follows the design's §8 slices:
  [plan](../superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md),
  [design](../superpowers/specs/2026-10-19-a798-degraded-trading-design.md).

Two slices from those answers are open, each its own pull request: 9b, the box sets its own clock from a confirmed source and watches its time service ([plan](../superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md)), built and parked for the owner as #2331; and 9c, a clock check at every start and after every change of the clock, with selling stopped while it waits ([outline](../superpowers/plans/2026-10-24-a798-9c-clock-check-at-start-and-change.md)). Open asesor questions:
  [Q51](../compliance/asesor-questions.md#q51-a-chain-whose-record-times-step-back-once-when-the-boxs-clock-is-confirmed-added-2026-10-21-revised-2026-10-24),
  [Q52](../compliance/asesor-questions.md#q52-sales-recorded-under-a-restart-whose-clock-later-proved-wrong-added-2026-10-21),
  [Q60](../compliance/asesor-questions.md#q60-sales-dated-later-than-the-real-time-by-a-clock-that-ran-ahead-added-2026-10-24)
  and, from slice 9b,
  [Q61](../compliance/asesor-questions.md#q61-a-system-that-corrects-its-own-clock-from-a-tills-clock-when-it-has-no-internet-added-2026-11-01).

## A1187 part 1: what its reviews left open

Part 1 of the recovery pack (design: [A1187](../superpowers/specs/2026-10-29-a1187-one-recovery-pack-design.md))
landed in pull requests from #2250 to setup's first pack (PR E). What their reviews left, by the
pull request that left it:

- **#2250 (the pack format and its readers).** `waitron-restore`'s usage line still says
  `<pack-file>` for `--from-archive`, which a test pins. The restore command's refusals for a file
  holding no kit or no archive pack still name the kit file and the archive recovery pack file,
  which tests pin word for word, where both forms now take the pack PDF. Setup's pack refusals say
  "paste the code" where the field's help says "paste the kit".
- **#2263 (the server makes and records the pack).** The encrypted-connection check is copied across
  several routes; `promote-api.ts` still answers a plain-HTTP or cross-site request with
  `authorization.not_permitted`, the answer the plan calls untruthful. The archive code, the
  backup-key check, the bucket recovery kit, the server key's name and the created date are each
  built twice, once in an older route and once for the pack. PR D removed the older routes in
  `backup-api.ts`, `stream-api.ts` and `recovery-document-api.ts`. The old recovery sheet's
  renderer (`packages/fiscal-verifactu/src/recovery-pdf-content.ts`) still draws the key's name and
  created date; since PR E only tests and `packages/fiscal-verifactu/test/recovery-pdf-node-runner.ts`
  call it, and it stays because the reader's tests draw old sheets with it.
- **#2274 (the Backups card).** The card's "ready" line dates a just-made pack from the browser's
  clock until the next status read names it; it is wrong only when the browser's clock and the
  box's fall on different days in the venue's zone. The card and the fresh sign-in widget read the
  pack status and the person's profile with their own read counters, and the Backups screen pokes
  the card after each write, where the dashboard's live queries (`DashboardQueries`,
  `apps/dashboard/src/api/live-queries.ts`) could keep both current. A pack whose receipt the box confirmed after the card left the page, or after the
  person lost `system.manage`, is counted received though no link to it was offered. So is an older
  pack whose receipt lands while a newer pack's link is on offer, unless it holds the newest server
  key the card was handed.

## A1323. One master key for the venue

- **Asked for (owner, 2026-11-04):** "ideally we'd just have one master key which unlocks everything".
- **What it replaces.** Today the owner's pack holds a backup key, which encrypts archives and sits readable on the box, and a server key, which unlocks nothing and authorises restore, promotion and an invoice identity conflict. The box keeps only a check value of the server key.
- **Why the box's working keys stay.** The box restarts unattended and needs its vault key for every payment, email and filing, so a master key cannot be one of them: stealing the box would then give the thief the master key.
- **Proposal.** The box makes the master key at setup and prints it in the pack, keeping only a check value. Backup key N is calculated one-way from the master key and N, and each backup records its N. Changing the backup key means typing the master key once and needs no new pack, and one master key opens every backup. A new master key is needed only if it is lost or exposed; older backups then need the older one.
- **Decided (owner, 2026-11-04): seal the box's secrets to the master key.** Anyone holding a backup key can read an archive, take the vault key out of it, and so reach the AEAT certificate and the provider logins. They could also rebuild an archive with their own check value (reasoned, not tested). So the box seals its secrets using a public key whose private half only the master key can calculate: it can write that packet and never read it back. A backup-key holder then gets the business data but no certificate. No check inside the software can do the same, because someone running their own modified copy skips it.
- **What that costs.** The box can no longer test-open the packet (`apps/server/src/backup-verification-secrets.ts` does today). A1188's emergency start has no master key on the night, so it would need a second packet sealed for Waitron Cloud, made only when the owner switches emergency start on. `node_sealed_state`, which travels in the bucket copy, changes the same way.
- **What goes.** "Paste my own key", because the key must be long and random; the backup key's "Show the current key"; the two restore codes shrink to bucket details.
- **What stays separate.** Each person's sign-ins, outside-service logins (they come back from the backup), the export passphrase, the Cloud emergency code, and probably the disk key, which the installer makes first (not confirmed).
