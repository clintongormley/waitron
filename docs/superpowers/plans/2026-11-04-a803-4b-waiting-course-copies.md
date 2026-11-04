# A803 slice 4b: waiting dishes leave with their own copy of the course — task plan

**Goal.** Today a dish in a held group (a course the waiter has not fired yet) stops its bill from
leaving the party: **Move this bill** to a table and **Split a table** are refused with
`group.held_leaves_party`. After 4b, both carry such dishes over. The party at the other table gets
its own still-held copy of each held group the moving dishes were in, never a fired one. The two
tables then fire their copies separately: firing one sends none of the other's dishes. The kitchen's
MOVED slip names only the dishes that moved, listing the held ones under HOLD where their HOLD paper
exists, and nothing already printed changes. **Move to the counter** keeps the refusal, with words
that no longer say "another table".

**Implements.** The [4a plan](2026-11-01-a803-4-portion-picker.md)'s "Cut 4b (outline)" and its
finding 7, the contract rows naming 4b, and the [master plan](2026-10-19-a803-bills-and-tables.md)'s
"Slice 4" ("Course contract" paragraph, the `A803 waiting copy` and `A803 race replay` items) under
its "Global constraints and release gates" and "Shared execution and verification contract". The
[spec](../specs/2026-10-18-a803-bills-and-tables-design.md) §3.7 ("A dish waiting for its course can
go. The leaving table gets its own copy of that course, still waiting, and fires it separately …
The kitchen gets a MOVED notice for the dishes that changed table only.") and §6 ("Moving a whole
bill with waiting dishes to another table uses the same own-copy-of-the-course fix as 3.7"). Binding
except where "Departures" says otherwise and why.

**Branch** `feat/a803-4b-waiting-course-copies`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a803-4b-waiting-course-copies`, planned from
main `7d3900e7a4` (2026-11-04). Every file and line below was read at that commit; what was run is
named, with its command, in "Receipts".

**Review weight: FULL.** Risk triggers: concurrency (two tills acting on one party's held group) and
the kitchen release state of dishes (a wrong answer fires food early or never). Per-task review by a
high-effort reviewer after each task; `/finish-branch`'s full wave at the end, with the Codex run-it
seat run twice (the second set to test what the checklist does not name).

**Execution.** Subagent-driven: each task goes to one `implementer` (medium effort), then a
high-effort reviewer. Each task below is sized well under 100 tool calls (estimate in its heading).
An implementer past about 150 calls stops at a passing or cleanly red point, commits, and hands over:
done, left, files, each check's state.

**Dependencies.** 4a landed (#2372). A773-2 PRs B to D landed (#2381 … #2446). A1301 S18a landed
(#2447). Nothing waits on another branch. 4c (Split a table through the 4a picker) waits for 4b.

**A1301 (location removal) binds here.** Nothing new is keyed on locations: no `locationId`
parameter, column, fixture value or rule. Existing fixtures that already pass `v.cfg.locationId`
(for example `party-move-bill.test.ts:85`) are left as they are; A1301's slices remove them.

## Owner questions

Building goes ahead on each default. A question about new Spanish blocks landing only.

**Question 1 of 2 (new Spanish; blocks landing).** After 4b, `group.held_leaves_party` is sent only
when a bill with held dishes is moved to the counter. Its words today
(`apps/till/src/i18n/codes.ts:338-341`) say "Items still on hold cannot move to another table until
their group is fired" / «Los artículos en espera no se pueden pasar a otra mesa hasta que se marche
su grupo», which would then be false: they can move to another table. Worked example: Table 5's
bill has a flan held for desserts; the waiter chooses **Move this bill → Counter**. Proposed:

- EN: "Items still on hold cannot move to the counter until their group is fired. They can move to
  another table."
- ES: «Los artículos en espera no se pueden pasar al mostrador hasta que se marche su grupo. Sí se
  pueden pasar a otra mesa.»

«mostrador» is the till's word for the counter (`apps/till/src/i18n/strings.ts:2242`, `:3382`).
Default: as proposed.

**Question 2 of 2 (no new words; does not block landing).** Which group number the copy prints.
Worked example: Table 5 holds GROUP 2 · POSTRES (a flan on Bill 1, a tarta on Bill 2), and its HOLD
ticket printed. Bill 2 moves to Table 8, which has nothing yet. The kitchen gets a MOVED slip
"Mesa 5 → Mesa 8", with the tarta under HOLD and a group line. Later each table fires its own copy.

- **(A, recommended and built)** The copy takes Table 8's next number, as any new group there would:
  the MOVED slip says `HOLD / GROUP 2 · POSTRES / 1 x TARTA` if Table 8's arriving dishes took GROUP
  1, and Table 8's later FIRE says the same number. Every group a party holds has a number no other
  group of that party shares, whatever moves later.
- (B) The copy keeps Table 5's number and table (the way a join keeps a group's number,
  `moveGroupsToParty`, `order-groups.ts:730-746`). The MOVED slip and FIRE then say `GROUP 2 · Mesa
  5`. But moving the bill back, or joining the two tables later, puts two different groups in one
  party with the same number and the same table name on paper (`readGroupNumberLabels`,
  `order-groups.ts:2477-2517`, tells duplicates apart only by the table that numbered them).

Default (A). Changing to (B) later changes one insert in `copyHeldGroups` and the paper cases.

## Read this first: what the planning pass found

1. **Lifting the refusal alone fires a dish held by hand, merges held groups and leaves empty held
   groups behind** (measured, "Receipts" R1–R3). With `refuseHeldLeavingParty` made a no-op in a
   throwaway worktree: (R1) a flan held by hand, with no course, moved to a seated table arrived
   **fired**, in the arrival's fired group beside the burger; (R2) two held groups, both flans of a
   course held until fired, arrived as **one** held group of two lines; in both, the source's held
   groups stayed `held` with **zero** lines. (R3) The same move to a free table was refused
   `allergy.unanswered`, because firing on arrival needs the new party's allergy answer, which a new
   party at a free table does not have unless the source answered "allergies"
   (`moveBillAllergies`, `packages/venue-service/src/party-allergy.ts:404-430`). An empty held group
   is not harmless: the release reminder counts a held group with no lines as the one waiting
   (`releaseReminder`, `order-groups.ts:1597-1601`, `own.length === 0`). This is the outline's
   finding 7, now measured.

2. **A773-2 added no group state.** `order_groups.state` is still `held | fired | removed`
   (`packages/db/src/schema/order-groups.ts:18`). "Requested" and "waiting for the pass" are stamps
   on a dish's kitchen item (`ticket_items.requested_at`, `pass_controlled`), on dishes of **fired**
   groups. Those dishes already leave their party today: `leaveParty` clears their group and
   `groupArrivingDishes` puts a Requested dish in the arrival's fired group, never re-held or
   re-requested (`order-groups.ts:2617`, B2's D31, pinned by `party-arriving-dishes.test.ts`
   "A773 requested lifecycle: arrival", `:1071` onwards). A held group's dishes have both stamps
   null: by reading, the two writers that stamp a dish of a held group take it out of held first —
   `releaseGroup` sets the group fired in the same call (`order-groups.ts:853-907`), and
   `fireHeldLine` moves the line to a new fired group before firing it (`:613-620`); the case "still
   lets a held dish change course" (`kitchen-request.bill-move.test.ts:237-247`) asserts
   `{ requestedAt: null, firedAt: null }` for a held dish at a station that waits for the pass. So 4b
   copies only `held` groups, and a copy is always `held`. No owner question is needed for A773-2's
   states.

3. **Where the MOVED slip gets its HOLD section, and why the held dishes must stay in their group
   until the copy exists.** `moveBillOnce` calls `leaveParty` (`move-bill.ts:197`) and only then
   reads the "before" picture for the MOVED slip (`readSentWork`, `:198`). That picture lists a held
   dish only while its line is in a `held` group whose HOLD ticket printed (`readOnHoldTickets`,
   `kitchen-print.ts:1548-1567`). After the move, `notifyMoved` (`:1688`) prints a held dish only at a station
   recorded as having its group's HOLD paper (`onHeldPaper`, `:1518-1543`), under that group's
   number (`buildTicketItems`, `:217`). So `leaveParty` must leave held dishes in their source group
   (not clear them, as it clears fired ones, `:525-528`), and the copy must carry the HOLD paper facts
   for the moved dishes, or the MOVED slip silently drops them. Split a table reads its "before"
   inside `withMovedSlips` (`table-actions.ts:320`), after `leaveParty` (`:317`): the same holds.
   By reading; Task 2's first deletion control (held dishes cleared like fired ones) and Task 5's
   (no HOLD paper facts on the copy) establish it.

4. **The copy must come after the arriving dishes are grouped.** `groupArrivingDishes` groups only
   lines with no group (`order-groups.ts:2599`) and appends its fired group at the party's last
   position. If the copies were made first, the arriving fired group would sit after a held copy,
   and the release reminder, which waits for the dishes of every group before the waiting one
   (`:1604-1608`), would not wait for them. Held dishes left in their source group are skipped by
   `groupArrivingDishes`, so making the copies right after it is safe. The outline said "before
   `groupArrivingDishes`"; that is replaced (D3).

5. **Drafts name groups.** A draft line can name a group to join (`order_draft_lines.join_group_id`)
   or to follow (`after_group_id`), and a recalled dish's draft row names the group it follows
   (`order_draft_recalled_lines.after_group_id`) (`packages/db/src/schema/order-drafts.ts:76-77`,
   `:98-112`). Today a bill moved with such a draft keeps the stale reference and the next save is
   refused `group.not_found` (`order-drafts.db.test.ts:4521`, "A stale target must travel unchanged",
   pinned at `:4672-4690`). That case moves a bill whose only held dish is recalled, so no copy is
   made and it stays as it is. Where a copy **is** made, the master plan says "Rebind only moved
   portions and their draft reservations": 4b rebinds the moving bill's drafts from the source group
   to its copy (D8).

6. **The changed checks are fewer than the outline listed.** `rg -n 'held_leaves_party' apps
   packages` finds the refusal pinned on table paths only at `party-table-actions.test.ts:1432-1446`
   (Split a table) and `order-drafts.db.test.ts:4735-4787` (free table, seated table, Split a table).
   `party-move-bill.test.ts:740-756` moves to the **counter** (`{ counter: { zoneId } }`, `:751`),
   as do `collect-at-counter.test.ts:553` and the till's `till-app-parties.test.ts:4163` (`to: {
   counter: true }`, `:4170`): they stay. The till's `:2542` row mocks the API and pins only the
   till's wording; it stays (see "Changed checks"). One check the outline did not list changes:
   `apps/till/src/i18n/codes.test.ts:271-274` pins the words Question 1 replaces.

7. **The guides say nothing about held dishes and moving a bill.** `rg -n -i 'leave (its|their)
   party|cannot leave|held.*another table' docs/developers docs/operations apps/server/src/guide`
   finds nothing relevant; `table-service.md` has no section on **Move this bill** or **Split a
   table** beyond naming them in the ⋮ list (EN `:250-253`). Its "Move dishes" section's "Send held
   items to the kitchen before moving them to another bill" (`:312-314`) is a different refusal
   (`tab.split_held_line`) and stays. 4b adds a short section, and one paragraph to
   `kitchen-service.md#held-work`.

8. **The race pattern.** `bill-editing.table-actions.test.ts` has no promise barrier (`rg -n -i
   'barrier|withResolvers' apps/server/src/bill-editing.table-actions.test.ts` prints nothing). The
   barrier pattern is in `order-drafts.db.test.ts:5988-6006` (both commands read their revisions,
   wait on one barrier, then race under `Promise.allSettled`) and `kitchen-allergy.atomic.test.ts:28-60`
   (a barrier that proves the store took them in turn). Task 6 uses the first.

9. **Firing a copy at a newly opened party needs that party's allergy answer**, as any fire there
   does (`assertPartyAllergyAnswered`, called by `releaseGroup`, `order-groups.ts:866`; R3). Split a
   table copies the answer (A669, `VENUE_SERVICE.splitPartyAllergies`); Move this bill to a free
   table copies only an "allergies" answer (finding 1). 4b changes neither; tests that fire a copy at
   a free table answer first, and the guide says the till may ask.

10. **Other branches.** At planning, three branches touch the files 4b edits, all lightly:
    `refactor/a1301-s18b-server-ignored-params` (`kitchen-print.ts` −7 lines, `working-order.ts`
    23 lines), `feat/a739-payment-window` and `feat/a802-partial-invoice-correction` (2–3 lines of
    `working-order.ts` each). None touches `move-bill.ts`, `table-actions.ts` or `order-groups.ts`
    (`git diff --stat main...<branch> -- <the five files>`). Overlap is a reason to rebase often, not
    to wait.

11. **A1192 (MOVED slips print each portion on its own line)** is not touched. 4b's MOVED slips go
    through the same `printMovedSlips` (`kitchen-print.ts:1793`), so three identical held portions
    would print three lines, as every MOVED slip does. 4b's paper cases use different dishes, one of
    each, so that A1192's later change does not have to rewrite them.

12. **Noticed, outside 4b (by reading, not run).** A Requested dish (fired group, not yet released
    by the pass) is in neither half of the MOVED slip's "before" picture: `readSentItems` takes
    released items (`fired_at` set) and held-group items on HOLD paper (`kitchen-print.ts:1490-1513`).
    So a Requested dish whose group's HOLD ticket printed before it was fired may move to another
    table with no MOVED line. This is A773-2's area. Task 11 probes it and, if confirmed, adds one
    backlog point; 4b does not change it.

## Where the outline is now wrong

| Outline (2026-11-01) | Now | Receipt |
| --- | --- | --- |
| `leaveParty` `move-bill.ts:507-543`; `refuseHeldLeavingParty` `working-order.ts:4865-4881`; `groupArrivingDishes` `order-groups.ts:2431` | `move-bill.ts:499-536` (refusal at `:520`); `working-order.ts:5005-5025`; `order-groups.ts:2571-2675` | read at `7d3900e7a4` |
| `groupArrivingDishes` makes "one new fired group plus one new held group per course" | still, plus a `released` branch: Requested dishes join the fired group (B2's D31) | `order-groups.ts:2614-2633` |
| `copyHeldGroups` runs before `groupArrivingDishes` | runs right after it; held dishes stay in their source group until then (D3) | finding 4 |
| The copy keeps the source's `remindAt` | `remindAt` null (D6) | `reorderHeldGroups` "A snooze belongs to the place in the sequence it was given at" (`order-groups.ts:945`) |
| Silent on the group number | the destination's next number (D4, Question 2) | finding 3, Question 2 |
| HOLD paper facts copied | `holdPrintedAt` and only the recorded stations that hold a moved dish (D5) | `onHeldPaper` reads stations per item |
| Changed checks include `party-move-bill.test.ts:740-756` and the till's `:2542`, `:4163` | those three stay; `codes.test.ts:271-274` changes | finding 6 |
| `order-drafts.db.test.ts:4753-4802` "split table" | `:4735-4787`, one `it.each` over three destinations, all three change | finding 6 |
| "Gate: … the refusal wording stays for the counter" | the words must change (Question 1) | `codes.ts:338-341` says "another table" |
| (master plan) race replay "as `bill-editing.table-actions.test.ts` does" with promise barriers | that file has none; the pattern is `order-drafts.db.test.ts:5988-6006` | finding 8 |
| (master plan) `copyWaitingCourses(tx, fromPartyId, toPartyId, portionIds)` | `copyHeldGroups(tx, fromPartyId, toPartyId, lineIds, operatorId, attendance?)` | 4a's D2: line ids are one-to-one with bound portions; an event needs an operator (`recordGroupEvent`, `:2542`) |
| (master plan) "Do not implement A773-2 Requested/pass release states here" | unchanged: a Requested dish is never in a held group (finding 2) | |

## Decisions

- **D1 What is copied.** For each source group in state `held`, belonging to the leaving party, that
  holds a leaving dish line (top-level, not recalled into a draft): one new `held` group at the
  destination party. The leaving lines and their extras (`parent_line_id` in them) move to the copy.
  A dish recalled into a draft still leaves its group and travels as a draft row (today's
  `clearGroups` in `leaveParty`, `move-bill.ts:525-528`). Lines of fired groups leave their group as
  today. Nothing else moves: ticket items, kitchen print links and portion bindings are untouched (a
  copy changes no `ticket_items` row; Task 1a pins it).
- **D2 One copy per source group, in the source's order.** Two held groups with the same course stay
  two copies (R2 shows the arrival path would merge them). Copies take the destination's next
  positions after everything already there, ordered by the source's `position`, `created_at`, `id`
  (the order `moveGroupsToParty` and `releaseHeldWorkOf` use, `:739`, `:806`).
- **D3 When.** `leaveParty` gains a mode: on a path to a table it leaves held, non-recalled dishes in
  their group and returns their ids; on the counter paths it refuses as today. The copies are made
  right after `groupArrivingDishes` and before the MOVED slips are queued (finding 3, finding 4).
- **D4 The copy's fields.** `state: "held"`, `firedAt`/`firedBy`/`firedByDeviceId` null (never a
  fired time), `submittedBy` the source's (who asked for the course), `requestKind: "next_course"`
  (every held group is created so: `order-groups.ts:379`, `:1124`, `:1404`, `:2695`; `releaseGroup`
  decides `new_order` when it fires, `:884`), `displayNumber` the destination's next
  (`nextGroupNumber`, `:2463`) with `numberPartyId` the destination (Question 2, default A),
  `holdPrintedAt` the source's (D5), `remindAt` null (D6).
- **D5 HOLD paper.** The copy keeps the source's `holdPrintedAt`, so the moved dishes are on HOLD
  paper exactly as they were. Its `order_group_hold_stations` rows are the source's rows for the
  stations where a moved dish or one of its split-off extras has an unfired kitchen item
  (`heldPaperStations` ∩ `dishKitchenItems`, `dish-kitchen.ts:51`). The source keeps all its rows.
  No HOLD ticket, no HOLD CHANGED slip is printed at the move: the MOVED slip is the paper, as for
  Transfer items of a held dish today (`move-merge.test.ts:1245`). The copy's later FIRE is marked
  FIRE at the copied stations, by `releaseGroup`'s existing rule (`:871-873`).
- **D6 No snooze carried.** A snooze belongs to the place in the sequence it was given at (the
  existing rule, `reorderHeldGroups` `:945-948`, `startGroupAfter` `:1407`); the copy takes a
  new place at another party, so its reminder runs from its new place.
- **D7 The emptied source is removed.** A source group left with no line goes `removed` with a
  `removed` event naming the mover (`removeEmptiedHeldGroups`, `:1426`). A source still holding a
  staying dish, or a recalled one, stays held.
- **D8 Drafts follow the copy.** In the same call, the open drafts of the bills whose lines moved
  have `join_group_id`/`after_group_id` (draft lines) and `after_group_id` (recalled rows) rewritten
  from each copied source group to its copy. A reference to a group that got no copy is left as it
  is (finding 5's pinned case).
- **D9 Events.** One `lines_moved` event on the source (`detail: { lineIds, to: copyId }`) and one on
  the copy (`detail: { lineIds, from: sourceId, arrived: true }`), actor the operator, with attendance
  when given (as `groupArrived`, `:2701-2711`). Task 1a first lists every reader of
  `orderGroupEvents.detail` (`rg -n 'orderGroupEvents' apps/server/src -g '!*.test.ts'`) and stops if
  one reads `lines_moved` details in a way these shapes would break.
- **D10 Counter keeps the refusal.** Move this bill to the counter and the paid bill sent to the
  counter by Finish table (`moveSettledBillToCounter`, `move-bill.ts:292-318`; held work is fired
  before it by `releaseHeldWorkOf`, `finish-party-service.ts:262`) keep `group.held_leaves_party`:
  a counter order has no party, so no groups. Only the words change (Question 1).
- **D11 Concurrency.** Every path already moves the source party's revision (`guardPathParty`,
  `bill-actions.ts:123-138`; `checkAndBumpParty` in `splitTable`, `table-actions.ts:298-304`), and
  `fireGroup`, `fireHeldLine`, `moveLinesToGroup` and the reorder check it. Of two commands read from
  one revision, the second to run is refused (`party.out_of_date` expected; Task 6 records what the
  run shows). 4b adds no lock.
- **D12 The server is the whole change.** The till has no held-dish gate on Move this bill or Split a
  table (`rg -n -i 'held' apps/till/src/screens/till-table-order-screen.ts` shows held-group verbs
  only, `:355-363`); its only changes are the counter refusal's words and a stale client comment.

## Departures from the master plan

| Master plan says | Here | Why |
| --- | --- | --- |
| New `waiting-course-copy.ts` | `copyHeldGroups` in `order-groups.ts`, beside `moveGroupsToParty` and `removeEmptiedHeldGroups` | it needs `nextGroupNumber`, `lastPosition`, `recordGroupEvent`, which are module-private there |
| "retaining course identity/name, waiting state and ordering" | a group has no course; its dishes do, and the paper heading reads them (`headingCourses`) | the copy keeps the dishes, so it keeps their courses; D2 keeps the order |
| `A803 race replay` in `bill-editing.table-actions.test.ts` | in `waiting-course-copy.test.ts`, barrier pattern of `order-drafts.db.test.ts:5988-6006` | finding 8 |
| One RED command over `portion-moves`, `waiting-course-copy`, `party-table-actions` | per-task RED commands | 4a built `move-dishes.test.ts` instead of `portion-moves` |

## Current code map (main `7d3900e7a4`)

| Boundary | Where |
| --- | --- |
| Move this bill | `apps/server/src/move-bill.ts`: `moveBill` `:127`, `moveBillOnce` `:162` (`leaveParty` `:197`, `readSentWork` `:198`, counter branch `:223-237`, free table `:238-259`, seated `:260-276`, `printHoldTickets` `:282`, `enqueueMovedSlips` `:283`), `moveSettledBillToCounter` `:292-318`, `leaveParty` `:499-536` |
| Split a table | `apps/server/src/table-actions.ts`: `splitTable` `:284-363` (`leaveParty` `:317`, `withMovedSlips` `:320`, `groupArrivingDishes` `:341`, `printHoldTickets` `:355`, `ensureFamilyBill` `:356`), `refuseUnsplittableBill` `:367` |
| Groups | `apps/server/src/order-groups.ts`: `releaseGroup` `:853`, `moveGroupsToParty` `:730`, `releaseHeldWorkOf` `:781`, `reorderHeldGroups` `:909`, `startGroup` `:1350`, `removeEmptiedHeldGroups` `:1426`, `releaseReminder` `:1591`, `printHoldTickets` `:2119`, `recordHeldPaper` `:2166`, `heldPaperStations` `:2180`, `holdPaperFor` `:2239`, `lastPosition` `:2455`, `nextGroupNumber` `:2463`, `readGroupNumberLabels` `:2477`, `recordGroupEvent` `:2542`, `groupArrivingDishes` `:2571`, `groupArrived` `:2677` |
| Refusal | `working-order.ts`: `refuseHeldLeavingParty` `:5005-5025`, `clearGroups` `:5028`; `errors.ts:579`; `till-api.ts:620` (409) |
| MOVED slips | `kitchen-print.ts`: `SentWork` `:1467`, `readSentWork` `:1479`, `readSentItems` `:1490`, `onHeldPaper` `:1518`, `readOnHoldTickets` `:1548`, `enqueueMovedSlips` `:1578`, `notifyMoved` `:1688`, `movedItems` `:1735`, `printMovedSlips` `:1793`, `enqueueMovedSlipsFor` `:1920`; `moved-slips.ts` `withMovedSlips`; `kitchen-ticket.ts` `formatMovedSlip` `:663`, `emitGroup` `:287` |
| Schema (unchanged) | `packages/db/src/schema/order-groups.ts` (`order_groups` `:32`, states `:18`), `order-group-hold-stations.ts:10`, `order-drafts.ts:76-112`; classified `state`/append-only events in `packages/db/src/classification.ts:198-212` |
| Till | `apps/till/src/i18n/codes.ts:338-341`, `codes.test.ts:271-274`, `api/client.ts:4490` (moveBill doc, still true), `:4699` (splitTable doc, goes stale), `till-app.ts:628` (`TABLE_REFUSALS`, stays) |
| Guides | `apps/server/src/guide/en/table-service.md` (⋮ list `:247-255`, `#move-dishes` `:289-326`), `guide/en/kitchen-service.md#held-work` `:56-72`, and the ES twins |
| Test homes | `party-arriving-dishes.test.ts` (setup with courses `:73-97`, HOLD ticket helpers `:858-936`), `move-merge.test.ts` (MOVED slip helpers, held cases `:1049-1330`), `party-table-actions.test.ts` (`refused` snapshot helper `:234-244`), `order-drafts.db.test.ts` (`movingFamily` `:4501-4566`) |

## Consumer trace (planning run, `7d3900e7a4`)

Run each again at the task that touches it; list any new consumer in the ledger.

| Consumer | What 4b does to it | Task |
| --- | --- | --- |
| `leaveParty` callers: `moveBillOnce` `:197`, `moveSettledBillToCounter` `:311`, `splitTable` `table-actions.ts:317` | gains a mode; counter callers keep "refuse" | 2 |
| `refuseHeldLeavingParty` (only `leaveParty`, `rg -n refuseHeldLeavingParty apps/server/src`) | unchanged code; its doc comment narrowed to the counter | 2, 8 |
| `groupArrivingDishes` (`move-bill.ts:250`, `:266`; `table-actions.ts:341`) | unchanged; held dishes still grouped are skipped | 2 |
| `readOnHoldTickets`, `onHeldPaper`, `buildTicketItems`, `releaseGroup`'s `heldPaper`, `holdPaperFor`, `readReprintParts` (`kitchen-print.ts:1973`) | read the copy's `holdPrintedAt` and stations; no code change planned | 5 |
| `releaseReminder`, `readHeldCounts` (`:1723`), `readCurrentOrders` (`:1863`), the pass board's Held column, the station queue's `QueueGroup` (`working-order.ts:7821-7831`) | read the copy as a held group of the destination party; no code change planned | 3 (reminder case) |
| `order_draft_lines`/`order_draft_recalled_lines` group references | rewritten to the copy (D8) | 1b |
| `order_group_events` readers | D9's check | 1a |
| Till `codes.ts`, `codes.test.ts`, `client.ts:4699` | words, comment | 7 |
| `docs/backlog/kitchen.md:390` (A660's record: "a bill holding a held course cannot move again") | dated pointer | 11 |
| `docs/superpowers/specs/2026-09-28-table-actions-design.md:242`, `:387` | dated pointer | 11 |

## Changed checks

The owner's rule (2026-10-05): an assertion may change only where it pins behaviour this slice
deliberately changes, and then to check the new behaviour at least as strictly. Every other existing
assertion stays; growth of fixtures is not a change.

| # | Check | Pins today | Pins after | Why the spec forces it | Task |
| --- | --- | --- | --- | --- | --- |
| 1 | `apps/server/src/party-table-actions.test.ts:1432-1446` "refuses a bill holding a dish held for the kitchen (Review Focus 4)" | Split a table refused `group.held_leaves_party` `{ tabId: b2, lineNo: 2 }`, parties/bills/tables unchanged | renamed "A803 waiting copy: Split a table takes a bill holding a dish held for the kitchen, and the new party holds its own copy of the group": the bill is the new party's; the flan's line is in a `held` group of the new party with `firedAt` null; the source's group is `removed`; the flan's kitchen item is unfired | §3.7 "A dish waiting for its course can go" | 2 |
| 2 | `apps/server/src/order-drafts.db.test.ts:4735-4787` `it.each(["free table", "occupied table", "split table"])` "a recalled companion does not let active held work leave for a %s, and refusal changes nothing" | all three refused `group.held_leaves_party` `{ lineNo: 3 }`, writing nothing | renamed "a recalled companion travels as a draft row while active held work leaves for a %s with its own copy of the group": the active line (and its extras) in a new `held` group of the destination party; the recalled source line has no group and its draft row is unchanged except `after_group_id` → the copy; the fresh draft lines' `join_group_id`/`after_group_id` → the copy; the source group `removed` | §3.7 (split), §6 (whole bill); D8 | 2 (body), 1b supplies the rebinding |
| 3 | `apps/till/src/i18n/codes.test.ts:271-274` | EN/ES "…cannot move to another table…" | Question 1's words | the old words become false once a held dish can move to a table | 7 |

Stay unchanged (outline listed some of them): `party-move-bill.test.ts:740-756` (counter);
`collect-at-counter.test.ts:553` (counter); `till-app-parties.test.ts:4163` (counter);
`till-app-parties.test.ts:2542` (a mocked `splitTable` rejection: it pins that the till words this
code, which the till still must do for the counter; the server no longer sends it for Split a table,
which the server cases pin); `client.test.ts:2784-2801` (counter); every `party-arriving-dishes.test.ts`
case (their waiting dishes have no group at the source, `coursedBill` `:200-209`, so they still take
the course-by-course arrival path). A red case in any other existing file is a stop: record it, do
not edit it, and ask in the ledger.

## Guard suites

Each command separately, each exit status checked, a nonzero **Tests** count read (CLAUDE.md §2, §4).
Local runs use `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true` when a passing case's
output must be seen.

- **H2, the fiscal pair (unedited):** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. Baseline 20 tests
  together (R5).
- **F (unedited):** `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
- **Filing (unedited):** `pnpm --filter @waitron/server exec vitest run src/move-merge.filing.test.ts src/order-portions.filing.test.ts src/transfer-lines.filing.test.ts`.
- **The move sweep:** every server test file that moves a bill or splits a table,
  `MOVES=( $(rg -l 'moveBill\(|splitTable\(|/move"|split-table' apps/server/src --glob '*.test.ts' | sed 's#^apps/server/##' | sort) )`
  (zsh: an array), run as `pnpm --filter @waitron/server exec vitest run "${MOVES[@]}"`. At
  `7d3900e7a4`: 46 files, 2,862 tests, all passing (R6). New files join it when they match.
- **The paper probe** (Task 5, Task 10): A773-2 D's wide paper probe,
  `PAPER=( $(/usr/bin/grep -rlE 'GROUP|GRUPO|decodeTicket|ticketText|paperText|printJobs|TextDecoder|\.bytes|jobText|paper|decode-ticket|printedLines|kitchenPrintJobs|kitchenTicketWords' apps/server/src apps/server/scripts --include='*.test.ts' | sed 's#^apps/server/##') )`,
  run as `pnpm --filter @waitron/server exec vitest run "${PAPER[@]}"`. Measure free memory first
  (`memory_pressure | grep free`); it is about 266 files.
- **G (guides):** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts`.
- **Words and codes:** `pnpm exec vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.
- **Types and format:** `pnpm --filter @waitron/server typecheck`; `pnpm --filter @waitron/till typecheck`; `pnpm format:check`.
- **S (schema): not needed.** 4b changes no schema: it inserts rows into `order_groups`,
  `order_group_hold_stations` and `order_group_events` and updates `working_order_lines.group_id`
  and the draft reference columns, all existing (`packages/db/src/schema/order-groups.ts`,
  `order-group-hold-stations.ts`, `order-drafts.ts`). If a task finds it needs a schema change, that
  is a stop for a plan change; it would then run S as A773-2 D lists it (`scripts/schema-constraints.test.ts`
  … `scripts/apply-migrations-callers.test.ts`, then `@waitron/composition`'s `src/composition.test.ts`).

A red H2, F or Filing case, or any diff to those files, is a stop. At each task's end,
`git diff 7d3900e7a4 -- packages/fiscal-verifactu apps/server/src/split-bill.fiscal.test.ts apps/server/src/till-api.fiscal-sale-paths.test.ts apps/server/src/transactional-series.test.ts apps/server/src/bill-payments.test.ts apps/server/src/bill-payments.card.test.ts apps/server/src/move-merge.filing.test.ts apps/server/src/order-portions.filing.test.ts apps/server/src/transfer-lines.filing.test.ts packages/db/src/schema packages/db/drizzle scripts/`
prints nothing.

## Test file

New `apps/server/src/waiting-course-copy.test.ts`, every case titled `A803 waiting copy: …`. Set up
as `party-arriving-dishes.test.ts:73-97` does (`useVenueDb({ resetPerTest: false, … })`,
`setupPartyVenue`, three courses created once; each case seats its own tables), with helpers copied
from there and from `move-merge.test.ts` (a station with a printer, `printedLines` of the jobs since
a mark, `setStationPrinting`). One helper, `rowsOf(partyIds, billIds)`, returns full rows, ordered,
of `order_groups`, `order_group_hold_stations`, `order_group_events`, `working_order_lines`,
`ticket_items`, `kitchen_notices`, `print_jobs`, `order_drafts`, `order_draft_lines`,
`order_draft_recalled_lines`, `parties`, `party_tables` and `working_orders` for those parties and
bills; refusal cases compare it before and after with `toEqual`.

Focused RED/GREEN command for this file:
`pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts -t '<case>'`.

---

## Task 0: preflight (no commit; about 15 calls)

- [ ] `git -C <worktree> fetch && git log --oneline 7d3900e7a4..origin/main -- apps/server/src/move-bill.ts apps/server/src/table-actions.ts apps/server/src/order-groups.ts apps/server/src/working-order.ts apps/server/src/kitchen-print.ts apps/server/src/order-drafts.ts apps/till/src/i18n`.
  If anything landed, rebase and re-read the lines this plan cites before Task 1a.
- [ ] Re-run finding 10's overlap check across `git worktree list` and the lanes' queues
  (`~/waitron-campaign*/queue.md`); record overlaps in the ledger.
- [ ] Re-run `rg -n 'held_leaves_party' apps packages`; any hit not in finding 6 joins "Changed
  checks" or the stay list, with a reason, before Task 2.
- [ ] Post Question 1 to `~/waitron-campaign-c/questions.md` (one-at-a-time format, worked example
  as above) and Question 2 beside it, marked "default built, does not block landing".
- [ ] Write the ledger `docs/handoffs/2026-11-04-a803-4b-waiting-course-copies.md`
  (`Status: in progress`).

## Task 1a: `copyHeldGroups` (about 55 calls)

**Files.** `apps/server/src/order-groups.ts` (new export beside `moveGroupsToParty`), new
`apps/server/src/waiting-course-copy.test.ts`.

**Contract.**

```ts
/**
 * Give each held group of `fromPartyId` holding one of `lineIds` a held copy at `toPartyId`, and
 * move those lines and their extras to it (plan D1–D9). Returns source group id → copy id.
 */
export async function copyHeldGroups(
  tx: Transaction,
  fromPartyId: string,
  toPartyId: string,
  lineIds: readonly string[],
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<Map<string, string>>;
```

A named line that is an extras line, recalled into a draft, in no group, in a group that is not
held, or in a group of another party is ignored. The tests call it directly inside `inTx`, after
moving the bill's row to the destination party by hand (`update working_orders set party_id`), so
they do not depend on Task 2.

- [ ] D9's reader check: `rg -n 'orderGroupEvents' apps/server/src -g '!*.test.ts'`; record each
  reader of `detail` in the ledger; stop if one would misread D9's shapes.
- [ ] **Failing tests** (all `A803 waiting copy: copyHeldGroups …`):
  1. "… copies a held group shared by a leaving and a staying bill, moving only the leaving dish and
     its extras": party A, Bill 1 (Flan, held, group G) and Bill 2 (Tarta, held, same G: place both
     on Bill 1 with `placeGroups`, then move the Tarta to a new bill with 4a's `moveDishes`, which
     keeps its group; give the Tarta an extras line as `party-arriving-dishes.test.ts:794-806`
     makes one); party B seated. Copy Bill 2's
     Tarta. Asserts the whole new `order_groups` row (`state: "held"`, `firedAt`/`firedBy`/
     `firedByDeviceId` null, `submittedBy` G's, `requestKind: "next_course"`, `remindAt` null,
     `position` B's last + 1, `displayNumber` B's next, `numberPartyId` B, `holdPrintedAt` G's);
     the Tarta and its extra's `group_id` is the copy; the Flan's is G; G is still `held`; the
     returned map is `{ G → copy }`; `ticket_items` rows are equal before and after.
  2. "… keeps two held groups of one course as two copies, in the source's order": G2 and G3 both
     Postres; both copied; copies at B's last+1 and last+2 in G2, G3 order.
  3. "… removes a source group the copy empties, with a removed event naming the mover".
  4. "… copies the recorded HOLD stations that hold a moved dish, and no others": G printed HOLD
     at Grill (Tarta) and Pastry (Flan, staying) (stations with printers as `move-merge.test.ts:543`
     `stationWithPrinter` makes them); copy's `order_group_hold_stations` is `[Grill]`;
     G keeps both.
  5. "… writes one lines_moved event on each side, naming the mover": D9's details, `toEqual` on the
     event rows (ids and times matched by `expect.any(String)`).
  6. "… ignores a recalled dish, a dish of a fired group and an extras line it is given".
  7. "… leaves a snooze behind": G snoozed (`snoozeReminder`); the copy's `remindAt` is null; G's
     is unchanged.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts -t 'copyHeldGroups'`:
  every case fails with `copyHeldGroups is not a function` (or Vitest's missing-export error).
  Anything else is a stop.
- [ ] **Implement.** One select of the named top-level lines joined to `order_groups` (held, of
  `fromPartyId`) and `not(isRecalledDish(tx))` (`draft-source.js`, used by `activeGroupLines`
  `:753-774`), grouped by group in D2's order; per group: insert the copy (D4), copy the stations
  (D5), update `working_order_lines.group_id` for the lines and `parent_line_id` in them, the two
  events (D9); then `removeEmptiedHeldGroups(tx, fromPartyId, sources, operatorId, attendance)`.
- [ ] **GREEN.** The file unfiltered; `src/order-groups.test.ts`, `src/party-arriving-dishes.test.ts`
  (baselines 254 and 29, R4); `pnpm --filter @waitron/server typecheck`.
- [ ] **Deletion controls** (each removed alone, the named case must go red, then restored):
  the hold-station intersection (copy all of G's stations) → case 4; `removeEmptiedHeldGroups` →
  case 3; the source-order `orderBy` reversed → case 2; `remindAt: null` replaced by G's → case 7;
  the recalled filter → case 6.
- [ ] **Commit.** `git commit -s -m "A803 4b: copy a party's held groups for dishes leaving it"`.

## Task 1b: drafts follow the copy (about 40 calls)

**Files.** `apps/server/src/order-groups.ts` (`copyHeldGroups`), `waiting-course-copy.test.ts`.

- [ ] **Failing tests.**
  1. "A803 waiting copy: copyHeldGroups points the moving bill's draft at the copy": Bill 2 has an
     open draft with one line `join_group_id = G` (slot 0) and one `after_group_id = G` (slot 2),
     and a recalled row with `after_group_id = G` for a recalled Tarta of G. Copy Bill 2's other G
     dish. All three references read the copy; every other column of those rows is unchanged
     (`toEqual` on the whole rows with the one field replaced).
  2. "… leaves a staying bill's draft on the source group": Bill 1's draft line naming G is
     unchanged.
  3. "… leaves a reference to a group that got no copy as it was": Bill 2's draft names G3, which
     has no leaving dish; unchanged.
- [ ] **RED.** `… -t 'draft'` in the file: case 1 fails on the first reference still reading G;
  cases 2 and 3 pass already (they are pins; say so in the report).
- [ ] **Implement.** After the copies: for the open drafts (`order_drafts.state = "open"`) whose
  `bill_id` is a bill holding a moved line, three updates per copied source group (`join_group_id`,
  `after_group_id` on `order_draft_lines`; `after_group_id` on `order_draft_recalled_lines`).
- [ ] **GREEN.** The file unfiltered; `src/order-drafts.db.test.ts` (299 as at R4: no path calls
  the copy yet, so its `:4735-4787` refusal case still passes unchanged).
- [ ] **Deletion controls.** Drop the `bill_id` filter → case 2 red; drop the recalled-row update →
  case 1 red.
- [ ] **Commit.** `git commit -s -m "A803 4b: a moving bill's draft follows its held group's copy"`.

## Task 2: Move this bill and Split a table carry held dishes (about 60 calls)

**Files.** `apps/server/src/move-bill.ts`, `apps/server/src/table-actions.ts`,
`waiting-course-copy.test.ts`, `party-table-actions.test.ts` (Changed check 1),
`order-drafts.db.test.ts` (Changed check 2).

- [ ] **Failing tests** (new file):
  1. "A803 waiting copy: Move this bill to a free table takes a held dish, held, in its own copy of
     the group" (Burger fired, Flan held by `placeGroups`; free table; asserts the result party, the
     Flan's group is a `held` group of the new party with `firedAt` null, its kitchen item has
     `firedAt` and `requestedAt` null, the source's group `removed`).
  2. "… to a seated table" (same, onto a party with its own fired and held groups; the copy after
     all of them, and after the arrival's fired group holding the Burger).
  3. "… Split a table takes a bill holding a held dish" (the new party; the copy is after the
     arrival's fired group).
  4. "… Move this bill to the counter still refuses a held dish, writing nothing" (`rowsOf` equal;
     `group.held_leaves_party` `{ tabId, lineNo }`).
  And the two Changed checks (1, 2) rewritten as the table says.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts -t 'Move this bill|Split a table'`
  → cases 1–3 refused `group.held_leaves_party`, case 4 passes (a pin).
  `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/order-drafts.db.test.ts -t 'held'`
  → the rewritten checks fail on the same refusal.
- [ ] **Implement.** `leaveParty(tx, billId, held: "refuse" | "keep")` returning
  `{ firers, heldLineIds }`: "keep" skips `refuseHeldLeavingParty` and clears only lines that are
  not held-and-unrecalled; "refuse" is today's body. `moveBillOnce` passes "refuse" for the counter
  and "keep" otherwise, and calls `copyHeldGroups(tx, path.partyId, partyId, heldLineIds,
  options.operatorId, activity)` right after each `groupArrivingDishes` (free `:250`, seated
  `:266`); `moveSettledBillToCounter` passes "refuse"; `splitTable` passes "keep" and copies right
  after `:341`, inside `withMovedSlips`. Update the doc comments of `leaveParty` (`:493-497`),
  `splitTable` (`:278-283`, "holding no dish held for the kitchen") and `refuseHeldLeavingParty`
  (`working-order.ts:5005-5008`) to say the counter.
- [ ] **GREEN.** The new file unfiltered; `src/party-table-actions.test.ts` (89), `src/party-move-bill.test.ts`
  (68), `src/order-drafts.db.test.ts` (299), `src/collect-at-counter.test.ts` (17),
  `src/kitchen-request.bill-move.test.ts` (7), `src/party-arriving-dishes.test.ts` (29) — each
  count equal to the baseline (R4) plus the cases added; then the move sweep. Types.
- [ ] **Deletion controls.** "keep" clearing held lines like "refuse" does → cases 1–3 red (no
  copy is made and the dish takes the arrival path, R1); the copy call removed from the free-table
  branch → case 1 red, from the seated branch → case 2, from `splitTable` → case 3 and Changed
  check 1; the copy call moved to before `groupArrivingDishes` → cases 2 and 3 red (the arrival's
  fired group after the copy, finding 4); the counter given "keep" → case 4 red.
- [ ] **Commit.** `git commit -s -m "A803 4b: a bill with held dishes moves to a table or splits off with its own copy of each held group"`.

## Task 3: what the copy does afterwards (about 55 calls)

**Files.** `waiting-course-copy.test.ts` only, unless a case finds a defect (then test first, fix in
the file the failure names, and say so in the report).

- [ ] **Cases** (each RED before Task 2 by construction; here they are expected to pass on first
  run, so each gets a deletion control instead):
  1. "… a dish held by hand on a course that does not wait by itself stays held at the new table"
     (R1's shape: Flan with no course, held by hand; seated destination).
  2. "… two held groups of one course stay two at the new table" (R2's shape).
  3. "… firing the copy sends none of the source's dishes, and firing the source sends none of the
     copy's" (a group shared by Bill 1 staying and Bill 2 leaving; `fireGroup` on each in turn;
     `ticket_items.fired_at` per line).
  4. "… firing a copy at a free table asks for the new party's allergy answer first" (`fireGroup`
     refused `allergy.unanswered`; after `savePartyAllergy` it fires) — finding 9.
  5. "… firing the copy at a station that waits for the pass leaves its dish Requested"
     (`setStationsWaitForPass`, `testing/pass-waiting.js`; `requestedAt` set, `firedAt` null).
  6. "… moving the bill again copies the copy and removes the emptied one" (T5 → T8 → T9).
  7. "… the new table's release reminder names the copy once the dishes ahead of it are served"
     (`readReleaseReminders` on the destination, reminder minutes set as the `line-service-*.test.ts`
     files set them; the source's reminder no longer names a removed group).
- [ ] **Run.** `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts`.
- [ ] **Deletion controls.** In `copyHeldGroups`: copy rows inserted with `state: "fired"` and a
  `firedAt` → cases 1, 3 red; one copy per destination instead of per source group → case 2 red;
  `removeEmptiedHeldGroups` removed → cases 6, 7 red. Restore each.
- [ ] **Commit.** `git commit -s -m "A803 4b: tests that each table fires its own copy"`.

## Task 4: rollback and the routes (about 45 calls)

**Files.** `waiting-course-copy.test.ts`; `apps/server/src/till-api.move-bill.test.ts` and
`till-api.table-actions.test.ts` (one case each, beside their existing move and split cases).

- [ ] **Cases.**
  1. "A803 waiting copy: a move refused before it writes leaves every row as it was" (stale party
     revision → `party.out_of_date`; `rowsOf` equal).
  2. "… a failure after the copy rolls the copy back too": `vi.spyOn(groupWrites, "printHoldTickets")`
     (`import * as groupWrites from "./order-groups.js"`, as `order-drafts.db.test.ts:4811-4813`
     spies `groupArrivingDishes`) throwing a marker error; both paths call it after the copy
     (`move-bill.ts:282`, `table-actions.ts:355`); `rowsOf` equal before and after, for both paths.
  3. Route: `POST /api/bills/:id/move` to a free table answers 200 for a bill with a held dish, and
     `GET` of the new party's current orders lists a held group holding it.
  4. Route: `POST /api/parties/:id/split-table` the same.
- [ ] **RED/GREEN.** Cases 1, 3, 4 would have been red before Task 2 (refused); 2 is a pin of the
  transaction. `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts src/till-api.move-bill.test.ts src/till-api.table-actions.test.ts`.
- [ ] **Deletion control** for case 2: run the copy in a separate `withTransaction` (a throwaway
  edit) → case 2 red (the copy survives the failure). Restore.
- [ ] **Commit.** `git commit -s -m "A803 4b: a failed move leaves no copy behind"`.

## Task 5: kitchen paper (about 55 calls)

**Files.** `waiting-course-copy.test.ts`. No production change is planned (finding 3); if a case
fails, the fix goes where the failure points, test first, and the report says so.

Fixture: Grill (prints held work, prints MOVED slips, a printer) and Pastry (the same, another
printer); party at Mesa 5 with Bill 1 (Flan → Pastry) and Bill 2 (Tarta → Grill, Burger → Grill
fired), Flan and Tarta held in one group G (Postres) whose HOLD tickets printed at both stations.
Different dishes, one of each (finding 11).

- [ ] **Cases.**
  1. "A803 waiting copy: the MOVED slip lists only the moved dishes, the held ones under HOLD with
     the copy's group" — Bill 2 to Mesa 8 (free). Grill's new jobs since the mark are exactly one
     MOVED slip: header, `1.000 x BURG`, `HOLD`, `GROUP n · POSTRES` (n the copy's number),
     `1.000 x TARTA`; Pastry gets nothing; `kitchen_notices` `moved` rows for Burger and Tarta only.
  2. "… prints no HOLD ticket and no HOLD CHANGED slip at the move".
  3. "… the copy's later FIRE lists only the moved dish, marked FIRE, and the source's only the
     staying one": fire the copy at Mesa 8 → Grill gets `*** FIRE ***`, Mesa 8's header, `GROUP n ·
     POSTRES`, `1.000 x TARTA`; fire G at Mesa 5 → Pastry gets FIRE with `1.000 x FLAN` only.
  4. "… bytes already printed never change": every `print_jobs` row that existed before the move
     has the same `payload` after the move and after both fires.
  5. "… a held group whose HOLD ticket never printed adds nothing under HOLD" (printing held work
     off; the MOVED slip lists the Burger only; the copy's `holdPrintedAt` null; its FIRE unmarked).
  6. "… Split a table: the leaving bill's MOVED slip lists its held dish under HOLD" (the staying
     bill's own MOVED notice, finding 8 of the 4a plan, is not asserted here; 4c changes it).
- [ ] **Run.** The file; then the paper probe (measure free memory first).
- [ ] **Deletion controls.** In `copyHeldGroups`: `holdPrintedAt` set null → case 1 red (Tarta
  missing from the slip) and case 3 red (FIRE unmarked); the station copy removed → case 1 red
  (finding 3). Restore each.
- [ ] **Commit.** `git commit -s -m "A803 4b: kitchen paper for a held dish that changed table"`.

## Task 6: races (about 40 calls)

**Files.** `waiting-course-copy.test.ts`.

Pattern: `order-drafts.db.test.ts:5988-6006`. Both commands read their revisions and bodies first;
each awaits one barrier; `Promise.allSettled` of both; open the barrier.

- [ ] **Cases.**
  1. "A803 waiting copy: of two moves of one bill read from one revision, one commits and the other
     is refused with nothing of its own written" — to two free tables. Exactly one fulfilled; the
     rejected reason has a domain `code` (expected `party.out_of_date`; record what the run shows);
     exactly one copy and one pair of `lines_moved` events exist; no party was opened at the losing
     table; `kitchen_notices` and `print_jobs` gained only the winner's MOVED rows.
  2. "… a move and a fire of the same held group: one commits, the other is refused" — `moveBill`
     against `fireGroup(G)`. If the move won: the copy is held and G's moved dish is unfired. If the
     fire won: G is fired and the bill did not move. Either way the loser wrote no event, notice or
     job.
  3. "… a move and Split a table of the same bill: one commits".
- [ ] **Run.** The file unfiltered, three times in a row (a race test must not pass by luck; all
  three runs green and the winner recorded per run).
- [ ] **Deletion control.** Remove the party revision check from the move path for one run
  (`guardPathParty` skipped, a throwaway edit) → case 1 red (two copies or a second write). Restore.
- [ ] **Commit.** `git commit -s -m "A803 4b: racing moves and fires of one held group"`.

## Task 7: the counter's words and the till's comments (about 30 calls)

**Files.** `apps/till/src/i18n/codes.ts:338-341`, `apps/till/src/i18n/codes.test.ts:271-274`
(Changed check 3), `apps/till/src/api/client.ts:4699` (drop `group.held_leaves_party` from
`splitTable`'s list; `:4490` stays).

- [ ] **Failing test.** Changed check 3 with Question 1's words. **RED:**
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts -t 'refusal about a table'`
  → fails on the old words.
- [ ] **Implement.** The words. `rg -n 'another table until' apps/till/src` prints nothing after.
- [ ] **GREEN.** `src/i18n/codes.test.ts`; `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts`
  (browser; measure free memory first; `:2542` and `:4163` pass unchanged because they read
  `codeMessage(code)`); till typecheck; `pnpm exec vitest run scripts/english-only.test.ts`.
- [ ] **Commit.** `git commit -s -m "A803 4b: the counter refusal for held dishes says what is still possible"`.

## Task 8: guides, EN and ES (about 30 calls)

**Files.** `apps/server/src/guide/en/table-service.md`, `guide/es/table-service.md`,
`guide/en/kitchen-service.md`, `guide/es/kitchen-service.md`.

Write from the code built in Tasks 1–5, not from this plan.

- [ ] `table-service.md`: a new section after `#move-dishes`, "## Move a bill or split a table with
  dishes on hold {#held-dishes-move}" (ES «## Mover una cuenta o dividir una mesa con platos en
  espera {#held-dishes-move}»): a bill with dishes on hold can move to another table, and Split a
  table can take it; the other table gets its own group for them, still on hold, and each table
  fires its own; the till may ask the new table's allergy question before firing there; a bill with
  dishes on hold cannot move to the counter until their group is fired (the refusal's words). Use
  the till's words: «en espera», «marchar», «grupo».
- [ ] `kitchen-service.md#held-work`: one paragraph: when such a bill changes table, a station with
  the group's HOLD paper gets a MOVED slip listing the dishes that moved, the held ones under HOLD
  with their group at the new table; that table's FIRE lists only them; nothing already printed is
  reprinted.
- [ ] **GREEN.** G; `pnpm exec prettier --file-info apps/server/src/guide/en/table-service.md` is not
  ignored and `pnpm format:check` passes.
- [ ] **Commit.** `git commit -s -m "Guides: a bill with dishes on hold can change table; each table fires its own"`.

## Task 9: LOOK at the paper (about 30 calls; no commit unless a defect is fixed, test first)

- [ ] A throwaway test (not committed) built on Task 5's fixture, with each station given two
  printers, one `paperWidth: "58mm"` and one `"80mm"` (`createPrinter`, `packages/printing/src/printers.ts:55-77`;
  columns 30 and 42, `packages/printing/src/layout.ts:8`), and the kitchen language set to ES, then
  EN. It writes `printedLines` of the MOVED slip and both FIRE tickets to
  `~/waitron-campaign-c/a803-4b-look/` (outside the repository).
- [ ] Check: the HOLD section sits under the fired dishes and is headed `HOLD`; the group line
  `GROUP n · POSTRES` (and `GRUPO n · POSTRES`) wraps at 58 mm without splitting a word; From and To
  read "Mesa 5" and "Mesa 8"; the FIRE ticket's header names Mesa 8 and the copy's number matches
  the MOVED slip's; nothing names a dish that did not move.
- [ ] Say in the ledger and the PR that this is decoded text, not paper; physical printing stays
  unmeasured until done on a printer. Delete the throwaway test.

## Task 10: the whole slice (no commit; about 45 calls)

- [ ] Every guard suite above, each separately, each count read.
- [ ] Re-run every deletion control of Tasks 1a–6 against the final code; each named case goes red
  and comes back green. Record the table in the ledger.
- [ ] Every removed or changed `expect` line in `git diff 7d3900e7a4 -- '*.test.ts'` is a row of
  "Changed checks" or is in a new case; anything else is a stop.
- [ ] `rg -n 'held_leaves_party' apps packages` hits only the counter paths, the code's
  registrations and the tests the stay list names.

## Task 11: backlog, record pass and PR (about 35 calls)

- [ ] Finding 12's probe: a throwaway case (a group with HOLD paper fired at a station that waits for
  the pass, its bill moved to another table); if no MOVED line names the Requested dish, add one
  backlog point under the kitchen area with the receipt; if one does, record that and add nothing.
- [ ] `docs/backlog.md` A803 entry (`:2020-2024`) and its Detail (`docs/backlog/till.md:2949-2966`):
  4b has landed (#PR); remaining: 4c (Split a table through the same picker, with A590) and
  pre-bills after asesor S2. Name what 4b leaves open (Question 2 if unanswered; finding 12's point
  if added). Delete nothing else.
- [ ] Dated pointers (one line each, never a rewrite): `docs/backlog/kitchen.md:390` (A660's record:
  since A803 4b a bill holding a held course can move to another table, not to the counter);
  `docs/superpowers/specs/2026-09-28-table-actions-design.md:242` and `:387`; the A803 spec §3.7's
  "Today a bill holding held dishes cannot leave its party" (`:128-130`).
- [ ] **Record pass.** Append "## Build record (4b)" to this plan: what was built versus planned,
  each departure with its reason, line numbers that moved, and the deletion-control table from
  Task 10. The text above it is left as written.
- [ ] PR body in plain English: what the waiter and the kitchen see; no venue reset, no schema
  change; "Changed test checks" (the three rows, with the stay list); "For the owner" (Question 1
  blocks landing; Question 2's default); the paper LOOK's limits. Then `/finish-branch` with this
  plan named.
- [ ] Ledger `Status: in progress` until landed; then 4c's plan is next.

## Task list and sizes

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight, questions posted, ledger | 15 | no commit |
| 1a | `copyHeldGroups` | 55 | green |
| 1b | drafts follow the copy | 40 | green |
| 2 | the two paths carry held dishes; Changed checks 1–2 | 60 | green |
| 3 | what the copy does afterwards | 55 | green |
| 4 | rollback and routes | 45 | green |
| 5 | kitchen paper | 55 | green |
| 6 | races | 40 | green |
| 7 | counter words, till comments; Changed check 3 | 30 | green |
| 8 | guides EN/ES | 30 | green |
| 9 | LOOK at the paper | 30 | no commit |
| 10 | whole slice, deletion controls | 45 | no commit |
| 11 | backlog, record pass, PR | 35 | green |

About 535 calls in 12 tasks, none planned above 60.

## Receipts (planning run)

R1–R3 ran in a throwaway detached worktree at `7d3900e7a4` (`git worktree add --detach
/tmp/a803-4b-probe 7d3900e7a4`, `pnpm install --frozen-lockfile`, removed afterwards with
`git worktree remove --force`), with `refuseHeldLeavingParty` returning early when `PROBE_LIFT=1` and
probe cases appended to `party-move-bill.test.ts`, run as
`env -u AI_AGENT -u CLAUDECODE PROBE_LIFT=<0|1> TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/party-move-bill.test.ts -t 'PROBE 4b'`
in `apps/server`. Before running, the failing case was stated: if lifting the refusal were enough,
the flan would arrive unfired in a held group and the source would have no held group left.

- **R0 (control).** `PROBE_LIFT=0`: both probe cases refused `group.held_leaves_party` (2 failed,
  68 skipped) — the probes reach the refusal.
- **R1.** `PROBE_LIFT=1`, Burger fired + Flan held by hand (no course), moved to a seated table:
  destination `[{ state: "fired", lines: 2 }]`, the Flan's kitchen item `fired: 1`; source
  `[{ fired, lines: 0 }, { held, lines: 0 }]`.
- **R2.** `PROBE_LIFT=1`, Burger fired + two held groups of one Flan each, both set to a course held
  until fired, moved to a free table: destination `[{ fired, lines: 1 }, { held, lines: 2 }]`;
  source `[{ fired, 0 }, { held, 0 }, { held, 0 }]`.
- **R3.** `PROBE_LIFT=1`, R1's shape moved to a free table: refused `allergy.unanswered` (the flan
  was being fired on arrival at a party with no allergy answer).
- **R4.** Baselines at `7d3900e7a4`, each file alone: `party-table-actions` 89, `party-move-bill`
  68, `order-drafts.db` 299, `collect-at-counter` 17, `kitchen-request.bill-move` 7, `order-groups`
  254, `party-arriving-dishes` 29 (all passed; together 763 in 7 files).
- **R5.** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`: 2 files, 20 tests passed.
- **R6.** The move sweep: 46 files, 2,862 tests passed.
- Searches named where used: `rg -n 'held_leaves_party' apps packages` (findings 6 and the stay
  list), `rg -n -i 'barrier|withResolvers' apps/server/src/bill-editing.table-actions.test.ts`
  (nothing), the guide searches (finding 7), `git diff --stat main...<branch>` for the overlap
  (finding 10).

Read, not run: findings 2–5, 9, 11 and 12, and every line number in the code map.
