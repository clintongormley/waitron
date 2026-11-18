# Restore the till receipt browser checks

**Finish line.** The browser tests catch a receipt logo that can overflow, and check accessibility
in light and dark for a practice receipt with its large bold heading, VAT-rate column and closing mark.

The watcher requested these checks in Lane F's queue at 07:13 after #3740. Keep the existing
four-column case. Scope is the two till test files and this plan. The receipt and unit wording are
outside this follow-up.

1. In `apps/till/src/screens/till-ticket-view.test.ts`, restore "keeps the logo no wider than the
   ticket and no taller than its own bound" using the supplied logo element. Keep the prior checks
   for max-width 100%, a max-height other than none, and object-fit contain.
2. In `apps/till/src/screens/till-ticket-view.a11y.test.ts`, reuse the light and dark fixture in a
   second variant with the VAT-rate column. Supply a bold double-size heading and a closing
   practice mark. Assert the heading is visibly larger and bold, the scoped rate heading and its
   value render, and the practice mark closes the article before running the existing axe check.
3. Run both test files. In a disposable checkout, remove the logo bounds and fit, then remove each
   of the heading styles, rate column and closing mark in turn. Each relevant test must fail.
   Restore the controls and retain the nonzero test counts. Use the normal signed review and CI.

**Estimate.** About 45–65 added test lines. No production changes.
