# A1515 set-menu fit scope check

You can call `fitSetMenus` from `@waitron/shared` to get the cheapest valid set-menu mix for a bill
and see where every dish goes. It respects fixed types and pinned places, and uses the previous
answer to settle equal-price choices. If the bill cannot fit, it reports a sufficient menu count
when possible. Ordering and bill integration belong to pieces 2 and 4.

Follow the [implementation plan](2026-11-17-a1515-set-menu-fit.md) and
[design, section 3](../specs/2026-11-17-set-menus-design.md#3-the-fit-how-the-bill-decides).
Reuse shared's `AppError`, exports and test setup. The design writer set the 40-menu, five-type,
200-dish performance target. The plan author set the 250,000-mix cap, which allows 47 unfixed
menus across five types, and the €10,000 cap on each price or surcharge. Piece 1 needs that
amount limit when publishing offers. Pieces 2 and 4 decide what the till shows for `too_large`.

Add `set-menu-placement.ts`, `set-menu-search.ts` and `set-menu-fit.ts` in `packages/shared/src/`
with a sibling test for each, plus `set-menu-fit.bound.test.ts`. Update `index.ts`, `errors.ts`
and `packages/shared/vitest.config.ts` for the export, typed error and timing-test exception in
mutation. When the fit lands, update the remaining A1515 work in `docs/backlog/menu.md`. Database,
routes, storage, fiscal code, screens and translations belong to other pieces.

Apply these corrections while following the five test-first tasks.

- Use the search's first solved equal-cost winner. Sort inputs, break equal bounds by enumeration
  order, and compare the exhaustive reference's optimum cost. Pin deterministic results separately.
- Rank set menus by the dishes they could keep on pairs with retained flow. When choosing which
  dishes fill that flow, use those whose set menu kept its type first, then dish id. The worked
  refit must change the menu that lost its hake. Ignore stale previous places.
- Check whole positive safe line counts. Include the sum of line counts times the number of menus
  in the safe-integer bound. Test a bill whose multiple-place lines take it over that bound.
- Binary-search the menu counts where the mix cap permits a check. When the first covering count
  remains unknown, return the plan's sufficient count. Time an uncovered bill that needs several
  more menus alongside the fit and refit checks.

The placement tests own the flow and its lower bounds. The search tests own the exact optimum.
The fit tests own the two design examples, matching, stability, pins, invalid input and required
count. Read focused coverage for the three fit files, run `conventions.test.ts`,
`scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`, shared typecheck and targeted
mutation. Measure fit and refit in scratch Chromium at 4× CPU throttling. CI runs the package
suite. Adjust the mutation shard only if the plan's six-minute measurement calls for it.

The reviewer estimates one PR at 550 production and configuration lines plus 800–1,000 test
lines. Reuse the small exhaustive fixtures across cases and report the production and test counts
separately.
