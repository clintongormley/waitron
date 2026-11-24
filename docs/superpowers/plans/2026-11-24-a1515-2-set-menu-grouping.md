# A1515-2 Set-menu grouping implementation plan

Lane F A1515-2 asks for “choosing counts, à la carte dishes, menu discounts, the takeaway rate rule,
the closest-to-saved tie-break and the size fallback. Shared code with no screens.”
[Design §§4 and 6](../specs/2026-11-24-set-menus-automatic-grouping-design.md).

Choose and price menus from a bill's linked offers and return a usable bill at the search limit.
Later pieces handle persistence, whole-bill adjustments, screens, payments and fiscal changes.

**Files and contract.** Add `groupSetMenus(input: SetMenuGroupingInput): SetMenuGrouping` in
`packages/shared/src/set-menu-grouping.ts` and export the function and types from `index.ts`.
Extend `set-menu-fit.ts`, `set-menu-search.ts` and `set-menu-placement.ts` in that folder. Reuse
offer/place types, product/variant matching, counted dish classes, the mix search and the
placement solver. Keep the fixed-count till caller through piece 4. Take each portion's canonical
course, adjusted à la carte charge, grouping eligibility, extras and resolved takeaway rate. Take
typed discounts by ID and offer, plus the saved menu IDs, dish places and discount holders.
Return priced menus, each dish's nullable place and charge, extras, unused discounts, total and
`exact` for proven cheapest cents.

**Menu counts and placement.** Allow an unused, zero-price, zero-place count and up to one menu
per eligible portion. Skip mixes whose discounted bases alone cost more than those portions à la
carte. Give each class its own à la carte cost. Match exact variants and canonical courses.
Measured and individually adjusted dishes stay à la carte. Split offers by takeaway rate and
solve rates independently when no discounts link them. A nonempty menu pays its full base with
any open places. Compare cents first. On price ties, rank saved IDs by surviving dishes and use
individual slots for those IDs in one final placement. Keep that result only at the same price.
Prefer retaining dish places, including à la carte, then menu IDs and discount holders, then ID order.

**Menu discounts.** Limit each discount to one use across rates on its offer. Each menu's discount
covers its base and actual supplements, with whole-cent rounding once per percentage reduction.
Extras stay separate. Comps and fixed reductions up to the base price are additive. Use basis-point
costs for a single percentage and compare the final rounded price. When several percentages can
round differently or a fixed amount exceeds the base, vary only the supplement choices that can
affect that discount and send the rest to the same placement solver. Verify those prices against
exhaustive small bills. The watcher settles whether discounts can stack on a remaining menu.

**Search limit.** Keep the mix cap for enumerated count vectors. Reserve a smaller deterministic
placement-solve budget for finding a complete fallback, and check it on the large fixture below.
Start with valid saved places and test whole-menu additions so a first order can get a saving.
Use the best complete result found that keeps valid saved places when the exact price is still
unknown. A proven cheapest price stands even if tie-breaking stops early. On an unchanged repeat,
keep the saved fallback price and places. The watcher settles whether fallback can close a saved
menu that becomes dearer than its remaining dishes after a change. Ineligible or over-limit
portions keep their à la carte charges.

**Worked bills.** After clearance observe failures before implementing. Keep the old assertions.

- Two 900¢ dishes take a 1,400¢ menu with an open place. A third dish with a higher supplement than
  its à la carte charge stays out. Two linked menu types can both win on one bill. Soup 600¢,
  hake 1,500¢ and flan 500¢ cost 1,400¢ grouped or 1,850¢ after halving the hake. Check comps and variants.
- Base 1,401¢, supplement 300¢ and extras 200¢ cost 1,050¢ at half off, 401¢ at 1,500¢ off, or
  200¢ comped. With one fixed discount and two menus, the supplemented one wins at 1,802¢ total.
- A 1,000¢ starter at 10% and 1,000¢ main at 21% group for 1,400¢ eat-in or cost 2,000¢ takeaway.
  A pair at each rate forms two takeaway menus at 2,800¢.
- Two 1,400¢ menus hold a 900¢ starter and 1,500¢ main each. Cancel one main and keep the other
  menu and both its dishes at 2,300¢. Show a different tie without the saved layout, retain a
  saved discount holder and à la carte dish, and show a one-cent saving beats the saved fit.
- Fit and refit eight diners with five courses and four overlapping offers, including one
  percentage discount, exactly within 500 ms each. Force the budget on the 40-menu fixture.
  Check the fallback opens a 1,400¢ menu for two new 900¢ dishes, releases invalid places after
  cancellation, replays its own answer, and finishes within the fixture's existing 500 ms target.

Run `pnpm --filter @waitron/shared exec vitest run src/set-menu-{grouping,fit,fit.bound,placement,search,bill.move}.test.ts`.
Update the open pieces in `docs/backlog/menu.md` when this lands. Estimate 350–450 production and
220–300 test lines. Bring any growth outside the lane's limit back to the watcher.
