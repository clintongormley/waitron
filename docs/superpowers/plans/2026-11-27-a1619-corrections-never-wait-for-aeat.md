# A1619 — a correction never waits for AEAT's answer to the original

Status: cleared (lane B, 2026-11-27), read against main c6acae0136; revised after fresh read 1 (no
Critical; four Important and eight Minor points, all taken in). The watcher cleared D2–D7 (lane B
`questions.md`, 13:21); the owner answered D1 (14:30, below). Fiscal: the owner lands both PRs. PR 1
is this page; PR 2 (a date fix after an earlier refund) gets its own section, sent to the watcher
before it is built.

## What staff can do when it lands

On a receipt or full invoice that AEAT (the Spanish tax agency) has not answered yet, refused, or
is holding back, on this box's records or another box's, staff press **Correct invoice** or **Give
money back** and the money goes back on a corrective invoice (a new invoice that reduces the old
one) at once, printed as usual. **Cancel and credit** and **Pay for items** on a printed bill file
their credit at once too. Today they wait ("This receipt is still being sent to the tax agency…
try again in a few minutes"; "The tax agency refused this receipt… Fiscal filing shows what to
do"), or, on a full invoice AEAT refused with no fix, give the money back with no corrective and
list it for the accountant. PR 2 then lets Fiscal filing's date fix (the replacement receipt) follow
a refund already given, so a refund never costs the fix (D1).

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

## The change (PR 1)

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
  credit; then Send the replacement on such a receipt answers `sale.replacement_not_first` (today's limit,
  which PR 2 lifts; pinned here).

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

- **D1 — the owner's answer** (below): never wait; PR 1 as written, PR 2 lets the date fix follow
  an earlier refund.
- **D2:** the watcher's 26 Nov 16:37 rule (credits refuse a receipt AEAT refused, to keep Send the
  replacement possible) is retired (the watcher, 14:30, following D1).
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

### D1, the owner's answer (27 Nov 2026, relayed by the watcher at 14:30)

The question was a receipt refused by AEAT as dated in the future (clock a day ahead) that a guest
had already been given 5.00 back on: Waitron cannot then send Fiscal filing's date fix, a
replacement receipt (`sale.replacement_not_first`, `record-replacement.ts:116-120`). The owner,
verbatim: "remember that we could potentially submit a chain of receipts and corrections in a single
request to AEAT, even if the first in the chain is incorrect, so we shouldn't wait for confirmation
on anything. the important thing is that a correction points to the previous invoice/receipt, even if
that document has been refused by AEAT. so we issue a date-fix replacement which points to the
original refused invoice, then a refund correction pointing to the date-fix replacement, and then we
can submit both invoices in the same request (or in separate requests), however the timing works.
Include this scenario as one requiring confirmation but don't wait for confirmation".

So:
- **PR 1** (this page): nothing waits on AEAT's answer. A refund after a date fix already names the
  replacement (`correction-target.ts`, unchanged).
- **PR 2** (its own section, to the watcher before it is built): when the refund was given BEFORE
  the refusal came back, the date fix is still possible: core's replacement writer stops refusing a
  receipt that has correctives, and the correction history counts the earlier refund after a
  replacement (the old option 4: `record-replacement.ts:116-120`, `correction-target.ts`,
  `correction-history.ts`). It touches the path around the record builder `recordCorrection`, so it
  takes a full review and a run on AEAT's test service first, and the owner lands it.
- The scenario is adviser question Q64 (`docs/compliance/asesor-questions.md`), built without
  waiting for the answer.

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


## PR 2 — a date fix after an earlier refund (cleared by the watcher 2026-11-27 17:10, lane B questions.md; read against main 4698ac9341)

### What lands

A receipt AEAT (the Spanish tax agency) refused as dated in the future (`1112`), on which a guest
was already given money back by a corrective "by difference" (an R5 of type I: a new invoice that
takes an amount off), can still be put right from Fiscal filing's **Send the replacement**: Waitron
files the replacement (an R5 of type S, which takes the receipt's place) naming the refused
receipt, at the receipt's whole amount. The earlier refund keeps counting, so the next refund can
give back only what is left (45.00 of a 50.00 receipt after 5.00). Refunds after the replacement
already name it (`correction-target.ts:12-17`).

### Today (read, not run, unless said)

1. **The refusal.** `recordReplacement` counts every sale that corrects the receipt
   (`record-replacement.ts:68`) and refuses `sale.replacement_not_first` if there is any
   (`:116-120`), because "an earlier corrective's change would then be counted beside it". It also
   refuses a cancelled receipt (`:77-83`), one exchanged for a full invoice (`:85-91`) and a
   corrective (`:93-95`). A second replacement is also stopped by the unique index
   `sales_one_replacement_uq` (`packages/db/src/schema/sales.ts:145-147`).
2. **What it builds.** The receipt's own total, VAT split and lines (`record-replacement.ts:160-164,
   191-202, 218-223`); copied lines keep their line numbers and get new ids with no link back
   (`:195-200`). The record builder files type S (`backend.ts:658`), `FacturasRectificadas` naming
   the receipt's number and date (`:659-669`) and `ImporteRectificacion` 0.00 / 0.00 (`:670-673`),
   allowed only when every record under the receipt's own number was refused, none with `3000`
   (`:624-627, 376-395`). That check reads the receipt's number only, so the earlier R5 (its own
   number) does not affect it. **No change to the builders, the hash (`computeHuella`), the chain
   or numbering is needed.**
3. **History after a replacement.** Correct invoice's preview reads the replacement
   (`correction-history.ts:121`) and counts only sales that correct the replacement (`:194, 250-262`),
   so a refund given before it vanishes: 50.00 more could be given back (55.00 in all). The writer
   repeats this: what is left (`record-correction.ts:186, 252-265`), Cancel and credit's "whole
   invoice, first correction" check (`:187, 494`) and the line history (`:314-328`) all read the
   replacement's own correctives. Its earlier refund's lines name the receipt's line ids, which are
   not on the replacement. Give money back already maps a receipt's lines onto its replacement's by
   line number (`apps/server/src/give-back-read.ts:338-349`).
4. **Reports already count it right.** `correctivesOf` (`packages/db/src/correctives-of.ts:16-20`)
   takes the receipt's correctives except the replacement, plus the replacement's: 50.00 − 5.00 =
   45.00. The guard `scripts/corrective-sums.test.ts` lets core read correctives directly on the
   stated ground that the target "has no replacement" (`:69-73, 126-150`), which PR 2 makes false.
5. **VAT day (read, not run).** The VAT report places a refund of the receipt on the receipt's own
   (wrong) day (`packages/reporting/src/vat-movements.ts:148-165`), while the replacement moves the
   sale itself to the real day (`:174-182`); a refund of the replacement takes the real day
   (`:150`). In the 31 March / 1 April case the 5.00 lands in a different quarter from the sale (D11).

### The change

1. `record-replacement.ts`: refuse `sale.replacement_not_first` only when a replacement exists
   (`replaces_original = 1`), not for any corrective; the replacement stays at the whole amount.
2. Core: one helper beside `correctionTargetFor` that reads the earlier correctives through
   `correctivesOf` of the replaced receipt and maps their lines onto the replacement by line number.
   `correction-history.ts` (`readStored`, `readHistory`, set-menu parts at `:322-327`) and
   `record-correction.ts` (`:186-187, 314-328`) use it. Drop the five allowlist entries the guard
   no longer needs.
3. Dashboard words (`packages/fiscal-verifactu/src/dashboard/strings.ts:330,733`): the code now
   means "already replaced": EN "This invoice has already been replaced, so nothing was sent. The
   case stays open." and the Spanish twin. No till words change; no guide words this refusal.
4. Docs: Q64's dated line; `docs/backlog.md:1129` ("cannot take its R4 (`sale.replacement_not_first`)")
   goes stale.

### Tests (each fails first)

- Core `record-replacement.test.ts:622-656` flips: after a 6.05 refund the replacement files at the
  receipt's total. New: a second replacement → `sale.replacement_not_first`, no number used.
- Core `correction-history.test.ts` / `record-correction.test.ts`, 50.00 receipt, 5.00 refund,
  replacement: preview left 45.00 and that line's remainder; 45.01 → `sale.correction_exceeds_total`;
  a whole credit → `sale.correction_not_whole`.
- `record-remedy-replacement.test.ts:536-565` flips: R5 "S", `ImporteRectificacion` 0.00/0.00,
  `ImporteTotal` 50.00, naming the receipt; the earlier R5's stored record and hash unchanged.
- PR 1's pinned server case (Send the replacement after a credit refuses) flips; Give money back
  then offers 45.00. Reporting: the period nets 45.00 (D11 decides the day). Untouched: golden hash,
  `inmutabilidad`.
- **AEAT test service, before the build lands.** No run has ever sent a type-S R5 (the probe at
  `docs/backlog.md:360-366` is still open) and `1112` itself has never been observed (only the
  published rules, `docs/compliance/2026-11-06-adviser-questions.md:599`). Runs are new modes of
  `scripts/live-aeat.mjs` in the `verifactu` repo, dispatched through `live-aeat.yml` on its `main`
  (`:8-36, 70-72`), as run 37286368370 (`rejected-invoice-credit`, `live-aeat.mjs:3324-3355`) and
  run 39560851006 (findings §18) were; a new mode needs the owner's approval (`backlog.md:364-365`).
  Mode `replacement-after-credit`: an F2 50.00 dated tomorrow, an R5 "I" −5.00 dated today naming
  it, an R5 "S" 50.00 (0.00/0.00, real day as `FechaOperacion`) naming it, chained in that order;
  once in one request, once in three; controls: the R5 "S" with no credit (the open probe) and a
  today-dated F2 with its credit; then a consulta of each number. Expected: F2 `Incorrecto` `1112`,
  both R5s `Correcto`. The failing case prints `Incorrecto` with a code on either R5.

### Decisions

- **D8 — the amount.** (a) Replace at 50.00 and keep the 5.00 counting: AEAT holds −5.00 + 50.00 =
  45.00, what was kept, and `correctivesOf` already agrees. (b) Replace at 45.00: AEAT nets 40.00
  unless the first refund is withdrawn, and the writer copies the whole receipt (`:160-164`).
  (c) Re-issue the 5.00 against the replacement: the first refund cannot be withdrawn (a
  cancellation says an invoice should never have existed, FAQ §17 2.d), so 40.00 again.
  **Recommend (a).** Q64 (b) asks the adviser exactly this. The owner's "a refund correction
  pointing to the date-fix replacement" is how every refund after the replacement is filed; read as
  re-issuing an earlier refund it is (c), so confirm.
- **D9:** keep `sale.replacement_not_first` for an existing replacement, reworded. Recommended.
- **D10:** an earlier refund written under the same wrong clock is itself refused `1112`, and a
  corrective has no fix (`record-replacement.ts:93-95`; `docs/backlog/self-service-refusals.md:233`). Out of
  PR 2. Recommended.
- **D11:** move an earlier refund's VAT day to the replacement's real day, as for later refunds
  (`vat-movements.ts:150`). Recommended in PR 2, with a test first; a VAT figure, not read further.
  As built (2026-11-28, after review): the refund keeps its own day, and the date fix moves it on its
  issue date, beside the receipt's own move, so a period already filed does not change.
- **D12:** a full invoice (R1 then R4 "S") follows the same core change but stays off
  (`put-right.ts:30`). Recommended.

### Size and files

About 90 production lines: `packages/core/src/{record-replacement,correction-target,
correction-history,record-correction}.ts`, `packages/reporting/src/vat-movements.ts` (D11), dashboard
`strings.ts`, `scripts/corrective-sums.test.ts` (smaller). About 250 test lines in core,
fiscal-verifactu, server and reporting. The `verifactu` mode is a separate PR of about 150 lines.
No schema change. Full review with two Codex angles; the owner lands it.

**Cleared (watcher, 2026-11-27 17:10):** D8 (a): replace at the whole 50.00; the earlier 5.00 refund keeps
counting against the original. D9 reworded "already replaced". D10: the same-clock earlier
refund stays out of PR 2, named in the PR body as a known limit, plus one line on the adviser's confirmation
list. D11 and D12 as written. **AEAT test service:** run 46070947073 (verifactu b979412f9f, mode
`replacement-after-credit`) accepted it: each receipt dated tomorrow refused `1112`; the 5.00 refund (R5 I) and
the date fix (R5 S, 0.00/0.00) both `Correcto`, in one request and in three; the date fix alone `Correcto`; the
owner's order (date fix, then a refund naming it) `Correcto`; the today control `Correcto`. Test service only.
