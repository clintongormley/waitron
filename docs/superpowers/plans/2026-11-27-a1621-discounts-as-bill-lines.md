# A1621 — Discounts held on the bill until the invoice: build plan

Status: cleared to build (lane B, 2026-11-27): D1–D22 by the watcher, D23 by the owner (below);
read once by a fresh reader (below). Fiscal: the owner lands
every pull request marked "owner lands" below. D12 depends on lane L's OVERPAID-BILLS.

**Cleared.** The watcher cleared D1–D22 on 27 November at 12:52 with four changes, in its words (lane
B's `questions.md`, "WATCHER 2026-11-27 12:52"; its plan review is
`~/waitron-campaign-shared/codex-review/last-plan-b-a1621.out`), each taken in where it says:
1. "Shares moved onto an existing bill (D8) need a visible row from 7a: have 6b draw them at the
   bill's foot until 6c." (D8, 6b, 6c.)
2. "D12: name the part-paid cancel case (12.00 + 8.00, 5.00 off, 5.00 paid, Burger cancelled →
   refused under the plan); make that refusal list the discount so the waiter can remove it; test it
   in 7a." (D12, 6b, 7a.)
3. "D23(b) also needs 2b's pending-discount subtraction for placed Counter orders; and an order
   placed without payment outside a pay-after-sending zone would still need (a). Write both into
   D23." (D23, 2b, 3, 7a; the second half as the owner's answer below settles it.)
4. "2a's read test checks what the read gathers against PR 1's output, not PR 1's figures again." (2a.)

The owner answered D23 at 13:00, through the watcher ("WATCHER 2026-11-27 13:00"), picking "Keep it
removable until payment, by briefly reopening the order at payment" (option 2): "changing a discount
changes what is payed, which means we need to open/correct the original and issue a new one. so yes,
we should be able to reopen it". The watcher added that an order placed without payment outside a
pay-after-sending zone "needs the same reopen (say how)", and that 7a rewrites the CLAUDE.md rule
it widens in the same change. D23 below is that answer, built in 2b, 3 and 7a.

**Fresh read (2026-11-27, on `1d842b6c96`; findings in lane B's `reviews/a1621-plan-fresh-read-1.md`).**
No Critical, seven Important, ten Minor. Each was checked against the code before it was taken.
Taken in:
- **I-1** `storedOrderTotal`'s change moved from 3a into 2b: without it 2b's own payment test
  cannot complete a bill (the paid check reads `readBillFigures`, `bill-payments.ts:828`, `:1112-1119`).
- **I-2** D23 rewritten as the two honest choices; 7a waits for the answer and tests the counter
  case. The reader's receipt holds: `withSentOrderOpen` (`sent-order-open.ts:46-61`) already reopens
  a placed, unpaid Counter order in a pay-after-sending zone (used at `pay-for-items.ts:256` and
  `bill-payments.ts:2395`), and the close of day invoices placed bills (`close-of-day.ts:128`).
- **I-3** A declined card's put-back (`movedItemsBack`, `bill-payments.ts:2379-2410`, which calls
  `moveOrderLines` into the existing source) runs 4a's move hook in an undo mode.
- **I-4** Taken in part. The till can already give a set menu a comp: the set-menu summary's Comp
  (`apps/till/src/widgets/set-menu-summary.ts:250-262`) calls the order screen's `#compMenu`
  (`till-table-order-screen.ts:1920`), which targets the set menu's own line; the reader's search for
  `setMenuRole` missed it. What it found that holds: nothing in the till reads the preview's
  `replaces` (ran `rg`), so "the till says so" (spec 6.7) was built nowhere. 6c now reads it.
- **I-5** D12 is now a dependency on lane L's OVERPAID-BILLS, with the reason.
- **I-6** `shared_from` is a foreign key set to empty when its row goes; the put-back on an empty link
  is stated. The guard named in the finding (`scripts/id-columns-are-references.test.ts`) covers only
  tables a configuration import transfers (its header), which this one is not; the check is
  `scripts/schema-constraints.test.ts`.
- **I-7** Copying a line's pending discounts when the line splits moved from 4a into 2b, because
  crystallising splits lines itself; PR 1 works out a split line the same way, and 2b tests the two
  against each other.
- **M-1** 3b's check folded into 2b and Remove into 7a: sixteen pull requests. 2b is about four
  hours, but its three tasks are separate. 7a now waits only for 6b (the bill's foot and the
  question); the drawings that wait on lanes N and E are in 6c, which gates 7b.
- **M-2** guards are "never weakened"; PR 9 removes the retired tables' and code's entries, including
  `seed.madrid-baseline.test.ts:465-466` (ran `rg`).
- **M-3** `till-app.ts` (at its cap) is listed in 6b with "move a block out first".
- **M-4** requests other than Pay, Print, Pay for items, the counter, unpaid departure and the deferred
  close show the refusal's own wording, not the dialog (6b).
- **M-5** the payment preview refuses only a payment that would complete the bill.
- **M-6** Remove's set-menu claim moved to 7c, where it can fail; D16 gains a control; 2b names the
  test that no edit can make a discount stop holding between the check and the invoice.
- **M-7** "Give a different discount" is one request (7a).
- **M-8** taken in part: the schema test moved to `packages/adjustments/src/schema/`; the
  non-existent `working-order-table-state.test.ts` replaced by `tabs.test.ts`; `bill-payments.ts`
  moves a block out first. Kept: `unattended` is not `moneyMoved` again, because `moneyMoved` also
  lets a captured card file a product taken off sale (`bill-payments.ts:1166`), which a refund's
  completion must still refuse.
- **M-9** lane E's slices name the pull requests they wait for (Overlap).
- **M-10** an old comp test that crystallises first and checks what a crystallising test already
  checks is merged into that test, not kept twice.

> **For agentic workers:** use superpowers:subagent-driven-development, one implementer per task,
> dispatched as `subagent_type: "implementer"`. Steps are test first.

**Spec:** [`2026-11-27-discounts-as-bill-lines-design.md`](../specs/2026-11-27-discounts-as-bill-lines-design.md),
approved by the owner on 27 November ("sounds great, build it!", ~11:28 CET, its Status line); its
section 14 holds the owner's four answers (~11:58 CET). The watcher relayed both in lane B's
`questions.md`, "WATCHER 2026-11-27 11:50 — A1621: the design is approved; plan it next": "Free
joins now; a whole-bill amount stays whole on a cancel; no condition rule now; a whole-bill % moved
to a NEW bill carries over as a whole-bill %, to an EXISTING bill becomes an amount on each moved
item."

**Words used in this plan.**

- A **pending discount** is a comp or discount held on an open bill as a row of its own, not yet
  written into any line's price. "Free" (a comp) is one kind of pending discount (owner's Q1).
- **Crystallising** a discount is writing it into the bill: lowering the lines' prices and writing
  today's `adjustments` and `adjustment_lines` records, then deleting the pending row. It happens
  once, just before the invoice.
- **The working-out** is one pure function that says what every pending discount takes off the bill
  as it stands now. The bill's shown total is the stored line totals less the working-out.
- **Dormant** code is built and tested (its tests insert pending rows directly) but reachable by
  nobody until a later pull request lets the comp window write pending rows.
- **The check before the invoice** refuses a request that would make the invoice while a pending
  discount no longer holds, so the waiter can remove or replace it first (spec 6.6).

**How the receipts below were got.** Every `file:line` is on main `f9c8d830d6` and was read, not
run, unless it says "ran". Five research passes read the readers of what an open bill owes, the
invoice paths, the moves, the till and the record readers; I re-read, myself, the receipts marked
(†). What I ran: `wc -l` for every file size quoted, `rg`/`git`/`gh pr list --state open` for the
overlap section and the test counts. No test was run.

---

## What staff can do when all of it lands

A waiter gives a discount or Free on the whole bill, a dish, an extra or a set menu, as today, from
**Comp…**. The discount then sits on the bill under what it was given on ("10%  −2.20" under the
burger, "Discount 10.00  −10.00" at the foot) and the total shows what the guest will pay. Until the
bill is paid, printed or otherwise invoiced, the waiter can take any discount off with **Remove**,
with no PIN. A percentage keeps covering what is inside its target: 10% on the burger covers onion
rings added later; 10% on the bill covers dishes ordered later. An amount stays the amount it was:
cancelling a dish never shrinks a whole-bill 10.00 off, so the guest's bill never goes up because a
dish was cancelled. Moving dishes, paying for some items alone, splitting a table or merging bills
takes the right share of a whole-bill discount with the dishes. Changing the extras of a discounted
dish asks nothing; changing a discounted dish's variant asks only when the discount is an amount
("keep the 2.00 off, or remove it?"). Just before the invoice, if a discount no longer applies (its
set menu broke up, or an amount is now larger than what it covers), the till says so and offers
**Remove it** or **Give a different discount**. Receipts, invoices, refunds and reports look as they
do today.

---

## The split: sixteen pull requests

The hard part is the switch from "written into prices when given" to "pending until the invoice".
Every reader of what an open bill owes, every invoice path, every move and the till must all agree
the moment the comp window starts writing pending rows; a half-switched bill shows one total and
files another. **The seam (D1):** build every piece that reads or carries pending rows first,
dormant, each in its own pull request tested with rows its tests insert; then flip the comp window
one target at a time, in the reverse of the crystallising order (whole bill, then set menus, then
dishes, then extras). The reverse order is what keeps each flip correct on its own: spec 7.2
crystallises extras first, then dishes, then set menus, then the whole bill, so a discount still
written at the moment it is given always sits where the final order puts it, earlier than every
pending one. Example after 7a: 10% on the burger is written into its price when given (today's
way), 10% on the bill is pending and taken at the invoice from the bill after the burger's 10%,
exactly as spec 7.2 orders them.

| PR | What a person can do when it lands | Size (product / tests, lines) | Schema change, venues reset | Owner lands |
| --- | --- | --- | --- | --- |
| 1. The working-out (`feat/a1621-1-working-out`) | Nothing changes. | +330 −120 / +600 | No | No |
| 2a. The pending table and its read (`feat/a1621-2a-pending-table`) | Nothing changes. Venues reset. | +420 (+ generated) / +450 | **Yes** | No |
| 2b. Crystallising at every invoice, and the check before it (`feat/a1621-2b-crystallise`) | Nothing changes. | +430 −110 / +700 | No | **Yes** |
| 3. Every list and screen figure for an open bill (`feat/a1621-3-bill-figures`) | Nothing changes; the dashboard's order detail can list a bill's discounts (none yet). | +240 / +400 | No | **Yes** |
| 4a. Discounts follow moved dishes (`feat/a1621-4a-moves`) | Nothing changes. | +330 −20 / +500 | No | **Yes** |
| 4b. Pay for items takes its share, and a declined card gives it back (`feat/a1621-4b-pay-for-items`) | Nothing changes. | +290 −30 / +500 | No | **Yes** |
| 5. A changed dish keeps its discount (`feat/a1621-5-changed-dish`) | Nothing changes. | +200 / +400 | No | **Yes** |
| 6a. The till shows the server's totals (`feat/a1621-6a-till-totals`) | The till shows the box's figure for an open bill's total instead of adding the lines itself; the figures are the same today. | +180 −90 / +300 | No | No |
| 6b. The bill's foot, Remove, and the question before the invoice, on the till (`feat/a1621-6b-till-foot-check`) | Nothing yet (no bill holds a pending discount). | +420 −40 / +450 | No | No |
| 6c. Discounts under dishes, extras and set menus, on the till (`feat/a1621-6c-till-targets`) | Nothing yet. | +300 −40 / +350 | No | No |
| 7a. **Switch:** whole-bill discounts are pending, and Remove (`feat/a1621-7a-bill`) | A whole-bill discount stays a percentage or amount until the invoice, covers dishes ordered later (a percentage), stays whole on a cancel (an amount), can be removed, travels with moved and paid-alone dishes, and set menus keep being worked out under it. A Counter order placed before it is paid keeps its discount removable until the guest pays (D23). A cancel refused because a part-paid bill would come to less than its money names the discount to remove (D12). Venues reset. | +430 −170 / +800, about 30 checks changed | **Yes** (D23's trigger) | **Yes** |
| 7b. **Switch:** set-menu discounts are pending (`feat/a1621-7b-set-menus`) | A set menu's discount or Free no longer locks the set menu; a second one replaces the first and the till says so; if the set menu breaks up the till asks before the invoice. | +180 −220 / +350, about 40 checks changed | No | **Yes** |
| 7c. **Switch:** a dish's own discount is pending (`feat/a1621-7c-dishes`) | A dish's percentage covers its extras added later; an amount stays; both can be removed; a variant change asks about an amount only. | +260 −200 / +450, about 60 checks changed | No | **Yes** |
| 7d. **Switch:** Free on a dish, and every extra's comp or discount, are pending (`feat/a1621-7d-free-and-extras`) | Free on the burger also covers Chips added later; Free on the Chips goes when the Chips go; both can be removed. | +120 −90 / +300, about 35 checks changed | No | **Yes** |
| 8. Reopen to split gives discounts again (`feat/a1621-8-reopen`) | A bill reopened to split holds its discounts as discounts again (a percentage stays a percentage), removable until its new invoice; the report counts each discount once. | +200 −90 / +350 | No | **Yes** |
| 9. The old repair code goes (`feat/a1621-9-cleanup`) | Nothing a person sees, but the adjustments report's help text stops mentioning discounts that came off. Venues reset. | +60 −1,900 / −2,400 | **Yes** | **Yes** |

Each pull request is about three hours of building; 2b is about four and 7a about five (D23's
reopen added a task), each in separate tasks one implementer can finish. 7c is the largest; if its first implementer
passes about 150 tool calls, it stops at a passing point and a second implementer carries on from
its handover (the global rule), it is not split further, because 7c's halves would change the same
test files.

**The spec's piece 4 (guides and demo)** is not a pull request of its own: CLAUDE.md §3 puts a
screen's guide change in the same change as the screen, so 7a–7d and 8 each update the comps section
of `apps/server/src/guide/{en,es}/table-service.md`, and 9 updates the report's help text. The demo
seeds no discounted bill to update (D19).

**Order.** 1 → 2a → 2b → 3, then 4a, 4b, 5 and 6a in any order, then 6b (after its frames, D21)
→ 7a → 6c (after lane N's sent rows and lane E's set-menu
summary land) → 7b → 7c → 7d → 8 → 9. Each lands on its own; none needs a later one to be correct.

---

## Decisions for the watcher

Recommendations, each with why. None changes what the owner decided, except where it says
**question**.

- **D1. The seam above** (dormant pieces first, then four switches by target). Alternative: one
  switch pull request holding 2b–7d's live parts, about two to three days and about 165 changed test
  checks in one review; it cannot be split without the problem the seam solves. The cost of the
  seam: about ten pull requests' worth of code is reachable only by its own tests until 7a, so 7a's
  first test drives every earlier path through the real comp window once more.
- **D2. The working-out lives in `packages/adjustments`, not a browser package.** Spec 6.5 proposed a
  shared package so the till could preview unsent dishes with it. Lane E's A1515-4 slice 2 replaces
  the till's unsent preview with a server quote ("Replace `draftPlacements` with a read-only quote
  for the current bill and draft through `till-draft-routes.ts`", its plan on
  `feat/e-a1515-4-till-set-menus`), so no till code would call it, and the till reads every figure
  from the server (6a). `packages/shared` is mutation-tested at 90 (CLAUDE.md §2) and the till does
  not depend on `@waitron/adjustments` (`apps/till/package.json`, read). If a till caller appears,
  the module moves to `packages/shared` then; it imports only `@waitron/shared`.
- **D3. The table** (spec 6.1 left names to the builder): `bill_discounts`, classified `state` in
  core's set (`packages/db/src/classification.ts`, beside the adjustments tables at `:382-410`),
  listed in `ADJUSTMENTS_TABLES` (`packages/adjustments/src/classification.ts:4-11`) and in
  `scripts/write-path-tables.json` naming one writer file. Columns: `id`; `working_order_id` (null
  for a dish or extra target, whose bill is its line's, so moving a line moves its discount with no
  write; set for a bill or set-menu target); `line_id` (a dish or extra; foreign key, deleted with its
  line); `set_menu_line_id` (foreign key, set to null when the grouping deletes the row, as
  `working_order_lines.set_menu_line_id` already is, `packages/db/src/schema/orders.ts:439-443`);
  `set_menu_id` and `set_menu_name` (to name it once its row is gone; `set_menu_id` references
  `menus` with no delete action, as `working_order_lines.set_menu_id` does: product code only
  deactivates a menu, `packages/menu/src/delete.ts`, and the one hard delete is the configuration
  import at first setup); `action` (`comp`,
  `discount_percent`, `discount_amount`, today's names, so crystallising maps one to one);
  `percent_bp`; `amount`; `origin` (`given` or `bill_share`, D8); `shared_from` (the row an amount
  share was split from, so a declined card can give it back, D10; a foreign key to this table set to
  empty when that row goes, because the source bill can be invoiced, and its rows deleted, while Pay
  for items' card is still in the reader, `pay-for-items.ts:294-298`); `given_together` (one id for the
  portions of one till row, removed together, spec 6.1); `position` (order given); the reason id,
  name and policy snapshot as `adjustments` copies them (`adjustments.ts:56-60`); `requested_by`,
  `approved_by`, `note`, `given_at`. CHECKs pin one target shape per row and the action/percent/amount
  pairing. Indexes on each foreign key column.
- **D4. An abandoned bill's pending rows are deleted by a trigger.** Spec 6.4 says "deleted with the
  bill's other open state", but nothing deletes a bill: abandoning only sets its status, and lines of
  a bill that is not open can be neither deleted nor written (`packages/db/triggers/core.sql:132-150`,
  `:397-409` (†)). One trigger in `triggers/core.sql`, after an update of `working_orders.status` to
  `abandoned`, deletes the bill's rows and the rows on its lines. The alternative, a delete at each
  of the five abandoning sites (held order, merge, declined card, counter abandon, an emptied party),
  is easier to miss.
- **D5. How crystallising writes: work out once, write as worked out** (the watcher, 2026-11-28
  03:43, replacing "one at a time, each worked out again on the bill as it now stands"). The bill's
  discounts are worked out once, by PR 1's working-out over the inputs the shown total reads, and
  each is written with exactly those figures, line by line and part by part: one record per
  discount over every line or part it covers, through today's `reprice` and `recordAdjustment`
  (`adjustments-apply.ts:1029-1105`, `:1185-1227` (†)), so the records keep today's shape and the
  amount charged is the amount shown. The `asked` check reads the same working-out, and the bill's
  pending rows are deleted before any price changes, after that check. The record's `created_at`
  is the moment of the invoice; the people, reason and note are the pending row's. Part of a line is never crystallised: a discount on part of
  a line splits the line when it is given (spec 6.1).
- **D6. Who is asked before the invoice.** Asked (refused with the check, before any money moves):
  a payment that would complete the bill, cash or card, checked where a payment's start already
  refuses a correction still open (`bill-payments.ts:1831-1836` (†)), so a card is checked before it
  is charged; Print the bill; unpaid departure; Pay for items, for the new bill and for the source bill
  it may issue (`pay-for-items.ts:300`, the spec names only the new one); the counter's sale and
  zero-bill close; an edit that leaves a paid bill exactly covered (cancels, line edits, moves, a
  comp bringing the bill to zero: the edit routes that call `issueIfFullyPaid`); and **the deferred
  close** (see "Found against the code", item 1). Not asked (crystallised as they stand, with an
  activity entry, spec 6.6): the close of day; every completion after money moved (the reader's
  second transaction, the card follow-up job, a manager's card or refund resolution, a held bill);
  a card refund's completion and its recovery job (`issueAfterBillRefund`,
  `tender-refund-sends.ts:334-353` (†)), marked by a new `IssueOptions.unattended`, not by
  `moneyMoved`, which would also let it file a product taken off sale (`bill-payments.ts:1166`). A
  cash or hand-keyed card refund that completes in its own request and leaves the bill exactly
  covered is not asked either: it passes `unattended` too (`bill-refunds.ts`), because the money has
  already gone back and corrections never wait (watcher, 2026-11-28 03:57, A1619). A
  hand-keyed card is charged on another machine before its
  request, so its check is the payment preview (`previewBillPayment`, `bill-payments.ts:1405` (†)),
  for a payment that would complete the bill only (a part payment is never asked); 6b pins by test
  that the till previews before a hand-keyed card. Requests other than Pay, Print the bill, Pay for
  items, the counter, unpaid departure and the deferred close (a cancel, a move, a comp to zero) show
  the refusal's own wording with the discounts named, not the dialog.
- **D7. The refusal code is `adjustment.no_longer_applies`**, in the adjustments registry
  (`packages/adjustments/src/errors.ts`), its details listing each discount: its id, `why`
  (`set_menu_gone` or `cut_down`), what it was given on (dish, extra or set-menu name, or the bill),
  its action, percentage or amount. A condition of its own (spec 6.6 kind 2) is left out: none exists
  (owner Q3).
- **D8. A share of a whole-bill discount arriving on an existing bill** (owner Q4: "calculate the
  amount and apply it to the individual items that move") is a pending amount on each moved line
  with `origin = bill_share`. Such a share never takes a dish out of its set menu (a dish's own
  discount does, spec 6.7), never replaces a set menu's own discount (spec 6.7's one-per-set-menu
  rule), is crystallised with the dishes' step, and shows on the till as "Share of Table 4's 10%".
  **Consequence for the watcher to weigh (possible question for the owner):** being on the item, a
  share goes when that item is cancelled, unlike a whole-bill amount, which a cancel never shrinks
  (Q2). Recommended: accept it as the literal reading of Q4 (the watcher cleared it, 12:52).
  **Where a share shows (watcher's change 1).** From 7a a move into an existing bill writes these
  shares, and 6c, which draws a discount under its dish, lands after 7a. So 6b also draws each share
  at the bill's foot, naming the dish it sits on, with its amount and **Remove**, until 6c moves it
  under the dish. Until then no total falls without a row that says why.
- **D9. Dishes from several bills into one new bill** (a table split's loose dishes,
  `table-actions.ts:347`, one new bill for all, `:422`): a whole-bill percentage is carried as a
  whole-bill percentage only when every moved dish came from one bill and that bill holds it; if two
  source bills hold one each, each moved dish takes its share as an amount (D8), so a percentage never
  reaches dishes that did not carry it.
- **D10. A discounted line split later** (Pay for items taking 1 of 3 beers on one line;
  `carveLines` copies a split line's reductions today, `working-order-transfer.ts:635`,
  `order-portions.ts:144-174`): the new part gets a copy of each pending discount on the line, a
  percentage or Free as it is, an amount shared by quantity (cents left over to the earlier part),
  no share above what its part costs once the discounts worked out before it are off, as PR 1's
  working-out shares an amount over a split line's parts (2026-11-28: shared by quantity alone,
  5 beers at 3.35 holding 15.72 then 1.03 lost a cent when one beer was split off). Built in 2b
  (I-7); crystallising itself deletes the pending rows before it splits a line (D5). A whole-bill amount
  split between two bills keeps `shared_from` so a declined card gives it back (spec 6.4's
  put-back, builder's call; 4b).
- **D11. A cancel still records the stored lines' drop**, undiscounted
  (`regroupAfterRemoval` reading `sum(line_total)`, `working-order-removal.ts:293-305`); pending
  discounts are worked out at the invoice, so the adjustments report shows the cancel at the dish's
  charge and the discount at what it finally took.
- **D12. A bill paid past its total: a dependency on lane L's OVERPAID-BILLS, not a question.** Spec
  6.5 sends a bill whose shown total falls below the money taken to "the existing
  give-back-or-keep-as-tip flow". Today a comp or discount that does that is refused
  (`bill.received_exceeds_total`, `bill-payments.ts:477`; `assertBillInvariantAt`,
  `adjustments-apply.ts:974` (†); pinned by `set-menu-dish-adjustments.test.ts:562`). The owner already
  decided the rule on 24 November in OVERPAID-BILLS' design, which lane L builds
  (`docs/backlog.md:581-584`: "A cancel, discount, move or split may leave more on a bill than it comes
  to, settled before it closes"), so asking again would reopen a decision made. Why a dependency and
  not a part of this plan: that rule is one change for cancels, discounts, moves and splits alike,
  and lane L owns it. Every check A1621 keeps reads the shown total (2b, 3), so when OVERPAID-BILLS
  lifts the refusal it covers pending discounts with no further change. Until then, a discount given
  after a part payment that would take the bill below its money is refused, exactly as today, so 7a
  does not wait for it. Whichever of 7a and OVERPAID-BILLS lands second adds the case "10% given after
  a part payment leaves the bill overpaid and offers give-back or tip" to its tests. Removing a
  discount only raises the total, so it never trips the refusal.
  **The part-paid cancel (watcher's change 2; spec 6.5 names it).** From 7a a cancel on a part-paid
  bill with a whole-bill amount standing is refused where today it is allowed: the cancel paths run
  the overpaid check (`assertBillInvariant`, `working-order-removal.ts:194`, `:207`, `:286`), and from
  2b that check reads the shown total. Example: a 12.00 Burger and an 8.00 dish, 5.00 off the bill,
  5.00 paid in cash, then the Burger cancelled. Today the 5.00 is spread into the prices when given
  (3.00 and 2.00 off), so 6.00 is left and the cancel is allowed. Under the plan the 5.00 stays whole
  (owner's Q2), so the bill would come to 3.00 against 5.00 paid, and the cancel is refused
  `bill.received_exceeds_total` (`refuseExcess`, `bill-payments.ts:475-477`). So the waiter can get
  past it, that refusal lists the bill's pending discounts in its details whenever the bill holds any
  (each one's id, what it was given on, its action and percentage or amount), the till's wording names
  them (6b), and removing the 5.00 lets the same cancel through (the bill then comes to 8.00 with
  5.00 paid). Built and tested in 7a; when OVERPAID-BILLS lifts the refusal, the list goes with it.
- **D13. Totals computed in SQL** (the floor's tab total, the held-orders list, the counter's waiting
  list, the party bills, the orders list, Find bill, which also sorts and pages by total in SQL,
  `find-bill-bills.ts:70`, `:139`, `:232-234` (†)): the box works out, in code, what pending discounts take
  off each open bill that holds one, and hands the result to the query as a JSON table (`json_each`),
  so totals, sorting and paging stay exact and in SQL. Only bills with a pending row are worked out.
- **D14. A comp that brings the bill to zero still issues the invoice at once** (the comp route's
  `closeZero`, `adjustments-api.ts:252` (†); guide `table-service.md:16`), crystallising first; the
  check before the invoice is asked then.
- **D15. The dashboard's order detail lists an open bill's pending discounts** (it shows each line
  and a total, `apps/dashboard/src/widgets/order-detail-dialog.ts:42-45`, `:435`; without them, an
  open bill's lines would not add up to its total). Small; in 3.
- **D16. The grouping's tie-break** (spec 6.7: between equally cheap groupings, keep a discounted
  set-menu row): a failing test first, with its control: two groupings of equal price, the discounted
  row kept; and a grouping one cent cheaper without it, the cheaper one chosen (so a test that passes
  because the grouping never moves anything fails the control). The calculation already prefers
  keeping saved places (`packages/shared/src/set-menu-grouping.ts:470-479` (†)); if that passes both,
  no code.
- **D17. Reopen to split** (spec 8, builder's call on the mechanism): copies take their list prices;
  each of the printed bill's comps and discounts is given again as a pending row on the copies, same
  action and percentage (an amount as its recorded `reduction`), same reason, people and note; when it
  crystallises, its record names the printed one in `reapplies_adjustment_id`
  (`adjustments.ts:80-81`), and the report and the free-items sheet count only the last record of
  such a chain.
- **D18. A variant change on a held order** (counter only: the till offers no variant change on a
  sent table dish, `apps/till/src/screens/till-table-order-screen.ts:2949`): a percentage or Free
  follows the new line silently; an amount makes the save refuse `adjustment.amount_on_changed_dish`
  listing them until the request says keep or remove for each. An extra rewritten because its count
  changed keeps its discount. A dish the save re-inserts without its line id loses its discount, as
  today (today its records stay behind on the deleted line id).
- **D19. No demo change.** The demo seeds reasons only (`apps/server/scripts/demo-seed/seed-adjustments.ts`)
  and no sale or bill with a comp (`seed-sales.ts`, searched for adjustments, none). Spec 15.4
  assumed discounted demo bills.
- **D20. Activity entries** (spec 6.6, 9): `discount.given`, `discount.removed`,
  `discount.written_as_it_stood`, declared in `packages/db/src/activity-kinds.ts`, people by id only.
- **D21. The till's drawing waits for frames.** 6b draws the bill's foot, Remove and the question;
  6c draws a discount under a dish, an extra and a set menu. The owner sees the frames through the
  watcher before each is built. Only 6c waits for lane N's sent rows (its PR 8a) and lane E's set-menu
  summary (A1515-4 slice 1), so 7a (whole bill) waits for 6b only, and 7b for 6c.
- **D22. Remove** is `DELETE /api/working-orders/:id/discounts/:discountId` with the bill's
  revision, built in 7a; it removes the discount's `given_together` group, needs `adjustment.apply`,
  no PIN, never the simplified-invoice refusal (spec 6.5, 10), and is refused while a payment is in
  flight (`refusePaymentInFlight`, `working-order-edit-state.ts:233`). **Give a different discount**
  is one request: the comp window's apply takes `replacesDiscountId` and deletes that discount in the
  same transaction as it writes the new one, so a refusal leaves the old one standing.
- **D23. Orders placed before they are paid: the owner chose (b), removable until payment** (owner,
  2026-11-27 13:00, through the watcher: "changing a discount changes what is payed, which means we
  need to open/correct the original and issue a new one. so yes, we should be able to reopen it").
  See "Found against the code", item 2. Example: at the Counter a coffee and a cake, 10% off; staff
  press Place order and the kitchen starts. Staff can still remove the 10% until the guest pays, and
  the payment writes it in. Choice (a), writing it at Place order, is not built.

  **Which orders it covers** (traced on this worktree's base; "ran" is a test run here, passing).
  Every placed order with no sale. Any of them can be paid (`requirePayableBill` accepts a placed
  bill with no invoice, `bill-payments.ts:1395-1397`; the issue at `:1087` accepts placed) or
  invoiced unpaid (unpaid departure; the close of day, `close-of-day.ts:102`, which marks only an
  open bill placed, `:128`). Three kinds reach that state:
  - a Counter order in a pay-after-sending zone (`ticket_then_pay`), placed by the till's Place order
    (`placeOrder`, `working-order-counter.ts:73-130`) and paid later. The database already lets this
    one go back to open (`withSentOrderOpen`, `sent-order-open.ts:46-61`);
  - a Counter order outside such a zone placed without payment. `placeOrder` checks that the bill is
    open, its editor, that it holds no payment and has none in flight (`:93-98`), and that its dishes
    can be sent (`:103-109`); it reads the zone's mode (`:99-100`) only to print a collection ticket
    (`:123-125`), so no check refuses a prepay order. The till never sends Place for a prepay order
    (`apps/till/src/till-app.ts:8985` returns first), but the server accepts it: ran
    `counter-handover.test.ts` "refuses a placed order whose service mode takes payment first", whose
    fixture places a prepay-zone order with no payment (`:112-127`);
  - a placed, unpaid Counter order moved to a table, which gains a party and stays placed
    (`takeIntoParty`, `move-bill.ts:554-576`): ran `unpaid-departure.test.ts` "invoices in full a bill
    placed without an invoice", whose fixture (`placedCounterBillMovedTo`,
    `testing/bill-venue.ts:617-650`) places a prepay-zone order, moves it to a table and invoices it.

  The database refuses the last two going back to open: the trigger's placed-to-open branch asks for
  no party, `ticket_then_pay` and no sale (`working_orders_enforce_transition`,
  `packages/db/triggers/core.sql:833-836`); ran `scripts/behavioural-triggers.test.ts`'s cases "refuses
  a placed order going back to open while it belongs to a party" and "… when its recorded mode is
  prepay / table_tab / null". So the watcher's 12:52 note that such an order "would still need (a)"
  holds for today's trigger; the owner's answer, relayed at 13:00, gives it "the same reopen", built
  as point 3.

  **How (b) is built.**
  1. **The figure (2b, 3).** `storedOrderTotal` subtracts pending discounts for a bill with no sale,
     open or placed (watcher's change 3), so a placed order's payment, preview and checks read the
     discounted total; 3's SQL sites likewise, since the counter's waiting list shows placed Counter
     orders (`listCounterWaiting`, `working-order-counter.ts:441-442`, its total `:460`).
  2. **Remove and the replacement need no reopen (7a).** They write only `bill_discounts` rows and the
     bill's revision. Nothing in the database stops either on a placed order: the trigger's
     placed-to-placed branch leaves `revision` free (`core.sql:768-796`), as `takeIntoParty`'s
     `revision + 1` on a placed bill shows (`move-bill.ts:547`, `:568`, reached by the
     `unpaid-departure` run above), and `bill_discounts` has no trigger on its bill's status (D3, D4).
     So Remove (D22) accepts a placed bill with no sale, and the comp window's apply accepts one only
     with `replacesDiscountId` (Give a different discount: a change to a discount, which the owner's
     words cover). A new discount on a placed order stays refused, as today (`assertTabOpen`,
     `stored-order-lines.ts:375-384` (†), called at `adjustments-apply.ts:549`). This corrects the
     first version of (b), which had Remove reopen the order. From 7c, Remove works set menus out
     again, which writes lines; on a placed order that runs inside point 3's reopen (7c).
  3. **The reopen at the invoice (7a).** Crystallising writes lines, which the database allows only
     under an open order (`core.sql:132-150`, `:396-409` (†)). `sent-order-open.ts` gains
     `withPlacedOrderOpenForDiscounts(tx, orderId, write)`: for a placed order with no sale that holds
     a pending row, it sets the order open, runs `write` and sets it placed again if `write` left it
     open, as `withSentOrderOpen` does; any other order runs `write` alone. `crystalliseBillDiscounts`
     (2b) runs its writes inside it, after its `asked` check, so a refusal is raised before the order
     is opened (the caution at `sent-order-open.ts:43-44`), and every invoice path that reaches a
     placed bill goes through that one call. The trigger gains a second placed-to-open branch:
     status-only (the same pinned columns as the first), no sale, and a `bill_discounts` row on the
     order or on one of its lines; any party, any mode. The first branch is unchanged, so for an
     order holding no pending discount the database refuses exactly what it refuses today. What the
     database cannot tell is which caller reopens: Pay for items' move on a party's placed order
     holding a pending discount would pass the new branch, so Pay for items stays held to today's
     orders by its own check (`sentCounterOrderWithoutReceipt`, unchanged) and by the guard's caller
     list (7a).
  4. **The rule widens in 7a's own change**: CLAUDE.md §3's line, `scripts/sent-order-open.test.ts`,
     the trigger and its tests, and the topic file (7a, "The rule it widens").

  The trigger lives in `packages/db/triggers/core.sql`, which the rebuild appends to core's starting
  migration (`apps/server/scripts/migration-baseline/rebuild.ts:78-79`, `:126-127`; the trigger
  stands at `packages/db/drizzle/0000_baseline.sql:3655`). So 7a rebuilds core's starting migration
  and **venues reset**, said in its pull request's first line (CLAUDE.md §3).

---

## Found against the code

1. **The deferred close is a till request, not an invoice "nobody is asked about".** Spec 6.6 lists
   it with the close of day, but it is `POST /api/working-orders/:id/close-deferred`
   (`deferred-close-api.ts:164`) behind a till session, and it refuses `deferred_close.conflict` when
   the priced total differs from the total the till sent (`deferred-close.ts:146-149` (†)). So it is
   asked (D6).
2. **A counter order can be placed before it is paid, and then its lines cannot be written.** The
   counter's Place order sets the order `placed` without an invoice (`working-order-counter.ts:81-128`
   (†)); a later payment issues it (`issueOrSettleWhenFullyPaid` accepts `placed`,
   `bill-payments.ts:1087` (†)). The database refuses inserting, updating or deleting lines of an order
   that is not open (`packages/db/triggers/core.sql:132-150`, `:397-409` (†)), and crystallising
   updates prices and may split a line in two. So spec 7.1 ("in the same transaction" as the invoice)
   cannot hold for such an order as the code stands. The owner chose to reopen the order at its
   invoice (D23), which needs a second branch in the trigger for placed orders outside a
   pay-after-sending zone or moved to a table (7a).
3. **A cascade alone silently drops some discounts.** Spec 6.1 has a dish or extra discount deleted
   with its line. Real removals delete lines, but two writes delete and re-insert what a person sees
   as the same dish or extra: a held-order save's variant swap (`working-order-held-write.ts:147-154`,
   deleted at `working-order-line-edits.ts:1181-1195` (†)) and an extra whose per-dish count changes
   (`working-order-line-edits.ts:749-781`). PR 5 moves their discounts to the new line before the
   delete.
4. **Nothing deletes a bill** (D4): abandoning sets a status; `abandoned` is final
   (`core.sql:742-754` (†)).
5. **Two of spec 6.5's "readers" read no prices.** `billOwes` (`parties.ts:984-992` (†)) reads status
   and line counts; `stillOwedOnIssuedBill` (`bill-payments.ts:594-600` (†)) takes the amount it is
   given. Neither changes. The full list of readers is in 2b (the payment path) and 3 (lists and
   screens).
6. **"The existing give-back-or-keep-as-tip flow" does not yet take a discount** (D12).
7. **The demo has no discounted bills** (D19).
8. **The till would not call a shared working-out** (D2).

---

## Traced readers of the records, the freeze and the endings, and what happens to each

Read (a research pass, with the (†) ones re-read by me). The readers of what an open bill owes are
in PR 2b's page (the payment path) and PR 3's (lists and screens); the invoice paths in 2b's.

| Reader (`file:line`) | What it decides today | Fate, and where |
| --- | --- | --- |
| `readReasonStanding` (`packages/adjustments/src/record.ts:108-133` (†)), from `judgeComp` (`adjustments-apply.ts:824-830` (†)) | A reason's limit counts what it still has off the bill | Adds pending discounts' working-out (7a); its ending join goes (9) |
| `judgeComp`'s `billComped` (`adjustments-apply.ts:831-836` (†)) | The bill's comp limit | Adds pending discounts (7a) |
| `readRows`, `listValue`, `standInRow` (`adjustment-rows.ts:58-122`, `:208`) | The comp window's base, nominal value, till rows | Kept for giving; base reads the shown figures (7a–7d); `ending` parameter goes (9) |
| `billTotalOf`/`rowsAfter` (`adjustment-bill-total.ts:38-147` (†)) | The comp window's "bill goes from … to …" | Built on the working-out (7a); release simulation kept (7c) |
| `atReleasedPrices` (`set-menu-dish-release.ts:19-54` (†)) | A dish with its own discount leaves its set menu | Kept; its frozen test reads pending set-menu discounts (7b) |
| `setMenuReplacement`, `endReplacedOnSetMenu` (`set-menu-adjustment.ts:82-108` (†)) | A set menu's second discount replaces the first | Replacement deletes the pending row (7b); ending goes (9) |
| `placedSetMenuDishes` (`set-menu-bill.ts:338-388`) | Which set-menu dishes may move alone (`movable`) | Reads pending dish discounts (7c); ending parts go (9) |
| `resolveMoveLines` (`bill-actions.ts:210`, `:241-271`) | A discounted set menu moves whole with its dishes | Reads pending set-menu discounts (4a) |
| `readPicks` (`pay-for-items.ts:89`, `:158-176`) | Pay for items' picks, ending a broken set menu's discount | Pending shares (4b); ending goes (9) |
| `frozenLineIdSources`, `reducedLineIds` (`set-menu-freeze.ts:18-78` (†)); `frozenLinesOf`, `belowListPrice` (`set-menu-grouping-plan.ts:83-108` (†)) | The grouping's freeze | `reduced` reads pending own dish discounts (7c); a set-menu discount stops freezing (7b), a whole-bill one (7a); `belowListPrice` and the written-record part go (9); the kept-charge cancel's freeze stays |
| `refuseMovingFrozenDishes` (`set-menu-moves.ts:20-71`) | `set_menu.move_adjusted` | Discount branch and code go (9); the kept-charge branch stays |
| `readEditableOrder`'s `adjusted` (`working-order-edit-state.ts:352` (†)) | Added units of a discounted line go apart | Also reads pending (5) |
| `carryLineReductions` (`order-portions.ts:144-174`) from `carveLines` (`working-order-transfer.ts:635`), line-edit copies (`working-order-line-edits.ts:1021`) and `copyBillDishes` (`split-after-print.ts:403`) | A split or copied line keeps its reductions | Pending copies (4a); Reopen gives again (8); open-bill uses go (9) |
| `readLockedLines`' stamp and `rowKey` (`stored-order-lines.ts:194-208`, `portion-sale-projection.ts:31-55`) | Lowered rows file apart | Unchanged (crystallised rows) |
| `readBillLines` to the till (`stored-order-lines.ts:460`, `:558-560`) and to the dashboard (`orders-list.ts:839-881`) | The "was" price | Unchanged; pending discounts reach both as `discounts` (3) |
| `endingRestores`, `endAdjustment`, `givenBackBy`, `readDiscountNotices` (`packages/adjustments/src/endings.ts:219-446` (†)); `endRepricedDishDiscounts` (`dish-discount-ending.ts:88-131`); `setMenuDiscountsLeftBy`, `endSetMenuDiscounts`, `endDiscountsCancelledBy` (`set-menu-discount-ending.ts:100-227`); `readBillsDiscountNotices`, `requireOpenNotice` (`discount-notices.ts:48-129`) | Rule C's repairs and notices | Reach only written records after each switch; deleted (9) |
| `readBillAdjustments` (`record.ts:163-247`), `receiptLines` (`receipt-adjustments.ts:82`) | Receipts and invoices | Unchanged; ending joins go (9) |
| `reports.ts` (`:297-336` came-off rule, `:347`, `:387`, `:471`), `free-items.ts:150-183` | The adjustments report, the Given free sheet | Count only written records, the last of a Reopen chain (8); came-off rule goes (9) |
| `give-back-read.ts:229-257`, `refund-links.ts:54-102`, `line-cancel.ts:450-466` | Cancels and refunds | Unchanged (cancels only) |

**Writers.** `recordAdjustment` (`record.ts:60-96` (†)) from `applyAdjustment` (`adjustments-apply.ts:1185`)
and `line-cancel.ts:499`; `adjustment_lines` from `adjustments-apply.ts:1218-1227` (†) and
`order-portions.ts:173`; the list-price stamp in `reprice` (`adjustments-apply.ts:1039-1044` (†)).
Comp and discount writes move to crystallising (2b, live from 7a–7d); cancel writes stay.

**The till's readers of discounts today.** The comp window (`widgets/adjustment-dialog.ts`, 1,070
lines) reads the preview's `billTotal`, `reduction` and `needsApproval` (`:372-399`), never `lines`,
`replaces` or `nominalValue`, and never sends `reapplies`; its whole-bill Free is sent as 100%
(`:343-346`, `:515`). A comp shows only as a struck-through price (`widgets/price-was.ts:18-26`;
`till-table-order-screen.ts:3480`, `:3884-3899`; `basket.ts:1277-1289`). `listUnitPriceGross` is
also read by `state/split-selection.ts:101-114`, `state/portion-groups.ts:60-70`,
`till-app.ts:8790` and `:17323`. `discountNotices` is declared and never read
(`api/floor-api.ts:137`, `api/orders-api.ts:161`). 6b, 6c and 9 change these; the split and portion
readers keep reading written records, which open bills no longer hold after 7d.

---

## Global constraints (every pull request)

- Every commit `git commit -s`; work in a `worktree.py new waitron <branch> --headless` worktree.
- Money in whole cents (`decimalToCents`, `centsToDecimal`); amounts and percentages on the pending
  row in cents and basis points (`money`, `rate` from `packages/db/src/schema/columns.ts`).
- One transaction per request; write functions take `tx: Transaction`; awaits in turn, never
  `Promise.all` on one transaction.
- New code in new files. Caps (ran `wc -l`): `adjustments-apply.ts` 1,246 of 1,250;
  `bill-payments.ts` 2,740 of 2,750; `orders-list.ts` 1,246 of 1,250; `working-order-line-edits.ts`
  1,210 of 1,250; `parties.ts` 1,091 of 1,250; till `till-app.ts` 25,758 of 25,758 (no room: move
  code out before adding any); `till-table-order-screen.ts` 7,431 of 7,500; `till-floor-screen.ts`
  3,250 of 3,250; `basket.ts` 1,467 of 1,500; `bill-pay-dialog.ts` 2,378 of 2,500;
  `adjustment-dialog.ts` 1,070 of 1,250 (`scripts/product-file-size-limits.json`). A pull request
  adding lines to a file near its cap moves an equal or larger block out first, in the same pull
  request.
- Nothing touches `computeHuella`, the chain, numbering or the record builders. Every pull request
  runs, unedited: the golden huella test
  (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`) and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`.
- **Tests the owner's way** (lane rules, owner 2026-11-09): when behaviour moves between layers, the
  property moves to its new owner (a price lowered "when given" becomes "when crystallised": those
  checks move into the crystallising tests, and the comp window's tests check the pending row and the
  shown total); a dependency's failure is tested once, at that dependency; before asserting a side
  effect did NOT happen, run the worker to an end point; search `apps/server/src/testing/`
  (`adjustment-venue.ts`, `set-menu-spec-fixture.ts`, `bill-payment-fixture.ts`) before adding a
  helper. A test that checks a price right after a comp keeps its check by calling the real
  crystallising function (2b) first, unless the design changed what it pins. Every changed check is
  listed in the pull request's "Changed test checks", checked at least as strictly. Golden huella,
  `inmutabilidad`, other fiscal hash or filing tests and every guard under `scripts/` are never weakened; PR 9
  removes only the entries naming the tables and the error code it retires.
- Every new or retired error code: `scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`,
  and its English and Spanish till wording in `apps/till/src/i18n/codes.ts`.
- Every new till route: refusing cases and inventory rows in
  `apps/server/src/till-api.profile-actions.test.ts` (CLAUDE.md §3).
- A guide change: `apps/server/src/guide-content.test.ts`, `scripts/guide-links.test.ts`, the
  box-word guards (`apps/server/src/guide-box-word.test.ts`).
- Each pull request updates `docs/backlog/menu.md`'s A1515 entry (the A1621 note dated 27 November)
  where it makes it stale, and deletes what it finishes.
- A sale-path read changes in 2b: its pull request carries a line starting `Sale-path read changed:`
  so the watcher's bench count sees it (CLAUDE.md §4, the A1308 rule, applied here by analogy).

## Review focus (all pull requests)

1. **The shown total equals the invoice, to the cent** (anti-goal 3), on a bill with a weighed line
   (the spread can take less than it was asked, `spreadBillDiscount`'s note,
   `packages/adjustments/src/spread.ts:300-310` (†)), a bill whose discount splits a row of several
   units into two prices (`splitRows`, `spread.ts:165`), and a bill of whole portions bound into
   one filed row (`spreadOverFiledRows`, `adjustments-apply.ts:371-420` (†)).
2. **A guest's bill never goes up because a dish was cancelled** (anti-goal 1): lane B's bill of 25
   November (spec 7.3) stays 17.00.
3. **No pending row survives an invoice, and none is written into a bill twice.**
4. **No sale is blocked:** every refusal names a discount the waiter can remove.

---

## PR 1 — The working-out (`feat/a1621-1-working-out`)

**What lands.** A pure function that, given a bill's lines and its pending discounts, says what each
discount takes off now, how each line's price would change, and which discounts no longer hold. No
caller yet except today's comp window, which starts using the helpers it shares. Nothing a person
sees changes.

**Today (read).**
- The arithmetic is in `packages/adjustments/src/spread.ts`: `percentReduction` (`:198-204`),
  `discountShares` (`:268-272`), `spreadBillDiscount` (`:300-361`), all pure.
- The rest of a discount's arithmetic lives in `apps/server/src/adjustments-apply.ts`, mixed with
  database reads: `requestedDiscount` (`:275-297`), `portionExactness` (`:314-322`), `spreadReaching`
  (`:328-341`), `spread` (`:344-361`), `spreadOverFiledRows` (`:371-420`, reads bound portions with
  `readPortionBindings` and `readLockedLines`), `handOut` (`:424-444`), `zeroed` (`:523-532`), and
  the exactness rules per target inside `planAdjustment` (`:573-742`) (all (†)).
- What a target covers: a set-menu row with its charged dishes (`setMenuDishes`,
  `apps/server/src/set-menu-adjustment.ts:20-23` (†)); a dish with its extras (`planAdjustment`'s
  `family`, `:612-616` (†)).

**The change.**
1. New `packages/adjustments/src/bill-discounts.ts` (pure; imports `@waitron/shared` and
   `./spread.js` only). Input: the bill's lines (id, line number, parent, set-menu row,
   quantity, price quantity, unit and total in cents, unit precision, and each line's bound-portion
   group when the bill has any, read by the caller) and its pending discounts (target, action,
   percentage or amount, origin, position). It works the discounts out in spec 7.2's order (extras,
   then dishes and `bill_share` amounts, then set menus, then the bill; within a target Free first,
   then by position), each on its target as the earlier ones left it. A line one discount prices at
   two prices becomes two rows for the next, numbered after the bill's last line number, as
   `splitLinesWithinOrder` numbers them (`rowsAfter` already simulates this,
   `apps/server/src/adjustment-bill-total.ts:115-134` (†)); 2b's test checks the numbers against the
   real split. A later discount on a line an earlier one split works out as 2b's copy on a split
   does (D10): one copy on each part, a percentage or Free as it is, an amount shared by quantity. Output per discount: what it takes off, the rows it leaves each line at, and whether it
   holds (`yes`, `set_menu_gone` when its set-menu row is gone, `cut_down` when an amount exceeds
   what its target costs). Output for the bill: the total taken off.
2. Move `portionExactness`, `spreadReaching`, `spread`'s line mapping, `handOut`'s pure part and
   `zeroed` from `adjustments-apply.ts` into the new module, and `gross` (now `lineGross`), `setMenuDishes`'s filter (now `coveredBySetMenu`) and the per-target exactness rules (`withExactness`, `takesAlone`, `exactOnWholeBill`); `adjustments-apply.ts` imports them
   (about 120 lines out of a file at its cap). `spreadOverFiledRows` keeps its two reads and calls
   the pure part, `spreadOverFiledGroups`.

**Tests (failing first).** `packages/adjustments/src/bill-discounts.test.ts`:
- spec 7.3's four worked examples, figure for figure (the owner's two items 50.00/10.00; the Daily
  bill 22.00 − 5.00 shared 3.18 and 1.82; the burger: 10% takes 1.40, then 1.55 with onion rings; 2.00
  shared 1.71 and 0.29);
- order: 10% on the dish then 10% on the bill takes the bill's 10% from the bill after the dish's;
  Free before a percentage on one dish; two dish discounts in the order given;
- a set-menu target covers the row and its charged dishes, not their paid extras; its row gone →
  `set_menu_gone`, nothing taken; an amount over its target → `cut_down`, the target to zero;
- a weighed line: what is taken can differ from what was asked, and the function reports what is
  taken (the assertion that fails if the function reported the asked amount);
- a `bill_share` amount works out with the dishes' step;
- two discounts on a line of three units, the first splitting it into two prices: the second works
  out once per part, as D10 copies it (2b checks the same figures against the database).
The assertion that fails if the behaviour is deleted: each example's per-line figures and total.
`adjustments-apply.test.ts` runs unchanged (the moved helpers keep today's results).

**Changed test checks.** None.

**Checks to run.** `pnpm --filter @waitron/adjustments exec vitest run`, `pnpm --filter
@waitron/server exec vitest run src/adjustments-apply.test.ts src/set-menu-adjustments.test.ts
src/bill-discounts-filing.test.ts`,
`pnpm --filter @waitron/adjustments test:coverage` (98/98/98/95), golden huella, `inmutabilidad`,
`scripts/product-file-size.test.ts`.

**Files.** `packages/adjustments/src/bill-discounts.ts` (new), its test (new),
`packages/adjustments/src/index.ts`, `apps/server/src/adjustments-apply.ts`,
`apps/server/src/adjustment-rows.ts`, `apps/server/src/set-menu-adjustment.ts`,
`apps/server/src/adjustment-bill-total.ts`, `apps/server/src/bill-discounts-filing.test.ts` (new),
`docs/backlog/menu.md`.

**Tasks.** 1.1 the module with the order and target rules and their tests; 1.2 moving the helpers
out of `adjustments-apply.ts`, `adjustments-apply.test.ts` green.

---

## PR 2a — The pending table and its read (`feat/a1621-2a-pending-table`)

**What lands.** The `bill_discounts` table (D3), its one writer file, the trigger that clears an
abandoned bill's rows (D4), and the read that works out every open bill's discounts. Nothing writes a
row yet. **Venues reset** (CLAUDE.md §3: the schema rebuilds core's one starting migration).

**Today (read).** No table holds a discount before it is written into prices; the adjustments tables
are in core's set (`packages/adjustments/src/classification.ts:3`, "They live in core's set"),
classified at `packages/db/src/classification.ts:382-410` (†), and listed append-only in
`packages/migrations/migrations.manifest.json:28-32`. `ADJUSTMENTS_TABLES` also drives the backup
check (`packages/adjustments/src/backup-verification.ts:9`) and the live change sources
(`classification.ts:13-18`).

**The change.**
1. `packages/db/src/schema/adjustments/bill-discounts.ts` (new) with D3's columns, foreign keys
   (`working_orders` restrict, `working_order_lines` cascade for `line_id`, set null for
   `set_menu_line_id`, `bill_discounts` set null for `shared_from`, `persons` restrict), CHECKs and
   indexes; exported from
   `packages/db/src/schema/adjustments/index.ts`; `classify("bill_discounts", "state", …)`;
   `ADJUSTMENTS_TABLES` gains it (mutable, so not in `immutableTables`).
2. The trigger (D4) in `packages/db/triggers/core.sql`.
3. `packages/adjustments/src/pending-discounts.ts` (new), the only writer
   (`scripts/write-path-tables.json`: `"bill_discounts": ["packages/adjustments/src/pending-discounts.ts"]`):
   insert, delete, move a share, read by bill (a bill's own rows plus the rows on its lines).
4. `apps/server/src/bill-discounts-read.ts` (new), in two exported steps so each is tested at its
   own layer: `gatherBillDiscountInputs(tx, billIds)` reads each bill's lines (the columns `readRows`
   reads, `adjustment-rows.ts:72-122`), bound-portion groups and pending rows (its own and its lines')
   into PR 1's input; `readBillDiscounts(tx, billIds)` runs PR 1 on that input and answers per bill
   its discounts with what each takes off and whether it holds, and the total off. A bill with no
   pending row costs one indexed read and is not worked out.
5. `pnpm --filter @waitron/server migration-baseline rebuild --set core`.

**Tests (failing first).** `packages/adjustments/src/schema/bill-discounts.test.ts` (beside the
existing `adjustment-lines.test.ts` there): each CHECK refuses its bad shape; a line delete removes
its dish discount; a grouping delete of a set-menu row leaves its discount with no row; deleting a
row a share was split from leaves the share with an empty `shared_from` (the assertion that fails
with the default `restrict`); abandoning a bill clears its rows and its lines' rows (the assertion
that fails without the trigger). `apps/server/src/bill-discounts-read.test.ts`, with rows inserted
through the store on a real venue (`useVenueDb`, `provisionAdjustmentVenue`), tests what the read
gathers, not PR 1's figures again (watcher's change 4; PR 1's own test holds the arithmetic):
- for two bills, each holding a whole-bill 10% and a dish's 2.00, `gatherBillDiscountInputs` hands
  over, per bill, exactly the expected lines (with the columns PR 1 takes), bound-portion groups and
  pending rows, and none of the other bill's (the assertion that fails if the read misses a line's
  row, reads only the bill's own rows, or takes another bill's);
- a row on a line moved to the other bill is in the new bill's input and not the old one's (the
  assertion that fails if the read finds a dish's row by `working_order_id`, which D3 leaves empty);
- a bill with no pending row is answered with nothing off and is not handed to PR 1;
- each bill's `readBillDiscounts` answer equals PR 1's function called in the test on that same
  expected input (the assertion that fails if the read changes PR 1's input or output on the way,
  with no figure written out twice).

**Changed test checks.** None.

**Checks to run.** The schema guard list: `scripts/schema-constraints.test.ts`,
`scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
`scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts`,
`scripts/starting-migrations.test.ts`, `scripts/write-path-tables.test.ts`,
`scripts/migration-upgrade.test.ts`, `scripts/live-subscriptions.test.ts`,
`packages/composition/src/composition.test.ts`, `inmutabilidad`; golden huella;
`pnpm --filter @waitron/adjustments exec vitest run backup-verification`; `@waitron/db`'s and
`@waitron/adjustments`' `test:coverage`.

**Files.** The schema file (new), its test in `packages/adjustments/src/schema/` (new),
`packages/db/src/schema/adjustments/index.ts`,
`packages/db/src/classification.ts`, `packages/db/triggers/core.sql`, `packages/db/drizzle/**`
(generated), `packages/adjustments/src/{classification,pending-discounts}.ts`,
`scripts/write-path-tables.json`, `apps/server/src/bill-discounts-read.ts` and its test (new),
`apps/server/src/testing/bill-discounts.ts` (new: inserts pending rows for later pull requests' tests).

**Tasks.** 2a.1 schema, trigger, classification, rebuild, schema tests; 2a.2 store and read, with
their tests.

---

## PR 2b — Crystallising at every invoice, and the check before it (`feat/a1621-2b-crystallise`)

**What lands.** Every path that invoices a bill's dishes first writes its pending discounts into the
lines and records them; the payment path's figures read the discounted total; a split line keeps its
pending discounts; every asked path (D6) refuses a discount that no longer holds before money moves.
Dormant. Owner lands (invoice paths). About four hours, in three tasks.

**Today (read).** Every dish invoice prices the stored lines at one of two calls:
`priceForIssuance` (`working-order-invoice.ts:293-317` (†)), called by Print the bill
(`meal-end.ts:116`), unpaid departure (`unpaid-departure.ts:113`), the deferred close
(`deferred-close.ts:143`) and the close of day (`close-of-day.ts:102`) (all (†)); and the payment path's
own call (`bill-payments.ts:1165` (†)), reached through `issueWhenFullyPaid` by every payment, card
completion, counter sale, zero bill and every edit that leaves a paid bill exactly covered. The full
trigger list (26 groups, from the routes down) is the research pass's; the only `recordSale` callers
in product code (ran `rg`) are `working-order-invoice.ts:349`, `bill-payments.ts:1198` and the advance
ticket's `bill-advances.ts:166`, which files money, not dishes. `priceForIssuance` says it "Writes
nothing but `log`'s lines" (`:291-292`).

The payment path's figures all come from `storedOrderTotal` (`stored-order-lines.ts:264-268` (†)),
which has six callers, all meaning "what the bill owes" (ran `rg`): `readBillFigures`
(`bill-payments.ts:828` (†)), which feeds the fully-paid check (`:1112-1119`), a payment's amount and
`coversBill` (`:1775-1833`), equal splits (`packages/orders-sales/src/bill-allocation.ts:77-92`; 2026-11-27: since O2a it calls
`equalShare` in `packages/shared/src/equal-share.ts`), the
preview (`previewBillPayment`, `:1405-1427`), the balance (`readBillBalance`, `:871`),
`assertBillInvariant`/`readBillExcess` (`:466-552` (†)), advances (`issueAdvanceIfOwed`,
`:1009-1028`) and the card's completion (`completeBillPayment`, `:2241-2253`); `totalBeforeEdit` and
`refuseOrderOverSimplifiedLimit` (`stored-order-lines.ts:280-306` (†)); `refuseBelowAdvances` callers
at `move-bill.ts:349` and `pay-for-items.ts:293`; `createOpenOrder` (`working-order-open.ts:295`, a
new order, never discounted). Crystallising and this figure must land together (fresh read I-1): with
only one of them, the paid check and the invoice disagree and a payment either never completes or is
refused by the database's tender check.

Crystallising can split a line in two prices (`reprice`, `adjustments-apply.ts:1059-1068` (†), through
`splitLinesWithinOrder` and `carveLines`, `working-order-transfer.ts:685`, `:635`), so a second
discount on the same line must follow the split part too (fresh read I-7).

The precedent for refusing before a card is charged: `refuseWhileAdvanceCorrectionOpen` when a
payment covers the bill (`bill-payments.ts:1831-1836` (†)), and in Pay for items before the reader
(`pay-for-items.ts:297`).

**The change.**
1. `apps/server/src/bill-discounts-crystallise.ts` (new): `crystalliseBillDiscounts(tx, cfg, billId,
   { asked })`. With `asked`, a discount that does not hold refuses `adjustment.no_longer_applies`
   (D7; the code and its details land here, its till wording in 6b). Otherwise, delete the bill's
   pending rows, run PR 1 once and write each discount in order with exactly its figures, with
   `reprice` (moved from `adjustments-apply.ts:1003-1105` to `apps/server/src/adjustment-reprice.ts`,
   unchanged) and `recordAdjustment` (D5); a discount that did not hold gets a
   `discount.written_as_it_stood` activity entry (D20).
2. Call it first in `priceForIssuance` (an `asked` parameter, its doc changed to say it writes the
   bill's discounts) and before `bill-payments.ts:1165` (`asked` unless D6's not-asked paths;
   `IssueOptions` gains `unattended`, set by `issueAfterBillRefund` and the job and manager routes).
   Close of day passes `asked: false`.
3. `storedOrderTotal` subtracts `readBillDiscounts`' total off for a bill with no sale, open or
   placed (D23: a placed order keeps its discounts pending until it is paid; watcher's change 3); its
   doc says so. One place covers every payment-path reader above, for a placed Counter order as for
   an open bill.
4. `carveLines` copies a split line's pending discounts to the new part (D10), through the store; PR
   1's working-out splits a line the same way.
5. The check before money moves: `refuseDiscountsNotHolding(tx, billId)` (in the crystallising file)
   where a payment covers the bill (beside `bill-payments.ts:1836`) and in the payment preview when
   the previewed payment would complete the bill. It reads `readBillDiscounts`, so the shown total,
   the question and the invoice read one working-out. `bill-payments.ts` has 10 lines of room (ran
   `wc -l`): move a block out first.
6. D23 (b): Place order writes nothing; the reopen that lets crystallising write a placed order's
   lines is 7a's, so here crystallising a placed order is reached only by tests, and none inserts a
   row on a placed order except the figure's test below.
7. One grouping of bound portions (the watcher, 27 Nov 17:00, on PR 1's review): the invoice code
   (`projectPortionSale`, `apps/server/src/portion-sale-projection.ts`) and PR 1's calculator
   (`filedRows`, `packages/adjustments/src/bill-discounts.ts`) share one function for which bound
   dishes file as one row, instead of keeping two copies. PR 1's agreement test
   (`apps/server/src/bill-discounts-filing.test.ts`) keeps running unedited over the shared function.
   This touches the invoice path, which is why it is here and not in PR 1.

**Tests (failing first).** `apps/server/src/bill-discounts-crystallise.test.ts`, with inserted rows:
- **the shown total equals the invoice**: for each fixture of Review focus 1, `readBillDiscounts`'
  total off equals the fall in the lines' own total after crystallising (`storedOrderTotal`, which
  already takes it off, item 3, stays the same), and equals the receipt's discount lines (the
  assertion that fails if crystallising wrote anything else); the split rows' line numbers equal
  PR 1's simulation;
- **two discounts on one line of three units** (fresh read I-7): 10% then 1.00 off a line of three
  beers at 3.35; PR 1's figures equal what crystallising writes, line by line (the assertion that
  fails if the second discount reached only the original part);
- a cash payment of the discounted total completes and issues the bill (the paid check and the
  invoice agree; fails if either reads the undiscounted total); the simplified-invoice limit reads the
  discounted total; equal split shares the discounted total;
- **a placed order's figure** (D23): a Counter order placed in a pay-after-sending zone with an
  inserted 10% row, and a placed order moved to a table holding one: `readBillFigures`' total, the
  payment preview's and the balance are 90% of the lines (the assertion that fails if the
  subtraction reads only open bills); paying and invoicing such an order is 7a's;
- each path crystallises: Print the bill, unpaid departure, a cash payment, the close of day, the
  reader's second transaction (records exist after, pending rows gone);
- asked and not holding: a cash payment that would complete the bill is refused and no payment row
  exists after (run the request to its end, then read); a reader payment is refused in its first
  transaction and the fake provider is asked for nothing; a part payment is not refused; Print the
  bill, unpaid departure, Pay for items, the deferred close, a counter sale and a cancel leaving a paid
  bill exactly covered are refused the same way; the card follow-up completing a held payment is not
  refused and writes it as it stood, with its activity entry;
- **nothing can stop a discount holding between the check and the invoice** (spec 6.6): while a card
  payment is pending, every bill edit route is refused (`refusePendingPartPayment`,
  `working-order-edit-state.ts:242`), one case per route; if one is not, its invoice crystallises as
  it stood and the case says so;
- `reprice`'s move changes nothing: `adjustments-apply.test.ts` unchanged.

**Changed test checks.** None.

**Checks to run.** The new test; `bill-payments.test.ts`, `bill-payments.card.test.ts`,
`bill-payments-api.test.ts`, `pay-for-items.card.test.ts`, `meal-end.test.ts`,
`unpaid-departure.test.ts`, `close-of-day.test.ts`, `deferred-close.test.ts`,
`adjustments-apply.test.ts`, `receipt-adjustments.test.ts`, `split-off-extras.split.test.ts`; golden
huella; `inmutabilidad`; `scripts/alert-codes.test.ts`; `scripts/errors-reachable.test.ts`;
`scripts/product-file-size.test.ts`; `scripts/write-path-tables.test.ts`.

**Files.** `apps/server/src/{bill-discounts-crystallise,adjustment-reprice}.ts` (new),
`adjustments-apply.ts`, `working-order-invoice.ts`, `stored-order-lines.ts`, `working-order-transfer.ts`,
`bill-payments.ts`, `tender-refund-sends.ts`, `bill-payments-loop.ts`, `payments-resolution-routes.ts`,
`close-of-day.ts`, `packages/adjustments/src/{errors,pending-discounts}.ts`,
`packages/db/src/activity-kinds.ts`.

**Tasks.** 2b.1 the function, `reprice`'s move, copying on a split, and the equality tests; 2b.2
`storedOrderTotal` and the call sites with their `asked` choice; 2b.3 the check before money moves.

---

## PR 3 — Every list and screen figure for an open bill (`feat/a1621-3-bill-figures`)

**What lands.** Every list and screen total for an open bill subtracts its pending discounts, and the
bill reads the till uses carry a `discounts` list. The payment path's figures moved to 2b. Dormant
(no rows), so every figure is today's. Owner lands (the totals the deferred close sends back as its
expected total).

**Today: every reader, traced (read).**
- **Totals summed in SQL** (D13): party bills (`parties.ts:757`, giving `outstanding` and `overpaid`
  at `:792-793`, read by the floor, split sources, deferred close's `expectedTotal`); held orders
  (`working-order-held-read.ts:192`); the counter's waiting list (`working-order-counter.ts:460`,
  used while no sale exists, `:561`); the floor's tab total (`working-order-table-state.ts:195`,
  `:310`); the orders list (`orders-list.ts:186`, its owed at `:508`, the dashboard's Orders); Find
  bill (`find-bill-bills.ts:70` (†), its owed at `:108`, sort and paging at `:139`, `:232-234` (†)).
- **Deliberately unchanged:** `working-order-removal.ts:299-305` (a cancel's recorded drop, D11);
  `billOwes` and `stillOwedOnIssuedBill` (no prices, "Found", item 5); every reader of an issued bill
  (`readBillFigures`' issued branch, `sale-due.ts:31`, receipts, corrections, reports).
- **Left to other pull requests:** the payment path (2b); the comp window's own figures (`readRows`,
  `billTotalOf`, `judgeComp`: 7a); Pay for items' prices (`readPicks`, `totalOnOwnBill`,
  `totalLeftBehind`: 4b); the till's own sums (`billGross`, `till-table-order-screen.ts:2481-2488` (†);
  `WorkingOrderStore.total`, `apps/till/src/state/working-order.ts:500-503`; `payLines`,
  `state/bill-payment.ts:393-419`: 6a).

**The change.**
1. `apps/server/src/pending-off-sql.ts` (new): the bills with no sale holding pending rows, open or
   placed (D23; the counter's waiting list shows placed Counter orders, `working-order-counter.ts:441-442`,
   its total `:460`), worked out once per read, as a SQL `json_each` table; each SQL site above
   subtracts it (one or two lines each; `orders-list.ts` has 4 lines of room).
2. `discounts` (each discount, its target, action, value, what it takes off now, whether it holds,
   its origin and reason name) on `PartyBill` (`parties.ts`), the held order read
   (`working-order-held-read.ts`), and the dashboard's order detail (D15), with the dashboard
   widget's rows.

**Tests (failing first).** With inserted rows: a bill with 10% shows 90% of its lines in each SQL
site's answer (party bills, held orders, the floor, the counter list, orders list, Find bill, Find
bill sorted by total placing it by its discounted figure; the assertion that fails if a site reads
`sum(line_total)` alone); a placed Counter order holding 10% shows 90% in the counter's waiting
list (the assertion that fails if the table holds open bills only); the deferred close accepts the party bill's discounted total as its
expected total; the dashboard's order detail lists the discount.

**Changed test checks.** None (whole-shape checks of the answers gain `discounts: []` where a test
pins the exact shape with `toEqual`; listed in the pull request).

**Checks to run.** The tests of each touched reader (`parties.test.ts`, `working-order-held-read.test.ts`,
`tabs.test.ts`, `table-signals.test.ts`, `orders-list.test.ts`, `orders-list.reads.test.ts`,
`find-bill-bills.test.ts`, `deferred-close.test.ts`), the dashboard's `order-detail-dialog` tests,
golden huella, `inmutabilidad`, `scripts/product-file-size.test.ts`,
`scripts/live-subscriptions.test.ts`.

**Files.** `pending-off-sql.ts` (new), `parties.ts`, `working-order-held-read.ts`,
`working-order-counter.ts`, `working-order-table-state.ts`, `orders-list.ts`, `find-bill-bills.ts`,
`packages/shared/src/adjustment-policy-types.ts` (the wire type),
`apps/dashboard/src/widgets/order-detail-dialog.ts`, their tests.

**Tasks.** 3.1 the SQL sites; 3.2 the `discounts` field and the dashboard's order detail.

---

## PR 4a — Discounts follow moved dishes (`feat/a1621-4a-moves`)

**What lands.** Move dishes, table split and merge carry pending discounts by spec 6.4 and the
owner's Q4, and a declined card's put-back undoes what the move did. Dormant. Owner lands (it
decides which invoice a discount lands on). Copying on a line split is 2b's (fresh read I-7).

**Today (read).** One update moves lines between bills, keeping their ids
(`working-order-transfer.ts:186-194` (†)), then both bills are worked out again (`:197-198` (†)).
Callers: Move dishes (`moveDishes`, `bill-actions.ts:341`, to a new bill when `toBillId` is null,
`:378-406`), table split (`splitTable`, `table-actions.ts:347`), merge (`mergeCheckedBills`,
`bill-actions.ts:168`), the declined card's put-back (`movedItemsBack`, `bill-payments.ts:2379`).
A set menu's own discount is ended when some of its dishes leave (`working-order-transfer.ts:155-163`
(†)); a set-menu row whose dishes are all chosen moves whole when it carries a discount
(`resolveMoveLines`, `bill-actions.ts:210`, `:241-271`). Splitting part of a line copies its
reductions (`carveLines`, `working-order-transfer.ts:635`; `carryLineReductions`,
`order-portions.ts:144-174`).

**The change.** `apps/server/src/bill-discounts-moves.ts` (new), called from `moveOrderLines` after
both bills are worked out again, with a mode, `move` or `undo`:
1. A dish or extra discount needs nothing (its bill is its line's, D3).
2. (Line splits: 2b.)
3. A whole-bill discount when dishes move: to a **new** bill, a percentage is copied (the source
   keeps it) and an amount is split by what each bill charges after the move, before discounts (spec
   6.4; the owner's 50.00/10.00 → 3.00 and 7.00); to an **existing** bill, the moved dishes' share
   (a percentage worked out on them, an amount's share) becomes an amount on each moved line, origin
   `bill_share` (D8), the source's amount reduced by it; from several bills, D9.
4. A set-menu discount whose set menu's every dish moved moves with them and attaches to the
   destination's set-menu row of the same type holding them, else stays with no row (spec 6.4's last
   paragraph); `resolveMoveLines` reads pending set-menu discounts beside today's.
5. A merge is a move of every line into an existing bill.
6. **Undo mode** (fresh read I-3), passed by the declined card's put-back (`movedItemsBack`,
   `bill-payments.ts:2379-2410`, which moves the items back with `moveOrderLines` into the existing
   source): no share is worked out. Before the move back, inside the put-back's own savepoint, the
   Pay for items bill's copied whole-bill percentages are deleted, and each of its amounts is added
   back to the row named by `shared_from` and deleted. An empty `shared_from` means the source's row
   was written by an invoice made while the card was in the reader (`pay-for-items.ts:294-298`); the
   source is then not open, `moveOrderLines` refuses the move back, the savepoint undoes the deletes,
   and the items stay on their own bill with their share, to be paid there, as the put-back already
   does for a source no longer open (`bill-payments.ts:2333-2339`).

**Tests (failing first).** With inserted rows: the owner's 50.00/10.00 example to a new bill (3.00
and 7.00) and to an existing one (amounts on the two moved items adding to 3.00); 10% to a new bill
copied, to an existing bill 10% of the moved items as per-item amounts, the destination's other
items untouched (the assertion the owner's Q4 sets); a set menu moved whole keeps its discount on the
destination's row; a table split from two discounted bills (D9); a declined card's put-back from a
bill holding 10% and from one holding 10.00 off: the source's shown total is the same before Pay for
items and after the put-back (the assertion that fails if the put-back worked out a share again, which
would discount the items twice), and no row is left on the abandoned bill.

**Changed test checks.** None.

**Checks to run.** The new tests; `set-menu-regroup-moves.test.ts`, `set-menu-bill-moves.test.ts`,
`bill-editing.adjustments.test.ts`, `split-off-extras.split.test.ts`; golden huella; `inmutabilidad`.

**Files.** `bill-discounts-moves.ts` (new), `working-order-transfer.ts`, `bill-actions.ts`,
`table-actions.ts`, `packages/adjustments/src/pending-discounts.ts`, their tests.

**Tasks.** 4a.1 whole-bill shares (new and existing bill, D9); 4a.2 set-menu discounts and merge;
4a.3 undo mode for the put-back.

---

## PR 4b — Pay for items takes its share, and a declined card gives it back (`feat/a1621-4b-pay-for-items`)

**What lands.** Pay for items' new bill and its preview carry the chosen items' discounts; a declined
card gives them back through 4a's undo mode. Dormant. Owner lands (an invoice path).

**Today (read).** `payForItems` (`pay-for-items.ts:444`) moves the chosen items to a new bill
(`moveItemsToNewBill`, `:243`, splitting part of a line first, `:266-269`) and pays there; it may
issue the source (`:300`). The preview prices the picks as their own bill groups them
(`priceItemPicks`, `:219-229`, via `totalOnOwnBill` and `totalLeftBehind`,
`set-menu-regroup.ts:319-359`). A declined card moves them back (`putItemsBack`,
`bill-payments.ts:2343`) and abandons the new bill.

**The change.** The move goes through 4a (a new bill: a percentage copied, an amount split, its
`shared_from` set). The preview works out both bills' discounts on the lines it already simulates,
without writing (PR 1 on the simulated lines). A printed bill reopened first (`reopenIfPrinted`,
`:395-434`) maps the picks to the copies before the move, as today.

**Tests (failing first).** The owner's two items (12.00 and 28.00) in the preview and in the
payment; the Hake paid alone (spec 7.3: 11.50 and 11.50); the preview's figures equal the payment's
(the assertion that fails if the preview skips the share); a declined reader card leaves the source
at 10.00 off again; the source invoiced while the card was in the reader, then the card declined:
the items stay on their own bill with their 3.00 share.

**Changed test checks.** None.

**Checks to run.** `pay-for-items*.test.ts`, `pay-for-items.set-menus.test.ts`,
`bill-payments.card.test.ts`; golden huella; `inmutabilidad`.

**Files.** `pay-for-items.ts`, `set-menu-regroup.ts`, `bill-payments.ts` (put-back, two lines),
`bill-discounts-moves.ts`, their tests.

**Tasks.** 4b.1 the move and put-back; 4b.2 the preview.

---

## PR 5 — A changed dish keeps its discount (`feat/a1621-5-changed-dish`)

**28 November line-edit split.** Find `addedApart` and pricing in `working-order-line-edit-plan.ts`.
Find the extra rewrites and `endRepricedDishDiscounts` call inside `applyLineEdits` in
`working-order-line-edits.ts`. Both files use the standard 1,000-line limit. The earlier line
numbers and size tally for `working-order-line-edits.ts` describe the file before this split.

**What lands.** A held-order save that swaps a dish's variant, or rewrites an extra, keeps its
discounts (D18); an amount on a swapped dish is asked about. Dormant. Owner lands.

**Today (read).** The swap deletes the old dish and inserts a fresh one
(`working-order-held-write.ts:147-154`; deleted at `working-order-line-edits.ts:1181-1195` (†)); just
before, `endRepricedDishDiscounts` ends the dish's own discount (`:1166-1180` (†);
`dish-discount-ending.ts:88-131`). An extra whose count changes is deleted and re-inserted
(`working-order-line-edits.ts:749-781`). Added units of a discounted line go on a line of their own
(`addedApart`, `:463-464` (†), reading the list-price stamp, `working-order-edit-state.ts:352`).

**The change.** `apps/server/src/bill-discounts-rewrite.ts` (new), called at `:1166` beside the
ending: each swap's percentage or Free moves to the new line; an amount moves only when the request
says keep (deleted when it says remove; refused `adjustment.amount_on_changed_dish` with the
discounts listed when it says neither); a rewritten extra's discount moves to its new row. `adjusted`
also reads "has a pending discount of its own". The held-order save body gains the answer
(`apps/server/src/working-order-held-write.ts` parsing).

**Tests (failing first).** With inserted rows: the burger's 10% follows the half burger (0.80 at the
invoice); 2.00 off refused until answered, kept or removed as answered; a Chips' Free moves to its
re-inserted row; a unit added to a discounted burger lands on its own line, undiscounted.

**Changed test checks.** None.

**Checks to run.** `working-order-held-write.test.ts`, `dish-discount-ending.test.ts`,
`working-order-pricing.test.ts`; `scripts/alert-codes.test.ts`; `scripts/errors-reachable.test.ts`;
golden huella; `inmutabilidad`; `scripts/product-file-size.test.ts`.

**Files.** `bill-discounts-rewrite.ts` (new), `working-order-line-edits.ts`,
`working-order-edit-state.ts`, `working-order-held-write.ts`, `packages/adjustments/src/errors.ts`,
their tests.

**Tasks.** 5.1 swaps and the question; 5.2 extras and `adjusted`.

---

## PR 6a — The till shows the server's totals (`feat/a1621-6a-till-totals`)

**What lands.** The till stops adding an open bill's lines itself and shows the box's figure
(`PartyBill.total`/`outstanding`, the held order's total), so pending discounts will show the
moment they exist. Same figures today. Not an invoice path; full review.

**Today (read).** The table screen sums `unitPriceGross × quantity` (`billGross`,
`apps/till/src/state/adjust-target.ts:58-63` (†); `till-table-order-screen.ts:2481-2488` (†)) into
`TabPayStore`, whose total the embedded tender confirms (`tender-pay.ts:892`, `:928`); "Comp the bill"
takes it as the bill's total (`#compBill`, `till-table-order-screen.ts:2997-3016`); the counter sums
`product.unitPrice × qty` (`state/working-order.ts:499-503`); Pay for items' list uses `payLines`
(`state/bill-payment.ts:393-419`) until the server preview answers.

**The change.** Those totals read the server's figure; Pay for items shows the server preview's
total only. `till-app.ts` has no room: any added line there moves a block out first.

**Tests (failing first).** The table screen's total, the tender's amount and the comp window's bill
total equal a `PartyBill.total` that differs from the lines' sum (the assertion that fails if the
till still sums); the counter's total likewise.

**Changed test checks.** `till-table-order-screen.panel-total.test.ts` and
`state/bill-payment.set-menus.test.ts` where they pin the till's own sum; listed in the pull request.

**Checks to run.** `pnpm --filter @waitron/till exec vitest run` for the touched screens and states,
their `.a11y` tests, `scripts/product-file-size.test.ts`.

**Files.** `till-table-order-screen.ts`, `state/adjust-target.ts`, `state/working-order.ts`,
`state/bill-payment.ts`, `widgets/tender-pay.ts`, `widgets/basket.ts`, their tests.

**Overlap.** Lane I's #4453 (quiet pay: `bill-pay-dialog.ts`, `state/bill-payment.ts`,
`till-app.ts`) and lane N's #4459/#4477 (`till-table-order-screen.ts`, `basket.ts`): 6a rebases
after them.

**Tasks.** 6a.1 the table screen and tender; 6a.2 the counter and Pay for items.

---

## PR 6b — The bill's foot, Remove, and the question before the invoice, on the till (`feat/a1621-6b-till-foot-check`)

**What lands.** A whole-bill discount drawn at the bill's foot ("Discount 10.00  −10.00",
"10%  −4.50") with **Remove**, marked when it no longer applies. On `adjustment.no_longer_applies`
from Pay, Print the bill, Pay for items, the counter, unpaid departure or the deferred close, a
dialog with spec 6.6's sentence for each discount and **Remove it** and **Give a different
discount**: the comp window opens on the bill, or on the dish or set menu the till can still find,
and saving sends one request that writes the new discount and removes the old (D22). Any other
request refused with that code (a cancel, a move, a comp to zero) shows the code's own wording with
the discounts named (fresh read M-4). Until 6c draws them under their dishes, each share a moved
dish brought from another bill's whole-bill discount (D8, origin `bill_share`) is drawn at the foot
too, naming the dish it sits on, with its amount and **Remove** (watcher's change 1). A placed
Counter order waiting for payment (the counter's collect stage) keeps **Remove** on its foot (D23). A
`bill.received_exceeds_total` refusal whose details list discounts (D12's part-paid cancel) names
them in its wording, so the waiter knows which to remove. Nothing shows until 7a. Built to the
frames the owner approves (D21); needs nothing from lanes N or E.

**Today (read).** A comp shows only as a struck-through old price (`widgets/price-was.ts:18-26`;
`#sentPrice`, `till-table-order-screen.ts:3884-3899`; basket `#dishTotal`, `basket.ts:1277-1289`);
nothing reads `discountNotices` (declared at `api/floor-api.ts:137`, `api/orders-api.ts:161`). The
nearest precedent for a question before payment is the dead-ends question asked before the payment
preview (`#askStoredDeadEnds`, `till-app.ts:8141-8170`); Print the bill's refusals go through
`#onMealEndRefused` (`till-app.ts:21052-21089`); the pay window's through `refusalOf`
(`state/bill-payment.ts:265-322`).

**The change.** A row widget (`widgets/bill-discount-row.ts`, new) at the bill's foot on the table
screen and the counter basket; the dialog widget (new); a controller file (new) holding Remove's,
the dialog's and the refusals' handlers; `api/payments-api.ts` gains Remove's call and the apply's
`replacesDiscountId`. The two `till-app.ts` hooks (`#onMealEndRefused`, the pay refusal path) are its
only lines there: `till-app.ts` is at its cap (25,758 of 25,758, ran `wc -l`), so the pull request
moves a block of at least the same size out of it first (fresh read M-3). English and Spanish
wording in `i18n/codes.ts` and `i18n/strings.ts`; guide text in 7a.

**Tests (failing first).** The foot draws a 10% and a 10.00; Remove sends the discount's id and the
bill's revision; a `cut_down` amount draws as taking what it can; each named refusal path opens the
dialog with each discount's sentence; Remove then a retry pays; Give a different discount opens the
comp window on the bill, a set menu or a dish and sends `replacesDiscountId`; a cancel refused with
the code shows its wording, not the dialog; the till previews a hand-keyed card payment that
completes the bill before asking for the outside machine (D6); axe tests in both themes. And:
- a bill whose Burger holds a 1.20 `bill_share` draws a foot row naming the Burger with −1.20 and
  Remove, and the foot's rows with the lines come to the bill's total (the assertion that fails if
  the foot drew only the bill's own discounts); Remove on it sends the share's id;
- the counter's collect stage for a placed order holding 10% draws the foot with Remove, and Remove
  sends the request (the assertion that fails if Remove is hidden once the order is placed);
- a cancel refused `bill.received_exceeds_total` with a 5.00 discount in its details shows wording
  naming that 5.00 discount (the assertion that fails if the till ignores the list); without a list,
  today's wording.

**Changed test checks.** None.

**Checks to run.** The widgets' and screens' tests and their `.a11y` tests,
`till-app-bill-payments.test.ts`, `till-app-pay-for-items.test.ts`, `till-app-meal-end.test.ts`,
`till-app-deferred-close.test.ts`, `apps/till/src/i18n/box-word.test.ts`,
`scripts/no-hardcoded-chrome-views.test.ts`, `scripts/primary-coloured-text.test.ts`,
`scripts/product-file-size.test.ts`.

**Files.** `apps/till/src/widgets/{bill-discount-row,discounts-check-dialog}.ts` (new), a controller
file (new), `till-app.ts` (two hooks, a block moved out), `till-table-order-screen.ts` (the foot;
69 lines of room), `widgets/basket.ts` (the foot; 33 lines of room), `api/payments-api.ts`,
`i18n/{codes,strings}.ts`, tests.

**Overlap.** Lane I's #4453 (quiet pay) and #4483 (`till-app-meal-end.test.ts`): rebase after.

**Tasks.** 6b.1 the foot, moved shares and Remove (the collect stage included); 6b.2 the dialog on
the pay paths; 6b.3 Print, unpaid
departure, deferred close, the other requests' wording, and the hand-keyed card's test.

---

## PR 6c — Discounts under dishes, extras and set menus, on the till (`feat/a1621-6c-till-targets`)

**What lands.** Each pending discount on a dish, an extra or a set menu drawn under it, with its value,
what it takes off now and **Remove**, marked when it no longer applies; "Share of Table 4's 10%" for
a moved share (D8), which moves here from the bill's foot, where 6b drew it. The comp window says what a set menu's new discount replaces (spec 6.7, "the till
says so"), from the preview's `replaces`, which nothing in the till reads today (ran `rg`; fresh read
I-4). On `adjustment.amount_on_changed_dish` from the counter's save, "This dish had 2€ off. It's now
the large burger: keep the 2€ off, or remove it?". Nothing shows until 7b. Built to the frames the
owner approves, on lane N's sent rows and lane E's set-menu summary.

**Today (read).** Giving a set menu a comp already exists: the set-menu summary's Comp
(`widgets/set-menu-summary.ts:250-262`) calls the order screen's `#compMenu`
(`till-table-order-screen.ts:1916-1923`), which targets the set menu's own line; lane E's slice 1
keeps "the existing comp action". The comp window reads only `billTotal`, `reduction` and
`needsApproval` from the preview (`widgets/adjustment-dialog.ts:372-399`).

**The change.** The row widget from 6b used by lane N's sent rows (`widgets/sent-row.ts`, its PR 8a),
lane E's set-menu summary and the counter basket's dish and extra rows; the comp window shows the
`replaces` sentence; the counter's save answers the variant question.

**Tests (failing first).** Each target draws its discount and Remove works from it; a `set_menu_gone`
discount draws as not applying; the comp window on a set menu holding 10% says the new one replaces
it (the assertion that fails if `replaces` is not read); the counter's variant question sends keep or
remove; axe tests in both themes.

**Changed test checks.** `till-table-order-screen.sent-prices.test.ts` where the struck-through price
no longer applies to a pending discount; 6b's moved-share foot test, which now finds the share under
the Burger and not at the foot (as strict: the same amount, Remove and total); listed.

**Checks to run.** As 6b's widget and screen checks.

**Overlap.** Starts after lane N's 8a and lane E's A1515-4 slice 1 land.

**Tasks.** 6c.1 sent rows and the basket; 6c.2 the set-menu summary and `replaces`; 6c.3 the variant
question.

---

## PR 7a — Switch: whole-bill discounts are pending, and Remove (`feat/a1621-7a-bill`)

**What lands.** **Venues reset**: D23's trigger branch rebuilds core's starting migration, and the
pull request's first line says so. The comp window's whole-bill discount writes a pending row; the
Remove route. Everything 1–6b built becomes live for whole-bill discounts. A Counter order placed
before it is paid keeps its discounts removable until the guest pays, and its invoice reopens it
briefly to write them (D23, the owner's answer). A cancel refused because a part-paid bill would come
to less than its money lists the discounts to remove (D12). Owner lands. About five hours, in five
tasks.

**Today (read).** A whole-bill discount spreads over every line now and lowers them
(`planAdjustment`'s bill branch, `adjustments-apply.ts:573-599` (†); `reprice`); a lowered line freezes
its set menu (`frozenLinesOf` and `belowListPrice`, `packages/orders-sales/src/set-menu-grouping-plan.ts:83-108` (†)), so
a bill discounted as a whole stops working out its set menus. The comp window's limits read what is
off the lines (`judgeComp`, `:802-848` (†): `readReasonStanding` and the list price less the price).
The comp routes sit in `adjustments-api.ts` (apply `:201`, preview `:268`), behind
`requireSession(…, { action: "take-orders" })` (†). Only `withSentOrderOpen` sets a placed order
back to open (`sent-order-open.ts:46-61`), called from Pay for items (`pay-for-items.ts:256`) and
the declined card's put-back (`bill-payments.ts:2395`); the trigger allows it only for a placed order
with no party, `ticket_then_pay` and no sale (`packages/db/triggers/core.sql:833-836`); the guard
finds a literal open status written only in `sent-order-open.ts` (`scripts/sent-order-open.test.ts:166-171`).
The overpaid refusal carries the bill and the excess only (`refuseExcess`, `bill-payments.ts:475-477`).

**The change.**
1. `apps/server/src/bill-discounts-give.ts` (new): the comp window's plan and apply for a whole-bill
   discount: the same refusals (reason, note, percentage range, amount at most the bill's shown
   total, `adjustment.exceeds_amount`), limits with standing figures that add pending discounts'
   working-out to today's records, the pending row written, the revision bumped,
   `discount.given` recorded. `planAdjustment`/`applyAdjustment` hand a whole-bill discount to it.
   The apply takes `replacesDiscountId` (D22): the old discount is deleted in the same transaction.
   With `replacesDiscountId` it also accepts a placed bill with no sale (D23, point 2); without it, a
   placed bill is refused `tab.not_open`, as today.
2. The preview's `billTotal` before and after from the working-out (spec 6.5).
3. Remove (D22): `apps/server/src/bill-discounts-api.ts` (new), mounted with the till routes; reads
   the discount, refuses a bill that is neither open nor placed with no sale, or has a payment in
   flight, deletes its `given_together` group through the store, bumps the bill's and party's
   revision, records `discount.removed`. It writes no line, so it needs no reopen (D23, point 2).
   Profile action `take-orders`; inventory row in `till-api.profile-actions.test.ts`.
4. **D23's reopen** (D23, point 3): `withPlacedOrderOpenForDiscounts` in
   `apps/server/src/sent-order-open.ts`; `crystalliseBillDiscounts` (2b) runs its writes inside it,
   after its `asked` check; the trigger's second placed-to-open branch in
   `packages/db/triggers/core.sql`, written beside the first (`:833`), well before the settled
   branch's anchor (`core.sql:908`), whose stretch `orders.transition.test.ts:1020-1024` slices by
   counting `OR (`; `migration-baseline rebuild --set core`. `sent-order-open.ts`'s doc and `packages/db/src/schema/orders.ts:39-44`'s comment
   ("for Pay for items' move") name both reopens.
5. **D12's list**: where the overpaid refusal is raised for a bill holding pending rows
   (`assertBillInvariant`, `assertBillInvariantAt`, `assertLinesKeptExcess`, `bill-payments.ts:466-556`;
   room made in 2b), its details gain `discounts` (each one's id, what it was given on, its action and
   percentage or amount), read through `readBillDiscounts`.
6. **The rule it widens**, in this change (owner's answer, D23):
   - CLAUDE.md §3's line becomes: "**Only `apps/server/src/sent-order-open.ts` sets a placed order
     back to `open`: around Pay for items' move, which the database allows only for a Counter order
     in a pay-after-sending zone with no sale; and to write a placed order's pending discounts at its
     invoice, which it allows for a placed order with no sale holding one** (owner, 2026-11-27:
     "changing a discount changes what is payed, which means we need to open/correct the original and
     issue a new one. so yes, we should be able to reopen it"). Guard: `scripts/sent-order-open.test.ts`,
     weaker than its name: it reads literals and named calls." The link to the topic file stays.
   - `docs/developers/conventions-data.md#only-one-file-sets-a-placed-order-back-to-open`: the heading
     stays (still one file, so the link holds); the body gains the second reopen, its trigger branch,
     who calls it, the owner's words, and what the database cannot tell (D23, point 3); the guard's
     limits paragraph gains what the caller lists miss (a call through another name).
   - `scripts/sent-order-open.test.ts`: see "Changed test checks".
7. Guide: the comps section says a whole-bill discount can be removed until the bill is paid or
   printed, a percentage covers later dishes, and an amount stays whole when a dish is cancelled
   (English and Spanish).

**Tests (failing first).** End to end through the comp window: 10% on a 50.00 bill shows 45.00,
a dish added later is covered, Remove brings 50.00 back, the invoice files 10% of the final bill;
lane B's 25 November bill stays 17.00 after the Soup is cancelled (anti-goal 1); 10.00 off a bill
cut to 8.00 by cancels is asked about before Pay; the owner's two items paid alone; set menus keep
regrouping under a whole-bill discount; Give a different discount replaces 10% with 15% in one
request, and a refused replacement leaves the 10% standing. Remove: deletes the row and its group,
raises the shown total, records the activity entry, is refused without `adjustment.apply` and while
a card payment is pending, and is not refused for taking the bill over the simplified limit. A
discount given after a part payment that would take the bill below its money is refused as today
(D12). And:
- **the part-paid cancel** (D12, watcher's change 2): a 12.00 Burger and an 8.00 dish, 5.00 off the
  bill, 5.00 paid in cash, then the Burger cancelled: refused `bill.received_exceeds_total`, its
  details listing the 5.00 discount's id, "the bill", `discount_amount` and 5.00 (the assertion that
  fails if the list is deleted), and the bill's lines and payments unchanged after (read once the
  request has ended); Remove the 5.00, the same cancel then passes and the bill comes to 8.00 with
  5.00 paid; a refusal on a bill holding no pending row carries no list (today's details exactly);
- **the Counter case** (D23): a Counter order in a pay-after-sending zone with 10%, placed, then paid
  in cash: the invoice files 10% of its lines, no pending row is left and the order ends settled (the
  assertion that fails if crystallising cannot write a placed order's lines); the same order with the
  10% removed after Place files the full price (the assertion that fails if Remove refuses a placed
  bill); a replacement of 10% by 15% after Place files 15%; a new discount after Place is refused
  `tab.not_open` (unchanged);
- **outside a pay-after-sending zone** (D23): a prepay-zone Counter order placed unpaid through the
  server (the fixture `counter-handover.test.ts:112-127` uses) and a placed Counter order moved to a
  table (`placedCounterBillMovedTo`), each holding 10%: paid, or invoiced by unpaid departure and by
  the close of day, each files 10% and ends with no pending row (the assertion that fails without the
  trigger's new branch, which today refuses both, as the D23 runs show);
- **the reopen stays shut where it should**: a refused `asked` check on a placed order leaves it
  placed (read after the request ends); after any payment that crystallises, the order is not open.
- **the trigger** (`scripts/behavioural-triggers.test.ts`, a new describe beside
  `:1388`): a placed order with no sale holding a pending row goes back to open by a status-only
  update whatever its party and mode (party set; `prepay`, `table_tab`, null); refused once a sale
  names it; refused with each pinned column changed (the same `FROZEN_REOPEN_COLUMNS` cases); refused
  for a placed order with a party or another mode and no pending row (as the existing cases, which
  stay unchanged).
- **bound portions with a measured extra** (found in PR 1's review, 27 November): two 1.00 dishes
  bound as one cohort, each with 0.125 of a sauce at 10.08 a unit, 0.05 off the bill: the shown
  total and the invoice both come to 4.47, and a further 4.48 off is cut down to the 4.47 left,
  never refused. Today's
  comp window shows 4.48 here while the invoice files 4.47, and refuses a further 4.48 with
  `adjustment.exceeds_amount`; PR 1's calculator gives 4.47 (`bill-discounts-filing.test.ts`). The same file's bill where
  splitting a bound pair would refile its extras higher ("keeps a bound pair at one price…") runs
  through the comp window too, and the invoice falls by what the bill shows.

**Changed test checks** (about 30; each listed in the pull request): the whole-bill groups of
`adjustments-apply.test.ts` (`:813` "a bill discount with a weighed line", `:875`, `:928`, and the
whole-bill cases of `:1904` "cumulative limits" and `:2515` "the bill's comp limit") move their price
checks into the crystallising tests where those already check the same thing (fresh read M-10), and
otherwise behind a call to crystallise; `set-menu-adjustments.test.ts:144` and `:269`;
`set-menu-dish-adjustments.test.ts:668`; `set-menu-discount-moves.test.ts:416` (a whole-bill
discount no longer freezes, "until 3c"); `set-menu-discount-apply.test.ts:303`. And
`scripts/sent-order-open.test.ts`, a guard under `scripts/`, which the global constraints say is never
weakened: it is edited here only because the owner's answer to D23 deliberately widens the rule it
pins, and it stays at least as strict. Its header names both reopens; its existing cases, including
"only sent-order-open.ts writes a literal open status to an order" (`:166-171`), stay unchanged; it
gains two cases: the opening writes in `sent-order-open.ts` sit inside exactly `withSentOrderOpen`
and `withPlacedOrderOpenForDiscounts` (fails if a third function there writes the open status), and
the product files calling each are exactly a fixed list, `withSentOrderOpen` from `pay-for-items.ts`
and `bill-payments.ts`, `withPlacedOrderOpenForDiscounts` from `bill-discounts-crystallise.ts` (fails
if any other file calls either). Each new case is proved by deletion (a third writer, and a call
from another file, each turn it red) with the legitimate callers still served. Weaker than its name,
as now: it reads literals and named calls, not a call through another name.

**Checks to run.** The touched suites; `receipt-adjustments.test.ts`, `free-items.test.ts`,
`packages/adjustments/src/reports.test.ts`, `till-api.profile-actions.test.ts`; `pay-for-items.sent.test.ts`,
`counter-handover.test.ts`, `unpaid-departure.test.ts`, `close-of-day.test.ts`,
`bill-payments.card.test.ts` (the put-back's reopen unchanged); `scripts/sent-order-open.test.ts`;
the schema guard list (`scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts`,
`scripts/migration-upgrade.test.ts`, `packages/db/src/schema/orders.transition.test.ts`);
`scripts/claude-md-pointers.test.ts`; golden huella; `inmutabilidad`; the guide guards.

**Files.** `bill-discounts-give.ts`, `bill-discounts-api.ts` (new), `adjustments-apply.ts` (the
hand-off; room made in PR 1), `adjustments-api.ts`, `adjustment-bill-total.ts`, `till-api.ts`
(mount), `sent-order-open.ts`, `bill-discounts-crystallise.ts`, `bill-payments.ts` (the refusal's
list), `packages/db/triggers/core.sql`, `packages/db/drizzle/**` (generated),
`packages/db/src/schema/orders.ts` (comment), `scripts/sent-order-open.test.ts`,
`scripts/behavioural-triggers.test.ts`, `CLAUDE.md`, `docs/developers/conventions-data.md`, the guide
in both languages, tests.

**Tasks.** 7a.1 plan and apply, with the replacement; 7a.2 preview and limits; 7a.3 Remove and the
part-paid cancel's list; 7a.4 D23's reopen (trigger, rebuild, `sent-order-open.ts`, the guard, the
rule line and topic file) and the Counter cases; 7a.5 the changed checks and the guide.

---

## PR 7b — Switch: set-menu discounts are pending (`feat/a1621-7b-set-menus`)

**What lands.** A comp or discount on a set menu is pending; a second replaces the first (the till
says so, from the preview's `replaces`, which 6c draws); a set menu holding one is worked out like any
other; one whose row goes is asked about before the invoice. Waits for 6c. Owner lands.

**Today (read).** A set menu's comp or discount is written onto its row and charged dishes
(`setMenuDishes`, `set-menu-adjustment.ts:20-23`), freezing it; a second ends the first
(`endReplacedOnSetMenu`, `:99-108` (†)); a cancel that breaks it ends it
(`endDiscountsCancelledBy`, `set-menu-discount-ending.ts:200`); a move of some of its dishes ends it
(`working-order-transfer.ts:155-163`).

**The change.** `bill-discounts-give.ts` takes set-menu targets: the replacement deletes the earlier
pending row of origin `given`; the grouping no longer treats a pending set-menu discount as freezing;
the ending calls above act only on written records (reopened bills until PR 8). Guide's set-menu
paragraph (`table-service.md:591-593`) in both languages.

**Tests (failing first).** 50% off a Daily, then its Hake cancelled so the Daily breaks up: the bill
shows the discount as not applying and Pay is asked (spec 6.6's sentence); a second discount
replaces the first and the preview's `replaces` names the first; the Daily moved whole keeps it; the
tie-break and its control (D16).

**Changed test checks** (about 40): `set-menu-discount-apply.test.ts`, `set-menu-discount-cancel.test.ts`
(endings become a kept discount asked about), `set-menu-discount-moves.test.ts` (`:140`, `:162`,
`:347`, `:385`: a dish moving alone no longer takes the discount off at the move),
`set-menu-discount-supplement-only.test.ts`, `set-menu-adjustments.test.ts:103-123`, the set-menu
cases of `discount-notices.test.ts`.

**Checks to run.** Those suites, `set-menu-regroup*.test.ts`, receipts, golden huella,
`inmutabilidad`, guide guards.

**Tasks.** 7b.1 give and replace; 7b.2 the grouping and the endings' reach; 7b.3 changed checks and
guide.

---

## PR 7c — Switch: a dish's own discount is pending (`feat/a1621-7c-dishes`)

**What lands.** A percentage or amount on a dish is pending: a percentage covers its extras, added
later included; an amount stays; the dish still leaves its set menu when it has a discount of its
own (spec 6.7, A1515-3's 3a); a till row of several portions gets one per portion, removed together; part of a
non-portion line is split off when given. A variant change asks about an amount (PR 5 live). Owner
lands.

**Today (read).** `planAdjustment`'s line branch (`adjustments-apply.ts:600-742` (†)): the release
from the set menu at its à la carte price (`atReleasedPrices`, `set-menu-dish-release.ts:19-54` (†)),
the carve (`reprice`'s split, `:1045-1056`), the row of portions (`standInRow`,
`adjustment-rows.ts:208`), the per-dish floor (`dishPrices`, `:857-920`); the grouping keeps a
reduced dish out (`frozenLineIdSources`, `set-menu-freeze.ts:18-45` (†)).

**The change.** `bill-discounts-give.ts` takes dish targets: release and carve as today at the
moment of giving, then pending rows (one per portion of a row, one `given_together` id); the
grouping's `reduced` set reads pending dish discounts of origin `given` (not extras, D34; not
shares, D8) beside written records; Remove now works the bill's set menus out again, so a dish whose
own discount goes rejoins the grouping (fresh read M-6: before 7c no pending discount excludes a
dish, so a test of this could not fail earlier). That regroup writes lines, so on a placed order
with no sale it runs inside `withPlacedOrderOpenForDiscounts` (D23, point 2), and the pull request
adds Remove's file to that function's caller list in `scripts/sent-order-open.test.ts` (the owner's
answer to D23 covers it; the list stays exact). Guide: the dish paragraph and the old "comes off that dish"
sentence (`table-service.md:18-19`).

**Tests (failing first).** The burger examples of spec 7.3 end to end; a discounted Hake stays out of
the Daily and rejoins it when the discount is removed; two Hakes in a row, 10% on the row, then one
moved: each keeps 10%; the per-dish floor still asks for a PIN at the same limits; on a Counter
order placed unpaid, removing the Hake's discount puts it back in the Daily (the assertion that fails
if Remove's regroup is refused on a placed order). The bill in `bill-discounts-filing.test.ts` where a bound dish's own discount would refile its extras higher ("leaves a bound dish as it is…") runs through the comp window too, and the invoice falls by what the bill shows.

**Changed test checks** (about 60, the largest set): `adjustments-apply.test.ts`'s line groups
(`:316` "a comp" for its discount cases, `:667`, `:791`, `:1291`, `:1350`, `:2007`, `:2412`,
`:3203`, `:3505`, `:3590`, `:3926`) move their price checks into the crystallising tests where those
already check the same thing (fresh read M-10), otherwise behind a call to crystallise;
`set-menu-dish-adjustments.test.ts`; `order-portions.adjustments.test.ts`; `dish-discount-ending.test.ts`
(the dish cases now PR 5's); `bill-editing.adjustments.test.ts`; `free-items.test.ts` (open-bill
discounts no longer counted before the invoice).

**Checks to run.** Those suites; `receipt-adjustments.test.ts`, `invoice-document*.test.ts`,
`order-portions.filing.test.ts`; golden huella; `inmutabilidad`; guide guards.

**Tasks.** 7c.1 give, release and carve; 7c.2 portions and the grouping; 7c.3 and 7c.4 the changed
checks (split by file); 7c.5 guide.

---

## PR 7d — Switch: Free on a dish, and every extra's comp or discount (`feat/a1621-7d-free-and-extras`)

**What lands.** Free on a dish covers its extras added later and can be removed; Free or a discount
on an extra goes when the extra goes and leaves its dish in its set menu (D34). Every comp and
discount is now pending. Owner lands.

**Today (read).** A comp prices rows at exactly zero (`zeroedRows`, now in PR 1's module); an extra is
covered only whole (`coveredQuantity`, `adjustments-apply.ts:261-272` (†)).

**The change.** `bill-discounts-give.ts` takes Free on dishes and every extra target; the comp route's
`closeZero` stays (D14). Guide: the Free sentences.

**Tests (failing first).** Free on the burger covers Chips added later; Free on the Chips goes with
them; a comp that brings the bill to zero issues at once, crystallised.

**Changed test checks** (about 35): `adjustments-apply.test.ts` `:316` (comp), `:464`, `:2940`;
`adjustments-extra-cancel.test.ts`; `free-item-*.test.ts`; `full-comp.fiscal-identity.test.ts` where
it pins a price before the invoice.

**Checks to run.** Those suites; golden huella; `inmutabilidad`; guide guards.

**Tasks.** 7d.1 Free on dishes; 7d.2 extras; 7d.3 changed checks and guide.

---

## PR 8 — Reopen to split gives discounts again (`feat/a1621-8-reopen`)

**What lands.** D17. Owner lands.

**Today (read).** `copyBillDishes` (`split-after-print.ts:366-415`) copies each line whole, its
lowered price and stamp included, and its reductions (`carryLineReductions`,
`order-portions.ts:144-174`); stopping an unserved copy ends its set menu's discount
(`split-after-print.ts:288-296`). Pay for items on a printed bill reuses it (`pay-for-items.ts:395-434`).

**The change.** Copies at list prices; each of the printed bill's comp and discount records given
again as a pending row on the mapped target; `recordAdjustment` writes `reapplies_adjustment_id` when
it crystallises; `packages/adjustments/src/reports.ts` and `free-items.ts` count only the last of a
chain.

**Tests (failing first).** A printed bill with 10% off reopened: the new bill holds 10% (a
percentage), covers a dish added there, and its invoice's record names the first; the report counts
one discount; a Daily's 20% reopened is on the copy's Daily.

**Changed test checks.** `split-after-print*.test.ts` (copies now at list prices),
`set-menu-discount-apply.test.ts:354`, `:395`, `set-menu-dish-adjustments.test.ts:955`.

**Checks to run.** Those suites, `reports.test.ts`, `free-items.test.ts`, `invoice-corrections` suites
touching reopened bills; golden huella; `inmutabilidad`.

**Tasks.** 8.1 copying and giving again; 8.2 counting once.

---

## PR 9 — The old repair code goes (`feat/a1621-9-cleanup`)

**What lands.** Spec section 11's "Removed" rows. **Venues reset** (two tables dropped). Owner lands
(it edits the receipt's and the report's reads).

**The change.** Delete `packages/adjustments/src/endings.ts`, `apps/server/src/{dish-discount-ending,
discount-notices}.ts`, the ending parts of `set-menu-discount-ending.ts` and `set-menu-adjustment.ts`,
every `ending?: Ending` parameter, `reducedLineIds` and the discount part of `frozenLineIdSources`,
`belowListPrice`'s freeze, `refuseMovingFrozenDishes`' discount refusal (`set_menu.move_adjusted`,
retired), `carryLineReductions` on open-bill copies, `discountNotices` on the wire and in
`DISCOUNT_NOTICE_WHYS`, `reapplies` on the comp request, the report's "came off" rule (D55,
`reports.ts:297-336`) and its help text (`packages/adjustments/src/dashboard/strings.ts:106`), the
`adjustment_endings` and `adjustment_ending_lines` tables (schema, classification, manifest,
backup verification, `ADJUSTMENTS_TABLES`), and the till's dead types. The entries naming what it
retires come out of the guards and fixtures that list them (ran `rg`; fresh read M-2):
`scripts/schema-constraints.test.ts:52-55`, `:331`; `scripts/append-only-triggers.test.ts:35-36`;
`scripts/personal-log-params.test.ts:139` (`set_menu.move_adjusted.dishNames`);
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:465-466`. Removing an entry for a table or
code that no longer exists weakens nothing. A pointer line in the spec of
24 November §6 (`docs/superpowers/specs/2026-11-24-set-menus-automatic-grouping-design.md:220`),
dated, to this design (spec 11's last row). Backlog: A1515's 26 November note and this item close.

**Tests.** Deleted with their code: `endings.test.ts`, `dish-discount-ending.test.ts`,
`discount-notices.test.ts`, `set-menu-discount-ending.test.ts`, `adjustment-ending-weighed.test.ts`,
`packages/adjustments/src/schema/adjustment-endings.test.ts`. A test that a lowered line no longer
freezes nothing is not needed (no open bill holds one after 8); the grouping's own tests keep the
kept-charge cancel's freeze.

**Changed test checks.** Whole-shape checks losing `discountNotices`; `reports.test.ts`'s came-off
cases deleted with the rule.

**Checks to run.** The schema guard list (as 2a), `scripts/alert-codes.test.ts`,
`scripts/errors-reachable.test.ts`, golden huella, `inmutabilidad`, every touched package's
`test:coverage`.

**Tasks.** 9.1 server code and codes; 9.2 tables; 9.3 till types, help text, spec pointer, backlog.

---

## Overlap with other work (ran `gh pr list --state open`, read the overlapping files)

- **Lane E, A1515-4** (`feat/e-a1515-4-till-set-menus`, local only, one commit: its plan). Its plan
  gives "discounts and the warning before a dish discount to A1621". What each slice waits for
  (fresh read M-9): **slice 1** (set-menu summary) waits for nothing here, and 6c waits for it.
  **Slice 2** (the unsent preview as a server quote) passes "frozen adjustments" to the grouping; if
  it calls the grouping's own frozen-source function (`planGrouping`, `set-menu-regroup.ts:132-145`)
  it waits for nothing and 7a–7c's changes reach it without a second edit; if it copies the freeze,
  it waits for 7c. Its quote should also subtract pending discounts once 2b exists (call
  `readBillDiscounts`); before 7a no bill holds one. **Slice 3** (Items price) shows the server
  preview's total; it waits for nothing, and after 4b that total includes the discounts.
- **Lane N, till order redesign** (#4459 PR 6, #4477 PR 7a, #4484 PR 8-0, plan for 8a–8c): owns
  `till-table-order-screen.ts`, `basket.ts`, the new `sent-row.ts`. 6a and 6b rebase after
  #4459/#4477; 6c draws under 8a's sent rows.
- **Lane I, #4453 quiet pay** (`bill-pay-dialog.ts`, `state/bill-payment.ts`, `till-app.ts`): 6a and
  6b rebase after it.
- **#4457 bill picker polish**, **#4450**, **#4492**, **#4491**: guide `table-service.md` text only,
  or no shared file; a rebase conflict at most.
- **#4483 CORRECT-FULL-INVOICE 2b** (corrections, give-back, `till-app-meal-end.test.ts`, the guide):
  no shared product file; 6b's test file rebases after it.
- **#4485 recovery pack** edits `docs/developers/conventions-data.md` near line 3919; 7a edits its
  section at line 7530, so a rebase conflict at most. No open pull request touches
  `sent-order-open.ts`, `triggers/core.sql`, `scripts/behavioural-triggers.test.ts`,
  `packages/db/src/schema/orders.ts` or `CLAUDE.md` (ran `gh pr list --state open --json files`,
  27 November, after D23's answer).
- **Lane L, OVERPAID-BILLS** (not yet a pull request): D12. A1621 depends on it for spec 6.5's
  overpaid sentence and does not wait for it.
- No open pull request touches `adjustments-*`, `bill-payments.ts`, `set-menu-*`,
  `working-order-*`, `pay-for-items.ts` or `split-after-print.ts` (ran: grep of every open pull
  request's file list).
