# A1515-2 Set-menu grouping implementation plan

Lane F A1515-2 asks for “choosing counts, à la carte dishes, menu discounts, the takeaway rate rule,
the closest-to-saved tie-break and the size fallback. Shared code with no screens.”
[Design §§4 and 6](../specs/2026-11-24-set-menus-automatic-grouping-design.md).

**Finish line.** Choose menu counts and prices from linked offers and return a usable bill at the
search limit. Later pieces handle linking, saving, whole-bill adjustments, screens and payments.

**Files and contract.** Add `groupSetMenus(input: SetMenuGroupingInput): SetMenuGrouping` in
`packages/shared/src/set-menu-grouping.ts` and export it and its types from `index.ts`. Extend
`set-menu-fit.ts`, `set-menu-search.ts` and `set-menu-placement.ts` in the same folder. Reuse their
offer and place types, product/variant matching, counted dish classes, placement solver and mix
search. The existing fixed-count caller keeps its current contract until the server switches.
Take canonical product course, à la carte charge after individual adjustments, eligibility, extras
and resolved takeaway rate for each portion. Take discounts (comp, percent or fixed) by ID and offer
and the saved menu IDs, dish places and discount holders. Return priced menus and every dish's
placement or à la carte charge, extras, unused discount IDs, total cents and `exact`.

**Search.** Let an unused menu take one count and zero places. Solve ordinary placements at each
viable count with a separate à la carte cost for each dish class. Match exact variants and canonical
courses. Measured and individually adjusted dishes go à la carte. On takeaway, split offers by
rate, so each menu has one rate. Pay the full base even with empty places. Exclude entirely empty
menus. Preserve class compression for identical choices.

Apply each discount once, to one menu of its offer. Price it on base plus that menu's actual
supplements using `percentOf` and cent converters, cap fixed reductions at that sum, and zero it
for a comp. Charge extras separately. For a discount that cannot be priced as separate dish
costs, try the feasible fills of that discounted menu and pass the remaining dishes to the
same solver. A 1,500¢ discount on a 1,401¢ menu with a 300¢ supplement leaves 201¢. Charging
the supplement at its full price after reducing the base would leave 300¢.

Compare cents first. Among equally priced mixes, use saved menu slots for dishes that can return
to their own menu and line. Consider which saved IDs to open only when one can retain a dish or a
discount. Preserve saved à la carte choices too. Prefer more unchanged dish places, menu IDs and
discount holders in that order, then stable ID order. Reuse an ID only for its offer.

**Search limit.** Use the existing mix cap and count additional discounted or saved-slot solves
against it. Keep the last best complete grouping in a search that anchors valid saved places.
Compare whole-menu fills there, so a first order can get a menu cheaper than all its dishes.
On exhaustion return that compatible answer with `exact: false`. With the same bill and saved
answer, keep its prices and placements. The watcher settles whether discounts can stack when
fewer menus remain. The plan proposes one discount per menu with the rest reported unused.

**Worked bills.** After clearance write failing tests in `set-menu-grouping.test.ts` and extend
the existing bound and placement tests. Keep the fixed-count tests and their assertions.

- Two 900¢ dishes take one 1,400¢ menu even with an open dessert place. A lone 900¢ dish or one
  with a supplement over 900¢ stays à la carte. A 600¢ soup, 1,500¢ hake and 500¢ flan cost 1,400¢
  grouped or 1,850¢ after a half-price hake leaves the grouping. Check comp and variant exclusion.
- A 1,401¢ menu, 300¢ supplement and 200¢ extras total 1,050¢ at half off, 401¢ at 1,500¢ off or
  200¢ comped. With one fixed discount and two menus, put it on the supplemented menu for 1,802¢.
- A 1,000¢ starter at 10% and 1,000¢ main at 21% group for 1,400¢ eat-in or cost 2,000¢ takeaway.
  A pair at each rate forms two takeaway menus. Compare small cases to exhaustive priced bills.
- Use a non-default saved layout with two equal menus, saved à la carte and a discount holder.
  Show a different tie without the saved layout and a move for a one-cent saving. Refit the result.
- Fit and refit eight diners with five courses and two overlapping offers exactly within 500 ms
  each. Force the cap internally on a first order and a changed saved bill. Assert the best
  compatible full price found, including opening a whole menu and releasing an invalid place.

Run `pnpm --filter @waitron/shared exec vitest run src/set-menu-{grouping,fit,fit.bound,placement,search,bill.move}.test.ts`.
Estimate 350–450 production lines and 220–300 test lines.
