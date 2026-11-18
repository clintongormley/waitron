# A1515 set-menu fit scope check

You can call `fitSetMenus` from `@waitron/shared` to get the cheapest valid set-menu mix for a bill
and see where every dish goes. The fit keeps fixed types and pinned places and uses the previous
answer to settle equal-price choices. If the current mix cannot cover the dishes, it reports how
many menus are needed, when known. Ordering and bill integration belong to pieces 2 and 4.

The [implementation plan](2026-11-17-a1515-set-menu-fit.md) and
[design, section 3](../specs/2026-11-17-set-menus-design.md#3-the-fit-how-the-bill-decides)
give the exact inputs, ranking and examples. Follow the plan's placement solver and bounded search.
Reuse the shared package's `AppError`, exports, Vitest and Stryker configuration. Keep all amounts
in whole cents and the fit browser-safe. The plan author chose `too_large` above 250,000 possible
mixes. With five offers, 47 unfixed set menus fit that bound and 48 exceed it. Pieces 2 and 4
decide what the till shows for that result.

In `packages/shared/src/`, add `set-menu-placement.ts`, `set-menu-search.ts` and `set-menu-fit.ts`
with a sibling test for each, plus `set-menu-fit.bound.test.ts`. Add the export in `index.ts`, the
typed error in `errors.ts` and the plan's timing-test exception for mutation in
`packages/shared/vitest.config.ts`. Update A1515's remaining work in `docs/backlog/menu.md`
without retiring its other pieces. The PR covers the function and its tests. Database, routes,
storage, fiscal code, screens and translations belong to other pieces.

Run each test before its implementation. The placement tests check capacities, prices and search
bounds against an exhaustive reference. The search tests compare the best result with trying
every mix. The fit tests check the two design examples, variant and course matching, equal-price
stability, pins, invalid input and the required menu count. The bound tests cover the agreed
40-menu, five-type, 200-dish bill and the 47-menu arithmetic boundary. Run focused coverage and
mutation on the fit files, the error guards and shared typecheck. Measure fit and refit in a
scratch Chromium page at 4× CPU throttling. CI runs the package suite. Adjust the mutation shard
only if the plan's six-minute measurement calls for it.

One PR, estimated at 550 production and configuration lines plus 450 test lines. The five tasks
in the implementation plan are test-first steps in that PR.
