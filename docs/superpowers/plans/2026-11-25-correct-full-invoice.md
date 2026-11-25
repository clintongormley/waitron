# CORRECT-FULL-INVOICE: giving money back on a full invoice files a corrective full invoice

Status: plan, revised 2026-11-25 after one fresh read
(`~/waitron-campaign-l/receipts/correct-full-invoice/plan-read-1.md`). Not started; nobody has approved
it. Design: [2026-11-25-correct-full-invoice-design.md](../specs/2026-11-25-correct-full-invoice-design.md),
with the owner's answers at the end of its section 6. FISCAL: the owner lands every pull request.

**Base.** `main` at `bd5d2dbf19`, which holds #4300 (`787644b5f5`), **plus Give money back's PR 3**
(`feat/give-money-back-remove-old`, read at `caf8ac7b3a`), which must land first: it removes the two old
windows, and its Task 15c, **not done at that head**, rewords what is on `main` to "corrective receipt /
corrective invoice". If it lands without 15c, 15c is done before PR 2. Server line numbers are `main` at
`bd5d2dbf19`; till ones are that branch. "Run" names its command; the rest was read.

**Words.** A *receipt* is the simplified invoice (AEAT's F2); its corrective is R5. A *full invoice* (F1)
names the customer; its corrective here is **R1**. A *corrective* is the new invoice, with negative
amounts, filed when money goes back. A *plain refund* is money back with no corrective. A *leg* is one
refund that is part of a corrective. The *press* is one Give back. A *link* records how much of a refund
paid a cancelled dish (`adjustment_refunds`).

## 1. Should this exist?

**The ask** (owner, 2026-11-24, told the till cannot correct a full invoice): "but we will build this
functionality, no?" (lane L `queue.md`). Today the money goes back with no corrective, so the business
deducts VAT on money it got back and the venue goes on declaring it. PR 2 files the corrective; PR 3 is the
owner's answer 4, PR 4 and 5 answer 1. **Simplest alternative:** nothing, and the accountant issues it by
hand outside Waitron's numbering and record chain, which does not meet the ask. **Approved:** the ask and
four answers, quoted in the design. D1 to D11 are lane L's.

| # | Decision |
| --- | --- |
| D1 | Only an F1, or A1407's R4 replacement of one, gets an R1. An F3 (a full invoice made from receipts) stays refused; no route issues one |
| D2 | A full invoice AEAT **refused** waits only while Waitron offers a fix for that refusal, the test the Fiscal filing page makes (`putRightFor`, `put-right.ts:24-54`): today `1100` naming the description; `1112` too once `FULL_INVOICE_REPLACEMENT_ON` is on. Any other refusal keeps today's plain refund and the accountant's list: waiting would never end. Held and set-aside filings (`detenido`, `retenido`) wait; today their money goes back at once |
| D3 | A cancelled dish's money goes on the corrective (owner) and waits with it (D2), its legs linked to the cancel. **On a mixed press the paper shares the money by menu price over the dishes it names, while the cancel reads paid in full first:** 18.50 of goodwill on a cancelled paella and a steak, 18.50 each, prints −9.25 and −9.25 and pays the paella. Section 5 keeps the paella from being offered again |
| D4 | So it needs **both rights**, money back and corrective: the cancel's own approval no longer covers it, and the window opened after **Cancel and refund** asks a PIN when the person lacks either. A receipt's asks none, as today |
| D5 | A plain refund of payment money that could be corrected is refused (`tender.refund_needs_correction`) on every route, cancelled-dish money included. The extra still goes back plain |
| D6 | **No column, no reset.** How it goes out travels with the requests that can file it: the press (cash, separate terminal, reader answered in time), and Money back under way's cash, card leg, **Finish** and **Stop here**. A card answer that arrives late is filed in the background and goes out the way the original went. *The alternative,* a column on `invoice_corrections`: a late answer, or a press finished elsewhere, would go out as staff chose. Cost: core's starting migration rebuilt and every box reset |
| D7 | Whatever files it sends it, under the person who opened it. On paper it prints where the person filing it is (Finish on another till prints there); with nobody asking, at the device that opened it, and with no receipt printer there, nothing prints and it stays in Find a bill |
| D8 | Preset: the original's delivered attempt, else its newest. Email and A4 are offered only where this device can use them now; otherwise the receipt printer |
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
receipts' without looking); Task 2 makes the builder the last word. Printing and resending issue nothing.

| # | Path | After | Held by |
| --- | --- | --- | --- |
| 1 | Give money back: cash (`give-back.ts:540`), separate terminal (`give-back-api.ts:160`), reader (`give-back-reader.ts`) | R1 | Tasks 5, 8 |
| 2 | Money back under way: cash (`invoice-correction-api.ts:159`), a card leg (`tender-refunds.ts:186`), `/file`, `/close` | R1; ending it files nothing | Tasks 5, 8 |
| 3 | The sweep, after a late card answer and at start: `invoice-correction-alerts.ts:101-109` | R1 | Task 8 |
| 4 | `POST /api/tender-refunds/:id/retry` (`tender-refund-api.ts:231`; the till reaches it from Money back under way, `give-back-under-way.ts:387`): settles a leg, files nothing | the sweep files one R1 | Task 8 |
| 5 | The dashboard's `/payments/tender-refunds/:id/resolve` (`payments-api.ts:2083`): the same | as row 4 | Task 8 |
| 6 | An open give-back on an invoice another box issued (handover, promotion): `wrong_node` | **Finish** ends it unrecorded, on the accountant's list; as a receipt's today | Task 8 |
| 7 | The old window's routes, `POST …/corrections`, `…/preview`, `GET …/lines` (`invoice-correction-api.ts:76-105`) | same refusal, `not_simplified` | existing; question 6 |
| 8 | Refund a payment's route | refused (D5) | Task 6 |
| 9 | Cancel and credit (`working-order-counter.ts:190`), Reopen to split (refused at `split-after-print.ts:142`) | `sale.correction_unsupported`, as today | existing + no record written |
| 10 | The dashboard's fixes: R4 replacement (off), corrective (not enabled, `record-remedy-routes.ts:34-38`), record correction | as today | existing + the corrective's body refuses a `fullInvoice` field |

## 3. Who reads "a corrective naming a customer is R4", and the words

| Where | Change |
| --- | --- |
| `invoice-typing.ts:23`, `:38`, `:96` (`packages/orders-sales`); the till's type | R4 when `replaces_original`, else R1; R1 prints the full layout |
| `tax-office-list.ts:8`, `:67-68`; `tax_office.kind.*` | R1 "Corrective invoice" / «Factura rectificativa»; R4 "Corrective invoice replacing another" / «Factura rectificativa por sustitución» |
| `invoice-email.ts:61-64` | the title for R1 |
| `find-bill-transactions.ts:66`, **and `:91`** (else a refund attaches to the corrective); the till's types list | a fourth type, `full-correction`, excluded at `:91` too |
| `orders.detail.corrective`, `corrections-report.ts`, `accountant-export.ts:547`, its `refundSheet` and note | the invoice's customer picks "corrective invoice" or "corrective receipt"; a sheet that can hold both says «documento rectificativo» / "corrective document" |
| Alerts `invoice_correction.unfinished`, `.filing_refused` (`alert-messages.ts:474-481`): "its corrective receipt" for both | params gain `fullInvoice: boolean` (absent: receipt); two wordings each, EN and ES |
| Till: `give_back.print_later`; both `not_simplified` sentences (`codes.ts:1129`, `:1427`) and the comment saying those reasons never change | by kind; `not_simplified`, an F3 only now: "A full invoice made from receipts cannot be corrected here" / "…so the money given back cannot be recorded on it here" |

No change, read: `returned-invoices.ts:76` (already R1 to R5), `registro-row.ts`, `correctivesOf` and the
VAT return (by `corrects_sale_id`; one VAT row pinned), `invoice-customer-data.ts:153`.

## 4. Printed titles, and AEAT

RD 1619/2012 (read at boe.es, arts. 6, 7, 15) sets no title for a corrective; arts. 7.1.h and 15.4 ask it
to name the invoice corrected. The paper says **"Corrective invoice" / «Factura rectificativa»** for both
kinds today; this plan keeps it on a full invoice's and leaves a receipt's (question 7). On a line given
back in part the amount may stand in for art. 6.1.f's unit price: art. 15.5 (read, mine).

**AEAT's test service.** Run [37286368370](https://github.com/waitron-io/verifactu/actions/runs/37286368370)
(head `d99e107738`; `gh run view`: success) sent as `controlCredit` an R1 "I" correcting one F1, the
customer by NIF; the answer is `Correcto` (`2026-10-05-aeat-protocol-evidence.json:20578-20598`). Not
covered: another identifier, two VAT rates, an R1 of an R4. Recommend counting the gate met.

## 5. What is left of a cancelled dish

`give-back-read.ts:490-495` makes it what is uncorrected of the dish's family (it and its extras) less all
its links. On a full invoice: **the uncorrected amount, less the links of refunds that are not legs of a
filed corrective, less, for each filed corrective, what its legs' links exceed its amount on that family**
(never below 0). So each corrective counts once, by the larger of what it took off the dish and what its
money paid of the dish's cancels.

The read's rule (the smaller of uncorrected less those other links, and gross less all links) fails
where a dish is cancelled **in part**: it keeps the two totals apart, so a served portion paid for later
is offered again. Run: an arithmetic script, shares by menu price as `correction-allocation.ts:120`.

| Case (the dish's `left` afterwards) | Corrective / links | Read's | This |
| --- | --- | --- | --- |
| Goodwill 18.50 on cancelled paella 18.50 + steak 18.50 | −9.25 / 18.50 | 0.00 | 0.00 |
| …then steak ticked, 9.25 | 0 / 0 | 0.00 | 0.00 |
| Both ticked, 20.00 of 37.00 (paella) | −10.00 / 18.50 | 0.00 | 0.00 |
| Paella alone, 10.00 then 8.50 | −10.00, −8.50 / same | 8.50, 0.00 | 8.50, 0.00 |
| Two croquetas, both cancelled 6.00, ticked 6.00 twice | −6.00, −6.00 / same | 6.00, 0.00 | 6.00, 0.00 |
| Goodwill 6.00 on those + steak 18.00, then ticked 6.00 | −2.40, −6.00 / 6.00, 6.00 | 6.00, 0.00 | 6.00, 0.00 |
| **One croqueta of two cancelled: goodwill 6.00, then the served one 6.00** | −2.40, −6.00 / 6.00, 0 | 6.00, **3.60** | 6.00, 0.00 |

The invoice's remaining money stays reachable: an amount above the ticked dishes' `left` is shared over
every dish (`give-back-plan.ts`, `linesHold`). The same path pays a cancel that owes more than its line
has left. The sharing is D3's; "the owed part to its own lines first" would need per-line amounts in core.

## 6. "Given back in part": one condition

**Minus the corrective row's `line_gross` differs from the `line_gross` of the line it corrects**
(`sale_lines.corrects_line_id`). A row naming no line, or with no stored gross, is whole; a whole dish prints
−1 × price, as the owner's answer 4 says. The draft's second test (the stored price against the
amount, D10) is dropped: it blanked whole weighed dishes and whole credits. Unchanged, held by a test that
files a whole credit of a bill with a shared free item and a divided set menu and finds no row blank, and by
the existing whole-credit cases unedited: Cancel and credit and Reopen to split negate `line_gross` row for
row (`reversedLines`, `cancel-credit.ts`); a replacement names no line. A reprint reads the same rows.

## PR 1 — the writer can file an R1 (packages; nothing calls it)

Every task runs, unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts`.

**Task 1, admission.** `packages/fiscal/src/backend.ts` and its fake, `correction-admission.ts`,
`put-right.ts` (its parameter narrowed to what it reads). An answer for an F1 or R4 "S" says `fullInvoice:
true`, eligible or not. Refused with an open case: a fix offered (D2) is `filing_refused`; none is a new
reason `refused_no_fix`, added to `NEVER_FILEABLE` (`refusesForGood` already counts all but
`filing_refused`). Failing first in `correction-admission.test.ts` (changes `:189-196`): F1 and R4 "S"
admitted; `1100` naming the description waits; `1112`, another code, and an R4 refused `1112` are
`refused_no_fix`; held and set-aside wait; F2, R5 "S", F3 unchanged.

**Task 2, record builder.** `backend.ts` is 935 of 1,000 lines: the type choice moves to a new file.
Failing first, the grid of original {F1, F2, F3, R1, R4 "S", R4 "I", R5 "S", R5 "I"} × {customer, none}: F1
and R4 "S" with a customer file R1 "I" with the **stored** customer (even handed another name), no
`ImporteRectificacion`, the library's `validate` empty; F2 and R5 "S" with none file R5 "I"; every other
pair is `fiscal.correction_unsupported`, nothing written. Changes `backend.test.ts:1009`; `:493` stays refused.

**Task 3, core.** `fullInvoice: true` on `previewCorrectionAmounts`, `readCorrectableLines` and
`recordCorrection`. Without it, any answer saying `fullInvoice` is refused `not_simplified`, so no caller
changes. With it: the `full_corrective` series; the customer's name, tax number, identifier and address and
the business's current registered address copied to the corrective; no registered address refuses
`fiscal.taxpayer_domicile_missing` in all three, before a number is taken; an invoice naming nobody, or
`wholeInvoice` beside it, refuses `sale.correction_unsupported`. Failing first in `correction-history.test.ts`
(`:547` kept) and `record-correction.test.ts` (`:689` kept).

**Task 4, readers** (section 3, rows 1 to 4). Failing first: `receipt-issuer.test.ts` (R1 full layout, R4
unchanged), `tax-office-list.kinds.e2e.test.ts:128`, Find a bill's type and `:91`, the email title, one VAT row.
Look at an R1 from `receipt-look.ts`: 58 mm, 80 mm, A4, both languages.

## PR 2 — Give money back files it

**Task 5, the press.** `invoice-corrections.ts`, `give-back-press.ts`, `give-back-read.ts`. `readCorrectableNow`
and everything on an **open** corrective pass the option; opening passes it only from `openCorrectionPart`;
`fileCorrectionIn` picks the series from the invoice. Failing first, new `give-back-full-invoice.test.ts`:
goodwill in cash files one R1 and no plain refund; two rates; separate terminal; reader; two payments then
Finish, then Stop here; the press sent again writes nothing; no registered address moves no money and works
once set; a second give-back; an advance that is a full invoice; another box's, an unsound chain's and
`refused_no_fix`'s go back plain.

**Task 6, routing and limits.** `give-back-plan.ts`, `give-back-read.ts` (`lineAvailability`),
`tender-refund-reservation.ts` (`plainRefundLimit`; `readRefundableTendersWithLimits` `:186-218`, its `owed`
and catch branch, so the till's limit equals the write's). On a full invoice: `owed` is 0 wherever it caps a
plain refund, the corrective names the ticked families for the whole amount, a plain refund is refused (D5),
both rights are asked (D4). Failing first: a cancelled paella of 18.50 files R1 −18.50; goodwill with a cancel
owed; while the filing waits, only the extra; the limit on a separate terminal; the PIN after Cancel and
refund. `give-back.test.ts` unedited. Changes `tender-refund-links.test.ts:555`, `:1010` (D5).

**Task 7, links and what is left.** The line-to-cancel map moves from `give-back-read.ts` to a new
`cancelled-lines.ts` (the reservation file imports the former's importer otherwise). Each leg, by any route,
is linked to the cancels still owed on the lines the corrective names (naming none: all still owed) and
**recorded before the give-back's `created_at`** (I11); `left` by section 5; a leg is never covered in
`authorizeStoredTenderRefund` (`:238-261`, I3); the resend's `fromCancel` check (`give-back.ts:170`) reads
the legs' links too (M4). Failing first: every row of section 5's table; split over cash and a card; a failed
leg leaves it owed; goodwill 10.00 over two payments with the paella cancelled between, and Finish links
nothing to it; a linked pending leg retried by someone with neither right is refused.

**Task 8, the audit's test.** New `full-invoice-correctives.test.ts`: every row of section 2 from an F1, rows
1 and 9 from an A1407 R4, each asserting the records naming the original. Also: opened while queued, a leg
pending, AEAT answers `1112`, the leg completes: nothing filed, one alert, Finish ends it unrecorded (money
out with no corrective, accepted). Proof by deletion: the builder's check, then the series choice.

**Task 9, words.** Section 3's other rows. Till, EN and ES, naming the page: no registered address; a refused
filing that waits (the receipt's sentence, `codes.ts:1395`, says cancelled-dish money still goes back: untrue
here); `refused_no_fix` ("The tax agency refused this full invoice and Waitron cannot fix that, so the money
given back is on your accountant's list"). Both guides' "cannot correct a full invoice" and PIN sentences,
`docs/backlog/fiscal.md`, the adviser sheet's "Money given back as goodwill" point (it lists a full invoice).
Tests: `alerts.test.ts` (both wordings, a row with no `fullInvoice`), `codes.test.ts`, `accountant-export.test.ts`.

Until PR 4, an R1 filed after a card prints nothing and is printed from Find a bill: a receipt's rule today.
A refused **R1** has no fix on the dashboard, as an R5 has none (`put-right.test.ts`), and an F1 holding an
R1 can never get its R4 (`sale.replacement_not_first`); PR 2 says so. Sale-path read changed: no.

## PR 3 — blank quantity and unit price on a line given back in part

Independent; may land first. It changes what a filed full invoice prints (art. 6.1.f): light path is
question 9.

**Task 10, which lines.** New `corrective-lines-in-part.ts`, called by `transaction-receipt.ts` and
`invoice-document.ts` for a corrective that is no replacement. Failing first, on filed rows: one dish; 3 of 3;
one of 3's money; two halves; 350 g at 5.20/kg whole; a discounted dish; a dish that shared a free item; a
divided set menu's dish; an extra; the whole credit of section 6; a replacement.

**Task 11, what prints.** `receipt-lines.ts` (rows merge only when alike in it), `receipt-facts.ts`,
`receipt-document.ts` (no stray indent). Failing first: both papers, whole and part on one, A4 and rolls, a
reprint equal, totals unchanged. Look.

## PR 4 — it goes out the way the original went, or as the request says (server)

**Sale-path read changed: yes** (delivery reads `replaces_original` of a sale it already reads by id).

**Task 12, deliverable.** `deliversAsFullInvoice` and its SQL twin (`invoice-selection.ts:36`, `:44`) admit a
corrective that is not a replacement, each caller checked: `invoice-delivery.ts:56`,
`invoice-delivery-status.ts:260`, `document-printer-offers.ts:129`, `invoice-document.ts:44`,
`invoice-print.ts:98`, `print-job-reprint.ts:201`, `alert-sources.ts:678`, `:695`; and `receipt-print.ts:519`,
`:751`, which test for F1. `departmentOf` (`invoice-email-contact.ts`) reads a corrective's contact from the
invoice it corrects, which covers M7's sites at once. An R4 replacement's delivery is unchanged.

**Task 13, sent when filed.** `fileCorrectionIn` sends it once inside `optionalDocument` (request key
`corrective:<id>`) by the choice handed to it, else the original's way (D8); the answer's corrective part gains
number, customer, amount and how it was sent. Failing first: the three ways from cash, a late answer (the
original's way) and Finish; an A4 printer switched off since (alert, filing stands); no receipt printer on the
opening device (nothing queued, filing stands); a resend sends nothing again.

**Task 14, the choice.** The press, `/cash`, `/file` and a correction's `/refunds` leg take `delivery`, checked by
`checkedInvoiceChoiceDelivery` with the original as source after the ids are looked up and before anything is
written; refused on a receipt; stored nowhere, so a resend of a filed press ignores it. The read gains `invoice`
(customer name, preset, options as `/api/invoice-delivery-options` works them out, the address only where
`till-sale-receipt-routes.ts:206-215` shows it).

**Task 15, try again.** `transaction-receipt-api.ts` gains email and its retry
(`till-sale-receipt-routes.ts:249-345`); the dashboard's `invoice_delivery.*` alerts name Find a bill for a
corrective. Failing first: email, retry, each refused where an F1's button is.

## PR 5 — staff can change it (till)

**Task 16.** The Delivery field and email box move from `invoice-recipient-dialog.ts` to
`widgets/invoice-delivery-choice.ts`; that dialog's tests pass unedited.

**Task 17, the window.** `give-back-dialog.ts` is at 1,000 of 1,000 lines and `till-app.ts` at 25,731 of 25,750:
move code out first. A dish or Goodwill on a full invoice shows **How the invoice goes to {customer}**, on the
preset; saved with the press and a `rest`; `PROVES_NOTHING` gains `invoice_delivery.printer_invalid`,
`invoice_delivery.email_unavailable`, `fiscal.taxpayer_domicile_missing`. Failing first: shown on a full
invoice, never on a receipt; the choice kept for `rest`.

**Task 18, under way and the end screen.** The same field in Money back under way, and these lines, from what
the server says was done ({amount} is the corrective's, not the give-back's):

| | English | Spanish |
| --- | --- | --- |
| Printing | A corrective invoice for {customer} (−{amount}) is printing. | Se está imprimiendo una factura rectificativa para {customer} (−{amount}). |
| Queued | A corrective invoice for {customer} (−{amount}) is being emailed to {email}. | Se está enviando por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| Sent | A corrective invoice for {customer} (−{amount}) has been emailed to {email}. | Se ha enviado por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| A receipt's | A corrective receipt (−{amount}) is printing. | Se está imprimiendo un ticket rectificativo (−{amount}). |

**Task 19, a past R1.** `till-ticket-view.ts` (1,199 of 1,250) and `till-app.ts`'s F1 delivery checks, through one
helper, show an R1 the delivery block and try-again buttons; both guides.

## True size

Lines from the files each task names, then Give money back's yardstick (its plan's "True size"; run: `git show
--numstat` of `e9106dcc71` and `787644b5f5`): server half 550 / 1,300 estimated, 2,427 / 3,104 built; till half
1,250 / 1,600, then 3,466 / 6,010. About 3 times. Plan for the right-hand column.

| | Tasks | By file (production / test) | Expect |
| --- | --- | --- | --- |
| PR 1 | 1–4 | 200 / 550 | 600 / 1,500 |
| PR 2 | 5–9 | 320 / 900 | 900 / 2,600 |
| PR 3 | 10–11 | 70 / 250 | 150 / 500 |
| PR 4 | 12–15 | 260 / 650 | 700 / 1,900 |
| PR 5 | 16–19 | 260 / 500 | 800 / 1,700 |

About 3,150 production and 8,200 test lines expected. Nineteen tasks of 50 to 80 calls each; split one that
passes 60 unfinished. No generated file, migration or reset. Risk triggers: PRs 1, 2, 4 fiscal, money,
permissions: full path, two Codex reviews; PR 5 light. Order: Give money back's PR 3 with 15c, then PR 1, 2,
4, 5; PR 3 whenever. Each leaves `main` green and working. Changed checks: those the tasks name, plus
`find-bill-transactions.test.ts`, the till's print line and the `GiveBackView` fixtures; `give-back.test.ts:1121`
(`not_simplified`) stays, now F3.

## What this plan does not do

- Cancel and credit, Reopen to split and the dashboard's fixes on a full invoice: refused as today.
- A corrective of a full invoice AEAT refused with no fix, one refused while a give-back was under way
  included (Task 8), or of an F3.
- A receipt's cancelled-dish corrective (the October decision); picking how many of a dish (A802).
- The rewording of what is on `main`, and a receipt paper's title.

## For the watcher

Each needs a yes; the recommended answer follows the dash.

1. **D2:** a full invoice AEAT refused waits only while Waitron offers a fix, else its money goes back with no
   corrective as today; held and set-aside ones wait — yes.
2. **D5:** a plain refund of money that could be corrected is refused everywhere, cancelled-dish money
   included — yes.
3. **D4, the cancelled-dish rule:** both rights, so a PIN after Cancel and refund where a receipt's asks none —
   yes; it follows from the owner's answer 2, which does not mention the PIN.
4. **D6, no column:** a late card answer goes out the way the original went — yes. The column keeps staff's
   choice for it and costs a reset of every box.
5. **D1, F3 refused** (reworded) — yes.
6. **M1, delete three server routes nothing calls** (`POST …/corrections`, `…/preview`, `GET …/lines`; not
   planned) — yes, in a small pull request before PR 1: they are half of the option plumbing. Lane L's own
   D16 kept them.
7. **The paper title word:** a receipt's corrective keeps "Corrective invoice" / «Factura rectificativa» — leave it
   (the law allows it; «ticket» would stand on paper headed «Factura simplificada»), but ask the owner whether
   "corrective receipts … everywhere" meant the paper too: 15c leaves printed titles, so nobody has it.
8. **D3, a mixed press's paper:** shared by menu price while the cancel reads paid first — yes; the other way
   means per-line amounts in the fiscal code.
9. **PR 3 on the light path** (one Codex review) — yes.
10. **Building R1 before the adviser answers** that a dish that never came is R1 (question 6 of the open sheet);
    an R1 filed cannot be undone, no venue is live; and counting run 37286368370 as the AEAT gate — yes to both.
