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

Each leaves `main` working on its own. They land 1, 2, 4, 3: until PR 4 pays a printed bill's
items the new way, the till pays them the old way, which PR 3 removes. PR 1, 2 and 4 change which
invoices are issued: full review wave with two Codex angles, and the OWNER lands them. PR 3 removes
code only and takes the same wave.

| PR | What a person can do when it lands | Depends on |
| --- | --- | --- |
| 1. Server | The till API can pay for items by moving them to a new bill (cash, hand-keyed and reader card), put them back on a failed card, and settle a bill left overpaid by giving back or keeping a tip. The till still uses the old items payment. | — |
| 2. Till | Pay > Items uses PR 1: the dialog shows the new bill's price, a declined card leaves the table's bill as it was, and an overpaid bill shows **Give back** and **Keep as tip**. Guides updated. | 1 |
| 4. Printed bills | Reopen to split needs no PIN and works on a part-paid printed bill, its money counting towards the table's bill; Pay for items on a printed bill runs it first. | 2 |
| 3. Removal | Nothing new to see: the "items" kind, `bill_payment_lines`, `bill.line_paid` and its guards, `paidLines` and the till's paid marks are gone. | 4 |

PR 1 and PR 2 are written out task by task below. PR 4 and 3 are given as scope, decisions and
files; each gets its task steps on this page, against `main` as PR 1 left it, before its build
starts, because each changes code PR 1 writes. The watcher clears each addition.

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

Branch `feat/a1515-1-pay-items-till`, on top of PR 1 (#4238) until that lands, then rebased onto
`main`. Task 0 changes the server (`apps/server`); Tasks 1–5 change the till, and Task 3 has one
server step. Every line count and `file:line` below was read on PR 1's tip (`71f8ce8be0`).

**What a person sees when it lands:** Pay > Items > choose > Cash or card makes a bill of its own
for the chosen items, takes the payment there and shows that bill's receipt window, then the
table's bill again, with the new bill **Paid ✓** in the bill switcher. Choosing every dish pays the
whole bill. While a card for those items is awaited, the table's bill says **Being paid on Bill N**;
a decline or **Cancel payment** leaves the table's bill as it was. A bill left paid more than it
comes to says so, offers **Give back** and (with tips on) **Keep as tip**, and offers no Pay.

**What stays as it is in PR 2:**
- **A printed bill's Items.** On a `placed` bill (the presented sheet's **Pay in parts**,
  `presented-pay-dialog.ts:454-459`, which opens Pay at `till-app.ts:13444-13448`; or Pay on a
  printed bill) the till keeps sending today's items payment to `/payments` with `kind: "items"`
  through `paymentAsk`'s items branch (`state/bill-payment.ts:91-101`): the new route refuses a
  presented bill (`refuseClosedBill`, `bill-actions.ts:65-69`, run by `moveItemsToNewBill`,
  `pay-for-items.ts:238-239`, and by `previewPayForItems`). PR 4 moves it to the new route.
- The server's old items payment, `paidLines`, the paid marks, and the dialog's choose step
  (`#chooseStep`, `bill-pay-dialog.ts:2317-2380`), which a printed bill's items payment can still
  reach: PR 3 deletes them. Set-menu lines are listed as today (`payLines`,
  `state/bill-payment.ts:412-437`) until piece 4.

**File-size room** (caps in `scripts/product-file-size-limits.json`, guarded by
`scripts/product-file-size.test.ts`, both on this branch; tip line counts): `till-app.ts` 26,065 of
26,250; `bill-pay-dialog.ts` 2,420 of 2,500; `client.ts` 5,694 of 5,750; `till-table-order-screen.ts`
7,516 of 7,750; every other product file 1,000. New logic goes in new files; each task says what
grows. No cap is raised: a task that would pass one moves code into its new file instead.

**Lane B (A1515-3 PR 2) works in the same screen.** PR 2 does not touch
`apps/till/src/widgets/menu-browser.ts`. In `apps/till/src/screens/till-table-order-screen.ts` it
touches only: the imports (beside `:241`), two properties beside `billBalance` (`:1495`), the three
pay gates and the summary in `#footFixed`/`#orderSummary`/`#orderDock` (`:3297-3337`), and one new
method beside `#chargeable` (`:5188-5191`). None of these draw dishes, counts, add/remove/move
controls or the "No place" question.

**Decisions** (the outline left these open):

- **PR2-D1. Two new till files carry the logic.** `apps/till/src/api/item-payment-types.ts` (the
  three routes' wire shapes, as `client.ts` already imports its other `*-types.ts` files,
  `client.ts:46`) and `apps/till/src/state/pay-for-items.ts` (turning a `PayRequest` into the new
  routes' bodies and their answers back into what the dialog and `till-app.ts` already handle).
  `till-app.ts` changes at its two API calls, not in its retry machinery: Pay for items rides on
  the same unanswered-send, resend and reader-Stop handling as every bill payment.
- **PR2-D2. Picks name lines by id.** The route takes `{ lineId, quantity? }`
  (`bill-payments-api.ts:188-205`); today's picks name `lineNo` (`state/bill-payment.ts:39`). `PayLine`
  (`bill-pay-dialog.ts:99-109`) gains `lineId`, filled by `payLines` from `TabLine.id`, and the
  items `PayChoice` pick carries it.
- **PR2-D3. Every dish chosen → whole bill, decided in the till.** When every offered line is
  picked whole, `#choice()` (`bill-pay-dialog.ts:958-979`) answers `{ kind: "whole" }`, so the
  preview and payment are today's whole-bill ones, receipt-guests question included. The server's
  `bill.all_items_chosen` stays the backstop for what the till cannot see: a set-menu dish with a
  supplement is listed on its own (`payLines`), yet leaves with its set menu (`readPicks`,
  `pay-for-items.ts:164-171`), so picking every other line reaches it. Its till words exist from
  PR 1 and say what to do: "These are all the items on this bill. Pay the whole bill instead."
  (`apps/till/src/i18n/codes.ts`, `bill.all_items_chosen`).
- **PR2-D4. Frozen request.** The items body (picks, the source's `expectedEdits`, and for a table
  `expectedPartyRevision`/`partyId` from `#billRevisions()`) is fixed when the waiter confirms and
  stored in the confirmation, because the server's retry fingerprint includes them
  (`retryPrintOf`, `pay-for-items.ts:292-311`): a resend after no answer must send the same body.
  `submissionFor`'s key leaves them out, as it leaves out `expectedEdit` (`state/bill-payment.ts:178-181`),
  and `party.out_of_date` joins `paymentNotRecorded` (`:202-210`): it is raised before anything is
  recorded (`guardPathParty` in `moveItemsToNewBill`, `pay-for-items.ts:238`), and without it a
  retry would resend the stale revision for ever.
- **PR2-D5. The new bill's payment and receipt match a whole-bill payment's, bar the guest count.**
  Task 0 makes the items route read a hand-keyed card's `externalRef`, `externalProvider` and
  `externalMachine` exactly as the whole-bill route does (`bill-payments-api.ts:164-172`,
  `readOutsideCardDetails`, `outside-card.ts:7-28`), and the new bill take the table's bill's
  receipt language. Traced: the Pay window sends no `receiptLanguage` (`bill-pay-dialog.ts` has
  none); a whole-bill payment issues in the bill's stored `receiptLocale` (`bill-payments.ts:1290`),
  overwritten only by a `receiptLanguage` the request carries (`:2076-2077`). A new bill copies its
  source's zone and dining (`working-order.ts:1607-1619`) but not its `receiptLocale`, so
  `moveItemsToNewBill` copies it with `itemsPaidFrom`. The route still takes no guest count or own
  receipt (`parseItemsPayment`, `bill-payments-api.ts:217-252`), so for items the dialog asks
  neither (`#guestsShown`, `#ownReceiptAsked`, `bill-pay-dialog.ts:2132-2150`).
- **PR2-D6. After the payment.** At a table: the new bill's receipt window opens
  (`#showPaidTicket`, `till-app.ts:23694`) for the new bill, and closing it returns to the table's
  bill rather than the next bill owing (`#onBackToTable` picks `#otherBillsToPay()[0]`,
  `till-app.ts:24296`); `SettlementDocument` (`till-app.ts:544-548`) gains `returnTo`. The reread
  that close already does (`#rereadAmounts`) brings the new bill into the switcher, which already
  lists settled bills as **Paid ✓** (`shownBills`, `state/bill-state.ts:83-91`;
  `paidMark`, `table-bill-controls.ts:21-25`). At the Counter: no receipt window (closing it starts
  a new sale, `till-app.ts:25684-25690`, which would drop the rest of the order); the Pay window
  says the payment was taken and the order is read again (`#rereadPayingOrder`'s counter branch).
  The server queues no original receipt at payment (`enqueueSaleReceipt` only reserves delivery);
  the till asks for it (`printReceipt` with `ifOwed`) when the receipt window closes, so where no
  window opens (the Counter, and a handheld's pending card that settles on a later read) the till
  asks as soon as it learns the new bill's invoice was issued, if the device may print receipts.
- **PR2-D7. The answer's balance is the new bill's.** `payForItems` answers `{ billId, payment }`
  with `payment.balance` of the new bill (`pay-for-items.ts:336-438`). The till never stores it as
  the table's balance (`till-app.ts:23628`) and rereads the table's bill without it. A card the
  reader did not charge returns the dialog to the form with the decline said (not to the
  confirmation, as today, `till-app.ts:23642-23660`): the put-back moved the table's bill's
  revisions, so the old confirmation could only be refused. A card still pending after the wait
  (`timeout`) keeps today's split: only a handheld reads a pending payment again every few seconds
  (`#startPendingReread` returns unless `handheldMode`, `till-app.ts:23115-23116`). There PR 2 points
  that reading at the new bill (`PendingReread`, `till-app.ts:1624-1629`, gains the bill it reads;
  `#pendingTick` reads `open.billId` today, `:23152`), so staff see **Card payment in progress**,
  then the payment taken or declined, as for any card. On a till, as today, the window shows the
  payment in progress and the table's bill says **Being paid on Bill N** until the bill is next read.
- **PR2-D8. Give back** reuses the existing `refund-excess` event and handler
  (`#onRefundExcess`/`#openRefund`, `till-app.ts:22852-22886`): the Pay window opens over the bill
  and, when one payment can be refunded, its Refund window opens on the excess. With several, staff
  choose **Refund** beside one.
- **PR2-D9. No PIN to give back money just taken** (owner, watcher note 2026-11-24 10:42; built in
  PR 1, `bill-refunds.ts`'s `refundPermission`). Traced: a refund is sent in the operator's own name
  and the PIN is asked only on `authorization.not_permitted` (`till-app.ts:24090-24100`), so cash and
  connected cards already ask no PIN when the server needs none. A hand-keyed card does not:
  `#onRefundContinue` always asks a PIN once the terminal step is confirmed (`till-app.ts:24015`), and
  the refund window says a manager will approve it (`bill-refund-dialog.ts:431`,
  `bill_refund.terminal_next`/`bill_refund.terminal`). PR 2 sends a hand-keyed give-back of no more
  than the bill's `overpaid` without asking, asks a PIN on `authorization.not_permitted` or
  `bill.manual_refund_pin_required` (the server counts tips given back too, `refundPermission`,
  `bill-overpaid.ts:40-54`), and keeps today's PIN-first path for every other hand-keyed refund.
  The refund window drops its PIN sentence for such an amount.
- **PR2-D10. Keep as tip is one tap, naming the amount** ("Keep €5.00 as tip"), with a fresh
  submission id each tap: the server records none and refuses a retry once the bill is no longer
  overpaid (`bill-overpaid.ts:56-65`). The request carries the amount the button named, and the
  server refuses `bill.overpaid_changed`, writing nothing, when the bill's excess is no longer that
  amount (found by the pre-merge review: another till's payment had raised it). After any answer or
  none, the till reads the bill again, so staff see and confirm the new amount.
- **PR2-D11. An overpaid bill offers no Pay, and no pay-section Full invoice.** The three pay gates
  (`till-table-order-screen.ts:3299,3306,3308,3317`) also require `overpaid` to be zero; `#chargeable`
  is left alone because Move a bill uses it too (`:7111`). Full invoice stays in the table ⋮.
- **PR2-D12. Refusals speak to the Pay window.** `refusalOf` (`state/bill-payment.ts:282-326`) and
  `PayRefusal` (`widgets/pay-refusal.ts:9-39`) carry `advances` and `dishName`, and `refusalText`
  passes the refusal to `codeMessage` as params (`pay-refusal.ts:99` passes none today), so
  `bill.below_advances` names its amount. `set_menu.no_place_on_target` (`codes.ts:36-38`) speaks of
  "the other bill", Move dishes' words; answering an items payment, the till shows its own instead:
  "{dishName} is part of a set menu. Choose its set menu too, or leave it on this bill." / "{dishName}
  forma parte de un menú. Elige también su menú o deja el plato en esta cuenta." The preview refuses
  it already (`readPicks`, `pay-for-items.ts:160-161`), so it shows on the form, before any money.
- **PR2-D13. A printed bill's Items stays on the old route** (see **What stays**). The till chooses
  by the bill's status as the Pay window last read it (`open.balance.status`, else the party bills
  row): `placed` sends `paymentAsk`'s items ask to `previewBillPayment`/`takeBillPayment` as today.
- **PR2-D14. A Counter order with no edit state.** The route needs the source's edit state
  (`requireBillEditors` → `readExpectedBillEdits`, `bill-editing.ts:237-250`, refuses a missing one
  as `expectedEdits`), and `#counterExpectedEdit` answers null when the basket's read of the order
  is not the current one (`till-app.ts:4137-4141`). An items payment then goes no further than the
  preview's existing check (`till-app.ts:23398-23400` throws `draft.out_of_date` for a table's null
  edit): it does the same for an items payment at the Counter, whose refusal path reads the order
  again (`#onBillPayRefused` → `#rereadPayingOrder` → `#reloadCounterOrder`), which stores a fresh
  edit state (`till-app.ts:10841-10845`); the next Continue works.
- **PR2-D15. An overpaid bill owes nothing in the party's sums.** The party bills list gives it a
  negative `outstanding` (`readBillsOfParties`, `parties.ts:774-775`), which the party's **Still to
  pay** adds up (`working-order.ts:9876-9881`) and the till's switcher shows. Task 3 clamps the row's
  `outstanding` at zero and adds `overpaid`, which the till's `owes()` reads.

**Changed test checks** (behaviour PR 2 changes on purpose; each named in the PR description):
in `apps/till/src/till-app-bill-payments.test.ts`, "accepted bill payment retires dirty entry before
the following table read" (`:1141`) and "pays for chosen items, then a contribution, then an equal
share…" (`:1184`) move their items step to the new routes; "pays for one held Tiramisu on the
table's own bill…" (`:5926`) and the `describe("till-app: the steak's two choices")` block
(`:6050-6198`) are deleted: they assert, on an open bill, the old items payment's paid-in-place marks
and the full-with-tip/use-pool choice, which the till no longer offers there. In
`apps/till/src/till-app-current-bill-pay.test.ts` the case at `:200-250` expects the new preview
route. The implementer greps `kind: "items"` across `apps/till/src/**/*.test.ts` and lists any other
it changes; a check on a printed bill's items payment stays as it is.

### Task 0 (PR 2): The new bill keeps a hand-keyed card's details and the table's receipt language

**Files:**
- Modify: `apps/server/src/bill-payments-api.ts` (`parseItemsPayment`, `:217-252`: for a card with
  no `entry`, the hand-keyed case, `readOutsideCardDetails(body, true)` and `externalRef`; for cash
  or a reader card, either refused as the whole-bill parser refuses them, `:164-172`)
- Modify: `apps/server/src/pay-for-items.ts` (`PayForItemsRequest` gains `externalRef?`,
  `externalProvider?`, `externalMachine?`; `payForItems`'s `payment()` passes them on; the retry
  fingerprint takes them in through `...req`; `moveItemsToNewBill` copies the source's
  `receiptLocale` with `itemsPaidFrom`)
- Test: extend `apps/server/src/pay-for-items.test.ts` and `apps/server/src/bill-payments-api.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a hand-keyed card's operation number and machine are kept on the new bill's payment"`:
    `externalRef: "4471"`, `externalProvider: "other"`, `externalMachine: "Bar terminal"` → the new
    bill's balance lists the payment with them, as a whole-bill hand-keyed payment's view does.
  - `"the new bill prints in the table's bill's receipt language"`: source `receiptLocale` `"en"`
    → the new bill's `receiptLocale` is `"en"` and its invoice result's receipt language English.
  - `"the same submission with another operation number is not a replay"`: same `submissionId`,
    `externalRef` changed → refused `submission.id_reused`, one bill.
  - In `bill-payments-api.test.ts`: `"item payments refuse which-machine details for cash"`
    (`management.request_invalid`, field `externalProvider`) and `"…an operation number for a
    reader card"` (field `externalRef`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.test.ts
  src/bill-payments-api.test.ts`. Expected: FAIL on the first case (no operation number).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/pay-for-items.card.test.ts
  src/pay-for-items.move.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Keep a hand-keyed card's details and the table's receipt language on a bill paid for by item"`.

### Task 1 (PR 2): The till's client for the new routes, and the items state

**Files:**
- Create: `apps/till/src/api/item-payment-types.ts` (~50 lines)
- Modify: `apps/till/src/api/client.ts` (+~35, to ~5,730: `BillBalance.overpaid` and `beingPaidOn`,
  `AllocationPreview`'s allocated `total?`, three methods)
- Create: `apps/till/src/state/pay-for-items.ts` (~160 lines)
- Modify: `apps/till/src/state/bill-payment.ts` (+~15: `payLines` `lineId`, `PayChoice` pick
  `lineId`, `paymentNotRecorded`, `refusalOf`), `apps/till/src/widgets/bill-pay-dialog.ts` (+1:
  `PayLine.lineId`), `apps/till/src/widgets/pay-refusal.ts` (+4)
- Modify: `apps/till/src/i18n/strings.ts` (`bill_pay.items_set_menu_dish`, English and Spanish, PR2-D12)
- Modify: `apps/till/test/bill-pay-app.ts` (`balanceOf` default `overpaid: "0.00"`, `stubApi` stubs
  for the three methods)
- Test: create `apps/till/src/state/pay-for-items.test.ts` and
  `apps/till/src/api/client.item-payments.test.ts`; extend `apps/till/src/state/bill-payment.test.ts`

**Interfaces:**
- Consumes (PR 1, Task 0): `POST /api/working-orders/:id/item-payments/preview` (body
  `{ picks, method, tendered?, addedTip? }`, answer `{ total, applied, tip, change }`,
  `bill-payments-api.ts:484-492`, `pay-for-items.ts:457-513`); `POST /api/working-orders/:id/item-payments`
  (body `PayForItemsRequest`, `pay-for-items.ts:274-288`, with Task 0's three fields; answer
  `{ billId, payment: BillPaymentResult }`; reader Stop keyed by the SOURCE bill's id and the
  submission id, `bill-payments-api.ts:520-525` and `:542`, so today's
  `cancelBillReaderPayment(open.billId, …)` reaches it unchanged);
  `POST /api/working-orders/:id/overpaid/keep-as-tip` (body `{ submissionId, overpaid }`, answer `BillBalance`,
  `bill-payments-api.ts:549-570`); `BillBalance.overpaid` and `beingPaidOn`
  (`apps/server/src/bill-payments.ts:292-301`).
- Produces in `item-payment-types.ts`:
  ```ts
  export interface ItemPick { lineId: string; quantity?: string }
  export interface ItemPaymentAsk { picks: ItemPick[]; method: "cash" | "card"; tendered?: string; addedTip?: string }
  export interface ItemPaymentPreview { total: string; applied: string; tip: string; change: string | null }
  export interface ItemPaymentRequest extends ItemPaymentAsk, OutsideCardDetails {
    submissionId: string; expectedEdits: BillEditExpected[]; expectedPartyRevision?: number;
    partyId?: string; applied: string; tip: string; externalRef?: string; entry?: "reader";
    readerId?: string; simulationOutcome?: "captured" | "declined" | "attempting";
  }
  export interface ItemPaymentResult { billId: string; payment: BillPaymentResult }
  ```
- Produces in `client.ts`: `previewItemPayment(billId, ask): Promise<ItemPaymentPreview>`,
  `payForItems(billId, request, options?): Promise<ItemPaymentResult>`,
  `keepOverpaidAsTip(billId, submissionId, options?): Promise<BillBalance>`.
- Produces in `pay-for-items.ts`:
  ```ts
  export type ItemsPart = { picks: ItemPick[]; expectedEdits: BillEditExpected[]; expectedPartyRevision?: number; partyId?: string };
  export function itemsChoiceOf(lines: readonly PayLine[], picks: ReadonlyMap<number, number>, offered: readonly PayLine[]): PayChoice; // PR2-D3
  export function itemsAsk(asked: PayRequest): ItemPaymentAsk;
  export function itemsAllocated(preview: ItemPaymentPreview, method: "cash" | "card"): AllocationPreview; // allocated, choice null, charged = applied + tip for a card, total kept
  export function itemsAllocatedFrom(preview: AllocationPreview): AllocationPreview; // a refusal's fresh preview: total = applied
  export function itemsRefusal(refusal: PayRefusal): PayRefusal; // PR2-D12's words for set_menu.no_place_on_target
  export function withItems(confirmation: Confirmation, asked: PayRequest, expectedEdit: BillEditExpected | null, revisions: BillRevisions): Confirmation; // PR2-D4
  export function itemsRequestOf(request: Confirmation & { submissionId: string; items: ItemsPart }): ItemPaymentRequest; // PR2-D5
  export function previewPayment(api: TillApi, billId: string, asked: PayRequest, expectedEdit: BillEditExpected | null, printed: boolean): Promise<AllocationPreview>; // PR2-D13
  export function takePayment(api: TillApi, billId: string, request: Confirmation & { submissionId: string }, options: ReadOptions): Promise<BillPaymentResult & { paidOn?: string }>;
  ```
  `Confirmation` (`state/bill-payment.ts:126`) becomes `Omit<BillPaymentRequest, "submissionId"> & { items?: ItemsPart }`;
  `withItems` adds `items` only for an items choice on a bill that is not `placed`.
  `itemsAllocatedFrom`: a `bill.allocation_changed` refusal carries the share allocation over the
  would-be new bill (`packages/orders-sales/src/bill-allocation.ts:206-223`), a whole payment of a
  bill holding nothing else, so its `applied` is that bill's total, as `previewPayForItems` builds
  it (`pay-for-items.ts:484-490`).

- [ ] **Step 1: Write the failing tests.**
  In `state/pay-for-items.test.ts`:
  - `"every dish picked whole is the whole bill"`: three lines, all picked at full units → `{ kind: "whole" }`.
  - `"one of three beers is a part pick by line id"`: a line of 3 with `unitTotal` → picks
    `[{ lineNo: 1, lineId: "line-1", units: 1 }]`, and `itemsAsk` sends `{ lineId: "line-1", quantity: "1" }`.
  - `"a card preview is allocated with its charge and the items' own total"`:
    `{ total: "17.50", applied: "17.50", tip: "2.50", change: null }` → `charged: "20.00"`, `total: "17.50"`.
  - `"a changed allocation keeps the items' total"`: `itemsAllocatedFrom` of an allocated preview
    with `applied: "16.00"` → `total: "16.00"`.
  - `"the items request carries only what the route reads"`: a hand-keyed card confirmation with
    `externalRef`, `externalProvider`, `externalMachine`, `guestCount`, `receiptLanguage`,
    `ownReceipt` and `expectedEdit` → the first three in the body, none of the rest; no `entry`;
    `expectedEdits` and the party revision from `items`.
  - `"a reader request names the reader and the practice outcome"`.
  - `"a set-menu dish chosen alone is refused in the Pay window's words"`: `itemsRefusal` of
    `{ code: "set_menu.no_place_on_target", dishName: "Flan" }` → text "Flan is part of a set
    menu…", in English and Spanish; any other code unchanged.
  - `"previewPayment and takePayment send a whole-bill choice down today's routes"`, `"…an items
    choice down the new ones"`, with `paidOn` the answer's `billId`, and `"…a printed bill's items
    choice down today's route with kind items"`.
  In `state/bill-payment.test.ts`: `"payLines names each line's id"`; `"the same items payment
  confirmed again after a reread keeps its submission id"` (key ignores `items.expectedEdits` and
  revisions); `"a stale party revision is not recorded"` (`paymentNotRecorded({ code: "party.out_of_date" })`);
  `"refusalOf keeps advances and dishName"`. In `client.item-payments.test.ts` (a `fetchStub` as
  `client.test.ts:6416-6470` builds one): each method's path, method, body and signal.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/state/pay-for-items.test.ts
  src/state/bill-payment.test.ts src/api/client.item-payments.test.ts`. Expected: FAIL, module
  `./pay-for-items.js` not found.
- [ ] **Step 3: Implement** as the Interfaces block says; `refusalText`'s last line becomes
  `codeMessage(refusal.code, undefined, refusal)`, as `bill-refund-dialog.ts` already calls it.
- [ ] **Step 4: Run** the same command, then `pnpm --filter @waitron/till exec vitest run
  src/widgets/bill-pay-dialog.test.ts src/i18n/codes.test.ts src/i18n/strings.test.ts` and
  `pnpm --filter @waitron/till typecheck`. Expected: PASS. Read the `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Teach the till's client the new Pay for items routes, and name picked dishes by line id"`.

### Task 2a (PR 2): Pay > Items in cash or by hand-keyed card at a table

**Files:**
- Modify: `apps/till/src/widgets/bill-pay-dialog.ts` (+~15, to ~2,436): `#choice()` through
  `itemsChoiceOf`; `#guestsShown`/`#ownReceiptAsked` false for an items payment on the new route;
  the confirmation's scope line shows the preview's `total` (`#scope`, `:1569-1590`), and a line
  under it, `bill_pay.items_own_bill`
- Modify: `apps/till/src/till-app.ts` (+~35, to ~26,100): `#onBillPayPreview` (`:23418`),
  `#onBillPayConfirm` (`:23469`, `:23555`), `#onBillPayRefused`'s `bill.allocation_changed` branch
  (through `itemsAllocatedFrom`) and refusal (through `itemsRefusal`), `#onBillPaid`'s invoice
  branch (`:23662`), `#showPaidTicket` (`:23694`), `SettlementDocument` (`:544-548`),
  `#onBackToTable` (`:24293-24313`)
- Modify: `apps/till/src/i18n/strings.ts` (`bill_pay.items_own_bill`, English and Spanish)
- Test: create `apps/till/src/till-app-pay-for-items.test.ts` (with `test/bill-pay-app.ts`'s
  helpers: `stubApi`, `openTable`, `openDialog`, `press`, `type`); extend
  `apps/till/src/widgets/bill-pay-dialog.test.ts`; the changed checks listed above

**Interfaces:** consumes Task 1's `previewPayment`, `takePayment`, `withItems`, `itemsChoiceOf`,
`itemsAllocatedFrom`, `itemsRefusal`.
- `#onBillPayPreview`: `api.previewBillPayment(open.billId, paymentAsk(…))` → `previewPayment(api,
  open.billId, asked, expectedEdit, <placed>)` (PR2-D13).
- `#onBillPayConfirm`: `confirmationOf(…)` wrapped in `withItems(…, asked, open.expectedEdit,
  this.#billRevisions())`; `api.takeBillPayment(…)` → `takePayment(api, open.billId,
  submission.request, { signal })`.
- `#onBillPaid`, when `result.paidOn` is set (PR2-D6, D7): no `this.billBalance = result.balance`
  (`:23628`); an invoice at a table → `#showPaidTicket` for `paidOn` with `returnTo: open.billId`.

- [ ] **Step 1: Write the failing tests** in `till-app-pay-for-items.test.ts`:
  - `"pays for two dishes in cash on a bill of their own, shows its receipt, then the table's bill"`:
    €120.00 bill (`bill120`), pick Tarta and Vino, cash 50 → `previewItemPayment("wo-4",
    { picks: [{ lineId: "line-4" }, { lineId: "line-5" }], method: "cash", tendered: "50" })`;
    the confirmation shows "Paying for Tarta, Vino: €30.00" from the preview's `total`; `payForItems`
    gets `applied: "30.00"`, `tip: "0.00"`, `expectedEdits: [<wo-4's edit>]`, the party's
    revision and id, no `kind`, `guestCount` or `ownReceipt`; `till-settlement-document-dialog`
    opens for `wo-9` with change €20.00; after `settlement-close` the screen shows `wo-4`, not another
    bill still owing, and the switcher lists `wo-9` as Paid ✓ once `getPartyBills` answers it.
  - `"a hand-keyed card sends its operation number and machine"`.
  - `"choosing every dish pays the whole bill"`: all five picked → `previewBillPayment` with
    `kind: "share", shareOf: 1`; `previewItemPayment` and `payForItems` never called.
  - `"a printed bill's items still go to today's route"` (PR2-D13): party bill row `status:
    "placed"`, Pay > Items, one dish → `previewBillPayment` and `takeBillPayment` with
    `kind: "items"`; the new routes never called.
  - `"the advances refusal names its amount"`: `{ code: "bill.below_advances", advances: "15.00" }`
    → the dialog says "…its own receipt (€15.00)…".
  - `"a set-menu dish chosen alone says to choose its set menu too"`.
  - `"a changed allocation shows the items' new total"`: `bill.allocation_changed` with a preview
    of `applied: "31.00"` → the confirmation shows €31.00.
  In `bill-pay-dialog.test.ts`: `"asks no receipt guests and no own receipt for items"`;
  `"shows the preview's total for the chosen items"` (preview `total: "31.00"` against a client sum
  of €30.00 → €31.00 shown).
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-pay-for-items.test.ts
  src/widgets/bill-pay-dialog.test.ts`. Expected: FAIL (the items preview still goes to
  `previewBillPayment`).
- [ ] **Step 3: Implement** as the Interfaces block says, and change the checks listed under
  **Changed test checks** (move an items step to the new routes; delete the two named groups).
- [ ] **Step 4: Run** the Step 2 command, then `pnpm --filter @waitron/till exec vitest run
  src/till-app-bill-payments.test.ts src/till-app-current-bill-pay.test.ts
  src/till-app-set-menus.test.ts`, then `pnpm --filter @waitron/till typecheck` and from the root
  `pnpm exec vitest run scripts/product-file-size.test.ts`. Expected: PASS; read each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Pay for chosen items on a bill of their own from the till"`.

### Task 2b (PR 2): Pay for items by card reader, after no answer, and at the Counter

**Files:**
- Modify: `apps/till/src/till-app.ts` (+~25, to ~26,125): `#onBillPaid`'s not-charged branch
  (`:23642-23660`), its pending branch (`:23667-23691`), `PendingReread` (`:1624-1629`) and
  `#pendingTick` (`:23152`) for PR2-D7; the Counter's null edit (PR2-D14) beside `:23398-23400`
- Test: extend `apps/till/src/till-app-pay-for-items.test.ts`

**Interfaces:** `#onBillPaid`, when `result.paidOn` is set: not charged → form with the refusal,
`asked`/`preview` null, then `#rereadPayingOrder(open)`; at the Counter → `taken`, the dialog's
balance read again (`#rereadBillPaying(open.id, open.billId)`); pending → `taken`, and on a handheld
the pending reread reads `paidOn`. Every branch rereads the table's bill without the answer's balance.

- [ ] **Step 1: Write the failing tests:**
  - `"a declined reader card leaves the table's bill as it was"`: reader card, `payForItems` answers
    `outcome: "declined"` with the new bill's balance → the form shows `bill_pay.card_declined`,
    `getTabLines("wo-4")` and `getPartyBills` called again, `billBalance` still `wo-4`'s.
  - `"Cancel payment stops the reader under the table's bill"`: during the reader wait,
    `bill-pay-stop` → `cancelBillReaderPayment("wo-4", <submissionId>)`.
  - `"no answer resends the same body under the same submission id"`: first `payForItems` rejects
    `TypeError("Failed to fetch")`, second answers → both calls' bodies equal, party revision
    included, even though the party was read again between them.
  - `"a stale party revision asks again with a fresh id"`: `party.out_of_date` → the next confirm
    sends a new submission id and the newly read revision.
  - `"a card still pending on a till shows the payment in progress and reads the table's bill"`.
  - `"a card still pending on a handheld is read on its own bill until it is taken"`:
    `handheldMode`; `getBillBalance("wo-9")` on the timer; captured → **Payment taken**.
  - `"at the Counter the window stays, says the payment was taken, and reads the order again"`.
  - `"at the Counter with no edit state the order is read again before items are paid"`:
    `#counterExpectedEdit` null → no `previewItemPayment`; the order is reloaded; the next
    Continue previews.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-pay-for-items.test.ts`.
  Expected: FAIL on the first case (the confirmation stays).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/till-app-bill-payments.test.ts
  src/till-app-handheld-pay.test.ts src/till-app-counter-payment-window.test.ts`,
  `pnpm --filter @waitron/till typecheck` and from the root `pnpm exec vitest run
  scripts/product-file-size.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Pay for items by card reader, and after a lost answer, at a table or the Counter"`.

### Task 3 (PR 2): The table's bill says it is being paid elsewhere, or paid too much

**Files:**
- Modify: `apps/server/src/parties.ts` (`readBillsOfParties`, `:715`; the row at `:774-775`; the
  `PartyBill` interface, `:92-130`, gains `overpaid?: string`) — PR2-D15
- Create: `apps/till/src/screens/bill-money-notice.ts` (~110 lines): `beingPaidNotice(balance)`,
  `overpaidNotice({ balance, tipsEnabled, busy, onGiveBack, onKeepAsTip })`, `billMoneyNoticeStyles`
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (+~25, to ~7,541; only the lines named
  under **Lane B** above): properties `tipsEnabled`, `overpaidBusy`; `#takesPayment()`; the notices
  rendered in `#orderSummary` after `#mealEndOutcome()`; it dispatches `refund-excess`
  `{ excess: overpaid }` and `keep-as-tip`
- Modify: `apps/till/src/api/client.ts` (+1: `PartyBill.overpaid?`, `:2352`) and
  `apps/till/src/screens/table-bill-controls.ts` (+~4): `owes()` (`:12-18`) shows "€5.00 over" for a
  row with `overpaid`
- Modify: `apps/till/src/widgets/bill-pay-dialog.ts` (+~8, to ~2,444): `#balance()` (`:1517-1540`)
  shows **Paid over the total** instead of a negative **Still to pay**
- Modify: `apps/till/src/till-app.ts` (+~35, to ~26,160): `.tipsEnabled` and `.overpaidBusy` at both
  `<till-table-order-screen>` sites (`:24650`, `:24863`); `@keep-as-tip` beside `@refund-excess`
  (`:25386`); `#onKeepAsTip()` (PR2-D10): `keepOverpaidAsTip(activeTabId, crypto.randomUUID())`
  under `TABLE_REQUEST_LIMIT_MS`, the answer stored as `billBalance` while the bill is on screen, a
  refusal through `#onTableRefusal` (`:15418`), then `#rereadAmounts`
- Modify: `apps/till/src/i18n/strings.ts`: `table.being_paid_on` ("Being paid on {bill}" /
  "Se está cobrando en la {bill}"), `table.overpaid` ("Paid {amount} more than this bill comes to" /
  "Se ha pagado {amount} más de lo que suma esta cuenta"), `table.give_back` ("Give back {amount}" /
  "Devolver {amount}"), `table.keep_as_tip` ("Keep {amount} as tip" / "Dejar {amount} de propina"),
  `table.bill_overpaid` ("{amount} over" / "{amount} de más"), `bill_pay.overpaid` ("Paid over the
  total" / "Pagado de más")
- Test: extend `apps/server/src/parties.test.ts`; create `apps/till/src/screens/bill-money-notice.test.ts`;
  extend `apps/till/src/screens/till-table-order-screen.bill-payments.test.ts`,
  `till-table-order-screen.bill-payments.a11y.test.ts`, `till-table-order-screen.bill-switcher.test.ts`;
  add cases to `apps/till/src/till-app-pay-for-items.test.ts`

**Interfaces:** consumes `BillBalance.overpaid`/`beingPaidOn` and `keepOverpaidAsTip` (Task 1),
`billNumberLabel` (`state/bill-state.ts:111-115`).

- [ ] **Step 1: Write the failing server test** in `parties.test.ts`: `"an overpaid bill owes
  nothing and the party still owes its other bill"`: one bill overpaid by 5.00 (Pay for items after
  a 15.00 contribution on a 20.00 bill) and another owing 30.00 → the first row `outstanding:
  "0.00"`, `overpaid: "5.00"`; the party's outstanding `"30.00"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/parties.test.ts`. Expected:
  FAIL (`outstanding: "-5.00"`, party `"25.00"`). Implement; run again: PASS, then
  `src/pay-for-items.test.ts src/bill-overpaid.test.ts src/till-api.parties.test.ts`: PASS.
- [ ] **Step 3: Write the failing till tests:**
  - `"an open bill being paid elsewhere says which bill"`: `beingPaidOn: { billId: "wo-9", billNumber: 3 }`
    → "Being paid on Bill 3"; Pay still offered.
  - `"an overpaid bill says by how much and offers no Pay"`: `overpaid: "5.00"` → the sentence,
    **Give back €5.00**, **Keep €5.00 as tip**, and no `[data-pay-sheet]`, `[data-pay-rest]` or
    `till-tender-pay`, at till width and at handheld width (`handheld`, not `wide`).
  - `"with tips off only Give back is offered"`.
  - `"Give back asks for the excess to be refunded"`: click → `refund-excess` with
    `{ excess: "5.00" }`, bubbling and composed.
  - `"Keep as tip is quiet while it is out"`: `overpaidBusy` → both buttons disabled.
  - `"the switcher shows an overpaid bill's excess, not an amount owed"`.
  - `"the Pay window shows what was paid over the total"`.
  - a11y: the overpaid notice in light and dark themes passes axe.
  In `till-app-pay-for-items.test.ts`: `"Keep as tip sends a fresh submission id and shows the bill
  paid"` (answer `status: "settled"` → `getPartyBills` read again, the switcher row Paid ✓);
  `"a refused Keep as tip says why and reads the bill again"` (`bill.not_overpaid`);
  `"Give back opens the Refund window on the excess"` (one refundable payment → the refund dialog's
  `suggested` is "5.00").
- [ ] **Step 4: Run** `pnpm --filter @waitron/till exec vitest run src/screens/bill-money-notice.test.ts
  src/screens/till-table-order-screen.bill-payments.test.ts src/till-app-pay-for-items.test.ts`.
  Expected: FAIL, module `./bill-money-notice.js` not found.
- [ ] **Step 5: Implement.** The notice reads `balance` only when it is the bill on screen's
  (`#balanceShown`, `till-table-order-screen.ts:5385-5388`).
- [ ] **Step 6: Run** the Step 4 command plus `src/screens/till-table-order-screen.bill-payments.a11y.test.ts
  src/screens/till-table-order-screen.bill-switcher.test.ts src/screens/till-table-order-screen.test.ts`,
  `pnpm --filter @waitron/till typecheck`, and from the root `pnpm exec vitest run
  scripts/no-hardcoded-chrome-views.test.ts scripts/primary-coloured-text.test.ts
  scripts/style-token-names.test.ts scripts/product-file-size.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `git commit -s -m "Show on the table's bill when it is being paid on another bill, or paid more than it comes to"`.

### Task 4 (PR 2): Giving back money just taken asks for no PIN

**Files:**
- Modify: `apps/till/src/till-app.ts` (+~8, to ~26,170): `#onRefundContinue` (`:24005-24017`) sends
  a hand-keyed give-back of no more than the Pay window's `balance.overpaid` without asking first;
  `#sendRefund`'s catch (`:24090-24100`) also asks approvers on `bill.manual_refund_pin_required`;
  `#renderBillRefunding` (`:13512-13527`) passes `.pinFreeUpTo`
- Modify: `apps/till/src/widgets/bill-refund-dialog.ts` (+~12): property `pinFreeUpTo: string | null`;
  for an amount up to it, `bill_refund.approval_next` (`:431`) is left out and the terminal step uses
  `bill_refund.terminal_next_no_pin` / `bill_refund.terminal_no_pin`
- Modify: `apps/till/src/i18n/strings.ts` (the two new keys, English and Spanish, the PIN sentence
  dropped from today's wording)
- Test: extend `apps/till/src/widgets/bill-refund-dialog.test.ts` and
  `apps/till/src/till-app-pay-for-items.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a hand-keyed give-back within the excess is recorded with no PIN"`: overpaid €5.00, payment
    entered `manual`, give back €5.00, confirm the terminal step → one `refundBillPayment` call with
    `manualConfirmed: true` and no `override`; no `till-supervisor-override-dialog`.
  - `"a hand-keyed give-back the server still wants approved asks a PIN"`: first call rejects
    `bill.manual_refund_pin_required` → approvers read, PIN prompt, second call carries `override`
    under the same submission id.
  - `"any other hand-keyed refund asks the PIN first, as today"`: overpaid €0.00 → no call before
    the PIN (the existing check at `till-app-bill-payments.test.ts:8035` passes unedited).
  - In `bill-refund-dialog.test.ts`: `"says no PIN is needed for an amount up to pinFreeUpTo"` and
    `"says a manager approves an amount above it"`, both languages.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/bill-refund-dialog.test.ts
  src/till-app-pay-for-items.test.ts`. Expected: FAIL on the first case (a PIN prompt opens).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/till-app-bill-payments.test.ts
  src/widgets/bill-refund-dialog.a11y.test.ts src/i18n/refund-wording.test.ts` and
  `pnpm --filter @waitron/till typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Give back what a bill was paid over its total with no manager's PIN"`.

### Task 5 (PR 2): Look at it, then say it in the guides

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`
  (`{#pay-window}`, en `:944-1000`, es from `:1010`; `{#refund-payment}`, en `:255-270`)
- Modify: `docs/backlog/menu.md` (A1515's piece 1 line, `:872`)

- [ ] **Step 1: Look.** Start a stack on a Claude slot: `wa-wt demo waitron-feat-a1515-1-pay-items-till`
  (`wa-wt ls` gives its till address; never slot 0, never the owner's stack). On a seated demo table
  with three dishes, at till width and at phone width (390 px), in light and dark: Pay > Items >
  one dish > Cash; the confirmation's price and "own bill" line; the receipt window; the table's
  bill after it and the switcher. Then a reader card with the simulator's **declined** outcome
  (the table's bill unchanged). Then make a bill overpaid (a contribution of €20 on a €25 bill,
  then Pay for items of €10) and look at the sentence, **Give back**, **Keep as tip** and the
  switcher row. Fix what reads or lays out badly in the task that drew it. Screenshots stay in the
  working folder and are shown to the owner directly; none is committed. `wa-wt down
  waitron-feat-a1515-1-pay-items-till` afterwards.
- [ ] **Step 2: Write the guides from what Step 1 showed**, English then the Spanish twin, same
  `{#id}`s: in `{#pay-window}`, replace "For items, choose the dishes and adjust the quantity…" with
  what staff now do: the chosen dishes go to a bill of their own, paid at once, with its own
  receipt; choosing every dish pays the whole bill; a declined card or **Cancel payment** puts them
  back; **Being paid on Bill N** while a card for them is out; on a printed bill, items are still
  paid on that bill, as before. Add a short paragraph: a bill paid more than it comes to says so;
  **Give back** returns it (no manager's PIN for that amount) and **Keep as tip** keeps it, after
  which the bill's receipt prints. Cut, do not reword, any sentence Step 1 proved wrong. The
  paid-mark sentences (en `:263-264`, `:749`, `:763-767`) stay for PR 3, which removes the marks they
  describe.
- [ ] **Step 3: Update the backlog**: A1515's piece 1 line says the till now pays for items on a
  bill of their own (pull request 2 of 4), and pull requests 4 (printed bills) then 3 (removing the
  old items payment) follow.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
  src/guide-box-word.test.ts` and from the root `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/english-only.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Say in the table service guide what Pay for items now does"`,
  then `/finish-branch` with the full wave; the owner lands it.

**For the watcher (not blocking PR 2's build):** (1) the items route still takes no receipt guest
count, so the new bill's receipt is never asked one (PR2-D5); (2) Keep as tip, and a refund that
issues the bill, answer no invoice, so the till shows no receipt window for it; the till asks for
the bill's receipt itself when the answer says the bill is settled (a connected-card give-back that
completes later is not asked one); (3) a set-menu dish with a supplement, which today's items payment takes alone,
now needs its set menu chosen too (PR2-D12's words).

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
  reopened bill, in one transaction; the till's Items on a printed bill moves from the old items
  payment (kept by PR 2, PR2-D13) to the new route.

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

_2026-11-24, for the piece that runs the bill's set-menu grouping on the server: PR 1's put-back moves lines with `moveOrderLines` in `movedItemsBack` (`bill-payments.ts`), not through `moveDishes`; Pay for items splits part of a line with `splitLinesWithinOrder` (`pay-for-items.ts`); the preview prices picks in `priceItemPicks` (`pay-for-items.ts`). Each must regroup or price with the grouping too._
