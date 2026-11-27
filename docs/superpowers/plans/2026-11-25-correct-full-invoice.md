# CORRECT-FULL-INVOICE: giving money back on a full invoice files a corrective full invoice

Status: cleared by the watcher 2026-11-25 15:52 with changes, all made here (last section). Give money
back's PR 3 landed as #4344 (`c19dad836f`); PR 0 landed as #4363 and PR 1 as #4391; PR 2a landed as #4448 (`059f606cd9`); PR 3 landed as #4496 (`8e8349ba4d`); PR 2b is built on `feat/correct-full-invoice-cancelled-dish`. Design:
[2026-11-25-correct-full-invoice-design.md](../specs/2026-11-25-correct-full-invoice-design.md), with the
owner's answers at the end of its section 6. FISCAL: the owner lands every pull request.

**Base.** `main` at `b8b2a4b6ed`, which holds #4300 (`787644b5f5`), **plus Give money back's PR 3**
(read as `feat/give-money-back-remove-old` at `da73900607`; landed as #4344, `c19dad836f`): it removes the two old windows, and its
Task 15c (`48f6a40bf4`, `08c528338a`, `da73900607`) says "corrective receipt / corrective invoice" in the
till and everywhere else. Server line numbers are `main`'s; till ones are that branch's. "Run" names its
command; the rest was read.

**Words.** A *receipt* is the simplified invoice (AEAT's F2); its corrective is R5. A *full invoice* (F1)
names the customer; its corrective here is **R1**. A *corrective* is the new invoice, with negative
amounts, filed when money goes back. A *plain refund* is money back with no corrective. A *leg* is one
refund that is part of a corrective. The *press* is one Give back. A *link* records how much of a refund
paid a cancelled dish (`adjustment_refunds`).

## 1. Should this exist?

**The ask** (owner, 2026-11-24, told the till cannot correct a full invoice): "but we will build this
functionality, no?" (lane L `queue.md`). Today the money goes back with no corrective, so the business
deducts VAT on money it got back and the venue goes on declaring it. PR 2a files the corrective, 2b answers the
owner's answer 2, PR 3 answer 4, PR 4a, 4b and 5 answer 1. **Simplest alternative:** nothing, and the
accountant issues it by hand outside Waitron's numbering and record chain, which does not meet the ask.
**Approved:** the ask and four answers, quoted in the design. D1 to D11 are lane L's, cleared by the watcher.

| # | Decision |
| --- | --- |
| D1 | Only an F1, or A1407's R4 replacement of one, gets an R1. An F3 (a full invoice made from receipts) stays refused; no route issues one |
| D2 | A full invoice AEAT **refused** waits only while Waitron offers a fix for that refusal, the test the Fiscal filing page makes (`putRightFor`, `put-right.ts:24-54`): today `1100` naming the description; `1112` too once `FULL_INVOICE_REPLACEMENT_ON` is on. Any other refusal keeps today's plain refund and the accountant's list: waiting would never end. Held and set-aside filings (`detenido`, `retenido`) wait; today their money goes back at once |
| D3 | A cancelled dish's money goes on the corrective (owner) and waits with it (D2). **The cancel is paid by no more than the corrective takes off its dish:** 18.50 of goodwill on a cancelled paella and a steak, 18.50 each, prints −9.25 and −9.25, pays 9.25 of the paella's cancel and leaves 9.25 of it owed, as the paper says (section 5) |
| D4 | So it needs **both rights**, money back and corrective: the cancel's own approval no longer covers it, and the window opened after **Cancel and refund** asks a PIN when the person lacks either. A receipt's asks none, as today |
| D5 | A plain refund of payment money that could be corrected is refused (`tender.refund_needs_correction`) on every route, cancelled-dish money included. The extra still goes back plain |
| D6 | **Staff's choice is stored with the give-back:** one column, `invoice_corrections.delivery` (the JSON type `working_orders.invoice_delivery` uses, `orders.ts:47-50`), written when the give-back opens and never changed after. Whatever files it, a late card answer or Finish on another till included, sends it as staff chose; null means nobody chose, and it goes the way the original went. Core's starting migration is rebuilt and every box reset (PR 4b) |
| D7 | Whatever files it sends it, under the person who opened it. On paper it prints where the person filing it is (Finish on another till prints there); with nobody asking, at the device that opened it, and with no receipt printer there, nothing prints and it stays in Find a bill |
| D8 | Preset, and what null sends when it files: the original's delivered attempt, else its newest. Email and A4 are offered only where this device can use them now; otherwise the receipt printer |
| D9 | "is being emailed to …" until the mail server has taken it, then "has been emailed to …" (the watcher's wording of the owner's answer 3) |
| D10 | Dropped (section 6) |
| D11 | The tax-office list keeps R4 for replacements, reworded, and gains R1; Find a bill gains **Corrective invoice** beside **Corrective receipt** |

## 2. The audit: every path that issues a document against an original

Run: `rg -n "recordCorrection|recordReplacement|recordSubstitution|recordVoid"` over non-test code.
`recordCorrection` has three callers (`invoice-corrections.ts:482`, `cancel-credit.ts:65`,
`record-remedy-corrective.ts:55`), `recordReplacement` one, the other two none outside tests. **No path
can file an R5 against a full invoice today:** the admission check (`correction-admission.ts:58-60`), core
(`record-correction.ts:199`, `correction-history.ts:117`) and the record builder (`backend.ts:583-587`)
each refuse. The series is the weak point (`invoice-corrections.ts:481` and `cancel-credit.ts` ask for the
receipts' without looking); The builder picks R1 or R5 from the customer alone and never reads the series, so core is the guard: Task 3 refuses an R1 numbered outside `full_corrective` and an R5 numbered in it, before a number is taken. Printing and resending issue nothing.

| # | Path | After | Held by |
| --- | --- | --- | --- |
| 1 | Give money back: cash (`give-back.ts:540`), separate terminal (`give-back-api.ts:160`), reader (`give-back-reader.ts`) | R1 | Task 5 (from an F1), 8 (from an R4) |
| 2 | Money back under way: cash (`invoice-correction-api.ts:159`), a card leg (`tender-refunds.ts:186`), `/file`, `/close` | R1; ending it files nothing | Task 5 |
| 3 | The sweep, after a late card answer and at start: `invoice-correction-alerts.ts:101-109` | R1 | Task 8 |
| 4 | `POST /api/tender-refunds/:id/retry` (`tender-refund-api.ts:231`; the till reaches it from all three Check agains: the outcome's, `give-back-dialog.ts:636` to `state/give-back.ts:315`; the choices', `give-back-dialog.ts:660` through `checkReceipt` to `state/tender-refund.ts:368`; and Money back under way's, `give-back-under-way.ts:217` to the same line; till lines at `c19dad836f`): settles a leg, files nothing | the sweep files one R1 | Task 8 |
| 5 | The dashboard's `/payments/tender-refunds/:id/resolve` (`payments-api.ts:2083`): the same | as row 4 | Task 8 |
| 6 | An open give-back on an invoice another box issued (handover, promotion): `wrong_node` | **Finish** ends it unrecorded, on the accountant's list; as a receipt's today (2026-11-27, A1614: now an R1 on this box once AEAT has accepted it, and a wait while it is unanswered) | Task 8 |
| 7 | The old window's routes, `POST …/corrections`, `…/preview`, `GET …/lines` (`invoice-correction-api.ts:76-133`) | deleted | PR 0 |
| 8 | Refund a payment's route | refused (D5) | Task 6 |
| 9 | Cancel and credit (`working-order-counter.ts:190`), Reopen to split (refused at `split-after-print.ts:142`) | `sale.correction_unsupported`, as today | existing + no record written |
| 10 | The dashboard's fixes: R4 replacement (off), corrective (not enabled, `record-remedy-routes.ts:34-38`), record correction | as today | existing + the corrective's body refuses a `fullInvoice` field |

## 3. Who reads "a corrective naming a customer is R4", and the words

| Where | Change |
| --- | --- |
| `invoice-typing.ts:23`, `:38`, `:96` (`packages/orders-sales`); the till's type | R4 when `replaces_original`, else R1; R1 prints the full layout |
| `tax-office-list.ts:8`, `:67-68`; `tax_office.kind.*` | R1 "Corrective invoice" / «Factura rectificativa»; R4 "Corrective invoice replacing another" / «Factura rectificativa por sustitución» |
| `invoice-email.ts` (Task 15c's `invoiceType === "R4"`) | R1 takes the same title |
| `find-bill-transactions.ts:66`, **and `:91`** (else a refund attaches to the corrective); the till's types list | a fourth type, `full-correction`, excluded at `:91` too |
| Alerts `invoice_correction.unfinished`, `.filing_refused` (`alert-messages.ts:474-481`): "its corrective receipt" for both | params gain `fullInvoice: boolean` (absent: receipt); two wordings each, EN and ES |
| Till: `give_back.print_later`; both `not_simplified` sentences (`codes.ts:1125`, `:1423`) and the comment saying those reasons never change | by kind; `not_simplified`, an F3 only now: "A full invoice made from receipts cannot be corrected here" / "…so the money given back cannot be recorded on it here" |

No change, read: `returned-invoices.ts:76` (already R1 to R5), `registro-row.ts`, `correctivesOf` and the
VAT return (by `corrects_sale_id`; one VAT row pinned), `invoice-customer-data.ts:153`. Already done by
`da73900607`: the order details, the corrections report and the accountant's sheet, which says "Corrective
invoice" for a row that names a customer (`accountant-export.ts:306` there), as an R1's does.

## 4. Printed titles, and AEAT

RD 1619/2012 (read at boe.es, arts. 6, 7, 15) sets no title for a corrective; arts. 7.1.h and 15.4 ask it
to name the invoice corrected. The paper says **"Corrective invoice" / «Factura rectificativa»** for both
kinds today; this plan keeps it on a full invoice's and leaves a receipt's (with the owner). On a line given
back in part the amount may stand in for art. 6.1.f's unit price: art. 15.5 (read, mine).

**AEAT's test service.** Run [37286368370](https://github.com/waitron-io/verifactu/actions/runs/37286368370)
(head `d99e107738`; `gh run view`: success) sent as `controlCredit` an R1 "I" correcting one F1, the
customer by NIF; the answer is `Correcto` (`2026-10-05-aeat-protocol-evidence.json:20578-20598`). Not
covered: another identifier, two VAT rates, an R1 of an R4. Counted as the gate (watcher).

## 5. What is left of a cancelled dish

**Today.** A link is a row of `adjustment_refunds` (append-only: cancel, refund, amount), written when the
refund is reserved, before a card answers (`tender-refund-reservation.ts:526`); a corrective's leg gets none
(`:470-471`, `invoice-correction-legs.ts:148`). Readers: `linkedTo` (`packages/adjustments/src/refund-links.ts:31-35`,
what a cancel still owes), the dashboard's adjustments list (`reports.ts:379`), the window
(`give-back-read.ts:251-262`, `:287-300`, `:487-489`: the dish's uncorrected amount, its extras included,
less all its links), a resend (`give-back.ts:170-182`) and the approval check
(`tender-refund-reservation.ts:243`).

**The rule.** When a full invoice's corrective files, `fileCorrectionIn` links it in the same transaction:
the cancels of each dish, recorded before the give-back opened, take up to what they still owe and together
no more than the corrective takes off the dish and its extras, put on its completed legs in order. Those
amounts are `preview.allocations` (`saleLineId`, `gross`), already in `previewCorrectionAmounts`' answer
(`correction-allocation.ts:32-47`, `correction-history.ts:58-64`) at the call in `fileCorrectionIn`
(`invoice-corrections.ts:471`). One that ends **unrecorded** has no corrective: `closeInvoiceCorrection`
pays the cancels on the lines it names (naming none, all) as a plain refund does. A discarded one gave
nothing back and links nothing.

**`left`** is the uncorrected amount less the links of refunds that are not legs of a *filed* corrective;
where the lines cannot be read, the gross less all links, as today. A receipt's legs are never linked, so
nothing changes there. **On a full invoice a cancel is shown as owing no more than `left`:** its refund value
ignores earlier correctives (`cancellation-refund-value.ts` reads none), so one made after goodwill owes
more than its dish has left.

Run: a script over the real `allocateCorrectionAmounts`, one rate, every press filed at once.

| Case, paella and steak 18.50 each, croquetas 2 × 6.00 | Corrective off the dish / linked | Owed, left after |
| --- | --- | --- |
| Goodwill 18.50, the paella cancelled | −9.25 / 9.25 | 9.25, 9.25 |
| …then the steak ticked 9.25; then the paella 9.25 | 0 / 0; −9.25 / 9.25 | 9.25, 9.25; 0, 0 |
| Both ticked, 20.00 of 37.00 | −10.00 / 10.00 | 8.50, 8.50 |
| Paella alone, 10.00 then 8.50 | −10.00, −8.50 / same | 8.50, 8.50; 0, 0 |
| Both croquetas cancelled, ticked 6.00 twice | −6.00, −6.00 / same | 6.00, 6.00; 0, 0 |
| Goodwill 6.00 on those + steak 18.00; then ticked 6.00 | −2.40, −6.00 / same | 9.60, 9.60; 3.60, 3.60 |
| **One croqueta cancelled:** goodwill 6.00; then ticked 6.00 | −2.40, −6.00 / 2.40, 3.60 | 3.60, 9.60; 0, 3.60 |
| **Goodwill 10.00, then the paella cancelled;** then ticked 13.50 | −5.00, −13.50 / 0, 13.50 | 13.50 (of 18.50), 13.50; 0, 0 |

Same script, 20,000 random invoices a run. Cancels made before any press: 50,366 presses, none leaving a dish
owed more than its `left`, and no money on the invoice outside the dishes' `left`. Cancels made between presses
too: 8,093 of 49,974 left a dish owed more than its `left`; with what is owed shown as at most `left`, 0 of 49,983.

**Between the money and the links nothing more goes back.** First leg done, second pending: nothing is filed
or linked, so the read still shows the dish's `left` and owed in full, and the dashboard's list the cancel as not
paid back, but nothing can be pressed. A second till opening the window finds every line and choice closed with
`invoice_correction.already_open` (`give-back-read.ts:153-154`, `:192`, `:206-209`) and Money back under way
(`:511-515`). Refused: its preview and its press (`give-back-plan.ts:187`, planned again in the write
transaction, `give-back.ts:373`); Refund a payment, the extra included (`tender-refund-reservation.ts:373`); a second
give-back (`invoice-corrections.ts:154`, and the unique index `invoice_corrections_open_key`); a leg above
what is left (`invoice-correction-legs.ts:149-155`; cash, `invoice-correction-cash.ts:100`). That ends only when
the give-back files, ends unrecorded or is discarded; each waits for a pending leg (`readSettledMoney`,
`invoice-corrections.ts:468`, `:566`) and writes any links in the transaction that ends it. A crash before then
leaves it open.

So a pending leg never carries a link, and the first plan's retry refusal is dropped: the approval check covers
only a linked refund (`tender-refund-reservation.ts:254`), and retrying a completed leg only shows it
(`tender-refund-api.ts:267`; `refunds_guard_update`, `core.sql:327`). A resend's `fromCancel` needs no check: on a full
invoice it changes no right (D4), and the row's amount and lines are compared (`give-back.ts:185-191`).

## 6. "Given back in part": one condition

**Minus the corrective row's `line_gross` differs from the `line_gross` of the line it corrects**
(`sale_lines.corrects_line_id`). A row naming no line, or with no stored gross, is whole; a whole dish prints
−1 × price, as the owner's answer 4 says. The draft's second test (the stored price against the
amount, D10) is dropped: it blanked whole weighed dishes and whole credits. Unchanged, held by a test that
files a whole credit of a bill with a shared free item and a divided set menu and finds no row blank, and by
the existing whole-credit cases unedited: Cancel and credit and Reopen to split negate `line_gross` row for
row (`reversedLines`, `cancel-credit.ts`); a replacement names no line. A reprint reads the same rows.

## PR 0 — delete three routes nothing calls

After Give money back's PR 3 (run: `git grep -n /corrections da73900607 -- apps/till/src` finds nothing, and the
dashboard only its own report). `POST …/corrections`, `…/preview` and `GET …/lines` go, with
`readInvoiceCorrectionLines`; `parseInvoiceCorrection`, which only tests would then call, moves to
`src/testing/`. Server test files call the routes: their cases about the routes go, the rest open the
correction through the helper. `openInvoiceCorrection` and `previewInvoiceCorrection` stay
(`give-back-press.ts:304-305`). **Leaves:** the till as it was.

## PR 1 — the writer can file an R1 (packages; nothing calls it)

Every task runs, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts`.

**Task 1, admission.** `packages/fiscal/src/backend.ts` and its fake, `correction-admission.ts`, `put-right.ts`
(its parameter narrowed to what it reads). An answer for an F1 or R4 "S" says `fullInvoice: true`, eligible or
not. Refused with an open case: a fix offered (D2) is `filing_refused`; none is a new reason `refused_no_fix`,
added to `NEVER_FILEABLE` (`refusesForGood` already counts all but `filing_refused`). **Owns admission.**
Failing first in `correction-admission.test.ts` (changes `:189-196`): F1 and R4 "S" admitted; `1100` naming the
description waits; `1112`, another code, and an R4 refused `1112` are `refused_no_fix`; held and set-aside wait;
F2, R5 "S", F3 unchanged.

**Task 2, record builder.** `backend.ts` is 935 of 1,000 lines: the type choice moves to a new file. **Owns the
record type.** Failing first, the grid of original {F1, F2, F3, R1, R4 "S", R4 "I", R5 "S", R5 "I"} × {customer,
none}: F1 and R4 "S" with a customer file R1 "I" with the **stored** customer (even handed another name), no
`ImporteRectificacion`, the library's `validate` empty; F2 and R5 "S" with none file R5 "I"; every other
pair is `fiscal.correction_unsupported`, nothing written. Changes `backend.test.ts:1009`; `:493` stays refused.

**Task 3, core.** `fullInvoice: true` on `previewCorrectionAmounts`, `readCorrectableLines` and
`recordCorrection`. Without it, any answer saying `fullInvoice` is refused `not_simplified`, except
`wrong_node`, which keeps its reason, so no caller changes. With it: the `full_corrective` series; the customer's name, tax number, identifier and address and
the business's current registered address copied to the corrective; no registered address refuses
`fiscal.taxpayer_domicile_missing` in all three, before a number is taken; an invoice naming nobody, or
`wholeInvoice` beside it, refuses `sale.correction_unsupported`, as do an F3 and an earlier corrective by
differences, before a number is taken. **Owns what is copied.** Failing first in
`correction-history.test.ts` (`:547` kept) and `record-correction.test.ts` (`:689` kept).

**Task 4, readers** (section 3, rows 1 to 4). Failing first: `receipt-issuer.test.ts` (R1 full layout, R4
unchanged), `tax-office-list.kinds.e2e.test.ts:128`, Find a bill's type and `:91`, the email title, one VAT row.
Look at an R1 from `receipt-look.ts`: 58 mm, 80 mm, A4, both languages.

**Leaves:** nothing changes for anyone; the readers can show an R1.

## PR 2a — Give money back files it (cancelled-dish money still plain, as a receipt's)

**Task 5, the press.** `invoice-corrections.ts`, `give-back-press.ts`, `give-back-read.ts`. `readCorrectableNow`
and everything on an **open** corrective pass the option; opening passes it only from `openCorrectionPart`;
`fileCorrectionIn` picks the series from the invoice. A plain refund of money a corrective can take is then
refused by the rule a receipt has (`plainRefundLimit`, `:163-183`). Failing first, new
`give-back-full-invoice.test.ts`, one case each: goodwill in cash files one R1 and no plain refund; separate
terminal; reader; two payments then Finish, then Stop here; the press sent again writes nothing; no registered
address moves no money; an advance that is a full invoice; `refused_no_fix` goes back plain; a cancel still owed
is paid plain first, as on a receipt.

**Task 8, the audit's test.** New `full-invoice-correctives.test.ts`: section 2's rows 3 to 6, 9 and 10 from an
F1 and row 1 from an A1407 R4, each asserting the records naming the original; and opened while queued, a leg
pending, AEAT answers `1112`, the leg completes: nothing filed, one alert, Finish ends it unrecorded (money
out with no corrective, accepted). Proof by deletion: the builder's check, then the series choice.

**Task 9, words.** Section 3's other rows. Till, EN and ES, naming the page: no registered address;
`refused_no_fix` ("The tax agency refused this full invoice and Waitron cannot fix that, so the money
given back is on your accountant's list"). Both guides' "cannot correct a full invoice", `docs/backlog/fiscal.md`,
the adviser sheet's "Money given back as goodwill" point (it lists a full invoice). Tests: `alerts.test.ts` (both
wordings, a row with no `fullInvoice`), `codes.test.ts`.

**Leaves:** a full invoice is corrected as a receipt is. A cancelled dish's own money still goes back plain with
no corrective and is on the accountant's list, as today. Until PR 4a, an R1 filed after a card prints nothing and
is printed from Find a bill: a receipt's rule today. A refused **R1** has no fix on the dashboard, as an R5 has
none (`put-right.test.ts`), and an F1 holding an R1 can never get its R4 (`sale.replacement_not_first`); the PR
says so. Sale-path read changed: no.

The till's `sale.correction_unsupported` words (`codes.ts`, "This is a full invoice naming a customer…") must also
cover a full-invoice correction refused because the invoice names nobody or is not a full invoice.

## PR 2b — a cancelled dish's money goes on it too

**Task 6, routing and limits.** `give-back-plan.ts`, `give-back-read.ts` (`lineAvailability`),
`tender-refund-reservation.ts` (`plainRefundLimit`; `readRefundableTendersWithLimits` `:186-218`, its `owed`
and catch branch, so the till's limit equals the write's; _since #4344 the till reads neither `plainRefundLimit` nor
`correctionOpen` from it, so deleting it is the other choice_). On a full invoice: `owed` is 0 wherever it caps a
plain refund, the corrective names the ticked families for the whole amount, a plain refund is refused (D5),
both rights are asked (D4). Failing first: a cancelled paella of 18.50 files R1 −18.50; while the filing waits,
only the extra; the limit on a separate terminal; row 8 of section 2; the PIN after Cancel and refund.
`give-back.test.ts` unedited. Changes `tender-refund-links.test.ts:555`, `:1010` (D5).

**Task 7, links and what is left** (section 5). The line-to-cancel map (`cancelsAndFreeByLine`,
`give-back-read.ts:267`) moves to a new `cancelled-lines.ts`: `give-back-read.ts` imports
`invoice-corrections.ts`, which now needs it. Failing first: section 5's goodwill row, its one-croqueta row and its
cancelled-after-goodwill row, through the window's read and press; split over cash and a card, with a second till
refused between the legs and the links on both legs after; Stop here after the first leg links only its amount; a
cancel made between the legs is not linked; ended unrecorded, the money is linked and not offered again; a waiting
filing after a linked corrective still shows the dish's `left` less its links. The table's other rows are one
table-driven unit case over the allocator and the linker.

**Words:** the PIN sentences in both guides; a refused filing that waits (the receipt's sentence, `codes.ts`'s
`GIVE_BACK_FILING_REFUSED`, says cancelled-dish money still goes back: untrue here). **Leaves:** owner's answer 2.

## PR 3 — blank quantity and unit price on a line given back in part

Independent; may land first. It changes what a filed full invoice prints (art. 6.1.f); light path (cleared).

**Task 10, which lines.** New `corrective-lines-in-part.ts`, called by `transaction-receipt.ts` and
`invoice-document.ts` for a corrective that is no replacement. Failing first, one table over filed rows: one dish;
one of 3's money; two halves; 350 g at 5.20/kg whole; a divided set menu's dish; the whole credit of section 6;
a replacement.

**Task 11, what prints.** `receipt-lines.ts` (rows merge only when alike in it), `receipt-facts.ts`,
`receipt-document.ts` (no stray indent). Failing first: both papers, whole and part on one. Look: A4 and rolls.
**Leaves:** answer 4, on receipts' and full invoices' correctives.

## PR 4a — it goes out the way the original went (server)

**Sale-path read changed: yes** (delivery reads `replaces_original` of a sale it already reads by id).

**Task 12, deliverable.** `deliversAsFullInvoice` and its SQL twin (`invoice-selection.ts:36`, `:44`) admit a
corrective that is not a replacement, each caller checked: `invoice-delivery.ts:56`,
`invoice-delivery-status.ts:260`, `document-printer-offers.ts:129`, `invoice-document.ts:44`,
`invoice-print.ts:98`, `print-job-reprint.ts:201`, `alert-sources.ts:678`, `:695`; and `receipt-print.ts:519`,
`:751`, which test for F1. `departmentOf` (`invoice-email-contact.ts`) reads a corrective's contact from the
invoice it corrects, which covers M7's sites at once. An R4 replacement's delivery is unchanged.

**Task 13, sent when filed.** `fileCorrectionIn` sends it once inside `optionalDocument` (request key
`corrective:<id>`) the original's way (D8); the answer's corrective part gains number, customer, amount and how it
was sent. Failing first: cash on paper; a late answer by email; an A4 printer switched off since (alert, filing
stands); no receipt printer on the opening device (nothing queued, filing stands); a resend sends nothing again.
**Leaves:** a corrective reaches the customer as the original did; staff cannot yet choose another way.

## PR 4b — staff's choice is stored, and try again (server)

**First line of the PR: "Resets every venue: core's starting migration is rebuilt."**

**Task 14, the choice.** `invoice_corrections.delivery`, null allowed, frozen like its siblings: `AND
new.delivery IS old.delivery` in `invoice_corrections_guard_update` (`packages/db/triggers/core.sql:359-382`),
then `pnpm --filter @waitron/server migration-baseline rebuild --set core`. The press takes `delivery`, checked
by `checkedInvoiceChoiceDelivery` with the original as source, after the ids are looked up and before anything
is written; refused where the press files no full-invoice corrective. `openInvoiceCorrection` stores it and puts
it in its fingerprint when present; `fileCorrectionIn` reads it from the row, so `/cash`, `/file`, a later leg
and the sweep take no choice of their own. **Absent means null means the preset, worked out when it files, never
copied at the press.** A resend must match the row: absent only a null column, a choice only an equal one (the
person aside), else `submission.id_reused`, beside the amount and lines check (`give-back.ts:185-191`); it never
changes the stored choice. The read gains `invoice` where a corrective can be filed (customer name, preset,
options as `/api/invoice-delivery-options` works them out, the address only where
`till-sale-receipt-routes.ts:206-215` shows it). Failing first: a late card answer goes out as staff chose, not
as the original; the same for Finish on another till; the trigger refuses a change; the resend cases. Run
`scripts/schema-constraints.test.ts`, `append-only-triggers`, `behavioural-triggers`, `starting-migrations` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`.

**Task 15, try again.** `transaction-receipt-api.ts` gains email and its retry
(`till-sale-receipt-routes.ts:249-345`); the dashboard's `invoice_delivery.*` alerts name Find a bill for a
corrective. Failing first: email, retry, each refused where an F1's button is. **Leaves:** the server takes both;
no till screen sends them until PR 5.

## PR 5 — staff can change it (till)

**Task 16.** The Delivery field and email box move from `invoice-recipient-dialog.ts` to
`widgets/invoice-delivery-choice.ts`; that dialog's tests pass unedited.

**Task 17, the window.** `give-back-dialog.ts` is at 1,000 of 1,000 lines and `till-app.ts` at 25,731 of 25,750:
move code out first. A dish or Goodwill on a full invoice shows **How the invoice goes to {customer}**, on the
preset; sent with the press and kept for a `rest`, which is a new press; `PROVES_NOTHING` gains
`invoice_delivery.printer_invalid`, `invoice_delivery.email_unavailable`, `fiscal.taxpayer_domicile_missing`.
Failing first: shown on a full invoice, never on a receipt; the choice kept for `rest`.

**Task 18, the end screen.** These lines, also when Money back under way finishes one, from what the server says
was done ({amount} is the corrective's, not the give-back's). No field in Money back under way: the choice is
made at the press and stored.

| | English | Spanish |
| --- | --- | --- |
| Printing | A corrective invoice for {customer} (−{amount}) is printing. | Se está imprimiendo una factura rectificativa para {customer} (−{amount}). |
| Queued | A corrective invoice for {customer} (−{amount}) is being emailed to {email}. | Se está enviando por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| Sent | A corrective invoice for {customer} (−{amount}) has been emailed to {email}. | Se ha enviado por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| A receipt's | A corrective receipt (−{amount}) is printing. | Se está imprimiendo un ticket rectificativo (−{amount}). |

**Task 19, a past R1.** `till-ticket-view.ts` (1,199 of 1,250) and `till-app.ts`'s F1 delivery checks, through one
helper, show an R1 the delivery block and try-again buttons; both guides. **Leaves:** the owner's answers 1 and 3.

## True size

By file, then three times that for production, as before (Give money back came out at 4.4 times on the server,
550 estimated and 2,427 built, and 2.8 on the till, so a server row could be half as much again). Tests: by file
**after the cuts**, then what Give money back's came out at, 2.4 times on the server and 3.8 on the till (run: `git
show --numstat` of `e9106dcc71`, `787644b5f5`). Each rule is proved once, in the layer that owns it: admission
Task 1, record type 2, what is copied 3, the press 5, routing 6, links 7; the audit (8) keeps only what no other has.

| | Tasks | By file (production / test) | Expect | Generated |
| --- | --- | --- | --- | --- |
| PR 0 | — | −90 / −300 + 120 | the same | none |
| PR 1 | 1–4 | 200 / 350 | 600 / 850 | none |
| PR 2a | 5, 8, 9 | 170 / 330 | 510 / 800 | none |
| PR 2b | 6, 7 | 130 / 250 | 390 / 600 | none |
| PR 3 | 10–11 | 70 / 110 | 210 / 260 | none |
| PR 4a | 12–13 | 140 / 170 | 420 / 410 | none |
| PR 4b | 14–15 | 110 / 200 | 330 / 480 | core's starting migration and snapshot, about 20 lines |
| PR 5 | 16–19 | 220 / 260 | 660 / 1,000 | none |

About **3,100 production and 4,400 test lines** (was 3,150 and 8,200). At the server half's rate (5,531 lines in
under six hours, other items' work included) PR 5 is about two hours and every other less; PR 1 with production at
4.4 times is also two. A PR whose tests pass its figure by half says why. Tasks of 50 to 80 calls; split one that
passes 60 unfinished.

Risk triggers: PRs 1, 2a, 2b, 4a, 4b fiscal, money, permissions or migration: full path, two Codex reviews; PR 0, 3
and 5 light. Order: Give money back's PR 3, PR 0, 1, 2a, 2b, 4a, 4b, 5; PR 3 whenever. Each leaves `main` green and
working, as its "Leaves" says. Changed checks: those the tasks name, plus `find-bill-transactions.test.ts`, the till's
print line and the `GiveBackView` fixtures; `give-back.test.ts:1121` (`not_simplified`) stays, now F3.

## What this plan does not do

- Cancel and credit, Reopen to split and the dashboard's fixes on a full invoice: refused as today.
- A corrective of a full invoice AEAT refused with no fix, one refused while a give-back was under way
  included (Task 8), or of an F3.
- A receipt's cancelled-dish corrective (the October decision); picking how many of a dish (A802).
- A receipt paper's title (with the owner).

## Cleared 2026-11-25 15:52

By the watcher (lane L's `questions.md`), inside the owner's ask and four answers, with changes 1 to 5 of
`plan-l-20261125-1548.md`; build from PR 1, no re-read.

1. **D2** (a refused full invoice waits only while Waitron offers a fix; held and set-aside ones wait): yes.
2. **D5** (a plain refund of money that could be corrected is refused, cancelled-dish money included): yes, from 2b.
3. **D4** (both rights, so a PIN after Cancel and refund where a receipt asks none): yes; the owner is told.
4. **D6:** no to "no column": the choice is stored, since a reset is free until go-live and the owner said "default
   to the original but allow the staff to change it".
5. **D1** (F3 refused): yes. 6. **Delete the three routes:** yes, after Give money back's PR 3 (PR 0).
7. **The paper title of a receipt's corrective** ("should the printed title also say corrective receipt / «ticket
   rectificativo»?"): with the owner; blocks nothing.
8. **D3's sharing:** falls with change 1 (section 5). 9. **PR 3 on the light path:** yes.
10. **R1 before the adviser answers** that a dish that never came is R1, and counting run 37286368370 as the AEAT gate:
    yes to both.

Added here under change 1, not in the verdict: a cancel is shown as owing no more than its dish has left, on a full
invoice; a give-back ended unrecorded links its money as a plain refund does, and those links go on counting in `left`.
