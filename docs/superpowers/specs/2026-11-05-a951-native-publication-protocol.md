# A951 private native publication protocol

**Artifact:** `waitron-a951-native-publication-v1`
**Edition:** `proposal-2026-11-05.1`
**Status:** PROPOSED engineering companion for D cross-review. All new validation **UNRUN**. Native integration and admission **CLOSED**.

This companion proposes the private publication, acknowledgement and retained-status grammar left to E. It introduces no new permission architecture, H operation, appliance record or signed approval payload. Hash the entire UTF-8 publication, including its final LF, externally; no self-hash appears here.

## 1. Immutable inputs and scope

Inherit the complete requirements of these publications, with S’s stated incorporation boundaries and precedence. Preserve their original bytes.

| Ref | Publication                                                                                                                                                                                           | Supplied complete-file SHA-256                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S   | [Appliance successor](2026-11-05-a951-appliance-v1-successor.md), `proposal-2026-11-05.1`                                                                                                             | `5f88b065b2ac8a0c8d860dcaf195ec2abd5a8fe18d5e4c58a891c6702e71bc24` |
| H   | [Local helper](2026-10-23-a951-local-helper-v1-proposal.md), `proposal-2026-10-23.1`                                                                                                                  | `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f` |
| X   | [Host custody](2026-11-02-a951-host-custody-amendment.md), `proposal-2026-11-02.1`                                                                                                                    | `50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2` |
| Y   | [Debian 13 profile](2026-11-05-a951-debian13-host-profile.md), `proposal-2026-11-05.1`                                                                                                                | `616725294c22f06abc86d340b7206609c528b39f3ef93e38c0c0486c551dde90` |
| M   | [Cloud mapping](https://github.com/waitron-io/waitron-cloud/blob/b1a8d7cee1056a0aac14adba53e03f270ac4263c/docs/superpowers/specs/2026-11-02-a951-g1-host-custody-mapping.md), `proposal-2026-11-02.1` | `2f16bd7c01c12849897501fae3bccabb770f9db4006e917b9964573bf994a9cf` |

These are complete-file documentary identities, verified by the driver with SHA-256, not executable acceptance pins.

D582’s final disposition, relayed by the watcher at about 18:55 on 5 November 2026, has complete-file SHA-256 `c76c7cc464760f2dd511b6c26e18a9486f97b1cd533c97f4ca5544f87685c8db`. It supersedes the earlier C-to-L objection. Retain that exact local receipt with the campaign; it is not an executable acceptance pin.

Local publication **L** and Cloud consume **C** remain independent winning points. Cloud permission need not remain continuously live until L; local permission need not remain live until physical opening. Later independent safety, trust, key, stop, pin, boot and expiry checks still fence effects.

D owns receiver/body/status/error/provisioning semantics, the Cloud one-use ledger and shared signed corpus. Its acceptance of S’s policy/proof shapes and three initially unmounted adapters remains unchanged.

## 2. Canonical bytes and references

Use A’s canonical `J`, incorporated by S: compact ordered printable-ASCII JSON, exact escapes, duplicate-aware parsing, no BOM, whitespace, LF, unknown members, coercion or alternative numeric spelling.

`H` is 32 lowercase hexadecimal characters; `D` is 64. `N` is an integer from 0 through 9007199254740991; `U` starts at 1. `T=N` denotes Unix milliseconds. Fields ending `Boot` or `BootMs` instead hold suspend-aware elapsed milliseconds in the explicitly named local boot. They are never Unix times.

Definitions below describe ordered objects: every listed member is mandatory in precisely that order. `X|null` permits only X or JSON null; absent members never mean null. Arrays have exact stated lengths and ordering.

For each new private record, its reference is `SHA256(UTF8(J(record)))`, excluding LF and framing. Its mandatory schema string supplies domain separation. No extra prefix is added. Different schema strings distinguish snapshot, publication, acknowledgement, status and index domains.

Existing references retain their original algorithms:

- `localApprovalRef`, `challengeDigest`, `contextDigest`, `permitDigest`, `qDigest` and `pinsDigest` follow S §4, hashing canonical payload/record bytes without LF.
- `cloudResultEnvelopeRef` hashes **J of the complete verified response E**, including payload and signature strings, without LF. It does not hash only decoded R or decoded response payload.
- `consumedEnvelopeRef` likewise hashes the complete verified Consumed E.
- H records and M completion/envelope references retain their exact saved-byte definitions. Shared heads retain M’s `cloud-a951-shared-head-v1` domain.

Resolve references only through bounded authenticated registries under fixed opened directory handles. A digest never becomes a supplied pathname, URL, attachment location or fetch instruction. Resolve and verify the entire required dependency graph before accepting work; cycles, missing records and mismatched bytes refuse.

## 3. Exact private records

All schema values below are literal strings.

**Snapshot** has exactly these ordered members:

| Member                 | Type                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| schema                 | `"waitron-a951-native-snapshot-v1"`                                                                   |
| localApprovalRef       | D                                                                                                     |
| challengeDigest        | D                                                                                                     |
| contextDigest          | D                                                                                                     |
| permitDigest           | D                                                                                                     |
| qDigest                | D                                                                                                     |
| anchorDigest           | D                                                                                                     | null, under S’s exact anchor-null policy                                             |
| pinsDigest             | D                                                                                                     |
| policyDigest           | D                                                                                                     |
| cloudResultEnvelopeRef | D                                                                                                     |
| consumedEnvelopeRef    | D                                                                                                     |
| transactionId          | H                                                                                                     |
| transactionSequence    | U                                                                                                     |
| nextStateDigest        | D                                                                                                     |
| commits                | exactly four `[sharedHead:D,commitEnvelopeRef:D]` pairs, application/helper/verifier/supervisor order |
| completionRef          | D                                                                                                     |
| boot                   | H                                                                                                     |
| generation             | U                                                                                                     |
| intentRef              | D                                                                                                     |
| evidenceRef            | D                                                                                                     |
| planRef                | D                                                                                                     |
| activateRequestRef     | D                                                                                                     |
| invocations            | exactly eight D                                                                                       | null entries, application/caller/verifier/helper/supervisor/staff/public/probe order |
| deadlines              | Deadlines                                                                                             |

`completionRef` resolves M’s exact saved completion: transaction ID/sequence/nextStateDigest and the same four commit pairs. Recompute every head using M’s definition. Compare current `Shared(State)` and Transaction; role-local progress may advance without changing the shared head.

`policyDigest` equals the approval policy selected by S’s pin array. Every context, Permit, Q, Decision, Challenge, Consumed, result, binding, epoch, floor, S/W and generation correlation must agree under S/A’s current-versus-result rules. Preserve original Q.floors separately from Permit.minimumFloors.

Invocation references resolve X’s supervisor registry entries and actual live lifetime, cgroup, namespace, executable-closure and manager-invocation handles. The first five entries cannot be null. A worker entry may be null only when its scope is absent and no live or unfinished custody remains. Broker custody belongs to the supervisor entry.

`activateRequestRef` hashes the exact proposed canonical H.activate payload, excluding U32 framing. It fixes the verifier’s actual H ID/sequence/body. The verifier prepares and saves these exact proposed request bytes in its fixed immutable registry before capture; the supervisor resolves that proposal through the registered operation, not an app-supplied activation request. Planning does not advance an H caller floor or create an H result. An intervening H mutation that makes this sequence stale refuses this attempt; it never substitutes a new sequence into the frozen snapshot.

`planRef` names exact expected H custody-plan bytes derived from that request, ownership, Evidence and listener receipts. Saving those expected bytes in the private registry does not publish H’s helper-owned plan file. H later publishes its own identical plan during its existing activation path. No H operation is added.

**Deadlines** has exactly `wallUntil:T,approvalUntilBoot:N,responseUntilBoot:N,scopes:[Limits|null,Limits|null,Limits|null]`, in staff/public-upstream/probe order.

Each Limits is exactly `[grantBoot:N,trustBoot:N,keyBoot:N,authorityBoot:N,pathBoot:N,certificateBoot:N|null,custodyBoot:N,kernelBoot:N]`. Null certificate time is permitted only for the non-TLS probe. A null scope grants nothing.

Copy first-saved deadlines from authenticated original evidence. `wallUntil` is the earliest applicable original Permit/Decision/Challenge/response wall expiry. The approval and response boot deadlines retain their original local conversions. Scope limits retain independent original authority expiries, including the early kernel closure reserve. Retain underlying evidence containing individual absolute expiries. Never compare another host’s elapsed clock to this boot.

**Publication** is exactly:

`schema:"waitron-a951-native-publication-v1",snapshotRef:D,publishedMs:T,publishedBootMs:N`.

**Acknowledgement** is exactly:

`schema:"waitron-a951-native-ack-v1",publicationRef:D,snapshotRef:D,supervisorInvocationRef:D,acceptedBootMs:N`.

It acknowledges durable acceptance of the exact publication. It is neither H’s custody acknowledgement nor proof of network activation.

**Status** is exactly:

`schema:"waitron-a951-native-status-v1",publicationRef:D,ackRef:D,phase:Phase,helperReceipt:D|null,scopes:[Outcome,Outcome,Outcome],observedBootMs:N,reason:Reason|null`.

`helperReceipt` is SHA-256 of the exact saved complete canonical H response payload, excluding its U32 framing and LF. It resolves the full response, not just its `result`, an arbitrary log or an application assertion. Match its original H.activate ID/sequence, node/generation/intent, boot, plan/armed custody acknowledgement and every requested scope’s S/W and immutable deadlines to Snapshot. Copy each scope’s network/listener outcomes from that retained read-back result.

Phase is `published|completed|closed|uncertain`. Outcome is exactly `[network,listeners]`, using H’s unchanged network and listener enums. Initial published status uses null helperReceipt and three `["unknown","pending"]` outcomes. Completed requires the exact successful H.activate `ok|replayed` response, verified post-effect/read-back and current protected-head/custody checks. Every requested scope must have `phase=active`, `network=observed_active` and `listeners=ready_verified`; omitted scopes grant nothing and retain their separately reported outcomes. A refusal before effects may produce closed; unknown or partial effects require uncertain. Closed alone does not assert verified removal.

Reason is exactly `invalid_schema|unauthenticated|unaccepted_dependency|conflict|unknown|expired|stopped|changed_state|retired_invocation|busy|capacity|persistence_failed|readback_failed|deadline`. Published/completed require null reason; closed/uncertain require a reason. No free-form error or person/session reference is returned.

## 4. Private ingress and closed control messages

Use X’s existing native caller and supervisor services. Add no service. The supervisor creates `/run/waitron-a951/supervisor/publication.sock`, root-owned, group 9510, mode 0660, in its protected directory. Expose a constrained socket-only mount to the registered native caller; the app receives no supervisor-directory access.

The supervisor creates a private application-to-caller request pipe and caller-to-application response pipe through trusted launch plumbing. These persistent feeder pipes are bound to the same application and native-caller invocations; retirement or loss of either closes both pipes and cancels outstanding work. They carry length-framed messages, one request in flight and no queued requests. EOF closes the feeder, rather than terminating each message. A partial frame times out and closes it. The caller forwards only the closed messages below. It cannot select service identities, commands, paths, process IDs, descriptor rights or signing purposes.

The application supplies a trusted **server assertion** about permission and persistence. Kernel-native peer authentication establishes the native caller’s identity and lifetime, not the person’s permission or the truth of that assertion. A supervisor receipt cannot prove server persistence against server compromise. S’s owner-selected exception remains limited to local approval for the legitimately provisioned binding.

Apply X’s current registry, connector lifetime, cgroup/namespace handles, executable closure and manager-invocation checks before parsing, before persistence and before any effect. UID, PID, unit strings and inode equality are insufficient. Connected channels cannot fork, export, borrow or import descriptors. Reject ancillary data; launch plumbing grants no request-time FD capability.

For each complete feeder request, the same registered native caller makes a fresh supervisor socket connection. That connection carries one `U32BE(length)||J(request)`, mandatory write EOF, one framed response, then close. Extra bytes or missing EOF cause no requested effect. No connected descriptor is reused, retained between requests or transferred. The persistent feeder carries the same length-framed request/response bytes without per-message EOF; the native caller does not accept another feeder request until it has written the prior response. Extra queued input refuses and closes the feeder.

Request has exactly `v:1,frame:H,op,body`:

| op      | Exact body                                                      |
| ------- | --------------------------------------------------------------- |
| capture | `localApprovalRef:D,challengeDigest:D,cloudResultEnvelopeRef:D` |
| publish | Publication itself                                              |
| status  | `localApprovalRef:D,publicationRef:D`                           |

Response has exactly `v:1,frame:H,result`, echoing frame. Result is exactly one of:

- `["captured",Snapshot]`
- `["acknowledged",Acknowledgement]`
- `["retained",Publication,Acknowledgement,Status,current]`, where current is `unchecked|retired`
- `["unknown"]`
- `["refused",Reason]`

Malformed framing or unreliable correlation closes without response. Status and capture cannot activate anything.

Private payload limits are request 1–16384 bytes and response 1–8192. Each standalone private record/message has depth at most six, 64 total object members, arrays at most eight items and decoded strings at most 128 ASCII bytes. Referenced A/H records are not embedded or parsed under these private shape limits.

Use absolute bounds: complete request/EOF within 1000 ms of accept; processing/read-back within 2000 ms of complete request; response write within 500 ms. Each feeder message uses the same absolute bounds from its first header byte, with processing measured from complete request and response write from response start; an idle feeder holds no request slot or authority. Neither a feeder retry nor a new native socket restarts an outstanding operation’s deadline. Progress, retries and queueing never extend a deadline. Retain H’s two ordinary slots, ordinary rate and priority-closure bypass for this private ingress; no additional aggregate concurrency allowance is created. H.helper.sock, its five operations and every H numerical/schema/EOF requirement remain unchanged.

## 5. Publication L and durable acceptance

Capture occurs outside database, control and pending-operation turns. The supervisor resolves original proofs, M completion, expected H plan and current invocations, then saves one immutable Snapshot with guards closed.

Immediately before L, the server takes S’s bounded pending step and existing serialized database write turn. It freshly resolves the original session and active person, idle eligibility and current `system.manage`, without touching lastSeenAt. It compares the exact snapshot, original deadlines, pins/policy, binding, floors/history, stops/withdrawals, holds and locally available participant read-back/current protected views. Missing comparison evidence refuses.

There is no RPC, signer, helper, participant or control wait inside that turn. A concurrently changed protected head remains independently fatal at native use.

Persist the exact Publication through temporary write, file sync, rename, directory sync and byte read-back while the permission turn still excludes other revocation commits. Release only after the database turn succeeds. Successful publication persistence in that successful turn is L. Local revocation committed before L wins; later login/logout/idle/role changes create no transport latch.

Database and file persistence are separate durability domains. A crash or failed database completion after file sync leaves ambiguity closed; a surviving file alone cannot establish successful L. Do not forward it after restart by inference. No invented database-commit authentication is available to the caller. If a new table is required, A1308/A760 holds that implementation.

After release, forward Publication. The supervisor independently compares current protected heads, complete evidence, boot, invocations, pins/policy, trust, stops and original deadlines. Persist Publication, exact Acknowledgement and initial Status before reply or permitting subsequent effects. Failed persistence produces no success. The server saves the exact acknowledgement before clearing its pending acknowledgement state.

## 6. Effects and historical status

Only the verifier requests H.activate. It sends the snapshot’s exact request; H saves its real incoming caller floor/pending bytes without PP pre-consumption. H publishes the matching plan, then the supervisor validates publication and current independent gates before producing H’s exact armed custody acknowledgement. H’s 500 ms acknowledgement bound is unchanged.

The private Acknowledgement precedes this path; completed Status follows actual H effects and separate network/listener read-back. Thus no completed receipt is required before the effect it describes.

After effects, recheck protected heads, floors and custody acknowledgement, then durably save Status. Follow inherited Report/Cloud acknowledgement ordering separately. Uncertain persistence or partial effects close and use inherited reconciliation; never roll floors or spend back to pending.

Every original deadline expires at equality. Waits, replay and status never refresh conversions, observation times or expiry. One-shot approval deadlines govern this initial publication/effect attempt; completed establishment’s later renewal follows A/M, without a continuing login requirement.

Status returns retained historical bytes only. It performs no repair, activation or fresh network/listener read-back. `unchecked` explicitly supplies no current admissibility claim; retired marks invalid original boot/invocations. Historical completed status may survive while every current gate is closed. Restart discards old handles and cannot arm an old plan; intact revalidation requires M’s separate fresh evidence.

## 7. Replay, retention and capacity

Stable identity is the original installation/requestSequence resolved from Q, bound to localApprovalRef and challengeDigest. Connection frame IDs are disposable correlation only. Different frame IDs or client request IDs cannot create another spend, timeout or operation.

The private replay index is exactly `schema:"waitron-a951-native-index-v1",bindingDigest:D,floor:N,entries:Entries,pending:Entry|null`. bindingDigest hashes S’s fixed channelBinding. Entries contains at most eight Entry arrays. Entry is exactly `[requestSequence:U,localApprovalRef:D,challengeDigest:D,cloudResultEnvelopeRef:D,snapshotRef:D,publicationRef:D|null,ackRef:D|null,statusRef:D|null]`.

Provision its explicit initial floor; absence never means zero. Persist floor/index changes before returning newly captured work. Retain eight completed results when available; one pending capture may coexist. Refuse growth that cannot retain required results. Preserve referenced unresolved evidence independently within the same budget.

An Entry in `entries` with null publicationRef, ackRef and statusRef is a terminal unpublished capture. On original expiry, retired invocation or independently verified invalidation, move an unusable pre-publication Entry durably from `pending` to `entries`, preserving its snapshot and floor. Do this only when no publication or effect remains unresolved; uncertain work stays held for reconciliation. Capture replay may return its original snapshot as historical evidence only. Publish for that terminal Entry returns `["refused","changed_state"]`, never a new publication. The freed pending slot may accept a genuinely new authorised operation above the preserved floor.

Identical capture/publish replay returns the original snapshot/acknowledgement; status returns the latest exact durably retained Status. Changed bytes at retained identity conflict. Missing, evicted, corrupt, rolled-back or ambiguous references return unknown, never recreate authority. Permanent inherited floors and history survive eviction.

M’s single aggregate journal remains **262144 bytes**, including the **16384-byte emergency reserve**; ordinary peak is at most **245760**. Count all four participants’ aggregate bookkeeping, new records/indexes, framing, retained results, pinned evidence, live metadata and old/new/temp writes.

For each proposed operation reserve:

`peak = retained live bytes + simultaneous staged/new bytes + framing/index/phase bookkeeping + outstanding completion/cleanup reservations`.

Count each simultaneously live copy. Derive lengths from actual serialized bytes before writing; reserve future bounded completion growth before work. Schema-valid oversized work refuses. No maximum-fit test is claimed.

Each independent complete safety copy, including staged copies, remains separately at most 65536 bytes. Safety temporary-file bookkeeping charges the journal as M requires. No extra allowance, history truncation or floor eviction is introduced. Exhausted reserve or disk failure closes without durable-success claims.

## 8. Required evidence and publication boundary

All host mechanics above are proposed requirements **UNRUN**, not external Linux guarantees. Future verification must retain positive, negative, individually failing deletion/bypass control and restored-positive evidence for:

- Exact canonical bytes, every nullable union, digest domain, envelope-versus-payload distinction and correlation; changed Q.floors, plan, policy, head or invocation must fail.
- Same bytes under different frame/client IDs, retained conflicts, eviction, missing index, lost EOF and lost replies; zero second spend/effect and unchanged deadlines.
- Crash at every file sync, rename, directory sync, database completion, acknowledgement and effect/status boundary; disk full, rollback and mixed stores must remain closed.
- Caller death, borrowed descriptors, frozen roles, supervisor restart, reboot and retired invocations; old status must never reattach handles.
- Permission loss before L, after L without a login latch, independent C ordering, stop/head races, key/trust revocation and equality expiry.
- Actual serialized peak accounting and full-budget priority closure, with network and listener outcomes measured separately.

| Dated provenance                                           | Exact quotation                                                                                                                | Scope                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Owner 18:10 relay, 5 November 2026, reproduced in S §9     | “for v1, trust the Waitron server's own current-permission check.”                                                             | Preserve existing database/ingress/TLS ownership.                     |
| Current D disposition after watcher 18:40, 5 November 2026 | “D accepts L as the final local one-shot authorization publication boundary.”                                                  | L is the local winning point.                                         |
| Same D disposition                                         | “D does not require Cloud permission to be continuously live at L or local permission to be rechecked until physical opening.” | No distributed permission commit or stronger exclusion is introduced. |

Preserve the exact inherited empty 83-byte production manifests and `.local` independence. Add no location, table, migration, fiscal change, provider action or host action.

Record matching agreement on this exact companion’s full-file digest, permitted scope and both full executable consumer commits in both ledgers before native integration; verify the companion against the root-provisioned accepted contract registry at launch. This adds no row or field to S’s fixed signed pin array.

This is a documentation milestone for fresh review and subsequent docs-only publication, not partial-foundation finishing, push, PR, landing or runtime acceptance. Accepted executable consumers and qualified runtime pair remain **NONE**; admission remains **CLOSED**.

**D agreement on this exact private grammar is required before native integration. No new product-owner question is opened.**
