# Give back a part payment after the table's invoice has taken it off — Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development, one `implementer` per task.
> Steps are checkboxes (`- [ ]`).

**Status: for the watcher's clearance, then the owner's (a fiscal change).** Nothing is built. Branch
`feat/advance-refund-after-final`, worktree
`~/workspace/worktrees/waitron-feat-advance-refund-after-final`, from `main` at `3e6eaf02b4`.

**Words used here.** An **advance** is a part payment whose payer asked for a receipt of their own:
Waitron issues them a ticket worded «Pago a cuenta» ("payment on account"), at 10% VAT. A **ticket**
is a simplified invoice (factura simplificada), the receipt that names no customer. The **table's
invoice** is the ticket issued when the meal ends; it lists the dishes and takes each advance off.
A **corrective** (factura rectificativa) is a new numbered invoice that reduces an earlier one; AEAT
(the Spanish tax agency) calls a corrective of a ticket an **R5**. A **record** is what Waitron files
with AEAT for each invoice. **Correct invoice** is the till's existing window that gives money back
and files the corrective.

## Outcome

Once a table's invoice has taken an advance off, staff can still give that guest money back through
the till: **Correct invoice** on the guest's own «Pago a cuenta» ticket, opened from **Find a bill**
or from **Refund** on that payment, gives the money back (cash with its own drawer opening, or card)
and files an R5 of that ticket. This covers a €0.00 table's invoice, where the advances paid for
everything, and dishes sent back after the table's invoice for more than it carries. The table's
invoice is never altered; money paid on it still comes back through Correct invoice on it.

**The answer to the first question.** The money goes back as a corrective of the guest's own
«Pago a cuenta» ticket, naming that ticket, exactly as Waitron already does before the table's
invoice exists. The table's invoice is left alone, because it declared only what was left after the
advance (down to €0.00) and holds none of the advance's money, so a corrective of it cannot give that
money back.

## What happens today

Receipts are marked **RUN** (a throwaway Vitest file in `apps/server/src/` through the real till
routes with `useVenueDb`, run as `pnpm exec vitest run src/<file>` in `apps/server` with
`TESTCONTAINERS_RYUK_DISABLED=true`, 6 and then 5 tests passed, files deleted before this commit) or
**READ** (`file:line`).

- **Before the table's invoice, an advance is corrected by an R5 of its own ticket. RUN.** A €30
  cash advance on a €120 bill filed an F2 (an ordinary ticket record) of €30, 10% base 27.27, VAT
  2.73, described «Pago a cuenta — consumo en mesa …». Correct invoice for €10 in cash filed an R5
  numbered in the corrective series (`R/1`), "by differences" (`TipoRectificativa` `I`), 10% −9.09
  and −0.91, whose `FacturasRectificadas` (the field naming the corrected invoice) named the
  advance's `A/1`. It wrote one completed cash refund on the advance's own payment and one
  `drawer_opens` row, reason `tender_refund` (the cash leg's drawer job,
  `apps/server/src/invoice-correction-cash.ts:141`, READ). The bill then owed €100.
- **The table's invoice records the advance only on its printed lines. RUN.** Example 1 (€120, €30
  advance, €90 paid): its record is an F2 of €90.00, 10% 81.82 and 8.18, with no field naming the
  advance. Its stored lines are the dish (base 109.09, gross 120.00) and one deduction line (base
  −27.27, gross −30.00) whose `deducts_sale_id` is the advance. Its only payment is the €90; the €30
  stays on the advance's ticket.
- **After the table's invoice, nothing gives advance money back. RUN.** With the €30 advance taken
  off, Correct invoice on the advance's ticket (preview, open, lines) answers 409
  `advance.taken_off_final_invoice` (refused at `apps/server/src/invoice-corrections.ts:151`, from
  `apps/server/src/advance-taken-off.ts:13-27`, READ). A €0.00 table's invoice (€140 bill, €120
  advance, €20 dish removed) has nothing to give back: its lines route shows `left` 0.00 and
  `moneyRefundable` 0.00, and a €20 preview is refused `sale.correction_amount_invalid`. When €100 of
  dishes go back on example 1, the table's invoice takes at most its €90 (a €100 preview is refused
  `sale.correction_amount_invalid`; €90 files), and the other €10 on the advance is refused with the
  same code. The till's **Refund** opens Correct invoice on an advance only while the bill is not
  printed (`apps/till/src/till-app.ts:23130`, READ); afterwards it sends a bill refund, which the
  server refuses (`apps/server/src/bill-refunds.ts:689`, READ).
- **Dishes cancelled before the table's invoice cannot leave the advances above the bill. RUN.** On
  a €140 bill with a €130 advance, removing the €20 dish is refused 409 `bill.received_exceeds_total`,
  excess 10.00 (`apps/server/src/bill-payments.ts:553`, READ), and nothing is issued. Giving the €10
  back first through Correct invoice on the advance (allowed before the table's invoice) and then
  removing the dish issues a €0.00 table's invoice, F2 10% 0.00 and 0.00. So `advance.exceeds_bill`
  (`apps/server/src/advance-deduction.ts:89-91`, READ) was not reached by the cancel route; the
  advances plan says piece 1 cannot reach it (ruling L4,
  `docs/superpowers/plans/2026-11-19-adviser-advances.md:142`, READ). I did not try every route that
  changes a bill. This plan leaves that check as it is: it stays piece 4's.
- **With the refusal switched off, the existing path does the right thing. RUN** (the same throwaway
  file, with `refuseTakenOffAdvance` replaced by a no-op through `vi.mock`, test-only). On the €0.00
  table's invoice, €20 back on the advance in cash filed an R5 of 10% −18.18 and −1.82 naming the
  advance, queued a drawer opening, left the bill `settled` with nothing owed, and left the table's
  record untouched. On example 1 with the table's invoice corrected by its €90, €10 more on the
  advance filed 10% −9.09 and −0.91. With only the €30 advance given back, the table's invoice could
  still be corrected by its €90 (preview 200), so no more than the €120 paid can come back. A
  hand-keyed card advance's €30 came back by its card leg, filed 10% −27.27 and −2.73, and queued no
  drawer opening. One oddity, not investigated: after the €90 and €10 corrections the bill's
  payments route answered `total` 20.00 and `received` 110.00; I did not check whether a bill
  without advances shows the same after Correct invoice.

**What the adviser has said (READ).** Answer 1.5: a price reduction made after the ticket is issued
"will, where applicable, require" a corrective invoice
(`docs/compliance/2026-11-15-adviser-answers.md:483-484`). Answer 1.7: "A real sale that was paid and
then refunded gets a **corrective** instead, given to the customer and kept linked to the evidence
of the refund" (`:227-229`). On advances, question 12 of the 19 November sheet proposes, for a
company's advance worth more than its meal, "a corrective taking €200 off the advance's invoice"
when the difference becomes a tip, and lists giving back the €200 as one of the agreed outcomes
without saying which invoice it corrects (`docs/compliance/2026-11-19-adviser-meeting.md:270`). That
question was added after the meeting and has no answer on file (`:455-468`). So the adviser has said
a refund needs a corrective, but **not which invoice is corrected once the table's invoice has taken
the advance off**. That is adviser question A1 below.

## Design

1. **Server.** Drop the taken-off refusal from Correct invoice
   (`invoice-corrections.ts:151`) and from a correction's refund legs
   (`apps/server/src/tender-refund-reservation.ts:216`). A plain or bill refund of an advance's money
   keeps its own refusal, `tender.refund_of_advance` or `bill.refund_of_advance`, which names the
   advance's ticket and Correct invoice on it (`advance-taken-off.ts:37-50` loses its first step).
   Delete `refuseTakenOffAdvance` and the code `advance.taken_off_final_invoice`
   (`apps/server/src/errors.ts:880-886`, the two doc comments at `:973-975` and `:989-991`, and
   `apps/server/src/till-api.ts:666`). `advance.correction_open` stays: before the table's invoice,
   an open correction of an advance still holds that invoice back.
2. **Till.** **Refund** on an advance's payment opens Correct invoice on its ticket whether or not the
   bill is printed (remove `open.printed !== true` at `till-app.ts:23130`). The two refund-of-advance
   messages lose "While the table's bill is still open" (`apps/till/src/i18n/codes.ts:656-663`); the
   `advance.taken_off_final_invoice` wording (`:664-667`, `:1135`) goes. No new window.
3. **Not touched:** the invoice builders (`recordSale`, `recordCorrection`, `recordSubstitution`),
   the chain, invoice numbering, the table's invoice and its deduction lines, `advance.exceeds_bill`.
   The corrective is filed by `recordCorrection` unchanged, in the existing corrective series.

## Decisions

- **Owner O1 (fiscal approval).** After the table's invoice, money paid on an advance comes back as
  an R5 of the advance's own ticket, filed as before that invoice. Recommended: yes. It replaces the
  14:26 rule, by your 22:40 words: "I think we have to allow a refund". The 22:40 words are on file
  only in the watcher's brief; `~/waitron-campaign-l/questions.md` does not hold them (searched).
- **Owner O2 and adviser A2: mixed VAT rates.** An advance is at 10%. When wine at 21% is sent back
  for more than the table's invoice carries at 21%, the rest comes off the advance at 10%. Example 2
  (€20 food at 10%, €80 wine at 21%, €50 advance, €50 paid at the end; worked out by hand, Task 1
  pins it): all the wine goes back; the table's invoice gives back its €50 (21% −41.32 and −8.68,
  as `apps/server/src/advance-corrections.test.ts:311` files today) and the advance €30 (10% −27.27
  and −2.73). Over the four records, the venue then declares €4.29 of VAT on the €20 it kept, where
  the food's own VAT is €1.82. The venue pays more VAT, never less. **Recommended: accept it.** The
  alternative would let a corrective of the table's invoice go below what it carries, which changes
  `recordCorrection` (an invoice builder). Cost if wrong: €2.47 of VAT overpaid in this example, and
  only on bills that mix rates and give back more than the table's invoice holds.
- **Adviser A1.** *"Once the table's ticket has taken off Ana's €30 advance (ticket A/12), the
  guests get money back: for example, dishes are sent back for more than the table's ticket
  carries, or the advances paid for the whole meal and the table's ticket came to €0.00. We plan to
  issue a corrective (R5) of A/12, by the amount given back, naming A/12, and leave the table's
  ticket as issued. Is that right, or should the table's ticket be corrected?"* Recommended default:
  the R5 of A/12, built now. Cost if wrong: records cannot be withdrawn, so R5s already filed stay
  in the chain naming A/12. At a single rate they declare the same VAT as a corrective of the
  table's ticket would. The other way needs a corrective that takes the table's ticket below zero,
  which `recordCorrection` refuses today (RUN above: `sale.correction_amount_invalid`), so it would
  be an invoice-builder change for the owner.
- **Watcher W1.** No pointer from the table's invoice to its advances inside Correct invoice.
  Recommended: none; the guide sends staff to the guest's ticket in Find a bill. Cost if wrong:
  staff with a €0.00 receipt look in the wrong place first; a pointer is a small till change later.
- **Watcher W2.** The two cases that write an open correction into the database to reach a state no
  route reaches (`advance-corrections.test.ts:564`, `:582`) are deleted with the guard they test,
  not rewritten. Recommended: delete.

## Changed test checks

Reason for every row: the owner, 2026-11-20 ~22:40, "refusing over payment only partly works. what
if ordered items are cancelled after part payment? you could still get into the same situation. I
think we have to allow a refund".

| Test | Before | After |
| --- | --- | --- |
| `apps/server/src/advance-corrections.test.ts:437` | Correct invoice on the advance refused `advance.taken_off_final_invoice`, nothing filed | it gives back €30 in cash and files an R5, 10% −27.27 and −2.73, naming the advance; the table's record unchanged |
| `apps/server/src/advance-corrections.test.ts:461` | plain and bill refunds of the advance refused `advance.taken_off_final_invoice` | refused `tender.refund_of_advance` and `bill.refund_of_advance`, naming the advance's ticket; no refund written |
| `apps/server/src/advance-corrections.test.ts:564`, `:582` (helpers `:486-562`) | a correction written open in the database had its cash or card leg refused | deleted (W2) |
| `apps/server/src/advance-corrections.test.ts:702` | after a whole credit of the table's invoice, Correct invoice on the advance refused | it files the advance's R5 |
| `apps/till/src/till-app-bill-payments.test.ts:8118` | Refund on a printed bill's advance sent a bill refund and showed the taken-off refusal | it opens Correct invoice on the advance's ticket and sends no bill refund |
| `apps/till/src/i18n/codes.test.ts:1033` | refund-of-advance wording says "While the table's bill is still open" | the wording without it, EN and ES |
| `apps/till/src/i18n/codes.test.ts:1055` | the taken-off wording, EN and ES | deleted with the code |

## Tasks

Each task leaves `packages/fiscal-verifactu/src/write-path.e2e.test.ts` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts` unedited, and touches no invoice builder, the
chain or numbering. Focused runs: `pnpm --filter @waitron/server exec vitest run <file>`, `pnpm
--filter @waitron/till exec vitest run <file>`.

- [ ] **Task 1: Correct invoice on an advance after the table's invoice (server).** Failing first,
  in `apps/server/src/advance-corrections.test.ts`: (a) the €0.00 case, €20 cash back on the
  advance files 10% −18.18 and −1.82 naming it, a `drawer_opens` row with reason `tender_refund`,
  the bill still `settled` and owing 0.00, the table's record unchanged; (b) example 1 with €100
  sent back, €90 on the table's invoice then €10 on the advance (10% −9.09 and −0.91); (c) example 2
  as in O2; (d) a hand-keyed card advance given back by its card leg, no drawer row; (e) a reader
  card advance given back through the fake provider, following
  `apps/server/src/invoice-correction-cards.test.ts`. Each fails today with
  `advance.taken_off_final_invoice`. Then remove the refusal at `invoice-corrections.ts:151` and
  `tender-refund-reservation.ts:216`, and apply the rows for `:437`, `:564`, `:582`, `:702`.
- [ ] **Task 2: plain refunds keep their own refusal; the code goes (server).** Failing first: row
  `:461`. Then remove the first step of `refuseAdvanceRefund`, delete `refuseTakenOffAdvance` and the
  code at the sites in Design 1. Also run `scripts/errors-reachable.test.ts` from the root
  (`pnpm exec vitest run scripts/errors-reachable.test.ts`).
- [ ] **Task 3: the till (till).** Failing first: row `till-app-bill-payments.test.ts:8118`, then the
  `codes.test.ts` rows. Then Design 2.
- [ ] **Task 4: guides and docs.** The staff guide's "While the bill has no invoice, **Refund** …"
  (`apps/server/src/guide/en/table-service.md:220-221`, `apps/server/src/guide/es/table-service.md:235-236`)
  becomes: Refund beside a payment that has its own ticket opens Correct invoice on that ticket, and
  once the table's receipt has taken it off, the guest's own ticket in Find a bill gives back what
  they paid on account. Then run `pnpm --filter @waitron/server exec vitest run
  src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`. Replace the
  14:26 sentences in `docs/backlog/fiscal.md:97-102` with the new rule and add question A1 to the
  adviser sheet's question 12 (EN and ES). Add a dated pointer to this plan beside the 14:26 answer in
  `docs/superpowers/plans/2026-11-19-adviser-advances.md:411-418` and `:239-241`, rewriting neither.

## Guards to run

`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` (unedited, must
pass), `apps/server/src/advance-final.test.ts`, `advance-money.test.ts`, `bill-advances.test.ts`,
`advance-corrections.later-sale-date.test.ts`, `invoice-correction-cards.test.ts`,
`scripts/errors-reachable.test.ts`, `scripts/corrective-sums.test.ts`, and the guide guards in
Task 4.

## Risks

- **The adviser answers A1 the other way.** Then the R5s filed in the meantime stay, as costed in A1.
- **Piece 1b (full-invoice advances) is not built.** An advance is always a ticket today
  (`advance.full_invoice_unsupported`, `errors.ts:877-879`), so every corrective here is an R5. Once
  1b lands, giving back a full-invoice advance needs piece 3's correctives of full invoices.
- **A staff member gives back an advance after the table's invoice for a reason that is not a price
  cut.** The R5 still records the money given back, as any Correct invoice does. The advances
  plan recommended this shape before the 14:26 answer refused it (its Q1, `:397-410`).
- **The settled bill's `received` figure after corrections** (the oddity above) is unexplained.
  Task 1's case (b) asserts only status and what is owed; whoever finds the cause fixes it in this PR
  if it is in the advance code.
