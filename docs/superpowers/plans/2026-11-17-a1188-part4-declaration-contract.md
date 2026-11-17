# A1188 part 4: PROPOSED declaration-confirmation contract

When the venue's box has died, a staff member must be able to declare the emergency inside the locked copy without an uncertain Cloud reply starting a second operation. This proposes only design §9 item 8 for agreement with Lane G. It supplies no implementation plan or authority to activate.

**Ask:** "when the venue's box has died, the venue can be started in Waitron Cloud (emergency start)." Recorded in Lane J `queue.md`, A1188, and the [design](../specs/2026-10-29-a1188-cloud-emergency-start-design.md).
**Clearance:** WATCHER, Lane J `questions.md`, 2026-11-17 21:52: "Yes: draft the Waitron side of the part 4 declaration-confirmation contract (design §11, §9 item 8) as a short proposal with examples, publish it to lane G in its questions.md as you did for the purpose-key input, and settle it together; no executable activation plan until G agrees. Shipped locked page and fiscal gates unchanged."
The watcher cleared drafting and publication to Lane G; Claude reviews the proposal before that handoff. Neither G's agreement nor owner approval of these proposed values is claimed.

## One stored declaration, one Cloud command

Use machine-v1 POST `/api/installations/emergency-copy-confirm`, action `emergency-copy-confirm`, with the existing authenticated `{payload,signature}` transport. Only the fresh copy installation named in the stored copy operation may call it. Browser Origin requests, source installations and other copies cannot confirm or read its result. Reuse part 3's authentication, post-lock checks, errors, shared budgets and size/time bounds unchanged. The request body remains capped at 4,096 code units; actor-name/reason bounds below are proposed wire bounds, not a claim about existing staff-name validation.

The signed body has exactly `{version:1,copyOperationId,bindingFingerprint,declaration}`. Cloud resolves the complete, immutable `EmergencyCopyBinding` from its stored operation, including venue/environment, both nodes/installations, selected stream/generation/database digest and fixed start/deadline. It accepts no caller-selected replacement binding. `bindingFingerprint` is the lowercase SHA-256 fingerprint of Waitron's unchanged local `HandoverBinding`; Cloud retains it as opaque evidence, not independently verified membership authority. Waitron checks that local binding against the held trusted venue/membership, with the same operation id and source/copy nodes. Do not send a second copy of that binding or hash.

`declaration` is a separately defined Cloud message document with exactly these fields:

| Field | Proposed value |
| --- | --- |
| `wordingVersion`, `locale` | `"a1018-emergency-v1"`; `"en"` or `"es"` |
| `statements` | Exactly `{sourceSwitchedOff:true,noParallelRecovery:true,missingTailAccepted:true}` |
| `reason` | Nonblank reason, at most 500 code units |
| `lastChangeAtMs` | The checked copy's finite last-change milliseconds or explicit `null`; Cloud already binds its exact database digest through the stored copy operation |
| `actor` | Exactly `{personId,displayName,method}`; the stored person UUID/name (1–200 code units), `"password+totp"` or `"password+recovery-code"` |
| `declaredAtMs` | Finite milliseconds when Waitron records the declaration |

This is new versioned Cloud confirmation evidence, not an extension of local `Declaration` or `waitron.handover.declaration.v1`. In particular, do not invent a Cloud source variant inside local `lastCopy`, change local `provider:null`, or treat local v1's retry comparison as actor binding. Cloud checks the message's consistency against its stored copy/installation mapping; Waitron independently checks the venue and membership facts against its held trusted state.

Waitron checks the person's active account, `node.manage`, both factors and sign-in age strictly under ten minutes before recording. It records this exact declaration and any recovery-code consumption before sending. The actor comes from that sign-in, never the browser's chosen id. Cloud validates field shapes and stores Waitron's attestation; it does not compare the two machines' clocks or independently recheck actor freshness. Declaration/copy times deliberately retain local millisecond numbers; Cloud response times use canonical ISO UTC strings.

Keep this evidence immutable. Hash the complete message body, using existing canonical JSON and lowercase SHA-256, as `commandSha256`. Use Cloud's command-fingerprint and reconciliation conventions, with command kind `emergency-copy-confirm`; this proposes no new table or general authorisation bridge. Retain the exact actor, declaration, copy and local binding together. A transport proof gets a fresh request UUID and timestamp on retry, distinct from the copy operation UUID; those transport values are outside the command hash.

Never send a password, TOTP value, recovery secret, locked-session cookie or backup key to Cloud. The actor fields attest to Waitron's completed check; Cloud's installation credential authenticates the sender only. Cloud owns consent to its services. Neither its yes nor that credential grants fiscal authority or makes an unknown membership key trusted.

## Admission, expiry and replies

Before recording, Waitron obtains part 3's fresh status read; failure, closed/unavailable eligibility, future contact or source contact age 0–120 seconds inclusive refuses. Unknown contact alone does not refuse and never proves shutdown. At first confirmation, Cloud rechecks the same eligibility/contact facts from current stored state, under the same venue turn as its deadline decision. An earlier open response cannot authorise a later closed request.

Cloud confirms only while its decision time is strictly before stored `expiresAt`. Confirmation and expiry use the same serialised venue decision. A durable confirmation wins even if its reply is lost; expiry first refuses an unconfirmed operation without a charge-start record or writer grant. Arrival at the HTTP listener is not confirmation. The copy cannot trade while the reply is uncertain.

**Proposed simpler decision for G:** one durable service confirmation, with no separately admitted/pending state. It records the original actor/declaration/command digest, one charge start, one owner notification to send, effective withdrawal of the source's remote access and backup writes, and reservation of the copy's fresh backup generation. Charge start is that confirmation time. Mail is queued once for sending at once; SMTP acceptance and inbox delivery do not gate trading, and this response promises neither. A retry never adds a second charge-start or logical owner notification.

A queued source-withdrawal request is insufficient: before returning confirmed, Cloud must establish that the source can no longer use its old remote route or write with existing backup authority, including previously admitted access. This does not prove that the box stopped selling locally. **G must identify the actual withdrawal consumers and agree whether this single service decision is feasible before either lane treats the proposal as agreed.** If an external withdrawal cannot meet that boundary, G must propose the smallest reconciliation change; do not hide an external effect inside a claimed database transaction.

The closed confirmation answer is exactly `{version:1,copyOperationId,commandSha256,confirmedAt,writerGeneration}` with HTTP 200. `confirmedAt` is the original canonical UTC millisecond instant. `writerGeneration` is exactly `{streamId,generation}`: `streamId` equals the stored source stream id; `parseGenerationName(generation).nodeId === copyNodeId`, and the generation differs from the source's. Its write target is isolated to that new generation; no source generation or copied pointer may be overwritten or moved backward. The answer contains no bucket credential. Provision a writer only after confirmation and restrict it to that target; fiscal activation still has its own gates.

A definite unconfirmed refusal is HTTP 409, exactly `{version:1,copyOperationId,reason,closedReason}`. `closedReason` is the existing part 3 closure reason only for `eligibility_closed`, otherwise null. After existing transport/stored-key authentication, order decisions as follows: (1) a body inconsistent with the stored copy/installation, or a changed body against an already confirmed command: `input_conflict`; (2) identical already confirmed command: replay HTTP 200; (3) decision time at or beyond expiry: `copy_expired`; (4) known eligibility closure: `eligibility_closed`; (5) unavailable eligibility or future source contact: `state_unavailable`; (6) source age 0–120 seconds inclusive: `source_recent`; otherwise confirm. Never use the new body's digest to describe the original confirmed result on conflict.

A definite 409 means that submitted command was not confirmed; its result may be rechecked before expiry after eligibility/contact recovers. Waitron retains its already recorded declaration unchanged. Its original actor can sign in again to retry the same declaration; renewed sign-in facts are not part of the immutable Cloud command. This removes Cloud's proposed `authentication_expired` refusal and needs no replacement declaration, new operation id or mutation of local v1 evidence. A different actor cannot rewrite that recorded declaration. Before any local declaration exists, a fresh permitted person may make it normally.

Resend the identical stored body with a fresh transport proof to resolve a timeout or lost reply. A confirmed command replays before expiry/initial eligibility checks, subject to current installation access checks; no second charge or new operation. Transport failure, installation-authentication failure or an unavailable read does not prove non-confirmation. A restarted resolver reads the saved declaration instead of reconstructing it from the new sign-in. Do not start another copy while the outcome is unknown.

Waitron declaration/recovery-code writes and Cloud's service decision are separate commits; local venue/node writes also cross databases. Local persistence failure prevents submission. G must qualify the effective withdrawal boundary and every external reconciliation before implementation is cleared. There is no claimed atomic transaction across those systems, no provider deployment, and no money collection in this proposal.

## Small shared examples

These are illustrative fixtures, not tested vectors. `O` is `d706194d-c1bc-4f48-8275-4fe8c4583990`, with a stored copy expiring at `2026-11-17T21:30:00.000Z`. `F` is the opaque local binding fingerprint. `D` holds the table's exact declaration fields for Nora, a password+TOTP sign-in checked by Waitron, a 21:21 declaration, three true statements, reason `"Box power supply failed"` and the accepted last-change time. `Q` denotes SHA-256 of the complete canonical message body.

```text
1. At 21:22: POST {version:1,copyOperationId:O,bindingFingerprint:F,declaration:D}
   200 {version:1,copyOperationId:O,commandSha256:Q,confirmedAt:"2026-11-17T21:22:00.000Z",writerGeneration:{streamId:S,generation:G}}
   S is the stored source stream; G is a fresh generation naming the copy node.
2. Confirmation at 21:29:59.999, reply lost; identical POST with fresh proof at 21:30:01.
   Return the original 200/Q/confirmedAt/generation. No new charge or copy; recover that confirmed operation as specified below.
3. No confirmation yet; decision time is exactly 21:30:00.000.
   409 {version:1,copyOperationId:O,reason:"copy_expired",closedReason:null}; no charge or writer grant.
4. After example 1, change D.actor.personId, F, reason or another declaration field.
   409 {version:1,copyOperationId:O,reason:"input_conflict",closedReason:null}; the original confirmed command/result stays intact.
5. Fresh pre-read was open, but before confirmation consent closes or source contact becomes 60 seconds old.
   409 eligibility_closed (with its existing closedReason) or source_recent (closedReason:null).
   Before expiry the same actor can reauthenticate and retry the unchanged declaration after recovery; no new operation is needed.
```

## Agreement boundary and sources

G is asked to agree this single-confirmation boundary, exact fields, refusal order and replay, subject to identifying the actual source-withdrawal consumers. Pin both revisions and exact shared vectors after agreement. This document gives neither an executable activation plan nor permission to build.

**Concrete part 3 amendment proposed for G:** before confirmation, allow only `control`, `emergency-copy-status` and the new `emergency-copy-confirm`; retain the original deadline/lease cap and stop for an unconfirmed operation. After durable confirmation, cancel that operation's 30-minute disposal; permit the same three actions for resolution with normally renewed control leases of at most one hour, without the old copy-deadline cap. Other serving actions and writer credentials remain unavailable until later activation. Expired leases never become valid merely because a command was confirmed.

Cloud's launcher may recover a lost reply or crash by reading its durable confirmation and relaunching **only that confirmed operation**, with the same identities, placed databases, original declaration and selected copy. It must reconcile whether activation already occurred, never overwrite a potentially activated database by placing again. An expired unconfirmed operation never relaunches. A code submission while a confirmed operation is unresolved reuses it and creates no second copy or launch allowance; after activation it goes to that operation's result. The copy cannot trust an expired binding on its own: future entry changes must resolve Cloud's stored confirmation before overriding a locked-only expiry refusal. These are contract requirements for a future build; the shipped hard stop/entry behavior is unchanged.

House clock rules supersede the historical AEAT checks in design §§6/10: use the synchronised internet time service or protected confirmation of the person's device, never an AEAT time read. Keep the existing clock, membership, fiscal identity and allocation gates. Activation, return query/item 10, hosted enrolment and money movement remain outside this contract; existing hosted activation is not assumed reusable.

Source inspection only: Waitron `132e62ae5384c040392aee914dce1830d03e24bc`; Cloud contract/source pin `620db37b0692fcf236870023fd684b647f823722`, read locally from `~/workspace/repos/waitron-cloud`. No runtime checks were run.

| Source | Exact words | What they establish |
| --- | --- | --- |
| Ask and watcher clearance quoted above | "no executable activation plan until G agrees" | Draft/publication only; joint agreement and build clearance remain. |
| [Design §9 item 8](../specs/2026-10-29-a1188-cloud-emergency-start-design.md#9-what-waitron-needs-cloud-to-agree) | "the same id and inputs return the stored result" | Retry requirement; the fields above are proposed. |
| [Cloud pinned contract, A1188 disposition](https://github.com/waitron-io/waitron-cloud/blob/620db37b0692fcf236870023fd684b647f823722/docs/waitron-integration-contract.md#disposition-of-a1188s-remaining-cloud-requests), lines 2423–2425 | "Bind one durable operation to the actor, selected copy and exact declaration." | Agreed direction, not this message or implemented effects. |
| Same pin, part 3 and A1018 answers, lines 2452–2461 and 2573–2601 | "only lease renewal (`control`) and `emergency-copy-status`"; "without adding Cloud fields to that local binding" | Allowlist needs amendment; local binding stays unchanged. |
| [Local declaration](../../../apps/server/src/handover-emergency-api.ts), lines 96–108, 552–633; [envelope](../../../packages/handover/src/envelope.ts) | `provider: null`; `purpose !== purposeOf(kind)` | Local schema/purpose are distinct; local retry comparison omits actor. |
| [Locked entry](../../../apps/server/src/cloud-locked-start.ts), lines 121–171; [copy binding](../../../apps/server/src/emergency-copy-binding.ts) | `armStop(expiry)`; `expires - Date.parse(startedAt) !== LIFETIME_MS` | Shipped stop and immutable thirty-minute binding are not cancelled by this document. |
| [Clock rules](../../developers/conventions-data.md#an-installation-names-minute-waits-refusals-and-repeats) | "we should never just accept another device's match automatically" | Protected confirmation supersedes the historical clock proposal. |
