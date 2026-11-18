# Restore the till receipt browser checks

**Finish line.** The browser tests catch a receipt logo that can overflow, and check accessibility
in light and dark for a practice receipt with its large bold heading, VAT-rate column and closing mark.

The watcher requested these checks in Lane F's queue at 07:13 after #3740. Keep the existing
four-column case. Scope is the two till test files and this plan. The receipt and unit wording are
outside this follow-up.

1. In `apps/till/src/screens/till-ticket-view.test.ts`, restore "keeps the logo no wider than the
   ticket and no taller than its own bound" using both the saved logo filename and the supplied
   logo element. Keep the prior checks
   for max-width 100%, a max-height other than none, and object-fit contain.
2. In `apps/till/src/screens/till-ticket-view.a11y.test.ts`, reuse the light and dark fixture in a
   second variant with the VAT-rate column. Supply a bold double-size heading and a closing
   practice mark. Check that the elements reach axe with scoped headings and the closing mark
   last. Compare the heading's computed size to the same article's plain text and check its
   bold weight. The presence and style assertions catch missing variants before axe runs.
3. Run both test files. In a disposable checkout break only `till-ticket-view.ts`: remove
   the logo's max-width, max-height or object-fit, remove each heading style, always use four
   item columns, or omit the last preview element. Run the matching test after each break and
   record its failing assertion. Restore the disposable file and verify both suites pass. Use
   the normal signed review and CI.

**Estimate.** About 45–65 added test lines. No production changes.
