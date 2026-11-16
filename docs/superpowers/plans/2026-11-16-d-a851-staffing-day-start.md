# A851 — Staffing and dated business-day starts

Author: separate GPT-6.1 Sol high-effort invocation; driver checked source and reproduction. Claude reviews the approach; watcher clears build. No owner design approval claimed.

## Finish line and evidence

Managers use the start in force for dated staffing, rota and Staffing-month reads. Reuse `cutoverForBusinessDay`, the already-read venue clock and existing paint/slot logic; add no storage, migration or framework.

The driver’s real-database probe set 04:00, then 02:00 from 2026-12-01, with Tuesday 03:00–03:30 and 05:00–05:30 blocks. On 2026-11-24 and 2026-12-01, rota boundaries, early-slot offsets (1380–1410 / 60–90), filled shifts and month needed/unfilled counts (2/1) already passed. Only resolved raw ordering failed: December returned [05:00,03:00] instead of [03:00,05:00]. Probe command: `pnpm --filter @waitron/staffing exec vitest run --project node src/rota.test.ts -t 'A851 probe'`; patch/log in Lane D receipts/a851-staffing-day-start/. Restored full rota file: 34 passed. No implementation yet.

`rota.ts:46–47,124–134` and `month.ts:28–32,53–58` already use each date’s start. Slots sort again before rendering; dashboard consumers use those offsets and keys (`rota-model.ts:111–133`, `rota-day.ts:103–106`, `rota-view.ts:427–447`). Raw ordering alone does not establish the queued visible boundary defect. `routes.ts:169,276,296` validates season/special-day edits, not rota writes.

## Watcher decision before build

The undated season editor still reads the first start (`paint.ts:265`); A788 §“The staffing painters…” records that defect but chooses no anchor. Recommend the business day at read time for the season grid and its save validation. Which date should anchor that grid, and is correcting raw resolver ordering wanted given the passing rota/month probe? Dependent season changes remain pending; amend and review their exact step once settled.

## Reviewed approach; build awaits watcher

Claude’s approach read (2026-11-16, report in Lane D receipts/a851-staffing-day-start/plan-review.md) agrees rota/month already work. It finds no meaningful visible reason to change raw ordering alone; remove that production step and the new resolver clock option. The visible core is the season editor: `paint.ts` read, its `readPlannedServiceGuides` cutover, and season-only save parsing in `routes.ts`, using the same agreed anchor inside their transactions. The exact step needs the watcher's date decision and one allowed Claude reread before build.

The decision must also cover blocks saved under the old start that cross the new one: existing parse rejects them while the grid clamps their drawing. Recommend retaining the refusal and making the invalid block apparent, rather than silently changing stored times; that visible correction needs watcher clearance too. Future seasons and a pending change follow the same agreed anchor, not an inferred season date. A788’s “not today’s” heading supports today but does not settle those cases.

`paint.test.ts` and `routes.test.ts` will cover the agreed season read/guides/save behavior and old crossing blocks. Rota/month tests protect already-working cutovers, offsets, shift assignment and matching; add only behavior not already protected, retain query budgets. Watch new bug assertions fail before the minimal fix. Inspect EN/ES staffing guides before changing prose; update only boundary instructions the change makes stale. Do not change `currentCutover` or `cutoverOf` globally: special-day read/parsing stays untouched.

Run `pnpm --filter @waitron/staffing exec vitest run --project node src/paint.test.ts src/rota.test.ts src/month.test.ts`, including `src/routes.test.ts` for the cleared season route change. Normal hook checks types; current-head CI owns package tests. No full local package run.

Exclude A644, A708, `readSpecialDayStaffing`, rota-table renaming and new abstractions. Delete A851 detail/bundle bullet and update the remaining bundle count in `docs/backlog/workforce.md` and update `docs/backlog.md` only once the season scope is complete; retain A644/A708. If season work is declined, add the missing rota/month regression protection and narrow A851 to the remaining season defect instead of deleting it. Expected production30–80, tests120–200, support0–15, docs35–55 changed lines; total185–350, outside-opinion stop525. One PR, light finish-branch review unless the final change triggers a risk rule; land only after watcher clearance and current-head CI.
