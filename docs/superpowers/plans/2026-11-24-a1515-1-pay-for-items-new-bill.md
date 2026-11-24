# Paying for items moves them to a new bill (A1515 rework, piece 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every bill, Pay > Items > choose > Cash or card makes a new bill holding the chosen
items, takes the payment there and closes it with its own invoice and receipt, in one go. A
declined or cancelled card puts the items back. A printed bill can be split this way too, and a
bill left with more money than it owes offers to give the difference back or keep it as a tip.
The "items" kind of payment goes.

**Architecture:** The move uses today's Move dishes (`moveDishes`, `apps/server/src/bill-actions.ts:292`),
which already makes a new bill of the party with the source's service context; part of a line is
first split within its own bill (`splitLinesWithinOrder`, `apps/server/src/working-order.ts:5299`)
and the new row moved whole. The payment is today's whole-bill payment (`kind: "share"`,
`shareOf: 1`, as the till asks it, `apps/till/src/state/bill-payment.ts:101-106`) on the new bill,
so the invoice is issued by today's `issueWhenFullyPaid` (`apps/server/src/bill-payments.ts:1067-1293`).
Nothing in the fiscal core changes: the new bill files an ordinary simplified ticket through
`recordSale`.

**Tech Stack:** Hono routes in `apps/server`, Drizzle on SQLite (`node:sqlite`), Lit till in
`apps/till`.

**Spec:** `docs/superpowers/specs/2026-11-24-set-menus-automatic-grouping-design.md`, section 7
("Moving dishes and paying for some items") and "The pieces, for planning", piece 1. Approval: the
owner, 24 November 2026 ("y"; commit 8dc86752ba). Owner decisions this plan keeps: no approver PIN
for Pay for items or Reopen to split ("1 A"); a part-paid printed bill can be split, its money stays
with the table's bill, and an overpaid bill offers change, a refund or a tip ("2 B").

## The split: four pull requests

Each leaves `main` working on its own. PR 1, 2 and 4 change which invoices are issued: full review
wave with two Codex angles, and the OWNER lands them. PR 3 removes code only and takes the same wave.

| PR | What a person can do when it lands | Depends on |
| --- | --- | --- |
| 1. Server | The till API can pay for items by moving them to a new bill (cash, hand-keyed and reader card), put them back on a failed card, and settle a bill left overpaid by giving back or keeping a tip. The till still uses the old items payment. | — |
| 2. Till | Pay > Items uses PR 1: the dialog shows the new bill's price, a declined card leaves the table's bill as it was, and an overpaid bill shows **Give back** and **Keep as tip**. Guides updated. | 1 |
| 3. Removal | Nothing new to see: the "items" kind, `bill_payment_lines`, `bill.line_paid` and its guards, `paidLines` and the till's paid marks are gone. | 2 |
| 4. Printed bills | Reopen to split needs no PIN and works on a part-paid printed bill, its money counting towards the table's bill; Pay for items on a printed bill runs it first. | 3 |

PR 1 is written out task by task below. PR 2–4 are given as scope, decisions and files; each gets
its task steps on this page, against `main` as PR 1 left it, before its build starts, because each
changes code PR 1 writes. The watcher clears each addition.

## Global Constraints

- Every commit `git commit -s`; feature work in a `worktree.py new --headless` worktree.
- Money columns hold whole cents (`decimalToCents`/`centsToDecimal`); quantities whole thousandths.
- Multi-table writes share ONE transaction (`withTransaction`/`withIssuanceTransaction`); write-path
  functions take `tx: Transaction`; queries on one transaction are awaited in turn.
- Error codes name the domain (`bill.*`), live in `apps/server/src/errors.ts`, map to an HTTP status
  in `apps/server/src/till-api.ts`, and get English and Spanish till text in `apps/till/src/i18n/codes.ts`.
- A schema change edits the TypeScript schema (and `packages/db/triggers/core.sql`) and runs
  `migration-baseline rebuild --set core`; never a new migration. Classify new tables in
  `packages/db/src/classification.ts`; append-only tables use `appendOnly()` and go in
  `packages/migrations/migrations.manifest.json`; a table whose writes are confined goes in
  `scripts/write-path-tables.json`.
- The golden huella test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and
  `inmutabilidad` pass UNEDITED.
- No PIN on any path this plan adds (owner "1 A").

## Review Focus

1. **The same request sent twice** (the till retries after a dropped connection, same
   `submissionId`): one new bill, one payment, one invoice; the second answer replays the first.
   Test in Task 3.
2. **A card declined after the items moved**: the items are back on the table's bill with the same
   total, the new bill is abandoned, and no invoice exists for it. Test in Task 5.
3. **The table's bill printed or paid while the card is in the terminal**: the items cannot go back
   to a bill that is not open, so they stay on their own open bill to be paid there. Test in Task 5.
4. **A part-paid table's bill left owing less than it was paid**: it issues no invoice while
   overpaid; keeping the difference as a tip, or giving it back (cash, or card completed later),
   issues it. Test in Task 6.
5. **A table's bill holding an advance** (a part payment with its own receipt, already filed as its
   own ticket): paying for items may never take the bill below what its advances already count.
   Test in Task 2.

---

## PR 1 — Server

Branch `feat/a1515-1-pay-items-server`.

**What stays as it is in PR 1:** the old items payment route keeps working (the till still calls
it); its removal is PR 3. Pay for items on a printed bill is refused as Move dishes refuses it
today (`bill.presented`, `refuseClosedBill`, `bill-actions.ts:65`); PR 4 lifts it.

**Decisions:**

- **D1. Where the source is remembered.** A new nullable column `working_orders.items_paid_from`
  (foreign key to `working_orders.id`, `restrict`, with an index: the box gathers no planner
  statistics) on the new bill names the bill its items came from. Every path that fails a pending
  payment needs it to put the items back, including the recovery loop that settles a stuck card
  later (`bill-payments-loop.ts:70`), so it cannot live in the request.
- **D2. Putting back.** `failBillPayment` (`bill-payments.ts:2366`) is the one function that fails
  a pending payment; its callers are `bill-payments.ts:2504`, `:2530`, `:2576`,
  `bill-payments-loop.ts:70` and `payments-api.ts:1814` (and any other `failBillPayment(` the
  implementer's grep finds). It gains a `cfg: TradingContext` parameter, which every caller has,
  because moving lines needs one (`moveOrderLines`, `working-order.ts:4301-4308`). When the failed
  payment's bill has `items_paid_from`, holds no other payment and its source is still `open`,
  every line of the new bill moves back to the source and the new bill becomes `abandoned`; both
  bills' and the party's revisions move on. _2026-11-24, as built: the put-back acts only when the
  failed payment is the new bill's earliest and no other payment on it is pending or received._
  The put-back runs in a savepoint (`tx.transaction(…)`,
  as `apps/server/src/optional-document.ts:39` does; the file is added to
  `scripts/no-bare-transaction.test.ts`'s list with reason `savepoint`) and an `AppError` from it is
  caught: the payment's failure always stands, and a put-back that is refused leaves the items on
  their own open bill, to be paid there. A source no longer open is the same case. A split-off
  part goes back as its own row (same dish, price and total), not joined to the row it came from
  (my call: joining needs a new writer for a case the guest never sees on paper).
- **D3. Overpaid.** Only Pay for items may leave the source holding more than it owes.
  `BillBalance.overpaid` is the excess as `assertBillInvariant` measures it (received plus reserved,
  less the total; `0.00` when none). A bill with `overpaid > 0` issues nothing
  (`issueOrSettleWhenFullyPaid` already waits for received to equal what is due). On an overpaid
  bill, `applyLineEdits` (`working-order.ts:7208`) accepts an edit that does not make the excess
  bigger (adding a coffee uses up the money), and calls `issueIfFullyPaid` after it; every other
  line writer keeps refusing `bill.received_exceeds_total`. It is settled by one of:
  - **Give back:** today's refund of a bill payment (`refundBillPayment`, `bill-refunds.ts:157`,
    cash or card, partial for a share or contribution payment). Every place a bill refund becomes
    completed calls `issueIfFullyPaid` for its bill: `completeRefundReservation`
    (`bill-refunds.ts`), and for a connected card `resolveClaimedRefund` and
    `resumeBillCardRefund` (`tender-refund-sends.ts:588`, `:632`) and the refund recovery loop.
  - **Keep as tip:** new route. The `bill_payments_guard_update` trigger (`core.sql:45-82`) gains
    one more allowed change: a `received` payment with no tender, on a bill that is `open` or
    `placed`, may move money from `applied` to `tip` with `applied + tip` unchanged. The route moves
    the excess newest received payment first, records an `activity_log` entry naming the person
    and amounts (kind declared in `packages/db/src/activity-kinds.ts`), then calls
    `issueIfFullyPaid`. No new table: every reader of `applied` and `tip` stays right as it is.
    Refused `bill.tip_not_allowed` when tips are off (`packages/payments/src/settings.ts:9`).
- **D4. Advances.** A bill's advances are already filed as their own tickets, and its invoice owes
  its total less their credits (`readBillFigures`, `bill-payments.ts:862-865`). Pay for items is
  refused when it would take the table's bill below its advances' credits, with a new code
  `bill.below_advances` (409, `{ advances }`): "Part of this bill was paid with its own receipt
  ({advances}), so it cannot come to less than that. Choose fewer items, or pay by amount." PR 4
  keeps the same rule for printed bills.
- **D5. The new bill's invoice** is a simplified ticket. A guest who wants a full invoice with tax
  details uses Move dishes and pays that bill, as today.
- **D6. Same submission twice.** The new route looks up the `submissionId` among the payments of
  bills whose `items_paid_from` is the source, before moving anything, and replays that answer.
- **D7. Every dish chosen.** Picks that take every dish of the bill are refused
  `bill.all_items_chosen` (409): "These are all the items on this bill. Pay the whole bill
  instead." (PR 2's till switches to a whole-bill payment itself, so staff never see it.) Moving
  everything would empty the table's bill, and a part-paid empty bill never issues.
- **D8. The kitchen is not told.** The items stay at the same table, so Pay for items and its
  put-back pass `moveDishes` an option that skips `enqueueMovedSlips` (`bill-actions.ts:369`): no
  MOVED slip, no station notice.
- **D9. Checks a payment needs.** The request carries the `applied` and `tip` the preview showed;
  the server refuses `bill.allocation_changed` when they no longer match (`confirmAllocation`,
  `bill-payments.ts:1946-1953`), and builds the new bill's `expectedEdit` itself after making it
  (`requireBillEditor` needs that bill's id, `bill-editing.ts:230`). The routes need `payment.take`
  as `POST /api/working-orders/:id/payments` does (`bill-payments-api.ts:257`), and its profile
  checks; they get rows in `till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`,
  and entries in `till-api.session-person.test.ts`'s walk (`BODIES`).
- **D10. Counter orders.** On a bill with no party, `moveDishes` makes a new counter order
  (`bill-actions.ts:324-345`), so Pay for items works there the same way.

### Task 1: Storage for the source; the kept-tip change on a payment

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (column `itemsPaidFrom` on `workingOrders`, its index)
- Modify: `packages/db/triggers/core.sql` (`bill_payments_guard_update`, D3)
- Regenerated: `packages/db/drizzle/0000_baseline.sql` and its snapshot (`migration-baseline rebuild --set core`)
- Modify: `scripts/schema-constraints.test.ts` (the new foreign key)
- Test: `packages/db/src/schema/bill-payments.test.ts`, `packages/db/src/schema/orders.test.ts`
  (or the file that tests `working_orders` constraints today)

**Interfaces:**
- Produces: `workingOrders.itemsPaidFrom: string | null`.

- [ ] **Step 1: Write the failing tests** in `bill-payments.test.ts`:
  - `"a received payment on an open bill may move money from applied to tip"`: applied 15.00, tip
    0.00 → applied 10.00, tip 5.00 is accepted.
  - `"the move keeps the payment's total"`: applied 15.00 → applied 10.00, tip 4.00 is refused
    (`bill payment cannot make that change`).
  - `"a payment that is a tender may not move it"`: the same change on a payment named by a
    `tenders` row is refused.
  - `"a pending payment may not move it"`.
  And `"items_paid_from names a bill"`: an unknown id is refused by the foreign key.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/bill-payments.test.ts`.
  Expected: FAIL on the first case (the trigger refuses it today).
- [ ] **Step 3: Add the column and index, change the trigger**, rebuild the core baseline.
- [ ] **Step 4: Run** the db tests, then from the root `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts
  scripts/append-only-migration-sets.test.ts` and `pnpm --filter @waitron/composition exec vitest
  run src/composition.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  inmutabilidad`. Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Store which bill paid-for items came from, and let an overpaid payment become a tip"`.

### Task 2: Moving chosen items, part of a line included, to a new bill

**Files:**
- Modify: `apps/server/src/bill-actions.ts` (`moveDishes` options)
- Create: `apps/server/src/pay-for-items.ts`
- Modify: `apps/server/src/errors.ts`, `apps/server/src/till-api.ts`, `apps/till/src/i18n/codes.ts`
- Test: `apps/server/src/pay-for-items.move.test.ts`

**Interfaces:**
- Consumes: `moveDishes` (`bill-actions.ts:292`), `splitLinesWithinOrder` (`working-order.ts:5299`,
  which takes `lineNo`; pass `{ splitExtras: true }`), `workingOrders.itemsPaidFrom` (Task 1).
- `moveDishes` gains a last parameter `options: { sourceMayBeOverpaid?: boolean; tellKitchen?: boolean }`
  (defaults `false` and `true`): the first relaxes its own `assertBillInvariant` call for the
  source (`bill-actions.ts:368`), the second skips `enqueueMovedSlips` (`:369`). Every existing
  caller passes nothing.
- Produces:
  ```ts
  export interface ItemPick { lineId: string; quantity?: string } // absent: the whole line
  export async function moveItemsToNewBill(
    tx: Transaction, cfg: OriginConfig, fromBillId: string, picks: readonly ItemPick[],
    command: BillCommand & { expectedEdits: BillEditExpected[]; admission: TradingAdmission },
  ): Promise<{ billId: string }>
  export async function priceItemPicks(tx: Transaction, fromBillId: string,
    picks: readonly ItemPick[]): Promise<Decimal>
  ```
  `moveItemsToNewBill` refuses D7 and D4 first, splits each pick with a `quantity` below its line's
  within the source, calls `moveDishes(…, null, ids, command, { sourceMayBeOverpaid: true,
  tellKitchen: false })`, sets `itemsPaidFrom` on the new bill, and calls `issueIfFullyPaid` for the
  source (as the Move dishes route does, `till-api.ts:4362`). `priceItemPicks` reads only: each
  picked line's `line_total` (pro rata to the quantity for a part) plus its extras' share.

- [ ] **Step 1: Write the failing tests:**
  - `"moves whole lines to a new bill of the party that names its source"`: a seated bill with soup
    6.00 and hake 15.00; pick the hake; the new bill holds the hake, `itemsPaidFrom` is the source,
    the source holds the soup at 6.00.
  - `"moves one of three units of a line"`: one row of 3 beers at 2.50; pick `quantity: "1"`; the new
    bill has one row of 1 beer, 2.50; the source keeps 2, 5.00; `priceItemPicks` said 2.50.
  - `"carries a dish's own comp with it"`: a hake comped 100%; the new bill's hake keeps its
    `adjustment_lines` row and `line_total` 0.00.
  - `"refuses part of a line whose extras do not split evenly, moving nothing"`:
    3 burgers with 2 extra cheeses on the line; pick 1; refused
    `tab.transfer_modifier_line`; no new bill exists.
  - `"refuses taking the bill below its advances"` (Review Focus 5): a 20.00 bill with a 15.00
    advance; picking 10.00 of items refuses `bill.below_advances` with `advances: "15.00"`.
  - `"refuses every dish"`: picking all lines refuses `bill.all_items_chosen`.
  - `"tells the kitchen nothing"`: no MOVED slip job and no station notice after the move.
  - `"a source left exactly paid issues its invoice"`: 20.00 bill, 10.00 received; picking 10.00 of
    items leaves the source `settled` with an invoice of 10.00.
  - `"a counter order's items go to a new counter order"`.
  - `"Move dishes still refuses an overpaid source"`: the existing route moving 10.00 off a 20.00
    bill with 15.00 received refuses `bill.received_exceeds_total`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.move.test.ts`.
  Expected: FAIL, module not found.
- [ ] **Step 3: Implement** as the Interfaces block says; register `bill.below_advances` and
  `bill.all_items_chosen` with English and Spanish text (D4, D7).
- [ ] **Step 4: Run** the test file, `src/move-dishes.test.ts`, `src/split-bill.test.ts`,
  `src/kitchen-request.bill-move.test.ts`, and from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Move chosen items, part of a line included, to a new bill"`.

### Task 3: Paying for items in cash or by hand-keyed card

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (export an in-transaction form of `takeBillPayment`)
- Modify: `apps/server/src/pay-for-items.ts`, `apps/server/src/bill-payments-api.ts`
- Modify: `apps/server/src/till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`,
  `till-api.session-person.test.ts` (D9)
- Test: `apps/server/src/pay-for-items.test.ts`

**Interfaces:**
- Produces in `bill-payments.ts`: `takeBillPaymentIn(tx, deps, cfg, workingOrderId, req, operator):
  Promise<BillPaymentResult>`, the body `takeBillPayment` runs inside its transaction for a bill
  with no counter basket. `takeBillPayment` calls it; its tests pass unedited.
- Produces in `pay-for-items.ts`:
  ```ts
  export interface PayForItemsRequest {
    submissionId: string; picks: ItemPick[]; expectedEdits: BillEditExpected[];
    method: "cash" | "card"; applied: string; tip: string; tendered?: string; addedTip?: string;
    entry?: "reader";
  }
  export async function payForItems(deps, cfg, fromBillId: string, req: PayForItemsRequest,
    operator): Promise<{ billId: string; payment: BillPaymentResult }>
  ```
- Routes: `POST /api/working-orders/:id/item-payments` and
  `POST /api/working-orders/:id/item-payments/preview` (body `{ picks, method, tendered?, addedTip? }`,
  answering `{ total, applied, tip, change }` from `priceItemPicks` and `previewAllocation`
  (`packages/orders-sales/src/bill-allocation.ts:147`) over a bill of that total with no payments;
  it writes nothing).

- [ ] **Step 1: Write the failing tests:**
  - `"cash pays the chosen items on their own bill and issues its ticket"`: soup 6.00 and hake
    15.00; pay for the hake, cash tendered 20.00; one new bill `settled` with one invoice of 15.00,
    change 5.00; the source `open` with 6.00 and no payment.
  - `"a hand-keyed card does the same"`.
  - `"the same submission twice makes one bill"` (Review Focus 1): one `submissionId` sent twice;
    one new bill, one invoice; the second answer equals the first.
  - `"too little cash leaves both bills as they were"`: tendered 10.00 for 15.00 refuses
    `management.request_invalid` with field `tendered` (`bill-allocation.ts:142`); no new bill exists.
  - `"a stale preview is refused"`: `applied` 14.00 for items now costing 15.00 refuses
    `bill.allocation_changed`; no new bill exists.
  - `"the preview prices the chosen items as their own bill would"`: one of three beers at 2.50 and a
    hake 15.00, cash tendered 20.00 → `{ total: "17.50", applied: "17.50", tip: "0.00", change: "2.50" }`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** `takeBillPaymentIn`, then `payForItems` for cash and hand-keyed card in
  one `withIssuanceTransaction`: the replay lookup (D6), `moveItemsToNewBill`, then
  `takeBillPaymentIn` on the new bill with `{ kind: "share", shareOf: 1, … }` and the
  `expectedEdit` read from the new bill (D9). Then the routes and the D9 test rows.
- [ ] **Step 4: Run** the test file, `src/bill-payments.test.ts`, `src/bill-payments-api.test.ts`
  and the three `till-api.*` files above. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Pay for chosen items on a bill of their own"`.

### Task 4: Splitting the card reader payment into its two steps

**Files:**
- Modify: `apps/server/src/bill-payments.ts`

**Interfaces:**
- Produces: `beginReaderBillPayment(tx, deps, cfg, workingOrderId, req, operator)` (the first
  transaction's body of `takeReaderBillPayment`, `:2436-2496`, returning what the later steps
  need) and `collectBegunReaderPayment(deps, cfg, begun)` (its provider call and outcome,
  `:2511-2589`). `takeReaderBillPayment` becomes their composition.

- [ ] **Step 1: Run** `pnpm --filter @waitron/server exec vitest run src/bill-payments.card.test.ts
  src/bill-payments-api.test.ts` and note the counts. Expected: PASS.
- [ ] **Step 2: Extract the two functions** with no change in behaviour.
- [ ] **Step 3: Run** the same command. Expected: PASS with the same counts, no test edited.
- [ ] **Step 4: Commit** `git commit -s -m "Split the card reader payment into its begin and collect steps"`.

### Task 5: Paying for items on the card reader, and putting them back

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (`failBillPayment`, D2; `BillBalance.beingPaidOn`),
  its callers (D2), `apps/server/src/pay-for-items.ts`, `scripts/no-bare-transaction.test.ts`
- Test: `apps/server/src/pay-for-items.card.test.ts`

**Interfaces:**
- Consumes: Task 4's two functions.
- `failBillPayment(tx, cfg: TradingContext, billPaymentId, failedAt, attestation)`.
- Produces: `BillBalance.beingPaidOn?: { billId: string; billNumber: number | null }`, set on an
  open bill when an open bill whose `items_paid_from` names it holds a pending payment (PR 2 shows
  "Being paid on bill N" from it).

- [ ] **Step 1: Write the failing tests** (with the reader fakes `bill-payments.card.test.ts` uses):
  - `"a captured card issues the new bill's ticket"`.
  - `"a declined card puts the items back"` (Review Focus 2): soup and hake; pay for the hake by
    reader; decline; the source holds soup and hake at 21.00, the new bill is `abandoned`, no
    invoice names it.
  - `"while the card is awaited the items are on the new bill"`: during `collect`, the source's
    balance has `beingPaidOn` naming the new bill, and a line write to the new bill refuses
    `order.payment_in_flight`.
  - `"a stuck card settled later as failed puts the items back"`: drive `settlePendingBillPayments`
    (`bill-payments-loop.ts:113`) to a failed outcome.
  - `"a source no longer open keeps the items on their own bill"` (Review Focus 3): print the source
    during `collect`, then decline; the payment is `failed` and the new bill is still `open` with the
    hake.
  - `"a refused put-back still fails the payment"`: make the move back refuse (a source whose
    simplified-invoice limit the hake would pass); the payment is `failed` and the new bill `open`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.card.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the reader path of `payForItems` (one transaction: replay lookup, move,
  `beginReaderBillPayment`; then `collectBegunReaderPayment`), D2's put-back, and `beingPaidOn`.
- [ ] **Step 4: Run** the test file, `src/bill-payments.card.test.ts`, `src/payments-api.test.ts`
  and from the root `pnpm exec vitest run scripts/no-bare-transaction.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Put paid-for items back when their card payment fails"`.

### Task 6: An overpaid bill — give back or keep as a tip

**Files:**
- Create: `apps/server/src/bill-overpaid.ts`
- Modify: `apps/server/src/bill-payments.ts` (`BillBalance.overpaid`), `apps/server/src/working-order.ts`
  (`applyLineEdits`, D3), `apps/server/src/bill-refunds.ts`, `apps/server/src/tender-refund-sends.ts`
  and the refund recovery loop (issue once balanced), `apps/server/src/bill-payments-api.ts`,
  `apps/server/src/errors.ts`, `apps/server/src/till-api.ts`, `apps/till/src/i18n/codes.ts`,
  `packages/db/src/activity-kinds.ts`, the three `till-api.*` test files of D9
- Test: `apps/server/src/bill-overpaid.test.ts`

**Interfaces:**
- Produces: `BillBalance.overpaid: Decimal`; `keepOverpaidAsTip(tx, deps, cfg, workingOrderId,
  operator)`; route `POST /api/working-orders/:id/overpaid/keep-as-tip`, body `{ submissionId }`,
  permission `payment.take`, answering the bill's balance. New code `bill.not_overpaid` (409):
  "This bill has nothing paid over what it comes to." / "Esta cuenta no tiene nada pagado de más."

- [ ] **Step 1: Write the failing tests** (Review Focus 4), each starting from a 20.00 bill with
  15.00 received in cash and 10.00 of items paid for:
  - `"a bill left owing less than it was paid issues nothing"`: `overpaid: "5.00"`, no invoice.
  - `"keeping the excess as a tip issues the bill"`: the payment's applied is 10.00 and tip 5.00;
    the source is `settled` with an invoice of 10.00 and its tender carries the 5.00 tip.
  - `"giving back the excess in cash issues the bill"`: refund 5.00 of the cash payment; `settled`,
    invoice 10.00.
  - `"giving back by connected card issues the bill when the refund completes"`: with a card
    payment instead, the bill is `open` while the refund is pending and `settled` once the provider
    confirms it.
  - `"adding a dish uses up the excess"`: send a 3.00 coffee; accepted, `overpaid: "2.00"`; send a
    2.00 water; the bill is `settled` with an invoice of 15.00 once nothing is unsent.
  - `"taking a dish off an overpaid bill is refused"`: cancelling a dish refuses
    `bill.received_exceeds_total`.
  - `"keep as tip is refused when tips are off"`: `bill.tip_not_allowed`, nothing written.
  - `"keep as tip is refused when nothing is overpaid"`: `bill.not_overpaid`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bill-overpaid.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** D3 and the route.
- [ ] **Step 4: Run** the test file, `src/bill-payments.test.ts`, `src/bill-payments-api.test.ts`,
  `src/bill-refunds.card.test.ts`, the `till-api.*` files, and from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Give back or keep as a tip what a bill was overpaid"`.

PR 1 also updates `docs/backlog/menu.md`'s A1515 entry (piece 1, PR 1 of 4 landed) in its last
commit, then `/finish-branch` with the full wave; the owner lands it.

**For the owner, through the watcher (not blocking PR 1's build):** giving money back needs
`sale.refund` (`bill-refunds.ts:185-189`), so a waiter without it is asked for an approver's PIN
just to give change after Pay for items. "1 A" removed the PIN from Pay for items and Reopen to
split; should Give back on an overpaid bill also need none? Default if unanswered: it keeps today's
refund rule.

## PR 2 — Till (`feat/a1515-1-pay-items-till`)

- Pay > Items (`apps/till/src/widgets/bill-pay-dialog.ts`, `apps/till/src/state/bill-payment.ts`)
  sends `POST /api/working-orders/:id/item-payments` instead of an items payment, shows the chosen
  items' price from the preview route, and offers no `full_with_tip`/`use_pool` choice and no
  own-receipt question (the new bill prints its own receipt). It sends the `applied` and `tip` the
  preview showed (D9), and when every dish is chosen it takes a whole-bill payment instead (D7). The list of lines is today's
  (`payLines`, `bill-payment.ts:412-437`); set-menu lines stay as today until piece 4.
- After the payment, the till shows the table's bill, and the new, settled bill in the bill
  switcher (`apps/till/src/screens/table-bill-controls.ts`).
- While a reader payment is awaited, the table's bill shows a line "Being paid on bill N"; a decline
  or a Stop leaves it as it was.
- A bill whose balance has `overpaid > 0` shows "Paid X more than this bill comes to" with **Give
  back** (opens today's refund dialog, `apps/till/src/widgets/bill-refund-dialog.ts`, for up to X)
  and **Keep as tip** (when tips are on). Pay is not offered while it is overpaid.
- The table-service guide (`apps/server/guide/en/table-service.md` and its Spanish twin) says what
  Pay for items now does. Open and look in both themes and at phone width.

## PR 3 — Removal (`feat/a1515-1-items-kind-removal`)

Delete, with their tests and till text: the `"items"` kind (`packages/db/src/schema/bill-payments.ts:22`,
its checks), `bill_payment_lines` (`:114-140`) and every listing of it (classification, manifest,
schema-constraints, append-only-triggers, `apps/till/src/api/live-connection.ts:94`, the Madrid demo
fixtures), `itemsDue`, `paidQuantitiesOf`, `readPaidQuantities`, `refusePaidLines` and their nine
callers, `BillBalance.paidLines`, the allocation's items case and `full_with_tip`/`use_pool`
(`packages/orders-sales/src/bill-allocation.ts`), `bill.line_paid` and `bill.refund_not_whole`,
`set-menu-bill.ts:316-350`'s paid pin, and the till's paid marks and unpickable paid groups
(`portion-selection.ts`, `split-selection.ts`, `till-table-order-screen.ts`). A test that asserts the
removed behaviour is deleted, not rewritten; each is listed in the PR's "Changed test checks".

## PR 4 — Printed bills (`feat/a1515-1-printed-bills`)

- **No PIN** (owner "1 A"): `splitAfterPrint` (`apps/server/src/split-after-print.ts:50-80`) stops
  asking `sale.rectify` and runs outside `withRectifyPinAhead`. `recordCorrection` checks
  `sale.rectify` itself (`packages/core/src/record-correction.ts:166-182`), so a correction made
  without it needs a new kind of authorisation there: a change to the fiscal core. Its exact form is
  written on the PR 4 page and cleared by the watcher before building. The till's approver step for
  Reopen to split goes (`till-app.ts:21876-21970`, mode `"split"` only; Cancel and credit keeps its
  PIN).
- **A part-paid printed bill** (owner "2 B"): `refusePlacedOrderMoney`
  (`working-order.ts:8008-8014`) stops refusing received money on this path, and the money counts
  towards the table's remaining bill. Two ways to carry it are weighed on the PR 4 page, with every
  reader of `bill_payments.working_order_id` and `payments.working_order_id` traced: (a) move the
  received payments to the new open bill, through a new column `bill_payments.carried_from` and a
  change to the `bill_payments_guard_update` trigger (`core.sql:45-82`) allowing `working_order_id`
  to change only from an `abandoned` bill; (b) reopen the same bill rather than copying its dishes
  to a new one, so the payments never move. A pending payment still refuses
  (`order.payment_in_flight`).
- **A printed bill holding an advance** (a part payment with its own receipt, `bill_advances`)
  stays refused: its ticket already counts that money and the advance row is append-only. This
  narrows the owner's "2 B", so it goes to the owner through the watcher with the PR 4 page; PR 1's
  D4 is the same rule for open bills.
- **Pay for items on a printed bill** runs Reopen to split, then PR 1's pay for items from the
  reopened bill, in one transaction.
