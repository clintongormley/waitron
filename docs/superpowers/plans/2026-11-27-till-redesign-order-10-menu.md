# Till redesign, order screen PR 10: the menu slides up

**PLAN FOR APPROVAL — awaiting the watcher's clearance.** Lane N, item TILL-REDESIGN-ORDER, PR 10 of
the [split](2026-11-26-till-handheld-redesign-pass-1.md) (“Browse or search three-column tiles from
the slide-up menu, with Home, section path, counts and Last added. Keep the sold-out action
reachable.”). Design: [§5](../specs/2026-11-26-till-handheld-redesign-design.md#5-the-menu-and-dish-options),
§8, §14.1 (“`d` and `m`: the menu path's Home is a home icon”), §14.2 and §14.4 “The menu”. It is
three times the split's three hours, so it lands as **10-0**, **10a** and **10b**, in that order,
each alone. Line numbers are main at `490f233084`.

## What staff can do when it lands

**10-0.** Nothing yet: the shared sheet look, in `packages/ui`.

**10a.** Everywhere the till shows its menu (a table, side by side or not, and Counter): tiles
drawn as `d` 2 draws them, a dish's count as a teal circle on its corner, sections as white tiles
with a folder, a search box with a magnifier and the filter beside it, and inside a section the path
“⌂ › Starters › Cooked starters” with a home icon. Search still shows tiles, across every menu.

**10b.** On a table screen narrower than 720 px, **Menu** slides the menu up over the order. At its
foot, **Last added** shows the dish just added with − and + (a bin at 1), and **Order · 5 new ·
€50.10** slides it back down. Until lane N's 9a gives the order its foot, the menu opens from
today's **Menu** button at the top of the order.

## The frames each element builds to

Measured in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`
(`d-light.html`, `m-light.html`, `s-light.html`, `base.css`). Turned down, never built from: `d` 3
(Last added at the top); `s` 2's search results as rows (§5: results are tiles); `m`'s tabs (§14.1).

- **Sheet** (10-0, 10b): `d` 2 (`.sheet-top`, `.handle`): top corners 16 (`--wt-radius-lg`), an
  upward shadow, the 40 × 5 sunken handle. Lane D's tokens already hold these:
  `--wt-menu-sheet-handle-width/-height` and `--wt-menu-sheet-shadow`
  (`packages/ui-core/src/tokens/structure.css:50–51`, `:143`). Fill `--wt-color-bg`, as drawn.
- **Search** (10a): `d` 2 (`.search`): 44 tall, radius 8, 1px border, an 18 magnifier, “Search the
  menu” muted. It is `wt-input`'s `variant="outlined"` with `search` in its `start` slot
  (`packages/ui-core/src/components/wt-input.ts:48`, design-system.md:942). **Filter** beside it:
  `m` (`.srow .ib`, a 44 outlined square), on the phone too (see question 3).
- **Path** (10a): `d` 2 (`.crumbs`): 15 bold, earlier steps `--wt-color-primary-text`, the current
  one `--wt-color-text`, separators muted regular. Home is a new `home` icon (house outline), named
  “Home” / «Inicio» (`menu.home`). Shown inside a section only, as today; `d` draws no home view.
- **Tiles** (10a): `d` 2 (`.tiles`, `.tile`): three across at 390 px, 76 tall
  (`calc(var(--wt-tap-min) + var(--wt-space-6))`, growing for a long name as today), radius 8, gap 8
  (`--wt-space-2`), name `md` bold, price `sm`. Till widths: `m` (`.tiles5`, five columns) and
  `s` 1 (three, upright). Columns stay `HOME_GRID_COLUMNS`
  (`packages/shared/src/menu-document/device-home.ts:173`), which the dashboard preview shares; at
  gap 8 it still gives 3, 3, 6 and 7 columns at 360, 390, 792 and 1440 px. **Section tile**: `d` 2
  (`.tile.folder`): `--wt-color-surface`, 1px border, `menu-section` muted over the name, never
  painted (question 2). **Count**: `d` 2 (`.badge`): `wt-count-badge tone="notice"` centred over the
  tile's top end corner, a 2px page-coloured ring. Sold-out and filtered-out tiles keep today's
  look (design-system.md:550–556); no frame draws them.
- **Last added** (10b): `d` 2 (`.last`): a full-width `--wt-color-surface-lifted` strip, “Last added”
  in small capitals over the name (`lg`, bold) and its options (`sm`, muted), and `wt-stepper` (7a's,
  `packages/ui/src/components/wt-stepper.ts:16`) at the right, its − a bin at 1 as 7a's opened row.
- **Order foot** (10b): `d` 2 (`.dock`): `wt-foot-button-bar` holding one full-width outlined
  button, `chevron-down` and “Order” at the start, “5 new · €50.10” muted at the end.
- **Menu picker**: no 2026-11-26 frame draws it. Today's `till-menu-switcher` moves to its own
  full-width line above search, where A1624's box goes (its frame 1, `2026-11-27-period-line/`).

## The change

**10-0. A sheet look for the full-screen panel**

1. `wt-full-screen-panel` (`packages/ui/src/components/wt-full-screen-panel.ts`, 70 lines) gains a
   reflected `sheet` boolean: rounded top corners, the handle above the `header` slot (hidden from
   screen readers, not focusable), the upward shadow, and a slide up from below on first draw unless
   reduced motion is asked for. Placement stays the parent's. Without `sheet` nothing changes for
   its users (lane D's panels, `widgets/quiet-pay.ts`). A workbench example and its
   `design-system.md` row.

**10a. The menu's look, in new files**

2. **Tiles move out of the browser.** `menu-browser.ts` is 1,481 lines against a 1,500 cap
   (`scripts/product-file-size-limits.json:46`); open PR #4528 cuts it to 1,231 and the cap to 1,250.
   New `apps/till/src/widgets/menu-tiles.ts` takes the tile templates (`#productButton` `:1033`,
   `#sectionButton` `:1093`, `#setMenuTile` `:1238`) and their styles (`:302–424`) as exported
   functions, drawn to the frames above. Their behaviour is unchanged: a tap adds, a sold-out tile's
   tap opens the dish's information (`:1061`), holding or Shift+F10 opens it (`:166–167`,
   `:1049–1052`). The reserved space above a counted name (`:343–347`) goes, since the count sits on
   the corner. The browser is reshaped, not replaced: its indexing, cross-menu search, set-menu
   folders, weighing keypad and information window (`:557–1000`) stay as they are.
3. **The path.** New `apps/till/src/widgets/menu-path.ts` draws `#sectionView`'s breadcrumb
   (`:1193–1212`) with the home icon; every step stays a button at least `--wt-tap-min` tall. `home`
   is registered once in `packages/ui/src/components/wt-icon.ts` (`:119–132`).
4. **The top of the menu.** In `render` (`:1361–1386`), the picker slot gets its own line and the
   side-by-side toolbar rules go (`:197–246`); search becomes outlined with the magnifier and
   placeholder; the `filters` slot stays beside it. `menu-browser.ts` ends shorter than it started.

**10b. The sheet on the narrow table screen**

5. **The sheet.** New `apps/till/src/screens/table-menu-sheet.ts` exports a template and its styles,
   as `widgets/service-period.ts` does, so the browser stays in the screen's own shadow root (the
   test helpers and `openSetMenuPlace` find it there, `till-table-order-screen.ts:4382`). On Menu
   below `DRAFT_SIDE_BY_SIDE_MIN_WIDTH` (`:275`) it draws `wt-full-screen-panel sheet`, fixed to the
   window `--wt-space-3` below its top and above `--wt-keyboard-inset`. Its body scrolls: the
   service-period line (question 1), then the browser, whose picker, search and path stay at the
   top while tiles scroll. Its `footer` holds Last added and the Order foot. The order stays
   `hidden` behind it, as today (`#ordering` `:3210–3231`).
6. **The Order foot.** Its count is `newOrderItems` (`state/new-order-count.ts:15`). Its amount is
   `panelTotal("0.00", lines, this.#setMenuPrices(lines))` (`state/draft-layout.ts:182`), the sum the
   draft rows show, so a set-menu dish counts at its placed price. A tap runs `#showOrder` (`:4335`).
   It replaces the New order bar, `#newOrderBar` (`:4222–4257`), `#bottomBar` (`:4215–4220`) and
   their styles (`:1234–1272`). The bar's **Send all** goes: `d` 2 draws none, and the order keeps
   its draft bar's Send all (`:4947`). The screen ends no longer than it started (7,445 of its
   7,500 cap; #4535's head is 7,450).
7. **Scroll and focus.** `#showOrder` and `#showMenu` (`:4387`) save and restore the sheet body's
   scroll, not the page's. Menu moves focus to the sheet's region, not Search, so no keyboard rises;
   Order returns it to the switch's Order button, as `:4345–4349` does today.
8. **Last added** (`widgets/last-added.ts`) takes the strip look and `wt-stepper`. + is disabled
   where `canSelectProduct` refuses (`:179`), the bin removes the line as −1 does at 1 today
   (`#step` `:131`), and a set-menu or weighed dish has no stepper, as today. Tapping the name still
   opens its row (`#openLastAdded` `:4268`). Counter uses the same strip (`till-counter-screen.ts:433`).
9. **Interim entry (watcher, 2026-11-27 22:08).** `#viewSwitch` (`:3235`), called from `#ordering`
   (`:3214`), is drawn on Order only, and its **Menu** button opens the sheet through `#showMenu`.
   That is the whole interim. 9a replaces the switch with the foot's Menu.

**Counter.** It gets 10a's tiles, path and search, and 10b's Last added strip, in today's layout
(`#menu` `till-counter-screen.ts:313`, `#gridBody` `:419`): no sheet and no counts, since it passes
no `inOrder`. N 9b brings the sheet there. **Side by side** (720 px and over) keeps today's
arrangement with 10a's look; PR 12 drops its Last added for the highlighted row (§8, `m`).

## What stays, and where

Adding a dish, set-menu folders and the held set-menu tile, search across menus, the diet and
allergen filter, the information window, Shortcuts / Full menu and their divider, the weighing
keypad, Not found, and the closed, ended and last-orders messages all stay in the browser, in the
sheet on a narrow table. **Sold out:** availability changes moved to the dashboard on 2026-11-27
(A1622, #4504), so the till's route is the sold-out tile and its information window, kept. Dish
options stay today's dialog until PR 11.

## Tests, failing first

| PR | File | Asserts |
| --- | --- | --- |
| 10-0 | `wt-full-screen-panel.test.ts`, `.a11y.test.ts`, new `.forced-colors.test.ts` | With `sheet`: corners, handle and shadow paint their tokens, the handle is unnamed and unfocusable, no slide under reduced motion; without it, none of them. Axe with and without, light and dark. A drawn top edge in forced colours. |
| 10a | new `menu-tiles.test.ts`, `menu-tiles.a11y.test.ts` | Tile height, radius and fill tokens; a section tile is never painted; the count's centre sits on the top end corner, never over the name, inside the grid; sold-out and filtered tiles keep today's paint; axe on plain, painted, counted, sold-out, filtered, section and set-menu tiles, both themes. |
| 10a | new `menu-path.test.ts` | Home is the icon, named “Home” / «Inicio», with no visible word; earlier steps teal and tappable, the current one marked; each step at least 44 tall. |
| 10a | `wt-icon.test.ts` | `home` draws. |
| 10b | new `till-table-order-screen.menu-sheet.test.ts` | At 390 px the sheet fills the window below its top strip inside the shell's drill-in; tiles scroll under a fixed search and path; the foot reads “5 new · €50.10” with a set-menu dish at its placed price, a measured line counting one, “Order” alone when empty; a tap shows Order once; with the keyboard up the foot sits above it; Spanish «Pedido · 5 nuevos». |
| 10b | `last-added.test.ts`, `.a11y.test.ts` | − and + step only the saved line; the bin removes it at 1; + disabled where refused; no stepper for a set-menu or weighed dish; axe, both themes. |

**Changed test checks**, each listed in its PR with `file:line`, old check and new:

- 10a: `menu-browser.test.ts:3161` (count inside the tile) becomes the corner check above;
  `menu-browser.toolbar.test.ts:96` (picker and search on one line at 390 and 768) becomes picker on
  its own full-width line with search and filter one line below; the breadcrumb cases
  (`menu-browser.test.ts:1164`, `:1183`) find Home by its name. `:3197`, `:3235` and `:885` (tile
  height kept, centred name, word wrapping) and `menu-browser.home-columns.test.ts:26` stay as they
  are.
- 10b: `till-table-order-screen.new-order-bar.test.ts` (14 cases) becomes the sheet file above, at
  least as strict: sticky foot, last tile uncovered, keyboard focus. Its three Send all cases
  (`:140`, `:153`, `:170`) are replaced by “no send in the sheet”; the order's own Send all keeps its
  checks. `till-app-bar-tables.test.ts`'s `data-menu-send-all` uses send from Order.
  `view-switch.test.ts:40`, `:107`, `:122` check the switch on Order only; `:161` restores the
  sheet's scroll and section. `data-last-added-step` (14 uses in 5 files) goes through one new
  helper in `till-table-order-screen.test-helpers.ts`.

## Strings, guides and docs

`apps/till/src/i18n/strings.ts`, English and Spanish: `menu.search_placeholder` “Search the menu” /
«Buscar en la carta» (10a); `table.menu_foot_new` and `_one`, “{n} new · {amount}” / «{n} nuevos ·
{amount}» (10b). 10b deletes `table.new_order_dish`, read only by the bar (`:4228`). Guides, English
and Spanish `table-service.md`: `{#phone-order}` (English `:571–593`, Spanish `:604–631`) loses the
New order bar and “Menu field beside Search”; a new `{#till-menu}` section, in both, says how to
search, open a section, go Home, read a count, change Last added and go back with **Order**. The
`help.menu.dishes` bubble (`i18n/help-strings.ts:33`, `:98`) stays true. `design-system.md`: the
Device Home Page and menu search paragraphs (`:559–618`) in 10a; “Table screen below the width”
(`:1217–1243`) in 10b.

## Size, review and pictures

Changed lines, production then tests then test support: **10-0** 25–40, 80–120, 0. **10a** 90–130
new or changed (about 200 more moved out of `menu-browser.ts`), 160–220, 10–20. **10b** 120–170,
250–330, 20–40. No risk trigger: the foot's amount reads the draft rows' own sum, and no total,
VAT rule, permission or request changes. Codex's run-it seat runs on each PR on its named risks:
10-0, the slide and the forced-colours edge; 10a, tap, hold and sold-out tap on the moved tiles;
10b, the fixed sheet inside the shell, scroll and focus across Menu and Order, and the keyboard.

Pictures go to the watcher, then lane P's finish review, then the owner. 10-0's workbench example,
light and dark at 390 px, goes to the watcher alone. 10a's and 10b's: phone 390 × 844 and 844 × 390,
till 1280 × 800 and 800 × 1280, light and dark, English and Spanish, beside `d` 2, `m` and `s` 1,
with Counter at 390 and 1280. Captures stay out of Git. Differences to list: the filter on the phone
(`m`'s, not `d` 2's); the 44px path against the drawn 40; `wt-count-badge`'s 24 / 12 against the drawn
26 / 14; the outlined search on the page ground against the drawn surface; the top strip showing the
page, not the dimmed order; the service-period line (question 1); and the till's five or six columns
against `m`'s five.

## Overlaps (whoever lands second rebases)

- **#4528** (lane E, A1515-4 slice 1) rewrites `menu-browser.ts` and its tests, and touches the order
  and Counter screens, `strings.ts` and `table-service.md`. 10a keeps the browser under 1,250.
- **#4535** (lane N, 8a): the order screen, `strings.ts`, `design-system.md`, `table-service.md`.
- **#4537** (A1631, Spanish words): `strings.ts`, the Spanish guides, `design-system.md`.
- **Lane N 9a** (no plan yet) replaces step 9's switch. **A1624** swaps the picker line's
  `till-menu-switcher` for its box. **A1626** removes Keep open from the service-period line.
  **PR 11** replaces the options dialog. **PR 12** moves the width rule and drops Last added side by
  side. **F 5f** opens a new order with Menu up: the sheet is that view.

## Open questions for the watcher, with the plan's defaults

1. **The service-period line** (“Open · until 13:00”, the zone, the receipt printer, Keep open,
   `widgets/service-period.ts:24–51`) is not in `d` 2. Default: it stays at the top of the sheet
   until A1624 and A1626 replace it, listed in the pictures.
2. **Section tiles** become plain white (§5, §14.4), so a manager's section colour no longer shows on
   the till. Default: build to the frame, listed for the owner.
3. **The filter on the phone**: `d` 2 draws none; it is the only route to the diet and allergen
   filter. Default: keep it beside search, as `m` draws it.
4. **The sheet piece**: 10-0 extends lane I's `wt-full-screen-panel` with lane D's sheet tokens,
   since neither the bill sheet (`wt-row-actions`, a list of choices) nor the panel draws a sheet that
   holds a scrolling page. Default: lane N builds 10-0, reviewed as lane I's 15a was.
5. **The dashboard's Device home page preview** shares the column rule but keeps today's tiles.
   Default: not changed in PR 10.
