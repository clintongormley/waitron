# A1407 step 2: put right a full invoice AEAT refused for a future date — implementation plan

_2026-11-18: S14 answered — answer 1.14 of 15 November (ticket and full-invoice correctives may not share a series), and the owner's answer to question 8 of the [19 November sheet](../../compliance/2026-11-19-adviser-meeting.md) (owner, 2026-11-18: "always use a separate series for correctives")._

> **For agentic workers:** use `superpowers:subagent-driven-development`. Dispatch each task as
> `subagent_type: "implementer"`. Every task is test-first: write the named failing check, run it,
> see it fail for the stated reason, then write the smallest code that passes it. Fiscal: the owner
> lands the pull request this plan produces.

**Why the corrective is an R4.** AEAT's taxpayer FAQ on invoicing procedures, under «Tipo de
facturas», gives the full-invoice corrective type as:

> «"R4": Factura Rectificativa (Resto). Se indicará tipo de factura R4 en estas situaciones: […]
> Cuando se haya consignado erróneamente algún dato no monetario de la factura»

and the simplified one as «"R5": […] La rectificación de una factura simplificada se registrará con
la clave R5 cualquiera que sea el motivo de la misma» — [Preguntas frecuentes, procedimientos de
facturación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html),
archived in the `verifactu` repo as
`sources/archive/aeat-faq-procedimientos-facturacion/9a0093f2….txt` («Actualizadas a 21 de octubre
de 2026»), quoted in `docs/compliance/research/2026-11-06-adviser-clock.md:319-325`. That a wrong
issue date is a «dato no monetario» is our reading; the FAQ does not name the date. That a wrong
issue date needs a corrective at all is the DGT's binding ruling
[V1665-22](https://petete.tributos.hacienda.gob.es/consultas/?num_consulta=V1665-22) (11 July 2022),
asked by a billing-software maker about «una fecha posterior a la real de emisión»: «en caso de que
se haya consignado de manera incorrecta la fecha de expedición de la factura, será necesaria la
expedición de una factura rectificativa que deberá constar en serie específica de factura»
(research `:290-310`). The same FAQ's R1 is for «un error fundado de derecho o alguna de las causas
del art. 80.Uno, Dos y Seis LIVA (devoluciones de mercancías, descuentos o alteraciones en el
precio …)», money changes, which a wrong date is not. **Worked example:** a full invoice F/12 to
Cliente SL, 110,00 €, stamped 16 March by a clock a day ahead, refused by AEAT with code `1112`; the
administrator gives 15 March as the real day; Waitron files R/7, an R4 by replacement dated today,
naming Cliente SL and F/12, carrying 100,00 + 10,00 VAT, rectified amounts 0,00 / 0,00, operation
date 15 March. The owner lands this PR and sees the type there (watcher, 2026-11-14 22:51).

**Status:** plan only, 2026-11-15, lane L. Worktree
`waitron-docs-a1407-full-invoice-replacement-plan`, branch `docs/a1407-full-invoice-replacement-plan`,
on `main` at `1adccc8468` (#3235, Q37-FIX PR 3, landed). No product code was written. **(run)**
marks what was run in this session; **(read)** marks what was only read.

## Corrections at build start, 2026-11-15 (these win over the text below where they differ)

Sources: the Fable second read F6 (`~/waitron-campaign-m/reports/a1407-step2-plan.md`: Critical 0,
Important 3), the watcher's rulings on it (lane L questions.md, 2026-11-15 01:52) and the owner's two
answers relayed at 01:58 and 01:59. The watcher let the build start on the plan's defaults (01:29);
the owner has not approved this plan as a whole.

1. **The full-invoice half lands switched off** (F6 finding 2; watcher 01:52 point 2). A new remedy
   policy token, `FULL_INVOICE_REPLACEMENT` (`"full-invoice-replacement"`, beside
   `ACCEPTED_WITH_ERRORS_CORRECTION` in `record-remedy.ts`), is NOT in the server's
   `ENABLED_REMEDIES` (`record-remedy-routes.ts:32`). Without it the replacement remedy admits an F2
   only, as today, and an F1 case keeps answering 400 `fiscal.remedy_invalid`. The page agrees:
   `putRightFor` takes the same switch as an option whose default is one exported constant
   (`FULL_INVOICE_REPLACEMENT_ON = false`, in browser-safe `put-right.ts`), and the server adds the
   token to `ENABLED_REMEDIES` when that constant is true, so turning it on is one line. While it is
   off an F1 `1112` case still says Waitron cannot put it right yet (`put_right.none.full-invoice`
   stays). Tests turn it on through `mountRecordRemedies`'s `enabledRemedies` argument and the
   option; one route test and one `put-right` case pin that it is OFF by default. Turning it on waits
   for adviser question S14 (one corrective series for R4 and R5?) and the R4 "S" probe on AEAT's
   test service; the backlog's probe entry says so. **So no R4 is numbered from the shared series
   until then; Still open 1 is settled for now.** The guide says nothing about full invoices.
2. **The replacement corrective prints once as an original when it is issued** (F6 finding 1;
   watcher 01:52 point 1). It applies to the R5 replacement too: one remedy path serves both. The
   remedy is a dashboard action with no till behind it, so the Put this right dialog asks which
   receipt printer to print on (the active receipt printers, first one chosen, as the dashboard's
   order reprint asks for a `printerId`); the request carries an optional `printerId`. After the
   corrective is issued, in the same transaction, the server enqueues it once with
   `enqueueOriginalReceipt` (as the refund's credit note does, `apps/server/src/invoice-corrections.ts`),
   through a new optional hook on the module route context, wired by `apps/server`. No printer
   chosen or none active: nothing prints, the corrective is still issued. Every later print stays a
   copy. Still no email and no A4. This is a design call the watcher did not make: it is posted as a
   DEVIATION with this default. Task 2b below.
3. **A refused corrective has no fix on the page** (F6 finding 3; watcher point 3). Scope: a
   refused R4 (and, today, a refused R5) has no fix on the page, and a refusal about the customer
   block (AEAT `1193`, `2001`) has no writer at all, because a replacement cannot be replaced and a
   correction record refuses changed recipients. Task 2 writes this into A1089's backlog entry.
4. **The real day is printed** (owner, 2026-11-15 01:58, relayed by the watcher): a replacement
   corrective, R4 and the landed R5 alike, prints "Date of the sale: 15 March" when its stored
   `sales.supply_day` differs from its own issue date. One row in `receipt-document.ts` (so the A4
   document carries it too) with a new label in every receipt language
   (`packages/country-es/src/receipt-labels.ts`), and the same row in the till's ticket view. No
   filing change. Still open 2 is answered. Task 2 amends A444's entry in `docs/backlog/fiscal.md`
   with a dated note quoting the owner: "the operation date is when the table closes, which normally
   coincides with the invoice date", and "where an invoice is issued days after the meal finished
   … the operation date and the invoice date should be distinct".
5. **Any real day is accepted, as now** (owner, 01:59, on F6 finding 5). No change.
6. **Tests the read found weak** (F6 findings 4, 6, 7 and test item 3):
   - Task 1 adds to `record-payload-admission.test.ts`, beside `:108-118`: an R1, R2 and R3 "S"
     carrying an operation date are refused `UNSUPPORTED_FIELD`; an R4 by differences carrying one
     is refused; an R4 "S" stores it. Task 1's command list adds that file.
   - Task 1 folds `backend.test.ts:846` ("refuses a replacement of a refused original that is not a
     simplified invoice…", which uses an F1) into the new "refuses an F1 replacement handed no
     customer…" case, keeping its "records nothing" assertion; with the token rule above the
     backend itself still refuses an F1 handed no customer.
   - Task 2's rewritten route test also asserts the R4's number is the series' next, the series
     moved by one, the real day, rectified amounts 0.00 / 0.00, the invoice named, and that
     `verifyChain` reports nothing, as the R5 case at `record-remedy-replacement.test.ts:174-226`
     does.
   - The alert site (`alert-sources.ts`) keeps its `isNull(sales.correctsSaleId)` lines: after
     correction 2 an original print of a corrective exists, so its test issues a replacement through
     the real route with a printer, fails that original job, and asserts no undelivered-invoice
     alert; it fails if the lines are removed.
7. **One typing helper** (F6 "Duplication"): the helper Task 3a adds is the one place that types a
   sale for printing; `receipt-issuer.ts` calls it instead of being overridden by spread order in
   `transaction-receipt.ts`. `deliversAsFullInvoice` stays one function; where a query needs its SQL
   form, one test holds the two to the same answer.
8. **Line drift** (F6 "Plan-versus-code facts"): `recordCorrection` ends at `backend.ts:626`; the
   backlog's A1407 entry and probe entry moved; RD 1619/2012 art. 6.1.d is not quoted in the A663
   plan (6.1.e is). The FAQ's operation-date sentence sits under R1 to R3, not R4: Decision 2 rests
   on AEAT's "Rx" worked example.
9. **Order:** Task 1, Task 2 (remedy behind the switch, words, docs), Task 2b (print the original
   at issue), Task 3a (server typing, layout, real-day row, delivery sites), Task 3b (till view),
   Task 4 (export pin).

**Task 2b — print the issued replacement once as an original.** Files: `packages/module/src/module.ts`
(an optional `printIssuedCorrective?(tx, saleId, printerId): Promise<void>` on the route context);
`apps/server` where the module context is built (wire it to `readTransactionReceipt` +
`enqueueOriginalReceipt` with that printer, refusing a printer that is not an active receipt
printer as `management.request_invalid` `field: "printerId"`); `record-remedy-replacement.ts` (read
an optional `printerId`, a UUID when present, and call the hook after the corrective is issued);
`dashboard/fiscal-filing-screen.ts` (a printer field in the replace form, from
`GET /management-api/orders/printers` or a receipt-printer list the screen already reads; none:
the field is hidden); guide EN/ES one sentence ("Waitron prints the new invoice on the printer you
choose; later prints are copies"). Failing tests first: the route with a printer leaves one
`print_jobs` row for the corrective with `receiptCopy` false; a later
`POST /api/transactions/:saleId/reprint` adds a copy; without a printer no job and the case is still
resolved; an unknown printer id refuses and issues nothing (no number used). The screen posts the
chosen `printerId`. Size: about 60 production lines, 180 test lines.

**Correction 2 replaced, 2026-11-15 (watcher, 04:54-stamped answer to lane L's DEVIATION): take the
smaller way.** No printer choice in the dashboard dialog and no print at issue. Instead a
replacement corrective's FIRST print, from a till's transaction view
(`POST /api/transactions/:saleId/reprint`), is the original (`enqueueOriginalReceipt`, not
`enqueueReceiptCopy`), and every later print is a copy. One original exists; the rest say duplicate.
The success message after **Put this right** says where to print the original, in English and
Spanish, and the guide says the same. This replaces correction 2 and the Task 2b text above; the
first build of Task 2b (printer in the dialog, `fe04859713`) was dropped unpushed.

**As built, 2026-11-15 (finish-branch review).** Correction 3 is narrower than written: a
corrective refused with code `1100` is still offered a correction record; only one refused for a
future date (`1112`) has no fix. Correction 6's alert bullet: `alert-sources.ts` had no
`isNull(sales.correctsSaleId)` lines; it now filters through `deliversAsFullInvoiceSql()`, and its
test prints the original from a till reprint (`transaction-receipt-api.test.ts`).

## Words used in this plan

- **Full invoice (F1)**: an invoice that names the customer (tax number, name, address). The
  ordinary restaurant ticket is a **simplified invoice (F2)** and names nobody. An **F3** is a full
  invoice issued later in exchange for tickets.
- **Corrective invoice**: a new invoice, numbered from the venue's corrective series, that corrects
  an earlier one. AEAT types it **R5** when it corrects a simplified invoice and **R1 to R4** when it
  corrects a full one, by cause (above). It is either **by differences** (`TipoRectificativa` "I",
  only the change) or **by replacement** (`TipoRectificativa` "S", the invoice's whole correct
  amounts in its place, plus `ImporteRectificacion`, the amounts it takes out of AEAT's count).
- **AEAT code `1112`**: AEAT refused a record because its issue date is in the future (the till's
  clock was ahead). **`FechaOperacion`**: the date the sale really happened, filed when it differs
  from the invoice's own date.
- **Record, fingerprint (*huella*)**: each invoice becomes an append-only row in
  `registros_facturacion`, chained by a hash over a few of its fields.
- **Filing case** and **Put this right**: the Fiscal filing page lists each refused record as a case;
  **Put this right** is the administrator's fix, the `replacement-invoice` remedy #3235 built.

## What #3235 built, and what stops a full invoice today

#3235 (with #3208) puts right a refused **simplified** invoice: `recordReplacement`
(`packages/core/src/record-replacement.ts`) copies the original's total, VAT split and lines into a
new corrective sale (`replaces_original` true, `supply_day` = the real day), and
`VerifactuBackend.recordCorrection` (`packages/fiscal-verifactu/src/backend.ts:503-610`) files it as
`TipoFactura` "R5", `TipoRectificativa` "S", `FacturasRectificadas` naming the refused invoice,
`ImporteRectificacion` `{ BaseRectificada: "0.00", CuotaRectificada: "0.00" }` (owner's answer A:
AEAT holds nothing for a refused original), and `FechaOperacion` the real day when it differs from
the replacement's own date (answer B) **(read)**. The VAT return buckets the replaced sale by
`coalesce(repl.supply_day, filed date)` (`packages/reporting/src/vat-return.ts:35-44`) **(read)**.

A full invoice is stopped in four places **(read)**, three of them pinned by tests **(run)**:

| Where | What it does | Test |
| --- | --- | --- |
| `record-replacement.ts:105`, `requireSupportedCorrection` (`correction-eligibility.ts:5-9`) | refuses any original with a customer tax number, `sale.correction_unsupported` | `record-replacement.test.ts:412` "refuses a full invoice": `Tests 1 passed \| 20 skipped` |
| `record-replacement.ts:204` | hands the backend `counterparty: null` | — |
| `backend.ts:537-551` (`replacesRefusedF2`) and `:573` | refuses a replacement unless the original is an F2; files only `TipoFactura: "R5"` | `backend.test.ts` and `put-right.test.ts`, `-t "full invoice\|F1\|full-invoice"`: `Tests 9 passed \| 118 skipped` |
| `record-remedy-replacement.ts:56-59` (`admits`) and `put-right.ts:27-31` | the remedy admits only `tipoFactura === "F2"`; the page answers "a full invoice needs a corrective invoice Waitron cannot issue yet" for F1 and F3 | `record-remedy-replacement.test.ts:310` "refuses a full invoice" (read, not run) |

**F3 is out, because none can exist.** `git grep -n "recordSubstitution" -- apps packages scripts
bench | grep -v "\.test\.ts:"` **(run)** prints core's own definition and export
(`packages/core/src/record-substitution.ts:58`, `index.ts:15`), the backends' implementations, error
comments, and `apps/server/src/start-clock-gate.ts:13`, which names the method in the list of
writers the start's time check wraps. No route, job or script calls it, so no F3 is ever issued at
a venue. This plan leaves an F3 case on the page's generic "Waitron cannot put this one right yet".

**The claim this plan corrects.** `packages/fiscal-verifactu/src/errors.ts:312-319` says "Rectifying
an `F1` is an `R1`". That holds for a money change (a refund or discount: R1 per the FAQ above) and
is wrong for a wrong date (R4). Task 1 rewrites it to say the type follows the cause. The test name
`backend.test.ts:486` ("refuses to correct a full invoice (F1), which would need an R1 (deferred)")
is about a by-differences correction, a money change, so it stays as it is.

## Decisions (this plan's; the owner sees them in the PR)

1. **R4 "S"**, from the sources above (watcher's default, 2026-11-14 22:51).
2. **Same amounts rules as the simplified replacement**: rectified amounts 0.00 / 0.00 and the real
   day as `FechaOperacion`. This carries the owner's answers A, B, C and E over from the
   simplified-invoice replacement, an inference this plan makes and nobody has confirmed (Still
   open 4). What supports it: AEAT's worked examples write «Tipo Factura: Rx» for both options
   (FAQ, «¿Cómo registra el emisor una factura rectificativa por sustitución "S"?») **(read)**.
3. **The same customer, copied, never typed in.** The replacement's sale row copies the original's
   six `counterparty_*` columns and the recipient's address, for the printed copy. The record's
   `Destinatarios` is the refused original record's own stored `destinatarios`, copied as it is
   (`registros_facturacion.destinatarios`, `packages/fiscal-verifactu/src/schema/registros.ts:84`,
   decoded by `decodeRegistroRow`, `registro-row.ts:340`), not rebuilt from the sale's columns
   through today's identifier checks (`buildDestinatarios`, `backend.ts:781-797`), so it is the
   customer AEAT was sent, byte for byte. The browser sends no customer detail. A wrong customer is
   a different correction and not in scope.
4. **The issuer's domicile is today's**, read from `taxpayer` and refused
   `fiscal.taxpayer_domicile_missing` before a number is used when blank, as `recordSale` does for
   a full invoice (`packages/core/src/record-sale.ts:259-266`) **(read)**: the replacement is a new
   invoice issued today.
5. **A later refund of a replaced full invoice stays refused**, as every refund of a full invoice
   is today: core's `requireSupportedCorrection` refuses the replacement (it carries the customer),
   `correction-admission.ts:56-60` answers `not_simplified` for an R4, and the backend's
   by-differences path accepts only an F2 or an R5 "S" (`backend.ts:533`, `:542-544`) **(read)**.
   Task 1 pins that an R4 "S" is never corrected by an R5 "I". So the owner's answer D (a later
   refund's credit note names the replacement) is **not** carried over to a full invoice.
6. **No schema change, no migration, no venue reset.** The counterparty columns already exist on
   every `sales` row (`packages/db/src/schema/sales.ts:104-114`); the only database rule about them,
   `sales_recipient_identity_insert` (`packages/db/triggers/core.sql:530-542`), checks that an
   identifier type comes with its country and a tax number, whatever the sale **(read)**.

## Scope and non-scope

In scope: the R4 "S" writer (core and Veri\*Factu backend); the remedy admitting an F1; the case
dialog's words and the guide (EN, ES); the printed and on-screen copy of an R4, and what every
delivery and document path does with it; a test that pins the accountant export for a replaced full
invoice; the backlog and the claims this retires.

Not in scope (watcher, 2026-11-14 22:51): the refusal hold (gone since #3233 anyway); the VAT
return (it never reads the customer, `packages/reporting/src/vat-return.ts:29-63`, and #3235's
2 March / 28 February case already covers `supply_day`); clocks running behind; F3; any by-differences correction of a full invoice (R1); emailing
or A4 delivery of the replacement (Still open 3); any AEAT call. The R4 "S" test-service probe joins
the go-live probe entry #3235 added (`docs/backlog.md:373-377`, "Probe a replacement R5 "S" on
AEAT's test service") — Task 2 widens that entry; it is not run here.

**CLAUDE.md §5 is unchanged.** Its "Nothing EXTERNAL may block a sale" entry already states the
`1112` handling since A1420 PR 2 (#3233, `CLAUDE.md:914-923`, `:957-975`) **(read)**: a refusal for
a future date sends a box whose time service is not synchronised back to waiting once, and never
holds later records. This plan adds an administrator's corrective, filed through the outbox like
any record; it stops nothing and waits on nothing external.

## What AEAT's own rules check, run against the library

A throwaway script (temp directory, deleted afterwards) built five records with
`@waitron/verifactu` 0.2.1's `buildAltaRecord`, validated each with `validate`, and hashed each
with `computeHuella` **(run)**. Same base (rectified 0.00 / 0.00, `FechaOperacion` a day before the
refused invoice's date, one 10% line):

| Record | Validation issues | Fingerprint (first 12) |
| --- | --- | --- |
| R4 "S" with `Destinatarios` | none | `9C01BB7EDA4A` |
| R4 "S" without `Destinatarios` (control) | `DESTINATARIOS_REQUIRED` | `9C01BB7EDA4A` |
| R4 "S" without `ImporteRectificacion` (control) | `IMPORTE_RECTIFICACION_REQUIRED` | `9C01BB7EDA4A` |
| R5 "S" with `Destinatarios` (control) | `DESTINATARIOS_FORBIDDEN` | `D3B0C56A304F` |
| R1 "S" with `Destinatarios` | none | `B5702A05B319` |

So: an R4 must name the customer and an R5 must not (the library cites AEAT validation 3.1.3.13,
`validate.js:756-764`) **(read)**; the customer and the rectified amounts do not enter the
fingerprint, while `TipoFactura` does, as it always has (`buildCadenaAlta`); and the library accepts
R1 too, so it does not decide R4 against R1 — the sources above do.

## Protected files this plan touches, and why (the owner must see this)

- **`VerifactuBackend.recordCorrection`** (`packages/fiscal-verifactu/src/backend.ts:503-610`), an
  alta builder. Task 1 changes exactly this: the replacement gate admits an F1 original as well as
  an F2 (same "AEAT refused every record of it, none with `3000`" check, `refusedEveryRecordOf`);
  `TipoFactura` becomes "R4" when the original is an F1 and stays "R5" otherwise; an R4 carries
  the original record's stored `destinatarios` as its `Destinatarios` (the select of the original
  at `:516-526` gains that column); the replacement is refused
  `fiscal.correction_unsupported` when the original is an F1 and `sale.counterparty` is null, or
  an F2 and it is not. `ImporteRectificacion`, `FechaOperacion`, `FacturasRectificadas`, the
  by-differences branch, `appendToChain`, `envios` and the QR are as today.
- **`packages/fiscal-verifactu/src/registro-row.ts:142-144`**: the rule that only an R5 "S" may
  carry `FechaOperacion` becomes "only an R4 or R5 by replacement".
- **`recordReplacement`** (core): copies the customer and passes it on (Task 1). `recordSale`,
  `recordCorrection` (core) and `recordSubstitution` are not touched.
- **Not touched:** `computeHuella`, `appendToChain` and the chain, `allocateInvoiceNumber`,
  `registros_facturacion`'s schema and triggers, the `FiscalBackend` contract (its `sale.counterparty`
  already carries a customer, `packages/fiscal/src/backend.ts:85-114`). The golden fingerprint test
  `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `inmutabilidad.test.ts`,
  `correction-amount.huella.test.ts` and #3208's `correction-form.test.ts` pass **unedited** after
  every task.

## Order and pull requests

One pull request, branch `feat/a1407-full-invoice-replacement` from `main`, five tasks in order
(1, 2, 3a, 3b, 4), one implementer each. Until Task 2, nothing in production reaches the R4 path: the remedy still
admits only an F2. **The PR description must open with these lines:**

- Fiscal; files a new record type, an R4 by replacement ("S"); no schema change and no venue reset.
- Go-live gate: the adviser's answer to S14 (may correctives of full invoices, R4, share one series
  with correctives of simplified invoices, R5?) is needed before the first real R4 is filed. This PR
  numbers R4 from the same `rectificative` series as R5, against our own research's reading
  (Still open 1).

---

## Task 1 — the writer files an R4 "S" naming the same customer

Files: `packages/core/src/record-replacement.ts` (drop the `requireSupportedCorrection` call at
`:105`; read the original's six `counterparty_*` columns and `counterparty_address`; when there is a
tax number, read today's `taxpayer.taxpayer_domicile` and refuse `fiscal.taxpayer_domicile_missing`
if blank, before `allocateInvoiceNumber`; write them on the replacement's row in `insertSale`; pass
`counterparty` to the backend instead of `null`); `packages/core/src/counterparty.ts` (a small
`storedCounterparty(row)` that rebuilds a `Counterparty` from those columns, the identifier pair
only when present); `packages/core/src/errors.ts:55` (the comment on `sale.correction_unsupported`
now says it is the by-differences path that refuses a full invoice);
`packages/fiscal-verifactu/src/backend.ts` (as under "Protected files": `OriginalAltaForCorrection`
gains `destinatarios`, read and decoded with the original; the comment at `:115-121` says F1 → R4
by replacement); `registro-row.ts:142-144`; `errors.ts:312-319` (the R1 claim
corrected: the R-type follows the cause, R4 for a wrong date and R1 for a money change, citing the
FAQ).

Failing tests first:

1. `packages/core/src/record-replacement.test.ts:412`, "refuses a full invoice", is **rewritten on
   purpose** (the behaviour changes) to "replaces a full invoice, naming the same customer": the
   replacement row's six counterparty columns and address equal the original's, its
   `taxpayer_domicile` is today's taxpayer row, `supply_day` is stored, and a spy on
   `backend.recordCorrection` received `sale.counterparty` equal to the original's (identifier pair
   included for a foreign customer, one case). Fails today: `sale.correction_unsupported`. Plus
   "refuses a full invoice when the business has no registered address", using no number: assert
   `fiscal.taxpayer_domicile_missing` and that the rectificative series' next number is unchanged.
2. `packages/fiscal-verifactu/src/backend.test.ts`, beside "files one R5 by replacement…" (`:688`):
   - "files one R4 by replacement naming the original's customer": a refused F1 (recorded with
     `recordSale` and a counterparty, delivery `rechazado` with `1112`), replaced with a later day
     and an earlier operation date → one row with `tipo_factura` "R4", `tipo_rectificativa` "S",
     `importe_rectificacion` 0.00 / 0.00, `fecha_operacion` the day given, `facturas_rectificadas`
     naming the F1, and `destinatarios` **equal to the original row's `destinatarios`**;
     `validate(fromRegistroRow(row))` is `[]`; `serializeEnvio` contains
     `<sf:TipoFactura>R4</sf:TipoFactura>` and the customer's `NIF`. The assertion that fails if the
     behaviour is deleted: `tipo_factura` "R4" and the `destinatarios` equality. One more case pins
     the copy: an original whose stored `destinatarios` differs from what `buildDestinatarios` would
     make of the sale's columns today (seed the sale row's name differently from the record's) →
     the R4 carries the record's, not the row's. Fails today:
     `fiscal.correction_unsupported` with `tipoFactura: "F1"`.
   - "refuses an F1 replacement handed no customer, and an F2 replacement handed one, recording
     nothing" (both `fiscal.correction_unsupported`; count of `registros_facturacion` unchanged).
   - "refuses an R4 replacement of a full invoice AEAT accepted, and records nothing" (the
     `refusedEveryRecordOf` gate, as `:784` for an F2).
   - "refuses a by-differences correction of an R4 by replacement, and records nothing": after the
     R4 above, `recordCorrection(…, { correctsSaleId: replacedSale })` with a negative total →
     `fiscal.correction_unsupported`, `tipoFactura: "R4"`. This passes on its first run once the R4
     exists; it pins Decision 5. Mutation check: let `replacement` at `:533` accept any "S" and see
     it fail, then restore.
   - The existing "files one R5 by replacement…" and "refuses to correct a full invoice (F1)…" pass
     unedited.
3. `packages/fiscal-verifactu/src/correction-admission.test.ts`: an R4 "S" alta answers `{ eligible: false, reason: "not_simplified" }`.
   Passes on its first run (characterisation); it pins Decision 5 for the till's refund screen.

Commands: `pnpm --filter @waitron/core exec vitest run src/record-replacement.test.ts
src/record-correction.test.ts src/correction-history.test.ts`; `pnpm --filter
@waitron/fiscal-verifactu exec vitest run --project node src/backend.test.ts
src/correction-admission.test.ts src/registro-row.roundtrip.test.ts src/correction-form.test.ts
src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/correction-amount.huella.test.ts
src/record-remedy-replacement.test.ts` (the last must still pass: the remedy still refuses an F1
until Task 2). Guards (root): `pnpm exec vitest run scripts/errors-reachable.test.ts
scripts/write-path-tables.test.ts scripts/corrective-sums.test.ts`. If anything here would change
what enters the fingerprint beyond the `TipoFactura` value, stop and write it to the watcher.

Size: about 70 production lines, 300 test lines.

## Task 2 — Put this right offers it for a full invoice; words and guide

Files: `packages/fiscal-verifactu/src/record-remedy-replacement.ts:56-59` (`admits` takes
`tipoFactura` "F1" or "F2"; the doc comment at `:20-23` names both types);
`packages/fiscal-verifactu/src/put-right.ts:27-31` (an F1 `1112` case answers
`{ kind: "replacement-invoice" }`; an F3 falls to `NOT_YET`; the `"full-invoice"` reason is removed
from `PutRight`); `remedy-refusals.ts` (`"fiscal.taxpayer_domicile_missing": 409`);
`dashboard/put-right-words.ts` (its sentence); `dashboard/strings.ts` EN and ES:
`fiscal_filing.cases.future_date` (`:236-237`, `:615-616`) says "an invoice", not "a simplified
invoice"; `put_right.replace.intro` (`:264-265`, `:644-645`) gains a full-invoice twin chosen by
`record.tipoFactura` ("AEAT refused this full invoice because its date was in the future. Give the
day the sale really happened, and Waitron issues a replacement corrective invoice for it, naming
the same customer."); `put_right.none.full-invoice` (`:282-283`, `:662-663`) deleted; a new
`fiscal_filing.refused.taxpayer_domicile` ("The business has no registered address, which a full
invoice must show. Enter it in Venue settings, then send again."; Spanish twin);
`dashboard/fiscal-filing-screen.ts` (picks the intro by type); `apps/server/src/guide/en/fiscal-filing.md:40-43`
and `es/fiscal-filing.md:42-47` ("a simplified invoice" → "an invoice"; one clause that a full
invoice's replacement names the same customer).

Failing tests first:

- `record-remedy-replacement.test.ts:310`, "refuses a full invoice", is **rewritten on purpose** to
  "replaces a full invoice with an R4 'S' naming the same customer, and resolves the case": 200,
  one record of `tipo_factura` "R4" whose `destinatarios` equal the original's, the case resolved.
  Fails today: 400 `fiscal.remedy_invalid`. Plus "refuses an exchanged ticket (F3)" →
  `fiscal.remedy_invalid` (built with `backend.recordSubstitution` directly, as a test may).
- `put-right.test.ts:51` (`it.each(["F1", "F3"])` "names the full-invoice corrective") is split: F1
  `1112` → `{ kind: "replacement-invoice" }`; F3 `1112` → `{ kind: "none", why: "not-yet" }`.
  Fails today: F1 answers `full-invoice`.
- `fiscal-filing-screen.test.ts:971` ("says a full invoice needs a corrective Waitron cannot issue
  yet") is rewritten: an F1 `1112` case shows **Put this right** with the full-invoice intro, and
  **Send** posts `kind: "replacement-invoice"` with the `registroId` and `operationDate`, no customer
  field and no amount. Fails today: the not-yet sentence. A `fiscal.taxpayer_domicile_missing`
  answer shows its sentence in the bottom message.
- `record-remedy-replacement.test.ts`: "refuses a full invoice when the business has no registered
  address": blank `taxpayer.taxpayer_domicile`, an F1 `1112` case → 409
  `fiscal.taxpayer_domicile_missing`, no number used, case still open. Fails today: 400
  `fiscal.remedy_invalid` (the F1 is refused first). `put-right-words.ts`'s `REFUSAL_WORDS` is
  typed `Record<RemedyRefusal, …>`, so the compiler, not a test, makes the new code need a
  sentence; `record-remedy-routes.test.ts:180-190` scans only the correction-record files and does
  not see this path.

Commands: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
src/record-remedy-replacement.test.ts src/put-right.test.ts src/record-remedy-routes.test.ts`;
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser
src/dashboard/fiscal-filing-screen.test.ts src/dashboard/fiscal-filing-screen.a11y.test.ts`
(browser: check `memory_pressure | grep free` first, CLAUDE.md §4); `cd apps/server &&
pnpm exec vitest run src/guide-content.test.ts src/fiscal-remedy.staff-refund.test.ts`; root
`pnpm exec vitest run scripts/guide-links.test.ts scripts/dashboard-browser-purity.test.ts
scripts/english-only.test.ts`. Open the dialog for an F1 case and look, both themes and phone width.

Docs, same task: `docs/backlog.md` A1407 (`:1781`) keeps only what remains (AEAT's
`TimestampPresentacion` is read but not stored) and drops the sentences this retires ("no corrective
writer files one yet", "`computeVatReturn` counts a full invoice in its issue date's period");
A1089 (`docs/backlog.md:224` and `docs/backlog/self-service-refusals.md:968`) says "an invoice AEAT
refused for a future date"; the probe entry (`docs/backlog.md:373-377`) gains "and an R4 'S'
replacing a full invoice refused the same way, naming the same customer" and a second go-live gate:
"answer adviser question S14 (one corrective series for R4 and R5?) before the first real R4 is
filed"; `docs/backlog/fiscal.md:1140-1145`
and the A444 exception line (`:1114-1116`) gain a dated line naming the R4 "S".

Size: about 50 production lines, 40 lines of words, 10 of guide prose; 220 test lines.

## Task 3 — the printed and on-screen copy of an R4, and every path that reads the customer

A full invoice must show the customer's tax number, name and address (RD 1619/2012 art. 6.1.d and
6.1.e, quoted in [2026-10-15-a663-receipt-layout.md:209-212](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a663-receipt-layout.md)) **(read)**, and
the R4 is filed as one (it carries `Destinatarios`). Today every corrective prints with
`invoiceType: "R5"` (`apps/server/src/transaction-receipt.ts:158-168`), and the paper layout treats
anything but "F1" as simplified (`receipt-document.ts:157`), so an R4 would print with no customer
block **(read)**. The customer would already reach the result: `transaction-receipt.ts:170-183`
adds `recipient` from the sale's own counterparty columns, which Task 1 now fills. The A4 page is
built from the same document (`invoice-page.ts:124` calls `buildReceiptDocument`), so the layout
change carries to it.

**Until now "the sale has a customer tax number" meant "a full invoice", because no corrective
carried a customer.** After Task 1 an R4 does, so every place that decides by that column needs a
decision. The list is `git grep -n "counterpartyTaxId\|counterparty_tax_id" -- apps packages
':!*.test.ts' ':!**/testing/**'` **(run)**, with the schema, migration, demo fixtures and the
writers left out. Each decision follows Still open 3's default: **in this PR an R4 is reprinted on
the receipt printer only; it is not emailed, not sent as an A4, and no delivery of it is
tracked.** That describes what this task builds, not today's code: today the delivery code would
treat an R4 as a full invoice and offer it all of those (table below).

One shared predicate does the work: `deliversAsFullInvoice(row)`, true when the sale has a customer
tax number **and** `corrects_sale_id` is null, in `apps/server/src/invoice-selection.ts` beside
`storedRecipientIdentifier` (with an SQL twin where a query filters). "A corrective skips this"
below means the site uses the predicate, so an R4 is handled exactly as an R5 replacement is today.
Each site's line was read **(read)**; none was run.

| Site | What it does today | Decision |
| --- | --- | --- |
| `invoice-delivery-status.ts:154`, `:186-190` | a sale with a customer gets a delivery state, page-printer offers and email | a corrective skips this: an R4's state is `null`, as an R5's |
| `document-printer-offers.ts:118`, `:127-129` | `full = recipient !== null`; A4 and page printers accepted | a corrective skips this: receipt only; asking for the invoice document refuses `management.request_invalid` (`field: "document"`), as for an R5 |
| `invoice-delivery.ts:48-55` (`reserveInvoiceDelivery`) | a sale with a customer may reserve receipt, A4 or email deliveries | a corrective skips this: receipt and A4 refuse `invoice_delivery.full_invoice_required`, as for an R5 |
| `invoice-print.ts:48-82` (reprint) | a sale with a customer opens an invoice delivery on reprint | a corrective skips this: a plain resend, which then agrees with `receipt-print.ts:392`, which already checks the type and so skips an R4 |
| `alert-sources.ts:618`, `:634` | an undelivered sale with a customer is an "undelivered full invoice" alert candidate | a corrective skips this (`isNull(sales.correctsSaleId)` beside each `isNotNull`): no alert for an R4 |
| `invoice-document.ts:63`, `:150-160` (A4 and email document) | types any sale with a customer "F1", even one with a corrective's number | type it R4: the same typing helper as `transaction-receipt.ts` (`invoiceType` "R4" and `corrects` with `inFull`), so the document says what was filed. `:63` stays: the R4 has a customer, and the customer's data download (next row) needs its PDF |
| `invoice-customer-data.ts:55`, `:77` (A980 S3: a customer's own data download) | lists and renders every sale naming the customer's tax number | keep: an R4 names the customer, so it belongs in their download, rendered through `invoice-document.ts` as an R4 |
| `transaction-receipt.ts:160-183`, `receipt-issuer.ts:26` | type and recipient of a reprint | type it R4 (this task's main change); `receipt-issuer.ts` answers "F1" for any customer and `transaction-receipt.ts` overrides it for a corrective, so it is left alone |
| `receipt-adjustments.ts:58`, `:92` | net prices per line for a sale with a customer | keep: the R4 prints in the full layout |
| `receipt-guests.ts:62-69` | guest count only on a sale without a customer | keep: no guest count on a full layout |
| `find-bill-transactions.ts:55`, `:74` | types a sale with a customer `full-invoice` | none needed: `replaces_original` is tested first (`:53`), so an R4 is typed `replacement` |
| `invoice-lookup-api.ts:47` | full-invoice search | none needed: it already requires `corrects_sale_id` null (`:49`) and series purpose `full` |
| `orders-list.ts:173-215`, `:473`, `:948-1015` | a bill row's and its own sale's type | none needed: they read the bill's own sale; the replacement is listed as `kind: "replacement"` |
| `deferred-close.ts:436`, `deferred-payment-export.ts:58` | the deferred bill's own sale | none needed: an R4 is never a deferred closure's sale |
| `till-api.ts:2366`, `:2409` | the receipt of a bill's sale | none needed: found by `working_order_id`, which a replacement does not have |
| `invoice-choice-delivery.ts:75` | the bill's staged delivery choice | none needed: joins the working order, which a replacement does not have, so it answers `false` |
| `accountant-export.ts:209` | customer columns per row | keep: the replacement's row shows the customer (Task 4) |
| `packages/core/src/*` | the writers and refusals | Task 1 |

Files: `apps/server/src/transaction-receipt.ts` and `invoice-document.ts` (a corrective whose sale
names a customer reads `invoiceType: "R4"` with `corrects`, through one shared helper);
`invoice-selection.ts` (`deliversAsFullInvoice`); the five "a corrective skips this" sites above;
`apps/server/src/till-sale.ts:340` and `apps/till/src/api/client.ts:1026` (the union gains "R4");
`apps/server/src/receipt-document.ts` (`simplified` is F2 or R5; the full layout's heading block
prints `correctiveInvoice`, "Replaces invoice … in full" with its number and date, and the 0,00 €
rectification row when `corrects` is set, reusing the three labels A802 slice 5a and #3208 added,
so no new words); `apps/server/src/invoice-email.ts:77-83` (title `correctiveInvoice` for R4 too);
`apps/till/src/screens/till-ticket-view.ts` (one local `full = invoiceType === "F1" ||
invoiceType === "R4"` for the LAYOUT sites only: `:243`, `:1240`, `:1293`, `:1306-1354`). The
till's delivery and document-choice sites (`till-ticket-view.ts:682-770`, `:1102-1132`,
`:1475-1506`, `apps/till/src/till-app.ts`, `settlement-document-dialog.ts`) compare with "F1" and so
already treat an R4 like an R5; they are left alone. Found with `git grep -n 'invoiceType [!=]==
"\(F1\|F2\|R5\)"'` **(run)**. `till-ticket-view.ts:1204`'s "Full invoice" banner stays F1-only;
the corrective heading takes its place.

Failing tests first:

- `apps/server/src/receipt-issuer.test.ts:174-195` gains a case: a replacement whose sale names a
  customer reads `invoiceType` "R4", `recipient` equal to the original's, and `corrects.inFull`.
  Extend `testing/replacement-fixture.ts`'s `insertCorrective` to copy the original's counterparty.
  Fails today: "R5".
- `apps/server/src/receipt-document.test.ts` (beside `:1593-1650`): an R4 at 80 mm and 58 mm, in
  English and Spanish, prints the customer block, the rate column, "Corrective invoice", "Replaces
  invoice … in full" with the original's number and date, and the 0,00 € row; the existing R5
  replacement case passes unedited. Fails today: no customer block.
- `apps/till/src/screens/till-ticket-view.test.ts` (beside `:3401-3437`): an R4 result shows the
  recipient section and the replacement lines, and offers no invoice (A4) choice. Fails today: no
  recipient section.
- **The delivery default, one assertion per site** (each fails today, because Task 1 gave the R4 a
  customer, and each fails again if its site's predicate is removed):
  `invoice-delivery-status.test.ts`: the R4's delivery state is `null` while its original keeps its
  own; `document-printer-offers.test.ts`: for the R4, `document: "receipt"` offers receipt printers
  and `document: "invoice"` refuses `management.request_invalid`; `invoice-delivery.test.ts`:
  reserving an `a4` or `receipt` delivery for the R4 refuses `invoice_delivery.full_invoice_required`;
  `invoice-print-api.test.ts`: reprinting the R4's job writes no `invoice_deliveries` row;
  `alert-sources.invoice-delivery.test.ts`: a failed R4 print raises no undelivered-invoice alert.
- `invoice-document.test.ts`: the R4's document reads `invoiceType` "R4" with `corrects.inFull`;
  `invoice-customer-data.pdfs.test.ts`: the customer's download includes the R4's PDF. Fails
  today: typed "F1".
- `apps/server/src/invoice-email.test.ts` (if the title is tested there): an R4's caption reads
  "Corrective invoice". Otherwise covered by the type test.

Commands: `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run
src/receipt-issuer.test.ts src/receipt-document.test.ts src/invoice-email.test.ts
src/transaction-receipt-api.test.ts src/receipt-print.test.ts src/invoice-delivery-status.test.ts
src/document-printer-offers.test.ts src/invoice-delivery.test.ts src/invoice-print-api.test.ts
src/alert-sources.invoice-delivery.test.ts src/invoice-document.test.ts
src/invoice-customer-data.pdfs.test.ts src/invoice-customer-data.files.test.ts`; `pnpm --filter @waitron/till exec
vitest run src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.a11y.test.ts`
(browser; memory first). Print an R4 to a file at both widths and look at it, and open the till's
ticket view on one, both themes (CLAUDE.md §4: a page asserted as a string has nothing checking
that it renders). The type change crosses the server–till wire, so run `pnpm --filter @waitron/till
typecheck` and `pnpm --filter @waitron/server typecheck` (a PR tests only changed packages).

Size: about 100 production lines, 380 test lines, the largest task, so it is split before dispatch:
**3a** (server: typing, layout, the delivery predicate and its sites, their tests) and **3b** (the
till's ticket view and its tests), one implementer each.

## Task 4 — the accountant export, pinned for a full invoice

No production change is expected: the export reads the counterparty columns from each row as it
is (`apps/server/src/accountant-export.ts:208-235`) **(read)**. The VAT return gets no new test: it
never reads the customer (`packages/reporting/src/vat-return.ts:29-63`), and #3235's 2 March /
28 February case already covers `supply_day`.

- `apps/server/src/accountant-export.test.ts`: a replaced full invoice, made through
  `recordReplacement`, exports its replacement row typed "Replacement corrective — do not add" with
  the same customer name and tax number as the original's row. Fails before Task 1 (no replacement
  of a full invoice can be made), passes after.

Commands: `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run
src/accountant-export.test.ts src/report-api.accountant-export.test.ts`.

Size: 0 production lines, about 50 test lines.

---

## Sizes

| Task | Production | Tests |
| --- | --- | --- |
| 1 writer | 70 | 320 |
| 2 remedy, words, guide | 50 (+ 40 words, 10 guide) | 250 |
| 3a server: typing, layout, delivery sites | 75 | 260 |
| 3b till ticket view | 25 | 120 |
| 4 accountant export pin | 0 | 50 |
| **Total** | **about 270** | **about 1,000** |

Calibration **(run**, `git show --numstat`**)**: Q37-FIX PR 3 (#3235) was planned at about 345
production and 720 test lines and landed at 616 and 1,322 (docs and the generated migration left
out), about 1.8 times the estimate. On that ratio this PR lands nearer 480 and 1,800. Every task is
meant to finish well under 100 tool calls; an implementer past about 150 stops at a passing point,
commits and hands over.

## Still open (for the watcher; the build follows each default unless told otherwise)

1. **Does an R4 share the corrective series with R5?** The code numbers every corrective from the
   node's one `rectificative` series (`packages/core/src/corrective-series.ts:38-43`;
   `record-remedy-replacement.ts:76`) **(read)**. The rule is that correctives of full invoices need
   a series apart from the full invoices' own (RD 1619/2012 art. 6.1.a and binding ruling V2884-16,
   quoted in `docs/compliance/research/2026-10-09-vat-and-corrections.md:338-348`), which the
   `rectificative` series is. Whether R5 and R1–R4 may share one series is open with the adviser
   (`docs/compliance/asesor-questions.md:392-393`, S14); our own reading leaned against sharing
   (research `:359-362`). A fourth series kind would touch setup, restore and custody
   (`packages/provisioning/src/venue-plan.ts:116`, `:233`; `first-setup-module-context.ts:32`;
   `recover-provisioned-venue.ts:28`; `packages/fiscal-verifactu/src/custodian/custody-state.ts:149`;
   `hour-series-configuration.ts:7`; `initial-paper-candidates.ts:29`; `allocation-identity.ts:69`;
   `packages/db/src/reserved-identity.ts:80`, from `git grep -n '"rectificative"'` **(run)**), well
   past this scope. **Default: share it.** This default goes against our own research
   (`docs/compliance/research/2026-10-09-vat-and-corrections.md` §4.3 bullet d: «art. 7.1.a's
   separation suggests they should not share»); it is chosen for size, not because a source allows
   it. So S14 becomes a go-live gate: the probe entry in `docs/backlog.md` says "answer before the
   first real R4 is filed" (Task 2), and the PR description opens with it. Ask the owner together
   with question 2.
2. **Does the printed R4 show the day the sale really happened?** Art. 6.1.i requires the
   operation date on a full invoice «siempre que se trate de una fecha distinta a la de expedición
   de la factura», and 7.1.c says the same for a simplified one
   ([`2026-10-15-a663-receipt-layout.md:209`](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a663-receipt-layout.md)) **(read)**. The R4 is a full invoice and its real day
   always differs from its issue day when it is filed (otherwise `FechaOperacion` is left out), so
   on its face the regulation asks for it on paper. But the owner decided on 2026-11-12 that no printed invoice carries a separate operation
   date (A444, `docs/backlog/fiscal.md:1099-1116`), and #3235's printed R5 replacement shows none
   (`git grep` of `operationDate|supplyDay` over the receipt code prints nothing **(run)**). **Default:
   not printed, as for #3235's R5**; one answer should cover both, so it is the owner's, asked
   together with question 1.
3. **Does the customer get the R4 by email or as an A4 document?** A full invoice's original goes to
   its customer that way. This plan makes the delivery code skip an R4, so it is reprinted on the
   receipt printer only, as the R5 replacement is (Task 3's table; without that, today's code
   would offer it as a full invoice). **Default: not in this PR**; the administrator reprints it
   from the bill's transactions. The R4 still appears, as a PDF, in the customer's own data download
   (Task 3). If the answer is yes, it is a task of its own: delivery bookkeeping
   (`invoice_deliveries`), the original/duplicate designation, and lifting the five "a corrective
   skips this" sites.
4. **Carrying the owner's simplified-invoice answers over to a full invoice — UNVERIFIED.** The
   answers were given on 2026-11-14 09:50 to "Q37-FIX replacement invoice … five tax choices"
   (`~/waitron-campaign-shared/desk/done/20261114-0001-L-q37-replacement-fiscal.md`), asked about
   the simplified-invoice replacement. This plan carries over exactly: **A** (rectified amounts
   0.00 / 0.00 when AEAT holds nothing for the refused original), **B** (the operation date is the
   original's real date), **C** (the printed copy says "Replaces invoice X in full" and "Amount of
   the rectification: 0,00 €") and **E** as later answered (owner, 2026-11-14 17:20: the VAT return
   counts the sale in its real day's period). It does **not** carry over **D** (a later refund names
   the replacement): a refund of a full invoice stays refused (Decision 5). The answers' wording is
   not specific to simplified invoices, but nobody was asked about a full invoice: applying them is
   this plan's inference. **Default: build on them; the PR names them as carried over, for the
   owner to confirm when landing.**

## Contradictions with the brief

- The brief asks the plan to "retire or correct" the R1 claim in `errors.ts`. It is corrected, not
  retired: R1 is AEAT's type for a money change to a full invoice, so the claim is half right.
- The brief says no remedy exists today because "both correction writers refuse F1/F3 with
  `sale.correction_unsupported`". For the replacement path there are four stops (table above), and
  the Veri\*Factu backend refuses with its own code, `fiscal.correction_unsupported`.
