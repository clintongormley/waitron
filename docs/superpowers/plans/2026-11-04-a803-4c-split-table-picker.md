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

**Review weight: FULL.** Risk triggers: a cross-package contract (`VENUE_SERVICE.splitPartyAllergies`
and the till-server wire), concurrency (two tills on one party), and the received-money floor.
Per-task review by a high-effort reviewer; `/finish-branch`'s full wave at the end, with the Codex
run-it seat run twice.

**Execution.** Subagent-driven: each task goes to one `implementer` (medium effort), then a
high-effort reviewer. Each task is sized well under 100 tool calls (estimate in its heading). An
implementer past about 150 calls stops at a passing or cleanly red point, commits, and hands over:
done, left, files, each check's state. Fixing a behaviour defect a review found stays at high effort.

**A working product at every commit.** The server learns the new request beside the old one (Task
5); the till moves to it in Tasks 11–12 while the old panel steps still work up to Task 11; the old
request and the old window go in Tasks 14a and 14b.

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
change to a function:** the split route starts calling the existing `issueIfFullyPaid` for each bill
that lost loose dishes, inside `withIssuanceTransaction`, exactly as the Move dishes route does
(`till-api.ts:4193-4204`). Without it, ticking the last unpaid dishes of a part-paid bill would leave
a fully paid bill with no invoice (D7). The suites H2, F and Filing below stay passing and unedited.

## Owner questions

Building goes ahead on each default. Questions 1 and 2 block landing only. Questions 3 and 4 do not
block landing: the build carries the default and the PR says so. All go to
`~/waitron-campaign-c/questions.md` at Task 0, one at a time.

**Question 1 of 4 (new words; blocks landing).** Every new text a person reads, with a recommended
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
| `table.split_bill_part_paid` | `{amount} paid` | `{amount} pagados` | Bill header beside the label, board 10; `bill_pay.paid_part` «pagados» |
| `table.split_take_over_first` | `You can tick this bill once you take the order over.` | `Podrás marcar esta cuenta cuando tomes el pedido.` | Under a take-over row; board 10 |
| `table.split_presented` | `Presented: this bill goes whole or stays.` | `Presentada: esta cuenta se va entera o se queda.` | Under a presented bill's header; `presented_pay.balance` «Cuenta presentada» |
| `table.split_own_unsent` | `Your unsent dishes go only with the whole bill.` | `Tus platos sin enviar solo se van con la cuenta entera.` | Under a bill holding this person's unsent dishes; `bill_pay.unsent` «platos sin enviar» |

Plus the guide section (Task 15), English and Spanish, also shown to the owner:

- Heading: `Split a table` `{#split-table}` / `Separar una mesa` `{#split-table}`
  («Separar una mesa», `guide/es/table-service.md:267`).
- EN: "When some of a party move to a table of their own, open the **⋮** menu, choose **Split a
  table** and tap the table that leaves. Tick what goes with it: whole bills, or single dishes from
  any bill. Single dishes go together on a new bill at that table. Set each table's guests, then
  choose **Split**. With nothing ticked, the table leaves with an empty bill.

  A part-paid bill can go whole, with its payments; its paid dishes cannot be picked on their own. If
  someone else has an unsent order on a bill, choose **Take over draft** on its row before you tick
  it. If everything is ticked, the till offers **Move guests** instead; **Split anyway** leaves the
  other table with an empty bill."
- ES: «Cuando parte de un grupo pasa a una mesa propia, abre el menú **⋮**, elige **Separar una
  mesa** y toca la mesa que se separa. Marca lo que se lleva: cuentas enteras o platos sueltos de
  cualquier cuenta. Los platos sueltos van juntos en una cuenta nueva en esa mesa. Indica los
  comensales de cada mesa y elige **Separar**. Si no marcas nada, la mesa se va con una cuenta vacía.

  Una cuenta en parte pagada puede irse entera, con sus pagos; sus platos pagados no se pueden elegir
  sueltos. Si otra persona tiene un pedido sin enviar en una cuenta, elige **Tomar el pedido** en su
  fila antes de marcarla. Si lo marcas todo, la caja ofrece **Mover clientes**; **Separar
  igualmente** deja la otra mesa con una cuenta vacía.»

Task 15 writes these from the code built; where that code makes a proposal untrue, Task 15 changes it
and updates the posted question, so the owner approves the text that ships.

**Question 2 of 4 (deleted test checks; blocks landing).** The guests window
`widgets/split-guests-dialog.ts` goes, with its three test files: spec §3.7 puts guest counts "in the
same window", so a second window is exactly what the spec removes. Default: it goes. Its behaviour
moves to the panel and each check is rewritten there or named as gone. The table is "Deleted checks"
below; four checks have no successor, each with its reason. Worked example of what is lost: today the
guests window opens with the cursor in the first field; after 4c focus goes to the panel's heading,
as every action panel does (`design-system.md:1090`).

**Question 3 of 4 (does not block landing).** Staying dishes whose kitchen paper names a place that
is gone. Spec §3.7 says "a MOVED notice for the dishes that changed table only", and the build follows
it. Running that change (R1) turned red three checks that pin something the spec's sentence may not
have had in mind:

Worked example. Today's plan joins Counter 6 and Table 9 and names the join "García birthday". A
burger is sent; its ticket says **García birthday**. Table 9 leaves with no dishes. The burger has not
moved, but no place called García birthday exists any more; the group now reads as Counter 6.

- **(A, built by default: the spec's words.)** No slip. The cook still holds a ticket naming a place
  that has gone from the floor.
- (B, my recommendation.) A staying dish is told only when **no** name its paper printed is still one
  of its places: "From García birthday, To Counter 6". Plain T7 + T8 → T7 still gets nothing, as board
  09 shows, because "T7" is still on the ticket. The three checks at `today-names.test.ts:468`, `:482`
  and `:751` then stay as they are.

The rule to decide: does "changed table only" also silence a slip when the name on the ticket
vanishes? Changing from A to B later is a small filter in `splitTable` and restoring three checks.

**Question 4 of 4 (does not block landing).** A bill with someone else's unsent dishes when the bill
would leave **whole**. Spec §3.7 and board 10 say take it over first. A773 §6, which §3.7 cites, says
"A sole common editor can be retained during relocation", and that is what the server does today:
`bill-editing.bill-moves.test.ts:280` ("split a table carries only its moved bill editor") pins that
Ana's unsent dishes travel with her bill and she stays its editor.

Worked example. Bill 2 holds two dishes Luis has not sent. Clint splits T8 off and wants Bill 2 to go.

- **(A, built by default: spec §3.7 and board 10 in the till; the server unchanged.)** The till greys
  Bill 2's tick and shows **Bill 2 · Luis has an unsent order** with **Take over draft**. The server
  still accepts it (that test stays), so a request sent in the moment before the till re-reads is not
  wrongly refused, and Luis's dishes follow the bill.
- (B) The till lets Clint tick Bill 2 and Luis keeps editing it at T8. Rows appear only where the
  server refuses: a loose dish on Luis's bill, or two whole bills with different editors.

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
   bill turned ten cases red: the list is "Changed test checks" rows 1–10. Question 3 asks about three
   of them.

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
    `split-guests-dialog.unsaved.test.ts:212-260`). A refused count reopens beside its field with what
    was sent (`SplitRefusal`, `till-table-order-screen.ts:272-281`; `till-app.ts:15629-15643`). Tasks
    11a and 11b carry both over.

14. **Open items 4c must not absorb.** A1327 (a dish waiting for the pass gets no MOVED line): a loose
    dish in that state has the same gap, because it comes from `readSentItems`, which 4c does not
    change. A1330, A1331 and A1333 (service steps after a bill leaves): Split anyway reaches A1333's
    state more easily; it stays the owner's question. Task 18 adds a sentence to A1327 and A1333 and
    changes none of their code.

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
| 4c about 12 tasks | 24 tasks, about 1,100 calls | Task list |
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
  ): Promise<{ partyId: string; billIds: string[] }>;
  ```

  `billIds` is the new party's bills in number order, from the existing `shownBillIds`
  (`table-actions.ts:417`). Bad shapes: a whole id twice, a bill both whole and loose, one bill in two
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
  6. Read `readSentWork` for each whole bill and each loose source, **before** any table leaves and
     before any line moves: 4b's finding 3 (the "before" picture needs held dishes still in their
     group, and for whole bills `leaveParty` first, as `splitTable` does today).
  7. `leaveTables`, `openParty` with the leaving count, `inheritKitchenNote` "copy" (as today).
  8. Each whole bill in number order: `allocateBillNumber`. Before step 9, so the new bill numbers last.
  9. Loose: `insertPartyBill(tx, cfg, newParty)` (label null, zone of the leaving table; S2 used
     `createOpenOrder` with the source's label and got the staying table's name in `working_orders.label`,
     so not that). For each source, `moveCheckedDishes` onto it with `refuseHeld: true`. Then
     `assertBillInvariant` on every source, then `leaveParty(tx, newBill, "keep")`.
  10. `VENUE_SERVICE.splitPartyAllergies` with every leaving bill (D8). After step 9, because it reads
      the bills' lines; before step 12, because firing on arrival needs the answer (4b finding 9).
  11. Nothing selected: `insertPartyBill` the empty bill. Otherwise whole bills: `takeIntoParty`,
      `moveBillDraftsToParty` with **that bill's** expected edit (today's `expectedEdits[0]` becomes a
      find by id).
  12. Each leaving bill in number order, new bill last: `groupArrivingDishes`. Then `copyHeldGroups`
      **once** over every held id (finding 3). Then `printHoldTickets` over every `held` answer.
  13. `ensureFamilyBill` on the staying party when a whole bill left; `leaveMergesRestoring`.
  14. MOVED slips (D6). Return `{ partyId: newParty, billIds: await shownBillIds(tx, cfg, newParty) }`.

- **D3 Where the new bill is made.** At the new party (finding 1). So moved lines cross parties
  mid-transaction: nothing in `carveLines` or `moveOrderLines` reads a party (`working-order.ts:4125-4215`,
  `:4670-4760`), and spike S2 ran it: the burger's fired group cleared and a new fired group made at the
  new party, the flan rebound to a held copy, the tarta left in the source group still held, one
  `moved` notice for BURG only.

- **D4 Editors.** New `requireSplitEditors(tx, wholeIds, looseSourceIds, operatorId, expected)` in
  `bill-editing.ts`. It reads the union, requires `expected` to be exactly the union, sorted, and
  compares each state (`requireExpectedState`). Conflicts are every loose source with a foreign editor,
  plus, when the whole bills have two or more different editors, every whole bill not owned by the
  actor. All of them go in one `draft.taken_over` with `conflicts`, sorted by bill id (A773 §6), so the
  till can show every row at once rather than one refusal per bill. A staying bill is not in the set.
  The new bill has no draft and no editor row. See Question 4 for the till's stricter gate.

- **D5 Arriving dishes, bill by bill.** Each leaving bill gets its own fired group, as if the bills
  moved one after another (`groupArrivingDishes` takes one bill). So two bills with fired dishes make
  groups 1 and 2 at the new table, and a held copy takes the next number after them. Pinned by a case
  so a change is a decision.

- **D6 MOVED slips** (spec §3.7; finding 5; Question 3's default). The `withMovedSlips` reach goes:
  staying bills, the family's paid bills and counter orders delivered to the party's tables are no
  longer read or told. Each whole bill: `enqueueMovedSlipsFor` over step 6's map. Each loose source:
  `enqueueMovedSlips(tx, cfg, before, newBill, splitFrom)`, so `movedItems` keeps only ticket items of
  that source now on the new bill (`kitchen-print.ts`, `movedItems`), one slip per source, because each
  names the order number it was sent under. A dish waiting for the pass is outside `before` as today
  (A1327, not absorbed).

- **D7 Issuance.** The route runs in `withIssuanceTransaction`; after `splitTable`, for each loose
  source, `issueIfFullyPaid(tx, fiscal, sendCfg, source, personId)`, then `captureKitchenActivity` over
  the loose sources and the new bill, as the Move dishes route does. A whole bill keeps its money and is
  not re-judged. No fiscal function changes. It runs inside `movingRooms`' write. A refusal by the box's
  trading state (`requireEconomicWrite`, reached inside `issueWhenFullyPaid`, `bill-payments.ts:673`)
  rolls the split back, as it does a Move dishes; a split with no loose dish never makes that call.

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
  "selection" }`. No `allSelected`: Move guests is its own command. Task 5 accepts `billId` beside it
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
  - A bill whose every dish is picked becomes whole, when no dish of it is paid, recalled or locked. A
    whole bill keeps its number, name and payments; two ticks should not silently make a new bill and
    leave an empty one behind.
  - A whole part-paid bill is selectable with its payments; its paid rows are never picks (spec §3.7).
    Its floor binds picks only, never the whole tick.
  - A presented bill: header tick only, its rows greyed `presented`, because the server refuses
    picking from it `bill.presented`.
  - A bill with someone else's unsent dishes: no tick and no rows until taken over (board 10; Question 4).
  - A dish recalled into any draft is in no row (4a's D17).
  - The till reads `pickedLineIds` per bill and sends whole bills in the order they are numbered.
  - **Everything ticked** means at least one bill is whole and nothing with dishes stays: every other
    owing bill has no sent dish and no open draft. A paid bill does not count as staying.

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
  stored elsewhere while untouched; leaving starts blank; blank records no count. Invalid text marks
  the field on Split, with `form.fix_fields` at the bottom and Split disabled until fixed; a server
  refusal of a count (`refusedSplitSide`, `till-app.ts:731`) goes under its field and keeps Split
  enabled. Enter submits from either stepper (`submitOnEnter`, as the window does). Split is primary
  from the start: "nothing ticked" is a valid split (spec §3.7 case 4).

- **D15 Everything ticked.** Pressing Split swaps the action row for board 10's question: **Move
  guests** (primary), **Split anyway**, Back. Move guests goes through the existing path:
  `#prepareRelocation("move", table, …)` with `actionVerb = "move"`, then the `move-guests` event
  (`till-table-order-screen.ts:4810-4849`). It moves the party off **all** its tables to the leaving
  table and keeps the party's guest count, so the steppers' values are not used; the question names the
  tables that would be left. Split anyway sends the split with the counts. Changing a tick returns to
  the action row.

- **D16 Refusals.** The panel closes on send and keeps a snapshot; the app hands back `splitRefusal`
  for every refusal below while the party still holds the table, and the panel reopens with picks and
  counts (extending today's pattern, `till-table-order-screen.ts:2005-2008`). After a re-read,
  `tidySplit` adjusts picks to what is now on screen. 4a closes its panel for good on a refusal; here a
  split is many ticks, so they are not thrown away (master plan: "retain a losing editor's local unsaved
  work"; root `CLAUDE.md` §3).

  | Code | What the waiter sees | What is read again |
  | --- | --- | --- |
  | `management.request_invalid` naming `guestCounts.*` | Under that stepper | nothing |
  | `party.out_of_date` | `#onTableRefusal`'s words | order and floor |
  | `draft.taken_over` | Its words; the take-over rows now show | drafts |
  | `draft.out_of_date` | Its words | drafts |
  | `bill.line_paid`, `bill.received_exceeds_total`, `bill.refund_in_progress`, `order.payment_in_flight`, `working_order.not_open` | Their words with `{bill}: ` in front, and "Refund {amount}" for the second, through `#onBillMoneyRefusal` | bills, balance, sources |
  | `bill.presented`, `bill.paid`, `tab.not_open` | The bill named, as `#refusedDestination` names one | bills, sources |
  | `tab.split_held_line` | `table.split_held_error` | sources |
  | `sale.total_exceeds_simplified_limit` | Its existing words (in `TABLE_REFUSALS`, `till-app.ts:620`) | nothing |
  | `tab.line_not_found` | `table.reread_failed`'s words | sources |
  | anything else | `tableWriteError` | nothing |

  None sends the person to somebody else. The different-people question (finding 9) asks when any
  loose source's total is over the limit; `#askDifferentPeople` gains a `billIds` parameter.

- **D17 After the split.** The till stays with the staying party at its other table, as today
  (`till-app-parties.test.ts:2280`). If the bill on screen left whole, `billToShow` chooses (as
  `till-app.ts:15655-15668`). If loose dishes left the bill on screen it stays on screen and its lines
  are re-read.

- **D18 Take-over rows.** `DraftSync` gains `partyDrafts` (the last `listDrafts` answer's drafts) and
  `takeOverOn(billId, draftId, revision)`: `api.takeOverDraft` with `expectedEditFor(billId)`, then its
  own `#load()`. The on-screen bill keeps `takeOver`. The row is `{bill} · {name}` with
  `table.others_draft`'s words and the existing `table.take_over` button and `#takeOverDialog` (no new
  dialog, no bulk take-over; A773 §6). `takenFromYou` rows use `table.draft_taken_by`'s words as the
  order screen does.

- **D19 A590.** The app gains `floorCarried: ReadonlyMap<string, { revision; answeredAt }>`. On a
  split's answer, before `#reloadTables` starts, each `zoneRevisions` entry is stored with
  `nextFloorMoment()`. `till-floor-screen` gains a `carriedRevisions` property, and `#revision`
  (`till-floor-screen.ts:1378-1385`) takes the later of its own `#carried` and this one, under the same
  rule: only while `tablesReadAt < answeredAt`. A later read that started after the answer wins, and a
  poll that started before it does not.

- **D20 Old steps go.** `split-table-bill`, `#splitTableBills`' bill buttons, `#splitGuestsDialog`, the
  `split-table-open` event and `#splitTablePrompts`, `widgets/split-guests-dialog.ts`, and the words
  `table.split_table_bill_heading`, `table.split_no_bill`, `table.split_guests_title`. The table step
  `table.split_table_heading` and `table.split_guests_confirm` "Split" stay. The edit state is read at
  Send, not when the panel opens: the panel can stay open across re-reads, and the server compares each
  expected state, so a change after the last read is refused rather than overwritten.

## Departures from the master plan

| Master plan says | Here | Why |
| --- | --- | --- |
| Portion ids on the wire | Line ids | 4a's D2: a bound line and its portion are one-to-one |
| `allSelected` flag and `guests` | no flag; `guestCounts` | D10 |
| `A803 selection` in `portion-selection.test.ts` and `portion-picker.test.ts` | New whole-bill cases in `split-selection.test.ts` and `split-picker.test.ts` under the same title | D12, D13: the whole-bill model has its own file |
| `A803 race replay` with promise barriers | The pattern 4b settled on: `waiting-course-copy.test.ts:1787` (`Promise.allSettled`, the asked-first order pinned) | 4b's Build record: the write lock takes them in turn, and the case that a barrier adds is covered by the order assertion |
| Forms: a refusal naming no field goes in the bottom message | Banner through the app's `errorKey`, as every table action, with the panel reopened behind it | "Refund {amount}" and `#onTableRefusal`'s re-reads live there. D16. Task 16 checks it is visible at 390 px |
| Refusal closes the panel (4a D9) | Panel reopens with picks | D16 |

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
| App | `till-app.ts`: `TABLE_REFUSALS` `:615`, `BILL_MONEY_REFUSALS` `:660`, `refusedSplitSide` `:731`, `#ownBillsChange` `:11664`, `#refreshBillDraft` `:11688`, `#onTakeOverDraft` `:11863`, `#loadPartyBills` `:11948`, `#onTableRefusal` `:12124`, `#reloadTables` `:15041`, `#splitTablePrompts` `:15589`, `#onSplitTable` `:15598-15677`, `#onBillPairRefusal` `:15793`, `#billComposition` `:15868`, `#askDifferentPeople` `:15931`, `#onMoveDishes` `:15973`, `#refusedDestination` `:16003`, floor element `:19050`, bindings `:19630-19631` |
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
R1.** Under Question 3's (B), rows 6, 7 and 10 stay unedited.

| # | Check | Pins today | Pins after | Task |
| --- | --- | --- | --- | --- |
| 1 | `party-table-actions.test.ts:1492-1508` | PAELLA on the staying bill gets `moved_to: "AvisoS 4"`, BURG `"AvisoS 5"` | `toEqual` of exactly `[...earlier, BURG]`, title changed to "… and nothing of the dishes that stayed" | 4 |
| 2 | `party-table-actions.test.ts:962-982` | The family's paid bill's BURG gets `moved_to: "PagoS 7"` | `noticesOn([ana.tabId])` equals `earlier`; the paid bill's row, lines and payments still equal | 4 |
| 3 | `move-merge.test.ts:411-439` | BURG, FLAN, TINTO notices; three slips | BURG only; one slip `De: Mesa 4, 5 / A: Mesa 5` | 4 |
| 4 | `move-merge.test.ts:441-452` | An empty table leaving gives BURG a notice | `noticesOf([tabId])` is `[]` | 4 |
| 5 | `move-merge.test.ts:774-790` | Row 8: two slips, `De: Mesa 51, 52 / A: Mesa 51` | no slip printed | 4 |
| 6 | `today-names.test.ts:468-480` | Named group, no bill: one slip, group name → own name | no slip | 4 |
| 7 | `today-names.test.ts:482-497` | Named group with a bill: two slips | one slip, group name → Patio | 4 |
| 8 | `today-names.test.ts:499-508` | Unnamed, no bill: one slip to Counter 6 | no slip | 4 |
| 9 | `today-names.test.ts:510-524` | Unnamed with a bill: two slips | one slip to Table 9 | 4 |
| 10 | `today-names.test.ts:751-763` | Delivered counter order at Table 9: one slip | no slip | 4 |

**Wire shape only, spec §3.7's new request; no behaviour assertion weakens.**

| # | Check | Change | Task |
| --- | --- | --- | --- |
| 11 | `till-api.table-actions.test.ts:167` | answer keys gain `billIds`, then lose `billId` | 5, 14b |
| 12 | `till-api.table-actions.test.ts:523-556` | "a malformed or missing bill" refuses `field: "selection"`, not `"billId"` | 14b |
| 13 | Bodies of 44 `split-table` posts in 11 server test files (`rg -c 'split-table' apps/server/src -g '*.test.ts'`) | `billId: x` → `selection: oneBill(x)` from `testing/table-action-fixture.ts` | 14b |
| 14 | `till-api.zone-closed.test.ts` (its split case) | `billId` → `billIds[0]` | 14b |
| 15 | `bill-editing.bill-moves.test.ts:297-300`, its direct `splitTable` import | passes `oneBill(from.billId)` | 2 |
| 16 | `packages/venue-service/src/party-allergy.test.ts:406`, `:563` | `id` → `[id]`, `null` → `[]` | 1 |
| 17 | `apps/till/src/api/client.test.ts:3078-3135`, `:5913-5918`; `client.bill-editing.test.ts:103-112` | body and answer | 5 |
| 18 | `till-app-parties.test.ts` (19 `split-table` emits; `toHaveBeenCalledWith` at `:2303`, `:2315`, `:2347`, `:2374`; stub `:321`), `till-app-table-service.test.ts` (4 emits; stub `:293`; row `:1147`) | detail `{ tableId, selection, guestCounts }`, called with `selection` | 12a |
| 19 | `screens/till-table-order-screen.a11y.test.ts:945-952` | scans the new panel, with a part-paid bill, a take-over row and a whole bill | 11a |
| 20 | `.table-menu.test.ts:584-600` | the second step is the picker; Escape returns to the tables | 11a |
| 21 | `.actions-unsaved.test.ts:211-240` | ticks and counts are protected; Split submits with no question | 11b |

`testing/table-action-fixture.ts`'s `splitTable` accepts `billId | null | SplitSelection` and answers
`{ partyId, billIds, billId: billIds[0] }`, so the other test files that call it through the fixture (`rg -n 'splitTable\('
apps/server/src -g '*.test.ts'`) need no edit. `observedTableActionBody` reads `selection` as well. A
fixture, not an assertion.

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
| `:159` disconnect aborts a leave decision; reconnect keeps the baseline | **Gone as written.** The panel's scope is the screen's own, whose disconnect is already pinned in `.actions-unsaved.test.ts` |
| `:178` retained departed controls cannot split | **Gone as written.** `#actionControlCurrent` guards the panel, pinned in `.actions-unsaved.test.ts` |
| `:197` a parent rerender keeps counts and the warning | U |
| `:212`, `:230` a stored count moves an untouched side, not a typed one | U |
| `:242`, `:251`, `:260` the same across take-out and put-back | U, as "while the panel is reopened by a refusal" |
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
- [ ] Post Questions 1 to 4 to `~/waitron-campaign-c/questions.md` (one-at-a-time format, worked examples as above).
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

## Task 2: several whole bills leave together (about 65 calls)

**Files.** `apps/server/src/table-actions.ts`, `apps/server/src/testing/table-action-fixture.ts`, `apps/server/src/bill-editing.bill-moves.test.ts` (row 15), `apps/server/src/party-table-actions.test.ts`.

The new signature (D1) with `loose` required to be empty until Task 3b (`management.request_invalid` for now). `requireRelocatableBillEditors` over the whole ids until Task 3a. MOVED reach unchanged until Task 4.

- [ ] **Failing tests**, `describe("A803 split")` in `party-table-actions.test.ts` (full rows compared):
  1. "… two of three whole bills leave together; the third stays": `billIds` is `[b2, b3]` in number order, both at the new party with numbers 1 and 2, `b1` keeps 1 at the staying party, one new party, table on it, revision moved by one.
  2. "… any bill can stay and any can go, the first included".
  3. "… nothing selected: the leaving table starts with an empty bill, and staying bills are untouched" (`[]`).
  4. "… everything selected: the staying party gets one empty bill" (`ensureFamilyBill`) and "… a staying party keeping only a paid bill gets none", with its reason in the title (D12's "does not count" follows the server here).
  5. "… sets both guest counts in the one command".
  6. "… two whole bills sharing a held group get one copy, with both dishes": the group count at the new party, one `lines_moved` pair, and firing the copy fires both (finding 3).
  7. "… two whole bills with fired dishes make one fired group each, in number order" (D5).
  8. "… two whole bills with held dishes move each bill's own open draft with its own expected edit".
  9. "… a whole part-paid bill goes with its payments": `bill_payments` rows and `paidLines` unchanged, balance answers the same; no invoice.
  10. "… the answer and allergy guests are copied once across both" (`splitPartyAllergies` through the command).
  11. The master plan's "A666 seats before a floor join and A757 highest joined-table state remain intact": "… a split of a joined table leaves the seats and the highest state as a one-bill split does", compared against a twin split with one bill.
  12. Refusals, `refused(...)` snapshot before and after (`:235-245`): a whole id twice, paid (`bill.paid`), abandoned, other party's (`bill.other_party`), with every row unchanged.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts -t 'A803 split'`: each fails on the current one-bill signature with an object where a bill id goes (`tab.not_open` or a shape error). Anything else is a stop.
- [ ] **Implement.** D2 steps 1, 2, 4 (whole), 5, 7, 8, 10, 11, 12, 13, 14 with the existing reach. Fixture as "Changed test checks" describes. Comment: replace `splitTable`'s doc comment (`:279-285`) with one that states the new contract, and no history.
- [ ] **GREEN.** The file unfiltered; the move sweep; server types.
- [ ] **Deletion controls.** `copyHeldGroups` per bill → case 6 red, "2 to be 1". `expectedEdits[0]` instead of a find → case 8 red. `ensureFamilyBill` removed → case 4 red. Number-order sort removed, seeded so ids sort against numbers → case 1 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table takes any number of whole bills"`.

## Task 3a: who must own what (about 35 calls)

**Files.** `apps/server/src/bill-editing.ts`, `apps/server/src/table-actions.ts`, `apps/server/src/bill-editing.bill-moves.test.ts`.

- [ ] **Failing tests**, `describe("A803 split: editors")` in `bill-editing.bill-moves.test.ts`, calling `requireSplitEditors` in a transaction:
  1. A sole foreign editor on a whole bill passes (A773 §6; the existing case at `:280` stays green unedited).
  2. Two different editors on whole bills: `draft.taken_over` with `conflicts` both, sorted by id.
  3. A foreign editor on a loose source: refused, whatever the whole bills hold.
  4. A loose source of Ana and a whole bill of Luis: one refusal with both in `conflicts` (the till shows every row at once).
  5. The actor's own draft on either: passes.
  6. A staying bill with a foreign editor is not in the set and refuses nothing.
  7. `expected` missing one id, holding an extra, or unsorted: `management.request_invalid { field: "expectedEdits" }` (`parseBillEditExpecteds`, `readExpectedBillEdits`).
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
- [ ] **Implement.** Export `resolveMoveLines` and `reservedRefusal` (`requireBillOfParty` covers the closed-bill refusals, so `refuseClosedBill` stays private); extract `moveCheckedDishes(tx, cfg, from, to, transfers, { refuseHeld, actorId })` holding `:416-420`'s carve and bump, which `moveDishes` calls; `assertBillInvariant` stays with each caller, because a split runs it after every source has moved. D2 steps 4, 6, 9, 10.
- [ ] **GREEN.** The file; `src/move-dishes.test.ts`, `src/till-api.move-dishes.test.ts` (4a's unchanged, proving the extraction); the move sweep.
- [ ] **Deletion controls.** `insertPartyBill` at the source party → case 3 red with the gap. `refuseHeld: true` → false → case 9 red. `assertBillInvariant` removed → case 5 red. `leaveParty(newBill)` removed → case 6 red (its fired group stays the source's). Allergy after arrival instead of before → the allergy firing case from Task 2 red.
- [ ] **Commit.** `git commit -s -m "A803 4c: single dishes picked off any bill leave on one new bill"`.

## Task 4: MOVED slips name only the dishes that changed table (about 50 calls)

**Files.** `apps/server/src/table-actions.ts`, tests per rows 1–10, `apps/server/src/waiting-course-copy.test.ts`.

- [ ] Check Question 3's answer in `questions.md`. With no answer, build (A). Under (B) leave rows 6, 7 and 10 as they are and add the filter D6's question describes.
- [ ] **Failing tests**, `describe("A803 split: what the kitchen is told")` in `move-merge.test.ts` (it has `printedBy`, `byDish`, `stationWithPrinter`):
  1. "… a loose dish gets a notice and a slip naming only it, the source's other dishes nothing".
  2. "… a whole bill's dishes are told; a staying bill's are not".
  3. "… two sources give one slip each, each under the order number the dish was sent on".
  4. "… nothing selected tells the kitchen nothing".
  5. "… a loose held dish on HOLD paper prints under HOLD with its copy's number" (decoded print, `GRUPO 2`, in `waiting-course-copy.test.ts`, with 4b's helper), and later firing prints its FIRE ticket with the mark (4b's `T5.3` shape).
- [ ] Rewrite rows 1–10. Each stays at least as strict: `toEqual` on the whole list; a "no slip" row asserts `slips` is `[]` **and** that the printer took other jobs earlier in the case (a control that prints nothing because no printer exists would prove nothing).
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/move-merge.test.ts -t 'A803 split: what the kitchen is told'`: cases 1, 2 and 4 name the staying dish; 3 under the reach as built in 3b.
- [ ] **Implement.** D6. `withMovedSlips` stays for the other actions; `splitTable` no longer uses it. Delete its import here if unused.
- [ ] **GREEN.** The move sweep. New red outside rows 1–10 is a stop (R1 listed exactly these).
- [ ] **Deletion controls.** The `{ parties: [partyId] }` reach put back → cases 1, 2, 4 red. Reading a loose source's `before` after the carve → case 1 red (nothing told). Copy after the slips → case 5 red, `GRUPO 3`, as 4b's control 27.
- [ ] **Commit.** `git commit -s -m "A803 4c: the kitchen hears only about dishes that changed table"`.

## Task 5: the route learns the selection, and issues what a split leaves paid (about 45 calls)

**Files.** `apps/server/src/till-api.ts`, `apps/till/src/api/client.ts`, `apps/till/src/till-app.ts` (mapping only), new `apps/server/src/split-table.fiscal.test.ts`, `apps/server/src/till-api.table-actions.test.ts`, rows 11 and 17.

- [ ] **Failing tests.** `till-api.table-actions.test.ts`, `describe("A803 split: the route")`: selection through the route answers `{ partyId, billIds }` with `zoneRevisions` when the room moved; `requireSplitSelection`'s shapes, each `management.request_invalid { field: "selection" }` (not an object; `wholeBillIds` missing; a non-UUID; an entry with no `billId`; upper-case ids answered lower-cased); `billId` still works beside it; each code's HTTP status from `:599-629` for a loose refusal (`tab.line_not_found`, `bill.line_paid`, `bill.received_exceeds_total`, `tab.split_held_line`, `tab.transfer_modifier_line`, `sale.total_exceeds_simplified_limit`, `draft.taken_over` with `conflicts`). Add the same to the profile tables: `till-api.profile-actions.test.ts` and `.profile-zones.test.ts` keep their rows and gain a loose-selection case each (a loose source in a zone the device may not serve refuses `service_zone.not_allowed`; so `checkZones` gets every bill named, not only the party).
- [ ] `split-table.fiscal.test.ts`, `describe("A803 split: issuance")`, with the set-up of `till-api.fiscal-sale-paths.test.ts` copied, not imported, and no location:
  1. A loose pick of the last unpaid dish of an item-paid bill issues its one invoice in the same transaction: one sale, one `registros_facturacion` row, `status` settled, on the staying party.
  2. The new bill holds no sale.
  3. A whole part-paid bill issues nothing, whatever it holds.
  4. A loose pick that leaves the source still owing issues nothing.
  5. A refusal by the trading admission rolls the whole split back: no new party, table still joined.
- [ ] **RED.** `pnpm --filter @waitron/server exec vitest run src/split-table.fiscal.test.ts src/till-api.table-actions.test.ts -t 'A803 split'`: route answers `management.request_invalid { field: "billId" }`; case 1 finds no sale after Task 5's parse alone.
- [ ] **Implement.** D7, D10. `checkZones` gets `{ partyId }` and each `{ orderId }` of the selection. Client `splitTable(partyId, tableId, selection, revision, edits, guests)` with its doc comment rewritten; the app's existing call maps its `billId` to a selection and reads `billIds` (nothing on screen changes yet). Rows 11, 17.
- [ ] **GREEN.** Move sweep; F and Filing unedited; H2; till `src/api/client.test.ts`, `src/api/client.bill-editing.test.ts`; types.
- [ ] **Deletion controls.** `issueIfFullyPaid` loop removed → case 1 red ("0 to be 1"). Zone check of a loose source removed → the profile-zones case red. **`withIssuanceTransaction` has no control:** it differs from `withTransaction` only by recording an incident for an `IssuanceRefusal` (`packages/core/src/incidents.ts:30-48`), and `rg IssuanceRefusal apps/server/src -g '*.test.ts'` finds no server case that forces one. Say so in the PR rather than claiming it.
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

- [ ] **Failing tests.** `till-api.table-actions.test.ts`, `describe("A803 split: the panel's read")`: three bills, one part-paid, one presented, one abandoned, one a family bill: `{ bills }` lists the open and presented of this party in number order, with the same `lines` as `GET …/lines` and the same `balance` as `GET …/payments` where those answer; `paidLines` present; the presented bill's lines present. Unknown party → its code. Add the rows: the action map in `till-api.profile-actions.test.ts` (session only, passive) and a refusing row in `.profile-zones.test.ts` beside `PUT /api/parties/:id/drafts`. Passive: reading it does not keep a session signed in (the shape of the drafts read's case). `client.test.ts`: `getSplitSources(partyId, options)` builds the GET and passes the signal.
- [ ] **RED.** `… -t "A803 split: the panel's read"`: 404.
- [ ] **Implement.** D11. `readTabLines = assertTabOpen + readBillLines`, its other callers unchanged. One query per bill per reader; a party has few bills. Measure once with 20 bills of 20 lines at Task 17a and record the time rather than assuming; a slow answer is a finding, not a note.
- [ ] **GREEN.** The file; `src/transfer-lines.test.ts`; types.
- [ ] **Deletion control.** The status filter dropped → the abandoned bill listed, red. `readBillLines` back to `readTabLines` → the presented bill refuses, red with `tab.not_open`.
- [ ] **Commit.** `git commit -s -m "A803 4c: a read of every bill's dishes and balance for Split a table"`.

## Task 8: the selection model, `A803 selection` (about 55 calls)

**Files.** New `apps/till/src/state/split-selection.ts`, `.test.ts`. No DOM.

```ts
export interface SplitSource {
  bill: PartyBill;
  groups: PickGroups;
  /** Someone else's unsent dishes hold it: no tick until taken over. */
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
export function splitSummary(sources: readonly SplitSource[], split: SplitPicks): SplitSummary;
export function tidySplit(
  before: ReadonlyMap<string, readonly PickRow[]>,
  sources: readonly SplitSource[],
  split: SplitPicks,
): SplitPicks;
```

- [ ] **Failing tests**, titled `A803 selection: …`: ticking a bill takes all of it and clears its picks; unticking one row of a whole bill turns the rest into picks, in line order, up to each limit; whole-bill tick of a part-paid bill is allowed and untick leaves its paid rows out; every dish picked on a clean bill becomes whole; every **unpaid** dish picked on a part-paid bill does not; a contribution's floor: €40 on €52 stays within it after an untick, and allows €40.00 but not €39.99; a contribution marks no dish paid; a presented bill: header only, rows blocked `presented`, no pick accepted; a held bill: no toggle; `2 of 4` from a whole bill: unticking the Caña row drops all four, and a pick count keeps 4a's first-members rule; recalled dishes in no row; `toSelection` sorts whole by number and lines by line number, and never lists a bill twice; nothing ticked gives an empty selection; `nothingStays` with a paid bill left (true), with an empty open bill left (true), with an own unsent draft on a staying bill (false), with nothing ticked (false); `splitSummary` for board 08's example: T8 takes Bill 2, Bill 3 and 3 dishes from Bill 1, €109.00; T7 keeps the rest of Bill 1, €67.00, exact `Decimal`; a re-read that pays a picked dish drops it; a re-read where a whole bill is presented stays whole; where a whole bill left or gained a foreign draft, it drops; bill order independent of list order.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/state/split-selection.test.ts -t 'A803 selection'`: module missing.
- [ ] **Implement.** Over `pickRows`, `setCount`, `tidyPicks`, `pickedLineIds`; no second money formula (`billGross`, 4a's D12). `PickRow.blocked` gains `{ reason: "presented" }`; 4a's cases stay unedited. `SplitSelection` is a local type here, matching the wire; the screen reads it.
- [ ] **GREEN.** The file; `src/state/portion-selection.test.ts` unedited.
- [ ] **Deletion controls.** The normalise-to-whole step → its case red. Floor limit ignored on untick → the €39.99 case red. Paid exclusion → the part-paid case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the selection across a table's bills"`.

## Task 9: the picker across bills (about 60 calls)

**Files.** `apps/till/src/widgets/portion-picker.ts` (`whole`), new `widgets/split-picker.ts`, `.test.ts`, `.a11y.test.ts`, `i18n/strings.ts` (the picker's new words).

- [ ] **Failing tests**, `split-picker.test.ts`, titled `A803 selection: …` where they are selection, and otherwise plainly:
  - Header tick: `.checked`, `.indeterminate` for `some` (read the property, not an attribute), named by the bill's label.
  - A whole bill's rows draw ticked and pale with no stepper; a usable tick on each; unticking emits `split-picks` with the model's result; a paid row in a whole bill ticked and disabled, reason tied by `aria-describedby`.
  - Part-paid header `{amount} paid`; presented note, header usable, rows greyed; held bill: `table.others_draft` row with the name, Take over button named `table.take_over · {bill}`, `table.split_take_over_first`, no rows, no tick; `takenFromYou` words; own unsent note.
  - A bill's total drawn with `money`; a long name wraps; a bill with no sent dishes draws its header and `table.move_dishes_none`.
  - It holds no picks: emits and redraws only from its properties.
  - Events: `split-picks` and `split-take-over` are the app-owned widget's plain names, stopped at the source (`CLAUDE.md` §3, shared `wt-*` rule does not apply; follow `portion-picks`).
- [ ] `split-picker.a11y.test.ts`: axe in both themes for: nothing ticked; a whole bill; `some` with a stepped row; part-paid with a paid row; presented; held. Disabled rows' reason not by colour alone (master plan).
- [ ] `portion-picker.test.ts`: `whole` cases. Existing cases unedited.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/widgets/split-picker.test.ts src/widgets/split-picker.a11y.test.ts src/widgets/portion-picker.test.ts`.
- [ ] **Implement.** D13. Every colour, spacing and font from `--wt-*`; a pale row by `--wt-opacity-disabled` over text only; checkboxes sized as the picker's. Words: EN and ES, every Question 1 key this widget draws.
- [ ] **GREEN.** The three files; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`; till types; `pnpm format:check`.
- [ ] **Deletion controls.** `.indeterminate` assignment removed → its case red. `aria-describedby` removed → reason case red. Stepper shown under `whole` → board-08 case red.
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

## Task 11a: the panel on the table screen (about 65 calls)

**Files.** `apps/till/src/screens/till-table-order-screen.ts`, new `.split-table.test.ts`, `widgets/guest-count.ts`, words, rows 19 and 20.

The old `split-table-bill` step stays reachable behind a property the tests do not set until 12a, so the till works at this commit: **a new step `split-table-pick` is drawn only when the app has handed `splitSources`**; with none it falls back to the old step.

- [ ] **Failing tests**, `.split-table.test.ts` (S in "Deleted checks", opening cases): tapping a table opens the pick step; heading `{table} leaves {party}` in EN and ES, focused; a renamed table by its name; hint names the staying tables; rows from `splitSources`; steppers named `stayingGuests`, `leavingGuests`, labelled, prefilled, staying from the party's count; Split primary at once; the summary lines for board 08; the new-bill note only with a loose pick; Back returns to the tables, Escape too; Split dispatches `split-table` with `{ tableId, selection, guestCounts }` once and closes; nothing ticked sends an empty selection; a read in progress: Split quiet with `table.reread_failed` on a failed read; invalid counts per the Deleted-checks rows.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.test.ts`.
- [ ] **Implement.** Move the panel's body into `#splitPickStep`, in as few new lines as the screen allows, with sources handed down as a property. `guestsStepper` gains optional `name` and `label`, its comment moved to the callers it still describes. `SplitTableDetail` becomes `{ tableId, selection, guestCounts }`. Rows 19, 20 (the a11y scan needs a part-paid bill, a held bill and a whole bill in its fixture). A help bubble is not added.
- [ ] **GREEN.** `.split-table.test.ts`, `.table-menu.test.ts`, `.a11y.test.ts`; till types; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts`.
- [ ] **Deletion controls.** Staying prefill removed → its case red. Guest validation skipped → the four values red. `split-table` detail dropping `guestCounts` → its case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel with its ticks and guests"`.

## Task 11b: unsaved work, re-reads, refusals, everything ticked (about 60 calls)

**Files.** Same screen, new `.split-table.unsaved.test.ts`, `.split-table.test.ts`, row 21.

- [ ] **Failing tests**:
  - `.split-table.unsaved.test.ts` (U rows): opening untouched asks nothing; a tick, a stepped count or a typed guest count asks on Back, Escape, a ⋮ item, a bill switch and navigation, keeps on Keep and discards on Discard; ticks back to where they were, and counts typed back however spelled, are clean; an invalid count stays protected; Split commits with no question; rerender keeps it all; stored count follows an untouched side, not a typed one, and the baseline moves with it.
  - `.split-table.test.ts`: re-read cases: a picked dish paid elsewhere drops, with `Paid`; a whole bill gaining a foreign draft drops its tick and shows the row, and counts as changed; a party switch or the table leaving closes the panel, sending nothing; `splitRefusal` with a `field` reopens with what was sent, the message under that stepper, Split enabled; without a `field` reopens with picks and no field marked; a refusal for a table no longer held does not reopen; focus: after Split and after Back to the ⋮.
  - Everything ticked (D15): Split swaps to the question with both tables named; Move guests sends `table-relocation-open` then `move-guests` with the leaving table; Split anyway sends the split; a tick change returns to Split; Back returns to Split, not out; the note's table names plural when two stay.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.split-table.unsaved.test.ts src/screens/till-table-order-screen.split-table.test.ts -t 'unsaved|re-read|refusal|Everything'`.
- [ ] **Implement.** `ActionDraft` gains `whole`, `staying`, `leaving`; `#watchActions` includes the new step; `equal` compares with `samePicks` per bill and `sameGuestCount`; the follow-stored rule moves here from the dialog (finding 13). `#tidySplit` on `updated` as `#tidyMovePicks` compares sources by identity. Row 21.
- [ ] **GREEN.** Both files, `.actions-unsaved.test.ts`; till types.
- [ ] **Deletion controls.** `samePicks` for whole bills dropped → the clean-again case red. `#tidySplit` removed → paid-elsewhere red. Follow-stored removed → stored-count red. `actionVerb = "move"` omitted → Move guests red (the ready check at `:4818`).
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's panel keeps its work across re-reads and refusals"`.

## Task 12a: the app reads, sends and follows (about 55 calls)

**Files.** `apps/till/src/till-app.ts`, new `src/till-app-split-table.test.ts` (with the shared allergy fixture 4a's Task 8 used, in `apps/till/test/`), row 18.

- [ ] **Failing tests**:
  - Opening reads `getSplitSources` once; the answer goes down as `splitSources`; a later bills read with a changed `revision` reads again; an overtaken answer is dropped (generation); `partyId` change drops it; leaving the step aborts.
  - Send: `expectedEdits` are those of whole bills and loose sources, sorted; party revision from the shown party; `selection` and `guestCounts` as dispatched. D17: stays with the staying party; the bill on screen gone → `billToShow`; dishes gone from the bill on screen → lines re-read, bill kept; `#refreshBillDraft` after. `#ownBillsChange` wraps it, so a background read does not say "no longer at this table".
  - Different people (finding 9): a loose pick off a bill over the limit asks once and sends only after confirming; a whole bill over the limit asks nothing; a limit of null asks nothing; a loose source under the limit asks nothing.
  - `api.splitTable` is given `selection`, and Rows 18.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts`.
- [ ] **Implement.** `#splitSources` read and generation; `#onSplitTable` per D17, composition at Send (D20); `#askDifferentPeople(proceed, billIds = [activeTabId])`. Remove the `billId` mapping of Task 5.
- [ ] **GREEN.** The file; `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`; till types.
- [ ] **Deletion controls.** Composition of the shown bill only → the `expectedEdits` case red. Generation check removed → overtaken case red. `billIds` ignored by the question → the over-limit source case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the till reads every bill and sends the split"`.

## Task 12b: refusals and take-over rows (about 55 calls)

**Files.** `apps/till/src/till-app.ts`, `till-app-split-table.test.ts`, `till-app-table-service.test.ts` (its refusal table, as 4a's Task 8 added `move-dishes` rows).

- [ ] **Failing tests**, one per row of D16's table: what is said, what is re-read and what is not, that `splitRefusal` reopens the panel, and that a refusal arriving after the waiter left the party or the table does nothing. Named: `bill.received_exceeds_total` offers "Refund {amount}" on the bill named in its params, and a bill not on screen is named in front of the words; `draft.taken_over` runs `sync.load()` so rows appear; `party.out_of_date` reloads (`#onPartyOutOfDate`). A refused count does not read anything.
- [ ] Take-over rows: `split-take-over` opens the screen's take-over dialog; confirming calls `sync.takeOverOn`; `takeOversAnswered` moves on; a refusal shows `takeOverRefusalError`; the row goes after a successful read; `#takeOverClosed` focuses the row's button while it is still there and the bill's tick otherwise.
- [ ] **RED.** `pnpm --filter @waitron/till exec vitest run src/till-app-split-table.test.ts -t 'refus|take-over'`.
- [ ] **Implement.** D16, D18. The screen's `takeOverPending` learns a `billId`, or a bill-less draft keeps today's path. A named refusal uses `#refusedDestination`'s rule, generalised to any bill of the selection.
- [ ] **GREEN.** The file; `.split-table.test.ts`; `src/screens/till-table-order-screen.test.ts` take-over cases unedited.
- [ ] **Deletion controls.** Bill name in front removed → its case red. Reopen removed → reopen case red. `takeOverOn` → `takeOver` → the row's case red with the on-screen bill's edit.
- [ ] **Commit.** `git commit -s -m "A803 4c: Split a table's refusals say what happened and keep the picks"`.

## Task 13: A590 (about 35 calls)

**Files.** `apps/till/src/till-app.ts`, `screens/till-floor-screen.ts`, `state/floor-today.ts`, `till-app-table-service.test.ts`, `till-floor-screen*.test.ts`.

- [ ] **Failing test.** `till-app-table-service.test.ts`, `A803 applies split room revision before reload`: tables at revision 1; `splitTable` answers `zoneRevisions: { [zone]: 9 }`; the next `getTablesState` is held (R5's mechanics); `back-to-floor`; a floor edit through the shortest control in reach (`[data-update-layout]` as `till-app-floor-layout.test.ts:127-135` presses it, with that file's zone set-up; or the details sheet); assert the API got revision **9**, and no `floor_today.out_of_date` shown. Release the read: it wins afterwards.
- [ ] A handheld twin, set up as `till-app-parties.test.ts:1571-1580`: the floor mounts after the split and still sends 9.
- [ ] `till-floor-screen`: a poll started **before** the answer and applied after it does not replace the carried revision; a read started after it does; own `#carried` newer than the app's wins, and the reverse.
- [ ] **RED and first probe.** `pnpm --filter @waitron/till exec vitest run src/till-app-table-service.test.ts -t 'A803 applies split room revision'`. What the failing case prints: the API called with revision 1. If it prints 9 before any fix, the window cannot be hit: stop and record that (A590's own "or confirm the window cannot be hit").
- [ ] **Implement.** D19.
- [ ] **GREEN.** The two files; `src/screens/till-floor-screen.today-joins.test.ts`; till types.
- [ ] **Deletion control.** The store on answer removed → red, revision 1. `tablesReadAt < answeredAt` dropped → the read-after case red.
- [ ] **Commit.** `git commit -s -m "A803 4c: the floor keeps the room's revision a split answered (A590)"`.

## Task 14a: the old window and steps go (about 45 calls)

Waits for Question 2. Built on its default; the PR cannot land until it is answered.

- [ ] Consumer trace, run first and listed in the ledger:
  `rg -n 'split-guests|SplitGuests|split-table-bill|split-table-open|splitTablePrompts|split_table_bill_heading|split_no_bill|split_guests_title' apps docs/developers docs/operations scripts`.
- [ ] **Failing check.** It cannot be red by a test; the check is that `rg` above prints only the historical dated plans after the edit (4a's Task 9b precedent).
- [ ] Delete `widgets/split-guests-dialog.ts`, its three test files, the screen's `split-table-bill`, `#splitGuestsDialog`, `#splitTableBills`' bill buttons, `split-table-open`, and the words. Delete the screen cases in "Deleted checks" whose new home now exists, confirming each home exists by name.
- [ ] `design-system.md:2871`, `:2883`, `:1090-1095`: name the panel's guests, not the window, and the focus sentence. `conventions-data.md:4727` stays true (`guestCounts`).
- [ ] **GREEN.** All of `src/screens/till-table-order-screen*.test.ts`, `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`, `src/widgets/split-picker*.test.ts`; till types; `pnpm exec vitest run scripts/native-form-fields.test.ts`.
- [ ] **Commit.** `git commit -s -m "A803 4c: the one-bill split steps and guests window go"`.

## Task 14b: the old request goes (about 35 calls)

- [ ] `rg -n "billId" apps/till/src/api/client.ts | /usr/bin/grep -i split`, and the server's parse: `selection` required. Answer `{ partyId, billIds, zoneRevisions? }`.
- [ ] Rows 11–14. `oneBill(id)` in the fixture answers `{ wholeBillIds: [id], loose: [] }`; `null` answers an empty selection.
- [ ] **Failing test.** `till-api.table-actions.test.ts`: a body with `billId` and no `selection` refuses `field: "selection"`. **RED** on Task 5's code.
- [ ] **GREEN.** The move sweep; `till-api.profile-actions`, `.profile-zones`, `.zone-closed`, `attendance-arriving-groups`, `floor-catch-up`, `today-names`, `till-device-proof`, `table-actions.refund-pending`.
- [ ] **Commit.** `git commit -s -m "A803 4c: the split route takes only a selection"`.

## Task 15: guides and the design contract (about 30 calls)

- [ ] EN and ES: the section of Question 1 in `guide/{en,es}/table-service.md`, before `{#held-dishes-move}`, one heading `{#split-table}` in both. Write each sentence from the code built and keep it only if it changes what staff do (root `CLAUDE.md` §3, A803 4b's Build record). Check the ES names against the till's strings by `rg`, not memory: **Tomar el pedido**, **Mover clientes**, **Separar**, **Separar igualmente**.
- [ ] Remove nothing else, and leave `#held-dishes-move` as the owner cut it. `table-service.md:345-346`'s "A table split off with a bill starts again at Bill 1" stays true and gets "with bills". If a sentence there is now untrue, fix it in both languages.
- [ ] `design-system.md` "The dish picker" (`:5795`): the whole-bill header, `whole` rows, the summary and notes, take-over rows, presented and everything-ticked, in the section's present-tense form, each guard named with what it does not see.
- [ ] **G.** Guide checks; `git diff --stat` shows both twins.
- [ ] **Commit.** `git commit -s -m "A803 4c: guides and design contract for Split a table's picker"`.

## Task 16: LOOK (about 45 calls; no commit unless a defect is fixed, test first)

- [ ] `memory_pressure | grep free`; `wa-wt demo waitron-feat-a803-4c-split-table-picker`. Screenshots stay in `~/waitron-campaign-c/a803-4c-look/`; never commit or copy them to Drive; show them to the owner directly.
- [ ] EN and ES, light and dark, 390 and 1280 px, and compare with the boards in `boards/`:
  - **Board 08:** nothing ticked; one bill whole (pale rows); `some` with a stepper at "2 of 4" and "1 of 2"; a dish on hold among the rows; the summary, the note and the steppers; a long dish name; a named bill and a long party name; four bills, to judge scrolling in the 22rem panel.
  - **Board 09:** after the split, both tables, the new table's Bills 1, 2, 3; the staying bill on screen; the kitchen's decoded MOVED job for only the dish that moved (decoded, not paper; physical printing stays unmeasured).
  - **Board 10:** a part-paid bill, its paid row, `{amount} paid`; a contribution's floor-greyed row; a take-over row before and after; everything ticked, with Move guests and Split anyway; nothing ticked.
  - A presented bill. Refusals: a dish paid from another tab then Split, its banner beside the reopened panel at 390 px (the Departures row); a refused count under its stepper.
  - Keyboard: Tab order, Space on a tick, Enter from a stepper, focus to the heading on open, focus back to the ⋮ after Back.
  - **Touch:** steppers and ticks at `--wt-tap-min` at 390 px. A1265 (⋮ taller than the room) untouched, but measure and record.
- [ ] A defect found is fixed test first in its own commit or added to the backlog in Task 18. A wording that does not fit updates Question 1 before landing.

## Task 17a: the whole slice (no commit; about 30 calls)

- [ ] Every guard suite above, each status read. `pnpm --filter @waitron/till exec vitest run src/state src/widgets/portion-picker.test.ts src/widgets/split-picker.test.ts src/widgets/split-picker.a11y.test.ts src/screens/till-table-order-screen.split-table.test.ts src/screens/till-table-order-screen.split-table.unsaved.test.ts src/screens/till-table-order-screen.a11y.test.ts src/screens/till-table-order-screen.table-menu.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/till-app-split-table.test.ts src/till-app-parties.test.ts src/till-app-table-service.test.ts src/till-app-drafts.test.ts`, after checking free memory.
- [ ] Task 7's timing: 20 bills of 20 lines, time the read, record it.
- [ ] Audits: `rg -n 'locationId|location_id' <every new test file>` prints nothing; `rg -n 'A803 selection|A803 split|A803 race replay|A803 applies split room revision'` lists every named case; `rg 'split-guests|split_no_bill'` prints only dated plans; the Schema diff prints nothing; `git diff --stat <merge base> -- packages/fiscal-verifactu` prints nothing.
- [ ] Spec walk, §3.7 line by line, naming the test per line, in the ledger. CI owns package coverage; do not add a whole-workspace run for this.

## Task 17b: deletion controls re-run (no commit; about 60 calls)

- [ ] Re-run each deletion control of Tasks 1–13 at the current head, one at a time: name the edit, the case, the red message, green after restore, in the ledger. A control that stays green is a finding: find out why before going on. Restore with `git checkout -- <file>`, then `git status --short` is empty.

## Task 18: backlog, record pass, PR (about 30 calls)

- [ ] `docs/backlog.md`: delete A590 and `docs/backlog/till.md`'s A590 detail (its check passed, Task 13), its decision left where a comment cites it (`rg A590`). A803's entry and detail (`docs/backlog.md:2050`, `docs/backlog/till.md:2996`): 4c has landed; pre-bills remain, through A446. A1327's and A1333's texts gain finding 14's sentence.
- [ ] New short entries, each only if still true: Join and Move guests from the order screen drop the room revision (finding 11); A773 §6's take-over rows are built for Split a table only and not for joins and moves (finding 7); a LOOK finding left open; A1192 still prints a slip per portion; if Question 3 stays at (A), the "name gone" case as an open question with a pointer to it.
- [ ] Dated one-line pointers, never rewrites: spec §3.7 "Bill numbers"; `2026-11-01-a803-4-portion-picker.md` Cut 4c: "built from `2026-11-04-a803-4c-split-table-picker.md`, whose findings correct this outline".
- [ ] **Record pass.** Append "## Build record (4c)" to this plan: what was built versus planned, departures with reasons, line numbers that moved, the control table.
- [ ] PR body in plain English: what the waiter and the kitchen see; no venue reset, no schema change; "Changed test checks" (the 21 rows) and "Deleted checks"; "For the owner": Questions 1 and 2 block landing; 3 and 4's defaults; that the route now issues an invoice for a bill it leaves fully paid, by the function Move dishes calls, no fiscal function changed, and that the lane's "truly fiscal PRs wait for the owner" rule is the driver's to judge on that sentence. Then `/finish-branch` with this plan named.
- [ ] Ledger `Status: in progress` until landed.

## Task list and sizes

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight, questions posted, ledger | 15 | no commit |
| 1 | allergies follow any number of bills | 30 | green |
| 2 | several whole bills leave together (`A803 split`) | 65 | green |
| 3a | who must own what | 35 | green |
| 3b | loose dishes on one new bill (`A803 split`) | 60 | green |
| 4 | MOVED only for moved dishes; rows 1–10 | 50 | green |
| 5 | route takes the selection; issuance | 45 | green |
| 6 | `A803 race replay` | 45 | green |
| 7 | one read for the panel | 45 | green |
| 8 | selection model (`A803 selection`) | 55 | green |
| 9 | picker across bills, a11y | 60 | green |
| 10 | take-over on any bill | 45 | green |
| 11a | panel, ticks, guests | 65 | green |
| 11b | unsaved work, re-reads, refusals, everything ticked | 60 | green |
| 12a | app reads, sends, follows | 55 | green |
| 12b | refusals and take-over rows | 55 | green |
| 13 | A590 | 35 | green |
| 14a | old window and steps go (Question 2) | 45 | green |
| 14b | old request goes | 35 | green |
| 15 | guides, design contract | 30 | green |
| 16 | LOOK boards 08–10 | 45 | no commit |
| 17a | whole slice | 30 | no commit |
| 17b | deletion controls | 60 | no commit |
| 18 | backlog, record pass, PR | 30 | green |

About 1,100 calls in 24 tasks, none planned above 65. The outline guessed 12 tasks.

## Against the master plan's slice 4

| Master plan item | Where |
| --- | --- |
| `A803 split`: two of three whole plus loose; each whole intact; loose as one new bill; any bill stays; none → empty; all → Split anyway; guest counts; allergies | Tasks 2, 3b, 1 |
| A669: known answer and unknown state | Task 1 |
| A666, A757 intact | Task 2 case 11 |
| `A803 selection`: whole-bill toggles, deselect becomes loose, a whole part-paid bill | Task 8, Task 9 |
| `A803 race replay` for splits, two tills on one party, lost reply | Task 6 |
| Recheck every `BillEditExpected`, ask take-over, no bulk | D4, Tasks 3a, 10, 12b |
| Decoded MOVED names only moved dishes | Task 4 |
| Cancel, Escape, navigation, switch bill, reconnect; reason not by colour alone | Tasks 9, 11b |
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
  at `till-app.ts:18988-19080`; Task 13's twin runs it), and no floor edit was sent, so A590's window
  itself is still unmeasured: Task 13's RED step measures it, and says what to do if it cannot be hit.
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

### Could not be established at planning

- Whether A590's window can actually be hit (R5's limit).
- Whether the action panel's 22rem width carries four bills, steppers and the summary. Task 16 decides;
  a change of panel width is a shared layout matter, so it goes to the owner rather than being widened
  here (board 08 draws it wider).
- The time of `GET split-sources` at size (Task 17a).
- Whether a bill can reach `tab.split_held_line` in real table service: 4a kept the refusal, 4c follows
  it, and Task 3b's case builds the state by hand.
