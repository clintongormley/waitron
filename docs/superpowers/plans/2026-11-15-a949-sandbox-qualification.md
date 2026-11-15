# A949: SumUp sandbox qualification and the owner's settlement check

Codex plan; Claude reviewed it on 15 November (199 seconds). The watcher cleared
docs-only publication at 16:08, inside the owner’s 12:05 “Do it soon” request,
recorded in `~/waitron-campaign-f/questions.md`. Experiments still need sandbox
access and the real-card check needs the owner’s session. No owner design approval is claimed.
Request, verbatim from `~/waitron-campaign-f/queue.md`:

> - **OWNER 2026-11-15 ~12:05 (picker, watcher's window), chose "Do it soon (Recommended)":** first run the sandbox tests your research found (Virtual Solo; €11.00 decline, €42.51 insufficient funds; a second reader on the same account) through Waitron's real SumUp client, recording what the till shows. Then write a 15-minute script for the owner's one real-card check (pay about €1 on the paired Solo; a day or two later confirm Waitron matched SumUp's settlement report) and put `## OWNER-ACTION: SumUp settlement check — pick a time` in questions.md. No signature-card test: there is no documented one.

**Finish line:** observed sandbox outcomes and a 15-minute owner script. Watcher 15:58 confirms
no sandbox merchant exists and saved keys are live; write the script while access is arranged.
Reuse the till, reader setup, real `sumupClient` and existing daily audit. No product code,
harness, automated test, refund, bank-payout viewer or fiscal change. Defects return to the watcher.

**Access:** obtain confirmed sandbox credentials and two same-account Virtual Solos, browser
access/operator and a separate preproduction venue with those credentials provisioned. Never
use the live keys for sandbox tests or run the existing €1-charge/refund sandbox suite. The later
real-card session also needs Codex's read-only access to its retained venue database.

**Files:** this plan; new `docs/research/2026-11-15-a949-sandbox-and-settlement-check.md`;
small pointers/status edits to `docs/backlog.md`, `docs/backlog/payments.md` and
`docs/research/2026-09-10-sumup-solo-experiments.md`. Raw redacted receipts stay in
`~/waitron-campaign-f/receipts/a949-sandbox-qualification-20261115/`.
Expected: **0 production, 0 automated test lines; about 150 documentation lines total**.

| Manual check | Layer and evidence |
| --- | --- |
| Control A, €10 | Till → real client → Virtual A: final success pays the correct order. |
| Declines A, €11 / €42.51 | Order remains unpaid; record actual till wording and provider outcome. A definite decline allows retry with a new reference; verify routing. Stop on uncertainty. |
| Second reader B | Till → real client → Virtual B on a separate order: final success and correct routing. This is integrated-reader qualification. Backup matching needs a charge outside Waitron; if Virtual Solo cannot originate one, record that remaining experiment blocked. Never manually record an integrated charge again. |

Retain Waitron's affiliate constant and record its existing fallback if observed
(`provider.ts:176-185`); a refused checkout is a blocker, not a reason to replace the key.
Use the current [SumUp testing](https://developer.sumup.com/terminal-payments/testing/) and
[Virtual Solo](https://developer.sumup.com/terminal-payments/cloud-api/#solo-virtual-terminal)
documentation as provenance. Virtual results leave physical hardware/signature qualification open.

**Owner script:** ten minutes now: pay about €1 once on the paired Solo, finish the bill normally,
retain the charge and order/provider references. Five minutes a day or two later: owner checks
the SumUp transaction and completed daily comparison; Codex obtains the actual match evidence.
The backup panel alone cannot prove a paired-reader match. Its daily comparison needs the
provisioned credential and following UTC-midnight check.

Codex reads the local captured payment and latest successful daily audit covering its timestamp:
exact provider ID/amount, eligible row with no resolved hold, run after capture, checked ≥1,
no payment in mismatch lists or reference in missingLocal. `store.ts:670`, `reconcile.ts:180`,
`reconciler.ts:320` and `reconcile-duty.ts:52` define that inference. Missing access/evidence
leaves qualification pending. Never run the money-moving reconciler manually for proof.
Bank arrival and fees remain outside Waitron. Verify paths and `git diff --check`; append
`## OWNER-ACTION: SumUp settlement check — pick a time` to `~/waitron-campaign-f/questions.md`.
