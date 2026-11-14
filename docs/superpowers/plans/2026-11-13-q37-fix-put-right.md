# Q37-FIX: put a refused invoice right from the Fiscal filing page — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development`. Dispatch each task as
> `subagent_type: "implementer"`. Every task is test-first: write the named failing check, run it,
> see it fail for the stated reason, then write the smallest code that passes it. Fiscal: the owner
> lands every PR this plan produces.

**Status:** revised plan, 2026-11-14, after the owner's and the watcher's answers and a fresh
review of `66c8455b8e`. Written in worktree `waitron-feat-q37-fix-put-right` (branch
`feat/q37-fix-put-right`) on `main` at `7fb59b4e84`. No product code was written when it was
revised; Tasks 1a–2b were then built on that branch (PR 2), and Task 3 waits on the owner's answers
A–E. **(run)** marks
what was run in this plan's sessions (2026-11-13 and 14); **(read)** marks what was only read. A few
results come from the first draft's session at `71baa3c8d0` and were not re-run; those say so.

## Words used in this plan

- **Simplified invoice (F2)**: the ordinary restaurant ticket, with no customer details. A **full
  invoice (F1)** names the customer. An **F3** is a full invoice issued later in exchange for
  tickets.
- **Corrective invoice (R5)**: a new invoice, with its own number from the venue's corrective
  series, that corrects a simplified invoice. AEAT (the Spanish tax agency) accepts two forms:
  - **by differences** (`TipoRectificativa` "I"): it carries only the change, for example −3.00 for
    a partial refund. This is the only form Waitron issues today.
  - **by replacement** (`TipoRectificativa` "S", *rectificativa por sustitución*): it carries the
    invoice's full, correct amounts and takes the original's place. It must also carry
    `ImporteRectificacion`, a block of up to three amounts: `BaseRectificada` (the base being
    replaced), `CuotaRectificada` (the VAT being replaced) and, optionally,
    `CuotaRecargoRectificado` (an equivalence surcharge, which Waitron never files).
- **Correction record (*subsanación*)**: a re-sent copy of the same invoice's record with an
  internal field fixed. It issues no new invoice and never changes amounts (owner, A1481).
- **Record, chain, fingerprint (*huella*)**: every invoice Waitron issues becomes an append-only
  record in `registros_facturacion`; each record's fingerprint is a hash over a few of its fields
  and the previous record's fingerprint, so records form a chain that cannot be edited.
- **Filing case**: what the Fiscal filing page lists when AEAT refused a record or a decision is
  needed. **AEAT code**: the number AEAT returns with a refusal, for example `1112` («El campo
  FechaExpedicionFactura es superior a la fecha actual», the issue date is in the future) or `1100`
  («Valor o tipo incorrecto del campo», a field has a wrong value or type). Both texts are lines 48
  and 60 of `sources/archive/aeat-error-codes/06519ceb….properties` in the `verifactu` repo
  **(read)**. AEAT's message on a real refusal is stored per case (`evidence.mensaje`, and
  `submission.mensajeError` for the latest reply, `filing-overview-types.ts:71`, `:85-90`).
- **Remedy**: one of the administrator actions mounted at `POST
  /management-api/fiscal-records/remedy` (`packages/fiscal-verifactu/src/record-remedy-routes.ts`).
  A remedy kind runs only if the server's own policy, `ENABLED_REMEDIES` (`:22`), lists it; today
  the set is empty.
- **The start's time check** and **the clock-behind stop**: after a start, a box that files records
  writes no record until its time is confirmed (`apps/server/src/start-clock-gate.ts`); and no box
  writes a record while its clock reads more than a minute earlier than its newest record, unless a
  clock confirmation covers it (`prepareIssueClock`, `packages/fiscal/src/issue-clock.ts:14`,
  refusing `clock.behind_chain`). Both are CLAUDE.md §5 rules.

## Decisions

Recorded in `~/waitron-campaign-shared/desk/done/20261113-2205-L-q37-fix-remedy.md` and in lane
L's `~/waitron-campaign-l/questions.md` (watcher entries 2026-11-13 22:05 and 22:09).

1. **The corrective for a simplified invoice AEAT refused for a future issue date (`1112`) is a
   replacement R5, `TipoRectificativa` "S"** — the owner, 2026-11-13 22:09, choosing "(b)
   Replacement (Recommended)". This matches the owner's Q37(b) answer of 2026-11-11
   (`docs/compliance/asesor-questions.md`, Q37). The VAT return must count the sale once.
2. **The correction record is offered only for AEAT code `1100`, correcting the operation
   description, and the server refuses a new issuer name through it** — the owner, 22:09, "Yes to
   both (Recommended)".
3. **The corrective is offered on any day; the confirmation says it carries today's date** — the
   owner, 22:09, "Any day (Recommended)".
4. **Tasks 1–2 are built first**, "keeping both remedies offered to no case until Task 3 is
   settled" — the watcher, 22:05; "Tasks 1–2 carry on as at 22:05" — the watcher, 22:09, after the
   owner's answers. The size cap (one PR under about 700 production and 1,100 test lines, otherwise
   the writer change goes first as its own PR) is the watcher's, 22:09.

**Where this plan departs from the queue.** The queue names `corrective-invoice`. That kind stays
off: it is the by-differences remedy whose request carries amounts from the browser, so switching it
on would let the browser send option (a), which the owner declined at 22:09. Decision 1 is carried
by a new kind, `replacement-invoice`, whose request carries no amounts.

**Not yet approved by anyone — asked 2026-11-14 in lane L's `questions.md` (WATCHER-NEEDED
"Q37-FIX — the replacement corrective's plan is reviewed")**: the new `replacement-invoice` kind;
the `sales.replaces_original` column; and the rule that locally the original carries the sale
(below, as amended by question E).

## Outcome

When all of this lands, an administrator — or a manager who signs in as one from the page — opens a
case on **Reporting → Fiscal filing** and sees one of three things:

- **AEAT refused a simplified invoice for a future issue date (`1112`)**: **Put this right** issues
  a replacement corrective invoice dated today that names the refused invoice, sends it to AEAT,
  and closes the case. The confirmation says exactly what will be sent.
- **AEAT refused a record with code `1100` and its message names `DescripcionOperacion`**:
  **Correct the description** re-sends the same record with a corrected operation description,
  beside AEAT's own message, and closes the case.
- **Anything else**: one sentence saying Waitron cannot put this one right yet, and why.

## Scope and non-scope

In scope: switch on `record-correction` and a new `replacement-invoice` remedy; hold every remedy
behind the start's time check; let the page name a case by its record; decide from what the page
reads which fix fits a case; refuse a new issuer name in a correction record; the replacement R5
writer; making every reader of sales count a replaced sale once; a later refund of a replaced sale;
the case dialog's actions, confirmation, in-place administrator sign-in and a self-service sentence
for every refusal the route can give; the guide's cases section in English and Spanish; the backlog
and written claims the change retires.

Not in scope: an R4 (full-invoice) corrective or any F1 correction (A1407); switching on
`corrective-invoice`, `absent-original-cancellation`, `release-brake` or `release-held-cancellation`
(Q35, Q38, Q40); cases "accepted with errors"; a fix for cancellations; a replacement of an invoice
AEAT accepted. The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`),
`inmutabilidad.test.ts` and `correction-amount.huella.test.ts` pass unedited.

## What AEAT's own sources say about a replacement

Sources are in the sibling `verifactu` repo, `sources/archive/`. PDFs were read through
`pdftotext -layout` **(run)**; what they mean was **(read)**.

- **The schema.** `aeat-annex-production-SuministroInformacion.xsd/ee4c1655….xsd:141`:
  `<element name="ImporteRectificacion" type="sf:DesgloseRectificacionType" minOccurs="0"/>`;
  `:323-332` defines it as «Desglose de Base y Cuota sustituida en las Facturas Rectificativas
  sustitutivas», with `BaseRectificada` and `CuotaRectificada` required and
  `CuotaRecargoRectificado` optional (`minOccurs="0"`). `DescripcionOperacion` is
  `sf:TextMax500Type` (`:143`).
- **The validation rules** (`aeat-validation-rules/426eb926….pdf`, v1.2.2, page 8): «Sólo deberá
  incluirse esta agrupación si el campo TipoRectificativa = "S".» and «Obligatorio si
  TipoRectificativa = “S”.» Error codes 1118 and 1119 say the same (`aeat-error-codes/….properties`
  lines 65-66). Page 9: an operation date may not be after today for IVA.
- **What the amounts mean: AEAT's taxpayer FAQ** (`aeat-faq-procedimientos-facturacion/9a0093f2….txt`,
  under «¿Cómo registra el emisor una factura rectificativa por sustitución “S”?»):
  - «Opción 1: Informando de un nuevo registro en el que se indiquen los importes correctos tras la
    rectificación en los campos “base imponible”, “cuota” … y a su vez de los importes rectificados
    respecto de la factura original en los campos “base rectificada”, “cuota rectificada” …». Its
    Example 1 replaces an invoice of base 1.000 / VAT 210 by one of 800 / 168 and files «la “base
    rectificada” (1.000) y la “cuota rectificada” (210)», with «Fecha Operación:01/05/2024» (the
    original's operation date) and «Fecha expedición: 18/10/2024».
  - «Opción 2: … y de otro registro en el que se informe de los importes rectificados.» The original's
    amounts are first cancelled by a separate negative invoice (−1.000 / −210), and the replacement
    then files «“la base rectificada” 0 y la “cuota rectificada” 0».
  - So the rectified amounts are the amounts of the original that the replacement takes out of
    AEAT's count. In both options the change AEAT ends up holding is the same (−200 base, −42 VAT).
    That reading is **inference from the two worked examples, not AEAT's words**.
- **A refused record is not in AEAT's systems.** Developer FAQ (`aeat-developer-faq/73906dc8….pdf`,
  v1.3 of 4 December 2025, §17, page 36): «ese RF rechazado no figuraría jamás en los sistemas de la
  AEAT (aunque constaría un rechazo)», and the error is «solucionada … cuando se reciba/n
  correctamente RF de la/s nueva/s factura/s rectificativa/s de la factura errónea original».
- **AEAT's 303 return counts correctives, not F3s.** Developer FAQ §27, page 49: «para el modelo 303
  se tienen en cuenta todas las facturas identificadas con clave de factura rectificativa (R1, R2,
  R3, R4 y R5) pero, por el contrario, ninguna factura identificada con la clave F3.»
- **A corrective of an earlier corrective is allowed.** The taxpayer FAQ works examples 4–6,
  «Rectificación de factura rectificativa previa», by both methods (same file; quoted in
  `docs/compliance/research/2026-10-09-vat-and-corrections.md` §3.3) **(read)**.
- **The fingerprint does not include the replacement fields.** `@waitron/verifactu` 0.2.1's
  `buildCadenaAlta` (`node_modules/@waitron/verifactu/dist/huella.js:35-47`) hashes
  `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`,
  `ImporteTotal`, the previous fingerprint and `FechaHoraHusoGenRegistro` **(read)**. A throwaway
  script built one R5 four ways with the library's `buildAltaRecord`, `computeHuella` and `validate`
  **(run)**, deleted afterwards: "I"; "S" with rectified 0.00/0.00; "S" with the original's
  11.00/1.10; "S" with no `ImporteRectificacion`. All four fingerprints were `35E7844D…3101641`,
  identical; the first three had no validation issues, and the fourth — the control that shows the
  validator was looking — was refused: «ImporteRectificacion is mandatory when TipoRectificativa is
  S (sustitución)». So the "S" form needs no change to `computeHuella`, the chain or number
  allocation.
- **Storage already holds the form.** `registros_facturacion` has `tipo_rectificativa` (CHECK `'S'`
  or `'I'`) and `importe_rectificacion` (`packages/fiscal-verifactu/src/schema/registros.ts:75-78`,
  `:145-153`), copied from the record (`registro-row.ts:176-182`) **(read)**. No fiscal table
  changes.

## Still open (posted to the watcher 2026-11-14, lane L `questions.md`)

The build follows each answer. Where the plan builds before an answer, it builds the recommended
default and names the one place a different answer changes.

- **A. The rectified amounts when AEAT refused the original.** Read literally, Option 1 puts the
  original's base and VAT (11.00 / 1.10 for a 12,10 € ticket at 10%); with nothing held, AEAT would
  count the sale **zero times**. Option 2 files 0 / 0 when the original's amounts are already out of
  AEAT's count; a refused original never entered it. **Recommended: 0.00 / 0.00**, no surcharge
  amount. Before the first real one, a preproduction probe in the `verifactu` repo (a new
  `live-aeat` mode, by the A985 precedent with the owner's approval): an F2 refused with `1112`,
  then an R5 "S" naming it with 0 / 0, sent while the original's date is still in the future and
  after it has passed. No such probe exists: the only refused-original probe,
  `rejected-invoice-credit`, sends an R1 by differences whose original was refused through
  `RechazoPrevio: "S"`, not a future date (`scripts/live-aeat.mjs`,
  `buildRejectedInvoiceCreditProbeRecords`) **(read)**. **Waits: Task 3d.**
- **B. The operation date when the replacement goes out on a later day.** AEAT's worked example
  fills `FechaOperacion` with the original's operation date (above), and our research says the same
  (`docs/compliance/research/2026-11-06-adviser-clock.md` §60.1: «la fecha de realización de la
  operación correspondiente a la factura original»). **Recommended: the original's real date**, the
  day the sale really happened. The stored date is not it (the clock was ahead), and Waitron stores
  no trusted one: AEAT's own reply time is read but not stored (A1407, `docs/backlog.md:1700`), and
  §60.9 says proving the real day is a question for a professional. Part of B is therefore where the
  date comes from; the proposal is that the confirmation asks the administrator for the sale's day,
  prefilled with the stored date and refused if after today, and the server states it as
  `FechaOperacion` (omitted when it equals the replacement's own date). The browser then sends a
  date, never an amount. **Waits: Tasks 3d and 3c's date field.**
- **C. The printed copy** (invoicing regulation art. 15.5: «… señalando igualmente en este caso el
  importe de dicha rectificación», quoted in `docs/compliance/research/2026-10-09-vat-and-corrections.md`
  §3.3). Today's corrective receipt prints "Corrective invoice", "Corrects invoice" and its own lines
  (`apps/server/src/transaction-receipt.ts:85-97`, A802 slice 5a, #3085) **(read)**. **Recommended:
  yes** — "Replaces invoice A/123 in full" and "Amount of the rectification: 0,00 €". **Waits: Task
  3e.**
- **D. A later refund of a replaced sale: does its credit note name the original or the
  replacement?** **Recommended: the replacement**, the one AEAT holds; AEAT's FAQ allows correcting
  an earlier corrective (examples 4–6). The first version of this plan assumed the original. **Built
  on the default in Task 3f**; "the original" changes only `correctionTargetFor` (it returns the
  sale itself) and drops 3f's two admission changes.
- **E. The VAT period when the original and the replacement fall in different periods.**
  **Recommended: the replacement's period, to match AEAT.** This flips "the original carries the
  sale" for the VAT return only; see "How the sale is counted once". **Built on the default in Task
  3b-1**; "the original's period" changes only `activeSalesClause`.
- **F. Code `1100` is generic.** (i) Offer the description-only correction record only when AEAT's
  message names `DescripcionOperacion`? **Recommended: yes — built in Task 1c.** (ii) Refuse
  `invoiceType` and `recipients` in a correction record too, as the issuer name now is (both are
  printed; today they are accepted, `record-remedy-facts.ts:10-22`)? **Recommended: yes — a
  conditional step in Task 1b, built only if the watcher says yes.**
- **G. May PR 2 open for landing with Tasks 1–2 only, the replacement following as its own PR?**
  **Recommended: yes.** The PR table below shows both outcomes.

## Refusal → fix

The page reads, per case, its cause, AEAT's code and message when the case opened (`evidence`) and
now (`submission`), the record type and the invoice type
(`packages/fiscal-verifactu/src/filing-overview-types.ts:66-95`) **(read)**. Nothing classifies AEAT
codes today: the stored code is compared only against `3000` and against itself
(`record-remedy.ts:160-164`, `record-remedy-corrective.ts:126-128`, `drain.ts:971-973`) **(read)**.
A case gets a fix only if it is `fiscal.registro_rechazado`, its delivery is `rechazado`, its code
then equals its code now, and it is an `alta` (an invoice record, not a cancellation) — the
conditions both remedies already check.

| Refusal (AEAT code) | Invoice | Fix offered | Why |
| --- | --- | --- | --- |
| `1112` issue date in the future | F2 | **Replacement corrective (R5 "S")** — from Task 3c | Decisions 1 and 3. |
| `1112` | F1, F3 | None: "needs a full-invoice corrective, which Waitron cannot issue yet" | Refused before any number is used (below); R4 is A1407. |
| `1112` | R1–R5 (a refused corrective) | None: "no fix yet" | The writer refuses a non-F2 original (`backend.ts:554-561`). |
| `1100`, message names `DescripcionOperacion` | any alta | **Correction record**, operation description only — from Task 2 | Decision 2; question F(i). |
| `1100`, message names another field or none | any alta | None: "no fix yet" | A description fix would be refused again (F(i)). |
| Wrong registered name | — | None reaches the page | AEAT's error list has no record-level code for the issuer's name, and AEAT's test service accepted a record with a wrong name (run 37286371546, Q37) — the first draft's finding, not re-run. |
| Anything else, a cancellation, a duplicate (`3000`), a conflict | — | None: "no fix yet" | No rule. |

**Full invoices.** A full invoice is refused twice before any number is spent: core refuses a sale
with a customer tax number (`requireSupportedCorrection`, `packages/core/src/correction-eligibility.ts:5-8`,
called at `record-correction.ts:215`), and the writer refuses any original that is not F2
(`backend.ts:554-561`). Both run **(run)**: `pnpm --filter @waitron/core exec vitest run
src/record-correction.test.ts -t "full invoice"` → `Tests 1 passed | 75 skipped`; `pnpm --filter
@waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts -t "refuses to correct a
non-simplified invoice"` → `Tests 1 passed | 40 skipped`.

**A held chain.** After three refusals in a row with one code the drain holds the rest of the chain,
the corrective included; its hourly probe releases the chain once a later, correctly dated record is
accepted (`drain.ts:786-822`) **(read)**. `release-brake` staying off delays a corrective by up to
an hour; it does not block it.

**A clock that ran ahead.** A `1112` case exists because the box's clock was ahead, so the chain's
newest record can be dated later than now. Until real time passes it, `prepareIssueClock` refuses
the replacement with `clock.behind_chain` (called at `record-remedy-corrective.ts:133`; the route
answers 409, `record-remedy-routes.ts:37`) **(read)**. A clock confirmation on the Box status page
(`POST /api/box/clock-confirm`, tested in `apps/server/src/clock-confirm.route.test.ts`) lifts the
stop for one step back (CLAUDE.md §5). Task 3c tests that path and the dialog says what to do.

_2026-11-14, found on rebasing PR 2 onto main: main's #2964 (A1420 PR 5) turned the clock-behind stop
off (`CLOCK_BEHIND_STOP_ON = false`, `packages/fiscal-verifactu/src/clock-behind.ts:14`), so a record
dated before the newest one is now written and chained after it with its own time (one dated before
28-10-2024 is still refused as `clock.unusable`). This paragraph, the clock-behind stop's definition
under "Words used in this plan", Task 2b's `clock.behind_chain` row, and Task 3c's future-dated case, its
`clock.behind_chain` sentences and its confirmation step, are rewritten for that before Task 3 is
dispatched, together with whether a replacement may be dated earlier than the refused record it
follows. The refusal was raised by `refuseWhileClockBehind`, which `attemptAppend` calls
(`packages/fiscal-verifactu/src/chain.ts:158`), never by `prepareIssueClock`._

## How the sale is counted once

A replacement is a second sale row (the corrective) pointing at the first (`sales.corrects_sale_id`)
and carrying the same amounts. Today every reader treats a corrective's total as a **change** to the
original, so a full-amount corrective would count twice. `sales` gains one flag,
`replaces_original` (Task 3a), and every reader below takes a decision. The A1308 table hold was
lifted on 2026-11-07 (`~/waitron-campaign-shared/a1308-hold.md`), and A1308's target design keeps
`sales` and adds columns to it (`docs/superpowers/specs/2026-11-02-rationalisation/tables-ordersales.md`
§1.13) **(read)**.

**The rules, with questions D and E on their recommended defaults:**

- **Money and the day it was taken: the original carries the sale.** Payments and settlement sit on
  the original. Every reader of what a sale owes, and every day report, leaves the replacement out,
  as they already leave out an F3 (`notSubstituteClause`, `packages/reporting/src/business-day.ts:207-209`).
  This keeps every closed day's figures as frozen (`issuedSalesClause`'s comment, `:222-228`).
- **The VAT return (question E): the replacement carries the sale.** It counts the replacement, in
  its own period, and leaves out the refused original, so Waitron's return matches what AEAT holds
  (FAQ §27: the 303 counts R5s). Consequence: the daily VAT summary puts the sale on the original's
  day while the 303 puts it in the replacement's period; they differ only for a replaced sale, and
  only in which day or period. If E is answered "the original's period", `activeSalesClause` leaves
  out the replacement instead and the two agree.
- **Later refunds (question D): they correct the replacement.** So "what the original owes" adds the
  correctives of the original (leaving out the replacement) **and** the correctives of its
  replacement. One SQL fragment in `@waitron/db`, `correctivesOf(saleIdColumn)`, says this once and
  every money reader uses it (Task 3b-2).

**Every production reader of `corrects_sale_id`** (`git grep -n "corrects_sale_id\|correctsSaleId"`
over `apps/*/src` and `packages/*/src`, tests, `testing/` and schema files left out **(run)**; 73
lines, grouped):

| Reader | What it does with correctives | Decision | Task |
| --- | --- | --- | --- |
| `packages/reporting/src/vat-return.ts:39` via `activeSalesClause` (`business-day.ts:217-220`) | counts every sale, correctives included | count the replacement, leave out a replaced original (E) | 3b-1 |
| `issuedSalesClause` / `reversedSalesClause` (`business-day.ts:229-244`): `vat-summary.ts:111,127`, `counts.ts:18-21`, `category-sales.ts:208,216`, `top-sellers.ts:71,78` | count correctives as rows on their day | leave out the replacement | 3b-1 |
| `top-sellers.ts:105` | nets corrective lines against the invoice line they name | none needed: replacement lines name no line (`correctsLineId` null, Task 3a); a later refund names the replacement's lines, which are counted on the replacement's day — the replacement itself is out, so test that a refund of a replaced sale nets against nothing it should not | 3b-1 |
| `apps/server/src/accountant-export.ts:194-212`, `:110` | one row per invoice, type "corrective" | replacement row typed `replacement`, replaced original typed `replaced` (M8 below) | 3b-1 |
| `apps/server/src/sale-due.ts:17` (`correctionsCents`) | adds correctives' totals to what is due | `correctivesOf` | 3b-2 |
| `packages/core/src/settle-sale.ts:51` | same, at settlement | `correctivesOf` | 3b-2 |
| `packages/core/src/list-outstanding-sales.ts:47` | same, for unpaid sales | `correctivesOf` | 3b-2 |
| `apps/server/src/orders-list.ts:136` | same, the corrected total shown | `correctivesOf` | 3b-2 |
| `orders-list.ts:325`, `:371`, `:390` | "credited" when any corrective exists | `correctivesOf` (a replacement is not a credit; a refund of it is) | 3b-2 |
| `orders-list.ts:496-499`, `:966` | lists correctives' numbers for a sale | keep; the replacement shows as "Replaced by" | 3b-2 |
| `orders-list.ts:197`, `:569`, `:272`; `invoice-lookup-api.ts:49`; `deferred-close.ts:137` | filters or searches on `corrects_sale_id` being null / matching | none: the replacement is a corrective, so these leave it out or find the original through it, as today | — |
| `apps/server/src/find-bill-bills.ts:55` | adds correctives' totals | `correctivesOf` | 3b-2 |
| `apps/server/src/find-bill-transactions.ts:19-20`, `:53`, `:73` | follows correctives up to their original; types them "correction" | keep the scope walk; type the replacement `replacement` | 3b-2 |
| `apps/server/src/deferred-close.ts:276` | a deferred sale with any corrective reads as corrected | `correctivesOf` (a replaced deferred sale is not "corrected") | 3b-2 |
| `apps/server/src/deferred-payment-export.ts:69` | lists each corrective's number and total under the sale | `correctivesOf`; the replacement's number listed as "replaced by", its total not | 3b-2 |
| `packages/core/src/record-correction.ts:141-142` | remaining and count of earlier corrections | reads the correction target (3f), so the replacement's own correctives; `not replaces_original` is never true there | 3f |
| `record-correction.ts:283-297` and `packages/core/src/correction-history.ts:109`, `:171-176` → `partial-correction-breakdown.ts:132`, `:217` | the partial-refund history; a history line naming no invoice line refuses with `sale.correction_history_unusable` | with D = replacement these read the replacement's correctives only, so the replacement's own lines (which name none) never enter the history. Without 3f, **every partial refund of a replaced sale would be refused** — 3f's test proves it is not | 3f |
| `correction-history.ts:108` (`previewCorrectionAmounts`, used by `apps/server/src/invoice-corrections.ts:124`, `:304`) | refuses a sale that is itself a corrective | allow a replacement | 3f |
| `invoice-corrections.ts:320`, `cancel-credit.ts:73` | create a corrective of the sale | through `correctionTargetFor` | 3f |
| `packages/core/src/correction-approval.ts:32` | approval must name the same sale | compares the target | 3f |
| `apps/server/src/transaction-receipt.ts:85-97` | prints "Corrects invoice …" | the replacement's wording (C) | 3e |
| `packages/fiscal-verifactu/src/handover-return.ts:42-43`, `:260`, `:484`, `:586` | walks correctives to their parents when a box's records come home | none: copies rows whole; run its suite after the column lands | 3a |
| `packages/fiscal-verifactu/src/backend.ts:537-556`, `record-remedy-corrective.ts:137`, `packages/fiscal/src/backend.ts:598-604`, `record-substitution.ts:46`, `reporting/src/types.ts:164-167` | the writer and its contract; comments | the writer: 3a, 3d, 3f; comments as touched | 3a/3d/3f |

**M8, the accountant export.** The export writes one row per invoice and adds no totals of its own
(`accountant-export.ts:95-112`; its only sum is a purchase's own lines, `:120`) **(read)**. So a
"replacement" row counts toward any total only if the accountant sums the column. Both rows stay
in the file — the refused original and its replacement are both invoices the venue keeps (owner,
Q37(c)) — typed `replaced` and `replacement`, so a sum over the column leaves one out; the export's
guide sentence says which.

## Protected files this plan touches, and why

- `packages/fiscal-verifactu/src/backend.ts`, `recordCorrection` (`:534-624`): Task 3a makes it
  refuse a replacement; Task 3d adds the "S" branch beside the "I" one; Task 3f lets it correct a
  replacement. The "I" branch's lines stay as they are, proved by Task 3a's first test.
- `packages/fiscal/src/backend.ts:596-605`, the `FiscalBackend.recordCorrection` contract (shared by
  every fiscal backend): its `correction` argument gains `replaces?: true`.
- `packages/core/src/record-correction.ts`: Task 3a moves its series check into a helper the new
  `recordReplacement` shares; Task 3f routes it through the correction target.
- `packages/db/src/schema/sales.ts` and core's starting migration (rebuilt, never hand-edited).
- `packages/fiscal-verifactu/src/correction-admission.ts:54` (Task 3f).
- Not touched: `computeHuella`, `appendToChain` and the chain (`packages/fiscal-verifactu/src/chain.ts`),
  `allocateInvoiceNumber`, `registros_facturacion`'s schema and its append-only triggers.

## Order and pull requests

Estimated total: about 760 production and 2,130 test lines (Sizes, below), past the cap, so the
writer goes first as its own PR. Question G decides whether Tasks 1–2 land on their own.

| PR | Branch | Tasks | Lands |
| --- | --- | --- | --- |
| 1. Replacement writer | `feat/q37-replacement-writer`, a new worktree from `main` | 3a, 3b-1, 3b-2, 3f now (D and E on their defaults); 3d after A and B; 3e after C | First of the writer work. Nothing in production calls `recordReplacement` until PR 3. |
| 2. Correction record | `feat/q37-fix-put-right` (this one) | 1a, 1b, 1c, 1d, 2a, 2b, now | **If G = yes:** on its own, as soon as it is reviewed. Its landable state offers the `1100` correction record (when AEAT's message names the description) and the corrective to no case. |
| 3. Put it right | a new branch from `main` after PRs 1 and 2 | 3c | **If G = yes:** after PRs 1 and 2. **If G = no:** 3c joins PR 2 instead, and PR 2 waits for PR 1. |

Until 3c, `putRightFor` answers "no fix yet" for every `1112` case and `ENABLED_REMEDIES` holds only
`record-correction`. Task 3c adds `replacement-invoice` to the set and switches the `1112` row on, in
the same commit.

**PR 1's description** carries a line starting `Sale-path read changed:` naming `settleSale`,
`correctionsCents` (`sale-due.ts`) and `listOutstandingSales`, which Task 3b-2 changes (CLAUDE.md
§4: a 30-day bench run follows once three such slices have landed). Every A1308 slice also runs
`apps/server`'s `pnpm protection-list` before and after; PR 1 is not an A1308 slice, so that rule
does not apply, and the PR says so.

---

## Task 1a — every remedy waits for the start's time check (PR 2)

Files: `packages/module/src/module.ts` (`ModuleRouteContext.recordGeneration`, `:87-94`, gains
`requireClockConfirmed(): void`); `apps/server/src/module-record-generation.ts` and
`apps/server/src/boot.ts` (pass `startClockHolds`, `boot.ts:2360`, into `moduleRecordGeneration`,
`boot.ts:3160`; it throws `clock.unconfirmed` while the gate holds);
`packages/fiscal-verifactu/src/record-remedy-routes.ts` (after `admitRecordRemedy` and the
generation check, `:80-82`, and before `requireFreshManagementSignIn`, `:83`, call
`requireClockConfirmed()`; the error map gains `"clock.unconfirmed": 409`).

Why the route: the start's time check wraps only the shared fiscal seat's four writers
(`apps/server/src/start-clock-gate.ts:8-14`), while `record-correction` appends to the chain
directly (`record-remedy.ts:194`) and the corrective remedies build their own, unwrapped seat
(`record-remedy-corrective-http.ts:99-103`) **(read)**. Not folded into `requireWritable`:
`apps/server/src/return-records-api.ts:51` and `return-clash-acceptance.ts:296` call it too, and
gating returns is not this item. It also covers the record-correction A1342 already admits in
production for a returned box's records (`record-remedy-routes.ts:68-79`).

Failing tests first:

- `record-remedy-routes.test.ts`, "refuses clock.unconfirmed before writing": a generation whose
  `requireClockConfirmed` throws, under a test policy enabling `record-correction` → 409
  `clock.unconfirmed`, chain unchanged. Fails today: the route never asks.
- `apps/server/src/boot.start-clock-gate.test.ts`, a case beside `:195`: while the start waits, a
  complete `record-correction` request under a test policy → 409 `clock.unconfirmed` and no record.
  Fails if boot does not pass the gate in.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
src/record-remedy-routes.test.ts`; `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec
vitest run src/boot.start-clock-gate.test.ts src/return-records.real.test.ts`; `pnpm --filter
@waitron/module exec tsc --noEmit` and the server's typecheck (a contract change).

Size: about 25 production lines, 80 test lines.

## Task 1b — the correction record refuses a new issuer name (PR 2)

Files: `packages/fiscal-verifactu/src/record-remedy-http.ts` (`refuseChangedAmountsOrClass`,
`:59-96`, or a sibling check, before anything is written); `packages/fiscal-verifactu/src/errors.ts`
(beside `fiscal.remedy_amount_changed`, `:116-126`).

Behaviour: a `facts.issuerName` that differs from the record's own `NombreRazonEmisor` is refused
with **`fiscal.remedy_issuer_changed`** `{ registroId }` (HTTP 400, the error boundary's default,
like `fiscal.remedy_amount_changed`). The same name is accepted, as an unchanged amount is. The
registry entry carries one line: the issuer's name is printed on the invoice, so changing it takes a
corrective invoice (decision 2). The code names the domain concept, as its siblings do.

**Conditional step (only if the watcher answers F(ii) "yes"):** in the same check, a changed
`invoiceType` or any `recipients` value other than the record's own is refused with
`fiscal.remedy_printed_fact_changed` `{ registroId, field: "invoiceType" | "recipients" }`, and
the existing cases that change them become refusal cases (`record-remedy-facts.test.ts:177-198`,
`:472`, and the R1/F3 reference-fact cases at `:209` onward). If the answer is "no", or none has
come when this task runs, skip it and note in the PR that F(ii) is open.

Failing tests first: `record-remedy-facts.test.ts` — a fix with a new `issuerName` → 400
`fiscal.remedy_issuer_changed` and no write; the same name → 200. Fails today: 200 with the new
name stored.

Existing assertions that change: `record-remedy-facts.test.ts` sends `issuerName` as its example fix
at `:117` (the shared body), `:163`, `:176`, `:472`, `:476` and `:501`. Each keeps its assertion with
`description: "Corrected restaurant service"` as the changed fact, except `:176` ("retains a
partial corrected-fact decision"), whose `issuerName` row becomes the new refusal case. `:527`
(`{ issuerName: "" }`) still answers `fiscal.remedy_request_invalid`, which is checked first.
`record-version-receipt.test.ts` builds records directly, not through the route, and is unaffected
**(read)**.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
src/record-remedy-facts.test.ts src/correction-history.e2e.test.ts`; root `pnpm exec vitest run
scripts/errors-reachable.test.ts`.

Size: about 15 production lines (25 with F(ii)), 90 test lines (130 with F(ii)).

## Task 1c — a case is found by its record, and the classifier (PR 2)

Files: `packages/fiscal-verifactu/src/record-remedy-http.ts`, `record-remedy-corrective-http.ts`
and the route (a body without `caseId` is answered for the case of its `registroId`); new
browser-safe `packages/fiscal-verifactu/src/put-right.ts` (`putRightFor(view: FilingCaseView)` →
`{ kind: "record-correction" } | { kind: "none"; why: "full-invoice" | "not-yet" }`; Task 3c adds
`{ kind: "replacement-invoice" }`).

Behaviour:

- One case per record (`filing_cases_registro_uq`, `schema/filing-cases.ts:35`), so `registroId`
  names the case. A body that sends `caseId` keeps today's checks, which refuse a case for another
  record (`record-remedy.ts:156`, `record-remedy-corrective.ts:119`). Why: no case id leaves the
  read model (`filing-overview-types.ts:67`), deliberately
  (`docs/superpowers/plans/2026-11-09-w41s-9-fiscal-filing-screen.md:70-84`).
- `putRightFor` is the Refusal → fix table, with the `1112` F2 row answering `not-yet` until Task
  3c, and the `1100` row offering `record-correction` only when the case's latest AEAT message
  (`submission.mensajeError`, else `evidence.mensaje`) contains `DescripcionOperacion`, ignoring
  case (F(i)).

Failing tests first:

- `record-remedy-http.test.ts` and `record-remedy-corrective-http.test.ts`: the same request
  without `caseId` → 200 and the event on that record's case. Fails today: 400
  `fiscal.remedy_request_invalid`.
- New `put-right.test.ts` (node project): one case per table row — F1, F3 and R5 with `1112`;
  `1100` whose message names `DescripcionOperacion`, names another field, or is empty; code then ≠
  code now; an `aceptado_con_errores` case; a cancellation.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy
src/put-right.test.ts`; root `pnpm exec vitest run scripts/dashboard-browser-purity.test.ts`.

Size: about 60 production lines, 120 test lines.

## Task 1d — switch the correction record on, and retire the claims that remedies are off (PR 2)

Files: `record-remedy-routes.ts:22` (`ENABLED_REMEDIES` becomes `new Set(["record-correction"])`);
the tests and docs below.

Failing test first: `record-remedy-routes.test.ts`, "the default policy enables exactly
record-correction": mounted with a generation and no policy argument, `record-correction` reaches
validation (400 `fiscal.remedy_request_invalid` for an empty body) and each other kind answers 409
`fiscal.remedy_disabled`. Fails today: `record-correction` answers 409.

Existing assertions that change, predicted by reading **(read)** — the first draft measured a
different switch (both kinds on) and that result no longer applies:

- `apps/server/src/fiscal-remedy.staff-refund.test.ts:554-580` "keeps every built-in remedy
  disabled": `record-correction` now passes the policy and its body's extra `enabledRemedies` key is
  refused, so it answers 400 `fiscal.remedy_request_invalid`. Becomes: every other kind 409
  `fiscal.remedy_disabled`; `record-correction` 400; fiscal facts unchanged either way.
- `record-remedy-routes.test.ts:58-72` still passes for `record-correction`, but for the wrong
  reason: it mounts with no generation (`:31`), so `recordGeneration === undefined` (`:81-82`)
  answers instead of the policy. Narrow its `it.each` to the disabled kinds.
- `record-remedy-corrective-http.test.ts:419` "keeps the default production policy closed" is
  unchanged: `corrective-invoice` stays off.

Docs this task retires (the gate now covers the remedies; production enables one): root
`CLAUDE.md:951` "the record remedies, off in production, are outside it";
`docs/developers/conventions-data.md:4705-4706` "call the chain directly and are outside the gate;
production enables none of them"; A1407, `docs/backlog.md:1700`, "today the remedies write past it,
and production enables none"; W41s, `docs/backlog.md:296-299` (drop Q37 from "pending
Q35/Q37/Q38/Q40" and correct the "`ENABLED_REMEDIES` is empty, `…record-remedy-routes.ts:20`"
clause); `docs/backlog/fiscal.md:429`.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy`
(baseline this plan ran **(run)**: with `src/correction-amount.huella.test.ts
src/write-path.e2e.test.ts src/inmutabilidad.test.ts` → `Test Files 14 passed`, `Tests 530
passed`); `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run
src/fiscal-remedy.staff-refund.test.ts`; root `pnpm exec vitest run
scripts/claude-md-pointers.test.ts`; the three protected fiscal tests, unedited.

Size: about 2 production lines, 40 test lines, 15 doc lines.

## Task 2a — the case view carries the operation description (PR 2)

Files: `packages/fiscal-verifactu/src/filing-overview-types.ts` (`FilingCaseView.record`, `:72-84`,
gains `descripcionOperacion: string | null`, null for a cancellation); `filing-overview.ts` (the
record read, beside `numSerieFactura` at `:238`); `test/fiscal-filing-browser-fixture.ts`.

Failing test first: `filing-overview.test.ts` — an alta's case carries its stored description; a
cancellation's carries null. Fails today: no field. The case export reads the same view: run its
tests too, and update any that pin the record's keys with `toEqual`.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
src/filing-overview`.

Size: about 15 production lines, 40 test lines.

## Task 2b — the case dialog: the correction record, AEAT's message, sign-in, every refusal, the guide (PR 2)

Files: `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` (the case dialog,
`#details()`, `:636-656`; the "cannot correct" line, `:609-615`), `fiscal-filing-client.ts` (a
`putRight` POST), `strings.ts` (English `:210` and Spanish `:492` "cannot correct" lines and the new
words), `index.ts` (hand the screen `ctx.permissionContinuation`, `:21-27`, as the certificate panel
already gets it at `:53`), a new browser-safe `packages/fiscal-verifactu/src/remedy-refusals.ts`
(the list of codes the remedy route can answer, which the route's error map and the dialog both
read), `apps/server/src/guide/en/fiscal-filing.md` and `es/fiscal-filing.md` (`{#cases}`, en
`:32-40`), a new `fiscal-filing-screen.unsaved.test.ts`.

Behaviour:

- The dialog shows the case's fix from `putRightFor`, or one sentence saying why not: a full invoice
  → "Waitron cannot put this one right yet: a full invoice needs a corrective invoice Waitron cannot
  issue yet."; otherwise → "Waitron cannot put this one right yet. The case stays open." (never
  "ask someone": `docs/developers/conventions-ui.md:8-20`; the export button keeps the owner's own
  wording).
- **Correct the description** (`1100`, F(i)) opens one field, the operation description, from the
  field primitive (`wt-textarea`, `name="operationDescription"`), prefilled from
  `record.descripcionOperacion` (Task 2a), required, capped at 500 characters (AEAT's
  `TextMax500Type`). AEAT's message (`submission.mensajeError`, else `evidence.mensaje`) is shown
  beside the field, as the dialog already shows it elsewhere (`fiscal-filing-screen.ts:178`, `:190`).
  Under the Forms contract (`docs/developers/design-system.md` → Forms): a draft scope from
  `draftScopeFor`; **Send** stays quiet and disabled until the text differs from the record's, using
  `saveActionState`; an invalid field shows an inline error and one bottom message above the
  buttons; a request refusal never disables the action.
- **Send** posts `kind: "record-correction"`, the `registroId`, a fresh `actionKey` per dialog
  opening (kept across a retry so a repeat is answered from the saved decision,
  `record-remedy.ts:114-131`), a fixed `reason` naming AEAT's code, and `facts: { description }`;
  no `caseId`. **Stop** sends nothing.
- Without `fiscal.remedy` (administrators only, `packages/fiscal-verifactu/src/permissions.ts:3`;
  the page needs `report.export`), the action reads **Sign in as an administrator to put this
  right** and calls `permissionContinuation.signIn({ permission: "fiscal.remedy", signal })`
  (`packages/dashboard-kit/src/contract.ts:13-19`), as the certificate card does
  (`certificate-card.ts:156`, `:172-173`).
- A recent sign-in: the route asks for one (`management_session.proof_required`,
  `record-remedy-routes.ts:83`); the dashboard's shared gate prompts in place and resends the same
  body (`apps/dashboard/src/api/fresh-sign-in.ts:40-71`, wrapping the request at
  `apps/dashboard/src/main.ts:91-97`). The panel adds nothing; a test proves the resend.
- **Every refusal the route can give has a sentence that says what happened and what to do**, shown
  under the actions with the action still available. The route's map
  (`record-remedy-routes.ts:24-43`) plus `clock.unconfirmed` (1a), `fiscal.remedy_issuer_changed`
  (1b), `fiscal.remedy_request_invalid`, `storage.disk_full` and, from 3c,
  `sale.replacement_not_first` and the series refusals. The intent of each, written in the strings
  file in English and Spanish:

  | Code | Sentence's point |
  | --- | --- |
  | `management_session.required`, `.expired` | You are signed out; sign in again here (the shell's sign-in). |
  | `authorization.not_permitted`, `person.suspended` | This needs an administrator; sign in as one here (`signIn`). |
  | `clock.unconfirmed` | The server is waiting for its time to be confirmed; confirm it on a till or on the Box status page, then send again. |
  | `clock.behind_chain` | The server's clock reads earlier than its newest invoice (the clock that caused this refusal); confirm the time on the Box status page, then send again. Wording follows `apps/dashboard/src/i18n/alert-messages.ts:213-216`. |
  | `clock.unusable` | The server's clock is unusable; with the internet it puts itself right, otherwise set it on the Box status page (`alert-messages.ts:284-287`). |
  | `venue.time_zone_not_ready` | The venue has no time zone yet; set it in Venue settings, then send again. |
  | `node.read_only`, `fiscal.chain_handed_over` | This server is not the one that files invoices now; open this page on the main server. |
  | `filing_case.already_resolved`, `fiscal.record_already_corrected`, `filing_case.action_mismatch`, `fiscal.remedy_invalid` | The case changed since the page read it; the page reads again (and does). |
  | `fiscal.remedy_disabled` | Waitron cannot put this one right yet; the case stays open. |
  | `fiscal.remedy_issuer_changed`, `fiscal.remedy_request_invalid` | Waitron could not send this correction; nothing was sent (not reachable from this dialog; a guard against a future one). |
  | `storage.disk_full` | The server's disk is full; nothing was sent (the alert's own guidance applies). |
  | `sale.replacement_not_first` (3c) | This invoice already has a corrective invoice, so Waitron cannot replace it; the case stays open and is in the export for your tax adviser. |

- The page's "Waitron cannot correct these records yet." becomes "Open a case to see whether Waitron
  can put it right." (Task 3c adds the future-date sentence.)

Failing tests first (`fiscal-filing-screen.test.ts`, browser project): a `1100` case naming the
description shows **Correct the description** prefilled from the record and AEAT's message beside
it; **Send** is disabled until the text changes, then posts `kind: "record-correction"` with that
`registroId`, `facts.description` and no `caseId` (fails if the action is deleted: no button); a
`1100` case naming another field shows "cannot put this one right yet"; a `1112` F2 case shows the
same sentence and no action (until 3c); an F1 `1112` case shows the full-invoice sentence; without
`fiscal.remedy` the action calls `signIn` with `fiscal.remedy`; a `proof_required` answer followed
by a confirmed sign-in resends the identical body once; **a walk over `remedy-refusals.ts`'s list
asserts every code has a dialog sentence in both languages** (fails when a code is added to the
route without words); a refusal is shown and the action stays enabled; **Stop** sends nothing.
`fiscal-filing-screen.unsaved.test.ts`: an edited description warns before the dialog or page is
left. `fiscal-filing-screen.a11y.test.ts`: the field, refusal and sign-in states in both themes.
Update the existing `data-test="no-correction"` assertion to the new words. In `record-remedy-routes.test.ts`,
assert the route's error map keys equal `remedy-refusals.ts`'s list.

Guide: the `{#cases}` section in both languages gains two sentences — that a case AEAT refused for
a wrong operation description can have it corrected from the case, beside AEAT's message, and that
this needs an administrator, who can sign in from the case. Written from the code
(`conventions-ui.md` "A help bubble orients", "A guide says what to do").

Backlog: A1089 (`docs/backlog.md:210`) says the page "decides nothing" and "`ENABLED_REMEDIES` is
empty": narrow it to the decisions still missing.

Commands (check `memory_pressure | grep free` first; browser tests need well above 15% free):
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.unsaved.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts`;
`cd apps/server && pnpm exec vitest run src/guide-content.test.ts`; root
`pnpm exec vitest run scripts/guide-links.test.ts scripts/native-form-fields.test.ts scripts/page-title-styles.test.ts scripts/dashboard-browser-purity.test.ts`.

Size: about 240 production lines (screen 130, refusal words 50, strings 40, client and wiring 20),
350 test lines, about 10 lines of guide prose. If it passes about 150 tool calls unfinished, the
implementer stops at a passing point (the refusal walk is a clean split) and hands over.

## Task 3a — core: a replacement corrective, and the `replaces_original` flag (PR 1)

Files: `packages/db/src/schema/sales.ts` (+ core's starting migration, rebuilt with
`pnpm --filter @waitron/server migration-baseline rebuild --set core`); new
`packages/core/src/record-replacement.ts`; new `packages/core/src/corrective-series.ts` (the series
check moved out of `record-correction.ts:161-195`, called from both); `packages/core/src/insert-sale.ts`
(passes the flag); `packages/core/src/errors.ts`; `packages/core/src/index.ts`;
`packages/fiscal/src/backend.ts` (contract) and `src/testing/fake-backend.ts`;
`packages/fiscal-verifactu/src/backend.ts` (refuses a replacement until Task 3d).

Behaviour:

- `sales.replaces_original`: a flag (`flag()`, `packages/db/src/schema/columns.ts:148`), not null,
  default false; CHECK `sales_replaces_original_ck`: false, or `corrects_sale_id` is not null; a
  unique index on `corrects_sale_id` where it is true (one replacement per invoice), declared in the
  TypeScript schema.
- `recordReplacement(tx, backend, { origin, nodeId, seriesId, correctsSaleId, operationDescription?,
  operationDate?, authz, clock })` — no amounts or lines in its input. It reads the original's total,
  stored VAT split, lines, locales and tax number; refuses a voided original (`sale.voided`), a
  series that is not this node's live rectificative series (the moved check, same codes), a session
  without `sale.rectify`, a full invoice (`requireSupportedCorrection`), and an original that
  already has any corrective (**`sale.replacement_not_first`** `{ saleId }`) — all before a number
  is allocated. Then it runs the integrity check, takes one clock reading, allocates the number as
  `recordCorrection` does, inserts the sale (the original's total and stored VAT split, positive;
  `correctsSaleId`; `replacesOriginal: true`), copies the original's lines with new ids and
  `correctsLineId` null, and calls `backend.recordCorrection(tx, sale, { correctsSaleId, replaces:
  true })`. (`operationDate` is passed through only once question B is answered.)
- `FiscalBackend.recordCorrection`'s third argument becomes `{ correctsSaleId: SaleId; replaces?:
  true }`. The Veri\*Factu backend refuses `replaces` with `fiscal.correction_unsupported` until
  Task 3d, so no backend files a full-amount "I" by mistake; `fiscal-none` records nothing, as for
  any corrective; the fake backend records the flag.

Failing tests first:

1. **Before any change**, new `packages/fiscal-verifactu/src/correction-form.test.ts`: a
   by-differences correction recorded through `recordCorrection` with a pinned clock and NIF, pinning
   as literals the stored row's filed fields (`tipo_rectificativa` "I", `importe_rectificacion`
   null, `facturas_rectificadas`, `desglose`, totals), the fingerprint input string
   (`buildCadena(fromRegistroRow(row))`) and the serialised envelope (`serializeEnvio`). Commit it
   passing on unchanged code; it must pass unedited after Tasks 3a, 3d and 3f. A mutation check:
   change `"I"` to `"S"` in `backend.ts` locally and see it fail, then restore.
2. `packages/core/src/record-replacement.test.ts`: a replacement of a 12.10 ticket stores a sale of
   12.10 with the original's VAT split, copied lines, `replaces_original` true and a new number from
   the rectificative series; each refusal above leaves no number used. **An earlier partial refund
   naming the refused original** (recorded through `recordCorrection` directly, as a test policy
   can) makes the replacement refuse `sale.replacement_not_first` with no number used (M4). Fails
   today: no such function.
3. `packages/db/src/schema/sales.test.ts`: `replaces_original` true without `corrects_sale_id` is
   refused by the CHECK; a second replacement of one sale by the unique index. Fails today: no
   column.
4. `packages/fiscal-verifactu/src/backend.test.ts`: `replaces: true` → `fiscal.correction_unsupported`
   and no record.

Commands: `pnpm --filter @waitron/core exec vitest run src/record-replacement.test.ts
src/record-correction.test.ts`; `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts`;
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/correction-form.test.ts
src/backend.test.ts src/handover-return.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
src/correction-amount.huella.test.ts`. Guards to RUN after the schema change (CLAUDE.md §3):
`scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts`,
`scripts/column-vocabulary.test.ts`, `scripts/errors-reachable.test.ts`.

Size: about 120 production lines, 360 test lines, plus the rebuilt starting migration (generated;
count its lines in the PR description).

## Task 3b-1 — reports count a replaced sale once (PR 1)

Files: `packages/reporting/src/business-day.ts` (two clauses beside `notSubstituteClause()`:
`notReplacementClause()`, used by `issuedSalesClause` and `reversedSalesClause`, and
`notReplacedClause()`, used by `activeSalesClause` — question E's default);
`apps/server/src/accountant-export.ts:194-212` (types `replacement` and `replaced`).

Failing tests first (each fails today because the replacement's 12.10 is added):

- `packages/reporting/src/vat-return.test.ts`: a 12.10 sale at 10% and its replacement in one
  quarter → base 11.00, VAT 1.10 (today 22.00 / 2.20); the original in Q4 and its replacement in the
  next Q1 → Q1 counts it and Q4 does not (E's default; one assertion flips if E says otherwise).
- `counts.test.ts`, `category-sales.test.ts`, `top-sellers` and the VAT summary's test: the
  replacement's day shows no extra sale, correction, VAT or quantity; the original's day is
  unchanged; a later by-differences refund of the replacement still counts on its own day.
- `apps/server/src/accountant-export.test.ts`: the replacement's row reads `replacement` and the
  original's `replaced`.

Docs: `vat-return.ts:10-16`'s «corrections netted» and the three clauses' comments say how a
replacement is counted.

Commands: `pnpm --filter @waitron/reporting exec vitest run`; `cd apps/server &&
TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/accountant-export.test.ts
src/report-api.accountant-export.test.ts`.

Size: about 25 production lines, 170 test lines.

## Task 3b-2 — what is owed, and the corrections around it (PR 1)

Files: `packages/db/src/` (export `correctivesOf(saleId: SQL)`: the correctives of a sale and of
its replacement, leaving the replacement out); every money reader in the table marked 3b-2:
`apps/server/src/sale-due.ts:17`, `packages/core/src/settle-sale.ts:51`,
`packages/core/src/list-outstanding-sales.ts:47`, `apps/server/src/orders-list.ts:136`, `:325`,
`:371`, `:390`, `:496-499`, `:966`, `apps/server/src/find-bill-bills.ts:55`,
`apps/server/src/find-bill-transactions.ts:53`, `apps/server/src/deferred-close.ts:276`,
`apps/server/src/deferred-payment-export.ts:69`; a new root guard
`scripts/corrective-sums.test.ts`.

Failing tests first (each fails today because the replacement's 12.10 is added, or it reads as a
credit):

- `packages/core/src/settle-sale.test.ts` and `list-outstanding-sales.test.ts`: after a replacement
  the original owes what it owed before; after a 3.00 refund of the replacement it owes 3.00 less.
- `apps/server/src/find-bill-bills.test.ts` (it reads `readIssuedSales`, `sale-due.ts`'s reader —
  there is no `sale-due.test.ts`) and `till-sale-integrated.db.test.ts` (`amountDue`): the same.
- `apps/server/src/orders-list.test.ts`: the replaced sale's corrected total is unchanged and it is
  not marked credited; its detail lists the replacement as "Replaced by".
- `apps/server/src/find-bill-transactions.test.ts`: the replacement is typed `replacement`.
- `apps/server/src/deferred-close.test.ts` and `deferred-payment-export.test.ts`: a replaced deferred sale can still be closed
  and its export lists no correction total for the replacement.
- **`scripts/corrective-sums.test.ts`** (M7): reads every production `.ts` file under `apps/*/src`
  and `packages/*/src` as TEXT and fails on any `corrects_sale_id =` / `correctsSaleId,` inside a
  `sum(`, `count(`, `exists` or Drizzle `.where(eq(… correctsSaleId …))` that is neither
  `correctivesOf` nor on its allowlist (the filters and walks marked "none" in the table, each with
  its reason). **Weaker than its name**: it reads text, not queries, so a sum built another way, or
  through a helper it does not recognise, passes it. Proved by deletion: revert one reader and see it
  fail; and a negative control — a filter the allowlist names — still passes. Belongs in the root
  Vitest project (CLAUDE.md §4) and is named in root `CLAUDE.md` §3 (Data), one line, with its limit
  in `docs/developers/conventions-data.md`.

Commands: `pnpm --filter @waitron/core exec vitest run src/settle-sale.test.ts
src/list-outstanding-sales.test.ts`; `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec
vitest run src/find-bill-bills.test.ts src/find-bill-transactions.test.ts src/orders-list.test.ts
src/orders-list.reads.test.ts src/till-sale-integrated.db.test.ts
src/deferred-close.test.ts src/deferred-payment-export.test.ts`; root `pnpm exec
vitest run scripts/corrective-sums.test.ts`. A PR tests only changed packages (CLAUDE.md §2), so run
the till and dashboard suites that read these routes if any response shape changes.

Size: about 45 production lines, 280 test lines (guard included).

## Task 3f — a later refund of a replaced sale corrects the replacement (PR 1; question D's default)

Files: new `packages/core/src/correction-target.ts` (`correctionTargetFor(tx, saleId)`: the sale's
replacement if it has one, else the sale); `apps/server/src/invoice-corrections.ts:124`, `:304`,
`:320` and `apps/server/src/cancel-credit.ts:73` (open, preview and file against the target);
`packages/core/src/correction-history.ts:108` (a replacement is not refused as "a corrective");
`packages/core/src/correction-approval.ts:32` (compares the target);
`packages/fiscal-verifactu/src/correction-admission.ts:54` (admits an alta whose type is R5 and
whose `tipo_rectificativa` is "S"); `packages/fiscal-verifactu/src/backend.ts:554-561` (corrects such
an R5, naming it in `FacturasRectificadas`, by differences as today).

If the watcher answers D "the original": `correctionTargetFor` returns the sale itself, the
admission and backend changes are dropped, and the partial-refund test below expects the history to
skip the replacement's lines instead.

Failing tests first:

- `packages/core/src/record-correction.test.ts` / `partial-correction-breakdown.test.ts`: **a
  partial refund of a replaced sale** (one line, with its VAT split) is recorded, by differences,
  against the replacement, and a second partial refund sees the first in its history. Fails today:
  `sale.correction_history_unusable` (the replacement's lines name no invoice line) or
  `not_simplified`.
- `apps/server/src/invoice-correction-api.test.ts`: opening a correction on the original's bill
  files the credit note naming the replacement.
- `packages/fiscal-verifactu/src/backend.test.ts`: a by-differences correction of an R5 "S" writes
  an R5 "I" naming it; a correction of any other R-type is still refused. `correction-form.test.ts`
  passes unedited.

Commands: `pnpm --filter @waitron/core exec vitest run src/record-correction.test.ts
src/partial-correction-breakdown.test.ts src/correction-history.test.ts`; `pnpm --filter
@waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts src/correction-form.test.ts
src/correction-history.e2e.test.ts`; `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec
vitest run src/invoice-correction-api.test.ts src/invoice-correction-cards.test.ts`.

Size: about 40 production lines, 180 test lines.

## Task 3d — the writer files the replacement as "S" (PR 1; after answers A and B)

Files: `packages/fiscal-verifactu/src/backend.ts` (`recordCorrection`, `:534-624`).

Behaviour: with `replaces: true`, the backend reads the original alta's delivery (`envios.estado`)
and refuses `fiscal.correction_unsupported` unless it is `rechazado` (AEAT holds nothing for it).
It then builds the same input as the "I" branch except `TipoRectificativa: "S"`,
`ImporteRectificacion` per answer A, and `FechaOperacion` per answer B. `FacturasRectificadas` names
the refused invoice by its stored number and date (`:578-587`), the corrective's own number and date
are its own (`:571-573`), and `appendToChain`, `envios` and the QR are as for "I".

Failing tests first: `backend.test.ts` — a replacement of a refused F2 writes one R5 with
`tipo_rectificativa` "S", `importe_rectificacion` as answered, the original's `desglose` and
totals, and `facturas_rectificadas` naming it; its serialised record passes the library's
`validate`; a replacement of an accepted original is refused with no record. `correction-form.test.ts`
passes unedited. Fails today: Task 3a's refusal.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts
src/correction-form.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
src/correction-amount.huella.test.ts`. If anything here would need a change to what enters the
fingerprint, stop and write it to the watcher.

Docs: the comment at `backend.ts:575-576` ("S" would also need `ImporteRectificacion`) is replaced
by the branch itself; `docs/backlog/fiscal.md`'s A1407 entry and `docs/compliance/asesor-questions.md`
Q37 gain a dated line saying the replacement is built.

Size: about 30 production lines, 150 test lines.

## Task 3e — the printed replacement (PR 1; after answer C)

Files: `apps/server/src/transaction-receipt.ts` (`:85-97`, reads `replaces_original`), the receipt
layout and the Spanish pack's receipt label table (the two words A802 slice 5a added, in all five
languages).

Failing test first: `receipt-document.test.ts` — a replacement's receipt at 58 and 80 mm, in
English and Spanish, prints the wording answer C settles. Fails today: it prints as a by-differences
corrective.

Size: about 20 production lines, 80 test lines.

## Task 3c — the replacement remedy, switched on (PR 3 if G = yes, else PR 2; after PR 1 lands)

Files: new `packages/fiscal-verifactu/src/record-remedy-replacement.ts`; `record-remedy.ts`
(`REMEDY_KINDS`, `:18-25`, gains `replacement-invoice`); `record-remedy-routes.ts` (the kind's
branch; `ENABLED_REMEDIES` gains it); `record-remedy-corrective.ts` (`applyCorrectiveInvoice` takes
the kind it records, default `corrective-invoice`, and a `replace` callback in place of its
`recordCorrection` call, so the case checks, the repeat answer and the case event are shared);
`remedy-refusals.ts` (the new codes); `put-right.ts` (the `1112` F2 row); the dialog, strings and
both guide pages.

Behaviour:

- The request is exactly `{ kind: "replacement-invoice", registroId, actionKey, reason, caseId? }`
  (plus the operation date if question B's answer puts it in the confirmation); any other key,
  amounts included, is refused `fiscal.remedy_request_invalid`. The server checks the case as
  `applyCorrectiveInvoice` does, then also that the case is `fiscal.registro_rechazado` with code
  `1112` then and now and the record is an F2 (`fiscal.remedy_invalid` otherwise), and calls
  `recordReplacement` with this node's live `rectificative` series (refused `fiscal.remedy_invalid`
  if there is none), the original's operation description, and the administrator's session.
- The dialog's **Put this right** confirmation: "Waitron will issue a replacement corrective invoice
  for invoice A/123 of 14/11/2026, total 12,10 €, dated today, and send it to AEAT. The refused
  invoice stays as it is." with **Send** and **Stop**. The number, date and total come from the
  case's record; the browser sends none of them.
- `sale.replacement_not_first` and `clock.behind_chain` get the sentences in Task 2b's table; the
  page's line gains "Waitron can put right a simplified invoice AEAT refused for a future date."; the
  guide's `{#cases}` gains one sentence saying so, in both languages, including that if the server
  says its clock reads earlier than its newest invoice, confirming the time on the Box status page
  lets it go ahead.

Failing tests first:

- New `record-remedy-replacement.test.ts`: a `1112` F2 case → 200, one R5 "S" naming the refused
  invoice, the case resolved, and a repeat with the same `actionKey` answered from the saved
  decision; a body with `correction`, `total` or `lines` → 400; a `1100` case, an F1, a case whose
  code changed, and an `aceptado_con_errores` case → `fiscal.remedy_invalid`; while the start waits
  → 409 `clock.unconfirmed`; **an original with an earlier partial refund** → 400
  `sale.replacement_not_first`, no number used (M4).
- **A chain that ends in a future-dated record** (I4; out of date since main's #2964, see "A clock
  that ran ahead"): the refused original stamped tomorrow, the
  clock today → 409 `clock.behind_chain` and nothing written; then a clock confirmation given
  through `POST /api/box/clock-confirm` (or the seat the clock-confirm route tests use) → the same
  request answers 200 with one R5 "S". Put this case where the boot wiring is real, beside
  `apps/server/src/clock-behind-stop.records.test.ts`.
- `put-right.test.ts`: the `1112` F2 row now answers `replacement-invoice`.
  `record-remedy-routes.test.ts`: the default policy is exactly `record-correction` and
  `replacement-invoice`. `fiscal-remedy.staff-refund.test.ts:554-580`: `replacement-invoice` joins
  `record-correction` as reaching validation.
- Browser: `fiscal-filing-screen.test.ts` — a `1112` F2 case shows **Put this right**, the
  confirmation names number, date and total, **Send** posts `kind: "replacement-invoice"` with that
  `registroId` and no amounts; a `clock.behind_chain` answer shows its sentence with the action
  still available; a11y for the confirmation in both themes.

Commands: as Tasks 1d and 2b, plus `src/record-remedy-replacement.test.ts` and
`cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/clock-behind-stop.records.test.ts
src/clock-confirm.route.test.ts`; then the three protected fiscal tests, unedited.

Docs: CLAUDE.md:951 and `conventions-data.md:4705-4706` as rewritten in Task 1d now name both
enabled remedies; A1407 (`docs/backlog.md:1700`) keeps only its full-invoice half; A1089 narrowed
again.

Size: about 140 production lines, 300 test lines.

## Sizes

Estimated from comparable changes: A802 slice 2's correction writer (#2671: 353 production, 816 test
lines) for Tasks 3a, 3d and 3f, and W41s-9 slice 2's screen work (#3077: 123 screen and 30 string
lines, 95 screen-test lines) for Tasks 2b and 3c **(run**: `git show --stat`**)**. The review's
correction to Task 3b (about +40 production, +150 test) is folded into 3b-1, 3b-2 and 3f.

| Task | PR | Production | Tests |
| --- | --- | --- | --- |
| 1a time check | 2 | 25 | 80 |
| 1b issuer name (F(ii) adds 10 / 40) | 2 | 15 | 90 |
| 1c case by record, classifier | 2 | 60 | 120 |
| 1d switch on, docs | 2 | 2 | 40 |
| 2a case view | 2 | 15 | 40 |
| 2b dialog | 2 | 240 | 350 |
| 3a core replacement, flag | 1 | 120 (+ generated migration) | 360 |
| 3b-1 reports | 1 | 25 | 170 |
| 3b-2 owed, guard | 1 | 45 | 280 |
| 3f later refunds | 1 | 40 | 180 |
| 3d "S" writer | 1 | 30 | 150 |
| 3e printed copy | 1 | 20 | 80 |
| 3c switch on | 3 (or 2) | 140 | 300 |
| **Total** | | **about 780** | **about 2,240** |
| PR 1 | | about 280 | about 1,220 |
| PR 2 (Tasks 1–2) | | about 360 | about 720 |
| PR 3 | | about 140 | about 300 |

PR 1 sits just past the 1,100-line test cap. If it is still past it once built, Task 3f (later
refunds) moves to its own PR straight after PR 1, before PR 3; nothing in production reaches a
replaced sale until PR 3 lands. Every task is meant to finish well under 100 tool calls; 2b and 3a
are the largest, and an implementer past about 150 calls stops at a passing point and hands over.
