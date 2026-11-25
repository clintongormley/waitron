# Reopen a printed bill that had an advance (REOPEN-WITH-ADVANCE)

**Goal.** A table's printed bill, part of which was paid on the payer's own receipt (an *advance*), can be reopened
like any other, with **Reopen bill** or **Pay > Items**. On #4317's head `c7d7bf953f`; lands after it.

**The ask** (`~/waitron-campaign-c/queue.md`): the owner, 25 Nov 13:0x: "I think a bill that has been partially paid
by an advance can still be opened, no? We just can't refund more than the advance no?", then "y" to "lifting the
refusal next, in its own pull request, ahead of COUNTER-SENT-ITEMS. Replaces the owner's "ok" of 24 November to
refusing it (D4's printed half)." The queue's what: "EUR 72 table, EUR 20 advance on its own receipt, bill printed
with a EUR 52 receipt. Reopen bill corrects the EUR 52 receipt in full; the dishes go to the reopened bill, which
counts the EUR 20 (Paid EUR 20, Still to pay EUR 52) and can never go below it (`bill.below_advances`, as open bills
today); an advance given back in full counts nothing and sets no floor; one given back in part counts what is left.
The advance's receipt and its `bill_advances` row are not touched: read the advances of a bill and of the bills it was
reopened from (`reopened_from`, several times over), in every reader of `bill_advances` (bill-advances.ts,
bill-payments.ts, owed-receipts.ts, invoice-corrections.ts, bill-refunds.ts, tender-refund-reservation.ts,
find-bill-transactions.ts, transaction-receipt.ts, accountant-export.ts)." "Pay > Items on such a printed bill works
the same way. The `split.refused_advance` words, the guides' sentence and the test pinning the refusal go. Try:
reopen, pay, reprint, reopen again; give back the advance before and after reopening; the VAT of the final receipt
still deducts the advance at its own rate." "Golden huella unedited."

**What staff can do after.** Reopen such a bill, move or pay for its dishes, give the advance back or take another,
print, pay, reopen again. Nothing new on screen: the reopened bill is an open bill with an advance.

**How I checked.** Both ways of RA-D1 were built in throwaway copies of `c7d7bf953f` (removed) with a probe test
against real Veri\*Factu records. "Run" means there; everything else is read.

## Decisions (X = the printed bill, Y = the bill reopened from it, Z = the one reopened from Y)

- **RA-D1. The advance's payment row moves to Y with the rest of X's money; a bill's advances are those whose payment
  is on it. NEEDS THE WATCHER: the queue chose reading through `reopened_from`.** Reading is not enough in
  `bill_advances`' readers: the money is in `bill_payments`. Run, with `readBillAdvances` and `readPaymentRows`
  following the link and the other payment readers as they are: merging Y into another bill was allowed (204;
  `holdsPayment` saw no payment) and the merged bill filed **140.00 with the 30.00 advance never taken off**; a refund
  of the payment on Y answered `bill.payment_not_found`, not `bill.refund_of_advance`; a resend to X answered X's
  balance; abandoned X still showed the advance as received. The receipts' own amounts came out right both ways.
  Reading needs each payment reader in the table changed. Moving changes one trigger condition, three queries and the
  carry, and gave the right answer on the same probe (merge: `bill.payments_received`). The advance's receipt and
  `bill_advances` row stay as written; its `working_order_id` stays X, the bill it was taken on.
- **RA-D2. The card's provider row stays on X, linked to the advance's sale** (follows). Its link is the advance's,
  not X's ticket's, so `payments.sql` is unchanged. `carryReceivedPayments` passes only payments that paid no advance
  to `carryProviderRows`; without that, a card advance's reopen answers 500 (run). Reconcile's orphan needs a null
  `sale_id`; the refund finds it by sale or payment.
- **RA-D3. Which receipt "took the advance off" skips a receipt whose bill was reopened** (`advancesTakenOff`;
  follows, fiscal). It picks the earliest deducting receipt, which would stay X's for ever and refuse Correct invoice
  on the advance on Y. Run: none while Y is open, then Y's receipt, then Z's. A whole credit that is not a reopen
  leaves the refusal naming the credited receipt, as today (`advance-corrections.test.ts`, L9).
- **RA-D4. Plain refund while printed. NEEDS THE WATCHER/OWNER.** On an unpaid printed bill Correct invoice on the
  advance is refused, but Refund a payment gives the money back with no corrective and the bill still counts it
  (`advance-final.test.ts:388`). So "given back in full counts nothing" holds before printing or on Y, not for this.
  Run: 30.00 refunded on X, then reopened: Y shows Paid 30.00, owes 90.00, and Correct invoice on the advance answers
  `invoice_correction.money_short`. Recommend no code: Y owes what X owed, the advance is filed and must be deducted,
  and the export already lists such a refund (owner, 2026-11-21 16:36). Alternative: refuse reopening (~10 lines and
  words).
- **RA-D5. The floor** (follows). Pay > Items: `bill.below_advances`, rolling the reopen back (run: X still placed, no
  corrective). Moving a dish off Y: today's `bill.received_exceeds_total`. The Items preview still does not say it
  before the payment, as on an open bill.
- **RA-D6. No refusal is added; only the advance check goes** (from the queue). `refuseSplitMoney` keeps money moving,
  a pending bill refund and an `items` payment. A full invoice naming a customer stays refused
  (`requireSupportedCorrection`); an advance on an order set for one stays `advance.full_invoice_unsupported`. Y's
  other actions are an open bill's: merge away refused, left unpaid files 90.00 (run), deferred and day close issue
  it. **Cancel and credit** on a printed bill holding an advance stays `bill.payments_received` (run on X and Y), not
  in the ask. A pending *card* refund of an advance on X does not refuse: it names the advance's sale and tender, and
  completes there as RA-D4.
- **RA-D7. `bill.has_advance`, `split.refused_advance` and their words are deleted** (from the queue; pre-live, so an
  error code may go).
- **RA-D8. Accountant export: an advance names the last receipt not reopened; X's receipt lists no "takes off"**
  (follows RA-D3; say it in the PR). X's receipt and corrective carry opposite VAT rows and cancel.
- **RA-D9. Storage: no column or table; one trigger condition**, so core's starting migration is rebuilt and **venues
  reset** (PR's first line; #4317 already does). Recommend paying that rather than RA-D1's risk.
- **RA-D10. Nothing changes in `packages/core` or `packages/fiscal-verifactu`**: the whole credit already reverses the
  deduction line and negates the filed VAT. Run unedited and green on the moving prototype: `inmutabilidad`,
  `write-path.e2e` (golden huella), `sale-amount.huella`.

## Readers

| Reader | Change | Why |
| --- | --- | --- |
| `bill-advances.ts` `readBillAdvances`, `advanceWithOpenCorrection` | by `bill_payments.working_order_id` | the bill the money counts on; feeds balance, issue, floor and open-correction check (run) |
| `invoice-corrections.ts` `issueAdvanceBill` | same | closing a correction must issue Y, not X |
| `advance-taken-off.ts` `advancesTakenOff` (not in the queue's list) | skip reopened bills' receipts | RA-D3; also serves `refuseTakenOffAdvance`, `refundableAdvanceNumbersTakenOffBy`, `transaction-receipt-api.ts`, give-back |
| `split-after-print-money.ts` | drop the refusal; carry all received; provider rows only of `paidNoAdvance` | RA-D1, RA-D2 |
| `bill-payments.ts` (`readPaymentRows`, `holdsPayment`, `givenBackAfterSettling`, `findSubmission`, settle), `bill-refunds.ts`, `bill-overpaid.ts`, `receipt-payments.ts`, `working-order-invoice.ts`, `payment-slip-print.ts`, `order-dining.ts`, `orders-list.ts`, `find-bill-bills.ts`, `set-menu-bill.ts` | none | read by the payment's bill, now Y; a reading design changes the ones that count money or find the payment |
| `pay-for-items.ts` `refuseBelowAdvances` | none | through `readBillAdvances` |
| `owed-receipts.ts`, `tender-refund-reservation.ts`, `transaction-receipt.ts`, `receipt-adjustments.ts`, `accountant-export.ts` | none | by the advance's sale, never by bill |
| `find-bill-transactions.ts` | none | it lists a bill's own documents, and the advance was taken on X; its zone scope is as today |
| `cash-up.ts`, close of day, VAT, category and top sellers | none | by payment or by sale. VAT, category and top sellers run (30.05 dish, 20.00 advance): printed +30.05, reopened +20.00 all payments on account, paid again +30.05, dish once |
| triggers `bill_payments_guard_update` / `payments_guard_update` | first only | RA-D9 / RA-D2 |

Query plans (node:26-slim, SQLite 3.54.1): both changed reads stay index searches (`bill_payments_submission_key`,
`bill_advances_bill_payment_key`, `working_orders_reopened_from_key`). PR line: `Sale-path read changed:
readBillAdvances finds a bill's advances through its payments`.

## Worked amounts (gross: base + VAT; run unless marked)

| Case | Advance | X's receipt | Its corrective | Y | Final receipt | Sum of records |
| --- | --- | --- | --- | --- | --- | --- |
| 72 at 10% (the final from `deductAdvances`; rest arithmetic) | 20: 18.18+1.82 | 52: 47.27+4.73 | −52: −47.27−4.73 | Paid 20, owes 52 | 52: 47.27+4.73 | 65.45+6.55 |
| Mixed, takeaway: 20 at 10%, 80 at 21% | 50 at 10%: 45.45+4.55 | 50: 10% −27.27−2.73, 21% 66.12+13.88 | 10% +27.27+2.73, 21% −66.12−13.88 | Paid 50, owes 50 | same as X's, after two reopens, 10 paid on Y carried | 18.18+1.82, 66.12+13.88 |
| Mixed, 20 of the 50 given back on Y (R5 −18.18−1.82), then reopened again | left 30 | as above | as above | Paid 30, owes 70 | 70: 10% −9.09−0.91, 21% 66.12+13.88 | as above |
| 120, 10 of 30 given back on Y | left 20 | 90: 81.82+8.18 | −81.82−8.18 | Paid 20, owes 100 | 100: 90.91+9.09 | 109.09+10.91 |
| 120, all 30 given back (on Y, or before printing: X's receipt is then 120) | 0 | 90 or 120 | all of it | Paid 0, no floor | 120: 109.09+10.91 | not summed |
| 120, 30, and 10 more taken on Y, reopened | 30 + 10 | 90 | −90 | Z: Paid 40, owes 80 | 80: 72.73+7.27, two lines | not summed |

Pinned today: 81.82+8.18, 100.00 and the mixed receipt (`advance-final.test.ts`); deduction rules
(`advance-deduction.test.ts`); whole credit of a deduction line (`cancel-credit.test.ts:46`,
`advance-corrections.test.ts`, L9). New: any reopened row, the mixed corrective, the mixed 70.00, 72/20/52. Tenders
(run): advance 50.00 its own; final 10.00 + 40.00; X's and Y's credited receipts none.

## Tasks (each: failing test first; commit `-s`)

1. **The trigger.** `packages/db/triggers/core.sql`: `bill_payments_guard_update`'s move branch drops `NOT exists
   bill_advances` and allows a tender only when a `bill_advances` row names that payment and that tender's sale.
   Rebuild: `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Comments:
   `schema/bill-payments.ts`, `schema/bill-advances.ts` (its `working_order_id` is where it was taken).
   `bill-payments.test.ts`: "…not one that paid an advance" becomes "one that paid an advance moves, its advance's
   tender naming it, its `bill_advances` row unchanged"; add "…not one an advance names when its tender is another
   sale's"; keep "…not one a tender names". Run it, then the guards: `pnpm exec vitest run
   scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts` and `pnpm --filter @waitron/fiscal-verifactu
   exec vitest run src/inmutabilidad.test.ts`.
2. **The money.** The four server files of the readers table. New `apps/server/src/reopen-with-advance.test.ts` on
   `testing/advance-bills.ts` (add a 72.00 dish) and `split-after-print-fixture.ts` (widen its venue type; skip
   `serve` on a reopened bill, whose copies are already served). Run `pnpm --filter @waitron/server exec vitest run
   src/reopen-with-advance.test.ts`. Cases: 72/20/52; mixed, reopened twice with 10.00 paid between, with tenders and
   sum of records; a second advance on Y; a keyed card advance (provider row unchanged); tip on an advance; a resend
   to X answers Y and issues one advance; X shows no money and its receipt reprints −50.00. Replace the two refusals
   in `split-after-print.test.ts:393`, `:446` with the reopen.
3. **Giving back.** Same file: before printing in full; on Y in part and in full; mixed 20 of 50; Correct invoice
   refused on X, allowed on Y, refused once Y is printed, naming Y's receipt; plain refund on Y
   `tender.refund_of_advance`; on X then reopened (RA-D4); bill refund on Y `bill.refund_of_advance`; correction open
   on Y: pay and print refused, then Close with a card taken meanwhile issues Y; export and reports as above. Delete
   each changed clause in turn and see a case fail.
4. **What follows.** `pay-for-items.printed.test.ts`: with an advance pays for a dish (source 30.00 of 120.00);
   `bill.below_advances` leaves X printed, nothing credited; a printed part payment leaves Y overpaid and Keep as tip
   takes none from the advance (run: 130.00 of 120.00, settled); the preview case at `:600` loses its advance half.
   New `reopen-with-advance.bill-actions.test.ts`: merge Y away `bill.payments_received`, move below
   `bill.received_exceeds_total`, left unpaid 90.00.
5. **Words and docs.** Delete `bill.has_advance` (`errors.ts`, `till-api-errors.ts`, `codes.ts`, `client.ts`'s
   comment) and `split.refused_advance` (`strings.ts`, EN/ES; `cancel-credit-dialog.ts`). Guides `table-service.md`
   EN/ES: "Money already paid counts towards it, a payment on its own receipt included." / "Lo ya pagado cuenta para
   ella, también un pago con su propio ticket." and drop the refusal. `docs/backlog/fiscal.md` (the 2026-11-25 note),
   `menu.md`, a dated pointer at PR4-D5 and its owner line. Run the till tests below and `pnpm --filter
   @waitron/server exec vitest run src/guide-content.test.ts`.

**Changed test checks:** `split-after-print.test.ts:393`, `:446`; `pay-for-items.printed.test.ts:600`;
`bill-payments.test.ts` "…not one that paid an advance"; till `cancel-credit-dialog.test.ts:430`,
`till-app-parties-closing.test.ts:934`, `till-app-pay-for-items.test.ts:528` (words only, deleted). On the moving
prototype 46 `apps/server` files ran: only those three server cases failed; likewise only the one in `packages/db`.
Seven root guard files and five `packages/payments` files passed.

**Review focus.** The trigger: may any payment whose tender is on a bill's own receipt now move? Every place that
takes `bill_advances.working_order_id` for the bill the money is on. Is "reopened" the right test in
`advancesTakenOff`, and nothing wider? One deduction per advance per live receipt, at its filed VAT, through any
number of reopens.

**Size.** Product about +30/−35 lines by hand (no till code beyond deleted words), generated baseline about 8 lines,
tests about +450/−110. Should it be smaller? No: the queue's way is larger; this is the smallest that files right.
