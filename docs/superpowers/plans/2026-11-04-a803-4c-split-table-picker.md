# A803 slice 4c: Split a table through the one dish picker — task plan

**Goal.** Today **Split a table** takes one bill or none. After 4c the waiter opens **Split a table**,
taps the table that is leaving, and sees every bill of the table with its dishes, in the picker Move
dishes… uses. They tick any whole bills plus any single ("loose") dishes from other bills. Loose
dishes go together on one new bill at the leaving table. Guest counts for both tables are set in the
same panel. If everything is ticked the till offers **Move guests** or **Split anyway**. If nothing
is ticked the leaving table starts with an empty bill. A bill with someone else's unsent dishes shows
a take-over row. The kitchen's MOVED slips name only the dishes that changed table. A590 is fixed: the
split's new room revision (the floor plan's version number, which a later floor edit must quote) is
handed to the floor screen.

**Implements.** The [4a plan](2026-11-01-a803-4-portion-picker.md)'s "Cut 4c (outline)", its finding
8 and the rows naming 4c; the [master plan](2026-10-19-a803-bills-and-tables.md)'s "Slice 4" under
its "Global constraints and release gates" and "Shared execution and verification contract", and its
A590 row; the [spec](../specs/2026-10-18-a803-bills-and-tables-design.md) §3.7 and §6, §3.10 on
wording; [A773's one-editor spec](../specs/2026-10-17-a773-one-editor-design.md) §6 on editors.
Boards 08, 09 and 10 are the picture of the panel. They left the repository at `3ef533f4fe`; copies
taken from `3ef533f4fe~1` are in `~/waitron-campaign-c/a803-4c-look/boards/`. Binding except where
"Departures" says otherwise and why. Where board 09 and the spec differ the spec wins (the board's
"was Bill 2" label is dropped, as the mock-ups' README said).

**Branch** `feat/a803-4c-split-table-picker`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a803-4c-split-table-picker`, planned from
main `4259a040d2` (2026-11-04). Every file and line below was read at that commit; what was run is
named in "Receipts".

**Review weight: FULL.** Risk triggers: a fiscal invariant (the route starts issuing an invoice, D7),
a cross-package contract (`VENUE_SERVICE.splitPartyAllergies` and the till-server wire), concurrency
(two tills on one party), and the received-money floor. Per-task review by a high-effort reviewer;
`/finish-branch`'s full wave at the end, with the Codex run-it seat run twice. The fiscal suites (H2, F
and Filing, under "Guard suites") still run unedited.

**Who lands it: the lane.** The owner's rule (2026-10-21) is that a PR waits for them only if it
changes invoices, the Veri\*Factu chain or its hashes, invoice series or numbering, or AEAT filing, and
that a lane adds no other "owner lands it" gate. 4c changes no fiscal function; it calls the existing
`issueIfFullyPaid` on a new path, as slice 4a's Move dishes route does (#2372, which the lane landed).
The PR body tells the owner in plain words that one split can issue more than one invoice in one
transaction when loose picks finish several part-paid bills, and names the new test cases that pin it
(Task 5's cases 6 and 7; Task 18). An unanswered Question 1 or 2 holds landing until it is answered; the
lane then lands it.

**Execution.** Subagent-driven: each task goes to one `implementer` (medium effort), then a
high-effort reviewer. Each task is sized well under 100 tool calls (estimate in its heading). An
implementer past about 150 calls stops at a passing or cleanly red point, commits, and hands over:
done, left, files, each check's state. Fixing a behaviour defect a review found stays at high effort.

**Every commit is green; the panel is complete at Task 12f.** The server learns the new request
beside the old one (Task 5). The new panel is built behind a temporary screen property, `splitPanelLive`,
that only tests set; Task 12c sets it in the app, and until then the old steps are what a waiter sees.
From 12c to 12f the panel is live on the branch without all its refusals (12d) and take-over (12e), so a
commit in that range is green but not a finished panel. Nothing reaches `main` before Task 14b, because
the branch lands as one squashed PR. The old request, the old window and that property go in Tasks 14a
and 14b.

**No table change (owner's A1308 hold).** 4c needs no migration, no schema file change and no new or
changed table, column, index or trigger. It reads and writes `working_orders`, `working_order_lines`,
`order_groups`, `order_group_hold_stations`, `order_group_events`, `ticket_items`, `kitchen_notices`,
`print_jobs`, `order_drafts`, `bill_edit_states`, `bill_identities`, `bill_number_allocations`,
`party_allergy*` and `allergy_line_ticks`, all existing. Spike S2 (R3) ran the new server sequence
against the current schema with no change. If a task finds it needs a schema change, that is a stop:
tell the driver, who reports it per the hold.

**No locations.** Nothing new is keyed on a location: no parameter, column, fixture value or rule.
Helpers copied from older test files drop any location they name. Each task that adds a test file
ends with `rg -n 'locationId|location_id' <file>` printing nothing.

**Not fiscal core.** Nothing touches `computeHuella`, the chain, invoice numbers,
`registros_facturacion` or the alta builders. **One thing near them changes, and it is a call, not a
change to a function:** the split route starts calling the existing `issueIfFullyPaid` inside
`withIssuanceTransaction`: the same function and arguments as the Move dishes route
(`till-api.ts:4193-4204`), once for each bill that lost dishes. Move dishes makes that call once per
request; here one request can issue several invoices, in bill-number order, the later ones chained on the
earlier, and a refusal rolls them all back (D7, R11). Without the call, ticking the last unpaid dishes of a
part-paid bill would leave a fully paid bill with no invoice. The suites H2, F and Filing below stay
passing and unedited.

## Revision 1 (2026-11-04): answers to plan review 1

The review is `~/waitron-campaign-c/a803-4c-plan-review/review-1.md` (1 Critical, 5 Important, 17
Minor). Every finding is Applied; none is Rejected. Three are applied differently from what the review
recommended (I3, M5, M9), and the row says why. Each was checked at `ae09c6c03f`. "Ran" means this
revision ran it, with the receipt under "Receipts"; "Read" means only read. The task text below is
already changed, so an implementer reads the task and not this table.

| Finding | Answer | Where | Evidence checked for this revision |
| --- | --- | --- | --- |
| C1 the plan dropped the till's guard on what the waiter saw, and ten test cases with it | **Applied** | D20, D16, finding 15, "Moved till-app cases", Task 11c, new Task 12c | Read: `till-app.ts:15589-15617`; A773 §6 "a new outbox/editor since the prompt refuses" (`2026-10-17-a773-one-editor-design.md:220-221`); the `describe` at `till-app-parties.test.ts:11914`, whose ten cases are listed by title in the new table. Also found by search and not in the review's list as such: `:1910`'s row, `:2359`, `:2397`, `:2429`, `:2450`, `:2482`, and that `#onSplitTable` keeps `billId` in old cases only until Task 14a |
| I1 Question 3 overruled A650 without naming it | **Applied** | Question 3, D2 steps 6 and 14, D6, Changed checks rows 5–10, Task 4, Task 18 | **Ran (R9):** the name-gone rule over today's one-bill command turned exactly rows 1, 2, 3, 4, 5, 8 and 9 red (7 failed, 2,958 passed); rows 6, 7 and 10 stayed green. Read: A650 §0 ruling 1 (`2026-10-14-a650-moved-slips-design.md`), `docs/backlog/till.md:2023-2034`, A650's rows 8, 9 and 18 (`:108`, `:109`, `:177`) |
| I2 Task 2 omitted the route | **Applied** | Task 2 Files and Implement | Read: `till-api.ts:3150-3180`; `till-api.table-actions.test.ts:167` pins the answer's keys |
| I3 a form's refusal on the banner | **Applied, by a different mechanism** | D14, D16, Departures (row removed), Tasks 11c, 12d, 16 | The review asked for `splitRefusal.message`, with a fifth owner question if Refund cannot live there. Read: `wt-form-actions`'s `error` is declared a string and `wt-form-error`'s `detail.message` is one (`packages/ui-core/src/components/wt-form-actions.ts`), so a button or `errorText`'s templates (`till-app.ts:1478`) do not belong in it, though round 3 ran one through and it drew. So the panel draws the same message itself, above the buttons, with the exported `formMessageStyles`. Refund then does live there, so no fifth question is needed. Forms contract read at `design-system.md:2653-2672` |
| I4 Refund for a bill not on screen acts on the bill on screen | **Applied** | D16, Task 12d | Read: the refusal already names the bill (`errors.ts:608`, `bill-payments.ts:454`); `billWriteError` drops it (`till-app.ts:683-688`); `#onRefundExcess` opens the bill on screen (`:17830-17839`); `#leavingActions` asks before a switch and closes the panel only on proceed (`till-table-order-screen.ts:5164-5185`) |
| I5 reconnect protection dropped; Question 2 undercounted | **Applied** | Deleted checks, Task 11b, Question 2 | Read: `split-guests-dialog.unsaved.test.ts:159`, `:178`, `:242-260`; `.actions-unsaved.test.ts:254`, which covers only ticks; `design-system.md:2871`, `:2883`; `till-table-order-screen.ts:1522-1525`. Two checks now go with no successor, not four |
| M1 Question 4 is already answered | **Applied**: question deleted | D4, D12, Owner questions | Read: spec §3.7 case 2 ("take that bill over first"), A773 §6 ("A sole common editor can be retained"), `bill-editing.bill-moves.test.ts:280`, `:329` ("refuses a stale empty bill"), `requireExpectedState` (`bill-editing.ts`) |
| M2 Task 11a cannot pass types | **Applied** | Task 11a, D20 | Read: `till-table-order-screen.ts:5056-5061` (`satisfies SplitTableDetail`), `till-app.ts:15599` |
| M3 a control named a case that did not exist | **Applied** | Task 2 case 13, Task 3b | Read: `working-order.ts:2144`, `party-allergy.ts:520-523`, `order-groups.ts:2806-2816` (only an `immediate` dish fires on arrival) |
| M4 D5 silent on `heldByCourse` | **Applied** | D5 | Read: `heldByCourse` is local to one `groupArrivingDishes` call (`order-groups.ts:2806`); `addTabRound` has no caller outside `testing/` (`rg -n 'addTabRound\b' apps packages -g '!*.test.ts'`). The review's `[ 'fired', 'held', 'held' ]` was not run again |
| M5 the Split anyway note is untrue when only a paid bill stays | **Applied: the wording changes**, not the server | Question 1, D12, Tasks 8, 11c | The review offered either. Calling `insertPartyBill` there would reverse `ensureFamilyBill`, whose rule counts a paid bill (`table-actions.ts:400`, `notAbandonedInFamily`), and Task 2 case 4 pins it. A second note says what is true |
| M6 turning picks into a whole bill can take unsent dishes | **Applied** | D12, Task 8 | Read: plan's D12 and Task 8; "locked" is defined nowhere |
| M7 row 12 understated | **Applied** | Row 12 | Read: `requireOtherBill` (`till-api.ts:970`), pinned at `till-api.table-actions.test.ts:554` |
| M8 Task 7's "its code" | **Applied** | Task 7 | Read: `requirePartyParam` refuses a non-UUID `party.not_open` (`till-api.ts:806`); an unknown UUID gives `[null]` from `partySubjectZones` (`zone-access.ts:29-31`); no status filter finds no bills |
| M9 Task 2's RED text | **Applied, with a different message** | Task 2 RED | The review's text said `ERR_INVALID_STATE`. **Ran (R10):** a selection through today's fixture printed `Error: Unknown named parameter 'wholeBillIds'` for both a filled and an empty selection. A failing claim would have printed `tab.not_open`. The plan quotes what was printed |
| M10 the bill on screen left fully paid | **Applied** | D17, Task 12b | Read: `#loadTabLines` empties the list on a failed read (`till-app.ts:11236-11238`); `billToShow` (`state/bill-state.ts:38-44`) |
| M11 nobody builds `SplitSource` | **Applied** | Task 8 (`splitSourcesFrom`), Task 11a, Tasks 12a, 12c | Read: `#recalledLineIds` covers the bill on screen (`till-table-order-screen.ts:2615-2622`); `fallbackPortionKeys` (`:314`); `Draft` (`api/client.ts:808`) |
| M12 who lands it | **Superseded by Revision 2**: the driver decided the lane lands it | Header | Read: the owner's 2026-10-21 rule, as kept in the lanes' memory `lanes-land-their-own-prs.md` |
| M13 a lost reply reads nothing | **Applied, going further** | D16's connection row, Task 12d | Read: `tableWriteError` answers `table.error` for no code (`till-app.ts:748-756`). "Could not update the table" would be false if the split went through, so after the re-read the app follows a table that has gone as a success |
| M14 the guide explains a corner | **Applied, plus one more sentence** | Question 1, Task 15 | The owner's 2026-11-04 rule. The everything-ticked sentence goes too: the screen itself asks that question, and it would have needed rewording for M5 |
| M15 A1192 exists | **Applied** | Task 18 | `/usr/bin/grep -n A1192 docs/backlog.md`: `:1900` |
| M16 Task 17b undersized | **Applied** | Tasks 16, 17b, 17c | Counted from this revised plan, one per arrow in its control lines: 25 server and 42 till. Task 17b splits in two, with one scripted call per control |
| M17 A590's window | **Applied** | Task 13, "Could not be established", R5 | Read: `capabilities: ["print-receipt"]` (`till-app-table-service.test.ts:154`); `[data-update-layout]` (`till-floor-screen.ts:2258`). The review's run printing `[1]` was not run again; Task 13's RED runs it |

**Found while applying these, not in the review:**

- `api.splitTable`'s new signature at Task 5 turns the app tests' `toHaveBeenCalledWith` red at Task 5,
  not Task 12a as row 18 said, and Task 5's GREEN did not run them. Row 18 is split and Task 5 runs them.
- `#onSplitTable`'s no-`field` refusal case (`till-app-parties.test.ts:2429`) pins the banner, and
  I3 reverses that, so it is a changed check (row 25).
- D16 sent `tab.line_not_found` and Task 11a a failed read to `table.reread_failed`, whose words begin
  "The order was updated" (`strings.ts:1370`), which is false in both places. Two new sentences.
- `draft.out_of_date` and `draft.taken_over` say "Reload" (`i18n/codes.ts:350-361`), which is not what
  a waiter does in a panel that has just read again. Two new sentences replace them in the panel only.
- `SplitGuestsDetail` is exported by the file Task 14a deletes and imported by the screen
  (`till-table-order-screen.ts:117`, `:266`), so the type moves first.

## Revision 2 (2026-11-04): answers to the claim check

The check is `~/waitron-campaign-c/a803-4c-plan-review/round-3.md` (1 Critical, 6 Important, 12 Minor), run
at `c645737bd0`. Every finding held on the evidence and is answered below. Two recommended fixes were
replaced, C1's and half of I2's, and each row says why. "Ran" means this revision ran it, with the receipt
under "Receipts" (R11 to R14); "Read" means only read. The task text below is already changed, so an
implementer reads the task and not this table.

| Finding | Answer | Where | Evidence checked for this revision |
| --- | --- | --- | --- |
| C1 a bill that gains someone else's order is dropped and the split goes ahead without it | **Applied, by a different design.** The review proposed dropping the tick and refusing one press. That still lets a second press send the split without the bill, and tells nobody at the moment it happens. Here the bill stays selected, Split is held, and the waiter chooses (D21). The one-press stop is kept only where no choice exists: a bill that has gone, or a pick that was lost | D12, D15, D16, D18, D20, D21, Departures, Tasks 8, 9, 11c, 11d (new), 12e, 12f (new), 15, 16, Question 1 | **Ran (R13):** another person's save through the real route moved both lists: `drafts` gained the row and `billEdits` moved `editorId`, `editorVersion` 0 to 1, `draftId`, `draftRevision`. Read: A773 §6's "new outbox/editor" and "reviews and retries" (`2026-10-17-a773-one-editor-design.md:216-221`); the delete dialog and A427's held action (`design-system.md:2909-2912`, `:5455-5458`) |
| I1 Task 12c's tests need rows Task 12d builds | **Applied** | Tasks 12c, 12d | Read: both tasks; `till-app.ts:15629-15643` |
| I2 three more assertions flip | **Applied in part.** `:11835` is a behaviour row (row 27). `:2540` and `:2542` do not flip: their party holds one table (`:110`; R14 printed `["t4"]`), and a party on one table is never offered Split a table (`till-table-order-screen.ts:5238`), so D16 now says the panel reopens only with another table left, and those two keep the banner by that stated rule. Their two-table twins go in Task 12d, at the panel's foot | D16, rows 18b, 27, 28, Tasks 12d, 14a | **Ran (R14):** the default party's `tableIds`. Read every other `split-table` emit in both files: `:11820` also stays on the banner (row 29); the rest reach no refusal |
| I3 the recovery link is invisible at the panel's foot | **Applied** | D16, Tasks 11c, 12d, 16 | Read: `till-app.ts:1491`, `:1889`, `widgets/recovery-refusal.ts:32-44`, `conflict-evidence.ts:27-30`. The review's contrast figures (1.00 and 1.09 against 5.85 and 7.25) were not run again; Task 12d's case and Task 16 run the fix |
| I4 Task 2 case 13's control stays green | **Applied** | Task 2 | **Ran (R12):** with the allergy copy moved after arrival, plain `split answered`, `hold: true` `allergy.unanswered`; copy where it is today, both answered |
| I5 one request can issue several invoices, and no case says so | **Applied** | Header, D1, D2, D7, D10, Task 5 cases 6 and 7, Task 18 | **Ran (R11):** two bills issued in one transaction are `A/1` and `A/2`, the second's previous record `A/1`. And a refusal needs no stand-in: a €10 simplified-invoice limit lets the €3 bill issue and refuses the €35 one with `sale.total_exceeds_simplified_limit`, leaving 0 sales and 0 records |
| I6 the bill-switch case could not reach its guard | **Applied** | "Moved till-app cases", Task 12c, Question 2 | **Ran (R14):** a retained `prompt` dispatched after the switch: `splitTable calls 0`; with `#billCompositionUnchanged` removed, `splitTable calls 1` |
| M1 "cannot hold a button" | **Applied** | Revision 1's I3 row, Receipts | Read: `wt-form-actions.ts:62`. Round 3's run not repeated |
| M2 a money refusal flashes the banner | **Applied** | D16's "How", Task 12d | Read: `#onBillMoneyRefusal` assigns before its await (`till-app.ts:15802-15805`); `#onPartyOutOfDate` assigns after its reload, but before the handler could clear it, so it takes a parameter too |
| M3 a failed read at once | **Applied** | D14, Tasks 11a, 12a, 15 | The finding holds, so Task 15 writes it into Forms. Read: `design-system.md:2631`, `:2898-2900`, `:5458-5463`, `:6402`. "Choose Back" stays rather than a Try again button: Back and the same table reads again (pinned in Task 12a) and adds no control |
| M4 D5's quoted result | **Applied, and pinned** | D5, Task 2 case 7b | From the review, not run again. So Task 2 gains the case that runs it |
| M5 "no word why" | **Applied**: the reason is replaced | D17 | Round 3's run printed `Bill 1 · Paid ✓`. Not run again; the choice is unchanged |
| M6 "working product" and old refusals | **Applied** | Header, row 18b, Task 12b | Read: `till-app-parties.test.ts:2382`, `:2429` |
| M7 the observe list | **Applied** | D20, Task 11c | Read: D20 and `:12078` |
| M8 the edit readers set the banner | **Applied** | D20, Task 12c | Read: `till-app.ts:17228-17262` |
| M9 `fallbackPortionKeys` | **Applied** | Task 11a | Read: `till-table-order-screen.ts:295-300`, `:314-318` |
| M10 task gaps | **Applied**: `till-app-parties.test.ts` joins Task 5's Files; Task 11d adds `table.split_taken` and `table.split_changed` | Tasks 5, 11d | Read |
| M11 `tab.not_open` | **Applied**: it joins `tab.line_not_found`'s row, so no new sentence | D16 | Read: `errors.ts:755`, `tableWriteError` (`till-app.ts:748-756`) |
| M12 "or untick it" | **Applied**: now true, because D21 keeps the tick, and the sentence is rewritten | Question 1, D16 | Read |
| Item 7, who lands it | **The driver's decision**: the lane lands it | Header, Task 18 | Round 3's facts; #2372 is `9a7efbb6b0` (`git log --grep`). That the lane rather than the owner landed it is from round 3's citation of the lane's ledger, not checked again |

**Found while applying these, not in the check:**

- `draft.taken_over` needed a fallback: if the read after it fails there is no row to show, so it says
  `table.split_changed` naming the refusal's `billId`, rather than "Reload the table" (D16).
- A label for a bill that has just left the party cannot be read after the re-read, so D16 reads it before.
- A take-over from the panel moves the bill's edit state, so without replacing its observation the first
  press after it would refuse (D20, Task 12e).
- Task 12c would have grown past 70 calls with C1's cases, so they are a new Task 12f, and the screen's half
  a new Task 11d.

## Owner questions

Building goes ahead on each default. Questions 1 and 2 hold landing until they are answered, and the lane
lands it after that. Question 3 does not hold landing: the build carries the default and the PR says so.
All go to
`~/waitron-campaign-c/questions.md` at Task 0, one at a time.

A fourth question, whether a bill someone else is editing may leave whole without a take-over, is
answered already: D4 cites the decisions.

**Question 1 of 3 (new words; blocks landing). Rule: new Spanish needs your approval (master plan).
Recommended: the wordings below.** Every new text a person reads, with a recommended
wording. Worked example, from board 08: García is at T7 + T8 with Bills 1, 2 and 3. The waiter chooses
Split a table → T8, ticks Bills 2 and 3 and three dishes of Bill 1.

| Key (proposed) | English | Spanish | Where and what it is built from |
| --- | --- | --- | --- |
| `table.split_pick_heading` | `{table} leaves {party}` | `{table} se separa de {party}` | Panel heading. First half of today's `table.split_table_bill_heading` (`strings.ts:1281`, `:3141`), whose "Which bill goes with it?" is no longer true |
| `table.split_pick_hint` | `Tick what goes with {table}. Everything else stays at {kept}.` | `Marca lo que se lleva {table}. Lo demás se queda en {kept}.` | Under the heading; board 08 |
| `table.split_takes` | `{table} takes {what} · {amount}` | `{table} se lleva {what} · {amount}` | Summary; board 08. Spanish verb as in today's heading |
| `table.split_keeps` | `{table} keeps {what} · {amount}` | `{table} se queda con {what} · {amount}` | Summary |
| `table.split_dishes_from` | `{count} dishes from {bill}` | `{count} platos de {bill}` | A part of `{what}`; «platos» as in `table.action_move_dishes` «Mover platos…» |
| `table.split_dish_from` | `1 dish from {bill}` | `1 plato de {bill}` | The same, for one |
| `table.split_rest_of` | `the rest of {bill}` | `el resto de {bill}` | A part of `{what}` |
| `table.split_empty_bill` | `an empty bill` | `una cuenta vacía` | `{what}` when one side has nothing |
| `table.split_new_bill_note` | `Single dishes go on a new bill at {table}. Merge it later if wanted.` | `Los platos sueltos van en una cuenta nueva en {table}. Se puede juntar después.` | Under the summary, only while a loose dish is ticked; board 08. «juntar» as in `table.action_merge_bills` «Juntar cuentas» |
| `table.split_guests_at` | `Guests at {table}` | `Comensales en {table}` | Each stepper's label; `seat.guest_count` «Comensales» |
| `table.split_nothing_stays` | `Nothing would stay at {kept}. Move the guests to {table} instead?` | `No quedaría nada en {kept}. ¿Mover los clientes a {table}?` | Everything ticked; board 10. «Mover clientes» as in `table.action_move_guests` |
| `table.split_anyway` | `Split anyway` | `Separar igualmente` | Everything ticked; `table.split_guests_confirm` «Separar» |
| `table.split_anyway_note` | `Split anyway leaves {kept} with an empty bill.` | `Separar igualmente deja {kept} con una cuenta vacía.` | Everything ticked; board 10 |
| `table.split_anyway_note_paid` | `Split anyway leaves {kept} with nothing to pay.` | `Separar igualmente deja {kept} sin nada que pagar.` | Everything ticked, when the only bills staying are paid: the server adds no empty bill then (D12) |
| `table.split_changed` | `{bill} changed while you were choosing. Check its row, then choose Split again.` | `{bill} ha cambiado mientras elegías. Revisa su fila y elige Separar de nuevo.` | Bottom of the panel, when a ticked bill changed or a read took a pick off it (D16, D20, D21). Replaces `draft.out_of_date`'s "Reload it" there |
| `table.split_taken` | `Someone else has unsent dishes on {bills}. Choose Take over draft on its row so what you ticked can go with {table}, or untick the bill to leave it at {kept}.` | `Otra persona tiene platos sin enviar en {bills}. Elige Tomar el pedido en su fila para que lo marcado pueda irse con {table}, o desmarca la cuenta para dejarla en {kept}.` | Bottom of the panel, as soon as a read shows it, while Split is held (D21). Replaces `draft.taken_over`'s "Reload the table" there. «Tomar el pedido» as in `table.take_over` |
| `table.split_bill_gone` | `{bill} has left this table or been paid, so it is not in this split. Check what is ticked, then choose Split again.` | `{bill} ya no está en esta mesa o ya se ha pagado, así que no entra en esta separación. Revisa lo marcado y elige Separar de nuevo.` | Bottom of the panel, on the first press after a read took a ticked bill away (D21). One bill per press |
| `table.split_read_failed` | `This table's bills could not be read. Choose Back and try again.` | `No se pudieron leer las cuentas de esta mesa. Elige Atrás e inténtalo de nuevo.` | Bottom of the panel when its first read fails; Split stays quiet. A later read that fails says nothing (D14). `action.back` «Atrás» |
| `table.split_bill_part_paid` | `{amount} paid` | `{amount} pagados` | Bill header beside the label, board 10; `bill_pay.paid_part` «pagados» |
| `table.split_take_over_first` | `You can tick this bill once you take the order over.` | `Podrás marcar esta cuenta cuando tomes el pedido.` | Under a take-over row while the bill is not ticked; board 10 |
| `table.split_presented` | `Presented: this bill goes whole or stays.` | `Presentada: esta cuenta se va entera o se queda.` | Under a presented bill's header; `presented_pay.balance` «Cuenta presentada» |
| `table.split_own_unsent` | `Your unsent dishes go only with the whole bill.` | `Tus platos sin enviar solo se van con la cuenta entera.` | Under a bill holding this person's unsent dishes; `bill_pay.unsent` «platos sin enviar» |

Plus the guide section (Task 15), English and Spanish, also shown to the owner:

- Heading: `Split a table` `{#split-table}` / `Separar una mesa` `{#split-table}`
  («Separar una mesa», `guide/es/table-service.md:267`).
- EN: "When some of a party move to a table of their own, open the **⋮** menu, choose **Split a
  table** and tap the table that leaves. Tick what goes with it: whole bills, or single dishes from
  any bill. Single dishes go together on a new bill at that table. Set each table's guests, then
  choose **Split**. With nothing ticked, the table leaves with an empty bill.

  If someone else has an unsent order on a bill, choose **Take over draft** on its row before you tick
  it."
- ES: «Cuando parte de un grupo pasa a una mesa propia, abre el menú **⋮**, elige **Separar una
  mesa** y toca la mesa que se separa. Marca lo que se lleva: cuentas enteras o platos sueltos de
  cualquier cuenta. Los platos sueltos van juntos en una cuenta nueva en esa mesa. Indica los
  comensales de cada mesa y elige **Separar**. Si no marcas nada, la mesa se va con una cuenta vacía.

  Si otra persona tiene un pedido sin enviar en una cuenta, elige **Tomar el pedido** en su fila antes
  de marcarla.»

Task 15 writes these from the code built; where that code makes a proposal untrue, Task 15 changes it
and updates the posted question, so the owner approves the text that ships.

**Question 2 of 3 (deleted test checks; blocks landing). Rule: a check of the old guests window goes
only where the panel cannot do what it checked; every other check moves to the panel at least as
strictly. Recommended: yes.** The window `widgets/split-guests-dialog.ts` goes, with its three test
files: spec §3.7 puts guest counts "in the same window", so a second window is exactly what the spec
removes. The tables "Deleted checks" and "Moved till-app cases" name where every check goes. Two have
no successor, each with its reason: the cursor starting in the first field, because the panel's heading
takes focus instead, and a technical check that the window's own signals reach the screen around it,
because that window is gone. Worked example of what is lost: today the guests window opens
with the cursor in the first field; after 4c focus goes to the panel's heading, as every action panel
does (`design-system.md:1090`). The ten cases protecting what the waiter saw when choosing are not
lost: they move, under their titles (Task 12c). One of them, a panel carried across a bill switch, now
sends its event directly rather than by pressing Split, because a bill switch closes the panel and leaves
nothing to press; removing the guard still turns it red.

**Question 3 of 3 (does not block landing). Rule: on 14 October you ruled a slip prints "when an order
left a table, or a name on its kitchen paper is gone" (A650, ruling 1), with "From: Mesa 51, 52 / To:
Mesa 51" for the bills that stay. On 18 October you ruled Split a table tells the kitchen only about
"the dishes that changed table" (spec §3.7), which plainly ends that "bills that stay" slip. Does the
later ruling also silence a slip when the name on the ticket has gone?** Recommended, and built: no.

Worked example. Today's plan joins Counter 6 and Table 9 and names the join "García birthday". A burger
is sent; its ticket says **García birthday**. Table 9 leaves with no dishes. The burger has not moved,
but no place called García birthday exists any more; the group now reads as Counter 6.

- **(B, built by default, recommended: both rulings stand.)** A staying dish is told only when **no**
  name its paper printed is still one of its places: "From García birthday, To Counter 6". Plain T7 +
  T8 → T7 gets nothing, as board 09 shows, because "T7" is still on the ticket. The checks at
  `today-names.test.ts:468`, `:482` and `:751` stay as they are. A test run of this rule changed only
  the checks the spec's sentence means to change (R9).
- (A: the later ruling silences this too.) No slip. The cook still holds a ticket naming a place that
  has gone from the floor. Those three checks then change.

Changing from B to A later removes one call in `splitTable` and changes those three checks.

## Read this first: what the planning pass found

1. **The outline's order burns a bill number at the staying table** (measured, R3). The outline puts
   loose dishes first on a new bill of the source party, then moves it out. A bill made on a party
   takes that party's next number at creation (`createOpenOrder`, `working-order.ts:1736`), and the
   allocator reads the history, never the bills shown (`packages/venue-service/src/bill-identities.ts:6-20`),
   so the staying table's next bill would be Bill 3 with no Bill 2 ever visible. Spike S1 printed
   `{ b1: 1, temp: 1, next: 3 }`. The new bill is made **at the new party** instead (D3); spike S2 ran
   that with dishes moved across the two parties, and every row came out right.

2. **4a's core cannot be called as it stands.** `moveDishes` starts with `guardPathParty`
   (`bill-actions.ts:375`), which checks and moves on the party's revision (`parties.ts:386-395`).
   `splitTable` has already done so (`table-actions.ts:300-306`), so a nested call would refuse itself
   `party.out_of_date`. Task 3b pulls the part after the checks into an exported
   `moveCheckedDishes`, with `moveDishes` itself unchanged in behaviour.

3. **Only one copy per source group: `copyHeldGroups` must be called once, over all leaving bills.**
   Two leaving bills sharing a held group, copied bill by bill, give the new table **two** held groups
   for one course, which then fire separately (spike S4 printed 2; one call over both printed 1).
   `copyHeldGroups` already takes lines of several bills (`order-groups.ts`, its `sources` map).

4. **The split route issues no invoice, and now must** (D7). It uses plain `withTransaction`
   (`till-api.ts:3158`); Move dishes uses `withIssuanceTransaction` and `issueIfFullyPaid`
   (`:4193-4204`). The outline does not mention it.

5. **Finding 8's change reaches ten checks in three files, not one** (measured, R1). The outline and
   the brief name `party-table-actions.test.ts`'s PAELLA case. Narrowing the MOVED reach to the leaving
   bill turned ten cases red: the list is "Changed test checks" rows 1–10. Seven change. The other
   three pin A650's ruling on a name gone from kitchen paper, which nothing has reversed, so they stay
   (Question 3, D6, R9).

6. **The till holds one bill's dishes.** `lines` and `#balanceShown()` are the bill on screen
   (`till-table-order-screen.ts:5416-5423`). To list every bill the till needs every bill's lines and
   balance. The per-bill line read refuses a presented bill: `readTabLines` calls `assertTabOpen`
   (`working-order.ts:4324-4325`), and spike S3 printed `tab.not_open`. So a read of each bill would
   leave a presented bill's dishes unlistable and cost two requests per bill. One new read answers
   every bill in one transaction (D11).

7. **Take-over only works on the bill on screen, and nothing draws the conflict rows yet.**
   `DraftSync.takeOver` sends `this.expectedEdit`, the on-screen bill's (`state/draft-sync.ts:617-623`);
   the server refuses a draft of another bill (`order-drafts.ts:730`, `expectedEdit.billId`).
   `sync.others` holds other people's drafts "on this bill" (`draft-sync.ts:286-287`). `rg conflicts`
   over the till's sources finds no reader of the `conflicts` the server sends with `draft.taken_over`
   (`editorConflict`, `bill-editing.ts:237-246`), so A773 §6's rows were never built for joins and moves either. 4c builds
   them for Split a table only (D18); joins and moves stay as they are (a backlog point, Task 18).

8. **Whole and loose need different editor rules.** The outline says `requireRelocatableBillEditors`
   for all of them. That rule lets a sole foreign editor through. A773 §6: "bill merges/dish transfers
   require the actor to own each nonempty source/destination regardless", and 4a's D6 uses
   `requireBillEditors` for that reason. And both functions demand that `expectedEdits` be exactly the
   ids they are given (`readExpectedBillEdits`, `bill-editing.ts:223-233`), so one list cannot simply
   go through both. D4 adds one function for both.

9. **The simplified-invoice question applies here too.** Move dishes asks "Separate bills for
   different people?" when the bill it cuts is over the simplified-invoice limit (`#askDifferentPeople`,
   `till-app.ts:15931`; `#onMoveDishes` `:15973`). A loose pick cuts a bill the same way; a whole
   bill does not. Today's one-bill split asks nothing because it never cuts a bill. D16.

10. **The floor screen is on the page behind a till's order screen, and not on a handheld's.** Probe
    R5: on a till, after the split, with the floor read held, `floor(el)` was the same instance before
    and after `back-to-floor`, so handing it the answer would work there. On a handheld the order
    screen is a tab card and `#tabBody` draws one tab (`till-app.ts:18988`, `:19050`, `:19080`), so the
    floor is not mounted to be told. `#carry` is also private to the screen (`till-floor-screen.ts:1840`).
    So the app keeps the answer and hands it down as a property (D19), which covers both.

11. **Join tables and Move guests from the order screen drop `zoneRevisions` too** (by reading: the
    route wraps all three in `movingRooms`, `till-api.ts:3099`, `:3163`; `rg zoneRevisions
    apps/till/src/till-app.ts` prints nothing). A590 names only the split. 4c fixes the split and adds a
    backlog point for the other two (Task 18), though the helper D19 adds makes them one line each.

12. **`guestsStepper` cannot draw two fields as written.** Its `name` is the fixed `"guests"` and its
    label the fixed `seat.guest_count` (`widgets/guest-count.ts:39-62`), and a comment says "No draft
    scope tracks this field". Task 11a adds optional `name` and `label` parameters; the panel's action
    scope tracks them, so that comment moves to the other callers' side.

13. **Today's window protects things the panel must keep.** A staying count left untouched follows a
    count stored on another till, and a typed one does not (`split-guests-dialog.ts:89-97`, pinned at
    `split-guests-dialog.unsaved.test.ts:212-260`), including while the screen is taken out of the page
    and put back. A refused count reopens beside its field with what was sent (`SplitRefusal`,
    `till-table-order-screen.ts:272-281`; `till-app.ts:15629-15643`). Tasks 11a, 11b and 11c carry these
    over.

14. **Open items 4c must not absorb.** A1327 (a dish waiting for the pass gets no MOVED line): a loose
    dish in that state has the same gap, because it comes from `readSentItems`, which 4c does not
    change. A1330, A1331 and A1333 (service steps after a bill leaves): Split anyway reaches A1333's
    state more easily; it stays the owner's question. Task 18 adds a sentence to A1327 and A1333 and
    changes none of their code.

15. **The server cannot refuse a change the till has already read.** It compares each bill's edit
    state with what the request sends. If a background read picks up a change and the till sends the
    new state, the server accepts. So the till compares with what the waiter saw, and refuses before
    sending (`#splitTablePrompts`, `till-app.ts:15589-15617`). A773 §6 asks for this: "a new
    outbox/editor since the prompt refuses". The panel keeps that guard, per ticked bill (D20).

16. **A read must not quietly shorten a split.** Ticks live longer here than today's one choice did, and
    "nothing ticked" is a valid split. So a tick a read removed with no word would send a split without
    that bill, or an empty one. D21 says what a read may do to a selected bill.

## Where the outline is now wrong

| Outline (2026-11-01) | Now | Receipt |
| --- | --- | --- |
| Loose dishes go on a new bill "of the source party", then leave | The bill is made at the new party, after the whole bills take their numbers | Finding 1; R3 S1, S2 |
| "with 4a's core" | `moveDishes` cannot be nested; `moveCheckedDishes` is extracted | Finding 2 |
| Every bill and source checked with `requireRelocatableBillEditors` | `requireSplitEditors`: whole by relocation, loose by ownership, one conflict answer | Finding 8 |
| "every leaving bill … leaves through the existing path with 4b's copies" | Yes per bill, except `copyHeldGroups`, once over all of them | Finding 3; R3 S4 |
| (silent) | The route issues the invoice of a bill left fully paid | Finding 4; D7 |
| Reach narrowed changes `party-table-actions.test.ts:1466-1482` | Ten checks in three files; that case is now at `:1492-1508` | Finding 5; R1 |
| `packages/module/src/module.ts:1474-1493` | `:1356-1362` | read |
| `#onSplitTable` hands `zoneRevisions` to the floor screen's `#carry` | The app holds them and passes a property; `#carry` is private and a handheld has no floor mounted | Finding 10; R5 |
| Floor's join at `till-floor-screen.ts:1662-1669` | `:1659-1669` | read |
| "The 4a widget gains bill headers with a tri-state tick" | A new `till-split-picker` draws the headers around one `till-portion-picker` per bill, which gains a `whole` property | D13 |
| Guest steppers via `guestsStepper` | Needs `name` and `label` parameters first | Finding 12 |
| 4c about 12 tasks | 31 tasks, about 1,510 calls | Task list |
| (master) `guests:{staying,leaving}`, `allSelected:"move-guests"\|"split-anyway"` in the body | `guestCounts` stays (existing name, `till-api.ts:826`); no `allSelected`: Move guests is its own command, as the outline said | D10 |
| (master) "Test A666 seats before a floor join and A757 highest joined-table state remain intact" | Kept as Task 2 cases | below |

## Decisions

- **D1 The command.**

  ```ts
  export interface SplitSelection {
    wholeBillIds: string[];
    loose: { billId: string; lineIds: string[] }[];
  }
  export async function splitTable(
    tx: Transaction,
    cfg: OriginConfig,
    partyId: string,
    tableId: string,
    selection: SplitSelection,
    options: {
      expectedPartyRevision: number;
      operatorId: string;
      guestCounts?: SplitGuestCounts;
      expectedEdits: BillEditExpected[];
    },
    attendance?: OrderAttendance,
  ): Promise<{ partyId: string; billIds: string[]; looseSourceIds: string[] }>;
  ```

  `billIds` is the new party's bills in number order, from the existing `shownBillIds`
  (`table-actions.ts:417`). `looseSourceIds` is the bills that lost loose dishes, in number order, for the
  route to issue (D7); it never reaches the wire. Bad shapes: a whole id twice, a bill both whole and loose, one bill in two
  loose entries, or a loose entry with no lines is `management.request_invalid { field: "selection" }`;
  the same line twice inside one entry is 4a's `tab.transfer_duplicate_line`. A line id is resolved as
  4a's D2 resolves it (`resolveMoveLines`, `bill-actions.ts:323`), never replaced by another portion.

- **D2 The order inside the one transaction**, each step with its reason:

  1. `checkAndBumpParty`, setting the staying guest count (as today).
  2. `table.not_joined`, `table.not_shared` (as today), then the shape refusals of D1.
  3. `requireSplitEditors` (D4), before any bill's own state, as today.
  4. Each whole bill: `refuseUnsplittableBill` (an open or presented bill may go). Each loose source:
     `requireBillOfParty` (refuses presented, paid, abandoned, other party), `resolveMoveLines`, and a
     dish recalled into a draft refuses `draft.out_of_date` (`reservedRefusal`, as 4a's D2).
  5. Each whole bill in number order: `leaveParty(tx, id, "keep")`, collecting firers and held ids.
  6. Read `readPartiesSentWork(tx, [partyId])` once, **before** any table leaves and before any line
     moves: every bill of the party and its family and every counter order delivered to its tables.
     4b's finding 3 (the "before" picture needs held dishes still in their group, and for whole bills
     `leaveParty` first, as `withMovedSlips` sees them today).
  7. `leaveTables`, `openParty` with the leaving count, `inheritKitchenNote` "copy" (as today).
  8. Each whole bill in number order: `allocateBillNumber`. Before step 9, so the new bill numbers last.
  9. Loose: `insertPartyBill(tx, cfg, newParty)` (label null, zone of the leaving table; S2 used
     `createOpenOrder` with the source's label and got the staying table's name in `working_orders.label`,
     so not that). For each source in number order, `moveCheckedDishes` onto it with `refuseHeld: true`. Then
     `assertBillInvariant` on every source, then `leaveParty(tx, newBill, "keep")`.
  10. `VENUE_SERVICE.splitPartyAllergies` with every leaving bill (D8). After step 9, because it reads
      the bills' lines; before step 12, because firing on arrival needs the answer (4b finding 9).
  11. Nothing selected: `insertPartyBill` the empty bill. Otherwise whole bills: `takeIntoParty`,
      `moveBillDraftsToParty` with **that bill's** expected edit (today's `expectedEdits[0]` becomes a
      find by id).
  12. Each leaving bill in number order, new bill last: `groupArrivingDishes`. Then `copyHeldGroups`
      **once** over every held id (finding 3). Then `printHoldTickets` over every `held` answer.
  13. `ensureFamilyBill` on the staying party when a whole bill left; `leaveMergesRestoring`.
  14. MOVED slips (D6). Return `{ partyId: newParty, billIds: await shownBillIds(tx, cfg, newParty),
      looseSourceIds }`.

- **D3 Where the new bill is made.** At the new party (finding 1). So moved lines cross parties
  mid-transaction: nothing in `carveLines` or `moveOrderLines` reads a party (`working-order.ts:4125-4215`,
  `:4670-4760`), and spike S2 ran it: the burger's fired group cleared and a new fired group made at the
  new party, the flan rebound to a held copy, the tarta left in the source group still held, one
  `moved` notice for BURG only.

- **D4 Editors.** New `requireSplitEditors(tx, wholeIds, looseSourceIds, operatorId, expected)` in
  `bill-editing.ts`. It reads the union, requires `expected` to be exactly the union, sorted, and
  compares each state (`requireExpectedState`). The conflicts are every bill in the set not owned by
  the actor; refused when a loose source has a foreign editor or the whole bills have two or more
  different editors. All of them go in one `draft.taken_over` with `conflicts`, sorted by bill id
  (A773 §6). A staying bill is not in the set.
  The new bill has no draft and no editor row.

  **The till is stricter than the server, by decision, not by question.** Spec §3.7 case 2 (owner,
  2026-10-18, "Yes") and board 10: "take that bill over first", so the till greys the tick of a bill
  holding someone else's unsent dishes and draws the take-over row. A773 §6: "A sole common editor can
  be retained during relocation", so the server keeps accepting it (`bill-editing.bill-moves.test.ts:280`
  stays green and unedited). A request sent with an out-of-date state is refused `draft.out_of_date`,
  pinned by "refuses a stale empty bill" (`:329`).

- **D5 Arriving dishes, bill by bill.** Each leaving bill gets its own fired group, as if the bills
  moved one after another (`groupArrivingDishes` takes one bill). So two bills with fired dishes make
  groups 1 and 2 at the new table, and a held copy takes the next number after them. Pinned by a case
  so a change is a decision.

  One limit: `groupArrivingDishes` makes its own held group per course on each call (`heldByCourse`,
  `order-groups.ts:2806`), so finding 3's two-groups shape would also appear for two whole bills that
  each hold a waiting-course dish outside any group. Round 3 ran two whole bills added with `hold: true`
  through the test-only `addTabRound` and printed `["held","held"]`, and with a third dish that fires on
  arrival `["fired","held","held"]`; rounds added without `hold: true` printed `["fired","fired"]`. Task 2's
  case 7b pins it. `addTabRound` has no caller outside `testing/`, and I found no other way into that state,
  so I believe it cannot happen in service today. That is the same open point as `tab.split_held_line` under
  "Could not be established". 4c does not change it.

- **D6 MOVED slips** (spec §3.7; A650 ruling 1; finding 5; Question 3's default). Step 6's map is split
  in three at step 14:
  - **Each whole bill:** `enqueueMovedSlipsFor` over its entry, by today's rule (`kitchenToBeTold`).
  - **The dishes that left each loose source:** `enqueueMovedSlips(tx, cfg, before, newBill, splitFrom)`,
    so `movedItems` keeps only ticket items of that source now on the new bill (`kitchen-print.ts`,
    `movedItems`), one slip per source, because each names the order number it was sent under. A dish
    waiting for the pass is outside `before` as today (A1327, not absorbed).
  - **Everything else in the map** (staying bills, what stays on a loose source, the family's paid bills,
    counter orders delivered to the party's tables): a new `enqueueMovedSlipsForNamesGone(tx, cfg, rest)`
    in `kitchen-print.ts`, told only when the paper printed at least one name and none of them is still
    one of the order's places: `before.places.names` has entries and none is in `after.names`. So plain
    T7 + T8 → T7 tells nothing, and "García birthday" ending prints From García birthday, To Counter 6.

  That map has to be read for the third group, so 4c does not drop the read of staying bills. R9 ran the
  rule over today's one-bill command. `withMovedSlips` stays for the other actions.

- **D7 Issuance.** The route runs in `withIssuanceTransaction`; after `splitTable`, for each of
  `looseSourceIds`, in that order, `issueIfFullyPaid(tx, fiscal, sendCfg, source, personId)`, then
  `captureKitchenActivity` over the loose sources and the new bill, as the Move dishes route does. The
  order is `splitTable`'s, not the request's, so invoice numbers follow bill numbers whatever the till sent.
  A whole bill keeps its money and is not re-judged. No fiscal function changes. It runs inside
  `movingRooms`' write. **One request can issue several invoices,** which no Move dishes does: when loose
  picks finish several part-paid bills, each gets its own invoice, the later chained on the earlier, and any
  refusal, whichever invoice it comes at, rolls back the split and every invoice before it (R11; Task 5 cases
  6 and 7). A refusal by the box's trading state (`requireEconomicWrite`, reached inside
  `issueWhenFullyPaid`, `bill-payments.ts:673`) rolls the split back, as it does a Move dishes; a split with
  no loose dish never makes that call.

- **D8 Allergies.** `splitPartyAllergies(tx, from, into, billIds: readonly string[], operatorId)`, an
  interface change in `packages/module/src/module.ts:1356-1362` and
  `packages/venue-service/src/party-allergy.ts:340`. `copyGuestsAndBillTicks`, also called by
  `moveBillAllergies`, takes the list too. Guests are copied once; ticks of every listed bill's lines
  and open drafts move to the copies; a staying bill's ticks stay. No answer at the source copies
  nothing, so the new party is unanswered, as today (`:348`, A669).

- **D9 Bill numbers.** Whole bills first in their number order, the new bill last (master plan and
  outline); the new table counts from 1 (owner's 2026-10-19 answer). The staying table's numbers are
  untouched and burn nothing (D3). A party's paid bill never leaves.

- **D10 The wire.** `POST /api/parties/:id/split-table` body `{ tableId, selection,
  expectedPartyRevision, expectedEdits, guestCounts? }`, answer `{ partyId, billIds, zoneRevisions? }`.
  `requireSplitSelection` lower-cases ids and refuses a bad shape `management.request_invalid { field:
  "selection" }`. The route leaves `looseSourceIds` out of the answer. No `allSelected`: Move guests is its own command. Task 5 accepts `billId` beside it
  and answers `billId` beside `billIds` so the till keeps working; Task 14b removes both. No
  `submissionId`: a resend after a lost reply is refused `party.out_of_date` as 4a's D9, pinned in
  Task 6.

- **D11 One read for the panel.** `GET /api/parties/:id/split-sources`, `requireSession(deps, c, {
  passive: true })` and `checkZones([{ partyId }])`, as `GET /api/parties/:id/drafts` is
  (`till-api.ts:3576-3599`). It answers `{ bills: { billId, lines: TabLine[], balance: BillBalance }[] }`
  for the party's own open and presented bills, in number order, in one transaction. `readTabLines`
  splits into the open check and a new exported `readBillLines` that reads a presented bill too. A bill
  of the party's family stays out: `#splitTableBills` lists `bill.partyId === party.id` today
  (`till-table-order-screen.ts:4952-4958`), and Finish table alone reaches those. Drafts come from the
  existing `listDrafts`, which `DraftSync` already polls.

- **D12 The selection model** (`state/split-selection.ts`, pure, over one 4a `PickGroups` per bill).
  A bill is `none`, `some` or `all` in a whole-bill set plus per-bill picks.
  - Ticking a bill's header at `none` or `some` makes it whole; at `all`, none (board 08).
  - Unticking a row of a whole bill turns it into picks of every other row, each up to its limit, so
    the floor still holds: a €40 contribution on a €52 bill may leave some rows unticked (spec §6).
  - A bill whose every dish is picked becomes whole, unless a dish of it is paid or recalled or it
    holds this person's own unsent dishes (`ownUnsent`), which go only if the whole bill is chosen
    (`table.split_own_unsent`). A whole bill keeps its number, name and payments; two ticks should not
    silently make a new bill and leave an empty one behind.
  - A whole part-paid bill is selectable with its payments; its paid rows are never picks (spec §3.7).
    Its floor binds picks only, never the whole tick.
  - A presented bill: header tick only, its rows greyed `presented`, because the server refuses
    picking from it `bill.presented`.
  - A bill with someone else's unsent dishes: no new tick and no rows until taken over (board 10; D4). A
    bill already ticked when that happens keeps its tick and its picks, and its tick can only clear (D21).
  - A dish recalled into any draft is in no row (4a's D17).
  - The till reads `pickedLineIds` per bill and sends whole bills in the order they are numbered.
  - **Everything ticked** means at least one bill is whole and nothing with dishes stays: every other
    owing bill has no sent dish and no open draft. A paid bill does not count as staying. Its note says
    what the server will do: with an empty owing bill staying, or no bill at all staying, "with an empty
    bill" (`table.split_anyway_note`). With only paid bills staying, including one on a party merged
    into this one, the server adds nothing (`ensureFamilyBill`, `table-actions.ts:400`, Task 2 case 4),
    so "with nothing to pay" (`table.split_anyway_note_paid`). This is the one place 4c says other than
    spec §3.7 case 3's "leaves the staying table an empty bill", because that sentence is not true then.

- **D13 The widgets.** New `widgets/split-picker.ts` (`till-split-picker`) draws, per bill: the header
  (a native checkbox with `.indeterminate`, the bill's short label, `{amount} paid`, the total), any
  take-over row or note, and a `till-portion-picker`. It holds no picks of its own, as D10 of 4a: it
  emits `split-picks` with the model's next value, and the screen keeps it in its action scope.
  `till-portion-picker` gains `whole` (boolean): rows draw ticked and pale with no stepper (board 08);
  a tick stays usable and unticking emits `portion-picks` with that row's members left out; a paid row
  in a whole bill draws ticked, disabled, with its reason. Native checkboxes are what
  `scripts/native-form-fields.test.ts:138` allows.

- **D14 Guests.** Two `wt-number-stepper`s through `guestsStepper`, `name="stayingGuests"` and
  `"leavingGuests"`, `table.split_guests_at`. Staying starts from the party's count and follows a count
  stored elsewhere while untouched, also while the screen is out of the page (as `#storedChanged` does,
  `split-guests-dialog.ts:66`); leaving starts blank; blank records no count. Invalid text marks
  the field on Split, with `form.fix_fields` at the bottom and Split disabled until fixed; a server
  refusal of a count (`refusedSplitSide`, `till-app.ts:731`) goes under its field with `form.fix_fields`
  at the bottom (`design-system.md:2666-2669`) and keeps Split enabled. While the panel's read has not
  answered Split is quiet and disabled (the Forms contract's "waits for a load"). If the panel's first read
  fails, that is a load failure, not a check of the form, so it shows at once: `table.split_read_failed` at
  the bottom, with Split still quiet. Only the first read does that: a later read that fails keeps the last
  rows, says nothing and leaves Split as it was, because a request's failure never disables the action.
  Task 15 writes this into Forms. Enter submits from either stepper (`submitOnEnter`, as the window does). Split is primary
  from the start: "nothing ticked" is a valid split (spec §3.7 case 4).

- **D15 Everything ticked.** Pressing Split swaps the action row for board 10's question: **Move
  guests** (primary), **Split anyway**, Back. Move guests goes through the existing path:
  `#prepareRelocation("move", table, …)` with `actionVerb = "move"`, then the `move-guests` event
  (`till-table-order-screen.ts:4810-4849`). It moves the party off **all** its tables to the leaving
  table and keeps the party's guest count, so the steppers' values are not used; the question names the
  tables that would be left. Split anyway sends the split with the counts. Changing a tick returns to
  the action row, and so does a read that holds a selected bill (D21), so neither Split nor Split anyway can
  go past it.

- **D16 Refusals.** The panel closes on send and keeps nothing of its own: the app's `splitRefusal`
  carries `{ tableId, selection, staying, leaving, field?, message, prompt? }`, and the panel reopens from
  it, with its ticks and counts, while the party still holds the table and at least one other (extending
  today's pattern, `till-table-order-screen.ts:2005-2008`). A party on one table is never offered Split a
  table (`:5238`), so it has no panel to go back to. After a re-read, `tidySplit` adjusts picks to what is now on
  screen. 4a closes its panel for good on a refusal; here a split is many ticks, so they are not thrown
  away (master plan: "retain a losing editor's local unsaved work"; root `CLAUDE.md` §3).

  **Where the sentence goes** (Forms contract, `design-system.md:2653-2672`). The panel is a form: it has
  two fields. A refusal naming a count goes under that stepper, with `form.fix_fields` at the bottom. Any
  other refusal is one sentence at the bottom, above the buttons, on its own line and announced, until
  Split is pressed again, and never disables Split by itself. The till's `errorKey` banner is used only when
  there is no panel to reopen: the party no longer holds the table, holds only that table, or the waiter has
  left. So `table.not_shared` reads on the banner when the party really has one table, and at the panel's foot
  when the till still shows two. A `split-table` with no `prompt` that finds no edit state composes at Send and
  says so on the banner as today (D20): it never came from a panel.

  **How.** The app works out what to say first, without assigning `errorKey`, then runs the row's re-reads,
  then decides: if the panel can reopen, `message` is `errorText(said, …, "panel")`'s result; otherwise
  `errorKey = said`. So no banner shows while a read is out. `#onBillMoneyRefusal` assigns before it awaits
  (`till-app.ts:15802-15805`), so the money row calls `billWriteError` and `#loadPartyBills` itself; every
  other caller keeps it as it is. `#onPartyOutOfDate` gains a last parameter, `say`, defaulting to assigning
  `errorKey`. The label of any bill the sentence names is read **before** the re-read, because the bill may
  have left the list by then.

  `errorText` answers a string or a template (`till-app.ts:1478`), and `wt-form-actions`'s `error` is declared
  a string, so the screen draws `<p class="form-message" role="alert" data-split-refusal>` directly above its
  `wt-form-actions`, with `formMessageStyles` from `@waitron/ui` and the `.error-part` and `.error-action` rules
  of `till-app.ts:1854` and `:1884`, since those do not cross into the screen's shadow root. It does not copy
  `.error-part + .error-part` (`:1889`), whose border is `--wt-color-on-danger`, made for the banner's red.
  `errorText` gains a last parameter `surface: "banner" | "panel" = "banner"`, and calls `recoveryLink(error,
  surface === "banner")` at `:1491`. Otherwise a refusal carrying `recoveryUrl`, such as `sif.allocation_invalid`
  when a bill left paid meets an active fiscal conflict (`conflict-evidence.ts:27-30`), draws its link in the
  banner's colour, which round 3 measured at contrast 1.00 on the panel in light and 1.09 in dark. A marked
  field's `form.fix_fields` still goes through `wt-form-actions`. D21's sentence replaces a no-field refusal's
  sentence, because it says what is true now; beside a marked field both show, one after the other.

  | Code | The sentence | What is read again |
  | --- | --- | --- |
  | `management.request_invalid` naming `guestCounts.staying` or `.leaving` | `seat.guest_count_invalid` under that stepper | nothing; the observation (D20) stays |
  | no `code`: the request failed or its reply was lost | Order and floor are read first. If the party no longer holds the table, the split went through: no message, no panel, and D17 follows it. Otherwise `table.error` | order and floor |
  | `party.out_of_date` | `#onTableRefusal`'s words | order and floor |
  | `draft.taken_over` | If the read shows the bill held: D21's state, with its sentence and rows. If that read fails or shows none: `table.split_changed` naming the refusal's `billId`, with Split enabled | drafts |
  | `draft.out_of_date`, and the till's own comparison at Send (D20) | `table.split_changed` naming the bill in its params. If the read shows that bill held, D21's state and sentence instead | drafts |
  | `tab.line_not_found`, `tab.not_open` | `table.split_changed` naming the bill (`tabId` in its params, `errors.ts:755`, `:760`) | bills, sources |
  | `bill.line_paid`, `bill.received_exceeds_total`, `bill.refund_in_progress`, `order.payment_in_flight`, `working_order.not_open` | Their words with `{bill}: ` in front (`table.refused_on_bill`), and "Refund {amount}" for the second, through `#onBillMoneyRefusal` | bills, balance, sources |
  | `bill.presented`, `bill.paid` | The bill named, as `#refusedDestination` names one (`workingOrderId` in their params) | bills, sources |
  | `tab.split_held_line` | `table.split_held_error` | sources |
  | `sale.total_exceeds_simplified_limit` | Its existing words (in `TABLE_REFUSALS`, `till-app.ts:620`) | nothing |
  | anything else, including another `management.request_invalid` and a refusal carrying `recoveryUrl` | `tableWriteError`, through `errorText(…, "panel")` | nothing |

  **Refund on the bill the refusal names.** `bill.received_exceeds_total` names its bill
  (`workingOrderId`, `errors.ts:608`), and a loose source may be any bill. So for a split: `CounterError`'s
  `excess` gains `billId` and `bill` (the label); the button's `refund-excess` event carries `billId`;
  `#onRefundExcess` (`till-app.ts:17830`) opens nothing but that bill, and every other caller, which sends
  no `billId`, behaves as today.
  - That bill on screen: the Refund dialog opens over the panel; the ticks stay, and `tidySplit` runs on
    the re-read after it.
  - Another bill: the screen stops the event at the panel and asks through `#leavingActions`, as any
    bill switch asks. **Keep** leaves the ticks and opens nothing. **Discard** closes the panel, and the app
    switches to that bill (`#flushBeforeSwitch`, `#showBill`, `#loadTabLines`), then opens its Refund.

  None sends the person to somebody else. The different-people question (finding 9) asks when any
  loose source's total is over the limit; `#askDifferentPeople` gains a `billIds` parameter.

- **D17 After the split.** The till stays with the staying party at its other table, as today
  (`till-app-parties.test.ts:2280`). If the bill on screen left whole, `billToShow` chooses (as
  `till-app.ts:15655-15668`). If loose dishes left the bill on screen and it still owes, it stays on screen
  and its lines are re-read. If they were its last unpaid dishes, it is now paid, and `GET lines` refuses
  a settled bill, so its list would be empty under its `Paid ✓` (`#loadTabLines`,
  `till-app.ts:11236-11238`). So it counts as gone: `billToShow(undefined, read)` shows the lowest-numbered
  bill still owing, or the paid bill if none is, because a bill still owing is what the waiter is working on.

- **D18 Take-over rows.** `DraftSync` gains `partyDrafts` (the last `listDrafts` answer's drafts) and
  `takeOverOn(billId, draftId, revision)`: `api.takeOverDraft` with `expectedEditFor(billId)`, then its
  own `#load()`. The on-screen bill keeps `takeOver`. The row is `{bill} · {name}` with
  `table.others_draft`'s words and the existing `table.take_over` button and `#takeOverDialog` (no new
  dialog, no bulk take-over; A773 §6). `takenFromYou` rows use `table.draft_taken_by`'s words as the
  order screen does. When a selected bill is taken over from the panel, the app replaces that bill's
  observation (D20) once `takeOverOn`'s read has answered, and the bill keeps its tick and picks (D21).

- **D19 A590.** The app gains `floorCarried: ReadonlyMap<string, { revision; answeredAt }>`. On a
  split's answer, before `#reloadTables` starts, each `zoneRevisions` entry is stored with
  `nextFloorMoment()`. `till-floor-screen` gains a `carriedRevisions` property, and `#revision`
  (`till-floor-screen.ts:1378-1385`) takes the later of its own `#carried` and this one, under the same
  rule: only while `tablesReadAt < answeredAt`. A later read that started after the answer wins, and a
  poll that started before it does not.

- **D20 What goes, and the guard that stays.** Going: `split-table-bill`, `#splitTableBills`' bill
  buttons, `#splitGuestsDialog`, `widgets/split-guests-dialog.ts` (its `SplitGuestsDetail` type moves to
  `widgets/guest-count.ts` first), `splitPanelLive`, `billId` in `SplitTableDetail` and `SplitRefusal`, and
  the words `table.split_table_bill_heading`, `table.split_no_bill`, `table.split_guests_title`. The
  table step `table.split_table_heading` and `table.split_guests_confirm` "Split" stay.

  **`split-table-open`, `prompt` and `#splitTablePrompts` stay, because their guard stays** (A773 §6;
  finding 15). What they hold changes, because a bill can now be ticked long after the panel opened:
  - The opening composition from `#billComposition([])`: API, session, visit, party, bill on screen,
    party revision. A prompt carried across a bill switch or to a replacement API sends nothing, as today.
  - One observation per selected bill. The screen dispatches `split-table-observe { prompt, billIds }`
    whenever the set of whole bills and loose sources changes, `#tidySplit`'s changes included, and when a
    refusal reopens the panel. It does not fire when the panel closes on send, so a refused count finds its
    observation still there. A bill's edit state is recorded as it joins the set, and a bill already recorded
    keeps its record. A bill leaving the set is dropped, so a bill that changed before it was ticked, or an
    unrelated bill, refuses nothing. A bill with no edit state when ticked is recorded as missing, and a later
    read does not turn that into permission. A selected bill someone else's order reaches stays in the set
    (D21), so its record stays.
  - The record reads `sync.expectedEditFor` behind the `#draftReady` and party checks, with no banner. The
    comparison at Send uses `#billChoiceMatches` (`till-app.ts:17251`). Neither uses `#billChoiceEdit` or
    `#billChoiceCurrent`, which set `errorKey` when the state is missing (`:17228-17249`).
  - At Send the app compares the selected bills only. One missing or moved sends no request and goes through
    D16's `table.split_changed` row, with the panel reopened.
  - A refused count keeps the observation, so a change made while the waiter corrects the count is still
    refused (`till-app-parties.test.ts:12078`). Every other refusal retakes the composition and clears the
    observations after its re-read, and the reopened panel's `split-table-observe` records new ones, because
    the waiter is now looking at the new state and must be able to retry.
  - A take-over from the panel replaces that bill's record with what its read shows, because the waiter
    has just acted on that state (D18, Task 12e).
  - Worked example: Clint ticks Bill 2 whole while its unsent order is his own. His other device saves more
    dishes to it. The till's next read picks that up; Clint presses Split; the till says "Bill 2 changed
    while you were choosing", with no request sent, and his ticks are still there. He checks the row and
    presses Split again.
  - A `split-table` event with no `prompt` composes at Send, as today; only tests send one.

- **D21 A selected bill never leaves the selection silently** (A773 §6, "a new outbox/editor since the
  prompt refuses" and "The actor explicitly takes those bills one by one, then reviews and retries the move",
  `2026-10-17-a773-one-editor-design.md:216-221`; finding 16). A read can change a selected bill, whole or a
  loose source, in three ways. `tidySplit` tells them apart and D20's comparison is the second layer behind it.

  **1. Someone else's unsent order arrives on it** (`SplitSource.held` is set), which includes this person's
  own order being taken over by someone else.
  - **It stays selected.** The bill stays in `whole`, or its picks stay as they are. Nothing is dropped.
  - **What the waiter sees, at once, with no press:** the tick stays, checked or indeterminate; the bill's rows
    give way to the take-over row, `{bill} · {name} has an unsent order` with **Take over draft** (or
    `table.draft_taken_by`'s words); `table.split_taken` at the foot, in `[data-split-refusal]`, announced,
    naming every such bill, the leaving table and the staying tables; and Split is held, drawn `secondary` and
    disabled. If the everything-ticked question was showing, the panel goes back to the action row.
  - **Take over draft** opens the existing dialog, which says what taking over does and names the person. On
    Take over, `takeOverOn` runs, then its read. The bill keeps its tick and picks, its rows return, its record
    is replaced (D20), and once no selected bill is held the sentence goes and Split is primary again. The
    waiter reviews and presses Split, and the request carries the new state. Cancel changes nothing. A refused
    take-over says so at the foot and the bill stays held.
  - **Unticking the bill** clears it from the selection, picks included: it stays at the staying table and the
    other person's order is untouched. Its tick then cannot be set again until the order is taken over or goes
    (`table.split_take_over_first`). Split comes back the same way. This is the only thing that tick does on a
    held bill.
  - **Back** asks, as it does with any ticks. Nothing has been sent.
  - **Doing nothing** is safe. If a later read shows the order gone, sent or discarded, the bill's rows return
    with its tick and picks, and Split comes back. Its edit state has moved, so D20's comparison stops the first
    press with `table.split_changed` and sends nothing; the waiter checks the row and the next press sends.
  - **What Send does: there is no Send.** While any selected bill is held, Split's handler returns before
    anything is dispatched, even for a `.click()` on the button's host, which a disabled `wt-button` still
    receives (`design-system.md:2888`). Enter from a stepper does nothing, because `submitOnEnter` skips a
    disabled button (`packages/ui-core/src/submit-on-enter.ts:35`). A `split-table` event carrying an old
    `prompt` meets D20's comparison and sends nothing. A request already on its way when the order arrived is
    refused by the server (`draft.out_of_date`, D16), and its re-read brings the panel to this same state.
  - **Forms.** Split is held by the state of a row the waiter chose, A427's rule for a button its row's own state
    rules out (`design-system.md:2909-2912`), not by a refusal, so "a request refusal never disables the action"
    stands: if the read after a refusal fails, no bill shows held and Split stays enabled. The sentence shows
    before any press because a disabled button with no reason is a dead end, and it reports what someone else
    did, not a mistake in the form. `wt-delete-dialog` does the same when it lists what refuses a delete
    (`:5455-5458`). Task 15 writes it into Forms.
  - **Refusal rule** (root `CLAUDE.md` §3). The sentence says what happened and what each choice does. Nobody is
    sent to anybody else: taking over needs `take-orders` (`till-api.ts:3689`), which the split itself needs
    (`:3140`).

  **2. It is gone**: the read no longer lists it, because it was paid, moved, merged or abandoned. Nothing can
  be chosen about a bill that is not there, so it leaves the selection, and `tidySplit` names it in `gone`. The
  next press sends nothing and says `table.split_bill_gone`, naming it. The press after sends what is ticked. Two
  gone bills take two presses, one sentence each.

  **3. A pick is lost**: the read paid or removed a picked dish, or presented the bill, and the bill is still
  there. The pick goes, as in 4a, its row shows why, and `tidySplit` names the bill in `changed`. If that was its
  last pick the bill's tick goes to none. The next press sends nothing and says `table.split_changed`. The press
  after sends what is ticked.

  A read that changes none of these adds no stop. A whole bill that is presented, or part-paid, stays whole and
  adds none. An unselected bill gaining an order gets its take-over row and adds none.

## Departures from the master plan

| Master plan says | Here | Why |
| --- | --- | --- |
| Portion ids on the wire | Line ids | 4a's D2: a bound line and its portion are one-to-one |
| `allSelected` flag and `guests` | no flag; `guestCounts` | D10 |
| `A803 selection` in `portion-selection.test.ts` and `portion-picker.test.ts` | New whole-bill cases in `split-selection.test.ts` and `split-picker.test.ts` under the same title | D12, D13: the whole-bill model has its own file |
| `A803 race replay` with promise barriers | The pattern 4b settled on: `waiting-course-copy.test.ts:1787` (`Promise.allSettled`, the asked-first order pinned) | 4b's Build record: the write lock takes them in turn, and the case that a barrier adds is covered by the order assertion |
| Refusal closes the panel (4a D9) | Panel reopens with picks | D16 |
| Board 10 shows a bill someone else holds with no tick | The same, unless it was ticked when that happened: then the tick stays and Split is held | D21 |

## Current code map (main `4259a040d2`)

| Boundary | Where |
| --- | --- |
| Split a table | `apps/server/src/table-actions.ts`: `SplitGuestCounts` `:274`, `splitTable` `:286-367`, `refuseUnsplittableBill` `:373`, `ensureFamilyBill` `:400`, `shownBillIds` `:417` |
| 4a core | `bill-actions.ts`: `reservedRefusal` `:74`, `refuseClosedBill` `:92`, `guardPathParty` `:123`, `resolveMoveLines` `:323`, `moveDishes` `:365-424` (move part `:415-422`) |
| 4b core | `order-groups.ts`: `copyHeldGroups`, `groupArrivingDishes`, `printHoldTickets`; `move-bill.ts`: `leaveParty` `:516-557`, `takeIntoParty` `:488`, `moveBillOnce` `:167` |
| Lines | `working-order.ts`: `moveOrderLines` `:4125`, `carveOffLines` `:4659`, `carveLines` `:4670`, `readTabLines` `:4324`, `assertTabOpen` `:4252`, `bumpRevision` `:5704` |
| MOVED | `moved-slips.ts`; `kitchen-print.ts`: `readSentWork` `:1473`, `readSentItems` `:1484`, `enqueueMovedSlips` `:1572`, `lostAPlace`, `notifyMoved` `:1682`, `movedItems`, `readPartiesSentWork` `:1858`, `enqueueMovedSlipsFor` `:1914` |
| Editors | `bill-editing.ts`: `requireBillEditors` `:132`, `requireRelocatableBillEditors` `:145`, `readExpectedBillEdits` `:223`, `editorConflict` `:237`, `transferBillEditor` `:59`; `order-drafts.ts`: `takeOverDraft` `:707` |
| Numbers | `packages/venue-service/src/bill-identities.ts:10`; `working-order.ts:1736`; `parties.ts:155` `insertPartyBill` |
| Allergies | `packages/module/src/module.ts:1356`; `packages/venue-service/src/party-allergy.ts:340`, `copyGuestsAndBillTicks` `:355`; `service.ts:10`, `:157` |
| Routes | `till-api.ts`: `requireSplitGuestCounts` `:826`, `requireOtherBill` `:970`, `requireLineIds` `:979`, `movingRooms` `:1225`, split `:3138-3180`, drafts read `:3576`, lines read `:3969`, split-bill `:4145-4177`, move-dishes `:4182-4220`, status map `:599-629` |
| Till client | `api/client.ts`: `Draft` `:808`, `BillEditState` `:834`, `BillBalance` `:1216`, `PartyBill` `:2160`, `listDrafts` `:3961`, `takeOverDraft` `:4055`, `getTabLines` `:4283`, `getBillBalance` `:4428`, `splitTable` `:4704-4723` |
| Model and picker | `state/portion-selection.ts` (`pickGroups` `:60`, `pickRows` `:138`, `setCount` `:148`, `toggleRow` `:157`, `tidyPicks` `:170`, `pickedLineIds` `:198`); `widgets/portion-picker.ts` |
| Screen | `screens/till-table-order-screen.ts`: `ActionDraft` `:244`, `SplitTableDetail` `:263`, `SplitRefusal` `:272`, `DishSources` `:295`, `fallbackPortionKeys` `:314`, `ActionStep` `:444`, `splitTableId` `:1287`, `splitGuests` `:1295`, `#watchActions` `:1337`, refusal restore `:2005`, `#closeActions` `:4784`, `#chooseVerb` `:4798`, `#prepareRelocation` `:4810`, `#splitTableStep` `:4960-5021`, `#splitTable` `:5023`, `#splitGuestsDialog` `:5037`, `#actionBackNow` `:5101`, ⋮ item `:5239`, `#moveDishesStep` `:5476`, `.action-panel` CSS `:618` (22rem wide) |
| App | `till-app.ts`: `TABLE_REFUSALS` `:615`, `BILL_MONEY_REFUSALS` `:660`, `billWriteError` `:683`, `tableWriteError` `:748`, `errorText` `:1478`, `.error-part` CSS `:1854`, `#onSplitTableOpen` `:15591`, `#onSwitchBill` `:17137`, `#onRefundExcess` `:17830`, screen bindings `:19121`, `:19264`, `refusedSplitSide` `:731`, `#ownBillsChange` `:11664`, `#refreshBillDraft` `:11688`, `#onTakeOverDraft` `:11863`, `#loadPartyBills` `:11948`, `#onTableRefusal` `:12124`, `#reloadTables` `:15041`, `#splitTablePrompts` `:15589`, `#onSplitTable` `:15598-15677`, `#onBillPairRefusal` `:15793`, `#billComposition` `:15868`, `#askDifferentPeople` `:15931`, `#onMoveDishes` `:15973`, `#refusedDestination` `:16003`, floor element `:19050`, bindings `:19630-19631` |
| Floor | `screens/till-floor-screen.ts`: `tablesReadAt` `:905`, `#carried` `:994`, `#revision` `:1378`, join `:1650-1669`, `#carry` `:1840`; `state/floor-today.ts:52` `nextFloorMoment` |
| Words | `i18n/strings.ts` (EN from `:1116`, ES from `:2979`), `i18n/codes.ts:350`, `:450`, `:482` |
| Guides | `apps/server/src/guide/{en,es}/table-service.md` (⋮ list EN `:247-255`, `#move-dishes` EN `:289`, `#held-dishes-move` EN `:328`, ES `:344`, numbers EN `:345-346`) |
| Test homes | `party-table-actions.test.ts` (`split a table` `:1242`, helpers `tables`, `joinFree`, `cmd`, `noticesOn`), `testing/table-action-fixture.ts:78`, `move-merge.test.ts`, `today-names.test.ts`, `waiting-course-copy.test.ts` (setup `:68-112`, race helper `:1787`), `till-app-parties.test.ts`, `till-app-table-service.test.ts`, `screens/till-table-order-screen.test.ts`, `.actions-unsaved.test.ts`, `.table-menu.test.ts`, `.a11y.test.ts`, `apps/till/test/answered-party-allergy.ts` |

## Changed test checks

The owner's rule (2026-10-05): an assertion may change only where it pins behaviour this slice
deliberately changes, and then to check the new behaviour at least as strictly. A red case in any
other existing file is a stop: record it, do not edit it, and ask in the ledger. A fixture learning a
new shape is not an edit.

**Behaviour, spec §3.7 ("a MOVED notice for the dishes that changed table only"). All ten ran red in
R1, which told only the leaving bill.** Seven change. Rows 6, 7 and 10 pin A650's ruling 1, on a name
gone from kitchen paper, and stay unedited on Question 3's default: under D6's rule they stayed green
and the other seven went red (R9). Row 5's title cites A650's row 8; A650 ruling 1 said "Split a table
prints" that slip, and spec §3.7, four days later, ended it.

| # | Check | Pins today | Pins after | Task |
| --- | --- | --- | --- | --- |
| 1 | `party-table-actions.test.ts:1492-1508` | PAELLA on the staying bill gets `moved_to: "AvisoS 4"`, BURG `"AvisoS 5"` | `toEqual` of exactly `[...earlier, BURG]`, title changed to "… and nothing of the dishes that stayed" | 4 |
| 2 | `party-table-actions.test.ts:962-982` | The family's paid bill's BURG gets `moved_to: "PagoS 7"` | `noticesOn([ana.tabId])` equals `earlier`; the paid bill's row, lines and payments still equal | 4 |
| 3 | `move-merge.test.ts:411-439` | BURG, FLAN, TINTO notices; three slips | BURG only; one slip `De: Mesa 4, 5 / A: Mesa 5` | 4 |
| 4 | `move-merge.test.ts:441-452` | An empty table leaving gives BURG a notice | `noticesOf([tabId])` is `[]` | 4 |
| 5 | `move-merge.test.ts:774-790` | A650's row 8: two slips, `De: Mesa 51, 52 / A: Mesa 51` | no slip printed; title names spec §3.7 in place of "(row 8)" | 4 |
| 6 | `today-names.test.ts:468-480` | Named group, no bill: one slip, group name → own name | **unedited**; under Question 3's (A), no slip | not changed |
| 7 | `today-names.test.ts:482-497` | Named group with a bill: two slips | **unedited**; under (A), one slip, group name → Patio | not changed |
| 8 | `today-names.test.ts:499-508` | Unnamed, no bill: one slip to Counter 6 | no slip | 4 |
| 9 | `today-names.test.ts:510-524` | Unnamed with a bill: two slips | one slip to Table 9 | 4 |
| 10 | `today-names.test.ts:751-763` | Delivered counter order at Table 9: one slip | **unedited**; under (A), no slip | not changed |

**Wire shape only, spec §3.7's new request; no behaviour assertion weakens.**

| # | Check | Change | Task |
| --- | --- | --- | --- |
| 11 | `till-api.table-actions.test.ts:167` | answer keys gain `billIds`, then lose `billId` | 5, 14b |
| 12 | `till-api.table-actions.test.ts:523-556` | "a malformed or missing bill": a malformed bill id goes from 409 `tab.not_open` (`requireOtherBill`, pinned at `:554`) to 400 `management.request_invalid { field: "selection" }`, and a missing one from `field: "billId"` to `field: "selection"` | 14b |
| 13 | Bodies of 44 `split-table` posts in 11 server test files (`rg -c 'split-table' apps/server/src -g '*.test.ts'`) | `billId: x` → `selection: oneBill(x)` from `testing/table-action-fixture.ts` | 14b |
| 14 | `till-api.zone-closed.test.ts` (its split case) | `billId` → `billIds[0]` | 14b |
| 15 | `bill-editing.bill-moves.test.ts:297-300`, its direct `splitTable` import | passes `oneBill(from.billId)` | 2 |
| 16 | `packages/venue-service/src/party-allergy.test.ts:406`, `:563` | `id` → `[id]`, `null` → `[]` | 1 |
| 17 | `apps/till/src/api/client.test.ts:3078-3135`, `:5913-5918`; `client.bill-editing.test.ts:103-112` | body and answer | 5 |
| 18a | `till-app-parties.test.ts`, `api.splitTable` called with, at `:2303`, `:2315`, `:2347`, `:2374`, `:11808`, `:12019`, `:12068` | the bill argument becomes a selection (`oneBill(x)`, or an empty selection for null) | 5 |
| 18b | `till-app-parties.test.ts` (19 `split-table` emits, stub `:321`), `till-app-table-service.test.ts` (4 emits; stub `:293`; row `:1147`) | detail `{ tableId, selection, guestCounts }`; the old `billId` shape keeps working until then. `:2382` is not here: row 24 moves it | 14a |
| 19 | `screens/till-table-order-screen.a11y.test.ts:945-952` | scans the new panel, with a part-paid bill, a take-over row and a whole bill | 11a |
| 20 | `.table-menu.test.ts:584-600` | the second step is the picker; Escape returns to the tables | 11a |
| 21 | `.actions-unsaved.test.ts:211-240` | ticks and counts are protected; Split submits with no question | 11b |
| 22 | `till-app-parties.test.ts:11914-12123`, ten cases | moved, under their titles: "Moved till-app cases" | 12c |
| 23 | `till-app-parties.test.ts:1902-1909`, the Split a table row of `:1910` | moved: "Moved till-app cases" | 12d, removed 14a |
| 24 | `till-app-parties.test.ts:2359-2427` | moved: "Moved till-app cases" | 12d, removed 14a |
| 25 | `till-app-parties.test.ts:2429-2448` "says a refusal naming no field of the window on the banner" | **Behaviour, Forms contract:** the sentence is at the panel's bottom with the panel reopened, and there is no banner. Moved: "Moved till-app cases" | 12d, removed 14a |
| 26 | `till-app-parties.test.ts:2450-2504`, two cases | moved, with the panel in place of the window: "Moved till-app cases" | 12d, removed 14a |
| 27 | `till-app-parties.test.ts:11835-11855` "refreshes bill editing metadata after refusal" | **Behaviour, Forms contract:** on `refusal` the party holds two tables, so `banner` becomes `[data-split-refusal]` holding `table.split_changed` naming the bill, and `banner` is null. The request count and the reads moving stay asserted | 14a |
| 28 | `till-app-parties.test.ts:2540`, `:2542` "shows %s in its own words" | detail shape only (as 18b). The banner assertion is unchanged: their party holds one table (`:110`), so there is no panel to reopen. `:2541` likewise, the table not being held. Their two-table twins, at the foot, are new in Task 12d | 14a |
| 29 | `till-app-parties.test.ts:11820-11834` "refuses to move a bill whose editing observation is missing" | detail shape only (as 18b). The banner assertion is unchanged: no `prompt`, so it composes at Send as today (D20) | 14a |

`testing/table-action-fixture.ts`'s `splitTable` accepts `billId | null | SplitSelection`. It answers
`{ partyId, billId: billIds[0] }`, and adds `billIds` only for a selection, because 7 existing cases pin the
old shape. So the other test files that call it through the fixture (`rg -n 'splitTable\('
apps/server/src -g '*.test.ts'`) need no edit. `observedTableActionBody` reads `selection` as well. A
fixture, not an assertion.

### Moved till-app cases

Each old case drives the window or the bill buttons, so it cannot stay. Each new case goes in
`src/till-app-split-table.test.ts` under the title given, drives the panel through its real controls (except
where the row says otherwise), and is at least as strict. The old case goes when its new home exists, confirmed by name. Row 22's go in Task
12c, because that is the commit that makes the panel live; the others keep passing on the old window
until Task 14a removes it.

| Old case, `till-app-parties.test.ts` | Title in its new home | Pins | Task |
| --- | --- | --- | --- |
| `:11943` × 3 "refuses a refreshed owner / draft / revision while the guests prompt stays open" | "refuses a refreshed owner / draft / revision on a ticked bill while the panel stays open" | no request; `table.split_changed` at the bottom; the panel the same element; no save and no take-over. These fixtures change `billEdits` alone, as the old ones do, so no bill shows held. Task 12f's case changes `drafts` as well | 12c |
| `:11980` "keeps missing metadata at prompt opening from becoming permission after refresh" | "keeps a bill with no edit state when ticked from becoming permission after refresh" | no request; the sentence | 12c |
| `:12002` × 2 "allows %s when only an unrelated bill changed" | same title, for a whole bill and for nothing ticked | exactly one request, with exactly the ticked bill's edit | 12c |
| `:12031` "refuses a guests prompt carried across a bill switch" | "refuses a panel carried across a bill switch" | no request. **Dispatched, not pressed:** a bill switch closes the panel (`till-table-order-screen.ts:1960`), so no control is left. The case captures `prompt` from `split-table-open`, switches bill and dispatches `split-table` with it, the one path that still reaches the guard (R14) | 12c |
| `:12042` "allows a new prompt after cancelling and refreshing its bill" | "allows a new panel after Back and a refreshed bill" | one request with the new state | 12c |
| `:12078` "retains the original observation when a refused guest count is corrected" | same title | second press sends nothing; `table.split_changed` | 12c |
| `:12111` "does not send an old guests prompt to a replacement API" | "does not send an old panel to a replacement API" | neither API called | 12c |
| `:1910`, its Split a table row, "does not reopen the $window window a refusal opened when a handheld comes back" | "does not reopen the panel a refusal opened when a handheld comes back to its order card" | panel absent after coming back | 12d |
| `:2359` × 2 "hands %s back to Split a table's guests window, beside the field, without a banner" | "hands %s back to the panel, beside the field, without a banner" | `splitRefusal` `toEqual`, both counts shown, `form.fix_fields` at the bottom, `banner` null | 12d |
| `:2397` "hands the refusal to the order card on a handheld" | same title | the stepper's refusal text | 12d |
| `:2429` "says a refusal naming no field of the window on the banner" | "says a refusal naming no field at the bottom of the panel" | **reversed (row 25):** message set, panel open, `banner` null | 12d |
| `:2450` "drops a refusal that arrives after the waiter has opened another party's table" | same title | panel absent, no refusal, no banner, on the other party | 12d |
| `:2482` "does not hand a refused split to the next table opened" | same title | no refusal on the next table | 12d |

### Deleted checks (Question 2)

`widgets/split-guests-dialog.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, and the old step's screen
cases. New homes are `till-table-order-screen.split-table.test.ts` ("S"),
`.split-table.unsaved.test.ts` ("U") and `split-picker.a11y.test.ts` ("A").

| Old check | Goes to |
| --- | --- |
| `.test.ts:50` names its heading and action in %s | S: heading and Split in EN and ES |
| `:66` labels each field with its tables, staying first, prefilled | S |
| `:83` puts the cursor in the staying field | **Gone.** The panel's heading takes focus (`design-system.md:1090`), pinned by `.table-menu.test.ts:584` |
| `:90` offers Split at once in its own colour | S |
| `:102` sends both counts as numbers, blanks as null | S |
| `:120` refuses 0, 1000, 2.5, abc beside the field and at the bottom | S, the same four values |
| `:149` marks both fields | S |
| `:163` refuses a bad count sent with Enter | S |
| `:177` splits with Enter from either field | S |
| `:193` sends its events across the shadow boundary | **Gone.** The steppers raise no event of their own past the screen; the screen's `split-table` is what an ancestor hears, pinned in S |
| `:213` a refusal under the field, Split enabled, clears on change | S |
| `:238` clears a refusal when Split is pressed again | S |
| `:249` reports Cancel without counts | S: Back sends nothing |
| `.a11y.test.ts:18`, `:31` no violations, opening and refused | A and `.a11y.test.ts:945` (row 19), both themes |
| `.unsaved.test.ts:83` opening and closing untouched asks nothing | U |
| `:93` Back or Escape keeps a typed count, then discards | U |
| `:116` counts typed back, however spelled, close quietly | U |
| `:130` an invalid count stays protected | U |
| `:146` splitting commits with no question | U |
| `:159` disconnect aborts a leave decision; reconnect keeps the baseline | U, with ticks and a typed count. `.actions-unsaved.test.ts:254` covers Move dishes' ticks only |
| `:178` retained departed controls cannot split | U: a departed Split, Back, tick or stepper changes nothing. `.actions-unsaved.test.ts:304`, `:331`, `:410` cover Move dishes only |
| `:197` a parent rerender keeps counts and the warning | U |
| `:212`, `:230` a stored count moves an untouched side, not a typed one | U |
| `:242`, `:251`, `:260` the same across take-out and put-back | U, with the same titles on the panel: the screen taken out and put back, and separately reopened by a refusal |
| `till-table-order-screen.test.ts:4962` Split a table picks a table, then a bill or none | S |
| `:5130` names a table renamed for today | S |
| `:5158` Back returns to the tables | S |
| `:5198`, `:5216`, `:5230`, `:5258`, `:5277`, `:5309`, `:5332` guests window cases | S and U, as above |
| `:5365`, `:5381`, `:5394` the window closes for a table or party gone | S |
| `.table-menu.test.ts:690` focus back to the ⋮ after the guests window | S: after Split and after Back |

## Guard suites

Each command separately, each exit status checked, a nonzero **Tests** count read (CLAUDE.md §2, §4).

- **H2 (unedited):** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Baseline 20 tests.
- **F and Filing (unedited):** `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts src/move-merge.filing.test.ts src/order-portions.filing.test.ts src/transfer-lines.filing.test.ts`. Baseline 340 tests.
- **The move sweep:** in `apps/server`, `MOVES=( $(rg -l 'moveBill\(|splitTable\(|/move"|split-table' src --glob '*.test.ts' | sort) )` (zsh: an array), then `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run "${MOVES[@]}"`. Baseline 48 files, 2,965 tests, 191 seconds.
- **Allergies:** `pnpm --filter @waitron/venue-service exec vitest run src/party-allergy.test.ts src/service.test.ts`. `party-allergy.test.ts` baseline 68 tests.
- **G (guides):** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`; `pnpm exec vitest run scripts/guide-links.test.ts`.
- **Words and codes:** `pnpm exec vitest run scripts/english-only.test.ts scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts scripts/native-form-fields.test.ts`.
- **Types and format:** `pnpm --filter @waitron/server typecheck`; `pnpm --filter @waitron/till typecheck`; `pnpm --filter @waitron/module typecheck`; `pnpm --filter @waitron/venue-service typecheck`; `pnpm format:check`.
- **Schema: not needed.** At each task's end,
  `git diff 4259a040d2 -- packages/db/src/schema packages/db/drizzle packages/venue-service/src/schema packages/venue-service/drizzle packages/fiscal-verifactu scripts/ apps/server/src/split-bill.fiscal.test.ts apps/server/src/till-api.fiscal-sale-paths.test.ts apps/server/src/transactional-series.test.ts apps/server/src/bill-payments.test.ts apps/server/src/bill-payments.card.test.ts apps/server/src/move-merge.filing.test.ts apps/server/src/order-portions.filing.test.ts apps/server/src/transfer-lines.filing.test.ts`
  prints nothing. A rebase moves the base in that command; the base is the branch's merge base.

A browser run checks free memory first (`memory_pressure | grep free`): beside another session only
well above 15% free. Stop only processes you started.

---

## Task 0: preflight (no commit; about 15 calls)

- [ ] `git fetch`, then `git log --oneline 4259a040d2..origin/main -- apps/server/src/table-actions.ts apps/server/src/bill-actions.ts apps/server/src/bill-editing.ts apps/server/src/till-api.ts apps/till/src/till-app.ts apps/till/src/screens/till-table-order-screen.ts apps/till/src/screens/till-floor-screen.ts apps/till/src/state apps/till/src/widgets/portion-picker.ts packages/venue-service/src/party-allergy.ts packages/module/src/module.ts`. If anything landed, rebase and re-read what this plan cites.
- [ ] Overlap check over `git worktree list` and the lanes' queues (`~/waitron-campaign*/queue.md`), for every branch; overlap is a reason to rebase often, not to wait. Record it in the ledger. R7 covered only the first 40 local branches.
- [ ] Post Questions 1 to 3 to `~/waitron-campaign-c/questions.md` (one-at-a-time format, worked examples as above).
- [ ] Ledger `docs/handoffs/2026-11-04-a803-4c-split-table-picker.md` (`Status: in progress`).

## Task 1: allergies follow any number of bills (about 30 calls)

**Files.** `packages/module/src/module.ts:1356`, `packages/venue-service/src/party-allergy.ts:340-400`, `apps/server/src/table-actions.ts:335`, `packages/venue-service/src/party-allergy.test.ts`.

- [ ] **Failing test.** `party-allergy.test.ts`, "A803 split: guests are copied once and the ticks of every listed bill move to the copies": a party answered "allergies", guest G with ticks on a dish of Bill 1, Bill 2 and Bill 3 and on an open draft line of Bill 2; `splitPartyAllergies(t, from, into, [bill1, bill2], actor)`. Asserts one guest row at `into` per source guest, the three listed ticks on the copy, Bill 3's on G.
- [ ] Add "A803 split: no answer at the source copies nothing, whatever bills are named" (with `[bill1]`), the case the master plan's "unknown/not-asked" asks for.
- [ ] **RED.** `pnpm --filter @waitron/venue-service exec vitest run src/party-allergy.test.ts -t 'A803 split'`. Vitest does not check types, so the array reaches today's `eq(workingOrderId, billId)`: the case must fail on a tick not moved, or on the bound value. An import or setup error is a stop.
- [ ] **Implement.** `billIds: readonly string[]` in the interface and the function; `copyGuestsAndBillTicks` takes the list (`inArray`), and `moveBillAllergies` passes `[billId]`; empty list copies guests and moves no ticks, as `null` does today. `table-actions.ts:335` passes `billId === null ? [] : [billId]`. Row 16.
- [ ] **GREEN.** The allergies suite; `apps/server` `src/party-allergy.moves.test.ts`, `src/kitchen-allergy.lifecycle.test.ts`; types for module, venue-service, server.
- [ ] **Deletion control.** The `inArray` narrowed to the first id → the first case red, naming Bill 2's tick. Restore.
- [ ] **Commit.** `git commit -s -m "A803 4c: a split's allergy copy follows any number of bills"`.

## Task 2: several whole bills leave together (about 70 calls)

**Files.** `apps/server/src/table-actions.ts`, `apps/server/src/till-api.ts` (a temporary mapping), `apps/server/src/testing/table-action-fixture.ts`, `apps/server/src/bill-editing.bill-moves.test.ts` (row 15), `apps/server/src/party-table-actions.test.ts`.

The new signature (D1) with `loose` required to be empty until Task 3b (`management.request_invalid` for now). `requireRelocatableBillEditors` over the whole ids until Task 3a. MOVED reach unchanged until Task 4. The route (`till-api.ts:3164`) is `splitTable`'s only production caller, so it changes here: it still parses `billId` with `requireOtherBill`, maps it to a selection (`billId` to one whole bill, `null` to an empty one) and answers `{ partyId, billId: billIds[0] }`, keeping the answer's keys that `till-api.table-actions.test.ts:167` pins. Task 5's parser removes this mapping, and Task 5's RED therefore still reads `field: "billId"`.

- [ ] **Failing tests**, `describe("A803 split")` in `party-table-actions.test.ts` (full rows compared):
  1. "… two of three whole bills leave together; the third stays": `billIds` is `[b2, b3]` in number order, both at the new party with numbers 1 and 2, `b1` keeps 1 at the staying party, one new party, table on it, revision moved by one.
  2. "… any bill can stay and any can go, the first included".
  3. "… nothing selected: the leaving table starts with an empty bill, and staying bills are untouched" (`[]`).
  4. "… everything selected: the staying party gets one empty bill" (`ensureFamilyBill`) and "… a staying party keeping only a paid bill gets none", with its reason in the title (D12's "does not count" follows the server here).
  5. "… sets both guest counts in the one command".
  6. "… two whole bills sharing a held group get one copy, with both dishes": the group count at the new party, one `lines_moved` pair, and firing the copy fires both (finding 3).
  7. "… two whole bills with fired dishes make one fired group each, in number order" (D5).
  7b. "… two whole bills each holding a dish on hold outside a group arrive with one held group each" (D5's limit, added with `addTabRound` and `hold: true`, `move-merge.test.ts:356`, so a change to it is a decision).
  8. "… two whole bills with held dishes move each bill's own open draft with its own expected edit".
  9. "… a whole part-paid bill goes with its payments": `bill_payments` rows and `paidLines` unchanged, balance answers the same; no invoice.
  10. "… the answer and allergy guests are copied once across both" (`splitPartyAllergies` through the command).
  11. The master plan's "A666 seats before a floor join and A757 highest joined-table state remain intact": "… a split of a joined table leaves the seats and the highest state as a one-bill split does", compared against a twin split with one bill.
  12. Refusals, `refused(...)` snapshot before and after (`:235-245`): a whole id twice, paid (`bill.paid`), abandoned, other party's (`bill.other_party`), with every row unchanged.
  13. "… allergies are copied before the bills arrive: a bill with a dish that fires on arrival arrives without `allergy.unanswered`". The party answered; a dish with no waiting course on the leaving bill, built with the test-only `addTabRound` and **`{ menuItemId, quantity: "1", hold: true }`**. The `hold: true` is what makes this case able to fail: arrival firing reaches `assertPartyAllergyAnswered` (`working-order.ts:2144`) only for a dish that arrives `immediate` (`order-groups.ts:2806-2816`), and a round added without it is already fired, so it arrives `released` and never asks (R12).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts -t 'A803 split'`: a case handing a selection to today's fixture fails with `Unknown named parameter 'wholeBillIds'` (R10: `node:sqlite`, reached because an object goes where a bill id goes). A case that uses no selection fails on its own assertion. Anything else is a stop.
- [ ] **Implement.** D2 steps 1, 2, 4 (whole), 5, 7, 8, 10, 11, 12, 13, 14 with the existing reach, and the route's mapping above. Fixture as "Changed test checks" describes. Comment: replace `splitTable`'s doc comment (`:279-285`) with one that states the new contract, and no history.
- [ ] **GREEN.** The file unfiltered; the move sweep; server types.
- [ ] **Deletion controls.** `copyHeldGroups` per bill → case 6 red, "2 to be 1". `expectedEdits[0]` instead of a find → case 8 red. `ensureFamilyBill` removed → case 4 red. Number-order sort removed, seeded so ids sort against numbers → case 1 red. Allergy copy after arrival instead of before → case 13 red, `allergy.unanswered`.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table takes any number of whole bills"`.

## Task 3a: who must own what (about 35 calls)

**Files.** `apps/server/src/bill-editing.ts`, `apps/server/src/table-actions.ts`, `apps/server/src/bill-editing.bill-moves.test.ts`.

- [ ] **Failing tests**, `describe("A803 split: editors")` in `bill-editing.bill-moves.test.ts`, calling `requireSplitEditors` in a transaction:
  1. A sole foreign editor on a whole bill passes (A773 §6; the existing case at `:280` stays green unedited).
  2. Two different editors on whole bills: `draft.taken_over` with `conflicts` both, sorted by id.
  3. A foreign editor on a loose source: refused, whatever the whole bills hold.
  4. A loose source of Ana and a whole bill of Luis: one refusal with both in `conflicts`.
  5. The actor's own draft on either: passes.
  6. A staying bill with a foreign editor is not in the set and refuses nothing.
  7. `expected` missing one id or holding an extra: `management.request_invalid { field: "expectedEdits" }` (`readExpectedBillEdits`). Unsorted: `management.request_invalid { field: "expectedEdits.1.billId" }` (`parseBillEditExpecteds`).
  8. A changed editor version: `draft.out_of_date`, conflicts checked first as `requireRelocatableBillEditors` does.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/bill-editing.bill-moves.test.ts -t 'A803 split: editors'`: `requireSplitEditors is not a function`.
- [ ] **Implement.** D4. `splitTable` calls it in place of `requireRelocatableBillEditors`.
- [ ] **GREEN.** The file; `src/bill-editing.table-actions.test.ts`; types.
- [ ] **Deletion control.** Treat a loose source as relocatable → case 3 red ("resolved"). Sort removed → case 2 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: a split checks whole bills by relocation and loose bills by ownership"`.

## Task 3b: loose dishes go on one new bill (about 60 calls)

**Files.** `apps/server/src/bill-actions.ts`, `apps/server/src/table-actions.ts`, `apps/server/src/party-table-actions.test.ts`.

- [ ] **Failing tests**, `describe("A803 split")`:
  1. "… loose dishes from a staying bill and whole bills leave together": two of three whole plus two dishes off the third: `billIds` is the whole bills then the new bill, numbered 1, 2, 3; the dishes moved keep their line ids, tickets, served state and extras; the source keeps the rest.
  2. "… dishes picked from two bills go on one new bill": both sources shortened, one new bill.
  3. "… a loose pick burns no number at the staying table": the next bill at the staying party takes the next number with no gap (finding 1's measurement, now pinned).
  4. "… a whole part-paid bill stays selectable, and its unpaid dishes can go loose": paid dish on the source; moving it refuses `bill.line_paid`, every row unchanged.
  5. "… contributions: a loose pick leaving €40.00 of €52 received €40 goes; leaving €39.99 refuses `bill.received_exceeds_total`" (exact, spec §6).
  6. "… a held dish loose: the new table gets its own held copy; the staying dish stays held in the source group", then each fires alone (4b's rule through a loose pick).
  7. "… a dish recalled into a draft refuses `draft.out_of_date`, naming the source".
  8. "… a presented source refuses `bill.presented`; the same bill whole goes".
  9. "… a dish the kitchen holds outside a held group refuses `tab.split_held_line`" (4a's rule, `carveLines`).
  10. "… a pending payment on a loose source refuses `order.payment_in_flight`; on a whole bill it goes" (`bumpRevision` against `movedRevision`, `move-bill.ts:481`).
  11. "… over the simplified-invoice limit, the new bill refuses `sale.total_exceeds_simplified_limit`".
  12. "… an allergy tick on a loose dish moves with it; one on a dish that stayed stays".
  13. "… a bill both whole and loose, one bill in two loose entries, an empty entry: `management.request_invalid { field: 'selection' }`"; "… a line named twice: `tab.transfer_duplicate_line`"; "… a line of another bill: `tab.line_not_found`, and no line of the named bill with that number moved" (4a's M3 control).
  14. Full-row rollback of each refusal above: parties, party tables, bills, lines, tickets, groups, group events, drafts, allergy, notices, `print_jobs`, `bill_number_allocations`. Reuse `rowsOf` shaped as `waiting-course-copy.test.ts:802`, with no location.
- [ ] **RED.** `… -t 'A803 split'`: Task 2's `management.request_invalid` for a non-empty `loose`.
- [ ] **Implement.** Export `resolveMoveLines` and `reservedRefusal` (`requireBillOfParty` covers the closed-bill refusals, so `refuseClosedBill` stays private); extract `moveCheckedDishes(tx, cfg, from, to, transfers, { refuseHeld, actorId })` holding `:416-420`'s carve and bump, which `moveDishes` calls; `assertBillInvariant` stays with each caller, because a split runs it after every source has moved. D2 steps 4, 9, 10; step 6's read stays inside `withMovedSlips` until Task 4.
- [ ] **GREEN.** The file; `src/move-dishes.test.ts`, `src/till-api.move-dishes.test.ts` (4a's unchanged, proving the extraction); the move sweep.
- [ ] **Deletion controls.** `insertPartyBill` at the source party → case 3 red with the gap. `refuseHeld: true` → false → case 9 red. `assertBillInvariant` removed → case 5 red. `leaveParty(newBill)` removed → case 6 red (its fired group stays the source's). Allergy after arrival instead of before, with loose dishes selected → Task 2's case 13 and this task's case 12 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: single dishes picked off any bill leave on one new bill"`.

## Task 4: MOVED slips name only the dishes that changed table (about 55 calls)

**Files.** `apps/server/src/table-actions.ts`, `apps/server/src/kitchen-print.ts`, tests per rows 1–5, 8 and 9, `apps/server/src/move-merge.test.ts`, `apps/server/src/waiting-course-copy.test.ts`.

- [ ] Check Question 3's answer in `questions.md`. With no answer, or (B), build D6 as written and leave rows 6, 7 and 10 unedited. Under (A) leave out `enqueueMovedSlipsForNamesGone`, change rows 6, 7 and 10 as their row says, and delete cases 6 to 8 below.
- [ ] **Failing tests**, `describe("A803 split: what the kitchen is told")` in `move-merge.test.ts` (it has `printedBy`, `byDish`, `stationWithPrinter`):
  1. "… a loose dish gets a notice and a slip naming only it, the source's other dishes nothing".
  2. "… a whole bill's dishes are told; a staying bill's are not".
  3. "… two sources give one slip each, each under the order number the dish was sent on".
  4. "… nothing selected tells the kitchen nothing".
  5. "… a loose held dish on HOLD paper prints under HOLD with its copy's number" (decoded print, `GRUPO 2`, in `waiting-course-copy.test.ts`, with 4b's helper), and later firing prints its FIRE ticket with the mark (4b's `T5.3` shape).
  6. "… a staying dish whose paper's every name has gone is told, from that name to what it now reads" (A650 ruling 1).
  7. "… a staying dish with one name of its paper left is not told": a group whose name survives the split, and plain T7 + T8 → T7.
  8. "… a loose source's staying dish is told once when its name has gone, and the dish that left once, on the new bill".
- [ ] Rewrite rows 1–5, 8 and 9. Each stays at least as strict: `toEqual` on the whole list; a "no slip" row asserts `slips` is `[]` **and** that the printer took other jobs earlier in the case (a control that prints nothing because no printer exists would prove nothing). Rows 6, 7 and 10 are not touched.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/move-merge.test.ts -t 'A803 split: what the kitchen is told'`: cases 1, 2, 4 and 7 name the staying dish; 3 under the reach as built in 3b.
- [ ] **Implement.** D6: step 6's one read; step 14's three groups; `enqueueMovedSlipsForNamesGone` in `kitchen-print.ts`, which reads each order's places once as `enqueueMovedSlipsFor` does and reuses `notifyMoved`. `withMovedSlips` stays for the other actions; `splitTable` no longer uses it. Delete its import here if unused.
- [ ] **GREEN.** The move sweep. New red outside rows 1–5, 8 and 9 is a stop: R9 listed exactly these, and rows 6, 7 and 10 must pass unedited.
- [ ] **Deletion controls.** The `{ parties: [partyId] }` reach put back → cases 1, 2, 4 red. Reading a loose source's `before` after the carve → case 1 red (nothing told). Copy after the slips → case 5 red, `GRUPO 3`, as 4b's control 27. `enqueueMovedSlipsForNamesGone` removed → rows 6, 7, 10 and case 6 red. Its test changed to "some name has gone" → case 7 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the kitchen hears only about dishes that changed table, or a name that has gone"`.

## Task 5: the route learns the selection, and issues what a split leaves paid (about 60 calls)

**Files.** `apps/server/src/till-api.ts`, `apps/till/src/api/client.ts`, `apps/till/src/till-app.ts` (mapping only), `apps/till/src/till-app-parties.test.ts` (row 18a), new `apps/server/src/split-table.fiscal.test.ts`, `apps/server/src/till-api.table-actions.test.ts`, rows 11 and 17.

- [ ] **Failing tests.** `till-api.table-actions.test.ts`, `describe("A803 split: the route")`: selection through the route answers `{ partyId, billIds }` with `zoneRevisions` when the room moved; `requireSplitSelection`'s shapes, each `management.request_invalid { field: "selection" }` (not an object; `wholeBillIds` missing; a non-UUID; an entry with no `billId`; upper-case ids answered lower-cased); `billId` still works beside it; each code's HTTP status from `:599-629` for a loose refusal (`tab.line_not_found`, `bill.line_paid`, `bill.received_exceeds_total`, `tab.split_held_line`, `tab.transfer_modifier_line`, `sale.total_exceeds_simplified_limit`, `draft.taken_over` with `conflicts`). Add the same to the profile tables: `till-api.profile-actions.test.ts` and `.profile-zones.test.ts` keep their rows and gain a loose-selection case each (a loose source in a zone the device may not serve refuses `service_zone.not_allowed`; so `checkZones` gets every bill named, not only the party).
- [ ] `split-table.fiscal.test.ts`, `describe("A803 split: issuance")`, with the set-up of `till-api.fiscal-sale-paths.test.ts` copied, not imported, and no location:
  1. A loose pick of the last unpaid dish of an item-paid bill issues its one invoice in the same transaction: one sale, one `registros_facturacion` row, `status` settled, on the staying party.
  2. The new bill holds no sale.
  3. A whole part-paid bill issues nothing, whatever it holds.
  4. A loose pick that leaves the source still owing issues nothing.
  5. A refusal by the trading admission rolls the whole split back: no new party, table still joined.
  6. "two loose sources left paid make two invoices, in bill-number order, the second chained on the first". One party. Bill 1: Caña, Caña, with a €3.00 contribution. Bill 2: Paella, Caña, with a €35.00 contribution. The request picks the last Caña of each and lists **Bill 2 first**, so only the server's order can pass. Both bills `settled`, one sale each; Bill 1's `invoiceNumber` is lower; Bill 2's record's `anterior_num_serie_factura` and `anterior_huella` are Bill 1's record's; the new bill holds both Cañas and no sale.
  7. "a refusal at the second invoice leaves no sale and no record, and takes no number". The same party, mounted with `{ ...cfg, simplifiedInvoiceLimit: decimal("10.00") }` after the contributions were taken, so Bill 1's €3.00 issues and Bill 2's €35.00 is refused (`invoice-selection.ts:100`) while the new bill's two Cañas stay under the limit: no stand-in is needed (R11). 4xx `sale.total_exceeds_simplified_limit`; both bills `open`; no sale; no `registros_facturacion` row; no new party; the table still joined. Then, mounted without the limit, the same split issues, and Bill 1's invoice takes the next number after the last one issued, so none was lost.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/split-table.fiscal.test.ts src/till-api.table-actions.test.ts -t 'A803 split'`: route answers `management.request_invalid { field: "billId" }`; case 1 finds no sale after Task 5's parse alone.
- [ ] **Implement.** D1's `looseSourceIds`, D7, D10. `testing/table-action-fixture.ts`'s `splitTable` leaves `looseSourceIds` out of what it answers, so no existing `toEqual` changes. `checkZones` gets `{ partyId }` and each `{ orderId }` of the selection. Client `splitTable(partyId, tableId, selection, revision, edits, guests)` with its doc comment rewritten; the app's existing call maps its `billId` to a selection and reads `billIds` (nothing on screen changes yet). Rows 11, 17, 18a.
- [ ] **GREEN.** Move sweep; F and Filing unedited; H2; till `src/api/client.test.ts`, `src/api/client.bill-editing.test.ts`, `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts` (row 18a turns these red here, after checking free memory); types.
- [ ] **Deletion controls.** `issueIfFullyPaid` loop removed → case 1 red ("0 to be 1"). `looseSourceIds` left in the request's order → case 6 red, Bill 2 holding the lower number. `withTransaction` kept but the loop run after it commits → case 7 red, Bill 1's sale surviving. Zone check of a loose source removed → the profile-zones case red. **`withIssuanceTransaction` has no control:** it differs from `withTransaction` only by recording an incident for an `IssuanceRefusal` (`packages/core/src/incidents.ts:30-48`), and `rg IssuanceRefusal apps/server/src -g '*.test.ts'` finds no server case that forces one. Say so in the PR rather than claiming it.
- [ ] **Commit.** `git commit -s -m "A803 4c: the split route takes a selection and issues the invoice of a bill it leaves paid"`.

## Task 6: `A803 race replay` (about 45 calls)

**Files.** `apps/server/src/bill-editing.table-actions.test.ts`, `apps/server/src/till-api.table-actions.test.ts`.

Pattern: `waiting-course-copy.test.ts:1787` (`Promise.allSettled`, one commits), each order pinned. Commands read their revisions and edit states before either is asked.

- [ ] **Failing tests**, titled `A803 race replay: …`:
  1. Two splits of one party from one read, both orders: one commits, the other `party.out_of_date`, one new party only, rows compared after.
  2. A split with a loose dish against a payment taking that dish, both orders: payment first → the split refuses (`party.out_of_date` or `bill.line_paid`; the case records what runs, as 4b did) with no event and no notice; split first → the payment names a line no longer on its bill and refuses.
  3. Take-over against a split of that bill, both orders: take-over first → `draft.out_of_date`; split first → take-over refused. No lost dish.
  4. Split against a Move dishes of the same dish, both orders.
  5. Split against Fire of a held group holding a loose pick, both orders: each table ends with the right state, never the dish fired at the wrong table.
  6. A lost reply: a resend of a successful split, through the route, is refused `party.out_of_date`, and no second party, bill or notice exists (master plan's replay case).
  7. Two tills on one party, through the route: one picks Bill 2 whole, the other Bill 2's dish loose; one commits.
- [ ] **RED, by nature:** these should pass on the code from Tasks 2–5 if the revision guard holds. Before running, write the failing output in the ledger: a loser with no refusal, or two new parties. Run `pnpm --filter @waitron/server exec vitest run src/bill-editing.table-actions.test.ts src/till-api.table-actions.test.ts -t 'A803 race replay'`. A case that fails is a defect to fix test first.
- [ ] **Deletion control.** `checkAndBumpParty` in `splitTable` replaced by a plain read → cases 1, 6, 7 red with two commits (say which). Each pair's asked-first check reversed → `expected 'fire' to be 'move'`-shaped failure, so the order is really pinned.
- [ ] **Commit.** `git commit -s -m "A803 4c: races on Split a table have one winner"`.

## Task 7: one read for the panel (about 45 calls)

**Files.** `apps/server/src/working-order.ts`, `apps/server/src/till-api.ts`, `apps/till/src/api/client.ts`, tests.

- [ ] **Failing tests.** `till-api.table-actions.test.ts`, `describe("A803 split: the panel's read")`: three bills, one part-paid, one presented, one abandoned, one a family bill: `{ bills }` lists the open and presented of this party in number order, with the same `lines` as `GET …/lines` and the same `balance` as `GET …/payments` where those answer; `paidLines` present; the presented bill's lines present. A party id that is no UUID → 409 `party.not_open` (`requirePartyParam`); a UUID naming no party → 200 `{ bills: [] }`, as the drafts read answers empty. Add the rows: the action map in `till-api.profile-actions.test.ts` (session only, passive) and a refusing row in `.profile-zones.test.ts` beside `PUT /api/parties/:id/drafts`. Passive: reading it does not keep a session signed in (the shape of the drafts read's case). `client.test.ts`: `getSplitSources(partyId, options)` builds the GET and passes the signal.
- [ ] **RED.** `… -t "A803 split: the panel's read"`: 404.
- [ ] **Implement.** D11. `readTabLines = assertTabOpen + readBillLines`, its other callers unchanged. One query per bill per reader; a party has few bills. Measure once with 20 bills of 20 lines at Task 17a and record the time rather than assuming; a slow answer is a finding, not a note.
- [ ] **GREEN.** The file; `src/transfer-lines.test.ts`; types.
- [ ] **Deletion control.** The status filter dropped → the abandoned bill listed, red. `readBillLines` back to `readTabLines` → the presented bill refuses, red with `tab.not_open`.
- [ ] **Commit.** `git commit -s -m "A803 4c: a read of every bill's dishes and balance for Split a table"`.

## Task 8: the selection model, `A803 selection` (about 70 calls)

**Files.** New `apps/till/src/state/split-selection.ts`, `.test.ts`. No DOM.

```ts
export interface SplitSource {
  bill: PartyBill;
  groups: PickGroups;
  /** Someone else's unsent dishes hold it: no new tick until taken over; an existing tick stays (D21). */
  held: { draftId: string; revision: number; ownerName: string } | null;
  /** This person's own unsent dishes on it. */
  ownUnsent: boolean;
}
export interface SplitPicks {
  whole: ReadonlySet<string>;
  picks: ReadonlyMap<string, Picks>;
}
export function billTick(source: SplitSource, split: SplitPicks): "none" | "some" | "all";
export function toggleBill(source: SplitSource, split: SplitPicks): SplitPicks;
export function pickOnBill(source: SplitSource, split: SplitPicks, next: Picks): SplitPicks;
export function rowsOf(source: SplitSource, split: SplitPicks): PickRow[];
export function toSelection(sources: readonly SplitSource[], split: SplitPicks): SplitSelection;
export function nothingStays(sources: readonly SplitSource[], split: SplitPicks): boolean;
/** Selected bills someone else's unsent order now holds, in number order (D21). */
export function heldSelected(sources: readonly SplitSource[], split: SplitPicks): SplitSource[];
export function splitSummary(sources: readonly SplitSource[], split: SplitPicks): SplitSummary;
/** Which note Everything ticked shows; `anyPaid`: a paid bill stays in the party or its family. */
export function anywayNote(
  sources: readonly SplitSource[],
  split: SplitPicks,
  anyPaid: boolean,
): "empty" | "paid";
/**
 * The panel's rows from the read (D11), the party's bills, every draft of the party and this person.
 * A bill the bills list does not hold is left out until the next read. `recalled` is the bill on
 * screen's unsaved recalls, which no draft read has yet.
 */
export function splitSourcesFrom(
  read: { bills: readonly { billId: string; lines: readonly TabLine[]; balance: BillBalance }[] },
  bills: readonly PartyBill[],
  drafts: readonly Draft[],
  personId: string,
  recalled: ReadonlySet<string>,
  keyFor: (lines: readonly TabLine[], balance: BillBalance) => (dish: TabLine) => string | null,
): SplitSource[];
/** After a read (D21). `gone`: selected bills the read no longer lists. `changed`: bills still listed
 * that lost a pick. A held bill is in neither: it stays selected. Both in the order of `before`. */
export function tidySplit(
  before: ReadonlyMap<string, readonly PickRow[]>,
  sources: readonly SplitSource[],
  split: SplitPicks,
): { split: SplitPicks; gone: string[]; changed: string[] };
```

- [ ] **Failing tests**, titled `A803 selection: …`: ticking a bill takes all of it and clears its picks; unticking one row of a whole bill turns the rest into picks, in line order, up to each limit; whole-bill tick of a part-paid bill is allowed and untick leaves its paid rows out; every dish picked on a clean bill becomes whole; every **unpaid** dish picked on a part-paid bill does not; every sent dish picked on a bill holding this person's unsent dishes does not, and `toSelection` lists the picks and leaves the unsent dishes out of it; a contribution's floor: €40 on €52 stays within it after an untick, and allows €40.00 but not €39.99; a contribution marks no dish paid; a presented bill: header only, rows blocked `presented`, no pick accepted; a held bill at `none`: no toggle; a held bill at `all` or `some`: `toggleBill` clears it, picks included; `pickOnBill` on a held bill changes nothing; `2 of 4` from a whole bill: unticking the Caña row drops all four, and a pick count keeps 4a's first-members rule; recalled dishes in no row; `toSelection` sorts whole by number and lines by line number, and never lists a bill twice; nothing ticked gives an empty selection; `nothingStays` with a paid bill left (true), with an empty open bill left (true), with an own unsent draft on a staying bill (false), with nothing ticked (false); `anywayNote` with only a paid bill staying (`"paid"`), with an empty open bill staying beside a paid one (`"empty"`), with no bill staying (`"empty"`); `splitSourcesFrom`: a dish recalled into a draft on a bill not on screen is in no row, a dish in `recalled` is in no row, someone else's draft sets `held` with its name and revision and leaves the bill's `ownUnsent` false, this person's draft sets `ownUnsent`, and a bill absent from the bills list is left out; `splitSummary` for board 08's example: T8 takes Bill 2, Bill 3 and 3 dishes from Bill 1, €109.00; T7 keeps the rest of Bill 1, €67.00, exact `Decimal`; a re-read that pays a picked dish drops it and names its bill in `changed`, and the same when it was the bill's last pick; a re-read that presents a bill with picks drops them and names it in `changed`; a re-read where a whole bill is presented stays whole and names nothing; a selected bill, whole or loose, the read no longer lists leaves the selection and is named in `gone`; **a selected bill, whole or loose, gaining a foreign draft keeps its place in `whole` or its picks, is in `heldSelected`, and is in neither list**; when that draft goes, its ticks and picks are as they were, tidied, and `heldSelected` is empty; `heldSelected` is in number order and leaves out an unselected held bill; `splitSummary` and `nothingStays` count a held selected bill as going; a read changing nothing names nothing; bill order independent of list order.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/state/split-selection.test.ts -t 'A803 selection'`: module missing.
- [ ] **Implement.** Over `pickRows`, `setCount`, `tidyPicks`, `pickedLineIds`; no second money formula (`billGross`, 4a's D12). `PickRow.blocked` gains `{ reason: "presented" }`; 4a's cases stay unedited. `SplitSelection` is a local type here, matching the wire; the screen reads it.
- [ ] **GREEN.** The file; `src/state/portion-selection.test.ts` unedited.
- [ ] **Deletion controls.** The normalise-to-whole step → its case red. A held selected bill dropped by `tidySplit` → the keeps-its-place case red. `gone` left empty → its case red. `changed` left empty → the paid-pick case red. Floor limit ignored on untick → the €39.99 case red. Paid exclusion → the part-paid case red. `ownUnsent` exclusion → the unsent-dishes case red. Recalled drafts of other bills ignored → the `splitSourcesFrom` recall case red. `anyPaid` ignored → the `"paid"` case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the selection across a table's bills"`.

## Task 9: the picker across bills (about 65 calls)

**Files.** `apps/till/src/widgets/portion-picker.ts` (`whole`), new `widgets/split-picker.ts`, `.test.ts`, `.a11y.test.ts`, `i18n/strings.ts` (the picker's new words).

- [ ] **Failing tests**, `split-picker.test.ts`, titled `A803 selection: …` where they are selection, and otherwise plainly:
  - Header tick: `.checked`, `.indeterminate` for `some` (read the property, not an attribute), named by the bill's label.
  - A whole bill's rows draw ticked and pale with no stepper; a usable tick on each; unticking emits `split-picks` with the model's result; a paid row in a whole bill ticked and disabled, reason tied by `aria-describedby`.
  - Part-paid header `{amount} paid`; presented note, header usable, rows greyed; held bill not selected: `table.others_draft` row with the name, Take over button named `table.take_over · {bill}`, `table.split_take_over_first` tied to its disabled tick by `aria-describedby`, no rows; **held bill selected: the same row, no `table.split_take_over_first`, no rows, its tick checked or indeterminate and usable, and unticking emits `split-picks` with the bill cleared**; `takenFromYou` words; own unsent note.
  - A bill's total drawn with `money`; a long name wraps; a bill with no sent dishes draws its header and `table.move_dishes_none`.
  - It holds no picks: emits and redraws only from its properties.
  - Events: `split-picks` and `split-take-over` are the app-owned widget's plain names, stopped at the source (`CLAUDE.md` §3, shared `wt-*` rule does not apply; follow `portion-picks`).
- [ ] `split-picker.a11y.test.ts`: axe in both themes for: nothing ticked; a whole bill; `some` with a stepped row; part-paid with a paid row; presented; held; held and selected. Disabled rows' reason not by colour alone (master plan).
- [ ] `portion-picker.test.ts`: `whole` cases. Existing cases unedited.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/widgets/split-picker.test.ts src/widgets/split-picker.a11y.test.ts src/widgets/portion-picker.test.ts`.
- [ ] **Implement.** D13. Every colour, spacing and font from `--wt-*`; a pale row by `--wt-opacity-disabled` over text only; checkboxes sized as the picker's. Words: EN and ES, every Question 1 key this widget draws.
- [ ] **GREEN.** The three files; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`; till types; `pnpm format:check`.
- [ ] **Deletion controls.** `.indeterminate` assignment removed → its case red. `aria-describedby` removed → reason case red. Stepper shown under `whole` → board-08 case red. A held bill's tick always disabled → the selected-untick case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: a picker across a table's bills"`.

## Task 10: take-over on any bill (about 45 calls)

**Files.** `apps/till/src/state/draft-sync.ts`, `state/draft-sync.test.ts`, `api/client.ts` only if a type is needed.

- [ ] **Failing tests**, `draft-sync.test.ts`, titled `A803 split: …`:
  - `partyDrafts` holds the last read's drafts of every bill and is replaced by each read.
  - `takeOverOn(billId, draftId, revision)` sends that bill's own `expectedEditFor(billId)` and a fresh submission id, then reads; the on-screen store's lines and candidate are untouched; `others` unchanged.
  - A refusal answers `{ refused: code }`, reads again, and locks nothing on the on-screen bill (unlike `#takeOver`'s recovery, which is about the bill on screen).
  - It refuses while a command or a send is out ("failed"), as `takeOver` does at `:593-595`.
  - A read answering after the sync was dropped changes nothing.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/state/draft-sync.test.ts -t 'A803 split'`.
- [ ] **Implement.** D18. No change to `takeOver`.
- [ ] **GREEN.** `src/state/draft-sync.test.ts` unfiltered; `src/till-app-drafts.test.ts`.
- [ ] **Deletion control.** `expectedEdit` (on-screen) instead of `expectedEditFor(billId)` → case 2 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: taking over the unsent dishes of a bill not on screen"`.

## Task 11a: the panel on the table screen (about 70 calls)

**Files.** `apps/till/src/screens/till-table-order-screen.ts`, `apps/till/src/till-app.ts` (types only), new `.split-table.test.ts`, `widgets/guest-count.ts`, `i18n/strings.ts`, rows 19 and 20.

The old `split-table-bill` step stays what a waiter sees: **a new step `split-table-pick` is drawn only under a temporary property `splitPanelLive`**, which tests set, Task 12c's app sets, and Task 14a removes. Rows come from two more properties, `splitRead` (D11's answer) and `partyDrafts`, through `splitSourcesFrom` (Task 8), kept until one of its inputs changes, as `#dishGroupsFor` does. `fallbackPortionKeys` (`:314`) takes one `DishSources` object, not `keyFor`'s two arguments, so pass a small wrapper that adds the screen's allergy snapshot: `(lines, balance) => fallbackPortionKeys({ lines, balance, allergy: <the screen's snapshot>, recalled })`, or dishes with different allergy marks would group together. Pass `#recalledLineIds()` as `recalled`.

`SplitTableDetail` is a union until Task 14a, so types pass at this commit: `{ tableId, guestCounts, prompt? }` with either `billId` (the old step, `:5056-5061`, whose `satisfies` is unchanged) or `selection` (the new step). In `till-app.ts`, `#onSplitTableOpen` returns early on the new shape until Task 12a, and `#onSplitTable` until Task 12b. `split-table-open`'s `billId` becomes optional for the same reason.

- [ ] **Failing tests**, `.split-table.test.ts` (S in "Deleted checks", opening cases): tapping a table opens the pick step and dispatches `split-table-open` with a `prompt`; heading `{table} leaves {party}` in EN and ES, focused; a renamed table by its name; hint names the staying tables; rows from `splitRead`; steppers named `stayingGuests`, `leavingGuests`, labelled, prefilled, staying from the party's count; Split primary at once once the read has answered; the summary lines for board 08; the new-bill note only with a loose pick; Back returns to the tables, Escape too; Split dispatches `split-table` with `{ tableId, selection, guestCounts, prompt }` once and closes; nothing ticked sends an empty selection; with no read answered Split is quiet and disabled; a first read that failed puts `table.split_read_failed` at the bottom at once, with nothing pressed, and Split stays quiet; a read failing after one has answered keeps the last rows, says nothing, and leaves Split enabled; invalid counts per the Deleted-checks rows; a dish recalled on a bill not on screen is in no row; two portions of one dish with different allergy marks draw as two rows; without `splitPanelLive` the old step draws.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.test.ts`.
- [ ] **Implement.** Move the panel's body into `#splitPickStep`, in as few new lines as the screen allows. `guestsStepper` gains optional `name` and `label`, its comment moved to the callers it still describes. Rows 19, 20 (the a11y scan needs a part-paid bill, a held bill and a whole bill in its fixture, with `splitPanelLive` set). A help bubble is not added.
- [ ] **GREEN.** `.split-table.test.ts`, `.table-menu.test.ts`, `.a11y.test.ts`, `src/screens/till-table-order-screen.test.ts` (the old step unedited); till types; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts`.
- [ ] **Deletion controls.** Staying prefill removed → its case red. Guest validation skipped → the four values red. `split-table` detail dropping `guestCounts` → its case red. `recalled` not passed on to `splitSourcesFrom` → the recall case red. The allergy snapshot left out of the wrapper → a case with two portions of one dish, different allergy marks, red on the rows counted.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel with its ticks and guests, not live yet"`.

## Task 11b: the panel's unsaved work, including out of the page (about 55 calls)

**Files.** Same screen, new `.split-table.unsaved.test.ts`, row 21.

- [ ] **Failing tests**, `.split-table.unsaved.test.ts` (U in "Deleted checks"), the old dialog's titles kept where they still say what is checked:
  - Opening untouched asks nothing; a tick, a stepped count or a typed guest count asks on Back, Escape, a ⋮ item, a bill switch and navigation, keeps on Keep and discards on Discard.
  - Ticks back to where they were, and counts typed back however spelled, are clean; an invalid count stays protected; Split commits with no question; a parent rerender keeps it all and keeps a pending warning.
  - A stored count follows an untouched staying side, not a typed one, and the baseline moves with it.
  - **Out of the page:** "disconnect aborts a leave decision; reconnect retains the opening baseline", with ticks and a typed count: still protected, and an old question's Discard does nothing.
  - "retained departed controls cannot split, go back or replace the draft": a departed Split, Back, tick and stepper.
  - "a count stored elsewhere while an untouched panel is taken out moves the staying side with it once it is put back"; "a typed staying count stored elsewhere while the panel is taken out counts as saved once it is put back"; "a split the panel stays open after keeps its counts when taken out and put back while the stored count is unchanged".
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.unsaved.test.ts`.
- [ ] **Implement.** `ActionDraft` gains `whole`, `staying`, `leaving`; they live in fields the disconnect does not clear, as `moveDishesPicks` does, and `#actionBaseline` survives disconnect already (`:1522-1525`). `#watchActions` includes the new step; `equal` compares with `samePicks` per bill and `sameGuestCount`. The follow-stored rule moves here from the dialog (finding 13), with a `#storedGuestsChanged` flag set in `willUpdate` even while detached, as `split-guests-dialog.ts:66` does. Every new control's handler starts with `#actionControlCurrent(event)`. Row 21.
- [ ] **GREEN.** The file, `.actions-unsaved.test.ts`; till types.
- [ ] **Deletion controls.** `samePicks` for whole bills dropped → the clean-again case red. Follow-stored removed → stored-count red. `#storedGuestsChanged` not set while detached → the taken-out case red. `#actionControlCurrent` removed from the stepper → the departed-controls case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel keeps its work when it is left or taken out"`.

## Task 11c: re-reads, reopening with a refusal, everything ticked (about 55 calls)

**Files.** Same screen, `.split-table.test.ts`, words.

- [ ] **Failing tests**, `.split-table.test.ts`:
  - Re-reads: a picked dish paid elsewhere drops, with `Paid` (what the next press does is Task 11d); a party switch or the table leaving closes the panel, sending nothing.
  - What the app observes (D20): `split-table-observe` with the prompt and the sorted ids fires on a bill ticked, a dish picked off a bill, a bill unticked, `#tidySplit` dropping a tick, and a refusal reopening the panel. It does not fire on a count change, or when the panel closes on send.
  - Reopening (D16): `splitRefusal` with a `field` reopens with what was sent and the same prompt, the message under that stepper, `form.fix_fields` at the bottom, Split enabled; without a `field` reopens with the ticks, no field marked, the message in `[data-split-refusal]` with `role="alert"`, before `wt-form-actions` in document order, Split enabled, gone when Split is pressed again; a template message draws its button; a refusal for a table no longer held, or for a party left on one table, does not reopen; a reopened panel counts as changed; focus after Split and after Back to the ⋮.
  - Refund for a bill not on screen (D16): pressing `[data-refund-excess]` with another bill's id asks; Keep leaves the ticks and dispatches nothing past the screen; Discard closes the panel and lets `refund-excess` through. For the bill on screen it asks nothing and lets it through.
  - Everything ticked (D15): Split swaps to the question with both tables named; Move guests sends `table-relocation-open` then `move-guests` with the leaving table; Split anyway sends the split; a tick change returns to Split; Back returns to Split, not out; the note's table names plural when two stay; with only a paid bill staying the note is `table.split_anyway_note_paid`.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.test.ts -t 're-read|observe|reopen|Refund|Everything'`.
- [ ] **Implement.** `#tidySplit` on `updated`, as `#tidyMovePicks` compares sources by identity. `split-table-observe`. The bottom message and its styles: `.error-part` and `.error-action`, not the `.error-part + .error-part` rule (D16). The words.
- [ ] **GREEN.** Both panel files, `.actions-unsaved.test.ts`; till types.
- [ ] **Deletion controls.** `#tidySplit` removed → paid-elsewhere red. `actionVerb = "move"` omitted → Move guests red (the ready check at `:4818`). Observe not fired from `#tidySplit` → its case red. The message moved after `wt-form-actions` → the document-order case red. The `#leavingActions` wrapper around Refund removed → the Keep case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel follows re-reads and reopens with a refusal"`.

## Task 11d: a read cannot quietly shorten the split (about 50 calls)

**Files.** Same screen, `.split-table.test.ts`, `i18n/strings.ts` (`table.split_taken`, `table.split_bill_gone`, `table.split_changed`, EN and ES, per Question 1; Task 12c also uses the last).

This is D21 on the screen. The app's half, through a real read, is Task 12f.

- [ ] **Before running anything,** write in the ledger what the failing case prints: a `split-table` dispatched with the bill left out of `selection`.
- [ ] **Failing tests**, `.split-table.test.ts`, titled `A803 split: a read and a selected bill: …`, each setting `splitRead` and `partyDrafts` as a read would:
  - A whole bill and a bill with picks each gain someone else's draft: both still in the next `selection` once it is resolved; their ticks `.checked` or `.indeterminate`; no rows; each take-over row drawn.
  - At once, with nothing pressed: `[data-split-refusal]`, `role="alert"`, holds `table.split_taken` with both bills, the leaving table and the staying tables; Split is `variant="secondary"` and disabled.
  - **Nothing sends:** `userEvent.click` on Split, a `.click()` on its host, and Enter from each stepper dispatch no `split-table`.
  - The everything-ticked question showing when a bill becomes held goes back to the action row, and Split anyway is not on screen.
  - Unticking one of two held bills: the sentence names the other, Split still held. Unticking the last: the sentence goes, Split primary, and the next press's `selection` leaves those bills out. A cleared held bill's tick is disabled, with `table.split_take_over_first`.
  - The draft going (the read removes it): rows back, ticks and picks as they were, sentence gone, Split primary.
  - A marked count beside a held bill: both messages, `form.fix_fields` through `wt-form-actions`. A no-field refusal: replaced by the held sentence.
  - **Gone:** a whole bill the read no longer lists: its tick and row go; the first press dispatches nothing and says `table.split_bill_gone` with the name it last drew; Split stays enabled; the second press dispatches once without it. Two gone: two sentences, two presses, then the send. A source whose bill left: the same.
  - **Lost pick:** a picked dish paid: first press dispatches nothing, `table.split_changed`; second dispatches once. The same when it was the bill's last pick, leaving nothing ticked: the second press dispatches an empty selection, because the waiter has now been told.
  - A read changing nothing: the first press dispatches. A whole bill presented by a read: the first press dispatches. An unselected bill gaining a draft: the first press dispatches, and that bill's tick is disabled.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.test.ts -t 'a read and a selected bill'`: Split dispatches, or the sentence is absent.
- [ ] **Implement.** D21. `#splitHeld()` from `heldSelected`, read by the button's `variant` and `?disabled`, by the sentence, and at the top of the handler (`submitOnEnter` skips a disabled button, so Enter stops at `?disabled`). `#splitGone` and `#splitChanged` fed by `#tidySplit`, with the bill names as last drawn, cleared on close, one taken per press. The foot's order: held sentence, else the refusal or stop sentence. Order in the handler: held, counts, one stop, everything ticked, send.
- [ ] **GREEN.** Both panel files; `.actions-unsaved.test.ts`; till types; `pnpm exec vitest run scripts/native-form-fields.test.ts`.
- [ ] **Deletion controls.** The handler's held check removed, the disabled attribute kept → the `.click()` case red, one dispatch. `?disabled` removed, the check kept → the `disabled` assertion red, and Enter still dispatches nothing, because the check is behind it. `#splitGone` not consulted → the gone case red, dispatched on the first press. `#splitChanged` not consulted → the lost-pick case red. The question left up → its case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: a read cannot quietly shorten what Split a table sends"`.

## Task 12a: the app reads every bill for the panel (about 35 calls)

**Files.** `apps/till/src/till-app.ts`, new `src/till-app-split-table.test.ts` (with the shared allergy fixture 4a's Task 8 used, in `apps/till/test/`).

- [ ] **Failing tests**, emitting the new `split-table-open`: it reads `getSplitSources` once; the answer reaches `tableOrder(el).splitRead`; `sync.partyDrafts` reaches `.partyDrafts`, on both screen bindings (`:19121`, `:19264`), and a drafts read replaces it; a later bills read with a changed `revision` reads again; an overtaken answer is dropped (generation); a `partyId` change drops it; leaving the step aborts; a first read that fails reaches the screen as failed; a later one that fails leaves the last answer in place; Back and the same table again reads again, and that read's answer replaces the failure. The old event shape with `billId` still does what it did.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts`.
- [ ] **Implement.** `#splitRead` and its generation. The screen, not the app, joins them (`splitSourcesFrom`), because the allergy snapshot and unsaved recalls are the screen's.
- [ ] **GREEN.** The file; `src/till-app-parties.test.ts`; till types.
- [ ] **Deletion controls.** Generation check removed → the overtaken case red. `partyDrafts` not passed on the handheld binding → its case red. A later failure replacing the last answer → its case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the till reads every bill for Split a table's panel"`.

## Task 12b: the app sends the selection and follows it (about 50 calls)

**Files.** `apps/till/src/till-app.ts`, `till-app-split-table.test.ts`.

- [ ] **Failing tests**, emitting `split-table` with `selection` and no `prompt`:
  - Send: `expectedEdits` are those of whole bills and loose sources, sorted; party revision from the shown party; `selection` and `guestCounts` as dispatched. `#ownBillsChange` wraps it, so a background read does not say "no longer at this table".
  - D17: stays with the staying party; the bill on screen gone → `billToShow`; dishes gone from the bill on screen, which still owes → lines re-read, bill kept; **the last unpaid dishes picked off the bill on screen, which is now paid → the lowest-numbered bill still owing is shown, and with none, the paid bill, with no "gone" notice**; `#refreshBillDraft` after.
  - Different people (finding 9): a loose pick off a bill over the limit asks once and sends only after confirming; a whole bill over the limit asks nothing; a limit of null asks nothing; a loose source under the limit asks nothing.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t 'send|follow|different people'`.
- [ ] **Implement.** `#onSplitTable` per D17, a `billId` detail mapped to a selection for the request until Task 14a. That mapping does not reach refusals: a refused `billId` detail keeps today's path (`splitRefusal` with `billId`, the banner) until Task 14a, because `till-app-parties.test.ts:2382` and `:2429` pin it until then. `#askDifferentPeople(proceed, billIds = [activeTabId])`.
- [ ] **GREEN.** The file; `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`; till types.
- [ ] **Deletion controls.** Composition of the shown bill only → the `expectedEdits` case red. `billIds` ignored by the question → the over-limit source case red. The paid-bill follow removed → the now-paid case red, on an empty list.
- [ ] **Commit.** `git commit -s -m "A803 4c: the till sends the split's selection and follows it"`.

## Task 12c: the panel goes live, and compares what the waiter saw (about 65 calls)

**Files.** `apps/till/src/till-app.ts`, `till-app-split-table.test.ts`, `till-app-parties.test.ts` (row 22).

- [ ] **Before running anything,** write in the ledger what the failing case prints: `api.splitTable` called once with the fresh state, where the waiter ticked the old one.
- [ ] **Failing tests.** Row 22's ten, under the titles in "Moved till-app cases", through the panel's real controls: open the panel, tick the bill in `till-split-picker`, `window.dispatchEvent(new Event("focus"))` to refresh, press Split. Each new case asserts at least what its old one does. The exception is "refuses a panel carried across a bill switch": a bill switch closes the panel, so it captures `prompt` from `split-table-open`, switches bill and dispatches `split-table` with that prompt and a selection (R14). Plus:
  - The worked example in D20: this person's own draft saved elsewhere, refreshed, refused, then retried and sent with the new state.
  - A bill changed before it was ticked sends with no refusal. A bill ticked, changed, unticked and ticked again sends with no refusal.
  - After a server refusal of `draft.out_of_date` the observation is new, so the retry sends once; after a refused count it is not.
  - A loose source is compared as a whole bill is.
  - "a dish recalled on a bill not on screen is not offered, and cannot be sent", through the real app.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t 'refuses a refreshed|keeps a bill with no edit state|only an unrelated bill|carried across|allows a new panel|retains the original|replacement API'`.
- [ ] **Implement.** D20. `.splitPanelLive=${true}` on both screen bindings. `#onSplitTableOpen` keeps the composition; a new `#onSplitTableObserve` keeps the observations, reading `sync.expectedEditFor` behind the `#draftReady` and party checks; `#onSplitTable` compares them at Send with `#billChoiceMatches`, never `#billChoiceEdit` or `#billChoiceCurrent`, which set the banner. D16's two rows these cases need, for the `selection` shape only: the refused count, and `draft.out_of_date` with the till's own comparison, each building `splitRefusal` with `selection` and reopening the panel. Delete row 22's old `describe` once every new title exists, confirming each by name.
- [ ] **GREEN.** The file; `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`, `src/till-app-drafts.test.ts`, `src/screens/till-table-order-screen.split-table.test.ts`; till types.
- [ ] **Deletion controls.** The comparison at Send removed → the three "refuses a refreshed" cases red, `api.splitTable` called once. Observation taken at Send → the same. Observation kept for every bill rather than the selected ones → "only an unrelated bill" red. Observation not cleared after a refusal → the retry case red. Cleared after a refused count → `:12078`'s case red. The check that the bill on screen is still the one the panel opened on removed from `#billCompositionCurrent` → "refuses a panel carried across a bill switch" red, `api.splitTable` called once (R14 ran this on today's code by removing `#billCompositionUnchanged`).
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel goes live and refuses a bill that changed since it was ticked"`.

## Task 12d: refusals, and Refund on the bill they name (about 60 calls)

**Files.** `apps/till/src/till-app.ts`, `till-app-split-table.test.ts`, `till-app-table-service.test.ts` (its refusal table, as 4a's Task 8 added `move-dishes` rows).

- [ ] **Failing tests**, one per row of D16's table except the two Task 12c built: what is said and where, what is re-read and what is not, that `splitRefusal` reopens the panel with no banner, and that a refusal arriving after the waiter left the party or the table does nothing. Then the cases of rows 23–26 under the titles in "Moved till-app cases", with `:2429`'s reversed. Named:
  - A bill not on screen is named in front of the words, by the label read before the re-read. `party.out_of_date` reloads (`#onPartyOutOfDate`) and its words go to the bottom.
  - `draft.taken_over`: `sync.load()` runs. When the read shows that bill held, it stays ticked, D21's sentence and row show, Split is held, and no second request goes. When the read fails, `table.split_changed` names the refusal's `billId` and Split stays enabled.
  - `tab.not_open` and `tab.line_not_found`, each carrying `tabId`: `table.split_changed` naming that bill, bills and sources read again.
  - **No banner while a read is out:** the money row and `party.out_of_date`, each with its read held: `banner` null and no `[data-split-refusal]` yet; released: the sentence at the foot, `banner` still null.
  - **The recovery link:** `sif.allocation_invalid` with `recoveryUrl: "/manage/recovery/fiscal-conflict"`: `[data-recovery]` inside `[data-split-refusal]`, its `style` naming `--wt-color-primary-text`, its computed colour differing from the panel's background, in both themes, `banner` null. The same refusal on a party left on one table: on the banner, `--wt-color-on-danger`, as today.
  - **Two tables, words at the foot:** `table.not_shared` and `group.held_leaves_party` on a party the till shows at two tables; their one-table cases at `till-app-parties.test.ts:2540` and `:2542` keep the banner (row 28).
  - **A lost reply:** the request fails with no `code`, and the re-read shows the table gone → no message, no panel, D17's follow. The re-read shows the table still held → `table.error` at the bottom, panel reopened. The re-read also fails → the same, and the next press refused `party.out_of_date` is said as that row says.
  - The table no longer held after a re-read, with a code → the banner, no panel.
  - **Refund, bill on screen:** `bill.received_exceeds_total` shows "Refund {amount}" in the bottom message; pressing opens the Refund dialog on that bill.
  - **Refund, bill not on screen:** with the refusal's `workingOrderId` naming Bill 2 and Bill 1 on screen, pressing Refund and answering Discard switches to Bill 2, and the dialog offers Bill 2's payment, pre-filled; answering Keep switches nothing and opens nothing, and the ticks stay.
  - An excess refusal from Move dishes, with no `billId`, behaves as today.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t 'refus|lost reply|Refund|read is out|recovery link|Two tables'`.
- [ ] **Implement.** D16's other rows. The app says nothing until the row's reads are done: the money row calls `billWriteError` and `#loadPartyBills` itself; `#onPartyOutOfDate` gains `say`. `errorText` gains `surface`. A named refusal uses `#refusedDestination`'s rule, generalised to any bill of the selection. `CounterError`'s `excess` gains `billId` and `bill`; `refund-excess` carries `billId`; `#onRefundExcess` switches first where needed and refuses to open anything but that bill.
- [ ] **GREEN.** The file; `.split-table.test.ts`; `src/till-app-parties.test.ts`; `src/till-app-table-service.test.ts`.
- [ ] **Deletion controls.** Bill name in front removed → its case red. Reopen removed → reopen case red. `billId` dropped from the `refund-excess` event → the not-on-screen case red, naming the on-screen bill's payment. `errorKey` not cleared on reopen → the "no banner" assertion red. The table-gone check after a lost reply removed → the first lost-reply case red, showing `table.error` for a split that went through. `surface` ignored → the recovery link case red, naming `--wt-color-on-danger`. The money row going through `#onBillMoneyRefusal` → the no-banner-while-a-read-is-out case red. `party.tableIds.length > 1` removed from the reopen check → `till-app-parties.test.ts:2540` red at Task 14a; before then, this task's one-table recovery case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's refusals say what happened at the foot of the panel and keep the picks"`.

## Task 12e: take-over rows (about 40 calls)

**Files.** `apps/till/src/till-app.ts`, screen, `till-app-split-table.test.ts`.

- [ ] **Failing tests.** `split-take-over` opens the screen's take-over dialog; confirming calls `sync.takeOverOn`; `takeOversAnswered` moves on; a refusal shows `takeOverRefusalError` at the panel's foot, not the banner; the row goes after a successful read; `#takeOverClosed` focuses the row's button while it is still there and the bill's tick otherwise; a tick taken after the take-over records the new state, so Split sends with no refusal. **A bill already ticked when taken over** keeps its tick and picks, its record is replaced once the read has answered, Split is held until then, and the first press sends once with the new `editorVersion`, `draftId` and `draftRevision`. The same after a refused take-over: still held, nothing sent.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t 'take-over'`.
- [ ] **Implement.** D18. The screen's `takeOverPending` learns a `billId`, or a bill-less draft keeps today's path.
- [ ] **GREEN.** The file; `src/screens/till-table-order-screen.test.ts` take-over cases unedited.
- [ ] **Deletion controls.** `takeOverOn` → `takeOver` → the row's case red with the on-screen bill's edit. The record not replaced after a take-over → the already-ticked case red: the first press sends nothing, `table.split_changed`.
- [ ] **Commit.** `git commit -s -m "A803 4c: taking over a bill's unsent dishes from Split a table's panel"`.

## Task 12f: someone else's order reaches a ticked bill, through the real app (about 40 calls)

**Files.** `till-app-split-table.test.ts`. Code only if a case finds a defect.

**The fixture changes `drafts` as well as `billEdits`.** A helper `withForeignDraft(snapshot, billId)` adds Luis's `Draft` to `snapshot.drafts` (`ownerId`, `ownerName: "Luis"`, `billId`, `revision: 0`) and moves that bill's row in `snapshot.billEdits`: `editorId`, `editorName`, `editorVersion` plus one, `draftId`, `draftRevision: 0`. That is the shape R13 printed from the real route. `:11943`'s fixture changes `billEdits` alone, so no bill shows held and it cannot reach D21.

- [ ] **Before running anything,** write in the ledger what the failing case prints: `api.splitTable` called once with an empty selection and `expectedEdits: []`, and the bill still at the staying table.
- [ ] **Failing tests**, titled `A803 split: a ticked bill someone else's order reaches: …`, each opening the panel, ticking through `till-split-picker`, changing the `listDrafts` answer with the helper, and `window.dispatchEvent(new Event("focus"))`. Each asserts `listDrafts` was read again:
  1. **The only tick, whole.** The tick still `.checked`; the take-over row names Luis; `table.split_taken` at the foot; Split `secondary` and disabled; `userEvent.click` on Split and Enter from a stepper; `api.splitTable`, `saveDraft` and `takeOverDraft` not called.
  2. **The only pick, loose.** The same, the tick `.indeterminate`. Unticking it leaves nothing ticked; the next press sends once with an empty selection, so none of its dishes.
  3. **With another bill ticked.** Bill 2 and Bill 3 whole, Bill 2 reached: no request at all, so no split goes ahead with Bill 3 alone.
  4. **Untick.** Bill 2 and Bill 3 whole, Bill 2 reached and unticked: Split sends once, `selection` only Bill 3, `expectedEdits` only Bill 3's; `takeOverDraft` not called.
  5. **Take over.** Confirmed through the dialog: one `takeOverDraft` with Bill 2's own edit; then Split sends once, `selection` still holding Bill 2, with its new state.
  6. **The order goes.** A later read removes the draft and leaves the edit state moved, as a send does: Split back; the first press sends nothing and says `table.split_changed`; the second sends once with the fresh state.
  7. **An old prompt.** With Bill 2 reached, `split-table` dispatched directly with the panel's `prompt` and a selection holding Bill 2: no request, `table.split_changed`. This is the app's own layer.
  8. **A request already out.** The read comes only after Split was pressed: the server's `draft.out_of_date` comes back, the re-read shows Luis's draft, and the panel reopens in this same state with no second request.
  9. **A ticked bill gone.** The next `getPartyBills` and `getSplitSources` leave Bill 2 out: the first press sends nothing and says `table.split_bill_gone` naming Bill 2; the second sends once, `selection` empty, `expectedEdits: []`.
  10. **In Spanish:** case 1's sentence and Split's name read from the strings.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t "a ticked bill someone else's order reaches"`. The screen and model already do this (Tasks 8, 11d, 12c, 12e), so these should pass as written: before running, run the first control below to see them fail for the right reason. A case that fails with nothing broken is a defect to fix test first.
- [ ] **GREEN.** The file; `src/screens/till-table-order-screen.split-table.test.ts`; till types.
- [ ] **Deletion controls.** Each is a real edit, and each case named must go red:
  - `tidySplit` put back to round 3's rule, dropping a held bill's tick and its record → case 1 red: `api.splitTable` called once, empty selection, `expectedEdits: []`. Case 3 red: called once with Bill 3 alone. This is the defect itself.
  - The screen's hold on Split removed, the tick kept → case 1 red on the `disabled` assertion. `api.splitTable` stays uncalled there, because D20's comparison is behind it: the reviewer reads that as two layers, not a weak control.
  - D20's comparison at Send removed → case 6 red, sent on the first press, and case 7 red, one request.
  - `gone` not consulted → case 9 red, sent on the first press.
- [ ] **Commit.** `git commit -s -m "A803 4c: a bill someone else's order reaches stays ticked, and the split waits for the waiter's choice"`.

## Task 13: A590 (about 35 calls)

**Files.** `apps/till/src/till-app.ts`, `screens/till-floor-screen.ts`, `state/floor-today.ts`, `till-app-table-service.test.ts`, `till-floor-screen*.test.ts`.

- [ ] **Failing test.** `till-app-table-service.test.ts`, `A803 applies split room revision before reload`: tables at revision 1; `splitTable` answers `zoneRevisions: { [zone]: 9 }`; the next `getTablesState` is held (R5's mechanics); `back-to-floor`; a floor edit through the shortest control in reach (`[data-update-layout]` as `till-app-floor-layout.test.ts:127-135` presses it, with that file's zone set-up; or the details sheet). This file's fixture has `capabilities: ["print-receipt"]` (`:154`), so the case must add `take-orders` or the button is not drawn: the review's first attempt printed `button false`. Assert the API got revision **9**, and no `floor_today.out_of_date` shown. Release the read: it wins afterwards.
- [ ] A handheld twin, set up as `till-app-parties.test.ts:1571-1580`: the floor mounts after the split and still sends 9.
- [ ] `till-floor-screen`: a poll started **before** the answer and applied after it does not replace the carried revision; a read started after it does; own `#carried` newer than the app's wins, and the reverse.
- [ ] **RED and first probe.** `pnpm --filter @waitron/till exec vitest run src/till-app-table-service.test.ts -t 'A803 applies split room revision'`. What the failing case prints: the API called with revision 1. The review's throwaway run printed `A590 sent revision [1]`, so expect that. If it prints 9 before any fix, the window cannot be hit: stop and record that (A590's own "or confirm the window cannot be hit").
- [ ] **Implement.** D19.
- [ ] **GREEN.** The two files; `src/screens/till-floor-screen.today-joins.test.ts`; till types.
- [ ] **Deletion control.** The store on answer removed → red, revision 1. `tablesReadAt < answeredAt` dropped → the read-after case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the floor keeps the room's revision a split answered (A590)"`.

## Task 14a: the old window and steps go (about 65 calls)

Waits for Question 2. Built on its default; the PR cannot land until it is answered.

- [ ] Consumer trace, run first and listed in the ledger:
  `rg -n 'split-guests|SplitGuests|split-table-bill|splitPanelLive|split_table_bill_heading|split_no_bill|split_guests_title' apps docs/developers docs/operations scripts`. `split-table-open` and `#splitTablePrompts` stay (D20), so they are not in it. Also `rg -n 'data-target="none"' apps/till/src`, which must end empty.
- [ ] **Failing check.** It cannot be red by a test; the check is that the `rg` above prints only the historical dated plans after the edit (4a's Task 9b precedent).
- [ ] Move `SplitGuestsDetail` to `widgets/guest-count.ts` and its imports with it (`till-table-order-screen.ts:117`, `:266`). Delete `widgets/split-guests-dialog.ts`, its three test files, the screen's `split-table-bill`, `#splitGuestsDialog`, `#splitTableBills`' bill buttons, `splitPanelLive` from the screen, the app and every test, `billId` from `SplitTableDetail`, `SplitRefusal` and `split-table-open`, the app's mapping from it, and the words. The comment at `till-table-order-screen.ts:2050` loses "split-guests".
- [ ] Row 18b: every remaining `split-table` emit and stub in `till-app-parties.test.ts` and `till-app-table-service.test.ts` sends `selection`, each pinned behaviour otherwise unchanged. The exceptions are row 27, whose banner assertion changes as that row says, and rows 28 and 29, whose banner assertions must stay green untouched: a red there is a stop, because it means D16's reopen rule is not as written. Delete rows 23–26's old cases and the screen cases in "Deleted checks" whose new home now exists, confirming each home exists by name.
- [ ] `design-system.md:2871`, `:2883`, `:1090-1095`: name the panel's guests, not the window, and the focus sentence; `:2883` keeps its "reconnect case", now in `.split-table.unsaved.test.ts`. `conventions-data.md:4727` stays true (`guestCounts`).
- [ ] **GREEN.** All of `src/screens/till-table-order-screen*.test.ts`, `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`, `src/till-app-split-table.test.ts`, `src/widgets/split-picker*.test.ts`; till types; `pnpm exec vitest run scripts/native-form-fields.test.ts`.
- [ ] **Commit.** `git commit -s -m "A803 4c: the one-bill split steps and guests window go"`.

## Task 14b: the old request goes (about 35 calls)

- [ ] `rg -n "billId" apps/till/src/api/client.ts | /usr/bin/grep -i split`, and the server's parse: `selection` required. Answer `{ partyId, billIds, zoneRevisions? }`.
- [ ] Rows 11–14. `oneBill(id)` in the fixture answers `{ wholeBillIds: [id], loose: [] }`; `null` answers an empty selection.
- [ ] **Failing test.** `till-api.table-actions.test.ts`: a body with `billId` and no `selection` refuses `field: "selection"`. **RED** on Task 5's code.
- [ ] **GREEN.** The move sweep; `till-api.profile-actions`, `.profile-zones`, `.zone-closed`, `attendance-arriving-groups`, `floor-catch-up`, `today-names`, `till-device-proof`, `table-actions.refund-pending`.
- [ ] **Commit.** `git commit -s -m "A803 4c: the split route takes only a selection"`.

## Task 15: guides and the design contract (about 35 calls)

- [ ] EN and ES: the section of Question 1 in `guide/{en,es}/table-service.md`, before `{#held-dishes-move}`, one heading `{#split-table}` in both. Write each sentence from the code built and keep it only if it changes what staff do (root `CLAUDE.md` §3, A803 4b's Build record). Question 1's text has already lost the sentences on a part-paid bill and on everything ticked, which the screen itself says; do not put them back. Check the ES names against the till's strings by `rg`, not memory: **Tomar el pedido**, **Mover clientes**, **Separar**, **Separar igualmente**.
- [ ] Remove nothing else, and leave `#held-dishes-move` as the owner cut it. `table-service.md:345-346`'s "A table split off with a bill starts again at Bill 1" stays true and gets "with bills". If a sentence there is now untrue, fix it in both languages.
- [ ] `design-system.md` "The dish picker" (`:5795`): the whole-bill header, `whole` rows, the summary and notes, take-over rows, presented and everything-ticked, in the section's present-tense form, each guard named with what it does not see. The action panel entry (`:1090`) gains that this panel's refusals sit at its foot, per Forms, and the till's banner only when no panel can reopen. "The dish picker" also gains D21's three cases and that a selected bill someone else's order reaches stays ticked.
- [ ] Forms, after the exceptions at `design-system.md:2631-2635` (A396, A752), in present tense, naming A803 4c: **(a)** a panel whose rows come from a read says so at once when its first read fails, with its action quiet and disabled; a later read that fails keeps the last rows and leaves the action as it was. Precedents to name: the Products Move and Delete dialog ("or after the summary failed", `:2898-2900`), `wt-delete-dialog`'s `readError` (`:5458-5463`), the period delete dialog (`:6402`). **(b)** A selection someone else's change now rules out says so at once, naming each choice, and holds the action quiet and disabled until the person chooses or the change goes: A427's rule for a button its row's own state rules out (`:2909-2912`), and `wt-delete-dialog`, which lists what refuses a delete as it opens (`:5455-5458`). Each stays a statement of what this panel does, with `till-table-order-screen.split-table.test.ts` named as what pins it.
- [ ] **G.** Guide checks; `git diff --stat` shows both twins.
- [ ] **Commit.** `git commit -s -m "A803 4c: guides and design contract for Split a table's picker"`.

## Task 16: LOOK (about 50 calls; no commit unless a defect is fixed, test first)

- [ ] `memory_pressure | grep free`; `wa-wt demo waitron-feat-a803-4c-split-table-picker`. Screenshots stay in `~/waitron-campaign-c/a803-4c-look/`; never commit or copy them to Drive; show them to the owner directly.
- [ ] EN and ES, light and dark, 390 and 1280 px, and compare with the boards in `boards/`. Set up each state once and loop the eight combinations in one script, one call per state; do not spend a call per screenshot:
  - **Board 08:** nothing ticked; one bill whole (pale rows); `some` with a stepper at "2 of 4" and "1 of 2"; a dish on hold among the rows; the summary, the note and the steppers; a long dish name; a named bill and a long party name; four bills, to judge scrolling in the 22rem panel.
  - **Board 09:** after the split, both tables, the new table's Bills 1, 2, 3; the staying bill on screen; the kitchen's decoded MOVED job for only the dish that moved (decoded, not paper; physical printing stays unmeasured).
  - **Board 10:** a part-paid bill, its paid row, `{amount} paid`; a contribution's floor-greyed row; a take-over row before and after; everything ticked, with Move guests and Split anyway; nothing ticked.
  - A presented bill. Refusals: a dish paid from another tab then Split, its sentence at the foot of the reopened panel, seen without scrolling away from Split at 390 px; a refusal with Refund, its button included; a refused count under its stepper with `form.fix_fields` at the foot; a refusal carrying `recoveryUrl`, its link readable at the foot in light and dark.
  - **D21:** another till saves an order on a bill ticked here, whole and with picks: the tick, the take-over row, the sentence at the foot and Split quiet, all seen together at 390 px, and the panel not jumping under the finger when the rows give way; then Take over and Untick, each to Split primary. A ticked bill paid from another tab: its sentence after the first press.
  - Keyboard: Tab order, Space on a tick, Enter from a stepper, focus to the heading on open, focus back to the ⋮ after Back.
  - **Touch:** steppers and ticks at `--wt-tap-min` at 390 px. A1265 (⋮ taller than the room) untouched, but measure and record.
- [ ] A defect found is fixed test first in its own commit or added to the backlog in Task 18. A wording that does not fit updates Question 1 before landing.

## Task 17a: the whole slice (no commit; about 30 calls)

- [ ] Every guard suite above, each status read. `pnpm --filter @waitron/till exec vitest run src/state src/widgets/portion-picker.test.ts src/widgets/split-picker.test.ts src/widgets/split-picker.a11y.test.ts src/screens/till-table-order-screen.split-table.test.ts src/screens/till-table-order-screen.split-table.unsaved.test.ts src/screens/till-table-order-screen.a11y.test.ts src/screens/till-table-order-screen.table-menu.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/till-app-split-table.test.ts src/till-app-parties.test.ts src/till-app-table-service.test.ts src/till-app-drafts.test.ts`, after checking free memory.
- [ ] Task 7's timing: 20 bills of 20 lines, time the read, record it.
- [ ] Audits: `rg -n 'locationId|location_id' <every new test file>` prints nothing; `rg -n 'A803 selection|A803 split|A803 race replay|A803 applies split room revision'` lists every named case; `rg 'split-guests|split_no_bill|splitPanelLive'` prints only dated plans; the Schema diff prints nothing; `git diff --stat <merge base> -- packages/fiscal-verifactu` prints nothing.
- [ ] Spec walk, §3.7 line by line, naming the test per line, in the ledger. CI owns package coverage; do not add a whole-workspace run for this.

## Task 17b: deletion controls re-run, server (no commit; about 45 calls)

- [ ] Re-run each deletion control of Tasks 1–7 at the current head: name the edit, the case, the red message, green after restore, in the ledger. **One call per control:** one shell command that makes the edit, runs the named case, prints the count and restores. Restore with `git checkout -- <file>`, then `git status --short` is empty. A control that stays green is a finding: find out why before going on.

## Task 17c: deletion controls re-run, till (no commit; about 70 calls)

- [ ] The same for Tasks 8–13, Tasks 11d and 12f included, one call per control, after checking free memory. Beside another browser run only well above 15% free.

## Task 18: backlog, record pass, PR (about 30 calls)

- [ ] `docs/backlog.md`: delete A590 and `docs/backlog/till.md`'s A590 detail (its check passed, Task 13), its decision left where a comment cites it (`rg A590`). A803's entry and detail (`docs/backlog.md:2050`, `docs/backlog/till.md:2996`): 4c has landed; pre-bills remain, through A446. A1327's and A1333's texts gain finding 14's sentence.
- [ ] New short entries, each only if still true: Join and Move guests from the order screen drop the room revision (finding 11); A773 §6's take-over rows are built for Split a table only and not for joins and moves (finding 7); a LOOK finding left open. A1192 is already in the backlog (`docs/backlog.md:1900`): a split's slips are one more place it shows, and it gets no new entry.
- [ ] A650's decision in `docs/backlog/till.md:2023-2034` is kept and gains one dated sentence: "2026-11-04, A803 4c: Split a table no longer tells bills that stay, by spec §3.7, except where a name on their paper has gone", worded to Question 3's answer. Moves to `## Decisions and deliberate limits` if not already there; never deleted.
- [ ] Dated one-line pointers, never rewrites: spec §3.7 "Bill numbers"; `2026-11-01-a803-4-portion-picker.md` Cut 4c: "built from `2026-11-04-a803-4c-split-table-picker.md`, whose findings correct this outline"; `2026-10-14-a650-moved-slips-design.md` §0 ruling 1 and its rows 8, 9 and 18: the same sentence as above.
- [ ] **Record pass.** Append "## Build record (4c)" to this plan: what was built versus planned, departures with reasons, line numbers that moved, the control table.
- [ ] PR body in plain English: what the waiter and the kitchen see; no venue reset, no schema change; "Changed test checks" (every row), "Moved till-app cases" and "Deleted checks"; "For the owner": Questions 1 and 2 hold landing until answered, and the lane lands it after that; Question 3's default, naming the two rulings; and, in plain words, that the route now issues an invoice for a bill it leaves fully paid, by the function Move dishes calls, no fiscal function changed, and that **one split can issue more than one invoice in one transaction when loose picks finish several part-paid bills**, naming the two cases that pin it in `split-table.fiscal.test.ts`: "two loose sources left paid make two invoices, in bill-number order, the second chained on the first" and "a refusal at the second invoice leaves no sale and no record, and takes no number". Say also that a bill someone else's order reaches stays ticked and holds Split (D21), naming Task 12f's title. Then `/finish-branch` with this plan named.
- [ ] Ledger `Status: in progress` until landed.

## Task list and sizes

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight, questions posted, ledger | 15 | no commit |
| 1 | allergies follow any number of bills | 30 | green |
| 2 | several whole bills leave together (`A803 split`) | 70 | green |
| 3a | who must own what | 35 | green |
| 3b | loose dishes on one new bill (`A803 split`) | 60 | green |
| 4 | MOVED for moved dishes and names gone; rows 1–5, 8, 9 | 55 | green |
| 5 | route takes the selection; issuance, including several invoices; row 18a | 60 | green |
| 6 | `A803 race replay` | 45 | green |
| 7 | one read for the panel | 45 | green |
| 8 | selection model (`A803 selection`), `splitSourcesFrom`, what a read may do | 70 | green |
| 9 | picker across bills, a11y | 65 | green |
| 10 | take-over on any bill | 45 | green |
| 11a | panel, ticks, guests, not live | 70 | green |
| 11b | unsaved work, out of the page | 55 | green |
| 11c | re-reads, reopening, everything ticked | 55 | green |
| 11d | a read cannot quietly shorten the split (D21, screen) | 50 | green |
| 12a | app reads every bill | 35 | green |
| 12b | app sends and follows | 50 | green |
| 12c | panel goes live; what the waiter saw; two refusal rows; row 22 | 65 | green |
| 12d | refusals, Refund, lost reply; rows 23–26 | 60 | green |
| 12e | take-over rows, a ticked bill taken over | 40 | green |
| 12f | someone else's order reaches a ticked bill, real app (D21) | 40 | green |
| 13 | A590 | 35 | green |
| 14a | old window and steps go (Question 2); rows 18b, 27–29 | 65 | green |
| 14b | old request goes | 35 | green |
| 15 | guides, design contract, Forms' two allowances | 35 | green |
| 16 | LOOK boards 08–10, D21 | 50 | no commit |
| 17a | whole slice | 30 | no commit |
| 17b | deletion controls, server | 45 | no commit |
| 17c | deletion controls, till | 70 | no commit |
| 18 | backlog, record pass, PR | 30 | green |

About 1,510 calls in 31 tasks, none planned above 70. The outline guessed 12 tasks.

## Against the master plan's slice 4

| Master plan item | Where |
| --- | --- |
| `A803 split`: two of three whole plus loose; each whole intact; loose as one new bill; any bill stays; none → empty; all → Split anyway; guest counts; allergies | Tasks 2, 3b, 1 |
| A669: known answer and unknown state | Task 1 |
| A666, A757 intact | Task 2 case 11 |
| `A803 selection`: whole-bill toggles, deselect becomes loose, a whole part-paid bill | Task 8, Task 9 |
| `A803 race replay` for splits, two tills on one party, lost reply | Task 6 |
| Recheck every `BillEditExpected`, ask take-over, no bulk | D4, D20, D21, Tasks 3a, 10, 11d, 12c, 12e, 12f |
| Decoded MOVED names only moved dishes | Task 4 |
| Cancel, Escape, navigation, switch bill, reconnect; reason not by colour alone | Tasks 9, 11b (its "Out of the page" cases) |
| A590 `A803 applies split room revision before reload` | Task 13 |
| LOOK boards 08–10 | Task 16 |
| EN/ES guides, design-system contract, backlog | Tasks 15, 18 |

## Receipts (planning run)

All at `4259a040d2`, in this worktree. Each throwaway edit was reverted; `git status --short` was empty
before this plan was written. Copies of the probes are in `~/waitron-campaign-c/a803-4c-look/probes/`.
Free memory read 72–73% before the browser and sweep runs.

- **R1, the reach.** What a failing case prints: a staying dish's case naming a notice it no longer
  gets. Edit to `splitTable` only: read `readSentWork(billId)` first, `withMovedSlips`
  given `null`, `enqueueMovedSlips(before, billId)` at the end. `MOVES` sweep: 48 files, **10 failed,
  2,955 passed** (`r-reach.log`): the ten in "Changed test checks". Limit: run with today's one-bill
  command, so it says nothing of loose dishes; those are Task 4's cases.
- **R2, the baseline.** The same sweep with no edit: 48 files, 2,965 passed, 191 seconds. F and Filing:
  340 passed. H2: 20 passed. `party-allergy.test.ts`: 68 passed. This is the control for R1.
- **R3, the spikes** (`spike-1.test.ts` and its S4 addition, `env -u AI_AGENT -u CLAUDECODE
  TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/zz-a803-4c-spike.test.ts`; 5 passed; deleted).
  They use only exports that exist today.
  - **S1**: Move dishes to a new bill on the source party, then Split a table with it, then a new bill
    at the staying party: `{ b1: 1, temp: 1, next: 3 }`. A failing case for finding 1 would have printed
    `next: 2`.
  - **S2**: the new bill made at the new party, Burger and Flan carved from a bill shared with Paella and
    Tarta. New bill: Burger in a new fired group, Flan in a held copy (group numbers 1, 2). Staying:
    Paella in its fired group, Tarta in its held group. Numbers: 1 and 1. Notices: one, BURG, on the new
    bill, `moved_to` the leaving table. `working_orders.label` read the staying table's name when the
    source's label was passed, so `insertPartyBill` (label null) is the plan's call. **Not run:**
    `insertPartyBill` itself in that sequence, or with whole bills beside it (Task 3b case 1).
  - **S3**: `readTabLines` on a bill forced to `placed`: `tab.not_open`.
  - **S4**: two bills sharing a held group: one `copyHeldGroups` call gives 1 held group at the new
    party; one call per bill gives 2. The second run is the control.
- **R4, boards.** `git show 3ef533f4fe~1:docs/backlog/mockups/a803-bills-and-tables/{08,09,10}-*.png`,
  read as images. Their README: "09's 'was Bill 2' label is dropped".
- **R5, the floor on a till.** Throwaway case in `till-app-table-service.test.ts` (restored from a copy,
  `tats.orig`). A first attempt was invalid: its helper threw inside the mocked read, so the tables were
  empty and nothing split; its output is not used. Second attempt: `floor while order open: true`,
  `split called: 1, read held: true`, `floor after back: true, same instance true`. So on a till the floor
  stays mounted. **Not run:** the handheld (D19 rests on a comment in that test file and `#tabBody` read
  at `till-app.ts:18988-19080`; Task 13's twin runs it), and no floor edit was sent, so this run did not
  measure A590's window. Plan review 1 did (see "Could not be established"); Task 13's RED step runs it
  again, and says what to do if it cannot be hit.
- **R6, reads** (each by reading, not run): `guardParty` moves the revision (`parties.ts:386-395`);
  `requireBillOfParty` refuses `placed` (`parties.ts:254-270`); `refuseOrderOverSimplifiedLimit`
  (`working-order.ts:1482-1497`) from `moveOrderLines`; `takeOverDraft` refuses another bill's edit
  (`order-drafts.ts:730`); `sync.others` "on this bill" (`state/draft-sync.ts:286`); `rg conflicts` over the
  till's non-test sources: no reader; `rg zoneRevisions apps/till/src/till-app.ts`: nothing.
- **R7, overlap.** Of the first 40 local branches, the one touching these files is
  `checkpoint/a773-1-before-final-integration-20261019`, an old checkpoint. That loop was cut at 40:
  Task 0 runs it over all of them and the queues.
- **R8, A1308's hold.** `~/waitron-campaign-shared/a1308-hold.md` read. Lane C's 4b was named as finishing;
  4c changes no table, so it may start under the rule "Work that touches no tables carries on".

Revision 1, at `ae09c6c03f`, same worktree. Each throwaway edit was reverted, and `git status --short`
was empty after each. Free memory read 74% before the sweep.

- **R9, the name-gone rule (Question 3's default).** What a failing case prints: an eighth red name, or
  `today-names.test.ts:468`, `:482` or `:751` among the reds. Edit: `splitTable` read
  `readPartiesSentWork(tx, [partyId])` where `withMovedSlips` read it, ran its write with a `null` reach,
  then told the leaving bill by `kitchenToBeTold` and every other entry only when `before.places.names` had
  entries and none was in `after.names`. `MOVES` sweep (log:
  `~/waitron-campaign-c/a803-4c-look/probes/r1-b-filter.log`): 48 files, **7 failed, 2,958 passed**: rows 1,
  2, 3, 4, 5, 8 and 9, by their case names. R2 is the control. Limit: today's one-bill command, so it says
  nothing of loose sources; Task 4's cases 6 to 8 are those.
- **R10, Task 2's RED.** What a failing claim prints: `tab.not_open`. Edit: `move-merge.test.ts:786` handing
  `{ wholeBillIds: [tabId], loose: [] }`, then `{ wholeBillIds: [], loose: [] }`, to today's fixture.
  `pnpm exec vitest run src/move-merge.test.ts -t 'row 8'`, twice: `Error: Unknown named parameter
  'wholeBillIds'`, 1 failed and 44 skipped each time. The review recorded `ERR_INVALID_STATE` for this
  input; I did not print the error's `code`, so the plan quotes only the message.
- **Claims this revision makes that rest on a read, not a run.** Each is run by the task named: that the
  panel's bottom message can be
  drawn with `formMessageStyles` and the copied rules (Task 11c, Task 16); that observing bills only when
  ticked keeps all ten cases' behaviour (Task 12c); that `#leavingActions` gives Keep and Discard for
  Refund as for a bill switch (Task 11c); that `billToShow(undefined, read)` is right for a bill just paid
  (Task 12b); that an unknown party answers `{ bills: [] }` (Task 7); that the panel's state survives
  disconnect as `moveDishesPicks` does (Task 11b). From the review and not re-run: `[ 'fired', 'held',
  'held' ]` (D5) and `A590 sent revision [1]` (Task 13). `wt-form-actions`' `error` not holding a button is a
  statement about its declared type (`wt-form-actions.ts:62`); round 3 ran a template through it and it drew,
  so the reason to draw beside it is the type and `wt-form-error`'s `detail.message`, not impossibility.

Revision 2, at `c645737bd0`, same worktree. Each throwaway edit was reverted, and `git status --short` was
empty after each. Free memory read 74% before the browser run.

- **R11, two invoices in one transaction.** What a failing case prints: one record, a second record not chained
  on the first, or a sale surviving the refusal. Edit: a throwaway `describe` in `till-api.move-dishes.test.ts`
  giving two bills a contribution, moving each one's unpaid dish off through the fixture's `moveDishes`, then
  `issueIfFullyPaid` for each inside one `withIssuanceTransaction`. `env -u AI_AGENT -u CLAUDECODE
  TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/till-api.move-dishes.test.ts -t 'PROBE-R2'`:
  `first issued`, `second issued`, `settled settled [{"invoiceNumber":1,…}] [{"invoiceNumber":2,…}]`, chain
  `A/1` (previous null) then `A/2` (previous `A/1`). With `{ ...venue.cfg, simplifiedInvoiceLimit: decimal("10.00") }`,
  a €3 bill first and a €35 bill second: `lim first issued`, then refused `sale.total_exceeds_simplified_limit`,
  `open open 0 0 0 0 0` (both open, no sales, no records, no new chain rows). Limit: called the function, not a
  route; that a later invoice takes the same number was not run, and Task 5's case 7 runs it. Read: the limit
  reaches the route, because `requestCfg` and `sendingCfg` spread the config (`request-config.ts:6-8`,
  `made-here.ts:37-43`); Task 5's case 7 runs that.
- **R12, Task 2 case 13.** What a failing claim prints: `hold false allergy.unanswered`, which would mean the plain
  round was enough. Edit: `splitPartyAllergies` moved after arrival in today's `splitTable`, and a throwaway case in
  `party-table-actions.test.ts` with and without `hold: true`. `-t 'PROBE-R2'`: `hold false split answered`, `hold
  true allergy.unanswered`. Control, the copy where it is today: both `split answered`.
- **R13, a foreign draft reaches both lists.** What a failing case prints: `drafts` empty, or `draftId` null, or
  `editorVersion` unchanged. Edit: a throwaway case in `till-api.move-dishes.test.ts`: `GET /api/parties/:id/drafts`,
  `saveDraftForTest` as `venue.adminId`, the same read. Before: `{"drafts":0,"edit":{…"editorId":null,…
  "editorVersion":0,"draftId":null,"draftRevision":null}}`. After: one draft on that bill owned by the admin,
  revision 0, and `{…"editorId":"cde3…","editorName":"Administradora","editorVersion":1,"draftId":"0439…",
  "draftRevision":0}`. Task 12f's helper is this shape. The till takes both from one answer (`state/draft-sync.ts:521`,
  `:534-542`), read, and Task 10 runs it.
- **R14, a retained prompt, and the one-table party.** What a failing case prints: `splitTable calls 0` both with
  and without the guard. Edit: a throwaway case in `till-app-parties.test.ts`, today's window: capture `prompt` from
  `split-table-open`, `take-payment` to `wo-check`, `emit` `split-table` with the prompt. `env -u AI_AGENT -u CLAUDECODE
  pnpm exec vitest run src/till-app-parties.test.ts -t 'PROBE-R2'`: `bill after switch wo-check prompt captured true`,
  `splitTable calls 0`. With `if (!this.#billCompositionUnchanged(asked)) return;` removed: `splitTable calls 1`. The
  default party, in a case beside it: `tableIds ["t4"]`. Limit: run on today's window and today's guard, not the panel.
- **Reads this revision relies on.** Task 12d runs `till-app.ts:15802-15805`'s assign-before-await with the read held;
  Task 11d runs the disabled button's host `.click()` (`design-system.md:2888`, "`disabled` stops a person, not a test"); Task
  14a runs `:110`'s single table against rows 28 and 29; Task 12f runs D21's order on the real app. A claim with **no**
  task that runs it: that taking over needs only `take-orders`, the action the split needs (`till-api.ts:3689`,
  `:3140`), so no separate sign-in is ever needed in that panel. The Revision 2 table's other "Read" rows are about
  documents or this plan's own text. From round 3 and not re-run: the contrast figures in D16, `.error-part` not
  reaching the screen, `["held","held"]` (D5; Task 2 case 7b runs it), `Bill 1 · Paid ✓` (D17; Task 12b's now-paid case
  is near it), and that the panel closes on a bill switch (`:1960`; Task 12c's case relies on it).

### Could not be established at planning

- Whether A590's window can actually be hit was open at planning (R5's limit). Plan review 1 ran a
  throwaway case: split answered `zoneRevisions: { z1: 9 }`, next read held, `back-to-floor`, Update layout
  pressed, `A590 sent revision [1]`; a window that could not be hit would have printed `[9]`. So I believe it
  can be hit. Task 13's RED is the receipt that counts.
- Whether the action panel's 22rem width carries four bills, steppers and the summary. Task 16 decides;
  a change of panel width is a shared layout matter, so it goes to the owner rather than being widened
  here (board 08 draws it wider).
- The time of `GET split-sources` at size (Task 17a).
- Whether a bill can reach `tab.split_held_line` in real table service: 4a kept the refusal, 4c follows
  it, and Task 3b's case builds the state by hand.
- Whether the panel jumps under a waiter's finger when a ticked bill's rows give way to a take-over row: a
  read can do that with Split already held, so a press cannot land on the wrong thing, but Task 16 looks.
