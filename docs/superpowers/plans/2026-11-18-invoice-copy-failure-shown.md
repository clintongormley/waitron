# Show staff when a chosen invoice copy could not be queued

Status: plan, 2026-11-18. Watcher-queued item from `docs/backlog.md` (Printers section, "Show a
failed automatic invoice copy to staff") and its detail in `docs/backlog/printers.md`. The owner
lands the eventual pull request.

## Outcome

If this is built (Part B): after a full invoice is paid or issued, if the email or office-printer
copy chosen for it was never queued, the window after payment and the sale's ticket say so in words:
which copy was chosen, that nothing was sent, and what the buttons already on that window do (send by
email, print on this till's invoice printer). Nothing is sent by itself, and paper is never
picked in place of the chosen copy.

**The recommendation (DEFAULT 1) is not to build it.** The tracing below found no event at a venue that
leaves a chosen copy unqueued: a removed printer, removed contact or removed invoice-printer listing
each leaves a delivery row that the till already shows. Only a forced refusal (a test trigger), and
possibly a full disk (not measured), reach the silent path. Part A closes the backlog entry with that
evidence. Part B is the build if the watcher overrules.

## What happens today (traced on main `d8f2a8d2e8`)

**Where the chosen copy is queued.** A full invoice's copy choice (email address or office A4
printer) is saved on the bill or counter order before payment by `setOrderInvoiceChoice`
(`apps/server/src/working-order.ts:4867-4931`), checked by `checkedInvoiceChoiceDelivery`
(`apps/server/src/invoice-choice-delivery.ts:26-65`), which always records the staff member
(`personId`) for email and A4. Once the invoice is issued, `reserveStagedInvoiceDelivery`
(`invoice-choice-delivery.ts:68-98`) writes an `invoice_deliveries` row under request key
`issuance:<saleId>`. It runs inside `optionalDocument` (`apps/server/src/optional-document.ts:19-55`),
which rolls back only that write when it fails, logs `receipt.optional_document_failed` and lets the
sale commit. That is deliberate: on a card sale "a throw here would roll back a sale whose card P2
already charged" (`apps/server/src/till-sale.ts:1884-1885`).

**Every path that calls it, and what the till gets back.** All five call it in the same transaction
that records the sale. None of the answers says anything about the copy:

| Path | Call | Answer to the till |
| --- | --- | --- |
| Counter/table pay with cash or hand-keyed card, `fileImmediateSale` | `till-sale.ts:1161` → `enqueueSaleReceipt` | the ticket (`till-sale.ts:1165`) |
| Connected card captured, `finalizeCapture` | `till-sale.ts:1886` | the ticket (`till-sale.ts:1887`) |
| Connected card recovery, `finalizeRecovery` | `till-sale.ts:2039` | `{ outcome: "captured", ticket }` (`till-sale.ts:2040`) |
| Bill payments completing a bill, `issueWhenFullyPaid` | `apps/server/src/bill-payments.ts:871`, `:891` | `{ invoice, total }` (`bill-payments.ts:872`, `:892`) |
| Unpaid departure and deferred close, `issueUnpaidInvoice` | `working-order.ts:7847` (callers `unpaid-departure.ts:129`, `deferred-close.ts:160`) | `IssuedInvoice` (`working-order.ts:7848`) |

For a sale issued unpaid, `issueWhenFullyPaid` calls `enqueueSaleReceipt` again at payment
(`bill-payments.ts:871`); the same request key replays the earlier row (`apps/server/src/invoice-delivery.ts:65-71`).

**The backlog's "then skips the paper original" is no longer true.** Since #2804 (`5635f69850`,
2026-11-11) `enqueueSaleReceipt` (`apps/server/src/receipt-print.ts:263-283`) never prints a paper
original: it queues only a prepay collection-number slip and the chosen copy. Paper is now always a
person's choice in the window after payment (#2791, `568b471070`). So a failed chosen copy loses no
paper; there was none to lose.

**What the till shows after payment.** Every payment completion opens
`till-settlement-document-dialog` (`apps/till/src/widgets/settlement-document-dialog.ts`) through
`#showTicket` (`apps/till/src/till-app.ts:22214-22253`), which reads
`GET /api/sales/:id/deliveries` (`till-app.ts:10542-10551`, `10575-10606`;
route `apps/server/src/till-api.ts:2554-2585`). For a full invoice the dialog's delivery section
(`apps/till/src/screens/till-ticket-view.ts:1105-1175`, `998-1076`) shows a status line for the
newest attempt (`deliveryWords`, `till-ticket-view.ts:376-401`: "Sending the invoice.", "Waiting for
the office printer.", "Not delivered.") and the existing actions. With no delivery row at all it
shows "Full invoice not delivered", "The original has not been sent to a printer." and **Send by
email** / **Print on {printer}**. That is the same as for a sale where nobody chose a copy, so staff
cannot tell that the chosen copy went nowhere. This is from reading the view, not from running it
in a browser.

**Sending another copy already exists.** `POST /api/sales/:id/deliveries` with `medium: "email"` or
`"print"` (`till-api.ts:2587-2627`, through `requestEmailDelivery` / `requestPrintDelivery` in
`apps/server/src/invoice-delivery-actions.ts:51`, `:114`), "Send the email again" for a failed email,
and "receipt instead" for a waiting one. All of them work out original versus duplicate in
`reserveInvoiceDelivery` (`invoice-delivery.ts:137-147`). The till offers them from the status's
`actions` (`apps/server/src/invoice-delivery-status.ts:255-342`). Part B reuses them unchanged.

**Which refusals can happen.** I read every refusal in `reserveInvoiceDelivery`
(`invoice-delivery.ts:43-165`) for a chosen email or A4 copy:

- `invoice_delivery.not_found` and `full_invoice_required`: the sale was just recorded, and only a sale
  with a customer tax number reaches the write (`invoice-choice-delivery.ts:83`). An order saved as a
  full invoice always issues one (`apps/server/src/invoice-selection.ts:115-130`). Neither can happen.
- `invoice_delivery.printer_invalid`: only when the office printer's row is missing. Deleting one only
  switches it off (`apps/server/src/page-printers.ts:156-163`), and issuance accepts a switched-off
  printer and records a failed row instead (`invoice-delivery.ts:73-87`). No code path removes the row.
- `invoice_delivery.active`: needs another queued delivery, or a paper original that is queued or
  printing, for a sale created in the same transaction. A collection-number slip carries no sale id
  (`receipt-print.ts:299`). It cannot happen at issuance.
- Missing staff member (`management.request_invalid`, `operatorId`): the saved choice always carries
  one (`invoice-choice-delivery.ts:49-50`, `:55-64`). The only tests that reach it write the choice as
  hand-made JSON (`apps/server/src/receipt-print.test.ts`, the two "names no staff member" cases).
- Email: the write does not check the mail transport or the department contact at all. Those are
  checked only when the choice is saved.
- No triggers exist on `invoice_deliveries` (a grep of the packages' `.sql` files found none), and its
  CHECKs (`packages/db/src/schema/invoice-deliveries.ts:113-125`) hold for every saved choice.

**Experiment (run 2026-11-18, then discarded).** In a throwaway worktree of `d8f2a8d2e8`, four
cases were appended to `apps/server/src/bill-payments.test.ts`, each paying a bill with a chosen copy
through `completeBillPayment`, then reading the sale's delivery rows and capturing `console.warn`.
Command: `pnpm exec vitest run src/bill-payments.test.ts -t "PROBE"` in `apps/server`, giving
`4 passed | 112 skipped`.

| Case | Rows after payment | `receipt.optional_document_failed` |
| --- | --- | --- |
| Email chosen, then every department contact removed | `email queued` | none |
| A4 chosen, then the printer deleted through `deletePagePrinter` | `a4 failed printer_disabled` | none |
| A4 chosen, then the till's invoice-printer listing removed | `a4 queued` | none |
| Control: a trigger refuses every insert into `invoice_deliveries` | none | one, `reserveStagedInvoiceDelivery` |

The control shows the probe can see a silent omission; the three real events do not produce one.
Each of their rows is already shown by the till's status line ("Sending the invoice.", "Not
delivered." with **Send by email** and **Print**).

**Not established.** (a) Whether a full disk can refuse only this write and still let the sale
commit. `optional-document.ts:15-18` lets an error escape when the engine ended the transaction, and
CLAUDE.md §3 says a full disk sometimes ends the whole transaction; I did not run it on a small
filesystem. (b) The connected-card and counter paths were not run. They call the same
`enqueueSaleReceipt`, so I believe the outcome is the same, but that is from reading. (c) What the
email worker does with a queued row while mail is not set up. The row exists, so the till shows a
line for it; that question belongs to a different item.

**Fiscal records are untouched by either part.** The fiscal packages never read `invoice_deliveries`
or `working_orders`: a grep of `packages/fiscal-verifactu/src` and `packages/core/src/record-sale.ts`
for either name returns nothing. The copy is written after `recordSale` (`packages/core/src/record-sale.ts:162`)
in its own savepoint, and Part B only reads. No change to `registros_facturacion`, the huella
(`packages/fiscal-verifactu/src/registro-row.ts`), invoice numbering or the record builders. **No
migration and no fiscal file change.** The golden huella suite
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad.test.ts` stay unedited.

## Defaults the watcher may overrule

1. **Do not build; close the item (Part A).** Only a forced refusal reaches the silent path
   (experiment above), and the owner's standing preference is no code for events that do not happen.
   If the watcher wants a safety net against a future defect or the unmeasured full-disk case, run
   Part B instead of Part A's deletion. Part B is small and changes no data.
2. **(Part B) Work it out when the status is read, rather than adding a flag to the payment answers.**
   One change in `readStates` (`invoice-delivery-status.ts:146-212`) covers all five paths, replays,
   reloads and a sale opened later from Find bill. A flag in the answer would need five answers and
   the till's twenty `#showTicket` callers, and would be lost on a replay or reload. It needs no new
   column, so no migration.
3. **(Part B) Show it only until somebody acts.** The field is present only while the sale is a full
   invoice, its order holds a chosen email or A4 copy, the sale has **no** delivery row and its paper
   original was never queued. Any send, print or paper original afterwards removes it, and the
   ordinary status line takes over.
4. **(Part B) No pre-filled email address.** The message names the chosen address so staff can type it
   into the existing email window. Pre-filling it would change `till-invoice-email-dialog`'s draft
   handling and its `*.unsaved.test.ts`. That is for a later change if staff ask.
5. **(Part B) No box alert, no staff notice, no new error code.** It is about one sale and is shown on
   that sale's window, which every payment opens. A staff notice (`staffNoticeText`) is for
   box-wide conditions.
6. **(Part B) The A4 wording does not name the printer.** A name would need a join to `page_printers`.
   "the office printer chosen for it" is enough to act on.

## Part A — close the entry (recommended; documentation only)

**Task A1** (one implementer, about 10 tool calls). Delete the bullet "Show a failed automatic
invoice copy to staff" from `docs/backlog.md` (Printers section) and the matching section from
`docs/backlog/printers.md:108-116`. If anything cites the section, move it under that area's
`## Decisions and deliberate limits` instead: one line saying a chosen email or A4 copy is always
recorded as a delivery row (queued, or failed when its printer was switched off), so the till's
status line covers it, with this plan as the receipt. Check with
`git grep -n "show-a-failed-automatic-invoice-copy"`. Commit with `git commit -s`. This is a
`docs/`-only change, so the workflow's documentation exemption applies (branch, fast-forward `main`,
push), unless the owner wants it in a pull request.

## Part B — build (only if DEFAULT 1 is overruled)

Size: about 60–85 production lines (server 25–35, till 25–40, EN/ES strings 8–10) and 130–190 test
lines, plus 4–8 guide lines in each language. Below "medium". Three tasks, each well under 100 tool
calls. Run each focused command with a bare `--` before any `-t` (CLAUDE.md §2's trap), and read the
`Tests` count rather than the exit status.

**Task B1: server status field** (`apps/server`).

1. Failing tests first, in `apps/server/src/invoice-delivery-status.test.ts`. Cases: (a) a full
   invoice whose order holds a chosen email copy, with no delivery row and no paper original, reads
   `chosenNotQueued: { medium: "email", recipient: "customer@example.test" }`; (b) the same for A4
   reads `{ medium: "a4" }`; (c) once a later `requestEmailDelivery` row exists the key is absent;
   (d) once a paper original is queued the key is absent; (e) a chosen copy whose row was written
   (queued, or failed `printer_disabled`) has no key; (f) a sale with no chosen copy, a receipt
   choice, or a simplified invoice has no key. Produce the "no row" state the way the existing
   `receipt-print.test.ts` case "omits a refused staged delivery reservation inside an invoice
   transaction" does (a temporary trigger), since no real event produces it. Say so in the test name.
   Add one route case to `apps/server/src/till-api.deliveries.test.ts` showing the field on
   `GET /api/sales/:id/deliveries`.
2. In `invoice-delivery-status.ts`, extend the existing `found` query in `readStates` with a left join
   from `sales.workingOrderId` to `workingOrders.invoiceDelivery`, so the number of queries does not
   change (`readInvoiceDeliveriesFor` promises a fixed count). Pass the choice to `deliveryStatus` and
   spread `chosenNotQueued` into the result **only when present**. Leaving the key out otherwise keeps
   every existing `toEqual` of the status (about 20 test files across server, till and dashboard)
   unchanged. Add the optional field to `InvoiceDeliveryStatus` (`:47-68`). The condition: the full
   invoice holds a chosen `email`/`a4` copy, `rows.length === 0`, and `receipt.status === "not_queued"`.
3. Run `pnpm --filter @waitron/server exec vitest run src/invoice-delivery-status.test.ts src/till-api.deliveries.test.ts src/receipt-print.test.ts src/bill-payments.test.ts src/orders-invoice-deliveries.test.ts src/alert-sources.invoice-delivery.test.ts src/transaction-receipt-api.test.ts`.
   Mutation control: delete the `rows.length === 0` clause and check that case (c) fails, then
   restore it.

**Task B2: till message** (`apps/till`).

1. Add the optional `chosenNotQueued` to `InvoiceDeliveryStatus` in `apps/till/src/api/client.ts:2585`.
2. Failing tests first, in `apps/till/src/screens/till-ticket-view.test.ts` (shared by the settlement
   dialog) and one case in `apps/till/src/widgets/settlement-document-dialog.test.ts`: the message
   appears with `role="alert"` above the actions, in English and Spanish (restore the language after
   each case, §4), for email with the address, and for A4. Check that its second sentence names only
   the actions shown: email and print, email only, print only, neither. With neither, it says the sale
   can be opened from Find bill on a till with an invoice printer. Pressing **Send by email** or
   **Print** still sends the existing request unchanged, and nothing is sent without a press. Add the
   alert state to `till-ticket-view.a11y.test.ts` in both themes.
3. Render it in `renderDelivery` (`till-ticket-view.ts:998`), worked out from the same flags the
   buttons use (`email`, `invoicePrintersEnabled`/`renderInvoicePrint`'s printer). Keep the existing
   "Full invoice not delivered" heading.
4. Strings in `apps/till/src/i18n/strings.ts`, English and Spanish twins. These drafts follow
   CLAUDE.md §3's refusal rule (say what happened, then what each choice does) and may be tightened
   in review:
   - `invoice.chosen_email_not_sent`: "The invoice was not emailed to {recipient} as chosen. Nothing
     was sent." / "La factura no se envió por correo a {recipient} como se eligió. No se envió nada."
   - `invoice.chosen_a4_not_sent`: "The invoice was not sent to the office printer chosen for it.
     Nothing was sent." / "La factura no se envió a la impresora de oficina elegida. No se envió nada."
   - `invoice.chosen_next_both`: "Send by email sends it to the address you enter; Print prints it on
     {printer}." / "Enviar por correo la envía a la dirección que escribas; Imprimir la imprime en
     {printer}."
   - `invoice.chosen_next_email`, `invoice.chosen_next_print`, `invoice.chosen_next_none`: the
     one-action and no-action forms of the same sentence. The last: "Open the sale from Find bill on a
     till with an invoice printer to print it." / "Abre la venta desde Buscar cuenta en una caja con
     impresora de facturas para imprimirla."
5. Run `pnpm --filter @waitron/till exec vitest run src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.a11y.test.ts src/widgets/settlement-document-dialog.test.ts src/widgets/settlement-document-dialog.a11y.test.ts src/i18n`
   (browser mode, so check `memory_pressure | grep free` first, §2). Open the dialog in both themes
   and at phone width and look at it.

**Task B3: guides, backlog, guards.**

1. Guide: in `apps/server/src/guide/en/table-service.md` `{#full-invoice}` (the paragraph "When the
   form shows **Delivery** …", around line 131), add one sentence: if the window after payment says the
   chosen copy was not sent, nothing went out, so send it with **Send by email** or print it there.
   Make the same edit to the twin in `apps/server/src/guide/es/table-service.md`. Do not explain the
   cause (CLAUDE.md §3: a guide sentence changes what staff do).
2. Delete the backlog bullet and its `docs/backlog/printers.md` section, as in Part A, and remove
   "then skips the paper original" wherever it remains.
3. Guards: `pnpm exec vitest run scripts/english-only.test.ts scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`
   at the root, and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.
   `scripts/staff-notice-codes.test.ts`, `scripts/errors-reachable.test.ts` and
   `scripts/alert-codes.test.ts` are not affected: no staff-notice code, error code or alert code is
   added (DEFAULT 5). Run them once anyway to confirm. Before the pull request, run
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
   unedited and expect them to pass, and check `git diff --stat main` shows nothing under
   `packages/fiscal*`, `packages/core`, `packages/db/src/schema` or any migration.

Risk: none of CLAUDE.md's risk triggers apply (no fiscal invariant, migration, permission or
cross-package contract; the field is server→till only and optional). This takes the light review
path: the plan-against-spec read and the Codex run-it seat in `/finish-branch`.
