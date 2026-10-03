# The Products screen as a category tree

**Status:** owner decisions of 2026-10-02, from one brainstorm over two screenshots of the Products
screen and three rounds of mockups (layout A, "the ⋮ menu", "All products" as the top row).
Not built. Folds in backlog A205 (a product row's click opens it) and cancels A207 (a blue Add
product button in the header). It changes the dashboard only: no migration, no route, and the
product editor's own rules are unchanged.

Facts about today's code were read from `main` on 2026-10-02. They are readings, not measurements;
each names its file so it can be re-checked before building.

The owner's words, in order: _"this layout is messy, needs tidying"_; _"it should be more obvious
which folder you're in and how to get back to the parent folder"_; _"dragging to reorder and
dragging to drop an item into a folder needs to be more obvious visually"_; _"would it be possible
to expand folders in place … it would make it easier to drag items between folders"_; _"the price
doesn't show the units"_. Two further points (customer-facing names for folders, adding a menu such
as Drinks) were the owner mixing folders up with menus, and are out of scope: the
[2026-09-30 design](2026-09-30-catalogue-menus-routing-design.md) stands — a category has one
internal name, and Drinks is a menu that another menu includes.

---

## 1. What the screen looks like

**Header:** the title "Products" and nothing else. Today's "Add product" button
(`#renderAddProduct`, `apps/dashboard/src/screens/catalogue-screen.ts`) goes.

**One toolbar:** search ("Search products and categories"), the table's filter chips, then on the
right **Expand all** (it reads **Collapse all** while everything is open), **Select** and
**Columns**. Removed: the Folders / All products switch and the breadcrumb
(`#breadcrumb` and the `.views` block in `apps/dashboard/src/widgets/catalogue-browser.ts`), and the
toolbar's **New folder** button.

**Filters:** Status and Standalone ordering stay. Standalone ordering's empty choice reads today
"All products" (`product.filter_ordering_all`), which would now read like the tree's top row; it
becomes **"Any ordering"** / **"Cualquier pedido por separado"**, matching "Any status" /
"Cualquier estado" and the column's own names, "Standalone ordering" / "Pedido por separado". There is no category filter today and none is
added: the tree shows each category's products.

**The table is a tree** (layout A):

- The **first row is "All products"**: a category icon, the name, and a count. It has no arrow, is
  always open, and cannot be renamed, moved, deleted or selected. Its ⋮ menu holds **Add product**
  and **Add category**.
- Every category is a row with an arrow, its icon, its name and a count such as "2 categories, 5
  products". Its children — categories first, then products — sit under it, indented one step.
  Categories stay above products within a parent whichever column the table is sorted by.
- A category's ⋮ menu: **Add product**, **Add category**, a divider, **Rename**, **Move to…**,
  **Delete**. Today's per-folder menu already holds Rename and Delete
  (`apps/dashboard/src/widgets/product-list.ts`, the folder row's `wt-row-actions`).
- A product row is as today (grip, picture, name, the chosen columns, its ⋮), indented under its
  category. A product with variants keeps its variants nested under it, as today.
- The marker for a category no routing rule covers (`unroutedFolderIds`) stays on its row.

**Clicks:**

- A category row's click, or Enter on it, opens or closes it. The arrow does the same.
- A product row's click, or Enter on it, does what Edit in that row's menu does; a variant's row
  opens that variant (this is A205). The grip, the ⋮ and the selection box keep their own
  behaviour, and a drag that ends where it started opens nothing.

**Search** keeps every category on the path to a match open while the search is active, and shows
the matching rows; clearing it restores what was open before.

**Prices show their unit** on every product: "€19.00 each", "€48.00 / kg". "Each" is the name a
product with no unit already shows (A178h). The unit is a quiet second word after the amount.

## 2. Adding and renaming

- **Add product** (from a category's ⋮, or from "All products") opens the product form as today,
  with its category already set to that category (none, from "All products"). The editor's
  required fields are unchanged: a product cannot be saved without a name, a VAT class and a valid
  price (`validate()` in `apps/dashboard/src/widgets/product-editor.ts`). After saving, the
  category opens if it was closed, and the new product is in it.
- **Add category** inserts a new row inside that category, opens the category if needed, and puts
  the cursor in a name box on that row. Enter (or leaving the box with a name typed) saves it; Esc,
  or leaving it blank, removes the row and saves nothing. A refusal from the server (a duplicate
  name, for example) is shown under the box and the row stays in edit mode, per the Forms contract
  in [design-system.md](../../developers/design-system.md).
- **Rename** turns that row's name into the same name box, holding the current name, with the same
  keys.
- The category form (`apps/dashboard/src/widgets/category-form.ts`) stays for the one place that
  still needs it: creating a category from inside the product editor.
  _2026-10-03 (A209): the product editor's Add category button is gone, so the form had no caller
  and its element was removed; the helpers `category-form.ts` exports stay._

The name box is a field primitive (`wt-input`), as CLAUDE.md §3 requires. It sits in a cell of
`wt-data-table`, whose cells render in the table's shadow root, so it is styled with `part=`, never
a class (CLAUDE.md §3).

## 3. When there is nothing yet

With no products and no categories, the table shows only the "All products" row, **with its ⋮ menu
already open**, offering Add product and Add category. This replaces the empty table's box with the
screen's Add button (A176) on this screen. The menu opens without taking keyboard focus and closes
like any menu; it does not reopen until the screen is next opened empty.

## 4. Dragging

- **The dragged row stays where it was, faded**, and a lifted copy of it follows the pointer. It
  never springs back during the drag; it moves only on a drop. (The owner saw today's row "flash
  back to its original position" while dragging onto a folder.)
- **The rows part** to open a dashed gap where the product will land: its place in the target
  category's order, which is the table's current sort. Products and categories have no order of
  their own — the owner confirmed this — so this shows the result, it does not choose a position.
- **The target category is marked with a thin bar on its left edge** in the accent colour, instead
  of today's whole-row highlight (`::part(drop-target)` in `product-list.ts`).
- **A closed category opens after a short hover** while dragging over it, so a product can be moved
  into a category several levels down. The delay is a named constant, stated in the PR.
- **Dropping on "All products"** takes the product out of every category, as dropping on the
  breadcrumb's "All products" does today.
- Esc, or a drop where the drag started, cancels with nothing moved.
- A category can be dragged too, as today, with the same rules; a category cannot be dropped into
  itself or its own descendants (`acceptsCatalogueDrop` already refuses that).
- On a touch screen a drag starts from the grip only, as today (`#startDrag`).
- **Several at once** (owner, 2026-10-02): in Select mode, dragging any selected row drags every
  selected row, whichever categories they sit in. All of them fade in place, and the lifted copy
  reads, for example, "3 items" with the first one's picture. Dragging a row that is NOT selected
  drags that row alone and leaves the selection as it was. Today's code already drags the whole
  selection when the drag starts on a selected row (`#dragged` in `product-list.ts`, read, not run);
  what is new is the look, and selection across categories, which the tree makes possible. A
  selection holding a category and something inside it moves the category, and its contents go
  with it; a category that is, or lies inside, one of the dragged categories is not offered as a
  drop place for any of them, as today (`acceptsCatalogueDrop` in `product-list.ts`).

## 5. Words

**"Category" everywhere** the dashboard says "folder" today, in English and Spanish ("categoría"):
the `folders.*` strings in `apps/dashboard/src/i18n/strings.ts` (for example "New folder" /
"Nueva carpeta", "Folder path", "Carpetas"), the Move to… dialog, the delete confirmation, the
selection count and the search placeholder. The product editor's "Main category" field keeps its
name. _(2026-10-03, A209: the field is gone; the editor shows the product's category as a path
with a Change link.)_ The string KEYS may keep their `folders.` prefix or be renamed — before go-live either is
free; say which in the PR. The till's menu sections are not touched.

## 6. Smaller decisions (defaults; the owner may overturn them on the spec)

1. **Which categories are open is remembered in this browser**, under the table's `viewKey`, the way
   its chosen columns are (`localStorage`, `${viewKey}:columns` today). A fresh browser starts with
   every category closed.
2. **Expand all** opens every category and **Collapse all** closes them; it is the flat view that
   "All products" used to be.
3. **The address names a category with `category=`** (owner, 2026-10-02), replacing `folder=` and
   `view=` in `apps/dashboard/src/navigation.ts`; old addresses are not supported (pre-live). Opening
   one opens the tree with that category and its parents open and the category scrolled into view.
   Nothing outside the screen links with either today.
4. **Phone width (390 px):** each level is indented less than on a wide screen, and the ⋮ column
   stays pinned at the edge (CLAUDE.md §3). Rows deeper than the indent can show still line up at
   the deepest indent rather than run off the screen.
5. **Select** mode keeps its boxes on every row except "All products", and its Move to… and Delete
   bar.

## 7. How it is built

- `wt-data-table` already draws trees: rows name a parent (`rowParent`), siblings sort by the
  chosen column, branches collapse (`collapsed`, `initiallyCollapsed`) and a search keeps a match's
  ancestors (`ancestorOnly`) (`packages/ui/src/components/wt-data-table.ts`). Today the product list
  puts every folder at the top level (`parentKey: null`) and lists only the current folder's
  contents (`#visible` in `catalogue-browser.ts`); the tree gives each category row its parent's
  key and each product its category's key, and lists everything.
- Remembering open branches is new on `wt-data-table`, keyed by `viewKey`. A change to the shared
  table needs its own tests there, and its token-painting and axe tests stay green.
- The drag is `product-list.ts`'s pointer drag (A180b, #1003), extended with the faded origin, the
  lifted copy, the gap and the hover-to-open. The breadcrumb's drop handling in
  `catalogue-browser.ts` (`#overCrumb`, `#dropCrumb`) goes with the breadcrumb.
- The empty case opens the row menu with `wt-row-actions`' public `show()`, which calls
  `showPopover()` and moves no focus itself (read, not run, in
  `packages/ui/src/components/wt-row-actions.ts`); a test holds that focus stays where it was.

## 8. Tests and looking

Tests first, red today, for each of: the "All products" row and its two-item menu; a category's
menu items in order; a category row's click and Enter toggle it; a product row's click and Enter
emit `edit-product` with its id, a variant's with the variant's id, and a click on the grip, the ⋮
or a selection box emits nothing; Add product from a category opens the editor with that category
set; Add category's name box saves on Enter, cancels on Esc and on blank, and shows a refusal under
the box; Rename the same; the empty screen shows the open menu without moving focus; the price cell
reads "€19.00 each" and "€48.00 / kg"; search opens a match's ancestors and clearing restores the
previous open set; the open set survives a reload; a drag keeps the origin row in place, opens a
closed category after the hover delay, moves on drop, and cancels on Esc and on a drop where it
started; in Select mode, a drag of a selected row moves every selected row, from two different
categories, in one drop, and a drag of an unselected row moves only that row; "folder" appears in no Products-screen string in either language.

Existing tests that assert the breadcrumb, the Folders / All products switch, the header's Add
product button, the New folder button, the folder-at-a-time listing or the word "folder" will
change, because the owner's design removes or renames those things. That is an owner-approved
change of assertion; the PR names each one.

**LOOK:** at 1280 and 390, light and dark, English and Spanish: the tree three levels deep, the
empty screen, a drag into a closed category, the add-category name box with a refusal showing.

**Review path:** light — no risk trigger (no fiscal code, migration, permission or cross-package
contract beyond the shared table component); one Codex run-it seat plus convention.
