# A1614 — correct an invoice a previous main box issued

Status: PLAN FOR APPROVAL (lane B, 2026-11-27). Fiscal: the owner lands it. Read against main 4d89be4919.

## What staff can do when it lands

After a switch to another box (a planned handover, a spare taking over, a promotion), staff can
**Correct invoice** or **Give money back** on a receipt or full invoice the old box issued, exactly
as on one this box issued. Today the till refuses ("This invoice was filed by another box…") and
staff can only end with a plain refund listed for the accountant.

The owner's words (26 Nov, quoted in lane B's queue): "The first thing we do after we receive
invoices of unknown status is try to file them, and accept duplicate errors from aeat as a sign that
they have already been filed. Either way we will either find out that it has already been filed or
we will file it, so we can issue a correction regardless".

## Today (read, with receipts)

- `packages/fiscal-verifactu/src/correction-admission.ts:69` refuses `wrong_node` when the invoice's
  newest version names another node, before it reads the filing state.
- `apps/server/src/invoice-correction-legs.ts:29-35` lists `wrong_node` as never fileable, so Close
  ends the correction with its refunds kept (`invoice-corrections.ts:536-556`), and
  `invoice-corrections.ts:173-177` (`refusesForGood`) sends Give money back to a plain refund.
- `packages/core/src/correction-history.ts:134` (`otherBox`) keeps `wrong_node` as the reason for a
  full invoice instead of `not_simplified`.
- The corrective itself already takes everything from the issuing box: its chain, installation,
  series and tax number (`packages/fiscal-verifactu/src/backend.ts:586-697`, `currentSif` at the
  issuing node). From the original it copies only issuer, number and date into
  `FacturasRectificadas` (`:644-653`). No foreign key or trigger ties a corrective to the original's
  node. So no writer changes.
- Inherited records reach this box with their filing state (both tables are venue records,
  `classification.ts:6,20`; a handover's return copies or sets `pendiente`, `handover-return.ts:563-603`),
  and this box's queue files every waiting record whatever its node (`drain.ts:640-700`). AEAT's
  duplicate answer (3000) becomes `aceptado` after a matching lookup (`drain.ts:1415-1430`,
  `:1842-1930`). That is the owner's "either way we will find out".
- A restore keeps the backup's node id (`apps/server/src/restore.ts:957-979`) but opens a new chain.
  So "another chain" also happens on one node.

## The change

1. **Admission stops refusing by node.** Delete the check at `correction-admission.ts:69` and the
   `wrong_node` reason from `CorrectionAdmission` (`packages/fiscal/src/backend.ts:65`) and its
   comment (`:49-50`). An inherited invoice is then judged by its filing state like this box's own:
   accepted (with or without errors) is correctable; refused waits while the Fiscal filing page
   offers a fix (`filing_refused`) or, for a full invoice, is `refused_no_fix`; voided, replaced and
   unusable stay refused.
2. **D1 — wait while another chain's original is unanswered.** If the original's newest version is
   on a chain other than the issuing box's current one (`currentSif`) and is still `pendiente` or
   `enviando`, admission answers a new waiting reason, `filing_pending`. On the box's own chain a
   waiting original stays admitted as today (the queue sends the original first: it keeps order
   within a chain, `drain.ts:650,664-672`). This is the rule Cancel and credit already uses for
   another chain, an earlier installation on this box included (`fiscal.original_unanswered`,
   `backend.ts:510-519`, plan `2026-11-25-cancel-unserved.md` §2): nothing orders a corrective on
   one chain behind its original on another, and a waiting original can still end refused or held.
   The wait normally lasts minutes, because this box files the inherited record itself.
3. **The server waits on `filing_pending`.** `refusesForGood` treats it like `filing_refused` (a
   wait, not a plain refund). Remove `wrong_node` from `NEVER_FILEABLE` and the `otherBox` branch in
   `correction-history.ts`.
4. **Till words.** Remove the three `wrong_node` sentences (`apps/till/src/i18n/codes.ts:1130,1507,1532`)
   and add `filing_pending` beside `filing_refused` in the same three maps, English and Spanish:
   "This invoice is still being sent to the tax agency, so it cannot be corrected yet. Press Check
   again in a few minutes." (receipt and full-invoice variants in the money-back maps). No guide text
   names the old refusal (searched `apps/server/src/guide/`).
5. **Comments and docs.** `packages/core/src/record-correction.ts:53-61` says to confirm with the
   asesor "before a real cross-node caller is wired": replace that clause with a one-line pointer to
   the owner's decision of 26 Nov (A1614) and asesor question R4
   (`docs/compliance/asesor-questions.md:605`, already listed). Dated pointer lines in
   `docs/compliance/verifactu-findings.md` (~:945) and `docs/compliance/2026-11-19-adviser-meeting.md:300`
   (historical: a pointer, not a rewrite).

## Tests (TDD: each new case fails first)

- `correction-admission.test.ts`: a receipt and a full invoice whose newest version names another
  node and is accepted → eligible, `original` its number and date; the same, `pendiente` and
  `enviando` on another chain → `filing_pending`; an earlier chain on the SAME node, `pendiente` →
  `filing_pending`; own chain `pendiente` → still `queued`; another node refused with and without a
  fix → `filing_refused` / `refused_no_fix`; voided stays `voided`. The three cases pinning
  `wrong_node` (`:241-245`, `:247-270`, `:329-333`) change to the new behaviour.
- Server: Give money back on an inherited accepted ticket files a corrective on this box's chain
  naming the original's number (replaces the plain-refund cases in `give-back.test.ts:640-643`,
  `:961-967`, `:1139`); an inherited full invoice likewise (`full-invoice-correctives.test.ts:265-271`);
  `filing_pending` waits, then files once the original is accepted; Close after a takeover
  (`invoice-corrections.test.ts:1577-1610`) now files instead of keeping refunds.
- Also changing as pins of `wrong_node`: `correction-history.test.ts:582-596,689-700`,
  `invoice-corrections.test.ts:1022-1028`, `advance-corrections.test.ts:857-883`,
  `invoice-correction-api.test.ts:1146`, till `give-back-under-way.test.ts:280-286,340-374`,
  `codes.test.ts:1172-1263`, `box-word.test.ts:32`. Each goes in the PR's "Changed test checks".
- Golden huella and `inmutabilidad` pass unedited; `scripts/errors-reachable.test.ts` and
  `scripts/alert-codes.test.ts` run.

## Decisions to clear

- **D1** (above): another chain's unanswered original waits (`filing_pending`); own chain unchanged.
  Alternative: admit it as `queued` like the box's own (no wait, but the corrective can reach AEAT
  before its original, or cite one that ends refused).
- **D2:** the same wait covers an earlier installation on this box (after a restore), which today is
  admitted as `queued`. Recommended, because it is the same risk and the same one-line test.
- **D3:** no check that the original's node is in this box's handover history. Every record in the
  venue's database is the venue's. A refused inherited record whose fix this box cannot apply
  (`record-remedy.ts:51-57`) would leave its correction waiting; I believe no real switch produces
  one, so nothing is built for it.
- **D4:** corrections already closed with refunds kept, and plain refunds already listed for the
  accountant, stay as they are (no venue is live).
- **Out of scope:** the deferred close after a switch (`deferred-close.ts:105,131`, `other_node`),
  pending the owner's answer.

## Size

One pull request, about 2.5 hours: about 40 production lines changed, about 300 test lines changed
or added. No schema change, no venue reset. Two Codex run-it angles (fiscal); the owner lands.
Branch `feat/a1614-correct-inherited-invoices`.
