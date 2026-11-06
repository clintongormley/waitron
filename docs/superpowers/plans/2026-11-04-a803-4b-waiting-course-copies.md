# A803 slice 4b: waiting dishes leave with their own copy of the course — task plan

> **2026-11-06, A1378:** MOVED now follows the station's combined/separate choice. Identical
> whole portions combine within their group; measured and printed-as-sold items stay separate.
> References below to A1192 being open describe the earlier implementation.


> **2026-11-06, A1378:** kitchen paper now prints whole quantities without `.000` and
> takes its hours from the venue's saved time zone. Paper examples and measured output below
> record the earlier implementation.

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
New test code, including helpers copied from an existing file, names no location (I4).

## Revision 1 (2026-11-04): answers to plan review 1

The review is `~/waitron-campaign-c/a803-4b-plan-review/review-1.md` (0 Critical, 6 Important, 8
Minor). Each finding was checked against the code at `7d3900e7a4` before it was applied; what was
read or run is named per row. Nothing was run for this revision beyond the reads and searches named.

| Finding | Answer | Evidence checked for this revision |
| --- | --- | --- |
| I1 recalled rows' `join_group_id` | **Applied** (D8 four columns, finding 5, Task 1b, Changed check 2) | Read: `order_draft_recalled_lines` has `join_group_id` and `after_group_id` (`packages/db/src/schema/order-draft-recalled-lines.ts:16-17`); `recallToDraft` passes a held group as the join (`apps/server/src/draft-recall.ts:387-395`); `appendRecalledLine` stores `{ joinGroupId, slot: 0, afterGroupId: null }` (`order-drafts.ts:396-403`); `saveDraft` validates every line's references, recalled ones included, against the bill's party (`order-drafts.ts:538`, `:1313-1339`) |
| I2 `holdPrintedAt` control aimed at cases that never read it | **Applied** (new Task 5 case 7 carries the control; Task 5 cases 1 and 3 keep the station control) | Read: the first move's "before" is read from the source group before the copy exists (`move-bill.ts:197-198`); after it, `onHeldPaper` reads only stations (`kitchen-print.ts:1518-1543`); `releaseGroup` marks FIRE from stations only (`order-groups.ts:871-873`); a **later** move's "before" needs `holdPrintedAt` (`readOnHoldTickets`, `kitchen-print.ts:1566`). The reviewer's E2 ran it |
| I3 nested `withTransaction` control | **Applied** (Task 4's control replaced) | Read: the write queue throws "write lock: a body asked for the lock it is already holding" on re-entry (`packages/store/src/write-queue.ts:41-43`); both paths call `printHoldTickets` unconditionally after the copy (`move-bill.ts:282`, `table-actions.ts:355`), through an import a namespace spy replaces (`move-bill.ts:27`, as `order-drafts.db.test.ts:4810-4816` spies `groupArrivingDishes`) |
| I4 location-keyed helpers | **Applied** ("Test file", Task 1a, Task 10a) | Read: `party-arriving-dishes.test.ts:85`, `:869`; `move-merge.test.ts:366`, `:572`, `:1566`. Siblings already pick the default station by `isDefault` alone (`dead-ends.test.ts:37`, `kitchen-timing-consumers.test.ts:50`); the counter zone the cases need is `v.counter.zoneId` (`party-move-bill.test.ts:744`); `createStation(tx, v.cfg, …)` takes the context, so the new file names no location |
| I5 Spanish guide text not in Question 1 | **Applied** (Question 1 lists all eight new texts; Task 8 writes them; Task 11) | Read: 4a's Question 1 named its guide heading (`2026-11-01-a803-4-portion-picker.md:586-587`). The ES guide calls Split a table «Separar una mesa» (`guide/es/table-service.md:267`), so the planned heading's «dividir una mesa» is replaced |
| I6 Question 2's example | **Applied** (Question 2 rewritten) | Read: `nextGroupNumber` counts groups the party holds or numbered (`order-groups.ts:2463-2475`); `moveGroupsToParty` keeps numbers (`:729-746`); `readGroupNumberLabels` labels only duplicate numbers, by the table that numbered them (`:2477-2517`), and the label prints in the group line (`kitchen-ticket.ts:294`) |
| M1 Task 10 (and Task 2) too large | **Applied** | Task 2 → 2a (Move this bill) and 2b (Split a table); Task 10 → 10a (guards and audits), 10b (controls of Tasks 1a–2b), 10c (controls of Tasks 3–6) |
| M2 kitchen views of the copy not asserted | **Applied** (Task 3 case 8, through `readCurrentOrders` and `readHeldCounts`) | Read: both exported (`order-groups.ts:1723`, `:1863`); `readCurrentOrders` shows a row under the party whose sequence holds its group (doc comment `:1855-1862`). The pass board's own read was not traced, so it is not named |
| M3 a staying draft naming a removed source group | **Applied, as a pin of today's rule** (D8, Task 1b case 4), **with the refusal code corrected** | The review said `group.not_found`. Read: `removeEmptiedHeldGroups` changes only `state` and `remindAt` (`order-groups.ts:1457`), so the removed group keeps its `party_id`, and `validateDraftPlaces` then throws `group.not_held`, not `group.not_found` (`order-drafts.ts:1336-1339`). Expected `group.not_held`; the case records what the run shows |
| M4 Task 6 framed as the master plan's race replay | **Applied** (outline row, Departures row, Task 6) | Read: `2026-11-01-a803-4-portion-picker.md:1361` assigns `A803 race replay` to 4a Task 3 and 4c |
| M5 D9's reader check already answered | **Applied** (D9, Task 1a) | Read: the one reader outside `order-groups.ts` is `service-step-signals.ts:119-124`, kinds `submitted`/`joined`, no `detail`; `recordGroupEvent` writes one attendance capture per event with an actor (`order-groups.ts:2542-2569`) |
| M6 Changed check 1 less strict than before | **Applied** (Changed check 1) | The old case pinned "nothing changed"; the new one adds the source group's `removed` event and the Flan's `ticket_items` row `toEqual` before and after |
| M7 `working-order.ts:6250` | **Applied** (D4) | Read: `startGroup(…, as.kitchen === "fire" ? fireKind! : "next_course")` at `working-order.ts:6250-6256` |
| M8 the till's `:2542` row title | **Rejected** | The title is generated from the row's data (`till-app-parties.test.ts:2542`, `"shows %s in its own words after %s"` at `:2545`), so renaming it means changing what the row emits, an edit to a passing check the slice does not force (owner rule, "Changed checks"). The row pins the till's wording of a code it still words; `:4163` pins the counter path the code is now sent on. Left as is, and named in the stay list |

## Owner questions

Building goes ahead on each default. A question about new Spanish blocks landing only.

**Question 1 of 2 (new words, English and Spanish; blocks landing).** 4b adds four texts, each in
English and Spanish: the counter refusal, and three in the guides. All four are listed here as
proposals. Task 8 writes the guide passages from the code built in Tasks 1–5; where that code makes
a proposal below untrue, Task 8 changes it and the question posted to the owner is updated before
landing, so the owner always approves the text that ships. The PR shows all four.

Worked example: Table 5's Bill 2 has a fired burger and a tarta held for desserts. The waiter
chooses **Move this bill → Table 8**: it goes, and Table 8 holds the tarta in its own group. At Table
5 the waiter chooses **Move this bill → Counter** for Bill 3, which also has a held dish: refused.

1. **The counter refusal** (`group.held_leaves_party`, `apps/till/src/i18n/codes.ts:338-341`). After
   4b it is sent only when a bill with held dishes is moved to the counter. Its words today, "Items
   still on hold cannot move to another table until their group is fired" / «Los artículos en
   espera no se pueden pasar a otra mesa hasta que se marche su grupo», would then be false.
   Proposed:
   - EN: "Items still on hold cannot move to the counter until their group is fired. They can move
     to another table."
   - ES: «Los artículos en espera no se pueden pasar al mostrador hasta que se marche su grupo. Sí
     se pueden pasar a otra mesa.»

   «mostrador» is the till's word for the counter (`apps/till/src/i18n/strings.ts:2242`, `:3382`).
2. **The new guide heading** in `guide/*/table-service.md`:
   - EN: "Move a bill or split a table with dishes on hold" `{#held-dishes-move}`
   - ES: «Mover una cuenta o separar una mesa con platos en espera» `{#held-dishes-move}`
     («Separar una mesa» is the ES guide's name for Split a table, `guide/es/table-service.md:267`).
3. **The new section's text** under that heading:
   - EN: "A bill with dishes on hold can go to another table with **Move this bill**, and **Split a
     table** can take it with the table that leaves. At the other table the dishes stay on hold, in
     a group of their own with that table's next number. Each table fires its own group: firing one
     sends none of the other table's dishes. If nobody has answered the allergy question at the
     other table yet, firing there says **Record an allergy answer before sending dishes.**: answer
     it under **Allergies** in the **⋮** menu, then fire again.

     A bill with dishes on hold cannot move to the counter. The till says **Items still on hold
     cannot move to the counter until their group is fired. They can move to another table.** Fire
     their group first, or move the bill to a table."
   - ES: «Una cuenta con platos en espera puede pasar a otra mesa con **Mover esta cuenta**, y
     **Separar una mesa** puede llevársela con la mesa que se separa. En la otra mesa los platos
     siguen en espera, en un grupo propio con el siguiente número de esa mesa. Cada mesa marcha su
     propio grupo: marchar uno no envía ningún plato de la otra mesa. Si en la otra mesa todavía
     nadie ha indicado si hay alergias, al marchar allí la caja dice **Indica si hay alergias antes
     de enviar los platos.**: indícalo en **Alergias**, en el menú **⋮**, y vuelve a marchar.

     Una cuenta con platos en espera no puede pasar al mostrador. La caja dice **Los artículos en
     espera no se pueden pasar al mostrador hasta que se marche su grupo. Sí se pueden pasar a otra
     mesa.** Marcha antes su grupo, o pasa la cuenta a una mesa.»

   The quoted allergy refusal is the till's existing text (`apps/till/src/i18n/strings.ts:56`,
   `:1948`). "with that table's next number" holds only under Question 2's default (A); under (B)
   the sentence becomes "keeping its number".
4. **The new paragraph** at the end of `guide/*/kitchen-service.md#held-work`:
   - EN: "When a bill with dishes on hold moves to another table, each station with a moved dish on
     its paper whose **Print a slip when sent dishes move table** setting is **Print** gets a
     **MOVED** slip listing the dishes that moved, the held ones under HOLD with their group's
     number at the new table. A held dish whose group's HOLD paper never reached that station is
     not listed there. The new table's ticket marked FIRE lists only those dishes, and the old
     table's lists only the dishes that stayed. Nothing already printed is printed again."
   - ES: «Cuando una cuenta con platos en espera pasa a otra mesa, cada estación que tiene en papel
     un plato movido y tiene **Imprimir un aviso al cambiar de mesa los platos enviados** en
     **Imprimir** recibe un ticket **MOVIDO** con los platos que se han movido; los que están en
     espera aparecen aparte, con el número de su grupo en la mesa nueva. Un plato en espera cuyo
     grupo no tiene lo impreso en espera en esa estación no aparece en ella. La comanda marcada
     FIRE de la mesa nueva lleva solo esos platos, y la de la mesa anterior solo los que se
     quedaron. No se vuelve a imprimir nada de lo ya impreso.»

   The setting's names are the guides' own (`guide/en/kitchen-service.md:109`,
   `guide/es/kitchen-service.md:126-127`), and the station setting gates the slip
   (`readMovedSlipPrinting`, `kitchen-print.ts:1774`). «lo impreso en espera» and «la comanda
   marcada FIRE» follow the paragraph above it (`guide/es/kitchen-service.md:68-76`).

Default: as proposed.

**Question 2 of 2 (no new words; does not block landing).** Which group number the copy prints.
Slips below are simplified to their group and dish lines.

Worked example. Table 5 has GROUP 1 (starters, fired), GROUP 2 (mains, fired) and GROUP 3 · POSTRES,
held: a flan on Bill 1 and a tarta on Bill 2. The Grill printed the tarta's HOLD ticket. Bill 2 (a fired burger and the tarta) moves to Table 8, which
had nothing; the burger arrives in Table 8's GROUP 1.

- **(A, recommended and built)** The copy takes Table 8's next number, GROUP 2, as any new group
  there would. The Grill's three slips for the tarta read:
  1. HOLD ticket (earlier): Mesa 5 · HOLD · GROUP 3 · POSTRES · 1 x TARTA
  2. MOVED slip: From Mesa 5 · To Mesa 8 · 1 x BURG · HOLD · GROUP 2 · POSTRES · 1 x TARTA
  3. FIRE ticket (later): Mesa 8 · FIRE · GROUP 2 · POSTRES · 1 x TARTA

  The cost: the cook holding slip 1 sees the tarta's group change from 3 to 2, tied together only by
  the MOVED slip's From and To lines and the dish's name.
- (B) The copy keeps GROUP 3, still counted as numbered by Table 5 (the way a join keeps a group's
  number, `moveGroupsToParty`, `order-groups.ts:729-746`). The slips read "GROUP 3" all three times,
  with no table beside it while Table 8 holds no other GROUP 3 (`readGroupNumberLabels`,
  `order-groups.ts:2477-2517`, adds a table only to duplicate numbers). The cost: if Bill 2 later
  moves back to Table 5, or Tables 5 and 8 are joined, while the flan is still held, Table 5 holds
    two different groups numbered 3 by Table 5's party, and the paper heads both with the same
  tables, "GROUP 3 · Mesa 5 · POSTRES" after a move back. The two FIRE tickets cannot then be told
  apart by their heading.

Under (A) a join can still give a party two groups with one number, since a join keeps numbers, but
they were numbered by different parties, so the paper heads each with the tables of the party that
numbered it, as for any join today. Default (A): a number that changes at the move, explained only
by the MOVED slip, rather than two groups the paper cannot tell apart. Changing to (B) later changes the copy's `displayNumber` and
`numberPartyId` in `copyHeldGroups` and the paper cases.

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
   By reading; Task 2a's first deletion control (held dishes cleared like fired ones) and Task 5's
   (no HOLD paper facts on the copy) establish it.

4. **The copy must come after the arriving dishes are grouped.** `groupArrivingDishes` groups only
   lines with no group (`order-groups.ts:2599`) and appends its fired group at the party's last
   position. If the copies were made first, the arriving fired group would sit after a held copy,
   and the release reminder, which waits for the dishes of every group before the waiting one
   (`:1604-1608`), would not wait for them. Held dishes left in their source group are skipped by
   `groupArrivingDishes`, so making the copies right after it is safe. The outline said "before
   `groupArrivingDishes`"; that is replaced (D3).

5. **Drafts name groups.** A draft line can name a group to join (`order_draft_lines.join_group_id`)
   or to follow (`after_group_id`) (`packages/db/src/schema/order-drafts.ts:76-77`), and so can a
   recalled dish's draft row (`order_draft_recalled_lines.join_group_id`, `after_group_id`,
   `packages/db/src/schema/order-draft-recalled-lines.ts:16-17`). A dish recalled from a **held**
   group gets a row that joins that group (`recallToDraft`, `draft-recall.ts:387-395`, stored by
   `appendRecalledLine` as `{ joinGroupId, slot: 0, afterGroupId: null }`, `order-drafts.ts:396-403`);
   that is the usual recalled row for a held dish (revision 1, I1). Today a bill moved with such a draft keeps the stale reference and the next save is
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
| (master plan) race replay "as `bill-editing.table-actions.test.ts` does" with promise barriers | that file has none; the pattern is `order-drafts.db.test.ts:5988-6006`. `A803 race replay` itself belongs to 4a Task 3 and 4c (`2026-11-01-a803-4-portion-picker.md:1361`); 4b's Task 6 is its own race check for the copy, not that item | finding 8; revision 1, M4 |
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
  (every held group is created so: `order-groups.ts:379`, `:1124`, `:1404`, `:2695`,
  `working-order.ts:6250`; `releaseGroup`
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
  have four columns rewritten from each copied source group to its copy: `join_group_id` and
  `after_group_id` on `order_draft_lines`, and `join_group_id` and `after_group_id` on
  `order_draft_recalled_lines`. A reference to a group that got no copy is left as it is (finding
  5's pinned case). A **staying** bill's draft is never rewritten: a copy belongs to another party,
  and `saveDraft` checks every reference against the draft's own party (`validateDraftPlaces`,
  `order-drafts.ts:1313-1339`). So when the copy empties and removes the source group, a staying
  draft line still naming it is refused at its next save, as for any emptied held group today: by
  reading, `group.not_held`, because a removed group keeps its `party_id`
  (`removeEmptiedHeldGroups` sets only `state` and `remindAt`, `order-groups.ts:1457`) and
  `validateDraftPlaces` refuses a group of the party that is not held (`order-drafts.ts:1339`).
  Task 1b case 4 pins it and records what the run shows.
- **D9 Events.** One `lines_moved` event on the source (`detail: { lineIds, to: copyId }`) and one on
  the copy (`detail: { lineIds, from: sourceId, arrived: true }`), actor the operator, with attendance
  when given (as `groupArrived`, `:2701-2711`). At planning (revision 1) the only reader outside
  `order-groups.ts` is `service-step-signals.ts:119-124`, which reads kinds `submitted` and `joined`
  and never `detail`. `recordGroupEvent` writes one attendance capture per event that has an actor
  and is given attendance (`order-groups.ts:2542-2569`), so a copy that empties its source writes
  three (two `lines_moved`, one `removed`). Task 1a
  re-runs `rg -n 'orderGroupEvents' apps/server/src -g '!*.test.ts'` and stops if a new reader reads
  `lines_moved` details in a way these shapes would break.
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
| (none: `A803 race replay` is 4a's and 4c's) | Task 6 adds 4b's own races in `waiting-course-copy.test.ts`, barrier pattern of `order-drafts.db.test.ts:5988-6006` | 4b adds a concurrency risk of its own (two tills on one held group); finding 8; revision 1, M4 |
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
| `leaveParty` callers: `moveBillOnce` `:197`, `moveSettledBillToCounter` `:311`, `splitTable` `table-actions.ts:317` | gains a mode; counter callers keep "refuse" | 2a, 2b |
| `refuseHeldLeavingParty` (only `leaveParty`, `rg -n refuseHeldLeavingParty apps/server/src`) | unchanged code; its doc comment narrowed to the counter | 2b, 8 |
| `groupArrivingDishes` (`move-bill.ts:250`, `:266`; `table-actions.ts:341`) | unchanged; held dishes still grouped are skipped | 2a, 2b |
| `readOnHoldTickets`, `onHeldPaper`, `buildTicketItems`, `releaseGroup`'s `heldPaper`, `holdPaperFor`, `readReprintParts` (`kitchen-print.ts:1973`) | read the copy's `holdPrintedAt` and stations; no code change planned | 5 |
| `releaseReminder`, `readHeldCounts` (`:1723`), `readCurrentOrders` (`:1863`), the pass board's Held column, the station queue's `QueueGroup` (`working-order.ts:7821-7831`) | read the copy as a held group of the destination party; no code change planned | 3 (reminder case; Current orders and held counts, case 8) |
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
| 1 | `apps/server/src/party-table-actions.test.ts:1432-1446` "refuses a bill holding a dish held for the kitchen (Review Focus 4)" | Split a table refused `group.held_leaves_party` `{ tabId: b2, lineNo: 2 }`, parties/bills/tables unchanged | renamed "A803 waiting copy: Split a table takes a bill holding a dish held for the kitchen, and the new party holds its own copy of the group": the bill is the new party's; the flan's line is in a `held` group of the new party with `firedAt` null; the source's group is `removed`, with one `removed` event naming the operator; the flan's `ticket_items` row is `toEqual` before and after (unfired, nothing rewritten) | §3.7 "A dish waiting for its course can go" | 2b |
| 2 | `apps/server/src/order-drafts.db.test.ts:4735-4787` `it.each(["free table", "occupied table", "split table"])` "a recalled companion does not let active held work leave for a %s, and refusal changes nothing" | all three refused `group.held_leaves_party` `{ lineNo: 3 }`, writing nothing | renamed "a recalled companion travels as a draft row while active held work leaves for a %s with its own copy of the group": the active line (and its extras) in a new `held` group of the destination party; the recalled source line has no group and its draft row is unchanged except that whichever of `join_group_id`/`after_group_id` named the source now names the copy; the fresh draft lines' `join_group_id`/`after_group_id` → the copy; the source group `removed`; and a `saveDraft` of that draft as read after the move is accepted (today's case pins only the refusal of a stale id) | §3.7 (split), §6 (whole bill); D8 | 2a rewrites the "free table" and "occupied table" rows and leaves "split table" as its own unchanged case, still refused; 2b moves that row into the rewritten `it.each`; 1b supplies the rebinding |
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
- **The paper probe** (Task 5, Task 10a): A773-2 D's wide paper probe,
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
a mark, `setStationPrinting`). **Copied without any location** (A1301; revision 1, I4): those files
filter stations and insert a zone by `v.cfg.locationId` (`party-arriving-dishes.test.ts:85`, `:869`;
`move-merge.test.ts:366`, `:572`, `:1566`). The new file picks the default station by
`eq(kitchenStations.isDefault, true)` alone, as `dead-ends.test.ts:37` and
`kitchen-timing-consumers.test.ts:50` do; finds a station by name with `eq(kitchenStations.name,
name)` and `active` alone; makes stations through `createStation(tx, v.cfg, …)`; uses
`v.counter.zoneId` for the counter (`party-move-bill.test.ts:744`); and makes no zone of its own
(`party-arriving-dishes.test.ts`'s "Barra factura" zone is not needed by any 4b case). Every task
that edits this file ends with `rg -n 'locationId|location_id' apps/server/src/waiting-course-copy.test.ts`
printing nothing (exit 1). One helper, `rowsOf(partyIds, billIds)`, returns full rows, ordered,
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
  checks" or the stay list, with a reason, before Task 2a.
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
they do not depend on Tasks 2a and 2b.

- [ ] D9's reader check: `rg -n 'orderGroupEvents' apps/server/src -g '!*.test.ts'`; at planning the
  only reader outside `order-groups.ts` was `service-step-signals.ts:119-124` (kinds only, no
  `detail`). Record any new reader of `detail` in the ledger; stop if one would misread D9's shapes.
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
  (baselines 254 and 29, R4); `pnpm --filter @waitron/server typecheck`;
  `rg -n 'locationId|location_id' apps/server/src/waiting-course-copy.test.ts` prints nothing (I4).
- [ ] **Deletion controls** (each removed alone, the named case must go red, then restored):
  the hold-station intersection (copy all of G's stations) → case 4; `removeEmptiedHeldGroups` →
  case 3; the source-order `orderBy` reversed → case 2; `remindAt: null` replaced by G's → case 7;
  the recalled filter → case 6.
- [ ] **Commit.** `git commit -s -m "A803 4b: copy a party's held groups for dishes leaving it"`.

## Task 1b: drafts follow the copy (about 45 calls)

**Files.** `apps/server/src/order-groups.ts` (`copyHeldGroups`), `waiting-course-copy.test.ts`.

- [ ] **Failing tests.**
  1. "A803 waiting copy: copyHeldGroups points the moving bill's draft at the copy": G holds Bill
     2's Tarta and Flan2 (both held). Recall Flan2 with the real `recallToDraft`
     (`draft-recall.ts:290`), so its recalled row carries the join the product writes,
     `join_group_id = G`, slot 0 (`draft-recall.ts:387-395`, `order-drafts.ts:396-403`); assert that
     before copying. Add to the same open draft one fresh line `join_group_id = G` (slot 0) and one
     `after_group_id = G` (slot 2), and, by hand, a second recalled row with `after_group_id = G`,
     slot 2, for another of Bill 2's dishes, since `source_line_id` is unique. That is the shape
     `recalledPlace` writes when a recalled dish takes the slot of a draft line that follows a
     group (`order-drafts.ts:431-443`), kept so the `after_group_id` update is tested too. Copy Bill
     2's Tarta. All four references read the copy; every other column of those rows is unchanged
     (`toEqual` on the whole rows with the one field replaced).
  2. "… leaves a staying bill's draft on the source group": Bill 1's draft line naming G is
     unchanged.
  3. "… leaves a reference to a group that got no copy as it was": Bill 2's draft names G3, which
     has no leaving dish; unchanged.
  4. "… a staying bill's draft naming a source group the copy removed is refused at its next save,
     as for any emptied held group" (D8; revision 1, M3): G holds only Bill 2's Tarta; Bill 1's open
     draft has a fresh line `join_group_id = G`. Copy the Tarta (G is `removed`), then `saveDraft`
     Bill 1's draft unchanged. Expected refusal `group.not_held` `{ groupId: G }` by reading
     (`order-drafts.ts:1339`; D8); write the code the run shows, and if it is not a domain refusal
     naming G, stop and ask in the ledger.
- [ ] **RED.** `… -t 'draft'` in the file: case 1 fails on the first reference still reading G;
  cases 2, 3 and 4 pass already (they are pins; say so in the report).
- [ ] **Implement.** After the copies: for the open drafts (`order_drafts.state = "open"`) whose
  `bill_id` is a bill holding a moved line, four updates per copied source group (`join_group_id`
  and `after_group_id` on `order_draft_lines`; `join_group_id` and `after_group_id` on
  `order_draft_recalled_lines`).
- [ ] **GREEN.** The file unfiltered; `src/order-drafts.db.test.ts` (299 as at R4: no path calls
  the copy yet, so its `:4735-4787` refusal case still passes unchanged); the location grep (I4)
  prints nothing.
- [ ] **Deletion controls.** Drop the `bill_id` filter → case 2 red; drop the recalled-row
  `join_group_id` update → case 1 red (the `recallToDraft` row still names G); drop the
  recalled-row `after_group_id` update → case 1 red (the hand-made row still names G).
- [ ] **Commit.** `git commit -s -m "A803 4b: a moving bill's draft follows its held group's copy"`.

## Task 2a: Move this bill carries held dishes (about 50 calls)

**Files.** `apps/server/src/move-bill.ts`, `waiting-course-copy.test.ts`, `order-drafts.db.test.ts`
(Changed check 2, its "free table" and "occupied table" rows).

- [ ] **Failing tests** (new file):
  1. "A803 waiting copy: Move this bill to a free table takes a held dish, held, in its own copy of
     the group" (Burger fired, Flan held by `placeGroups`; free table; asserts the result party, the
     Flan's group is a `held` group of the new party with `firedAt` null, its kitchen item has
     `firedAt` and `requestedAt` null, the source's group `removed`).
  2. "… to a seated table" (same, onto a party with its own fired and held groups; the copy after
     all of them, and after the arrival's fired group holding the Burger).
  4. "… Move this bill to the counter still refuses a held dish, writing nothing" (`rowsOf` equal;
     `group.held_leaves_party` `{ tabId, lineNo }`; the counter is `v.counter.zoneId`).
  And Changed check 2's "free table" and "occupied table" rows rewritten as the table says. Its
  "split table" row moves, unchanged, into a case of its own beside them (same title with "split
  table", same body), because Split a table still refuses until Task 2b.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts -t 'Move this bill'`
  → cases 1 and 2 refused `group.held_leaves_party`, case 4 passes (a pin).
  `pnpm --filter @waitron/server exec vitest run src/order-drafts.db.test.ts -t 'recalled companion'`
  → the two rewritten rows fail on the same refusal; the split-table case passes.
- [ ] **Implement.** `leaveParty(tx, billId, held: "refuse" | "keep")` returning
  `{ firers, heldLineIds }`: "keep" skips `refuseHeldLeavingParty` and clears only lines that are
  not held-and-unrecalled; "refuse" is today's body. `moveBillOnce` passes "refuse" for the counter
  and "keep" otherwise, and calls `copyHeldGroups(tx, path.partyId, partyId, heldLineIds,
  options.operatorId, activity)` right after each `groupArrivingDishes` (free `:250`, seated
  `:266`); `moveSettledBillToCounter` and `splitTable` pass "refuse" (Split changes in 2b). Update
  the doc comment of `leaveParty` (`:493-497`).
- [ ] **GREEN.** The new file unfiltered; `src/party-move-bill.test.ts` (68),
  `src/order-drafts.db.test.ts` (299 + the split-out case), `src/collect-at-counter.test.ts` (17),
  `src/kitchen-request.bill-move.test.ts` (7), `src/party-arriving-dishes.test.ts` (29),
  `src/party-table-actions.test.ts` (89, unchanged: Split still refuses) — each count equal to the
  baseline (R4) plus the cases added; types; the location grep (I4) prints nothing.
- [ ] **Deletion controls.** "keep" clearing held lines like "refuse" does → cases 1 and 2 red (no
  copy is made and the dish takes the arrival path, R1); the copy call removed from the free-table
  branch → case 1 red, from the seated branch → case 2 red; the copy call moved to before
  `groupArrivingDishes` in the seated branch → case 2 red (the arrival's fired group after the copy,
  finding 4); the counter given "keep" → case 4 red.
- [ ] **Commit.** `git commit -s -m "A803 4b: a bill with held dishes moves to another table with its own copy of each held group"`.

## Task 2b: Split a table carries held dishes (about 45 calls)

**Files.** `apps/server/src/table-actions.ts`, `apps/server/src/working-order.ts` (a doc comment),
`waiting-course-copy.test.ts`, `party-table-actions.test.ts` (Changed check 1),
`order-drafts.db.test.ts` (Changed check 2's "split table" row).

- [ ] **Failing tests.**
  3. "A803 waiting copy: Split a table takes a bill holding a held dish" (the new party; the copy is
     after the arrival's fired group).
  And Changed check 1 rewritten as the table says (with the `removed` event and the Flan's
  `ticket_items` row `toEqual` before and after, M6), and the "split table" case from 2a moved back
  into Changed check 2's rewritten `it.each`, so that it has its three planned rows.
- [ ] **RED.** `… -t 'Split a table'` in the new file → refused `group.held_leaves_party`;
  `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/order-drafts.db.test.ts -t 'held|recalled companion'`
  → Changed check 1 and the "split table" row fail on the same refusal.
- [ ] **Implement.** `splitTable` passes "keep" and copies right after `groupArrivingDishes`
  (`:341`), inside `withMovedSlips`. Update the doc comments of `splitTable` (`:278-283`, "holding
  no dish held for the kitchen") and `refuseHeldLeavingParty` (`working-order.ts:5005-5008`) to say
  the counter.
- [ ] **GREEN.** The new file unfiltered; `src/party-table-actions.test.ts` (89),
  `src/order-drafts.db.test.ts` (299), and the 2a list again; then the move sweep; types; the
  location grep prints nothing.
- [ ] **Deletion controls.** The copy call removed from `splitTable` → case 3 and Changed check 1
  red; the copy call moved to before `groupArrivingDishes` there → case 3 red (finding 4);
  `splitTable` given "refuse" again → case 3, Changed check 1 and the "split table" row red.
- [ ] **Commit.** `git commit -s -m "A803 4b: Split a table takes a bill with held dishes, with its own copy of each held group"`.

## Task 3: what the copy does afterwards (about 60 calls)

**Files.** `waiting-course-copy.test.ts` only, unless a case finds a defect (then test first, fix in
the file the failure names, and say so in the report).

- [ ] **Cases** (each RED before Tasks 2a and 2b by construction; here they are expected to pass on first
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
  8. "… each table's Current orders and held count show its own part of the group" (revision 1,
     M2): a group shared by Bill 1 (Flan, staying) and Bill 2 (Tarta, moving to a free table).
     `readCurrentOrders` (`order-groups.ts:1863`) of the destination lists the copy, `held`, with
     the Tarta's row only; of the source, G with the Flan's row only. `readHeldCounts`
     (`order-groups.ts:1723`) gives 1 for each party.
- [ ] **Run.** `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts`; the
  location grep (I4) prints nothing.
- [ ] **Deletion controls.** In `copyHeldGroups`: copy rows inserted with `state: "fired"` and a
  `firedAt` → cases 1, 3 red; one copy per destination instead of per source group → case 2 red;
  `removeEmptiedHeldGroups` removed → cases 6, 7 red; the lines' `group_id` update dropped (the
  moved dish left in G) → case 8 red. Restore each.
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
- [ ] **RED/GREEN.** Cases 1, 3, 4 would have been red before Tasks 2a and 2b (refused); 2 is a pin of the
  transaction. `pnpm --filter @waitron/server exec vitest run src/waiting-course-copy.test.ts src/till-api.move-bill.test.ts src/till-api.table-actions.test.ts`.
- [ ] **Case 2 is a pin of the single transaction**, not a test that could be broken by a second
  one: a nested `withTransaction` from inside the move is refused by the write queue ("write lock: a
  body asked for the lock it is already holding", `packages/store/src/write-queue.ts:41-43`), and
  `copyHeldGroups` takes only `tx` (CLAUDE.md §3: write paths take `tx`, never open their own), so
  the copy cannot commit apart from the move by construction (revision 1, I3).
- [ ] **Deletion control** for case 2: the spy's throwing implementation removed (it calls the real
  `printHoldTickets` and returns) → case 2 red for both paths (the move commits, `rowsOf` differs).
  This shows the marker error, not something else, is what case 2's equal rows rest on. Restore.
- [ ] **Commit.** `git commit -s -m "A803 4b: a failed move leaves no copy behind"`.

## Task 5: kitchen paper (about 60 calls)

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
  7. "… moving the bill again: the second MOVED slip lists the held dish under HOLD with its group's
     number at the third table" (revision 1, I2): after case 1's move to Mesa 8, move Bill 2 on to
     Mesa 9 (free). Grill's new jobs since a mark are one MOVED slip, From Mesa 8 To Mesa 9:
     `1.000 x BURG`, `HOLD`, `GROUP m · POSTRES` (m the second copy's number), `1.000 x TARTA`.
     This is the case that reads the copy's `holdPrintedAt`: a later move's "before" picture lists
     a held dish only if its group's `holdPrintedAt` is set (`readOnHoldTickets`,
     `kitchen-print.ts:1566`). It also covers the master plan's "new notices use current
     destination/name" on a subsequent move.
- [ ] **Run.** The file; then the paper probe (measure free memory first); the location grep (I4)
  prints nothing.
- [ ] **Deletion controls.** In `copyHeldGroups`: `holdPrintedAt` set null → case 7 red (the Tarta
  missing from the second MOVED slip). The first move's slip and the FIRE do not read the copy's
  `holdPrintedAt` (the first "before" is read from the source, `move-bill.ts:197-198`; after it
  `onHeldPaper` and `releaseGroup` read stations only, `kitchen-print.ts:1518-1543`,
  `order-groups.ts:871-873`), so cases 1 and 3 are not this field's control. The station copy
  removed → case 1 red (the Tarta missing from the slip) and case 3 red (FIRE unmarked) (finding 3;
  the reviewer's E3 ran both). Restore each.
- [ ] **Commit.** `git commit -s -m "A803 4b: kitchen paper for a held dish that changed table"`.

## Task 6: races (about 40 calls)

**Files.** `waiting-course-copy.test.ts`.

Pattern: `order-drafts.db.test.ts:5988-6006`. Both commands read their revisions and bodies first;
each awaits one barrier; `Promise.allSettled` of both; open the barrier.

These are 4b's own races for the copy, not the master plan's `A803 race replay` item, which belongs
to 4a Task 3 and 4c (`2026-11-01-a803-4-portion-picker.md:1361`). A lost reply followed by a stale
resubmission is Task 4 case 1 (a stale party revision refused, `rowsOf` equal), not a case here.

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

Question 1 items 2–4 are the proposed text, EN and ES. Check each sentence against the code built
in Tasks 1–5 before writing it (CLAUDE.md: a guide is written from the code); write the proposal
where it holds, and where the code makes a sentence untrue, write what the code does and update
Question 1 in `~/waitron-campaign-c/questions.md` and the ledger with the new text (it blocks
landing either way).

- [ ] `table-service.md`: a new section after `#move-dishes` with Question 1 item 2's heading and
  item 3's text, in EN and ES.
- [ ] `kitchen-service.md#held-work`: Question 1 item 4's paragraph, at the end of the section, in
  EN and ES.
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

## Task 10a: the whole slice, guard suites and audits (no commit; about 40 calls)

- [ ] Every guard suite above, each separately, each count read.
- [ ] Every removed or changed `expect` line in `git diff 7d3900e7a4 -- '*.test.ts'` is a row of
  "Changed checks" or is in a new case; anything else is a stop.
- [ ] `rg -n 'held_leaves_party' apps packages` hits only the counter paths, the code's
  registrations and the tests the stay list names.
- [ ] `rg -n 'locationId|location_id' apps/server/src/waiting-course-copy.test.ts` prints nothing
  (I4), and `git diff 7d3900e7a4 -- apps packages | rg '^\+.*(locationId|location_id)'` prints
  nothing (no new location key anywhere in the slice).

## Task 10b: deletion controls of Tasks 1a–2b (no commit; about 65 calls)

- [ ] Re-run, against the final code, each deletion control listed in Tasks 1a, 1b, 2a and 2b (16
  at revision 1): one throwaway edit, the named case or cases red, restore, green. Record the table
  in the ledger: control, case, red message, green after restore. `git diff` after the last restore
  prints only the slice's own changes (no leftover throwaway edit).

## Task 10c: deletion controls of Tasks 3–6 (no commit; about 40 calls)

- [ ] The same for each deletion control listed in Tasks 3, 4, 5 and 6 (8 at revision 1), added to
  the ledger's table; the same leftover check.

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
  Tasks 10b and 10c. The text above it is left as written.
- [ ] PR body in plain English: what the waiter and the kitchen see; no venue reset, no schema
  change; "Changed test checks" (the three rows, with the stay list); "For the owner": Question 1
  blocks landing, listing each of its four texts in EN and ES as they were written (the counter
  refusal, the guide heading, the `table-service.md` section, the `kitchen-service.md` paragraph);
  Question 2's default; the paper LOOK's limits. Then `/finish-branch` with this
  plan named.
- [ ] Ledger `Status: in progress` until landed; then 4c's plan is next.

## Task list and sizes

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight, questions posted, ledger | 15 | no commit |
| 1a | `copyHeldGroups` | 55 | green |
| 1b | drafts follow the copy (four columns; a staying draft's pin) | 45 | green |
| 2a | Move this bill carries held dishes; Changed check 2's two move rows | 50 | green |
| 2b | Split a table carries held dishes; Changed check 1; Changed check 2's split row | 45 | green |
| 3 | what the copy does afterwards (with Current orders and held counts) | 60 | green |
| 4 | rollback and routes | 45 | green |
| 5 | kitchen paper (with the second move's slip) | 60 | green |
| 6 | 4b's own races | 40 | green |
| 7 | counter words, till comments; Changed check 3 | 30 | green |
| 8 | guides EN/ES (Question 1's proposals) | 30 | green |
| 9 | LOOK at the paper | 30 | no commit |
| 10a | whole slice: guard suites and audits | 40 | no commit |
| 10b | deletion controls of Tasks 1a–2b | 65 | no commit |
| 10c | deletion controls of Tasks 3–6 | 40 | no commit |
| 11 | backlog, record pass, PR | 35 | green |

About 685 calls in 16 tasks, none planned above 65.

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

## Build record (4b)

Written 2026-11-04 at `f86819f209`, on main `9c80824143`. The text above is the plan as reviewed and
is left as written, including the parts this section corrects. The review reports it names are outside
the repository, in `~/waitron-campaign-c/a803-4b-reviews/`; the ledger is
`~/waitron-campaign-c/item-a803-4b-ledger.md`, and the owner's answers are in
`~/waitron-campaign-c/questions.md`.

### What was built against the plan

Tasks 0 to 10c were carried out. **Move this bill** to a table and **Split a table** now take a bill
holding held dishes. The other table gets its own held copy of each held group the moving dishes were
in, numbered from that table's next number. Each table fires its own copy. The MOVED slip lists the
held dishes under HOLD where their HOLD ticket printed. **Move to the counter** still refuses, with new
words. The server is the whole change apart from the till's refusal words and a client comment (D12).
Task 10a's diff of `packages/db/src/schema` and `packages/db/drizzle` against `9c80824143` printed
nothing: no schema change.

| Task | Commit | Note |
| --- | --- | --- |
| 1a | `ebfc5bd60a` | `copyHeldGroups` |
| 1b | `78eee621c7` | drafts follow the copy |
| fixes to 1a and 1b | `7758ecaa83` | from their reviews |
| 2a | `db720af7b3` | Move this bill |
| 2b | `cff85e389c` | Split a table |
| 3 | `22e2cbaca6` | tests only, none of them found a defect |
| 4 | `ac68e1359d` | rollback and routes |
| 5 | `db1ef44785` | tests of the kitchen paper only; the code already printed it |
| 6 | `ecd14e9a72` | races |
| 7 | `af87a9ba55` | the counter's words |
| fixes to 2b | `cb1e7c885d` | `errors.ts` description, `splitTable` comment, Split attendance case |
| 8 | `7e37cf630f` | guides as first proposed |
| fix to 2a | `5531068c9b` | pins that a free table's copy comes after the arriving dishes |
| guide cut | `71adba2863` | the owner's shorter passages |
| fixes to Tasks 3 to 8 | `f86819f209` | tests only |
| 9, 10a, 10b, 10c | no commit | reports in the folder named above; the paper LOOK is in `~/waitron-campaign-c/a803-4b-look/` |

Task 10a ran at `71adba2863`; its guard suites all exited 0 (`task-10a.md` has each command and count).
The paper LOOK ran at `7e37cf630f` and is decoded print jobs, not paper. The later commits change only
guides and tests (`git diff --stat 7e37cf630f f86819f209`), so no later code changed what it read.

### Departures from the plan

| Plan said | What happened | Why |
| --- | --- | --- |
| Per-task review by a high-effort reviewer after each task | Tasks 3 to 8 had one review, over all their commits (`tasks-3-8.md`) | The ledger records no reason. Tasks 1a, 1b, 2a and 2b each had their own |
| The guides carry Question 1 items 3 and 4 | Task 8 wrote them; `71adba2863` replaced both with the ~16:05 passages | The owner found them too long and asked for only what a person would not find by trying |
| ES kitchen paragraph names «marcada FIRE» | The new text names no marker | Spanish paper prints `*** MARCHAR ***` (the Task 9 LOOK). The cut made the question moot for the new text; the older lines became A1328 |
| Task 11 runs finding 12's probe | The Tasks 3 to 8 reviewer ran it (`tasks-3-8.md`, I1), at `71adba2863` and at `9c80824143`; it was not run again | Its output was already on record. It confirmed finding 12 and found more: the later ticket has no FIRE mark. Filed as A1327 |
| Task 6 has 3 race cases | 5 tests | The move-and-fire and move-and-Split pairs each run in both orders |
| Task 6 records the code the loser gets | `party.out_of_date`. The commands take turns on the write lock, and the one asked first won in all 65 race runs the review read (13 runs of 5 cases) | The plan left this to be measured |
| 16 controls in Task 10b, 8 in Task 10c | 28 and 10 | Reviews added controls for their own fixes. Two of them, the copy moved after the MOVED slips, ran in both tasks |
| Task 10a diffs against `7d3900e7a4` | Against `9c80824143` | The branch was rebased onto it in Task 0 (A1301 S18b) |
| `held_leaves_party` hits only the plan's stay list | One more hit, `waiting-course-copy.test.ts:941` | It is this slice's own new case, "Move this bill to the counter still refuses a held dish, writing nothing", a counter path |
| Control tables recorded in the ledger | Kept in the review reports and copied below | The ledger points to the reports |

Review findings not listed above: `m2`, `m4`, `m5`, `m6`, `m7` of `tasks-3-8.md` and finding F1 of
`task-10b.md` were fixed in `f86819f209`; `m1` and `m3` are corrected below; `m8` went to the owner as a
note on the open guide question (questions.md, ~16:15).

### The owner's answers

- **Question 1.** The counter refusal and the guide heading are approved as written, in both languages
  (~14:00). The two guide passages were cut to the text lane C posted at ~16:05, at the owner's request.
  **Approval of those passages is still open** when this was written: nothing after ~16:15 answers
  "4b guide y".
- **Question 2.** (A): a moved held group takes the new table's next number (~14:05).

### Corrections to the plan's text

**Finding 1's reason is wrong.** It says an empty held group is not harmless because the release
reminder counts it as the one waiting. It does not: both callers drop empty groups before calling
`releaseReminder` (`order-groups.ts:1882-1883` and `:2288-2289` at `71adba2863`), and that branch is
reached only by direct calls in `current-orders.test.ts`. Removing an emptied group protects two other
things: it no longer sits in the Current orders answer, and it cannot linger as held. Whether the till
draws such a group was not run. With `removeEmptiedHeldGroups` removed (`tasks-3-8.md`, m1):

| Read | Real code | Mutant |
| --- | --- | --- |
| source group state | `removed` | `held` |
| `readCurrentOrders().groups` | `[["other","fired",1]]` | `[["other","fired",1],["G","held",0]]` |
| `.reminder`, `readReleaseReminders`, `readHeldCounts` | null, null, none | null, null, none |
| `fireGroup` on it | `group.not_found` | `management.request_invalid` |
| state after `releaseHeldWorkOf` | `removed` | `held` |

**Task 3's control inherits that.** It says "`removeEmptiedHeldGroups` removed → cases 6, 7 red". The
control is "`removeEmptiedHeldGroups` removed → case 6 red". Case 7 stays green, correctly: it pins that
the source stops reminding, that a copy must be held to be reminded about, and that the due time runs
from the dishes ahead of the copy.

**Finding 9 names the wrong place.** The refusal when firing a copy at a party with no allergy answer
comes from `prepareAllergyRelease` in `apps/server/src/party-allergy.ts`, which `fireGroup` reaches
first, not from the call in `releaseGroup`. Removing `releaseGroup`'s call left the case green; making
the check do nothing turned it red. The case is sound.

**D11's "the second to run is refused" is true, not always for the reason it gives** (`tasks-3-8.md`, m3).
In the first race case the loser never reaches the revision check: it is refused by the check that the
bill has left the party (`bill-actions.ts`, `refuseMovedParty`), which also answers `party.out_of_date`.
The same goes for "split asked first" of the move-and-Split pair. The set has no gap: with the revision
check removed from `guardPathParty` the stale-revision case, both move-and-fire orders and "move asked
first" go red, and with `splitTable`'s check removed "move asked first" goes red.

**Finding 12 said "by reading" and "may".** Run, it does happen, and the later ticket loses its FIRE mark
too: A1327.

**Plan review round 3's three small points**, which the ledger held for this record:
`createStation(tx, input)` takes no context argument since `9c80824143`; D9's attendance captures are "up
to three", because no capture is written when the party has no bill left (seen again in `cb1e7c885d`);
Question 1 item 4's ES should read «bajo EN ESPERA», which the shipped passage now does.

**D9's reader, 2026-11-04.** `readStepFacts` (`service-step-signals.ts`) now reads `detail`: it counts a
`lines_moved` event as an order only when `arrived` is true, as a party's order times when it has no order of its own
and still has a dish on a shown bill.

**Control 9's claim.** The plan says the dish "takes the arrival path" with no copy made. Both cases passed
their earlier assertions and only the source group's `removed` state went red (`task-10b.md`, Note A).

### After the whole-branch review, 2026-11-04

The sections above were written at `f86819f209`, before the rebases onto `721f30a311` and `c11d7ff0c3`; that commit is
`9648aae170` here (same patch id), and other commits they name from before the rebase are not on this
branch either. The review that followed changed behaviour in two
places and added tests:

- **A table that received a bill counts as having ordered** (`0ebff0cfd5`, `5569be5a72`, with their
  wording in `805715db33`). A review run showed "Take order" still live after a move to a free table;
  a fired bill did the same at `721f30a311`, so that path predates this slice and held dishes were a
  new way to reach it. See "D9's reader" above.
- **A copy keeps its source group's `createdAt`** (`83e9ed3cbc`, adding to D4), so the "Held" time
  survives the move. A party's place in the pass's Held column therefore also moves up when a bill with
  an older held group arrives (`partyFirstCreatedAt` in `pass-card.ts`, read as `partyFirstGroupAt` in `working-order.ts`), not only at a merge.
- **Four race cases more** (`eddb5726d0`): recall against Move this bill and against Split a table, each
  asked first in turn. The "5 tests" and "65 race runs" rows above stand for Task 6 as it was.

Two statements above need narrowing. "Printed nothing: no schema change" was true of Task 10a's run;
`f310d21af5` and `9deba32595` later changed comments in `packages/db/src/schema/order-groups.ts`, and only
comments. "No later code changed what it read" was true at `f86819f209`; the rebase brought in `main`'s attendance
and payment changes, none in those two files, and `83e9ed3cbc` later changed `copyHeldGroups`, and a grep of `kitchen-print.ts` and `moved-slips.ts` finds no read of a group's
`createdAt`. The paper LOOK was not run again.

### Line numbers that moved

Task 0's rebase and later work moved these from what the plan cites: `readSentItems` `:1490` to `:1484`;
`readOnHoldTickets`' filter `:1566` to `:1560`; the A803 entry in `docs/backlog.md` `:2020` to `:2025`
before this record's edits; the ES guide's second «HOLD CHANGED» from about `:332` to `:328`. Other line
numbers above were not re-checked one by one.

### Deletion controls

**These ran at `71adba2863`, before `f86819f209`, which changed tests only.** So a line number in these
tables is that commit's. Task 10b: 28 controls, all 28 red for the reason claimed and green after restore
(`task-10b.md`). Task 10c: 10 controls, 14 control-and-case pairs, 13 red and 1 green, the green one
being case 7 under `removeEmptiedHeldGroups` removed, explained above (`task-10c.md`). Both reports are in
`~/waitron-campaign-c/a803-4b-reviews/`, and each states its limits; the tables are copied from them unchanged.

Files in Task 10b's tables: W = `waiting-course-copy.test.ts`, PTA = `party-table-actions.test.ts`,
OD = `order-drafts.db.test.ts`.

**Task 10b, the plan's 16 controls**

| # | Control (the edit) | Case | Red message | Green after restore |
| --- | --- | --- | --- | --- |
| 1 | 1a: hold-station intersection removed; the copy takes all of G's recorded stations (`new Set(held ?? [])`) | W "copies the recorded HOLD stations that hold a moved dish" | 1 failed, 42 skipped. W:365 `expect(await holdStationsOf(copyId)).toEqual([grill])`: `expected [ …(2) ] to deeply equal [ Array(1) ]`, one extra station id | 1 passed, 42 skipped |
| 2 | 1a: `removeEmptiedHeldGroups` call removed from `copyHeldGroups` | W "removes a source group the copy empties" | 1 failed, 42 skipped. W:339 `expected 'held' to be 'removed'` | 1 passed, 42 skipped |
| 3 | 1a: source-order `orderBy` reversed (position descending) | W "keeps two held groups of one course as two copies" | 1 failed, 42 skipped. W:311 `expect([...copies.keys()]).toEqual([g2, g3])`: the same two ids in reverse order | 1 passed, 42 skipped |
| 4 | 1a: `remindAt: null` replaced by G's `remindAt` | W "leaves a snooze behind" | 1 failed, 42 skipped. W:528 `expected '2026-11-04T14:34:12.269Z' to be null` | 1 passed, 42 skipped |
| 5 | 1a: recalled filter `not(isRecalledDish(tx))` removed from the select | W "ignores a recalled dish, …" | 1 failed, 42 skipped. W:507 `expect([...copies]).toEqual([])`: `expected [ [ …(2) ] ] to deeply equal []` | 1 passed, 42 skipped |
| 6 | 1b: `bill_id` filter dropped from the draft rewrite | W "leaves a staying bill's draft on the source group" | 1 failed, 42 skipped. W:682 `toEqual(before)`: the staying draft's `joinGroupId` and `afterGroupId` changed | 1 passed, 42 skipped |
| 7 | 1b: recalled-row `join_group_id` update removed | W "points the moving bill's draft at the copy" | 1 failed, 42 skipped. W:664 `recalledRows` `toEqual`: first row's `joinGroupId` differs from the copy | 1 passed, 42 skipped |
| 8 | 1b: recalled-row `after_group_id` update removed | W "points the moving bill's draft at the copy" | 1 failed, 42 skipped. W:664 `recalledRows` `toEqual`: the hand-made row's `afterGroupId` differs from the copy | 1 passed, 42 skipped |
| 9 | 2a: "keep" clears held lines as "refuse" does (the `clearGroups` filter loses `!staysHeld`) | W "Move this bill to a free table takes a held dish" and "… to a seated table …" | 2 failed, 41 skipped. W:894 and W:928 `expected 'held' to be 'removed'` on the source group. See note A | 2 passed, 41 skipped |
| 10 | 2a: copy call removed from the free-table branch | W "… to a free table …" | 1 failed, 42 skipped. W:883 group list: `expected [ [ …(2) ] ] to deeply equal [ [ …(2) ], [ …(2) ] ]`, the held row missing | 1 passed, 42 skipped |
| 11 | 2a: copy call removed from the seated branch | W "… to a seated table …" | 1 failed, 42 skipped. W:919 group list: the last held row missing | 1 passed, 42 skipped |
| 12 | 2a: seated branch, copy moved to before `groupArrivingDishes` | W "… to a seated table …" | 1 failed, 42 skipped. W:919 group list: the held copy before the arrival's fired group | 1 passed, 42 skipped |
| 13 | 2a: counter destination given "keep" | W "Move this bill to the counter still refuses a held dish" | 1 failed, 42 skipped. W:940 `promise resolved "{ partyId: null, …(1) }" instead of rejecting` | 1 passed, 42 skipped |
| 14 | 2b: copy call removed from `splitTable` | W "Split a table takes a bill holding a held dish"; PTA Changed check 1 "Split a table takes a bill holding a dish held for the kitchen, …" | 2 failed, 130 skipped. W:973 group list: the held row missing. PTA:1455 `expect(flan.groupId).not.toBe(source)`: `expected '<id>' not to be '<id>'` | 2 passed, 130 skipped |
| 15 | 2b: copy moved to before `groupArrivingDishes` in `splitTable` | W "Split a table takes a bill holding a held dish" | 1 failed, 42 skipped. W:973 group list: the held copy before the arrival's fired group | 1 passed, 42 skipped |
| 16 | 2b: `splitTable` given "refuse" again | W "Split a table takes …"; PTA Changed check 1; OD Changed check 2's "split table" row | 3 failed, 428 skipped. All three: `AppError: group.held_leaves_party`, thrown at `refuseHeldLeavingParty` (`working-order.ts:5022`), reached from `splitTable` (`table-actions.ts:320`) | 3 passed, 428 skipped |

**Task 10b, controls added by review fixes**

| # | Control (the edit) | Case | Red message | Green after restore |
| --- | --- | --- | --- | --- |
| 17 | 1a review I1: the copy's number read from the source party (`nextGroupNumber(tx, fromPartyId)`) | W "copies a held group shared by a leaving and a staying bill" and "keeps two held groups …" | 2 failed, 41 skipped. W:272 `displayNumber` expected 2, received 3. W:320 numbers expected 2, 3, received 3, 4 | 2 passed, 41 skipped |
| 18 | 1a review I1: the number not advanced between copies (`displayNumber++` becomes `displayNumber`) | W "keeps two held groups …" | 1 failed, 42 skipped. W:320 second copy's number expected 3, received 2 | 1 passed, 42 skipped |
| 19 | 1a review I2: source-party filter `eq(orderGroups.partyId, fromPartyId)` dropped | W "ignores a recalled dish, … and a dish of another party's held group" | 1 failed, 42 skipped. W:507 `expected [ [ …(2) ] ] to deeply equal []` | 1 passed, 42 skipped |
| 20 | 1a review I3: recorded-HOLD check `held?.has(…)` dropped | W "gives the copy no HOLD station that never got HOLD paper" | 1 failed, 42 skipped. W:390 `expected [ Array(1) ] to deeply equal []` | 1 passed, 42 skipped |
| 21 | 1a review I4: attendance not passed to the two `lines_moved` events | W "records attendance for each event it writes" | 1 failed, 42 skipped. W:420 `expected [ { source: 'draft', …(6) } ] to deeply equal [ { source: 'draft', …(6) }, …(2) ]`: the two events' captures missing, the `removed` event's still there | 1 passed, 42 skipped |
| 22 | 1b review I1: every source group pointed at the first copy in the draft rewrite | W "points each draft reference at its own group's copy" | 1 failed, 42 skipped. W:724 `draftLineRows` `toEqual`: the second group's `joinGroupId` and `afterGroupId` name the first copy | 1 passed, 42 skipped |
| 23 | 1b review M1: `state = 'open'` filter dropped from the draft rewrite | W "leaves a discarded draft of the moving bill as it was" | 1 failed, 42 skipped. W:744 `toEqual(before)`: the discarded draft's `joinGroupId` changed | 1 passed, 42 skipped |
| 24 | 2a review I1: free-table branch, copy moved to before `groupArrivingDishes` | W "Move this bill to a free table …" | 1 failed, 42 skipped. W:883 group list: held before fired | 1 passed, 42 skipped |
| 25 | 2a review m1: a stray second empty held group inserted at the destination by the copy (my edit; the review named no mutant) | OD "a recalled companion travels …", all three rows | 3 failed, 296 skipped. OD:4795 `expected [ { …(14) }, { …(14) } ] to have a length of 1 but got 2` | 3 passed, 296 skipped |
| 26 | 2b review M1: `splitTable` passes `undefined` for attendance to the copy | W "Split a table records attendance for the copy's event" | 1 failed, 42 skipped. W:1014 `expected [] to deeply equal [ { source: 'draft', …(6) } ]` | 1 passed, 42 skipped |
| 27 | 2b review I1: `splitTable`'s copy moved to after `withMovedSlips` has queued the slips | W "Split a table: the leaving bill's MOVED slip lists its held dish under HOLD" | 1 failed, 42 skipped. W:1708 expected `GRUPO 2 · DESSERTS`, received `GRUPO 3 · DESSERTS` | 1 passed, 42 skipped |
| 28 | 2b review I1: Move this bill's copy moved to after `enqueueMovedSlips`, both table branches | W "the MOVED slip lists only the moved dishes, …"; also W "moving the bill again: the second MOVED slip …" | 1 failed, 1 passed, 41 skipped. W:1576 expected `GRUPO 2 · DESSERTS`, received `GRUPO 3 · DESSERTS`. **The second case stayed green: see Findings** | 2 passed, 41 skipped |

**Task 10c** (numbers there are the plan's case numbers for that task)

| Control (the edit) | Case | Red message | Green after restore |
| --- | --- | --- | --- |
| T3: `copyHeldGroups` inserts the copy with `state: "fired"` and a `firedAt` | T3.1 dish held by hand stays held | `Tests 2 failed \| 41 skipped (43)`. `:1072` `expected { …(14) } to match object { …(3) }`: `firedAt` null vs a time, `state` "held" vs "fired" | `2 passed \| 41 skipped` |
| same | T3.3 firing the copy sends none of the source's | Same run. `AppError: group.not_held` from `requireHeldGroup` (`order-groups.ts:2620`): `fire(b, copyId)` is refused because the copy is already fired. This is a domain refusal, not a failed `expect` | same run |
| T3: one copy for all source groups instead of one per group (later sources reuse the first copy) | T3.2 two held groups stay two | `Tests 1 failed \| 42 skipped (43)`. `:1097` `expected [ [ …(2) ], [ …(2) ] ] to deeply equal [ [ …(2) ], [ …(2) ], [ …(2) ] ]`: the second held row is missing | `1 passed \| 42 skipped` |
| T3: the `removeEmptiedHeldGroups` call in `copyHeldGroups` deleted | T3.6 moving again removes the emptied one | `Tests 1 failed \| 1 passed \| 41 skipped (43)`. `:1209` `expected { …(14) } to match object { …(2) }`: `state` "removed" vs "held" | `2 passed \| 41 skipped` |
| same | T3.7 release reminder names the copy | **STAYED GREEN** (the "1 passed" in that run). The plan claims red. See the finding below | same run |
| T3: the lines' `group_id` update in `copyHeldGroups` deleted (moved dish left in G) | T3.8 each table shows its own part | `Tests 1 failed \| 42 skipped (43)`. `:1291` `expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]`: the new table's copy has `[]` rows, and the test's `copyId`, read from the Tarta's line, is the source group G. The source-side assertion above it passed, so the new table's side is what catches this | `1 passed \| 42 skipped` |
| T4: `throw marker` deleted from the `printHoldTickets` spy (test file edit; it still calls the real one) | T4.2 failure after the copy rolls back (Move this bill) | `Tests 2 failed \| 41 skipped (43)`. `:1385` `expected { …(13) } to deeply equal { …(13) }`: `rowsOf` differs (the move committed: new `partyId`, revision 2 vs 3, `removed` and `lines_moved` events, notices) | `2 passed \| 41 skipped` |
| same | T4.2 (Split a table) | Same run, same message: `rowsOf` differs | same run |
| T5: `holdPrintedAt: null` in the copy | T5.7 second MOVED slip | `Tests 1 failed \| 42 skipped (43)`. `:1726` `expected [ [ '*** MOVIDO ***', …(7) ] ] to deeply equal [ [ '*** MOVIDO ***', …(10) ] ]`: `EN ESPERA`, `GRUPO 2 · DESSERTS`, `1.000 x TARTA` missing | `1 passed \| 42 skipped` |
| T5: station copy deleted (`recordHeldPaper` line in `copyHeldGroups`) | T5.1 MOVED slip | `Tests 2 failed \| 41 skipped (43)`. `:1576` same `(7)` vs `(10)` message: the Tarta and its HOLD heading are missing | `2 passed \| 41 skipped` |
| same | T5.3 later FIRE | Same run. `:1623` `expected [ [ 'Paper grill 2', …(6) ] ] to deeply equal [ [ '*** MARCHAR ***', …(7) ] ]`: the FIRE ticket is unmarked | same run |
| T5, from the 2b review: `copyHeldGroups` after `enqueueMovedSlips` in `moveBillOnce` (both call sites moved) | T5.1 MOVED slip | `Tests 1 failed \| 42 skipped (43)`. `:1576` `expected [ [ '*** MOVIDO ***', …(10) ] ] to deeply equal [ [ '*** MOVIDO ***', …(10) ] ]`: expected `GRUPO 2 · DESSERTS`, printed `GRUPO 3 · DESSERTS`, the source's number | `1 passed \| 42 skipped` |
| T5, from the 2b review: `copyHeldGroups` after `withMovedSlips` returns in `splitTable` | T5.6 Split a table's MOVED slip | `Tests 1 failed \| 42 skipped (43)`. `:1708` `expected [ '1.000 x BURG', 'EN ESPERA', …(3) ] to deeply equal [ '1.000 x BURG', 'EN ESPERA', …(3) ]`: expected `GRUPO 2 · DESSERTS`, printed `GRUPO 3 · DESSERTS` | `1 passed \| 42 skipped` |
| T6: `guardPathParty` skipped in `moveBillOnce` (a plain read of the bill instead) | T6.1 two moves from one revision | `Tests 1 failed \| 42 skipped (43)`. `judge` `:1793` `expected [ 'left', 'right' ] to have a length of 1 but got 2`: both moves committed | `1 passed \| 42 skipped` |

**Further mutations, from the test fixes in `f86819f209`.** That commit makes the paper and race cases expect
the group number itself (2, or 3 for the third table and the source's FIRE) rather than read it from the
copy's row, gives the third table a group of its own so the second-move case can tell the two numbers apart,
makes the ordered race cases check that the command asked first won, and makes the race commands carry the
edit state read before they were asked. As the fix round reported them; this record did not run them again:

| Mutation | Result |
| --- | --- |
| The copy numbered 1000 | The printed-number cases go red (`tasks-3-8.md` m2: before this commit every paper case stayed green) |
| Control 28, the copy moved after the MOVED slips | The second-move case now goes red (`task-10b.md` F1: before this commit it stayed green) |
| Which command is asked first reversed | `expected 'fire' to be 'move'` (`tasks-3-8.md` m5: by reading, before this commit each case would pass on its other branch) |

Not run, as `task-10b.md` lists: `item.firedAt === null` dropped (no case covers it, and a review saw that
mutant survive at `ebfc5bd60a`), and mutants the 1b and 2a reviews found change no behaviour. `task-10c.md`'s
late-copy control exercises only the free-table branch of Move this bill. No control re-ran on `f86819f209`
beyond the three above.

### Owner's last word on the guides (2026-11-04 ~18:26, relayed by the watcher)

The owner turned down the service-step sentence in both wordings and asked that every 4b guide
sentence pass one test: does it change what staff do? Removed from both languages, leaving the
behaviour and its tests as they are:

- `table-service.md`, "Clear a service step": the sentence about a moved-in bill and steps.
- `table-service.md`, the held-dishes section: "in a group with that table's next number".
- `kitchen-service.md`, the whole held-work paragraph on the MOVED slip and the fire ticket. The slip
  and the ticket say this themselves, and a cook does nothing different for reading it.

Earlier mentions of these guide texts in this plan and in `~/waitron-campaign-c/questions.md` record
what was true then. The rule went into root `CLAUDE.md` §3 and `docs/developers/conventions-ui.md`.

A third Codex run (`~/waitron-campaign-c/a803-4b-reviews/finish-codex-c.md`) ran the three behaviour
fixes the first two runs never saw: no Critical or Important finding. Its performance finding was
fixed in `bed2df5395`; its guide finding went away with the sentence.
