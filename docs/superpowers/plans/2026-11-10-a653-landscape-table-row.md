# A653-l: keep a whole row on short landscape phones

**Proposal; no build approval yet.** A653 landed in PR #2674 (`8d7ee8c42c`). Its real-page
Structure selection probe left 4px of row space at 667×375 and none at 844×390. The watcher's
2026-11-09 23:32 instruction, in Lane D `archive/questions-resolved-2026-11-09.md`, was:
“after this lands, take it as your next item, A653-l: a one-page plan for the smallest fix
(for example, the cap stands aside below a viewport height, or selection keeps one whole row).”
That approves planning, not this rule. One Claude read and at most one reread precede watcher
approval; no code starts before it.

**Shared rule and decision.** After the existing shell cap declaration, add
`@media (orientation: landscape) and (max-height: 25rem)` and set `.main`'s existing
`--wt-table-max` to `none`. The shell owns that inherited value. All dashboard tables then
use natural height; the content column scrolls rows, toolbar and headings together. This is
a deliberate exception to A653's held-controls/headings rule. Selection actions scroll away
while you pick lower rows; you scroll back to use them. Approval must accept that tradeoff.

The cutoff is a chosen round boundary, nominally 400px, just above the two target heights;
it is not a measured universal minimum. Above it the cap stays, with no whole-row guarantee.
Portrait and desktop targets retain their cap. Short/empty tables retain natural height and
dialogs their nearer reset. No pointer condition, row-height floor, selection-specific rule,
per-screen exception, API, state, measurement, observer or timer. Leave the shared table and
dialog implementations unchanged.

**Exact files and build size.** One small PR, about one hour build-to-open, hard limit three.
Stop for the watcher before scope changes or growth beyond about 1.5× the estimate.

| Kind | Changed files | Added / removed lines |
| --- | --- | --- |
| Production | `apps/dashboard/src/dashboard-app.ts` | +6 / −0 |
| Tests | `apps/dashboard/src/dashboard-app.touch.test.ts` | +45 / −5 |
| Test support | None; reuse the native fixture and drag helper | +0 / −0 |
| Docs | `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/dashboard.md` | +10 / −15 |

This already-committed plan is separate from those build estimates. Both backlog entries exist
on the landed cap base. Do not rewrite the historical A653 plan.

**Test responsibility.** Add a mode column to the existing `it.each` and branch after its
shared setup; do not extract or re-indent the inline fixture. Add normal-mode cases at
667×375 and 844×390. A native row drag must move the main column while the table's own row
scroll stays zero. In the capped failing run, confirm the row drag moved `.scroll` and not
`.main`; if it did not, fix the start point so the drag starts on a row before proceeding.
Then apply the override. Wait for native `scrollend` before the absence assertion. Keep
portrait gestures and their behavioural assertions. No extra heading gesture:
it already moves the column. Existing UI suites retain capped/uncapped, focus/reveal and heading
responsibilities; add no private-style mirror, duplicate selection or geometry test.

Run dashboard's `vitest run src/dashboard-app.touch.test.ts` and UI's
`vitest run src/components/wt-data-table.test.ts src/components/wt-data-table.head-and-cells.test.ts
src/components/wt-data-table.lifecycle.test.ts`, through `pnpm --filter @waitron/<package> exec`.

**Visual checks and finish line.** Inspect real-page 40-product Structure normal/selection in
EN/ES at both target sizes; both themes at one size. After page scrolling, a whole product row
and the last row's checkbox must be fully visible. Select the last row, scroll back, and check
the correct count and working selection actions. Check the chosen cutoff and record 844×401's
row area without making it a row-count gate. Retain portrait 375×667/390×844 and desktop
1280×800 behaviour; also inspect Products, short/empty tables with a following action, and a
dialog table. Screenshots own geometry and stay local; native tests own scrolling. If a target
fails, return to the watcher. Update the contract and remove A653-l from both backlogs. After
review, the normal hook and current-head CI, staff can select rows at both landscape targets
and return to the actions without rotating the phone.
