# Menus and the catalogue — detail

The open entries are listed in [the backlog](../backlog.md), under "Menus and the catalogue". This file holds
their full text.

## `MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this engine

**`MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this
engine — OPEN (found by #603).** Read only, not run: `MAX_MODIFIER_INTEGER`
(`packages/catalogue/src/modifier-limits.ts`, 2147483647) and the extras contract's `whole` bound
were PostgreSQL's integer maximum; the test names "refuses a pick bound above what the column can
hold" and "refuses a maxQuantity above what the column can hold" (`src/extra-contract.test.ts`)
assume a column limit.

## Test titles in `packages/catalogue` a comments-only change cannot touch

**Test titles in `packages/catalogue` a comments-only change cannot touch — OPEN (found by #603).** Read only, not run:
`describe("validateContainsTag (Task 4)")` and `describe("validateDietOverride (Task 4)")`
(`src/dietary.test.ts`), "settles a product id sent in upper case in the database"
(`src/product-modifiers.test.ts`, the code settles it now), "rebuilds every lookup index without the
tenant" (`src/migrations.test.ts`).

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
`apps/dashboard/src/screens/menus-screen.test.ts` requires that overflow. The contrast of
that link, and of the product list's maker link, on a highlighted row is fixed (A306, #1336).

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
  `packages/catalogue/src/device-home.ts`.

## Two copies of the tree pointer drag — OPEN (W88)

**Two copies of the tree pointer drag — OPEN (W88).** W88 moved what Products and the Menus tree
draw during a drag into `apps/dashboard/src/widgets/tree-drag.ts` (the ghost, the row and gap marks,
the click blocked after a release), but each widget still has its own copy of the drag itself: the
press, the 5 px start, the target under the pointer, Escape, the release and the clean-up
(`#pointerDown` to `#gap` in `apps/dashboard/src/widgets/product-list.ts`, `#gripDown` to `#gap` in
`apps/dashboard/src/widgets/menu-structure-table.ts`). A shared helper, told how to map a row to a
target, would serve both.

## The Menus Structure tree notices silent branch closure by watching its table redraw — OPEN (W88)

`wt-data-table.setExpanded` is silent. Structure's table controller checks whether a silent closure
hid the current path; it also refits paths, restores focus after redraws and moves, and repaints an
active drag. A462 replaces the bulk button with root closure but retains those duties. A shared
notification for programmatic branch changes could replace the current-path check, rather than
the whole controller.

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

_2026-10-14: both open points here — few rows at 375×667, and `stickyHeader` set only by Products —
are now part of A653 ([dashboard.md](dashboard.md#a653--every-long-dashboard-table-scrolls-the-same-way-with-less-above-it))._

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
On 2026-10-11 A487a saw it once in every run of
`pnpm --filter @waitron/ui exec vitest run src/components/wt-tabs` — three plain and three with
coverage on main `5197ae03599332e540aba80c108c1829c5ae84d9`, and the same on its first candidate,
`57538cf47aab2038ed2d6e8968da4e51c0de453b`, with every test passing. Which
test logs it was not looked for.

## `joinCustomerPresentationText` passes the requested language where the default belongs — OPEN (found 2026-10-02 by A172, not measured)

- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).** It calls `resolveSnapshotText(variant, locale,
locale)` (`packages/catalogue/src/product-presentation.ts`), the shape A172 fixed in
  `customerOptionSnapshotLabels`, so a locale blank in a variant's map takes the first stored
  language alphabetically rather than the default. The order path freezes the variant's text in
  the default content language, under every receipt-language key, before it gets there
  (`defaultLanguageDescriptions`, called by `priceOrderLines` in
  `apps/server/src/working-order.ts`), so whether any surface shows the difference is unknown;
  reproduce before fixing.

## Language resolution follow-ons

- **Language resolution follow-ons**
  ([original design](../superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)):
  there is still no single shared rule: the receipt's `lineName`
  (`apps/server/src/receipt-document.ts`) and the kitchen ticket's `ticketName`
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

- **Classification.** `Product.categoryId` and `primaryCategoryId` always hold the same value. A
  line's classification is recorded when it is added (M7v), so `sale_classification.invalid`
  refuses adding a line; whether the till's message for that refusal on the add paths is right is
  not checked. The demo seed
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
  added again until the product is switched back on. Archiving a product turns its shortcut into
  a Missing one (`takeOffMenus`, `packages/catalogue/src/menu-removal.ts`); how the Home page tab's
  preview draws a shortcut to a product switched off any other way was not checked.

## Content languages and the image library (#339, #344) — what is left open

**Content languages and the image library (#339, #344) — what is left open.**
[Operator guide](../../apps/server/src/guide/en/content-and-images.md).

- **A new picture consumer has to add a real database reference, not just store a filename.**
  Products point at the image table through a foreign key on the picture's filename
  (`products_media_image_fk`, `ON DELETE RESTRICT`), which is what makes "you cannot delete a
  picture something is using" true. Any future screen that shows a
  library picture has to add the same kind of reference and a sentence naming the use, or that
  check will not see it.
- **The online language selector has nothing to select for yet.** The setting and the rule for
  choosing a language are built and tested; the customer-facing online ordering surface they were
  built for does not exist (A508 and A509, [till.md](till.md#a509-online-ordering-for-collection-at-the-counter)).
- **Left by A157's review:** the upgrade test `packages/media/src/schema/name-only-upgrade.test.ts`
  makes its scratch folder with `tmpdir()` rather than `scratchParent()` (`scripts/scratch-dir.mjs`),
  unmeasured either way; the list of hand-written migrations in
  `docs/developers/conventions-data.md` leaves out core `0036` and `0047`, catalogue `0013` and
  media `0004`, and A157's media `0005`. **Next action:** fill the list when next touching that
  file; the other needs a decision whether it is worth a change at all.

## Extras and Options — deliberate limits, and what is left open

**Extras and Options — deliberate limits, and what is left open.**
[integration contract](../developers/modifiers.md).

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

## In Spanish a range's placeholder reads "8.00 – 12.00" with full stops, and a refused field is drawn about 14 px wider than the others

- Open, seen in #1368's screenshots on code this branch does not change (`wt-price-input`,
  `#focusField` and the placeholder line are untouched): in Spanish a range's placeholder reads
  "8.00 – 12.00" with full stops (the field's hint is written as typed, from W89, 53a76dce9a);
  a refused field is drawn about 14 px wider than the others, pushing its "?" to the right; and at
  390 wide a refusal's focus scrolls the table only part way sideways, leaving Spanish prices
  half-hidden behind the pinned Resolve column. (A344 removed the "?" and the Resolve column and keeps each price
  box on screen at 390 px; the wider refused field and the placeholder's full stops were not
  re-checked.)

## A353 — Preview's changes: an "Undo" link that puts one change back to the live version

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version (owner,
  2026-10-07: "would it be possible to have an 'Undo' link as well?"; PARKED, not queued — owner
  2026-10-08: take it from here when a lane has room).** Started in lane D, then parked for A366.
  Its work so far is on a LOCAL branch only — `feat/menu-preview-undo` at `e04b3abe7`, in the
  worktree `waitron-feat-menu-preview-undo` (no push, no pull request): the plan, and the scalar
  and presentation Undo checkpoint. What was left at the park: the rest of its Task 2's controls,
  the structural Undo commands, and the server and dashboard wiring.

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

## Catalogue course window late-close guard

The catalogue-screen test "ignores the closed window's late close…" catches its guard's
removal only through an unhandled error, because the late close throws before it changes
anything a state assertion could see. Left open by A212 (#1087).

## Allergens and dietary preferences are edited in place (A213): what #1079 left open

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.

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

- **The product list.** A variant's name may sit a few pixels low in its row at 390px, not yet looked at;
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
[Operator guide](../../apps/server/src/guide/en/products.md); [developer guide](../developers/products.md).

- **Smaller things #379 surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale. A joined customer-facing line
  can mix languages when a locale exists on one half only. `wt-price-input` was built from scratch
  rather than on `wt-input`'s end slot. `modifier-limits.ts` holds a product rule as well as modifier
  ones. And four interface faults seen then: the products list heads its Name column "Description",
  "Top sellers" is rendered
  twice on the overview, the login screen shows an error before anything is submitted, and the
  recipe screen is not routed from anywhere.

## "May contain" survives in the data with no way to see or set it

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.

## The product editor summarises the same values twice

Settled by [A668](../superpowers/specs/2026-10-14-a668-allergen-info-editor-and-till-design.md) (owner, 2026-10-14); kept so older links resolve.


## Translate all: run the end-to-end check on the Santet venue against a local Waitron Cloud

Waitron's side of Translate all (A689, plan tasks 1 to 20) is on `main`, tested only against the
fake Cloud in `apps/server/test/translation-cloud-fixture.ts`. Task 21 of
[the plan](../superpowers/plans/2026-10-14-translate-all.md) runs it on the Santet venue against a
local Cloud. Cloud's side is on Cloud's `main`: its four translation routes, its worker, the
`servicesVersion` 2 configuration reply, and collect answering one page of at most 16 MiB at a time (Cloud's `packages/translation/src/collect-page.ts`).
A689-21 made the box fetch and store those pages
([its plan](../superpowers/plans/2026-10-19-translate-all-collect-pages.md), PR 1). What is left
is that plan's PR 2:

- **2a, the Santet run**, Task 21 adapted to paging, with Cloud's fake provider making the result
  larger than one page (the owner chose the fake provider on 2026-10-19, open question 3). Its
  record is a docs-only commit.
- **2b, the joint fault proof** Cloud's release gate asks for. Its contract's words: "Do not go
  live until pinned Cloud and Waitron candidates jointly prove multi-page collection, crash/reply-loss
  retry, deduplication, bounded decoded reads and release only after durable completion." The plan
  recommends a Cloud script beside Cloud's `scripts/test-waitron-pairing.mjs`, built by lane D on
  Cloud's side; the owner chose that on 2026-10-19 (open question 4).

- **Cloud must support version 2 before any box built from `main` talks to it.** The box asks for
  the service with `servicesVersion` 2, which a Cloud without version 2 refuses as an invalid
  proof, and the box answers that by dropping its lease
  ([cloud-connection.md](../developers/cloud-connection.md)).
- **Where the design lives.** Waitron's side is in
  [the Translate all design](../superpowers/specs/2026-10-14-translate-all-design.md) and
  [the plan](../superpowers/plans/2026-10-14-translate-all.md). Cloud's side and the wire contract
  are in the Cloud repository's `docs/superpowers/specs/2026-10-14-translate-all-design.md` and
  `docs/waitron-integration-contract.md`. Cloud's plan is its
  `docs/superpowers/plans/2026-10-14-translate-all.md` (24 tasks; 22 to 24 are owner-run
  measurements with the real key), on waitron-cloud PR #131. The owner approved both specs and
  both plans on 2026-10-14.
- **The cap.** Translate all is meant to become a paid subscriber service in Waitron Cloud; for
  now it is free for connected venues, capped per venue. The owner's approval covers the proposed
  $5 per venue per month cap and Cloud's submit allowance (4 jobs in flight, 1 per address).
  Cloud's spec still says "proposed" until its first implementation change updates it.
- **When the check passes**, delete this entry (Task 21, Step 7); otherwise each failure becomes
  its own entry.

## Translate all: shared collect-page test vectors

- **Translate all: shared collect-page test vectors.** The fake Cloud's paging
  (`apps/server/test/translation-cloud-fixture.ts`) follows Cloud's
  `packages/translation/src/collect-page.ts`, but nothing in either repository compares them; the
  shared translation vector (`apps/server/test/cloud-translation-vector.json`) covers submit
  signing only. Vectors Cloud generates from fixed items, outcomes and
  a byte budget, checked by both Cloud's `collectPage` and Waitron's fake, would catch drift in CI
  on both sides. One drift they would catch: the fake reads a signed body's job id with a stricter
  key-order check (`jobIdIn`) than Cloud, which sorts the keys (Cloud's
  `packages/translation/src/machine.ts`). A contract change for Cloud's side (plan
  `docs/superpowers/plans/2026-10-19-translate-all-collect-pages.md`, "2b and what can be
  automated").

## Translate all: a job that ends before any page is stored does not count its items as lost

- **Translate all: a job that ends before any page is stored does not count its items as lost.**
  When a job ends after at least one page is stored, `recordSuggestionJobEnded`
  (`packages/catalogue/src/content-suggestion-jobs.ts`) counts every item not yet received as one
  that could not be done, so the notice says so. A job that ends before any page is stored (Cloud
  expired it, the box's 24-hour clock ran out, or the service went off) keeps the counts of its
  last progress reading, usually no failures. Such a job has stored no suggestions, so the notice
  appears only for an earlier job's waiting ones, and it does not mention this job's lost items.
  Left out of A689-21 as wider than its plan's Decision 8.

## A655 — fewer and slimmer columns on Products

**A655 — fewer and slimmer columns on Products (owner, 2026-10-14; open).** In
`apps/dashboard/src/widgets/product-list.ts`: (1) "Standalone ordering" (`product.ordering`,
Spanish "Pedido por separado") gets a shorter heading — the owner suggested "Standalone"; choose it
beside A647's new values (Anyone / Staff only / Nobody), and the Spanish needs the owner's wording.
(2) Allergens and Dietary info start hidden (`choosable: "hidden"`) and stay in the column chooser.
(3) Made at is deleted, or at the very least loses the grey second line under a category's station
("set on this category", "from {name}", "default station", "some items made elsewhere",
`folders.made_at_*`), which makes each category row up to three lines tall; which of the two is
the owner's call at the plan. Either way "Kitchen routing unavailable"
(`folders.made_at_unavailable`, drawn on category rows when the stations cannot be read) needs a
new place rather than going with it; and deleting the column also deletes the station link to Prep
stations' routing view (`/manage/prep-stations/view/routing`). Decided with it: the Availability
column stays as it is, and the table staying wider than its box at desktop width is accepted
(there will always be too many columns here; folding the sidebar to a strip gives it more room).
**Added 2026-10-16 (owner):** the heading is "Standalone", and the editor field and the filter
both become "Standalone ordering by" (today "Ordered on its own by" and "Standalone ordering");
a Course column and a Course filter join the list, and "Default course" is renamed "Course"
everywhere the dashboard shows it. A course change is live on the till without republishing
(course is left out of the published copy, `packages/catalogue/src/menu-document.ts`); confirm
that on a till while building.

## A547 — Preview tab: "Publish later" sits to the left of "Publish now", and "Scheduled versions" shows only when something is scheduled

**A547 — Preview tab: "Publish later" sits to the left of "Publish now", and "Scheduled versions"
shows only when something is scheduled** (owner, 2026-10-12). Today "Publish now" is on its own
line, then a "Scheduled versions" heading, the "Publish later" button and a table that says "No
versions are scheduled." ([before](mockups/a547-preview-tab-before.png)). Wanted: the two
buttons on one line, Publish later first; the heading and table drawn only while at least one
version is queued. The two buttons live in different widgets: Publish now in
`apps/dashboard/src/widgets/menu-preview.ts` (`#renderPublish`), Publish later with the heading,
table and schedule dialog in `apps/dashboard/src/widgets/menu-publications.ts`, which the menus
screen slots into the preview's changes pane — so putting them side by side needs a choice of
which widget draws the row; the implementer picks one and says why. Points to settle in the
change: each button still shows on its own when the other does not (Publish later hides on a
clash or when the draft matches the newest live or queued version; Publish now hides when the
draft matches live); a failed read of the schedule still shows its message and Retry rather than
hiding; and closing the schedule dialog or cancelling the last queued version currently sends
focus to the "Scheduled versions" heading, which may no longer be there.

## Translate all: a job the box ends itself is marked released without a call to Cloud, and Cloud can still hold it

- **Translate all: a job the box ends itself is marked released without a call to Cloud, and
  Cloud can still hold it.** The box ends a job without asking Cloud when the job's own 24-hour
  clock runs out, when `translationService()` is no longer `on` (Cloud's last configuration reply
  no longer lists the service `ready`, or the connection is revoked), and when a status or collect
  call is refused as a request Cloud will never accept, and when a job's last page leaves an item
  unaccounted for (both ended `rejected`). Cloud's 24 hours run
  from its own submit, or from when the job finished, so it can still hold the job, and while that
  job is queued or running the contract's `translation_job_running` refuses the venue's next
  submit. A release would not end a queued or running job (Cloud answers 409
  `translation_not_ready`); it only deletes a finished job's results sooner. Cloud's operator
  switching the service off answers 503, which the box retries rather than ending the job. A
  submit Cloud accepted whose reply was lost is the worst case: the box never learned Cloud's job
  id, so it could not release the job even once Cloud finished it. Pinned by "a job Cloud took but
  whose reply was lost…", "a running job 24 hours old ends expired without asking Cloud" and "a
  status Cloud refuses as a request it will never accept…" in
  `apps/server/src/content-suggestion-runner.test.ts`. What would fix it is open.

## Translate all: open points from the review of A689's second PR

- **Translate all: open points from the review of A689's second PR.** (1) A suggestion's
  out-of-date check starts from the item as it stood when the results were stored, not when the
  job was sent, so an owner change (an included menu moved between sections) while Cloud works is
  not noticed. (2) A waiting placeholder ("the name doesn't say what it is") stops every later run
  from asking for that item, even after its staff name is clarified, until someone discards it.
  (3) A variant whose product's staff name is over 500 characters is sent with no product as
  context, because that product is left out of the job (plan Decisions 9 and 10). (4) The fake
  Cloud refuses a language tag outside `^[a-z]{2,3}(-[A-Z]{2})?$`
  (`apps/server/test/translation-cloud-fixture.ts`), so a venue with Valencian (`ca-ES-valencia`)
  enabled would have every job refused; the contract's own words ("language tags (`ca`, `es`,
  `pt-BR`)") do not settle whether the real Cloud does the same. Not run against Cloud.

## Translate all: three limits the translations dialog accepts for now (A689's fourth PR, 2026-10-15)

- **Translate all: three limits the translations dialog accepts for now (A689's fourth PR, 2026-10-15).**
  A Discard whose delete request never answers keeps Save disabled, across closing and reopening the
  dialog, until the page is reloaded, and nothing says why: a delete has no time limit (only reads
  do, `packages/dashboard-kit/src/request.ts`). And on the default language's page, an item a read
  by reference showed should not be listed is skipped for the rest of that opening, so an item that
  becomes listable again while the dialog is open shows only from the next opening
  (`#dropped`, `apps/dashboard/src/widgets/content-translations-dialog.ts`). And after a Discard
  that deleted some of a row's suggestions before one was refused, that language's row takes no
  suggestion including any of them, and shows no Discard, for the rest of the opening the refusal
  lands in (or, if the dialog was closed then, the very next opening, when that is on the same language);
  the refused suggestion is still stored and fills the row again at that language's opening after
  that.

## A682. Translations: nothing required, every missing name reported, all languages side by side (owner, 2026-10-14)

**Current checkpoint, 2026-10-17, after 16:40:** the owner approved unit A at 16:25: required staff
name and abbreviation, all translations optional, no automatic copying. Spanish A was approved at
16:40: Save succeeds with Spanish customer text blank; Spanish stays enabled everywhere in Spain,
including unknown province, Basque Country and Navarre, and its gaps remain. Other regional rules
stay. The [dated design closure](../superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-closure-unit-a-and-spanish-a)
closes both decisions and authorizes planning/build. The [executable plan](../superpowers/plans/2026-10-17-a682-translations.md)
covers all five points and Use fix in one complete future production PR. **A682 and Use fix remain
OPEN** for implementation and validation. Fresh-context plan review is complete, with field-specific
staff fallback and the additive-upgrade check made explicit. Implement in one production PR after
the relevant G/C/E handoffs. The original points and earlier checkpoint below remain historical.

**Historical checkpoint; see the [2026-10-17 closure](../superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-closure-unit-a-and-spanish-a).**
**Current checkpoint, 2026-10-17, after the unit answer:** unit option A is approved: required staff
name and abbreviation, with every translated value optional. The [design addendum](../superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-reconciliation-spanish-and-approved-unit-option-a)
records the remaining Spanish-text conflict. Keeping Spanish enabled and refusing a save for blank
Spanish customer text are different rules; one worked example asks which the owner intends.
Implementation and its detailed plan wait for that answer. The original points and earlier design
checkpoint below remain as history; their pending unit A/B question is closed.

- **A682. Translations: nothing required, every missing name reported, all languages side by side
  (owner, 2026-10-14).**
  1. No customer-facing name is required. A blank one falls back to the default-language name,
     then to the staff name. A unit has no staff name to fall back to and stays required today
     ([products.md](../developers/products.md#the-translation-gap-report)), so settle units first.
  2. The Missing translations report lists every missing value in every enabled language, the
     default included.
  3. Changing the default content language is no longer refused over missing text
     (`listContentTranslationGaps`, `packages/catalogue/src/content-languages.ts`).
  4. The translations dialog shows one field per enabled language on each row, so a name can be
     compared and filled in every language at once. Its "Why" filter becomes a "Missing in…"
     language filter; "Kind" stays.
  5. On Content languages, the note under a language's count is cut off mid-sentence (the Spanish
     row: "Spanish stays enabled for venues in this region, and…"). Wrap it.

  This settles the two questions C122 and A172 left for the owner: whether a name blank in every
  language counts under the default language, and whether "Spanish filled, English blank" is still
  a gap. Translate all fills the same dialog; its "Use fix" button waits for this change
  (its own entry in `docs/backlog.md`).

  **The user guides moved (A582 slice 3).** They are in `apps/server/src/guide/en/`, with Spanish
  twins in `apps/server/src/guide/es/`. A682's guide changes go to both
  `en/content-and-images.md` and `es/content-and-images.md`, and to the lines about translations in
  `en/modifiers.md` and `es/modifiers.md`; the first half of Languages and photos, before "Add a
  photograph once", was left for A682 to correct.

  **Historical checkpoint; see the [2026-10-17 closure](../superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-closure-unit-a-and-spanish-a).**
  **Design checkpoint, 2026-10-17:** the [proposal](../superpowers/specs/2026-10-17-a682-translations-design.md)
  covers all five points and Use fix in one future PR. Its unit choice is still open: add a required
  staff name and abbreviation with optional translations (recommended), or retain at least one
  translated name and abbreviation. Product implementation and the detailed plan await that choice.

## Open test gap from A201b (#1091)

- **Open test gap from A201b** (#1091): removing `#closeLostList()` from `#includeMenu` in a
  disposable checkout left `pnpm --filter @waitron/dashboard exec vitest run
  src/screens/menus-screen.test.ts` green (207/207, 2026-10-03). The suite does not establish
  whether that guard catches a list disappearing between the last read and selection. Check that
  race with a focused test, or remove the guard if the path cannot occur; its reachability remains
  unverified.

## A884. Deleting an options or extras list leaves it on the published menus until they are republished

Found while checking the Modifiers guide for A582 slice 3. Deleting a list does not republish the
menus: the delete route calls only the list's own remove (`mountListSurface`,
`apps/server/src/catalogue-api.ts`; `deleteOptionList`, `packages/catalogue/src/options.ts`, has no
publish), and the till's offers come from the published menu document, where a deleted list's
options count as unavailable (`labelAvailable`, `packages/catalogue/src/menu-document.ts`). Measured
with temporary cases in `apps/server/src/working-order.test.ts`, `order-groups.test.ts` and
`tabs.test.ts`, since reverted:

- With an options list deleted and the menus not republished, the till cannot add a dish that
  carries it (`options.label_required`), and saving a change to a parked order that keeps such a
  dish on it is refused the same way. On a table's order, a new round (`submitGroups`) and a
  quantity change to one line (`updateOrderLine`) still succeed, and another such dish with the
  old answer is refused. A save of the whole order that kept such a dish, already sent to the
  kitchen, and added a line was refused `options.label_required`.
- With an options list and an extras list both deleted and the menus republished, raising the
  quantity of a table's dish that still carries an extra from the deleted list is refused
  `extras.invalid`, though a note on it succeeds.

The Modifiers guide tells the reader to republish straight after deleting an options list. Two ways out: the delete
republishes the menus that carry the list, or the published menu drops a deleted list. Done when a
test deletes each kind of list and the till can still add the dish and change an open order holding
it, before and after a republish.

## A885. Say that lines already on an open order keep their VAT class after a republish

Found while checking the Products guide for A582 slice 3. The VAT help (`help.products.vat`,
`apps/dashboard/src/i18n/strings.ts`, English and Spanish) and the guide's opening
(`apps/server/src/guide/en/products.md` and its Spanish twin) say a change of VAT class reaches the
tills when the menu is published again. Neither says that a line already on a held order or a tab
keeps the class it was added with, and only a line added after the publish takes the new one (the
"a new version published with the new class" cases in
`apps/server/src/vat-class-at-line-add.test.ts`). Add that to the help text and the guide, in both
languages. Done when both say it.

## A dish in a measure unit is still rung up one unit per tap

Left open by A821f. A 250 ml line is 1 ml per tap with ±1 steps, the split control turns it into
250 lines, a course group counts it as 250 items (`itemCount`, `apps/till/src/state/draft-groups.ts`),
and the basket-refresh dialog prices it "each". Whether a measure should ask its quantity as a
decimal unit does — which would change the other readers of the till's `soldByTheUnit`
(`apps/till/src/widgets/product-name.ts`) — is the owner's call. Its readers: `splitLine`
(`apps/till/src/state/working-order.ts`), `countsWholeUnits` and the last-added steps and split
control (`apps/till/src/screens/till-table-order-screen.ts`), and the price label
(`apps/till/src/widgets/basket-refresh-dialog.ts`). Read, not run.

## Decisions and deliberate limits

### A651 — drop photos to upload them, and tidy the image library and its picker

Historical design observations and owner decisions, 2026-10-14. The field and tile contract is
now in [the design system](../developers/design-system.md#primitives).

Owner, 2026-10-14, from screenshots of the library, the picker and the upload window. Boards, in
[mockups/a651-image-library/](mockups/a651-image-library/): 1 the library page, 2 photos dragged
over it, 3 just after the drop, 4 the picker, 5 the picker's full-size photo, 6 the upload window.
Where a board and this text differ, this text wins. The library is
`packages/media/src/dashboard/image-library.ts`; the picker
(`packages/media/src/dashboard/image-picker.ts`) places that same component inside the window
`apps/dashboard/src/widgets/image-upload.ts` opens, with its `picker` flag set.

1. **Drop several photos on the library page** (boards 2, 3). The whole page accepts the drop and
   says "Drop 3 photos to upload them" while photos are dragged over it. Each photo uploads straight
   away, with no window, its default-language name taken from its file name (`patatas-bravas.jpg`
   becomes "Patatas bravas": extension dropped, dashes and underscores to spaces, first letter
   capital). While they upload, a bar reads "2 of 3 photos uploaded." and each new photo shows a
   New badge; no message says the names came from the file names (owner). The person renames one
   later with Edit. A photo the server reports as already in the library (`created: false`) is
   reused, as one uploaded through the window is today (`image.duplicate_reused`). The page also says "Drop photos anywhere on this
   page to upload them, or choose files", and choose files takes several files too.
2. **The upload window's Photo field becomes a drop area** (board 6): "Drop a photo here, or choose
   a file · JPEG, PNG or WebP, up to 20 MB". Once a photo is chosen it shows the photo, its file
   name and size, and "Choose another". This is a shared field primitive in `packages/ui`, under
   the rule that a screen does not draw its own form field (CLAUDE.md §3), with the tests a new
   `wt-*` primitive needs. Dropping one photo here fills the field and does not upload until Save.
   Its default-language name is filled in from the file name, as on a drop on the page (owner,
   2026-10-14), and can be changed before Save.
3. **The Photo field's required mark is red**, as the Name field's already is (today it is black).
4. **Library page** (board 1): the Upload photo button reads "Upload photos" and is drawn blue
   (`variant="primary"`; today it is drawn like every other button). The "Preview" label over each photo goes; clicking the photo still
   opens it. Edit and Delete leave the tile for a ⋮ menu beside the photo's name.
5. **Picker** (board 4): only the window's "Choose image" title shows; the library's own "Image
   library" heading goes. Each photo keeps the same ⋮ menu (Edit, Delete) and a full-width
   Use image drawn white (owner: not blue, so a page of photos is not a page of blue buttons). The
   big Edit and Delete buttons and the Preview label go. Upload photos stays (owner), so a photo
   can be added and used without leaving the product.
6. **The picker's full-size photo** (board 5) gains Use image, drawn blue, beside Back. Today it
   opens with no way to choose the photo from it.


### A652 — frame a photo for its thumbnails

Owner, 2026-10-14: Edit photo opens Adjust framing as a separate window. Drag and Zoom share
one focal point and zoom for the square Lists preview and the 4:3 Till buttons preview. Reset
returns to the centre at 100%; Done returns to the unsaved photo draft. Only the outer Save
persists names, accepted framing and a replacement file. Replacing resets framing while retaining
names, photo identity and every use. The full-photo viewer shows the complete current source.
The [boards](mockups/a652-photo-framing/) record these decisions.

Implementation, 2026-10-17: original hash filenames remain stable references and still serve
immutable original bytes. Replacement blobs and sparse framing/revision overrides travel in the
venue database and configuration transfer. Published/queued menu documents and their hashes do
not change; their presentation resolves the current photo. Already returned receipt presentations
and queued print payloads retain their earlier picture. A photo save refreshes all currently
matching department receipt rasters in the same transaction, including retained departments.

The grid uses square renditions bounded to 480 pixels; till tiles use 480×360, without enlarging
tiny inputs. These are bounded in-memory cached responses generated from durable source bytes.
Recipe URLs include source, framing and algorithm version. A removed recipe version returns 404;
raw content-hash URLs keep their byte identity. The [implementation plan](../superpowers/plans/2026-10-17-a652-photo-framing.md)
records the limits, collision policy, measured large-input byte reduction and tiny-seed counterexample.
The old “about 4 MB per page” estimate was not a measurement. Current upload dedup preserves the
matched photo's names/framing; an occupied retired-original alias is refused when no current source
matches, rather than silently returning a different picture.

The visible-page resolver remembers up to 256 recent presentations across remounts and refreshes them in the background. Newly arriving thumbnails do not cancel a lookup already serving mounted rows. Public rendition requests have their own bounded queue; photo saves prepare the display crop outside that queue and outside the write transaction.

### A647 — tidy the product editor

Owner, 2026-10-14, decided over a run of screenshots and mock-ups. Boards, in
[mockups/a647-product-editor/](mockups/a647-product-editor/): 1 the thumbnail, 2 the sections,
3 the Variants section and the unit link, 4 the whole editor as it opens (the target), 5 the
Selling options (A chosen; B, two loose lines under the name, rejected). Where a board and this
text differ, this text wins. The editor is `apps/dashboard/src/widgets/product-editor.ts`.

1. **The thumbnail is the one control for image and colour.** The Colour heading, the
   "Use category colour" chip, the swatches and Custom leave the form. The square beside the name
   shows the image, or the colour when there is no image, carries a small pencil badge, and opens
   one panel holding Choose image, then Use category colour, the swatches and Custom. A colour
   picked there shows in the square at once, before saving (today the square shows the saved value
   only). Keyboard focus returns to the square when the panel closes.
2. **Every section has one style.** Title in bold, its arrow beside it as now, a light line under
   the title running the full width; a closed section's summary sits close under the line at normal
   line spacing (today Descriptors' two summary lines touch). The gap between sections is the same
   everywhere: today the gap after Kitchen is larger than the others and Pricing's label sits
   directly under Nutritional info with no gap.
3. **Pricing, Variants and Modifiers become sections like the others** (today PRICING and
   MODIFIERS are grey all-capitals labels that never close, and Pricing becomes a section only once
   a variant exists). Variants is its own section after Pricing. With no variants, the open Variants
   section shows only Add variant under its title; closed, its summary reads "None". Pricing's
   closed summary keeps today's "Base price: €11.00 each · VAT: Reduced (10%)" form.
4. **A Selling section, placed first,** holds the Available switch and, below it, "Ordered on its
   own by" with a three-way toggle: Anyone / Staff only / Nobody (today "Public / Staff only / Not
   sold separately", `product.ordering_*` in `apps/dashboard/src/i18n/strings.ts`), with the
   chosen choice's existing explanation underneath (`product.ordering_*_hint`). Closed, its summary
   reads "Available · Ordered on its own by: Anyone", with "Unavailable" in the warning colour
   (`--wt-color-warning`) when the switch is off. The new names apply wherever the old ones are
   shown, including the products list's ordering filter and its tests; the Spanish strings change
   with them and need the owner's wording. On a variant's page, which has no ordering choice, the
   section holds only the switch.
5. **Which sections start open:** Kitchen and Pricing; Modifiers when the product has any; for a
   product with variants, Variants open and Pricing closed. Selling, Descriptors and Nutritional
   info start closed.
6. **The variants table's unit choice becomes a link** in the Price column title,
   "Price · Each ▾", in place of the bordered button; it opens the same unit dialog. The base
   price field's own unit button stays as it is.

7. **Added 2026-10-15 (owner): the Pricing unit dialog's units read in the dashboard's language,
   sorted.** Today they read in the venue's first content language (`locales[0]`,
   `apps/dashboard/src/widgets/product-editor.ts`), which is Catalan for a Catalan venue even with
   the dashboard in English, while "Each" comes from the dashboard's own strings
   (`editor.unit_each`); and after Each they come in the order of their random ids
   (`packages/catalogue/src/units.ts`). Show each unit's name in the dashboard's language (falling
   back as other content does when a unit has none), Each first, the rest alphabetical. Read, not
   run, 2026-10-15.

**The three-way toggle is a new shared primitive** (`packages/ui`; nothing like it exists — only
`wt-switch` and `wt-combobox`), so it needs the two tests a new `wt-*` primitive needs (CLAUDE.md
§3): a token-painting test and an axe test for each state in both themes. It is a single-choice
group: one button per choice, the chosen one filled `primary`.

Related open entries on the same screen: [the editor summarises the same values
twice](#the-product-editor-summarises-the-same-values-twice) (Nutritional info's summary), and
the Descriptors fold at 390px in `docs/backlog.md`. Every change here is to an editor that saves,
so its draft scope and `*.unsaved.test.ts` must keep passing with sections closed.


2026-10-15: implemented by the [A647 plan](../superpowers/plans/2026-10-15-a647-product-editor.md).
The numbered decision above records the approved design and describes the earlier editor where
it says “today”. The owner supplied Spanish wording the same day: Venta; Pedir por separado;
Cualquiera / Solo el personal / Nadie.

**Table toolbars and closure (A462, owner 2026-10-10).** Customise follows search and stays last
at every width. Header and row checkboxes share their leading alignment. Products and Structure
start with their root open, have no Expand all button, and open only the chosen branch's own level.
Closing a branch closes its descendants, including hidden paths. Preview keeps Expand all.
Structure uses one Select mode for checkboxes and drag handles. Search openings and their parents
survive clearing unless deliberately closed; after clearing, a closed current Structure path
returns editing to its nearest open parent. Products remembers deliberate closures across reloads.
[Implementation plan](../superpowers/plans/2026-10-10-a462-table-toolbars.md).

**Product search (A461, owner 2026-10-10).** Products and Menu Structure show flat own matches
with inline paths. Each new query starts branches collapsed. Opening one shows its contents
and keeps matching descendants as flat results too; openings and their parents persist after
clearing. Products shows its one category placement; Menu Structure shows every member path.
Repeated views of one list/member share one tick, while distinct memberships remain separate.
Table-sort ties remain the A454 rule, confirmed by the owner. Search and filters retain eligible
ticks; Select all changes visible ticks only. Dragging carries visible ticks on both dashboards
and keeps hidden ticks; Move/Remove take the full selection. Removed or no-longer-owned rows
are trimmed. The till mixes products and displayed sections by closeness with traversal-order
ties, disables diet-empty sections, and opens a section without changing the basket.
[Implementation plan](../superpowers/plans/2026-10-10-a461-product-search.md).

- **Courses and stations use permanent Delete (A435 step 5, owner, 2026-10-10).**
  Neither kind offers Disable, Enable or a Status filter/column. You may reuse a deleted name
  with a new id. Deleting a course clears product defaults, including archived products;
  recorded draft and order choices keep the original course. Courses and stations left as
  history are excluded from configuration exports; archived products still travel.

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
so a product never checked stays apart from one checked and allergen-free. A668-3 (2026-10-16) renames the displayed Pending label to Not reviewed and applies each variant's effective state to its cell and filter; inherited badges are italic. Dietary info's "Has" means a
categorised dietary origin from the product's recipe, or a Vegan, Vegetarian, Halal or Kosher override (owner); the list also counts a
ticked dietary declaration. Made at offers only the stations the column names for some product, not
every kitchen station, and matches the station the column shows, including a switched-off station a
product has no replacement for; the backlog entry marked that matching "assumed, not asked".
**2026-10-10 update:** A435 step 5 removes deleted stations from current routing settings and
choices. The switched-off-station example above records A463's earlier decision; Task 9's
integrated Made at check follows the surviving rule after deletion.

- **Task 13 (#903, standalone ordering).** A product's `ordering` is Public, Staff only or Not
  sold separately; Staff only behaves exactly as Public until guest ordering exists.

From "Extras and Options — deliberate limits, and what is left open"
([integration contract](../developers/modifiers.md)):

- **An options list is always required.** It asks for exactly one pick, with the default
  preselected; an unanswered ACTIVE list refuses the order with `options.label_required`. An
  optional options list is a possible future change, not built.
- **A variant offers its parent's lists and cannot override them**; a per-variant attachment row
  is a possible later addition.
- **A menu offer carries all its product's extras and options lists; there is no per-menu extras
  editing (owner, 2026-10-01; #993).** The per-menu tables were dropped, and
  `packages/catalogue/src/migrations.test.ts` checks they stay gone.
- **Extras only on a dish sold by the unit (owner, 2026-10-15; A663 Part 2d).** A dish whose unit
  has a scale or allows decimal places takes no extras, so 1 l of sangría cannot carry one; to sell
  it with extras, sell it in a unit with no scale, no decimals and the measure switch off (a jug).
  Owner, 2026-10-19 (A821): a unit can be marked a measure ("Mide una cantidad (ml, g…) — sin
  extras"), and a dish in a measure takes no extras either. On a newly set-up venue the seeded ml,
  l, g, kg and mg start with it on; a new unit starts with it off. The switch is frozen into the
  published menu with the dish's unit, so a change reaches the till and the server at the next
  publish.

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

From A335 (#1457, the menu editor's heading):

- **When the venue needs a reset, the menu editor shows the "reset the venue" sentence inside the
  brackets beside the menu's name**, where the live version normally sits, in muted text. A review
  suggested a line of its own; kept in the brackets by decision. (A335, #1457.)

From the owner's answers to A774's keep/drop list (owner, 2026-10-17):

- **Spanish is required everywhere** (owner, 2026-10-17): in a Spanish venue, Spanish names are
  required whatever the province, including a venue with no known province. Relayed to A682, which
  must reconcile its "nothing required" with this. Whether receipts outside Catalonia stay free to
  choose was not answered and stays open.
- **Clearing the Extras editor's Minimum choices box saves 0, and that is right** (owner,
  2026-10-17): an empty box means no minimum, so a cleared minimum is not refused.
- **A product literally named `Gin (Double)` and `Gin`'s `Double` variant may show the same label**
  (owner, 2026-10-17): no naming rule is added; distinct saved names are the answer. (A357, #1381.)
- **The Pricing fold does not name an empty base price or VAT** (owner, 2026-10-17): a new product
  already starts with the venue's default VAT, and a variant's empty VAT shows its parent's as its
  hint.
- **Accepted as built: Save turns active only for a refusal an option's window holds when it opens**
  (owner, 2026-10-17). One handed to it while it is already open leaves Save as it was, and it
  stays active for the whole time that window is open, even once the refused field is edited back.
  (A410, #1434.)
