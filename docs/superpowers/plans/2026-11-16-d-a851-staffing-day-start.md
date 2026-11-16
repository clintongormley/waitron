# A851 — Staffing and dated business-day starts

Author: separate GPT-6.1 Sol high-effort invocation; driver checked source and reproduction. Claude reviews the approach; watcher clears build. No owner design approval claimed.

## Finish line and evidence

Managers use the start in force for dated staffing, rota and Staffing-month reads. Reuse `cutoverForBusinessDay`, the already-read venue clock and existing paint/slot logic; add no storage, migration or framework.

The driver’s real-database probe set 04:00, then 02:00 from 2026-12-01, with Tuesday 03:00–03:30 and 05:00–05:30 blocks. On 2026-11-24 and 2026-12-01, rota boundaries, early-slot offsets (1380–1410 / 60–90), filled shifts and month needed/unfilled counts (2/1) already passed. Only resolved raw ordering failed: December returned [05:00,03:00] instead of [03:00,05:00]. Probe command: `pnpm --filter @waitron/staffing exec vitest run --project node src/rota.test.ts -t 'A851 probe'`; patch/log in Lane D receipts/a851-staffing-day-start/. Restored full rota file: 34 passed. No implementation yet.

`rota.ts:46–47,124–134` and `month.ts:28–32,53–58` already use each date’s start. Slots sort again before rendering; dashboard consumers use those offsets and keys (`rota-model.ts:111–133`, `rota-day.ts:103–106`, `rota-view.ts:427–447`). Raw ordering alone does not establish the queued visible boundary defect. `routes.ts:169,276,296` validates season/special-day edits, not rota writes.

## Watcher decision before build

The undated season editor still reads the first start (`paint.ts:265`); A788 §“The staffing painters…” records that defect but chooses no anchor. Recommend the business day at read time for the season grid and its save validation. Which date should anchor that grid, and is correcting raw resolver ordering wanted given the passing rota/month probe? Dependent season changes remain pending; amend and review their exact step once settled.

## Conditional implementation and tests

1. If cleared, `paint.ts` replaces `ResolveStaffingGiven.cutover` with optional `clock: BusinessDayClock`, reuses `cutoverForBusinessDay`/`blockSpan`, and sorts each date’s copied blocks with existing tie-breaks. Preserve paint arrays, fallback and empty-row behavior. `rota.ts` and `month.ts` pass their existing clocks; no per-date query.
2. `paint.test.ts`: before/after dates reverse two raw blocks, exercising default and supplied-clock paths. Rota/month tests characterize the already-working cutovers, offsets, shift assignment and matching; add only behavior not already protected, retain query budgets. Watch each new bug assertion fail before the minimal fix.
3. Season work, if cleared, covers its read, matching season-save validation (`routes.ts`), focused tests and EN/ES staffing guides together. Do not change `currentCutover` or `cutoverOf` globally: special-day read/parsing stays untouched.
4. Run `pnpm --filter @waitron/staffing exec vitest run --project node src/paint.test.ts src/rota.test.ts src/month.test.ts`, adding `src/routes.test.ts` only for a cleared route change. Normal hook checks types; current-head CI owns package tests. No full local package run.

Exclude A644, A708, `readSpecialDayStaffing`, rota-table renaming and new abstractions. Delete A851 detail/bundle bullet in `docs/backlog/workforce.md` and update `docs/backlog.md` only once all cleared scope is complete; retain A644/A708. Expected production30–80, tests120–200, support0–15, docs35–55 changed lines; total185–350, outside-opinion stop525. One PR, light finish-branch review unless the final change triggers a risk rule; land only after watcher clearance and current-head CI.
