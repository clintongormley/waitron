> **2026-10-23: rejected and superseded.** The owner rejected this proposal at ~02:25 because
> it requires Cloud and has too many moving parts; the ~02:58 direction settles five points
> for its replacement. Read the [proposed simple handover revision](2026-10-23-a1018-simple-handover-design.md).
> The body below, including the `db7cddeb2` / Cloud `6700d6f` agreement and pending question,
> is historical. That agreement is no longer current; fresh builder review is complete; Lane G agreement
> and one new owner design question remain pending. No build is approved.

# A1018: prove a hosted writer stopped before its successor starts

> **2026-10-22 publication update:** Cloud's shared contract section is now published at
> [`6700d6f2319ff0b62b0ccc27e833487935ad2174`](https://github.com/waitron-io/waitron-cloud/blob/6700d6f2319ff0b62b0ccc27e833487935ad2174/docs/waitron-integration-contract.md#hosted-writer-retirement-a1018-direction-agreed)
> through [D118 PR #300](https://github.com/waitron-io/waitron-cloud/pull/300).
> It records the direction agreement against this proposal's original revision
> `db7cddeb2d38984b284b23e8e391e7ebd7cb9156`. The owner's single design question is pending;
> no enforcement profile, wire schema or build is approved. Lane D's production/hosting
> wording corrections remain open. The earlier status notes and proposal below are historical.

> **2026-10-22 update: the status below is historical.** Lane G, acting for Cloud under
> the explicit D118 transfer, accepted Waitron proposal
> `db7cddeb2d38984b284b23e8e391e7ebd7cb9156` against Cloud pin
> `35af2d396d916223ff4f319d8f44093685d62da5`. Agreement covers the contract direction;
> no enforcement profile is qualified. Cloud's canonical integration-contract publication
> and Lane D's two wording corrections remain pending because of Lane D's D79 file reservation.
> The single Harbour Kitchen worked-example owner question is now eligible; owner design
> approval remains pending. This agreement supplies no runtime/provider qualification or build
> approval. See [A1018's current record](../../backlog/replication-cloud.md#a1018-agree-and-build-the-hosted-writer-stop-proof-contract)
> for the literal Cloud reply and remaining gates.

**2026-10-22 · PROPOSED for bilateral agreement. Lane D acceptance: pending.
Owner design approval: pending after that agreement. Publication grants no build authority.**

You must be able to move a hosted venue without leaving two servers selling from its history.
This proposal requires both a final data boundary and externally enforced retirement of the old
runtime. A signed statement from Waitron can describe stopped work; it cannot prove its signer
has exited. If either boundary is unknown, refuse continuation and ask. Owner permission to
attempt a move does not supply its missing evidence.

## 1. Brief, pins and scope

Waitron source pin: `71ea6745700bf1076eccd28c55b8e94a87411fe9` (BASE and inspected HEAD).
All source observations below are **READ ONLY / runtime UNVERIFIED**. No application, provider
or failure experiment was run. Line references are at this pin, not promises about later main.

Cloud brief: merged PR #294, `35af2d396d916223ff4f319d8f44093685d62da5`:

| Pinned requirement, in the source's words | Interpretation here |
| --- | --- |
| [Production design §3](https://github.com/waitron-io/waitron-cloud/blob/35af2d396d916223ff4f319d8f44093685d62da5/docs/superpowers/specs/2026-10-22-cloud-production-deployment-design.md#3-what-this-design-corrects-in-the-existing-proposals): “Each action's own status in the action list” | Ask-first and act-and-report select permission timing; neither waives proof. Countries have separate Clouds under a global layer. |
| Same design §9: “first obtains that proof, and if it cannot, it does not start the new server and asks instead” | Every new hosted writer after an uncertain old run needs stop proof, including an in-place replacement process. |
| Same design §12: “The stop proof's mechanism for each kind of move, with Waitron” | This is the proposed bilateral mechanism, not an accepted capability. |
| [Hosting design, Recover without creating two writers](https://github.com/waitron-io/waitron-cloud/blob/35af2d396d916223ff4f319d8f44093685d62da5/docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md#recover-without-creating-two-writers): “Prove it stopped before allowing a new writer.” | Separate application quiescence from external hard fencing and restart prevention. |

Inputs are the supplied local receipt copies of production §§3, 9 and 12 and its sibling hosting
proposal. The newer production brief governs automation and country/region placement.
A1018's explicit owner-accepted exception governs **cold restore:
a separate fresh-chain/data-loss recovery needs no stop proof**. The older hosting prose must
be reconciled with that exception during agreement, not imported as a hidden restore gate.

Scope is protocol only: hosted restarts, moves, replacement and failover. No UI, infrastructure
qualification, fiscal writer change, `computeHuella` change or restore implementation is authorised.
On-prem A947 has its own physical isolation and manager rules; hosted automation cannot inherit
an on-prem “other box is switched off” checkbox as hard-stop evidence.

## 2. Existing seams and their limits

These observations follow executable calls, rather than treating comments as capabilities:

| Source at BASE (path:line) | Observed call context and proposed gap |
| --- | --- |
| `packages/store/src/venue-lock.ts:55`, `:78`, `:104` | `lockVenueDirectory` resolves the folder, opens `venue.lock` with zero busy timeout and `begin immediate`, shares a process-local holder and closes it on last release. This names one folder, not runtimes on independent cloned disks. Retain it beneath hosted admission. |
| `apps/server/src/boot.ts:911`, `:935`, `:940` | Boot opens a stamp probe, applies migrations, then opens the long-lived store. Hosted admission must precede writable venue access and migrations, not merely the later trading listener. |
| `apps/server/src/membership-reconcile.ts:28`, `:60`; `boot.ts:1430` | Non-mirror boot with a configured peer fetches its chart; fetch failure becomes null, and null returns `superseded: false`. Boot accepts/persists a verified newer chart, then rereads membership at `:1457`. Hosted admission must refuse stale boot even when that peer cannot answer. |
| `apps/server/src/membership-fence.ts:7`; `packages/membership/src/fence.ts:7`, `:20` | Null membership and an absent standing do not fence; `sell-only` and `evicted` do. These are local document decisions, not an external stop check. |
| `apps/server/src/boot.ts:1460`, `:1490`, `:1521`, `:2527`, `:2551` | A held fence demotes the singleton role, defers restored first start and installs a read-only gate. The loop selects singleton work from the holder; fiscal drain wraps restart reset. Add hosted admission before all of these; a newer chart alone does not stop an isolated running copy. |
| `apps/server/src/promote.ts:58`, `:83`, `:169`, `:202` | Both promotion functions first check boolean `oldNodeNeutralised`. Mirror promotion prepares module operations, activates modules, checks series and commits roles/membership through `commitMirrorPromotionTx` at `:148`. Keep those module gates; the boolean is not this protocol's proof bundle. |
| `apps/server/src/boot.ts:738`, `:759`, `:2730` | `close()` calls the teardown list and logs `server.stopped`; work teardown aborts loops and awaits stream stop before store close. A repeated close returns immediately at `:760`. Neither that return nor the log is a runtime death receipt or final-head receipt. |
| `apps/server/src/rejoin-command.ts:94`, `:124`, `:139`; `rejoin.ts:39` | CLI holds the folder lock, reads held membership and calls `rejoinAsSecondary`; its fenced-standing/carrier checks precede close and wipe. This path does not compare a tail receipt. Do not use it as proposed hosted return reconciliation. |
| `apps/server/src/restore-command.ts:95`, `:151`, `:276`, `:342`, `:440` | CLI dispatches artifact/kit/pack paths; operation-file/node-recovery-key inputs configure the restore runner. Sole recovery uses selected-copy preparation, and artifact restore supplies the existing source-live check. Preserve these gates independently of A1018. |
| `apps/server/src/recovery-module-operation.ts:111`, `:138`; `operation-authentication.ts:39` | Restore runner checks module/action, then recovery-key authority checks target/action and the stored verifier, including rereading it inside commit. This recovery secret is not the membership signing key or Cloud writer authority. |

Signing vocabulary: `apps/server/src/node-identity.ts:8`, `:24`, `:39` stores the membership
private key under vault purpose `membership.node_key`, with its public half on the node row.
`packages/membership/src/crypto.ts:6`, `:14`, `:28` generates Ed25519 keys (base64 SPKI public,
PKCS8 private), signs UTF-8 bytes and verifies them. `canonicalize.ts:15` sorts object keys
recursively and preserves array order. `types.ts:23` defines endorsements and `:31` signed
membership documents. `membership-mint.ts:30` reads key/endorsement and calls the builder;
`packages/membership/src/accept.ts:12` verifies then requires a strictly newer term.
`verify.ts:100` resolves the signer against supplied trust/held membership before signature check.
These inspected functions authenticate membership; this proposal adds separate signed purposes.
The folder/recovery locks, isolation declarations and restore-key distinctions are documented in
[conventions-data.md](../../developers/conventions-data.md#one-process-per-venue-folder);
the evidence standard is [writing-claims.md](../../developers/writing-claims.md).

## 3. Choose admission without a sale-time lease

**Proposed choice:** one durable writer-grant authority per country, shared across its cells and
regions, plus an execution supervisor outside each venue's disk and application sandbox.
The authority serialises grants for each venue. The supervisor enforces starts and irreversible
runtime retirement. A runtime is one process incarnation with all its child work, not a pod name,
node id, container restart count or reusable machine address.

The authority uses a serial journal committed by a quorum, a majority of its voting replicas.
A grant or retirement is acknowledged only
after durable commit; only the quorum side may change a venue row. CAS (compare-and-swap) accepts
a change only if its expected prior revision still matches. A cell controller cannot grant from
its cached row. Losing authority prevents new grants, including restarts; an already admitted
runtime continues selling locally. No outside check on every sale and no expiring writer lease
are introduced. Tills still need connectivity to their hosted primary.

The authority journal, trust roots and retirement records live outside venue snapshots. Never
restore that authority from an older backup and resume issuing grants. Lost quorum/history means
freeze grants until authoritative history is recovered or every potentially authorised runtime
is externally retired under a separately reviewed authority recovery. No second regional authority
may be created merely because Spain's controller cannot be reached from Paris.

This is a safety/availability choice: you may wait during a control outage to avoid two writers.
It does not establish that a particular database, EKS, EC2 or sandbox meets these requirements.

## 4. Identities, evidence and signature trust

Use a versioned strict schema; all fields below are signed, with no unsigned semantic fields.
These are proposed records, not existing endpoints. Use canonical UTF-8 JSON and Ed25519 with
separate purpose strings `waitron.hosted.<record-kind>.v1`, separated from the body by a newline.
Represent counters as canonical unsigned decimal strings; disallow floats, unknown fields,
duplicate JSON keys and unbounded input. Hash canonical bodies/manifests with SHA-256.

| Record | Required bindings |
| --- | --- |
| Durable intent | Stable operation id, input digest, actor/permission decision, mode `continuation`, country/venue/Cloud installation mapping, expected authority revision, predecessor grant digest, old and selected new runtime, next writer generation, source data epoch, image/schema contract and complete potentially authorised runtime set. |
| Exact runtime identity | Provider/account/region/cell, immutable machine identity, externally attested host boot identity, supervisor identity, sandbox identity, one-use launch nonce and ephemeral runtime public key. Bind Waitron node id/key fingerprint separately. Names and disk contents cannot supply external identity. |
| Quiescence receipt Q | Intent digest, old/new runtime identities, old/new generation, held membership term/document digest, frozen data manifest H, stopped admission cut, in-flight external-work inventory and outcomes/deadlines. Signed by the enrolled old node membership key and runtime key. This reports logical quiescence, never process death. |
| Hard-stop receipt F | Same intent/runtime/generation bindings, Q digest or explicit `Q absent`, completed termination scope, observed completion, durable denial record/revision, selected successor, supervisor/provider evidence digest and qualified enforcement profile version. Signed by the independently trusted fence issuer. |
| Data receipt H | Venue/data epoch, source writer and stream generation, exact recovery artifact digest, schema/module inventory, final local commit highwater and stream segment/offset mapping, per-chain heads/counts, pending external outcomes and required node-local persistence manifest. |
| Terminal inspection receipt T | Inspector signs intent, old/new runtime/generation, F digest, terminal disk inventory and final H digest, plus Q match or explicitly invalidated earlier Q/H. F's reference to a received Q is provenance, not certification of its data boundary. |
| Grant G and activation receipt A | Continuation G binds intent, predecessor, next generation, selected runtime/key, F/T/H digests and authority revision. A binds G, target runtime, imported H, resulting membership/roles and module-operation result digests, image and activation outcome. G is authority-signed; A is target node/runtime-signed. |

The authority enrolls node keys from authenticated venue setup and pins their mapping before a
move. Never trust keys or endorsements solely because a restored source supplies them. Runtime
keys are enrolled through the qualified supervisor's attested launch, not a file in the image.
Fence issuer and authority public keys come from a separately provisioned country trust root;
application node keys cannot issue F or G. Pin issuer key ids, rotations and revocations in the
authority journal; unknown/revoked keys refuse new transitions. Preserve historical verification
keys and signed records. Timestamps aid audit; journal order and bindings decide freshness.

## 5. What counts as externally enforced retirement

Before Q is requested, the authority commits intent and denies all new launches of the old
generation, selecting exactly one successor. The old admitted process can finish quiescing;
restart denial alone does not stop it. The supervisor serialises start/stop with that denial,
terminates the exact runtime and all children, and records the terminal observation outside
the guest disk. F is issued only after completion and durable denial, never after a stop request.

Effective denial must survive old disk restoration, node-key copying, host/supervisor/controller
restart and replay of old launch material. Every launch, process restart and suspended-memory
resume needs fresh authority admission. Admission is consumed once by a supervisor tied to an
attested boot and launch nonce; it is not a transferable bearer token. Restarting the supervisor
requires reconciliation of every outstanding runtime before any new start. A stale outstanding
admission remains a potentially live writer until it is externally retired too.

The enforcement boundary must block direct launch of old images, bypass entrypoints and clones
with copied node/vault keys. Hosted workload credentials have no host, scheduler or supervisor
administration. Proposed host authentication uses a hardware-backed non-exportable supervisor
key, attested to the country authority with its boot measurement. The exact hardware trust chip
(TPM) or provider mechanism needs qualification. Runtime launch state lives outside guest snapshots;
a software nonce stored on the same recoverable disk is insufficient. Disk clones may be mounted
only in isolated non-writing inspection until fresh admission. Retain irreversible denial of
retired runtimes even after venue-disk rollback. Never “unretire” an old incarnation.

For a reachable healthy host, a qualified supervisor may attest terminated sandbox/children and
persisted denial. A host unreachable to that supervisor needs an independent provider-enforced
termination of the entire old execution domain, including prevention of later resume/reboot.
If only whole-host retirement is enforceable, do not substitute a pod stop; plan the impact on
its other venues explicitly. A provider adapter may translate authenticated provider evidence
into F only against a previously qualified profile and exact immutable resource identities.

**Qualification is required future acceptance:** name the actual primitive, trusted component,
keys, non-clonable boundary and crash/rollback tests. No provider profile is accepted here.
If the selected provider cannot demonstrate effective stop plus lasting restart denial, there
is no accepted F and no hosted continuation replacement. Refuse and ask; do not fill the gap
with the word “fenced”. Compromised enforcement hosts/authority roots are outside the assurance;
suspected compromise freezes grants pending explicit recovery, rather than asserting clone safety.

Kubernetes status, timeouts/heartbeats, pod deletion, route withdrawal, exclusive-volume attachment,
a copied membership document or possession/revocation of a node key alone never substitutes for F.
None excludes a process writing its own disk or submitting work through an independent path.

## 6. Continuation protocol and final data boundary

1. **Prepare:** persist the immutable intent by venue CAS; block competing lifecycle operations.
   Inventory every outstanding runtime/grant, including ambiguous launches and any promotable
   local peer. A pure hosted profile initially permits no independently promotable on-prem peer;
   adding one needs a joint protocol. Reject unknown peers. Preparation admission is separate from
   G: it permits isolated inspection/recovery of a private copy, with no business work or writable
   live venue mount. The selected runtime/key can be enrolled while it waits for G.
2. **Deny restart:** commit denial for the old generation and all its outstanding admissions,
   bound to this operation and successor; deliver it to the enforcement boundary. Lost completion
   is uncertain. No target may write on the strength of this step alone.
3. **Quiesce old runtime:** close mutation admission atomically with the local write queue; refuse
   new sales and all business mutations, including passive-read housekeeping, scheduled work,
   callbacks and commands. Start no new fiscal filing or external business request. Finish already
   admitted transactions, bound already-submitted requests by their existing request deadlines,
   persist answers received and record unanswered work as uncertain. Do not extend deadlines or
   treat cancellation as reversal of a remote payment/submission.
4. **Freeze and capture:** after those waits, stop every remaining mutator, including stream/local
   checkpoint writers. Hold the folder lock until process termination. Capture a consistent final
   database and required local state, export immutable H and Q outside the venue folder, and seal
   the source against further writes. Final stream publication must map exactly to H, or transfer
   the consistent artifact directly. Wall time, bucket freshness and a single chain head cannot
   stand for the complete boundary. Q must report any failure; a shutdown timeout is not success.
5. **Hard stop:** obtain F after termination and durable denial. It references Q/H when available.
   Retirement preserves the source disks, WAL and required local state for inspection; termination
   must not delete the only authoritative copy.
   In every case, an independently enrolled isolated inspector checks the terminal disk/WAL after
   F against H. Recover on a private copy without business workers. If it differs, invalidate Q/H
   and recapture the terminal boundary; T must record that invalidation. Never accept a signed but
   earlier snapshot. With no Q after a crash, the inspector signs H/T as crash recovery evidence.
   Its qualified profile must establish complete authoritative disk inventory and no later source
   writes. Missing disk or older offsite
   copy cannot establish that final head: refuse continuation. Pin the inspector's key and scope
   through the country trust root, separately from the old node key.
6. **Verify target:** independently verify F/T and the denial's current authority revision; import
   exactly H and check integrity, chain heads/counts, schema and the complete persistence inventory.
   Sign the target data receipt. Missing tail, mismatched digest or uncertain restore refuses.
7. **Grant once:** authority CAS commits G for the selected runtime at the next writer generation,
   using exact predecessor, F/T and H. Stop remains enforced throughout proof, import and grant.
   The target consumes G only through its admitted supervisor and persists G/operation outcome
   with its local activation transaction before enabling writes, filing or business workers.
   Required module preparation/authority remains Waitron's responsibility, not granted by G.
8. **Confirm then route:** reconcile signed A against G and the durable target outcome, mark active
   by authority CAS, then publish routes. A lost A is `activation uncertain`; query the same target
   and journal. Routing is neither a grant nor evidence that activation did or did not happen.

A hosted writer generation increases for every new process incarnation, including same-machine
restart. It is separate from membership term, stream generation and fiscal identity. G never
creates a fiscal identity, selects a series, reuses invoice numbers or supplies recovery authority.
For continuation, A acknowledges this runtime's admission to the preserved logical node; a new
process alone must not invoke a fresh setup, restore or promotion allocation.
Reconcile its binding with Waitron's approved module contract before building. No fiscal code is
changed by this publication. An unresolved external outcome remains recorded through handover;
only the existing domain-specific reconciliation may settle it, never blind resubmission by Cloud.

## 7. Retry, crash, stale boot and rollback

The journal records `prepared`, `restart-denied`, `quiescent` (optional), `hard-stopped`,
`data-verified`, `granted`, `active`, plus a refusal/uncertainty reason at the blocked step.
Retry of the same operation/input returns its durable result; changed input under that id
conflicts. Every outside action has intent before dispatch and retained evidence afterward.
Timeouts do not release a grant, reset a generation or permit another candidate.
Reserve writer generations monotonically in the authority; cancelled or uncertain attempts never
return their reserved number to a pool. The commit highwater in H is a proposed local write-sequence
contract, not an assertion that BASE exposes such a complete counter today.

After a crash, reload the journal and reconcile outstanding actions by exact identity. CAS
rejects stale worker completions. Once stop/denial might have happened, cancellation cannot resume
the old incarnation. To change the selected successor, close the old intent without erasing its
denials; account for every possibly launched target and prove its stop before a new intent/grant.
An unconsumed G cannot be reassigned. Failure after G requires retiring that target even when
Cloud never saw A. No distributed transaction is assumed between authority, SQLite and storage.

Hosted boot obtains fresh runtime admission before migration, restored first start, listeners,
sales, restart-reset or any filing pass. The local gate checks G against the exact live runtime;
copied membership, an old G or unavailable authority leaves the candidate non-writing. An already
running admitted process needs no periodic renewal. After its crash it is a new incarnation and
must wait. Inspecting a source clone with full node keys cannot grant it that live identity.

Disk rollback cannot roll back journal generations or denials. Never boot an older snapshot into
an already used writer generation, roll back a traded ledger or replay an old activation receipt
as present authority. This proposal does not prevent arbitrary use of stolen plaintext outside
the qualified enforcement domain; it cannot claim containment after root/key custody compromise.

## 8. Refusal by move and failure

Every continuation row requires F, terminal inspection T, final H and the selected runtime's G.

| Situation | Required evidence/path | Refusal when missing |
| --- | --- | --- |
| Planned in-place restart | Retire old process, Q/H plus F; fresh runtime and next G, same physical placement allowed. | `stop unknown`, `restart denial unknown` or `data head unknown`; no automatic bypass for “restart”. |
| Graceful machine/cell move | Q, complete final H, F, target match and next G. | Keep target non-writing; do not resume retired source. |
| Process crash, same healthy host | Supervisor proves full old process/children death and lasting denial; recover terminal disk after F; fresh G. | A free `venue.lock` alone is insufficient. Wait if supervisor identity/state or disk completeness is unknown. |
| Host partition or apparently dead machine | Independent enforced old execution-domain retirement and denial; recover complete final disk H. | No F means no continuation even if no heartbeat; no final disk means no continuation even with F. Ask. |
| Cross-cell or cross-region controller partition | Same country authority/quorum, F and H; permitted destination placement. | No new grants from a cell cache, backup journal or minority. Existing runtime keeps selling. |
| Explicit cold restore | Separate owner-accepted fresh-chain/data-loss operation and existing restore authority/key/source gates. **No A1018 stop proof.** | Refuse missing restore authority, wrong key or invalid source under those existing rules; never demand F as a new prerequisite. |
| Old runtime/disk returns | Retired identity cannot resume; isolated non-writing inspection, preserve tail, reconcile through separately approved return path. | No automatic selling/filing, wipe or tail merge from a stale chart or claimed healthy successor. |

The refusal labels above are protocol outcomes, not newly registered application error codes.
Report operation, missing evidence and safe next step without secrets; permission is never evidence.
For a new venue with no predecessor, prove initial creation in the authority journal and use normal
Waitron setup/module gates; an absent predecessor field is not enough to classify a replacement new.

Cold restore is deliberately outside continuation's single-history assurance. It may lose the
unreplicated tail and starts a fresh fiscal chain; it must be explicitly selected and authorised,
never triggered as fallback from `stop unknown`. Preserve the selected backup's recovery key,
node-recovery-key/operation gates and existing source-live/sole-recovery declarations. In BASE,
`restore-command.ts:169` supplies that check and `recovery-entry.ts:68` maps declarations;
`operation-authentication.ts:60` verifies the node recovery secret. These are not hard-stop proof.
Following the artifact call, `apps/server/src/restore.ts:875`, `:432`, `:348` validates, runs the
source check and takes the target lock; `:743` runs module restore hooks through the prepared
operation runner. `apps/server/src/restore-stream.ts:127`, `:152` implements the source checks
and their `oldBoxGone` early return. Preserve that existing declaration route, not a demand for F.
Flag a potentially returning source, retain its identity/history and plan restricted return/tail
handling without adding a hidden F requirement to cold recovery or claiming all old sources stopped.

Hosted admission must therefore also define a strict `cold-restore` intent/grant variant. It binds
the explicitly authorised recovery operation, selected backup digest/head, accepted loss and a
fresh data epoch, plus successor/runtime/generation as above; F and T are explicitly absent.
Record the displaced source as unresolved and deny its future restart, without claiming its active
process stopped. No source termination acknowledgement is required to issue this cold grant.
Initial creation likewise has its own `initial` grant variant after the new-venue check above.
Neither variant may be issued by retrying or relabelling a failed continuation intent.

## 9. Worked example

Venue “Harbour Kitchen” runs on host M1, boot B7, runtime R41, writer generation 41.
Operation O42 selects host M2, runtime R42, generation 42. Cloud records O42 and denial of
R41/41. R41 rejects a new sale, starts no filing pass, waits for its already-sent request to
its deadline and records the unanswered result in H812. It signs Q with final commit 812.
The supervisor terminates R41 and its children and signs F tied to O42, Q and R42. Independent
terminal inspection signs T confirming H812. M2 imports H812, verifies all heads/inventory,
and the authority CAS grants only R42/42. Waitron records activation A42 under its own module
rules; Cloud then moves the stable venue route.

If the controller dies after G but before A arrives, retry O42 asks R42 for its durable result.
It cannot grant R43. If M1 instead partitions before Q, a deleted pod proves nothing: O42 waits
for external retirement. Even after retirement, a bucket copy at commit 810 cannot stand for
the missing final disk. You may explicitly choose cold recovery from 810 with its existing
authority and accepted lost tail; O42 never makes that choice silently. M1's snapshot at 800
and duplicated node key cannot reopen R41 under the qualified launch/denial boundary.

## 10. A947 integration and future acceptance

[A947 §6.4](2026-10-21-a947-two-box-failover-design.md#64-the-hand-over-when-the-main-box-still-answers)
proposes stopping sales/new filing, waiting for sent work and syncing exactly the final change.
Its slice 4e is the future application quiescence seam for Q/H; it does not supply hosted F.
[A947 §7](2026-10-21-a947-two-box-failover-design.md#7-when-the-old-main-box-comes-back)
and slice 5a propose deciding the role before first filing and waiting for an unreachable spare.
Hosted admission must also resist source rollback/cloning and cannot offer the on-prem manager
override. A947's §7.1 tail reconciliation, §7.2 receipts/archive and guarded wipe remain separate
future dependencies for old return. This design neither implements them nor authorises their use.

Future bilateral acceptance must pin both implementations and the enforcement profile, then run
the following adversarial controls. **None was run for this documentation task.**

| Required scenario/assertion | Deletion or adverse control that must expose the missing guard |
| --- | --- |
| Normal move and same-host restart import exactly final H and admit one successor; active runtime sells during authority loss. | Remove per-sale authority connectivity entirely: active sales still pass; attempted new grants remain refused. |
| Old runtime remains reachable directly during pod deletion/route withdrawal/control partition; no successor sale or filing starts. | Remove the F requirement: isolated old writer plus candidate exposes overlapping writes in the rehearsal. |
| Old disk snapshot and duplicated node/vault key cannot launch or resume after denial; reboot host/supervisor/controllers too. | Remove external launch/denial enforcement: stale clone becomes runnable; merely refusing its Cloud API calls is a failed control. |
| Q signer or child remains alive: no accepted complete proof. Late mutations invalidate Q/H and require terminal recapture. | Treat Q as F: candidate starts while old work is possible. |
| Two controllers/regions race; lost replies and crashes at every persisted transition yield at most one granted runtime. | Remove expected-revision CAS or fork authority history: competing grants become observable. |
| Substitute venue, operation, destination, runtime/boot, generation, H or issuer; replay valid old receipts. | Remove each binding/verification in turn; that specific substitution must be accepted by the weakened path. |
| Missing tail, late callback, disk-full capture or source crash after Q requires terminal-state checking/recovery; uncertain requests remain recorded. | Remove post-F H equality/freeze guard: deliberately altered or stale data passes and the assertion fails. |
| Crash after G/local activation but before A; stale completion and cancelled intent cannot restart the old runtime or reassign G. | Remove durable intent/outcome reconciliation: duplicate activation or unsafe reassignment is observed. |
| Explicit authorised cold restore works without F; continuation failure never invokes it automatically. | Add an F prerequisite or fallback conversion: the respective positive/negative recovery assertion fails. |

Keep evidence of attempted sales, commits, filing starts and denied boots on both runtimes, not
just controller status. Runtime/provider qualification must exercise the actual selected stop,
launch, disk-clone and suspended-resume boundaries, including uncertain provider replies.

## 11. Bilateral decisions and the one later owner question

Lane D must agree a pinned shared contract revision covering this intent/receipt schema, one
country authority across failover regions, issuer trust and the per-move refusal matrix. D must
name a qualifying supervisor/provider retirement primitive or record that no profile qualifies.
Agree the complete final-data manifest and how runtime restart admission is enforced beneath
copied disk/key state. Reconcile the Cloud production design's restart/machine-replacement
exception with mandatory proof, and older D88 cold-restore fencing prose with A1018's exception.
Record actual agreement in both lanes' questions files through their drivers; no agreement is
asserted here and this author does not edit campaign files or another lane's repository.

**Only after Lane D agrees**, ask the owner one question, with §9's worked example:
“Do you approve requiring confirmed retirement and the final data head before every hosted
continuation, including an in-place restart, so Harbour Kitchen waits when M1 is unreachable
and retirement or its final disk cannot be established? Recommendation: yes; keep the already
accepted explicit cold restore as the separate fresh-chain/data-loss choice.”

That question has not been asked or answered here. Bilateral agreement, owner design approval,
implementation planning/build authority and provider acceptance remain distinct pending gates.
