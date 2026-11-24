# The menu editor: one table, one Save, publishing in the heading

Status: approved by the owner, 2026-11-24 (interactive design session, picture by picture, quoted
below). The points marked **my call** were the session's; the ones that matter were read out to the
owner at the end: "otherwise all good".

## Why

A critique of the Structure tab scored it 22 of 40: after an edit the page still says "Live: version
1", with only a star on Preview to say otherwise, and on a phone Preview is off screen; on landing,
Type says "Section" on every row below the menu's own and Available is blank; rows are about 71 px
tall. The owner added:

- "i also don't like how the header moves down when you edit a menu, it leaves less space on the page"
- "the idea is to add and arrange products and sections on the menu. one problem is that the drag
  handles are not visible by default"
- the menu's own row has no picture "so it looks weird. and if a section or product doesn't have an
  image there is no placeholder, which also looks weird"
- one table for structure and prices: "ideally yes"
- "use save/cancel for all changes. people don't need to edit the menu interactively. one person
  wants to work on it and then save all the changes, overwriting anything that is already there. we
  can remove all of the undo. leave the bar in place, fixed to the bottom, like we do with other
  similar screens"

## Goals, and what this is not

A person opens a menu, arranges it and prices it in one table, saves once, then reviews and
publishes. It must be as usable on a phone.

Not in this work: the Home page tab (its own design round; decided already: "A", its own Save and
Cancel in the same bar, asking before a tab change with unsaved changes), the guest menu preview
("needs its own design pass"; its button keeps working where it is), set menus' own pages beyond the
shared heading, the Products table beyond its new filter, and any change to what publishing does.

## Approaches

Saving: (1) save each change at once, as Structure does today; (2) hold prices until Save and save
moves at once; (3) hold everything until one Save. The session proposed 1, then 2. The owner chose 3:
it costs a draft of the whole menu on the page and a new save request, and in return one way of
saving, no undo, and most single-change requests retired.

Prices at rest: boxes in every row, or plain text that becomes a box when clicked. The owner chose
boxes ("I'd use A"), because text hides that a price can be changed.

Unpublished changes: words and a button in the heading, a link only, or the star made visible on a
phone. The owner chose the first ("A").

## Decisions

### 1. The heading

- One line: **Menus › Casa Delgado**, the name the `h1` and "Menus" a link, at the height a list
  page's heading has, so opening a menu moves nothing down. This replaces A335's "parent on a line of
  its own above" for the menu editor (**my call:** and for the set menu's own page, which shares it;
  other sub-pages are not changed here). On a phone the live words wrap under it.
- Then the live words without brackets, "Live: version 1 · 28 minutes ago", or "Unpublished" (a never-published menu also shows
  Review and publish, with no dot).
- While the saved menu differs from the live one, **● Unpublished changes** in the warning colour
  beside them, and a teal **Review and publish** at the trailing edge, which opens Preview. With
  nothing to publish, neither shows. The Preview tab's star goes.
- While this tab has unsaved changes, Review and publish is outlined, so Save is the only teal button.
  Pressing it then offers to save first (**Save and review** / **Keep editing**) (**my call:** the
  words).
- On Preview, Review and publish is replaced, in the same place, by **Publish later** and the teal
  **Publish now**. A menu whose publishing waits on clashes keeps the line that says so; it links to
  Structure filtered to clashes (to the Price overrides tab until piece 2 removes it).
- Tabs: Structure, Home page, Preview. The Price overrides tab goes. All three fit at 390 px.
- **Patch live menu…** leaves the heading and goes in the row ⋮ on the Menus list, for a menu with a
  live version, and nowhere else in the editor (owner: "why not put this in the actions menu on the menus home
  page instead?"). Its help badge and guide link go with it.

### 2. The table

- Columns: Name, Price and the pinned ⋮. Type, Available and the column chooser go. The heading ⋮
  stays (owner asked for it: "it takes up less space on the phone").
- Rows about 48 px on a desktop and 52 px on a phone (more where text wraps); pictures about 36 px,
  30 px on a phone, where they are shown too (owner: "A"; it reverses W85e for this tree).
- **Every row has a picture**: the photo, with the colour ring it has today; else an icon on the
  row's own colour or the neutral fill: a book for a menu, a folder for a section, cutlery for a
  product, a cloche for a set menu. The menu's own row and an included menu show that menu's photo
  when it has one. A variant shows its own photo, else its product's, else the icon (owner: "they
  should have an icon"). Preview's tree uses the same.
- **Order and spacing** (approved, "looks good"): the drag handle, then straight after it the arrow,
  the picture and the name. The menu's own row has no handle and starts at the left edge, its arrow in
  line with the handles. Each level steps in (18 px desktop, 12 px phone); variants step in past their
  product. The handle is always visible, on a phone too. Its target is as tall as the row but
  narrower than 44 px (about 30, 26 on a phone); the owner was told. The arrows all draw at one size
  (`.tree-toggle` in `wt-data-table.ts` lacks `font-family: inherit`).
- Section names are bold, then their count in muted small text ("5 products"); a closed section holding
  unavailable products says so ("4 products · 1 unavailable"); an included menu keeps "Menu: <name>",
  "Shown as a folder" or "Sections shown directly", then its counts; a set menu says "Set menu". On a
  phone these go under the name.
- A product that is not available says **Unavailable** in a red outlined label. Nothing is said when
  it is available.
- Bold underline for the current section goes; adds have named their own target since A453. The
  address still carries the last section opened, so a reload or a link returns to it (**my call**).
- Search: the outlined box the Menus list has, one line with Filters and Select. It also matches
  variants' names, as Price overrides does. Filters: Available (Yes / No), Price (Set on this menu /
  Clashes), Main category, Modifiers (has / none, as Products) and Variants (has / none) (owner asked
  after the last two). Price overrides' sort by price goes, and its Section filter, which the tree
  itself shows (**my call**).
- **Available** covers variants too: a variant that is off has the Unavailable label, and its product's
  row says "2 variants · 1 unavailable" (**my call**).
- "Included in: …" stays, as one muted line above the toolbar, only on a menu that others include.
- The name heading, sticky header and flat search are as today.

### 3. Prices in the row

- A product with no variants has a price box: a price set on this menu in bold with "usually €9.00"
  beside it (under the name on a phone); otherwise the usual price in muted italics. Emptying the box
  returns to the usual price.
- A product with variants shows its price or range as **plain text**: it is derived (owner). Its
  variants open under it, each with a box. **The menu's own price on a product with variants goes,
  underneath too** (owner: "agreed"), on ordinary menus only: nothing may set, inherit or publish one,
  `patchLiveMenu` refuses one, and a product that gains its first variant loses its price on every
  ordinary menu (**my call**). **A set menu's `gross_price` is a supplement and is not touched**, with
  or without variants.
- The usual prices, price sources and clashes shown follow the menu **as arranged on the page**, unsaved
  moves and includes counted, so nobody saves into a surprise clash. An included menu's contents and
  prices keep refreshing under an unsaved draft: they belong to that menu.
- The till's variant picker drops the difference from the product's price and shows only each
  variant's full price, which it already shows beside it (owner: "A").
- A dish has one price on a menu however many places show it (`menu_items` is unique on menu and
  product). Changing one box changes every box of that dish; while the price is changed and unsaved,
  each row says where else it is ("Also in Menu: Drinks › Cocktails").
- Products inside an included menu have a price box too; it sets this menu's price. Their place stays
  read-only. They and variants get a ⋮ holding only **Edit product**, as Price overrides has today; the
  pictures show none (**my call**). A set menu's price is plain text, edited on its own page.
- A clash is marked in the row as the Price overrides tab marks it, and settled by typing a price.
- A price the editor refuses today is refused here, under its field, per the Forms contract.

### 4. One Save for everything on the tab

- **Held until Save:** adding a section, products, an included menu or a set menu; moving by drag, key
  or Move to section…; removing; editing a section or an included menu's folder; prices.
- The bar holds Cancel and Save, always shown, fixed to the bottom, quiet and disabled until something
  changes, as on similar screens (`wt-form-actions`, A331).
- **Save sends the whole menu in one request, all or nothing**, in one transaction. It replaces what is
  there without warning if someone else changed the menu meanwhile (owner). Only what this menu owns
  is written: its sections, its members, its include settings and its own prices. Existing sections
  and members keep their ids, so Home page shortcuts and the publish comparison still match; a moved
  dish keeps its price.
- What no longer exists cannot be saved back: a product, variant, included menu or set menu deleted
  meanwhile, a price on a product that has gained variants, a price on a dish no longer inside an
  included menu. Save drops it, saves the rest in that same press, and names what it dropped
  (**my call**).
  Anything else the server refuses today (a cycle, a duplicate in one list, an ineligible set menu
  product) refuses the whole Save and is shown beside the row or, with no row, in the bar.
- While the draft has changes, live updates refresh what the products say (name, photo, usual price,
  availability) but never the draft's arrangement.
- Cancel drops everything back to the saved menu and asks first. Leaving the page, changing tab or
  opening another menu with unsaved changes asks, through the draft scope.
- Removing a product asks nothing; removing a section that holds something asks. Removal is **Remove**
  everywhere, a section included (it was Delete); a removed section is deleted when saved, and its
  products stay in the library.
- **Edit product** opens the product editor over the menu and returns to the same row. The product
  saves in its own window, at once, and the menu's unsaved work stays. So does its photo link.
- Adding stays in each row's ⋮, the menu's own row included (owner: a top button cannot say "what you
  want to add … and at what level"). Actions that open a window end in "…".
- The requests and functions this replaces are removed once nothing calls them. Still in use:
  Products' Add to menus (`addSectionProducts`), set menu dishes (`removeSectionMember`,
  `updateMenuItem`), the demo seeds and the fixtures.

### 5. Select mode

- Select adds tick boxes. On a desktop they go left of the handles, and dragging a ticked row still
  carries the visible ticks. On a phone the tick takes the handle's place and rows move with Move….
- One bar: "2 selected", **Move to section…** (**Move…** on a phone), **Remove**, **Done**. Remove takes
  off everything ticked, asking only when a section with something in it is included. This replaces
  Remove from menu, Delete and "Delete sections and remove other items separately."

### 6. Preview

- Two columns: warnings and changes, then the menu as it will be published. On a phone, two views,
  **Changes (6)** and **Menu**.
- What stops publishing (clashes, set menu problems) stays in full, first. Warnings fold to one line
  each with a count, "29 products with allergens not yet reviewed", opening to today's links.
  Publish now still confirms when there are warnings.
- **Changes are brief** (owner's examples), grouped: Added, "Popular drinks › Negroni"; Removed;
  Moved, "Catalan cream Mains → Desserts"; Prices, "Negroni €9.00 → €8.50"; Order, the section whose
  order changed; and the remaining kinds in the same style. A change made elsewhere ends in grey with
  where: "changed in Products", or the included or set menu's name.
- A variant's price change names it and its prices, "House coffee › Double €2.00 → €2.20"; today a
  change record holds neither, so it gains them.
- A shared product's change keeps the other menus it affects, after the grey note ("also on Deli
  takeaway").
- View, Edit, Hide and Show all changes go. The name is the link; it shows that row in the menu beside
  it, switching to Menu on a phone. A set menu's name links to its own page, a Home page change to its
  tab, and a change with no place in the menu is plain text.
- The language picker sits directly above the menu, with Internal names as today (owner: "important").
- The menu shows prices, a range for a product with variants, and the placeholder pictures. Expand all
  stays. Scheduled versions stay, below.
- The published, stale and failed messages, "these menus must be published too" and a refused schedule
  show directly under the heading on this tab.

### 7. Guide and design contract

The English and Spanish Products guide sections on arranging, pricing, previewing, publishing and
patching a menu change with their screens. `docs/developers/design-system.md`'s paragraphs on the
Structure tree, Price overrides, Preview, the sub-page heading and the menu editor are rewritten, not
appended to. Links to `/view/prices` (Menus list, publish problems, Preview) go to Structure, filtered
to clashes where they were.

## Delivery

Lane D, after DELETE-NOT-ARCHIVE and SET-MENUS-PAGE, which change the same files. Each piece is usable
without the next; the lane may split piece 2 further (the save request, then the table).

0. Products gains a **Variants** filter (has / none), as its Modifiers one (owner: "Products also needs
   a Variants filter"). Small, on its own.
1. (a) The heading, and Patch in the Menus list's ⋮. (b) Preview. The Price overrides tab is still
   there after this piece.
2. (a) No menu price on a product with variants, ordinary menus only: menu, patch, product save,
   import, till. It changes what is charged and published: full review path. (b) The save request: new
   write code over several tables, full review path; a comparison inside one transaction reusing the
   `sections.ts` checks, so ids and prices survive. (c) The product editor as something another screen
   can open. (d) The table with its draft, pictures, Select and Save. (e) Remove Price overrides and
   the unused requests.

Pre-live, so 2(a) may need a venue reset instead of carrying stored prices forward; its PR says so.

Screenshots for the owner before landing each: 1440 px and 390 px, light and dark, English and Spanish,
with unsaved changes, with unpublished changes, in Select mode, and a menu with no photos.

## Left to the builder

The shape of the save request and of the draft; the exact words not quoted here; whether the two
trees share one row component; how the bar clears the phone's on-screen keyboard.

## Pictures

Not committed. On the owner's machine, in the main checkout, `.impeccable/shots/menu-editor-mock-6.png`
(spacing, desktop and phone; the two coffee variants are drawn too far left there), `-7.png` (Select
mode and the variants' place), `-4.png` (the whole page and the bar; its spacing is superseded by 6),
`-9.png` (Preview). They are drawn, not screenshots: where they differ from a shared `wt-*` component,
the component wins. Drawn prices, counts, the "Popular drinks" section and the "no Spanish
name" warning are invented.
