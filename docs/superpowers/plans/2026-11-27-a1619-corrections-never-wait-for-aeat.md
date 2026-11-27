# A1619 — a correction never waits for AEAT's answer to the original

Status: plan for approval (lane B, 2026-11-27), read against main c6acae0136. Fiscal: the owner
lands it. One question for the owner (D1); the rest are the watcher's to clear.

## What staff can do when it lands

On a receipt or full invoice that AEAT (the Spanish tax agency) has not answered yet, refused, or
whose sending is on hold, on this box's records or another box's, staff can press **Correct
invoice** or **Give money back** and the money goes back on a corrective invoice (a new invoice
that reduces the old one) at once, printed as usual. **Cancel and credit** and **Pay for items**
on a printed bill likewise file their credit at once. Today these either wait ("This receipt is
still being sent to the tax agency… try again in a few minutes"; "The tax agency refused this
receipt… Fiscal filing shows what to do"), or, on a full invoice AEAT refused with no fix, give the
money back with no corrective and list it for the accountant. The one exception I recommend (D1):
a receipt AEAT refused for a future date, while Fiscal filing offers **Send the replacement**,
still waits for that replacement.

The owner's words (27 Nov ~09:14, lane B queue A1619): "In fact, we don't need to wait for a reply
on the old invoice. We can even issue a correction to an invoice that the aeat will never accept".

## What AEAT does with such a corrective (found first, as the brief asks)

Nothing found says a corrective must wait for its original.

- AEAT's developer FAQ v1.3 (4 Dec 2025, `docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf`,
  §17, p.36), on an invoice whose record AEAT refused: «ese RF rechazado no figuraría jamás en los
  sistemas de la AEAT (aunque constaría un rechazo)… dichas situaciones de error se dan por
  solucionadas en este caso cuando se reciba/n correctamente RF de la/s nueva/s factura/s
  rectificativa/s de la factura errónea original (que indicará/n a qué factura está/n
  rectificando)». So: AEAT expects correctives that name an invoice it does not hold, and counts the
  refusal settled once one arrives.
- AEAT's validation rules (`Validaciones_Errores_Veri-Factu.pdf` v1.2.2, §3.1.3 item 4, p.8; fetched
  today, not kept in `sources/`): the whole rule for `FacturasRectificadas` is «El NIF del campo
  IDEmisorFactura debe estar identificado. Sólo podrá incluirse esta agrupación (no es obligatoria)
  si TipoFactura es igual a "R1", "R2", "R3", "R4" o "R5"». I searched the whole text for
  "rectificad" and "exist": no rule checks that the corrected invoice is at AEAT.
- AEAT's test service took a credit naming an invoice it had refused (so held nothing under that
  number) as `Correcto` (verifactu run 37286368370, 2026-10-05; `docs/compliance/verifactu-findings.md`
  §16 and `asesor-questions.md` Q37). Test system only; production not tried, and no run sent a
  corrective before its original arrived later.
- The asesor (tax adviser) answered that a corrective may be issued from another server
  (`2026-11-15-adviser-answers.md`, answer 2.4). Q37 (which remedy fits which refusal) is still open.

## Today (receipts; "ran" = the existing tests named passed on this checkout)

1. **Admission** (`packages/fiscal-verifactu/src/correction-admission.ts`), which Correct invoice,
   Give money back, File now, the automatic finish and Refund a payment's limit all ask through
   core's `previewCorrectionAmounts` (`packages/core/src/correction-history.ts:130-141`):
   - `:82-86` original on another chain, queued or sending → `filing_pending` (A1614, #4471).
   - `:87-90` refused (`rechazado`), held (`detenido`) or set aside (`retenido`) → `filing_refused`,
     except a full invoice refused with no fix on offer → `refused_no_fix`. A refused receipt with
     no fix still waits for ever. Ran: `correction-admission.test.ts` (71 passed with backend.test.ts).
2. **The server**: `invoice-corrections.ts:173-177` (`refusesForGood`) treats `filing_refused` and
   `filing_pending` as waits; `invoice-correction-legs.ts:29-34` (`NEVER_FILEABLE`) lets Finish close
   over `refused_no_fix`; `invoice-correction-alerts.ts:166-169` raises no alert for `filing_pending`.
   Read.
3. **#2973's rule**: the cash step that brings the last money back files in the same transaction
   (`invoice-correction-cash.ts:157-160`); a refused filing undoes the step. For a never-fileable
   reason, earlier legs pass (`invoice-correction-legs.ts:209-215`) but the last is refused and
   undone, and staff Finish (kept by 05817049f0). Read. Ran: `give-back-full-invoice.test.ts:420`
   (refused full invoice: legs unrecorded, Finish lists them for the accountant).
4. **Credits**: `refuseCreditOf` (`packages/fiscal-verifactu/src/backend.ts:486-501`) refuses
   `fiscal.original_refused` for any refused current version and `fiscal.original_unanswered` while
   another chain's version is unanswered or held (`:161-179`). Called for Cancel and credit
   (`apps/server/src/working-order-counter.ts:208`) and Reopen bill / Pay for items on a printed
   bill (`split-after-print.ts:155`). Ran: `cancel-unserved.test.ts:595,632`,
   `split-after-print.test.ts`, `pay-for-items.printed.test.ts` (23 passed).
5. **Nothing was served** (`recordVoid`, a cancellation record, not a corrective) throws the same
   two codes (`backend.ts:534,542`). Not one of the four actions; unchanged (D2).
6. **Why refused originals wait today**: a corrective filed first makes Fiscal filing's
   **Send the replacement** (the fix for a receipt refused for a future date, `1112`) refuse for
   ever: `sale.replacement_not_first` (`packages/core/src/record-replacement.ts:115-120`; the watcher's
   decision, lane L `questions.md` 26 Nov 16:37, recorded in `docs/backlog/fiscal.md:1266-1270`).
   The description fix (`1100`) is a correction record of the same invoice and does not look at
   correctives (`record-remedy.ts:174-198`), so it has no such conflict.
7. **Voided and replaced originals** (unchanged): a cancelled invoice answers `voided`
   (`correction-admission.ts:58-60`): its cancellation record says it should never have existed,
   «dicha factura no tendrá ningún efecto fiscal» (FAQ §17 2.d, p.35), so there is nothing to
   reduce. A receipt exchanged for a full invoice answers `replaced`
   (`correction-history.ts:122-129`): the full invoice is the one to correct. A receipt replaced by
   a replacement receipt is corrected through the replacement (`correction-target.ts`).

## The change

1. **Admission** (`correction-admission.ts`): delete the `filing_pending` branch (`:79-86`, and the
   `openSifId` import). Map `rechazado` to `filing: "refused"` and `detenido`/`retenido` to
   `filing: "held"` (D3), eligible. Keep one wait, per D1: a refused original whose open case offers
   `replacement-invoice` (`putRightFor`) answers `filing_refused`; `fixOffered` narrows to that
   kind. `refused_no_fix` and `filing_pending` leave `CorrectionAdmission`
   (`packages/fiscal/src/backend.ts:45-72`, comment included).
2. **Credits**: `refuseCreditOf` asks `correctionAdmissionFor` and throws `fiscal.original_refused`
   only when it answers `filing_refused`; `refuseUnansweredElsewhere` stays for `recordVoid` alone.
   Update the comments naming `refuseCreditOf` (`errors.ts:90-94`, `refused-current-alta.ts:36`).
3. **Server**: `refusesForGood` keeps `filing_refused` as its one wait; drop `refused_no_fix` from
   `NEVER_FILEABLE`; delete `awaitsOriginalAnswer`. **#2973's rule needs no code change**: with
   these invoices admitted, the last cash step files the corrective like any other; the
   refuse-and-undo remains only for `replaced`, `voided` and `not_simplified`, none about AEAT (D4).
4. **No error code is retired**: both `fiscal.original_*` codes stay (Nothing was served, and the
   D1 wait); `filing_pending`/`refused_no_fix` are reasons, not codes. `alert-codes` and
   `errors-reachable` are run, not edited.
5. **Till words** (`apps/till/src/i18n/codes.ts`, EN and ES): delete the `filing_pending` entries
   (`:1147`, `:1537`, `:1553`, `GIVE_BACK_FILING_PENDING`, `giveBackReasonMessage`'s branch) and the
   two `refused_no_fix` entries (`:1138`, `:1529`); reword the four `filing_refused` texts to the one
   case left, gist: "The tax agency refused this receipt's date. An administrator can put it right on
   Fiscal filing with Send the replacement; then try again." Delete `split.refused_receipt_unanswered`
   (`strings.ts:2270,4726`) and its two mappings (`cancel-credit-dialog.ts:109`, `pay-for-items.ts:129`);
   reword `split.refused_receipt_refused` to the date case. No guide words these refusals (searched
   `apps/server/src/guide/` EN and ES for each sentence).
6. **Docs**: dated lines in `docs/backlog/fiscal.md` (`:1190-1206`, `:1266-1272`); dated pointers in
   `docs/compliance/verifactu-findings.md:945-950` and `2026-11-19-adviser-meeting.md:300,466`
   (historical); the FAQ and validation quotes above go in `verifactu-findings.md` §13.

## Tests (each new case fails first)

New, by the assertion that fails if the behaviour were deleted:
- `correction-admission.test.ts`: another chain `pendiente`/`enviando` → `eligible, filing: "queued"/"sending"`;
  F2 refused `1161` → `eligible, filing: "refused"`; `detenido` → `filing: "held"`; F1 refused with
  no fix → eligible with `fullInvoice`; F2 refused `1112` with an open case → `filing_refused`.
- `backend.test.ts` (`refuseCreditOf`): another chain unanswered resolves; refused `1161` resolves;
  refused `1112` with its case open rejects `fiscal.original_refused`.
- Server: Give money back goodwill on a receipt refused `1161` files an R5 naming it
  (`correctivesOf` has one row); after `takeOver` with the original unanswered, File now files at
  once on the new chain; on a full invoice refused with no fix, the cash leg that makes up the rest
  files the R1 in that step and the accountant's list has none of its refunds (#2973's change);
  Cancel and credit and Pay for items on a refused `1161` receipt and on another box's unanswered
  one each file a credit.

Changed test checks (each to the new behaviour, at least as strictly; listed in the PR):
`correction-admission.test.ts:160-170,195,205,218,240,245,314,323,345,356,367,381,408`;
`backend.test.ts:576-690` (refuseCreditOf block only); `sale-read-plans.test.ts:120,136` (plan of the
new read); `correction-history.e2e.test.ts:274-281` (`1161` now passes admission; expect the next
refusal); core `correction-history.test.ts:570-596,689-700,745`; `fake-backend.test.ts:423`;
server `invoice-corrections.test.ts:617-625,1036,1569-1610`, `advance-corrections.test.ts:883`
(stub `voided`, still closable, so Close keeps its check), `give-back.test.ts:780,1175-1225`,
`give-back-full-invoice.test.ts:340-460`, `full-invoice-correctives.test.ts:321-350`,
`invoice-correction-api.test.ts:1215-1240`, `give-back-api.test.ts:120`, `cancel-unserved.test.ts:595-665`,
`split-after-print.test.ts:610-670`, `pay-for-items.printed.test.ts:515-560,794`; till `codes.test.ts:89,659-670,1138-1300`,
`give-back-under-way.test.ts:355-460`, `give-back-dialog.test.ts:148-190,2263`,
`cancel-credit-dialog.test.ts:170,658,722`, `pay-for-items.test.ts:223-242`,
`till-app-parties-closing.test.ts:322,1264`, `tender-refund.test.ts:569`, `box-word.test.ts:32`
(point at a path that still exists). Untouched: golden huella, `inmutabilidad`, `drain.test.ts`
(its `original_refused` cases are `recordVoid`'s), every `scripts/` guard.

## Commands

```
packages/fiscal-verifactu: pnpm exec vitest run src/correction-admission.test.ts src/backend.test.ts src/sale-read-plans.test.ts src/correction-history.e2e.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
packages/core: pnpm exec vitest run src/correction-history.test.ts
packages/fiscal: pnpm exec vitest run src/testing/fake-backend.test.ts
apps/server: pnpm exec vitest run src/invoice-corrections.test.ts src/advance-corrections.test.ts src/give-back.test.ts src/give-back-full-invoice.test.ts src/full-invoice-correctives.test.ts src/invoice-correction-api.test.ts src/invoice-correction-alerts.test.ts src/give-back-api.test.ts src/cancel-unserved.test.ts src/split-after-print.test.ts src/pay-for-items.printed.test.ts src/cancel-invoiced-order.test.ts
apps/till: pnpm exec vitest run src/i18n/codes.test.ts src/i18n/box-word.test.ts src/widgets/give-back-under-way.test.ts src/widgets/give-back-dialog.test.ts src/widgets/cancel-credit-dialog.test.ts src/state/pay-for-items.test.ts src/till-app-parties-closing.test.ts src/state/tender-refund.test.ts
root: pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts
```
Each package's `typecheck` and `format:check`.

## Implementer tasks (one PR, about 3–4 hours)

1. **Fiscal seat and core** (change 1–2): `correction-admission.ts`, `backend.ts` (`refuseCreditOf`,
   comments), `packages/fiscal/src/backend.ts`, `errors.ts`, `refused-current-alta.ts`; their tests.
   About 30 production lines (mostly deleted), 150 test lines.
2. **Server** (change 3): `invoice-corrections.ts`, `invoice-correction-legs.ts`,
   `invoice-correction-alerts.ts`; the server tests above. About 15 production lines, 200 test lines.
3. **Till and docs** (changes 5–6). About 60 production lines (mostly deleted), 80 test lines.

No schema change, no venue reset. Two Codex run-it angles (fiscal). Branch
`feat/a1619-corrections-never-wait`.

## Decisions

- **D1 — for the owner.** A receipt AEAT refused for a future date while Fiscal filing offers
  **Send the replacement**: recommended, Correct invoice and the credits keep waiting for that
  replacement (an administrator can send it at once), because a corrective filed first blocks the
  replacement for ever (`sale.replacement_not_first`), leaving the case open with no fix and the
  sale on its wrong date in the VAT return (`docs/backlog.md:1101`). The alternative is the owner's
  words taken literally: admit it too and lose the replacement.
- **D2:** Nothing was served (a cancellation record) keeps refusing a refused or another chain's
  unanswered receipt: not one of the four actions, and a cancellation of a held receipt stops later
  records (`backend.ts:531-533`). Recommended.
- **D3:** an admitted refused or held original reports `filing: "refused"` / `"held"` rather than
  posing as accepted. Nothing reads the field but tests (searched). Recommended.
- **D4:** #2973's refuse-and-undo stays for `replaced`, `voided` and `not_simplified`; the owner's
  27 Nov words are about AEAT's answer, which none of these is. Recommended.
- **D5:** corrections already closed with refunds kept, and refunds already on the accountant's
  list, stay as they are (no venue is live). Recommended.

## Overlap

`gh pr list --state open` today: only #4483 (`feat/correct-full-invoice-cancelled-dish`) touches the
same files (`invoice-corrections.ts`, `invoice-correction-legs.ts`, `correction-history.ts`,
till `codes.ts`, and tests). It reads the same `waiting` answer (`readCorrectableNow`) for a
cancelled dish's money and adds tests pinning `filing_refused` and `filing_pending` on full
invoices (its `give-back-full-invoice.test.ts`). Whoever lands second rebases: if #4483 lands
first, its new `filing_pending` cases change here as the others do. The till redesign PRs (#4453,
#4494, #4495) touch `strings.ts` only; keep both sides.

## Contradicts the queue item

- "Remove the older `fiscal.original_unanswered` wait": the code also guards Nothing was served
  (`backend.ts:534`), so it is removed from the credits only (D2).
- "Admit … refused": conflicts with the replacement fix and with the watcher's 26 Nov 16:37
  decision (item 6 above); hence D1.
