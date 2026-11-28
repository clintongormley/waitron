# Corrections by substitution, and a full invoice for a past receipt

Status: approved by the owner in session waitron-84, 2026-11-28 (each decision below quotes them).
FISCAL: the owner lands every pull request. Built on best guesses where marked; the tax adviser
confirms through question 15 of `docs/compliance/2026-11-19-adviser-meeting.md`, and the build does
not wait for the answer.

**Words used here.** A *receipt* is a simplified invoice (AEAT's F2). A *full invoice* names the
customer (F1). A *corrective* is a new invoice that corrects an earlier one (R1–R5). A corrective
*by differences* (AEAT's `TipoRectificativa` "I") carries only the change, usually negative. A
corrective *by substitution* ("S") carries the corrected figures and states the figures of the
version it replaces. The *latest version* of an invoice is the original, or the most recent
substitution that replaced it.

## 1. What the owner decided

| # | Decision | The owner's words (2026-11-28) |
|---|---|---|
| D1 | A correction that leaves an invoice with a total above zero is a corrective **by substitution, in one document** (AEAT's "option 1"): the corrected figures, plus the figures of the version it replaces. Receipts: R5 "S". Full invoices: R1 "S", same customer, the full correctives' series. | "I prefer substitutions because as a human, it's easier to understand, and you just have to look at the current invoice. You don't have to have all the chain of previous invoices together to understand what went on." Option 1 for a bill that stays: "agreed. we have a plan." |
| D2 | Each substitution names **the latest version**, never the first invoice. | "That seems like a simpler model to substitutions, because you're always just pointing at the head of the previous" |
| D3 | A correction that takes an invoice **to zero** (cancel, split after printing, everything given back) stays **by differences**, then fresh documents follow where needed. No replacement with all amounts at zero. | "a difference may actually be easier to understand because it's just taking down to zero. It's not issuing a zero order." |
| D4 | **Splitting or cancelling a printed full invoice** is built (refused today). Best guess: by differences to zero, naming the same customer — R4 for a split (the sale went ahead; only the paper changes), R1 for a cancel (the sale is undone, VAT law art. 80.Dos, as the adviser sheet's question 6 reads a dish that never came). The new bills start as full invoices for the same customer; staff may change the customer or switch any of them to a receipt. | "yes" (to including it); option "b" for the new bills |
| D5 | **Changing a full invoice's customer**: wrong details → R4 "S" with the same amounts; details and amounts together → one R1 "S" carrying both (best guess); a different customer altogether → R4 by differences to zero, then a new F1 to the new customer (best guess). | Proposed in the session; "Please build the plans to get this all implemented", then, asked whether to build it now or wait: "queue the changes with the watcher, who will decide priority. but i think this is pretty high" |
| D6 | **Make it a full invoice** for a past receipt issues **no F3**. Waitron credits the receipt with a negative F2 at the receipt's current standing value, then issues an ordinary F1 naming the customer for the same lines. Later corrections go on the F1 as R1s. | "i like the second route where we refund the receipt and replace it with an F1. That is much cleaner. Let's go that way and confirm with the adviser." |
| D7 | **One receipt becomes one full invoice.** Several receipts onto one F1 is not planned. | "yes sure" |
| D8 | Receipts that are an advance, that took an advance off, or that are still unpaid are refused by the first pull requests and **built by later pull requests of the same plan**. | "ok, but make sure it is part of the plan" |
| D9 | The F3 code is **removed from `main`** and kept on an archive branch. | "we don't plan to use it, correct? then leave it in a branch but remove it from main" |
| D10 | The negative F2 and the F1 **both carry the receipt's date of operation** (`FechaOperacion`), so a swap in a later quarter nets to zero in the receipt's quarter and leaves today's alone, matching Waitron's rule that a sale counts in its real day's VAT period (owner, 2026-11-14). Best guess: AEAT's own two-document example leaves the negative record's date blank («Fecha Operación: dejar en blanco»), so the adviser is asked. | "ok build the dates the way you think and ask for confirmation" |

Unchanged: a cancellation record (*anulación*) is only for an invoice that should never have existed
(the till's **Nothing was served**); refusals and sequencing of corrections never wait on AEAT's
answer (owner, 2026-11-27, A1619).

## 2. Every case, and what Waitron issues

Worked on one receipt: 1 beer 3 €, 2 chips 6 €, total 9 € at 10 % (8.18 € + 0.82 € VAT).

| Case | Documents | Record notes |
|---|---|---|
| Take the beer off a receipt | R5 "S": 2 chips, 6 € | names the latest version; replaced figures 8.18 + 0.82; paper also states the change, −3 € (RD 1619/2012 art. 15.5) |
| Then take one chips off too | R5 "S": 1 chips, 3 € | names the 6 € corrective; replaced figures 5.45 + 0.55 |
| Give everything back, or cancel a printed bill | R5 "I": −9 € (or minus the latest version's total) | as today |
| Split a printed receipt (Reopen bill) | R5 "I" to zero, then a fresh receipt per person | as today |
| Refund part of a full invoice | R1 "S", same customer, FR series | as D1 |
| Split or cancel a printed full invoice | split: R4 "I" to zero; cancel: R1 "I" to zero; same customer; new bills after a split start as F1 for that customer, staff may change customer or switch to receipt | D4 |
| Fix the customer's details on a full invoice | R4 "S", same amounts, corrected customer block | D5 |
| Fix details and amounts together | one R1 "S" | D5 |
| Invoice the meal to a different customer | R4 "I" to zero naming the old customer, then a new F1 | D5 |
| Make it a full invoice (past receipt) | negative F2 (receipt series) at the standing value, then F1 naming the customer; both carry the receipt's date of operation | D6, D10 |
| A refund after that | R1 "S" (or "I" to zero) on the F1 | D6 |
| A receipt AEAT refused | R5 "S" replacement with replaced figures 0.00 (Q37), as today | unchanged |

## 3. How it is built

**Stored data stays as it is; only the filed record changes.** Today a corrective's `sales` row holds
the change (`packages/core/src/record-correction.ts:367`), names the invoice it corrects in
`corrects_sale_id`, and every money and VAT reader sums those changes (`correctivesOf`,
`packages/db/src/correctives-of.ts`; `packages/reporting/src/vat-movements.ts`; the coverage trigger
in `packages/db/triggers/core.sql:118-130`). A substitution moves exactly the same money and VAT as
the difference would: AEAT nets "new figures minus replaced figures". So:

- A substitution's `sales` row keeps storing **the change**, and keeps naming **the invoice the
  corrections hang from** (the original, or its Q37 replacement as `correctionTargetFor` does today).
  The money readers, the VAT return and the coverage trigger need no change for it.
- The **filed record** carries the latest version's figures after the change in `Desglose` and
  `ImporteTotal`, the latest version's figures before it in `ImporteRectificacion`, and the latest
  version's number and date in `FacturasRectificadas`. Plan 1 (its decision S1) also stores, on the
  substitution's `sales` row, which version it replaces (`restates_sale_id`, unique, so each
  version is replaced at most once) and the corrected figures (`restated_total`,
  `restated_vat_breakdown`), so generic code can tell a substitution from a Q37 replacement without
  reading Veri\*Factu's tables. `total` and `vat_breakdown` still hold the change.
- What breaks, and the plans fix: the schema comment that a sale's `vat_breakdown` is the filed value
  (`packages/db/src/schema/sales.ts:90-92`) and `refuseMovedFigures`
  (`packages/core/src/correction-history.ts:259-291`); every place that reads "replacement" as Q37's
  full repeat (`replacesOriginal`, `inFull`, the printed "0,00 €", R4 typing in
  `apps/server/src/invoice-typing.ts:96`, Find a bill, the tax-office list, the accountant export's
  "no sumar"); the paper, which must show the corrected lines and total and the amount of the change.
- A zeroing correction is still "I". The choice is made from what is left after the change, so a
  give-back that takes everything left is "I".

**A full invoice for a past receipt** needs the negative F2 to be storable: `sales_total_ck`
(`packages/db/src/schema/sales.ts:171`) refuses a negative total with no `corrects_sale_id`. Pre-live,
the schema changes through the starting-migration rebuild. The credit and the F1 are linked to the
receipt by a new append-only table, one row per receipt. The receipt keeps its payments; the credit
and the F1 are left out of every reader that shows money owed or waiting for payment, and later
corrections of the F1 count against the receipt, the way a replacement's corrections do today (plan
3's decision N2: counting the credit against the receipt would show its payments as refundable
again). The VAT return and the accountant's sheets count both new documents, on the receipt's date
of operation. Payment lookups that follow `sale_substitutions` today follow the new link instead.

## 4. The plans

| Plan | Lane | What | Depends on |
|---|---|---|---|
| `docs/superpowers/plans/2026-11-28-substitution-1-correctives.md` | L | D1–D3: receipts and full invoices corrected by substitution; the AEAT test-service run first | CORRECT-FULL-INVOICE PR 4b/5 for its full-invoice half |
| `docs/superpowers/plans/2026-11-28-substitution-2-full-invoice-changes.md` | L | D4–D5: split and cancel a printed full invoice; change its customer | plan 1 |
| `docs/superpowers/plans/2026-11-28-full-invoice-for-a-receipt.md` | A | D6–D10: Make it a full invoice by credit and F1, the later cases, and removing the F3 code | replaces lane A's `~/waitron-campaign/till-fiscal-f3-plan.md` from F3-1a; reuses its screens |

## 5. For the adviser (question 15 of the current sheet)

1. D1–D2: substitution for corrections that leave a balance, each naming the latest version, repeated
   as often as needed; differences for those that take it to zero (D3).
2. D4: R4 for splitting and R1 for cancelling a printed full invoice; the new bills as full invoices or
   receipts.
3. D5: R4 "S" for wrong customer details; one R1 "S" for details and amounts together; R4 "I" to zero
   and a new F1 for a different customer.
4. D6, D7, D10: a negative F2 then an F1 instead of an F3; the negative F2 in the receipt series; both
   dated with the receipt's date of operation.
5. A substitution naming a latest version AEAT has refused: its figures are still the replaced
   figures (the owner's 27 November rule that a correction names the previous document even when
   AEAT refused it).

## 6. Sources (fetched 2026-11-28)

- AEAT, *Preguntas frecuentes — Procedimientos de facturación* (page updated 27/11/2026): substitution
  options 1 and 2 with worked examples, examples 4–6 correcting an earlier corrective, and «En el caso
  de que se realice un abono de la factura simplificada (mediante el envío de un registro negativo con
  clave "F2"), la factura emitida en sustitución de esta tendrá que informarse con la clave "F1".»
  https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html
- AEAT, *FAQs Desarrolladores* (4 December 2025), §27: «La rectificación de la simplificada puede
  hacerse por diferencias o por sustitución, y en caso de sustitución podría hacerse mediante una o dos
  facturas», and the F3 cases 1–3 this design no longer needs.
  https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf
- AEAT, *Validaciones y errores* v1.2.2: `FacturasRectificadas` «Sólo podrá incluirse esta agrupación
  (no es obligatoria) si TipoFactura es igual a "R1", "R2", "R3", "R4" o "R5"»; `ImporteRectificacion`
  «Obligatorio si TipoRectificativa = "S"». No rule found refusing a record whose amounts are all zero;
  D3 avoids such a record anyway.
  https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf

## 7. Statements this design retires

Dated pointers, not rewrites, go on: the 2026-11-25 full-invoice correction design §3 ("By
differences") and §7 (split and cancel left out); `docs/compliance/verifactu-findings.md` §10.2 (F3 as
the "make me a proper invoice" document); the till redesign spec §7.12 item 2 and §13 (the receipt is
not cancelled); lane A's F3 plan from F3-1a on.
