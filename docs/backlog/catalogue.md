# Menus and the catalogue — detail

The open entries are listed in [the backlog](../backlog.md), under "Menus and the catalogue". This file holds
their full text.

## A461 — product search shows what matches, finds categories on the till, and keeps ticks between searches

Covers the Products screen and the Menus screen's Structure table on the dashboard, and the till's home page.

Owner, 2026-10-10, queued for implementation. Three changes; the owner's choices between drawn
layouts are recorded as decisions. Setup used for the examples: category Drinks › Coffee holds
Espresso, Iced coffee, Add ice and Ginger tea; category Desserts holds Coffee cake.

**1. Dashboard Products search: a flat list of what matches.** Today a search for "coffee" shows
the Coffee category held open without its chevron and every product in it, because `wt-data-table`
with `searchOpensPath` pulls in every row below a match (`#treeVisible`,
`packages/ui/src/components/wt-data-table.ts`) and hides the chevron of a row it holds open. When
only the category's name matches, it already shows collapsed with its chevron. Decided:

- While a search is typed, the Products list is a flat list of the rows whose own name matches
  (a product still matches on its variant names, as today), ranked by closeness as today. Rows in a
  matching category are not shown unless their own name matches.
- Each row shows its category path after its name on the same line, moving to the next line only
  when there is no room: "Iced coffee  Drinks › Coffee", "Coffee cake  Desserts", and for the
  category itself "Coffee  Drinks". The owner chose this over the path beneath the name and over a
  matches-only tree.
- A matching category is a collapsed row with its chevron; opening it shows its contents indented
  beneath it, as in the tree.
- Clearing the search returns to the tree as it was.

The same goes for the Menus screen's Structure table (owner, 2026-10-10: "do the same for menus").
It also sets `searchOpensPath` (`apps/dashboard/src/widgets/menu-structure-table.ts`): while a search
is typed it becomes a flat list of the sections and items whose own name matches, each followed by
its path within the menu, with a matching section collapsed and showing its chevron. Those two
screens are the only users of `searchOpensPath` today.

**2. Till home page: sections in the results.** Today `#matches`
(`apps/till/src/widgets/menu-browser.ts`) searches product names only, so a section never appears.
Decided: matching section tiles and matching product tiles share one grid, ranked purely by how
closely the name matches (the owner chose this over sections first and over a section header with
its matches beside it). A section tile looks as it does on the home page. Assumed, not asked:
tapping a section tile opens that section and clears the search, as tapping it on the home page
does; a section the diet filter has emptied shows greyed and disabled, as on the home page; with
several menus served, each menu's section of results includes its own matching sections.

**3. Ticks survive a new search, on Products and on the Menus Structure table.** Today typing in
either search box empties the selection (`apps/dashboard/src/widgets/catalogue-browser.ts`,
`if (changed.has("search")) this.selected = []`, pinned by "clears selection on %s and keeps
selection mode on" in `catalogue-browser.test.ts`; `structureSelected = []` beside the search
box's change handler in `apps/dashboard/src/screens/menus-screen.ts`). On Menus, dragging is off
while a search is typed (`#reorderable`, `menu-structure-table.ts`), so ticks gathered across
searches are moved by dragging after the search is cleared, or with the Move action.
Decided: a ticked row stays ticked when the search changes or is cleared, so the owner can tick
results from several searches and then drag them all to one place. Read, not run: dragging a ticked
row already drags every ticked item, shown or not (`#moveDrag`, `apps/dashboard/src/widgets/product-list.ts`). Assumed, not asked, and to be confirmed with the owner at
the plan: a column-filter change keeps ticks too, for the same reason; "select all" still adds
only the rows shown; the selected count already shown in select mode is how the owner sees ticks
the current search hides; leaving select mode, Done, and a finished move or delete still clear
them as today.

## A462 — dashboard table toolbars: column chooser at the end, no Expand all, closing a branch closes everything in it

Owner, 2026-10-10, from screenshots of Products, a menu's Structure and Price overrides tabs, and
Modifiers → Extras. Five changes; the owner's answers of 2026-10-10 to the first draft's open
points are folded in.

**1. The Customise columns button sits at the right-hand end of every table's toolbar**, after the
search field. Today `wt-data-table` draws Filters, `toolbar-start`, Expand all, `toolbar-end`,
Customise, then search, and design-system.md (Tables, the toolbar-order paragraph) puts search last
on purpose, so Tab crosses the buttons on the first line before reaching search on its own line
when the table is narrow. Moving Customise after search changes that rule: at each width, the order
Tab follows must still match what is drawn, and the "Tab follows" cases in
`packages/ui/src/components/wt-data-table.test.ts` and
`apps/dashboard/src/widgets/catalogue-browser.test.ts` change with it. Owner, 2026-10-10: "we'll
almost never use this button, so it goes on the right" — at every width it is the last control,
drawn and reached by Tab after search; where search takes its own line, Customise ends that line.

**2. No Expand all or Collapse all on Products or a menu's Structure tab.** The top row ("All
products"; the menu's own name on Structure) opens and closes everything instead. Today that row
cannot be closed at all: both tables pass `rowCollapsible` returning false for the root row
(`apps/dashboard/src/widgets/product-list.ts`, `apps/dashboard/src/widgets/menu-structure-table.ts`),
so the top row needs a chevron. Owner, 2026-10-10: opening the top row opens only its own level,
like any other branch. Closing it closes every level, by point 3, so on both tables it is how to
collapse everything. A menu's Preview tab (`apps/dashboard/src/widgets/menu-document-tree.ts`) keeps
its Expand all (owner, 2026-10-10), so `wt-data-table` keeps the feature. The entry "The Menus Structure tree notices Collapse all only by watching its table
redraw" below then needs revisiting: closing the top row still closes many branches at once.

**3. Closing a branch closes every branch inside it**, on Products and on a menu's Structure tab,
so opening it again shows its categories or sections closed rather than as they were left.

**4. A menu's Structure tab has one button for Reorder and Select.** Pressing it shows the
checkboxes and the drag handles together, as Products already does (`catalogue-browser.ts` passes
one `selecting` state to both `.selecting` and `.reordering`); today `menus-screen.ts` keeps
`structureReordering` and `structureSelecting` apart.

**5. The header's Select all checkbox lines up with the rows' checkboxes, on every table** (owner,
2026-10-10: "do this everywhere"). Seen on Products at phone width with select mode on: the rows'
checkboxes sit at the start of the controls column with the drag handle after them, while the
header's checkbox sits further right, over the gap between them. The header and the rows are drawn
by `wt-data-table` (the select-all cell and the row-controls cell), so fix it there, with and
without drag handles, and pin the alignment in a test that measures both boxes.

## `mergeAllergenMaps` (`src/derivation.ts`) can list a source twice and order sources differently from run to run

- Found by #603 (`packages/catalogue`). **`mergeAllergenMaps` (`src/derivation.ts`) can list a
  source twice and order sources differently from run to run**: `recomputeProductDerivations`
  (`packages/recipes/src/recipes.ts`) feeds it ingredient rows in no fixed order, and #603's
  review measured, with three or more sources, barley/rye/wheat folded in two orders giving
  "barley, rye, wheat" and "barley, wheat, rye", and barley/rye/barley giving "barley, barley,
  rye". The comment now says so; the code is unchanged. Read only, not run: `writeItems`
  (`src/extras.ts`) and `writeLabels` (`src/options.ts`) each keep a refusal after their insert
  that looks unreachable now (duplicate and foreign ids are refused earlier and one write runs at
  a time). `MAX_MODIFIER_INTEGER` (`src/modifier-limits.ts`, 2147483647) and the extras
  contract's `whole` bound were PostgreSQL's integer maximum and have no stated reason on this
  engine; the test names "refuses a pick bound above what the column can hold" and "refuses a
  maxQuantity above what the column can hold" (`src/extra-contract.test.ts`) assume a column
  limit. `assertRefsExist` (`src/product-modifiers.ts`) still reads lists in sorted key order,
  which served PostgreSQL's lock ordering only. Four configuration-transfer cases (in
  `options.test.ts`, `product-modifiers.test.ts`, `extras.test.ts` and
  `extra-projection.test.ts`) pin an insert order that the importer's
  `pragma defer_foreign_keys` makes unnecessary for foreign keys — whether to keep pinning it is
  the owner's call. Test titles a comments-only change cannot touch: `describe("validateContainsTag
(Task 4)")` and `describe("validateDietOverride (Task 4)")` (`src/dietary.test.ts`), "settles
  a product id sent in upper case in the database" (`src/product-modifiers.test.ts`, the code
  settles it now), "rebuilds every lookup index without the tenant" (`src/migrations.test.ts`).

## The media library still reads every matching image for search and name sorting, inside the venue write lock

**The media library still reads every matching image for search and name sorting, inside the venue
write lock — OPEN (found 2026-09-23, task F1's review wave).** The unsearched date sort counts,
orders and pages in SQL, reading only the page's metadata. Search still scores and pages in
JavaScript, and name sorting still uses `Intl.Collator` for accented names.
`listImageTranslationGaps` still reads all rows of its selected columns. The route
(`GET /management-api/images`) uses `withTransaction`, the venue's exclusive write lock, so these
remaining scans can delay a sale. **Next action:** decide how far to push search ranking into SQL;
measure a way to bound name sorting without changing its results.

## A negative catalogue price can still be stored by a direct call

**A negative catalogue price can still be stored by a direct call — OPEN (left by #487).** A
negative catalogue price is never valid (owner ruling 2026-09-21); the product-create and menu-item writes in
`apps/server/src/catalogue-api.ts` refuse one at the request boundary. `createProduct` and
`updateProduct` (`packages/catalogue/src/operations.ts`) still accept and store a negative when
called directly — a seed, a script or a future caller — and `products.unit_price` carries no
`>= 0` check. Decide whether the screen belongs in the ops or as a `products.unit_price >= 0` check
beside the sibling price checks the other catalogue tables carry; the column is an integer count of
cents, so a check constraint is now the only thing that would refuse it at the database.

## Two price rules disagree about a value that is not negative

**Two price rules disagree about a value that is not negative — OPEN (found 2026-09-21, task N4).**
`isProductPrice` (`packages/catalogue/src/modifier-limits.ts:12`) allows at most two decimal places
and ten whole digits; `stringToCents` (the `decimal()` + `decimalToCents` pair) that the
screened catalogue writes use allows any number of decimals and twelve whole digits, and ROUNDS the
excess. So `POST /management-api/products` with `unitPrice: "1.999"` stores `2.00` without saying
so, while the product-editor route refuses the same value with `product.invalid`; an eleven-digit
price splits the same way, and `-0.00` is accepted by one and refused by the other. Widening the
four routes to `isProductPrice` would start refusing values that save today. **Next action:** decide
whether one rule should govern every catalogue price, and if so which — and check each dashboard
form against it before changing the server, since a server stricter than its own form is the
failure #485 met.

## Menus list Changes column and top-aligned rows (W87, #1191): left open

**Menus list Changes column and top-aligned rows — DONE (W87, #1191, owner 2026-10-04).** The Menus list
has a Changes column when the list is wide enough, holding an "Unpublished changes" link to the
menu's Preview tab.
The list takes one of three layouts by its own
width. From 50rem it has four columns and the name wraps so that they fit without sideways
scrolling, even for a long name. Between 30rem and 50rem it has Name, Status and Actions, with the
link on its own line under the state, so the link stays in view beside a long name. At 30rem or less
the state and then the link stack under the name.
Left open by W87: between 30rem
and 50rem a long menu name can still make the table wider than its box (measured in Chromium,
2026-10-04: by 20 px in English and 29 px in Spanish, at a 600 px window with hyphenated, spaced and
unbroken names and at 700 px with spaced and unbroken ones, where a hyphenated one did not
overflow), so the end of the live version's time scrolls under the pinned Actions column; the link
and the row menu stay in view. The existing 600 px case "keeps every menu row's menu on screen and
uncovered while the other columns scroll sideways" in
`apps/dashboard/src/screens/menus-screen.test.ts` requires that overflow. In that middle layout the
Status column, and on a phone the Name column, hold the Unpublished changes link but do not set
`activatesRow: false`, so a click beside the link opens the menu; the design system records this as
a deviation from its `activatesRow` rule, and whether it stays is the owner's call. The contrast of
that link, and of the product list's maker link, on a highlighted row is fixed (A306, #1336). The product
list's "Made at" column (`apps/dashboard/src/widgets/product-list.ts`) also does not set `activatesRow:
false`, so, judging by the code (not run), a click beside a short station name opens the product
editor, which the `activatesRow` rule in `docs/developers/design-system.md` forbids. Both predate
this branch (5b725d672, ca89633f1) and are left for an item of their own.

## A menu's Structure tab is one tree (W88, #1209): not checked

**A menu's Structure tab is one tree — DONE (W88, #1209, main `21b57d280`, 2026-10-05; owner 2026-10-04).**
Not checked: a drag with a touch pointer or on a
real touch screen; a drag does not scroll the page near its edge (nor does Products'); in Spanish at
390 px the Type column scrolls partly under the pinned Actions column, which is the table's own
sideways scroll; the heading's height with "Checking…" or "Could not be checked" was not measured
against the other states.
(2026-10-08, A334: Products now scrolls at a held drag's edge, with native touch checked at
390 px in both themes and languages. Menu Structure gained the same helper in A334b after the Preview bundle.)

## A menu's prices are one editable Price overrides field per row (W89, #1239): left open

**A menu's prices are one editable Price overrides field per row — DONE (W89, #1239,
2026-10-05; owner 2026-10-04).** Not checked:
the tab on the running dev stack — the product page opening from a Status link, a real save and
the re-read after it, and Undo against the real server (the look in Chromium used mounted widgets
only). (2026-10-08, A348: the Status link is gone; a row's ⋮ Edit product opens the product instead.)
W95's implementation now uses Price override / Precio propio for Preview clashes.
Left open, raised in #1239's review and not taken: a size with its own price decides whether
its clash comes from its product by matching the two clashes, which can be misread in a
rare setup where they match exactly — telling them apart needs the prices read to say which level
a clash came from.

## A product has one colour everywhere (W92, #1250): left open

Left open:

- In the Structure tree, closing the section form opened from a section's swatch puts focus on the
  row's ⋮ menu rather than back on the swatch that opened it. No test pins it.
- At 390 px the Structure tree clips a long name under the pinned Actions column, so a long name's
  swatch needs a sideways scroll to reach. The names clip with the swatches removed too (measured
  on the W92 branch, not on `main`) _(2026-10-06: W85e gives it 12 px more; it still clips)_
  _(2026-10-06, A294: a section's square now sits before its name, so this no longer applies to
  sections — A294's look pass saw a long-named section's square at 390 px; a product's square still
  trails its name, so it stays open for products)_.
- A case in `apps/dashboard/src/screens/catalogue-screen.test.ts` (near line 2135, added by #1087
  before W92) prints "[Unhandled rejection] Error: marker" in passing runs; the noise should go.
- Some dashboard pixel and drag cases W92 did not change failed once when run in parallel locally
  during the branch's work; the cause was not found. They passed in the PR's dashboard CI shard on
  its final head.
- **Done (W92a, #1259, 2026-10-05) — a sold-out painted till tile stays readable.**
- **Done (A292, #1310, 2026-10-06) — W92a's four look points.** A sold-out painted tile's stripe is
  `--wt-space-1` (4px) with a one-pixel `--wt-color-text` line beside it, so in both themes every
  palette colour's stripe either reaches 3:1 against the tile or is edged by a line that does; the
  dark theme's sold-out tile sits at the page's own level (`--wt-color-surface-sunken`); and the
  labels are centred (products.md, _Colour_).
- A292's look is the owner's to judge (#1310's "Looks for the owner to judge"; screenshots in lane
  C's `a292-shots/`): in the dark theme an available plain tile is only about 1.10:1 lighter than a
  sold-out one, and in the light theme a pale stripe shows mostly through the dark line beside it.

## Each menu has one Device Home Page (W93, #1287): left open

Left open:

- **A339 test-fixture follow-up:** `apps/dashboard/src/api/menu-read-controller.test.ts` and `live-queries.test.ts` still use handheld five/six in fake snapshots, including three distinct snapshots in the invalidation cases. These files were outside the branch and left unchanged. Replace those with valid, distinguishable snapshots using columns plus another display field, preserving every revision, read-count and late-answer assertion; do not collapse three distinct observations into two.
- The Home page tab's Till preview draws the menu at the frame's full width, but on a real till
  the menu shares the screen with the order: from 720 px wide the table order screen gives it three
  fifths (`apps/till/src/screens/till-table-order-screen.ts`), and on the demo counter at 1280 px
  its grid was 796 px wide, six columns at a setting of 10. So the Till preview can show up to
  about four more columns than the till does. Not changed, because the real width depends on the
  till screen's layout.
- On the till, opening a section from lower on the screen leaves the page scrolled, so the
  breadcrumb is out of view. I believe this predates W93: neither `main`'s nor W93's
  `apps/till/src/widgets/menu-browser.ts` scrolls on opening a section (read, not bisected).
- **A291 DONE (2026-10-06):** removed format-2 preview/republication and silent omission from till
  reads. Unsupported live documents refuse with `menu.reset_required`, localized in dashboard and
  till; the Menus list, selected menu, Preview and Home display the reset instruction. Catalogue and real management/till route
  tests cover the refusal; configuration export/import still leaves publications behind. Reset the
  venue instead of republishing old menus. Historical W93 Decision 5 has a dated superseding note.

- The dashboard's Home page preview (`apps/dashboard/src/widgets/device-home-preview.ts`) is a hand
  copy of the till's menu browser (`apps/till/src/widgets/menu-browser.ts`): the thumbnail, the tile
  painting, the section trail, the two-block home arrangement, the breadcrumb and about a hundred lines
  of CSS. A change to the till's tiles has to be repeated by hand, and no test sees the two drift
  apart. Proposed follow-up: move the shared logic and CSS beside `arrangeHome` in

## Two copies of the tree pointer drag — OPEN (W88)

**Two copies of the tree pointer drag — OPEN (W88).** W88 moved what Products and the Menus tree
draw during a drag into `apps/dashboard/src/widgets/tree-drag.ts` (the ghost, the row and gap marks,
the click blocked after a release), but each widget still has its own copy of the drag itself: the
press, the 5 px start, the target under the pointer, Escape, the release and the clean-up
(`#pointerDown` to `#gap` in `apps/dashboard/src/widgets/product-list.ts`, `#gripDown` to `#gap` in
`apps/dashboard/src/widgets/menu-structure-table.ts`). A shared helper, told how to map a row to a
target, would serve both.

## The Menus Structure tree notices Collapse all only by watching its table redraw — OPEN (W88)

**The Menus Structure tree notices Collapse all only by watching its table redraw — OPEN (W88).**
`wt-data-table` sends no event when Expand all or Collapse all opens or closes branches (only
`wt-expand-change` for one branch a person toggles), so `menu-structure-table.ts` adds a Lit
controller to the table and checks after every table update whether the current row is still
shown. An event from the table for "these branches changed" would be cleaner; it means a change in
`packages/ui`.

## An included menu can show its sections directly (A322, #1372): left open

Left open:

- A folder's fixed photo shows on the till only in Thumbnails mode, as a section's photo does.
- A home shortcut to a menu that is included in two lists of one menu opens the top-level copy,
  else the copy indexed last.
- Renaming or clearing the included menu's own customer names is not checked against the folders
  that fix some languages, so a folder can end up with no name in the default language. The
  missing-translations report lists it, and changing the default language is refused while it
  lasts, but the write that caused it is allowed.
- A fixed value that happens to equal the included menu's value when the dialog opens is saved
  back as "follow" the next time the dialog is saved: the dialog compares with the included
  menu's value and cannot tell the two apart.
- The live photo triggers for products and sections (media `0005` to `0007`) look up
  `products.image` and `sections.image`, which no index covers. The lookup stops at the first row
  naming the photo, so deleting or renaming a photo that nothing uses reads both tables in full.
  The folder photo's own lookup has an index (`section_members_folder_image_idx`). Its own item: a
  performance fix with a media migration.

## Products table toolbar and headings stay in view (W80, #1187): left open

**Products table toolbar and headings stay in view — DONE (W80, #1187, owner 2026-10-04); left
open:** `wt-data-table`'s opt-in `stickyHeader` is set only by the Products screen.
At every width the table's box is at least three tap targets tall. The dashboard shell
test, with a stub catalogue of 40 uncategorised products, no category open and no message above the
list, finds only the rows scrolling at 390×844 and 375×667, with about 27px to spare at 375×667
before W83 (a temporary test, not kept, measured 83px after it on 2026-10-04;
`docs/developers/design-system.md`, `stickyHeader`), so longer toolbar labels, a wrapped banner or a
message can still make the content column scroll. Not covered: in Select and move mode the toolbar wraps
taller and the content column overflows at 375×667 (figures below).
Other long tables (Orders, Staff, Payments and
the rest) keep scrolling with the content column until someone decides they should opt in too; each
would need its screen to give the table a bounded height, as the Products screen does.
Still open: at 375×667 the box gave few rows, short of the item's "enough rows to remain usable",
and a larger minimum does not fit that screen without the toolbar scrolling away. W83 (below)
shortened the toolbar. Measured on 2026-10-04 with a temporary test in the shell test's 375×667
setup (not kept), reading the rows' box below its headings: before W83, 117.5px of row area, which
held the All products row and no whole product row (rows are 69px); after it, 173.5px, which holds
the All products row and one whole product row. At 390×844 the whole rows, the All products row included, went from four to five.
In Select and move mode at 375×667 the content column overflows: by 129px before W83 and 25px after, in the
same temporary test; no kept test covers Select and move mode there. Whether
that is enough rows is the owner's call.

_2026-10-06, A303: Select now has its own action bar below Search, and grips occupy a separate
leading column. The W80/W83 measurements above describe the earlier layout; the 375×667
selection measurement has not been retaken._

## Products: Filters and Select at the start of the table's toolbar (W83, #1193): left open

**Products: Filters and Select at the start of the table's toolbar — DONE (W83, #1193, owner
2026-10-04); left open:** While the table is at least 768px wide, Filters opens a panel beside the
rows at their left; narrower, it opens full screen. One existing test assertion changed, for the
owner to review: the catalogue browser's toolbar-order test pinned the old order (search, Filters,
Expand all, Select, Customise) and now pins the new one (Filters, Select, search, Expand all,
Customise). Left open: on a phone the search is drawn under Expand all
and Customise while Tab reaches it before them (two reviewers judged this not a WCAG 1.3.2 or 2.4.3
failure, by stepping through with the keyboard and reading Chromium's accessibility tree; what a
screen reader says was not checked) _(2026-10-05, W85d: this now happens wherever the list is 40rem
wide or less, desktop windows with the sidebar showing included; those two reviewers judged it when
the layout existed only at phone width, #1193)_; and a desktop window narrow enough to leave the table under
768px gets the full-screen panel — at which window width that happens with the sidebar shown was
not measured. Also left open by W83's review, none started: (1) the table's Customise columns
button is icon-only beside these two but has neither their look nor a tooltip; (2) the icon button
and its tooltip are a stylesheet and a handler each caller wires by hand, not a `wt-icon-button`
component — the Products table's Select is a native `<button>` because `wt-button` does not pass `aria-pressed`
through, and the Structure tab's Reorder and Select toggles are hand-built icon buttons for the same
reason (a review probe confirmed `wt-button` drops `aria-pressed` on 2026-10-06);
(3) the 768px side-panel threshold is tied by hand to token sizes (768 − 7×44 − 12 = 448, just
above the table's 440px narrow-tree width).

_2026-10-08, A368: the search/Tab-order point above is closed. Search now follows Expand all
and Customise in markup at both widths; the remaining W83 points stay open._

## Products at phone width: a long name runs under the pinned Actions column (W85b, W85c, W85e): left open

**Products at phone width: a long name runs under the pinned Actions column, cut with no ellipsis —
DONE (W85b, #1243; W85c, #1245; W85e, #1275); left open:**

- Not covered by W85b: while a category is being renamed, its count and asterisk follow the name
  box and are not capped _(2026-10-05: since W72g only at desktop width; at phone width they sit on
  the line above the box and wrap in what the grip and folder icon leave of the room before the
  pinned column; since A294 the count is hidden at phone width, and the folder icon's slot is
  blank)_.
- The owner answered W85b's open point (a name got about 46 px at 390 px) "maybe (b) and (c)" (b:
  drop the product photo at phone width; c: narrow the tree's leading slots), and **W85e** (#1275,
  2026-10-06) did (b) and narrowed the arrow slot of (c). Categories kept their folder icon, so at
  phone width a product's name started one folder slot before a sibling category's. _(2026-10-06:
  A294 removed the folder icon, but its slot stays and holds the category's colour square, so at
  phone width a product's name still starts one slot before a sibling category's.)_ The grip and the
  8 px indent step were left as they were. The Structure tree's long names still clip at 390 px
  (W92's open point above).
  Left for the owner (the owner's answer was a "maybe"): keep, or undo, either half; hide the
  folder icon too at phone width so product and category names line up again (since A294 that
  slot holds the category's colour square, so this now means moving or hiding the square); narrow the indent
  step. Before/after screenshots: `~/waitron-campaign/w85e-shots/pair-*.png` (local).

## Catalogue: no two categories with one parent, and no two Active products, share a name (W72 to W72h): left open

**Catalogue: no two categories with one parent, and no two Active products, share a name — DONE
(W72, #1214; W72a, #1230; W72b, #1236; W72c, #1237; W72d, #1238; W72e, #1241; W72f, #1252; W72g, #1246;
W72h, #1247); left open:**
There is no unique index: each product row stores its folded staff name in `products.name_key`, and
the product check looks other rows up by that key. There is no
backfill: a row whose name has not been written since the column was added keeps a null key, and the
check does not see it until its name is next written (every product editor save writes it) or the
venue is reset. Stored data is not renamed: a venue that already holds
duplicates keeps them until someone renames one.
The guard W72d added (`scripts/id-columns-are-references.test.ts`) knows an id column only by its
name, so a reference named otherwise is still unseen.
Since W72c an imported print agent arrives with no node; the importing box's
own agent still enrols as a new row beside it, as it did before (read, not run).

W72h (#1247) stopped Chromium logging "ResizeObserver loop completed with undelivered
notifications" from the Products tree's category name box.
On 2026-10-05 A261-3 also observed this message while running
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/folder-made-at.test.ts
src/widgets/catalogue-browser.test.ts`: both the transition candidate and the previous
`c41ed54910fece4add9f1475bf18034992545e99` commit in a frozen-installed disposable checkout
reported 164 passing tests and logged the message. Its cause on that path has not been established.
On 2026-10-08 A349's six Preview, price-table and navigation suites also logged the message:
397 tests passed on its candidate; the same command at the preceding checkpoint
`43c54024eea8149e789163fdac46f3239300365c` in a frozen-installed disposable checkout passed
390 tests and logged it too. The command selected `src/widgets/menu-preview.test.ts`,
`menu-preview-top.test.ts`, `menu-preview-navigation.test.ts`, `menu-preview.a11y.test.ts`,
`menu-prices-table.test.ts` and `src/navigation.test.ts` with the dashboard's Vitest runner.
That comparison does not establish which observer causes it or its effect on the rendered screen.

## A customer-facing name with no text in the default language prints a blank goods line — OPEN (found 2026-10-01 by C122)

- **A customer-facing name with no text in the default language prints a blank goods line — OPEN
  (found 2026-10-01 by C122).** Under default Catalan, a customer name holding only Spanish printed
  `1 u` and the price with no name on the receipt, and stored `{"ca-ES":""}` on the sale line
  (`toInvoiceLineDescriptions`, `packages/catalogue/src/invoice-descriptions.ts`, then `lineName` in
  `apps/server/src/receipt-ticket.ts`). No save path writes such a row today (product and variant
  saves refuse it), only a direct write. It shows under the default language in the Missing
  translations list.

## `joinCustomerPresentationText` passes the requested language where the default belongs — OPEN (found 2026-10-02 by A172, not measured)

- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).** It calls `resolveSnapshotText(variant, locale,
locale)` (`packages/catalogue/src/product-presentation.ts`), the shape A172 fixed in
  `customerOptionSnapshotLabels`, so a locale blank in a variant's map takes the first stored
  language alphabetically rather than the default. The receipt fills the variant's text per
  receipt language before it gets there (`apps/server/src/working-order.ts`), so whether any
  surface shows the difference is unknown; reproduce before fixing.

## The default-change check counts deleted and switched-off things — OPEN (noted 2026-10-01 by C122; I believe this predates the branch)

- **The default-change check counts deleted and switched-off things — OPEN (noted 2026-10-01 by
  C122; I believe this predates the branch).** `listContentTranslationGaps`
  (`packages/catalogue/src/content-languages.ts`) has no `active` filter on top-level products,
  options lists, extras lists or a menu's sections, and keeps a variant whose product is deleted, so
  a deleted product's partly translated name blocks a change of default while the Missing
  translations list leaves it out. The case "a deleted product, which the default-change check
  still counts" in `packages/catalogue/src/content-translation-report.test.ts` pins today's answer.

## Language resolution follow-ons

- **Language resolution follow-ons**
  ([original design](../superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)):
  there is still no single shared rule: the receipt's `lineName`
  (`apps/server/src/receipt-ticket.ts`) and the kitchen ticket's `ticketName`
  (`apps/server/src/kitchen-print.ts`) try the exact language and then take the first stored one.
  Read in the code and not run: `resolveContentText` moves to another region of the same language
  (es-ES to es-MX), which the design rules out. Adding content translations does not translate
  Waitron's interface.

## Product folders, menus that include menus, and prep station routing: partly built (design approved 2026-09-30)

**Product folders, menus that include menus, and prep station routing: partly built
(design approved 2026-09-30).** The
[design](../superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. Slices
1, 2, 3a, 3b ([#1024](https://github.com/clintongormley/waitron/pull/1024)), 3c-1, 3c-2 (PF6,
[#1046](https://github.com/clintongormley/waitron/pull/1046)) and 3c-3 (PF7,
[#1068](https://github.com/clintongormley/waitron/pull/1068)) have landed. **Owner decision
(2026-10-01):** deleting only empty folders
stays immediate, including any routing rules attached to them; a confirmation is shown when the
selected folders contain products or subfolders. **Reversed 2026-10-06 (owner, A279):** a folder
holding only routing rules gets the confirmation, saying how many rules go with it; a folder with
nothing at all is still deleted at once. Each dev venue needs `wa-wt reset demo
<worktree-name>` after slices 1 and 2, and after slice 2 the owner's box needs a reset too: library
sections and their placements disappear and per-menu extras are retired. Reload tills running the
older build before using the new published document. Status and remaining work:

- **Deleting or moving a folder does not show which products change station** (slice 3a, approved
  R6). The delete dialog counts the routing cells removed but lists no products whose
  destination changes, and **Move to…** changes folder ancestry without a routing preview. Add that
  preview before extending these operations during service.
- **A future rebuild of `categories` can empty its routing rules.** `routing_cells_category_fk`
  uses `ON DELETE CASCADE`
  (`packages/venue-service/src/schema/routing.ts`); follow CLAUDE.md §3's rebuild rule and add a
  populated-upgrade check before another categories rebuild.
- **The Spanish menu preview's selected Preview tab showed clipped at 390 px** after programmatic
  selection, in a render on 2026-10-01; clicking it scrolled it into view. A base-build render was
  not run, so when it began is not established (geometry and screenshot:
  `~/waitron-campaign-e/receipts/finish-render-20261001/render-report.md`). Check restored selection
  visibility before changing the shared tab component.

## Sales classification and the menus plan — what they left open

**Sales classification and the menus plan — what they left open.** Both plans are complete (the
[menus design](../superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) (§11 wins
over §10, which wins over §1–§9; "category" in §1–§7 means SECTION) and
[plan](../superpowers/plans/2026-09-25-menus-categories-home-layouts.md); the
[classification design](../superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md)
and [plan](../superpowers/plans/2026-09-25-sales-classification.md)). Several entries are overtaken by
the 2026-09-30 folders design; what remains:

- **Classification.** `Product.categoryId` and `primaryCategoryId` always hold the same value, and
  `?descendants=1` on a category's products has no dashboard caller. A line's classification is
  recorded when it is added (M7v), so `sale_classification.invalid` refuses adding a line; whether
  the till's message for that refusal on the add paths is right is not checked. The demo seed
  (`apps/server/scripts/demo-seed/seed-sales.ts`), the other scripts that call `recordSale`
  directly (`record-one-sale.ts`, `settle-invoice-first.ts`, `daily-close-demo.ts`,
  `daily-close-z-demo.ts`, `modelo-303-demo.ts`) and `apps/server/src/fiscal-readiness-runner.ts`
  file sales without the issuance pass, so seeded demo lines carry no product id, classification or
  gross, and the Sales screen's category report shows every seeded line under Not recorded.
- **The category sales report (#738).** `wt-button` disables only its inner `<button>`, so a
  scripted click on the host still reaches a click handler; the Sales screen's print handler checks
  for itself, other screens relying on `?disabled` alone have not been checked. The spec (§6)
  wanted the category analysis printable with the daily close, but no daily-close print exists.
- **Photo-holding tables are named by hand in several places in `packages/media`** (the triggers,
  `listImageUsages`, `countUsages`, the live-query dependencies, the `before` lists in
  `module.ts`, the `ImageUsage` unions), and only a comment keeps `countUsages` and
  `listImageUsages` in step; one list those derive from, checked against the triggers, would make
  the next such table one edit.
- **`sections_owner_menu_fk` has no delete rule**, so deleting a menu that owns a section will be
  refused until one is chosen; nothing deletes a menu today. Media's triggers name `sections`, so a
  later rebuild of that table meets the trap `docs/developers/conventions-data.md` records.
- **A product reached through a section offers no extras list** (noted at #659, and already so
  before it, checked at `002b79f69`).
- **The Menus screen (#664).** Which section is being edited is not in the address, only the menu
  and the tab. Opening "Add to menus" sends one `getMenuStructure` request per menu, each reading
  the whole section graph (`readMenuStructure`, `packages/catalogue/src/menu-structure.ts`); one
  server read returning every menu's structure would make it one. A refused change's message sits
  under the menu's heading, above the tabs, so on a phone the tree sits between it and the list it
  names; if someone else exactly undoes a move while it is saving, the move's answer is shown over
  their change until the menu is next read; and no accessibility test covers that message.
- **The Price overrides tab (named Prices until W89; #670, #680).** The owner decided 2026-09-26
  that removing a product's last placement needs no warning before it clears the menu price and
  variant settings. Open: the main-category filter offers every category, not only those on the
  menu; the product editor's help lines are paragraphs beside their inputs, not linked to them (a
  `hint` shows only as the placeholder since C104, so moving them there would hide them whenever
  the field holds a value); a variant row is announced by its name alone; and,
  from reading only, a Columns panel wider than a very narrow screen would not shrink to fit, and is
  not re-placed on resize.
- **Publishing (#677).** After a publish the editor's heading shows the browser's clock until the
  next read; the status
  and preview reads build every menu's frozen copy inside `withTransaction`, the venue's write lock
  — about 21 ms median for 4 menus and 300 dishes on a dev laptop, not measured on the box; at
  phone width the list keeps a fixed room for the row menu, and a status sort falls back to a name
  sort. The configuration import (`apps/server/src/configuration-transfer.ts`, inside
  provisioning's `beforeCommit`) deletes every `catalogues` row, so a provisioning or demo-seed
  path that publishes a menu BEFORE the import runs fails the import's commit on the append-only
  `menu_versions` → `catalogues` key. `apps/dashboard/src/widgets/variant-form.test.ts` failed once
  in a local dashboard coverage run; which of its tests failed was not recorded. The one
  intermittent failure in that file whose cause is known, the Escape test, is fixed (A220f, #1075; see the
  flaky-test entry); whether it was this one is not known.
- **Home page shortcuts (Task 8, #722; rewritten 2026-10-06 for W93, which replaced named layouts
  and the profile's choice with one Device Home Page per menu).** The add-shortcut picker offers
  active products only, so a shortcut to a product switched off since, once removed, cannot be
  added again until the product is switched back on. How the Home page tab's preview draws such a
  shortcut was not checked.

## Copying some of a section's products into another section is not built

**Copying some of a section's products into another section is not built** (found by the menus
plan's closing sweep, 2026-09-27). The menus spec §2 asks to select all, almost all or some of a
section's products and add them to another section, creating it in the same flow if needed, with
the selection telling the section's own members apart from products reached through a nested
section. What landed is duplicating a section and §10.2's Add products flow. Since slice 2 any such
follow-up belongs in the owning menu editor. **Next action:** the owner decides whether §10.2's
flow replaces §2's copy.

## Content languages and the image library (#339, #344) — what is left open

**Content languages and the image library (#339, #344) — what is left open.**
[Operator guide](../content-and-images.md).

- **A new picture consumer has to add a real database reference, not just store a filename.**
  Products point at the image table through a foreign key on the picture's filename
  (`products_media_image_fk`, `ON DELETE RESTRICT`), which is what makes "you cannot delete a
  picture something is using" true. Any future screen that shows a
  library picture has to add the same kind of reference and a sentence naming the use, or that
  check will not see it.
- **The online language selector has nothing to select for yet.** The setting and the rule for
  choosing a language are built and tested; the customer-facing online ordering surface they were
  built for does not exist.
- **Left by A157's review:** the upgrade test `packages/media/src/schema/name-only-upgrade.test.ts`
  makes its scratch folder with `tmpdir()` rather than `scratchParent()` (`scripts/scratch-dir.mjs`),
  unmeasured either way; the list of hand-written migrations in
  `docs/developers/conventions-data.md` leaves out core `0036` and `0047`, catalogue `0013` and
  media `0004`, and A157's media `0005`. **Next action:** fill the list when next touching that
  file; the other needs a decision whether it is worth a change at all.

## Extras and Options — deliberate limits, and what is left open

**Extras and Options — deliberate limits, and what is left open.**
[integration contract](../developers/modifiers.md).

- **Clearing the Extras editor's Minimum choices box saves 0** (the save format's own default); the
  A66 plan's Review Focus item 3 reads as if a cleared minimum should be refused. Open for the
  owner.
- **The Options list's rows centre their contents rather than lining up by text baseline (D6).**
  When a server refusal adds an error line under an option's name, the dot and menu centre on the
  name and the error together. Expected from the CSS in `option-list-form.ts`, not looked at on
  screen. **Next action:** screenshot a row carrying an error and decide.
- **A stored empty options default is still possible** through configuration transfer, which
  copies rows without re-parsing them (the spec's D8).
- **The two list forms still share about a hundred lines of per-form plumbing**
  (`#primaryLanguage`, `#mapFieldErrors`, `#edit`, `#emit`, `#cancel`, the `willUpdate` reseed
  guard, the Escape-while-busy handler and the footer). **Next action:** decide whether a shared
  base or a controller is the right vehicle before a third list form is written; the row editors
  genuinely differ and should NOT be merged.
- **The seven string-parsing helpers are copied between the two contracts.**
  `packages/catalogue/src/extra-contract.ts` and `option-contract.ts` carry byte-identical copies of
  `invalid`, `record`, `keys`, `staffName`, `translations`, `kitchenName` and `id`, differing only in
  the error-code prefix. **Next action:** extract them, and decide at the same time whether
  `product-editor-input.ts`'s near-copies join them. A review also suggested moving
  `resolveExtraPrice` from `extras.ts` into `extra-contract.ts`, beside the price parsing.
- **`optionListDependants` and `listOptionLists`' usage count each select the carrying
  `product_modifiers` rows with their own condition on `option_list_id`.** Whoever writes a refusal
  that uses the same condition shares it then.
- **A list switched on with no pickable label is refused only by the parser.**
  `parseOptionListInput` is the only door today; a path that writes `option_labels.available`
  directly, or flips `option_lists.active` with a plain update, could leave a list nobody can answer.
- **`packages/catalogue/src/options.ts` still says `findContentTranslationGap` returns rather than
  throwing.** It throws `content.translation_invalid` for a non-text value.
- **The definition reads behind a dish's offered lists take no lock, and whether the storage
  switch closed the gap is unestablished.** `readMenuExtras`, `readProductExtras`,
  `readOptionListsByIds` and `readProductModifiers`, reached from `walkAttachedModifiers`
  (`packages/catalogue/src/offered-modifiers.ts`), are off the sale path since menus Task 7 except
  for an edit of a saved line whose dish the live version no longer offers (`productOptionLists`,
  `apps/server/src/working-order.ts`). The concern is a list edit committing mid-read, giving one
  order a snapshot mixing pre- and post-edit wording; not measured. **Next action:** trace those
  reads — if every one goes through `withTransaction` (the write lock), the entry closes on that
  alone; if any does not, decide deliberately.

## Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and `image-picker.ts`)

- **Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and
  `image-picker.ts`).** (1) When the picker is handed a new live-data source, the library keeps
  listening to the first one until its next load. (2) The delete confirmation's Close button has no
  in-flight check of its own and relies on being drawn disabled; two clicks dispatched by script in
  one task, confirm then Close, close it while the delete runs. **Next action:** decide whether (1)
  re-subscribes as soon as the source is replaced, and whether (2) gets a `busy` check like the
  modal's `wt-close` listener.

## A name stored under a regional code such as `en-GB` is read by the forms as the plain code first, then its regional ones

Left open by W77 (a folded Customer-facing names section shows every language's name, inherited
ones in italic, owner 2026-10-04; #1197; W77a #1206):

The only other folded section holding customer-facing names is the Product editor's Descriptors
section, whose Name row says "None specified" for a blank language by A211's decision; left as it
is (asked of the owner, 2026-10-04).
A name stored under a regional code such as `en-GB` is read by the forms as the plain code first,
then its regional ones (`languageText`, `apps/dashboard/src/widgets/form-fields.ts`). A till or
receipt asking for `en-GB` reads `en-GB` before `en`, so a map holding both can show one name in the
form and serve the other. An option's label, a variant and a menu section reach the same helper
through `optionalTextFields` but have no case of their own. Still reading the plain code only: the
unit form's names, the adjustment reasons' names
(`packages/adjustments/src/dashboard/reasons-screen.ts`) and the image library's names
(`packages/media/src/dashboard/image-library.ts`). Left from #1206's review, optional tidying: the
Product editor keeps a private `text()` helper doing what `languageText` does, and
`product-list.ts` and `extra-list-form.ts` make the same `resolveContentText` call inline for unit
names; folding them into the one helper was not part of W77a.

## A product literally named `Gin (Double)` and `Gin`'s `Double` variant have the same display label

From A357 (relative variant names, #1381):

Known edge from the second review: a product literally named `Gin (Double)` and `Gin`'s
`Double` variant have the same display label; saved/imported raw names satisfy the requested
scopes. A held-group summary combines their displayed quantities, retaining both line ids.
Choose distinct saved names for now. Any future restriction on composed labels needs an owner
decision about the naming policy; this change adds no such restriction.

## In Spanish a range's placeholder reads "8.00 – 12.00" with full stops, and a refused field is drawn about 14 px wider than the others

- Open, seen in #1368's screenshots on code this branch does not change (`wt-price-input`,
  `#focusField` and the placeholder line are untouched): in Spanish a range's placeholder reads
  "8.00 – 12.00" with full stops (the field's hint is written as typed, from W89, 53a76dce9a);
  a refused field is drawn about 14 px wider than the others, pushing its "?" to the right; and at
  390 wide a refusal's focus scrolls the table only part way sideways, leaving Spanish prices
  half-hidden behind the pinned Resolve column. (A344 removed the "?" and the Resolve column and keeps each price
  box on screen at 390 px; the wider refused field and the placeholder's full stops were not
  re-checked.)

## Closing a refusal's message now clears the outcome

- Open, from #1368's review (read, not tested): closing a refusal's message now clears the
  outcome, so a later save's "Saved …" message with its Undo can appear where before it stayed
  hidden — the docs say so, but no test covers that case. And when the message closes (its ×, or
  Undo replacing it), keyboard focus is not put back where it was, unlike the dashboard's alert
  toast. Next: a test for the first, and return focus to the field the save came from.

## A353 — Preview's changes: an "Undo" link that puts one change back to the live version

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version (owner,
  2026-10-07: "would it be possible to have an 'Undo' link as well?"; PARKED, not queued — owner
  2026-10-08: take it from here when a lane has room).** Started in lane D, then parked for A366.
  Its work so far is on a LOCAL branch only — `feat/menu-preview-undo` at `e04b3abe7`, in the
  worktree `waitron-feat-menu-preview-undo` (no push, no pull request): the plan, and the scalar
  and presentation Undo checkpoint. What was left at the park: the rest of its Task 2's controls,
  the structural Undo commands, and the server and dashboard wiring.

## `MenuPriceRow.active` and `MenuPriceVariant.active` are always true since A347 (#1392)

- Open, for the owner: `MenuPriceRow.active` and `MenuPriceVariant.active` are always true since
  A347 (#1392), so the dashboard's Inactive branches (`#active` and `activeOffer` in
  `menu-prices-table.ts`, the `active` conditions in `menu-price-inheritance.ts`) cannot be
  reached. Retiring them deletes the tests whose subject is an Inactive row, so it waits for the
  owner.

## In the real dashboard at a 390px window the table is 358px wide

- Open: in the real dashboard at a 390px window the table is 358px wide (read once in the
  dashboard's test browser; no test pins it). Whether one-word names keep their line there while no field shows a
  range has not been measured; with the full 390px a longer word such as "Hamburguesa" (about
  90px, against 76px kept for a name) breaks. Options for more room: less page padding on phones,
  or a shorter Actions heading.

## On the Structure tab at 390px the tree's own box scrolls sideways under the pinned ⋮

- Open, believed to predate A348: on the Structure tab at 390px the tree's own box scrolls
  sideways under the pinned ⋮, by design (`pinned: "end"`); in Spanish the Tipo column already
  sat under Acciones before A348 (measured at the commit before it), and Disponible now sits
  wholly behind it until the tree is scrolled. Letting long names wrap at narrow widths may free
  the room; not tried.

## What #1151 left open (2026-10-03)

- **The database still accepts a maximum of 0.** The CHECK on `extra_lists` allows `max_picks = 0`
  when `min_picks` is 0, and configuration transfer copies stored lists without the request check,
  so a stored 0 can still arrive; the form then shows the 0 and refuses to save until it is
  changed. Refusing it in the database is a table rebuild (CLAUDE.md §3's rebuild rule). OPEN,
  unqueued: the owner has not asked for it.
- **A very long number is cut off in the narrower box.** The request check accepts up to
  2147483647, which needs about 82px against the 66px between the buttons (measured by #1151's
  review); three digits need about 26px. Left alone because widening the box would undo the size
  the owner approved. OPEN, unqueued.
- At 390px the extras table's Price column runs past its scroll area's right edge until scrolled;
  #1151's review measured it on main before the change (452px against a 373px area) and smaller
  after it (388px). OPEN, unqueued; W49 changed the table's column sizing, but horizontal scrolling
  remains for the Price column at phone width. (2026-10-04: W75 added a Portion column and widened
  the table; not re-measured.)

## A disabled course keeps its name

**An Add course button beside the course dropdown (A212) — DONE (#1087); left open:** a disabled course keeps its name, because `kitchen_courses_name_key` covers disabled
rows too, so adding a course with a disabled course's name is refused as taken (measured
2026-10-03 with a throwaway case in `apps/server/src/kitchen.test.ts`: create "Mains", deactivate
it, create "Mains" again → `course.name_taken`); a deleted course frees its name (read, not run). Raised in #1087's review and not changed there
(its other point, `wt-combobox`'s `stable-width` missing from `docs/developers/design-system.md`,
A342 documented): the catalogue-screen test "ignores the closed window's late close…" catches its guard's removal only through an unhandled error, because the late close throws
before it changes anything a state assertion could see.

## Allergens and dietary preferences are edited in place (A213): what #1079 left open

**Allergens and dietary preferences are edited in place (A213) — DONE (#1079); left open by #1079
(raised in its review, not changed there):** on a variant's page an empty
line reads "None specified" while the grey hint under it gives the parent's values, which reads as
a contradiction — A211's "an empty value shows the parent's value" is the natural place to settle
it. And on a product's own page a reviewed-empty allergen list and one nobody has reviewed yet
(`allergens: null`) both read "None specified"; before #1079 both read "None selected", so this
predates it (checked against the old code in #1079's review). The variant hint already tells the
two apart ("Not yet reviewed", `editor.allergens_unreviewed`); the product line does not.
(2026-10-03, A211: a variant's closed Nutritional info line now shows the parent's values in
italic, but the open line still reads "None specified" above the hint, so the first point stands;
on a product's own page the closed line reads both cases as "None specified" too, as the open line
does, so the second stands.)

## Left open by #1188's review, none started (the pricing unit dialog, W66)

**The pricing unit is chosen in a dialog (W66, owner 2026-10-04) — DONE (#1188).**
The price field's unit button, and on a product with variants the unit button in the
variants table's Price heading, open one Pricing unit dialog holding the unit dropdown and Add unit.
Detail: design-system.md, the `wt-price-input` note under the product editor.
Left open by #1188's review, none started: (1) one kind of unit refusal reads "The server rejected
this value…", and on the price field after a price message "this value" reads as the price — a
unit-specific sentence needs the owner's wording; (2) the price field's own unit button does not
announce that it opens a dialog (`aria-haspopup`), while the heading's button does — needs an option on
the shared `wt-price-input`; (3) `EACH_CHOICE` is still exported from `variant-table.ts` though only
the product editor uses it; (4) the test title "…when the table's heading dropdown is hidden" still
says dropdown for what is now a button; (5) the product editor's VAT dropdown is not disabled while
saving (same on `main` before W66, not checked further).

## From #541's review, neither blocking

From **Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](../developers/products.md), under _Variants_.

- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call; and the rule that hides screen-reader text is copied into each widget that
  needs it (`grep -rln "clip: rect(0, 0, 0, 0)"`), where a shared one in
  `packages/ui-core/src/base-styles.ts` would be an optional tidy-up.

## The product list

From **Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](../developers/products.md), under _Variants_.

- **The product list.** It leaves a variant's allergen cell empty (`ListedVariant`,
  `packages/catalogue/src/product-types.ts`) — decide whether it should read a variant's effective
  allergens; a variant's name may sit a few pixels low in its row at 390px, not yet looked at;
  `listedVariantsOfProducts` (`packages/catalogue/src/operations.ts`) repeats the grouping
  `variantsOfProducts` (`packages/catalogue/src/variants.ts`) does — share one helper.

## A location's menu list is read by no sale

From **A sale needs a zone (lane B's B4, #571) — what is left open.** Every sale line is priced from the
menu offers of its order's service zone. Since W97 (2026-10-06), a sale with no `zoneId` takes its
device profile's starting zone when the profile has a department — the first of the profile's zones
still usable when that one is not — and is refused `device_profile.no_service_zone` when none is;
otherwise it takes the venue's counter-default zone, and a venue with none is refused
`service_zone.default_missing` (`resolveNewOrderZone`, `packages/venue-service/src/operations.ts`).

- **A location's menu list is read by no sale.** The location's list (`locations.catalogue_id`
  plus `location_catalogues`) is still read and written by `GET /api/products`, the management API's
  location routes (`apps/server/src/catalogue-api.ts`; no dashboard screen calls them since #297),
  configuration transfer, both provisioning seeds, two dev scripts and the `offerProducts` test
  helper. **Next action:** owner to decide whether to retire `location_catalogues` and those routes
  with `GET /api/products`.

## Two signals say whether a dish is sold by weight, and they can disagree in storage

From **Units and the old `pricing_unit` (#342, #375, #382) — what is left open.**

- **Two signals say whether a dish is sold by weight, and they can disagree in storage.** Since B4
  the order path reads only the unit (`priceOrderLines`), so no sale reads `products.pricing_unit`;
  `assignProductUnit` writes `product_units` without touching it, and reassigning a unit's products
  to another real unit does not update it either. The column is still written, derived from whether
  the unit has a scale mapping, which is lossy: a product sold by the litre records `each`. **Next
  action:** keep it in step with the unit or drop it; its removal is listed under the #297
  departments-and-menus row in A9, and whoever does it also cleans up the demo scripts and tests
  that use `pricingUnit` to pick a product.

## `createProduct` and `updateProduct` duplicate the legacy-`pricingUnit` fallback

From **Units and the old `pricing_unit` (#342, #375, #382) — what is left open.**

- **`createProduct` and `updateProduct` duplicate the legacy-`pricingUnit` fallback**, and the
  synthetic `EACH_UNIT` id is a literal in both `packages/catalogue/src/unit-validation.ts` and the
  till's `product-name.ts` with nothing pinning them equal. Since W75 (2026-10-04) `EACH_UNIT_ID`
  lives in that module, which the till already imports (`apps/till/src/state/working-order.ts`), so
  the till could import it instead of keeping its own literal.

## Smaller things #379 surfaced and did not take

From **The product editor and catalogue (#345, #379, #387) — what is left open.**
[Operator guide](../products.md); [developer guide](../developers/products.md).

- **Smaller things #379 surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale. A joined customer-facing line
  can mix languages when a locale exists on one half only. `wt-price-input` was built from scratch
  rather than on `wt-input`'s end slot. `modifier-limits.ts` holds a product rule as well as modifier
  ones. And four interface faults seen then: the products list heads its Name column "Description",
  "Top sellers" is rendered
  twice on the overview, the login screen shows an error before anything is submitted, and the
  recipe screen is not routed from anywhere.

## "May contain" survives in the data with no way to see or set it

From **Allergens and nutrition (#370, #377, #385) — what is left open.**

- **"May contain" survives in the data with no way to see or set it.** A product's stored
  allergens carry a `presence` field that can read `may_contain`, and the compact picker cannot
  show or set it; an allergen a manager adds is written as `contains`. Ingredients and the till
  still carry the old contains/may-contain distinction and the reviewed toggle; the old
  `dashboard-allergen-picker`'s one non-test consumer is the ingredient form
  (`apps/dashboard/src/widgets/ingredient-form.ts`). **Next action:** decide whether "may contain"
  stays a real product claim — if it does, the picker needs a control for it; if not, the field and
  its readers go. Decide in the same change whether to show again the dietary labels that follow
  from the ones picked (vegan implies vegetarian), which the old editor showed as "inferred" badges;
  the derivation still runs (`expandDietaryDeclarations`,
  `packages/catalogue/src/dietary-declarations.ts`).

## The product editor summarises the same values twice

From **Allergens and nutrition (#370, #377, #385) — what is left open.**

- **The product editor summarises the same values twice.** `renderNutrition`
  (`apps/dashboard/src/widgets/product-editor.ts`) renders a `wt-disclosure` whose `summary` joins
  the allergen and dietary names, and puts `<dashboard-allergen-dietary-picker>` inside it, which
  summarises the same two fields again; the ingredient form renders the older picker expanded.
  **Next action:** whoever adopts the shared picker for ingredients and the till picks ONE shape,
  and decides whether the product editor keeps both summaries.

## Decisions and deliberate limits

**Products: the tree's Name column lines up, and the Main category column goes — DONE (W84, #1199, owner
2026-10-04).** Seven existing test assertions that pinned the column changed, for the owner to
review (listed in the PR). A product whose category the dashboard's category list does not hold
lists under All products with no "missing" marker; the database refuses a stored product naming a
category that does not exist (`packages/db/src/schema/catalogue.ts:51`, a foreign key; not tried),
so this is expected only while the dashboard's category list is behind.

**Products: the Move dialog's destination categories (W82, #1210).** Two sibling categories with the same name are left as they are (owner: "leave it"): they still show as two identical entries, in the tree and in a search.

**Products: a category's Made at (W86, #1203).** The "some items made elsewhere" note does not look at whether the categories involved hold any products, so it can claim items that do not exist yet; the owner chose to keep these words (2026-10-05).

**Products: Show archived replaces the Status filter, and the Status column becomes Availability (A463, owner
2026-10-10).** Show archived starts off; on, archived products and variants are listed too, with View in place of Edit and Archive.
Availability is blank for an ordinary product, Unavailable when sold out, and Archived when archived,
also when it is sold out; the owner chose this column over badges beside the name. The Allergens filter
offers the column's three states (Pending / None / Declared) rather than one "nutritional info" filter,
so a product never checked stays apart from one checked and allergen-free. Dietary info's "Has" means a
categorised dietary origin from the product's recipe, or a Vegan, Vegetarian, Halal or Kosher override (owner); the list also counts a
ticked dietary declaration. Made at offers only the stations the column names for some product, not
every kitchen station, and matches the station the column shows, including a switched-off station a
product has no replacement for; the backlog entry marked that matching "assumed, not asked".

- **Task 13 (#903, standalone ordering).** A product's `ordering` is Public, Staff only or Not
  sold separately; Staff only behaves exactly as Public until guest ordering exists.

From "Extras and Options — deliberate limits, and what is left open"
([integration contract](../developers/modifiers.md)):

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected; an unanswered ACTIVE list refuses the order with `options.label_required`. An
  optional options list is a possible future change, not built.
- **A variant offers its parent's lists and cannot override them**; a per-variant attachment row
  is a possible later addition.

From A344 (#1375, a menu's Price overrides tab shows its clashes):

- Decided as built: a filter choice the person made earlier in the browser tab (the table keeps
  one for every menu) wins over starting on Clashes; the red line still gives the count. Under
  Clashes a product that clashes itself stays folded until opened, as the table folds any row
  that matches a filter in its own right. Once a load has had no clash, a clash that comes back
  (Undo, a live re-read) does not switch the filter back to Clashes.

From A345 (#1383, a menu with clashes cannot be published, from anywhere):

- Decided as built: a product with both a variant that follows its clashing price and a variant
  whose own price clashes is marked on its own price first, because a price typed there settles
  one of them; once typed, the mark moves to the variants.

From A294 (#1300, the Products and Structure trees show drag grips only in a mode):

- The Structure tree's section rows were deliberately not top-aligned: section names do not wrap
  there, and `apps/dashboard/src/widgets/menu-structure-table.test.ts` deliberately centres the
  included-menu name and note.

From the product editor tidy-up (A209 to A219, owner 2026-10-02):

- A209 (#1090) — No migration clears the categories variants already store, and none will be written (owner
  decision, 2026-10-03: no data-migration code before go-live, CLAUDE.md §3, and the dev venue is
  reset before then). The effective category (`effectiveProductColumns.categoryId`) and the
  editor's read ignore a stored one, and the next save of the variant's own page, or that
  category's deletion, clears it.
- A216 (#1057) — **Decided (owner, 2026-10-02):** "Each" with no unit, "per <unit>" with one.
- A217 (#1065) — The wording is "inactive", to match the rest of the dashboard (owner).
- A219 (#1065) — **Decided (owner, 2026-10-02):** the price comes before VAT, everywhere.

From A332 (#1430, "All products" holds a venue default colour):

- (3) the All products swatch sits one tree level left of the categories' swatches, by the table's
  indent rule. Owner ruling 2026-10-08 (A415): keep each square at its own row's indent, never one
  column, and every level has one.

From A204's W99 (#1358, queued menu publication), left open after W99:

- **Left as it is (owner 2026-10-07): a narrow window, and menus are not fiscal records.** A due
  version is served as live before anything records it (publication plan Decision 5), so if
  the box's clock is stepped backwards past its time before the activation duty records it, reads
  serve the previous version again until the clock catches up. A Codex review reproduced it against
  the real migrations. Closing it means reads recording what they serve, or a never-decreasing
  clock in the process.

From A222 (#1101, a variant always has its product's unit):

- No migration clears the unit rows variants already store: the owner chose this on 2026-10-03,
  as for A209's categories (no data-migration code before go-live, CLAUDE.md §3). The product, menu and unit
  reads ignore such a row, and the next save of the variant's own page, or its unit's deletion,
  removes it.

From variants as products (#511–#556):

- **A menu offer created with no price field at all is refused** (`management.request_invalid`);
  only an explicit `null` means "blank, charge the product's own price" — **decided 2026-09-23 by
  the owner:** _"we don't want to confuse 0.00 with `""`"_.

From units and the old `pricing_unit` (#342, #375, #382):

- **Only kilograms, grams and milligrams can ever come from a scale** — a fixed list enforced by a
  database check, separate from the editable name. A unit you invent, and the volume units, are
  typed, never weighed. Intended, not an oversight.
