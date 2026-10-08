# Menus and the catalogue — detail

The open entries are listed in [the backlog](../backlog.md), under "Menus and the catalogue". This file holds
their full text.

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
component — Select is a native `<button>` because `wt-button` does not pass `aria-pressed`
through, and the Structure tab's Reorder toggle is a second hand-built icon button for the same
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

## Decisions and deliberate limits

**Products: the tree's Name column lines up, and the Main category column goes — DONE (W84, #1199, owner
2026-10-04).** Seven existing test assertions that pinned the column changed, for the owner to
review (listed in the PR). A product whose category the dashboard's category list does not hold
lists under All products with no "missing" marker; the database refuses a stored product naming a
category that does not exist (`packages/db/src/schema/catalogue.ts:51`, a foreign key; not tried),
so this is expected only while the dashboard's category list is behind.

**Products: the Move dialog's destination categories (W82, #1210).** Two sibling categories with the same name are left as they are (owner: "leave it"): they still show as two identical entries, in the tree and in a search.

**Products: a category's Made at (W86, #1203).** The "some items made elsewhere" note does not look at whether the categories involved hold any products, so it can claim items that do not exist yet; the owner chose to keep these words (2026-10-05).
