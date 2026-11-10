# A275 Task 4: every screen and document names a transfer-closed bill "To be paid by transfer"

**Status: proposed 2026-11-11, for the watcher; nothing built.** Branch `feat/a275-transfer-labels`.
Tasks 0–2 (#2664) and Task 3 (#2740) landed: `closeBillByTransferTx` (`apps/server/src/transfer-close.ts`)
issues or reuses the invoice and settles the sale with one tender row whose method is `transfer`
(`transfer-close.ts:181–193`), and `POST /api/working-orders/:id/close-by-transfer` can call it.

## Authority

- Design approved by the owner 2026-10-22 15:55 ("A275 looks fine";
  [design §4](../specs/2026-10-22-a275-final-transfer-close-design.md#4-close-history-and-accountant-export):
  label the bill, Orders detail, Find bill, receipt preview/thermal/A4/PDF and copies **To be paid by
  transfer / A pagar por transferencia**; never Paid by card, a debt or bank-confirmed status). H2
  build scope "Yes" 2026-10-22 ~17:20 (lane L `queue.md`, A275). This file cuts the
  [master plan's Task 4](2026-10-22-a275-final-transfer-close.md#task-4-label-every-consumer-and-preserve-remediesdelivery)
  to main at `f7657fbefe` and to the lane's rules (owner 2026-11-08/09: shortest safe path, real
  events only, test a dependency once, tests at most about twice the code).
- Nothing in the fiscal core changes: no hash, chain, numbering, builder, `registros_facturacion`
  trigger or invoice writer. No schema change and no migration: every read below uses the existing
  `tenders.method` value `transfer` (`packages/db/src/schema/sales.ts:44`) or the existing unique key
  `transfer_closures_working_order_key` (`packages/db/src/schema/transfer-closures.ts:72`).

## What a transfer-closed bill shows today

Probe, run 2026-11-11 and deleted: a copy of `till-sale-tender-block.test.ts` seeding a `transfer`
tender. A transfer branch would have passed; it failed with `readTenderBlock` returning
`{ method: "card", charged: "1.00", tip: "0.00", reference: null }`. Everything else below is read,
not run.

| Consumer | Today | Receipt |
| --- | --- | --- |
| `readTenderBlock`, feeding every printed and on-screen receipt | **Card** (anything not cash falls through) | `apps/server/src/till-sale.ts:386–436`; callers `:906` (`readSettledTicket`, used by original print and reprint, `:950–951`), `transaction-receipt.ts:176`, `invoice-document.ts:157` |
| Shared print tree (thermal, A4 page, PDF, image, email, the A4/email delivery a close reserves) | prints **Card** from the block above | `receipt-document.ts:443–452`; one tree: `receipt-ticket.ts:76`, `invoice-page.ts:124`, `invoice-pdf.ts:4` and `invoice-raster.ts:2` via `layoutInvoicePages` |
| Till receipt on screen | **Card**; a fresh (not past) receipt also offers **Payment slip** | `apps/till/src/screens/till-ticket-view.ts:302–344`, `:1347–1350` |
| Dashboard Orders list | status **Paid** / **Pagada** | `apps/server/src/orders-list.ts:123–130`; `apps/dashboard/src/screens/orders-screen.ts:250` |
| Dashboard order detail | tender **Card** | `apps/dashboard/src/widgets/order-detail-dialog.ts:408` |
| Till Find bill, Transactions | **Transfer** / **Transferencia** (not card) | `find-bill-transactions.ts:37–39`; `till-find-bill-screen.ts:434`; strings `:619`, `:2593` |
| Till Find bill, Bills | a Counter bill with kitchen tickets not yet collected: **Paid, not handed over**, "Paid so far" = the total; a seated bill is not listed | `find-bill-bills.ts:56–60`, `:81–82`, `:90` |
| Counter screen, Waiting orders | the same Counter bill: **Paid, not handed over** | `working-order.ts:7696–7730`; `apps/till/src/widgets/counter-waiting.ts:127` |
| Refunds | no refund offered: the read skips any method but cash and card, already tested | `tender-refund-balance.ts:121`; test `tender-refund-balance.test.ts:214–220`; the write refuses through that read (`tender-refund-reservation.ts:142–145`) and `refundTenderKind` (`tender-refund-authorization.ts:46–47`, `:116–117`) |
| Old collect on a settled bill | returns the stored receipt; no tender, drawer or payment | `till-sale.ts:710–712`, `:2093`; drawer only on the take paths `:1092`, `:2310` |
| Outstanding / Unpaid lists | excluded (settled) | `packages/core/src/list-outstanding-sales.ts:51`; `orders-list.ts:304–305` |

## Changes (one PR)

1. **Receipt label.** Add `toBePaidByTransfer` to `RECEIPT_LABEL_KEYS` (`packages/country/src/country.ts`)
   and to all five Spain label sets (`packages/country-es/src/receipt-labels.ts:8,66,124,182,240`):
   en-GB "To be paid by transfer", es-ES "A pagar por transferencia", and drafted ca-ES, gl-ES, eu-ES
   wording named in the PR for the owner to check. The three regional sets cannot be left out:
   `spain.ts:321` offers them as receipt languages and `spain.test.ts:346–355` requires every key in
   each. The fallback (`packages/country-packs/src/registry.ts:181`) is es-ES, so it follows.
2. **Tender block.** Add `{ method: "transfer" }` to `TenderBlock` (`till-sale.ts:303`) and its till
   twin (`apps/till/src/api/client.ts:1027`); `readTenderBlock` returns it for a `transfer` row before
   the card lookup. No amount, tip, reference or change: there is no payment behind it.
3. **Print tree.** `receipt-document.ts`: a `transfer` branch printing `label.toBePaidByTransfer` as
   one text line. Covers thermal, A4, PDF, image, email, original and every copy.
4. **Till receipt.** `renderTender` (`till-ticket-view.ts:302`) gets the same branch. The Payment slip
   condition (`:1347–1350`) already tests `=== "card"`, so it stops offering one with no edit.
5. **Dashboard Orders.** `BILL_STATUS` (`orders-list.ts:123`) gains
   `when tc.id is not null then 'to_be_paid_by_transfer'` after `cancelled` and before `paid`, with
   `left join transfer_closures tc on tc.working_order_id = wo.id`; the value joins `ORDER_STATUSES`
   (`:51`) and the dashboard's `ORDER_STATUS_FILTERS` (`client.ts:2256`), with EN/ES words. So the
   **Paid** filter no longer lists these bills and a new filter does. A voided one still reads Voided.
6. **Dashboard order detail.** `order-detail-dialog.ts:408` maps `transfer` to a new
   `orders.detail.to_be_paid_by_transfer` (EN/ES) instead of falling to Card.
7. **Till Find bill.** Transactions: `find_page.transfer` becomes "To be paid by transfer" / "A pagar
   por transferencia" (the only transfer tenders are these closures, `transfer-close.ts:186`). Bills:
   the settled-Counter branch (`find-bill-bills.ts:81–82`) adds
   `and not exists(select 1 from transfer_closures tc where tc.working_order_id = wo.id)`, as the
   master plan decided, so no "Paid" state, paid amount or debt is shown; `openCount` follows. It
   stays findable under Transactions, and handover stays on the Counter screen.
8. **Counter Waiting orders.** `listCounterWaiting` reads `transfer_closures` for its settled ids and
   sets `closedByTransfer: true` on those rows (`CounterWaitingOrder`, `working-order.ts:7664`, and
   till twin `client.ts:1296`); `counter-waiting.ts:127` then shows a new
   `waiting.transfer_not_handed_over`, "To be paid by transfer, not handed over" / "A pagar por
   transferencia, sin entregar". Hand over is unchanged.

## Tests (red first; `useVenueDb`; transfer-closed bills made by the real `closeBillByTransferTx`)

Use `testing/transfer-close-fixture.ts` (`transferCloseVenue`, `close`, `counterOrder`). If
`counterOrder` fires no kitchen ticket, take the firing step from `counter-handover.test.ts` or
`testing/grouped-counter-order.ts` rather than writing a new helper. Each case names the assertion
that fails when the change is removed:

- `till-sale-tender-block.test.ts`: widen `seedSale`'s method type; a transfer tender reads
  `toEqual({ method: "transfer" })` (today: the card block above).
- `receipt-document.test.ts`: an es-ES transfer result's tree contains "A pagar por transferencia"
  and neither "Tarjeta" nor the reference or charged labels.
- `packages/country-es/src/spain.test.ts`: es-ES `toBePaidByTransfer` is "A pagar por
  transferencia" (the existing every-key case covers the other four sets).
- `till-ticket-view.test.ts`: a transfer receipt shows "To be paid by transfer", no "Card" and no
  `payment-slip` button.
- `orders-list.test.ts`: a closed bill reads `to_be_paid_by_transfer`; the `paid` filter leaves it
  out and the new filter returns it (fails as `paid` without the CASE line).
- `order-detail-dialog.test.ts`: a `transfer` tender shows "To be paid by transfer", not "Card".
- `find-bill-bills.test.ts`: a transfer-closed Counter bill with an uncollected kitchen ticket is
  absent from rows and `openCount`, beside a card-paid one that is listed.
- `counter-handover.test.ts` (or whichever suite reads `listCounterWaiting`) asserts the flag; the
  `counter-waiting` widget test asserts the words.
- Unchanged and run: golden huella and `inmutabilidad`
  (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`),
  `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  empty; the transfer-close suites; `tender-refund-balance.test.ts`; till and dashboard
  `i18n` tests. Typecheck server, till, dashboard, country, country-es. Browser suites after
  `memory_pressure` shows headroom.
- Deletion controls, recorded in the PR, not committed: the `readTenderBlock` branch, the print-tree
  branch, the till branch, the CASE line, the Bills clause; each fails its case.

**Implementer dispatches** (each well under 100 tool calls): (i) changes 1–4; (ii) 5–6; (iii) 7–8.

## Size

One PR: about 80 production lines (labels ~10, tender block and print tree ~10, till ticket ~8,
Orders and dialog ~20 with strings, Find bill and Counter waiting ~30 with strings) and about 170
test lines. Stop for an outside opinion past about 500 written lines. A second PR is not worth it:
splitting receipts (1–4) from lists (5–8) leaves each under 150 lines.

## Left out, and why

- **A new `transfer-close-consumers.test.ts` and a nullable `closureClassification` on every row**
  (master plan): the tender method and one status value carry it; cases go in the existing suites.
- **Per-renderer controls for thermal, A4, PDF and image** (master 4b): one print tree feeds them all
  (table above); tested once at the tree.
- **A crafted direct refund write**: the write refuses through the read, which is already tested
  for `transfer` (`tender-refund-balance.test.ts:214`). Test once at the dependency.
- **Delivery, original print, F1 actor controls, delivery failure and restart** (master 4d): the
  close's only document step is the existing one inside `issueUnpaidInvoice`, which reserves a
  staged A4 or email delivery for a bill with a recipient (`working-order.ts:7412` →
  `invoice-choice-delivery.ts:68–98`); that document is drawn by the print tree, so change 3 gives it
  the wording. The paper original is printed by the till after the answer, and no till sends the
  close until Task 7, so original print, actors and retries move there. The delivery files write no
  order, sale or closure row (grep of `invoice-delivery*.ts`, `invoice-email*.ts`,
  `invoice-choice-delivery.ts` for `update(workingOrders)`, `update(sales)`, `transferClosures`: no
  match), so a failed send cannot reopen the bill. Counter F1 still refuses
  `sale.full_invoice_unavailable` (`working-order.ts:4583–4584`).
- **Old collect on a transfer-closed bill**: needs a second till racing Task 7's button; it already
  returns the stored receipt with no money effect, which after change 2 reads "To be paid by
  transfer".
- **Guides**: nothing staff do changes until Task 7, whose 7c writes the transfer sections. No guide
  names these statuses today: grep of `apps/server/src/guide/en/` for the changed words finds only
  `table-service.md:154`, about a paid collect-at-counter order, still true.
- Reports, close of day and export: Tasks 5–6.

## For the watcher

1. **Build now, or with Task 7?** No till sends the close until Task 7 (after A739 in lane F), so
   today no venue can produce such a bill. A739 touched `till-sale.ts` and `till-ticket-view.ts` on
   2026-11-10 (`59b55825bd`); this task edits a few lines in each. **Recommend now**, as one small PR:
   the master plan prepares Tasks 1–6 behind the hidden route, and without it Task 7's first close
   prints "Card" on a €220 bill nobody paid by card.
2. **The other "Paid" marks inside a party.** When a transfer close leaves the party open (Task 3's
   unserved-dish case), the floor card and table sheet say **Paid** (`till-floor-screen.ts:3236`,
   `table-details-sheet.ts:31–34`, `:196`, from `party.outstanding` reaching zero); the split and
   portion pickers have their own "paid" marks (`split-picker.ts:232`, `portion-picker.ts:189`),
   whose source I did not trace. Example: a €220 F2 closed by transfer while dessert is still to
   serve shows **Paid** on the table card until dessert is served and the table clears. **Recommend
   leaving these to Task 7**, whose look at the floor (7d) sits inside the pay flow A739 is reworking;
   bringing them here needs a per-party flag from the floor read.
