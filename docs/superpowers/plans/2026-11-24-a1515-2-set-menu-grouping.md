# A1515-2 Set-menu grouping implementation plan

Lane F `queue.md`, A1515-2 asks for “choosing counts, à la carte dishes, menu discounts, the takeaway
rate rule, the closest-to-saved tie-break and the size fallback. Shared code with no screens.”
[Design §§4 and 6](../specs/2026-11-24-set-menus-automatic-grouping-design.md).

**Finish line.** Choose menu counts and price the cheapest bill, with a usable fallback. Later
pieces handle linking, persistence, bill-wide adjustments, screens, payments and fiscal changes.

**Files.** Add `set-menu-grouping.ts` and `set-menu-grouping.test.ts` under `packages/shared/src/`.
Export `groupSetMenus(input: SetMenuGroupingInput): SetMenuGrouping` and its types from `index.ts`.
Reuse `SetMenuOffer`, `SetMenuPlace` and the saved maps (null for saved à la carte). Keep
`fitSetMenus` serving `suggestMove` until pieces 3 and 4 switch over.

**Contract.** Take linked offers, saved assignments, discounts by ID and offer, and dish portions
with ID, product/variant, canonical course, à la carte charge after any individual adjustment,
that adjustment's marker, separately charged extras and resolved takeaway rate. Treat measured
lines as à la carte. Return total cents, `exact`, unused discount IDs,
menus with stable keys, offer, base, rate and applied discount ID and cents, and dishes with ID,
nullable place, supplement or à la carte charge, and extras. Generate new menu keys deterministically.

**Pricing.** Pooling places by offer and line at fixed per-dish prices loses each menu’s rates,
saved places and discount base (`set-menu-fit.ts:313–367`, `set-menu-placement.ts:44–55`). Try
à la carte, open places and new menus with or without an unused discount. Match exact
product/variant and canonical course within capacity. Keep individually discounted or comped
dishes à la carte. Each takeaway menu has one rate. Two menus can have different rates. Charge
full base plus actual supplements, even with open places. Use one discount per menu and each
discount once on its linked offer. In whole cents, cap fixed discounts at that sum, round the
percentage reduction once with `percentOf` and cent converters, and zero the sum for a comp.
Add paid extras separately.

**Search limit.** Keep valid saved places, drop empty menus and apply discounts by greatest
saving. Price remaining dishes in ID order at the lowest added cost of an open place, new menu
or à la carte. Use this fallback price to start the exact search with dishes free to move. Try
the fewest choices first, skip interchangeable new menus and prune subtotals above the best price.
On ties keep the most saved dish assignments, then same-offer menu IDs, then stable order. Reuse
`MAX_SET_MENU_MIXES` (250,000) to cap attempted choices. On exhaustion return the fallback with
`exact: false`.

**Worked bills.** After watcher clearance, see these cases fail before implementing, then pass.

- Six diners get three 1,400¢ and three 1,800¢ menus from overlapping offers plus a 400¢ drink.
  Assert 10,000¢ and `exact: true`. Two 900¢ dishes form one 1,400¢ menu even though either alone
  costs less à la carte. An unlisted variant or wrong canonical course forms zero menus. Soup 600¢, hake 1,500¢ and flan 500¢ cost 1,400¢ grouped or 1,850¢ all à la
  carte after halving the hake price. A comped hake also stays out.
- Base 1,401¢ + supplement 300¢ + extras 200¢ costs 1,050¢ at half off, 401¢ at 1,500¢ off or
  200¢ comped. Without the supplement, cap 1,500¢ off at 1,401¢. Across two menus of that offer
  with one supplement and extra, apply the 1,500¢ discount there for 1,802¢ total. Report an
  unused discount when its offer forms zero menus.
- A 1,000¢ starter at 10% and 1,000¢ main at 21% cost 1,400¢ grouped eat-in or 2,000¢ takeaway.
  A starter and main at each rate form two 1,400¢ takeaway menus, one at each rate.
- Reorder input and assert the same saved IDs and places on ties. A cent of savings wins. Force
  the limit and assert `exact: false`, valid places kept, invalid places released and the cheaper
  of a newcomer’s supplement and à la carte price charged.

Rerun `pnpm --filter @waitron/shared exec vitest run src/set-menu-grouping.test.ts src/set-menu-fit.test.ts src/set-menu-bill.move.test.ts`.
Estimate 250–320 production lines and 150–200 test lines.
