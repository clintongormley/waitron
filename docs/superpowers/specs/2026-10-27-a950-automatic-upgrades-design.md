# A950: automatic app upgrades with a recoverable trial

**PROPOSAL, 27 October 2026. No design or build approval is recorded here.**
You need the box to update without losing yesterday's records or tonight's work. If the
new version fails its checks before you use it, the proposed updater restores the complete
stopped state and the exact previous images. Rolling back keeps you trading; it does not
fix the failed release. A950 is required before go-live, by the owner's 21 October decision.

The owner's boundary remains **“the first order taken on the new version”**, not the restart.
Section 2 asks one unresolved policy question because other acknowledged work can precede
that order. Until answered, the broader boundary below is a recommendation, not permission
to implement it. All choices labelled **my call** are proposed and unapproved.

## 1. Contracts and evidence status

This is a design, not an implementation plan. It changes no fiscal hash, chain, allocation,
invoice writer or installation name. An ordinary upgrade continues the same node, keys,
SIF, series, next number and fiscal/workforce heads. It performs no setup, restore-as-new,
re-registration or promotion. The ahead-of-image guard stays: rollback means the matching
old complete state **and** old image, never an old image over migrated data or a downgrade
bypass. A release requiring a new installation name is an exceptional separately authorised
operation, outside automatic app updates.

Read together:

- [B3 approved-with-changes design](2026-10-21-b3-usb-installer-design.md), §§6, 7.4,
  7.5, 8 and 14; [B3 plan](../plans/2026-10-26-b3-usb-installer.md), Global Constraints
  and execution gates. Its six planned slices exclude slice 7 daily release polling;
  A950 must obtain separate build authority for that integration. B3 is not built by this proposal.
- [A947 two-box design](2026-10-21-a947-two-box-failover-design.md), §§3, 5–8:
  waiting spare, single primary, fencing and explicit takeover stay authoritative.
- [A799 historical upgrade design](2026-10-19-a799-real-database-upgrade-testing-design.md)
  and [plan](../plans/2026-10-22-a799-real-upgrade-testing.md), current approval addenda,
  capture/preservation/new-sale contracts; [actual harness status](../../../bench/real-upgrade/README.md).
  Its approved build authority does not approve A950. Real historical qualification precedes
  enabling automatic upgrades; a rollback facility cannot replace it.
- [A1016 and A1049](../../backlog/box.md): easy updating and off-box copies, and honouring
  a Cloud-held release. This proposal changes no Cloud service or support-retirement policy.

**Source inventory: READ ONLY at `9d5853c310e691ed558d80a8a12d0dbddccab2e7`.**
The following anchors describe inspected source, not executed behaviour. Every runtime
consequence is UNVERIFIED. No A950 Linux, VM, Docker, TPM, btrfs, power-cut, bucket or
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
| `apps/server/src/stream-host.ts:140`, `:156`, `:192`; `packages/stream/src/supervisor.ts:405`, `:428`, `:441`, `:458`; `packages/stream/src/litestream.ts:13` | Current host constructs a supervisor with node/term/settings; opening claims a fresh generation, starts replication and conditionally moves a pointer after a full copy. Pin is Litestream 0.5.17. An arbitrary old prefix is not a proven rollback/resume interface. |
| `packages/provisioning/src/first-setup-start-again-note.ts:23`, `:51`, `:57`, `:73`; `packages/provisioning/src/first-setup-start-again-leftovers.ts:245` | Current note requires a nonempty known name/module, raises only to a later floor, and supplies a floor source. It does not establish A1099's future name/damage-unknown representation. |
| `packages/store/src/venue-lock.ts:55`, `:78`; `apps/server/src/recovery-lock.ts:21`; `apps/server/src/recovery-state.ts:229` | Venue and recovery locks have owners; recovery state has an update helper. No unlinking locks or writing `recovery.json` directly belongs in an updater. |
| `bench/real-upgrade/index.json:1`; `bench/real-upgrade/README.md:1` | Qualification index has no fixtures/epoch. Cuts 1–3 use metadata/comparison/injected admission interfaces. No historical image, issued-F1 preservation or real upgrade is qualified by this source read. |

The only outside facts used here have deliberately small bounds:

| Source, accessed 2026-10-27 | Exact quotation | Paraphrase and limit |
| --- | --- | --- |
| [Btrfs Subvolumes, Nested subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html#nested-subvolumes) | “snapshotting is not recursive” | Nested subvolumes need explicit inventory. This does not qualify Docker mount replacement or encrypted-disk behaviour. |
| [Btrfs Subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html) | “A snapshot is not a backup” | A local rollback point does not replace a copy off the box. No performance, capacity or power-loss durability claim follows. |

## 2. The one owner question: which use closes rollback?

**Harbour Kitchen updates overnight. Before its first new order, Ana clocks in and changes
the till PIN; a refund or queued invoice filing may happen before the first new order. May
automatic rollback end before the first live change or external action, including automatic
filing and backup publication? Recommend yes, so none can later disappear. This includes
sign-in that stores credentials.**

That is broader than “first order” and requires an explicit answer. If you mean literally
first order, the alternative is to refuse all other durable changes and external work until
that order commits. Ana cannot clock in, change a PIN or complete that refund in the trial.
If sign-in itself needs stored challenges/sessions, it cannot be offered normally before
commit either. Do not implement “acknowledge now, restore later” under either answer.

Concrete boundary cases for the recommended policy:

| First attempted use after readiness | Required proposed treatment |
| --- | --- |
| Create an order, add to an existing held table, send to kitchen, close/pay a bill | Close rollback durably before the handler can execute. An edit/payment need not create a new order ID. Active/held orders normally defer scheduling, but admission still guards a missed/racing case. |
| Clock in/out, change settings/menu, invite staff, reset a PIN/password, enrol a passkey/device, issue/renew a live login | Close rollback before the first stored effect or email. Do not lose an acknowledged credential or attendance event. |
| Login challenge/session/counter, automatic token renewal, a GET that writes last-seen state | Treat by actual effect, not HTTP verb. Use a genuinely passive trial read or close rollback first. |
| Fiscal outbox, pending card/refund recovery, printing/drawer, mail/webhook, scheduled activation/archive/replication/follow | No execution before irreversible commit. After readiness, an actual due action can request that commit before execution. In-flight or uncertain money already present prevents starting the upgrade. |
| Read the upgrade screen, inspect readiness, leave the screen | Host-owned passive/status controls remain available without changing rollbackable venue state. Their audit is outside rollback. An explicit authorised rollback uses the separate serialized restoration path. |

**My call, subject to that answer:** after readiness passes, a real scheduled action may ask
for admission just as a staff action does. Before the first such action executes, the host
closes rollback durably. This lets a queued filing or backup publication complete an overnight
upgrade without waiting for staff. No artificial housekeeping write, acceptance button or timer
closes rollback merely to finish the update.

If no live action is due, a healthy READY candidate stays available, including beyond the quiet
window and across a restart after revalidation. There is no ten-minute idle rollback. Background
effects remain suppressed until their admission commits the version; status shows the actual
copy/filing pause. No second update starts while this attempt is READY. A failed check or lost
readiness before commit still invokes restoration; an explicit Return to previous version does
the same. Stop only leaves the screen. This policy, automatic-on default and timing below are
proposals, not additional owner approvals.

## 3. Scheduling without putting a release server on the sale path

**My call:** automatic app updates are on by default for qualified stick-installed boxes,
shown in Box settings, with a daily 03:00–05:00 window in the venue's configured time zone.
An administrator can change the window, pause automatic updates or choose Update now; manual
start still meets every admission check. No version-age policy disables ordinary sales.
Off-box backup defaults and commercial support ages remain A1016 decisions, not settled here.

The proposed host service checks B3's signed release manifest daily with jitter, verifies
signatures against its embedded current/spare public keys, platform, minimum host protocol,
source and immutable app/agent/dependency digests. A1049 adds a fresh authenticated Cloud hold
answer bound to that exact release; unknown/stale/unavailable status defers offering/applying
it. A venue with no Cloud account still needs a qualified account-free hold-check contract;
none is promised here. Recheck immediately before freezing; a hold during trial cancels it.
A hold arriving after commit blocks future attempts, never orders or a forced downgrade.

Download and verify while the current version trades. A failed manifest, hold check, download,
status query or lack of disk space leaves that service running. No synchronously fetched
release/hold answer belongs in an ordinary sale request. An explicitly paused box keeps trading
and sees a version/backup warning, with no invented support expiry.

Require ten minutes without new work and, under a shared admission fence, no active/held orders,
unsettled bills, in-flight requests, reader authorisation/capture, Stripe reconciliation,
pending/unknown refunds, printing/drawer delivery, restore/reset/setup, membership change,
host/network change or conflicting update. Drain already-started effects to a known outcome
within their own deadlines; an unknown answer defers. Do not cancel money work to make a quiet
window. Pending unsent fiscal/email work may be frozen, not sent during trial. A failed ability
to determine quiet status defers the upgrade, not current service. The fence stops a fresh order
slipping between the final check and shutdown; a request already admitted makes that attempt defer.

**My-call budgets:** release/download checks get three bounded attempts per daily check,
30-second metadata/hold attempts and 10-minute image attempts; no freeze before completion.
Freeze/drain gets two minutes, migration/readiness five minutes and restoration/old-readiness
five minutes each. Start no freeze unless the window has room for these budgets. Healthy READY
waiting is event-driven rather than timed out; crossing the window never rolls back admitted
work or starts a second attempt.
Measure and review these limits before enabling them. An expired phase never implies success
or permits killing an effect with an unknown result. One failed candidate digest is quarantined
after one trial; no nightly failure loop. A newer fixed digest is eligible next window. An admin
may explicitly retry the same digest after seeing its recorded cause, without a promise that
retry fixes it. Cleanup failure retains evidence and prevents another attempt.

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

**My call:** keep one rollback set and one active attempt, plus bounded failed-attempt evidence.
Do not delete the rollback set to make its candidate fit. Disk-full during pull, journal write,
snapshot or readiness means defer or restore, according to the phase. Snapshot success does not
reserve enough blocks for migrations; preflight must measure data/metadata headroom and trial
must handle exhaustion. No reserved disk allocation is introduced. After commit the snapshot is
never offered as a rollback; remove only owned obsolete data after a durable completion record.

For a manually installed/non-B3 disk, **my call:** defer automatic updates unless a separately
qualified stopped whole-state copy adapter provides the same inventory, capacity and atomic
restoration contract. Do not silently repartition it or call a database-only copy a substitute.
Existing manual install remains today's path, with its documented one-way migration risk.

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
name, and damage remains an explicit blocker until that released contract resolves it. This
checkout's parser does not supply that contract (§1). Trace all readers/writers then qualify the
overlay with both old and new releases; an old parser that cannot honour the retained state is
ineligible for automatic rollback. Until that binding exists, do not enable this path.

Host recovery evidence likewise survives and remains distinct from snapshot `recovery.json`.
Reconcile app recovery state only through `updateRecoveryState` under its lock, retaining actual
refusal evidence; never clear refusal flags just to force the old app to trade. Restoring
`@volumes` cannot erase host intent, logs, the newer floor or B3's retained disk key/UUID.

## 5. Trial startup and the durable no-return interlock

Add a dedicated upgrade-trial mode, checked at entry **before** recovery/reset/restore effects,
migrations or any duty startup. It may perform the candidate's real packaged migrations on the
captured active set; a read-only SQL connection is only an inspection tool. Enumerate allowed
local migration/boot effects by field/cause. No ordinary request, account/session write,
background mutation, provider request or hardware action is admitted during validation.

Explicitly suppress fiscal filing/reconciliation, all card/refund recovery, drawer/printing,
mail/webhooks, scheduled activation, Cloud/tunnel renewal, archives, stream uploads/pruning/
pointer changes and spare following/copy-up. Check every enabled module's contributions and
every separate process. Defence includes withheld external capabilities/egress/hardware workers
as well as code gates; network denial alone must not make attempted effects look like a pass.
The candidate gets no Docker socket or general host/file-write API. Trial exceptions are a
closed list of local diagnostics, not “all GETs”.

Upgrade readiness is a new structured result, bound to attempt, candidate digest, boot nonce,
snapshot identity, schema manifests, node/membership identity and admission generation. Require:

1. Packaged migration completion for enabled sets; disabled retained modules stay intact.
2. Stopped integrity/foreign-key checks and complete protection definitions; fiscal/workforce
   chains checked through existing non-writing interfaces. Identity, heads and next allocation
   remain unchanged. Fail any unexpected fiscal/allocation delta or unexplained local change.
3. Actual local listener/TLS and authenticated-equivalent passive menu/config/history loading
   for till and dashboard, with no fabricated login or normal session writes. A bounded local
   validator capability must be unusable for business actions. Qualify the actual rendered
   screens separately; a setup/recovery 200, `/health` or a mock alone does not qualify readiness.
4. Expected primary/waiting role and unchanged signed membership, no live external duty or
   attempted forbidden effect, required host interlock supported by both versions. Provider,
   internet, Cloud and bucket availability are not required to prove ordinary local selling.

The host persists a versioned root-only journal on checked `@host-state`, with attempt ID,
disk UUID/layout, old/new digests, capture/subvolume identities, phase sequence, admission
generation, readiness binding, floor evidence, stream/spare heads and bounded redacted outcomes.
Unknown versions, mismatches, corruption or missing state after an attempt never mean idle.
Use serialized atomic publication with file and directory flushes and validated read-back;
the exact crash guarantees must be measured. The app cannot fabricate readiness or commit
authority by supplying a path or an unbound boolean. Host requests authenticate the local caller
and fixed operation, not merely a server-provided person name.

Unauthenticated polling, a bad password or a request without permission cannot force commit.
The trial's rollback control requires an existing authenticated session or a narrowly scoped
fresh admin proof checked without a venue write. Opening the till is passive navigation,
not a separate Use control. Any precommit challenge needed for that proof
is short-lived host memory, grants only this control, and creates no normal login credential.
Normal sign-in/session issuance follows commit. Bind and qualify password/passkey plus enrolled
TOTP against released identity APIs; if this cannot work without precommit durable auth changes,
hold the design binding rather than silently admitting normal login or exposing an
unauthenticated commit control.

**Proposed irreversible boundary:** before a ready request's handler executes, it asks the host
to admit its operation ID under the current readiness binding. The host serializes this with
rollback, durably writes **COMMIT_INTENT**, and only then grants execution. This marker means
rollback is permanently closed for the attempt, even if that handler later fails or writes
nothing. Only after that grant may the request execute and acknowledge; ordinary outbox and
provider idempotency rules then govern its result. Background effects cannot start earlier.
The grant is bound to the admitted process/boot generation; stale permits cannot start work.

The host cannot atomically transact with every database/provider, so it deliberately commits
too early rather than too late. A lost commit answer requires querying that durable attempt;
absence of a reply never permits rollback, execution or an unbounded duplicate operation.
After host/process restart, renew the binding from the journal before admission. A lost readiness
record may strand a healthy candidate pending a new local check; it must never undo committed
state. There is no timeout that turns an uncertain commit back into a reversible trial.

If rollback wins the host's serialized race, record ROLLBACK_INTENT first and reject every
admission. Shut down all trial writers, recheck ownership/membership, restore the verified
complete set plus old digest/config, apply the floor/recovery overlay, and validate the old
version before reopening it. Restoring one database file or relying on Compose tags is refused.
If admission wins, every later rollback request says it is unavailable and preserves the new
state, even when the operation response was lost. No acknowledged operation or external effect
may ever be erased by an automatic restoration.

Before any restored old service can accept work, durably record RESTORED with the verified active
tree and a new admission generation. That record permanently retires this attempt's restore
permission. A restart may recheck/start this tree, never replace it again from the same snapshot.
Normal old-version work must also pass that host admission check, so an interrupted completion
answer cannot resurrect an earlier restore after the old version has acknowledged new work.

## 6. Crash and failure outcomes

Every phase below is proposed host-journal state. Recovery is idempotent and records exact
substeps; partial replacement is never inferred complete from a directory name.

| Durable phase when interrupted | Required recovery outcome |
| --- | --- |
| PREPARED: verified downloads/old references, old app still trading | Revalidate inputs/holds/window later. Never restore an earlier state over the still-running old app. |
| FREEZING: admissions closed, shutdown/capture incomplete | Keep admissions closed while ownership is uncertain. Establish all writers stopped; if no candidate ran, reopen the intact old state only after local checks. Forced shutdown invalidates that capture. |
| SNAPSHOT_READY | Verify complete capture and old references. Continue a bounded trial or restore the old set; no unrecorded candidate boot. |
| VALIDATING | Treat migrated state as disposable only while journal proves no commit. Timeout/crash/check failure enters ROLLBACK_INTENT; retain diagnostics. No loop of candidate restarts. |
| READY: checks passed, rollback still open | Recheck boot/readiness binding after any restart. Await the first real staff/scheduled action or explicit rollback. An idle candidate remains READY beyond the window; Stop only exits the screen. Readiness lost is not commit lost. |
| COMMIT_INTENT: persisted before permission to execute | Never restore, including power loss before execution, lost host answer, failed handler or lost client response. Recover candidate and reconcile the operation by its ID; tell staff its outcome is unknown when it is. |
| LIVE: candidate accepted, normal work enabled | Keep current state and repair forward if it fails. A newer fixed image may be installed through a new attempt only from this current state. No reset/downgrade advice. |
| ROLLBACK_INTENT: admission closed | Resume only the recorded restore substeps with all writers stopped. Preserve the failed tree until replacement/overlay/readiness are proven; never start a mixed set. |
| RESTORED: exact old set verified, failure quarantined | Start/revalidate old service, preserve attempt/log evidence and overlay. A cut before the completion answer cannot trigger another stale restore after old service has admitted work. |
| Unknown/missing/corrupt/conflicting journal, changed disk or newer membership | No automatic restoration or trading admission on that uncertain boot. Show inspection/recovery choices and Stop. Re-read authoritative host/disk/membership evidence; never guess “nothing happened”. |

Disk-full before freeze leaves current service alone. During trial, stop the candidate and
restore only when capture, journal and no-return evidence are intact. Failure to durably write
COMMIT_INTENT admits zero work. If the write's outcome is uncertain, retain the stop until it
can be read, with no rollback assumption. A durable marker followed by disk-full is committed
even if the operation fails. Restore/mount/journal failure leaves the host recovery screen,
not an empty venue. Do not delete unknown files, locks or shared images to make recovery fit.

## 7. Bucket continuity and two local boxes

**No candidate data leaves the box before commit.** Before capture stop the publisher and
record the last authoritative pointer/ETag, generation, node/term and observed data head. Freeze
spare follow, store mutations and offsite mirroring/deletion for this attempt; retain the last
consistent spare database and its store. Do not overwrite them with migrated trial bytes or
prune their generations. The freeze is intentional protection unavailability, shown explicitly.

Current supervisor opening (§1) is not a promise that an old local LTX/WAL position can resume
under a newer image. **My call:** use a fresh generation prefix after commit, and after rollback
if continuity has not been independently qualified for that exact restored set/version. No
in-place rewrite/reuse of a published prefix. At the same node/term, qualify the actual 0.5.17
adapter, full-copy readiness and conditional pointer handoff, including crash/retry. A new
generation is a backup namespace, not a new fiscal chain or membership term.

Keep the old published head/prefix and frozen spare data until the new full copy is verified
and the pointer's compare-and-swap against the recorded authority succeeds. Candidate trial
objects cannot become a restore source. Restore selection must validate signed membership,
pointer and complete generation; no “newest object wins” or shared-prefix merge. A changed
ETag/newer term cancels handoff and requires reconciliation, never overwriting newer authority.
Qualify exclusion from both local pruning and A947's deletion-mirroring; keeping just a pointer
is insufficient if another process deletes its objects.

After local commit, a bucket/spare outage leaves the local version trading with a clear copy
warning. Publication waits/retries with bounded backoff while retaining the old remote head
and current local state. An old off-box copy is labelled by its actual age/version; do not
present it as containing postcommit work. Before rollback, a newer membership or evidence of
another primary stops restoration/admission for reconciliation under A947. No update grants
authority to promote, assume peer failure or start a new chain.

**My call: upgrade the spare first, one box at a time.** A release must declare and qualify
the old-primary/new-spare and new-primary/new-spare combinations before automatic paired use:
host protocol/journal, stored schema, Litestream/S3/LTX format, membership/fencing, tail transfer,
takeover validation and print-agent protocol. A version label alone supplies no compatibility
evidence. No general backward-compatibility layer is authorised while the pre-live reset rule
stands; defer unsupported pairs rather than adding one implicitly.

While the spare trials, the primary continues selling, with replication deliberately paused
and last-copy age visible; it must not wait on the update coordinator to make a sale. Snapshot
the spare's entire stopped store/follower state, leave its old data intact and suppress takeover
on the trial instance. Before resuming follow or receiving newer primary data, commit the spare's
own host journal; that first background admission closes its local rollback. Before this,
failure restores only the untouched matching spare set. After this, repair forward or rebuild
the spare through separately approved A947 rejoin rules, never restore stale spare data as current.

Then require the upgraded spare to catch up to a measured primary head before attempting the
primary. During primary trial, freeze following/copy-up at that head; the spare is still waiting,
not a temporary seller. On primary rollback, the upgraded spare must be qualified to follow the
old version again; on commit it follows the new qualified publication. No auto-promotion or
name change occurs merely to update. A manager's separately authorised real takeover terminates
the upgrade attempt: new membership permanently bars stale primary admission/rollback until
A947 reconciliation. The updater never undoes an acknowledged takeover.

If the spare is missing/incompatible before starting, **my call:** defer automatic paired upgrades
and show that reason; an administrator can explicitly choose a qualified single-box attempt,
accepting loss of the spare. If it is lost during primary trial, restore precommit when authority
is still proven, otherwise hold for reconciliation; postcommit keep local work and warn. Ordinary
sales on the already-running primary do not depend on spare/update readiness. After an uncertain
restart retain A947's separate membership-wait and manager Continue without spare contract;
an update cannot silently weaken it. Rejoining a repaired spare remains A947's job.

## 8. What you see

[Proposed static screens](../../backlog/mockups/a950-automatic-upgrades/README.md) include
`01-upgrade-check.png` and `02-rollback-complete.png`, in English and Spanish, both themes,
phone and desktop. These are documentation illustrations, not product-rendering or runtime
evidence. The table also specifies states not pictured in this first set:

| State | English | Español |
| --- | --- | --- |
| Checking | **Checking the update**. “Waitron is checking version {version}. You cannot take orders or make changes yet. If the check fails, the previous version and saved state will be restored.” | **Comprobando la actualización**. «Waitron está comprobando la versión {version}. Aún no puedes tomar pedidos ni hacer cambios. Si falla la comprobación, se restaurarán la versión anterior y el estado guardado.» |
| Ready, still reversible | **Update checked. Ready to use.** “The first live change or automatic action ends the option to return to the previous version. Opening the till alone does not end it.” Actions: **Open till**, **Return to previous version**, **Leave this screen**. Opening the till is passive navigation; a sign-in that writes state or the first actual staff/scheduled action requests admission. No acceptance button commits by itself; the warning is subject to §2's answer. | **Actualización comprobada. Lista para usar.** «El primer cambio real o acción automática elimina la opción de volver a la versión anterior. Abrir la caja por sí solo no la elimina.» **Abrir caja**, **Volver a la versión anterior**, **Salir**. |
| Rollback complete, old readiness passed | **Previous version restored**. “Version {failedVersion} failed its checks. Version {oldVersion} and the saved state have been restored. No changes were accepted on the new version. You can take orders again. This update will not be tried automatically again.” Show the actual check failure. **Open till**, **View details**, **Leave this screen**. | **Versión anterior restaurada**. «La versión {failedVersion} no ha superado las comprobaciones. Se han restaurado la versión {oldVersion} y el estado guardado. No se aceptaron cambios en la versión nueva. Ya puedes tomar pedidos. Esta actualización no se volverá a intentar automáticamente.» **Abrir caja**, **Ver detalles**, **Salir de esta pantalla**. |
| Committed operation outcome unknown | **The previous version cannot be restored**. “A change was admitted on this version. Its result is not yet confirmed. Restoring the old state could remove it.” **Check this operation**, **View details**, **Leave this screen**. | **No se puede restaurar la versión anterior**. «Se ha admitido un cambio en esta versión. Su resultado aún no está confirmado. Restaurar el estado anterior podría eliminarlo.» **Comprobar esta operación**, **Ver detalles**, **Salir de esta pantalla**. |
| Restore or journal not verified | **Waitron cannot confirm the saved state**. “Orders are paused. The update record could not be verified. No older state has been opened for trading.” **Inspect update record**, **View details**, **Leave this screen**. | **Waitron no puede confirmar el estado guardado**. «Los pedidos están en pausa. No se ha podido verificar el registro de actualización. No se ha abierto un estado anterior para vender.» **Examinar el registro de actualización**, **Ver detalles**, **Salir de esta pantalla**. |

The safe Stop choice is labelled **Leave this screen**. It exits this screen without changing
service, admission, the update phase or any already-admitted payment/background operation. It
never cancels an unknown money outcome. **Return to previous version** is a separate explicit
choice, available only before commit; it runs the serialized rollback path and explains that
orders resume only after old-version checks pass. During an uncertain phase, leaving the screen
leaves its existing admission stop in force; it neither resumes trading nor starts restoration.
Public status and bounded redacted diagnostics disclose no credentials/person data; any operation requiring admin authority
offers password/passkey and enrolled TOTP on that screen, rather than sending you to somebody else.
If a later forward repair is qualified, offer it with its actual effect; otherwise retain inspect,
download redacted report and Stop. Do not promise retry will cure an unknown cause.

Record failure locally on `@host-state` and retained logs before restoration; after old readiness,
show a persistent Box alert and last-attempt details. **My call:** existing authorised notification
channels may send a redacted report after service returns, queued if offline. No automatic new
support/Cloud upload or A9 bug-report capability is assumed. The public rollback claim above is
shown only with positive no-admission and completed-restore evidence; uncertainty uses its own state.

## 9. Host updates and qualification gates

App updates never bundle an unqualified kernel, boot-loader, firmware, TPM-seal or Docker-line
transition. B3 §7.4 remains a separate host transaction with its own OS/boot inventory and crash
evidence. Do not restore `@rootfs` as an app fix, roll back `@host-state`, regenerate a disk key,
restore another disk's key or let a host helper downgrade erase an admission marker.

Hold startup-changing packages by their measured effect, as B3 requires. Unattended resealing,
temporary/predicted seals, power cuts and rollback of boot bytes must qualify on the selected
real platform before automation; a register-7/certificate-list transition remains person-and-key
present until settled. An app snapshot proves none of these. A host update must preserve B3's
retained key/UUID, recovery identity, approved locked redirects and minimal normal Wi-Fi copy,
including its fixed-path update/cleanup protocol outside measured boot bytes. It adds no recovery
SSID/hotspot. Stale/unjoinable Wi-Fi offers cable/local recovery, not a working-network promise.
B3's actual Android trust hold and physical-device gates remain, unchanged.

**All gates below are UNVERIFIED / NOT RUN for A950.** They are acceptance requirements for a
later separately approved build, not a task plan or evidence that this design is ready to ship.

| Gate | Required discriminating evidence |
| --- | --- |
| Policy and host admission | Owner answers §2; real old/new entry and host protocol reject bypasses. Race first-operation/rollback both ways; power-cut before/after journal flush and execution; lost readiness/commit/client answers. Removed admission must allow the forbidden effect in a negative control. |
| Complete-state durability | Encrypted Linux btrfs rig, pinned Docker store, all writers stopped, exact mount/nested-subvolume inventory, side files and whole-state restoration. Cut every journal/restore phase; prove logs, host marker, key/UUID and newer/unknown/damaged floor survive. Refuse missing host/log mounts and unsupported old parsers. |
| Capacity and images | Full-data and metadata exhaustion on an owned small throwaway filesystem during image/snapshot/migration/commit/restore. Exact old digests launch offline; supported cleanup cannot prune protected references. No test fills or cleans the real shared disk. |
| Candidate containment/readiness | Actual packaged entry/migrations and enabled/disabled modules; intercepted attempts to every external/hardware/background seat; no real provider use. Remove each gate and observe failure beside a valid control. Inspect actual EN/ES screens, both themes, phone/desktop, keyboard/accessibility. Static PNGs do not pass this gate. |
| A799 release qualification | Oldest-supported and previous-retained sources, equal endpoints once; actual pending migrations distinct from restart; exact independent issued-F1/history/identity preservation, restart and separate continued sale on disposable copies. Empty/missing/skipped evidence blocks release; no automatic retirement or refreshed expectations. |
| Stream and spare | Actual pinned Litestream/S3, old/new mixed versions, frozen store/follow/copy-up/prune, same-term conditional new-prefix handoff and failed CAS; crash before/after full copy/pointer switch; rollback restores old publication, spare loss/new membership never admits stale primary. Readiness failures must defer updates while current service sells. |
| Host/TPM and clients | B3's separately authorised real Linux/VM/TPM/firmware/disk/Android gates; startup reseal interruption and key-present exceptions. No source read, mock or app upgrade result substitutes for them. |

One fresh builder review identified the Stop, idle overnight trial and early acceptance-button
ambiguities; this proposal incorporates those corrections. The next owner decision is §2.
No plan, build, migration, runtime qualification, Cloud change or release approval follows from
publishing this proposal.
