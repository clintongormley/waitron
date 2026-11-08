# A1425: every restore takes its own identity, and a restore is a takeover

Status: approved by the owner, 2026-11-07 ("go"). Backlog A1425. Grew out of A1418
(`docs/superpowers/specs/2026-11-07-a1418-box-stop-intent-design.md`) and serves A1188 part 0
(`docs/superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md` §5, §11).

## Why this exists

Today a restore brings the dead box back under the dead box's own machine identity: the same node id
and the same signing key. So two machines can exist with one name. The old box, switched on later, and
the restored box are indistinguishable to anything that asks "which box is this?", and A1418's
"replaced" check has to lean on terms alone (its plan's decision 1, "an equal term is not replaced",
exists because of this).

A controlled or emergency handover already does the right thing: the spare runs under its own id.
But a measurement on 2026-11-07 showed the spare cannot finish the work it inherits (§1). The owner's
view: restore and takeover are one problem. A restore is recorded as a takeover from the old box, and
everything that cannot handle a takeover is fixed once, for both.

## What the owner decided (2026-11-07)

- **Staff and tills see the same box**: same address, same `waitron.local`. Internally the restored box
  is a new machine, with a new node id and a new signing key.
- **The dashboard shows two machines**, explicitly: the old one marked replaced on the restore date
  ("two machines i think, that can be explicit").
- **A restore onto the same physical box also makes a new machine** ("y").
- **Requirement: devices, printers, print agents and card readers keep working after a restore with
  nothing re-paired** ("that's a requirement").
- **The replacement statement.** The restored box signs "box A is replaced by box B from term N" with
  the OLD box's key, saves it in `venue.db` and at a fixed key in the bucket that pruning never
  deletes, then destroys the old private key. The old public key stays in the machine list ("y").
- **Restore and takeover are one problem** ("yes"): a restore is recorded as a takeover from the old
  box, and the readers are fixed once for both. Start with a test (done, §1).
- **Orders are not owned by a box.** The rule that one box cannot change another's orders dates from
  when several boxes took orders at once, which is no longer so. Drop the box filter on orders, as
  #259 did for the lists.
- **A cancellation of an old box's sale goes on the selling box's own chain**, citing the old sale, as
  corrections already do. Nothing adds to a handed-over box's chain again ("y").

## Goals, non-goals, anti-goals

Goals:

- After a restore or a takeover, the box that sells can do everything with what it inherited: change
  and pay open tables, cancel, correct or refund earlier sales, see earlier days in every report,
  reconcile earlier records with AEAT, and show the certificate it holds.
- A restored box is a different machine from the one it replaced, in the chart, in the bucket and in
  the dashboard, so an old box switched on later can be told, by signature, that it was replaced.
- Nothing on a device, printer, print agent or card reader needs touching.

Non-goals:

- Merging chains or moving history. Old records stay under the old box's id (§4).
- Several boxes selling at once. One box sells; this design relies on that.
- Cloud's emergency copy itself (A1188). This gives it the restore it needs; the rest stays there.

Anti-goals (a failure even if it works):

- Any record added to a handed-over or replaced box's chain.
- Rewriting history rows to the new id to make a reader work. Readers learn the list of boxes this
  one took over from instead.
- A restored box that asks anyone to re-pair, re-enrol or re-enter anything.
- Order numbers repeating within a venue.

## 1. The measurement (run, 2026-11-07)

`apps/server/src/handover-controlled.e2e.test.ts`, extended on branch `probe/takeover-inherited-work`
(commit `feba7de8b4`, not pushed). After a controlled handover from M1 to M2, run twice, same result
each time (`Tests 4 failed | 25 passed | 1 expected fail (30)`), on M2:

| M2 tries to | Result |
| --- | --- |
| add a dish to M1's open table (`POST /api/parties/{party}/groups`) | works |
| pay it in cash (`POST /api/working-orders/{tab}/payments`) | 409 `working_order.not_open`; the box filter at `apps/server/src/invoice-selection.ts:94-96` (read). The whole-bill path places the table, then `collect` is refused the same way, leaving it stuck as `placed` |
| open a new order | gets number 2; M1 had given out 1 to 5, so 1 and 2 now exist twice. `allocateOrderNumber(tx, cfg.nodeId)` at `apps/server/src/working-order.ts:1711`; the counter is per box (`packages/db/src/allocate-order-number.ts`) |
| cancel one of M1's filed sales (no route reaches `recordVoid`; called in the test process) | succeeds, but chained on M1's chain under M1's installation identity, filed by M2. `packages/fiscal-verifactu/src/backend.ts:432-436` takes the box from the original sale; `refuseNewIssuance` did not refuse M1 after M1 relinquished filing |
| read the day's cash-up (`GET /management-api/reports/daily-close`) | shows only M2's one sale; M1's three are missing. `apps/server/src/report-api.ts:182-184` → `packages/reporting/src/business-day.ts:250`. The overview report is venue-wide and shows all four |

Already shown by the same file before this change: M2 lists the open table, captures M1's open card
payment (through `readTakenOverFrom`, `apps/server/src/handover-collection.ts`), and holds the AEAT
certificate; its certificate card reads "not recorded" (an existing `it.fails`, A1018 plan Task 5.10).

The probe also fixed the test's stand-in for AEAT, which was built afresh on every sending pass and so
never remembered the sale being cancelled. That fix belongs in the build.

## 2. The idea: one list, "the boxes this one took over from"

`readTakenOverFrom` already walks every box this one took over from, and every box those took over
from. Today only card payments read it. This design makes it the one answer to "whose history is
mine?", and records a restore into it the same way a handover activation does.
**2026-11-08, as built for part 1:** the walk is `readHistoryNodes` in `@waitron/db` (this box and the
boxes it took over from), which reports, reconciliation, the certificate read, corrections and record remedies read. Card payments still
call `readTakenOverFrom`, the same list without this box, and the backup check has its own copy of the
walk.

Each reader that today filters by "this box" is judged on its own, into one of three kinds:

1. **Not owned by a box at all**: drop the box filter. Open orders and their payments
   (`working-order.ts` ~1490, 4569, 4647, 4678; `invoice-selection.ts:94`), order numbers, overdue
   orders.
2. **This box plus the boxes it took over from**: reports and cash-up for earlier days, AEAT
   reconciliation (`reconcile-runtime.ts:33-36`, `reconcile-sweep.ts:55`, `reconcile.ts:284`), the
   certificate install record (`certificate-record.ts:7-14`), in-flight card payments (already so).
   Cash closes follow the approved close-a-drawer design
   (`docs/superpowers/specs/2026-11-06-a1325-close-a-drawer-design.md`): each drawer closes on its own
   and covers everything since its last close, so the old box's cash is counted once. If part 1 lands
   before A1325, a close counts only the old box's sales that no close of the old box's own already
   covers (my call).
   **2026-11-08, as planned for part 1:** the recorded daily close is left alone for A1325 to
   replace, and the daily-close report reads the list like every other report (plan decision 5,
   `docs/superpowers/plans/2026-11-07-a1425-takeover-inherited-work.md`).
3. **This box only, on purpose**: its own invoice chain and series, its own signing key, its own
   mode and mirror link. A new record always goes on this box's chain.

The builder sorts every reader the survey lists
(`docs/handoffs/2026-11-07-restore-identity-survey.md`, part A) into these kinds and says which in
the plan. A reader that genuinely needs a fourth answer comes back to the owner.

## 3. Fiscal records after a takeover or restore

- **New records go on the selling box's chain**: sales, cancellations, corrections, substitutions.
  A cancellation cites the old sale's invoice (issuer, series and number, date) as it does today, but
  is chained and numbered on this box (owner). Corrections and substitutions already do this
  (`backend.ts:488, 593`).
- **A handed-over or replaced box's chain takes nothing more.** `refuseNewIssuance` refuses any box in
  the taken-over-from list, wherever the request comes from. Today it did not refuse M1 after M1
  relinquished (§1).
  **2026-11-08, as built for part 1:** a box in that list may have taken back, so the check reads the
  held membership chart instead and refuses a box the chart does not name `serving-primary` (plan
  decision 4, `docs/superpowers/plans/2026-11-07-a1425-takeover-inherited-work.md`).
- **Old records are still sent and reconciled.** Sending is already venue-wide (`drain.ts:151, 474`),
  and records waiting under the old identity are filed under it, as the handover test already shows.
  Reconciliation reads the list (§2, kind 2).
- The old box's software and installation identity stay as they were recorded. Nothing is re-signed.

## 4. What a restore does

A restore becomes: make a new machine, then take over from the box in the backup.

Kept as history under the old id (survey part B): the old `nodes` row, every sale and record, its
chain, series, working-time chain, closes, handover events, the old generations and pointers.

Created for the new machine (survey part C): a new node id in `trading.env`, recorded beside the old
one in the restore marker so a resumed restore reuses the same new id; a new `nodes` row and signing
key; its own filing identity, chain and series at the switch-on, as a takeover does; the next chart,
naming the new box and listing the old one as removed; a new pointer and sealed state in the bucket.

Carried over (survey part A): the old box's mode, recovery key verifier, any handover restriction,
the box's own print agent row (`selfEnrolNodeAgent`, `join-requests.ts:699`), and a spare's mirror
link and pin, which must name the new box. The builder confirms each against the survey.

**The replacement statement** (owner): signed with the old key, "box A is replaced by box B from
term N"; saved in `venue.db` and at a fixed bucket key that pruning never deletes; then the old
private key is destroyed. The old public key stays in the machine list, so anything holding it (an old
box, a spare, Cloud) can check the statement. It is meant to carry trust on too: a spare endorsed by
the old box should keep trusting the new one because the statement vouches for the new key. Today's
rules may refuse that, since a removed box's endorsement "may not vouch further"
(`packages/membership/src/endorsement.ts:58-75`, survey open risk 1, read); the builder says how the
statement is accepted where an endorsement is.

**How this meets A1418.** The old box, switched on later, finds a statement signed with its own key
saying it was replaced: "replaced" no longer depends on comparing terms. The builder checks whether
A1418 part 1's decision 1 ("an equal term is not replaced") can then go.

**Restoring a backup older than the box that replaced it** (owner, 2026-11-07: "Allow, after a
warning"). Example: A was replaced by B; B dies; only an old backup of A is left, and it becomes C.
The bucket already holds "A is replaced by B", and C cannot sign for B, whose key was never in A's
backup. The restore screen says the backup is from box A, which box B replaced on that date, that
restoring it loses everything since, and offers the bucket's newest copy instead. If the admin
confirms box B is gone for good, C records that it replaces A and B. B, if switched on later, learns
it was replaced from C's higher term, since no statement signed with its own key exists. The same
applies to a backup restored twice.

**The owner's recovery pack keeps working** (my call, from the owner's rule that recovery never
asks for re-entry). Today a pack trusts only pointers signed by the key it holds
(`apps/server/src/backup-recovery-pack-parts.ts:138-148`, `apps/server/src/restore-stream.ts:274-281`,
read), so after a restore it would stop opening the bucket. Instead a bucket restore follows the
replacement statements at the fixed bucket key from the pack's key to the current signer, through
any number of restores (A, then B, then C). The dashboard may still suggest a fresh pack; nothing
depends on it.

## 5. What nobody has to touch

Measured by reading (survey, "Not found"): devices, device profiles, tills, sessions, printers and
card-reader pairing store no node id; tills route by address and term. Print agents on other devices
route by address, term, selling and environment (`packages/print-agent/src/router.ts:108-135`).
The box's own print agent is found by id and moves to the new id (§4). The certificate the box
serves is not tied to the node id and is reissued as today.

The build must show this by running it: a restore test in which a till, a print agent and a card
reader paired before the backup work after the restore with no new pairing.

## 6. The dashboard

Two machines in the box's history: the old one marked "replaced on" with the date by the new one, the new
one current (owner). Wording and placement are the builder's, under the design system.

## 7. Earlier text this changes

- Waitron Cloud's contract says both restores recover the source identity (`:687-690`, quoted in
  A1188 "What exists today"). A1188 §9 item 4 already plans the amendment for the emergency copy;
  this extends it to every restore. Cloud must agree before the restore half is built.
- The `SentPointers` comment (`packages/stream/src/pointer.ts:124-127`) assumes one id per venue.
- A1418's spec §3 ("a rebuild reuses the dead box's node id") gets a dated note, and A1418's
  "replaced" check accepts the replacement statement (§4). A1418 can be built first; the restore half
  amends it.
- The root `CLAUDE.md` fiscal rule "working-time chain continues from its head" retires for restores:
  the restored box's working-time records go on its own chain, as they already do after a takeover.
  `packages/workforce/src/restore-continuation.test.ts` assumes the kept id and changes with it.

## 8. Order of work

1. The takeover readers and fiscal rules (§2, §3), proved by the probe's five cases turning green in
   `handover-controlled.e2e.test.ts`, plus the certificate card's `it.fails`. Needs nothing from Cloud.
2. A route that reaches a cancellation, if the venue needs one before go-live.
3. The restore as a takeover (§4, §5, §6), after Cloud agrees the contract change (§7). This is the
   expensive half. What it buys beyond A1418 alone (a restore takes a term above everything in its
   bucket): an old box is told by its own key's signature that it was replaced, two machines are never
   one name, and A1188's emergency copy gets the restore it needs.

Planning: part 1 is planned in full now; part 3 gets an outline until Cloud has answered.

**2026-11-08:** part 1 is built in #2570 (A1425). Part 2 is not built.

## 9. Left to the builder

- How a restore is written into the taken-over-from list: a handover activation row or a row of its
  own, as long as `readHistoryNodes` and the backup check's copy of its walk (§2) read both.
- Order numbers continue from the highest number any box in the list gave out (my call; one counter
  for the venue is also fine). Either way, no number repeats. Numbers the dead box gave out after the
  backup are lost with the rest of that tail, as a restore already accepts.
- The exact form, signature format and bucket key of the replacement statement, and how the chart
  lists the old box as removed within its eight places.
- Every reader's kind (§2), listed in the plan.
