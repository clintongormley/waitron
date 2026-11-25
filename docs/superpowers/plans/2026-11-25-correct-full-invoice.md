# CORRECT-FULL-INVOICE: giving money back on a full invoice files a corrective full invoice

Status: plan, written 2026-11-25 on `docs/correct-full-invoice-plan` from `0cd0274ee1`. Not started;
not read by anyone else yet. Design:
[2026-11-25-correct-full-invoice-design.md](../specs/2026-11-25-correct-full-invoice-design.md), with
the owner's answers at the end of its section 6. FISCAL: the owner lands every pull request.

**Base:** `main` plus #4300 (`feat/give-money-back-till`) plus PR 3 of Give money back
(`feat/give-money-back-remove-old`), which removes the two old windows and does the "corrective
receipt / corrective invoice" rewording of what is on `main`. Server line numbers were read on `main`
at `0cd0274ee1`; `give-back*.ts` and till ones in those two worktrees. Results marked "run" came from
the command beside them; everything else was read.

**Words.** A *receipt* is the simplified invoice (AEAT's F2) most guests get; its corrective is R5.
A *full invoice* (F1) names the customer; its corrective here is **R1**. A *corrective* is the new
invoice, with negative amounts, filed when money goes back (`invoice_corrections` while under way).
A *plain refund* is money back with no corrective. A *leg* is one refund that is part of a
corrective. The *press* is one Give back, with its four ids.

## 1. Should this exist?

**The ask** (owner, 2026-11-24, told the till cannot correct a full invoice): "but we will build this
functionality, no?" (lane L `queue.md`). Today Give money back on a full invoice gives the money with
no corrective, so the business deducts VAT on money it got back and the venue goes on declaring it.
After PR 1 it gets a corrective; after PR 2, the way staff choose. Not available: section "What this
plan does not do".

**Simplest alternative.** Change nothing: the accountant issues the corrective by hand, outside
Waitron's numbering and record chain. That does not meet the ask. Inside the ask, the simplest build
is PR 1 alone: the corrective filed and printed on the receipt printer as a receipt's is. PR 2 exists
because the owner asked for the delivery choice, PR 3 because the owner asked for the blank columns.
PR 2's one column could be left out (D6 says what is lost).

**Who decided what.** The owner's four answers are quoted in the design. Open for the watcher to
overrule (mine unless said):

| # | Decision |
| --- | --- |
| D1 | Only an F1, or A1407's R4 replacement of one, gets an R1. An F3 (a full invoice made from receipts) stays refused as today; no route issues one (section 2, row 13) |
| D2 | A full invoice whose filing AEAT **refused** now waits, as a receipt's does, where today its money goes back at once. Two exceptions keep today's plain refund and the accountant's list: a full invoice refused as dated in the future (`1112`), which Waitron cannot put right while `FULL_INVOICE_REPLACEMENT_ON` is off (`packages/fiscal-verifactu/src/put-right.ts:17`, `:40-44`), and every refusal that is for good today (another box's invoice, records that need checking) |
| D3 | A cancelled dish's money on a full invoice goes on the corrective (owner) and waits with it (D2). The legs are linked to the cancel, so the cancel reads as paid and is never offered twice |
| D4 | So it needs both rights, money back and corrective: the cancel's own approval no longer covers it, and the window that opens filled in after **Cancel and refund** asks a PIN when the person signed in lacks either, where a receipt's asks none |
| D5 | A plain refund of a full invoice's payment money that could be corrected is refused (`tender.refund_needs_correction`) on every route, cancelled-dish money included, so nothing can go round the corrective. The extra paid on top still goes back plain |
| D6 | The delivery staff chose is kept on the give-back (`invoice_corrections.delivery`, one new column): **core's starting migration is rebuilt and every box is reset when PR 2 lands.** A corrective can be filed after the press has ended (a card company that answers late, money left for another payment, **Finish**), from code with no till asking. Without the column those correctives go out the way the original did, and what staff chose is lost; everything else in PR 2 stands |
| D7 | A full invoice's corrective is delivered by whatever files it, the background recovery included, under the person who opened it; on the receipt printer, at the device that asked, or with nobody asking the one that opened it. A receipt's corrective keeps today's rule: printed when a person's cash press files it, not otherwise |
| D8 | Preset: the original's delivered attempt, else its newest. Email and A4 are offered only where they can be sent from this device now; otherwise the preset is the receipt printer |
| D9 | The end screen says "is being emailed to …" until the mail server has taken it, then the owner's "has been emailed to …" |
| D10 | "In part" also covers a whole line whose stored price does not come to its amount (section 6) |
| D11 | The tax-office list keeps R4 for replacements, reworded, and gains R1; Find a bill gains the type **Corrective invoice** beside **Corrective receipt** |

## 2. The audit: every path that issues a document against an original

Run: `rg -n "recordCorrection|recordReplacement|recordSubstitution|recordVoid"` over non-test code.
`recordCorrection` has three callers (`apps/server/src/invoice-corrections.ts:482`,
`cancel-credit.ts:66`, `packages/fiscal-verifactu/src/record-remedy-corrective.ts:55`),
`recordReplacement` one, core's `recordSubstitution` and `recordVoid` none outside tests.

**Result: no path can file a receipt-type corrective (R5) against a full invoice today.** Three
refusals stand in the way: the admission check (`correction-admission.ts:57-60`), core's
(`record-correction.ts:184`, `correction-history.ts:117`) and the record builder, which writes an R5
only for an F2 or the R5 replacing one (`backend.ts:583-587`). The series is the weak point:
`invoice-corrections.ts:481` and `cancel-credit.ts:55` ask for the receipts' series without looking
at the invoice. Task 1 makes the builder the last word: the type comes from the original's record and
the customer handed to it, and any other pairing is refused.

| # | Path | Today on a full invoice | After | Held by (Task 5 unless said) |
| --- | --- | --- | --- | --- |
| 1 | Give money back, cash: `give-back.ts:540` → `invoice-correction-cash.ts:151` | plain refund, nothing filed (`give-back-plan.ts:233-237`) | R1 | files R1, `full_corrective` |
| 2 | …separate terminal: `give-back-api.ts:160` → `invoice-correction-alerts.ts:183` | as 1 | R1, after commit | as 1 |
| 3 | …card reader: `give-back-reader.ts:112` | as 1 | R1 | as 1 |
| 4 | The card company answers late: `tender-refunds.ts:186`; the recovery pass, reached at start too: `boot.ts:4780` → `tender-refund-recovery.ts:35` → `invoice-correction-alerts.ts:101-109` | nothing open to file | R1 | a leg left pending, then the sweep files R1 |
| 5 | Money back under way: cash `invoice-correction-api.ts:159`, card `tender-refund-api.ts:154`, **Finish** and **Stop here** (`/file`, `invoice-correction-api.ts:218`), **Finish** that ends it unrecorded and **Cancel** (`/close`, `:224`) | nothing open | R1; ending it files nothing against the original | each step |
| 6 | The old Correct invoice routes: `invoice-correction-api.ts:85`, `:100`, `:126` | refused `sale.correction_not_admitted` (`not_simplified`), pinned by `tender-refund-links.test.ts:1010-1025` | same refusal, same code | existing, kept |
| 7 | Refund a payment's route: `tender-refund-api.ts:154` | plain refund, no document | refused (D5) | Task 4 |
| 8 | Cancel a placed order (Cancel and credit): `till-drawer-and-cancel-routes.ts:124` → `working-order-counter.ts:190` | refused `sale.correction_unsupported` (`bill-payments.test.ts:1021`) | same | existing + no record written |
| 9 | Reopen to split: `split-after-print.ts:65`, refused first at `:102` | refused (`split-after-print.test.ts:476`) | same | existing + no record written |
| 10 | The dashboard's fix by replacement: `record-remedy-replacement.ts:82-87` → `record-replacement.ts:97-102` | R4 in the full series, and switched off | same | existing (`backend.test.ts:921-1031`) |
| 11 | The dashboard's corrective-invoice fix: `record-remedy-corrective-http.ts:82-99` | not enabled (`record-remedy-routes.ts:34-38`); core refuses | same; its request list admits no new field | a body naming `fullInvoice` is refused |
| 12 | The dashboard's record correction: `record-remedy-http.ts:164-165` | re-files the same invoice; its type, customer, what it corrects (`:104-118`) and its amounts may not change | same | existing (`record-remedy-facts.test.ts:218-253`) |
| 13 | Exchange for a full invoice (F3), void | no production caller; the builder refuses an F3 of anything but an F2 (`backend.ts:729`); a void is not an invoice | same | existing |

Printing, reprinting and resending lay out a stored invoice and issue nothing. Close of day, the
settle loop and advances call `recordSale`, which corrects nothing. `payments-api.ts:2096` settles a
refund and leaves filing to row 4.

## 3. Every reader of "a corrective naming a customer is R4"

| Reader | Today | Change (Task 6) |
| --- | --- | --- |
| `packages/orders-sales/src/invoice-typing.ts:23`, `:38`, `:96`; its type in `apps/till/src/api/client.ts:1096` | R4 | R4 when `replaces_original`, else R1; R1 prints the full layout |
| `apps/server/src/tax-office-list.ts:8`, `:67-68`; `apps/dashboard/src/api/client.ts:1759`; strings `tax_office.kind.*` | R4 | R1 "Corrective invoice" / «Factura rectificativa»; R4 "Corrective invoice replacing another" / «Factura rectificativa por sustitución» |
| `apps/server/src/invoice-email.ts:61` | title for R4, R5 | adds R1 |
| `apps/server/src/find-bill-transactions.ts:66`, and `:91` (`i.type <> 'correction'`); till `find-bill-types.ts:8`, `till-find-bill-screen.ts:45` | every corrective is "correction", labelled Corrective receipt by #4300 | a fourth type `full-correction`; **`:91` excludes both**, or a refund attaches to the corrective |
| `orders.detail.corrective` (dashboard order detail), `corrections-report.ts`, `accountant-export.ts:547` | one word for both | the invoice's customer picks "Corrective invoice" or "Corrective receipt", after Give money back's PR 3 has reworded them |
| `packages/fiscal-verifactu/src/returned-invoices.ts:76`, `record-remedy-facts.ts:113` | already list R1 | none |
| `registro-row.ts:144-148` | refuses an operation date on anything but F1, F2 and a replacement | none: an R1 files none |
| `correctivesOf` and its readers (`scripts/corrective-sums.test.ts`), `packages/reporting`, the VAT return | by `corrects_sale_id`, whatever the type | none; Task 6 pins one VAT return row |
| `invoice-customer-data.ts:153` (a customer's own invoices) | any sale naming the customer | none: R1s join it; pinned |
| `invoice-lookup-api.ts:50`, `owed-receipts.ts:57`, `deferred-close.ts:132` | leave correctives out | none |

## 4. Printed titles

Read at boe.es on 2026-11-25 (`curl` of BOE-A-2012-14696; arts. 6, 7 and 15 whole, and every line of
the act holding «rectificativ»). RD 1619/2012 **sets no title** there for a full invoice, a simplified
one or a corrective of either; arts. 6 and 7 list contents. What a corrective of
a receipt must say is art. 7.1.h: «En caso de facturas rectificativas, la referencia expresa e
inequívoca de la factura rectificada y de las especificaciones que se modifican»; and art. 15.4: «…una
nueva factura en la que se haga constar los datos identificativos de la factura rectificada».
**So the law does not stop the paper saying "Corrective receipt" / «Ticket rectificativo».** Its own
phrase for one is «factura simplificada rectificativa» (art. 15.5).

The paper prints **"Corrective invoice" / «Factura rectificativa»** on both kinds today
(`receipt-document.ts:167`, `invoice-layout.ts:119-120`, `invoice-email.ts:62`; labels
`packages/country-es/src/receipt-labels.ts:39`, `:128`, five languages), beside the corrected number
and date. This plan prints that title on a full invoice's corrective and does not change a receipt's:
whether its paper and email become "Corrective receipt" belongs to Give money back's PR 3. **For the watcher:** the
word «ticket» would then stand on paper whose original is headed «Factura simplificada».

**Blank unit price (answer 4).** Art. 6.1.f asks a full invoice for «el precio unitario sin
Impuesto», but art. 15.5 says of a corrective: «los datos que se regulan en los párrafos f) y h) del
citado artículo 6.1 se podrán consignar, bien indicando directamente el importe de la rectificación,
con independencia de su signo…». Read (mine): the amount alone is enough on a line given back in part.

## 5. AEAT's test service, before PR 1 lands

**Already answered, I believe.** Run
[37286368370](https://github.com/waitron-io/verifactu/actions/runs/37286368370) (mode
`rejected-invoice-credit`, head `d99e107738`) sent as `controlCredit` an R1, `TipoRectificativa` "I",
`FacturasRectificadas` naming one F1, −1.00/−0.21, and **the customer by NIF**: the record is built
from `buildTestRecord`, whose `Destinatarios` it keeps (`git show d99e107738:scripts/live-aeat.mjs`,
lines 250 and 577–598). AEAT answered `Correcto`
(`docs/superpowers/specs/2026-10-05-aeat-protocol-evidence.json:20580-20598`). The design said this
shape was untried; that was wrong. **Not covered:** a customer named by another identifier
(`IDOtro`), two VAT rates, and an R1 correcting an R4.

To repeat it: `gh workflow run live-aeat.yml --repo waitron-io/verifactu --ref main -f
mode=rejected-invoice-credit`. It needs write access to that repository and nothing on this machine:
the test certificate, issuer and customer are secrets of its `aeat-preproduction` environment, which
runs from `main` only (`gh api …/environments/aeat-preproduction`: a branch rule, no reviewer). Lane
L's ledger gives the same command for its last run, 44707265624 (`item-adviser-advances-ledger.md`). I
did not run it. **Recommend:** count the gate met and quote the
run in PR 1; the watcher may ask for one repeat. Other identifiers would need a new mode in the
library and I do not recommend holding for it: the block is copied as AEAT already took it on the F1.

## 6. How "given back in part" is known

From the stored filed rows, when the corrective is laid out: the corrective's row points at the line
it corrects (`sale_lines.corrects_line_id`). The two columns print only when **both** hold:

1. **Whole:** minus the row's `line_gross` equals the corrected line's `line_gross`. Two correctives
   that each take half of a dish are both in part.
2. **The price comes to the amount:** `unit_price × quantity ÷ price_quantity` is within one cent per
   unit of `line_total` (ordinary invoices already differ by that much: run, below).

| Line | What prints |
| --- | --- |
| One dish, all of it back | −1 × price |
| A row of 3, all of it back | −3 × price. Nobody owns giving back 1 of 3 as "−1": a correction takes an amount, and "Picking how many of a dish" is A802's open entry (`docs/backlog/fiscal.md`). One beer's money out of 3 is in part |
| A discounted dish, all back | −1 × the price paid: the stored unit price is the discounted one (run: 10.00 sold at 8.00, 10% → 7.27 and 7.27) |
| A dish that shared its price with a free item (A445), all back | blank, by 2: the shared amount moved and the unit price did not (run: salad 9.62 against 8.01, free water 0.00 against 1.38) |
| A divided set menu's dish | compared with the whole `line_gross`, part included, on both rows, so the `line_gross − set_menu_part` reading is not needed; the menu's own row is never on a partial corrective (`printed-set-menu-parts.ts:7-13`) |
| A whole-invoice credit (Reopen to split, Cancel and credit), a replacement | unchanged: rows reverse exactly, or name no line |

Run: a throwaway test of `rateLines` and `shareFreeItems` in `packages/orders-sales`, removed
afterwards; 3 × 1.50 gave 1.36 each against 4.09, one cent off. Only filed rows are compared with
filed rows, so CLAUDE.md §3's rule on changed filed totals is not in play. A reprint is laid out from
the same rows, so it prints the same.

## PR 1 — the corrective itself (server, plus the words that name it)

About 420 production and 1,150 test lines; no migration. **Sale-path read changed: no.** Risk
triggers: fiscal records, money, permissions: full path, two Codex reviews. Every task runs, unedited
and passing: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
src/inmutabilidad.test.ts src/correction-amount.huella.test.ts`.

**Task 1: admission and record builder — about 60 calls.** `packages/fiscal/src/backend.ts` (an
eligible answer says `fullInvoice`), its fake; `packages/fiscal-verifactu/src/correction-admission.ts`,
`backend.ts` (the type choice moves to a new `correction-type.ts`; `backend.ts` is 935 of 1,000
lines). Failing first, in `backend.test.ts`: the grid of original {F1, F2, F3, R1, R4 "S", R4 "I",
R5 "S", R5 "I"} × {customer, none}. F1 and R4 "S" with a customer file an R1 "I" with the **stored**
`Destinatarios` (even when handed another name), no `ImporteRectificacion`, no `FechaOperacion`, the
library's `validate` empty, a huella that recomputes; F2 and R5 "S" with none file an R5 "I"; every
other pair is `fiscal.correction_unsupported` and writes nothing. In `correction-admission.test.ts`:
F1 and R4 "S" admitted as `fullInvoice` (the cases at `:189-196` change); refused filing waits; `1112`
on an F1 answers `not_simplified` (D2).

**Task 2: core — about 60 calls.** `packages/core/src/correction-history.ts`, `record-correction.ts`,
`correction-eligibility.ts`. An option `fullInvoice: true` on `previewCorrectionAmounts`,
`readCorrectableLines` and `recordCorrection`. Failing first: without it every refusal today is
unchanged, code included (`correction-history.test.ts:531`, `record-correction.test.ts:662`, and
`not_simplified` from admission); with it, on an F1 and on an R4's original: the `full_corrective`
series required, name, tax number, identifier, address and the business's current registered address
copied to the corrective's row, `backend.recordCorrection` handed the customer; no registered address
refuses `fiscal.taxpayer_domicile_missing` in preview, read and writer, before a number is taken;
with it on an invoice naming nobody, or with `wholeInvoice`, refused.

**Task 3: Give money back asks for it — about 75 calls.** `invoice-corrections.ts`,
`give-back-press.ts`, `give-back-read.ts`. `readCorrectableNow` and everything acting on an **open**
corrective (`fileCorrectionIn`, `fileNowFor`, `previewOrRefusal`, Close) pass the option; opening one
passes it only from `openCorrectionPart`, so the old routes still refuse (row 6). `fileCorrectionIn`
picks the series and option from the invoice. Failing first in a new `give-back-full-invoice.test.ts`
on a real venue (customer chosen as `tender-refund-links.test.ts:199` does): goodwill in cash files one
R1 and no plain refund; two rates; a separate terminal; a card reader; money over two payments, then
Finish and Stop here; a press sent again writes nothing; an invoice with no registered address moves
no money, shows the reason on every choice but the extra, and works once it is set; a second give-back
on the same invoice; an advance that is a full invoice; another box's and an unsound chain's still go
back plain.

**Task 4: a cancelled dish's money — about 75 calls.** `give-back-plan.ts:205-239`,
`give-back-read.ts` (`lineAvailability`, `cancelled.back`), `tender-refund-reservation.ts:163-182`,
`:465-533`. On a full invoice that can be corrected: no plain part; the corrective names the ticked
dishes' families for the whole amount; each leg, whatever route sends it, is linked to the cancels
still owed on the lines the corrective names (or, naming none, to all still owed, as a plain refund
naming none is today); `left` no longer subtracts what a **filed** corrective's legs gave; a
plain refund is refused (D5). Failing first: a cancelled paella of 18.50 files R1 −18.50 and its cancel
reads paid; 1 of 2 croquetas cancelled leaves the other's money and no more; goodwill with a cancel
owed; split over cash and a card; a leg that fails leaves it owed; Cancel and refund's window asks a
PIN (D4); a receipt's are unchanged (the existing `give-back.test.ts` cases, unedited). Changes
`tender-refund-links.test.ts:1010` (now refused, by D5) and `:557`.

**Task 5: the audit's test — about 55 calls.** New `apps/server/src/full-invoice-correctives.test.ts`:
one case per row of section 2 that starts from an F1, and rows 1 and 8 again from an A1407 R4, each
asserting the records naming the original: only R1 (rows 1–5), or none and the refusal's code. Proved
by deletion: with the builder's check removed, and again with `invoice-corrections.ts`'s series line
restored, name which cases fail.

**Task 6: readers and words — about 75 calls.** Section 3's table. Till words for the new refusals,
EN and ES, naming the page as the house rule asks: no registered address ("…Add it in the dashboard,
under Venue settings › Venue details."), and a refused filing on a full invoice (the receipt's
sentence says cancelled-dish money still goes back, which is untrue here). The end screen's print
line says corrective invoice. `apps/server/scripts/receipt-look.ts:597` gains an R1; open 58 mm, 80 mm
and A4 in both languages and look. Tests: `invoice-typing` cases in `receipt-issuer.test.ts`,
`receipt-document.test.ts`, `invoice-document.test.ts`, `tax-office-list.kinds.e2e.test.ts`,
`find-bill-transactions.test.ts`, `invoice-email.test.ts`, one VAT return row. Both guides
(`table-service.md`, "The till cannot correct a full invoice naming a customer" in Print the bill, and
Give money back's PIN sentence), `docs/backlog/fiscal.md` `:1182`, and the goodwill point of the
adviser sheet's question 14, which lists "a full invoice naming a customer" as uncorrectable.

## PR 2 — how the customer gets it

About 620 production and 1,150 test lines, plus the rebuilt starting migration (generated).
**`Sale-path read changed:` yes** — `reserveInvoiceDelivery` and the delivery status read one more
column of a sale they already read by id (`sales.replaces_original`). **Reset every box** (D6), said
in the PR's first line. Needs PR 1.

**Task 7: the choice on the server — about 70 calls.** `packages/db/src/schema/invoice-corrections.ts`
(`delivery`, the `StagedInvoiceDelivery` JSON `working_orders` uses, null on a receipt's) and
`pnpm --filter @waitron/server migration-baseline rebuild --set core`; new `give-back-delivery.ts`.
The read gains `invoice: null | { customerName, delivery: { preset, invoicePrinter, emailAvailable,
emailNeedsReceiptContact } }`: the preset by D8 from `readInvoiceDeliveries` on the original, the
options as `/api/invoice-delivery-options` works them out (`till-working-order-routes.ts:363-376`), the
email address only where `till-sale-receipt-routes.ts:207-216` shows it. The press gains `delivery`,
checked by the existing `checkedInvoiceChoiceDelivery` (`invoice-choice-delivery.ts:26`) with the
original as its source, after the press's ids are looked up and before anything is written; absent
means the preset; on a receipt, or a press with no corrective part, it is refused. **The same ids
sent again** answer what the first send stored and deliver nothing; with a different `delivery` they
refuse `submission.id_reused`; where the first send left the corrective unfiled, the resend files it
and it goes out the stored way. Failing first: each preset; a deleted or other device's A4 printer;
email not set up; the resends; `write-path-tables` and the schema guards CLAUDE.md §3
names. The column is a new place an email address is kept (as `working_orders.invoice_delivery` is):
check the data-protection guide's list.

**Task 8: sent when it is filed — about 75 calls.** `fileCorrectionIn` delivers a full invoice's
corrective once, by its stored choice, inside `optionalDocument` (a failure never undoes the filing),
request key `corrective:<id>`, under `requested_by` (D7): A4 and email through
`reserveInvoiceDelivery`, the receipt printer through `enqueueOriginalReceipt`. `deliversAsFullInvoice`
and its SQL twin (`packages/orders-sales/src/invoice-selection.ts:36`, `:44`) admit a corrective that is
not a replacement; check each caller: `invoice-delivery.ts:56`, `invoice-delivery-status.ts:260`,
`document-printer-offers.ts:129`, `invoice-document.ts:44`, `invoice-print.ts:98`,
`print-job-reprint.ts:201`, `alert-sources.ts:678`, `:695`; and `receipt-print.ts:519`, `:751`, which
test for F1. The answer's corrective part gains its number, customer, amount and how it was sent.
Failing first: the three ways, each from cash, a late card answer through the sweep, and Finish; an A4
printer switched off since (fails, alert raised, filing stands); an R4 replacement's delivery
unchanged.

**Task 9: try again — about 60 calls.** `transaction-receipt-api.ts`: a corrective has no bill, and
those routes only print (`:79-88`, `:237`), so they gain email and its retry, as
`till-sale-receipt-routes.ts:249-345` has, with the email contact read from the corrected invoice's
department (a corrective's own is null). The dashboard alerts `invoice_delivery.*` say "from the
order, … on the Orders page"; for a corrective they name Find a bill on a till.

**Task 10: the shared choice on the till — about 55 calls.** The Delivery field and its email box
move out of `invoice-recipient-dialog.ts` (`:179-247`, `:522-553`) into
`widgets/invoice-delivery-choice.ts`; that dialog's tests pass unedited.

**Task 11: the window — about 80 calls.** `give-back-dialog.ts` (994 of 1,000 lines: move the form's
way list out first), `give-back-steps.ts`, `state/give-back.ts`, `give-back-types.ts`, strings. With A
dish or Goodwill on a full invoice, **How the invoice goes to {customer}**, starting on the preset,
above Give back and before the terminal step. Saved with the press and with a `rest`, so Send again
and Give back the rest carry it (an email address then sits in the till's refund journal, which
signing out clears); `state/give-back.ts`'s `PROVES_NOTHING` gains
`invoice_delivery.printer_invalid`, `invoice_delivery.email_unavailable` and
`fiscal.taxpayer_domicile_missing`. End screen, from what the server says was done, never guessed:

| | English | Spanish |
| --- | --- | --- |
| Printing (receipt printer, A4) | A corrective invoice for {customer} (−{amount}) is printing. | Se está imprimiendo una factura rectificativa para {customer} (−{amount}). |
| Emailed, queued (D9) | A corrective invoice for {customer} (−{amount}) is being emailed to {email}. | Se está enviando por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| Emailed, sent | A corrective invoice for {customer} (−{amount}) has been emailed to {email}. | Se ha enviado por correo a {email} una factura rectificativa para {customer} (−{amount}). |
| A receipt's, printing | A corrective receipt (−{amount}) is printing. | Se está imprimiendo un ticket rectificativo (−{amount}). |
| Not sent or printed | Its corrective invoice / receipt can be printed from Find a bill. (as today) | Su factura rectificativa / ticket rectificativo se puede imprimir desde Buscar cuenta. |

`{amount}` is the corrective's, not the whole give-back's. A button **See the invoice** / **Ver la
factura** opens it. Tests: `give-back-dialog.test.ts`, `.unsaved`, `.a11y`, `state/give-back.test.ts`,
`i18n/strings.test.ts`.

**Task 12: the invoice's own view, and the guides — about 70 calls.** A past R1 shows the delivery
block and try-again buttons an F1 shows: `till-ticket-view.ts` (its F1 checks, 1,193 of 1,250 lines)
and `till-app.ts` `:11014`, `:11280-11288` and the other `invoiceType === "F1"` checks about delivery,
through one helper; `till-app.ts` has 134 lines to its cap. Both guides: Give money back (the choice,
the two kinds of corrective, where to send it again) and Issue a full invoice.

## PR 3 — blank quantity and unit price on a line given back in part

About 110 production and 320 test lines; no migration; **Sale-path read changed: no** (the new read
runs only for a corrective). Independent of PR 1 and 2 and may land first. Paper only, no
risk trigger: light path, one Codex review.

**Task 13: which lines — about 45 calls.** New `apps/server/src/corrective-lines-in-part.ts` (section
6's rule), called by `transaction-receipt.ts:198-208` and `invoice-document.ts:98-127` only when the
sale corrects another and is no replacement; they mark a line `inPart`. Failing first, against filed
rows: every row of section 6's table, a weighed dish, an extra, the second half of a dish.

**Task 14: what prints — about 50 calls.** `packages/orders-sales/src/receipt-lines.ts` (`inPart`; two
rows merge only when alike in it, `:305`), `receipt-facts.ts:326-345` and `:385-446`,
`receipt-document.ts:213-224` (no stray indent where the quantity was). Failing first in
`receipt-facts.test.ts`, `receipt-document.test.ts`, `invoice-layout.test.ts`: receipt and full-invoice
correctives, whole and part on one paper, A4 and roll, reprint equal to the original; amounts, bases
and totals unchanged. Run `receipt-look.ts` and look, 58 mm, 80 mm, A4.

## Sizes, order, what changes in existing tests

| | production | test | generated |
| --- | --- | --- | --- |
| PR 1 | 420 | 1,150 | none |
| PR 2 | 620 | 1,150 | core's starting migration |
| PR 3 | 110 | 320 | none |

About 1,150 production and 2,600 test lines, against the design's 700 and 1,300: the growth is the
cancelled dish, the choice and its email routes, and the blank columns on both papers. Order: #4300,
Give money back's PR 3, then PR 1, PR 2; PR 3 whenever. Schema generation is in PR 2 only, so a rebase
there rebuilds from `main`'s copy.

**Existing checks that change, each with its decision:** `correction-admission.test.ts:189-196`
(admission), `backend.test.ts:493` (still refused with no customer; retitled), `tender-refund-links.test.ts:557`,
`:1010` (D5), `tax-office-list.kinds.e2e.test.ts:128` and the dashboard's kind list (D11),
`find-bill-transactions.test.ts` (D11), the till's print-line words (owner's answer 3),
`give-back-client.test.ts` and the `GiveBackView` fixtures (PR 2). `give-back.test.ts:1086`
(`not_simplified`) stays: it is now the F3 and `1112` case.

## What this plan does not do

- A receipt's cancelled-dish corrective (the October decision, its own backlog entry).
- Give back 1 of a row of 3 as a quantity; a corrective of an F3; changing a customer's details.
- Cancel and credit, Reopen to split and the dashboard's fixes on a full invoice: refused as today.
- The "corrective receipt / corrective invoice" rewording of what is on `main`, and the receipt
  paper's title (section 4): Give money back's PR 3.
- Turning on `FULL_INVOICE_REPLACEMENT_ON`.

## For the watcher

D2 (a refused full invoice now waits), D4 (a PIN after Cancel and refund), D5, D6 (the column and the
reset), D9's wording, and the live test: met by the earlier run, or repeated. The adviser's line
(R1 also for a dish that never came) is on the sheet's question 6. Nothing here waits for it: the owner's standing
call is to build on the best guess and let the specialist confirm later.
