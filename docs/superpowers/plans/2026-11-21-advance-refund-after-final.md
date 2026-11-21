# Give back a part payment after the table's invoice has taken it off — Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development, one `implementer` per task.
> Steps are checkboxes (`- [ ]`).

**Status: for the watcher's clearance, then the owner's (a fiscal change).** Nothing is built. Branch
`feat/advance-refund-after-final`, worktree
`~/workspace/worktrees/waitron-feat-advance-refund-after-final`, from `main` at `3e6eaf02b4`.
Revised after fresh reads 1 and 2 (`~/waitron-campaign-l/receipts/advance-refund-plan-read-1.md`,
`advance-refund-plan-read-2.md`).

**Words used here.** An **advance** is a part payment whose payer asked for a receipt of their own:
Waitron issues them a ticket worded «Pago a cuenta» ("payment on account"), at 10% VAT. A **ticket**
is a simplified invoice (factura simplificada), the receipt that names no customer. The **table's
invoice** is the ticket issued when the meal ends; it lists the dishes and takes each advance off.
A **corrective** (factura rectificativa) is a new numbered invoice that reduces an earlier one; AEAT
(the Spanish tax agency) calls a corrective of a ticket an **R5**. A **record** is what Waitron files
with AEAT for each invoice. **Correct invoice** is the till's existing window that gives money back
and files the corrective.

## Outcome

Once a table's invoice has taken an advance off, staff can still give the guests money back through
the till. While the table's invoice still has money to give back and a dish left to correct at the
advance's own rate (10%), that money comes back through **Correct invoice** on the table's invoice,
as today. Otherwise (a €0.00 table's invoice; dishes sent back for more than it carries; or no dish
at 10% left on it) the money comes back through **Correct invoice** on the guest's own «Pago a
cuenta» ticket, opened from **Find a bill** or from **Refund** on that payment: cash with its own
drawer opening, or card. The table's invoice is never altered by it.

**The answer to the first question.** Money goes back by a corrective of the table's invoice while it
can still give back money for dishes at the advance's rate; otherwise by a corrective (R5) of the
guest's own «Pago a cuenta» ticket, naming that ticket, as Waitron already files it before the
table's invoice exists. The adviser has not said which invoice to correct in this case, so this is
the recommended default, with a third way (one corrective naming both tickets) put to the adviser.

## What happens today

Receipts are marked **RUN** (throwaway Vitest files in `apps/server/src/` through the real till
routes with `useVenueDb`, run as `pnpm exec vitest run src/<file>` in `apps/server` with
`TESTCONTAINERS_RYUK_DISABLED=true`, every run's tests passed, files deleted before each commit) or
**READ** (`file:line`). "Refusal off" means the run replaced `refuseTakenOffAdvance` with a no-op
through `vi.mock`, in the test file only.

- **Before the table's invoice, an advance is corrected by an R5 of its own ticket. RUN.** A €30
  cash advance filed an F2 (an ordinary ticket record) of €30, 10% 27.27 and 2.73, described
  «Pago a cuenta — consumo en mesa …». Correct invoice for €10 in cash filed an R5 in the corrective
  series (`R/1`), "by differences" (`TipoRectificativa` `I`), 10% −9.09 and −0.91, whose
  `FacturasRectificadas` (the field naming the corrected invoice) named the advance. It wrote one
  completed cash refund on the advance's own payment and one `drawer_opens` row, reason
  `tender_refund` (`apps/server/src/invoice-correction-cash.ts:141`, READ).
- **The table's invoice records the advance only on its printed lines. RUN.** Example 1 (€120, €30
  advance, €90 paid): an F2 of €90.00, 10% 81.82 and 8.18, with no field naming the advance; stored
  lines are the dish and one deduction line (base −27.27, gross −30.00) naming the advance. Its only
  payment is the €90.
- **After the table's invoice, nothing gives advance money back. RUN.** Correct invoice on the
  advance answers 409 `advance.taken_off_final_invoice` (`apps/server/src/invoice-corrections.ts:151`,
  from `apps/server/src/advance-taken-off.ts:13-27`, READ). A €0.00 table's invoice has `left` and
  `moneyRefundable` 0.00, and a €20 preview on it is refused `sale.correction_amount_invalid`. With
  €100 of dishes back on example 1, the table's invoice takes its €90 and the other €10 is refused.
  The till's **Refund** opens Correct invoice on an advance only while the bill is not printed
  (`apps/till/src/till-app.ts:23130`, READ); afterwards it sends a bill refund, which the server
  refuses (`apps/server/src/bill-refunds.ts:689`, READ).
- **Dishes cancelled before the table's invoice cannot leave the advances above the bill. RUN.**
  Removing a €20 dish from a €140 bill holding a €130 advance is refused 409
  `bill.received_exceeds_total`, excess 10.00 (`apps/server/src/bill-payments.ts:553`, READ). Giving
  the €10 back first on the advance, then removing the dish, issues a €0.00 table's invoice. So the
  cancel route did not reach `advance.exceeds_bill` (`apps/server/src/advance-deduction.ts:89-91`);
  the advances plan says piece 1 cannot reach it (ruling L4,
  `docs/superpowers/plans/2026-11-19-adviser-advances.md:142`). I did not try every route that
  changes a bill. That check stays piece 4's.
- **With the refusal off, the existing path files and moves money correctly. RUN.** €0.00 table's
  invoice, €20 cash back on the advance: R5 10% −18.18 and −1.82 naming the advance, a drawer
  opening, the bill still `settled` and owing nothing, the table's record untouched. Example 1 with
  €90 back on the table's invoice, then €10 on the advance: 10% −9.09 and −0.91. A hand-keyed card
  advance came back by its card leg (10% −27.27 and −2.73) with no drawer opening.
- **Mixed rates, refusal off. RUN.** Reader's example: €120 menu at 10% and €20 at 4%, a €130
  advance, €10 paid at the end. The advance filed 10% 118.18 and 11.82; the table's invoice 10%
  −9.09 and −0.91 beside 4% 19.23 and 0.77. The 4% dish goes back: the table's invoice gives back
  its €10 (4% −9.62 and −0.38) and the advance €10 (10% −9.09 and −0.91). VAT over the four records
  is €10.39; the €120 menu kept owes €10.91, so **€0.52 is under-declared**. In example 2 (€20 food
  at 10%, €80 wine at 21%, €50 advance) the wine going back declares €4.29 of VAT on the €20 food,
  whose own VAT is €1.82: **€2.47 over-declared** (worked out by hand from figures the reader's run
  confirmed, and `apps/server/src/advance-corrections.test.ts:311`).
- **Food sent back on example 2 cannot go back at its own rate through the table's invoice. RUN**
  (refusal off). The table's invoice's lines route shows the 10% food `left` 0.00, the 21% wine
  `left` 80.00, `moneyRefundable` 50.00. €20 of food back on it naming the food line is refused 409
  `sale.correction_amount_invalid`; naming no line it answers 200 at 21%, 16.53 and 3.47 (the food's
  VAT is 1.82: €1.65 under-declared). On the advance it answers 200 at 10%, 18.18 and 1.82, exact.
  So "the table's invoice first" must mean first **at the advance's rate** (Design 1).
- **The dish reports leave an advance's corrective out. RUN.** Example 1, €90 back on the table's
  invoice and then €10 on the advance (refusal off): the VAT summary shows €20.00 (10% 18.18 and
  1.82), but category sales shows €30.00 gross (27.27 net) and top sellers the menu at 27.27. Both
  reports keep only lines with no advance role (`packages/reporting/src/category-sales.ts:209`,
  `:218`; `packages/reporting/src/top-sellers.ts:72`, `:80`), and a corrective copies its line's
  role (`packages/core/src/correction-history.ts:386`), all READ. Measured over whole bills
  (RUN): example 1 changed the VAT summary by €20 and category sales by €30; example 2 with €20 food
  back on the advance, €80 and €100; a whole credit of example 1's table's invoice, −€90 and −€120
  (on `main` today, before any advance refund); €30 back on the advance after it, −€30 and €0. With
  the `advance_role is null` filter removed from `category-sales.ts` (`:209`, `:218`), category sales
  moved exactly with the VAT summary in all four (€20, €80, −€90, −€30), the advance lines netting
  under **Not recorded**, and `packages/reporting/src/category-sales.test.ts` had 1 failed and 28
  passed: the failure is `:765`, "category sales count example 1's dishes once and leave out the
  advance's line and the deduction line". The file was restored afterwards.
- **A settled bill's `received` ignores Correct invoice refunds, with or without advances. RUN.**
  Control, no advance: €120 paid, €90 back by Correct invoice → the payments route answers `total`
  30.00, `received` 120.00. `moneyOf` nets only bill refunds, and an advance by what is left of it
  (`apps/server/src/bill-payments.ts:317-330`, READ), so an advance's corrective lowers `received`
  (example 1 above: 110.00) and this change does not make the gap worse.
- **A wholly credited table's invoice. RUN** (refusal off). After a whole credit of example 1's
  table's invoice, its lines route answers `sale.correction_history_unusable`, and a €30 preview on
  the advance answers 200 (10% 27.27 and 2.73). The advance's line carries the role
  `payment_on_account`.
- **Waitron's copy of AEAT's checks does not look at which invoice a corrective names. RUN.** The
  advance's R5 passed `validate` as filed, with a second ticket added to `FacturasRectificadas`, and
  with that field removed. The run says nothing about whether AEAT accepts two tickets.

**What the adviser has said (READ).** Answer 1.5: a price reduction made after the ticket is issued
"will, where applicable, require" a corrective invoice
(`docs/compliance/2026-11-15-adviser-answers.md:483-484`). Answer 1.7: "A real sale that was paid and
then refunded gets a **corrective** instead, given to the customer and kept linked to the evidence
of the refund" (`:227-229`). Question 12 of the 19 November sheet proposes "a corrective taking €200
off the advance's invoice" when a company's surplus becomes a tip, and lists giving back the €200
without saying which invoice it corrects (`docs/compliance/2026-11-19-adviser-meeting.md:270`); it
was added after the meeting and has no answer on file (`:455-468`). The invoicing regulation allows
one corrective for several invoices: art. 15.4, «Se podrá efectuar la rectificación de varias
facturas en un único documento de rectificación, siempre que se identifiquen todas las facturas
rectificadas» (several invoices may be corrected in one corrective, as long as it names them all;
`docs/compliance/research/2026-10-09-vat-and-corrections.md:302-303`). So which invoice is corrected
here is **not settled**: adviser questions A1 and A2.

## Design

1. **Table's invoice first, at the advance's rate (server).** In the checks Correct invoice runs
   before preview, open and its lines (`checkInvoiceCorrectable`, `invoice-corrections.ts:137-163`),
   replace the taken-off refusal: once a table's invoice has taken the advance off, refuse
   `advance.final_invoice_first` (`saleId`, `finalSaleId`, `invoiceNumber`, `rate`, `moneyLeft`) while
   that invoice still has money to give back and a dish at the advance's own rate left to correct,
   as its own lines route reports them; `moneyLeft` is the smaller of the two. A table's invoice with
   a whole credit has nothing left: its lines route answers `sale.correction_history_unusable` (RUN,
   below), so the check reads the whole credit first rather than calling that route. Otherwise the
   advance's corrective goes ahead, filed by `recordCorrection` unchanged.
2. **Rates below the advance's (server; only under owner O2 (i)).** Refuse
   `advance.rate_below_advance` (`saleId`, `finalSaleId`, `invoiceNumber`, `rate`) when the table's
   invoice holds a dish at a rate below the advance's own. Under O2 (ii), the default, nothing is
   built here.
3. **A correction opened before the table's invoice (server).** Keep `advance.taken_off_final_invoice`
   only on a correction's refund legs (`apps/server/src/tender-refund-reservation.ts:216`), narrowed
   to a correction opened before the table's invoice was issued; rewrite the comment at `:214-215`.
   `advance.correction_open` stays: it still makes the table's invoice take off the advance as
   corrected.
4. **Plain refunds (server).** A plain or bill refund of an advance's money keeps
   `tender.refund_of_advance` or `bill.refund_of_advance`, naming the advance's ticket
   (`advance-taken-off.ts:37-50` loses its first step). This is the lane's choice; the watcher may
   overrule it.
5. **Category sales (`packages/reporting`; owner O3, O4).** Under O3's default, remove the
   `advance_role is null` filter from both halves of the report's line query
   (`category-sales.ts:209`, `:218`), so an advance, its deduction line and every corrective of
   either count, and net to what was given back. Under O4's default they show under a row of their
   own, **Payments on account** / **Pagos a cuenta**, a new kind beside `not_recorded`
   (`category-sales.ts:34`, `:108-109`, `:138-142`; `apps/dashboard/src/api/client.ts:1669`;
   `apps/dashboard/src/screens/dashboard-sales-screen.ts:661-662`; two strings in
   `apps/dashboard/src/i18n/strings.ts`). Top sellers stays as it is: it counts dishes.
6. **Till.** **Refund** on an advance's payment opens Correct invoice on its ticket whether or not the
   bill is printed (remove `open.printed !== true` at `till-app.ts:23130`; rewrite the comment at
   `:23136-23137`). Words for the two new codes, EN and ES:
   - `advance.final_invoice_first`: "The table's receipt{invoiceNumber} can still give back
     {moneyLeft} for dishes at {rate}% VAT, this payment on account's rate. Use Correct invoice on
     that receipt first. Once it has no dish at that rate left to correct, correct this payment on
     account." / "El ticket de la mesa{invoiceNumber} todavía puede devolver {moneyLeft} de platos al
     {rate} % de IVA, el tipo de este pago a cuenta. Usa primero Rectificar factura en ese ticket.
     Cuando ya no le quede ningún plato a ese tipo por rectificar, rectifica este pago a cuenta."
   - `advance.rate_below_advance`, only under O2 (i): "This bill has a dish at {rate}% VAT, below this payment on
     account's rate, so the till cannot yet give this money back after the table's
     receipt{invoiceNumber}: how to record it is with the tax adviser. Nothing has been given back."
     / "Esta cuenta tiene un plato al {rate} % de IVA, por debajo del tipo de este pago a cuenta, así
     que la caja aún no puede devolver este dinero después del ticket de la mesa{invoiceNumber}: cómo
     registrarlo está consultado con el asesor fiscal. No se ha devuelto nada."
   - `advance.taken_off_final_invoice`, now only for a correction opened before the table's receipt:
     "This correction was opened before the table's receipt{invoiceNumber} took this payment on
     account off. Choose Discard, then open Correct invoice on this ticket again." / "Esta
     rectificación se abrió antes de que el ticket de la mesa{invoiceNumber} descontara este pago a
     cuenta. Elige Descartar y vuelve a abrir Rectificar factura en este ticket."
   - The two refund-of-advance messages (`apps/till/src/i18n/codes.ts:656-663`) lose "While the
     table's bill is still open" and say "that gives the money back, and while the bill is open
     takes it off the bill" instead of "that gives the money back and takes it off the bill".
7. **Not touched:** `recordSale`, `recordCorrection`, `recordSubstitution`, the chain, invoice
   numbering, the table's invoice and its deduction lines, `advance.exceeds_bill`.

## Decisions

- **Owner O1 (fiscal approval).** Table's invoice first; the rest as an R5 of the advance's own
  ticket. Recommended: yes. It replaces the 14:26 rule, by the owner's words recorded at
  `~/waitron-campaign-l/queue.md:79` (2026-11-20 ~22:40): "I think we have to allow a refund". The
  advances plan offered this shape ("refuse it once the table's invoice exists, except for what the
  table's invoice cannot take", `docs/superpowers/plans/2026-11-19-adviser-advances.md:408-409`).
- **Owner O2: an advance's corrective when the bill mixes rates.** The advance's corrective is at 10%.
  On a bill whose dishes are all at 10% or above, it can only over-declare: in example 2 the food
  now comes back exactly (10% −18.18 and −1.82, RUN above), and wine given back from the advance
  while the table's invoice still holds money at 21% declares too much (all €50 at 10% instead of
  21%: €4.13 over, worked out by hand); with the table's invoice exhausted, the wine's last €30
  declares €2.47 over. A dish below 10% can under-declare: the 4% example, €0.52 under (RUN). Choose
  for bills holding a dish below 10%:
  - **(i)** refuse the advance's corrective (`advance.rate_below_advance`) until the adviser answers
    A2. That refusal offers the person no next step, so it needs **the owner's exception to the
    self-service refusal rule** (CLAUDE.md §3, "A refusal explains … Never send the person to
    somebody else"). Cost: on such a bill the money has no way back through the till until then.
  - **(ii) Recommended:** allow it, and record it for the adviser: A2 carries the 4% example, and
    such correctives are found later as R5s of a «Pago a cuenta» ticket whose table's invoice holds
    a dish below 10%, so the accountant can put the VAT right through the corrections report if
    the adviser says so. Cost: a few cents of VAT under-declared per such refund until then, in
    records that cannot be withdrawn. How often a bill holds a dish below 10% was not measured.
  - The exact alternative is one corrective naming both tickets at the dishes' own rates (A1, third
    way), which changes `recordCorrection`, an invoice builder: not in this plan.
- **Owner O3: category sales.** Recommended: the simpler rule, drop the `advance_role is null`
  filter (Design 5). It matched the VAT summary in every measured case, a whole credit included
  (RUN). Cost: it reverses piece 1's choice to leave advance lines out, and
  `packages/reporting/src/category-sales.test.ts:765` changes; an advance on a bill still open
  shows in category sales from the moment it is paid, as it already does in the VAT summary, and
  is netted out by the table's invoice's deduction line. Alternative: count only an advance's
  corrective issued after the table's invoice took it off, and only when that invoice has no whole
  credit: without that condition, a whole credit then €30 back on the advance gives category sales
  −€150 against the VAT summary's −€120 (RUN: −€120 and €0 measured with the filter as it is, plus
  the −€30 this alternative adds). Leaving both reports as they are shows category sales above
  takings on such bills (example 1: €30.00 against €20.00).
- **Owner O4: the row's name.** "Not recorded" means a category was not recorded
  (`apps/dashboard/src/i18n/strings.ts:3047`), so money given back would read as missing data.
  Recommended: a row of its own, **Payments on account** / **Pagos a cuenta**, which is one new
  kind, its sort place and two strings across the five sites in Design 5 (read, not built). If it
  turns out bigger than that, the advance lines stay under **Not recorded**.
- **Adviser A1 and A2.** *"Once the table's ticket has taken off Ana's €30 advance (ticket A/12), the
  guests get money back for more than the table's ticket can give back: dishes are sent back, or the
  advances paid for the whole meal and the table's ticket came to €0.00. We plan to give back what
  the table's ticket holds by a corrective of it, and the rest by a corrective (R5) of A/12 at A/12's
  10%. Is that right? Or should one corrective name both tickets (art. 15.4) and carry the returned
  dishes' own rates? When the dishes sent back were at 4% or 21%, may the part taken off A/12 stay
  at 10%? On a bill with water at 4%, may it stay at 10% when the water is what went back (€120 menu,
  €20 water, €130 advance: €0.52 less VAT declared than the meal's)?"* Recommended default until
  answered: Design 1, and O2 (ii). Cost if the adviser wants one
  corrective naming both: the R5s filed meanwhile stay in the chain; at a single rate they declare
  the same VAT; building the joint corrective is an invoice-builder change for the owner, and AEAT's
  acceptance of two named tickets is untested (RUN above).
- **Watcher W1.** No pointer from the table's invoice to its advances in Correct invoice; the new
  `advance.final_invoice_first` wording names the table's receipt the other way round. Recommended:
  none.
- **Watcher W2: the settled bill's `received` figure.** It predates advances (control RUN) and this
  change does not make it worse. Recommended: under the loose-ends rule, one line in the PR thread,
  not fixed here.

## Changed test checks

Reason for every row: the owner, 2026-11-20 ~22:40 (`~/waitron-campaign-l/queue.md:79`): "refusing
over payment only partly works. what if ordered items are cancelled after part payment? you could
still get into the same situation. I think we have to allow a refund".

| Test | Before | After |
| --- | --- | --- |
| `apps/server/src/advance-corrections.test.ts:437` | Correct invoice on the advance refused `advance.taken_off_final_invoice`, nothing filed | refused `advance.final_invoice_first`, naming the table's invoice, `rate` 10.00 and `moneyLeft` 90.00; nothing filed |
| `apps/server/src/advance-corrections.test.ts:461` (lane's choice) | plain and bill refunds refused `advance.taken_off_final_invoice` | refused `tender.refund_of_advance` and `bill.refund_of_advance`, naming the advance's ticket; no refund written |
| `apps/server/src/advance-corrections.test.ts:702` | after a whole credit of the table's invoice, Correct invoice on the advance refused | its preview answers 200, 10% 27.27 and 2.73 (RUN with the refusal off): the credited invoice has nothing left |
| `apps/till/src/till-app-bill-payments.test.ts:8118` | Refund on a printed bill's advance sent a bill refund and showed the taken-off refusal | it opens Correct invoice on the advance's ticket and sends no bill refund |
| `apps/till/src/i18n/codes.test.ts:1033` | refund-of-advance wording with "While the table's bill is still open" | Design 6's wording, EN and ES |
| `apps/till/src/i18n/codes.test.ts:1055` | the taken-off wording sending staff to the table's receipt | Design 6's wording for a correction opened before the table's receipt |
| `packages/reporting/src/category-sales.test.ts:765` (under O3's default) | example 1's advance line and deduction line left out | they count, under O4's row, and net to 0.00 |

`advance-corrections.test.ts:564` and `:582` stay unchanged: Design 3 keeps what they check.

## Tasks

Each task leaves `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` unedited, and touches no invoice builder, the
chain or numbering. Focused runs: `pnpm --filter @waitron/server exec vitest run <file>`, `pnpm
--filter @waitron/till exec vitest run <file>`, `pnpm --filter @waitron/reporting exec vitest run
<file>`.

- [ ] **Task 1a: the advance's corrective after the table's invoice (server).** Failing first, in
  `apps/server/src/advance-corrections.test.ts`: (a) €0.00 table's invoice, €20 cash back on the
  advance files 10% −18.18 and −1.82 naming it, one `drawer_opens` row `tender_refund`, bill
  `settled` owing 0.00, table's record unchanged; (b) example 1 while the table's invoice holds €90:
  refused `advance.final_invoice_first` with `rate` 10.00 and `moneyLeft` 90.00 (row `:437`); after
  €90 back on it, €10 on the advance files 10% −9.09 and −0.91; (c) example 2: €20 of food back on
  the advance while the table's invoice still holds €50 at 21% files 10% −18.18 and −1.82; (d) the
  4% bill, after its table's invoice gave back its €10: the advance is not held back by Design 1
  (that invoice's 10% menu shows `left` 0.00, RUN), and files 10% −9.09 and −0.91 under O2 (ii), or
  is refused `advance.rate_below_advance` with `rate` 4.00 under O2 (i); (e) row `:702`. Then
  Design 1 and 3, and Design 2 under O2 (i), the codes in
  `apps/server/src/errors.ts` and `apps/server/src/till-api.ts` beside `:666` (409). Run `:564` and `:582`
  unchanged.
- [ ] **Task 1b: category sales (reporting).** Failing first, in
  `apps/server/src/advance-corrections.test.ts` (the reports need the till's routes), each measured
  as the change over one bill: example 1 with €90 back on the table's invoice and €10 on the
  advance moves category sales by €20.00, as the VAT summary (fails today: €30.00); a whole credit
  of the table's invoice moves it by −€90.00 (fails today: −€120.00); top sellers unchanged. Then
  Design 5 under O3 and O4, row `category-sales.test.ts:765`, and a unit case for the new row in
  that file. Under O3's alternative, the cases pin its figures instead.
- [ ] **Task 2: card legs and plain refunds (server).** Failing first: a hand-keyed card advance and
  a reader card advance (fake provider, following `apps/server/src/invoice-correction-cards.test.ts`)
  given back after a €0.00 table's invoice, no drawer row; row `:461`. Then Design 4. Run
  `pnpm exec vitest run scripts/errors-reachable.test.ts` from the root.
- [ ] **Task 3: the till.** Failing first: row `till-app-bill-payments.test.ts:8118`, the
  `codes.test.ts` rows and cases for the two new codes' words. Then Design 6.
- [ ] **Task 4: guides and docs.** The guide's "While the bill has no invoice, **Refund** …"
  (`apps/server/src/guide/en/table-service.md:220-221`, `apps/server/src/guide/es/table-service.md:235-236`)
  becomes: Refund beside a payment that has its own ticket opens Correct invoice on that ticket; once
  the table's receipt has taken it off, money comes back first through Correct invoice on the table's
  receipt, and what it cannot give back through the guest's own ticket. Run `pnpm --filter
  @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run
  scripts/guide-links.test.ts`. Rewrite `docs/backlog/fiscal.md:97-114` for the new rule and
  `advance.correction_open`'s reason (it keeps the table's invoice from taking off an advance whose
  correction is still open). Add A1 and A2 to the adviser sheet's question 12, EN and ES. Add dated
  pointers to this plan beside the 14:26 answer in `docs/superpowers/plans/2026-11-19-adviser-advances.md:239-241`
  and `:411-418`, rewriting neither.

## Guards to run

`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` (unedited, must
pass), `apps/server/src/advance-final.test.ts`, `advance-money.test.ts`, `bill-advances.test.ts`,
`advance-corrections.later-sale-date.test.ts`, `invoice-correction-cards.test.ts`, the whole of
`packages/reporting` (`pnpm --filter @waitron/reporting test`), `scripts/errors-reachable.test.ts`,
`scripts/corrective-sums.test.ts`, and the guide guards in Task 4.

## Risks

- **Table's invoice first sends money to whoever paid it.** When Ana alone is owed money and Bob
  paid the table's invoice by card, the first refund goes to Bob's card or the cash drawer, through
  that invoice's own steps. This is the cost of Design 1.
- **The adviser answers A1 or A2 the other way.** The R5s filed meanwhile stay, as costed above.
- **Piece 1b (full-invoice advances) is not built.** Every advance is a ticket today
  (`advance.full_invoice_unsupported`, `errors.ts:877-879`), so every corrective here is an R5; once
  1b lands, a full-invoice advance needs piece 3's correctives of full invoices.
- **A refund that is not a price cut** (a mistaken payment, say) is still recorded as a corrective,
  as any Correct invoice is.
