# A653-l: keep a whole row on short landscape phones

**Proposal.** The driver's real-page probe leaves 4px of rows at 667×375 and none at 844×390
in Structure selection. Receipts: Lane D `archive/questions-resolved-2026-11-09.md`, watcher
23:32 and preceding question; `receipts/a653-cap-run-it/review.md`, finding 1. Approval covers
the cap, not this design. Build after PR #2674 lands, using candidate
`220e7166d0a60c54bff5b08efdfd7033a3e0b81b` and `2026-11-09-a653-shared-table-cap.md` meanwhile.
Driver inspects and signs off this plan, obtains one Claude read and at most one reread,
then watcher approval before code.

**Shared rule.** In `dashboard-app` CSS, set `.main`'s `--wt-table-max` to `none` only when
the viewport is landscape, at most **400 CSS pixels high**, and its primary pointer is coarse
(the browser's touch-oriented input classification). Every dashboard table grows naturally;
the content column scrolls rows, toolbar and headings together. You can scroll a whole product
row into view during selection without rotating. This gives up held controls/headings in that
mode. Above 400px, in portrait, or with a fine primary pointer, retain A653's cap.
Short and empty tables still grow only to their content. Dialogs retain their existing reset.

Approval settles the 400px boundary, coarse-pointer scope and scrolling-controls tradeoff.
Leave out row-height floors, selection-specific rules, per-screen exceptions, APIs, new state,
measurements, observers and timers. Keep `wt-data-table.ts` and `wt-dialog.ts` unchanged.

**Exact files and size.** One medium PR; estimate two hours build-to-open, hard limit three
hours. Stop for the watcher before scope changes or growth beyond about 1.5× this estimate.

| Kind | Changed files | Estimated added / removed lines |
| --- | --- | --- |
| Production | `apps/dashboard/src/dashboard-app.ts` | +8 / −0 |
| Tests | `apps/dashboard/src/dashboard-app.touch.test.ts` | +65 / −5 |
| Test support | None; reuse the native fixture and drag helper in that test | +0 / −0 |
| Docs | `docs/developers/design-system.md`, `docs/backlog.md`, `docs/backlog/dashboard.md`, this plan | +80 / −15 |

**Build and test responsibility.** Reproduce both selection screenshots in the real page frame.
Extend the existing native Structure fixture with normal-mode landscape cases at
667×375 and 844×390: a native row drag moves the content column while the table's row scroll
position stays zero; a heading/toolbar drag also moves the column. Observe the expected failure
under the cap, apply the CSS override, then pass. Retain the portrait gesture cases and their
existing row-count assertions unchanged. Reuse native `scrollend` completion, not timing waits.
Existing UI suites own capped/uncapped height, focus/reveal and headings. Add no geometry suite,
private-style assertions or duplicated selection tests.

**Focused checks and visual boundaries.** Run `pnpm --filter @waitron/dashboard exec vitest run
src/dashboard-app.touch.test.ts` and `pnpm --filter @waitron/ui exec vitest run
src/components/wt-data-table.test.ts src/components/wt-data-table.head-and-cells.test.ts
src/components/wt-data-table.lifecycle.test.ts`. Manually inspect screenshots of real-page
40-product Structure, normal and selection, at both target sizes in EN/ES and both themes.
Require a whole product row after page scrolling, separate from the root, plus access to the
last row and selection controls. Inspect touch landscape 844×400/401 across the cutoff,
portrait 375×667 and 390×844, desktop 1280×800 for retained cap behaviour. At fine-pointer 844×390, check the same landscape
page-scrolling rule.
Check Products too, short/empty tables with a following action, and a dialog table. Screenshots
own this geometry evidence and stay local; gesture tests own scroll interaction.

**Finish line.** Update the design-system contract and remove A653-l from both backlogs.
After the normal hook, branch review and current-head CI, staff can select landscape Structure
rows at both sizes. Reusing natural height and page scrolling keeps this simple. The cutoff
is proposed policy; screenshots must establish its boundaries. If they fail, return to the
watcher rather than add row measurement.
