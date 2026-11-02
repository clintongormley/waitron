> 2026-10-29, A1206: the start-again note is retired; §"The start-again floor must survive a rollback" no longer applies.

**Execution authority, 29 October 2026:** the owner subsequently approved the complete implementation plan (option A), one eligible cut per pull request. This supersedes the pending-plan statements below; every prerequisite and real qualification gate remains. See the [plan](../plans/2026-10-29-a950-automatic-upgrades.md).

<a id="a950-automatic-app-upgrades-with-a-recoverable-trial"></a>

# A950: automatic app upgrades with rollback until a clean, running restart

**DESIGN APPROVED, 29 October 2026. The implementation plan awaits owner approval.
No build authority is recorded here.**
You need the box to update without losing yesterday's records or tonight's work. The
approved updater design keeps the complete stopped state and exact previous images while it checks
the new version. Rollback closes automatically after a successful restart, a clean database
upgrade and confirmation that the system is running and answering. Normal work then resumes.
Rolling back keeps you trading; it does not fix the failed release. A950 is required before
go-live, by the owner's 21 October decision.

**Dated supersession, 28 October:** the owner's answer replaces the earlier first-order and
first-real-action boundaries, including any healthy READY wait or acceptance step. It settles
the closing rule. The later 28 October instruction requires a local closed period, after close,
reports and backup, ending before reopening.

**Dated supersession, 29 October:** asked to approve the complete revision at `c0fbcd888`, the
owner answered “Default the hours to 3-5, so upgrades are on by default.” Lane E's
`questions.md`, “OWNER ANSWER (2026-10-29 ~02:00 CET)”, relays whole-design approval with that
change. Every venue starts automatic-on with an editable **03:00–05:00 local** window.
This replaces waiting for an initial administrator selection. An administrator can still
explicitly clear both saved hours; that unset choice blocks automatic and manual application
while verified downloads and sales continue. Restarting preserves it rather than reinstalling
the default. Pause remains the separate switch and keeps the saved hours. All other design contracts, including the former **my call**
choices, are approved. The [implementation plan](../plans/2026-10-29-a950-automatic-upgrades.md)
needs owner approval before any build. Historical source tables and quotations remain evidence
of their dated inspections only. All A950 runtime qualification remains **UNVERIFIED / NOT RUN**.

## 1. Contracts and evidence status

The plan linked above describes how to build this approved design. It changes no fiscal hash, chain, allocation,
invoice writer or installation name. An ordinary upgrade continues the same node, keys,
SIF, series, next number and fiscal/workforce heads. It performs no setup, restore-as-new or
promotion. The ahead-of-image guard stays: rollback means the matching old complete state **and** old image, never an old image over migrated data or a downgrade
bypass. A release requiring a new installation name is an exceptional separately authorised
operation, outside automatic app updates.

Read together:

- [B3 approved-with-changes design](2026-10-21-b3-usb-installer-design.md), §§6, 7.4,
  7.5, 8 and 14; [B3 plan](../plans/2026-10-26-b3-usb-installer.md), Global Constraints
  and execution gates. Its six planned slices exclude slice 7 daily release polling;
  A950 must obtain separate build authority for that integration. B3 remains a separate prerequisite.
- [A947 two-box design](2026-10-21-a947-two-box-failover-design.md), §§3, 5–8:
  waiting spare, single primary, fencing and explicit takeover stay authoritative.
- [A799 historical upgrade design](2026-10-19-a799-real-database-upgrade-testing-design.md)
  and [plan](../plans/2026-10-22-a799-real-upgrade-testing.md), current approval addenda,
  capture/preservation/new-sale contracts; [actual harness status](../../../bench/real-upgrade/README.md).
  Its approved build authority does not approve A950. Real historical qualification precedes
  enabling automatic upgrades; a rollback facility cannot replace it.
- [A1016 and A1049](../../backlog/box.md): easy updating and off-box copies, and honouring
  a Cloud-held release. This design changes no Cloud service or support-retirement policy.

**Historical source inventory: READ ONLY at `9d5853c310e691ed558d80a8a12d0dbddccab2e7`.**
The following anchors describe source inspected at that SHA, not today's tree or executed
behaviour. Later source changes do not upgrade this inventory into runtime evidence. Every
runtime consequence is UNVERIFIED. No A950 Linux, VM, Docker, TPM, btrfs, power-cut, bucket or
two-box qualification has run. The driver ran `docker info --format '{{.ServerVersion}}'`
on 27 October; it exited 1 because `/Users/clintongormley/.docker/run/docker.sock` was absent.
That is a host availability result, not a rollback experiment.

| Inspected anchor | What the source says; design consequence |
| --- | --- |
| `deploy/waitron.sh:659`, `:672`, `:676`, `:684`, `:685` | Install fetches box files, selects images, brings Compose up, then deletes previous images after health. This path contains no whole-state capture or trial gate. It cannot be reused unchanged. |
| `deploy/waitron.sh:597`, `:627`, `:640` | Health polling defaults to 36 attempts, 5 seconds apart; previous app/agent image IDs are collected and deletion attempted. These are source defaults, not measured outage times or image-retention guarantees. |
| `deploy/compose.yml:42`, `:61`, `:91`, `:143`, `:174` | App mounts state/logs/backups; health accepts either health or setup status; mailpit and print-agent have their own writable volumes. Inventory every mounted writer, not just the app database. |
| `apps/server/src/node-entry.ts:250`, `:571`, `:577`, `:583`; `packages/provisioning/src/schema-ahead.ts:44` | Entry takes the venue hold, checks unknown migration hashes, then starts the server. The domain refusal is `provisioning.database_ahead`. |
| `apps/server/src/boot.ts:961`, `:979`, `:988`, `:1002`, `:1640` | Migration and append-only checks precede the mirror/fence HTTP gate. Blocking HTTP writes, a mirror role or a read-only inspection connection does not prevent boot migrations. |
| `apps/server/src/health.ts:145`, `:166`; `apps/server/src/boot.ts:2831` | Health judges duty freshness and reports stream status separately. A non-primary can advance an empty pass. This is not the proposed upgrade-readiness proof. |
| `apps/server/src/boot.ts:1841`, `:1859`, `:1884`, `:1910`, `:2237`, `:2255`, `:2272`, `:2304`, `:2812`, `:2881`, `:2935`, `:2964`, `:2972` | Attendance, emails, reminders, backup/sealed-state/stream work, fiscal drain, cards/refunds and Cloud work have startup paths. Trial needs an explicit inventory and gate for every duty, including future webhooks and spare following. |
| `apps/server/src/stream-host.ts:140`, `:156`, `:192`; `packages/stream/src/supervisor.ts:405`, `:428`, `:441`, `:458`; `packages/stream/src/litestream.ts:13` | At that SHA the host constructs a supervisor with node/term/settings; opening claims a fresh generation, starts replication and conditionally moves a pointer after a full copy. Pin is Litestream 0.5.17. An arbitrary old prefix is not a proven rollback/resume interface. |
| `packages/provisioning/src/first-setup-start-again-note.ts:23`, `:51`, `:57`, `:73`; `packages/provisioning/src/first-setup-start-again-leftovers.ts:245` | At that SHA the note requires a nonempty known name/module, raises only to a later floor, and supplies a floor source. It does not establish A1099's future name/damage-unknown representation. |
| `packages/store/src/venue-lock.ts:55`, `:78`; `apps/server/src/recovery-lock.ts:21`; `apps/server/src/recovery-state.ts:229` | Venue and recovery locks have owners; recovery state has an update helper. No unlinking locks or writing `recovery.json` directly belongs in an updater. |
| `bench/real-upgrade/index.json:1`; `bench/real-upgrade/README.md:1` | Qualification index has no fixtures/epoch. Cuts 1–3 use metadata/comparison/injected admission interfaces. No historical image, issued-F1 preservation or real upgrade is qualified by this source read. |

The only outside facts used here have deliberately small bounds:

| Source, accessed 2026-10-27 | Exact quotation | Paraphrase and limit |
| --- | --- | --- |
| [Btrfs Subvolumes, Nested subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html#nested-subvolumes) | “snapshotting is not recursive” | Nested subvolumes need explicit inventory. This does not qualify Docker mount replacement or encrypted-disk behaviour. |
| [Btrfs Subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html) | “A snapshot is not a backup” | A local rollback point does not replace a copy off the box. No performance, capacity or power-loss durability claim follows. |

<a id="2-the-one-owner-question-which-use-closes-rollback"></a>

## 2. Resolved owner boundary: a clean restart and a running system

The owner's 28 October answer is: “After a successful restart of the new version we can
assume that the upgrade is ok. We just want to be sure that the database has upgraded cleanly.”
The addition is: “And that we have a running system.” The receipt is Lane E's local
`questions.md`, lines 743–752, relayed at about 01:50–01:52 CET. These are owner instructions,
not an outside technical claim. Whole-design approval is recorded separately above.

Rollback therefore ends only when **all three** hold for this attempt: the new version has
successfully restarted, its database upgrade is confirmed clean, and fresh local checks
confirm that the system is up and answering. Section 5 specifies the evidence for those checks;
none has been runtime-qualified for A950. The host durably closes rollback before releasing
normal requests and duties. No first order, first real change, scheduled action or owner
acceptance click closes it. There is no healthy reversible version waiting for morning.

For example, Harbour Kitchen has finished service and meets the approved quiet-window checks
at 06:50, inside its administrator-chosen window after the day’s close, reports and backup
have completed (§3). The host stops all writers, saves the complete state and starts the new
version in validation mode. At 06:52 the packaged migrations, database preservation checks and fresh local
TLS/menu/config/history responses all pass. These times illustrate the sequence, not measured
durations. The host records rollback closed and releases normal work immediately. Queued
filing and qualified backup publication can resume at 06:52 without waiting for Ana to arrive.
At 08:00 Ana signs in, clocks in and changes her PIN normally; the first order has no update role.

If migration or local running checks fail **before** closure, the host restores the matching
old state and images and checks the old service before reopening it. If the new version fails
at 07:10 **after** closure, it keeps the current state and needs repair of that state. It cannot
restore the 06:50 snapshot, even if no order has yet been taken. Otherwise it could erase work
or external effects already acknowledged after closure. A bucket, Cloud, internet or provider
outage cannot postpone closure when the local checks pass, and cannot block ordinary sales.
Their own retry, publication and membership rules still apply.

## 3. Scheduling without putting a release server on the sale path

**Approved design:** automatic app updates are on by default for qualified stick-installed
boxes. Every venue starts with an editable **03:00–05:00 local** window in its named time zone;
no initial administrator selection is required. The default does not prove the venue is closed
or waive close/report/backup, quiet or qualification gates. You can pause automation or choose
Update now; manual application meets the same window, close/report/backup, time-budget and quiet
checks. You can still save both hours empty to leave the window unset. A partial or invalid
window cannot be saved; an explicit unset window blocks both application paths until you save
valid hours. Defaults initialise missing first settings only and never overwrite that choice.
No hours are inferred from opening hours or inactivity. No version-age policy disables
sales. Off-box backup defaults and commercial support ages remain A1016 decisions.

The saved end is your **latest reopening boundary**: admission must reserve enough time to restore normal work before it.
Choose a period you intend the venue to be closed, with room for late reports, backups and the
full trial plus rollback. The setting does not close the venue or prevent earlier real work.
If you reopen early, new work invalidates readiness and defers an attempt not yet frozen.
An unsaved preview grants no authority. Required start/end use local HH:MM and the venue's named
time zone; show the next dated occurrence and its UTC instants before Save. Equal times are
invalid, not an all-day window. An end earlier than the start means the following civil date.

### What the timeline can say from today's source

**Additional source-only inspection at HEAD `288213aef2b66189480c341954dc7dfaea256fdd`,
28 October 2026.** These anchors supplement, and do not replace or refresh, §1's historical
inventory. No scheduler, reporting, archival or A950 runtime operation was executed.

| Inspected anchor at this HEAD | Source rule and limit |
| --- | --- |
| `packages/reporting/src/business-day.ts:112`, `:157`, `:209`, `:221`; `apps/server/src/business-day-start.ts:76`; `apps/server/src/business-day-changeover.ts:30` | Reports resolve the node's location time zone and dated cutovers. Business-day labels/bounds differ from civil midnight; the settings model exposes current day, revision and pending change. These functions do not produce a report at rollover. |
| `packages/reporting/src/daily-close.ts:15`; `apps/server/src/report-api.ts:295`, `:382`; `packages/reporting/src/record-daily-close.ts:32`, `:68`, `:81`; `apps/server/scripts/daily-close-z-demo.ts:186` | The GET computes a day's figures on demand; category printing queues a job and returns 202. The separate frozen-close function appends a snapshot and chain head in its caller's transaction. `rg -n 'recordDailyClose\(|computeDailyClose\(' packages apps --glob '*.ts' --glob '!*.test.ts'` found its call in the demo, not a production app close workflow. Do not claim a scheduled frozen close or reports produced at rollover. |
| `packages/venue-service/src/service.ts:131`; `apps/server/src/boot.ts:1702`, `:2836`, `:2846` | The service contribution exposes operational seats; the inspected scheduled `runDue` call runs the reconciliation duty. Neither supplies a daily report-completion receipt. Any actual service/reporting job used for admission must be inventoried by its real producer and outcome, not inferred from this generic scheduler. |
| `apps/server/src/backup-config.ts:51`, `:86`, `:274`, `:303`; `apps/server/src/backup-schedule.ts:54`, `:60` | Environment scheduling supports interval or wall-clock daily/selected weekdays; wall-clock `auto` is the dated business-day boundary +30 minutes + stable seed jitter of 0–10 minutes. Fixed local HH:MM and interval alternatives differ. Environment without a destination, or dashboard without a sealed record, supplies no archive duty; a switched-off record stays off. |
| `apps/server/src/backup-sweep.ts:122`, `:181`, `:208`, `:268`; `apps/server/src/backup-supervisor.ts:210`, `:265`, `:286`, `:355` | A sweep copies immediately on startup, then schedules. A cycle's next due instant stays fixed while it waits, even after a clock edit. `runOnce` settles destination calls separately: a resolved promise can include failed uploads; `onUploaded` precedes pruning, and callbacks can outlive a stopped sweep. The supervisor filters aborted callbacks, gates archives on the singleton `primary` role and keeps per-sweep outcomes, not day-bound durable update authority. |
| `apps/server/src/boot.ts:2209`, `:2223`, `:2230`, `:2971`; `apps/server/src/cloud-snapshot-worker.ts:134`, `:166`, `:196` | Archives use the node seed/clock and expose the actual scheduled deadline. Cloud retained snapshots have a separate primary/service/test-environment gate and publication path; they are not automatically a production archive substitute. |

Read alongside the [archive settings reference](../../../apps/server/README.md#backup-archive-settings),
[backup operations guide](../../operations/backups-and-support.md),
[backup recovery guide](../../../apps/server/src/guide/en/backup-recovery.md#proof) and
[business-day writing rules](../../developers/conventions-data.md). These guides describe settings
and recovery, not a daily close scheduler. The current backup selector's wording “after close
and the day's reports” (`apps/dashboard/src/i18n/strings.ts:1780`) is not evidence of a dependency:
`nextFireMs` uses the clock, not close/report results. A950 must show the actual rule above.

### Completion means this closed day, on the actual primary

**Approved design:** obtain durable completion receipts from qualified close/report and backup
producers. These are new contracts, not existing status booleans. Producer receipts carry venue/location,
actual primary node and membership term, closed business-day label D and resolved UTC bounds,
close episode ID, relevant input/data generation, producer settings revisions (report/job
inventory, backup destinations/key and clock with pending cutovers), run/output IDs and actual
start/completion instants. The host binds accepted receipts to the current window revision and
occurrence. Environment-owned settings need an effective-settings digest, not an invented
dashboard revision. Persist accepted evidence and its binding in `@host-state`;
a restart, delayed callback or status cache cannot create a success receipt.

A close receipt requires an explicit authorised confirmation that the venue has actually closed
for D, plus completion of its required report outputs for that same data generation. The
qualified close/report workflow declares that required output set; A950 cannot guess it from
installed modules or accept an absent/unknown declaration as an empty set. Ten idle
minutes, a closed station, midnight and rollover prove none of these. **For reports with no
scheduled job:** finish them on demand, then record close/report completion through an
authenticated workflow bound to those outputs. Show “On close; no fixed scheduled time” until
there is an actual completion time. Merely opening a live Sales report is not a frozen close.
Where a frozen close is required, use its real committed record; its absent production workflow
is an integration/qualification gate, not permission for A950 to invent one or synthesize a row.
Disabled/unavailable required reporting defers application. An empty scheduled-job inventory can
say “No scheduled report jobs”; it cannot say “Reports complete” or waive actual close/reporting.
No new daily report scheduler is proposed. Until the qualified receipt producer exists, defer.

For configured service/reporting workflows, enumerate all closing jobs required for D, including
print/delivery work when part of that workflow. Require their terminal successful results; queued,
started, failed, overdue, missing and unknown outcomes are not complete. A cancelled/disabled job
cannot disappear from the accepted inventory mid-attempt. Work that is unrelated to closing still
meets the quiet checks below. No updater cancellation makes a late job fit.

**Approved backup contract:** require a completed archive captured after the accepted close/report
outputs, covering their committed data, stored successfully at every enabled configured archive
destination, with the whole run and its cleanup settled. Record artifact identity/digest,
capture point and per-destination storage/pruning outcomes under the same effective settings.
A pruning failure is visible and defers this attempt; an early upload callback, recent object
mtime, generic freshness, timer firing or `runOnce` resolving is insufficient. A scheduled copy
captured before reports finished cannot authorize this close episode. Wait for a later qualified
run; do not silently reschedule backups or start an extra one. Show fixed weekdays or interval
next due as configured, even if it is outside this update window.

Disabled, unconfigured, unreadable or unavailable backups defer **both manual and automatic**
application, with a link to Backups and a reason. There is no “disabled means complete” waiver,
and the local rollback snapshot or continuous bucket stream does not substitute for this archive.
The administrator can configure backups and wait for a real qualifying result, change the window,
or leave the current version running. This does not settle A1016's off-box default. A remote
backup outage defers updates only; it never gates ordinary sales or cancels backup/report work.

D is the trading day being closed, selected from the actual close episode, not “the most recent
close row”. After rollover D may be yesterday's label; it remains eligible only for that same
unbroken closed episode and window occurrence, with no later business work. An older day's
receipt cannot authorize today's closure, and rollover never creates a close for D+1. Reopening,
a new business mutation affecting the close/archive inputs, a new closing job, settings change
or membership change invalidates readiness. Revalidate the producer evidence and make a fresh
admission binding; reuse an existing output only if its own day, inputs and producer settings
still match. Never relabel an old output or claim it ran under newer producer settings. Readiness is not a permission that survives a later day's service.

### Waiting, final admission and clock changes

At window start, wait with the current version serving normally until the actual close/report
AND backup receipts are complete. The window may overlap them; that is a wait, not a failure or
an instruction to stop them. When results arrive, require the quiet checks below and the full
remaining budgets before freeze. Late, failed, missing or unknown results skip this occurrence
when time runs out. Record the specific reason and next eligible window, not “update failed”.
No queued automatic freeze is carried into reopening or the next occurrence.

In the final admission turn, serialize with new work, report/backup starts, settings edits and
membership changes. Re-read all receipt bindings, current data generation, actual outstanding
jobs, actual scheduled deadlines, quiet state, resolved window and remaining time under the same
fence before any shutdown. A due job racing that turn wins or makes admission defer; a success
from a replaced run cannot win it. Keep the fence through stopped capture. A change before
candidate launch cancels admission and rechecks the intact old service; after candidate launch,
follow §§5–6's bounded trial/rollback and durable closure rules, never a live settings rewrite.

Any accepted time-zone, business-day-start (including pending-change activation), report/backup
settings or window edit invalidates a pending occurrence/receipt binding. Respect the venue
editor's existing restrictions; A950 grants no new right to change history or time zones.
Recompute and show dated labels and actual worker deadlines, which may still reflect the old
clock until the next backup cycle; do not promise an immediate backup move. Require a fresh
review/save of the update window after a clock change before application resumes, without
restarting report or backup jobs merely to obtain a new receipt.

**Approved design:** a cross-midnight window is one occurrence identified by its local start date,
zone and saved settings generation. Resolve both endpoints to UTC. If either local endpoint is
missing or repeated at a daylight-saving change, skip that occurrence with an explanation; do
not pick one offset silently. An internal offset change with unique endpoints uses the real
elapsed time. Persist one attempt per box within the coordinated occurrence and one active box
attempt at a time, across restarts, clock jumps and settings revisions. An edit cannot mint a
second attempt for the same close episode or overlapping period, or reset the daily allowance. A backward jump cannot
reopen a consumed occurrence; an uncertain clock or a forward jump leaving too little time
defers. Expired windows cannot acquire freeze authority.

For example only, in **Europe/Madrid (UTC+01:00)** D **2026-10-28** runs from 28 October
06:00 until 29 October 06:00; D+1 starts then. On 29 October the venue closes at 01:15,
reports finish on demand at 01:45, and the administrator's saved closed window is **01:30–08:00**,
with **08:00 the explicit next reopening boundary**. The selected archive schedule is daily
`auto`: due **06:37** in this example (+30 minutes, example stable jitter +7), initially Pending;
at **06:45** all configured stores, pruning and cleanup are confirmed complete for D's close.
Admission may then proceed only with every remaining check and budget. If it is still running
or uncertain at the latest safe start, skip the update and let it finish. These are example
settings/statuses, neither defaults nor measured durations. The timeline shows scheduled, actual
and unknown times separately; §8's EN/ES settings brief gives the exact illustration copy.

The planned host service checks B3's signed release manifest daily with jitter, verifies
signatures against its embedded current/spare public keys, platform, minimum host protocol,
source and immutable app/agent/dependency digests. A1049 adds a fresh authenticated Cloud hold
answer bound to that exact release; unknown/stale/unavailable status defers offering/applying
it. A venue with no Cloud account still needs a qualified account-free hold-check contract;
none is promised here. Recheck immediately before freezing; an authenticated hold for this
release received during validation cancels it while rollback is open. Closing does not wait for another external hold
roundtrip. A hold arriving after closure blocks future attempts, never orders or a forced downgrade.

Download and verify while the current version trades. A failed manifest, hold check, download,
status query or lack of disk space leaves that service running. No synchronously fetched
release/hold answer belongs in an ordinary sale request. An explicitly paused box keeps trading
and sees a version/backup warning, with no invented support expiry.

Require ten minutes without new work and, under a shared admission fence, no active/held orders,
unsettled bills, in-flight requests, reader authorisation/capture, Stripe reconciliation,
pending/unknown refunds, printing/drawer delivery, restore/reset/setup, membership change,
host/network change or conflicting update. Drain already-started effects to a known outcome
within their own deadlines; an unknown answer defers. Do not cancel money, report or backup
work to make a quiet window. Pending unsent fiscal/email work may be frozen, not sent during trial. A failed ability
to determine quiet status defers the upgrade, not current service. The fence stops a fresh order
slipping between the final check and shutdown; a request already admitted makes that attempt defer.

**Approved budgets:** release/download checks get three bounded attempts per daily check,
30-second metadata/hold attempts and 10-minute image attempts; no freeze before completion.
Freeze/drain gets two minutes, migration/readiness five minutes and restoration/old-readiness
five minutes each. Require strictly more than the full 17-minute total before freeze against
the saved end/reopening boundary, using elapsed time; include shutdown/capture and journal/closure/release within the
qualified phase bounds, not unbounded extras. If this cannot be bounded, defer. This reserve is
an admission requirement, not a promise of recovery by opening after a fault or power cut.
Successful checks trigger closure immediately, even with nobody present. Crossing the window never
reopens closed rollback or starts a second attempt while one is unfinished.
Measure and review these limits before enabling them. An expired phase never implies success
or permits killing an effect with an unknown result. One failed candidate digest is quarantined
after one trial; no nightly failure loop. A newer fixed digest is eligible next window. An admin
may explicitly retry the same digest in a later eligible occurrence after seeing its recorded
cause and meeting the same checks, without a promise that retry fixes it. Cleanup failure
retains evidence and prevents another attempt.

## 4. Capture the complete state and retain the previous release

Use exactly B3's encrypted five-subvolume layout; there is no sixth storage root:

| B3 area | Proposed upgrade handling |
| --- | --- |
| `@rootfs` | Host OS/runtime. App updates do not roll it back. Host/boot updates are separate (§9). |
| `@images` | Keep old/new app, agent and required sidecar images by verified immutable platform digest. Retain labelled stopped container references for each required old image, plus a root-owned release inventory. Tags alone are insufficient as the retention contract. |
| `@volumes` | Capture/restore all inventoried persistent app and companion volumes as one stopped set, including state, node/venue databases and side files, config, TLS/vault, queues, backups, mailpit and agent state. |
| `@logs` | Remain mounted independently. Preserve failed-trial and rollback logs. Container stdout must also reach retained bounded diagnostics outside replaced containers. |
| `@host-state` | Root-only updater journal, admission/no-return marker, immutable attempt metadata, recovery evidence and floor overlay. Preserve B3's retained disk-key/UUID record and physical recovery identity. Never restore this area from an OS/venue snapshot. |

B3 §6's historical “by its tag” sentence is not the retention mechanism proposed here. Before
stopping service, prove old images are locally launchable without registry access, capture exact
Compose/env/profile compatibility inputs, and retain their protected references. Updater-owned
cleanup must exclude them and prohibit prune/remove operations that invalidate a live rollback
set. Qualify the selected Docker/containerd store against retention and its supported cleanup
paths. An arbitrary host-root prune can defeat this protection; it is not promised survivable.
Never free space by deleting shared/unowned images, volumes, containers or caches.

Stop **all** writers: app/entry recovery work, print-agent, mailpit, Litestream, archive workers,
spare follower/store writers and host operations that touch captured state. Disable automatic
container restart during the fenced operation. Await clean shutdown and recorded child exits;
forced termination, incomplete shutdown or a remaining writer invalidates capture. Take the real
venue/recovery coordination holds through their APIs. Snapshot acquisition and later replacement
need a host maintenance fence too: a lock in a replaced tree alone cannot exclude another start.
Retain lock files and reacquire ownership on the restored tree; never unlink them to proceed.

Inspect actual mounts/subvolumes and Docker storage paths. Reject unexpected nested subvolumes,
bind mounts or data roots unless separately captured in the stopped set. Explicitly exclude
`@logs`/`@host-state` with checked mount identities; refuse absent/wrong mounts rather than writing
underlying `@rootfs` directories. Snapshot `@volumes` read-only and record its identity, complete
inventory and release binding before launching candidate code. Check integrity and matching WAL/
journal set without deleting side files. No promise of size-independent timing is made.

**Approved design:** keep one rollback set and one active attempt, plus bounded failed-attempt evidence.
Do not delete the rollback set to make its candidate fit. Disk-full during pull, journal write,
snapshot or readiness means defer or restore, according to the phase. Snapshot success does not
reserve enough blocks for migrations; preflight must measure data/metadata headroom and trial
must handle exhaustion. No reserved disk allocation is introduced. After closure the snapshot is
never offered as a rollback; remove only owned obsolete data after a durable completion record.

For a manually installed/non-B3 disk, **approved design:** defer automatic updates unless a separately
qualified stopped whole-state copy adapter provides the same inventory, capacity and atomic
restoration contract. Do not silently repartition it or call a database-only copy a substitute.
The historical install path (§1) supplies no A950 rollback contract; this design does not
qualify it.

### The start-again floor must survive a rollback

Before an attempt, the host preserves the newest valid start-again note and its provenance in
`@host-state`. Before any restoration it re-reads and durably merges newer observations under the
same operation fence. Restore the complete snapshot, then apply the monotonic overlay **before
any old entry, setup, recovery or series-name selection can run**. Use the released provisioning
helpers, not direct JSON replacement. An unchanged ordinary upgrade raises no floor and chooses
no name; overlay only prevents a restore from discarding evidence already acquired elsewhere.

For known notes choose the greater floor, retaining the associated name/module evidence. Equal
floors with conflicting evidence refuse automatic resolution. After **A1099's release**, preserve
its actual name-unknown and damage-unknown semantics as well: unknown is never converted to an
absent note or a lower known floor; a newer floor can be retained without inventing a historical
name, and damage remains an explicit blocker until that released contract resolves it. The
parser in the historical inventory does not supply that contract (§1); this says nothing about
today's implementation. Trace all readers/writers then qualify the overlay with both old and
new releases; an old parser that cannot honour the retained state is ineligible for automatic
rollback. Until that binding exists, do not enable this path.

Host recovery evidence likewise survives and remains distinct from snapshot `recovery.json`.
Reconcile app recovery state only through `updateRecoveryState` under its lock, retaining actual
refusal evidence; never clear refusal flags just to force the old app to trade. Restoring
`@volumes` cannot erase host intent, logs, the newer floor or B3's retained disk key/UUID.

## 5. Trial startup and the durable no-return interlock

The following checks and host protocol are **approved acceptance requirements, UNVERIFIED / NOT RUN**.
They implement the resolved owner boundary without authorising a build.

Add a dedicated upgrade-validation mode, checked at entry **before** recovery/reset/restore
effects, migrations or duty startup. It performs the candidate's real packaged migrations on
the active set captured in §4; a read-only SQL connection is only an inspection tool. Enumerate
allowed local migration/boot effects by field/cause. No business request, normal account/session
write, background business mutation, provider request or hardware action is admitted during
validation. Allow only the specified local migration, diagnostic and passive validation work.

Explicitly suppress fiscal filing/reconciliation, all card/refund recovery, drawer/printing,
mail/webhooks, scheduled activation, Cloud/tunnel renewal, archives, stream uploads/pruning/
pointer changes and spare following/copy-up. Check every enabled module's contributions and
every separate process. Defence includes withheld external capabilities/egress/hardware workers
as well as code gates; network denial alone must not make attempted effects look like a pass.
The candidate gets no Docker socket or general host/file-write API. Validation exceptions are
a closed list, not “all GETs”; last-seen or session renewal is still a write.

### Successful restart, clean database and running-system evidence

Bind every result to the same attempt, candidate image digest, fresh boot nonce, active tree/
snapshot identity, schema manifests, node/membership identity and admission generation. A stale
answer from the old process or another boot cannot complete this attempt. Require all of:

1. **Successful restart.** Launch the selected packaged image through its real entry and boot
   path, using the retained venue's actual configuration and enabled modules. Confirm this
   candidate owns the intended venue and reaches its normal service path in validation mode.
   A process exit code, container start or generic health result alone is insufficient.
2. **Clean database upgrade.** Run the real packaged enabled migration sets and their declared
   dependencies to completion. Compare recorded sets, hashes and endpoints with the candidate
   manifests: no pending/incomplete, unknown or ahead-of-image set is accepted, and retained
   disabled-module data stays intact. Under quiescence, require integrity checks to report
   clean and foreign-key checks to report no violations for each inventoried database. Confirm
   foreign-key enforcement is enabled. Compare required constraints, indexes and full append-only/protection definitions with the packaged
   expectations; matching a trigger name alone is insufficient. Through non-writing checks,
   compare against independently captured pre-upgrade evidence: node/tenant identity, keys,
   installation name/SIF, series and next-number allocations, fiscal records and chain heads,
   workforce history and heads, and other retained history. Permit only migration-declared
   schema/data transformations and enumerated local boot deltas; no unexplained loss, allocation
   advance, rewritten fiscal/workforce fact or silently refreshed expectation passes. This
   runtime comparison complements A799's historical release qualification; it does not replace it.
3. **Running and answering.** After migration and database checks, make fresh requests through
   the candidate's actual local TLS listener and normal passive till/dashboard read paths.
   Require representative menu, configuration and retained-history responses whose bodies match
   the retained venue and expected schema, with success bound to this same candidate/boot/attempt.
   Reject cached responses, redirects to setup/recovery, empty success placeholders and an
   unrelated listener. Use a narrowly scoped local validator capability for protected reads;
   it grants no business action and creates no normal login credential/session. No synthetic
   order, payment, fiscal record or forced staff sign-in is part of acceptance. Exact passive
   routes and capability binding must be qualified against the released APIs before enabling
   automation; inability to make these reads defers qualification rather than weakening checks.

Also confirm the expected primary/waiting role, unchanged signed membership, all validation
restrictions still in force and no attempted forbidden effect. Missing or uncertain evidence is
not a pass. Provider, internet, Cloud, bucket and peer availability are not running-system checks;
existing A947 membership authority remains a separate gate. Actual screen rendering and continued
sales are qualified on disposable release-test copies, never by a test sale in the venue.

### Automatic durable closure, then release

The host persists a versioned root-only journal on checked `@host-state`, with attempt ID,
disk UUID/layout, old/new digests, capture/subvolume identities, phase sequence, admission
generation, check bindings, window/close/report/backup receipt bindings from §3, floor evidence,
stream/spare heads and bounded redacted outcomes.
Unknown versions, mismatches, corruption or missing state after an attempt never mean idle.
Use serialized atomic publication with file and directory flushes and validated read-back;
the exact crash guarantees must be measured. Host requests authenticate the local caller and
fixed operation. A path, a server-provided person name or an unbound boolean grants no authority.

Once all fresh checks pass, **the host automatically writes and verifies ROLLBACK_CLOSED**,
bound to those results, before allowing any normal request or duty. A readiness result can be
transient while that write completes; it is not a healthy READY state awaiting first use, window
expiry or acceptance. The marker records successful checks and permanent closure, not permission
for a particular operation. There is no operation-triggered COMMIT_INTENT or acceptance button.

After confirmed closure, release the matching running generation into normal service. Staff
sign-in, clock-ins, settings/PIN changes, refunds, fiscal filing and backups are no longer held
by the updater. They retain their normal permissions, safety checks and qualified publication
protocols. Do not require a host roundtrip per ordinary operation. Bind the one-time release to
the checked boot/generation, reject stale releases, and re-establish that binding at process
startup from the durable journal. This prevents an old validation process or delayed response
opening another attempt; it is not a new continuing dependency for sales.

If completion is lost, query the durable attempt before releasing work or choosing restoration.
A confirmed ROLLBACK_CLOSED record forbids restoration even if power failed before release or
before anyone saw the completion screen. Recover the current candidate and repair forward.
Fresh startup checks may be needed, but cannot reopen rollback. If closure is positively absent
and containment is proven, lost/stale checks can be rerun within the original validation budget;
a failed check, candidate crash or exhausted budget uses the recorded rollback path. Do not
loop candidate restarts. If a closure write's
outcome is uncertain, keep work stopped and resolve the journal. Silence or an expired timer
never proves that restoration is allowed.

An explicit preclose return requires existing authenticated authority or narrowly scoped fresh
administrator proof checked without a venue write. Offer password/passkey and enrolled TOTP on
this screen; any challenge is short-lived host memory, grants only this control and creates no
normal login credential. Bind and qualify this against released identity APIs. If it requires
unqualified durable auth changes, hold that binding rather than exposing unauthenticated restore.
Automatic successful closure needs no administrator proof or owner click.

Serialize closure and rollback under the same host fence. Recheck this attempt's fresh results,
process ownership and membership inside that turn. If rollback wins, durably record
ROLLBACK_INTENT, reject closure and keep all admissions closed. Stop candidate writers, restore
the verified complete set plus old images/config, apply the floor/recovery overlay and check the
old service. If closure wins, every later return request reports it unavailable. Never restore
after ROLLBACK_CLOSED or overwrite acknowledged work. A newer membership stops stale restoration
or admission under A947 rather than letting the updater choose a primary.

Before any restored old service can accept work, durably record **RESTORED**, binding the verified
active tree, old checks and a new admission generation. This permanently retires this attempt's
restore permission. Release that old generation once; after a restart, consult RESTORED and
recheck/start the current tree. Never replace it again from the snapshot, including when a restore
completion answer was lost. Old-version work requires no per-operation host call either.

## 6. Crash and failure outcomes

Every phase below specifies planned host-journal state. Recovery is idempotent and records exact
substeps; partial replacement is never inferred complete from a directory name.

| Durable phase when interrupted | Required recovery outcome |
| --- | --- |
| PREPARED: verified downloads/old references, old app still trading | Revalidate inputs/holds/window later. Never restore an earlier state over the still-running old app. |
| FREEZING: admissions closed, shutdown/capture incomplete | Keep admissions closed while ownership is uncertain. Establish all writers stopped; if no candidate ran, reopen the intact old state only after local checks. Forced shutdown invalidates that capture. |
| SNAPSHOT_READY | Verify complete capture and old references. Continue bounded validation or restore the old set; no unrecorded candidate boot. |
| VALIDATING, including transient successful check results | No normal work yet. With positive evidence that closure is absent and containment held, rerun lost checks on the still-running candidate within the original budget. Record ROLLBACK_INTENT on failed checks, candidate crash or timeout. Never wait for a real operation or extend a healthy reversible state overnight. |
| ROLLBACK_CLOSED: checks passed and closure durable, release may be unacknowledged | Never restore, even before first work. Rebind/start the current candidate, release normal work when its startup checks permit, and repair forward on failure. A lost completion answer cannot reopen rollback. |
| LIVE: closure durable, matching generation released | Normal service and duties. Keep current state on failure; a separately qualified repair/new attempt starts from this current state. No reset/downgrade advice. |
| ROLLBACK_INTENT: admissions closed | Resume only recorded restore substeps with all writers stopped. Preserve the failed tree until replacement/overlay/old checks are proven; never start a mixed set. Closure cannot now win. |
| RESTORED: exact old set verified, restore permission retired | Recheck/start the current old tree and preserve attempt/log evidence and overlay. A cut before completion cannot trigger another stale restore after the old service has accepted work. |
| Unknown/missing/corrupt/conflicting journal, changed disk or newer membership | No automatic restoration or trading admission on that uncertain boot. Show inspection/recovery choices and Stop. Re-read authoritative host/disk/membership evidence; never guess “nothing happened”. |

Disk-full before freeze leaves current service alone. During validation, stop the candidate and
restore only when capture, journal and positive evidence of an open rollback are intact. Failure
to durably close rollback admits zero work. An uncertain write keeps the stop until its outcome
is established; do not infer permission to restore. A durable closure followed by disk-full
requires repair of current state. Restore/mount/journal failure leaves the host recovery screen,
not an empty venue. Do not delete unknown files, locks or shared images to make recovery fit.

## 7. Bucket continuity and two local boxes

**No candidate state is published or followed off the box before closure.** Before capture stop the publisher and
record the last authoritative pointer/ETag, generation, node/term and observed data head. Freeze
spare follow, store mutations and offsite mirroring/deletion for this attempt; retain the last
consistent spare database and its store. Do not overwrite them with migrated trial bytes or
prune their generations. The freeze is intentional protection unavailability, shown explicitly.

Supervisor opening in the historical inventory (§1) does not qualify resuming an old local
LTX/WAL position under a newer image. **Approved design:** use a fresh generation prefix after closure, and after rollback
if continuity has not been independently qualified for that exact restored set/version. No
in-place rewrite/reuse of a published prefix. At the same node/term, qualify the actual 0.5.17
adapter, full-copy readiness and conditional pointer handoff, including crash/retry. A new
generation is a backup namespace, not a new fiscal chain or membership term.

Keep the old published head/prefix and frozen spare data until the new full copy is verified
and the pointer's compare-and-swap against the recorded authority succeeds. Candidate trial
objects cannot become a restore source. Restore selection must validate signed membership,
pointer and complete generation; no “newest object wins” or shared-prefix merge. A changed
ETag or newer term cancels handoff and requires reconciliation, never overwriting newer authority.
Qualify exclusion from both local pruning and A947's deletion-mirroring; keeping just a pointer
is insufficient if another process deletes its objects.

After local closure, a bucket/spare outage leaves the local version trading with a clear copy
warning. Publication waits/retries with bounded backoff while retaining the old remote head
and current local state. An old off-box copy is labelled by its actual age/version; do not
present it as containing postclosure work. Before rollback, a newer membership or evidence of
another primary stops restoration/admission for reconciliation under A947. No update grants
authority to promote, assume peer failure or start a new chain.

**Upgrade the spare first, one box at a time.** A release must declare and qualify
the old-primary/new-spare and new-primary/new-spare combinations before automatic paired use:
host protocol/journal, stored schema, Litestream/S3/LTX format, membership/fencing, tail transfer,
takeover validation and print-agent protocol. A version label alone supplies no compatibility
evidence. No general backward-compatibility layer is authorised while the pre-live reset rule
stands; defer unsupported pairs rather than adding one implicitly.

Both boxes use §3’s chosen closed window and completion evidence from the **actual primary**.
The spare’s disabled archive duty is neither a completed backup nor a reason to run a competing
archive. Bind the primary’s authenticated receipts/head/term to the spare attempt; any subsequent
primary work invalidates readiness for the primary attempt. Reserve each full trial/rollback
budget and bounded catch-up time before beginning the paired sequence; if remaining time cannot
cover the next box, defer it. A completed spare remains waiting on its qualified version.

While the spare trials, the primary remains available for ordinary sales, with replication
deliberately paused and last-copy age visible; it must not wait on the update coordinator to make a sale. Snapshot
the spare's entire stopped store/follower state, leave its old data intact and suppress takeover
on the trial instance. Before resuming follow or receiving newer primary data, close the spare's
own rollback boundary automatically after its own successful restart, clean-database and fresh
local running checks. Its passive checks use the retained spare copy and waiting role; they do
not require following newer data. Durably close before releasing follow, never on its first
follow admission. Before closure, failure restores only the untouched matching spare set.
After closure, repair forward or rebuild the spare through separately approved A947 rejoin
rules, never restore stale spare data as current.

Then require the upgraded spare to catch up to a measured primary head before attempting the
primary. During primary trial, freeze following/copy-up at that head; the spare is still waiting,
not a temporary seller. On primary rollback, the upgraded spare must be qualified to follow the
old version again; after closure it follows the new qualified publication. No auto-promotion or
name change occurs merely to update. A manager's separately authorised real takeover terminates
the upgrade attempt: new membership permanently bars stale primary admission/rollback until
A947 reconciliation. The updater never undoes an acknowledged takeover.

If the spare is missing/incompatible before starting, **approved design:** defer automatic paired upgrades
and show that reason; an administrator can explicitly choose a qualified single-box attempt,
accepting loss of the spare. If it is lost during primary validation, apply A947's authority
checks. Loss of the peer alone is not a failed local running check: proven authority and
successful local checks allow closure; uncertain authority holds for reconciliation. After
closure keep local work and warn. Ordinary sales on the already-running primary do not depend
on spare/update readiness. After an uncertain
restart retain A947's separate membership-wait and manager Continue without spare contract;
an update cannot silently weaken it. Rejoining a repaired spare remains A947's job.

## 8. What you see

Static screen brief and EN/ES copy
show `01-upgrade-check.png`, `02-rollback-complete.png` and `03-upgrade-complete.png`, with
English/Spanish, both themes, phone and desktop variants. The existing state views are unchanged.
The eight `04-window-settings-<en|es>-<light|dark>-<390|1280>.png` settings views show the timeline
next to the fields on desktop and directly below them on phone. All eight new views have been
rendered and visually inspected. PNGs are documentation illustrations, not product or runtime proof.

The planned settings form starts automatic-on with the editable 03:00–05:00 local default, with the end labelled as latest
reopening, the saved time zone and dated business-day boundaries, actual close/report status,
each selected backup schedule/actual next due/completion status and why application waits.
The default needs no initial Save. Pausing automation preserves the saved hours, downloads and sales.
Offer Save, Cancel, Pause automatic updates, Backups and the close/report completion workflow
when qualified, with on-screen admin authentication where needed. Update now shares §3’s gates.
Use the shared field/draft/Save/inline-error contract. Both hours empty can be saved as unset;
partial or invalid hours cannot be saved. An unset window blocks manual and automatic
application while downloads and sales continue. The 01:30–08:00 illustrations show a
custom saved window, not the default. Their older “proposed” badge is illustration history, not
a pending design decision. No inferred hours or hidden
acceptance of disabled backups is shown.

| State | English | Español |
| --- | --- | --- |
| Checking, validation genuinely open | **Checking the update**. “Waitron is checking that version {version} restarted successfully, the database upgraded cleanly and the system is running and answering. Orders and changes are paused during these checks. If a check fails, Waitron will return to the saved previous version and state.” **View details**, **Return to previous version**, **Leave this screen**. | **Comprobando la actualización**. «Waitron está comprobando que la versión {version} se ha reiniciado correctamente, que la base de datos se ha actualizado sin errores y que el sistema funciona y responde. Los pedidos y los cambios están en pausa durante estas comprobaciones. Si alguna falla, Waitron volverá a la versión y al estado anteriores guardados.» **Ver detalles**, **Volver a la versión anterior**, **Salir de esta pantalla**. |
| Complete, durable closure and release confirmed | **Update complete**. “Version {version} restarted successfully. The database checks passed and Waitron is running and answering. Normal work is enabled.” **Open till**, **View details**, **Leave this screen**. No return or acceptance action. | **Actualización completada**. «La versión {version} se ha reiniciado correctamente. La base de datos ha superado las comprobaciones y Waitron funciona y responde. Ya puedes trabajar con normalidad.» **Abrir caja**, **Ver detalles**, **Salir de esta pantalla**. Sin acción de volver ni de aceptar. |
| Rollback complete, old checks and release confirmed | **Previous version restored**. “Version {failedVersion} failed its checks. Version {oldVersion} and the saved state have been restored and checked. No changes were accepted on the new version. You can take orders again. This update will not be tried automatically again.” Show the actual check failure. **Open till**, **View details**, **Leave this screen**. | **Versión anterior restaurada**. «La versión {failedVersion} no ha superado las comprobaciones. Se han restaurado y comprobado la versión {oldVersion} y el estado guardado. No se aceptaron cambios en la versión nueva. Ya puedes tomar pedidos. Esta actualización no se volverá a intentar automáticamente.» **Abrir caja**, **Ver detalles**, **Salir de esta pantalla**. |
| Failure after durable closure | **Waitron needs repair**. “Version {version} passed the restart, database and running-system checks. Returning to the saved previous state is no longer available. Waitron now needs repair using its current state.” Show the current fault and actual service availability separately. **View details**, **Download report**, **Leave this screen**. | **Waitron necesita una reparación**. «La versión {version} ha superado las comprobaciones de reinicio, base de datos y funcionamiento del sistema. Ya no se puede volver al estado anterior guardado. Ahora es necesario reparar Waitron conservando su estado actual.» Mostrar el fallo actual y la disponibilidad real del servicio por separado. **Ver detalles**, **Descargar informe**, **Salir de esta pantalla**. |
| Restore or journal not verified | **Waitron cannot confirm the saved state**. “Orders are paused. The update record could not be verified. No older state has been opened for trading.” **Inspect update record**, **View details**, **Leave this screen**. | **Waitron no puede confirmar el estado guardado**. «Los pedidos están en pausa. No se ha podido verificar el registro de actualización. No se ha abierto un estado anterior para vender.» **Examinar el registro de actualización**, **Ver detalles**, **Salir de esta pantalla**. |

The safe Stop choice is labelled **Leave this screen**. It exits only the screen without changing
service, admission, checks, phase or an in-flight payment/background operation. It never cancels
an unknown money outcome. **Return to previous version** is separate and offered only while the
host positively confirms validation is open. Explain: “This stops validation and restores the
saved previous version and state. Orders resume after that version passes its checks.” Spanish:
«Esta acción detiene la comprobación y restaura la versión y el estado anteriores guardados.
Los pedidos se reanudan cuando esa versión supera las comprobaciones.» Require on-screen admin
authorisation from §5, with no acceptance click for a successful version.

Closure can win while an old screen is open or authentication is in progress. Refresh the status,
remove Return and explain that checks passed and rollback is closed; never treat a stale button
as authority. During journal uncertainty show the inspection state, not an available return or
an invented claim that checks passed. A successful explicit return uses “You chose to return
before checks finished” / «Has elegido volver antes de que terminaran las comprobaciones»,
instead of saying a check failed. Only confirmed old readiness/release permits “You can take
orders again”. A spare's completion says it is ready to follow, never that it can take orders.

Public status and bounded redacted diagnostics disclose no credentials/person data. Any operation
requiring admin authority offers password/passkey and enrolled TOTP on that screen. If a repair
of the current state is qualified, offer it with its actual effect; otherwise retain inspection,
download of a redacted report and Stop. Do not promise retry will cure an unknown cause.

Record failure locally on `@host-state` and retained logs before restoration; after old readiness,
show a persistent Box alert and last-attempt details. **Approved design:** existing authorised notification
channels may send a redacted report after service returns, queued if offline. No automatic new
support/Cloud upload or A9 bug-report capability is assumed. Show completed rollback only with
positive containment/no-admission, complete-restore, old-readiness and RESTORED evidence. Show
completion only with the bound successful checks, durable closure and matching release evidence.

## 9. Host updates and qualification gates

App updates never bundle an unqualified kernel, boot-loader, firmware, TPM-seal or Docker-line
transition. B3 §7.4 remains a separate host transaction with its own OS/boot inventory and crash
evidence. Do not restore `@rootfs` as an app fix, roll back `@host-state`, regenerate a disk key,
restore another disk's key or let a host helper downgrade erase a closure or RESTORED marker.

Hold startup-changing packages by their measured effect, as B3 requires. Unattended resealing,
temporary/predicted seals, power cuts and rollback of boot bytes must qualify on the selected
real platform before automation; a register-7/certificate-list transition remains person-and-key
present until settled. An app snapshot proves none of these. A host update must preserve B3's
retained key/UUID, recovery identity, approved locked redirects and minimal normal Wi-Fi copy,
including its fixed-path update/cleanup protocol outside measured boot bytes. It adds no recovery
SSID/hotspot. Stale/unjoinable Wi-Fi offers cable/local recovery, not a working-network promise.
B3's actual Android trust hold and physical-device gates remain, unchanged.

**All gates below are UNVERIFIED / NOT RUN for A950.** They are acceptance requirements for a
later separately approved build, not execution evidence that this design is ready to ship.

| Gate | Required discriminating evidence |
| --- | --- |
| Scheduling and completion | Prove a fresh venue starts automatic-on with an editable 03:00–05:00 local window and needs no initial Save; pause keeps the saved hours and blocks automation while downloads/sales continue. An explicitly cleared pair stays unset across restart and blocks both application paths while downloads/sales continue; partial/invalid edits refuse. Manual has identical prerequisites. Cover close/report on demand with no scheduler, actual scheduled jobs, disabled/missing producers, late/failed/unknown results, archive captured before close, every-destination storage versus early upload/pruning/cleanup, callbacks from replaced sweeps and startup/reload copies. Race new work/jobs/settings/term changes against final admission; reject wrong day/node/term/revision/data generation and a prior day’s receipt, while accepting the same unbroken D episode after rollover. Cover fixed/weekday/interval/auto next due, retained old-clock deadlines, pending cutover activation, cross-midnight and DST gap/fold/internal transition, clock jumps, reboot and revision-based duplicate attempts. Positive controls must admit the fully complete quiet case with full budgets, reject exactly-at-cutoff admission and preserve real jobs on deferral. Check both-box evidence comes from the primary and reserve sequential budgets/catch-up. Inspect all eight EN/ES timeline views and default/paused/unset/wait/skip/disabled statuses in the eventual product. |
| Closure and host admission | Apply §2's resolved boundary. Race successful-check closure against explicit/failed-check rollback both ways; cut power before/after durable closure and release; lose check/completion answers; reject stale boot permits and unknown journals. Prove no effect before closure and no restore after closure or RESTORED, with negative controls. An idle overnight success must close without staff, first work or an acceptance click; normal operations need no ongoing updater roundtrip. |
| Complete-state durability | Encrypted Linux btrfs rig, pinned Docker store, all writers stopped, exact mount/nested-subvolume inventory, side files and whole-state restoration. Cut every journal/restore phase; prove logs, host marker, key/UUID and newer/unknown/damaged floor survive. Refuse missing host/log mounts and unsupported old parsers. |
| Capacity and images | Full-data and metadata exhaustion on an owned small throwaway filesystem during image/snapshot/migration/closure/restore. Exact old digests launch offline; supported cleanup cannot prune protected references. No test fills or cleans the real shared disk. |
| Candidate containment/readiness | Actual packaged entry/migrations and enabled/disabled modules; reject incomplete/ahead sets, damaged integrity/FKs/protection definitions and preservation deltas. Fresh local TLS/menu/config/history checks must reject stale boots, cached/setup/recovery/health-only responses and overbroad validator credentials. Intercept attempts to every external/hardware/background seat; no real provider use or venue test sale. Remove each gate and observe failure beside a valid control. Inspect actual EN/ES screens, both themes, phone/desktop, keyboard/accessibility. Static PNGs do not pass this gate. |
| A799 release qualification | Oldest-supported and previous-retained sources, equal endpoints once; actual pending migrations distinct from restart; exact independent issued-F1/history/identity preservation, restart and separate continued sale on disposable copies. Empty/missing/skipped evidence blocks release; no automatic retirement or refreshed expectations. |
| Stream and spare | Actual pinned Litestream/S3, old/new mixed versions, frozen store/follow/copy-up/prune, same-term conditional new-prefix handoff and failed CAS; crash before/after full copy/pointer switch; rollback restores old publication, spare loss/new membership never admits stale primary. Spare closure must precede follow; its primary keeps selling during validation. External outages must not delay successful local closure or ordinary sales; publication retries retain authority and old copies. |
| Host/TPM and clients | B3's separately authorised real Linux/VM/TPM/firmware/disk/Android gates; startup reseal interruption and key-present exceptions. No source read, mock or app upgrade result substitutes for them. |

**Status: complete design approved on 29 October 2026, with automatic-on and an editable
03:00–05:00 local default.** The clean-restart closing rule and all non-window contracts remain
approved. The implementation plan awaits owner approval before any build. Publication grants no
build, migration, runtime qualification, Cloud change or release authority. All runtime gates
above remain **UNVERIFIED / NOT RUN**.
