# Venue operations: how the venue is organised and configured

**Status:** Draft, 2026-10-03. Every decision below was made by the owner in a design conversation
that day, over a series of mockups, unless it is marked **Proposed**. Each §11 step gets its own
plan; step 1's is [2026-10-03-venue-settings-and-navigation.md](../plans/2026-10-03-venue-settings-and-navigation.md).
Backlog entry: A261.

This spec builds on [A254](2026-10-03-departments-service-styles-hours-design.md) (departments,
service styles and opening hours) and changes it in two places: §4's day types are replaced by
special dates (§7 here), and the trading name's switch gets a home and a position on the receipt
(§5 here). A254's other decisions stand, including its split of the four-value service style into
separate settings (A254 §3) and its open questions about tabs at the counter (A254 §3.1).

The approved mockups are in [2026-10-03-venue-operations-mockups/](2026-10-03-venue-operations-mockups/).
They are HTML fragments drawn for the brainstorming tool, so a browser shows them without its
styling. Where a later mockup replaced part of an earlier one, this spec says which one wins.

## 1. What exists today

Checked by reading the code on `main` at `92711bdf5`; nothing was run.

- **Prep stations** already has a page of its own (`/manage/prep-stations`,
  `packages/venue-service/src/dashboard/prep-stations-screen.ts`). It shows one card per station
  with its status, hours, "Close for today", fallback, late flags, printers, screens, watchers and
  the folders it claims, followed by the routing tester, the exceptions, unassigned folders and
  watchers.
- **Routing** (`chooseMaker`, `packages/venue-service/src/routing.ts`) tries the ordered exceptions
  first (`route_exceptions`; the first that matches wins), then the nearest folder claim walking up
  the category tree (`station_claims`), then the default station (`kitchen_stations.is_default`).
  A closed station's work then follows its fallback chain. Variants route as their parent product.
- **Late flags** are three columns on each station (`warm_after_minutes`, `overdue_after_minutes`,
  `forgotten_after_minutes`, defaults 5, 10 and 15), and a database check keeps them in that order
  (`packages/db/src/schema/kitchen-stations.ts`). There is no venue-wide default.
- **Live kitchen state** is in `ticket_items`: one row per dish sent to a station, in state
  `queued`, `preparing` or `ready`. Bands (warm, overdue, forgotten) are computed by `classifyBand`
  (`packages/shared/src/timing.ts`) for the station, expo and floor screens. Nothing counts dishes
  per station and nothing measures waiting time.
- **A station is never deleted**, only switched off, because past tickets name it
  (`deactivateStation`, `apps/server/src/kitchen.ts`).
- **Kitchen screens** pick their station or watcher once, when the device joins
  (`apps/server/src/join-api.ts`); no route changes it afterwards.
- **Printing rules** (`apps/dashboard/src/screens/printing-rules-screen.ts`) holds the kitchen ticket
  routing (which printers serve each station, which print a watcher's copies), each till's receipt
  printer, the receipt print mode and the cash drawer policy. A238 moves the receipt printers to the
  device profile.
- **Receipts** is its own page under Settings (`apps/dashboard/src/screens/receipts-screen.ts`):
  the receipt language, an owner-written header line, a footer message, the description sent to
  the tax agency, and a live preview the server draws as the printer will print it.
- **The receipt language** is stored as a list on the venue (`locations.invoice_locales`). Since
  #1014 (C113, owner-approved 2026-10-02) every save stores exactly one entry: the venue's default
  receipt language. Staff can still print a copy in another of the country's receipt languages
  (#1022), for example Spanish in Catalonia, where the default must be Catalan.
- **The cash drawer policy** (`locations.drawer_open_policy`, `gated` or `open`) decides whether
  opening the drawer by hand needs the `cash.drawer` permission. Permissions come only from the
  four-level role ladder, and `cash.drawer` starts at supervisor
  (`packages/identity/src/permissions.ts`).
- **The Kitchen page** (`apps/dashboard/src/screens/kitchen-screen.ts`) holds courses, bump mode and
  fire control, and links to Prep stations.

## 2. The sidebar, and three kinds of page

Pages are of three kinds: **structure** (what the venue is built from and keeps referring to),
**set-once settings**, and **live** (used during service). Mockup: `nav-v2.html`.

The sidebar, top to bottom:

- **Overview**
- **Reporting** (A251)
- **Service**: Live floor (new, a watcher's view) and Bookings
- **Products and menus**: unchanged
- **Venue operations**: Departments and zones, Hours, Floor plan, Prep stations, Venue settings
- **Team** and **Purchasing**
- **Settings**: the existing group, less what moves out below. Its code id is `configuration`, but
  its English label is already "Settings", so the new page is called **Venue settings**.

Pages that go:

- the **Kitchen** page: its settings move to Venue settings › Kitchen (§3);
- the **Statuses** page: it becomes Venue settings › Tables;
- the **Receipts** page: it becomes Venue settings › Receipts (§5);
- the **Printing rules** page (§9);
- on today's Venue operations screen, the **Status** tab (a readiness checklist: a problem now shows
  on the row it is about) and the **"Changes after sending"** tab, whose settings are split by
  subject across Kitchen and Floor.

## 3. Venue settings

One page, one tab per group. Each tab's settings are set once and left.

- **Venue details** (new): the venue's name, address, time zone and business-day start. Today these
  are set only during setup. The legal name and tax ID are the taxpayer's and are not edited here.
- **Receipts**: §5.
- **Tables** («Mesas»): a **Needs clearing** switch at the top (whether a table a party leaves shows
  "Needs clearing" until staff mark it clear; `service_settings.clearing_workflow`, which has no
  switch today), then today's Statuses page unchanged: the labels staff set on a table by hand from
  the till. These labels are separate from the states Waitron sets itself (Free, Occupied,
  Reserved, Needs clearing, Bill requested and the kitchen signals), which are not on this tab;
  designing those is A267 (§10). The demo seed's hand-set labels are renamed, because "Free",
  "Occupied" and "Reserved" copy the built-in states' names while driving nothing.
- **Adjustment reasons**: the discount and void reasons, and the largest discount on one bill.
- **Kitchen**: courses; bump mode; fire control; the late-flag defaults (§6.5); the held-course
  reminder; identical dishes on a ticket; printing held courses; allowing changes after sending.
  Fire control was missing from the list the owner saw; it is the Kitchen page's third setting, so
  it moves with the other two.

## 4. Departments and zones

Mockup: `tree-v4-inplace.html`, which replaces the tree with a side editor in `tree-v3.html` and the
department editor in `routing-v4-and-department.html`.

**One table, edited in place.** Department rows with their zones nested under them, like
categories and products. There is no editor panel: clicking a cell opens its dropdown or text box.

- **Columns**, grouped by heading:
  - **On the receipt**: *Trading name* and *Print it* (a switch, with a Preview link, §5). Department
    rows only; on a zone row these cells are empty, because a zone has neither.
  - **Quick sales** (no table and no tab): *Paid* (before preparation, or on collection) and
    *Order number* (numbered, or none).
  - **Tabs**: *Bill* ("Pre-bill first" or "Invoice is the bill"), waiting on the advisor (A254 §3.3).
  - **Every sale**: *Receipt* (always, on request or never). This is today's venue-wide
    `receipt_print_mode`, moved to the department with a zone override (A254 §3.2).
- **Inheritance.** A department's cells are always set, and their dropdowns have no blank entry. A
  zone's cells may be blank: the dropdown's first entry is blank, and a blank cell shows the
  department's value in grey. There is no other marker.
- **Moving a zone** to another department is a drag onto that department.
- **Row menu (⋮)**: Rename and Remove on a zone; Rename, Remove and Hours (opening the Hours page)
  on a department. Names are also edited in place.
- **Removing** switches a department or zone off rather than deleting it, as today, so past orders
  and reports keep its name (`deactivateDepartment`, `packages/venue-service/src/operations.ts`;
  `deactivateZone`, `apps/server/src/tables.ts`). Owner, 2026-10-03:
  - **Removing a department that has zones warns, then removes its zones with it.** The warning lists
    each zone and how many tables it has ("This also removes Deli counter (4 tables)"); confirming
    switches off the department and those zones in one transaction. This replaces today's refusal,
    `department.has_active_zones`.
  - **Removing is refused while a tab is open at a table in a zone it would remove**, naming the
    table. This applies to removing a single zone too, which today checks nothing.
  - **The last department cannot be removed.**
- **New department** and **New zone** sit at the top right.
- **A problem that stops a zone taking orders** is a red line under the zone's name, lined up with
  it, with a link to where it is fixed, for example "No menu is offered here. Set one up in Menus".
- **Not in this table:** menus (which menus a zone offers, and when, belongs on the Menus screen;
  redesigning that screen is outside this spec, apart from the rule that menu assignment moves
  there) and table counts (tables are placed and counted on the floor plan).
- **Zones are created here.** The floor plan only places tables into existing zones.

**A venue with one department** shows no department rows. Its department appears as an **"Every
zone"** row at the top, holding the defaults and the trading name, the same idea as Routing's "All
categories" row (§6.2). When a second department is added, that row becomes the first department's
row, already named after the venue (A254 §2).

## 5. Receipts

Mockups: `receipt-trading-name.html` (option A) and `receipts-under-venue.html`.

- **The trading name prints first**, above the legal name, when its department's *Print it* switch
  is on. The legal name, the owner's header line and the NIF follow as today
  (`apps/server/src/receipt-ticket.ts`), so everything the regulations require still prints. The
  printer prints every line at one size, so position is the only emphasis.
- **Which trading name:** the department the sale was made under.
- **Receipts becomes a tab of Venue settings.** It holds:
  - the **default receipt language** (C113; a copy can be printed in another, #1022); it lives
    only here; `receipts-under-venue.html` shows
    two languages, drawn before C113 was noticed; today's single picker is what moves;
  - the header line, now described as printed under the legal name;
  - the footer message;
  - the description sent to the tax agency with each sale;
  - the live preview, as today, with a **Preview for** picker choosing which department's receipt
    it draws. The picker appears only when there is more than one department.
- **The Preview link** beside a department's *Print it* switch opens this tab with *Preview for*
  set to that department.
- The trading name itself is edited only in the Departments and zones table; the Receipts tab says
  where.

## 6. Prep stations

Mockups: `stations-tabs-v3.html`, with routing as in `routing-v4-and-department.html`.

**One tab per subject**, each a table with a row per station (per category on Routing), so stations
are compared one subject at a time. Every value is edited in its cell: a click opens a dropdown, or
a multi-select dropdown for a list. Tabs in order: **Stations, Routing, Tickets, Watchers,
Settings.** "New station" and "New watcher" sit at the right of the tab bar. "Folders" are called
**categories** everywhere on these tabs, in every language (today's wording says "folder" and
"carpeta").

### 6.1 Stations: the live health page

- **Columns:** name (with a *Default* badge), today's state, dishes **Waiting**, **Being made** and
  **Ready**, **Late** (how many dishes are warm, overdue or forgotten, coloured to match), and
  **Oldest** (the longest any dish there has waited). The numbers update on their own; clicking one
  lists those dishes.
- **Today's state and its button:** "Open until 01:00" with *Close for today*; "Opens at 12:00" with
  *Open for today*; "Closed for today, work goes to Kitchen" with *Back to the schedule*. These are
  today's whole-day overrides (`station_day_states`). The default station reads "Always open" and
  has no button.
- **A station with no kitchen screen** has nobody marking its dishes as being made or ready, so it
  shows "No screen" in those two columns. Its dishes count as waiting until they are served, and
  its lateness runs from when the dish was sent to the station, as the kitchen screens count today
  (owner, 2026-10-03). The print time is recorded too (`print_jobs.delivered_at`, through
  `kitchen_print_jobs.print_job_id`), but counting from the sending makes a dish behind a jammed
  printer turn late rather than look fine.
- **Problems** sit under the name in red, as today's warnings do: a stopped printer, a screen gone
  dark.
- **Creating and changing stations happens here:** *New station*; the row menu has Rename, Make
  default and Switch off (Switch on for a switched-off station); rows are reordered by dragging,
  which replaces the "Display order" number. A station is never deleted (§1). Switched-off stations
  are greyed at the bottom.
- Hours are not edited here; they are on the Hours page (§7).
- Per-station counts are new server work: today nothing groups `ticket_items` by station. The live
  subscription that feeds them follows CLAUDE.md's rule that subscription names travel with their
  server sources.

### 6.2 Routing: a grid

**Layout.** Categories down the side, nested as they are on the Categories screen, with each
top-level product as a row inside its category. Service zones run across the top, after an
**Every zone** column. Each cell holds a station or **No preparation**.

- **The top row is "All categories".** Its *Every zone* cell is the default station (setting it is
  Make default, and it can never be blank). Its zone cells replace today's "everything in this
  zone" exceptions.
- **Products with no category** sit in a "No category" group at the bottom. **Proposed:** this keeps
  them visible, as today's "Unassigned" card does.
- **Every cell shows its result**: a set value in normal text, an inherited one in grey. Clicking a
  cell opens a dropdown whose first entry is blank (clearing the cell), then the active stations,
  then No preparation. Switched-off stations are not offered.
- **Expand and collapse.** ▸ and ▾ collapse and expand a category, and *Expand all* and *Collapse
  all* sit above the grid. A collapsed category still shows every row inside it that has a setting
  of its own, at any depth, and says how much it hides ("24 more products, 2 more categories").
  Categories start collapsed, so a long menu opens as its top categories plus its exceptions.
- **The tester** ("Where is this made?": product, extras, zone, when) stays at the top, and explains
  its answer in the grid's terms ("Terrace bar: Drinks, on the Terrace").

**The rule for a dish.** Start at the dish's own row: its product row, then its category, then each
parent category in turn, then All categories. In each row, take the dish's zone cell if it is set,
otherwise that row's Every zone cell if it is set, otherwise move up to the next row. The first set
cell decides. Then a closed station's work follows its fallback chain, as today. So a category's own
Every zone setting beats its parent's zone-specific setting: with Drinks set to Bar everywhere and
Terrace bar on the Terrace, Cocktails left blank go to the Terrace bar on the Terrace, but Coffee
set to Kitchen goes to the Kitchen there too. The owner accepted this rule, and every cell shows its
result, so a surprise is visible on the screen.

**Storage.** One table of cells replaces `station_claims` and `route_exceptions`. A cell is (a
category, a top-level product, or All categories) × (a zone, or Every zone) → (a station, or No
preparation), at most one per pair. The All categories × Every zone cell is not stored: it is the
default station, `kitchen_stations.is_default`, as today. The ordered list goes, and with it the
check for exceptions that can never fire (`unreachableExceptions`).

- **Extras** keep their rule (`chooseExtraMaker`): an extra decided by the default station, rather
  than by a set cell, follows its dish.
- **No conversion.** Waitron is not live, so venues set their routing up again, the demo data is
  rewritten, and the owner's box is set up again (as A238 already requires).

### 6.3 Tickets

- One row per station: **Printed on** (a multi-select of printers), **Shown on screens**, **Also
  seen by**.
- **Printed on** writes today's `station_printers`; a printer may print for several stations. A
  printer that prints a watcher's copies is shown greyed in the dropdown with the reason, because
  it cannot also print station tickets.
- **Shown on screens** is read-only, with a link to Devices: a screen picks its station when it
  joins. Changing it afterwards was considered and left out for now.
- **Also seen by** lists the watchers following the station, read-only; what a watcher follows is
  edited on the Watchers tab.

### 6.4 Watchers

One row per watcher: **Follows** (every station, or a list), **For service zones** (every zone, or
a list), **Runs the pass**, **Screens** (read-only, as on Tickets) and **Printers** (a
multi-select, writing `watcher_printers`). Row menu: Rename and Remove.

### 6.5 Settings

One row per station: the three late flags, **Show the rest of the order**, and **When closed, work
goes to** (the default station reads "Never closes").

- **The late flags have venue-wide defaults** in Venue settings › Kitchen. A station may override
  any of the three; an empty box uses the default, shown in grey.
- **They must stay in order** (warm, then overdue, then forgotten), and the check moves from the
  station's own columns to the values the station ends up with:
  - saving a station whose result is out of order is refused, beside the field;
  - changing a venue default that would put some station out of order is refused, and the message
    names the station.
  The database's check on the three columns cannot see the venue default, so it is replaced by
  these two checks in code; the error codes follow the existing `station.*` codes.

## 7. Hours

Mockup: `hours-v3.html`.

- **A standard week grid**: Monday to Sunday down the side; departments across the top, then prep
  stations after a thick line. A cell holds one or more periods ("09:00–14:00, 17:00–20:00") or
  Closed. Hours past midnight belong to the day that opened.
- **The default station's column reads "Always open"** and cannot be edited or closed for a day,
  because it takes any work no other station does (`stationStatus`, `routing.ts`). `hours-v3.html`
  showed it with hours; this corrects it.
- **Department hours never stop a sale** (A254 §4): they are the public opening hours. Only stations
  act on hours, by sending work to their fallback.
- **Special dates replace A254's day types**, with no setup step:
  - one row per date, with a name and a colour, and the same columns as the week grid;
  - an empty cell keeps the standard hours, shown in grey;
  - a *Close the whole venue on a date* button;
  - **Duplicate** asks only for the new date or dates, and copies the name, the colour and every
    cell.
- **A calendar view**: a Monday-first month grid, each special date shown with its name in its
  colour. Clicking a date opens a panel with Edit, Duplicate and Delete; an ordinary date offers
  *Make this a special date*.
- **Colours**: a fixed one for a standard day and one for Closed (every department shut); neither is
  in the set a row picks from. A partly closed day (the deli shut on Sunday) stays standard. This
  was read from the owner's "Beautiful!", not stated outright.
- **Today's station hours form** (`station-hours-form.ts`) and the hours on the station card go;
  the station's whole-day override stays on Prep stations › Stations (§6.1).

### 7.1 Public holidays (festivos)

- The national and regional list ships as a data file, updated each year once the BOE publishes it.
  2026's is BOE-A-2025-21667 (read on boe.es on 2026-10-03); its annex is per region, and the region
  comes from the venue's province. In 2026 some regions move Todos los Santos to Monday 2 November.
- Local holidays (up to two per town, published in regional or provincial bulletins rather than one
  list) are entered by the owner.
- The calendar shows a festivo even without special hours ("Fiesta Nacional · standard hours").
- *Duplicate* and *Make this a special date* name the new date after its festivo, otherwise after
  the original.
- The wages work in A9 needs the same list; build one for both.

## 8. Floor, live floor and the till's starting zone

- **The floor plan editor** moves under Venue operations and only lays tables out on a map: no zone
  settings on it. Bar stools and counter positions are one-person tables. A group standing at the
  bar is a named tab with no table (A254 §3.1).
- **Live floor** is used on tills and handhelds, plus a watcher's view on the dashboard. The
  dashboard view gets its own spec.
- **A till's starting zone** is set on the device's own editor on Devices, reversing R10 of
  2026-10-01 in [the catalogue, menus and routing design](2026-09-30-catalogue-menus-routing-design.md).
  The venue-wide counter default stays only as the fallback for a device with none.

## 9. Printing rules and the cash drawer policy are deleted

Where each part of Printing rules goes:

| Today on Printing rules                          | Goes to                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| Each till's receipt printer                      | The device profile's printer lists (A238)                |
| Which printers print each station's tickets      | Prep stations › Tickets (§6.3)                           |
| Which printers print a watcher's copies          | Prep stations › Watchers (§6.4)                          |
| The receipt print mode                           | The *Receipt* column in Departments and zones (§4)       |
| The cash drawer policy                           | Deleted                                                  |

- **The cash drawer policy is deleted.** Opening the drawer by hand always needs the `cash.drawer`
  permission; who may do it is decided by giving people the permission. Until roles can be defined
  by the venue (backlog: "Roles are something an admin can add and edit"), `cash.drawer` comes with
  the supervisor role, and anyone else gets the drawer opened by a supervisor's PIN at the till, as
  the `gated` policy works today. `locations.drawer_open_policy` and its readers go.
- **Receipt and card payment slip printers belong to the device profile**, which A238 already does.
- With all of that gone, the page is deleted, which settles backlog A242.

## 10. Recorded elsewhere

- **Table states and signals (A267)**: which states and signals a table has that Waitron sets
  itself, which a venue can switch off, which customers can trigger (asking for the bill or calling
  a waiter from a QR code, for example), whether marking a table reserved by hand becomes a
  built-in action rather than a hand-set label, and whether hand-set labels are still needed after
  that (owner: "we may find we don't need custom table states"). Owner, 2026-10-03; its own design
  session.
- **Waiters' floats (A240)** belong with clocking in and out, under Team. Where the settings for
  recording cash in and out of a drawer (A239) go is not decided; its own spec decides.

## 11. Build order

Each step is one queue item, with its own plan.

1. **Navigation and Venue settings.** The sidebar moves; Venue settings with its tabs; Receipts and
   the receipt language on the Receipts tab; Tables, Adjustment reasons and Kitchen gathered
   from their old pages, and the Needs clearing switch. No behaviour changes.
2. **Departments and zones.** The table (§4), A254 §3's separate settings, the trading name on the
   receipt with the Preview link (§5), and the receipt print mode per department and zone.
3. **Prep stations tabs.** Stations with the live numbers, Tickets, Watchers and Settings, with the
   late-flag defaults. The Routing tab holds today's routing screen unchanged until step 4.
4. **The routing grid** (§6.2).
5. **Hours** (§7): the week grid, special dates and the calendar.
6. **Public holidays** (§7.1).
7. **Editing the venue details** (§3). Its plan first checks what changing each one affects: for
   example the time zone and business-day start decide which day a sale and a daily close belong
   to.
8. **Delete Printing rules and the cash drawer policy** (§9), once A238 has landed and steps 2 and 3
   have moved the receipt print mode and the kitchen printers.

## 12. Open

1. Everything A254 §6 lists, apart from what this spec settles: A254 §4's day types (replaced by
   §7) and the trading name's switch (§5).
2. **Proposed, not yet confirmed:** products with no category sit in a "No category" group in the
   routing grid (§6.2).
3. Step 7's plan decides, for each venue detail, whether a change is allowed, allowed with a
   warning, or refused once the venue has made sales (§11).
