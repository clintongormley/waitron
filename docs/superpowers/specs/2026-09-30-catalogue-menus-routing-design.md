# Product folders, menus that include menus, and prep station routing

> **2026-10-05 — A261 step 3:** For the replacement station, printer, watcher and timing controls, see the [Prep stations tabs implementation plan](../plans/2026-10-05-prep-stations-tabs.md) and its dated implementation checkpoints. This document retains the earlier screen layout and procedures as historical context.

**Status:** owner decisions of 2026-09-30, from one brainstorm covering categories, menu sections,
labels and kitchen routing together, so the four agree with each other. The owner reviewed and
approved this document the same day, including §7's defaults. Not built. It is built in
three slices (§6), each with its own plan and pull request.

**What this replaces.** Where this document disagrees with an earlier one, this one wins:

- [The menus design](2026-09-20-menus-categories-and-home-layouts-design.md): reusable library
  sections and the Sections screen (§1–§3, §10.1), labels (§10.1), the kitchen-routing outline
  (§10.5), and publishing's rule that drops a shortcut tile whose target has gone (plan decision
  D13).
- [The sales classification design](2026-09-25-sales-classification-and-category-reports-design.md):
  everything about labels, and translated category names.

Facts about today's code were read from `main` on 2026-09-30. They are readings, not measurements.
Each names its file so it can be re-checked before building.

---

## 1. The idea in one page

- **Categories are for reporting and routing.** They are folders in the products screen. Each has
  one internal name, with no translations, no image and no colour. The Categories screen goes.
  Superseded 2026-10-05 by W92
  (`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
  colour again, which products inherit.
- **Folders also decide where things are made.** On one new screen, **Prep Stations**, each station
  claims folders. Ordered exceptions sit above the claims, and the venue's default station catches
  the rest.
- **A menu is built from sections that belong to it.** Sharing between menus works one way only: a
  menu can **include another menu**, which arrives with its own sections, products and prices. The
  Sections screen goes.
- **Every price and on/off switch follows one rule.** A menu's own setting wins. Otherwise
  everywhere the product appears must agree, and a disagreement blocks publishing until the menu
  sets its own.
- **Labels are removed.** Folders now do everything they were meant to do.

---

## 2. Categories: the products screen as a file browser

### 2.1 What a category is

A category is a folder for reporting and routing: reports roll up along it, and stations claim it
(§5.5). It has one internal name (not translated) and at most one parent.
A product has at most one category. A product with no category sits at the top level, which is
what "Uncategorised" means today. Reports roll up along the tree, as now.

**Removed from categories:**

- the translated name, which becomes one plain name;
- the image and the colour;
  Superseded 2026-10-05 by W92
  (`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
  colour again, which products inherit.
- the kitchen station.

Today's schema for reference: `categories` (`packages/db/src/schema/catalogue.ts:25`) holds a
translated `name` and `station_id`, and `category_details`
(`packages/catalogue/src/schema/categories.ts:4`) holds `parent_id`, `image` and `color`. Nothing
outside the Categories screen reads the image or the colour (`docs/backlog.md`, "A category's
colour is stored but shown nowhere"). The image is also tracked by the media library's usage
records (`packages/media/src/images.ts`), so removing it touches media's triggers (§6, risks).

What stays the same: the tree rule, which refuses a loop (`validateParent`,
`packages/catalogue/src/categories.ts`), and the recording of each sale line's category chain when
the line is added.

### 2.2 The products screen

> 2026-10-02: the folder view became a category tree; see
> [2026-10-02-products-category-tree-design.md](2026-10-02-products-category-tree-design.md).

The products screen shows products and folders together.

- **Folder view.** You open a folder and see its subfolders and products. A breadcrumb shows where
  you are. You can add a product or a folder at the current level.
- **Flat view.** A toggle switches between "Folders" and "All products". The flat view lists every
  product with its folder path. It is for sorting by name or price, and for finding products that
  are switched off or missing something. Today's product list already shows every product in one
  table, with a category-path column and variants as child rows
  (`apps/dashboard/src/widgets/product-list.ts`). The shared table component can already switch
  between tree and flat display, as the Categories screen does. So this view largely keeps what
  exists.
- **Search** covers every folder and shows each result with its path, as a file browser's search
  does.
- **Variants** sit under their product, as today. They move with it and cannot be moved on their
  own.
- **Selection mode** is the main way to move or delete things. You tick products and folders, then
  choose an action from a bar: "Move to…" (pick a folder, or the top level) or "Delete". It works in
  both views. On a touch screen, and from the keyboard, it is the only way.
- **Drag and drop** is a shortcut: drag selected items onto a folder. This is new work. Today's
  drag code (`apps/dashboard/src/widgets/reorder-table.ts`) only reorders rows within one list.
- **Where each product is made** shows read-only, for example "Made at: Bar", with a link to Prep
  Stations. Routing is never edited here (§5.12).

### 2.3 Deleting a folder that still holds things

The screen asks which of these to do:

- **(a) Delete everything inside,** subfolders included. Products are switched off, as deleting a
  product already does (`products.active`, `packages/db/src/schema/catalogue.ts`). The rows stay, so
  sales history still points at them.
- **(b) Move the contents up** to the parent folder, or to the top level for a top-level folder.

An empty folder is deleted without asking. _(2026-10-06, A279: a folder holding only routing
rules now gets the confirmation, with the rule count — owner decision reversing 2026-10-01, which
is in commit `5ffa5c633c` and the backlog's folders entry.)_

---

## 3. Labels are removed

Labels (`labels`, `product_labels`, `packages/catalogue/src/schema/labels.ts`) are removed
completely:

- the Labels tab (`apps/dashboard/src/screens/labels-panel.ts`);
- the product editor's labels field;
- the product list's labels column;
- the label part of each line's recorded classification (`packages/shared/src/sale-line-classification.ts`);
- the per-label totals in the category sales report (`packages/reporting/src/category-sales.ts`);
- labels as a planned routing condition.

Waitron is not live, so no data is carried over (CLAUDE.md §3, "No backwards-compatibility or
data-migration code until Waitron is in production").

**Not touched:** `option_labels`, which holds the choices inside an options list ("rare / medium /
well done"). The name is shared by accident; it is unrelated.

---

## 4. Menus

### 4.1 A section belongs to one menu

A section is a folder inside one menu. It is never shared. Products are placed in it like
shortcuts, so one product can sit in several sections of the same menu.

A section has:

- an internal name;
- a customer-facing name, with translations;
- an optional image;
- an optional colour.

There is no description until something shows one. The till does not yet show a section's image or
colour (`apps/till/src/widgets/menu-browser.ts` shows a folder icon and the name), though the
published menu carries both.
Superseded 2026-10-05 for colour by W92
(`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): the till paints a section's
colour on its tile.

**Retired:** library sections (`sections.role = 'library'`, `packages/catalogue/src/schema/sections.ts`)
and the Sections screen (`apps/dashboard/src/screens/sections-screen.ts`). A menu's sections are
edited only in that menu's editor. That editor must therefore edit every section field; today
"New section here" asks only for the internal name (`docs/backlog.md`, menus Task 4's entry).

### 4.2 A menu can include another menu

- Any menu can include any other menu, as long as no menu ends up including itself, directly or
  through others.
- An included menu appears in the including menu as **one folder**, placed anywhere in its
  structure. For example, Evening's top level reads "Starters, Mains, Drinks", and Drinks opens to
  its own Beers, Wines and Cocktails. Its sections are not laid out at the including menu's level.
- So a menu needs the same presentation fields as a section: a customer-facing name with
  translations, and an optional image and colour. These are what the folder shows.
- A menu that is included elsewhere is still a menu in its own right. A bar till can run on Drinks
  alone.

### 4.3 One product, one price, in a combined menu

A **combined menu** is a menu plus everything it includes, directly or through other menus.

**Duplicates are merged.** The same product can arrive through several places. For example,
Afternoon's own Specials section and the included Drinks menu might both hold the house lager. It
is still one item, with one price and one on/off state, wherever it is tapped.

**The price rule.** A menu's price for a product is worked out as follows:

1. If the menu has its **own override** for the product, that is the price. It wins over everything
   the menu includes.
2. Otherwise, collect a price from **every place the product appears**. For the menu's own
   sections, that is the product's own price. For each included menu, it is that menu's price,
   worked out by this same rule. If they all agree, that is the price.
3. If they disagree, that is a **clash**. The menu cannot be published until it sets its own
   override.

_2026-10-01, owner: for a product with sizes, a price set for a specific size beats a price set
for the whole product, wherever each was set — so a menu's own price for the product does not
override an included menu's price for one size. Detail: the
[slice 2 plan](../plans/2026-09-30-menus-include-menus-slice-2.md), decision P4._

**Worked example.** Drinks overrides lager to €3.50. Afternoon includes Drinks and also puts lager
in its own Specials section, where it carries the product's own €3. Afternoon shows a clash:
"Lager is €3 in Specials and €3.50 in Drinks. Set Afternoon's price." Evening includes Drinks and
places lager nowhere else, so it sells lager at €3.50 with no clash.

**On/off follows the same rule.** A menu's own setting wins. Otherwise the sources must agree, and
a disagreement is a clash. Evening can switch off lemonade without touching Drinks. This is not
"sold out tonight", which the till handles during service.

_(Superseded 2026-10-05 by W90: a menu has no on/off setting of its own for a product or a variant;
see [the W90 design](2026-10-05-w90-remove-menu-offered-switch-design.md).)_

**Where prices are stored today.** Every product has its own price (`products.unit_price`). Every
menu can override it (`menu_items.gross_price`, empty meaning "use the product's price";
`packages/catalogue/src/schema/menu.ts:74`), and switch it off (`menu_items.active`). The new part
is how these combine across included menus.

**Clashes are warnings while editing, and block publishing.** An edit anywhere can create a clash
somewhere else. A price change in Drinks can create one in Afternoon, and nobody editing Drinks is
looking at Afternoon. So the edit is allowed, but:

- the editor of every affected menu shows its clashes, each with a one-step fix: "Set this menu's
  price" or "Set this menu's on/off";
- publishing an affected menu is refused until its clashes are resolved;
- editing an included menu can warn the editor, for example "This creates a clash in Afternoon".

This is safe because nothing reaches a till until a menu is published (§4.4).

**The editor shows each menu's own decisions**, for example "Evening sets its own price for 2 items
and switches off 1 item from Drinks". An override then reads as a visible exception, not a hidden
difference.

### 4.4 Publishing

A till sells from a menu's published, frozen copy (`menu_versions`, `menu_publications`). When an
included menu changes, **every menu that includes it**, directly or through others, shows
"unpublished changes". Each is published separately. Publishing the included menu does not
republish the menus that include it.

### 4.5 Home layouts

A home layout is the grid of shortcut tiles a device shows first. Each menu owns its layouts: one
default plus any named alternatives. Each device profile picks one layout per menu. This is
unchanged, apart from three points:

1. **Tiles can point into included menus.** Any section or product the combined menu reaches can be
   a tile, for example Drinks › Beers.
2. **Layouts are never inherited.** A device uses the layouts of the menu it runs. A menu does not
   pick up the layouts of the menus it includes.
3. **A tile whose target has gone becomes an empty slot.** An edit to an included menu can remove
   what an including menu's tile pointed at.
   - Today, publishing leaves such a tile out (plan decision D13, `docs/backlog.md`, menus Task 8's
     entry), and every later tile moves up one place.
   - Instead, publishing keeps an **empty slot** in its place. The till draws an empty space there,
     which cannot be tapped, so no other tile moves. Staff tap by position during service.
   - The editor shows the slot as "Missing: Drinks › Beers", with Remove and Replace.
   - The editor warns before and after publishing, for example "2 shortcuts on Evening's Counter
     layout point at things no longer in this menu".
   - The empty slot is a new kind of tile, on the till and in the published menu.
     _2026-10-01: [slice 2](../plans/2026-09-30-menus-include-menus-slice-2.md) implements this
     contract as `{ kind: "empty" }`, with till rendering and an editor offering Remove and Replace;
     its focused checks pass and landing is pending._

A deliberate blank tile, for spacing, is left out.

---

## 5. Routing: the Prep Stations screen

### 5.1 How routing works today

_2026-10-01: an order with a service zone did not reach steps 2–4; it used only the zone's
routes and refused a dish none matched (`route.missing`). Slice 3a replaced both paths with
ordered exceptions, ancestor folder claims and the active venue default. The former
`preparation_routes` table and product/category station fields are removed; station editing and
the default moved to Prep Stations. The list below records the design's starting point._

- **Stations** are managed on the dashboard's Kitchen screen (`apps/dashboard/src/screens/kitchen-screen.ts`):
  - name;
  - lateness thresholds;
  - the venue default station;
  - courses, bump mode and who fires courses.
- **A station can have printers and a screen.**
  - A station's printers are listed in `station_printers` (`packages/db/src/schema/station-printers.ts`).
  - A kitchen screen device is bound to one station (`devices.station_id`).
  - A printer can print one ticket per station, or one per whole order (`printTicketScope`,
    `packages/db/src/schema/printers.ts`).
  _2026-10-01 (slice 3d): a kitchen screen binds a station or a watcher; the whole-order setting
  is gone. [Plan](../plans/2026-10-01-watchers-slice-3d.md)._
- **Routing rules** are edited on a different screen: Venue operations › Preparation routing
  (`packages/venue-service/src/dashboard/venue-operations-screen.ts:730`, table
  `preparation_routes`). A rule matches a zone (or all zones) together with a product or a category,
  and names either a station or "no preparation".
- **Order of decision** (`apps/server/src/working-order.ts:1300-1303`):
  1. a matching zone rule;
  2. the product's own station;
  3. its own category's station;
  4. the venue default.

  A category's station does not pass down to its subfolders.
- **Each item goes to exactly one station.**
- **The expediter** is a till screen (`apps/till/src/screens/till-expo-screen.ts`) plus the venue's
  fire-control setting (`fireControlMode`, `packages/db/src/schema/tenants.ts`). It is not a
  station that receives items.

### 5.2 One maker, any number of watchers

- **Each item has exactly one maker:** the station that prepares it. The maker is chosen by the
  rules in §5.3, so nothing is lost and nothing is made twice.
- **Watchers get copies and make nothing.** A watcher is a screen or printer that follows either or
  both of these (§5.9):
  - **stations**, like an expediter watching the grill, fryer and cold stations;
  - **delivery areas**, like a runner watching the terrace.

### 5.3 How the maker is chosen

The first of these steps that gives an answer wins:

1. **Exceptions:** an ordered list, where the first match wins (§5.6).
2. **Station claims:** the nearest claimed folder above the product (§5.5).
3. **The venue default station.**

Then **opening hours and fallbacks** apply to the chosen station (§5.7). If it is closed, or its
printer or screen is down, the item goes to the station's fallback, then to that station's
fallback, and so on. The chain ends at the venue default.

The chosen station is **recorded when the work is sent**, as today. Changing a rule never moves
work that has already been sent.

_2026-10-01 (slice 3b, owner): the [3b plan](../plans/2026-10-01-station-hours-fallbacks-slice-3b.md)
replaces the fallback policy above. Closed and switched-off stations follow their fallback chain;
no replacement is a dead end, and the till asks where to make the dish before sending or taking
payment. Printer and screen failures raise alerts. Closing a station moves only new work._

_2026-10-01 (slice 3c-3, owner): a waiter can move a dish the kitchen has not started to another
station. At release, a held dish at a closed or switched-off station follows the current rules unless
a station chosen by hand remains switched on; that choice stays even when closed, without an alert.
If the rules find no replacement, the dish stays at its old station and raises an alert
([plan](../plans/2026-10-01-moving-dishes-slice-3c3.md)). A rule change alone still moves nothing
already sent._

### 5.4 Delivery area

_2026-10-01, approved R10: you set a till's default service zone on Venue operations › Service
zones and menus. Devices remains a core screen; configuration export does not carry devices or
their default zones. Slice 3a matches the order's service zone without an order-type condition._

Exceptions match on **where the finished item is delivered**. That single condition replaces
separate conditions for order type and ordering device. The delivery area is found as follows:

- **An order with a table** uses the table's area (its zone), whatever device took the order.
- **An order with no table** uses the ordering device's default area. Devices already have one
  (`device_zone_defaults`, `packages/venue-service/src/schema/service.ts`). A bar till is set to
  "Bar counter", for example.
- **A takeaway or delivery order** uses its own area, such as "Pickup", whatever device took it.
  That is how "takeaway goes to the packing station" becomes an ordinary exception.

> **2026-10-06 follow-up (W97):** a device's default zone and `device_zone_defaults` are gone,
> replaced by a device profile's starting zone; see the
> [devices, menus and service zones design](2026-10-04-devices-menus-and-service-zones-design.md).

### 5.5 Station claims

- **A station claims folders.** A claim covers everything inside the folder, including products
  added later.
- **Each folder has at most one claiming station.** Claiming a folder that another station holds
  moves the claim, after a confirmation.
- **A subfolder can be claimed by a different station**, and the nearest claim wins. For example,
  Bar claims Drinks and Cocktail bar claims Drinks › Cocktails.
- **"No preparation" is a built-in entry** that can claim folders like a station. For example,
  "Bottled drinks" needs nothing made.
- **The unassigned list** shows:
  - top-level folders that nobody claims;
  - top-level products outside any folder.

  These go to the venue default station, and the list makes that visible. A new top-level folder
  appears here until someone assigns it.

### 5.6 Exceptions

An exception reads as a sentence, for example "**Cocktails** from **Terrace** → **Main bar**":
what, then the delivery area, then the station.

- **Conditions.** Every condition given must hold:
  - **delivery area** (§5.4);
  - **folder or product.** A folder includes its subfolders.
- **Outcome:** a station, or "no preparation".
- **Order:** first match wins, and the list is reordered by dragging.
- **A product-specific route is an exception naming the product.** Products no longer carry a
  station field.
- **Warnings:**
  - "Can never match": an earlier exception catches everything this one would.
  - Each destination is checked. A station that is switched off, for example, is flagged.
    _2026-10-01 (slice 3b, owner): a switched-off station follows its fallback, like a closed one._

**The three examples this design was tested against:**

| Rule wanted | How it is written |
| ----------- | ----------------- |
| All drinks go to the bar. | Bar claims Drinks. |
| Drinks ordered upstairs go to the upstairs bar between 7 and 9pm; otherwise to the downstairs bar. | Exception "Drinks from Upstairs → Upstairs bar". The upstairs bar opens 19:00–21:00, with Downstairs bar as its fallback. |
| Drinks ordered on the terrace go to the terrace bar, except cocktails, which go to the main bar. | Two exceptions, in this order: "Cocktails from Terrace → Main bar", then "Drinks from Terrace → Terrace bar". |

### 5.7 Opening hours and fallbacks

- **Opening hours.** Each station has a weekly schedule, for example Upstairs bar, 19:00–21:00 on
  Fridays and Saturdays.
- **Manual open and close.** A manager can open or close a station by hand for today, for example
  closing the upstairs bar early because it is quiet.
- **Fallback.** Each station names a fallback station. While a station is closed, its work goes to
  the fallback, following the chain.
- **Printer or screen down.** The same fallback applies when a station's printer or screen is not
  reachable, and someone is alerted. Nothing disappears without anyone knowing.
  _2026-10-01 (slice 3b, owner): a down printer reroutes nothing; it raises an alert on the dashboard,
  on Prep Stations and on the station's kitchen screen, and the manager closes the station by hand.
  A station with dishes sent in the last hour still waiting, whose kitchen screens have all stopped
  checking in for three minutes, is alerted on the dashboard and Prep Stations, whether or not it is
  open — closing it moves only new work._
- **Rules never mention time.** Time lives on stations.

### 5.8 Extras

- **Extras are products** (`extra_list_items.product_id`, `packages/catalogue/src/schema/extras.ts:40`),
  so they have folders.
- **An extra follows its dish** unless its rule sends it to a different station. Fries in Extras ›
  Sides, claimed by the Fryer, split off to the fryer. Extra cheese in unclaimed Extras › Toppings
  stays on the grill ticket with the burger. The venue default alone does not split an extra off.
- **A split-off extra stays linked to its dish** (§5.10).
- **Plain options** ("rare / medium / well done") are not products. They always follow the dish.

_2026-10-01 (slice 3c-2): the full rule runs for an extra; matching nothing, or the default,
means it follows its dish; "No preparation" keeps it on the dish's ticket; a closed station with
no replacement leaves it with its dish, silently; it splits off only to a station other than its
dish's. [Plan](../plans/2026-10-01-split-off-extras-slice-3c2.md)._

### 5.9 Watchers

A watcher is a screen or printer that follows stations, delivery areas, or both.

- **Following stations** works like a kitchen display. An expediter at the pass follows Grill,
  Fryer and Cold, and sees every item they make, from any area.
- **Following delivery areas** works for every delivery area, including ones with no tables. A
  runner follows Terrace and sees every item for terrace tables, food and drinks together. A
  pickup screen follows Pickup and shows takeaway orders as their items come ready. A counter
  screen follows Bar counter. So an area watcher is a real watcher screen or printer, not the table
  plan: counters and takeaways have no table plan. The table plan may also show each table's
  progress, but that is an addition, not a replacement.

A watcher shows each item's progress (queued, being made, done), and it can mark its own copy done,
for example "plated and sent out". When the venue's fire-control setting is "expo", the fire
action appears on the expediter's watcher screen.

_2026-10-01 (slice 3d): a watcher is its own thing, not a station. Its station and service-zone
filters must both match. It marks its own Done; Away remains one shared mark. Fire is a switch on
the watcher. [Plan](../plans/2026-10-01-watchers-slice-3d.md)._

### 5.10 What a ticket shows

- **A dish and its split-off extras always mention each other,** on screen and on paper. For
  example, "Burger — with chips from Extras station", and "Chips — for the burger at Grill".
  _2026-10-01 (slice 3c-2): the dish's cross-reference says it is with the extra at its station;
  the extra's says it is for the dish at the dish's station. Paper prints each reference on a
  `> ` line. [Plan](../plans/2026-10-01-split-off-extras-slice-3c2.md)._
- **"Show the rest of the order"** is a setting per station, off by default. It adds the rest of the
  order under a clearly marked heading, "Also on this order (not for this station)", with each
  line's station:
  - on a **screen**, each line shows its progress;
  - on **paper**, it is a plain list. Many kitchens work from print alone.

_2026-10-01 (slice 3c-1): a station's own tickets, first send, FIRE, HOLD and reprint, and its kitchen screen's card view list it. The whole-order PASE ticket and correction slips do not, and neither does the column view. It lists items now with other stations, held ones as on hold; served, sent-away, made-here and no-preparation lines and dishes not yet sent are left out._

_2026-10-01 (slice 3d): watcher printers replace whole-order printing. A watcher's ticket is headed
by its name; its printers also receive matching correction slips, headed by the dish's station. An
existing whole-order printer prints its attached stations' tickets until you attach it to a
watcher. [Plan](../plans/2026-10-01-watchers-slice-3d.md)._

### 5.11 "Made here, no ticket"

A till can be set to say that items for certain stations are made on the spot. For example, on the
bar till: "Items for these stations are made here: [Bar]". Those items get no ticket. The bar is
still their maker. This is a **device setting, not routing**. Left empty, the bar gets tickets as
usual. Watchers do not see these items either.

_2026-10-01 (slice 3c-1): set this per device on the Devices screen, not per profile, and set it again after configuration export and import. "Here" is the device that first sends the item; paths with no device give it a ticket. The final station decides whether the device makes it here. A made-here item is never held: it is made the moment it is sent, even for a later course or in a held group, and the sending till shows a "Make now" list until the waiter dismisses it (owner, 2026-10-01). Once made it can be cancelled, not changed (D1). A dish an edit sends again keeps its first send's decision._

### 5.12 The screen

_2026-10-01, approved R7: slice 3a shows station printers and kitchen screens read-only, with
links to Printing rules and Devices. You attach printers on Printing rules and bind a kitchen
screen when it joins. Slice 3a builds claims, ordered exceptions, their previews and a
product/delivery-area tester; opening hours, fallbacks, watchers and extras follow in later slices.
Approved R6 leaves folder move/delete routing previews as a backlog gap: deletion counts rules
removed, but neither action lists products whose station changes._

**Prep Stations** replaces two things: the Kitchen screen's station list, and Venue operations ›
Preparation routing. It holds:

- **Stations:**
  - name;
  - printers and screen;
  - opening hours;
  - fallback;
  - lateness thresholds;
  - what the station watches, if it is a watcher;
  - "Show the rest of the order";
  - the folders it claims.

  _2026-10-01 (slice 3d): watchers are a separate group on Prep Stations. A station card says which
  watchers follow it. [Plan](../plans/2026-10-01-watchers-slice-3d.md)._

  Claims are added by picking from the unassigned list.
- **The unassigned list** (§5.5).
- **Exceptions** (§5.6).
- **A preview before a routing change is saved.** It lists the products whose station would change.
  This carries forward the menus design's §10.5 requirement: a claim moved during service reroutes
  tonight's orders, and the preview is the protection.
- **The tester.** Pick a product, the extras chosen, a delivery area, a time and an order type. It
  shows the maker, the watchers, and which step decided (which exception, which claim, the default
  or a fallback). It can also be opened from a product in the products screen, already filled in
  with that product.

Courses, bump mode and fire control stay where they are.

---

## 6. Build slices

Each slice gets its own plan and pull request. Slice 3 needs slice 1, because stations claim
folders. Slice 2 is independent of both.

**Slice 1: products and categories.**

- The file-browser products screen: folder view, flat view, search, selection mode, "Move to…",
  drag and drop, the folder-delete choice, and variants.
- Categories lose translations, image and colour.
  Superseded 2026-10-05 by W92
  (`docs/superpowers/specs/2026-10-05-w92-product-colours-design.md`): a category has an optional
  colour again, which products inherit.
- The Categories screen goes.
- Labels are removed (§3).
- The "Made at" column waits for slice 3.

**Slice 2: menus.**

- Sections belong to one menu.
- A menu can include another menu, with its presentation fields.
- The combined-menu price and on/off rule, with clashes.
- Republish marking.
- Home-layout tiles into included menus, and the empty slot.
- The Sections screen and library sections go.

**Slice 3: routing.**

- Prep Stations: claims, the unassigned list, exceptions, opening hours and fallbacks, watchers,
  split-off extras, ticket cross-references and "Show the rest of the order", "Made here, no
  ticket", the change preview and the tester.
- Removed: `preparation_routes` in its current form, the product and category station fields, and
  the old routing table on Venue operations.

**Risks every plan must check** (CLAUDE.md §3):

- **Removing a column may make drizzle rebuild the table,** and on this engine the rebuild's
  `DROP TABLE` silently deletes the rows of every child table that cascades from it. Before any
  rebuild of `products`, `categories` or `sections`, list the foreign keys pointing at the table
  (`docs/developers/conventions-data.md`). Slices 1 and 3 remove columns from `products` and
  `categories`.
- **Media's triggers name the catalogue tables:** `category_details.image` in
  `packages/media/drizzle/0001_image_references.sql`, and `sections.image` in
  `0002_section_image_references.sql`. Removing category images must remove those triggers in the
  same change. Slice 2 must keep the section ones working through any change to `sections`.
- **Configuration export and import carry all of this.** Routing is in
  `packages/venue-service/src/configuration-transfer.ts`. Labels and sections are in
  `packages/catalogue/src/configuration-transfer.ts`. Each slice updates what it changes.
- **Trace every consumer** before changing a field's meaning. The category name becomes one plain
  string. The sale-line classification loses its labels. The category report loses label totals.

---

## 7. Settled while writing — for the owner to check

These were not discussed. Each is the default this document takes.

1. **The venue default station has no opening hours and no fallback.** It is always open, because
   it is the end of every chain. If its printer is down, the alert is raised and the work waits on
   its screen, or in its print queue if it has no screen.
2. **The price rule applies to every price a menu can set:** a product's price, a variant's price
   override (`menu_item_variant_overrides`) and an extra's price on the menu
   (`menu_item_extra_items`). Each is merged and clash-checked the same way.
   _2026-10-01: the owner dropped per-menu extras while slice 2 was planned, so the rule covers a
   product's price and each variant's; a menu offer carries its product's extras lists at the
   lists' prices ([slice 2 plan](../plans/2026-09-30-menus-include-menus-slice-2.md))._
3. **An included menu's folder shows the included menu's customer-facing name.** The including menu
   cannot rename it. To show a different name, include it inside a section of your own.
4. **A folder with a claim that is deleted** takes its claim with it. Its products then fall to the
   nearest claim above, or appear on the unassigned list. Deleting it shows this in the routing
   preview (§5.12).

---

## 8. Left open for planning

- **Whether the till's table plan also shows each table's progress,** beside the area watchers
  (§5.9).
  _2026-10-01 (slice 3d): left as it is; a "being made" count and a refresh are in the backlog._
- **What the whole-order printer becomes.** A printer that prints one ticket per whole order
  (`printTicketScope = 'order'`) may be a watcher of a delivery area, or of every station. The
  routing plan decides and states why.
  _2026-10-01 (slice 3d, owner): watcher printers replace that setting. You set up a named watcher
  on Prep Stations, choosing stations and service zones that must both match. Its printers produce
  one copy per send, headed by its name, and every correction slip for a dish on that paper. A
  printer still set to "one ticket per order" prints its attached stations' tickets until you
  attach it to a watcher. The setting is gone; its column stays unread until the next reset.
  [Plan](../plans/2026-10-01-watchers-slice-3d.md)._
- **Bundles.** Waitron may gain bundled products, made of a list of other products: a set menu, for
  example. Bundles are not designed here. The direction for routing: each product in a bundle is
  an ordinary product in its own folder, so it routes by its own folder like any other. The bundle
  itself is made by no station. A bundle's parts mention each other on tickets, as a dish and its
  split-off extras do (§5.10).
- **Whether an included menu's clashes can be seen from the included menu's own editor,** as a
  list of "menus this change affects", or only from each including menu.
