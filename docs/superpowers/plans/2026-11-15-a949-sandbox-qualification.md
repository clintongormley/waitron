# A949: qualify SumUp sandbox payments and prepare the owner's check

Author: Codex. Await Claude plan review and watcher clearance before execution.

Request, verbatim from `/Users/clintongormley/waitron-campaign-f/queue.md`:

> - **OWNER 2026-11-15 ~12:05 (picker, watcher's window), chose "Do it soon (Recommended)":** first run the sandbox tests your research found (Virtual Solo; €11.00 decline, €42.51 insufficient funds; a second reader on the same account) through Waitron's real SumUp client, recording what the till shows. Then write a 15-minute script for the owner's one real-card check (pay about €1 on the paired Solo; a day or two later confirm Waitron matched SumUp's settlement report) and put `## OWNER-ACTION: SumUp settlement check — pick a time` in questions.md. No signature-card test: there is no documented one.

Deliver observed sandbox outcomes, local evidence and the owner-run settlement-check script.
Reuse the till, reader setup, `packages/payments-sumup/src/sumup-client.ts`, `report-source.ts`
and `reconciler.ts`; use historical experiments §§10–11 and the table-service guide's
**Use another card machine** section. No harness, ledger, API, automated checks, refunds or
fiscal changes. A discovered product defect returns to the watcher as new scope.

## Access and files

No authenticated provider request now. Shell `SUMUP_*` is unset; do not read/source
`~/.sumup-experiments/env`, whose sandbox designation is unknown. Do not run
`packages/payments-sumup/src/collect.sandbox.test.ts`: it charges/refunds EUR1.
Obtain a confirmed sandbox merchant API key, two same-account Virtual Solo instances and
browser access or an operator before promising experiments; no browser tool is exposed.
Use existing reader setup in a separate preproduction venue, preserving the physical Solo.

Files:

- Create `docs/superpowers/plans/2026-11-15-a949-sandbox-qualification.md`.
- Create `docs/research/2026-11-15-a949-sandbox-and-settlement-check.md`: provenance,
  outcomes/blockers, receipt pointers and operator script.
- Add small dated pointers/status edits to `docs/research/2026-09-10-sumup-solo-experiments.md`,
  `docs/backlog.md` and `docs/backlog/payments.md`; retain unqualified hardware/signature work.

Keep redacted raw receipts outside git in
`~/waitron-campaign-f/receipts/a949-sandbox-qualification-20261115/`, with times, reader/order
identities, references and exact till wording; exclude credentials/card data.
The executing lane later appends the quoted OWNER-ACTION heading to `questions.md`, linking
the script and asking for a time. Expected size: **0 production lines, 0 automated test lines; about 100–150 documentation lines total**.

## Manual qualification after access arrives

Use real Waitron requests. Record run/failed/blocked separately from expected results.
Add minimal quoted provenance dated
15 November from [SumUp testing](https://developer.sumup.com/terminal-payments/testing/)
and [Virtual Solo](https://developer.sumup.com/terminal-payments/cloud-api/#solo-virtual-terminal):
EUR11 decline, EUR42.51 insufficient funds, sandbox only, no real transfers and auto-approved PIN.

| Named check | Responsible layer and evidence |
| --- | --- |
| Successful control A | Till through real client to Virtual A: EUR10 pays the correct order after final success, not checkout acceptance. |
| Decline A | EUR11 leaves order unpaid; save exact till/provider words, generic or specific. |
| Insufficient funds A | EUR42.51 leaves order unpaid; save exact words. For both declines, retry after definite failure only; verify new reference and correct order/reader routing. Stop on uncertainty. |
| Same-account backup B | Successful independent Virtual B charge through existing real client, then **Pay → Other card machine → This SumUp account**, operation number and machine. Verify unique amount/time matching in the daily comparison. Record a blocker if virtual access cannot support this flow. Virtual matching leaves physical hardware unqualified. |

## Owner script and report evidence

Write **10 minutes now / 5 minutes later**: owner pays about EUR1 once on the paired Solo;
saves order, provider reference, amount, currency and time; leaves it unrefunded until proof.
Return a day or two later; wait if the daily check is incomplete.

Before specifying proof, follow `packages/payments/src/reconcile.ts`,
`apps/server/src/reconcile-duty.ts`, `backup-audit-day.ts`, `payments-api.ts` and
`apps/dashboard/src/widgets/backup-audit.ts`. SumUp history supplies gross charges; it is not a
bank payout report. **Reporting → Check card payments → SumUp comparison** displays backup
matches. For the normal paired charge, inspect the saved successful daily audit read-only,
correlating period/checked rows, provider ID, EUR amount and mismatch lists with the supporting
provider record. Empty panels or absent alerts prove nothing. Do not rerun the reconciler:
it can move money.

Name available evidence; leave unproven matches pending. Bank arrival/fee reconciliation stay
outside Waitron; promise no bank arrival within two days. Verify paths and `git diff --check`;
report what ran and what remains.
