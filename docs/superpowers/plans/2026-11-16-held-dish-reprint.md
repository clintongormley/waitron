# Held dish reprint implementation plan

**Status:** awaiting Claude read and watcher clearance. Sol drafted this plan; the driver narrowed it after the probes. No owner design approval is claimed.
**Ask:** HELD-DISH-REPRINT in lane H's `queue.md` (watcher 2026-11-16 22:25/22:26), A1369 and Task 6 point 3 in `docs/backlog/kitchen.md`.
**Finish line:** reprinting a bill includes its requested dishes still waiting for the pass on existing HOLD paper, with the existing HOLD mark and original send time. Fired and ordinary held dishes keep their current output. One PR, no table changes.

## Evidence and scope

On base `8d65e53f22`, the driver's real submit/fire/cancel reproductions failed at the missing reprint and missing cancellation on the original printer; the other 25 cases passed. Receipts: `~/waitron-campaign-h/receipts/held-dish-reprint/reproduce-whole-file.log` and `reproduction.patch`.

Point 3 also reproduced. The additional real-operation probe raised a requested burger by a portion, removed the original and cancelled the new portion, both with unchanged printers and after replacing the station printer. At the remaining dish, `kitchen_print_job_lines` was empty; the HOLD CHANGED/CANCELLED jobs had no kitchen links. With replacement, the original HOLD was on Grill/pass and the addition and cancellations were on Fryer. The unchanged-printer control retained Grill/pass output. `printer-history.jsonl`, `printer-history-probe.patch` and `printer-history-whole-file.log` retain the rows/decoded output and 27 passing cases. This demonstrates a gap in typed recipient history, not a proof that every no-table approach is impossible. Leave point 3 with this receipt: a complete routing correction needs recipient information the existing correction jobs do not record. Do not guess from the earliest/latest ticket or parse paper bytes as routing data.

Exclude correction-job records/alerts, stale paper after reordering/merging, paper layout, dark-screen alerts, new helpers, records, columns or migrations. Estimate: production 15–35 added/0–5 removed lines; tests 45–85 added/0–5 removed. Docs about 10–20 changed lines; no generated files.

## Build and checks

- [ ] Restore and strengthen the reprint reproduction in `apps/server/src/kitchen-request.hold-paper.test.ts`, reusing `fresh`, `firedFromHold` and `slips`. At distinct fixed HOLD/request/reprint times, mark initial HOLD jobs completed, expect one REPRINT/HOLD burger on Grill and pass with its original HOLD time, no Fryer ticket for the requested extra without paper, and unchanged ticket state. Watch the missing-ticket assertion fail before code; this file owns the new behavior.
- [ ] In `apps/server/src/kitchen-print.ts`, trace both callers of `readWaitingOnHoldPaper`. Expand its projection with line/station/quantity and group's HOLD time without changing its eligibility checks. Append those rows to `readReprintParts`' held section using that time. Keep ordinary held filtering, fired selection, routing, formatting and joining. Check the two held input sets cannot duplicate an item; trace `readReprintTargets` into printing-problem readers. Prune affected stale reprint comments.
- [ ] Run the changed file green, then full focused server files: `kitchen-request.hold-paper.test.ts`, `kitchen-print.test.ts`, `print-problems.test.ts`, `party-name-paper.test.ts`, `order-kitchen-note.corrections.test.ts`. Existing suites own ordinary held/fired output, links and same-printer warning clearing; preserve their assertions.
- [ ] Update `docs/backlog/kitchen.md`: delete A1369, retain Task 6 points 1/2 and replace point 3's read-not-run wording with the measured limitation. Update the bundle count/reference in `docs/backlog.md`. Add one practical reprint sentence to both `apps/server/src/guide/{en,es}/kitchen-service.md`; run guide checks.
- [ ] Run unedited fiscal `test:build-custodian`, `src/write-path.e2e.test.ts`, `src/inmutabilidad.test.ts`; server `src/till-api.sell-published.test.ts` (Review Focus 1/2); till `src/till-app-menu-refresh.test.ts` after memory check. Use `pnpm --filter <package> exec vitest run <files>`; no whole-package local run.
- [ ] Finish through the authorised `finish-branch` review, normal push hook, current-head CI and `land-branch`. Return material scope/size changes to the watcher first.
