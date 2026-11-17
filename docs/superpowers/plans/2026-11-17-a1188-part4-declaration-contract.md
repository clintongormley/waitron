# A1188 part 4: PROPOSED declaration-confirmation contract

When the venue's box has died, a staff member must be able to declare the emergency inside the locked copy without an uncertain Cloud reply starting a second operation. This proposes only design §9 item 8 for agreement with Lane G. It supplies no implementation plan or authority to activate.

**Ask:** "when the venue's box has died, the venue can be started in Waitron Cloud (emergency start)." Recorded in Lane J `queue.md`, A1188, and the [design](../specs/2026-10-29-a1188-cloud-emergency-start-design.md).
**Clearance:** WATCHER, Lane J `questions.md`, 2026-11-17 21:52: "Yes: draft the Waitron side of the part 4 declaration-confirmation contract (design §11, §9 item 8) as a short proposal with examples, publish it to lane G in its questions.md as you did for the purpose-key input, and settle it together; no executable activation plan until G agrees. Shipped locked page and fiscal gates unchanged."
WATCHER 22:10 cleared the correction: "one confirmed answer, no mail-provider gate, no redundant fields; Waitron owns actor freshness" and publication to G, including G qualifying source access/write withdrawal (Lane J `questions.md`, 17 November). Neither G's agreement nor owner approval of these proposed values is claimed.

On 17 November at 23:10, the watcher limited the agreement to the confirmation request, replies, expiry and replay. Effective withdrawal of the source's remote access and backup write authority remains a condition of a confirmed reply.

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

Keep this evidence immutable. Hash the complete message body, using existing canonical JSON and lowercase SHA-256, as `commandSha256`. Use Cloud's command-fingerprint and reconciliation conventions, with command kind `emergency-copy-confirm`; this proposes no new table or general authorisation bridge. Retain the exact actor/declaration and local binding fingerprint with Cloud's stored `EmergencyCopyBinding`. A transport proof gets a fresh request UUID and timestamp on retry, distinct from the copy operation UUID; those transport values are outside the command hash.

Never send a password, TOTP value, recovery secret, locked-session cookie or backup key to Cloud. The actor fields attest to Waitron's completed check; Cloud's installation credential authenticates the sender only. Cloud owns consent to its services. Neither its yes nor that credential grants fiscal authority or makes an unknown membership key trusted.

## Admission, expiry and replies

Before recording, Waitron obtains part 3's fresh status read; failure, closed/unavailable eligibility, future contact or source contact age 0–120 seconds inclusive refuses. Unknown contact alone does not refuse and never proves shutdown. At first confirmation, Cloud rechecks the same eligibility/contact facts from current stored state, under the same venue turn as its deadline decision. An earlier open response cannot authorise a later closed request.

Cloud confirms only while its decision time is strictly before stored `expiresAt`. Confirmation and expiry use the same serialised venue decision. A durable confirmation wins even if its reply is lost; expiry first refuses an unconfirmed operation without a charge-start record or generation reservation. Arrival at the HTTP listener is not confirmation. The copy cannot trade while the reply is uncertain.

**Proposed simpler decision for G:** one durable service confirmation, with no separately admitted/pending state. It records the original actor/declaration/command digest, one charge start, one owner notification to send, effective withdrawal of the source's remote access and backup writes, and reservation of the copy's fresh backup generation. Charge start is that confirmation time. Mail is queued once for sending at once; SMTP acceptance and inbox delivery do not gate trading, and this response promises neither. A retry never adds a second charge-start or logical owner notification.

A queued source-withdrawal request is insufficient: before returning confirmed, Cloud must establish that the source can no longer use its old remote route or write with existing backup authority, including previously admitted access. This does not prove that the box stopped selling locally. **G must identify the actual withdrawal consumers and agree whether this single service decision is feasible before either lane treats the proposal as agreed.** If an external withdrawal cannot meet that boundary, G must propose the smallest reconciliation change; do not hide an external effect inside a claimed database transaction.

The closed confirmation answer is exactly `{version:1,copyOperationId,commandSha256,confirmedAt,writerGeneration}` with HTTP 200. `confirmedAt` is the original canonical UTC millisecond instant. `writerGeneration` is exactly `{streamId,generation}`: `streamId` equals the stored source stream id; `parseGenerationName(generation).nodeId === copyNodeId`, and the generation differs from the source's. Its write target is isolated to that new generation; no source generation or copied pointer may be overwritten or moved backward. The answer contains no bucket credential. Confirmation reserves that generation only; activation provisions writer credentials restricted to it, through the existing fiscal gates.

A definite unconfirmed refusal is HTTP 409, exactly `{version:1,copyOperationId,reason,closedReason}`. `closedReason` is the existing part 3 closure reason only for `eligibility_closed`, otherwise null. After existing transport/stored-key authentication, order decisions as follows: (1) a body inconsistent with the stored copy/installation, or a changed body against the first authenticated, well-formed, binding-consistent confirmation command: `input_conflict`; (2) identical already confirmed command: replay HTTP 200; (3) decision time at or beyond expiry: `copy_expired`; (4) known eligibility closure: `eligibility_closed`; (5) unavailable eligibility or future source contact: `state_unavailable`; (6) source age 0–120 seconds inclusive: `source_recent`; otherwise confirm. Cloud retains that first command fingerprint even on a definite precondition refusal; only the identical body can be rechecked. This preserves the existing “changed inputs conflict” rule before and after confirmation. Never use the new body's digest to describe the original confirmed result on conflict.

A definite 409 means that submitted command was not confirmed; its result may be rechecked before expiry after eligibility/contact recovers. Waitron retains its already recorded declaration unchanged. Its original actor can sign in again to retry the same declaration; renewed sign-in facts are not part of the immutable Cloud command. After `source_recent`, show the latest contact and require that actor to confirm all three statements again before resending; sign-in alone is insufficient. This is a local gate, not a change to the recorded Cloud command. This removes Cloud's proposed `authentication_expired` refusal and needs no replacement declaration, new operation id or mutation of local v1 evidence. A different actor cannot rewrite that recorded declaration. Before any local declaration exists, a fresh permitted person may make it normally.

Resend the identical stored body with a fresh transport proof to resolve a timeout or lost reply. A confirmed command replays before expiry/initial eligibility checks, subject to current installation access checks; no second charge or new operation. Transport failure, installation-authentication failure or an unavailable read does not prove non-confirmation. A restarted resolver reads the saved declaration instead of reconstructing it from the new sign-in. Do not start another copy while the outcome is unknown.

Waitron declaration/recovery-code writes and Cloud's service decision are separate commits; local venue/node writes also cross databases. Local persistence failure prevents submission. G must qualify the effective withdrawal boundary and every external reconciliation before implementation is cleared. There is no claimed atomic transaction across those systems, no provider deployment, and no money collection in this proposal.

## Small shared examples

These are illustrative fixtures, not tested vectors. `O` is `d706194d-c1bc-4f48-8275-4fe8c4583990`, with a stored copy expiring at `2026-11-17T21:30:00.000Z`. `F` is the opaque local binding fingerprint. `D` holds the table's exact declaration fields for Nora, a password+TOTP sign-in checked by Waitron, a 21:21 declaration, three true statements, reason `"Box power supply failed"` and the accepted last-change time. `Q` denotes SHA-256 of the complete canonical message body.

```text
1. At 21:22: POST {version:1,copyOperationId:O,bindingFingerprint:F,declaration:D}
   200 {version:1,copyOperationId:O,commandSha256:Q,confirmedAt:"2026-11-17T21:22:00.000Z",writerGeneration:{streamId:S,generation:G}}
   S is the stored source stream; G is a fresh generation naming the copy node.
2. Confirmation at 21:29:59.999, reply lost; identical POST with fresh proof at 21:30:01.
   Return the original 200/Q/confirmedAt/generation without a second charge.
3. No confirmation yet; decision time is exactly 21:30:00.000.
   409 {version:1,copyOperationId:O,reason:"copy_expired",closedReason:null}; no charge or generation reservation.
4. After example 1, change D.actor.personId, F, reason or another declaration field.
   409 {version:1,copyOperationId:O,reason:"input_conflict",closedReason:null}; the original confirmed command/result stays intact.
5. Fresh pre-read was open, but before confirmation consent closes or source contact becomes 60 seconds old.
   409 eligibility_closed (with its existing closedReason) or source_recent (closedReason:null).
   Before expiry the same actor can reauthenticate and retry unchanged after recovery; source_recent also requires re-confirming all three statements against the displayed contact.
```

## Agreement boundary and sources

G is asked to agree the request and reply fields, expiry, refusal order, replay and examples. To agree what a confirmed reply means, identify where Cloud enforces the source's remote access and backup write authority and how it establishes that both have been withdrawn before returning HTTP 200. Pin both revisions and the shared examples after agreement.

Source inspection only: Waitron `132e62ae5384c040392aee914dce1830d03e24bc`; Cloud contract/source pin `620db37b0692fcf236870023fd684b647f823722`, read locally from `~/workspace/repos/waitron-cloud`. No runtime checks were run.

| Source | Exact words | What they establish |
| --- | --- | --- |
| Ask and watcher clearance quoted above | "no executable activation plan until G agrees" | Draft/publication only; joint agreement and build clearance remain. |
| [Design §9 item 8](../specs/2026-10-29-a1188-cloud-emergency-start-design.md#9-what-waitron-needs-cloud-to-agree) | "the same id and inputs return the stored result" | Retry requirement; the fields above are proposed. |
| [Cloud pinned contract, A1188 disposition](https://github.com/waitron-io/waitron-cloud/blob/620db37b0692fcf236870023fd684b647f823722/docs/waitron-integration-contract.md#disposition-of-a1188s-remaining-cloud-requests), lines 2423–2425 | "Bind one durable operation to the actor, selected copy and exact declaration." | Agreed direction, not this message or implemented effects. |
| Same pin, A1018 answer, lines 2573–2601 | "without adding Cloud fields to that local binding" | The proposed request carries a fingerprint of the local binding. |
| [Local declaration](../../../apps/server/src/handover-emergency-api.ts), lines 96–108, 552–633; [envelope](../../../packages/handover/src/envelope.ts) | `provider: null`; `purpose !== purposeOf(kind)` | Local schema/purpose are distinct; local retry comparison omits actor. |
