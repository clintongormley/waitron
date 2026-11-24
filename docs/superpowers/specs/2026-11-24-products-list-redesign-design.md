# The Products list: dishes first, a List and a Tree, and one switch for Available

Status: approved by the owner, 2026-11-24 (interactive design session, quoted below). The points
marked **my call** were the session's; they and the Spanish were read out to the owner at the end, who
answered "y". A few small ones were left out of that list: the size of things not named, and wording
not quoted.

## Why

A critique of the Products page scored it 21 of 40. On arrival it shows categories and five blank
columns, and no price, photo or sold-out dish; rows are about 73 px tall, and at 1180 px and narrower
the table scrolls sideways, hiding Availability first. Switching one dish off takes four clicks. A
failed load reads "0 products" on every category.

Shown two layouts (A: the same tree, tighter; B: a flat list with a switch to the tree), the owner:

- "B is not so much products vs categories but flat view vs tree view, no?"
- "i like B, and I think it is mentally easier to just add the product without having to think about
  cat 1 -> cat 2 -> etc"
- "for A, i don't think clicking price and having to switch to a flat view is intuitive"
- "With B, when you add a product, you may need to add a category first (or during the process),
  including setting the colour."
- "i'd keep an unavailable toggle in the flat view, so it is quick to mark a product as unavailable"
- B as redrawn, with the Available switch in both views and Category as an ordinary field: "yes, great"
- all six faults below, with Back as described: "y"

## Not in this work

Prices edited in the row; the till's sold-out window and whether the till and the dashboard use one
word ([A1569](../../backlog/till.md#a1569-the-tills-sold-out-window-needs-a-design-with-the-owner));
the dashed frame on an inherited colour (A423 stands); the rest of the product editor; Archive
becoming Delete ([its own spec](2026-11-24-delete-menus-and-products-design.md), which lands first:
Show archived and the Archived state are gone before the list here is built).

## Decisions

### 1. The page

- The heading, with a teal **Add product** at its end. This reverses the cancelling of A207
  (2026-10-02, with A208). The row ⋮ adds stay in the Tree, and add in that place.
- One toolbar line: Filters, Select, Search (the outlined 44 px box the Menus list has), **List |
  Tree** (`wt-segmented-control`), Customise last (A462). On a phone List | Tree has a line of its own
  above the others, and the search box says only "Search".
- The page opens on the List; the browser then remembers the view last used (**my call**). An address
  naming a category opens the Tree at that category (**my call**), so switching to the List removes
  the category from the address.
- Switching views keeps the search and the filters both views have; a Category filter is dropped.
- With no products the List says so and offers Add product. Add product is drawn disabled, with the
  reason, while adding is not possible (no unit or no language yet), as the row's adds are today.

### 2. The row, the same in both views

- About 48 px on a desktop and 52 px on a phone (more where text wraps). A row holding a switch
  measured 69 px with today's table (a 44 px target and 12 px above and below), so this needs a
  dense-row setting in the shared table, which the menu editor's list needs too: one setting, used by
  both. Pictures are 36 px, and 30 px on a phone, where they now show, as do a category's colour square
  and counts (this reverses W85e, and the hidden counts, for this list). The picture and the square
  keep a target as tall as the row. Pictures load lazily.
- Columns: Name, **Category** (List only: a colour square, not a button, and the path), Price, **Available**, and
  the pinned ⋮. Course, Modifiers, Standalone, Allergens and Dietary info start hidden and stay in
  Customise (this changes A655's starting set, and the starting set fits its box, which A655 allowed
  it not to). Availability goes: Available replaces it under a new column key, so that a browser in
  which Availability was hidden still shows the switch.
- After a product's name, small and muted, only what applies: "2 variants", "Modifiers", "Staff only",
  "Not sold separately". "Anyone" and the dash for no course are not printed in
  the name; in their own columns, when shown, they stay blank (**my call**).
- On a phone the category (List only) and these words go under the name, Available has no visible
  heading, and a price range and its unit may wrap, so that the starting columns do not scroll
  sideways in either language. The Spanish heading does not fit at 356 px (measured on the real table
  and switch, without a picture).
- Price: a unit other than each follows the amount, small and muted, in a place of its own so the
  amounts line up. "each" is not printed. A product with variants shows its price or range.
- Variants open under their product in both views, indented past it, each with its picture and switch.

### 3. Available

- A switch on every product and every variant, in both views. It saves at once and applies to every
  menu and till, as the editor's Available does. It asks nothing. A change made on a till moves it.
- Nothing in the Available cell opens the product: with today's row a click 3 px beside the switch did
  (tried in Chromium). Each switch has a name of its own, "Available: Cabrales".
- It sends only that product's or variant's availability. Switching a product does not change its
  variants' own switches, as on the till.
- A refused change puts the switch back and says why in a message that names the dish and stays in
  view however far the list is scrolled (**my call**).
- A product or variant that is off says **Unavailable** beside its name, in the red outlined label the
  menu editor will have (today's Unavailable badge is grey); on a phone the red word goes under the name. A product with variants off says
  "2 variants · 1 unavailable". A closed category holding any says "5 products · 1 unavailable", counting the products directly in it, as its count does, and a
  product with an unavailable variant as one. This reverses A463's "this column over badges beside
  the name".
- The dashboard keeps Available and Unavailable until A1569 is designed.

### 4. Finding things

- **Filters:** Available (Yes / No; a product with an unavailable variant answers both) and Category
  (List only, a chosen category includes those inside it; **my call**) join today's.
- **Sorting in the List:** Name, Category, Price and any shown column that sorts today.
- **Sorting in the Tree:** categories always stand A–Z, whatever is sorted and in either direction;
  products are sorted inside each. Today every sort orders categories by name in the sort's direction.
- **Filtering in the Tree** opens the categories that hold a match, including ones the person had
  closed, and closes them again when the
  filters are cleared. This reverses A461/A462's "filters alone keep the ordinary tree rules". Opening
  them does not count as the person opening them (nothing is remembered).
- **Search** keeps A461's flat matches with paths in the Tree. In the List, a category's name finds the
  products in it (**my call**). No matches offers **Clear search and filters** (**my call**).
- A product saved while the search or filters hide it is not shown; a line above the table says it was
  saved and offers Clear search and filters (**my call**).

### 5. Select mode

- Move to…, **Mark available**, **Mark unavailable**, Delete, Done. The two new ones act on the ticked
  products in one request, all or none, and show only while just products are ticked (**my call**).
  Like Move and Delete they act on ticked rows a search hides; each button says how many.
- Dragging and its handles are in the Tree only. Switching views clears the ticks (**my call**).
- The move window's last button says Move, not "Move to…" (**my call**).

### 6. Adding and editing a product

- **Add product** opens the editor with no category chosen, which may be saved so, as today. Adding
  from a category's ⋮ chooses that category. This works wherever the editor opens, including over the
  menu editor once that can open it.
- In the editor's first card: Name (with its picture), then **Category as an ordinary field**, then
  Available. The "Change" link goes. A variant's page still shows its product's path as plain text.
  This changes the order in decision 11 of the
  [quieter product editor](2026-11-23-product-editor-quieter-design.md).
- The field's list begins with **Add category…**, which stays first while something is typed and then
  reads **Add category “Vermouths”**, also when a category of that name exists (names are unique only
  inside one parent). The shared list hides such a row while typing, and puts its own typed-add row
  last, so it needs a setting for this. It opens a small window: Name (filled with what was typed),
  **Inside** (a category, or none; it starts as the product's chosen category, else none), Colour (the
  chooser a category has today). Its button is Add category.
- Adding it returns to the product with the category chosen and its colour showing. The category is
  saved at that moment and stays if the product is then cancelled, as a unit added there does
  (**my call**). A refused name shows under Name.
- After a save the new product's row is brought into view, in whichever view is open, unless hidden
  (section 4).

### 7. Faults fixed with it

1. **Loading and failing.** No count is shown until products have loaded. A failed read shows its
   message in place of the table, with **Try again**. A refused move, rename or drop says so above the
   table, where it can be seen, and a refused category name is scrolled into view.
2. **Tick boxes and sort headings** (the shared table, so every list): the whole cell of a tick box
   ticks it, and the whole heading cell sorts. A help badge inside a heading keeps its own target, and
   so does the drag handle that shares the tick box's cell in Products and Menu structure.
3. **Back.** Opening a product adds a step to the browser's history, so Back closes it and stays on
   Products; with unsaved changes it asks first, as it does now. Adding a product adds a step too, so
   it needs an address of its own. Back from a variant opened inside its product returns to the
   product. Save and Cancel go back over the step the page added (as `closePainter` in
   `opening-hours-screen.ts` does), so one Back then leaves Products and does not reopen the product.
   A product opened straight from a link closes to the list. After a reload one spare step is allowed.
   Opening and closing categories still adds no step (**my call**).
4. **Deleting a category.** The title names it: "Delete Cheeses?", or "Delete 3 categories?" over
   their names. Two choices: "Keep its 5 products, with no category" (or "in Wine and beer" when it has
   a parent) and "Delete its 5 products too". Each choice also counts the categories inside, and says
   the routing rules that go. With different parents it says each category's own parent; categories
   with the same path stay numbered; products ticked as well are named in the title. An empty category
   with no routing rule still asks nothing. Changes of station are one line each where they agree,
   "All 5 will be made in Kitchen instead of Deli prep", with the full table folded under **Details**;
   where they do not agree, one line per pair of stations. Every check and refusal of today stays. This
   rewrites A296's words.

## Other text this changes

`docs/developers/design-system.md` (the Products list, trees, the filters panel, Select mode, the
table's headings and tick boxes), `docs/developers/products.md` (where categories are made, the
editor's category), and the products guide in English and Spanish, in short sentences.

## Delivery

Each piece is usable without the next. No schema change and no venue reset is expected. Lane D's
MENU-EDITOR-ONE-SAVE changes the same editor, screen and table: its 2(c) lets other screens open the
product editor, and its 2(d) draws the same rows. Pieces 5 and 6 are not built at the same time as
2(c); whichever comes second follows the first.

1. The shared table: whole-cell tick boxes and headings (7.2), and the dense-row setting. Any time.
2. Loading and failing (7.1). Any time.
3. The request that changes availability: one product or variant, then several. Server, full review.
4. Deleting a category (7.4). After DELETE-NOT-ARCHIVE, which rewrites the same window.
5. The Category field and Add category in the editor. After 2(c) is best.
6. Back (7.3). After 2(c) is best.
7. The list, after DELETE-NOT-ARCHIVE and pieces 1 and 3:
   (a) the row, the columns, the switch, the labels, filters and sorting, on today's tree;
   (b) the List, the view switch, Add product and the phone layout (until piece 5 lands, Add product
   uses today's Change link for the category);
   (c) Mark available and Mark unavailable in Select mode.

`product-list.ts`, `product-browser.ts`, `wt-data-table.ts` and `products-screen.ts` are close to their
size caps (the last to the default 1,000 lines): new code goes in new files.

Screenshots for the owner before landing 4, 5 and 7: 1440 px, 1180 px and 390 px, light and dark,
English and Spanish; for 7 both views, a category open, variants open, something unavailable, filters
on, Select mode, no matches, an empty List, and a failed load.

### Spanish (owner, "y")

Lista | Árbol · Dentro de · Añadir categoría «Vermuts» · Marcar como disponible / Marcar como no
disponible · 5 productos · 1 no disponible · No se vende por separado · ¿Eliminar Quesos? · Conservar
sus 5 productos, sin categoría · Eliminar también sus 5 productos.

## Left to the builder

The shape of the availability request; whether the two views are one table with two settings or two;
whether the row is shared with the menu editor's; how the column choices are kept for two views; the
exact words not quoted here.

## Pictures

Not committed. On the owner's machine, in the main checkout: `.impeccable/shots/products-mock-b2-list.png`,
`-b2-tree.png` and `-b2-add.png`. They are drawn, not screenshots: where they differ from a shared
`wt-*` component, the component wins. Cabrales, Prawns and Double coffee are drawn unavailable, and
the House vermouth example is invented; a variant that is off has no red label in them and should.
