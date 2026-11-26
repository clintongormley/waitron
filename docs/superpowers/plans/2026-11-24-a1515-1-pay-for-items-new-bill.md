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
(2026-11-24: main later lowered `till-app.ts`'s cap to 26,000; this branch put it back to 26,250
with the watcher's leave, "WATCHER 2026-11-24 20:01" in lane C's `questions.md`.)

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
  (`apps/till/src/i18n/codes.ts`, `bill.all_items_chosen`). _2026-11-25: since A1515-3 PR 2c such a
  dish can be paid for alone, unless it leaves only with its set menu (`refuseMovingFrozenDishes`)._
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
  choose **Refund** beside one. Added 2026-11-25: the Counter shows the same overpaid notice in place
  of Pay, its amount read from the order's bill balance, and a give-back or Keep as tip that settles
  a Counter order asks for its receipt and starts a new sale.
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
  Added 2026-11-25: when Finish table is refused for an overpaid bill, the refusal names that bill
  and its excess with **Go to Bill N** (no button for the bill on screen) instead of Take payment.
- **PR2-D12. Refusals speak to the Pay window.** `refusalOf` (`state/bill-payment.ts:282-326`) and
  `PayRefusal` (`widgets/pay-refusal.ts:9-39`) carry `advances` and `dishName`, and `refusalText`
  passes the refusal to `codeMessage` as params (`pay-refusal.ts:99` passes none today), so
  `bill.below_advances` names its amount. `set_menu.no_place_on_target` (`codes.ts:36-38`) speaks of
  "the other bill", Move dishes' words; answering an items payment, the till shows its own instead:
  "{dishName} is part of a set menu. Choose its set menu too, or leave it on this bill." / "{dishName}
  forma parte de un menú. Elige también su menú o deja el plato en esta cuenta." The preview refuses
  it already (`readPicks`, `pay-for-items.ts:160-161`), so it shows on the form, before any money. _2026-11-25: since A1515-3 PR 2c only a dish
  with a comp, a discount, a payment by item or a kept-charge cancel of its own or on an extra is
  refused alone, in words for why._
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
  which the till asks for the bill's receipt. Cut, do not reword, any sentence Step 1 proved wrong.
  The paid-mark sentences (en `:263-264`, `:749`, `:763-767`) stay for PR 3, which removes the marks
  they describe.
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

_2026-11-25: the owner renamed Reopen to split to **Reopen bill** / **Reabrir cuenta**; the old name below is as written then._

Branch `feat/a1515-1-printed-bills`, on top of PR 2 (#4280) until that lands, then rebased onto
`main`. Every line count and `file:line` below was read on PR 2's tip (`78ec159ea0`). Tasks 1–6
change the server and the packages under it (Task 4 in two parts, 4a and 4b); Tasks 6–8 change the
till; Task 9 is the guides.

**What a person can do when it lands:**
- **Reopen to split** on a printed bill asks nobody for a PIN.
- It also works when part of the printed bill is already paid. The receipt is credited in full as
  today, the dishes go onto a new open bill, and the money already paid moves with them and counts
  towards that bill. If the guests then pay for items on their own bills and the table's bill is
  left paid more than it comes to, the till offers **Give back** and **Keep as tip**, as PR 2 built.
- **Pay > Items** on a printed bill does the same in one go: it reopens the bill, moves the chosen
  dishes to a bill of their own and takes the payment there, with its own receipt. A declined card
  puts the dishes back on the reopened bill, which can be printed again or paid as any open bill.
- After a Pay for items payment the till no longer reads the table's bill again on its own: the
  server's answer carries it.

**What stays as it is in PR 4:**
- **Cancel and credit** keeps its approver's PIN (`cancelPlacedOrder`,
  `apps/server/src/working-order-counter.ts:168-197`, `withRectifyPinAhead` at `:202-220`), and
  still refuses a bill holding money (`refusePlacedOrderMoney`, `:242-248`).
- The other refusals of Reopen to split: a counter order (`bill.not_at_table`), a bill whose guests
  left unpaid, a bill with no ticket, a full invoice naming a customer, and dishes printed with
  Print anyway and not yet served, which already offers **Mark served**
  (`apps/server/src/split-after-print.ts:83-109`).
- A printed bill holding an advance (a part payment that has its own receipt) stays refused (owner,
  "ok", 2026-11-24 10:4x); PR 1's D4 is the same rule for open bills. _2026-11-26: replaced by the
  owner on 2026-11-25; such a bill can be reopened
  ([REOPEN-WITH-ADVANCE](2026-11-25-reopen-with-advance.md))._
- The old items payment (`kind: "items"`) and its server route: PR 3 removes them. After PR 4 the
  till sends it nowhere.
- No new route. The two Pay for items routes and the Reopen to split route keep their paths and
  permissions, so `till-api.profile-zones.test.ts` and `till-api.session-person.test.ts` need no new
  rows. The Pay for items routes gain one profile check on a printed bill (PR4-D7, *Who may*), so
  `till-api.profile-actions.test.ts` gains its refusing cases (Task 5).

**File-size room** (caps in `scripts/product-file-size-limits.json`, counts on `78ec159ea0`):
`apps/server/src/bill-payments.ts` 2,988 of 3,000 and `apps/till/src/api/client.ts` 5,745 of 5,750
take no net growth; `apps/till/src/till-app.ts` is 26,169 of 26,250, so Tasks 6–8 together add at
most ~60 lines there and put the rest in `apps/till/src/state/`; `packages/payments/src/store.ts`
1,113 of 1,250 takes none (the new writer gets its own file). Every other product file 1,000. No cap
is raised.

**Decisions:**

- **PR4-D1. A credit made by Reopen to split needs no `sale.rectify` — the exact form, for the
  watcher to clear before Task 2 starts.**
  - *What the check is today.* `recordCorrection` (`packages/core/src/record-correction.ts:166-182`)
    accepts three kinds of authority, and every one needs a person holding `sale.rectify`: a till
    session (`authorize`, `packages/identity/src/authorize.ts:41-58`: the signed-in person holds it,
    or an approver's PIN does), a dashboard session (`authorizeManager`, permission `sale.rectify`),
    or an open invoice correction whose recorded approver holds it (`authorizeCorrectionApproval`,
    `packages/core/src/correction-approval.ts:38`). The one it accepts is written on the credit note
    as `sales.authorized_by` (`record-correction.ts:312`), fixed at insert because `sales` is
    append-only. So no way of filing the credit without a holder of `sale.rectify` leaves
    `recordCorrection` unchanged; I looked for one and found none.
  - *The form (recommended).* A fourth kind, `{ reopenedBillId: string; sessionId: string }`,
    tested for first (`"reopenedBillId" in`). The order matters against the last branch, not the
    `managementSessionId` one: the last branch takes anything the two tests before it did not
    (`record-correction.ts:166-182`) and sends it to `authorize` with `permission: "sale.rectify"`
    (`:177-181`). So this kind, carrying `sessionId`, would land there if tested later, and be
    refused for want of `sale.rectify`. A wrong order refuses; it never lets a credit through.
    `recordCorrection` accepts it only when all of these hold, else refuses a new core code
    `sale.correction_reopen_invalid` `{ saleId, reopenedBillId, reason }`, before a number is
    allocated:
    1. `wholeInvoice` is true (`reason: "not_whole"`): it can never free a partial correction.
    2. The working order `reopenedBillId` exists, is `open`, and its new column `reopened_from`
       (Task 1) names the bill whose ticket is being credited, read as `sales.working_order_id`
       of `input.correctsSaleId` (`reason: "no_reopened_bill"`). Task 1's trigger adds what the
       check cannot see itself: that link was set once, while the credited bill was still `placed`,
       on a bill that was open, and has not changed since. That is all it shows. It does not show
       which dishes the open bill holds; Reopen to split puts the copies there in the same
       transaction. Cancel and credit opens no such bill, so it cannot use the kind, whatever its
       caller passes.
    3. The till session is open (`session.not_open`, as `authorize` refuses it). Its person is
       recorded as `authorized_by`. Identity gains `signedInPerson(tx, sessionId)`, the session read
       `authorize` already does at `:46-51`, and `authorize` calls it.
    For check 2 and the trigger to hold, `splitAfterPrint` opens the new bill, sets its
    `reopened_from` while the printed bill is still `placed`, and copies the dishes onto it, all
    before it credits the ticket and then abandons the printed bill, in its one transaction (today
    it credits, abandons and only then opens the new bill, `split-after-print.ts:65-67`).
    `createOpenOrder` takes no such option (`apps/server/src/working-order-open.ts:113-133`), so
    the link is set by an update right after it.
  - *A smaller form, if the watcher prefers it.* The same kind without check 2: core checks only
    `wholeInvoice` and the session. It is a few lines shorter and keeps core from reading
    `working_orders`, but then nothing in the database stops any other caller from passing the kind
    and filing a whole credit with no permission.
  - *Risks of the recommended form.* (i) Any code that links an open bill to a printed one and
    then credits the printed bill's ticket frees the credit from the PIN. Task 1's trigger narrows
    this: the link can be made only once, from none, on an open bill, to a bill that is `placed` at
    that moment, and never changed or cleared after. It does not stop new code from making such a
    link to a printed bill and crediting it. Only `split-after-print.ts` writes the column; a
    reviewer must check every new writer, and no guard does. (ii) Core starts reading
    `working_orders` (a table in `@waitron/db`, which core already writes through
    `sales.working_order_id`). (iii) Once the dishes are on the open bill, taking one off follows an
    open bill's rules, not `sale.rectify`. `copyBillDishes` copies each row whole (`...row`,
    `split-after-print.ts:166`), so a copy keeps its original's `served_quantity`. The cancel
    context counts a dish whose served quantity is above zero as started
    (`apps/server/src/line-cancel-context.ts:117`), and the cancel route then sends removing a
    started dish's charge through the adjustment's approver check (`approverToCheck`,
    `apps/server/src/line-cancel-api.ts:251-278`; `adjustments-api.ts:119-133` asks for the
    approver only where the adjustment's plan needs approval), as for any served dish on an open
    bill. I read this; I did not run it.
    (iv) The golden huella and `inmutabilidad` are untouched: the kind changes who is recorded as
    authorising, never what is filed.
- **PR4-D2. The money moves to the reopened bill (way a); reopening the same bill (way b) cannot
  work.** `sales` allows one sale per working order: `unique("sales_working_order_id_key")`
  (`packages/db/src/schema/sales.ts:168`, shipped as `CREATE UNIQUE INDEX` in
  `packages/db/drizzle/0000_baseline.sql:1534`), which the comment at `:126-128` calls the
  sale-idempotency key. The printed bill already owns its ticket's sale, so a reopened printed bill
  could never file the ticket for what is left on it. The credited ticket must also still reprint
  its dishes, which is why Reopen to split copies them (`copyBillDishes`,
  `split-after-print.ts:140-143`: "Kitchen state, print links and sale links stay with the
  originals"). Way (a) keeps both: the printed bill, its ticket and its credit note stay exactly as
  Reopen to split leaves them today, and only the money moves.
- **PR4-D3. What moves, and the link that allows it.** In the split's transaction, after the
  printed bill is `abandoned` and the reopened bill is open, every `received` payment of the printed
  bill moves to the reopened bill: its `bill_payments` row, and the card provider row (`payments`)
  that names it. `failed` and `declined` payments hold no money and stay, as the printed bill's
  history. Refunds, drawer entries and slips name the payment's id, not its bill, so they follow.
  Instead of the outline's `bill_payments.carried_from`, the new column is
  `working_orders.reopened_from` on the reopened bill (foreign key to `working_orders.id`,
  `restrict`, with an index, as PR 1's `items_paid_from`, `packages/db/src/schema/orders.ts:121,159-163`).
  One column then serves three needs: the trigger checks that a payment moves only from a bill to
  the bill reopened from it; PR4-D1's check 2; and Pay for items' replay lookup on a printed bill
  (PR4-D7). Where a carried payment was first taken is its bill's `reopened_from`. The triggers
  (Task 1):
  - A new trigger on `working_orders` fixes the link itself. An insert must leave `reopened_from`
    null. An update may change it only from null, only on a bill that is `open` before and after
    the update, and only to a bill that is `placed` at that moment; once set it never changes or
    clears. This is needed because `working_orders_enforce_transition` lets an `open` bill change
    any column (`old.status = 'open'`, `packages/db/triggers/core.sql:715`). Since the trigger
    refuses any change to a bill that is not open, the transition trigger's branches need not list
    the column.
  - `bill_payments_guard_update` (`packages/db/triggers/core.sql:45-91`) also allows
    `working_order_id` to change when the old bill is `abandoned`, the new bill is `open` with
    `reopened_from` equal to the old bill, the payment is `received` and not `items` (PR4-D12), no
    tender names it, it paid no advance (`bill_advances`), and no refund of it is pending. Every
    other column stays as it was.
  - `payments_guard_update` (`packages/payments/triggers/payments.sql:9`, which today fixes
    `working_order_id`) allows it to change to the bill its `bill_payment_id` now names, when the
    old bill is `abandoned`. In the same update `sale_id` may go back to null (PR4-D4), only from
    the sale of the old bill (`sales.working_order_id`); today it is fixed once set (`:20`). The
    `bill_payments` row is moved first, so the subquery sees it.
- **PR4-D4. Both rows move, and a card already linked to the printed ticket is unlinked.** Two
  things I read, not ran, make moving only `bill_payments` wrong:
  1. Printing a part-paid bill links its card payments to the printed ticket's sale
     (`issueUnpaidInvoice` → `linkBillCardPaymentsToSale`, `apps/server/src/working-order-invoice.ts:366`).
     When the reopened bill later files its ticket, `linkCardBillPayments`
     (`apps/server/src/bill-payments.ts:841-864`) calls `associatePaymentWithSale`, which refuses
     `payment.already_associated` for a row whose `sale_id` is set
     (`packages/payments/src/store.ts:309-336`). The reopened bill could never be paid off.
  2. A card paid after printing keeps `sale_id` null until the bill settles. Left on the abandoned
     bill, the reconcile sweep counts a captured card with no sale on a bill that is neither open
     nor placed as an orphan (`packages/payments/src/reconcile.ts:221-227`), and one on an
     `abandoned` bill goes on to be claimed for reversal at the provider (`:411`, then
     `markReconcileRemediated`, `store.ts:1087-1097`, which, unlike `claimAbandonedCapture`
     (`:1050`), does not leave out bill payments). That would hand the guest's money back while it
     still counts on the table's bill.
  Clearing `sale_id` at the move, rather than repointing it when the new ticket is filed, leaves
  each moved provider row in exactly the state of a card part payment on an open bill today
  (bill = the open bill, `sale_id` null, `bill_payment_id` set), so filing (`linkCardBillPayments`)
  and every reader that already handles that state handle it unchanged. Task 4b's tests check both
  points by running them, with a control: the reconcile listing (`listReconcilable`,
  `store.ts:747-773`) shows the moved card on an `open` bill, and the same test with the provider
  row left behind shows it on an `abandoned` one.
- **PR4-D5. What a part-paid printed bill still refuses.** _2026-11-26: the advance refusal below
  and `bill.has_advance` are gone; [REOPEN-WITH-ADVANCE](2026-11-25-reopen-with-advance.md) lets
  such a bill be reopened, at the owner's request of 2026-11-25._ `refusePlacedOrderMoney` keeps its
  callers but Reopen to split stops calling it; a new `refuseSplitMoney` (in a new file,
  `apps/server/src/split-after-print-money.ts`) refuses, in this order and after the bill's own
  refusals (as today, `split-after-print.ts:61-63`):
  - a pending card payment, or a card charged but not yet recorded: `order.payment_in_flight`, as
    today (`refusePendingPartPayment` and `ordersWithUnfiledPayment`);
  - a card refund still pending: `bill.refund_in_progress` (`refuseRefundInProgress`,
    `apps/server/src/working-order-edit-state.ts:207-222`): until it ends, the money the bill holds
    is unknown;
  - an advance: new code **`bill.has_advance`** (409, `{ workingOrderId }`). English: "Part of this
    bill was paid with its own receipt, so it cannot be reopened to split. Take the rest of the
    payment on this bill by amount or in equal shares." Spanish: "Parte de esta cuenta se pagó con
    su propio ticket, así que no se puede reabrir para dividirla. Cobra el resto en esta cuenta por
    importe o a partes iguales." The advance's money is on its own ticket and the printed ticket
    takes it off (`split-after-print.test.ts:423-474`: a 30.00 advance and an 18.00 ticket), and
    `bill_advances` is append-only (`packages/migrations/migrations.manifest.json:19`), so the
    advance cannot follow the money;
  - a received items payment (`kind = 'items'`, the old way PR 2 keeps for printed bills):
    `bill.payments_received`, as today. PR4-D12 keeps it off the move, so without this refusal the
    move would end in the trigger's raw refusal instead of a worded answer.
  Then the dishes' refusal and the split as today. `bill.payments_received` stays an answer of
  Reopen to split for that one case only; PR 3, which deletes the kind, deletes the refusal.
- **PR4-D6. Every reader of the two `working_order_id` columns, traced** (`rg` for
  `billPayments.workingOrderId`, `bp.working_order_id`, `payments.workingOrderId` and
  `p.working_order_id` outside tests, on `78ec159ea0`). After the move each sees the payment on the
  reopened bill, where its money now counts:
  - *Bill money and filing:* `readPaymentRows`/`readHeld`, `holdsPayment`, `givenBackAfterSettling`,
    `itemsBeingPaidOn`, `findSubmission`, `linkCardBillPayments` (`bill-payments.ts:374`, `:534`,
    `:730`, `:958`, `:1060`, `:1731-1741`, `:2452`), `bill-overpaid.ts:132`, `pay-for-items.ts:329`,
    `set-menu-bill.ts:322` (the old items kind's pin, PR 3), `working-order-invoice.ts:160`,
    `working-order-edit-state.ts:213-255`, `packages/db/src/order-dining.ts:45`, `till-sale.ts:140`
    (`readTenderBlock`: a hand-keyed card's operation number on the receipt, found by sale and bill,
    which is one more reason the provider row moves) and `till-sale.ts:386`
    (`ordersWithUnfiledPayment`).
  - *Refunds:* `bill-refunds.ts:139`, `:196` (a refund names the payment and its bill: the till
    sends the reopened bill's id, as it lists that bill's payments), `tender-refund-sends.ts:200`,
    `:336` (a completed card refund issues the payment's bill), `tender-refund-receipt.ts:46-48`
    (the refund receipt's language, which the reopened bill copies), `bill-refund-alerts.ts:85`.
  - *Receipts and slips:* `receipt-payments.ts:131` (an issued, unpaid ticket's reprint lists the
    bill's payments: the credited ticket then reprints without them, and the reopened bill's ticket
    lists them), `payment-slip-print.ts:332`.
  - *Card recovery and reconcile:* `payments-api.ts:1531`, `:1634`, `:1711-1726`, `:1914`,
    `:1966-1982` (pending payments and their recovery; a carried payment is received), and in
    `packages/payments`: `store.ts:397` (`selectCapturedForWorkingOrder`), `:571`, `:631`,
    `:766-773` (`listReconcilable`, PR4-D4), `:817`, `:853`, `:872`, `:1053-1067`
    (`claimAbandonedCapture`, bill payments left out), `holds.ts:82`, `resolutions.ts:41`,
    `personal-data.ts:17`, and `packages/payments-stripe/src/provider.ts:485` (attempts only).
  - *Reports and lists:* `packages/reporting/src/cash-up.ts:98-108` (by the payment's own time and
    device and the bill's node, which the reopened bill shares), `find-bill-bills.ts:66`, `:93`,
    `find-bill-transactions.ts:90`, `orders-list.ts:345`, `:1118`, `outside-payments-report.ts:37-44`
    (lists a carried hand-keyed card under the reopened bill's order number),
    `paired-reader-audit.ts:91`.
  - *Devices, handover and personal data:* `device-delete.ts:59-70`, `old-box-data-since.ts:283-380`,
    `personal-data-actions.ts:78`, `packages/fiscal-verifactu/src/handover-return.ts:130`, `:145`,
    `packages/venue-service/src/department-transfers.ts:367`, `:375` (pending only).
  A moved payment's `received_at` comes before its bill's `opened_at`. I found no reader comparing
  the two (`rg` for `openedAt`/`opened_at` on a line with `received` or `payment`: none); that is a
  text search, not a proof.
- **PR4-D7. Pay for items on a printed bill.** The two Pay for items routes accept a `placed` bill.
  - *The payment*, in one transaction (a reader card's begin step included):
    1. check the request's party revision and the printed bill's edit state against what the till
       read (`guardPathParty`, `apps/server/src/bill-actions.ts:94-110`, without bumping, and
       `requireBillEditors`, `apps/server/src/bill-editing.ts:116-127`, with the request's
       `expectedEdits`, which name the printed bill);
    2. reopen it (`reopenToSplitIn`, Task 3's in-transaction body of `splitAfterPrint`, money
       included), which answers the reopened bill's id and each printed line's copy
       (`copyBillDishes` builds that map, `split-after-print.ts:154`, and starts returning it);
    3. translate each pick's `lineId` to its copy, then `moveItemsToNewBill` from the reopened bill
       (`apps/server/src/pay-for-items.ts:229-276`) with the party's revision as the reopen left it
       and the reopened bill's edit state, both read by the server, as D9 does for the new bill;
    4. take the payment on the items' bill, as today.
    A refusal anywhere rolls the whole of it back, so the printed bill stays printed and nothing is
    credited.
  - *The same request twice.* `earlierItemsBill` (`pay-for-items.ts:321-334`) also looks among the
    bills paid for from a bill whose `reopened_from` is the printed bill, so a resend to the printed
    bill's id answers the first payment and reopens nothing.
  - *The preview* (`previewPayForItems`, `pay-for-items.ts:463-524`, which today refuses a placed
    bill through `refuseClosedBill`) prices the printed bill's own lines, which the copies repeat,
    and first runs Reopen to split's refusals that write nothing (`refuseReopen`: the bill's, the
    money's and the dishes'), so staff learn of a refusal before any money is taken.
  - *Who may (for the watcher to confirm).* What Pay for items needs (`payment.take` and its
    profile checks, D9), and, on a printed bill only, the device profile's `take-orders` action,
    which Reopen to split's route requires (`requireSession(deps, c, { action: "take-orders" })`,
    `apps/server/src/till-api.ts:2849-2851`). The printed-bill path of both routes checks it first,
    before the reopen or `refuseReopen`, with `assertProfileAction(device, "take-orders")`
    (`apps/server/src/device-session.ts:328-336`), so it is refused as the split route refuses it:
    `device.forbidden_action` `{ action: "take-orders" }`. Today the payment route requires
    `payment.take` and the preview route only a session
    (`apps/server/src/bill-payments-api.ts:483-497`); Pay for items on an open bill, and paying a
    printed bill by amount (`till-api.profile-actions.test.ts:1134`), keep needing no `take-orders`.
  - *Every dish chosen.* The till pays the whole printed bill as today (PR2-D3), so no reopen
    happens; the server's `bill.all_items_chosen` stays the backstop.
  - *The answer* names the items' bill (`billId`) and carries the table's bill as the payment left
    it (PR4-D10), here the reopened bill, which is how the till learns its id.
- **PR4-D8. A card declined after the reopen.** The reopen cannot be undone: the credit note is
  filed. The put-back (D2) moves the items to the reopened bill, which is open, so the table is
  left with one open bill holding every dish at the printed ticket's total, with the money already
  paid on it, to be printed again or paid as any open bill. The till moves to it (Task 8).
- **PR4-D9. Give back on a reopened bill.** A carried payment is a payment of the reopened bill like
  any other, so PR 2's rule applies unchanged (`refundPermission`,
  `apps/server/src/bill-overpaid.ts:42-55`): giving back no more than what the bill is paid over
  its total needs `payment.take`, no approver's PIN; more needs `sale.refund`. The excess exists
  only because Pay for items took dishes off a bill that money had already paid for, so it is the
  same money paid twice, the case the owner freed from the PIN.
- **PR4-D10. The Pay for items answer carries the table's bill** (from #4280's "Discussed and not
  done": "would save one of four reads after each such payment"). `payForItems` answers
  `{ billId, payment, sourceBalance }`: `sourceBalance` is the bill the items came from (the
  reopened bill on a printed one), read after the payment, after the put-back for a reader card that
  charged nothing, and on a replay. On a replay it is read from the items bill's `items_paid_from`,
  never from the request's bill id: on a printed bill that id names the abandoned printed bill,
  while the items came from the reopened one (`earlierItemsBill` answers the items bill,
  `pay-for-items.ts:322-336`). Today, in `#onBillPaid` (`apps/till/src/till-app.ts:23663-23756`),
  a Pay for items answer leaves `own` undefined (`:23673`), so every branch that opens no receipt
  window (a card not charged, a card still pending, any Pay for items at the Counter) calls
  `#rereadAfterPaid(open)` (`:23760-23765`), whose `#rereadBillPaying` reads `getBillBalance`
  before reading the order (`:23079-23096`). With `sourceBalance` the till skips that read and
  shows the answer's balance. The receipt window's close (`#onBackToTable`, `:24376-24397`) keeps
  its own reads: the window can stay open for minutes, and `#loadBillBalance` already skips the
  balance read for a bill holding no payment (`:15300`).
- **PR4-D11. The till's Reopen to split.** It is offered on a printed bill with payments too (today
  only on one with none, `apps/till/src/screens/till-table-order-screen.ts:7086-7090`); Cancel and
  credit keeps `!bill.hasPayments`. The split is sent with no override, and a refusal never opens
  the approver's PIN prompt for it (`#onCancelCreditRefused`, `till-app.ts:21853`, for mode
  `"cancel"` only); `splitAfterPrint` in the till's client drops its `override` argument
  (`apps/till/src/api/client.ts:4297`). On a bill with money paid, the dialog's scope line adds
  "{paid} already paid counts towards the new bill." / "Lo ya pagado ({paid}) cuenta para la cuenta
  nueva." (`split.scope_paid`), the amount read as the bill row's `total` less `outstanding`. The
  dialog shows `bill.has_advance`'s words (an unmapped code falls back to `codeMessage`,
  `apps/till/src/widgets/cancel-credit-dialog.ts:189-195`). `split.refused_payments`
  (`apps/till/src/i18n/strings.ts:2150`, Spanish `:4486`) and its map entry (`:61`) stay, for the
  one case PR4-D5 still refuses that way, and its words change to: "Part of this bill was paid for
  by item, so it cannot be reopened to split. Take the rest of the payment on this bill by amount
  or in equal shares." / "Parte de esta cuenta se pagó por artículos, así que no se puede reabrir
  para dividirla. Cobra el resto en esta cuenta por importe o a partes iguales." PR 3 deletes them
  with the kind.
- **PR4-D12. An items payment is never carried.** The `bill_payments` trigger's exception leaves out
  `kind = 'items'`, as the tip exception does (`core.sql:61`). After PR 4 the till sends that kind
  nowhere, but a printed bill may already hold one, taken before PR 4 through the route PR 2 kept;
  `refuseSplitMoney` refuses such a bill first (PR4-D5, tested in Task 4a). PR 3 deletes the kind,
  the clause and that refusal.
- **PR4-D13. The kitchen hears nothing new.** Reopen to split tells no station today (it refuses
  unserved dishes first), and Pay for items' move sends no MOVED slip (D8).

**Changed test checks** (behaviour PR 4 changes on purpose; each named in the PR description):
in `apps/server/src/split-after-print.test.ts`, "needs sale.rectify, and names unserved dishes
first" (`:382`) becomes "needs no sale.rectify…" (a session without it splits); "refuses a
part-paid bill before its unserved dishes" (`:397`) is replaced by Task 4a's tests (a part-paid bill
splits); "refuses a bill holding an advance…" (`:423`) expects `bill.has_advance`, its other checks
unchanged; "refuses an operator without sale.rectify before looking for a corrective series"
(`:568`) becomes "refuses on a box with no corrective series, copying nothing", expecting
`series.no_corrective_for_node` (409, `apps/server/src/till-api.ts:530`). That is the refusal
`creditWholeInvoice` raises when it reads the live series (`readLiveSeriesIdTx`,
`apps/server/src/cancel-credit.ts:55`, throwing `NO_LIVE_SERIES["corrective"]`,
`packages/db/src/reserved-identity.ts:71`, `:102`), before `recordCorrection` and its
`requireCorrectiveSeries` run. In `apps/till/src/till-app-parties-closing.test.ts`,
"without the permission, asks for an approver's PIN and sends it with the split" (`:786`) is
deleted. In `apps/till/src/till-app-pay-for-items.test.ts`, "a printed bill's items still go to
today's route" (PR 2's Task 2a) is rewritten for the new route. The implementer greps
`splitAfterPrint(` across `apps/till/src/**/*.test.ts` and lists any other check it changes; every
Cancel and credit check passes unedited.

### Task 1 (PR 4): Storage for the reopened bill's link, and the triggers that let money move to it

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`reopenedFrom` on `workingOrders`, its foreign key
  and index, beside `itemsPaidFrom` at `:121`, `:159-163`)
- Modify: `packages/db/triggers/core.sql`: `bill_payments_guard_update` (PR4-D3), and new triggers
  `working_orders_reopened_from_insert` and `working_orders_reopened_from_update` (PR4-D3's first
  bullet). `working_orders_enforce_transition` is not changed: the new update trigger refuses any
  change of the column on a bill that is not open, before and after.
- Modify: `packages/db/src/trigger-refusals.ts` (`REOPENED_FROM_REFUSAL`, the new triggers' words,
  as each behavioural trigger's are, asserted by `scripts/behavioural-triggers.test.ts`, per the
  file's header at `:9-11`)
- Modify: `packages/payments/triggers/payments.sql` (`payments_guard_update`, PR4-D3)
- Regenerated: `packages/db/drizzle/0000_baseline.sql` and its snapshot
  (`pnpm --filter @waitron/server migration-baseline rebuild --set core`), and the payments set's
  (`… rebuild --set payments`)
- Modify: `scripts/schema-constraints.test.ts` (`["working_orders", ["reopened_from"], "working_orders"]`,
  beside `:297`)
- Test: `packages/db/src/schema/bill-payments.test.ts`, create
  `packages/db/src/schema/orders.reopened-from.test.ts`, `packages/payments/src/schema/payments-guard.test.ts`

- [ ] **Step 1: Write the failing tests.** In `bill-payments.test.ts`, each starting from a
  `placed` bill A with a received cash payment, A then set `abandoned`, and an open bill B:
  - `"a received payment moves from an abandoned bill to the bill reopened from it"`: B's
    `reopened_from` is A; updating the payment's `working_order_id` to B is accepted.
  - `"…not to a bill reopened from another"`: B's `reopened_from` is null → refused
    (`bill payment cannot make that change`).
  - `"…not from a bill that is still placed"`, `"…not a pending payment"`, `"…not one a tender names"`,
    `"…not one that paid an advance"`, `"…not one with a refund pending"`, `"…not an items payment"`.
  - `"the move changes nothing else"`: the same update also changing `applied` is refused.
  In `orders.reopened-from.test.ts`, with a `placed` bill A and an open bill B (each refusal is
  `REOPENED_FROM_REFUSAL` unless named):
  - `"an open bill is linked once to a placed bill"`: setting B's `reopened_from` to A is accepted;
    then A goes `abandoned` and B keeps the link (the order Reopen to split uses).
  - `"…not to a bill that is not placed"`: to an open bill, to an `abandoned` one, to a `settled`
    one, and to B itself: each refused.
  - `"…not on a bill that is not open"`: B `placed`, or B moved to `placed` in the same update:
    refused.
  - `"…not changed or cleared once set"`: after the accepted link, setting it to another placed bill
    is refused, and setting it to null is refused.
  - `"…not at insert"`: inserting an open bill with `reopened_from` set to A is refused.
  - `"…and only to a bill that exists"`: an unknown id is refused by the foreign key.
  - Control, so the refusals are not the trigger refusing everything: an update of B that changes
    another column and leaves `reopened_from` alone is accepted, linked or not.
  In `payments-guard.test.ts`: `"a card's row follows its bill payment off an abandoned bill"`
  (accepted); `"…not to any other bill"` (refused); `"its sale goes back to none only from the old
  bill's own sale, in the same move"` (accepted), and `"…not from another sale"` and `"…not without
  the move"` (refused).
- [ ] **Step 2: Add the column only, then run.** Add `reopenedFrom`, its foreign key and index to
  `orders.ts` and rebuild the core baseline, triggers untouched, so no test fails with
  `no such column`. Run `pnpm --filter @waitron/db exec vitest run src/schema/bill-payments.test.ts
  src/schema/orders.reopened-from.test.ts` and `pnpm --filter @waitron/payments exec vitest run
  src/schema/payments-guard.test.ts`. Expected: FAIL for the trigger reason. The move cases are
  refused (`bill payment cannot make that change`, `a payment cannot make that change`), and the
  `reopened_from` refusals are accepted, since nothing refuses them yet. The foreign-key case and
  the controls already pass.
- [ ] **Step 3: Add the two new triggers, change the two guard triggers, rebuild both baselines.**
- [ ] **Step 4: Run** the Step 2 commands, then from the root `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/starting-migrations.test.ts
  scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`. Expected: all PASS; read
  each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Link a reopened bill to the printed one, and let its payments move to it"`.

### Task 2 (PR 4): A whole credit backed by a reopened bill needs no sale.rectify

Starts only once the watcher has cleared PR4-D1's form; built as cleared.

**Files:**
- Modify: `packages/identity/src/authorize.ts` (`signedInPerson`, used by `authorize`)
- Modify: `packages/core/src/record-correction.ts` (`RecordCorrectionInput.authz` gains
  `{ reopenedBillId: string; sessionId: string }`; the checks of PR4-D1)
- Modify: `packages/core/src/errors.ts` (`sale.correction_reopen_invalid`)
- Test: create `packages/core/src/record-correction.reopen.test.ts` (set up as
  `record-correction.approval.test.ts` is)

- [ ] **Step 1: Write the failing tests:**
  - `"credits a bill's ticket whole for a person without sale.rectify when its reopened bill is open"`:
    the corrective is filed with `authorized_by` the session's person.
  - `"refuses a partial correction"` (`reason: "not_whole"`), `"refuses when no open bill was
    reopened from the ticket's bill"`, `"…when the reopened bill names another bill"` and `"…when it
    is no longer open"` (each `reason: "no_reopened_bill"`), `"refuses an ended session"`
    (`session.not_open`); none allocates an invoice number.
  - `"the other kinds still need sale.rectify"`: the same credit with `{ sessionId }` alone refuses
    `authorization.not_permitted`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/core exec vitest run src/record-correction.reopen.test.ts`.
  Expected: FAIL (the kind is not accepted).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command, `pnpm --filter @waitron/core exec vitest run
  src/record-correction.test.ts src/record-correction.approval.test.ts
  src/record-correction.management.test.ts`, `pnpm --filter @waitron/identity exec vitest run
  src/authorize.test.ts` (or the file that tests `authorize`), `pnpm --filter @waitron/fiscal-verifactu
  exec vitest run src/write-path.e2e.test.ts inmutabilidad`, and from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts`. Expected: PASS, the golden huella and `inmutabilidad` unedited.
- [ ] **Step 5: Commit** `git commit -s -m "Let a whole credit backed by a reopened bill be filed without the right to correct a sale"`.

### Task 3 (PR 4): Reopen to split needs no PIN

**Files:**
- Modify: `apps/server/src/split-after-print.ts` (open the new bill, set its `reopened_from` by an
  update while the printed bill is still `placed`, and copy the dishes, all before the credit and
  the abandon (PR4-D1); credit with `{ reopenedBillId, sessionId }`; no
  `withRectifyPinAhead` and no `authorize`; `copyBillDishes` returns the line copies; export
  `reopenToSplitIn(tx, deps, cfg, id, operator)` and `refuseReopen(tx, deps, cfg, id)` for Task 5)
- Modify: `apps/server/src/cancel-credit.ts` (`creditWholeInvoice`'s `authz` takes the new kind)
- Modify: `apps/server/src/till-api.ts` (the `split-after-print` route, `:2849-2873`, reads no
  `override`; `splitAfterPrint` takes `{ personId, sessionId }`)
- Test: `apps/server/src/split-after-print.test.ts` (the changed checks above, and new cases)

- [ ] **Step 1: Write the failing tests** in `split-after-print.test.ts`:
  - `"needs no sale.rectify, and names unserved dishes first"` (was `:382`): a session without it
    splits; the corrective's `authorized_by` is that person.
  - `"the new bill names the printed one"`: its `reopened_from` is the printed bill.
  - `"Cancel and credit still needs sale.rectify"`: the same session's cancel refuses
    `authorization.not_permitted` (Review Focus 11).
  - `"refuses on a box with no corrective series, copying nothing"` (was `:568`):
    `series.no_corrective_for_node` (409); no new bill.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-after-print.test.ts`.
  Expected: FAIL on the first case (`authorization.not_permitted`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/split-after-print.set-menus.test.ts
  src/till-api.profile-actions.test.ts src/a-la-carte-price.test.ts` (it imports `copyBillDishes`,
  `a-la-carte-price.test.ts:22`, whose answer this task changes) and the file that tests Cancel and credit's route (find it
  with `rg -l "/cancel" apps/server/src --glob '*.test.ts'`), and from the root
  `pnpm exec vitest run scripts/errors-reachable.test.ts`. Expected: PASS; read each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Reopen a printed bill to split it without a manager's PIN"`.

### Task 4a (PR 4): A part-paid printed bill can be reopened, its cash moving with its dishes

**Files:**
- Create: `apps/server/src/split-after-print-money.ts` (`refuseSplitMoney`, PR4-D5;
  `carryReceivedPayments(tx, fromBillId, toBillId)`, PR4-D3: the `bill_payments` rows only)
- Modify: `apps/server/src/split-after-print.ts` (`refuseSplitMoney` in place of
  `refusePlacedOrderMoney`; `carryReceivedPayments` after `abandonPlacedOrder`)
- Modify: `apps/server/src/errors.ts` (`bill.has_advance`), `apps/server/src/till-api.ts` (409),
  `apps/till/src/i18n/codes.ts` (English and Spanish, PR4-D5)
- Test: create `apps/server/src/split-after-print.money.test.ts` (with `split-after-print.test.ts`'s
  helpers); the changed checks above

Until Task 4b, `refuseSplitMoney` also refuses `bill.payments_received` for a received payment
that a card provider row (`payments.bill_payment_id`) names, so no card's `bill_payments` row moves
without its provider row. Task 4b deletes that line.

- [ ] **Step 1: Write the failing tests:**
  - `"a part-paid printed bill splits, and its cash counts towards the new bill"`: a 30.00 bill,
    10.00 cash received after printing; split; the new bill's balance shows the payment, still to
    pay 20.00; the printed bill holds no payment; one corrective of −30.00.
  - `"the new bill's ticket takes the carried money as its tender"` (Review Focus 9): then 20.00
    more in cash; the new bill is `settled`, its ticket 30.00, its tenders 10.00 and 20.00 in time
    order; the credited ticket has no tender, and it and its credit note sum to zero.
  - `"the credited ticket reprints without the carried payments"` (`receipt-payments.ts:131`).
  - `"a pending card still refuses"` (`order.payment_in_flight`), `"a pending refund refuses"`
    (`bill.refund_in_progress`), `"an advance refuses"` (`bill.has_advance`), `"a received items
    payment refuses"` (`bill.payments_received`, PR4-D5; the items payment taken through PR 2's
    route on the printed bill); in each, nothing is credited and no bill opens.
  - `"a failed payment stays with the printed bill"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/split-after-print.money.test.ts`.
  Expected: FAIL on the first case (`bill.payments_received`).
- [ ] **Step 3: Implement**, and change the two checks at `split-after-print.test.ts:397` and `:423`.
- [ ] **Step 4: Run** the Step 2 command plus `src/split-after-print.test.ts
  src/bill-payments.test.ts src/bill-overpaid.test.ts`, from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/no-bare-transaction.test.ts`,
  and `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts`. Expected: PASS; read
  each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Reopen a part-paid printed bill, its cash moving to the reopened bill"`.

### Task 4b (PR 4): Card payments move with their provider rows

**Files:**
- Create: `packages/payments/src/carry.ts` (`carryProviderRows(tx, { billPaymentIds, toWorkingOrderId,
  fromSaleId })`: the provider rows follow, `sale_id` cleared where it is `fromSaleId`, PR4-D4);
  export it from `packages/payments/src/index.ts`
- Modify: `apps/server/src/split-after-print-money.ts` (`carryReceivedPayments` calls
  `carryProviderRows` after moving the `bill_payments` rows; `refuseSplitMoney` drops Task 4a's
  interim card refusal)
- Test: create `packages/payments/src/carry.test.ts` (the package's own coverage run does not run
  the server's tests); extend `apps/server/src/split-after-print.money.test.ts` (with the reader
  fakes `bill-payments.card.test.ts` uses)

- [ ] **Step 1: Write the failing tests:**
  - In `carry.test.ts`: `"moves the named rows to the bill and clears only the old sale"` (a row
    linked to `fromSaleId` ends with `sale_id` null; a row with `sale_id` null stays null; a row of
    another bill payment is untouched).
  - `"a card paid before printing is linked to the new ticket"` (Review Focus 10; PR4-D4 point 1):
    a 10.00 reader card captured on the open bill, then printed (its provider row names the printed
    ticket), split, paid off; the provider row names the new ticket and the new bill.
  - `"a card paid after printing is not a stray to the reconcile sweep"` (Review Focus 10; point 2):
    after the split, `listReconcilable` lists the card with `workingOrderStatus: "open"`. Control,
    run once and recorded in the PR: with `carryProviderRows` skipped, the same test shows
    `"abandoned"`.
  - `"a hand-keyed card's operation number prints on the new ticket"` (`readTenderBlock`).
  - `"a carried payment is refunded on the new bill"` (Review Focus 8): refund 5.00 of a carried
    reader card through the reopened bill's id; it completes, and the reopened bill's balance
    counts it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/payments exec vitest run src/carry.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/split-after-print.money.test.ts`.
  Expected: FAIL (`carryProviderRows` does not exist; the card cases refuse `bill.payments_received`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 commands plus `pnpm --filter @waitron/server exec vitest run
  src/split-after-print.test.ts src/bill-payments.test.ts src/bill-refunds.card.test.ts
  src/bill-overpaid.test.ts`, `pnpm --filter @waitron/payments exec vitest run src/reconcile.test.ts
  src/schema/payments-guard.test.ts`, and from the root `pnpm exec vitest run
  scripts/no-bare-transaction.test.ts`. Expected: PASS; read each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Move a part-paid printed bill's card payments with their provider rows"`.

### Task 5 (PR 4): Paying for items on a printed bill

Built as the watcher confirms PR4-D7's *Who may*.

**Files:**
- Modify: `apps/server/src/pay-for-items.ts` (`billFor`, `:373-395`: a `placed` source runs
  PR4-D7's steps; `earlierItemsBill`, `:321-334`; `previewPayForItems`, `:463-524`: a `placed` bill
  runs `refuseReopen` instead of `refuseClosedBill`; on a `placed` bill both first call
  `assertProfileAction(device, "take-orders")`, PR4-D7 *Who may*). If the file would pass ~900
  lines, the printed path goes in a new `apps/server/src/pay-for-items-printed.ts`.
- Modify: `apps/server/src/bill-payments-api.ts` (both Pay for items routes, `:483-497` onwards,
  pass `session.device` to `payForItems` and `previewPayForItems`)
- Test: create `apps/server/src/pay-for-items.printed.test.ts` (with `pay-for-items.test.ts`'s and
  `pay-for-items.card.test.ts`'s helpers); extend `apps/server/src/till-api.profile-actions.test.ts`
  in its `describe("the person's permission and the profile's action are both needed")` (`:1133`).
  These are cases, not `ROUTES` rows: that table sends each route a random bill id (`:156`), and
  the check needs a printed bill, as the presented-bill case at `:1134` seeds one.

This task may be split at the declined-reader-card case (that case and those after it in a second
task, with its own run and commit) if the implementer nears ~100 tool calls.

- [ ] **Step 1: Write the failing tests** (Review Focus 6, 7 and 9):
  - `"cash pays for chosen items on a printed bill"`: soup 6.00 and hake 15.00, printed; pay for
    the hake, cash 20.00; the printed ticket is credited (−21.00), the hake's bill `settled` with a
    15.00 ticket, the reopened bill `open` with the soup at 6.00.
  - `"on a part-paid printed bill the paid money stays with the table's bill"`: 10.00 cash received
    after printing; pay for the hake by cash; the reopened bill holds the soup (6.00) and the
    10.00, `overpaid: "4.00"`, no ticket yet; Keep as tip then settles it with a 6.00 ticket; the
    credit note, the hake's ticket and the soup's ticket together come to what the guests paid
    less the tip.
  - `"the same request twice reopens once"`: one `submissionId` sent twice to the printed bill's
    id; one corrective, one reopened bill, one items bill, the second answer equal to the first.
  - `"a declined card leaves every dish on the reopened bill"`: reader card on the hake, declined;
    the printed ticket stays credited, the reopened bill `open` with soup and hake at 21.00 and any
    paid money, the items' bill `abandoned`, no ticket for it.
  - `"a refusal reopens nothing"`: a stale `applied` refuses `bill.allocation_changed`; the bill
    is still `placed`, no corrective, no new bill.
  - `"the preview says the reopen's refusal before any money"`: a printed bill holding an advance
    previews `bill.has_advance`; one with an unserved dish, `bill.unserved_dishes`.
  - `"a stale party revision is refused before the reopen"` (`party.out_of_date`).
  - `"part of a line on a printed bill"`: one of three beers; the reopened bill keeps two.
  - In `till-api.profile-actions.test.ts`: `"refuses Pay for items on a printed bill on a till
    without take-orders, reopening nothing"` (`forbidden("take-orders")`; the bill is still
    `placed`, no corrective) and `"refuses its preview the same way"`. Control:
    `"pays for items on an open bill on a till without take-orders"` (200), so the check is held
    to printed bills.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.printed.test.ts
  src/till-api.profile-actions.test.ts`. Expected: FAIL on the first case of each
  (`bill.presented`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/pay-for-items.test.ts src/pay-for-items.card.test.ts
  src/pay-for-items.move.test.ts src/split-after-print.test.ts src/split-after-print.money.test.ts
  src/bill-payments-api.test.ts`. Expected: PASS; read each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Pay for chosen items on a printed bill by reopening it in the same step"`.

### Task 6 (PR 4): The Pay for items answer carries the table's bill

**Files:**
- Modify: `apps/server/src/pay-for-items.ts` (`payForItems` answers `sourceBalance`, read with
  `readBillBalance`, `bill-payments.ts:976`, in the payment's transaction, or with `getBillBalance`,
  `:2983`, after a reader card's collect step; also on a replay, where the bill read is the items
  bill's `items_paid_from`, not the request's bill id, PR4-D10)
- Modify: `apps/till/src/api/item-payment-types.ts` (`ItemPaymentResult.sourceBalance: BillBalance`),
  `apps/till/src/state/pay-for-items.ts` (`takePayment`, `:194-204`, passes it on as
  `sourceBalance`), `apps/till/src/till-app.ts` (+~10: `#onBillPaid` uses it where it calls
  `#rereadAfterPaid` for a Pay for items answer, PR4-D10; a card not charged still returns to the
  form, not the confirmation)
- Test: extend `apps/server/src/pay-for-items.test.ts`, `apps/server/src/pay-for-items.card.test.ts`,
  `apps/server/src/pay-for-items.printed.test.ts`, `apps/till/src/state/pay-for-items.test.ts`, `apps/till/src/till-app-pay-for-items.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - Server: `"the answer carries the table's bill as the payment left it"` (cash: the soup's 6.00
    left, no payment) and `"…as the put-back left it"` (a declined reader card: 21.00 again).
  - Server, in `pay-for-items.printed.test.ts`: `"a replay on a printed bill carries the reopened
    bill"`: the same cash request sent twice to the printed bill's id; the second answer's
    `sourceBalance` names the reopened bill (the soup's 6.00 left), not the abandoned printed bill.
  - Till: `"a declined reader card for items shows the table's bill from the answer, reading no
    balance"`: `getBillBalance` is never called; the form shows the decline and the answer's
    balance. `"at the Counter the order is read again without a balance read"`. `"a card still
    pending on a till reads no balance"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/pay-for-items.test.ts
  src/pay-for-items.card.test.ts src/pay-for-items.printed.test.ts` and `pnpm --filter @waitron/till exec vitest run
  src/state/pay-for-items.test.ts src/till-app-pay-for-items.test.ts`. Expected: FAIL (no
  `sourceBalance`; one `getBillBalance` call).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 commands plus `pnpm --filter @waitron/till exec vitest run
  src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts
  src/till-app-counter-payment-window.test.ts`, `pnpm --filter @waitron/till typecheck`, and from
  the root `pnpm exec vitest run scripts/product-file-size.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Answer Pay for items with the table's bill, so the till need not read it again"`.

### Task 7 (PR 4): The till's Reopen to split asks no PIN and works on a part-paid bill

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (only `:7086-7132`: Reopen to split is
  offered without `!bill.hasPayments`; Cancel and credit keeps it)
- Modify: `apps/till/src/till-app.ts` (`#sendCancelCredit`, from `:21718`: a split sends no
  override; `#onCancelCreditRefused`, `:21853`: the approver step for `"cancel"` only; the dialog
  gets the bill's paid amount)
- Modify: `apps/till/src/api/client.ts` (`splitAfterPrint` drops `override`, from `:4293`)
- Modify: `apps/till/src/widgets/cancel-credit-dialog.ts` (property `paid: string | null`; the scope
  line adds `split.scope_paid`; the split map keeps `bill.payments_received`, `:61`, PR4-D11)
- Modify: `apps/till/src/i18n/strings.ts` (`split.scope_paid` in English and Spanish;
  `split.refused_payments`, `:2150-2151` and `:4486-4487`, takes PR4-D11's new words)
- Test: `apps/till/src/till-app-parties-closing.test.ts`, `apps/till/src/widgets/cancel-credit-dialog.test.ts`,
  the file that tests the bill ⋮ menu's items (`rg -l "data-split-after-print" apps/till/src`),
  `apps/till/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"offers Reopen to split on a printed bill with payments, and Cancel and credit only without"`.
  - `"splits a part-paid bill and says what was paid carries over"`: bill row total 30.00,
    outstanding 20.00 → the dialog says "€10.00 already paid counts towards the new bill."; the
    split is sent with no override; the new bill opens.
  - `"a split refused as not permitted opens no PIN prompt"`: `authorization.not_permitted` → the
    refusal shown, no `till-supervisor-override-dialog`.
  - `"a bill with an advance says to take the rest by amount or in shares"` (`bill.has_advance`).
  - `"a bill paid for by item says so"` (`bill.payments_received` → PR4-D11's words).
  - In `client.test.ts`: `"splitAfterPrint sends no override"`.
  - Delete the check at `till-app-parties-closing.test.ts:786`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-parties-closing.test.ts
  src/widgets/cancel-credit-dialog.test.ts`. Expected: FAIL on the first case.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/api/client.test.ts src/i18n/codes.test.ts
  src/i18n/strings.test.ts`, the dialog's `*.a11y.test.ts` if it has one, the bill menu's test file,
  `pnpm --filter @waitron/till typecheck`, and from the root `pnpm exec vitest run
  scripts/product-file-size.test.ts scripts/english-only.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Reopen a printed bill to split it on the till with no PIN, also when part is paid"`.

### Task 8 (PR 4): Pay > Items on a printed bill through the new route

**Files:**
- Modify: `apps/till/src/state/pay-for-items.ts` (`withItems`, `:118-140`, and `previewPayment`,
  `:176-190`, lose `staysOnBill`: every items choice goes to the new routes)
- Modify: `apps/till/src/till-app.ts` (delete `#itemsStayOnBill`, `:12810`, and its uses at
  `:23431`, `:23456` and in the `withItems` call from `:23505`; when the answer's `sourceBalance`
  names another bill than the Pay window's (PR4-D7, D8): a receipt window returns to that bill
  (`SettlementDocument` gains `returnTo`, read by `#onBackToTable`, `:24376-24397`, in place of
  `staysOnBill`); otherwise the screen and the Pay window move to it (`#switchToBill`), the window
  showing the decline or the payment in progress there). The move goes in a new
  `apps/till/src/state/reopened-bill.ts` where it can. The request's `expectedEdits` name the
  printed bill's edit state, which the Pay window already holds for a printed bill (today's
  whole-bill payment sends it: `paymentAsk(…, open.expectedEdit)`, `till-app.ts:23507`).
- Test: extend `apps/till/src/till-app-pay-for-items.test.ts` and `apps/till/src/state/pay-for-items.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a printed bill's items go to the new route and the table shows the reopened bill"`: party bill
    row `status: "placed"`, Pay > Items, one dish, cash → `previewItemPayment` and `payForItems` on
    the printed bill's id; the receipt window for the items' bill; after `settlement-close` the
    screen shows the reopened bill named by `sourceBalance`, and no Pay is offered on the printed
    bill. (This rewrites PR 2's "a printed bill's items still go to today's route".)
  - `"a declined card on a printed bill moves to the reopened bill and says so"`: the Pay window's
    form, on the reopened bill, shows `bill_pay.card_declined`.
  - `"the preview's reopen refusal shows before any money"`: `previewItemPayment` rejects
    `bill.unserved_dishes` → the Pay window says it; `payForItems` is never called.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-pay-for-items.test.ts
  src/state/pay-for-items.test.ts`. Expected: FAIL (the preview goes to `previewBillPayment`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command plus `src/till-app-bill-payments.test.ts
  src/till-app-current-bill-pay.test.ts src/till-app-handheld-pay.test.ts`, `pnpm --filter
  @waitron/till typecheck`, and from the root `pnpm exec vitest run scripts/product-file-size.test.ts`.
  Expected: PASS; read each `Tests` count.
- [ ] **Step 5: Commit** `git commit -s -m "Pay for items on a printed bill from the till by reopening it"`.

### Task 9 (PR 4): Look at it, then say it in the guides and the backlog

**Files:**
- Modify: `apps/server/src/guide/en/table-service.md` (`:263-264`, `:710-713`, `:963`) and
  `apps/server/src/guide/es/table-service.md` (their twins: `:279`, `:757-760`, `:1028-1029`)
- Modify: `docs/backlog/menu.md` (A1515's piece 1 line, `:854`) and `docs/backlog/fiscal.md`
  (ADVISER-SPLIT-AFTER-PRINT, `:1217-1229`: its D1 and D3 are replaced by the owner's "1 A" and
  "2 B"; add a dated line, do not rewrite the entry)

- [ ] **Step 1: Look.** On a Claude slot (`wa-wt demo waitron-feat-a1515-1-printed-bills`; never
  the owner's stack), at till and phone width, light and dark: print a seated table's bill, take
  €10 in cash, then **Reopen to split** (no PIN asked; the dialog's paid line); then on another
  printed bill **Pay > Items** > one dish > cash, and once with the simulator's **declined** card.
  Fix what reads or lays out badly in the task that drew it. Screenshots stay in the working folder
  and go to the owner directly. `wa-wt down waitron-feat-a1515-1-printed-bills` afterwards.
- [ ] **Step 2: Write the guides from what Step 1 showed**, English then Spanish, same `{#id}`s:
  `:710-713` says money already paid counts towards the new bill, and that a bill with a payment
  on its own receipt is paid by amount or in shares instead; `:963` says that on a printed bill
  **Items** first credits its receipt and puts its dishes back on an open bill, then pays the chosen
  ones on their own, and a declined card leaves every dish on that open bill to print again or pay;
  cut `:263-264` (no printed bill takes an items payment any more). Cut, do not reword, any
  sentence Step 1 proved wrong.
- [ ] **Step 3: Update the backlog**: A1515's piece 1 line says printed bills are paid for by item
  and split with no PIN, part-paid ones included (pull request 4 of 4 to land; PR 3 then removes
  the old items payment), and the fiscal decision gets its dated line.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts
  src/guide-box-word.test.ts` and from the root `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/english-only.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Say in the table service guide how printed bills are split and paid for by item"`,
  then `/finish-branch` with the full wave and two Codex angles; the owner lands it.

**For the watcher, before Task 2:** two things to clear. (1) PR4-D1's form: recommended, the
reopened-bill check, now backed by Task 1's trigger that sets the link once, on an open bill, to a
bill still `placed`; or the smaller form without the check. (2) PR4-D7's *Who may*: Pay for items
on a printed bill also needs the device profile's `take-orders` action, as Reopen to split does
(Task 5). **For the owner, through the watcher (not blocking):** a card declined
after Pay for items on a printed bill leaves its receipt credited and every dish on an open bill of
the table, to print again or pay (PR4-D8).

## PR 3 — Removal (`feat/a1515-1-items-kind-removal`)

On PR 4's head (`a9d84eef8f`, #4317, which holds `main` with #4313 and the owner's wording change)
until that lands, then rebased onto `main`. Every `file:line` below was re-read on that head on
25 November 2026.

**What it delivers.** Nothing new to see. The old "items" payment (dishes paid for while they stay on
the table's bill) goes: the kind, its table `bill_payment_lines`, the guards that kept a paid dish
where it was, the two ways to pay for items that cost more than was left, and the till's paid marks.
Pay > Items already moves the dishes to a bill of their own. **The PR's first line: "Resets venues"**
(core's starting migration is rebuilt). It files and charges nothing differently.

**Measured first,** on PR 4's earlier head `f6689d9bc8`, before #4313. The product code below was
removed in a throwaway worktree, the core migration rebuilt, and the 40 server test files that name it
or the new route run: every failure is a case listed under Changed test checks, or follows from one in
the same file. `till-api.fiscal-sale-paths`, the four `pay-for-items*`, `payments-api.stuck`, the golden
huella test and `inmutabilidad` passed unedited. Of the till, only the product code and its typecheck
were tried.

### Decisions

- **PR3-D1 (from the spec, §7, "What this removes").** The kind, the table, `paidLines`, the guards
  and `bill.line_paid`, and an items payer's own-receipt advance go. `full_with_tip`/`use_pool` go with
  them: `previewAllocation` answers `choose` only for an items request
  (`packages/orders-sales/src/bill-allocation.ts:166`), `previewPayForItems` asks as a share
  (`apps/server/src/pay-for-items.ts:614-626`), and the till's only producer is the choose step
  (`apps/till/src/widgets/bill-pay-dialog.ts:2399-2456`).
- **PR3-D2 (follows).** An old request with `kind: "items"` is refused
  `400 management.request_invalid {field: "kind"}`, also a resend; `lines` and `choice` on another kind
  are ignored, as any unknown key is. Stored items payments go with the venue reset: no reading code.
- **PR3-D3 (follows).** In the till, `PayChoice`'s `items` stays (it is what Pay > Items means);
  `paymentAsk` asks for it as `share` of 1, which is what the server takes on the new bill. Sent down
  the bill's own route, that ask would pay the whole bill, so `takePayment` (`state/pay-for-items.ts:210`)
  is handed the choice and throws on an items choice with no items part, as `withItems` already throws
  with no edit state (`:144`). The resend key still tells picks apart (`submissionFor` adds
  `items.picks`, `state/bill-payment.ts:173`).
- **PR3-D4 (follows; corrects #4317's note).** `paysOnNewBill` (`state/pay-for-items.ts:113`) is NOT
  dead: it reads the preview's `total`, which hides the guest count and own-receipt questions and shows
  the items' price. Keep it. `AllocationPreview` keeps its one `kind: "allocated"` on the wire.
- **PR3-D5 (follows).** A re-read that drops a pick because the dish was paid elsewhere becomes one
  where the dish has left the bill, or the money floor is reached. Till tests whose subject is the
  dropped pick are re-pointed at those; a test of the paid mark itself is deleted.
- **PR3-D6 (follows).** The counter keeps a part-paid retrieved order unfolded
  (`state/counter-portion-rows.ts:6-18`, guides `table-service.md`); only its comment's reason changes.
- **PR3-D7 (watcher, 2026-11-25 14:47).** `bill_pay.items_none` says "Every item on this bill is
  already paid for.", which can no longer be the reason. Reword to "Nothing to choose on
  this bill." / "No hay nada que elegir en esta cuenta."
- **PR3-D8 (watcher, 2026-11-25 14:47: land PR 3 without waiting).** Nothing a person can do after
  PR 4 is lost: `previewPayment`/`takePayment` send every items choice to the new route
  (`state/pay-for-items.ts:193-221`), `withItems` throws rather than fall back (`:144`), a sent Counter
  order and a Find-a-bill bill show Items barred (`:98-109`), and no reader outside the till posts the
  old kind (`bench/`, demo seed and dashboard: none). But the old kind is then no longer there to fall
  back on for the sent Counter order the owner has asked for next (COUNTER-SENT-ITEMS, 12:17); it is
  designed on the new route, so PR 3 does not block it and the two only meet in `pay-for-items.ts`.
  _2026-11-26: a sent Counter order with no receipt now offers Items
  ([COUNTER-SENT-ITEMS](2026-11-26-counter-sent-items.md))._

**#4313, landed first.** `moveOrderLines` regroups both bills (`working-order-transfer.ts:195`), so the
put-back (`movedItemsBack`) and Pay for items' move do too; pricing the preview by grouping is lane B's
PR 2c (its D21, Task 2c.1), as the dated note below. `set-menu-count.ts` is gone, leaving 8
`refusePaidLines` calls. Its rule that a dish paid for by item keeps its place (its D2) goes here with
the pin at `set-menu-bill.ts:392-396` and the union at `set-menu-freeze.ts:43-46`; `set-menu-moves.ts`'s
caller of `namedFrozenLineIds` needs no edit.

**REOPEN-WITH-ADVANCE** (lane C queue, after #4317, beside this PR) rewrites `refuseSplitMoney`
(`split-after-print-money.ts`), the readers of `bill_advances` and `split.refused_advance`'s words.
Whoever lands second rebases. Task 6's edit of `refuseSplitMoney` leaves the advance refusal exactly as
it finds it.

**Size (production measured in the trial, the rest estimated):** production +110 / −930 (till +78 / −382,
server +21 / −437, packages and triggers +10 / −106); tests +330 / −2,150 (about 1,300 of it deleted server cases, 750
till, 170 packages; about 100 one-line fixture edits); generated +6 / −96; docs +15 / −30.

### Task 1 (PR 3): The till's Pay and refund windows lose the choice and the part-paid dish

**Files:** `apps/till/src/state/bill-payment.ts` (`paymentAsk` `:83-112`, `confirmationOf` `:132-147`;
`paidQuantities` `:404-418` stays until Task 2b), `state/pay-for-items.ts` (`itemsChoiceOf` loses
`offered`, `choice: null`, the `kind` checks; `takePayment` PR3-D3), `widgets/bill-pay-dialog.ts`
(`allocation` `:120`, the choose step `:2395-2456`, `#paidUnits`/`#remaining`/`#offered` `:979-993`, the
cash "own tip" code `:2103-2115` and its use in `#tipErrors`, the `.choices` styles `:383`),
`widgets/bill-refund-dialog.ts` (`#wholeOnly`), `till-app.ts` (`:23506-23509`, `takePayment` at `:23596`
is passed `submission.shown.asked.choice`, `:23854`; the `itemsDue` comment `:1808-1810`),
`api/client.ts` (`AllocationChoice` `:1186`, `BillPaymentAsk` `:1189-1205`, `AllocationPreview`
`:1227-1242`, `BillPaymentView.kind` `:1273`), `i18n/strings.ts` (`bill_pay.choose_later`,
`.choice_legend`, `.choice_tip`, `.choice_pool`, `.tip_amount_between`, `bill_refund.whole_only`; reword
`.items_none`, PR3-D7), `test/bill-pay-app.ts`.

- [ ] **Step 1: Write the failing tests.** In `state/bill-payment.test.ts`, replacing `:45`'s items half:
  `"chosen items are asked for as the whole of their own bill"` → `paymentAsk` of an items choice
  equals the ask of a whole choice; expected FAIL (`kind: "items"`). In `state/pay-for-items.test.ts`:
  `"takePayment refuses an items choice with no items part"` → it throws and neither
  `api.takeBillPayment` nor `api.payForItems` is called; expected FAIL (it calls `takeBillPayment`). Run
  `pnpm --filter @waitron/till exec vitest run src/state/bill-payment.test.ts src/state/pay-for-items.test.ts`.
- [ ] **Step 2: Implement.** For cash the server's own rule tip is always nothing
  (`bill-allocation.ts`, `ruleTip`), so the tip floor is 0 and `addedTip` is the tip itself.
- [ ] **Step 3: Edit the tests** (list: Changed test checks, Till 1). A pick quantity capped by a
  payment becomes a line whose quantity fell in the re-read.
- [ ] **Step 4: Run** the files edited, `src/till-app-pay-for-items.test.ts src/i18n/strings.test.ts
  src/i18n/refund-wording.test.ts`, `pnpm --filter @waitron/till typecheck`, and from the root `pnpm exec
  vitest run scripts/product-file-size.test.ts scripts/english-only.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Take the old items payment's choices out of the till's Pay and refund windows"`.

### Task 2a (PR 3): The till's pick rows lose the paid row

**Files:** `state/portion-selection.ts` (`PickGroup.paid`, the `paid` block, `pickedTotal`,
`tidyPicks`, `pickedLineIds`), `state/split-selection.ts` (`picksEveryDish` `:95-104` with its comment),
`widgets/portion-picker.ts` (`:189`, `:206`), `state/counter-portion-rows.ts` (comment).

- [ ] **Step 1: Re-point the tests first** (list: Till 2a), and run them: a dish leaving the bill in the
  re-read already drops its pick, so these pass before the code changes. Control: with the line put
  back in the re-read, each fails.
- [ ] **Step 2: Remove the code and the deleted tests.** Keep the money floor, the presented stop and a
  whole-bill tick on a part-paid bill exactly as they are: `picksEveryDish` keeps its `ownUnsent` test.
  `anywayNote`'s `"paid"` and `data-split-paid` are about a paid bill and stay.
- [ ] **Step 3: Run** the files edited, `src/till-app-move-dishes.test.ts src/till-app-split-table.test.ts
  src/till-app-split-table.reads.test.ts`, the pickers' `*.a11y.test.ts` and the till typecheck.
- [ ] **Step 4: Commit** `git commit -s -m "Stop a pick row being held back as paid for"`.

### Task 2b (PR 3): The till's order screen loses the paid marks

**Files:** `screens/till-table-order-screen.ts` (`fallbackPortionKeys` `:438-461`, `.line-paid` `:897`,
`#paidIndexed`/`#paidDishes` `:2874-2891` and its use `:2905-2907`, `:3480`, `:3979`, `:5401-5431`,
`:6511-6522`), `state/split-selection.ts` (`keyFor`'s balance `:268`, `:284`; `pickGroups` keeps its
own), `state/bill-payment.ts` (`paidQuantities`), `i18n/strings.ts` (`table.pick_payment_stays`,
`table.line_payment_part`).

- [ ] **Step 1: Edit the tests** (list: Till 2b) and run them; the kept halves pass on the old code.
- [ ] **Step 2: Remove the code.**
- [ ] **Step 3: Run** the files edited, every `till-table-order-screen*.a11y.test.ts`, the till
  typecheck, and from the root `scripts/product-file-size.test.ts` (lower `till-table-order-screen.ts` to
  the limit it names) and `scripts/english-only.test.ts`.
- [ ] **Step 4: Commit** `git commit -s -m "Take the paid marks off the till's order screen"`.

### Task 3 (PR 3): The till's refusal codes, live table and wire fields

**Files:** `i18n/codes.ts` (`bill.line_paid` `:608`, `bill.refund_not_whole` `:744`), `till-app.ts`
(`bill.line_paid` at `:934`, `:968`, `:989`), `widgets/cancel-credit-dialog.ts` (`:54`) and
`split.refused_payments` (`strings.ts:2267`, `:4718`; the server's only raise for a reopen, Task 6,
goes), `api/live-connection.ts` (`:94`), `api/client.ts` (`paidLines` and `BillPaymentView.lines`
`:1286-1287`, `:1318-1319`, doc comments `:5085`, `:5150`, `:5502`), and every test fixture that
states them (`git grep -n "paidLines" apps/till`; `test/bill-pay-app.ts:179,199`,
`test/bill-pay-fixtures.ts:18`, `test/allergy-app-fixture.ts`, two `*.test-helpers.ts`).

- [ ] **Step 1: Remove.** Where `bill.line_paid` is only an example of a money refusal in a test, use
  `bill.received_exceeds_total`; where that is already a row beside it, drop the row (list: Till 3).
- [ ] **Step 2: Control.** `git grep -nE
  "paidLines|paidQuantit|line_paid|refund_not_whole|refused_payments\"|full_with_tip|use_pool|bill_payment_lines"
  apps/till` answers only `cancel_credit.refused_payments`.
- [ ] **Step 3: Run** the files edited, `src/i18n/codes.test.ts src/i18n/refund-wording.test.ts
  src/i18n/strings.test.ts src/api/client.test.ts src/api/client.item-payments.test.ts
  src/widgets/cancel-credit-dialog.test.ts src/till-app-parties-closing.test.ts`, the till
  typecheck, and from the root `pnpm exec vitest run scripts/live-subscriptions.test.ts
  scripts/staff-notice-codes.test.ts scripts/english-only.test.ts scripts/product-file-size.test.ts`.
- [ ] **Step 4: Commit** `git commit -s -m "Drop the old items payment's codes and fields from the till"`.

### Task 4 (PR 3): Re-point the server tests that only needed a part payment

No product code. Three commits, each passing on unchanged code, which is what shows the re-pointed
tests still assert the same thing. Replace the items payment by a **contribution of the same amount**
(or `share` of 1 where it paid the whole bill); keep every other assertion; say "part payment" in a
title that said "item payment". The per-file list is under Changed test checks, "Re-pointed".

- [ ] **4a Payments suites:** `bill-payments-api`, `bill-payments`, `bill-payments.card`, `bill-unsent`,
  `bill-editing.table-actions`, `adjustments-apply`. And one new case in `bill-payments`, "the writers
  with no route of their own": `"refuses cutting part of a grouped line below what was received"` — three
  Beers (9.00) on one grouped line (`writeGroupedLines`), a contribution of 6.00, then
  `cancelLine(tx, cfg, billId, 1, "2")` is `bill.received_exceeds_total {excess: "3.00"}` and cancelling
  `"1"` goes through. It is the only test of the check at `working-order-removal.ts:206` (Task 6).
- [ ] **4b Bills and kitchen:** `draft-discard`, `line-cancel-api`, `move-dishes`,
  `party-table-actions`, `set-menu-adjustments`, `set-menu-money`, `till-api.bill-actions`,
  `till-api.groups`, `till-api.table-actions`.
- [ ] **4c Fiscal:** `bill-payments.after-ticket`, `order-dining.filing`, `order-dining.switch`,
  `order-portions.lifecycle`, `split-table.fiscal`, `till-api.move-bill`, `till-api.move-dishes`. Filed
  totals, rates, tender amounts, record counts and one-invoice checks stay word for word; a reviewer
  diffs these seven files for any changed expected value.
- [ ] **For each:** run the edited files (`pnpm --filter @waitron/server exec vitest run …`), then
  mutate one re-pointed expectation per file to see it fail, put it back, and commit
  `git commit -s -m "Part-pay with an amount where these tests used an items payment (…)"`.

### Task 5a (PR 3): Delete the tests of the removed payment

No product code: the cases listed "Deleted with the writer", and nothing else.

- [ ] **Step 1: Delete them,** with the helpers and imports only they used.
- [ ] **Step 2: Run** the edited files and the `server` and `orders-sales` typechecks. A case deleted
  with a `venue.card.stallNextCollect()` takes the stall with it; a case that stays must use its stalled
  reader up. (In the trial `bill-payments.card` `:736` failed only because `:709`'s stall, refused before
  the reader, was left for it.)
- [ ] **Step 3: Commit** `git commit -s -m "Delete the tests of the old items payment"`.

### Task 5b (PR 3): The server takes no items payment

After this nothing can write `bill_payment_lines`.

**Files:** `packages/orders-sales/src/bill-allocation.ts` (`AllocationChoice`, `AllocationOption`, the
items request, `offeredChoices`, `BillFunds.hasPending`, `choice`), `apps/server/src/bill-payments.ts`
(`BillPaymentAsk` `:188-205`, `itemsDue` `:1448-1534`, `allocationRequestFor` `:1536-1565` becomes a
plain function of the ask, the insert `:2105-2111`, `lines` in `retryShapeOf` `:1699`),
`bill-payments-api.ts` (`parseLines` `:73-91`, `:95`, `:103-104`, `:117-119`, the counter check
`:142-146`), `pay-for-items.ts` (`:610`, the comment `:614` and the cast), `payments-api.ts`
(`hasPending` `:1449`, the not-allocated refusal `:1458`, `choice: null` in `allocationChanged`),
`scripts/personal-log-params.test.ts:26` (the allocation holds money amounts only). Test types that
still name the kind or `choice`: `bill-payments-api.test.ts:572`, `:580`, `bill-payments.card.test.ts:50`,
`:58`, `till-api.move-bill.test.ts:57`. `BillPaymentView.kind` becomes `PaymentRow["kind"]` so Task 7
narrows it.

- [ ] **Step 1: Write the failing test** in `bill-payments.card.test.ts`'s refused-body table: the row
  `["the old items kind", { ...card, kind: "items", lines: [{ lineNo: 1 }] }, "kind"]`. Expected FAIL
  (refused for `amount`).
- [ ] **Step 2: Implement,** and re-point `packages/orders-sales/src/bill-allocation.test.ts`.
- [ ] **Step 3: Control.** `git grep -n billPaymentLines -- 'apps/server/src/*.ts' ':!*.test.ts'` shows
  reads only. An ordinary payment's fingerprint is unchanged: `retryShapeOf` only
  loses a key that `canonicalJson` dropped when absent — check by asserting one known request's
  fingerprint before and after in a scratch test, not committed.
- [ ] **Step 4: Run** `pnpm --filter @waitron/orders-sales exec vitest run src/bill-allocation.test.ts`,
  every server file of Tasks 4 and 5a, `src/pay-for-items.test.ts src/pay-for-items.card.test.ts
  src/pay-for-items.move.test.ts src/pay-for-items.printed.test.ts src/payments-api.stuck.test.ts
  src/counter-bill-payments.test.ts src/till-api.fiscal-sale-paths.test.ts`, both typechecks
  (`orders-sales`, `server`), and from the root `pnpm exec vitest run scripts/personal-log-params.test.ts`.
  The fiscal-sale-paths file must pass UNEDITED: it holds no items payment
  (its `paidLines` at `:1127` is a local name).
- [ ] **Step 5: Commit** `git commit -s -m "Refuse the old items payment on the server"`.

### Task 6 (PR 3): The guards and readers of what items payments paid for

**Files (`apps/server/src/`):** `bill-payments.ts` (`readPaymentLines` `:456`, `paidQuantitiesOf`
`:495`, `readPaidQuantities` `:520`, `refusePaidLines` `:548`, `PaymentMoney.refunds` `:339-340`, `:359`,
`readLineNos` `:760`, `BillPaymentView.lines` `:282-283` and `paidLines` `:305`, `:1042`);
`bill-advances.ts` (`AdvancePaymentMoney.correctives` `:241-242`, `:360`: `:359` was its one reader); the
eight `refusePaidLines` calls — `adjustments-apply.ts` `:862`, `:908`, `:1013` (and the then-unused
`covering` `:972`; the comment `:801`), `line-cancel.ts:295`, `working-order-line-edits.ts` `:429`,
`:550`, `working-order-transfer.ts` `:143`, `:511`; `working-order-line-edits.ts:355`;
`working-order-removal.ts:620-629` (`paidLineParts`, also in `scripts/working-order-split.json:181`);
`set-menu-bill.ts:392-396` and its spread into `fixed`; `set-menu-freeze.ts:43-46`; `bill-refunds.ts:262`
and the comment `:149-152`; `bill-overpaid.ts:119-121` and the comment `:60-61`;
`split-after-print-money.ts:25-36` (nothing else in `refuseSplitMoney`); `errors.ts` (`bill.line_paid`
`:902-906`, `bill.refund_not_whole` `:1009-1013`, the `bill.payments_received` comment `:937-940`);
`till-api-errors.ts` `:221`, `:242`; comments at `bill-actions.ts:296`, `working-order-removal.ts:105`.

- [ ] **Step 1: The control, before deleting.** Make `readPaidQuantities` and `paidQuantitiesOf` answer
  an empty map and run every server file of Tasks 4 to 6 plus the four `pay-for-items*`: the only
  failures are the cases listed "Deleted with the guards". Anything else is a guard that also protected
  something; stop and report it.
- [ ] **Step 2: Delete the code and those tests.** Keep `assertBillInvariant`,
  `assertLinesKeptExcess`, `refusePaymentInFlight` and `refuseRefundInProgress` at every site. Then
  delete each money check below in turn, run its file, see the named test fail, and put it back
  (measured on this head, 25 November):

  | Check that stays | Guards | Its test |
  | --- | --- | --- |
  | `working-order-removal.ts:193`, a whole line | `adjustments-apply.ts:908`, `line-cancel.ts:295` | `bill-payments-api` "refuses a €20.00 void by the €10.00 excess…" |
  | `working-order-removal.ts:206`, part of a line not held as portions | the same two | Task 4a's new case, nothing else |
  | `working-order-removal.ts:285`, portions | the same two | `bill-payments-api` "refuses cutting part of a line when the rest would be less…" |
  | `adjustments-apply.ts:1431`, a comp or discount | `adjustments-apply.ts:862`, `:1013` | `adjustments-bill-payments` "refuses a €20.00 comp by the €10.00 excess…" |
  | `working-order-line-edits.ts:1138`, an item edit or whole-order save | `working-order-line-edits.ts:429`, `:550` | `bill-payments` `:639` re-pointed, the only one on an ordinary bill; `set-menu-regroup-paths` "checks a bill's excess payment against the grouped total…" |
  | `bill-actions.ts:380`, Move dishes | `working-order-transfer.ts:143` | `move-dishes` "…€52.00 with €40.01 received…" |
  | `table-actions.ts:437`, Split table | `working-order-transfer.ts:143` | `party-table-actions` "a loose pick leaving €39.99 of €52.00…" |
  | `working-order-transfer.ts:205`, the bill the lines arrive on | `working-order-transfer.ts:143` | `set-menu-regroup-moves` "refuses moving a Water onto a part-paid bill…" |

  Three kinds of write end in no check on the bill they cut or leave, and need none:
  a cut within one bill, for Move to group and Split line (`order-group-edits.ts:221`, `:348`) and for
  Pay for items' part (`pay-for-items.ts:262`), because `checkLinePart` (`working-order-transfer.ts:296`)
  refuses parts whose prices do not add up to the line's; Pay for items' move
  (`sourceMayBeOverpaid`, `pay-for-items.ts:266`), because the excess is given back or kept as a tip and
  `refuseBelowAdvances` (`:219`) holds the advances' floor; and a bill that is emptied and abandoned — the
  put-back, only when the new bill holds no other money (`itemsPaymentSource`,
  `bill-payments.ts:2538`), and the merge, whose source may hold no payment
  (`refuseBillWithPayments`, `bill-actions.ts:142`). Both check the bill the lines arrive on
  (`working-order-transfer.ts:205`).
- [ ] **Step 3: Run** Step 1's files, `src/finish-party-service.test.ts src/give-back.test.ts
  src/set-menu-edits.test.ts src/set-menu-regroup.test.ts src/set-menu-regroup-paths.test.ts
  src/set-menu-regroup-moves.test.ts src/split-after-print.test.ts
  src/split-after-print.money.test.ts`, the server typecheck, and from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/product-file-size.test.ts` (lower `bill-payments.ts` to the
  limit it names; 2,726 lines in the trial, so 2,750).
- [ ] **Step 4: Commit** `git commit -s -m "Remove the guards that kept a dish paid for by item on its bill"`.

### Task 7 (PR 3): Storage

**Files:** `packages/db/src/schema/bill-payments.ts` (`billPaymentKind` `:22` → `["contribution",
"share"]`, which narrows `bill_payments_kind_ck`; the table `:117-144`; the doc comment `:26-38`),
`packages/db/src/index.ts:205`, `packages/db/src/classification.ts:76-80`,
`packages/db/triggers/core.sql` (the `old.kind <> 'items'` clauses `:55` and `:74` of
`bill_payments_guard_update`; nothing else in it changes),
`packages/migrations/migrations.manifest.json` (core's `appendOnlyTables`),
`scripts/append-only-triggers.test.ts:40`, `scripts/schema-constraints.test.ts:57`, `:485-486`,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (one name in `REMOVED_TABLES`; the
captures under `packages/country-es/test-fixtures/demo/` are frozen and are NOT edited), then
`packages/db/drizzle/*` and `scripts/migration-baseline-epoch.json` by
`pnpm --filter @waitron/server migration-baseline rebuild --set core`. No other set names the kind or
the table. Dropping an append-only table needs no trigger work: the starting migration holds none for
it; they are created from the manifest's list when migrating. A venue's old file is refused at start
(CLAUDE.md §3), not migrated.

- [ ] **Step 1: The test first:** in `packages/db/src/schema/bill-payments.test.ts`, the
  unknown-kind row `:350` gains a sibling `["the old items kind", { kind: "items" },
  "bill_payments_kind_ck"]`; `:429` goes; `:586` becomes `["the kind", "kind = 'share'"]`; the trigger
  cases `:668` and `:1363` and the `bill_payment_lines` block `:805-871` are deleted. Expected: the new
  row FAILS.
- [ ] **Step 2: Change the schema and triggers, rebuild, then confirm by hand** that the diff of
  `0000_baseline.sql` is only the dropped table and index, the CHECK and the two clauses (16 lines in
  the trial).
- [ ] **Step 3: Run** `pnpm --filter @waitron/db exec vitest run src/schema/bill-payments.test.ts`;
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts
  scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/module-graph-honesty.test.ts
  scripts/id-columns-are-references.test.ts scripts/write-path-tables.test.ts
  scripts/journal-monotonic.test.ts scripts/live-subscriptions.test.ts
  scripts/product-file-size.test.ts`, then `scripts/migration-upgrade.test.ts` on its own;
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`;
  `pnpm --filter @waitron/migrations exec vitest run`; `pnpm --filter @waitron/country-es exec vitest
  run src/demo-testing.test.ts`; `pnpm --filter @waitron/server exec vitest run
  scripts/demo-seed/seed.madrid-baseline.test.ts`; `pnpm --filter @waitron/fiscal-verifactu exec vitest
  run inmutabilidad src/write-path.e2e.test.ts` (UNEDITED); typechecks of `db`, `payments`,
  `fiscal-verifactu`, `server`, `till`. Read each `Tests` count.
- [ ] **Step 4: Commit** `git commit -s -m "Drop the items payment kind and its lines from the database"`.

### Task 8 (PR 3): Say it

**Files:** `docs/developers/design-system.md` (`:6497` "or paid mark", `:6501-6504`, the first reason at
`:6545-6548`, `:6573` "a dish is paid or", `:6576-6577` "A paid dish stays ticked…"),
`docs/operations/payments.md:6-8` (a part-paid bill's dishes move down to what it has received; a printed
bill is reopened first, so its Pay items also moves the dishes), `docs/backlog/menu.md` (`:771` loses "paid
for by item"; the Piece 1 paragraph `:773` loses "Left: pull request 3…" and, if it is the last piece-1
point, is cut to what later pieces need), `docs/backlog/till.md:913-917` (Item payment is no longer a
part-of-row path there), `docs/superpowers/specs/2026-09-26-bill-payments-design.md` and
`docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md` (one dated line each: the items
kind and `bill_payment_lines` were removed; do not rewrite). The guides need nothing: no English or
Spanish guide names the paid mark, the choices or an items refund (checked 25 November with
`rg -i "has a payment|tiene un pago|paid for by item|pagad.* por art" apps/server/src/guide`).

- [ ] **Step 1: Look.** On a Claude slot, at till and phone width, light and dark: a table's Pay >
  Items (all, some, part of a line), Move dishes… and Split table on a part-paid bill (the floor stop
  shows; no "Has a payment"), a partial refund of a contribution. Pictures stay in the working folder.
- [ ] **Step 2: Edit; run** `pnpm exec vitest run scripts/claude-md-pointers.test.ts
  scripts/guide-links.test.ts`. Two controls. `git grep -nE "bill_payment_lines|line_paid|refund_not_whole|paidLines|use_pool|full_with_tip"
  -- apps packages scripts` answers only the frozen Madrid captures, `REMOVED_TABLES`
  and the local names in `till-api.fiscal-sale-paths.test.ts` and `finish-party-service.test.ts`.
  `git grep -nE "kind[^,;]{0,12}[\"']items[\"']|[\"']items[\"'] \| \"|[\[(, ]'items'" -- apps/server packages scripts
  ':!packages/country-es/test-fixtures'` answers only the two refused rows of Task 5b and Task 7.
- [ ] **Step 3: Commit** `git commit -s -m "Say in the docs that paying by item moves the dishes"`, then
  `/finish-branch`, full wave with two Codex angles. The PR body says "Resets venues" first, "Changed
  test checks", and `Sale-path read changed:` — the bill balance, an item edit and a move each make one
  or two queries fewer.

### Changed test checks (seed; server files in `apps/server/src/`)

**Re-pointed, every assertion kept (contribution of the same amount unless said):**
`bill-payments-api` — "takes an item payment for a held line…" `:1584` and "sends a held dish one guest
paid for…" `:1644` go to `POST …/item-payments` (probed 25 November: 200, the Cake's group stays held
on the paid bill, firing it answers 200 and makes a queued ticket, the table's bill owes 35.00; the
`line_paid`/`paidLines` lines go); `:3956` keeps its added-tip half on a contribution; `:4457` keeps that a
payment holding only a tip is refunded tip-only (a contribution with 0.00 applied; its lines and
`paidLines` go); the balance shapes `:668`, `:686` lose `paidLines`. `bill-payments` — `:639` (contribution
25.00: dropping the Steak is refused `bill.received_exceeds_total`, dropping the Beer is saved; see Task 6,
never cut it); `:1533` loses its `items` row and its line rows. `bill-payments.card` — "change versus tip"
×3 `:505-569`, `:930`.
`bill-unsent` — `:217`; `:318` asks a share; the loop `:340` loses `items`. `bill-editing.table-actions`
— the race `:818` pays with `payForItems` (party and revision named): both losers are
`party.out_of_date` (probed), and pay-first leaves the staying dish alone on the table's bill.
`adjustments-apply` — `:4205` keeps "comps the unpaid one" with a contribution; its refusal half goes.
`draft-discard` `setup(true)`; `line-cancel-api` `:1071` (×2), `:1118`, `:1160`; `move-dishes` `:401`,
`:428`; `party-table-actions` `:2587` (loses `paidLines`), `partPaid` `:3033`; `till-api.bill-actions`
`:335` (share), `:444`; `till-api.groups` `:2391`'s paid = 1 half (a contribution of 18.00; the five rows
and the kept id stay); `till-api.table-actions` `payItems` `:1628` (loses `:1757`);
`set-menu-adjustments` `:200` loses its third `fix`, "or item-paid" in its title and `payByItems` `:88`;
`set-menu-money` `:208` loses its `items` row.
**Re-pointed, fiscal:** `bill-payments.after-ticket` `:117`; `order-dining.filing` `:156` (two amounts of
the same cents: same previews, same rates; titled "a takeaway bill paid in two amounts");
`order-dining.switch` `:236`, `:570` (share);
`order-portions.lifecycle` `:679` (share); `split-table.fiscal` `payFor` `:237` (its parametrised "an
item payment" row goes, "a contribution" stays); `till-api.move-bill` `:474` (its line row goes, the one
invoice of both dishes stays); `till-api.move-dishes` `:446` ×3 (loses `paidLines`).

**Deleted with the writer (they assert the removed payment itself, or need one to reach a guard):**
`adjustments-bill-payments` `:157`, `:183`; `advance-money` `:497` (an items payer's advance);
`bill-overpaid` `:572`; `bill-payments-api` `:1460`–`:1532` with `steakPaid`, `:1724`, `:1739`, the block
`:1754`, `:3994`, `:4423`, `:4484`, `:5620`; `bill-payments` `:594`, `:681`, `:711`, `:739`, `:3161`;
`bill-payments.card` the block `:572` ("the steak") and the body rows "lines that are not a list", "a
line numbered 0", "lines on a contribution", "an unknown choice"; `line-cancel-api` `:719`;
`move-dishes` `:667`, `:985`; `order-portions.adjustments` `:985`, `:1322`; `order-portions.counter`
`:532` (its insert goes; a 3,277-burger `payForItems` was probed as far as the invoice limit);
`party-bill-actions` `:294`; `party-table-actions` `:3079`; `set-menu-regroup` `:536`;
`split-after-print.money` `:349`; `till-api.groups` `:2391`'s paid = 2 half;
`till-api.move-dishes` `:301`; `till-api.table-actions` `:1324`. In
`packages/orders-sales/src/bill-allocation.test.ts`: the block `:350`, `:501`, the "items costing
nothing" row; in Task 5b its other items cases become a contribution of the same amount, and five
`choice: null` go.
**Deleted with the guards (they insert the rows directly):** `draft-split` `:339`'s `items` row and
`frozen()`'s `allocations` (every case in that file reads it); `set-menu-bill` `:212`; `tabs` `:3039`.
**With the storage:** as Task 7, Step 1.

**Till 1:** delete `widgets/bill-pay-dialog.test.ts` `:344`, `:410`, `:436`'s paid half (the empty list
keeps a case), `:899`, the choices block `:945`, `:1098`, `:1117`, `:3372`; re-point `:237` (the re-read's line
quantity fell); `bill-pay-dialog.a11y.test.ts` `:369` and the choose rows `:1285`; `bill-refund-dialog`
`:213` and its a11y `:88`; `state/bill-payment.test.ts` `:45`'s items half, `:139`;
`pay-for-items.test.ts` `:138`, and `takePayment`'s calls gain the choice; `api/client.test.ts` `:6438`
previews a share and answers an allocation; `till-app-bill-payments.test.ts` `:5951` says
`kind: "share"`. About 50 `choice: null` fixture lines go (`git grep -n "choice: null" apps/till`); the
typecheck names these outside the files above: `till-app-handheld-pay.test.ts:97`,
`till-app-bill-payments.test.ts:6067`, `bill-pay-dialog.unsaved.test.ts:144,266`,
`widgets/payment-leading-zeros.test.ts:158`, `pay-for-items.test.ts:186,235`, `test/bill-pay-app.ts:220`.
**Till 2a:** delete `portion-selection` `:180`, `:284`, `:429`; `split-selection` `:258`, `:303`, `:382`,
`:1160`; `portion-picker` `:249`, `:293`, `:650`; `split-picker` `:225`; the paid states of the pickers'
a11y files. Re-point: `split-selection` `:800` ("draws rows from the read's lines and balance") keeps
its subject with the floor as the stop; at a dish that left the bill, `.move-dishes` `:597`,
`.split-table` `:1329` (without its reason text), `:1354`, the helper `paidSalad` `:2196`, `:2914`,
`.split-table.unsaved` `:825`, `split-selection` `:893`, `:905`, `:917`; `split-selection` `:979` becomes
a contribution. `till-app-move-dishes` `:617`, `:671`, `:1009` use the money floor. The test keys' third
argument (`paidQuantities`) goes.
**Till 2b:** delete `till-table-order-screen.bill-payments`'s block `:401` (its `:508` keeps the held
half); `.sent-portions` `:392`; `.sent-fallback`'s a11y `:111`; `.sent-change` `:266`, `:297` and the "a
payment for it lands" row `:1017` (`:246` is a settled bill and stays; `:1198` loses only its paid mark);
`state/bill-payment.test.ts` `:655`; the file `.current-list-retirement.a11y.test.ts`, whose only test is
the mark (a held dish's window keeps its axe checks in `.sent-actions.a11y.test.ts:44` and
`.drawer-placement-retirement.a11y.test.ts`). Re-point `.sent-fallback` `:114`: on a part-paid bill the
read-only list still has no buttons.
**Till 3:** `bill.line_paid` → `bill.received_exceeds_total` in `till-app-bill-payments` `:2567`,
`:4370`, `till-app-move-dishes` `:652`, `:733`, `:1009`, `:1318`, `till-app-split-table`
`:2465`–`:3225`, `till-app-adjustments`, `till-app-table-service` `:1519`, `adjustment-dialog` and its
a11y; rows dropped in `codes.test.ts:311`, `refund-wording.test.ts` `:7` (Task 1's `whole_only`), `:71`,
and `till-app-split-table` `:2439`. `split.refused_payments` goes from `cancel-credit-dialog.test.ts`
(`:457`'s row, `:557`) and `till-app-parties-closing.test.ts` `:841`.

### Review Focus (PR 3)

1. **A guard that protected something else.** Eight `refusePaidLines` sites go; each must still refuse
   what money on the bill forbids (`bill.received_exceeds_total`) and a card in flight. Task 6 Steps 1
   and 2.
2. **Give back and Keep as tip.** `kind` conditions go from the refund, Keep as tip and the two trigger
   clauses: a partial refund and a kept tip now apply to every bill payment. Nothing else in
   `bill_payments_guard_update` may move (advances, tenders and pending refunds still refuse).
3. **A replay.** A resend of an ordinary payment, and of Pay for items, answers the first one's payment
   across the change: the fingerprint's remaining keys are the same.
4. **What is charged and filed.** The allocation for a share and a contribution, cash and card, tips on
   and off, is unchanged to the cent; a bill's invoice is still issued once, when received equals due.
   Items never become a whole-bill payment of the table's bill (PR3-D3).
5. **The till's stops on a part-paid bill.** Move dishes and Split table still refuse picks below the
   money floor, and a held or presented bill; a whole-bill tick still carries payments.
6. **A stale name.** `bill_payment_lines` in a live-update list breaks `scripts/live-subscriptions`,
   in the append-only list breaks start; a till left open from before PR 4 gets a plain 400.

_2026-11-24, for the piece that runs the bill's set-menu grouping on the server: PR 1's put-back moves lines with `moveOrderLines` in `movedItemsBack` (`bill-payments.ts`), not through `moveDishes`; Pay for items splits part of a line with `splitLinesWithinOrder` (`pay-for-items.ts`); the preview prices picks in `priceItemPicks` (`pay-for-items.ts`). Each must regroup or price with the grouping too._
_2026-11-25: #4313 landed the moves' regrouping; the preview is lane B's PR 2c._
