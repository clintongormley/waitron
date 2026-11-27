# Till redesign, order screen PR 10: the menu slides up

**PLAN FOR APPROVAL — awaiting the watcher's clearance.** Lane C, item TILL-REDESIGN-ORDER-MENU
(PRs 10–12 moved from lane N, watcher 2026-11-27 11:38 and 11:41). PR 10 of the
[split](2026-11-26-till-handheld-redesign-pass-1.md): “Browse or search three-column tiles from the
slide-up menu, with Home, section path, counts and Last added. Keep the sold-out action reachable.”
Design: [§5](../specs/2026-11-26-till-handheld-redesign-design.md#5-the-menu-and-dish-options), §8,
§14.1, §14.2, §14.4 “The menu”. Too big for one three-hour slice, it lands as **10-0**, **10a**,
**10b**, in order, each alone. Lines are main at `490f233084` unless a PR is named.

**When it lands.** 10-0: nothing on the till; the shared panel can look like a rising sheet. 10a:
wherever the till shows its menu (table, side by side or not, and Counter), `d` 2's tiles, a count
on each dish's corner (side by side too), plain section tiles, an outlined search with the filter,
and inside a section “⌂ › Starters › Cooked starters”. 10b: on a table screen under 720 px,
**Menu** raises the menu over the order, with **Last added** (− and +, a bin at 1) and **Order · 5
new · €50.10** at its foot. Until 9a's foot exists it opens from today's **Menu** button.

## Frames (`~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`)

Never built from: `d` 3 (Last added at the top), `s` 2's search rows (§5 says tiles), `m`'s tabs.

- **Sheet**, `d` 2 `.sheet-top` and `.handle`: 16 top corners, upward shadow, 40 × 5 handle, fill
  `--wt-color-bg`, from lane D's `--wt-menu-sheet-*` tokens (`packages/ui-core/src/tokens/structure.css:50–51`, `:143`).
- **Search**, `d` 2 `.search`: `wt-input variant="outlined"` (`packages/ui-core/src/components/wt-input.ts:48`)
  with `search` in `start`, placeholder “Search the menu”. **Filter**: `m` `.srow .ib`, 44 outlined.
- **Path**, `d` 2 `.crumbs`: 15 bold, earlier steps teal, current dark; from 720 px 16 (`lg`), as
  `m` and `s`. A new `home` icon named “Home” / «Inicio». Inside a section only, as today.
- **Tiles**, `d` 2 `.tile`: 76 tall (`calc(var(--wt-tap-min) + var(--wt-space-6))`), gap 8, radius 8,
  name `md` bold, price `sm`; from 720 px, `m` and `s` `.tiles5`: 84 tall
  (`calc(2 * var(--wt-tap-min) - var(--wt-space-1))`). Columns stay `HOME_GRID_COLUMNS`
  (`packages/shared/src/menu-document/device-home.ts:173`). **Section**, `.tile.folder`: never
  painted (§5, §14.4). **Count**, `.badge`: `wt-count-badge tone="notice"`, 6px outside the tile's
  top and end edges as drawn (`top:-6px; right:-6px`), a 2px page-coloured ring; the grid keeps
  `--wt-space-2` padding at its top and end so it is never clipped. Sold-out and filtered tiles keep
  today's look (`docs/developers/design-system.md:550–556`).
- **Last added**, `d` 2 `.last`: a `--wt-color-surface-lifted` strip, “Last added” in small capitals
  over name and options, 7a's `wt-stepper` (`packages/ui/src/components/wt-stepper.ts:16`) at the right.
- **Order foot**, `d` 2 `.dock`: `wt-foot-button-bar` with one outlined full-width button,
  `chevron-down` and “Order” at the start, “5 new · €50.10” muted at the end.
- **Menu picker**: no 2026-11-26 frame. Today's `till-menu-switcher` gets its own line above search,
  where A1624's box goes.

## The change

**10-0.** `wt-full-screen-panel` gains a reflected `rising` boolean: rounded top, a handle above
`header` (unnamed, unfocusable), the shadow, and a rise from below on first draw unless reduced
motion is asked for; without it nothing changes for its users. Not `wt-sheet`
(`packages/ui/src/components/wt-sheet.ts`, #1506, 2026-10-10): the floor-plan editor's expanding
bar, its body capped at 60dvh. Not lane D's `wt-row-actions` bottom sheet: a popover list of
choices. Who builds 10-0 is question 4.

**10a. The look, in new files**

1. **Tiles.** New `apps/till/src/widgets/menu-tiles.ts` takes `#productButton` (`menu-browser.ts:1033`),
   `#sectionButton` (`:1093`) and `#setMenuTile` (`:1238`); their styles (`:302–424`) move to
   `packages/ui/src/menu-tile-styles.ts`, so the dashboard preview can read the same copy
   (question 5). Behaviour is unchanged: a tap adds, a sold-out tile's tap opens its information
   (`:1061`), holding or Shift+F10 opens it (`:166–167`, `:1049–1052`). The space reserved above a
   counted name (`:343–347`) goes. Indexing, cross-menu search, set-menu folders, weighing and the
   information window stay where they are: the browser is reshaped, not replaced.
2. **One head block.** New `apps/till/src/widgets/menu-path.ts` draws the path (from `#sectionView`,
   `:1193–1212`) with steps at least `--wt-tap-min` tall; `home` is registered in
   `packages/ui/src/components/wt-icon.ts` (`:119–132`). The browser draws picker, search with
   filter, and path as one block above its content, replacing the toolbar rules (`:197–246`). With a
   reflected `pinned-head`, set only by the sheet, the block is `position: sticky; top: 0` on the
   page colour: one rule, no stacked offsets. `#revealTrail` (`:708`) targets the head's path.
3. **Counts side by side**, as `m` draws: the screen passes `inOrder` at every width
   (`till-table-order-screen.ts:3079` passes none side by side).
4. **Size.** About 300 lines leave `menu-browser.ts` and about 40 come in. #4528's head is 1,231 of
   its new 1,250 cap, so either order ends near 960.

**10b. The sheet on the narrow table screen**

5. **Where it sits.** New `apps/till/src/screens/table-menu-sheet.ts` exports a template and styles,
   as `widgets/service-period.ts` does, so the browser stays in the screen's shadow root. On Menu
   under `DRAFT_SIDE_BY_SIDE_MIN_WIDTH` (`:275`) it draws `wt-full-screen-panel rising` over the
   shell's drill box (`apps/till/src/widgets/till-shell.ts:455–460`: absolute, inset 0, its own
   scroller), `--wt-space-3` below its top and above `--wt-keyboard-inset`. The shell's header
   (help, operator menu, ☰; `till-shell.ts:1635–1658`) and notices strip (`:1662`, filled by
   `till-app.ts:24495`) stay above it and usable (question 6). What it covers in the screen is
   `inert`: the head (party menu, status, bill controls, Back, kitchen note; `:3120–3156`) and
   `#orderDock` (`:3286`); the order stays `hidden` as today (`#ordering`, `:3210–3231`). Panel
   header: the service-period line (question 1). Body: the browser, `pinned-head`. Footer: Last
   added and the Order foot.
6. **The Order foot.** Count `newOrderItems` (`state/new-order-count.ts:15`); amount
   `panelTotal("0.00", lines, this.#setMenuPrices(lines))` (`state/draft-layout.ts:182`), the draft
   rows' own sum, set-menu prices included. A tap runs `#showOrder` (`:4335`). It replaces
   `#newOrderBar` (`:4222–4257`) and its styles (`:1234–1272`). The bar's **Send all** goes (`d` 2
   draws none); the draft bar's stays (`:4947`). `#bottomBar` (`:4215`) keeps only the side-by-side
   case, Last added under browsing, until PR 12 drops it (§8). The screen ends no longer than it
   started (7,445 of 7,500; #4535's head is 7,450).
7. **Scroll and focus.** `#showOrder` and `#showMenu` (`:4387`) save and restore the panel body's
   scroll, not the drill's. Menu focuses the sheet's region, not Search, so no keyboard rises; Order
   returns focus to the switch's Order button (`:4345–4349`).
8. **Last added** (`widgets/last-added.ts`) takes the strip and `wt-stepper` with `removeLabel`: the
   bin removes the line, as −1 at 1 does today (`#step`, `:131`); + is disabled where
   `canSelectProduct` refuses (`:179`); no stepper on a set-menu or weighed dish. Counter shows the
   same strip (`till-counter-screen.ts:433`).
9. **Interim entry (watcher, 2026-11-27 22:08).** `#viewSwitch` (`:3235`, called at `:3214`) is drawn
   on Order only; its **Menu** opens the sheet through `#showMenu`. 9a replaces it.

**Counter** keeps its layout (`#menu`, `till-counter-screen.ts:313`) with 10a's look and 10b's strip;
N 9b brings the sheet. **Kept:** adding, set-menu folders, cross-menu search, the filter, the
information window, Shortcuts / Full menu, weighing, Not found, the closed and last-orders messages.
**Sold out:** availability changes moved to the dashboard (A1622, #4504, 2026-11-27); the till's
route is the sold-out tile and its information window, kept. Options stay a dialog until PR 11.

## Tests, failing first

- **10-0**, `wt-full-screen-panel.test.ts`, `.a11y.test.ts`, new `.forced-colors.test.ts`: with
  `rising`, corners, handle and shadow paint their tokens, the handle is unnamed and unfocusable, no
  rise under reduced motion; without it, none; axe both ways in both themes; a top edge in forced
  colours.
- **10a**, new `menu-tiles.test.ts` and `.a11y.test.ts`: 76 tall, 84 from 720 px; a section never
  painted; the count 6px outside the top and end edges, never over the name, inside the grid's
  padding box, side by side too; sold-out and filtered paint kept; axe on each tile state, both
  themes. New `menu-path.test.ts`: Home an icon named “Home” / «Inicio», no visible word; steps 44
  tall; 15, then 16 from 720 px. `menu-browser.test.ts`: with `pinned-head` the head stays while
  tiles scroll, without it the head scrolls. `wt-icon.test.ts`: `home` draws.
- **10b**, new `till-table-order-screen.menu-sheet.test.ts`, in the real shell at 390 px: the sheet's
  box is the drill's less the top strip; header and notices usable; the screen's head and dock inert;
  the foot reads “5 new · €50.10” with a set-menu dish at its placed price, a measured line as one,
  “Order” alone when empty; a tap shows Order once; the foot stays above the keyboard; Spanish.
  `last-added.test.ts` and `.a11y.test.ts`: steps change only the saved line, the bin removes at 1,
  + disabled where refused, no stepper on set-menu or weighed dishes, axe both themes.

**Changed test checks**, each listed in its PR with `file:line`, old check and new:

- **10a**: `menu-browser.test.ts:3161` (count inside the tile) becomes the corner check;
  `menu-browser.toolbar.test.ts:96` (picker and search on one line) becomes picker above search;
  `menu-browser.test.ts:1164` and `:1183` find Home by name; `new-order-bar.test.ts:308–311` (no
  count at 1280) expects the count. Unchanged: `menu-browser.test.ts:885`, `:3198`, `:3235`,
  `menu-browser.home-columns.test.ts:26`.
- **10b**: `new-order-bar.test.ts`'s 14 cases move to the sheet file, as strict, its Send all cases
  (`:140`, `:153`, `:170`) becoming “no send in the sheet”; `till-app-bar-tables.test.ts`'s four
  Send all cases (from `:438`) send from Order; `view-switch.test.ts:40`, `:107`, `:122` see the
  switch on Order only, `:161` restores the panel body's scroll, and `:264` loses its
  `[data-menu-send-all]` row. `data-last-added-step` (14 uses in 5 files) goes through one helper in
  `till-table-order-screen.test-helpers.ts`.

## Strings, guides, docs

**10a**: `menu.search_placeholder` (“Search the menu” / «Buscar en la carta») in
`apps/till/src/i18n/strings.ts`; `table-service.md` `{#phone-order}`'s “Use the **Menu** field
beside **Search**” (English `:589`, Spanish `:626`) fixed, and a new `{#till-menu}` section in both
on search, sections, Home and counts; `design-system.md` `:559–618` and the counts sentence
`:1232–1234`. **10b**: `table.menu_foot_new` and `_one` (“{n} new · {amount}” / «{n} nuevos ·
{amount}»); `table.new_order_dish` deleted (read only at `:4228`); `{#phone-order}`'s New order bar
paragraph (English `:577–579`, Spanish `:611–614`) rewritten; Last added and **Order** added to
`{#till-menu}`; `design-system.md` `:1217–1243`. **10-0**: the primitives table.

## Size, review, pictures

Changed lines, production / tests / test support: **10-0** 25–40 / 80–120 / 0; **10a** 120–170
(plus about 300 moved) / 180–250 / 10–20; **10b** 150–220 / 280–360 / 20–40. No risk trigger: the
foot reads the draft rows' own sum; no total, VAT rule, permission or request changes. Review:
`finish-branch`'s Codex run-it seat on each PR, given the split's named risks (question 7): 10-0 the
rise and forced colours; 10a tap, hold and sold-out tap on moved tiles, the pinned head; 10b the
sheet on the drill box, the inert parts, scroll and focus across Menu and Order, the keyboard.

Pictures to the watcher, lane P, then the owner (10-0's workbench example to the watcher alone):
390 × 844, 844 × 390, 1280 × 800, 800 × 1280, light and dark, English and Spanish, beside `d` 2, `m`
and `s` 1, Counter at 390 and 1280; never committed. **Differences to list:** the filter on the
phone; 44 tap height against the drawn 40; the badge's 24 × 26 and 12 text against the drawn 26
circle and 14; the till grid's 12 gap against `m`'s 10 (no 10px token); search on the page colour,
not surface; the top strip shows the page, not the dimmed order; the shell's header above the sheet;
no slide down on Order (it hides at once); the service-period line.

## Collisions (whoever lands second rebases)

- **#4535** (lane N, 8a) rewrites `#measure` to call `#showMenu` or `#showOrder` on a width change
  and adds two view-switch scroll cases (“shows browsing's scroll side by side when it widens on
  Order…”, “stays on Menu when it narrows again…”), which step 7 reworks; also `strings.ts`,
  `design-system.md`, `table-service.md`.
- **#4528** (lane E, A1515-4) shrinks `menu-browser.ts` and its cap (step 4) and deletes
  `openSetMenuPlace` (screen `:4376`, browser `:807`); also Counter, `strings.ts`, `table-service.md`.
- **#4537** (A1631) has merged (`aecc389ad8`): `strings.ts`, Spanish guides, `design-system.md`.
- **9a** replaces step 9, **A1624** the picker line, **A1626** Keep open, **PR 11** the options
  dialog, **PR 12** the width rule; **F 5f**'s “Menu up” is this sheet.

## Questions for the watcher, with defaults

1. **Service-period line** (open until, zone, receipt printer, Keep open;
   `widgets/service-period.ts:16–53`), absent from `d` 2. Default: the sheet's header, until A1624
   and A1626 replace it.
2. **The section colour field.** It is set in `apps/dashboard/src/widgets/section-details-form.ts:295`
   and read by the till (`menu-browser.ts:1094`), the Device home preview
   (`apps/dashboard/src/widgets/device-home-preview.ts:778`) and the Structure tree's swatch
   (`apps/dashboard/src/widgets/menu-document-tree.ts:299`). With plain section tiles only the tree
   shows it. Default: PR 10 leaves the field; whether to remove it is the watcher's to assign.
3. **Filter on the phone** (`d` 2 draws none; it is the only diet and allergen filter). Default: beside
   search, as `m`.
4. **Who builds 10-0.** The queue's rule: “lane D (13a-0) sheet, menu row … Never a lane's own copy”
   (`~/waitron-campaign-shared/watcher-handoff.md:52`). Default: lane D builds it, unless the watcher
   grants lane C an exception.
5. **Device home preview.** Default: it follows the till, reading step 1's shared tile styles (about
   30 more lines in 10a and the preview's tests).
6. **Shell header and notices above the sheet**, where `d` 2 draws neither. Default: they stay; they
   carry staff notices, help and the operator's menu.
7. **Review seat.** The split asks for two Claude run-it reviews; the house rule gives the run-it
   seat to Codex. Default: Codex's seat per `finish-branch`, given the split's named risks.
