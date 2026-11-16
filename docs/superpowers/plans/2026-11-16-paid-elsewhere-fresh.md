# Paid elsewhere and retained lines — implementation plan

Authority: watcher-fed Lane F queue item PAID-ELSEWHERE-FRESH, covering A1288 and A1267 in `docs/backlog/till.md`; this is not owner plan approval. Native driver builds inline only after Claude plan review and watcher clearance.

Smallest usable outcome: opening Move dishes reads current bill facts before offering ticks; a money refusal refreshes the bill and table foot. If reproduced, kept lines from a vanished bill remain reviewable beside the replacement bill's kept lines, with nothing saved or sent automatically.

Existing paths and limits (source observations, not reproduction)

- `apps/till/src/till-app.ts:14068` reads party bills but starts `#loadBillBalance` without awaiting it. The picker consumes that balance; `screens/till-table-order-screen.ts:3233` instead draws the foot from `party.outstanding`.
- Reuse `#reloadOrder`, `#rememberOrderParty`, the existing bill/balance reads and their read counters. Reuse the cancelable opening/ready pattern beside `#chooseVerb`, plus API, operator-session, visit and bill currentness checks; no new refresh framework.
- `till-app.ts:14212` refuses to carry a candidate onto an existing one. `state/draft-sync.ts:351` applies reviewed lines by replacing the editable store; `state/draft-layout.ts` groups by placement and derives line indexes. Concatenating snapshots without checking identities, placement and destination contents is not a settled fix.

1. A1288 — reproduce, then refresh at the two action boundaries

- Change `apps/till/src/till-app-move-dishes.test.ts`: add “opening Move dishes after another till pays disables the native paid tick”. Start with an unpaid read, change the fixture's bill/payment facts, open through the menu before any periodic refresh, and assert the native checkbox is disabled and cannot be selected.
- Extend its existing paid-refusal case with “money refusal refreshes the visible table outstanding”. Change both bill balance and floor outstanding, refuse with `bill.line_paid`, and assert the rendered foot immediately reflects the new table amount without reopening the table; preserve refusal and no-retry assertions.
- Change `apps/till/src/screens/till-table-order-screen.move-dishes.test.ts`: “opening waits for fresh facts; abandoned opening cannot resume”. Hold the callback, close or switch the bill, release it, and assert no stale picker opens. The screen owns opening/cancellation; the app tests own API reads, paid facts and the foot.
- Run each new assertion before its fix and record its expected failure. Then change only `apps/till/src/screens/till-table-order-screen.ts` and `apps/till/src/till-app.ts`: defer the picker using the existing cancelable callback pattern, reread bills/lines and await the relevant balance before ready. A failed read must not release stale actionable ticks; allow another explicit opening attempt.
- After a money refusal, reuse the floor-to-party-to-bill refresh so `party.outstanding` also changes. Keep the refusal, do not retry the write, and guard late replies after leaving, switching bills, signing out or replacing the API. Add a held-read app assertion for that boundary using existing helpers.

2. A1267 — establish the case before choosing the fix

- Change `apps/till/src/till-app-parties.test.ts`, beside “lines typed on the vanished bill are not sent to the new bill, and are offered for review”: retain distinct unsaved dishes on both bills for one person, make the shown bill vanish, and use the existing reread helper. Assert the replacement review contains both sets with exact contents/counts. Watch this fail before changing production code.
- If it reproduces, adjust `#carryCandidate` in `apps/till/src/till-app.ts` within the existing `RetainedDraftCandidate` shape. Keep the destination snapshot and incoming kept lines together for review; preserve quantities, notes, identities and course/group placement. Check the existing review's replacement semantics against saved destination lines, so applying cannot drop or duplicate them. If this needs a new kept-line model, stop this part and ask the watcher in `questions.md`.
- Change `apps/till/src/till-app-drafts.test.ts` for “combined candidate review preserves both sets and the destination order”. Reuse retained-candidate/server helpers; assert exact visible rows before/after explicit Update the order, repeated reads do not duplicate them, and save/submit call counts stay unchanged through waiting and review. Only a later explicit save/send may write; assert its exact lines and placement. Keep existing failed-read and changed-authority review assertions.
- If A1267 does not reproduce, record the exact command, scenario and observed assertions when retiring the point; do not invent a fix.

Verification and finishing scope

- Run the affected files with `pnpm --filter @waitron/till exec vitest run src/till-app-move-dishes.test.ts src/screens/till-table-order-screen.move-dishes.test.ts src/till-app-parties.test.ts src/till-app-drafts.test.ts`; use `-t` with `exec vitest` for initial failing cases. Require reported test counts. Browser app tests own these client behaviors; no server or database test is planned.
- LOOK in a real browser using the existing fixture: EN/ES, light/dark, phone/desktop; inspect the native paid tick, visible foot and combined review through explicit resolution. Keep images local. No layout/style changes.
- Update staff action text only where needed in `apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`, preserving shared anchors; add no explanation of refresh internals. Delete both entries, their bundle and its index line from `docs/backlog/till.md` and `docs/backlog.md`; retire the stale A1267 cross-reference there too.
- Exclude polling, push channels, new protocols/models, Join tables takeover rows, refusal wording (A1349/A1289), merge/move eligibility rules and server changes. If existing reads cannot serve this, return to the watcher before expanding scope.
- Estimated lines added/removed: production +60–110 / −10–25; tests/support +170–270 / −0–20, reusing existing fixtures; docs including this plan +35–45 / −35–50. Roughly 265–425 added lines; no new support files.
- After build: follow H13 for any overlapping Lane C till branch; concurrency finish path uses two Claude run-it seats and a fresh read of fixes, normal push/CI, then finish/land skills. This plan-writing task starts none of them.
