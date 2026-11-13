# Q37-FIX: put a refused invoice right from the Fiscal filing page — implementation plan

> **For agentic workers:** use `superpowers:subagent-driven-development`. Dispatch each task as
> `subagent_type: "implementer"`. Every task is test-first: write the named failing check, run it,
> see it fail for the stated reason, then write the smallest code that passes it. Fiscal: the owner
> lands every PR this plan produces.

**Status:** revised plan, 2026-11-13, after the owner's and the watcher's answers. Written in
worktree `waitron-feat-q37-fix-put-right` (branch `feat/q37-fix-put-right`) on `main` at
`7fb59b4e84`. No product code was written. **(run)** marks what was run in this revision's session;
**(read)** marks what was only read. A few results come from the first draft's session at
`71baa3c8d0` and were not re-run; those say so.

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
  **(read)**.
- **Remedy**: one of the administrator actions mounted at `POST
  /management-api/fiscal-records/remedy` (`packages/fiscal-verifactu/src/record-remedy-routes.ts`).
  A remedy kind runs only if the server's own policy, `ENABLED_REMEDIES` (`:22`), lists it; today
  the set is empty.
- **The start's time check**: after a start, a box that files records writes no record until its
  time is confirmed (CLAUDE.md §5). `apps/server/src/start-clock-gate.ts` enforces it.

## Decisions

All recorded in `~/waitron-campaign-shared/desk/done/20261113-2205-L-q37-fix-remedy.md` and in lane
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
   owner's answers. Since decision 2 settles the correction record, this plan reads that as: Task 2
   offers the correction record for `1100` only, and the corrective is offered to no case until the
   replacement exists (Task 3c). The size cap (one PR under about 700 production and 1,100 test
   lines, otherwise the writer change goes first as its own PR) is the watcher's, 22:09.

What the owner's decision 1 still leaves open is in **Still open** below: three pieces of fiscal
content the sources do not settle. They are kept out of the build until answered.

## Outcome

When this lands, an administrator — or a manager who signs in as one from the page — opens a case
on **Reporting → Fiscal filing** and sees one of three things:

- **AEAT refused a simplified invoice for a future issue date (`1112`)**: **Put this right** issues
  a replacement corrective invoice dated today that names the refused invoice, sends it to AEAT,
  and closes the case. The confirmation says exactly what will be sent.
- **AEAT refused a record with code `1100`**: **Correct the description** re-sends the same record
  with a corrected operation description, and closes the case.
- **Anything else**: one sentence saying Waitron cannot put this one right yet, and why (a full
  invoice needs a corrective Waitron cannot issue yet, A1407; otherwise no fix is known yet).

## Scope and non-scope

In scope: switch on `record-correction` and a new `replacement-invoice` remedy in
`ENABLED_REMEDIES`; hold every remedy behind the start's time check; let the page name a case by its
record; decide from what the page already reads which fix fits a case; refuse a new issuer name in a
correction record; the replacement R5 writer; making every reader of sales count a replaced sale
once; the case dialog's actions, confirmation and in-place administrator sign-in; the guide's cases
section in English and Spanish; the backlog and written claims the change retires.

Not in scope: an R4 (full-invoice) corrective or any F1 correction (A1407); switching on
`corrective-invoice` (the by-differences remedy, whose request carries amounts from the browser —
it stays off), `absent-original-cancellation`, `release-brake` or `release-held-cancellation` (Q35,
Q38, Q40); cases "accepted with errors"; a fix for cancellations; a replacement of an invoice AEAT
accepted. The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`),
`inmutabilidad.test.ts` and `correction-amount.huella.test.ts` pass unedited.

## What AEAT's own sources say about a replacement

Sources are in the sibling `verifactu` repo, `sources/archive/`. PDFs were read through
`pdftotext -layout` this session **(run)**; what they mean was **(read)**.

- **The schema.** `aeat-annex-production-SuministroInformacion.xsd/ee4c1655….xsd:141`:
  `<element name="ImporteRectificacion" type="sf:DesgloseRectificacionType" minOccurs="0"/>`;
  `:323-332` defines it as «Desglose de Base y Cuota sustituida en las Facturas Rectificativas
  sustitutivas», with `BaseRectificada` and `CuotaRectificada` required and
  `CuotaRecargoRectificado` optional (`minOccurs="0"`). `DescripcionOperacion` is
  `sf:TextMax500Type` (`:143`).
- **The validation rules** (`aeat-validation-rules/426eb926….pdf`, v1.2.2, page 8): «Sólo deberá
  incluirse esta agrupación si el campo TipoRectificativa = "S".» and «Obligatorio si
  TipoRectificativa = “S”.» Error codes 1118 and 1119 say the same (`aeat-error-codes/….properties`
  lines 65-66).
- **What the amounts mean: AEAT's taxpayer FAQ** (`aeat-faq-procedimientos-facturacion/9a0093f2….txt`,
  under «¿Cómo registra el emisor una factura rectificativa por sustitución “S”?»):
  - «Opción 1: Informando de un nuevo registro en el que se indiquen los importes correctos tras la
    rectificación en los campos “base imponible”, “cuota” … y a su vez de los importes rectificados
    respecto de la factura original en los campos “base rectificada”, “cuota rectificada” …». Its
    Example 1 replaces an invoice of base 1.000 / VAT 210 by one of 800 / 168 and files «la “base
    rectificada” (1.000) y la “cuota rectificada” (210)».
  - «Opción 2: … y de otro registro en el que se informe de los importes rectificados.» In the same
    example the original's amounts are first cancelled by a separate negative invoice (−1.000 /
    −210), and the replacement then files «“la base rectificada” 0 y la “cuota rectificada” 0».
  - So the rectified amounts are the amounts of the original that the replacement takes out of
    AEAT's count. In both options the change AEAT ends up holding is the same (−200 base, −42 VAT),
    which is how this plan reads the amounts: the replacement adds its own amounts and takes away
    the rectified ones. That reading is **inference from the two worked examples, not AEAT's
    words**.
- **A refused record is not in AEAT's systems.** Developer FAQ (`aeat-developer-faq/73906dc8….pdf`,
  v1.3 of 4 December 2025, §17, page 36): «ese RF rechazado no figuraría jamás en los sistemas de la
  AEAT (aunque constaría un rechazo)», and the error is «solucionada … cuando se reciba/n
  correctamente RF de la/s nueva/s factura/s rectificativa/s de la factura errónea original».
- **AEAT's 303 return counts correctives, not F3s.** Developer FAQ §27, page 49: «para el modelo 303
  se tienen en cuenta todas las facturas identificadas con clave de factura rectificativa (R1, R2,
  R3, R4 y R5) pero, por el contrario, ninguna factura identificada con la clave F3.»
- **The fingerprint does not include the replacement fields.** `@waitron/verifactu` 0.2.1's
  `buildCadenaAlta` (`node_modules/@waitron/verifactu/dist/huella.js:35-47`) hashes
  `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`,
  `ImporteTotal`, the previous fingerprint and `FechaHoraHusoGenRegistro` **(read)**. A throwaway
  script built one R5 four ways with the library's `buildAltaRecord`, `computeHuella` and `validate`
  **(run)**, deleted afterwards: "I"; "S" with rectified 0.00/0.00; "S" with the original's
  11.00/1.10; "S" with no `ImporteRectificacion`. All four fingerprints were
  `35E7844D…3101641`, identical; the first three had no validation issues, and the fourth — the
  control that shows the validator was looking — was refused: «ImporteRectificacion is mandatory
  when TipoRectificativa is S (sustitución)». So the "S" form needs no change to `computeHuella`, the
  chain or number allocation.
- **Storage already holds the form.** `registros_facturacion` has `tipo_rectificativa` (CHECK `'S'`
  or `'I'`) and `importe_rectificacion` (`packages/fiscal-verifactu/src/schema/registros.ts:75-78`,
  `:145-153`), copied from the record (`registro-row.ts:176-182`) **(read)**. No fiscal table
  changes.

## Still open: fiscal content the sources do not settle (for the watcher)

These three stay out of the build until answered (Task 3d and Task 3e wait for them). Everything
else is planned in full.

- **A. Which rectified amounts does the replacement carry when AEAT refused the original?**
  - Read literally, Option 1 says "the amounts of the original invoice": the original's base and
    VAT (for a 12,10 € ticket at 10%: 11.00 and 1.10). AEAT would then add the replacement's 11.00 /
    1.10 and take away 11.00 / 1.10 that it never held, so it would count the sale **zero times**.
  - Option 2 files 0 / 0 when the original's amounts are already out of AEAT's count. A refused
    original never entered it (FAQ §17). With 0 / 0, AEAT counts the sale **once**.
  - **Recommended default: `BaseRectificada` 0.00 and `CuotaRectificada` 0.00, no
    `CuotaRecargoRectificado`**, offered only for an original whose record AEAT refused. Before the
    first real one, run a preproduction probe in the `verifactu` repo (a new `live-aeat` mode, by
    the A985 precedent with the owner's approval): an F2 refused with `1112`, then an R5 "S" naming
    it with 0 / 0, sent while the original's date is still in the future and again after it has
    passed. No such probe exists today: the only refused-original probe, `rejected-invoice-credit`,
    sends an R1 by differences, and its original was refused through `RechazoPrevio: "S"`, not a
    future date (`scripts/live-aeat.mjs`, `buildRejectedInvoiceCreditProbeRecords`) **(read)**. A
    probe shows whether AEAT accepts the record, not what it counts.
- **B. Which operation date does the replacement state when it goes out on a later day?** AEAT's
  research note (`docs/compliance/research/2026-11-06-adviser-clock.md` §60.1) quotes: the operation
  date to state is «la fecha de realización de la operación correspondiente a la factura original».
  The original's stored date is the wrong one (the clock was ahead), and the real day cannot be
  proved from the box alone (§60.9). An operation date may not be in the future for IVA (validation
  rules, page 9).
  - **Recommended default: state no operation date**, as today's by-differences writer does, so AEAT
    reads the replacement's own issue date (today). That is exact when the replacement goes out on
    the day of the sale, and off by the delay otherwise. The confirmation already says the invoice
    carries today's date (decision 3).
- **C. What does the printed replacement say about the amount of the rectification?** The invoicing
  regulation, art. 15.5, says a simplified corrective states the amounts «tal y como quedan tras la
  rectificación efectuada, señalando igualmente en este caso el importe de dicha rectificación»
  (quoted in `docs/compliance/research/2026-10-09-vat-and-corrections.md` §3.3). Today's corrective
  receipt prints "Corrective invoice", "Corrects invoice" and its own lines
  (`apps/server/src/transaction-receipt.ts:85-97`, from A802 slice 5a, #3085) **(read)**; it states
  no rectification amount.
  - **Recommended default:** the replacement's receipt adds "Replaces invoice A/123 in full" and
    "Amount of the rectification: 0,00 €", since its amounts are the original document's. The
    remedy itself prints nothing; the receipt is reached through the existing reprint.

## Refusal → fix

The page reads, per case, its cause, AEAT's code when the case opened (`evidence.codigo`) and now
(`submission.codigoError`), the record type and the invoice type
(`packages/fiscal-verifactu/src/filing-overview-types.ts:66-95`) **(read)**. Nothing classifies AEAT
codes today: the stored code is compared only against `3000` and against itself
(`record-remedy.ts:160-164`, `record-remedy-corrective.ts:126-128`, `drain.ts:971-973`) **(read)**.
A case gets a fix only if it is `fiscal.registro_rechazado`, its delivery is `rechazado`, its code
then equals its code now, and it is an `alta` (an invoice record, not a cancellation) — the
conditions both remedies already check.

| Refusal (AEAT code) | Invoice | Fix offered | Why |
| --- | --- | --- | --- |
| `1112` issue date in the future | F2 | **Replacement corrective (R5 "S")** — from Task 3c | Owner, decisions 1 and 3. |
| `1112` | F1, F3 | None: "needs a full-invoice corrective, which Waitron cannot issue yet" | Refused before any number is used (below); R4 is A1407. |
| `1112` | R1–R5 (a refused corrective) | None: "no fix yet" | The writer refuses a non-F2 original (`backend.ts:554-561`). |
| `1100` a field has a wrong value or type | any alta | **Correction record**, operation description only — from Task 2 | Owner, decision 2. |
| Wrong registered name | — | None reaches the page | AEAT's error list has no record-level code for the issuer's name, and AEAT's test service accepted a record with a wrong name (run 37286371546, Q37) — the first draft's finding, not re-run. It falls to "no fix yet" by its code. |
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
accepted (`drain.ts:786-822`) **(read)**. `release-brake` staying off therefore delays a corrective
by up to an hour; it does not block it.

## How the sale is counted once

A replacement is a second sale row (the corrective) pointing at the first (`sales.corrects_sale_id`)
and carrying the same amounts. Today every reader treats a corrective's total as a **change** to the
original, so a full-amount corrective would count twice everywhere, not only in the VAT return:

- **VAT return** (`packages/reporting/src/vat-return.ts:10-16`): sums every sale not voided and not an
  F3, correctives included, «corrections netted» (`activeSalesClause`,
  `packages/reporting/src/business-day.ts:217-220`) **(read)**.
- **Day reports**: VAT summary, counts, category sales and top sellers select through
  `issuedSalesClause` / `reversedSalesClause` (`business-day.ts:229-244`) **(read)**.
- **What a sale still owes**: `correctionsCents` (`apps/server/src/sale-due.ts:17`), `settleSale`
  (`packages/core/src/settle-sale.ts:51`), `listOutstandingSales`
  (`packages/core/src/list-outstanding-sales.ts:47`), the orders list (`apps/server/src/orders-list.ts:136`;
  its "credited" marks at `:325`, `:371`, `:390`), Find bill (`apps/server/src/find-bill-bills.ts:55`)
  and `recordCorrection`'s own remaining and count (`packages/core/src/record-correction.ts:141-142`)
  all add correctives' totals **(read)**.
- **Accountant export** (`apps/server/src/accountant-export.ts:212`) labels every corrective
  "corrective" **(read)**.

**The rule this plan builds: a replacement adds nothing locally; its original carries the sale.**
Every reader leaves the replacement out, exactly as they already leave out an F3. The original
keeps its money, its day and its place in every report. Reasons:

- It is the treatment the return already gives an F3, the other document that stands in for an
  earlier one (`notSubstituteClause`, `business-day.ts:207-209`).
- It keeps every closed day's figures as they were frozen: a replacement issued days later changes
  no closed day (`issuedSalesClause`'s comment, `business-day.ts:222-228`).
- The VAT period follows when the VAT fell due, not the invoice date (§60.5a). The original's stored
  date is the clock's error away from the real day; the replacement's is as far away as the delay in
  fixing it, which decision 3 leaves open. The original's date is the closer one.
- What it gives up: AEAT holds the sale under the replacement's date, so in the rare case where the
  two dates fall in different VAT periods, Waitron's return and AEAT's register put it in different
  periods. The watcher may prefer the other rule (count the replacement, leave out the refused
  original); that changes only `activeSalesClause` in Task 3b.

To tell a replacement from an ordinary corrective, `sales` gains one flag column,
`replaces_original` (Task 3a). The A1308 table hold was lifted on 2026-11-07
(`~/waitron-campaign-shared/a1308-hold.md`), and A1308's target design keeps `sales` and adds
columns to it (`docs/superpowers/specs/2026-11-02-rationalisation/tables-ordersales.md` §1.13)
**(read)**.

## Protected files this plan touches, and why

- `packages/fiscal-verifactu/src/backend.ts`, `recordCorrection` (`:534-624`): Task 3a makes it
  refuse a replacement; Task 3d adds the "S" branch beside the "I" one. The "I" branch's lines stay
  as they are, proved by Task 3a's first test.
- `packages/fiscal/src/backend.ts:596-605`, the `FiscalBackend.recordCorrection` contract (shared by
  every fiscal backend): its `correction` argument gains `replaces?: true`.
- `packages/core/src/record-correction.ts`: Task 3a moves its series check into a helper the new
  `recordReplacement` shares and adds `not replaces_original` to its remaining and count (Task 3b);
  nothing else in it changes.
- `packages/db/src/schema/sales.ts` and core's starting migration (rebuilt, never hand-edited).
- Not touched: `computeHuella`, `appendToChain` and the chain (`packages/fiscal-verifactu/src/chain.ts`),
  `allocateInvoiceNumber`, `registros_facturacion`'s schema and its append-only triggers.

## Order and pull requests

Measured estimates (below) put the total at about 610 production and 1,520 test lines, past the test
half of the cap. So, by decision 4, **the writer change goes first as its own PR**:

| PR | Branch | Tasks | When |
| --- | --- | --- | --- |
| 1. Replacement writer | `feat/q37-replacement-writer`, a new worktree from `main` | 3a, 3b now; 3d, 3e after A–C are answered | Lands first. Nothing in production calls it: the remedy that does is Task 3c. |
| 2. Put it right | `feat/q37-fix-put-right` (this one) | 1, 2 now; 3c after PR 1 lands, on a rebase | One PR: it is not opened for landing until 3c is in it. |

Until Task 3c, `putRightFor` answers "no fix yet" for every `1112` case and `ENABLED_REMEDIES`
holds only `record-correction`, so the branch offers the correction record (decided) and no
corrective (decision 4). Task 3c adds `replacement-invoice` to the set and switches the `1112` row
on, in the same commit.

---

## Task 1 — server: the time check, the correction record on, a case found by its record, the classifier, the issuer-name refusal

Files: `packages/fiscal-verifactu/src/record-remedy-routes.ts`; `packages/module/src/module.ts`
(`ModuleRouteContext.recordGeneration`, `:87-94`, gains `requireClockConfirmed(): void`);
`apps/server/src/module-record-generation.ts` and `apps/server/src/boot.ts` (pass `startClockHolds`,
`boot.ts:2360`, into `moduleRecordGeneration`, `boot.ts:3160`, which throws `clock.unconfirmed`
while it holds); `packages/fiscal-verifactu/src/record-remedy-http.ts` and `errors.ts` (the
issuer-name refusal); new browser-safe `packages/fiscal-verifactu/src/put-right.ts`
(`putRightFor(view: FilingCaseView)` → `{ kind: "record-correction" } | { kind: "none"; why:
"full-invoice" | "not-yet" }`; Task 3c adds `{ kind: "replacement-invoice" }`).

Behaviour:

- `ENABLED_REMEDIES` becomes `new Set(["record-correction"])`.
- After `admitRecordRemedy` and the generation check (`record-remedy-routes.ts:80-82`), the route
  calls `ctx.recordGeneration.requireClockConfirmed()`, for every kind, before
  `requireFreshManagementSignIn` (`:83`); the error map gains `"clock.unconfirmed": 409`. Why the
  route: the start's time check wraps only the shared fiscal seat's four writers
  (`apps/server/src/start-clock-gate.ts:8-14`), while `record-correction` appends to the chain
  directly (`record-remedy.ts:194`) and the corrective remedies build their own, unwrapped seat
  (`record-remedy-corrective-http.ts:99-103`) **(read)**. It is not folded into `requireWritable`
  because `apps/server/src/return-records-api.ts:51` and `return-clash-acceptance.ts:296` call that
  too, and gating returns is not this item. It also covers the record-correction that A1342 already
  admits, in production, for a returned box's records (`record-remedy-routes.ts:68-79`).
- A body without `caseId` is answered for the case of its `registroId` (one case per record:
  `filing_cases_registro_uq`, `schema/filing-cases.ts:35`); a body that sends one keeps today's
  checks, which refuse a case for another record (`record-remedy.ts:156`,
  `record-remedy-corrective.ts:119`). Why: no case id leaves the read model
  (`filing-overview-types.ts:67`), deliberately (`docs/superpowers/plans/2026-11-09-w41s-9-fiscal-filing-screen.md:70-84`).
- `applyCorrectedRecordFacts` refuses a `facts.issuerName` that differs from the record's own
  `NombreRazonEmisor` with **`fiscal.remedy_issuer_changed`** `{ registroId }` (HTTP 400, the
  error boundary's default, like `fiscal.remedy_amount_changed`), before anything is written. The
  same name is accepted, as an unchanged amount is. Registered in
  `packages/fiscal-verifactu/src/errors.ts` beside `fiscal.remedy_amount_changed` (`:116-126`), with
  a one-line comment saying the issuer's name is printed on the invoice, so changing it takes a
  corrective invoice (owner, decision 2). The code names the domain concept, as its siblings do.
  Other printed facts a correction record accepts today (`invoiceType`, `recipients`,
  `record-remedy-facts.ts:10-22`) stay accepted; the panel never sends them, and narrowing them is
  not decided.
- `putRightFor`: the table above, with the `1112` F2 row answering `not-yet` until Task 3c.

Failing tests first:

- `record-remedy-routes.test.ts`, new "the default policy enables exactly record-correction": mounted
  with a generation and no policy argument, `record-correction` reaches validation (400
  `fiscal.remedy_request_invalid` for an empty body) and each other kind answers 409
  `fiscal.remedy_disabled`. Fails today: `record-correction` answers 409.
- Same file, "refuses clock.unconfirmed before writing": a generation whose `requireClockConfirmed`
  throws → 409 `clock.unconfirmed` for `record-correction`, chain unchanged. Fails today: the route
  never asks.
- `apps/server/src/boot.start-clock-gate.test.ts`, a case beside `:195`: while the start waits, a
  complete `record-correction` request → 409 `clock.unconfirmed` and no record. Fails if boot does
  not pass the gate in.
- `record-remedy-facts.test.ts`: a fix with a new `issuerName` → 400 `fiscal.remedy_issuer_changed`
  and no write; the same name → 200. Fails today: 200 with the new name stored.
- `record-remedy-http.test.ts` and `record-remedy-corrective-http.test.ts`: the same request without
  `caseId` → 200 and the event on that record's case. Fails today: 400
  `fiscal.remedy_request_invalid`.
- New `put-right.test.ts` (node project): one case per table row, including F1, F3 and R5 with
  `1112`, code then ≠ code now, an `aceptado_con_errores` case and a cancellation.

Existing assertions that change, predicted by reading **(read)** — the first draft measured a
different switch (both kinds on) and that result no longer applies:

- `record-remedy-facts.test.ts` sends `issuerName` as its example fix at `:117` (the shared body),
  `:163`, `:176`, `:472`, `:476` and `:501`. Each keeps its assertion with `description:
  "Corrected restaurant service"` as the changed fact, except `:176` ("retains a partial
  corrected-fact decision"), whose `issuerName` row becomes the new refusal case. `:527` (`{
  issuerName: "" }`) still answers `fiscal.remedy_request_invalid`, which is checked first.
- `apps/server/src/fiscal-remedy.staff-refund.test.ts:554-580` "keeps every built-in remedy
  disabled": `record-correction` now passes the policy and its body's extra `enabledRemedies` key is
  refused, so it answers 400 `fiscal.remedy_request_invalid`. Becomes: every kind except
  `record-correction` 409 `fiscal.remedy_disabled`; `record-correction` 400; fiscal facts unchanged
  either way.
- `record-remedy-routes.test.ts:58-72` still passes for `record-correction`, but for the wrong
  reason: it mounts with no generation (`:31`), so `recordGeneration === undefined` (`:81-82`)
  answers instead of the policy. Narrow its `it.each` to the disabled kinds; the new default-policy
  case owns `record-correction`.
- `record-remedy-corrective-http.test.ts:419` "keeps the default production policy closed" is
  unchanged: `corrective-invoice` stays off.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy
src/put-right.test.ts`; `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run
src/boot.start-clock-gate.test.ts src/fiscal-remedy.staff-refund.test.ts src/return-records.real.test.ts`.
This session's baseline **(run)**: `vitest run --project node src/record-remedy
src/correction-amount.huella.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts` →
`Test Files 14 passed`, `Tests 530 passed`.

Guards: `scripts/errors-reachable.test.ts` (the new code); `scripts/dashboard-browser-purity.test.ts`
for `put-right.ts`; the three protected fiscal tests, unedited.

Docs this task retires (the gate now covers the remedies; production enables one): root
`CLAUDE.md:951` "the record remedies, off in production, are outside it"; `docs/developers/conventions-data.md:4705-4706`
"call the chain directly and are outside the gate; production enables none of them"; A1407,
`docs/backlog.md:1700`, "today the remedies write past it, and production enables none"; W41s,
`docs/backlog.md:296-299` (drop Q37 from "pending Q35/Q37/Q38/Q40" and correct the
"`ENABLED_REMEDIES` is empty, `…record-remedy-routes.ts:20`" clause); `docs/backlog/fiscal.md:429`.

Size: about 90 production lines, 220 test lines.

## Task 2 — the case dialog: the correction record for `1100`, sign-in, the guide

Files: `packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts` (the case dialog,
`#details()`, `:636-656`; the "cannot correct" line, `:609-615`), `fiscal-filing-client.ts` (a
`putRight` POST), `strings.ts` (English `:210` and Spanish `:492` "cannot correct" lines, and the new
words), `index.ts` (hand the screen `ctx.permissionContinuation`, `:21-27`, as the certificate panel
already gets it at `:53`), `apps/server/src/guide/en/fiscal-filing.md` and `es/fiscal-filing.md`
(`{#cases}`, en `:32-40`), a new `fiscal-filing-screen.unsaved.test.ts`.

Behaviour:

- The dialog shows the case's fix from `putRightFor`, or one sentence saying why not: a full invoice
  → "Waitron cannot put this one right yet: a full invoice needs a corrective invoice Waitron cannot
  issue yet."; otherwise → "Waitron cannot put this one right yet. The case stays open." (no
  "ask someone": `docs/developers/conventions-ui.md:8-20`; the export button keeps the owner's own
  wording).
- **Correct the description** (`1100`) opens one field in the dialog, the operation description,
  from the field primitive (`wt-textarea`, `name="operationDescription"`), prefilled with the
  record's description, required, capped at 500 characters (AEAT's `TextMax500Type`). Under the
  Forms contract (`docs/developers/design-system.md` → Forms): a draft scope from `draftScopeFor`;
  **Send** stays quiet and disabled until the text differs from the record's, using
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
- A recent sign-in: the route asks for one (`requireFreshManagementSignIn`,
  `record-remedy-routes.ts:83`, `management_session.proof_required`); the dashboard's shared gate
  prompts in place and resends the same body (`apps/dashboard/src/api/fresh-sign-in.ts:40-71`,
  wrapping the request at `apps/dashboard/src/main.ts:91-97`). The panel adds nothing; a test proves
  the resend.
- A refusal is shown under the actions, explained, the action still available.
  `clock.unconfirmed` reads "The server is waiting for its time to be confirmed. Confirm it on a
  till, then send again." On success the dialog closes and the page reads again; a failed read after
  a successful send is a load failure, not a failed send.
- The page's "Waitron cannot correct these records yet." becomes "Open a case to see whether Waitron
  can put it right." (Task 3c adds the future-date sentence.)

Failing tests first (`fiscal-filing-screen.test.ts`, browser project): a `1100` case shows
**Correct the description**; **Send** is disabled until the text changes, then posts
`kind: "record-correction"` with that `registroId`, `facts.description` and no `caseId` (fails if
the action is deleted: no button); a `1112` F2 case shows the "cannot put this one right yet"
sentence and no action (until Task 3c); an F1 `1112` case shows the full-invoice sentence; without
`fiscal.remedy` the action calls `signIn` with `fiscal.remedy`; a `proof_required` answer followed
by a confirmed sign-in resends the identical body once; a refusal is shown and the action stays
enabled; **Stop** sends nothing. `fiscal-filing-screen.unsaved.test.ts`: an edited description warns
before the dialog or page is left. `fiscal-filing-screen.a11y.test.ts`: the field, refusal and
sign-in states in both themes. Update the existing `data-test="no-correction"` assertion to the new
words.

Guide: the `{#cases}` section in both languages gains two sentences — that a case AEAT refused for a
wrong field value can have its description corrected from the case, and that this needs an
administrator, who can sign in from the case. Written from the code (`conventions-ui.md` "A help
bubble orients", "A guide says what to do").

Backlog: A1089 (`docs/backlog.md:210`) says the page "decides nothing" and "`ENABLED_REMEDIES` is
empty": narrow it to the decisions still missing (everything but `1100` and, after Task 3c, `1112`
on a simplified invoice).

Commands (check `memory_pressure | grep free` first; browser tests need well above 15% free):
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.unsaved.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts`;
`cd apps/server && pnpm exec vitest run src/guide-content.test.ts`; root
`pnpm exec vitest run scripts/guide-links.test.ts scripts/native-form-fields.test.ts scripts/page-title-styles.test.ts`.

Size: about 210 production lines (screen 130, client 15, strings 50, wiring 15), 300 test lines,
about 10 lines of guide prose.

## Task 3a — core: a replacement corrective, and the `replaces_original` flag (PR 1)

Files: `packages/db/src/schema/sales.ts` (+ core's starting migration, rebuilt with
`pnpm --filter @waitron/server migration-baseline rebuild --set core`); new
`packages/core/src/record-replacement.ts`; new `packages/core/src/corrective-series.ts` (the series
check moved out of `record-correction.ts:161-195`, called from both); `packages/core/src/insert-sale.ts`
(passes the flag); `packages/core/src/errors.ts`; `packages/core/src/index.ts`;
`packages/fiscal/src/backend.ts` (contract) and `src/testing/fake-backend.ts`;
`packages/fiscal-verifactu/src/backend.ts` (refuses a replacement until Task 3d).

Behaviour:

- `sales.replaces_original`: a flag (`flag()` from `packages/db/src/schema/columns.ts:148`), not
  null, default false; CHECK `sales_replaces_original_ck`: false, or `corrects_sale_id` is not null;
  a unique index on `corrects_sale_id` where it is true (one replacement per invoice), declared in the
  TypeScript schema.
- `recordReplacement(tx, backend, { origin, nodeId, seriesId, correctsSaleId, operationDescription?,
  authz, clock })` — no amounts or lines in its input. It reads the original's total, stored VAT
  split, lines, locales and tax number; refuses a voided original (`sale.voided`), a series that is
  not this node's live rectificative series (the moved check, same codes), a session without
  `sale.rectify`, a full invoice (`requireSupportedCorrection`), and an original that already has a
  corrective (**`sale.replacement_not_first`** `{ saleId }`) — all before a number is allocated.
  Then it runs the integrity check, takes one clock reading, allocates the number as
  `recordCorrection` does, inserts the sale (the original's total and stored VAT split, positive;
  `correctsSaleId`; `replacesOriginal: true`), copies the original's lines with new ids and
  `correctsLineId` null, and calls `backend.recordCorrection(tx, sale, { correctsSaleId, replaces:
  true })`.
- `FiscalBackend.recordCorrection`'s third argument becomes `{ correctsSaleId: SaleId; replaces?:
  true }`. The Veri\*Factu backend refuses `replaces` with `fiscal.correction_unsupported` until
  Task 3d (so no backend files a full-amount "I" by mistake); `fiscal-none` records nothing, as for
  any corrective; the fake backend records the flag.

Failing tests first:

1. **Before any change**, new `packages/fiscal-verifactu/src/correction-form.test.ts`: a
   by-differences correction recorded through `recordCorrection` with a pinned clock and NIF, pinning
   as literals the stored row's filed fields (`tipo_rectificativa` "I", `importe_rectificacion`
   null, `facturas_rectificadas`, `desglose`, totals), the fingerprint input string
   (`buildCadena(fromRegistroRow(row))`) and the serialised envelope (`serializeEnvio`). Commit it
   passing on unchanged code; it must pass unedited after Tasks 3a and 3d. A mutation check: change
   `"I"` to `"S"` in `backend.ts` locally and see it fail, then restore.
2. `packages/core/src/record-replacement.test.ts`: a replacement of a 12.10 ticket stores a sale of
   12.10 with the original's VAT split, copied lines, `replaces_original` true and a new number from
   the rectificative series; each refusal above leaves no number used (`invoice_series` counter
   unchanged). Fails today: no such function.
3. `packages/db/src/schema/sales.test.ts`: `replaces_original` true without `corrects_sale_id` is
   refused by the CHECK; a second replacement of one sale by the unique index. Fails today: no
   column.
4. `packages/fiscal-verifactu/src/backend.test.ts`: `replaces: true` → `fiscal.correction_unsupported`
   and no record.

Commands: `pnpm --filter @waitron/core exec vitest run src/record-replacement.test.ts
src/record-correction.test.ts`; `pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts`;
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/correction-form.test.ts
src/backend.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts`.
Guards to RUN after the schema change (CLAUDE.md §3): `scripts/schema-constraints.test.ts`,
`scripts/append-only-triggers.test.ts`, `scripts/behavioural-triggers.test.ts`,
`scripts/starting-migrations.test.ts`, `scripts/column-vocabulary.test.ts`,
`scripts/errors-reachable.test.ts`, `packages/fiscal-verifactu/src/inmutabilidad.test.ts`; also
`packages/fiscal-verifactu/src/handover-return.test.ts`, which copies sales rows between boxes.

Size: about 120 production lines, 350 test lines, plus the rebuilt starting migration (generated;
count its lines in the PR description).

## Task 3b — every reader counts a replaced sale once (PR 1)

Files: `packages/reporting/src/business-day.ts` (a `notReplacementClause()` beside
`notSubstituteClause()`, used by `activeSalesClause`, `issuedSalesClause` and
`reversedSalesClause`); `apps/server/src/sale-due.ts:17`, `packages/core/src/settle-sale.ts:51`,
`packages/core/src/list-outstanding-sales.ts:47`, `apps/server/src/orders-list.ts:136`, `:325`,
`:371`, `:390`, `apps/server/src/find-bill-bills.ts:55`, `packages/core/src/record-correction.ts:141-142`
(each `… where c.corrects_sale_id = … and not c.replaces_original`);
`apps/server/src/accountant-export.ts:212` (a replacement's type reads `replacement`).

Failing tests first (each fails today because the replacement's 12.10 is added):

- `packages/reporting/src/vat-return.test.ts`: a 12.10 sale at 10% and its replacement in one
  quarter → base 11.00, VAT 1.10 (today 22.00 / 2.20); the original in Q4 and its replacement in the
  next Q1 → Q4 counts it, Q1 does not.
- `packages/reporting` day reports: the replacement's day shows no extra sale, VAT or top-seller
  quantity (`vat-summary`, `counts`, `top-sellers` tests).
- `packages/core/src/settle-sale.test.ts` and `list-outstanding-sales.test.ts`, `apps/server`
  `sale-due`, `orders-list` and `find-bill` tests: after a replacement the original owes what it owed
  before, and the orders list does not mark it credited.
- `packages/core/src/record-correction.test.ts`: a by-differences correction of a replaced sale sees
  the original's remaining, not twice it (the A802 path is otherwise unchanged).
- `apps/server` accountant export: the replacement's row reads `replacement`.

Commands: `pnpm --filter @waitron/reporting exec vitest run`; `pnpm --filter @waitron/core exec
vitest run src/settle-sale.test.ts src/list-outstanding-sales.test.ts src/record-correction.test.ts`;
`cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run src/sale-due.test.ts
src/orders-list.test.ts src/find-bill-bills.test.ts src/accountant-export.test.ts` (names checked
when the task starts; grep for the suites that read each changed file). A PR tests only changed
packages, not their dependents (CLAUDE.md §2), so run the dashboard's live-query and till suites
that pin `sales` readers if any of their queries change.

Docs: `vat-return.ts:10-16`'s «corrections netted» and `activeSalesClause`'s comment gain "except a
replacement, which stands in for its original"; root `CLAUDE.md` §3 (Data) gains one line — a
reader that sums correctives' totals leaves out `replaces_original`; nothing guards it — with the
receipt in `docs/developers/conventions-data.md`.

Size: about 30 production lines, 250 test lines.

## Task 3d — the writer files the replacement as "S" (PR 1; after answers A and B)

Files: `packages/fiscal-verifactu/src/backend.ts` (`recordCorrection`, `:534-624`).

Behaviour: with `replaces: true`, the backend reads the original alta's delivery (`envios.estado`)
and refuses `fiscal.correction_unsupported` unless it is `rechazado` (AEAT holds nothing for it; a
replacement of an accepted invoice is not in scope). It then builds the same input as the "I"
branch except `TipoRectificativa: "S"`, `ImporteRectificacion` per answer A, and the operation date
per answer B. `FacturasRectificadas` names the refused invoice by its stored number and date
(`:578-587`), the corrective's own number and date are its own (`:571-573`), and `appendToChain`,
`envios` and the QR are as for "I".

Failing tests first: `backend.test.ts` — a replacement of a refused F2 writes one R5 with
`tipo_rectificativa` "S", `importe_rectificacion` as answered, the original's `desglose` and totals,
and `facturas_rectificadas` naming it; its serialised record passes the library's `validate`; a
replacement of an accepted original is refused with no record. `correction-form.test.ts` (Task 3a)
passes unedited. Fails today: Task 3a's refusal.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts
src/correction-form.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
src/correction-amount.huella.test.ts`. If anything here would need a change to what enters the
fingerprint, stop and write it to the watcher.

Docs: the comment at `backend.ts:575-576` ("S" would also need `ImporteRectificacion`) is replaced
by the branch itself; `docs/backlog/fiscal.md`'s A1407 entry and `docs/compliance/asesor-questions.md`
Q37 gain a dated line saying the replacement is built.

Size: about 25 production lines, 150 test lines.

## Task 3e — the printed replacement (PR 1; after answer C)

Files: `apps/server/src/transaction-receipt.ts` (`:85-97`, reads `replaces_original`), the receipt
layout and the Spanish pack's receipt label table (the two words A802 slice 5a added, in all five
languages).

Failing test first: `receipt-document.test.ts` — a replacement's receipt at 58 and 80 mm, in
English and Spanish, prints the wording answer C settles. Fails today: it prints as a by-differences
corrective.

Size: about 20 production lines, 80 test lines.

## Task 3c — the replacement remedy, switched on (PR 2; after PR 1 lands)

Files: new `packages/fiscal-verifactu/src/record-remedy-replacement.ts`; `record-remedy.ts`
(`REMEDY_KINDS`, `:18-25`, gains `replacement-invoice`); `record-remedy-routes.ts` (the kind's
branch; `ENABLED_REMEDIES` gains it); `record-remedy-corrective.ts` (`applyCorrectiveInvoice` takes
the kind it records, default `corrective-invoice`, and a `replace` callback in place of its
`recordCorrection` call, so the case checks, the repeat answer and the case event are shared);
`put-right.ts` (the `1112` F2 row); the dialog, strings and both guide pages.

Behaviour:

- The request is exactly `{ kind: "replacement-invoice", registroId, actionKey, reason, caseId? }`;
  any other key, amounts included, is refused `fiscal.remedy_request_invalid`. The server checks the
  case as `applyCorrectiveInvoice` does, then also that the case is `fiscal.registro_rechazado` with
  code `1112` then and now and the record is an F2 (`fiscal.remedy_invalid` otherwise), and calls
  `recordReplacement` with this node's live `rectificative` series (refused
  `fiscal.remedy_invalid` if there is none), the operation description of the original, and the
  administrator's session.
- The dialog's **Put this right** confirmation: "Waitron will issue a replacement corrective invoice
  for invoice A/123 of 14/11/2026, total 12,10 €, dated today, and send it to AEAT. The refused
  invoice stays as it is." with **Send** and **Stop**. The number, date and total come from the
  case's record; the browser sends none of them.
- The page's line gains "Waitron can put right a simplified invoice AEAT refused for a future date."
  The guide's `{#cases}` gains one sentence saying so, in both languages.

Failing tests first: new `record-remedy-replacement.test.ts` — a `1112` F2 case → 200, one R5 "S"
naming the refused invoice, the case resolved, and a repeat with the same `actionKey` answered from
the saved decision; a body with `correction`, `total` or `lines` → 400; a `1100` case, an F1, a
case whose code changed, and an `aceptado_con_errores` case → `fiscal.remedy_invalid`; while the
start waits → 409 `clock.unconfirmed`. `put-right.test.ts`: the `1112` F2 row now answers
`replacement-invoice`. `record-remedy-routes.test.ts`: the default policy is exactly
`record-correction` and `replacement-invoice`. `fiscal-remedy.staff-refund.test.ts:554-580`:
`replacement-invoice` joins `record-correction` as reaching validation. Browser:
`fiscal-filing-screen.test.ts` — a `1112` F2 case shows **Put this right**, the confirmation names
number, date and total, **Send** posts `kind: "replacement-invoice"` with that `registroId` and no
amounts; a11y for the confirmation in both themes.

Commands: as Task 1 and Task 2, plus `src/record-remedy-replacement.test.ts`; then the three
protected fiscal tests, unedited.

Docs: CLAUDE.md:951 and `conventions-data.md:4705-4706` as rewritten in Task 1 now name both enabled
remedies; A1407 (`docs/backlog.md:1700`) keeps only its full-invoice half; A1089 narrowed again.

Size: about 130 production lines, 250 test lines.

## Sizes

Estimated from comparable changes: A802 slice 2's correction writer (#2671: 353 production, 816 test
lines) for Tasks 3a and 3d, and W41s-9 slice 2's screen work (#3077: 123 screen and 30 string
lines, 95 screen-test lines) for Tasks 2 and 3c **(run**: `git show --stat`**)**.

| Task | Production | Tests |
| --- | --- | --- |
| 1 | 90 | 220 |
| 2 | 210 | 300 |
| 3a | 120 (+ generated migration) | 350 |
| 3b | 30 | 250 |
| 3c | 130 | 250 |
| 3d | 25 | 150 |
| 3e | 20 | 80 |
| **Total** | **about 625** | **about 1,600** |
| PR 1 (3a, 3b, 3d, 3e) | about 195 | about 830 |
| PR 2 (1, 2, 3c) | about 430 | about 770 |

Each task is meant to finish well under 100 tool calls; Task 2 is the largest, and if it passes
about 150 calls the implementer stops at a passing point and hands over.
