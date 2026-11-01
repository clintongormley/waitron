# A803 slice 4: one dish picker — task plan, cut into three pull requests

**Goal.** At a table, a waiter moves some of the dishes on the bill on screen to another bill of the
table, or to a new bill, in one step: **Move dishes…** in the ⋮ opens one picker listing the bill's
dishes, identical dishes as one row with an "n of m" count, weighed dishes as whole ticks, paid
dishes and dishes the bill's received money must keep greyed with the reason, and one Move. It
replaces **Split by item** and **Transfer items**. Unpaid dishes may leave a part-paid bill, into an
existing bill or a new one. Later cuts let **Split a table** use the same picker across every bill,
and let dishes waiting for their course leave with their own still-waiting copy of the course.

**Implements.** [Master plan](2026-10-19-a803-bills-and-tables.md), "Slice 4: one portion picker and
independent waiting-course copies", under its "Global constraints and release gates", "Review focus"
items 3 and 5, "Builder decisions and proposed contracts" ("Portions and selection", "Deterministic
count picker", "Monetary stop condition"), "Shared execution and verification contract" and
"Recorded move/join/split defects" (the A590 row). All binding except where "Departures" says
otherwise and why. [Spec](../specs/2026-10-18-a803-bills-and-tables-design.md) §3.1 (no partial cut
of a weighed dish), §3.6, §3.7, §3.8, §6 (whole-bill moves get the course copy; the received-money
floor; MOVED only for what moved), §7 (which identical portions a count picks). The owner's
amendments of 2026-10-18 (lane C queue, A803, items 1–5) concern slice 3's controls; this slice
keeps what slice 3 built from them.

**The cut (why three pull requests).** Slice 3 became 28 tasks and about 33 hours. Read against the
current code, slice 4 is about the same size, and its parts are independent:

| Cut | Branch | What it ships | Lands on its own because |
| --- | --- | --- | --- |
| **4a** (this plan, full detail) | `feat/a803-4-portion-picker` | **Move dishes…**: the selection model, the picker widget, one atomic server command `POST /api/bills/:id/move-dishes`, unpaid dishes out of a part-paid bill, the received-money floor in the picker, no partial cut of a weighed portion (A1195); Split by item and Transfer items leave the till | It touches only same-party moves; Split a table and course groups are unchanged |
| **4b** (outline) | `feat/a803-4b-waiting-course-copies` | A dish waiting for its course may leave its party with **Move this bill** and with today's one-bill **Split a table**: the destination gets its own still-waiting copy of the course; both fire independently; MOVED slips name only moved dishes | Server-only plus refusal wording; uses no picker |
| **4c** (outline) | `feat/a803-4c-split-table-picker` | **Split a table** through the 4a picker: any whole bills plus loose dishes (one new bill at the leaving table), guest counts in the same window, everything ticked → Move guests / Split anyway, nothing ticked → empty bill, take-over rows; MOVED for moved dishes only; A590 | Needs 4a's widget and 4b's copies; nothing else waits on it |

Each cut leaves `main` green and working. 4a is planned task by task below; 4b and 4c are outlined
at the end with their order and gates, and each gets its own task plan (and fresh plan review) when
it starts.

**Execution.** `trial: inline`: the lane's driver session writes each task's tests and code itself,
test first, task by task; after each task a separate high-effort reviewer reviews it (review weight
**FULL**: a cross-package wire contract between server and till, concurrency on bills another till
can pay or take over, and the received-money floor). Worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a803-4-portion-picker`, branch
`feat/a803-4-portion-picker`, planned from main `e5bfb0b07`.

**Task size and end state.** Each task is sized for one focused sitting of about 40–70 tool calls
(estimate in its heading). Each ends with `pnpm --filter @waitron/server typecheck` and
`pnpm --filter @waitron/till typecheck` clean and its touched files' focused suites green. No task is
planned to end red. If one does, stop at a cleanly red point, list the failing files and cases in the
ledger, and make them green first in the next sitting.

**A working product at every commit.** Task 7a adds Move dishes… to the ⋮ beside Split by item and
Transfer items; Task 9a takes those two off the screen and 9b retires their handlers. The server keeps `/split` and `/transfer` (A1196 retires
them). So every commit of 4a is a working till against a working server.

## Owner answers

**Added 2026-11-01, after the build (the text below this paragraph is as planned):** all four
questions were answered in lane C's `questions.md`. Question 2: yes, the old checks go. Question 1:
the words as proposed, and the grey reason gains what to do — "{amount} is already paid on this
bill: move fewer dishes" / «Ya se han pagado {amount} en esta cuenta: mueve menos platos». Question
3: dishes MAY move onto a bill that already has a payment; it owes more afterwards and Merge bills
still refuses such a bill. That replaces D4's "holding no payment", D14's destination list and the
"other bills with no payment" checks of Tasks 7a and 11; D5 still holds, because a move only adds
dishes and no price is negative. Question 4: the default (one tap takes the whole row).

None yet for slice 4. The defaults under "Owner questions" are what the build uses. **Question 2
(deleted till checks) is written to `~/waitron-campaign-c/questions.md` at Task 0**, before any file
it names is edited; the build goes ahead on its default meanwhile, as the owner's 2026-10-05 rule
allows, and the PR cannot land until it is answered. Questions 1, 3 and 4 go to `questions.md` and
the PR at Task 13, with Task 12's pictures.

Earlier owner answers this plan applies are under "Owner decisions this plan applies".

## Read this first: what the planning pass found

Line numbers are at `e5bfb0b07`. All of this was read, not run, except where a command is named.

1. **The till has no portion ids, and does not need them.** `portionId` appears nowhere in
   `apps/till/src` outside tests (`rg -n portionId apps/till/src -g '!*.test.ts'` prints nothing).
   The till reads `portion: boolean` per line (`readTabLines`, `apps/server/src/working-order.ts:4186`,
   mapped `:4293`), and a bound line and its portion are one-to-one: `working_line_portions` has the
   line as primary key and the portion unique (`packages/db/src/schema/order-portions.ts:28`), and a
   whole-line move updates the line in place, so the line id survives and its binding goes with it
   (`moveOrderLines`, `working-order.ts:3994`, writes the `moved` portion event at `:4070`). Slice 1's
   D31 already names a row's portions by their **line ids** (`lineIds`) for comps, discounts and
   cancels. Move dishes does the same (D2).

2. **What Split by item and Transfer items do today** (`apps/server/src/bill-actions.ts`):
   - `splitBill` (`:162-199`) puts chosen lines on a new bill; the source may be part-paid (paid
     quantities stay, `refusePaidLines`; the floor `assertBillInvariant([billId])`); it refuses a
     presented, paid or abandoned source (`refuseClosedBill` `:88`) and a dish the kitchen holds
     outside a held group (`carveOffLines(..., { refuseHeld: true })` → `tab.split_held_line`).
   - `transferItems` (`:277-312`) moves chosen lines to an existing bill; **both** bills must be
     untouched (`requireUntouchedPair` `:141-154`: no payment of any kind, not presented), so a
     part-paid bill cannot give dishes to an existing bill (spec §3.8 changes this for the source).
   - Both take `Transfers = { lineNo: number; quantity?: string }[]` (`:47`), so both can cut part
     of a line. A part cut gets **no** portion binding and no portion event (`carveLines`,
     `working-order.ts:4548-4935`, has no portion code), which is backlog A1195's defect when the line
     is a bound weighed portion.
   - The split route issues the source's invoice when the split leaves it fully paid
     (`issueIfFullyPaid`, `apps/server/src/till-api.ts:4135`, inside `withIssuanceTransaction`); the
     transfer route does not, because its source can hold no payment (`:4210-4237`).
   - A pending payment or refund on either bill refuses both, through `bumpRevision` →
     `refusePaymentInFlight` (`working-order.ts:5517`, `order.payment_in_flight`).
   - Both send kitchen MOVED slips with `enqueueMovedSlips(tx, cfg, before, to, splitFrom)`
     (`apps/server/src/kitchen-print.ts:1543`).

3. **The till's pickers today** (`apps/till/src/screens/till-table-order-screen.ts`, "TOS"): the ⋮
   (`#tableMenu` `:5389-5459`) offers Split by item, Transfer items and Merge bills on an open bill
   with no payments, and only Split by item on one with payments (`:5428`). Modes
   `ActionStep = "closed" | "pick" | "transfer-lines" | "split-lines" | "split-table" | "split-table-bill"`
   (`:391-392`); rows are `#pickerRows()` (`:5082`), grouped by `portionGroups` with
   `#fallbackPortionKey` (`:2631`, which adds the paid quantity and the allergy guest, and makes a
   partly paid line stand alone). A grouped Split row takes its **first** members by line number
   (`#stepSplitGroup` `:5169`; `#tidyPickedPortions` `:5093` keeps it so after a refresh). Picks are
   keyed by line number. Transfer moves a grouped row whole (`#toggleTransferLine` `:5130`). The
   staged picks sit in the screen's action draft scope (`ActionDraft` `:234-239`, `#watchActions`
   `:1301`), guarded by `till-table-order-screen.actions-unsaved.test.ts`. There is no `wt-checkbox`;
   the pickers draw `<button aria-pressed>` with ☑/☐ (`:5662`); native checkboxes are used in
   `widgets/finish-table-dialog.ts:374`, `cancel-item-dialog.ts:519`, `bill-pay-dialog.ts:1596`, and
   `scripts/native-form-fields.test.ts:138` allows `<input type="checkbox">`.

4. **The app's handlers** (`apps/till/src/till-app.ts`): `#onTransferLines` (`:15946`) and
   `#onSplitLines` (`:15978`) both run `#billComposition` (`:15841`) for the bills' revisions and
   expected editors, then `#askDifferentPeople` (`:15904`, the simplified-invoice limit question),
   then the API call inside `#ownBillsChange` (`:11639`). Refusals: `tab.transfer_modifier_line` →
   `table.split_modifier_error`, `tab.split_held_line` → `table.split_held_error`, money refusals →
   `#onBillMoneyRefusal` (`:15775`, which offers "Refund {amount}" for `bill.received_exceeds_total`),
   the rest → `#onBillPairRefusal` (`:15767`) or `#onTableRefusal`. A split shows the new bill
   (`#chooseBill(split.billId)`); a transfer stays on the source. Then `#reloadOrder` (`:11906`) and
   `#refreshBillDraft`.

5. **The till can know the floor and paid dishes before Move.** `BillBalance`
   (`apps/till/src/api/client.ts:1203-1218`) carries `total`, `received`, `reserved` and
   `paidLines: { lineId, lineNo, paidQuantity }[]`; the screen already reads it for paid marks
   (`paidQuantities`, `apps/till/src/state/bill-payment.ts:330`). So a tick whose dishes would leave
   the bill owing less than `received + reserved` can be greyed before Move, as spec §6 asks; the
   server's `assertBillInvariant` stays the authority.

6. **Approved words that fit, and the ones that do not exist.** Approved: `table.new_bill`
   ("+ New bill" / «+ Cuenta nueva», slice 3), `bill_pay.paid` ("Paid" / «Pagado»),
   `bill.received_exceeds_total_excess` ("Moving these items would leave this bill owing {amount}
   less than has already been paid on it. Move fewer items, or refund {amount} first." / «Al mover
   estos artículos…», `strings.ts:1505`, `:3275`), `table.split_held_error`, `table.move_line`
   ("Move to…" / «Mover a…»). Not present: "Move dishes…", an "{n} of {m}" pick count, and the greyed
   tick's reason "€40 is already paid on this bill" (`rg` for "already paid on this bill" finds only
   `bill_pay.items_none`). Those are Owner question 1.

7. **Waiting dishes cannot leave their party today, and arriving dishes are regrouped by course.**
   (For 4b; recorded here because 4a's design must not depend on it.) `leaveParty`
   (`apps/server/src/move-bill.ts:507-543`) refuses a line in a held group, `group.held_leaves_party`
   (`refuseHeldLeavingParty`, `working-order.ts:4865-4881`), on Move this bill, Move to counter and
   Split a table. `groupArrivingDishes` (`apps/server/src/order-groups.ts:2431`) puts arriving ungrouped
   dishes into one new fired group plus one new **held group per course whose course is
   `heldUntilFired`**, and fires the rest at once. So simply lifting the refusal would fire a dish
   whose group was held by hand on a course that does not wait by itself. Within one party a held
   group spans bills (a line names its group, `working_order_lines.group_id`), so 4a's moves between
   bills of one party keep each dish in its group, as `splitBill` and `transferItems` do today.

8. **Split a table tells the kitchen about dishes that did not move.** (For 4c.) Its MOVED reach is
   the whole party (`withMovedSlips(tx, cfg, { parties: [partyId] }, …)`,
   `apps/server/src/table-actions.ts:320`), and a staying bill loses the leaving table from its places,
   so its dishes get a MOVED notice too; `party-table-actions.test.ts:1466-1482` pins this ("PAELLA
   on the staying bill gets `moved_to`"). Spec §3.7: "The kitchen gets a MOVED notice for the dishes
   that changed table only." 4c changes it.

9. **A durable replay exists, and 4a does not need it.** `runServiceCommand` (`apps/server/src/parties.ts:873`,
   table `service_commands`) answers a resent submission. Split, transfer and merge do not use it; the
   party revision refuses a resend (`party.out_of_date`) and the bill revisions refuse a stale edit.
   The master plan's "do not promise success replay without an existing durable command contract"
   is met by not promising it: a lost reply followed by a resend is refused and the till re-reads
   (D9).

10. **Write transactions are taken in turn.** The store runs one write transaction at a time
    (CLAUDE.md §3, "Multi-table writes share ONE transaction"; `withTransaction`), and the existing
    race cases run the winner, then the loser on the stale read (`party-table-actions.test.ts:1527-1550`).
    The master plan's "promise barriers" are not needed for two server commands: the loser is the
    one that commits second, and the test is that it is refused with nothing changed. The till side's
    "late answer" races keep the existing composition checks (`#billCompositionCurrent`).

## Scope

**In (4a).** A pure selection model for one bill's dishes (`state/portion-selection.ts`); a picker
widget (`widgets/portion-picker.ts`) with ticks, "n of m" counts for identical portions, whole ticks
for weighed dishes, greyed paid dishes and greyed floor-breaking ticks with their reason; one server
command `moveDishes` and route `POST /api/bills/:id/move-dishes` that moves named whole dish lines
(with their extras, portion ids, tickets and kitchen state) to an existing bill of the party or to a
new bill, allowing a part-paid source, keeping the floor, issuing the source's invoice when the move
leaves it fully paid (as Split by item does); the ⋮'s **Move dishes…** replacing Split by item and
Transfer items; Split by item, Transfer items and Move dishes never cut a bound measured (weighed)
portion when moving it to another bill (A1195, Task 1). Partial paths inside one bill stay as they are: a part
discount, a part moved to another course group, a station split, part serves and part cancels of a
measured portion (`order-portions.filing.test.ts:665` pins a part cancel), all under A1196. EN/ES
guides and the operator runbook; the design-system contract; LOOK; backlog.

**Out of 4a.** Split a table's picker, whole-bill ticks, guest counts and the four awkward cases
(4c); waiting-course copies on any path (4b); A590 (4c); retiring the server's `/split` and
`/transfer` routes and the partial-quantity paths (A1196, after 4a: the till no longer calls them);
choosing which portions a comp, void or Fire now takes (A1193 stays; the picker is for moves only);
Finish table's grouped cancels (A1194); A739's payment window; any change to issuance, the hash
chain or filing (H2); bill names on paper (owner, 2026-10-30: never).

**Backlog items, and how each closes.** An entry is deleted only after its own check passes.

| Item | 4a? | Closing check |
| --- | --- | --- |
| A1195 (a weighed portion can be cut) | **Closes in 4a** (Task 1) | `A803 A1195:` cases in `order-portions.lifecycle.test.ts`: a part split and a part transfer of a bound 0.350 kg portion to another bill are refused `tab.transfer_quantity_invalid` with every row unchanged; a part of the same bound line split inside its own bill (`splitLinesWithinOrder`, what a part discount and a course-group move use) is unchanged; an unbound weighed line still splits (`transfer-lines.test.ts:372` unchanged and green); deletion control turns the refusal cases red. A1195's text is about "a partial split or transfer" (`docs/backlog.md:2132-2135`); A1196 keeps the in-bill partial paths |
| A1193 (which portions an action takes; Fire now) | No | Retained; its text gains "Move dishes… picks a row's first portions (4a); comp, void and Fire now are unchanged" |
| A1194 (Finish table cancels one at a time) | No | Retained |
| A1196 (retire partial-quantity paths) | No | Retained; its text gains "since 4a the till calls neither `/api/bills/:id/split` nor `/transfer`" (Task 13, after `rg -n "/split\`|/transfer\`" apps/till/src -g '!*.test.ts'` prints nothing) |
| A590 (split-table revision) | No (4c) | 4c's `A803 applies split room revision before reload` |
| A1256, A1258 (`wt-row-actions` keys, resize) | No | The picker uses no `wt-row-actions` |
| A1261 (full invoice for a paid bill) | No | Waits for A802 |
| A1263, A1264, A1266, A1267, A1269 | No | Untouched paths |
| A1265 (⋮ taller than the room) | No | Retained; 4a makes the bill section one item shorter (two items become one); the entry gains that fact, with the LOOK's measured heights (Task 12) |
| A1198 (moved out and back rejoins its row) | No | Owner question from slice 1, unchanged |

**Venue reset.** Not needed for 4a: no schema change.

**Spanish.** New strings are proposals, built behind approval (Owner question 1). Everything else
the picker shows reuses an approved string (D11).

| Key (proposed) | English | Proposed Spanish | Built from |
| --- | --- | --- | --- |
| `table.action_move_dishes` | `Move dishes…` | `Mover platos…` | `table.move_line` «Mover a…»; «platos» as in `bill_pay.unsent` «platos sin enviar» |
| `table.move_dishes_heading` | `Move dishes from {bill}` | `Mover platos de {bill}` | `table.move_bill_heading` «Mover {bill} a:» |
| `table.move_dishes_to` | `Move to` | `Mover a` | `table.move_line` without the ellipsis |
| `table.move_dishes_confirm` | `Move` | `Mover` | the verb of `table.action_move_bill` |
| `table.move_dishes_none` | `No dishes to move` | `No hay platos para mover` | `table.transfer_no_lines` «No hay artículos para transferir» |
| `table.pick_count` | `{count} of {total}` | `{count} de {total}` | `bill_pay.paid_part` «{paid} de {quantity} pagados» |
| `table.move_dishes_floor` | `{amount} is already paid on this bill` | `Ya se han pagado {amount} en esta cuenta` | spec §6's own example; `bill.received_exceeds_total` «lo que ya se ha pagado» |

## Owner decisions this plan applies

- **Spec §3.6**: Move dishes… replaces Split by item and Transfer items; dishes come from the bill
  on screen and go to another bill of the table or a new bill; dishes move only between bills of
  one party.
- **Spec §3.8 / §6**: a part-paid bill's **unpaid** dishes can move to an existing or new bill; paid
  dishes cannot be picked off; a part-paid bill cannot be merged (Merge stays strict); the picker
  greys a tick that would leave the bill owing less than it has received and says why.
- **Spec §3.1, owner at slice 1's landing (2026-10-29, "Land 2232" with defaults)**: a weighed dish
  is never cut; its refusal was deferred to slice 4 (A1195).
- **Owner, 2026-10-28 (slice 1 question, answer (c))**: a comp, discount or cancel on a grouped row
  covers every portion; "slice 4's picker then becomes the way to act on SOME of the portions". 4a
  applies this to moves only; the row actions keep their counts (A1193 retained, D13).
- **Owner, 2026-10-30, slice 2 Q1**: bill names never on kitchen paper. Nothing here prints one.
- **Owner, 2026-10-31, slice 3 Q1**: the switcher reads "Bill 4 · 2 bills"; the picker's bill
  labels use the same short label (`#billName`).
- **Owner's test-change rule (2026-10-05)** (`~/waitron-campaign-c/queue.md`, "⚠ OWNER DECISION
  2026-10-05 ~00:05"): a check may change without asking where it pins behaviour this slice
  deliberately changes, to check the new behaviour at least as strictly. **Still a stop, asked in
  `questions.md` while other work carries on:** a change to a golden hash, `inmutabilidad` or any
  other fiscal hash or filing test; a change to a guard under `scripts/`; a deleted or weakened
  check; a check of something this slice was not asked to change; money totals, VAT, login
  refusals, permissions or the cash drawer where the spec does not spell out the new value. The
  owner's standing rule from slice 3: **adding what a fixture lacks is not an edit**; changing an
  assertion needs a receipt.
- **Refusals** (root `CLAUDE.md` §3): a greyed tick says what happened and what to do in place (the
  floor reason; a refused Move offers "Refund {amount}" as today); nothing sends the waiter to
  somebody else.

## Decisions

- **D1 One command, two destinations.** New
  `moveDishes(tx: Transaction, cfg: OriginConfig, fromBillId: string, toBillId: string | null,
  lineIds: readonly string[], command: BillCommand & { expectedEdits: BillEditExpected[] }):
  Promise<{ billId: string }>` in `apps/server/src/bill-actions.ts`. `toBillId === null` makes a new
  bill (a new counter order when the source has no party), as `splitBill` does; otherwise the
  destination is an existing bill of the source's party. It answers the destination's id. It reuses
  `carveOffLines` with whole-line transfers only, so tickets, kitchen state, served state, held-group
  membership, extras, allergy ticks, portion bindings and `moved` portion events behave exactly as a
  whole-line Split by item or Transfer items does today (`refuseHeld: toBillId === null`, matching
  each). `splitBill` and `transferItems` stay unchanged for A1196.

- **D2 The till names line ids, whole lines only.** The wire carries `lineIds: string[]`, each a
  top-level dish line of the source; its extras follow it. No `quantity`: a line moves whole, so a
  weighed dish is never cut (spec §3.1) and an unbound legacy line of three moves whole. The server
  resolves each id inside the transaction: unknown or not on the source → `tab.line_not_found`
  `{ tabId, lineId }` (the existing union arm, `apps/server/src/errors.ts:717`); an extra →
  `tab.transfer_modifier_line` `{ tabId, lineNo }` (existing: "naming an extra directly"); the same
  line twice → `tab.transfer_duplicate_line`; empty → `sale.empty_basket`; a dish recalled into a
  draft → `draft.out_of_date` (`requireUnreservedTransfers`, unchanged). A stale id is refused, never
  replaced by another portion (master plan, "Deterministic count picker"). No new error code.

- **D3 Which portions a count takes.** First the ineligible go: a dish recalled into a draft is in
  no row (D17), and a paid dish is blocked (D12), as the master plan's "Deterministic count picker"
  says ("Filter ineligible paid/reserved portions first"). Within a row of identical portions (one
  `portionGroups` row, so one state, price and extras), "2 of 4" is the row's **first** two members
  by line number on this bill, as Split by item does today (`#stepSplitGroup`). Rows already
  separate unsent, waiting, sent, served, paid and differently priced portions (`tabLinePortionKey`,
  `#fallbackPortionKey`), so the master plan's state order is the row order itself. Line number is
  the order a dish joined this bill, not the order it was created: a dish moved in takes a number
  past the bill's highest (`moveOrderLines`, `working-order.ts:4052-4058`, "Destination numbers
  start beyond its current maximum"), so a dish moved out and back sorts after newer identical ones.
  The master plan's "creation ordinal, then UUID" would need the portion's cohort and ordinal on the
  till's line read, which it does not carry (finding 1); within one row the members are identical,
  so the order decides only which identical dish goes, never what is charged (Departures). The till
  sends the chosen members' ids (D2).

- **D4 The source may be part-paid; the destination keeps today's Transfer rule.** Source: open
  (`refuseClosedBill`: not paid, presented or abandoned); payments allowed; a paid line refuses
  `bill.line_paid` (`moveOrderLines`' `refusePaidLines` with nothing kept); the floor
  `assertBillInvariant([fromBillId])` refuses `bill.received_exceeds_total`; a pending payment or
  refund refuses `order.payment_in_flight` (`bumpRevision`). Existing destination: a bill of the same
  party, open, not presented, **holding no payment** (`requireBillOfParty` + `refuseBillWithPayments`,
  as Transfer items and Merge require today), in the same service mode (`assertServiceModesMatch`).
  The spec relaxes the source only (§3.8: "Move dishes… must allow unpaid dishes out of a part-paid
  bill into an existing bill too"); a destination with payments is Owner question 3, default keep.

- **D5 Issuance as Split by item does it.** The route runs in `withIssuanceTransaction` and, after
  the move, `issueIfFullyPaid(tx, fiscal, saleCfg, fromBillId, personId)`, exactly as the split route
  (`till-api.ts:4127-4135`). Moving the last unpaid dishes off a part-paid bill therefore invoices it
  in the same transaction, as Split by item does today. The destination cannot become fully paid (it
  holds no payment, D4). No fiscal function changes (H2).

- **D6 Editors.** `requireBillEditors(tx, billIds, operatorId, expectedEdits)` over the source and,
  when it exists, the destination (A773 §6: "Merge bills or transfer dishes: source and destination
  bills, including empty destinations"), so `expectedEdits` has one entry for a new bill and two,
  sorted by bill id, for an existing one (`parseBillEditExpecteds`, `apps/server/src/bill-editing.ts:121`).
  Another person's unsent dishes on either bill refuse `draft.taken_over` with its conflicts; the till
  shows its existing Take over (slice 3's flow), never a bulk take-over.

- **D7 The screen after a move** keeps today's: a new bill is put on screen (as Split by item:
  `#chooseBill(billId)`), an existing destination leaves the source on screen (as Transfer items).

- **D8 The kitchen.** `enqueueMovedSlips(tx, cfg, before, toBillId, splitFrom)` as both functions do
  today. Same party, same tables: the slips and notices are whatever a whole-line Transfer items or
  Split by item writes for the same lines; Task 2 pins that by twin fixtures (D1).

- **D9 No replay, and what the till does with a refusal.** No `submissionId`. For a bill of a
  party, the party revision refuses a resend after a lost reply: `guardPathParty` moves it on
  (`bill-actions.ts:119`), and the review's E1 (cases C and D) saw a second split from one read
  refused `party.out_of_date`; Task 3 pins it for `moveDishes`. A bill with no party has no
  revision; there a resend names lines that are no longer on the source and is refused
  `tab.line_not_found` (Task 3 pins it). The till never sends that one: it offers no Move dishes…
  without a party (D15). The till handles a refusal as `#onTransferLines` does today
  (`till-app.ts:15946-15975`, through `#onBillPairRefusal` `:15767`), so the panel is already
  closed and:
  - `party.out_of_date` reloads the order and says what changed (`#onTableRefusal` →
    `#onPartyOutOfDate`, `:12081-12105`);
  - a money refusal (`BILL_MONEY_REFUSALS`, `till-app.ts:656-663`: `bill.payments_received`,
    `bill.line_paid`, `bill.received_exceeds_total`, `bill.refund_in_progress`,
    `order.payment_in_flight`, `working_order.not_open`) shows its words and reads the party's
    bills and the shown bill's balance again (`#onBillMoneyRefusal` → `#loadPartyBills`), not its
    lines; the balance's `paidLines` then grey a newly paid dish the next time the picker opens;
  - `service_zone.mode_incompatible` shows `table.bills_served_differently`;
  - `tab.split_held_line` shows `table.split_held_error` (as `#onSplitLines`);
  - `draft.out_of_date` and `draft.taken_over` show their own approved words (`i18n/codes.ts:346`,
    `:354`) by setting `{ code }`, as `#onRelocationRefusal` does (`till-app.ts:15780-15786`).
    Today's `#onTransferLines` would send them to `tableWriteError`, which has no draft codes in
    `TABLE_REFUSALS` (`:611`) and so shows `table.error`; Move dishes is a new handler and takes the
    relocation path's better words;
  - anything else shows its words (`tableWriteError`) and re-reads neither the lines nor the floor,
    as `till-app-table-service.test.ts:1229-1250` pins for a refused transfer today;
  - every refusal then runs `#refreshBillDraft`, which reads the bill's drafts again, so another
    person's unsent dishes show with the existing Take over (slice 3).

- **D10 The picker is one till widget; the screen owns the draft.** `widgets/portion-picker.ts`
  (`till-portion-picker`) draws rows from the selection model and emits picks; it holds no staged
  state of its own. The screen keeps the picks in its action draft scope (`ActionDraft`,
  `#watchActions`), so Cancel, Escape, Back, switching bill, navigation and reconnect follow the
  existing action-panel rules and `till-table-order-screen.actions-unsaved.test.ts` guards them. 4c
  gives the same widget bill headers. A tick is a native `<input type="checkbox">` (finding 3); a
  grouped row's count is a − / "2 of 4" / + control built as Split by item's
  (`#splitGroupQuantity`, `wt-button`s), shown once the row is ticked; a weighed or unbound line has
  the tick only.

- **D11 Words.** New words are only those in "Spanish" above. Reused: `table.new_bill` for the new
  bill destination; the other bills' short labels (`#billName`); `bill_pay.paid` beside a paid row;
  `table.split_held_error`, `bill.received_exceeds_total_excess` with its "Refund {amount}"
  (`bill.refund_excess`), `bill.line_paid`, `draft.*` and `table.bills_served_differently` for the
  server's refusals, through the handlers that already word them. `table.split_options_together`,
  `table.split_modifier_error`, `table.split_pick_lines`, `table.split_confirm`,
  `table.split_no_lines`, `table.split_quantity*`, `table.split_group_line`, `table.transfer_*` go in
  Task 9b when `rg` shows their last user gone.

- **D12 The floor in the picker.** For the bill on screen, "kept money" is `received + reserved`
  from its `BillBalance`. A row's next tick is greyed when `total − (picked amount + one more
  member's amount) < kept`, with `table.move_dishes_floor` naming `kept` as the reason (spec §6: "€40
  is already paid on this bill"). A member's amount is the sum of `tabLineGross` (`state/adjust-target.ts:53`,
  the helper the screen's `#lineGrossByLineNo` uses, TOS `:1925`) over the dish and its extras; no
  second money formula (`lineGross` in `state/order-line.ts:27` is for draft lines and is not used).
  A row whose members are paid (`paidLines`) is greyed with "Paid". Exact `Decimal` throughout, no
  floats. **The greying is the till's estimate**: whether a group of dishes priced together can put
  a cent of the bill's total somewhere other than the sum of its lines' `tabLineGross` at the €40.00
  boundary was not measured. The server's `assertBillInvariant` stays the authority: if it refuses
  anyway, the panel has already closed (as today's pickers do on send, `#retireActions` then
  `#closeActions`, TOS `:5143-5151`), and the refusal's words with "Refund {amount}" are shown (D9,
  D11); the waiter opens Move dishes… again over the re-read balance.

- **D13 Row actions unchanged.** Comp, Void, Mark served and Fire now on a grouped row keep slice
  1's behaviour (D31/D32 there). The picker is for moves.

- **D14 Which bills are offered as destination.** The other open bills of the party with no payment
  (`#otherBills()`, `TOS:4768`, unchanged), each by its short label, in number order, then
  `+ New bill`. Nothing is chosen at first; Move stays quiet until at least one dish and a
  destination are chosen (root `CLAUDE.md` §3, Forms: "stay quiet while awaiting a choice,
  selection").

- **D15 Where Move dishes… is offered.** On the bill on screen of a party when it is open (not
  presented, not paid), with or without payments: wherever Split by item is offered today with a
  party (`TOS:5428`). **Not with no party.** The app's `#billComposition` answers `null` when
  `orderParty` is `null` (`till-app.ts:15841-15846`), so today's `#onSplitLines`,
  `#onTransferLines` and `#onMergeBills` all return without a word there, and a Move dishes built
  the same way would be a control that does nothing. The no-party bill section that offers them
  came with slice 3 (`git log -S'billItems: lineVerbs'` names #2360 only). 4a takes Split by item
  and Transfer items out of it and adds no Move dishes… (a W row on
  `till-table-order-screen.table-menu.test.ts:224`); Merge bills stays there, and Task 13 records
  in the backlog that with no party it does nothing (by reading `#onMergeBills`, `:15882-15887`).
  The server's `moveDishes` keeps a no-party path, as `splitBill` has (Task 2 case 8), for A1196 to
  retire with the others.

- **D16 What a tick takes.** Ticking a row takes **every** member of it the floor allows; − lowers
  the count from the last member, + raises it; ticking a ticked row clears it. This is what both
  pickers do today: Transfer items "picks or drops every member" (`#toggleTransferLine`, TOS
  `:5130`) and Split by item "picks every member whole, or drops every member" (`#toggleSplitLine`,
  `:5155`), then steps down (`#stepSplitGroup`, `:5169`). The spec (§3.6, "identical ones as one row
  with a '2 of 4' count") and board 08 (a ticked Caña row at "2 of 4") show a count but not what the
  first tick takes; board 08's own rule for a bill ("Ticking a bill takes all of it") reads the same
  way. Owner question 4 asks it, defaulting to this; it does not block landing, because the default
  keeps today's behaviour. When taking the whole row would break the floor, the tick takes the
  first members that keep it and + is greyed with the floor reason; when even one would break it,
  the tick itself is greyed (D12). After a re-read regroups a row, the row keeps its count, taken
  from its first members (Split by item's rule, `#tidyPickedPortions` `:5093`). Transfer items'
  rule, untick the row, goes with the old picker: a B row (spec §3.6, one picker with a count, so
  the count shown is what is sent).

- **D17 A dish recalled into a draft is not in the picker.** It is being changed in a draft, this
  person's or another's, and today's sent list leaves it out the same way (`#sentFallback`, TOS
  `:2598-2605`, builds the `recalled` set from `#draftStore` and `otherDrafts`). Task 7b moves that
  set into one `#recalledLineIds()` used by both. Without this a count could take a recalled dish
  by line number and the server would refuse the whole move `draft.out_of_date`
  (`requireUnreservedTransfers`, `bill-actions.ts:50-73`), with the waiter unable to step past it,
  since the row always takes its first members. A dish recalled after the picker opened drops out of
  the picks at the next refresh (`tidyPicks`); the server stays the authority.

## Departures from the master plan, and where it no longer matches the code

| Master plan says | Now | Why |
| --- | --- | --- |
| `movePortions(tx, cfg: TillConfig, fromBillId, to: {billId}\|{newBill:true}, portionIds, command & {expectedEdits})` | `moveDishes(tx, cfg: OriginConfig, fromBillId, toBillId: string \| null, lineIds, command & {expectedEdits})` | finding 1 (no portion ids on the till; line ids are one-to-one with bound portions, as slice 1's D31); `TillConfig` is now `OriginConfig` (`bill-actions.ts:21`) |
| `PortionSelection = {wholeBillIds; portions}` | 4a's model covers one bill's dishes; whole-bill picks join in 4c | 4a moves from the bill on screen only (spec §3.6) |
| `widgets/portion-picker.unsaved.test.ts` | the screen's `actions-unsaved` test | D10: the widget holds no staged state |
| `widgets/split-guests-dialog.ts` "where retired" | untouched in 4a | 4c decides it with the guest counts |
| "relax transfer's untouched rule only for unpaid portions" | `transferItems` unchanged; the new command allows a part-paid source | D1, D4; the old function retires with A1196 |
| `A803 race replay` with promise barriers | winner then stale loser, rows compared | finding 10 |
| "Recheck every affected `BillEditExpected`… ask takeover" | as planned | D6 |
| `copyWaitingCourses(tx, fromPartyId, toPartyId, portionIds)` | 4b; copies **held order groups**, not courses, and before `groupArrivingDishes` | finding 7: a held group, not a course, is what waits; regrouping by course would fire hand-held dishes |
| Split-table body with `allSelected: "move-guests" \| "split-anyway"` | 4c; the server needs no such flag (Move guests is its own command) | 4c outline |
| "notice rows … include only moved dishes" | true for 4a's same-party moves; Split a table's party-wide reach changes in 4c | finding 8 |
| `A803 selection` "a whole part-paid bill remains selectable with its payments" | 4c | whole-bill picks are 4c |
| "Deterministic count picker": "…then creation ordinal, then UUID" | line number on this bill inside a row (D3) | the till's line read carries no cohort or ordinal (finding 1); members of a row are identical, so the order picks which identical dish goes, never the money |

## Current code map (main `e5bfb0b07`)

| Boundary | Where |
| --- | --- |
| Same-party moves (server) | `apps/server/src/bill-actions.ts`: `BillCommand` `:40-45`, `Transfers` `:47`, `requireUnreservedTransfers` `:50`, `refuseClosedBill` `:88`, `guardPathParty` `:119`, `requireUntouchedPair` `:141`, `splitBill` `:162`, `mergeBills` `:205`, `mergeCheckedBills` `:237`, `transferItems` `:277` |
| Line moves | `working-order.ts`: `moveOrderLines` `:3994` (portion events `:4070`), `assertDistinctTransferLines` `:4513`, `carveOffLines` `:4537`, `carveLines` `:4548` (partial branch `:4650-4700`), `refuseHeldLeavingParty` `:4865`, `refusePaymentInFlight` `:5517`, `readTabLines`/`TabLine` `:4130-4296` |
| Portions | `packages/db/src/schema/order-portions.ts` (`order_portions` `:12`, `working_line_portions` `:28`, `sale_line_portions` `:53`, `order_portion_events` `:84`); `apps/server/src/order-portions.ts` (`readPortionBindings` `:233`, `recordPortionEvents` `:345`) |
| Money | `bill-payments.ts`: `paidQuantitiesOf` `:367`, `readPaidQuantities` `:392`, `refusePaidLines` `:420`, `assertBillInvariant` `:440`, `refuseBillWithPayments` `:488`, `issueIfFullyPaid` `:810`; `parties.ts:254` `requireBillOfParty` |
| Editors | `bill-editing.ts`: `parseBillEditExpecteds` `:121`, `requireBillEditors` `:132`, `requireBillEditor` `:209` |
| Routes | `till-api.ts`: `billCommand` `:838`, `requireOtherBill` `:966`, `requireTransfers` `:978`, split `:4117-4150`, merge `:4172-4207`, transfer `:4210-4237`, STATUS `:438`, `:582-627` |
| Till client | `api/client.ts`: `BillBalance` `:1203`, `PartyBill` `:2128`, `TabLine` `:2329-2395`, `TabTransfer` `:2401`, `splitBill` `:4722`, `mergeBills` `:4735`, `transferItems` `:4751` |
| Till screen | TOS: `ActionVerb` `:230`, `ActionDraft` `:234`, `ActionStep` `:391`, state `:1250-1274`, `#watchActions` `:1301`, `#fallbackPortionKey` `:2631`, `#otherBills` `:4768`, `#closeActions` `:4781`, `#chooseVerb` `:4797`, `#pickBill` `:5069`, `#pickerRows` `:5082`, `#tidyPickedPortions` `:5093`, transfer/split pickers `:5130-5800`, `#actionPanel` `:5326`, `#tableMenu` `:5389-5459` |
| Till app | `till-app.ts`: `#ownBillsChange` `:11639`, `#reloadOrder` `:11906`, `#onBillPairRefusal` `:15767`, `#onBillMoneyRefusal` `:15775`, `#billComposition` `:15841`, `#askDifferentPeople` `:15904`, `#onTransferLines` `:15946`, `#onSplitLines` `:15978`, bindings `:19602-19609` |
| Grouping | `apps/till/src/state/portion-groups.ts` (`portionGroups`, `tabLinePortionKey`, `wholePortion`); `state/bill-payment.ts:330` `paidQuantities` |
| Words | `apps/till/src/i18n/strings.ts` (EN from `:1231`, ES from `:3008`); `i18n/codes.ts:478-485` |

## Consumer trace (planning run, `e5bfb0b07`)

Run each again at the task that touches it; list any new consumer in the ledger.

```
rg -n 'splitBill\(|transferItems\(|split-lines|transfer-lines|"split"|"transfer"' apps/till/src -g '!*.test.ts'
rg -n 'transferLineNos|splitQuantities|splitAttempted|#pickerRows|#tidyPickedPortions|#splitGroupQuantity|#otherBills' apps/till/src
rg -n 'table\.(split_(pick_lines|confirm|no_lines|quantity|group_line|options_together|modifier_error)|transfer_|action_split"|action_transfer)' apps/till/src docs/developers apps/server/src/guide
rg -n 'Split by item|Transfer items|Dividir por artículo|Transferir artículos' apps docs/developers docs/operations
rg -n '/api/bills/\$\{[^}]*\}/(split|transfer)' apps/till/src
rg -n 'carveOffLines\(|carveLines\(|splitLinesWithinOrder\(|splitUnitsWithinOrder\(' apps/server/src -g '!*.test.ts'
rg -c 'split-lines|transfer-lines|transferItems|splitBill' apps/till/src -g '*.test.ts'
```

The last two, rerun at review 1 (`e5bfb0b07`): `carveLines` is reached from `splitBill`
(`bill-actions.ts:191`) and `transferItems` (`:305`) with two different bills, and with one bill
from `splitLinesWithinOrder` (`working-order.ts:4909`, called by `adjustments-apply.ts:1278`,
`:1295` and `order-groups.ts:1125`, `:1249`) and `splitUnitsWithinOrder` (`:4924`, called by
`order-groups.ts:1303`). Ten till test files reach the old pickers: `till-app-parties` (49),
`till-app` (36), `till-table-order-screen` (25), `till-app-bill-payments` (18),
`till-app-table-service` (10), `till-table-order-screen.actions-unsaved` (10), `api/client` (8),
`till-app-drafts` (6), `till-table-order-screen.table-menu` (3), `till-table-order-screen.a11y` (1).

| Consumer (non-test) | Task |
| --- | --- |
| `working-order.ts` `carveLines` partial branch (refusal of a bound **measured** portion, only when the dish leaves its bill: `fromTabId !== toTabId`) | 1 |
| `bill-actions.ts` new `moveDishes` (and private `resolveMoveLines`) | 2, 3 |
| `till-api.ts` new route, STATUS unchanged (no new code) | 4 |
| till `api/client.ts` new `moveDishes`; `splitBill`/`transferItems` deleted | 4, 9b |
| till `state/portion-selection.ts` (new) | 5 |
| till `widgets/portion-picker.ts` (new) | 6 |
| TOS: `ActionVerb` gains `"move-dishes"`, `ActionStep` gains `"move-dishes"`, ⋮ item, panel step, `#closeActions` (7a); `ActionDraft` gains picked ids and destination, `tidyPicks` on refresh (7b) | 7a, 7b |
| till-app: `#onMoveDishes`, binding | 8 |
| TOS: transfer/split pickers, verbs, modes, state, `#tidyPickedPortions`, `#holdsDishWithExtrasToPart` | 9a |
| till-app: `#onTransferLines`, `#onSplitLines`, bindings, `tab.transfer_modifier_line` mapping | 9b |
| till `i18n/strings.ts` new keys (7) and retired keys | 6/7a (new), 9b (retired) |
| Guides `apps/server/src/guide/{en,es}/table-service.md` `{#portions}` (EN `:180-196`), `{#bill-switcher}` (EN `:232-287`), new `{#move-dishes}` | 11 |
| `docs/developers/design-system.md` ⋮ list (`:1075-1083`, including the no-party sentence `:1082`), "Identical portions share one row" (`:5753`, `:5766`) | 11 |
| `docs/operations/payments.md:5` ("**Split by item** creates another bill") | 11 |
| TOS `#sentFallback`'s recalled set, moved into `#recalledLineIds()` (D17) | 7b |

## Guard suites

Each command separately, each exit status checked, a nonzero **Tests** count required.

- **H2 (unedited):** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **F (unedited, plus H2):** `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
- **Filing (unedited in 4a):** `pnpm --filter @waitron/server exec vitest run src/move-merge.filing.test.ts src/order-portions.filing.test.ts src/transfer-lines.filing.test.ts`.
- **S (schema; 4a changes none — run at Task 0 and Task 10 only):** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`, then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- **G:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- **Words and codes:** `pnpm exec vitest run scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- **Style and fields:** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
- **Types:** `pnpm --filter @waitron/server typecheck`; `pnpm --filter @waitron/till typecheck`; `pnpm format:check`.

A red F, H2 or Filing case, or any change to those files, is a stop: keep the output, revert the
task's uncommitted change, write a decision request. At every task's end,
`git diff e5bfb0b07 -- packages/fiscal-verifactu apps/server/src/split-bill.fiscal.test.ts apps/server/src/till-api.fiscal-sale-paths.test.ts apps/server/src/transactional-series.test.ts apps/server/src/bill-payments.test.ts apps/server/src/bill-payments.card.test.ts apps/server/src/move-merge.filing.test.ts apps/server/src/order-portions.filing.test.ts apps/server/src/transfer-lines.filing.test.ts scripts/`
prints nothing. (No `scripts/` guard changes in 4a. If one must, it is a stop and joins Owner
question 2.)

## Changed test checks

The owner's rule (2026-10-05): an assertion may change without asking only where it pins behaviour
this slice deliberately changes, and then to check the new behaviour at least as strictly; never
deleted, never loosened. Kinds, as in slice 3: **B** behaviour the spec or an owner answer changes
(cite it); **R** a retired control re-pointed at the control that now does the same thing, the
assertion otherwise unchanged; **W** a whole-shape or list pin losing or gaining an entry with every
other value unchanged; **S** setup re-expressed through the new command, every `expect`
byte-identical; **F** a fixture or request losing or renaming a field the type no longer has, same
value. **Q2** marks a row that deletes a check: it is built on the default and the PR cannot land
until Owner question 2 is answered. Adding what a fixture lacks (a missing balance read, a party, a
line) is not an edit. **A changed check covering money totals, VAT, permissions, filing or anything
4a was not asked to change, not on this list, is a STOP**: ledger, revert, ask.

Every changed check goes in the receipt attached to the PR (`~/waitron-campaign-c/a803-4a-changed-checks.md`)
with file:line, kind, before, after, source, and the red and green output. Expected from reading;
each is confirmed at its task's red run.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `apps/till/src/screens/till-table-order-screen.table-menu.test.ts` (the ⋮'s item list for an open bill and a part-paid bill) | W | `Split by item`, `Transfer items` → `Move dishes…` at Split by item's place; every other item and its order unchanged | spec §3.6 | 7a (added), 9a (removed) |
| `till-table-order-screen.table-menu.test.ts:224` ("with no party: Split by item, Transfer items and Merge bills under Bill…") | W | the Bill list `["Split by item", "Transfer items", "Merge bills"]` → `["Merge bills"]`; the Whole table list unchanged; the case name follows | D15 (no party: the app's `#billComposition` answers `null`, so neither old item nor Move dishes could send anything) | 9a |
| TOS `:6375` "offers nothing to transfer to, under the plain heading, for an order that belongs to no party" | B | the ⋮ of an order with no party has no Move dishes… item (at least as strict: nothing to open, so nothing to move) | spec §3.6 ("between bills of the same party"), D15 | 9a |
| TOS `:6283` "offers neither merge nor transfer a bill holding a pending payment…" (its transfer half) | R | Move dishes' destinations leave out the bill holding a pending payment; `targetIds` read from the Move to list; the merge half unchanged | D4, D14 | 9a |
| TOS `:6649` "A803 portion grouping: a ticked Transfer row that another portion joins on a refresh is shown and sent as unticked" | B | the row keeps its count, taken from its first members, and Move sends exactly those ids (Split by item's rule, `:6676`, which stays R) | spec §3.6 (one picker whose count is what is sent), D16 | 9a |
| TOS tests for Split by item (`till-table-order-screen.test.ts` from `:4226`) and Transfer items (`:6264-6504`) whose behaviour Move dishes keeps (dispatch of the chosen lines; a ticked grouped row sending every member, `:6540`, `:6578`; "2 of 3", `:6598`, `:6626`; a picked Split line keeping its count after a refresh, `:6676`; only whole lines sent) | R | the same assertion through the Move dishes panel and its `move-dishes` event (`lineIds` instead of `lineNo`s naming the same lines). They stay R because a tick takes the whole row and − steps it down, as today (D16) | spec §3.6, D2, D16 | 9a |
| TOS Split by item cases for a partial quantity of one line, its decimal box and its errors (`:4226-…`, "partial quantities, errors") | **Q2** | deleted: no part of a line moves (spec §3.1); replaced by "a weighed dish has a tick and no count" and "an unbound line of three moves whole" | spec §3.1, D2 | 9a |
| TOS "Dishes with options must be moved in full" help (`table.split_options_together`) case | **Q2** | deleted with the help: whole lines always carry their extras | D2 | 9a |
| `till-table-order-screen.actions-unsaved.test.ts:143-449` (split quantities, transfer target) | R | the same leave/keep/discard assertions over Move dishes' picks and destination | D10 | 9a |
| `till-table-order-screen.a11y.test.ts:779-997` (transfer and split pickers, grouped stepper) | R | axe over the Move dishes panel in both themes, grouped, weighed, paid and floor rows | D10 | 9a |
| `till-app.test.ts:10010-10187` (transfer and split reloads; €3,000 question) | R | the same through `move-dishes` (new bill and existing destination) | spec §3.6 | 9b |
| `till-app.test.ts:10224` (`tab.transfer_modifier_line` → `table.split_modifier_error`) | **Q2** | deleted: Move dishes never names an extra, so the till never sends what that code refuses; a server case keeps the refusal of a named extra (Task 3) | D2 | 9b |
| `till-app-parties.test.ts` split-lines flows (`:1817-…`: the bill shown after a split, refusals) | R | the same through Move dishes to a new bill (D7) | D7 | 9b |
| `till-app-bill-payments.test.ts:3769-3821` money refusals on transfer and split | R | the same refusal handling (`#onBillMoneyRefusal`, "Refund {amount}") through Move dishes | D11 | 9b |
| `till-app-bill-payments.test.ts` case that a transfer **from** a bill with a payment is refused / not offered (if present; found at Task 9b) | B | Move dishes from a part-paid bill is offered and its unpaid dishes move | spec §3.8 | 9b |
| `till-app-drafts.test.ts:1448`, `:3440-3494` (drafts survive split-off bills) | R | the same through Move dishes to a new bill | D7 | 9b |
| `api/client.test.ts:3210` (`transferItems` request shape), `:3272` (`splitBill` request shape), and the `transferItems` and `splitBill` rows of the `it.each` at `:4513` ("%s sends the party revisions it was given") | **Q2** | deleted with the two client methods; new `moveDishes` request-shape cases and a `moveDishes` row in the `:4513` table (Task 4). `:3181` is `mergeBills` and is not touched | D1 | 9b |
| `apps/till/src/till-app-table-service.test.ts:1152-1153` ("%s sends nothing to the server" on an empty order: the `transfer-lines` and `split-lines` rows) | W | one `move-dishes` row naming `lineIds: ["line-1"]` (a real dish id, so the empty order and not an empty pick is what sends nothing), asserting `moveDishes` is not called, with the other assertions of the case unchanged | spec §3.6 | 8 (row added), 9b (old rows removed) |
| `till-app-table-service.test.ts:1187` ("a %s refused because a card payment of the order is running says so", the `transfer-lines` row) | R | the same through `move-dishes`, `moveDishes` rejecting `order.payment_in_flight` | D9 | 8 (row added), 9b |
| `till-app-table-service.test.ts:1232` ("a refused %s shows table.error and re-reads neither the tab nor the floor", the `transfer-lines` row) | R | the same through `move-dishes`, `moveDishes` rejecting `tab.not_open` | D9 | 8 (row added), 9b |
| `till-app-table-service.test.ts:1352-1353` ("a %s refused because an item is already paid for says so in that code's own words") | R | one `move-dishes` row, `moveDishes` rejecting `bill.line_paid` | D9 | 8 (row added), 9b |
| `till-app-table-service.test.ts:1369` ("a split refused for any other reason shows table.error and keeps paying the original tab") | R | the same through `move-dishes` to a new bill; every assertion unchanged | D7, D9 | 9b |
| `till-app-table-service.test.ts:297-298` (the fake API's `transferItems` and `splitBill`) | F | the fake loses the two methods the till no longer has, and gains `moveDishes` (adding is not an edit) | D1 | 8 (add), 9b (remove) |

No existing server test changes in Tasks 1–4. Task 1's refusal is expected to turn no existing
case red (its receipts); `splitBill`, `transferItems` and their routes are otherwise unchanged.

## Owner questions

Each has a default the build uses; a different answer changes only the tasks named. **Question 2
is written to `questions.md` at Task 0, before any file it names is edited.** Questions 1, 3 and 4 go
to `questions.md` and the PR at Task 13 with pictures from Task 12 (saved as
`docs/backlog/mockups/a803-bills-and-tables/slice4a-*.png` and copied with the question text to
`~/My Drive/Waitron mockups/2026-11-0x A803 slice 4a <topic>/`). **The PR is parked
`needs-owner-review` and cannot land until questions 1 and 2 are answered**; questions 3 and 4 do
not block.

1. **The words for Move dishes, in English and Spanish** (blocks landing). Default: the seven in
   "Spanish" above, plus the guide section «Mover platos a otra cuenta» (Task 11). Worked example:
   Table 4, Bill 1 holds 4 × Caña, 2 × Croquetas and 0.350 kg of Jamón; €40 has been paid on it as a
   contribution. The waiter taps ⋮ → «Mover platos…»; the panel reads «Mover platos de Cuenta 1»;
   the Caña row, ticked (which takes all four, D16) and counted down twice with −, reads «Caña
   2 de 4»; the Jamón row has a tick and no count; if ticking one more dish would leave the bill
   owing less than €40, that tick is grey and says «Ya se han pagado 40,00 € en esta cuenta»; under
   «Mover a» the waiter chooses «Cuenta 2» or «+ Cuenta nueva» and taps «Mover». Two things to
   look at: (a) the grey reason says what happened but not what to do; the next step is to move
   fewer dishes, or give money back first with the payment's Refund, and an alternative wording
   that says so is «Ya se han pagado 40,00 € en esta cuenta: mueve menos platos» / "€40.00 is
   already paid on this bill: move fewer dishes" (the refusal after Move already offers
   "Refund {amount}", `bill.received_exceeds_total_excess`); (b) «platos» also covers drinks such
   as Caña; the existing Transfer items words say «artículos» («Transferir artículos»), so
   «Mover artículos…» is the alternative. Changes Tasks 6, 7a and 11 strings only.
2. **Deleted till checks** (blocks landing). The full text, ready to paste, is in Task 0. Default:
   yes to every item. A "no" to an item keeps the retired control and its test (for example, keep
   Split by item's part-of-a-line quantity), which contradicts spec §3.1 for weighed dishes; the
   answer then needs its own decision.
3. **May dishes move onto a bill that already has a payment?** (does not block). Today Transfer items
   refuses it, and the spec relaxes only the bill the dishes leave. Default (D4): such a bill is not
   offered as a destination, and the server refuses it with `bill.payments_received`, whose existing
   wording a waiter meets only when a payment lands on Bill 2 after the picker was drawn: "A bill that
   has taken payments cannot be merged, and items cannot be transferred between it and another bill.
   Take the rest from the bill's payments" (`apps/till/src/i18n/codes.ts:362-365`). After 4a its
   "between it and another bill" over-claims (dishes may now leave a part-paid bill); Task 13 records
   that in the backlog rather than writing unapproved Spanish. Alternative: allow it — the destination's total rises, nothing paid changes, and Merge stays
   refused for a part-paid bill. Worked example: Bill 2 has €20 paid by card; the waiter moves a
   coffee from Bill 1 to Bill 2. Default: Bill 2 is not in «Mover a»; the coffee can go to «+ Cuenta
   nueva». Alternative: Bill 2 is offered, and owes €1.50 more afterwards. Changes D4, D14, Tasks 2
   and 7.
4. **What does ticking a row of identical dishes take?** (does not block). Default (D16): all of
   them, and − takes them back one at a time, as Split by item and Transfer items do today. The
   spec and board 08 show a row at "2 of 4" but not what the first tick takes. Worked example:
   Bill 1 has 4 × Caña. Default: one tap on the Caña tick reads «Caña 4 de 4»; two taps on − make
   it «2 de 4». Alternative: the first tap takes one («Caña 1 de 4») and + adds the next. Under
   either, if the bill has €40 paid on it, a tick or + never takes a dish that would leave it owing
   less than €40. Changes D16 and Tasks 5–7b, and the re-pointed till checks that tick a grouped
   row (`till-table-order-screen.test.ts:6540`, `:6578`, `:6598`, `:6626`) become behaviour
   changes.

## Task 0: preflight, reservations and Owner question 2 (no commit, ≈20 calls)

- [ ] `git -C /Users/clintongormley/workspace/worktrees/waitron-feat-a803-4-portion-picker status --short`
      clean apart from this plan's commit; `git log -1`. If main moved, rebase and re-resolve each
      code-map line a task touches.
- [ ] Ledger `~/waitron-campaign-c/item-a803-4-ledger.md` (the queue names it): `Status: in progress`,
      base sha, the cut (4a now; 4b, 4c outlined), the owner-question defaults in force, "PR parked
      until Q1 and Q2 are answered".
- [ ] Reservations: `grep -n 'A739\|A773\|A797\|A696\|A802\|A1196' ~/waitron-campaign*/queue.md`;
      read `~/waitron-campaign-e/questions.md` for A696's recorded reservation (the watcher asked
      lane E to record it after A1271; planning found it not yet recorded); `gh pr list --state open --json number,title,headRefName,files`;
      compare each live branch's diff with 4a's files (`bill-actions.ts`, `till-api.ts`,
      `working-order.ts`, till `api/client.ts`, `till-app.ts`, TOS, `strings.ts`). Known at planning:
      lane E's parked `feat/a696-startup-zone-validation` (`c79b2c03d`) adds
      `admission: TradingAdmission` and `requireEconomicWrite` to `splitBill` and to bill routes in
      `till-api.ts`; **if A696 lands first, the new `moveDishes` and its route take the same
      admission argument and check as `splitBill`** (whoever lands second adapts; do not wait). Lane
      F's `feat/a739-payment-window` (`3e45abdc6`) is parked; a read-only reference. Lane C's own
      A797 slices 10–11 edit TOS's foot and switcher, not the action panel.
- [ ] **Record 4a's reservation for the watcher** (its note of 2026-11-01 ~05:20 in lane C's
      `questions.md`: before slice 4 touches bill or payment files, keep out of the paths A696
      reserves "or say in yours which you need"). At planning lane E had recorded none
      (`grep -n 'A696' ~/waitron-campaign-e/questions.md` shows no reservation section). Append to
      `~/waitron-campaign-c/questions.md` one `##` section, "A803 slice 4a reservation — FYI, no
      answer needed (lane C, <date>)", listing the files 4a changes: `apps/server/src/bill-actions.ts`
      (new `moveDishes`), `apps/server/src/till-api.ts` (new route beside `/split`),
      `apps/server/src/working-order.ts` (`carveLines` partial branch only),
      `apps/server/src/testing/bill-action-fixture.ts`, `apps/till/src/api/client.ts`,
      `apps/till/src/till-app.ts`, `apps/till/src/screens/till-table-order-screen.ts`,
      `apps/till/src/i18n/strings.ts`, the two `table-service.md` guides,
      `docs/developers/design-system.md`, `docs/operations/payments.md`; and that 4a changes no
      payment, issuance or filing function (`issueIfFullyPaid` is called, not changed). If lane E
      has since recorded a reservation overlapping these, say which paths overlap in the same
      section, and carry on (the watcher sequences).
- [ ] **Re-check Owner question 2's list**, each command's output against the items:
      `rg -n "split-lines|transfer-lines|data-split-|data-transfer-|split_options_together|split_modifier_error|transferItems|splitBill" apps/till/src -g '*.test.ts' -l`
      and `rg -n "quantity:" apps/till/src/api/client.test.ts | rg -n "split|transfer"`. Add any file
      not named.
- [ ] **Append Owner question 2 to `~/waitron-campaign-c/questions.md`**, one `##` section, this
      text with any file the re-check added:

      > ## A803 slice 4a (Move dishes) — may these till checks be deleted? The build goes ahead on "yes"; the PR waits for your answer (lane C, 2026-11-01)
      >
      > Why: Move dishes… replaces Split by item and Transfer items (spec §3.6), and moves whole
      > dishes only, so a weighed dish is never cut (spec §3.1). Your 2026-10-05 rule makes a
      > deleted check a stop. Every other check of the two old pickers is moved onto Move dishes
      > with its assertion unchanged; these are the ones that go with what they checked. No filing
      > test, fiscal suite or `scripts/` guard changes.
      >
      > 1. **Part of one line.** `apps/till/src/screens/till-table-order-screen.test.ts`, the Split by
      >    item cases that type or step part of a line (for example 1 of a line of 3, or 0.120 kg of
      >    0.320 kg) and their error messages, and their `actions-unsaved` and a11y twins. Replaced
      >    by: a weighed dish shows a tick and no count; a grouped row's count takes whole dishes.
      > 2. **"Dishes with options must be moved in full".** The help line and its test: a whole dish
      >    always takes its extras.
      > 3. **`till-app.test.ts:10224`**: the till's wording for `tab.transfer_modifier_line`. Move
      >    dishes never names an extra on its own; a server test keeps that refusal.
      > 4. **`apps/till/src/api/client.test.ts:3210` and `:3272`, and two rows of the table at
      >    `:4513`**: the request shapes of the till's `transferItems` and `splitBill`, which go (the
      >    server keeps both routes until backlog A1196 retires them). New cases pin `moveDishes`'
      >    request. (`:3181`, Merge bills' request, stays.)
      >
      > Answer "a803-4a q2 y" for all, or name the items you want done differently.

- [ ] Baselines, each separately, recording Tests counts: H2, F, Filing, S, G, Words and codes,
      Style and fields; plus
      `pnpm --filter @waitron/server exec vitest run src/order-portions.lifecycle.test.ts src/transfer-lines.test.ts src/party-bill-actions.test.ts`
      and `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/screens/till-table-order-screen.table-menu.test.ts`.

## Task 1: a weighed portion is never cut on its way to another bill (A1195) (≈40 calls)

**Files.** `apps/server/src/working-order.ts` (`carveLines` partial branch `:4650-4700`: before
`refusePaidLines`, when `fromTabId !== toTabId`, refuse a partial line bound to a **measured**
portion); tests `apps/server/src/order-portions.lifecycle.test.ts`.

**Why only there (review 1, C1).** `carveLines` serves two kinds of caller. With two bills:
`splitBill` (`bill-actions.ts:191`) and `transferItems` (`:305`), the paths A1195 names ("a partial
split or transfer of a bound measured line", `docs/backlog.md:2132-2135`). With one bill:
`splitLinesWithinOrder` (`working-order.ts:4909`; a part discount, `adjustments-apply.ts:1278`,
`:1295`; part of a line moved to another course group, `order-groups.ts:1125`, `:1249`) and
`splitUnitsWithinOrder` (`:4924`; `order-groups.ts:1303`), which A1196 keeps ("partial serve, cancel,
adjustment"). Spec §3.1's "never cut" is about moving dishes between bills; a part discount inside
one bill does not move a dish. **Why measured only.** By reading, a unit portion's line holds one
dish: raising a bound unmeasured dish adds copies rather than raising its line (`risesByCopies`,
`order-portions.ts:263-269`; master plan, "A quantity increase creates more unit portions"), and
no whole part of a line of one exists to cut. The one unit-bound line of two the sweep met is a
hand-edited fixture (`simplified-limit.test.ts:757-759`). Receipts, all run at
review 1's revision in a throwaway worktree at `e5bfb0b07`, with every server test file that names
`splitBill`, `transferItems`, the `/split` or `/transfer` routes, `carveOffLines`,
`splitLinesWithinOrder` or `splitUnitsWithinOrder`, plus the adjustments, order-groups,
order-portions, line-cancel, line-service-split, station-move, split-off-extras, pass-board,
kitchen-allergy.lifecycle, till-api.unroutable-dish, management-api.station-disable and
order-drafts.db files (78 files):
- the review's E3: refusing every bound line, with no bill condition, turned two in-bill cases red
  (`pass-board.test.ts` "A773 no dispatch state: splitting keeps the source mark…",
  `station-move.test.ts` "copies a dish's move records…to the line a quantity split makes");
- refusing every bound line only when `fromTabId !== toTabId`: 77 files green, one case red,
  `simplified-limit.test.ts:753` "moving part of a line onto a bill that would go over the limit is
  refused" (a unit-bound line hand-edited to two, expecting the limit's 409; it got 400);
- refusing only a bound **measured** line when `fromTabId !== toTabId`: that case green, and a
  control copied from it with the line rebound to a new measured portion was refused 400
  `tab.transfer_quantity_invalid` with both bills' lines unchanged. (The 78-file sweep of this
  variant is recorded in "Review answers".)

- [ ] Cases `A803 A1195:` (`useVenueDb`, a table bill with a bound 0.350 kg Ham portion, sold by
      weight so its portion is measured, and a bound Burger, built through the real table send so
      the lines are bound): "Split by item of 0.100 kg of a bound weighed portion is refused
      `tab.transfer_quantity_invalid` naming its line and quantity, and no row of
      `working_order_lines`, `working_line_portions`, `order_portion_events`, `ticket_items` or
      `working_orders` changes" (rows read before and after, outside the failed transaction); "the
      same by Transfer items"; "the whole 0.350 kg still moves, keeping its portion id and writing
      one `moved` event"; "an unbound weighed line still splits" (an `openTab` line, as
      `transfer-lines.test.ts:372`); "**inside its own bill, 0.100 kg of the bound weighed portion
      still splits off** (`splitLinesWithinOrder`, as a part discount does): two lines, the binding
      stays on the source line, as today" (A1196 keeps it; the case pins that Task 1 did not reach
      it).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/order-portions.lifecycle.test.ts -t 'A803 A1195'`
      — the two refusal cases fail on "resolved instead of rejected" (the review's E2 saw a part of a
      bound measured line cut today); the other three pass (they describe kept behaviour; state so
      in the ledger).
- [ ] Implement: when `fromTabId !== toTabId` and `partials` is not empty, read the partial lines'
      portions once with `readGrowingPortions(tx, ids)` (`order-portions.ts:271`, which carries
      `measured`), and refuse the lowest-numbered line whose portion is measured with the existing
      code and params (`{ tabId, lineNo, quantity }`). One-line comment at the site: a weighed
      portion is one dish and leaves its bill whole (spec §3.1); A1196 keeps the in-bill splits.
- [ ] GREEN: the file unfiltered; then every file the receipts above ran, from `apps/server`:

      ```
      env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run $( { rg -l 'splitBill|transferItems|/split`|/transfer`|"/split"|/transfer"|carveOffLines|splitUnitsWithinOrder|splitLinesWithinOrder' src -g '*.test.ts'; ls src/adjustments*.test.ts src/order-groups*.test.ts src/order-portions*.test.ts src/line-cancel*.test.ts src/line-service-split.test.ts src/station-move.test.ts src/split-off-extras*.test.ts src/split-bill*.test.ts src/pass-board.test.ts src/kitchen-allergy.lifecycle.test.ts src/till-api.unroutable-dish.test.ts src/management-api.station-disable.test.ts src/order-drafts.db.test.ts; } | sed 's#^\./##' | sort -u )
      ```

      (78 files at review 1, about three minutes; read the Tests count); F; Filing; server types. **No
      existing case is expected red** (receipts above). A red case is a stop: ledger, revert, ask;
      it is not a Changed-test-checks row.
- [ ] Deletion controls: (a) remove the new refusal → the two refusal cases fail; restore. (b) drop
      the `fromTabId !== toTabId` condition → the in-bill case fails; restore. (c) drop the
      measured condition → `simplified-limit.test.ts:753` fails, 400 for 409; restore.
- [ ] Commit: "Never cut a weighed dish when splitting or transferring part of it to another bill".

## Task 2: `moveDishes`, the moves that succeed (≈65 calls)

**Files.** `apps/server/src/bill-actions.ts` (new exported `moveDishes`, D1; private
`resolveMoveLines(tx, billId, lineIds): Promise<{ lineNo: number }[]>` for D2's checks);
`apps/server/src/testing/bill-action-fixture.ts` (a `moveDishes` wrapper beside `splitBill`/
`transferItems` `:42-55`, same style); new `apps/server/src/move-dishes.test.ts`.

```ts
export async function moveDishes(
  tx: Transaction,
  cfg: OriginConfig,
  fromBillId: string,
  toBillId: string | null,
  lineIds: readonly string[],
  command: BillCommand & { expectedEdits: BillEditExpected[] },
): Promise<{ billId: string }>
```

Order of checks (each existing code): `sale.empty_basket`; `tab.transfer_self` when `toBillId ===
fromBillId`; `guardPathParty(fromBillId)`; `refuseClosedBill(source)`; for an existing destination
`requireBillOfParty(path.partyId, toBillId)` (or `bill.other_party` with no party),
`refuseBillWithPayments(toBillId)` (D4), `assertServiceModesMatch`; `resolveMoveLines` (D2);
`requireBillEditors` (D6); `requireUnreservedTransfers`; then for a new bill `createOpenOrder` +
kitchen note copy exactly as `splitBill` `:177-190`; `readSentWork`; `carveOffLines(tx, cfg, from,
to, transfers, { refuseHeld: toBillId === null, actorId })`; `bumpRevision([from, to])`;
`assertBillInvariant([from])`; `enqueueMovedSlips`.

- [ ] Cases `A803 move dishes:` (`useVenueDb`; party with Bill 1 and Bill 2 at one table):
      1. "moves two of four identical Cañas to a new bill: the new bill is Bill 3 of the party, holds
         exactly those two lines with their ids, portion ids and ticket items, and the source keeps
         the other two" (numbers via `VENUE_SERVICE.readBillIdentities`).
      2. "moves one of two sent Burgers with cheese to Bill 2: the burger's cheese goes with it,
         its kitchen state and served state are unchanged, and one `moved` portion event names Bill 1
         → Bill 2".
      3. "moves a whole 0.350 kg Ham portion".
      4. **Part-paid source, existing destination** (spec §3.8): "after a €10 contribution on Bill 1
         (€30 total), its unpaid €12 Burger moves to Bill 2; Bill 1's payment stays on Bill 1".
      5. "after an item payment for one Croqueta, the unpaid Croquetas move and the paid one stays".
      6. **Floor, allowed exactly** (spec §6): "Bill 1 totals €52.00 with €40.00 received; moving
         €12.00 leaves €40.00, which is allowed".
      7. "a dish in a held group moves to another bill of the party and stays in its group" (as
         `splitBill`'s comment says).
      8. "a bill with no party: moving to a new bill makes a new counter order and copies the kitchen
         note", as `splitBill` does.
      9. **Twins (D8):** "on twin fixtures, `moveDishes` to an existing bill writes the same rows as
         `transferItems` of the same whole lines" and "… to a new bill writes the same rows as
         `splitBill`": compare `working_order_lines` (ids, line numbers, quantities, prices, groups),
         `ticket_items`, `working_line_portions`, `order_portion_events` (without ids and times), the
         two bills' totals and `kitchen_notices` and print-job bytes (decoded), with the generated
         ids mapped. Untouched bills only, since `transferItems` refuses a part-paid source.
      10. **Cancelled, charge kept** (master plan `A803 moves`, "cancelled"): "a Burger cancelled
         with its charge kept moves with its cancellation: on Bill 2 its line reads
         `cancelledQuantity` 1, Bill 1's total drops by its charge and Bill 2's rises by it". Expected
         from reading: a whole-line move updates the line in place (`moveOrderLines`,
         `working-order.ts:4052-4058`), and a cancellation is stored against the line's id
         (`line_service_cancellations`, read by `readLineCancellations`,
         `apps/server/src/line-service-state.ts:51-95`), so it travels with the line. If the red run
         shows otherwise, that is a stop: ledger and decision request, not a quiet fix.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/move-dishes.test.ts -t 'A803 move dishes'`
      — first red is the missing export; with a stub that throws, every case must fail on its own
      assertion (record that run).
- [ ] Implement D1/D2/D4/D6/D8.
- [ ] GREEN: the file unfiltered; `src/party-bill-actions.test.ts src/order-portions.lifecycle.test.ts`
      (unchanged); F; Filing; server types.
- [ ] Deletion controls: (a) put `requireUntouchedPair`'s source payment check back → cases 4–6 fail;
      (b) drop `assertBillInvariant` → no case here fails (that is Task 3's); (c) pass
      `refuseHeld: true` for an existing destination → the twin case fails only if the fixture holds
      such a dish — add one to the twin fixture so it does.
- [ ] Commit: "Move chosen dishes to another bill of the party, or a new bill, in one step".

## Task 3: `moveDishes` refuses, and changes nothing (≈60 calls)

**Files.** `apps/server/src/move-dishes.test.ts`; `bill-actions.ts` only if a case finds a gap.

Each case reads every row set the move could touch (`working_orders` incl. status and revision,
`working_order_lines`, `ticket_items`, `working_line_portions`, `order_portion_events`,
`bill_payments`, `bill_identities`, `bill_number_allocations`, `order_drafts`, `kitchen_notices`,
`print_jobs`, `parties`) before and after, outside the refused transaction, and asserts the exact
domain code and params (CLAUDE.md §4: "Rejected writes assert the domain error code").

- [ ] Cases `A803 move dishes refuses:`
      - paid: "a paid Croqueta named with an unpaid one → `bill.line_paid` naming it";
      - floor: "€52.00 with €40.00 received; moving €12.01 → `bill.received_exceeds_total`, excess
        `0.01`" (spec §6, the €40 / €39.99 boundary);
      - pending: "a pending card payment on the source → `order.payment_in_flight`"; "a refund in
        progress → the same";
      - destination: "Bill 2 has a payment → `bill.payments_received`" (D4); "Bill 2 presented →
        `bill.presented`"; "Bill 2 paid → `bill.paid`"; "another party's bill → `bill.other_party`";
        "different service mode → `service_zone.mode_incompatible`"; "the source itself →
        `tab.transfer_self`";
      - source: "presented → `bill.presented`"; "paid → `bill.paid`"; "abandoned → `tab.not_open`";
      - lines: "an id not on the source → `tab.line_not_found` `{ tabId, lineId }`, and nothing
        moved": the id named is Bill 2's line 1, and Bill 1 also has a line 1, so a check that
        looked the id up anywhere and moved by line number would move Bill 1's line 1 instead (the
        substitution the master plan forbids); the fixture says so in a comment;
        "an extra's id → `tab.transfer_modifier_line`"; "the same id twice →
        `tab.transfer_duplicate_line`"; "none → `sale.empty_basket`"; "a dish recalled into a draft
        → `draft.out_of_date`";
      - held: "to a new bill, a dish the kitchen holds outside a held group → `tab.split_held_line`"
        (as Split by item);
      - editors: "another person's unsent dishes on the destination → `draft.taken_over` with its
        conflict"; "a stale editor version on the source → `draft.out_of_date`";
      - party: "a stale party revision → `party.out_of_date`".
- [ ] Cases `A803 move dishes race:` (winner, then the loser on the read taken before the winner,
      finding 10): "an item payment for the Burger commits first; the move naming it is refused
      `bill.line_paid`, nothing changed"; "a €40 contribution commits first; the move that would now
      break the floor is refused `bill.received_exceeds_total`"; "Bill 2 is taken over by another
      person first; the move is refused `draft.out_of_date` or `draft.taken_over` (record which)";
      "two moves from one read: the second is refused `party.out_of_date`, and exactly one new bill
      exists"; "a resend of a successful move (its reply lost) is refused `party.out_of_date` and
      makes no second bill and no second kitchen notice" (D9); "on a bill with no party, a resend of
      a successful move to a new bill is refused `tab.line_not_found` naming the first moved id,
      and makes no second counter order" (D9; the till never sends it, D15).
- [ ] RED/GREEN: `pnpm --filter @waitron/server exec vitest run src/move-dishes.test.ts -t 'A803 move dishes (refuses|race)'`.
      Cases that already pass (the checks are reused) are recorded as such in the ledger; each still
      needs its deletion control below to show it can fail.
- [ ] Deletion controls, one at a time: drop `assertBillInvariant` → the floor and €40 race cases
      fail; drop `refuseBillWithPayments(toBillId)` → the destination-payment case fails; drop
      `requireBillEditors` → the editor cases fail; skip `resolveMoveLines`' source check (look the
      id up on any bill and send its line number) → the foreign-id case fails because Bill 1's
      line 1 moved, not on a `tab.line_not_found` from `carveLines`.
- [ ] GREEN: the file unfiltered; F; server types.
- [ ] Commit: "Pin what Move dishes refuses, and that a refused move changes nothing".

## Task 4: the route and the till's client (≈55 calls)

**Files.** `apps/server/src/till-api.ts` (new `POST /api/bills/:id/move-dishes` beside split
`:4117`); new `apps/server/src/till-api.move-dishes.test.ts`; rows in
`till-api.profile-actions.test.ts` (doc table `:127`, list near `:461`) and
`till-api.profile-zones.test.ts` (doc table `:193-196`, cases near `:1188-1226`); till
`apps/till/src/api/client.ts` (new `moveDishes`), `api/client.test.ts`.

Wire contract (one literal used by both sides' tests):
`POST /api/bills/:fromBillId/move-dishes`, body
`{ lineIds: string[], toBillId: string | null, expectedPartyRevision?: number, partyId?: string, expectedEdits: BillEditExpected[] }`,
answer 200 `{ billId: string }`.

Route: `requireSession(deps, c, { action: "take-orders" })`; `requireTabParam`; `lineIds` must be an
array of UUID strings, else `invalid("lineIds")` (400); `toBillId` `null` or `requireOtherBill(…, "toBillId")`;
`billCommand(personId, body)`;
`withIssuanceTransaction`: `checkZones(tx, deps.cfg, session, [{ orderId: from }, …(toBillId ? [{ orderId: toBillId }] : [])])`,
then `parseBillEditExpecteds(body.expectedEdits)` inside the transaction, after the zones, as the
transfer and merge routes do (transfer: zones `till-api.ts:4221`, edits `:4224`; merge: `:4182`,
`:4200`; the split route parses its one `expectedEdit` the same way, `:4130`, `:4133`), so a body refused for its zone needs no valid
`expectedEdits` and the profile-zones rows can send the same body shape as transfer's;
`moveDishes`, `issueIfFullyPaid(tx, fiscal, saleCfg, from, personId)` (D5),
`captureKitchenActivity(…, [from, result.billId])`. No new STATUS entry (every code is mapped).

Client:
```ts
moveDishes(
  fromBillId: string,
  lineIds: readonly string[],
  toBillId: string | null,
  revisions: BillRevisions & { expectedEdits: BillEditExpected[] },
): Promise<{ billId: string }>
```

- [ ] Route cases `A803 move dishes route:` 200 with `{ billId }` for new and existing; 400
      `management.request_invalid` field `lineIds` for a missing, non-array, empty-string or
      non-UUID entry; 400 for a malformed `expectedEdits`; 401 without a session; a refusal from
      Task 3 reaches its STATUS (one each: 409 `bill.line_paid`, 404 `tab.line_not_found`, 409
      `draft.taken_over` with `conflicts`). **Issuance (D5):** "moving the last unpaid dishes off a
      bill whose contribution covers what stays files one invoice for it, and the moved dishes' new
      bill none" (sales count per bill, invoice number present, filed total equals what stayed); "a
      move that leaves the source owing files nothing".
- [ ] Profile rows (new rows only): `take-orders` refuses without it; a source or destination bill in
      a zone the device does not serve is refused, as transfer's `(from)`/`(to)` rows.
- [ ] Client cases `A803 move dishes client:` the exact method, path and body for a new bill and an
      existing one (the wire literal above), and the answer passed through; and a `moveDishes` row
      in the `it.each` at `client.test.ts:4513` ("%s sends the party revisions it was given").
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/till-api.move-dishes.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts -t 'A803|move-dishes'`
      (404 status first); `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts -t 'A803 move dishes client'`.
- [ ] Implement.
- [ ] GREEN: the three server files unfiltered; F; H2; Filing; the client file unfiltered; both
      typechecks.
- [ ] Deletion controls: drop `issueIfFullyPaid` from the route → the issuance case fails; drop the
      destination's `checkZones` subject → its zone row fails.
- [ ] Commit: "Add the move-dishes route and the till's client call".

## Task 5: the selection model (≈50 calls)

**Files.** New `apps/till/src/state/portion-selection.ts`, `portion-selection.test.ts`.

```ts
export interface PickRow {
  /** Members in line order on this bill (D3); one member for a line that stands alone. */
  members: readonly TabLine[];
  /** A whole portion of a unit dish in a row of several: the row takes a count. False: a weighed
   * or unbound line, which has a tick only, or a partly paid line, which stands alone and is
   * blocked `paid`, so it cannot be ticked at all. */
  counted: boolean;
  /** The money one member takes off the bill, its extras included, as a decimal string. */
  each: string;
  /** Why no (more) member of this row can be picked; null when one can. */
  blocked: { reason: "paid" } | { reason: "floor"; kept: string } | null;
}
export type Picks = ReadonlySet<string>; // picked line ids

export function pickRows(
  lines: readonly TabLine[],
  keyOf: (dish: TabLine) => string | null,
  balance: BillBalance | null,
  recalled: ReadonlySet<string>, // line ids recalled into any draft; left out of every row (D17)
  picks: Picks,
): PickRow[];
export function pickedCount(row: PickRow, picks: Picks): number;
/** The row's first `count` members picked, the rest dropped (D3); never past what the floor
 * allows. */
export function setCount(row: PickRow, count: number, picks: Picks): Picks;
/** None picked → every member the floor allows (D16); any picked → none. */
export function toggleRow(row: PickRow, picks: Picks): Picks;
/** After a re-read. `before` is the rows last drawn; `rowsFor` draws the re-read bill's rows over a
 * set of picks. Each old row hands its count to the unpaid row now holding most of its members
 * (a tie: the one drawn first; counts handed to one row add up). The rows then take their counts
 * in drawn order, each its first members, never more than its limit over the picks placed so far,
 * so together they keep the floor. An id in no row now (gone, recalled) is dropped; its row's
 * count stays, taken from the members left. */
export function tidyPicks(
  before: readonly PickRow[],
  rowsFor: (picks: Picks) => readonly PickRow[],
  picks: Picks,
): Picks;
export function pickedLineIds(rows: readonly PickRow[], picks: Picks): string[]; // line order
export function pickedAmount(rows: readonly PickRow[], picks: Picks): string;
```

`keyOf` is the screen's `#fallbackPortionKey` (so paid quantities and allergy guests part rows, as
today). `recalled` is the screen's `#recalledLineIds()` (D17, Task 7b). `blocked` follows D12: a
member with a paid quantity → `paid`; else picking one more member would leave
`total − picked − each < received + reserved` → `floor` with `kept = received + reserved`. No
balance read (a bill with no payment) → nothing is blocked by floor or paid. A member's amount is
`tabLineGross` over the dish and its extras (D12).

- [ ] Cases `A803 selection:` "4 identical Cañas form one counted row; ticking it picks all four;
      count 2 then picks the first two line ids"; "toggling a ticked grouped row clears it, and so
      does toggling a partly picked one"; "€52.00 with €40.00 received and 4 × €5.00 Caña: ticking
      the row picks the first two (€10.00 leaves €42.00; a third would leave €37.00) and the row is
      then blocked `floor`, so + cannot add a third"; "a weighed line is its own row, not counted";
      "an unbound line of 3 is its own row, not counted, and moves whole"; "a paid Croqueta's row is
      blocked `paid`; its unpaid twins form their own row"; "€52.00 with €40.00 received: a €12.00
      row is pickable, and once picked, a €0.01 row is blocked `floor` with kept `40.00`"; "a
      contribution marks no dish paid" (spec §6); **"a Caña recalled into a draft is in no row: of
      4 Cañas with the first recalled, the row reads 3 and count 2 picks the second and third"**
      (D17; the master plan's "Filter ineligible paid/reserved portions first"); "`tidyPicks` after
      a re-read in which one picked member was paid elsewhere keeps the row's first unpaid members,
      as many as were picked"; "`tidyPicks` after a re-read in which a picked member was recalled
      drops it and keeps the row's count from its first remaining members"; "a vanished id is
      dropped"; "`pickedLineIds` is in line order"; "`pickedAmount` sums dish and extras exactly"
      (a €0.05 × 3 case and a 10% extra case, against `tabLineGross`, D12).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/state/portion-selection.test.ts -t 'A803 selection'`
      (missing module first; then with stubs returning empty, each case on its assertion).
- [ ] Implement; reuse `portionGroups`, `paidQuantities`, `tabLineGross`, the till's decimal
      helpers.
- [ ] GREEN: the file unfiltered; till types.
- [ ] Deletion controls: compare `<=` for `<` in the floor test → the €40.00 boundary case fails;
      take the last members instead of the first → the count case fails; ignore `recalled` → the
      recalled case fails; make `toggleRow` take one member → the "ticking it picks all four" case
      fails.
- [ ] Commit: "Model which dishes of a bill are picked, and which cannot be".

## Task 6: the picker widget (≈60 calls)

**Files.** New `apps/till/src/widgets/portion-picker.ts` (`till-portion-picker`),
`portion-picker.test.ts`, `portion-picker.a11y.test.ts`; `apps/till/src/i18n/strings.ts`
(`table.pick_count`, `table.move_dishes_floor`, `table.move_dishes_none` EN and the proposed ES,
behind the approval note the slice-3 strings used).

Properties: `rows: readonly PickRow[]`, `picks: Picks`, `nameOf: (row) => string` (the screen's
`#nameForLine`), `money: (amount: string) => string`. Event: `portion-picks`, `detail: { picks:
string[] }`, `bubbles: true, composed: true` (an app widget may name its events plainly, CLAUDE.md
§3). Each row: a native `<input type="checkbox">` labelled by the dish name (checked when any
member is picked; `disabled` when blocked and nothing of it is picked), the row's amount, and, for a
blocked row, a visible reason line referenced by `aria-describedby` (`bill_pay.paid` or
`table.move_dishes_floor` with the amount) — never colour alone; a counted, ticked row shows −
"{count} of {total}" + (`wt-button`s, − disabled at 1, + disabled at the member count or when the next
member is floor-blocked), as `#splitGroupQuantity` does. An empty list shows `table.move_dishes_none`.
Tokens only (`--wt-*`); tap targets at least `--wt-tap-min`.

- [ ] Cases `A803 picker:` ticking a grouped row of four emits all four (D16); − then emits the
      first three; − at 1 is disabled; + at the member count is disabled; a weighed row has no count control; a paid row's tick is disabled and its
      reason reads "Paid"; a floor-blocked row's reason reads "€40.00 is already paid on this bill"
      (English, then Spanish via the locale); a ticked row whose next member is floor-blocked has +
      disabled; keyboard: Space toggles, Tab reaches −/+; the event detail is in line order; every
      label contains its visible text.
- [ ] a11y `A803 picker a11y`: axe with no violations, light and dark, for: empty list; grouped
      unticked; grouped ticked "2 of 4"; weighed; paid; floor-blocked.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/widgets/portion-picker.test.ts src/widgets/portion-picker.a11y.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: both files unfiltered; Style and fields; Words and codes; till types.
- [ ] Deletion controls: drop `aria-describedby` → the reason-association case fails; drop the
      disabled state on a paid row → the paid case fails; emit only the first member on a tick →
      the "emits all four" case fails.
- [ ] Commit: "Add the dish picker: ticks, counts and why a dish cannot be picked".

## Task 7a: Move dishes… in the ⋮, its panel and what Move sends (≈50 calls)

**Files.** TOS (`ActionVerb` `:230` gains `"move-dishes"`; `ActionStep` `:391` gains
`"move-dishes"`; state `moveDishesPicks: Picks`, `moveDishesTo: string | null | undefined`
(`undefined` = nothing chosen, `null` = new bill); `#closeActions` resets them; the ⋮'s bill
section gains Move dishes… at Split by item's place, offered as D15 (a party's open bill, with or
without payments; never with no party); the panel step `#moveDishesStep()` draws heading
`table.move_dishes_heading` with the bill's short label, the picker, "Move to"
(`table.move_dishes_to`) with the destinations of D14 as `wt-choice-row`s (`aria-pressed`), and
Back plus Move (`table.move_dishes_confirm`), quiet until at least one pick and a destination; Move
dispatches `move-dishes` `{ lineIds, toBillId }`, then `#retireActions` and `#closeActions` as
`#confirmTransfer` does (TOS `:5143-5151`); the balance shown (`#balanceShown`) feeds `pickRows`),
`strings.ts` (`table.action_move_dishes`, `table.move_dishes_heading`, `table.move_dishes_to`,
`table.move_dishes_confirm`); new `screens/till-table-order-screen.move-dishes.test.ts`;
`till-table-order-screen.table-menu.test.ts` (W row: the new item; nothing added with no party).

Split by item and Transfer items stay in the ⋮ until Task 9a.

- [ ] Cases `A803 move dishes panel:` the ⋮ on an open bill of a party lists Move dishes… where
      Split by item is; on a part-paid open bill too; not on a presented or paid bill; **not with no
      party** (D15); choosing it opens the panel with its heading focused; the destinations are the
      party's other open bills with no payment in number order then "+ New bill"; Move is quiet
      (native `disabled`) until a dish and a destination are chosen; ticking the 4-Caña row and
      pressing − twice, then Move, dispatches exactly `{ lineIds: [first two Caña ids], toBillId:
      <Bill 2 id> }`, and with "+ New bill" `{ …, toBillId: null }`; the panel closes after Move.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.move-dishes.test.ts src/screens/till-table-order-screen.table-menu.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: both files unfiltered, plus `src/screens/till-table-order-screen.test.ts` (unchanged)
      and `src/screens/till-table-order-screen.bill-controls.a11y.test.ts`; Words and codes; till
      types.
- [ ] Deletion controls: send line numbers instead of ids → the dispatch case fails; offer the item
      with no party → the no-party case fails.
- [ ] Commit: "Offer Move dishes… in the table's ⋮, with the dish picker and where to move them".

## Task 7b: the picks as unsaved work, refreshes, and recalled dishes (≈45 calls)

**Files.** TOS (`ActionDraft` `:234` gains `picks: Set<string>` and `moveTo`;
`#watchActions`/`#actionPayload` carry them; the screen keeps the `PickRow[]` it last drew, and a
refresh runs `tidyPicks(lastDrawn, (picks) => pickRows(lines, keyOf, #balanceShown(), #recalledLineIds(), picks), picks)`
over the re-read lines, with `keyOf` the screen's `#fallbackPortionKey`, so rows that gain picks
together keep the floor (Task 5); new `#recalledLineIds()`
holding the set `#sentFallback` builds today (`:2598-2605`), used by `#sentFallback` and by
`pickRows` (D17), with `#sentFallback`'s behaviour unchanged); `till-table-order-screen.move-dishes.test.ts`;
`till-table-order-screen.actions-unsaved.test.ts` (new cases).

- [ ] Cases in `move-dishes` `A803 move dishes refresh:` a re-read that pays one picked dish
      elsewhere keeps the row's first unpaid members (`tidyPicks`); a re-read in which another
      identical dish joins a ticked row keeps the row's count from its first members, and Move sends
      exactly those (D16); **a dish recalled into this person's draft, and one recalled into another
      person's (`otherDrafts`), are in no row, and "2 of 3" never takes them** (D17); a picked dish
      recalled before a refresh drops out of the picks.
- [ ] Cases in `actions-unsaved` `A803 move dishes unsaved:` with picks made, Back/Escape/switch
      bill/leave the table ask before discarding, and keep the picks on "stay"; with nothing picked
      they do not ask; a refresh does not count as a change.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.move-dishes.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: both files unfiltered, plus `src/screens/till-table-order-screen.sent-fallback.test.ts`
      and `src/screens/till-table-order-screen.recalled-layout.test.ts` (unchanged: the moved
      recalled set); till types.
- [ ] Deletion controls: drop the picks from `#actionPayload` → an unsaved case fails; pass an empty
      recalled set to `pickRows` → the recalled case fails.
- [ ] Commit: "Keep Move dishes' picks as unsaved work, and leave recalled dishes out".

## Task 8: the app moves the dishes (≈65 calls)

**Files.** `apps/till/src/till-app.ts` (new `#onMoveDishes(event, confirmed?)` modelled on
`#onTransferLines` `:15946` and `#onSplitLines` `:15978`: nothing sent for an empty `lineIds`;
`#billComposition([active, toBillId?])`, `#askDifferentPeople`, `#ownBillsChange`,
`asked.api.moveDishes(...)` with `asked.expectedEdits`; refusals as D9: `tab.split_held_line` →
`table.split_held_error`, `draft.out_of_date`/`draft.taken_over` → `{ code }`, the rest →
`#onBillPairRefusal` (which sends money refusals to `#onBillMoneyRefusal`, the mode refusal to
`table.bills_served_differently` and the rest to `#onTableRefusal`), then `#refreshBillDraft`;
success: a new bill `#chooseBill(billId)` (D7), then `#reloadOrder` and `#refreshBillDraft`;
binding beside `:19602-19609`); new `apps/till/src/till-app-move-dishes.test.ts`; the fake API of
`till-app-table-service.test.ts` (`:297-298`) gains `moveDishes`, and its `it.each` tables at
`:1152`, `:1187`, `:1232` and `:1352` gain a `move-dishes` row each (new checks; the old rows go in
Task 9b).

- [ ] Cases `A803 move dishes app:` with the app's fake API: "Move to a new bill sends the picked
      ids with the two revisions and the source's editor, then shows the new bill"; "Move to Bill 2
      sends both editors in bill-id order and stays on Bill 1"; "over the simplified-invoice limit
      the question comes first, and No sends nothing"; "`bill.received_exceeds_total` shows the
      approved sentence with Refund {amount}"; "`bill.line_paid` shows its sentence and reads the
      party's bills and the bill's balance again (`getPartyBills` once more), not its lines
      (`getTabLines` not called again)"; "`party.out_of_date` reloads the order and says what
      changed"; "`draft.taken_over` shows its own words, reads the bill's drafts again, and moves
      nothing"; "a refusal leaves the source bill on screen with the panel closed, and opening Move
      dishes… again starts with nothing picked over the re-read balance" (D12); "a reply after the
      waiter switched bills does not change the screen" (`#billCompositionCurrent`); "the request
      after a refused one carries the re-read revisions". The `till-app-table-service.test.ts` rows:
      an empty `lineIds` sends nothing; `order.payment_in_flight` says so; `tab.not_open` shows
      `table.error` and re-reads neither the tab nor the floor; `bill.line_paid` in its own words.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/till-app-move-dishes.test.ts src/till-app-table-service.test.ts -t 'A803 move dishes app|move-dishes'`.
- [ ] Implement.
- [ ] GREEN: both files unfiltered; `src/till-app.test.ts src/till-app-parties.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts`
      (unchanged); till types.
- [ ] Deletion controls: drop `#chooseBill` → the new-bill case fails; drop `#askDifferentPeople`
      → the limit case fails; route `draft.taken_over` through `#onBillPairRefusal` → the draft case
      fails (it would read `table.error`).
- [ ] Commit: "Move the picked dishes from the table screen".

## Task 9a: the two old pickers leave the table screen (≈55 calls)

**Files.** TOS (remove verbs `"transfer"`/`"split"`, steps `"transfer-lines"`/`"split-lines"`,
`transferLineNos`, `splitQuantities`, `splitAttempted`, `#transferLinesStep`, `#transferLineRow`,
`#splitLinesStep`, `#splitLineRow`, `#splitGroupQuantity`, `#splitEachQuantity`,
`#toggleTransferLine`, `#confirmTransfer`, `#toggleSplitLine`, `#stepSplitGroup`,
`#setSplitQuantity`, `#stepSplitQuantity`, `#splitPrecision`, `#splitQuantityError`, `#splitErrors`,
`#confirmSplit`, `#holdsDishWithExtrasToPart`, the old `#tidyPickedPortions` branches, `#pickBill`'s
transfer arm; the two ⋮ items, at a party and with no party (D15); `ActionDraft`'s
`lines`/`quantities` if unused); the screen tests in the "Changed test checks" rows marked 9a
whose file is `till-table-order-screen*.test.ts`. The app's `#onTransferLines`/`#onSplitLines` stay
until 9b: the app tests emit those events straight at the screen element, so they stay green.

- [ ] First run the consumer trace; every hit is in 9a's or 9b's list or the ledger.
- [ ] Re-point each R row at Move dishes, keeping its assertion; make each B row's new expectation
      (`:6375`, `:6649`); the W row at `table-menu.test.ts:224`; delete each Q2 row of these files
      (only those), each with its replacement case named in Owner question 2.
- [ ] RED (the re-pointed and B rows fail before the removal is complete, against the old controls):
      `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/screens/till-table-order-screen.a11y.test.ts src/screens/till-table-order-screen.table-menu.test.ts`.
- [ ] Implement the removal.
- [ ] GREEN: the same command, plus `src/till-app.test.ts src/till-app-parties.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts src/till-app-table-service.test.ts`
      (unchanged in 9a); `rg -n '"transfer-lines"|"split-lines"' apps/till/src/screens -g '!*.test.ts'`
      prints nothing; Style and fields; till types.
- [ ] Commit: "Take Split by item and Transfer items off the table screen".

## Task 9b: the app's handlers, the client calls and the words go (≈45 calls)

**Files.** till-app (`#onTransferLines`, `#onSplitLines`, their bindings, the
`tab.transfer_modifier_line` mapping); `api/client.ts` (`splitBill`, `transferItems`, `TabTransfer`
if unused — `rg` first); `strings.ts` (D11's retired keys, each after `rg` shows no user); the app
and client tests in the "Changed test checks" rows marked 9b (`till-app.test.ts`,
`till-app-parties.test.ts`, `till-app-bill-payments.test.ts`, `till-app-drafts.test.ts`,
`till-app-table-service.test.ts`, `api/client.test.ts`).

- [ ] Re-point each R row, make each B row's expectation, delete each Q2 row (`till-app.test.ts:10224`;
      `client.test.ts:3210`, `:3272` and the two `:4513` rows), and drop the F row's fake methods.
- [ ] RED (re-pointed rows fail while the old handlers still answer the old events):
      `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/till-app-parties.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts src/till-app-table-service.test.ts src/api/client.test.ts`.
- [ ] Implement the removal.
- [ ] GREEN: the same command and 9a's screen command; `rg -n "split-lines|transfer-lines|splitBill\(|transferItems\(" apps/till/src`
      prints nothing; Words and codes (`errors-reachable` still green: the server codes are thrown
      by the kept server paths); Style and fields; till types; `pnpm format:check`.
- [ ] Commit: "Retire Split by item and Transfer items from the till".

## Task 10: whole-slice run and controls (no commit unless a fixture moves, ≈50 calls)

- [ ] `memory_pressure | grep free` first; size concurrency to it (CLAUDE.md, "Test concurrency
      follows measured headroom").
- [ ] Unfiltered: `pnpm --filter @waitron/server exec vitest run src/move-dishes.test.ts src/till-api.move-dishes.test.ts src/order-portions.lifecycle.test.ts src/party-bill-actions.test.ts src/transfer-lines.test.ts src/split-bill.test.ts src/till-api.transfer.test.ts src/till-api.split-bill.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/bill-editing.split-transfer.test.ts src/adjustments-bill-payments.test.ts src/simplified-limit.test.ts`.
- [ ] Unfiltered: `pnpm --filter @waitron/till exec vitest run src/state/portion-selection.test.ts src/widgets/portion-picker.test.ts src/widgets/portion-picker.a11y.test.ts src/screens/till-table-order-screen.move-dishes.test.ts src/screens/till-table-order-screen.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/screens/till-table-order-screen.a11y.test.ts src/screens/till-table-order-screen.table-menu.test.ts src/screens/till-table-order-screen.bill-controls.a11y.test.ts src/screens/till-table-order-screen.sent-fallback.test.ts src/screens/till-table-order-screen.recalled-layout.test.ts src/till-app-move-dishes.test.ts src/till-app.test.ts src/till-app-parties.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts src/till-app-table-service.test.ts src/api/client.test.ts`.
- [ ] H2, F, Filing, S, G, Words and codes, Style and fields, both typechecks; the `git diff`
      check under "Guard suites" prints nothing.
- [ ] The server list again with Task 1's 78-file command (its receipts), unfiltered.
- [ ] Re-run every deletion control of Tasks 1–8 once against the finished code (CLAUDE.md §4,
      "Re-run deletion controls after restructuring"); record each red count.
- [ ] `pnpm --filter @waitron/server test:coverage` and `pnpm --filter @waitron/till test:coverage`
      only if a coverage question arises (CI owns the bar).

## Task 11: guides, the runbook and the design-system contract (≈40 calls)

**Files.** `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`,
`docs/developers/design-system.md`, `docs/operations/payments.md` (an operator runbook).

- [ ] EN `{#portions}`: replace the Split by item / Transfer items sentence with Move dishes…
      (whole dishes, a count for identical ones, weighed ones whole). EN `{#bill-switcher}`: the ⋮'s
      bill list names Move dishes… in place of the two. New EN section **Move dishes to another bill
      {#move-dishes}**: what the panel shows, counts, the grey "Paid" and "already paid" ticks and
      why, the destinations (other bills with no payment, + New bill), what stays (a dish's course,
      kitchen state, extras), the refusals and Refund {amount}. ES twins with the shared ids
      (proposal, Owner question 1).
- [ ] design-system: the ⋮ bill list (`:1075-1083`, and `:1082`'s no-party sentence, which now
      names only Merge bills, D15); "Identical portions share one row" names the
      Move dishes picker in place of the two old pickers; a new "The dish picker" contract (ticks,
      counts, blocked rows with a visible reason, quiet Move, the destinations' order), with its
      guards named and any "weaker than its name" hedge.
- [ ] `docs/operations/payments.md:5`: "**Split by item** creates another bill" becomes Move
      dishes… → + New bill (whole dishes; a part-paid bill's unpaid dishes may go). Then
      `rg -n 'Split by item|Transfer items|Dividir por artículo|Transferir artículos' apps docs/developers docs/operations -g '!*.test.ts'`
      prints only `strings.ts` keys Task 9b kept for A1196, if any (each named in the ledger).
- [ ] G; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`; LOOK the served
      `/help/en/table-service#move-dishes` and `/help/es/…` in Task 12.
- [ ] Commit: "Explain Move dishes in the table-service guide and the design contract".

## Task 12: LOOK, and the owner's pictures (≈50 calls)

- [ ] `wa-wt demo waitron-feat-a803-4-portion-picker` (never a bare `pnpm dev`); before any reset,
      `lsof` the venue folder and port 8080.
- [ ] In real Chromium, EN and ES, light and dark, 390 and 1280 px: the ⋮ with Move dishes…; the
      panel with a grouped row unticked and "2 of 4", a weighed row, a paid row, a floor-blocked row
      with its reason (seat a party, take a €40 contribution on a €52 bill), long dish names, the
      destination list with a named bill, Move quiet and active; a refusal (pay a dish from another
      tab, then Move it) and its recovery; Take over on a foreign editor's bill; after Move to a new
      bill (the new bill on screen) and to Bill 2 (source on screen). Keyboard: Tab order, Space on a
      tick, focus back to the ⋮ after Back. Compare row layout with board 08's rows
      (`docs/backlog/mockups/a803-bills-and-tables/08-split-table-pick.png`): tick, name, count, amount.
- [ ] Measure the ⋮'s height at 1280×900 and 390×844 (for A1265's entry).
- [ ] Save the owner's pictures as `docs/backlog/mockups/a803-bills-and-tables/slice4a-*.png` and
      copy them, with each question's text, to Google Drive (`~/My Drive/Waitron mockups/`).
- [ ] Each LOOK finding is fixed test-first in its own commit or recorded in the backlog.

## Task 13: backlog, questions, PR text, hand-off (≈30 calls)

- [ ] `docs/backlog.md`: A803's entry says slice 4a landed and what 4b and 4c hold; delete A1195
      (its check, Task 1, passed); update A1193, A1196 and A1265 as "Scope" says; a new entry for
      each LOOK finding not fixed; a new entry for `bill.payments_received`'s wording, which after
      4a over-claims ("items cannot be transferred between it and another bill") and needs new
      approved Spanish (Owner question 3 may settle it); a new entry: with no party the ⋮'s Merge
      bills does nothing (`#onMergeBills` returns when `#billComposition` answers `null`,
      `till-app.ts:15882-15887`; by reading, D15); A1196's text also gains that A1195's refusal
      covers moves to another bill only, so a part of a weighed line can still be split inside its
      bill (a part discount, a course-group move), as Task 1's in-bill case pins.
- [ ] Questions 1, 3 and 4 to `~/waitron-campaign-c/questions.md` (one at a time format, pictures named);
      the changed-checks FYI entry ("A803 slice 4a (#PR) — changed test checks, FYI, no answer
      needed") pointing at the receipt.
- [ ] PR body, in plain English: what the waiter sees; no venue reset; "Changed test checks"
      (with the receipt); "For the owner" (Q1, Q2 block landing; Q3 and Q4 defaults); the A696
      note; then
      `/finish-branch` with the plan named.
- [ ] Ledger: `Status: in progress` until landed; then 4b's plan is next.

## Cut 4b (outline): waiting dishes leave with their own copy of the course

**Branch** `feat/a803-4b-waiting-course-copies`, after 4a lands (or beside it: it touches
`move-bill.ts`, `table-actions.ts`, `order-groups.ts`, `working-order.ts`'s `refuseHeldLeavingParty`
and `kitchen-print.ts`, none of which 4a changes beyond `carveLines`). Its own task plan and plan
review first. Review weight FULL (kitchen release state; concurrency).

- **Contract.** `copyHeldGroups(tx, fromPartyId, toPartyId, lineIds): Promise<Map<string, string>>`
  in `order-groups.ts`: for each source group in state `held` that holds a leaving line, one new
  `held` group on the destination party, after its existing groups in the source groups' position
  order, with the source's `submittedBy`, `remindAt`, and its HOLD paper facts (`holdPrintedAt`,
  `order_group_hold_stations`) where the MOVED slip lists the dishes under HOLD; never a fired time;
  `lines_moved` events on both groups; the leaving lines (and their extras) rebound to the copy; an
  emptied source group goes `removed` (`removeEmptiedHeldGroups`). It runs before
  `groupArrivingDishes`, which skips grouped lines (finding 7).
- **Paths.** `leaveParty` stops refusing held-group lines for Move this bill to a table (free or
  seated) and for today's one-bill Split a table; Move to the counter keeps `group.held_leaves_party`
  (a counter order has no party or groups). A dish recalled into a draft still travels as a draft
  row.
- **Tests** `A803 waiting copy` (new `waiting-course-copy.test.ts`): whole-bill move and one-bill
  split; one held group shared by a leaving and a staying bill; two held groups with the same
  course label stay two; firing the copy fires none of the source's dishes and the reverse; a
  hand-held group on a course that does not wait by itself stays held at the destination (the
  regression finding 7 predicts); the MOVED slip (decoded) lists only the moved dishes, under HOLD
  where their HOLD paper exists; a refused move leaves every group row unchanged; HOLD/FIRE bytes
  already printed never change. Changed checks (B, spec §3.7, §6): `party-table-actions.test.ts:1432-1446`,
  `party-move-bill.test.ts:740-756`, `order-drafts.db.test.ts:4753-4802` ("split table"), and the
  till's `till-app-parties.test.ts:2542`, `:4163` where they pin the refusal on a table path.
  F, Filing, H2 unedited.
- **Guides** EN/ES: a waiting dish can move with its bill; each table fires its own copy. LOOK:
  kitchen paper previews (58/80 mm) of the MOVED and later FIRE slips; physical printing stays
  unmeasured until done on a printer.
- **Gate:** none from the owner beyond new Spanish (likely none: the refusal wording stays for the
  counter).

## Cut 4c (outline): Split a table through the same picker

**Branch** `feat/a803-4c-split-table-picker`, after 4a and 4b land. Its own task plan and review.
Review weight FULL (wire contract, concurrency, money floor, allergies across packages).

- **Server.** `splitTable(tx, cfg, partyId, tableId, selection: { wholeBillIds: string[]; loose: { billId: string; lineIds: string[] }[] }, options: { expectedPartyRevision; operatorId; guestCounts; expectedEdits }, attendance?)`
  answering `{ partyId: string; billIds: string[] }` (the new party's bills in number order; the
  route adds `zoneRevisions` through `movingRooms` as today). Order inside one transaction: refuse
  duplicates and a bill both whole and loose (`management.request_invalid`); every leaving bill and
  every loose source checked for editors (`requireRelocatableBillEditors`, A773 §6); the loose
  dishes go first onto **one** new bill of the source party with 4a's core (part-paid sources
  allowed, paid lines and the floor refused per source); then every leaving bill (whole bills in
  number order, the new loose bill last) leaves through the existing path with 4b's copies; the
  staying party with no bill gets an empty one (exists); no selection → one empty bill at the
  leaving table (exists). The MOVED reach becomes the leaving bills only, so staying dishes get no
  notice (finding 8; B change of `party-table-actions.test.ts:1466-1482`, spec §3.7).
  `VENUE_SERVICE.splitPartyAllergies` takes `billIds: readonly string[]` (a cross-package interface
  change in `packages/module/src/module.ts:1474-1493` and `packages/venue-service/src/party-allergy.ts:340`),
  copying the answer, unknown and not-asked states per A669.
- **Till.** The 4a widget gains bill headers with a tri-state tick (whole bill; a dish unticked
  turns the bill into loose picks; a whole part-paid bill selectable with its payments, its paid
  dishes not pickable alone), guest steppers for both tables in the same panel (`guestsStepper`,
  `widgets/guest-count.ts:47`), a summary ("T8 takes Bill 2, Bill 3 and 3 dishes from Bill 1 ·
  €109.00"), take-over rows for foreign editors, everything ticked → Move guests / Split anyway,
  nothing ticked → the empty bill. Whether `widgets/split-guests-dialog.ts` and its three test files
  go is an Owner question there (deleted checks).
- **A590.** `#onSplitTable` hands the answer's `zoneRevisions` to the floor screen's `#carry`, as the
  floor's own join does (`till-floor-screen.ts:1662-1669`); test `A803 applies split room revision
  before reload` in `till-app-table-service.test.ts` (hold the next floor read, send a floor edit
  before releasing it: the new revision is sent, no `floor_today.out_of_date`). RED/GREEN:
  `pnpm --filter @waitron/till exec vitest run src/till-app-table-service.test.ts -t 'A803 applies split room revision'`.
- **Owner questions there:** new Spanish (Split anyway, the summary line, guest labels); deleted
  checks of the old one-bill split steps. LOOK boards 08–10 in EN/ES, both themes, 390 and 1280 px.

## Against the master plan's slice 4

| Master plan item | Where |
| --- | --- |
| `widgets/portion-picker.ts`, `.test.ts`, `.a11y.test.ts`; `state/portion-selection.ts` | 4a Tasks 5, 6 (unsaved at the screen, D10) |
| `movePortions`, `/api/bills/:id/move-dishes` | 4a Tasks 2–4 (`moveDishes`, line ids; Departures) |
| `A803 selection` (2 of 4, measured, paid, €40/€39.99, contributions mark nothing paid) | 4a Task 5; whole-bill toggles and a whole part-paid bill in 4c |
| `A803 moves` (part-paid source to existing/new, paid and floor refusals, wrong party, duplicate, cancelled, reserved, stale id, pending payment/refund, presented/settled, full rollback) | 4a Tasks 2, 3 |
| `A803 split` | 4c |
| `A803 waiting copy` | 4b |
| `A803 race replay` | 4a Task 3 (moves); 4c (splits) |
| "relax transfer's untouched rule only for unpaid portions; keep merge's" | 4a D4 (Merge untouched) |
| Cancel/Escape/navigation/switch-bill/reconnect; disabled rows' reason not by colour alone | 4a Tasks 6, 7b |
| LOOK boards 08–10 | 4a Task 12 (rows), 4c (the split) |
| Defect ledger: A590 | 4c; the other rows stay retained as the master plan says |
| EN/ES guides | 4a Task 11, 4b, 4c |

## Task list and sizes (4a)

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight; 4a's reservation; Owner question 2 to `questions.md` | 20 | no commit |
| 1 | a weighed portion is never cut on its way to another bill (A1195) | 40 | green |
| 2 | `moveDishes`, the moves that succeed, twins, a cancelled dish | 65 | green |
| 3 | `moveDishes` refusals and races, rows unchanged | 60 | green |
| 4 | route, issuance, profile rows, client | 55 | green |
| 5 | selection model (whole-row tick, recalled dishes left out) | 50 | green |
| 6 | picker widget, a11y | 60 | green |
| 7a | ⋮ item (not with no party), panel, what Move sends | 50 | green |
| 7b | picks as unsaved work, refreshes, recalled dishes | 45 | green |
| 8 | app handler, refusals as D9, table-service rows | 65 | green |
| 9a | old pickers off the table screen (Q2) | 55 | green |
| 9b | old handlers, client calls and words out (Q2) | 45 | green |
| 10 | whole-slice run, deletion controls | 50 | no commit |
| 11 | guides, runbook, design contract | 40 | green |
| 12 | LOOK, pictures | 50 | pictures committed in 13 |
| 13 | backlog, questions, PR | 30 | green |

About 780 calls for 4a, in 16 tasks, none planned above 65. 4b is about 6 tasks; 4c about 12.

## Review answers (review-1)

Review: `~/waitron-campaign-c/a803-4-plan-review/review-1.md` (1 Critical, 7 Important, 8 Minor),
of the plan at `686f9b81f`. Every finding was checked against the code at `e5bfb0b07` before it was
acted on; none is rejected. What was run, rather than read, is named.

**Experiments run for this revision**, in a throwaway detached worktree at `e5bfb0b07`
(`/tmp/a803-4-rev`, `pnpm install --frozen-lockfile`, removed afterwards with
`git worktree remove --force`), each with `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run …`
in `apps/server` over the 78 files of Task 1's GREEN command, Tests count read:

- **R1**: a refusal of every bound line in `carveLines`' partial branch, only when
  `fromTabId !== toTabId` (the review's recommended variant). Result: 77 files passed, 1 failed;
  4,080 passed, 1 failed: `simplified-limit.test.ts:753`, "expected 400 to be 409" (a unit-bound
  line hand-edited to two, part-transferred to another bill). The probe's log line fired once, in
  that case. What a pass would have meant: the review's variant is safe as written; it is not.
- **R2**: the same, but only for a line whose portion is `measured`. A control case was added
  beside `:753`, rebinding the line to a new measured portion (inserted, since `order_portions` is
  append-only: the first attempt to update it was refused "order_portions is append-only"). Result:
  `:753` passed, and the control was refused 400 `tab.transfer_quantity_invalid` with both bills'
  lines unchanged. Then the 78 files: 78 passed, 4,082 tests passed (the original 4,081 plus the
  control); the probe's log line fired once, in the control only.

| Finding | Answer |
| --- | --- |
| **C1** refusal on a path shared with in-bill splits | **Fixed.** Task 1 refuses only when the dish leaves its bill (`fromTabId !== toTabId`) **and** its portion is measured, which is A1195's own wording ("a partial split or transfer of a bound measured line"). The review's variant (any bound line, across bills) was run (R1) and turns `simplified-limit.test.ts:753` red, so it was narrowed to measured portions (R2, all 78 files green). Every caller of `carveLines` is listed in Task 1 with file:line; the GREEN command is the 78-file sweep (a command that selects by `rg` plus named globs, checked to list the same 78 files as R1 and R2); a new in-bill case pins that a part of a bound weighed line still splits inside its own bill (A1196); three deletion controls. The B row for Task 1 is gone: no existing case is expected to change, and a red one is a stop. |
| **I1** count picker takes recalled dishes | **Fixed.** D17: a dish recalled into any draft is in no row, using the set `#sentFallback` already builds (TOS `:2598-2605`, moved into `#recalledLineIds()` in Task 7b). `pickRows` takes `recalled`; Task 5 case "of 4 Cañas with the first recalled, count 2 picks the second and third"; Task 7b cases for this person's and another person's drafts and for a pick recalled before a refresh; a deletion control. D3 now opens with the master plan's "Filter ineligible paid/reserved portions first". |
| **I2** what a tick takes | **Decided, D16: a tick takes the whole row** (every member the floor allows), − steps down, as both pickers do today (`#toggleTransferLine` `:5130`, `#toggleSplitLine` `:5155`, `#stepSplitGroup` `:5169`). Spec §3.6 and board 08 show "2 of 4" but not the first tick, so it is Owner question 4, default whole row, **not blocking** (the default is today's behaviour). The R rows now hold (they tick whole rows and step down); Q1's example now reads "ticked (all four) and counted down twice". One check does change: `:6649` (Transfer's untick-on-regroup) becomes a B row, since one picker keeps one rule, Split's count (`:6676`). |
| **I3** `till-app-table-service.test.ts` missing; D9 wrong | **Fixed.** Five places in that file, not three: `:1152-1153`, `:1187`, `:1232`, `:1352-1353`, `:1369`, plus the fake at `:297-298`; each is a row (R, or F for the fake). Task 8 adds `move-dishes` rows to the four tables and runs the file; 9b removes the old rows; Task 10 runs it. D9 rewritten to what the code does (`#onTransferLines` → `#onBillPairRefusal` → `#onBillMoneyRefusal` reads bills and balance, `#onTableRefusal` reloads only on `party.out_of_date`, the rest re-read nothing), and `draft.*` take the relocation path's own words. Reading also found D12 and Task 8 promising "the picks are kept" after a refusal while the panel closes on send (`#retireActions`/`#closeActions`, TOS `:5143-5151`); both now say the panel closes and the waiter reopens it. |
| **I4** Q2 cites `:3181` (mergeBills) | **Fixed.** Q2 item 4 and its row cite `:3210` and `:3272`, plus the `transferItems` and `splitBill` rows of the `it.each` at `:4513`, which the plan had missed (`rg -n 'transferItems\|splitBill' apps/till/src/api/client.test.ts` shows `:4565`, `:4588`); `:3181` is named as untouched. Task 0 still re-checks before posting. |
| **I5** Move dishes with no party sends nothing | **Fixed, by not offering it.** D15: no Move dishes… with no party, because `#billComposition` answers `null` there (`till-app.ts:15841-15846`). The no-party ⋮ loses Split by item and Transfer items (a W row on `table-menu.test.ts:224`, and a B row on TOS `:6375`). Merge bills stays there and is equally inert; Task 13 records that in the backlog rather than widening 4a. The server's no-party path stays for parity with `splitBill`. |
| **I6** scope over-claims | **Fixed.** Scope says Split by item, Transfer items and Move dishes never cut a bound measured portion on its way to another bill, and names the partial paths that stay (in-bill splits, part serves, part cancels such as `order-portions.filing.test.ts:665`) under A1196; Task 13 adds that to A1196's text. |
| **I7** runbook | **Fixed.** `docs/operations/payments.md:5` is in the consumer table and Task 11, with a closing `rg` over `apps docs/developers docs/operations`. Only it and `design-system.md` name the old controls in docs (`rg -ln` over `docs` and the READMEs, outside superpowers, backlog, handoffs and compliance). |
| **M1** line number is not creation order | **Fixed.** D3 says line number is the order a dish joined this bill (`moveOrderLines`, `working-order.ts:4052-4058`), and a Departures row records why not "creation ordinal, then UUID": the till's line read has no ordinal, and members of a row are identical. |
| **M2** cancelled dish not covered | **Fixed.** Task 2 case 10: a dish cancelled with its charge kept moves with its cancellation, expected because the cancellation is keyed by line id (`line-service-state.ts:51-95`) and a whole-line move keeps the id; a different result is a stop. |
| **M3** foreign-id control | **Fixed.** The case names Bill 2's line 1 while Bill 1 has a line 1, asserts nothing moved, and the control says it fails because Bill 1's line 1 moved, not on `carveLines`' own `tab.line_not_found`. |
| **M4** D9 for a bill with no party | **Fixed.** D9 says a no-party resend is refused `tab.line_not_found` (Task 3 case), and that the till never sends it (D15), so no new words are needed. |
| **M5** A696 reservation | **Fixed.** Task 0 posts 4a's file list to lane C's `questions.md` as an FYI reservation, and names overlaps if lane E has since recorded one (none at revision: `grep -n 'A696' ~/waitron-campaign-e/questions.md` shows no reservation section). |
| **M6** wrong helper | **Fixed.** D12 and Task 5 name `tabLineGross` (`state/adjust-target.ts:53`, used by TOS `#lineGrossByLineNo` `:1925`) and say `lineGross` is for draft lines; D12 says the greying is an unmeasured estimate at the cent and the server stays the authority. |
| **M7** `counted` comment | **Fixed.** The comment says a partly paid line stands alone and is blocked `paid`, so it cannot be ticked. |
| **M8** words and check order | **Fixed.** Q1 now asks about a floor reason that names the next step (with a proposed wording) and about «platos» for drinks, with «artículos» as the alternative. The route parses `expectedEdits` inside the transaction after `checkZones`, as transfer (`till-api.ts:4221`, `:4224`) and merge (`:4182`, `:4200`) do. |

**Task changes.** Task 7 split into 7a (⋮, panel, what Move sends) and 7b (unsaved picks,
refreshes, recalled dishes); Task 9 split into 9a (screen) and 9b (app, client, words). Estimates
rise to about 780 calls; no task is planned above 65.

## Build record (4a, 2026-11-01)

Where the build of 4a departed from the text above, or found it wrong. The text above is left as
written; this section is the correction.

**Pointers and wording (round-3 claim check of `ba3d3f781`).**
- Task 1 "Why only there": `order-groups.ts:1125` (in `moveLinesToGroup`) moves part of a line to
  another course group; `:1249` and `:1303` are in `splitHeldLineIntoUnits` and split a held line
  into units.
- Task 1's sweep does not select the five server files that split across bills through
  `splitPartyBill`; they were run separately and pass. Since Task 2 the sweep selects 80 files, not
  78: `move-dishes.test.ts` and `till-api.move-dishes.test.ts` match its pattern.
- `carveLines` is reached through `carveOffLines` (`bill-actions.ts:191`, `:305`), not called there.
- "Changed test checks": `till-app-table-service.test.ts:1369` is `:1370`. Task 7b: `ActionDraft`
  is at `:235`; `readGrowingPortions` at `order-portions.ts:272`; the design-system no-party
  sentence spans `:1081-1082`.
- D16 reads spec §6 ("greys out a tick that would break it") differently: a tick that would break
  the floor takes the first members that keep it and greys +; the tick itself is greyed only when
  even one member would break it. This meets §6's aim, no refusal after Move, and is shown to the
  owner with question 4.

**Departures in the build.**
- Task 3: a refund in progress is refused `bill.refund_in_progress`, not `order.payment_in_flight`
  (`refuseRefundInProgress` runs first inside `refusePaymentInFlight`); the case pins that.
- Task 4: the route-test fixture `billActionBody` learned `move-dishes`.
- Task 5: `PickRow` gains `limit` (the most members the floor allows); `tidyPicks` takes the rows
  drawn before and a function drawing the re-read rows over any picks
  (`tidyPicks(before, rowsFor, picks)`), so that re-placed picks keep within the floor together
  (Task 5 review I1).
- Task 6: an unticked grouped row shows its count; `nameOf` has a default; the stepper's + carries
  the floor reason. The amount was the whole row's until the LOOK (Task 12) compared it with board
  08; a ticked row now shows what its picked dishes take off the bill.
- Task 7a: the heading uses `billLabel`; destinations are native buttons with `aria-pressed`, in a
  group labelled by "Move to".
- Task 7b: a destination on its own counts as unsaved work, unless it is no longer offered. Picks
  are re-placed only when the lines, the shown balance, the allergy answers or the recalled ids
  change (300 lines, 60 rows: an update with no change went from 24.4 to 1.3 ms in Chromium).
- Task 8: the new app test file uses the shared `test/allergy-app-fixture.ts`; the "Bill 2" case
  moves to `bill-1` so the bills sort as the case needs; its set-ups need `simplifiedInvoiceLimit`
  and `hasPayments`. Its commit message says 15 cases; the run showed 14 (21 after the review).
  `tab.transfer_modifier_line` cannot be reached from the till: the picker's rows are dishes only
  (`portion-selection.ts`), so no words were added for it.
- Task 9b: its RED step cannot be red. The re-pointed rows assert the move-dishes handler, which
  exists since Task 8; the check is the `rg` of the retired names, which prints nothing.
- Task 10: the controls re-run found the paid filter in `pickRows`' picked total unreached since
  the Task 5 fix; a direct case was added (`ada7185cb`), red with the filter deleted.
- Task 11: a guide link to a section on the same page names the page
  (`table-service.md#move-dishes`); `guide-content.test.ts` refuses a bare `#move-dishes`.
- Final review: `pickRows` is split. `pickGroups(lines, keyOf, balance, recalled)` groups the bill,
  and the screen keeps that grouping until what it is drawn from changes (`#dishGroupsFor`); the
  list of the bill's dishes shown while the Sent read is missing uses the same grouping.
  `pickRows(groups, picks)` works out each row's limit and blocked reason, and
  `tidyPicks(before, groups, picks)` places the picks again over the kept groups.
  `pickedAmount`, called only by its tests, is removed.
- Final review: a row names its extras and, for a dish that is not one whole unit, its quantity
  (A1292). `PickRow` gains `extras`, and the picker's `nameOf` names a line rather than a row.
