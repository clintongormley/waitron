# A1619 — a correction never waits for AEAT's answer to the original

Status: plan for approval (lane B, 2026-11-27), read against main c6acae0136; revised after fresh
read 1 (no Critical; four Important and eight Minor points, all checked against the code and taken
in). Fiscal: the owner lands it. One question for the owner (D1); the rest are the watcher's.

## What staff can do when it lands

On a receipt or full invoice that AEAT (the Spanish tax agency) has not answered yet, refused, or
is holding back, on this box's records or another box's, staff press **Correct invoice** or **Give
money back** and the money goes back on a corrective invoice (a new invoice that reduces the old
one) at once, printed as usual. **Cancel and credit** and **Pay for items** on a printed bill file
their credit at once too. Today they wait ("This receipt is still being sent to the tax agency…
try again in a few minutes"; "The tax agency refused this receipt… Fiscal filing shows what to
do"), or, on a full invoice AEAT refused with no fix, give the money back with no corrective and
list it for the accountant. This is built as the owner's words say; if the owner picks another D1
option, the plan changes as D1 says.

The owner's words (27 Nov ~09:14, lane B queue A1619): "In fact, we don't need to wait for a reply
on the old invoice. We can even issue a correction to an invoice that the aeat will never accept".

## What AEAT does with such a corrective (found first, as the brief asks)

Nothing found says a corrective must wait for its original. What each source says, narrowly:

- AEAT's developer FAQ v1.3 (4 Dec 2025, `docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf`,
  §17, p.36), case 2.a (an error the invoicing rules make you fix with a corrective) on an invoice
  whose record AEAT refused: «ese RF rechazado no figuraría jamás en los sistemas de la AEAT
  (aunque constaría un rechazo)… dichas situaciones de error se dan por solucionadas en este caso
  cuando se reciba/n correctamente RF de la/s nueva/s factura/s rectificativa/s de la factura
  errónea original». So AEAT expects a corrective that fixes the error to name an invoice it does
  not hold. The FAQ says nothing about a corrective for another reason (money given back as
  goodwill or for a dish) on a refused or unanswered invoice: it neither allows nor forbids it.
- AEAT's validation rules (`Validaciones_Errores_Veri-Factu.pdf` v1.2.2, §3.1.3 item 4, p.8;
  archived at `~/workspace/repos/verifactu/sources/archive/aeat-validation-rules/426eb926….pdf`,
  the same SHA-256 as the copy fetched today): the whole rule for `FacturasRectificadas` is «El NIF
  del campo IDEmisorFactura debe estar identificado. Sólo podrá incluirse esta agrupación (no es
  obligatoria) si TipoFactura es igual a "R1", "R2", "R3", "R4" o "R5"». I searched the whole text
  for "rectificad" and "exist": no rule checks that the corrected invoice is at AEAT.
- AEAT's test service took a credit naming an invoice it had refused, so held nothing under that
  number, as `Correcto` (verifactu run 37286368370, 2026-10-05; `verifactu-findings.md` §16). Test
  system only; production not tried; no run sent a corrective before its original arrived later.
- The asesor (tax adviser): a corrective may be issued from another server (answer 2.4,
  `2026-11-15-adviser-answers.md:93-96`). Q37 was answered by the owner on 11 Nov
  (`asesor-questions.md:3424-3442`): a future date is put right with a corrective, built as the
  replacement (an R5 that replaces the receipt).

## Today (receipts; "ran" = existing tests that passed on this checkout, filtered by name)

1. **Admission** (`packages/fiscal-verifactu/src/correction-admission.ts`), asked through core's
   `previewCorrectionAmounts` (`packages/core/src/correction-history.ts:130-141`) by Correct
   invoice, Give money back, File now, the automatic finish and Refund a payment's limit:
   `:82-86` another chain's original, queued or sending → `filing_pending` (A1614, #4471); `:87-90`
   refused, held or set aside → `filing_refused`, except a full invoice refused with no fix on
   offer → `refused_no_fix`; a refused receipt with no fix waits for ever. On this box's own chain a
   queued or sending original is admitted (`:13-18`). Ran: `correction-admission.test.ts` and
   `backend.test.ts` with `-t "refuseCreditOf|judged by its submission|another node|earlier
   installation|full invoice"`: 71 passed, 113 skipped by the filter (184 in the two files).
2. **Server**: `invoice-corrections.ts:173-177` (`refusesForGood`) waits on `filing_refused` and
   `filing_pending`; `invoice-correction-legs.ts:29-34` (`NEVER_FILEABLE`) lets Finish close over
   `refused_no_fix`; `invoice-correction-alerts.ts:166-169` raises no alert for `filing_pending`. Read.
3. **#2973's rule**: the cash step that brings the last money back files in the same transaction
   (`invoice-correction-cash.ts:157-160`) and a refused filing undoes the step; for a never-fileable
   reason the earlier legs pass (`invoice-correction-legs.ts:209-215`) and the last is refused and
   undone, then staff Finish (kept by 05817049f0). Read.
4. **Credits**: `refuseCreditOf` (`packages/fiscal-verifactu/src/backend.ts:486-501`) refuses
   `fiscal.original_refused` for any refused current version and `fiscal.original_unanswered` while
   another chain's version is unanswered or held (`:161-179`). Called for Cancel and credit
   (`apps/server/src/working-order-counter.ts:208`) and Reopen bill / Pay for items on a printed
   bill (`split-after-print.ts:155`). Ran: `cancel-unserved`, `give-back-full-invoice`,
   `full-invoice-correctives`, `split-after-print` and `pay-for-items.printed` tests with
   `-t "AEAT refused|another box|no fix|unanswered|refused"`: 23 passed, 98 skipped by the filter.
5. **Nothing was served** (`recordVoid`, a cancellation record, not a corrective) throws the same
   two codes (`backend.ts:534,542`). Not one of the four actions (D3).
6. **Why refused originals wait today**: Fiscal filing's **Send the replacement** (the fix for a
   receipt refused for a future date, `1112`) refuses once the receipt has any corrective
   (`sale.replacement_not_first`, `packages/core/src/record-replacement.ts:116-120`), which is why
   the watcher made the credits refuse a refused receipt (lane L `questions.md`, 26 Nov 16:37;
   `docs/backlog/fiscal.md:1266-1270`). The description fix (`1100`) is a correction record of the
   same invoice and does not look at correctives (`record-remedy.ts:174-198`).
7. **Voided and replaced originals** (unchanged): a cancelled invoice answers `voided`
   (`correction-admission.ts:58-60`); its cancellation says it should never have existed, «dicha
   factura no tendrá ningún efecto fiscal» (FAQ §17 2.d, p.35), so there is nothing to reduce. A
   receipt exchanged for a full invoice answers `replaced` (`correction-history.ts:122-129`): the full
   invoice is the one to correct. A receipt with a replacement R5 is corrected through it
   (`correction-target.ts`).

## The change (as D1 option 3, the owner's words)

1. **Admission** (`correction-admission.ts`): delete the `filing_pending` branch (`:76-86`), the
   refused branch, `fixOffered` and the `openSifId`/`putRightFor` imports; any submission state is
   admitted (the column allows only seven, `schema/verifactu-submissions.ts:61`, every one now
   admitted). Delete the `filing` field and its map (D4). `filing_pending`, `filing_refused` and
   `refused_no_fix` leave `CorrectionAdmission` (`packages/fiscal/src/backend.ts:45-72`, comment
   too). The implementation drops `issuingNodeId`; the shared interface keeps it (D5).
2. **Credits**: delete `refuseCreditOf` (interface `packages/fiscal/src/backend.ts:495`,
   `backend.ts:486-501`), `refuseCreditOfRefused` (`cancel-credit.ts:84-93`) and its two calls, and
   the parameters that leaves unused (`refuseSplitBill`'s `issuingNodeId`; `noUnusedParameters`,
   `tsconfig.base.json:9`). `refuseUnansweredElsewhere` stays for `recordVoid` alone; fix the
   comments naming `refuseCreditOf` (`errors.ts:90-94`, `refused-current-alta.ts:36`).
3. **Server**: `refusesForGood` treats no admission refusal as a wait; drop `refused_no_fix` from
   `NEVER_FILEABLE`; delete `awaitsOriginalAnswer`. **#2973's rule needs no code change**: with
   these invoices admitted, the last cash step files the corrective; refuse-and-undo stays only for
   `replaced`, `voided` and `not_simplified` (D6).
4. **No error code is retired**: both `fiscal.original_*` codes stay for Nothing was served; the
   three removed values are reasons, not codes. `alert-codes` and `errors-reachable` are run.
5. **Till words** (`apps/till/src/i18n/codes.ts`, EN and ES): delete the `filing_pending`,
   `filing_refused` and `refused_no_fix` entries (`:1138-1150`, `:1529-1557`),
   `GIVE_BACK_FILING_REFUSED`, `GIVE_BACK_FILING_PENDING` and `giveBackReasonMessage`'s branches;
   delete `split.refused_receipt_refused` and `split.refused_receipt_unanswered`
   (`strings.ts:2268-2271,4724-4727`) and their mappings (`cancel-credit-dialog.ts:108-109`,
   `pay-for-items.ts:127-130`). The Cancel dialog's cancel mode has no entry for these codes
   (`cancel-credit-dialog.ts:81-87`) and shows `codes.ts:657-663`; after the change only Nothing was
   served throws them, and those words ("…so it cannot be cancelled. Take payment.") fit it, so
   they stay. No guide words these refusals (searched `apps/server/src/guide/` EN and ES).
6. **Docs**: dated lines in `docs/backlog/fiscal.md` (`:1190-1206`, `:1266-1272`); dated pointers in
   `verifactu-findings.md:945-950` and `2026-11-19-adviser-meeting.md:300,466` (historical). In
   `verifactu-findings.md` §13 add only the narrow findings above (FAQ case 2.a as quoted, the
   validation rule, the test run), not a claim that the FAQ allows any corrective.

## Tests (each new case fails first)

New, by the assertion that fails if the behaviour were deleted:
- `correction-admission.test.ts`: another chain `pendiente`/`enviando` → `eligible: true` with
  `original`; receipt refused `1161` and `1112` (case open) → eligible; `detenido` → eligible; full
  invoice refused with no fix → eligible with `fullInvoice`.
- Server: Give money back goodwill on a receipt refused `1161` files an R5 naming it
  (`correctivesOf` one row); after `takeOver` with the original unanswered, File now files at once
  on the new chain; on a full invoice refused with no fix the cash leg that makes up the rest files
  the R1 in that step and the accountant's list holds none of its refunds (#2973's change); Cancel
  and credit and Pay for items on a refused receipt and on another box's unanswered one each file a
  credit; then Send the replacement on such a receipt answers `sale.replacement_not_first` (the
  cost D1 names, pinned).

Changed test checks (to the new behaviour, at least as strictly; listed in the PR):
`correction-admission.test.ts:153-245,314,323,345,356,367,381,408`; `backend.test.ts:576-690` and
`sale-read-plans.test.ts:120,136` delete with `refuseCreditOf` (the server credit cases above
replace them); `correction-history.e2e.test.ts:274-281` (`1161` now passes admission; expect the
next refusal); core `correction-history.test.ts:494-500,569-601,633,689-700,729,745`;
`fake-backend.test.ts:420-424`; server `invoice-corrections.test.ts:617-625,1036,1569-1610`,
`advance-corrections.test.ts:883` (stub `voided`, still closable, so Close keeps its check),
`give-back.test.ts:780,1175-1225`, `give-back-full-invoice.test.ts:340-460`,
`full-invoice-correctives.test.ts:321-350`, `invoice-correction-api.test.ts:1215-1240`,
`give-back-api.test.ts:120`, `cancel-unserved.test.ts:595-665`, `split-after-print.test.ts:610-670`,
`pay-for-items.printed.test.ts:515-560,794`; till `codes.test.ts:89,1138-1300`,
`give-back-under-way.test.ts:355-460`, `give-back-dialog.test.ts:148-190,2263`,
`cancel-credit-dialog.test.ts:170`, `pay-for-items.test.ts:223-242`,
`till-app-parties-closing.test.ts:1263-1264`, `tender-refund.test.ts:569`, `box-word.test.ts:32`
(point at a path that still exists). Untouched: golden huella, `inmutabilidad`, `drain.test.ts`
(its `original_refused` cases are `recordVoid`'s), `codes.test.ts:659-670` (Nothing was served's
words), every `scripts/` guard.

## Commands

```
packages/fiscal-verifactu: pnpm exec vitest run src/correction-admission.test.ts src/backend.test.ts src/sale-read-plans.test.ts src/correction-history.e2e.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
packages/core: pnpm exec vitest run src/correction-history.test.ts
packages/fiscal: pnpm exec vitest run src/testing/fake-backend.test.ts
apps/server: pnpm exec vitest run src/invoice-corrections.test.ts src/advance-corrections.test.ts src/give-back.test.ts src/give-back-full-invoice.test.ts src/full-invoice-correctives.test.ts src/invoice-correction-api.test.ts src/invoice-correction-alerts.test.ts src/give-back-api.test.ts src/cancel-unserved.test.ts src/split-after-print.test.ts src/pay-for-items.printed.test.ts src/cancel-invoiced-order.test.ts
apps/till: pnpm exec vitest run src/i18n/codes.test.ts src/i18n/box-word.test.ts src/widgets/give-back-under-way.test.ts src/widgets/give-back-dialog.test.ts src/widgets/cancel-credit-dialog.test.ts src/state/pay-for-items.test.ts src/till-app-parties-closing.test.ts src/state/tender-refund.test.ts
root: pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts
```
Each touched package's `typecheck` and `format:check`.

## Implementer tasks (one PR, about 3.5 hours)

1. **Fiscal seat and core** (changes 1, 2 first half): `correction-admission.ts` (drop its
   `issuingNodeId`; `backend.ts:463-468` stops passing it), `backend.ts`, `packages/fiscal/src/backend.ts`,
   `fake-backend.ts:62`, `correction-history.ts:78`, `errors.ts`, `refused-current-alta.ts`; their
   tests. Typecheck `fiscal`, `fiscal-verifactu`, `core`, `server`. About 50 production lines,
   mostly deleted; 150 test lines.
2. **Server** (change 2 second half, 3): `cancel-credit.ts`, `working-order-counter.ts`,
   `split-after-print.ts`, `invoice-corrections.ts`, `invoice-correction-legs.ts`,
   `invoice-correction-alerts.ts`; server tests. About 30 production lines; 220 test lines.
3. **Till and docs** (5, 6). About 70 production lines, mostly deleted; 80 test lines.

No schema change, no venue reset. If it runs past one PR, cut after Task 2 (the till's words for
the removed reasons are then unreachable, not wrong) and land Task 3 next. Two Codex run-it angles
(fiscal). Branch `feat/a1619-corrections-never-wait`.

## Decisions

- **D1 — for the owner** (question below). Recommended: option 3 now, option 4 as its own item if
  the owner wants the date fix kept.
- **D2:** the watcher's 26 Nov 16:37 rule (credits refuse a receipt AEAT refused, to keep Send the
  replacement possible) is retired under D1 option 3; under options 1 or 2 it narrows to receipts
  refused for a future date while the replacement is offered. Recommended: follow D1.
- **D3:** Nothing was served (a cancellation) keeps refusing a refused receipt and another chain's
  unanswered one: not one of the four actions, and cancelling a held receipt stops later records
  (`backend.ts:531-533`). Recommended.
- **D4:** delete the admission answer's `filing` field. Only core copies it into the preview
  (`correction-history.ts:78`); the preview route spreads it into its answer
  (`invoice-corrections.ts:161`), and nothing in the till or dashboard names it (searched). An alta
  never reaches `retenido` (only cancellations are set aside, `drain.ts:938-944`), so mapping new
  values would describe a state that does not occur. Recommended.
- **D5:** `issuingNodeId` stays on the shared `FiscalBackend.correctionAdmissionFor` (core names it
  six times in `correction-history.ts`; another regime may judge by the issuing box) and leaves only
  fiscal-verifactu's implementation, so the typecheck passes without touching core's callers.
  Recommended.
- **D6:** #2973's refuse-and-undo stays for `replaced`, `voided` and `not_simplified`; the owner's
  words are about AEAT's answer, which none of these is. Recommended.
- **D7:** corrections already closed with refunds kept, and refunds already on the accountant's
  list, stay as they are (no venue is live). Recommended.

### D1, as I would put it to the owner

A table's €50 receipt prints at 23:58 on 31 March while the box's clock runs a day ahead, so the
receipt says 1 April. AEAT refuses it as dated in the future. Today the fix is on Fiscal filing:
an administrator sends a replacement receipt carrying the real day. Waitron cannot send that
replacement once the receipt has any refund on it. So if a guest gets €5 back on that receipt
first, the replacement is no longer possible: the receipt stays refused at AEAT, its case stays
open with nothing to press, and the sale may be counted in April's VAT instead of March's (as
`docs/backlog.md:1101` says of a full invoice). That can happen whatever we choose below, except
option 4, because the €5 can go back while the receipt is still being sent and the refusal arrives
after (true today on the box's own records, `correction-admission.ts:13-18`).

1. **Keep a wait** for a receipt already refused this way: Give money back waits until an
   administrator sends the replacement. It covers only refusals that have already come back.
2. **Give money back sends the replacement first**, asking for the real day and an administrator's
   sign-in in place, then the refund. Same partial cover; its own PR, about 3 hours (a new seat
   method over the case dialog's `applyReplacementInvoiceRequest`, `record-remedy-replacement.ts:26-97`,
   about 50 lines; the server step about 60; the till's day question and sign-in about 120;
   tests about 300). It calls the existing replacement writer; no record builder changes.
3. **Never wait** (your words): simplest, and staff never wait; in this rare case the date fix is
   lost. I believe it is rare: it needs the box's clock ahead after the start-up time check passed.
4. **Let a replacement follow an earlier refund**: the only option that covers both halves. It
   changes core's replacement writer (`record-replacement.ts:116-120`, which wraps the record
   builder `recordCorrection`), and the correction history, which after a replacement reads only
   the replacement's refunds and would then miss the €5 (`correction-target.ts`,
   `correction-history.ts`; about 60 production and 200 test lines). That touches a record builder,
   so it is a stop for this item: its own item, with a run on AEAT's test service first.

Recommended: **3 now, and 4 as its own item if you want the date fix kept.** The wait in 1 and 2
protects only half the cases and makes staff wait; 4 is the real fix and needs its own probe.

## Overlap

`gh pr list --state open` today. #4483 (`feat/correct-full-invoice-cancelled-dish`) touches
`invoice-corrections.ts`, `invoice-correction-legs.ts`, `correction-history.ts`, till `codes.ts`
and `strings.ts`, `docs/backlog/fiscal.md`, and adds tests pinning `filing_refused` and
`filing_pending` on full invoices (`give-back-full-invoice.test.ts`); it reads the same `waiting`
answer (`readCorrectableNow`). Till `strings.ts`: #4450, #4452, #4453, #4459, #4477, #4494, #4495.
`docs/backlog/fiscal.md`: #4481, #4496. Whoever lands second rebases and keeps both sides; if #4483
lands first, its new `filing_*` cases change here like the others.

## Contradicts the queue item

- "Remove the older `fiscal.original_unanswered` wait": the code also guards Nothing was served
  (`backend.ts:534`), so it leaves the credits only (D3).
- "Admit … refused": conflicts with the replacement fix and the watcher's 26 Nov rule (item 6),
  hence D1 and D2. `docs/backlog.md:1101` (A1407, full invoices) says "a record refused for a future
  date should get its corrective at once, naming the refused invoice": the date-fixing corrective
  sent promptly, which argues against a wait for a person (options 1–2).
