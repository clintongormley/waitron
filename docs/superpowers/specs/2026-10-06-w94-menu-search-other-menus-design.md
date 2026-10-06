# W94 — Search the current menu first, then the device's other menus (design)

Status: design, 2026-10-06. Written from `main` 53c8f1e6d, which holds W93 (#1287, the Device Home
Page). The code is one pull request, branch `feat/service-menu-search`. It adds no storage and no
migration.

## The owner's item

> W94. Search the current menu first, then other menus available to the device.
> - Keep a search bar at the top of the live device's menu screen, above the Home and full-menu
>   blocks, including while browsing a section. Search the selected current menu first. Below those
>   results, group matching products from each other active, published menu available in the
>   device's current service context, labelled by menu. Search only offers the device actually
>   receives; never search all venue menus or unpublished drafts. Apply the same diet and
>   availability/ordering rules as ordinary menu browsing.
> - A result uses the offer, published menu version, menu-specific price and modifiers of the menu
>   group it appears under. If one product is on more than one menu, show it in each relevant group
>   with its own price and menu label; tapping a result from another menu adds or opens that menu's
>   offer without silently substituting the selected menu's price. Recompute results when selected
>   menu, service context, publication or availability changes. Give clear empty states for no
>   matches in the current menu and no matches anywhere.
> - The dashboard Home preview is scoped to its one draft menu and cannot know the live device's
>   assigned menus or zone. Keep its search preview current-menu-only with a short explanation of
>   that limit; do not fabricate other-menu results or require a device picker in the Home tab. The
>   live device alone gets cross-menu groups.
> - Test-first for current-first grouping, another visible menu, an unavailable/inactive/unpublished
>   menu excluded, the same product priced differently across menus, variant/modifier selection,
>   service-context changes, diet filtering and the preview limit. Inspect handheld and till widths,
>   both themes, keyboard and touch use. Trace `menu-browser`, menu filtering, zone offers and
>   order-line identity before changing their props. Update `docs/developers/design-system.md` and
>   `docs/backlog.md` in the PR. Own PR after W93 to avoid competing edits in the menu browser.

## What is already true (traced on 53c8f1e6d)

- **The search bar exists and stays put.** `till-menu-browser` draws one `wt-input type="search"`
  above its view on home and inside a section alike (`apps/till/src/widgets/menu-browser.ts:539`).
  A non-empty query replaces the view with results; clearing it returns to the same section
  (`menu-browser.test.ts`, `describe("search")`). It searches the staff name of the shown menu's
  products only, as one flat grid (`#results`, `menu-browser.ts:508`).
- **The device already receives exactly the menus it may sell from.** The till loads its zone's
  offers through `GET /api/service-zones/:zoneId/offers` or `GET /api/default-service-zone/offers`
  (`apps/server/src/till-api.ts`, both through `listZoneOffers`,
  `packages/venue-service/src/operations.ts`). The body lists every menu of the zone that is active
  and has a live published version, in the zone's order, with each menu's structure and home, and
  the offers of all of them, each carrying its `menuId`. Unpublished and deactivated menus are left
  out; that is pinned in `packages/venue-service/src/operations.test.ts` ("leaves a zone's
  unpublished menus out…", "sells nothing from a published menu once it is deactivated…"). The
  "service context" of this item is that zone: there are no menu timetables yet (W98).
- **The screens already hold every served offer.** `till-table-order-screen` and the counter's
  `till-card-grid` receive the full product set and the zone's `menus`, and narrow the products to
  the shown menu and the diet lens only when handing them to the browser (`visibleProducts`,
  `apps/till/src/menu-filter.ts`).
- **A till product already carries its own menu's selling identity.** `menuOfferToTillProduct`
  (`apps/till/src/api/client.ts`) gives each product its offer's `menuItemId`, its menu's live
  `menuVersionId`, its menu's price, variants and modifiers. A line sends only `menuItemId`,
  `variantId` and `menuVersionId`; the server finds that offer among the zone's and prices from it
  (`priceOrderLines`, `apps/server/src/working-order.ts`). It refuses an offer the zone does not
  serve with `service_zone.offer_not_allowed`, a version belonging to another menu with
  `management.request_invalid` (field `menuVersionId`), and a version no longer live with
  `menu.version_changed`. So a result tapped from another menu's group already rings up at that
  menu's price, with nothing substituted; `working-order.test.ts` ("prices the selected menu
  offer…") already sells an offer from a zone menu that is not the zone's default and asserts that
  menu's price. The selected menu is a filter on the device and nothing on the server knows it.
- **Nothing downstream assumes a line belongs to the selected menu.** Staff can already add lines
  from several menus through the menu switcher (a tab spanning menus is stated at
  `till-table-order-screen.ts`'s `products` property). Basket merging
  (`apps/till/src/state/working-order.ts`, `draft-lines.ts`), the till's offer index
  (`ZoneOfferIndex`, `till-app.ts`) and the stale-version check (`menu-refresh.ts`) key on
  `menuItemId` or the line's own menu; lookups by `product.id` only resolve a name, which both
  menus' offers of one product share. Search adds no new path.
- **The dashboard preview already says its limit.** W93 drew the Home tab's search as this menu
  only, with the note "This preview searches this menu only. A device may also show results from
  other menus available to it." (`apps/dashboard/src/widgets/device-home-preview.ts:449`), pinned in
  `device-home-preview.test.ts`. W94 leaves it as it is.

## The design

### The browser learns the device's other menus

`till-menu-browser` gains two properties:

- `menus: readonly TillZoneMenu[]` — every menu the device is served in its current zone, in the
  zone's order, the shown one included. Default empty.
- `servedProducts: TillProduct[]` — every served menu's products, with the same diet lens as
  `products`. Default empty.

`products` keeps its meaning (the shown menu's products), so the home and section views do not
change. Search reads the other menus as `menus` minus the shown one, each indexed with the same
`indexMenu` the shown menu uses, against `servedProducts`. A menu's structure names only its own
offers (an included menu's products are the including menu's offers), so each index holds only that
menu's offers, keyed by product, and the same product on two menus appears once in each group with
its own price. Products not sold separately are left out, as in browsing. A sold-out product stays
in its group, greyed and disabled, as a sold-out tile does everywhere (D12).

Each other menu's index is cached by the menu object and the `servedProducts` array. Both are
replaced whenever the screen's inputs change: a zone change loads a new offers body and a
publication or availability refresh replaces the products (`till-app.ts`, `#showCounterOffers` and
the table path, applying `withUnavailable` from `apps/till/src/state/menu-refresh.ts`), a diet
change hands a new filtered array, and a change of selected menu hands a new `menu` and
`products`. So the results follow every change the item names without a
recompute of their own.

### Results, current menu first

With only the shown menu served (`menus` holds one menu or none) the results are drawn exactly as
today: the "Search results" heading, one grid, "No products match" when empty.

With more than one menu served:

- The "Search results" heading stays, as the region's name.
- The shown menu's group comes first, headed "<menu> (this menu)". When nothing in it matches but
  another menu has a match, the group stays and says "No products match in this menu".
- Then one group per other menu that has a match, in the zone's order, headed with the menu's name.
  A menu with no match draws nothing.
- When nothing matches in any menu, there are no groups, only "No products match in any menu".

Each group is a `<section data-menu>` headed by an `<h3>`, so a screen reader lists the groups as
headings. The sections carry no `aria-labelledby`: two menus may share a name (the `catalogues`
table has no unique index on it), and two regions with one name break axe's `landmark-unique`
rule; an unnamed section is not a landmark. Two same-named menus therefore show two identical
headings; the zone's order keeps them apart, and naming menus distinctly is the venue's choice. A group
holds the same tiles, in the same column count and tile mode, as the shown menu's display uses: the
results are one list read in one style, and a tile shows its own menu's price.

Tapping a result works as tapping a tile does (`pickProduct`): it adds the product, opens the
modifier picker when it has variants or modifiers, or asks the weight. The product is the one from
its group's menu, so its line carries that menu's offer and version.

### The callers

`till-table-order-screen` (`#menuBrowser`) and `till-card-grid` (the counter's product-grid card)
pass `menus` (the zone's served menus they already hold) and `servedProducts` (their full product
set through the diet lens, with no menu filter, memoised as `products` already is so the browser is
not re-indexed on every render).

### What does not change

The server, the offers body, line identity, pricing and the dashboard preview. No new route, no new
field on the wire, no storage.

## Strings

| Key                        | English                         | Spanish                                  |
| -------------------------- | ------------------------------- | ---------------------------------------- |
| `menu.results_this_menu`   | `{menu} (this menu)`            | `{menu} (esta carta)`                    |
| `menu.no_results_this_menu`| `No products match in this menu`| `Ningún producto coincide en esta carta` |
| `menu.no_results_any_menu` | `No products match in any menu` | `Ningún producto coincide en ninguna carta` |

Another menu's group heading is the menu's own name, which is data, not a string.

## Tests

Test-first, in `apps/till/src/widgets/menu-browser.test.ts` unless named otherwise:

1. Current first: a query matching products on the shown menu and on another served menu draws the
   shown menu's group first, headed with its name and "(this menu)", then the other menu's group
   headed with its name.
2. Zone order and absent groups: three served menus, a match on the third only — the shown group
   says "No products match in this menu", then the third's group; the second draws nothing.
3. Nothing anywhere: "No products match in any menu", no groups.
4. One menu served (a regression guard, passing before the change): the results are drawn as
   before (heading, one grid, "No products match"); the existing search cases stay as they are.
5. Only served menus (a regression guard): a product in `servedProducts` whose menu is not in
   `menus` is never a result; adding that menu to `menus` makes it one.
6. Same product, two prices: one product offered at different prices on two menus shows once in
   each group, each tile with its own menu's price; tapping the other menu's tile adds a line whose
   `menuItemId`, `menuVersionId` and price are that menu's.
7. Variant and modifier selection: tapping another menu's product with variants or modifiers opens
   the picker with that menu's product, and confirming adds that product.
8. Availability and ordering: a sold-out product in another menu's group is greyed and disabled; a
   product not sold separately is not a result.
9. Recompute: re-rendering with a new `menus` (a zone change), a new `servedProducts` (a refresh
   that marks a product sold out) or a new `menu` and `products` (another menu selected) changes
   the groups; with Drinks selected, Drinks comes first as "(this menu)" and Lunch follows.
10. Search from a section: typing while a section is open shows the grouped results; clearing
    returns to the section.
11. `menu-browser.a11y.test.ts`: the grouped results, the "no match in this menu" group, and two
    other menus sharing a name pass axe in both themes.
12. Callers: in `till-table-order-screen` and `till-card-grid` suites, a search shows another
    served menu's group, and a diet lens hides a non-matching product from it.
13. The diet lens is pinned by 12. The preview limit is pinned by the existing
    `device-home-preview.test.ts` note case, written for W93. The exclusion of inactive and
    unpublished menus is pinned by the existing `operations.test.ts` cases named above; on the till
    only case 5 stands for it, and W94 adds no server test for it.
14. A counter zone change through the till app: the search's other-menu groups follow the new
    zone's menus.

The server side needs no new code and no new test: the pricing of another zone menu's line is
already pinned (above).

## Out of scope

Menu timetables and department membership (W98), device profiles choosing menus (W97), searching
customer-facing or kitchen names, and any change to the dashboard preview.
