# A555: no build plan yet. The approved design no longer fits the landed payment flow

**Status: owner question open, 2026-11-12.** Written in place of an implementation plan, because the
re-map against current `main` (`3e7dcf4b6d`) found that the 2026-10-21 design
([spec](../specs/2026-10-21-a555-counter-invoice-delivery-design.md)) no longer describes what is
left to build. Nothing below changes product code. "READ" means the code was read, not run; "RUN"
means a command was run and its output read.

## What the counter does today

1. **The design has already been overtaken, as its own header says.** Spec lines 1–14 (READ) say
   A739 "now asks after settlement" and "Do not ask A555's old A/B timing question". A739's
   approved contract says Print and Email are separate, explicit actions after payment, and that
   choosing an option sends nothing (`../specs/2026-10-22-a739-owner-payment-and-receipt-flow.md:28`;
   `2026-11-10-a739-current-payment-flow.md:7`, READ). The same plan rules out any "new protocol,
   choice record" (`:9`, READ). The design's per-payment snapshot of the delivery choice, frozen
   when payment is accepted (spec, "State and transaction boundaries"), would be exactly that.
2. **Paying a counter bill in the shared Pay window already issues a full invoice.** On an order
   screen, Pay opens the window whenever the total is above zero
   (`apps/till/src/screens/till-counter-screen.ts:422`, `apps/till/src/widgets/tender-pay.ts:931-948`,
   READ). Before the window opens, `#onCounterBillPay` saves the till's Full invoice choice
   (recipient and delivery) to the order (`apps/till/src/till-app.ts:19117-19126`, READ; added by
   #2725, A739 cut 6, per `git blame`). Saving that choice has no counter restriction
   (`apps/server/src/working-order.ts:4303-4364`, READ). The last part payment issues the invoice
   through `selectOrderInvoice` (`apps/server/src/bill-payments.ts:747`, READ). **RUN:** a throwaway
   test, deleted afterwards, parked a counter order, saved an F1 choice for "North Coast Studio SL",
   and paid EUR3.00 cash with `POST /api/working-orders/:id/payments`. The answer was 200. The order
   got one sale carrying `counterpartyTaxId: "B12345674"` and the recipient's name. The control, the
   same order left as F2, got a sale with no counterparty, filed in a different series. If the
   counter were still refused, the F1 case would have been answered 409
   `sale.full_invoice_unavailable` and left no sale.
3. **An Email or A4 original chosen before payment is still sent automatically.** Issuance calls
   `enqueueSaleReceipt` (`bill-payments.ts:826,846`), which reserves the original that was chosen
   before payment (`apps/server/src/receipt-print.ts:263-283`,
   `apps/server/src/invoice-choice-delivery.ts:68-99`, READ). **RUN:** the same test wrote an email
   delivery choice straight onto the order row, which skips the route's check that email is
   available. Payment then left one `invoice_deliveries` row: `medium: "email"`, key
   `issuance:<saleId>`, status `queued`. The F2 control added none.
4. **A "Receipt printer" original chosen before payment now prints nothing by itself.** The
   pre-payment dialog still offers Receipt printer, A4 and Email
   (`apps/till/src/widgets/invoice-recipient-dialog.ts:186-217`, READ). Since A739 cut 7b, a
   receipt-medium choice reserves nothing (`invoice-choice-delivery.ts:83`, READ). The original
   prints only if someone presses Print in the after-payment window
   (`apps/till/src/widgets/settlement-document-dialog.ts:63-110`, READ). If that window is
   dismissed, which counts as None, no paper original is made.
5. **What still refuses an F1:** direct `POST /api/sales` and `POST /api/pay`
   (`apps/server/src/till-sale.ts:554-561`, `:725`, `:739`, `:1205-1207`), collecting an unissued
   order through `/collect` (`:2343`) and a counter transfer close
   (`apps/server/src/transfer-close.ts:152`) (all READ). On the order screen the till reaches the
   direct routes only when the bill totals zero, because any bill above zero goes through the
   window (tender-pay above, READ). The existing refusal tests in
   `apps/server/src/invoice-recipient-flow.e2e.test.ts:134-180` call those routes directly.
   `apps/server/src/counter-bill-payments.test.ts` has no F1 case at all (READ by grep).
6. **The backlog is out of date.** `docs/backlog.md:280` and `docs/backlog/fiscal.md:278-283`
   still say counter sales refuse F1.

**Unplanned change to flag:** A739's contract says to "keep its actual route scope, including any
counter restriction still owned by A555" (spec `:47`). Cut 6 opened the counter's main payment
route to F1 without saying so. It uses the same issuing code as table bills, and nothing protected
changed. But no recorded decision opened it, and no test pins it.

## Options

- **A. Accept what main does (recommended).** The full invoice and an Email or A4 original are
  chosen before Pay, and the original is sent when the bill is fully paid. Paper is an explicit
  Print in the after-payment window. Build one small PR:
  - a server test and a till test pinning counter F1 through the window, including a partial
    payment first and the queued email original;
  - replace the pre-payment "Receipt printer" option, which does nothing now, with wording that
    says paper is chosen after payment. That dialog is shared with table bills;
  - keep the zero-total refusal and say so;
  - correct the backlog lines.

  Rough size: production 40–80 lines, tests 150–250, docs about 30. This is an estimate, not
  measured. None of `computeHuella`, the chain, invoice numbering, `registros_facturacion` or
  `recordSale`/`recordCorrection`/`recordSubstitution` changes.
- **B. Follow A739's "explicit only" rule strictly.** Before Pay, ask only for the customer's
  details; every original, email included, is sent from the after-payment window. This retires
  the delivery saved on the order, which today is a column on `working_orders`. Removing it
  rebuilds that migration set and changes table bills and unpaid departures too. Medium size,
  not estimated.
- **C. Build the 2026-10-21 design as written:** the delivery chosen inside the Pay window, plus a
  frozen per-payment snapshot. Large, several PRs. It contradicts A739 plan `:9`.

## The one owner question

**A customer at the counter buys EUR18.70 of food and asks for a full invoice to North Coast Studio
SL by email. Should the email be chosen before payment and sent by itself (A), or sent only when
staff press Email after payment (B)?**

- **Under A, today's behaviour:** before Pay, the waiter taps Full invoice and enters the company's
  tax number, name and address. They pick Email and type billing@example.invalid, take EUR20 cash,
  and the invoice is issued and its email queued. The window after payment shows the recipient and
  the email's status, and Print is there if the customer also wants paper. If the waiter closes
  that window, the email still goes. Choosing A also accepts that counter full invoices have been
  live through the Pay window since #2725.
- **Under B:** before Pay, the waiter enters only the company details and takes EUR20. In the
  window after payment they tap Full invoice, then Email, and type the address. If the window is
  closed first, nothing is sent until someone finds the bill later and sends it.

Once the owner answers, the plan for that option is written from this note. A needs no further
design. B needs a short design for retiring the saved delivery.
