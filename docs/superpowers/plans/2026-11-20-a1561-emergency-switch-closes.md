# A1561: a handover closes, so the venue can hand over again

Status: built on this branch (revision 3, then the finish-branch review's fixes, 2026-11-21). Lane L (fiscal). Branch
`fix/a1561-emergency-switch-closes`, from `e8e8d0a949`. Builds on the A1342 records return (PR1 #2770,
PR2 #2857; plan deleted in `7b73cc98b0`, read with
`git show 7b73cc98b0^:docs/superpowers/plans/2026-11-09-a1342-return-records.md`) and A1018's received
inventories (#3006). Owner's measurement: A947 design, 20 November rerun (`62dd2dcb1c`).

## Outcome

After an emergency switch or a planned handover, the old main box returns its invoice records to the new
main box as soon as it is switched on, including a return with nothing in it. Once the new main box has
confirmed them, the handover is finished there: a person can hand the venue over again. If the old box
will never come back, an administrator says so on Servers ("Will not return"), after a warning about
what that loses, and the handover is finished the same way. A former main box can then be removed from
Servers, but only when it cannot later wake up unaware and sell beside the new main box (D4). The old
box's own page names the box now running the venue by its address and role, and keeps saying it may be
reset once its return was confirmed, across restarts.

## What happens today

Receipts are `file:line` at `e8e8d0a949`. "Ran" marks throwaway test edits, all reverted; the reader's
runs are marked as theirs.

1. **The return never reaches the new main box on a real box.** Boot starts the sender with no transport
   settings (`apps/server/src/boot.ts:2130-2137`); the sender calls `postToBox` with only
   `{ fetch, timeoutMs }` (`apps/server/src/return-records.ts:76-81`); with no fetch replacement and an
   `https` address, `postToBox` refuses before connecting (`apps/server/src/boot-peer-check.ts:406-409`);
   the sender turns that into `"waiting"` and logs nothing (`return-records.ts:111-112`). **Ran:** the pass
   as boot calls it (no `fetch`) gave `{"result":"waiting","firstCallDeps":{"timeoutMs":5000},"outcome":"PeerCertificateRefused: no authority to check the certificate under"}`.
   **Reader's control:** `postToBox` to `https://127.0.0.1:9` refuses the certificate without the
   authority and gives `ECONNREFUSED` with it. The likeliest reason the owner's box waited; not reproduced
   on the boxes.
2. **An empty return already works.** The fiscal seat always sends at least one batch, an empty one for a
   box with no records (`packages/fiscal-verifactu/src/handover-return.ts:715`); `return-records.ts:58`
   is reached only when no enabled module has a return seat. **Ran:** real fiscal module, old box with no
   records: `{"result":"confirmed","batchesRead":1,"firstBatchRecords":0,"accounted":true}`.
3. **Nothing closes a handover on the new main box, controlled or emergency.** One open operation per box
   (`packages/node-db/src/schema/node-handover.ts:25-30,57-64`); a second is refused
   `handover.operation_in_progress` (`packages/node-db/src/handover.ts:54-57`). The steps allow
   `activated → return_pending → return_complete | return_abandoned` for a destination in both scenarios
   (`packages/handover/src/states.ts:46-60`); no product code writes those states. The receive route
   records a confirmed batch only for an emergency activation and never moves the operation
   (`apps/server/src/return-records-api.ts:69-88`). **Ran:** in `handover-two-boxes.test.ts` (2 passed),
   after the controlled takeover the new main box held `{"scenario":"controlled","state":"activated"}`
   open and a new operation was refused `handover.operation_in_progress`; the same after the emergency
   switch; control, a freshly joined box: `"created"`. The controlled defect is in this plan.
4. **A former main box cannot be removed.** Removal refuses every `sell-only` box,
   `membership.node_has_served` (`apps/server/src/membership-removal.ts:64-65`, from #708, 2026-09-26),
   and also any box an open operation names (`membership-removal.ts:280-286`). Every handover leaves the
   outgoing main box `sell-only` (`packages/membership/src/standings.ts:15`), and a chart lists at most 8
   boxes (`packages/membership/src/verify.ts:27`), so these rows pile up.
5. **The page names the wrong thing.** The restricted page shows the successor's venue `nodes.name`
   (`apps/server/src/restricted-page.ts:70-73,98`); a spare is named `"<main box's name> (standby)"`
   (`apps/server/src/spare-join.ts:176`), and the main box's name is the name typed at setup
   (`packages/provisioning/src/venue-plan.ts:225-226`) — hence "Clinton Gormley (standby)".
6. **The dashboard asks after an id it made up (mostly cosmetic).** After a 409 the Servers screen reads the
   status of its own new id (`apps/dashboard/src/screens/servers-screen.ts:268-296`), which can only answer
   `handover.operation_unknown` when the refusal names another operation
   (`handover-source-start-api.ts:139,498`). The person already sees the in-progress words
   (`servers-screen.handover.test.ts:201-220`); only the wasted request is wrong.
7. **What the old box stores as "confirmed": nothing.** The sender's state lives in memory
   (`return-records.ts:125,135`); each start resends. Once the new main box has removed it, the resend is
   refused as `binding` (`apps/server/src/return-clash-acceptance.ts:54-65`, 409), which the sender shows as
   `needs-attention`: "…Do not reset this box." (`apps/server/src/i18n/restricted-page.ts:101-102`).
8. **A removed box that never learnt it was replaced can sell again (reader's run, C1).** Through
   `askPeerStatus` with a real signature, a `sell-only` box asking the new main box got
   `{"answered":true,"chartStandings":["serving-primary","sell-only"]}`, which stops it; an evicted one got
   `{"answered":false,"reasons":["refused"]}`. A refusal counts as silence (`boot-peer-check.ts:492`); with
   every counted box silent the start waits (`boot-peer-check.ts:226-231`) and an administrator may carry on
   unless the box holds a restriction or an open source operation (`apps/server/src/carry-on.ts:354-356`
   through `knownHandoverSuccessor`, `start-peer-check.ts:88-96`). So: emergency switch with the old box off
   → Will not return → Remove → old box on → it carries on selling and filing on its old chain.
9. **A stepped-down box learns the new chart only from one post.** A box holding a restriction starts
   restricted before any peer check (`boot.ts:2211-2213`); the new main box posts its chart to the old box
   once per start, only while its operation is open (`apps/server/src/handover-activation.ts:236-240`). If
   the old box is off then, its held chart still names itself serving primary and the sender waits with no
   target (`return-records.ts:47-49`).

## Design

The new main box's operation closes when the fact it records becomes true there:

| Step (new main box, destination) | Becomes true when | Written in |
| --- | --- | --- |
| `activated → return_pending` | the first signed batch from that operation's source commits its venue facts (accounted or not) | `return-records-api.ts`, its existing node transaction, after the venue transaction commits |
| `→ return_complete` | every batch of one inventory from that source is accounted (count and digest, as `return-completion.ts:44-74` judges), the one-empty-batch return included | the same node transaction |
| `→ return_abandoned` | an administrator says the old box will not return (D5) | a new Servers route: node transaction outside, venue activity entry first, node state after, stepping through `return_pending` when needed |

`node.db`'s lock is taken outside `venue.db`'s and `venue.db` is saved first (CLAUDE.md §3). A crash
between the two leaves no receipt sent (built after the node transaction, `return-records-api.ts:95-117`),
so the old box resends and the replay (`onConflictDoNothing`, `return-completion.ts:35-41`) writes the
step; the reader confirmed this order. While that operation is still before `activated` (the activation's
venue save committed, its `node.db` step not yet), the route takes the batch's venue facts but answers
`handover.return_refused` with reason `activating` and sends no receipt, so the old box resends once it is
`activated` (review fix, 2026-11-21); the sender reads `activating` as `"waiting"` whichever way it found
its target. The receive route needs no open operation, so a box that comes back
after Will not return still has its records taken in and filed until it is removed. With no open operation
from that box, its batches are recorded against this box's latest `handover_activations` row from it (by
`activated_at`), and no `node.db` state moves, so a complete late return lets Remove go ahead without the
statement (review fix, 2026-11-21).

**The old box** aims its return at the chart's serving primary when that is another box, otherwise at the
successor its restriction names, using that box's address in the held chart (fixes 9 without a retry loop).
On a confirmed return it appends one `node_handover_events` row, kind `return_confirmed`, operation id
from its restriction (null after an emergency), detail `{ destinationNodeId, inventory }`, envelope the last
signed receipt; at each start it sends again, and when that send ends `waiting` or `needs-attention`, a row
whose inventory matches what it sent answers `confirmed`; a `clash`, `record-clash` or `clock` answer is
shown as it is (fixes 7; review fixes, 2026-11-21: a main box restored from an earlier copy gets the records
again). `kind` is free text and `operation_id` nullable (`node-handover.ts:70-81`), and
its one writer stays `packages/node-db/src/handover.ts` (`scripts/write-path-tables.json:4`): no schema
change. A restricted start writes nothing to `venue.db` (`boot.restricted-quiet.test.ts`); this writes
`node.db` only. The page lists a controlled old box's events by kind (`restricted-page.ts:48-51,85-95`), and
an unknown kind shows as its bare name in every language (`:49`), so `return_confirmed` gets EN/ES words in
`RESTRICTED_STEP_WORDS` ("Invoice records confirmed by the main box"). Not the `return_complete` kind:
events named after a state are what `advanceHandoverTx` writes when the state moves
(`handover-store.ts:126-133`), and this row moves no state.

In a planned handover the old box restarts restricted before the new main box activates, so a batch sent
to the successor is refused `handover.return_refused` with reason `binding` until the successor's chart
names it main (`return-clash-acceptance.ts:34-36,57`). The sender reads that refusal, sent to a target it
took from its restriction, as `"waiting"`, not `needs-attention` (whose words say "Do not reset this box",
`i18n/restricted-page.ts:101-102`); it retries on its 30-second turn (`return-records.ts:136`).

**Removing a former main box (D4).** Refused while an open operation here names it
(`handover.return_outstanding`, D6). Otherwise allowed when either (a) the venue holds a completed return
inventory from it — a `handover_return_batches` set complete for a `handover_activations` row whose source
is that box, which travels with the venue copy (`packages/db/src/classification.ts:274-277`), so it holds
after later handovers too — or (b) the person states that the box has been reset or will never be switched
on again, after a warning that a box switched on with its data afterwards could sell beside this one, and
that if it does come back it must be reset, and Carry on as the main box must never be chosen on it.
Why (a) is proof: the sender runs only on a restricted start (`boot.ts:2128-2137`, its one caller), a
restricted start happens only once the box holds a restriction (`boot.ts:2211-2213,2338-2342`), nothing
clears a restriction (`node-handover.ts:83`), and the receiver accepts only a batch signed by that box's
pinned key (`return-clash-acceptance.ts:53-57`). The owner's case (old box already reset → Will not return
→ Remove → hand over to the new spare) goes through (b).

## Decisions — owner (recommended default first)

- **D1 — what an empty return is.** One signed batch holding no records, which the new main box accounts
  and answers with a signed receipt; that receipt is the confirmation and closes the operation. This is
  today's wire behaviour (run 2), so no new message. The old box shows its existing `confirmed` words
  (`i18n/restricted-page.ts:109-110`).
  The watcher chose this default (2026-11-20 22:17); the owner answered only D4 (22:18, "yes").
- **D4 — when a former main box may be removed.** (a) or (b) above. Not option (c), answering a removed box
  so that it stops itself: a removed box's endorsement is dropped from the next chart
  (`apps/server/src/membership-mint.ts:71-81`), so the answering box often cannot check its signed question,
  and the old box asks only the boxes its own stale chart lists, which may since have handed over
  themselves. So (c) is not small and does not cover every path (read, not run).

## Decisions — watcher

- **D2 — controlled handovers close the same way**, on the old box's confirmed return or by Will not
  return, not at activation: the chart post runs only while the operation is open
  (`handover-activation.ts:236-240`). With the old box aiming at its restriction's successor (Design), an
  old box that was off at that post still returns. This changes the `"controlled"` row of the `it.each` at
  `return-records.test.ts:937`, which today asserts nothing is recorded.
- **D3 (revised) — the old box writes one confirmation event, no operation states.** Its controlled row
  stays `filing_relinquished`; nothing reads it on a restricted box but `knownHandoverSuccessor`, which reads
  the restriction first (`start-peer-check.ts:88-96`).
- **D5 — Will not return: `node.manage` plus a fresh sign-in**, as Remove and Hand over require
  (`membership-removal-api.ts:53-60`, `handover-source-start-api.ts:512-519`). Warning, emergency: invoice
  records the old box made after the copy this box started from stay only on the old box; switched on again
  before it is removed, it still sends them. Controlled: the copy was taken after the old box stopped
  selling. Each sentence is checked against a test before it ships (CLAUDE.md §1).
- **D6 — a clearer refusal.** When the open operation is a destination operation waiting for a return,
  starting a handover or removing that box refuses `handover.return_outstanding`
  (`{ operationId, sourceNodeId }`): the last handover is still waiting for ⟨address⟩ to return its invoice
  records; switch it on, or choose Will not return for it on Servers.

## Tasks

Test-first each time: write the failing case, see it fail for the stated reason, then the smallest change.
Focused runs only, `pnpm --filter <pkg> exec vitest run <file>` (never `pnpm test <file> -t`, which drops
the `-t`). Every verify step includes `pnpm format:check`. `main` stays green after each task.

1. **The return reaches the main box.** `return-records.ts` takes `stateDir` and `lookup`, reads
   `readVenueAuthority` each pass and passes `authorityOf` and `lookup`; `boot.ts:2130` passes
   `config.stateDir` and `seams.boxLookup` (as `boot.ts:2232,3799`). The catch at `:111` logs
   `return-records.unreachable` with the error's class name and the first system code in its cause chain
   (`firstCodeInCauseChain`, `packages/shared/src/cause-chain.ts:12`), never `codeOf`, which answers
   `unknown` for both (`packages/server-kit/src/error-code.ts:8`). Add an async variant of `startBoxServer`
   (`testing/box-authority.ts:53-56` takes only a synchronous answer, and the receipt echoes a random nonce).
   Failing first in `return-records.test.ts`: no `fetch`, a real TLS box server hosting the receive route →
   `"confirmed"`; control, no authority file → `"waiting"` and one log line naming the certificate refusal.
   Re-run `handover-controlled.e2e.test.ts`. `pnpm --filter @waitron/server exec vitest run src/return-records.test.ts`.
2. **The main box closes on a confirmed return (D1, D2).** `return-records-api.ts` (match the open
   destination operation by source; drop the emergency-only filter at `:76`; write the two steps);
   `return-completion.ts` (`returnCompletedFor(tx, operationId)` from the existing grouping); the wording at
   `classification.ts:277` loses "for an emergency takeover". Failing first, extending
   `return-records.test.ts:915-969`: two batches → `return_pending` then `return_complete`; one empty batch →
   `return_complete`; unaccounted → `return_pending` only; controlled now recorded and closed; a failed node
   write → no receipt, the resend closes it. The real case in `return-records.real.test.ts`: empty and
   one-record returns both close. Pin `handover-controlled.e2e.test.ts:2205` (expects `activated`) to the
   state this task makes deterministic there; do not loosen it.
3. **The old box remembers and finds its target (D3).** `return-records.ts` (target rule; read and write the
   `return_confirmed` event; `binding` refusal from a restriction-taken target → `"waiting"`),
   `packages/node-db/src/handover.ts` (read events by kind with a null operation id; `readHandoverEvent`
   matches by `eq`, `:128-147`), `i18n/restricted-page.ts` (EN/ES words for `return_confirmed`). Failing
   first in `return-records.test.ts`: after `"confirmed"`, a new duty with a receiver that refuses `binding`
   sends once and still answers `"confirmed"`; a held chart naming itself primary plus a restriction naming
   the successor sends to the successor, and while that successor's chart does not yet name it main the pass
   answers `"waiting"`, then `"confirmed"` once it does. In `restricted-page.test.ts`: a Spanish page lists
   the event in Spanish, never as `return_confirmed`.
4. **Will not return on the server (D5, D6).** `POST /management-api/servers/:nodeId/return-abandoned` in
   `membership-removal-api.ts` (body `{ confirmed: true }`); activity kind `handover.return_abandoned` in
   `packages/db/src/activity-kinds.ts`; codes in `apps/server/src/errors.ts`, EN/ES words in
   `apps/dashboard/src/i18n/codes.ts`; `handover.return_outstanding` thrown in `handover-source-start-api.ts`
   and `membership-removal.ts` before the generic refusal. Failing first in `membership-removal-api.test.ts`:
   refused without `node.manage`, without fresh sign-in, with no outstanding return (nothing written);
   accepted → `return_abandoned`, one activity entry; a later batch is still taken in.
5. **Remove a former main box safely (D4).** `judgeRemoval` and `listServers` (`membership-removal.ts`) take
   whether a return from that box is outstanding here, whether the venue holds a completed return from it,
   and the person's statement; the listing reports `returnOutstanding` and `needsResetStatement` per row.
   Failing first in `membership-removal-api.test.ts`: `sell-only` refused while a return is outstanding;
   removable after a completed return (also for a box another box received it from: A → B, then B → A2,
   removing A on A2); after Will not return, refused without the statement and removable with it; a batch
   from a removed box is refused. Then the C1 sequence in `handover-two-boxes.test.ts`: removed after a
   completed return, the old box restarted starts restricted and cannot carry on.
6. **Servers screen, server-side wiring.** `api/client.ts` calls for Will not return and for removal with
   the statement; after a 409 `handover.operation_in_progress` naming another id the screen shows the refusal
   without reading status (small change at `servers-screen.ts:286-296`). Failing first in
   `servers-screen.handover.test.ts`: in the 409 case at `:201-220`, `status` is not called when the refusal
   names another id. `pnpm --filter @waitron/dashboard exec vitest run src/screens/servers-screen.handover.test.ts`.
7. **Servers screen, the row and dialogs.** `servers-screen.ts`, `i18n/strings.ts` EN/ES: a row waiting for a
   return says so and offers Will not return (warning, required confirmation, fresh sign-in, Forms
   contract); Remove on a former main box asks for the statement when D4(a) does not hold. New
   `servers-screen.return.test.ts`; axe cases in `servers-screen.a11y.test.ts`; guide
   `apps/server/src/guide/{en,es}/servers.md`.
8. **The old box's page.** `restricted-page.ts` names the successor by the host of its `contactUrl` and its
   standing in the held chart ("main box" / «equipo principal»; also for a chart still listing it as standby
   while this box holds a confirmed return to it), else its id; `i18n/restricted-page.ts`.
   Failing first in `restricted-page.test.ts`: a successor row named `"Bar Pepe (standby)"`, standing
   `serving-primary`, at `https://box-db91.waitron.local` renders the address and "main box", never the
   name. Open the rendered page in Chromium, both themes, phone width.
9. **Two boxes, controlled.** `handover-two-boxes.test.ts`: after the controlled takeover the old box's real
   pass closes the new main box's operation and a new operation is then accepted (the run-3 probe,
   inverted); with the old box's chart post lost, its return still arrives (Design's target rule).
10. **Two boxes, emergency.** Same file: with the old box off, Will not return closes the operation, Remove
    with the statement succeeds, and a handover to a newly joined spare is accepted (the owner's case).

## Guards and checks to run

Unedited and run: `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (golden huella) and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`. Also `apps/server/src/boot.restricted-quiet.test.ts`,
`apps/server/src/peer-status-api.test.ts`, `packages/handover/src/states.test.ts`,
`packages/node-db/src/handover.test.ts`, `apps/server/src/read-only-exemptions.test.ts`,
`apps/server/src/return-records.real.test.ts`, and the root guards `scripts/errors-reachable.test.ts`,
`scripts/personal-log-params.test.ts`, `scripts/write-path-tables.test.ts`, `scripts/english-only.test.ts`,
`scripts/native-form-fields.test.ts`, `scripts/guide-links.test.ts`, `apps/server/src/guide-content.test.ts`.
No schema change, so no baseline rebuild. Untouched: `computeHuella`, chaining, invoice-number allocation,
`registros_facturacion` triggers, alta builders.

## Risks

- Task 1 makes every restricted box really post its records; suites that start one with real TLS gain
  traffic and may change timing. Read them; do not loosen assertions.
- Every product reader of the open operation (`readOpenHandoverOperation` across promotion, removal, the
  start check, carry-on's helpers, the emergency routes, the chart post, peer status and the destination
  duty) sees `null` once it closes. Read so far: the chart post stops, which is intended; a returning box is
  stopped by the chart and its restriction as well as a peer's open operation (`boot-peer-check.ts:110-119,212`;
  `start-peer-check.ts:98-113` reads activated operations open or closed). Task 2 lists every call site and
  its answer in the PR.
- D4(b) rests on a person's statement; the warning says what a wrong one costs.
- A crash between Will not return's two commits leaves an activity entry and an open operation; a retry
  writes a second entry. Accepted: nothing may read `activity_log` to decide (CLAUDE.md §3).
- Assumption, not checked: a planned-handover old box can confirm its return while its own chart still names
  it main; if it then lost `node.db` but kept `venue.db`, the lost-state refusal lets a box whose chart names
  it serving primary through (`boot.ts:1188`; that exception dates from #2942, `git log -L1177,1191:apps/server/src/boot.ts`),
  and with no restriction left it could reach carry on. Saving the successor's newer chart at confirmation
  would close it, but that is a background `venue.db` write on a restricted box, which
  `boot.restricted-quiet.test.ts:299` forbids, so it is not in Task 3.
- The real-box cause is inferred from run 1 and the reader's control, not observed on the boxes; the
  owner's two-box rerun after landing is the check.
