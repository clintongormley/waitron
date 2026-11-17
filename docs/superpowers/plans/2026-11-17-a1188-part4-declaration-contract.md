# A1188 part 4: PROPOSED declaration-confirmation contract

When the venue's box has died, a staff member must be able to declare the emergency inside the locked copy without an uncertain Cloud reply starting a second operation. This proposes only design §9 item 8 for agreement with Lane G. It supplies no implementation plan or authority to activate.

**Ask:** "when the venue's box has died, the venue can be started in Waitron Cloud (emergency start)." Recorded in Lane J `queue.md`, A1188, and the [design](../specs/2026-10-29-a1188-cloud-emergency-start-design.md).
**Clearance:** WATCHER, Lane J `questions.md`, 2026-11-17 21:52: "Yes: draft the Waitron side of the part 4 declaration-confirmation contract (design §11, §9 item 8) as a short proposal with examples, publish it to lane G in its questions.md as you did for the purpose-key input, and settle it together; no executable activation plan until G agrees. Shipped locked page and fiscal gates unchanged."
The watcher cleared drafting and publication to Lane G; Claude reviews the proposal before that handoff. Neither G's agreement nor owner approval of these proposed values is claimed.

## One stored declaration, one Cloud command

Use machine-v1 POST `/api/installations/emergency-copy-confirm`, action `emergency-copy-confirm`, with its existing authenticated `{payload,signature}` transport. Only the fresh copy installation named in the stored copy operation may call it. Browser Origin requests, source installations and other copies cannot confirm or read its result. Reuse part 3's authentication, post-lock checks, errors, shared budgets and size/time bounds unchanged.

The signed body has exactly `{version:1,copyBinding,handoverBinding,bindingFingerprint,declaration}`. `copyBinding` is the complete, unchanged `EmergencyCopyBinding`, including selected stream, generation, database digest and fixed start/deadline. `handoverBinding` is the unchanged local `HandoverBinding`, with scenario `emergency`, operation id equal to `copyOperationId`, matching source/destination/environment and the held venue/membership facts. Its existing `bindingFingerprint` remains SHA-256 of recursively key-sorted JSON.

`declaration` is a separately defined Cloud message document with exactly these fields:

| Field | Proposed value |
| --- | --- |
| `wordingVersion`, `locale` | `"a1018-emergency-v1"`; `"en"` or `"es"` |
| `statements` | Exactly `{sourceSwitchedOff:true,noParallelRecovery:true,missingTailAccepted:true}` |
| `reason`, `provider`, `replaces` | Nonblank reason, at most 500 code units; `null` for this local source; `null` for this first emergency operation |
| `lastCopy` | Exactly `{identifier,lastChangeAtMs}`: the checked module-summary SHA-256 and finite last-change milliseconds or explicit `null`; the full selected stream stays in `copyBinding` |
| `actor` | Exactly `{personId,displayName,method,signedInAt,permission}`; stored person id/name, `"password+totp"` or `"password+recovery-code"`, canonical UTC sign-in instant, `"node.manage"` |
| `declaredAtMs` | Finite milliseconds when Waitron records the declaration |

This is new versioned Cloud confirmation evidence, not an extension of local `Declaration` or `waitron.handover.declaration.v1`. In particular, do not invent a Cloud source variant inside local `lastCopy`, change local `provider:null`, or treat local v1's retry comparison as actor binding. Cloud checks the message's consistency against its stored copy/installation mapping; Waitron independently checks the venue and membership facts against its held trusted state.

Waitron checks the person's active account, `node.manage`, both factors and sign-in age strictly under ten minutes before recording. It records this exact declaration and any recovery-code consumption before sending. The actor comes from that sign-in, never the browser's chosen id. Cloud requires `signedInAt <= declaredAtMs <= admission time` and sign-in age under ten minutes at first admission. These are freshness checks, not a new clock-authority rule.

Keep this evidence immutable. Hash the complete signed body, using existing canonical JSON and lowercase SHA-256, as `commandSha256`. Bind it to Cloud's existing operation/journal command pattern, with command kind `emergency-copy-confirm`; create no new table, ledger or general authorisation bridge. Retain the exact actor, declaration, copy and local binding together. A transport proof gets a fresh request UUID and timestamp on retry, distinct from the copy operation UUID; those transport values are outside the command hash.

Never send a password, TOTP value, recovery secret, locked-session cookie or backup key to Cloud. The actor fields attest to Waitron's completed check; Cloud's installation credential authenticates the sender only. Cloud owns consent to its services. Neither its yes nor that credential grants fiscal authority or makes an unknown membership key trusted.

## Admission, expiry and replies

Before recording, Waitron obtains part 3's fresh status read; failure, closed/unavailable eligibility, future contact or source contact age 0–120 seconds inclusive refuses. Unknown contact alone does not refuse and never proves shutdown. At first confirmation admission, Cloud rechecks the same eligibility/contact facts from current stored state, under the same venue turn as its deadline decision. An earlier open response cannot authorise a later closed request.

Cloud admits only while its admission time is strictly before stored `expiresAt`. Expiry and confirmation compete in that same serialised decision: admission first preserves the accepted operation; expiry first refuses it without charging, mail, withdrawal or writer permission. Receipt at the HTTP listener before the deadline does not count as admission.

**Proposed decision for G:** durable admission is confirmation of acceptance and cancels the automatic 30-minute disposal, even if the reply is lost. External work may still be pending. This two-stage meaning requires an explicit part 3 amendment; a pending acknowledgement never means the copy can trade. Do not discard an accepted operation or start a replacement because its original deadline subsequently passes.

The closed response is `{version:1,copyOperationId,commandSha256,status,acceptedAt,completedAt,reason,writerGeneration}`. Times are canonical UTC instants with milliseconds or `null`. `writerGeneration` is `null` or exactly `{streamId,generation}`; it contains no credential.

| HTTP / `status` | Meaning |
| --- | --- |
| 202 / `pending` | Durable acceptance exists; `acceptedAt` is set, `completedAt` and `writerGeneration` are null, `reason:"effects_pending"`. No all-done claim. |
| 200 / `confirmed` | All confirmation effects below have completed; both times and generation are set, `reason:null`. This is Cloud service confirmation only. |
| 409 / `refused` | No admission for this command; times/generation are null. Reason is `copy_expired`, `eligibility_closed`, `source_recent`, `state_unavailable`, `authentication_expired` or `input_conflict`. Existing transport/authentication errors retain their existing statuses. |

Resend the identical stored body with fresh valid transport proof to resolve a timeout or lost reply. Once admitted, return its stored outcome or current pending progress, without repeating completed effects or rechecking initial admission eligibility. Current installation access checks still apply. Pre-admission eligibility/contact refusals can be freshly checked on identical resubmission; they are not an accepted outcome. Exact deadline expiry is terminal for a command never admitted.

Changing actor, selected copy, declaration, mapping or any other command input under that operation conflicts; it never overwrites the admitted command. A restarted resolver must read the saved declaration rather than reconstruct it from a new sign-in. No reply, unavailable status or an authentication refusal is evidence of non-acceptance. Keep the same operation unresolved until its recorded outcome is readable.

## What a completed confirmation promises

Cloud coordinates these effects through its existing journal/command pattern: one charge-start record at `acceptedAt`; owner notification naming the recorded actor and declaration time; withdrawal of the bound source's remote access and backup writes; reservation of the copy's new backup generation. No retry starts charging twice or schedules a second logical owner notification.

Propose that owner mail counts as sent when the mail service acknowledges acceptance, not when it reaches an inbox. A queued or uncertain send keeps `pending`; reconcile that same notification identity rather than blindly sending another. A `confirmed` reply also requires effective source-service withdrawal, including existing access, rather than just a queued withdrawal request. It does not claim that the source box has stopped selling locally.

The generation belongs to the copy's node and this operation, differs from the source generation and uses an isolated write target that cannot overwrite the source stream or move its pointer backward. Preserve the source copy. The locked copy receives no bucket credential before `confirmed`; later writer provisioning must target only this reserved generation. No provider, payment collection or runtime design is added here.

Waitron's declaration/recovery-code writes, Cloud's database decision and external effects are separate commits. Local venue/node writes also cross databases. There is no atomic transaction across them: local persistence failure prevents submission; an accepted Cloud command with incomplete or uncertain effects remains pending and resumes under its existing identity. Exact crash recovery and external-effect qualification belong to the later build, not a claim that this proposal already provides atomicity.

## Small shared examples

These are illustrative fixtures, not tested vectors. `O` is `d706194d-c1bc-4f48-8275-4fe8c4583990`; `C` is its full stored binding, started `2026-11-17T21:00:00.000Z`, expiring `2026-11-17T21:30:00.000Z`. `H/F` are its unchanged local binding/fingerprint. `D` records Nora's id/name, password+TOTP sign-in at 21:20, declaration at 21:21, the three true statements, reason `"Box power supply failed"`, accepted copy and null provider/replacement. `Q` denotes the full command digest, not a supplied literal digest.

```text
1. Confirm at 21:22: POST {version:1,copyBinding:C,handoverBinding:H,bindingFingerprint:F,declaration:D}
   202 {version:1,copyOperationId:O,commandSha256:Q,status:"pending",acceptedAt:"2026-11-17T21:22:00.000Z",completedAt:null,reason:"effects_pending",writerGeneration:null}
   Same body after effects: 200 confirmed, same acceptedAt; completedAt and the reserved fresh generation set.
2. Accepted at 21:29:59.999, reply lost; identical POST with fresh proof at 21:30:01.
   Return stored pending/confirmed and the original acceptedAt. Do not return copy_expired or start a second charge.
3. No admission yet; original POST wins its admission turn exactly at 21:30:00.000.
   409 refused, reason:"copy_expired", acceptedAt:null. Nothing is charged or activated.
4. After example 1, POST the same O with D.actor.personId changed, or C.selectedStream.databaseSha256 changed.
   409 refused, reason:"input_conflict". The original command/result stays intact; neither change creates another operation.
5. Fresh pre-read was open; before admission consent closes, or source contact becomes 60 seconds old.
   409 refused, reason:"eligibility_closed" or "source_recent" respectively; no acceptance or side effects.
```

## Agreement boundary and sources

G is asked to accept these fields, actor binding, admission/expiry ordering, two-stage confirmation, replay and completion meanings, including the mail-service acknowledgement boundary. Pin both revisions and shared exact vectors after agreement; runtime qualification remains later. This is not a request to build.

Part 3 currently stops at its deadline and permits only `control` and `emergency-copy-status`. Confirmation/replay and preserving an accepted operation beyond that deadline need a narrow joint amendment to the action allowlist, control lease and locked lifetime. Expired leases do not become valid. This proposal requires same-operation resolution after admission; exact post-confirmation startup/activation lifetime belongs to the later build. Until agreed and built, the shipped hard stop remains.

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
