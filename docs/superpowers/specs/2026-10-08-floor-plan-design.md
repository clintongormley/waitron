# Floor plans: the saved plan, today's plan and the till's map

**Status:** owner decisions of 2026-10-08, from one brainstorm that used Square for Restaurants'
floor plan editor as the reference. The owner approved this written spec on 2026-10-08. Not built. Behaviour below is the target design, not a claim
about what runs today; section 2 is the only part that describes today's code, and it cites where.

**What this replaces.** Where this document disagrees with an earlier one, this one wins:

- [Venue operations](2026-10-03-venue-operations-design.md) (A261) §8, first bullet: the editor
  still only lays tables out and has no zone settings, but it now also creates, names and deletes
  tables, and holds their seats and saved joins.
- [Service times, departments, zones and prep stations](2026-10-07-service-times-departments-and-stations-design.md)
  (A366) §9.1's "There is no separate 'tonight' plan in this design" and §14's "A 'tonight' copy of
  the floor plan that resets each day": today's plan (section 6 here) is that copy, and it is in
  this design. §9.1's entry points ("Edit floor plan", "Add a floor plan" on a zone) stand.
- The backlog's later item on changing the working layout during service (join/split, chair
  counts, a daily reset from a saved default) is covered by section 6.

## 1. Why

Today a table's place on the map is stored on the table itself, so a venue has one layout and
staff can only change it by editing the master copy. Tables are added one at a time on a separate
tab, a table's drawn size is worked out from its seat count, and there is no undo. On a phone the
map's tokens are too small for the totals and chips drawn on them, which the backlog records
several times. The owner wants a Square-style editor, a plan staff can rearrange during service
without touching the saved one, and a map whose job on the till is statuses and rearranging, with
the details one tap away.

## 2. What exists today

- **One placement per table.** `dining_tables` holds `pos_x`, `pos_y` (thousandths of the canvas),
  `shape` and `rotation` (`packages/db/src/schema/dining-tables.ts`). There is no plan entity.
- **Seats exist.** `dining_tables.capacity` is an optional seat count edited on the floor screen's
  Config tab; it sets the drawn size (`sizeForCapacity`, `packages/ui/src/floor.ts:82`) and nothing
  else. The canvas is a fixed 3:2 (`FLOOR_ASPECT`, `packages/ui/src/floor.ts:3`).
- **Table names are unique per venue, switched-off tables included** (`dining_tables_location_label_key`).
- **A zone is optional on a table**, and a table in no zone cannot take orders (backlog, the
  no-zone table question).
- **Placement routes:** `PUT`/`DELETE /management-api/tables/:id/placement`
  (`apps/server/src/management-api.ts:1810`, `:1846`) and the till's own pair, which needs
  `venue.configure` (`apps/server/src/till-api.ts:2994`). The till's `table-layout-editor` card
  turns editing on (`apps/till/src/widgets/card-grid.ts:371-375`).
- **What points at a table by id**, with a foreign key: `party_tables.table_id`, kept after a party
  closes (`packages/db/src/schema/parties.ts`); `orders.delivery_table_id`
  (`packages/db/src/schema/orders.ts:88`); and `bookings.table_id`
  (`packages/bookings/src/schema/bookings.ts`).
- **An issued receipt already holds the table's name as text.** Issuance freezes it onto the order's
  `label`, and a reprint reads that copy (`apps/server/src/receipt-order.ts:41-43`). The table-name
  readers found (`partyTableLabels`, `packages/db/src/party-table-labels.ts:8-22`) read only tables
  a party still holds (`left_at` null), and giving up a table fills `left_at` (`leaveTables`,
  `apps/server/src/parties.ts:274-283`); whether every close path gives up its tables was not
  checked. The `party_tables` rows stay after that, pointing at the table, so a used table's row
  cannot be removed.
- **The business day** comes from the venue's `day_cutover` (`packages/db/src/schema/tenants.ts`,
  default 06:00) through `currentBusinessDay` (`packages/reporting/src/business-day.ts`).

## 3. Words used here

- **Zone**: what Square calls a section. Zones are still created on Departments (A366 §9.1). A zone
  has at most one floor plan; a counter-only zone has none.
- **Saved plan**: the zone's plan as the owner laid it out in the editor.
- **Today's plan**: what the till shows: the saved plan plus today's changes made on the till.
  Nobody sees "changes"; staff see one map.
- **Spare table**: a table of the zone that the saved plan does not place.
- **Fixed table**: a table marked "Fixed in place", such as a bar stool or a seat at a communal
  table. It never moves on today's plan.
- **Join**: one party at several tables. For movable tables a join also merges them on the map.

## 4. The saved-plan editor (dashboard)

- **Opening it:** Departments › the zone › "Edit floor plan", or "Add a floor plan" for a zone with
  no tables. It opens full screen with the zone's name, Close, Undo, Redo and Save.
- **Save** follows the forms contract: quiet and disabled until the draft changes (`draftScopeFor`,
  `saveActionState`), and leaving with unsaved changes asks first. Undo and Redo cover every change
  since the editor opened.
- **The canvas** is a grid that grows as tables are dragged further out; the owner never sets its
  size. Wherever a plan is displayed, in the editor's preview on the zone and on the till, it is
  cropped to the area its tables occupy plus a margin of two grid squares, and fitted to the space.
- **Moving:** drag a table and it snaps to the grid. The arrow keys nudge the selected table.
- **The side panel** (a bottom sheet at phone width) lists the zone's tables. Placed tables are
  greyed out; tapping an unplaced one places it at the first free spot. Unplaced tables are the
  zone's spares.
- **Add tables:** "Add [10] tables with [4] seats", with:
  - **Naming:** automatic or custom. Automatic uses a prefix that defaults to the zone's name
    ("Terrace") and numbers on from the highest number already used with that prefix ("Terrace 6…15").
    Custom shows one name field per table.
  - **Fixed in place:** a tick, for adding bar stools in bulk.
  - A name already used anywhere in the venue is refused beside its field (`table.label_taken`).
  - New tables are created unplaced, so they appear in the side panel ready to place.
- **The selected table's panel:** name, seats, shape (rectangle or round; a round table with equal
  sides is a circle), width and height in grid squares, rotation by a handle in 15° steps, Fixed in
  place, and:
  - **Joins:** the saved joins this table is part of ("with 5 · seats 6"), with Add (which tables,
    how many seats) and Remove. A saved join's tables are all in this zone.
  - **Remove from plan:** the table becomes a spare. A table a party sits at keeps its place on
    today's plan until the party leaves (owner, 2026-10-08).
  - **Delete:** section 8.
- **New table defaults:** a square of 8 × 8 grid squares, not rotated, movable.
- **Saving** writes the whole plan, its tables, their positions and its saved joins in one
  transaction. A save made from a copy older than the plan's last save is refused
  (`floor_plan.changed`) and offers to reload the newer plan; it never overwrites it silently.

## 5. The till's map

- **Zone tabs** as today, limited to the device profile's zones.
- **Each zone's map** is today's plan, cropped and fitted to the screen when it opens. Pinch to
  zoom, drag empty space to pan, double-tap (or double-click) empty space to fit again.
- **A table shows a fill colour and at most one flashing dot.** Below a drawn size that the
  implementation plan states, its name is hidden; the colour and the dot always show. Totals, counts and chips leave the
  map and move to the details sheet.
- **Until A267 decides the real states and signals**, the map uses a stand-in set: fill for free,
  occupied, bill requested, needs clearing and reserved; a flashing dot for dishes ready to serve
  and for an order past its "forgotten" time. Colours read `--wt-*` tokens.
- **The list view** stays as the other view, and lists the tables on today's plan.
- **Tapping a free table** opens the seat dialog. Its covers field is optional, and its placeholder
  is short: the table's seats for today as a guide ("4 seats"), or "Covers" when it has none. The
  seat count never refuses or warns about a larger party (section 7).
- **Tapping an occupied table** opens its order, as today.
  - **A flash notice:** if the table has something the waiter must see (in the stand-in set: dishes
    ready to serve, an order past its forgotten time, bill requested), a notice shows over the order
    for a few seconds. It blocks nothing and goes on its own or with a tap.
  - **The status pin:** a corner of the order screen shows the table's current status as a colour
    and a short word or count ("2 to serve"). Tapping it opens the details sheet.
- **Long-press without dragging** (double-click with a mouse) opens the **details sheet**: party
  name, covers, amount owed, kitchen progress, signals, reserved time, and the actions Join with…,
  Split, Rotate, Change seats for today, Back to its saved place, Take off for today and Mark
  cleared, each shown only where it applies.
- **Long-press and drag** moves or joins (section 6).

## 6. Today's plan

Anyone who may take orders may change today's plan: the device profile's `take-orders` action and
the person's ordering permission, the same checks as joining today, plus the zone check. It is all
undone at the next reset anyway.

### 6.1 Moving and joining

- **A movable table dropped on empty space** moves there for today.
- **A movable table dropped on another movable table** joins them. The dragged table snaps to touch
  the target on the side nearest the drop, taking the target's rotation, and the two draw as one
  shape labelled with both names ("4+5"). Its seats for today come from the saved join with exactly
  these tables; with none, the till asks, suggesting the tables' seats added together. Then:
  - two free tables are merged with no party, for example to set up for a booking;
  - a seated table and a free one: the party extends onto the free table;
  - two seated tables: the existing combine flow runs, where the waiter chooses one bill or keeps
    the bills separate (table-actions design).
  The merge stays after the party leaves, until it is split or reset.
- **A join involving a fixed table** moves nothing. While dragging, a copy of the table follows the
  finger; over a target, a line links the two and the target is highlighted; on release the copy
  springs back. The tables are joined as one party, drawn in one colour with a thin linking line
  and one label. Two free fixed tables become one new party seated at both, through the seat
  dialog. Fixed tables are never merged, so the link ends when the party leaves.
- **Join with…** in the details sheet does the same as dropping, chosen from a list, for keyboard
  and screen-reader users. A join across zones of different service areas is still refused
  (`service_zone.join_mismatch`).

### 6.2 The other changes

- **Split** on a free merge separates it; with a party seated it runs today's "split a table"
  action. Either way each table returns to where it stood before the join.
- **Rotate** turns the table 15° for today.
- **Change seats for today** sets the table's (or the merge's) seats for today.
- **Take off for today** hides a free table from the map and the list. Refused while a tab is open
  at it.
- **The zone menu (⋮)** holds:
  - **Add a spare table:** lists the zone's spares; picking one places it in the middle of the map,
    ready to drag. With none, it says "No spare tables — add some in the floor plan editor". Staff
    never create tables.
  - **Taken off today:** each taken-off table with Put back.
  - **Reset to saved plan:** asks first.
- **Back to its saved place** undoes every change to that one table for today.

### 6.3 Reset

- Today's plan resets automatically at the day cutover, and on Reset to saved plan.
- **Occupied tables wait.** A table with an open tab, a merge included, keeps today's position
  until its tab closes, then returns to the saved plan. A placed spare goes back to being unplaced
  the same way.
- Nothing runs at the cutover: section 9's "today" rule makes it so.
- **The owner's edits show through.** Saving the saved plan mid-service changes at once every table
  nobody has changed today.

## 7. Seats

- A table has one number, its **seats**: the most it seats properly. A saved join has its own seats
  ("4+5 seats 6"); seats are never added up automatically, because pushed-together tables lose
  places where they meet.
- **Seats are a guide, never a limit.** Bookings will plan with them (later work). The till never
  refuses or warns when more people sit down, since staff can always bring chairs.
- No minimum party size. It is added with the bookings work if needed.

## 8. Table names, history and deleting

- **While a tab is open** it points at the actual tables, by id, so joins, splits and moves work. A
  rename shows on the open tab at once.
- **When a party closes**, the names of its tables are copied onto it as text ("Terrace 4 + 5") and
  its links to the tables are released. A counter order delivered to a table releases its link when
  it is issued; its name is already frozen there (section 2). A past booking keeps its table's name
  as text.
- **Everything about the past reads the copied text**, so a later rename never changes history,
  including a future report by table, and nothing in the past needs the table's row.
- **Delete** removes the table, its saved positions, its saved joins and its rows in today's plan.
  It is refused only while an upcoming booking is assigned to the table. **Changed by the owner,
  2026-10-08** (this replaces "allowed only on a free table" and "its name can be used again at
  once"): an open party is tied to the table on today's plan, not on the saved plan, so Delete
  always takes the table off the saved plan at once; a table a party sits at stays where it stood
  on today's plan until the party leaves, and takes no new party. The table is gone for good, and
  its name free again, once no open party holds it or used it earlier in its meal and no order to
  it is unpaid or on its way. The plan, decision 5, has the detail. Because nothing in the past points at a table, Disable and Enable go away: a table
  is placed, a spare, or deleted.
- **Before building**, every reader of a closed party's tables and of `orders.delivery_table_id` is
  listed. Each one either moves to the copied text or is shown to read only open parties. If any of
  the tables involved is append-only, the work stops and asks the owner.

## 9. Storage

All new tables are venue-wide and classified `state`. They live in the core beside `dining_tables`
and `floor_zones`, not in a module: tables and zones are core, and the till's live floor reads them
on every screen. The commit adding them states this reason.

- **`dining_tables`:** `zone_id` becomes required; `capacity` becomes `seats`; a `fixed` flag is
  added; `pos_x`, `pos_y`, `shape`, `rotation` and `active` go. `status_id` and
  `needs_clearing_since` stay.
- **Floor plan:** one per zone for now, with the time of its last save, which the save check
  compares. The later department-level named plans add a column here and today's plans become their
  defaults.
- **Saved positions:** plan, table, x, y, width, height (whole grid squares), shape, rotation
  (0–345, a multiple of 15). One row per table on a plan; a spare has none.
- **Saved joins:** a join of a plan, with its seats, and its member tables.
- **Today's changes:** a table, a business day, and only what changed: position, rotation, taken
  off, placed as a spare, seats for today.
- **Today's joins:** a business day, its seats, and its member tables, each with where it stood
  before the join.
- **The "today" rule:** a row applies on its own business day, and on a later day only while its
  table has an open tab. Stale rows are ignored on read and deleted by the next write to that
  zone's today's plan.
- **The migration** drops columns from `dining_tables`, which drizzle may do by rebuilding the
  table. Before shipping, every foreign key pointing at `dining_tables` is listed and the generated
  SQL is read (CLAUDE.md's rebuild rule). Pre-live, nothing is carried forward: the seeds are
  rewritten and dev venues are reset.

## 10. Routes and permissions

- **Dashboard** (`venue.configure`, as today's table routes): read a zone's plan; save a zone's plan
  in one go; delete a table. Refusals name the field they concern.
- **Till** (a session, `take-orders`, the ordering permission, the zone check): move or rotate for
  today; join (today's join extended to merge); split; take off and put back; place a spare; seats
  for today; back to its saved place; reset a zone. A request to move a fixed table is refused.
  Each new till route gets its row in the profile-action map
  (`apps/server/src/till-api.profile-actions.test.ts`) and the zone map
  (`apps/server/src/till-api.profile-zones.test.ts`), and a refusing case.
- **The till's table-state read** returns each table's position for today, worked out from the
  saved plan and today's changes, plus merges and spares.
- **Live updates:** the floor's subscription names the new tables as its sources.

## 11. Removed

- The floor screen's Config tab, its per-zone tabs and its Disable/Enable.
- The placement routes on the dashboard and the till, and the till's `table-layout-editor` card:
  the saved plan is edited only on the dashboard.
- Drawn size worked out from seats (`sizeForCapacity`) and the fixed 3:2 canvas.

## 12. Build order

One plan, in slices that each land on their own. The branch touches migrations, permissions and
a cross-package contract, so it takes the full review path.

1. **Storage and reads:** the new tables, the `dining_tables` changes, names copied on close, Delete,
   today's position worked out on the server, seeds.
2. **The dashboard editor** (section 4).
3. **The till map** (section 5), with the flash notice and the status pin.
4. **Today's plan on the till** (section 6).
5. **Removing the old pieces** (section 11).

## 13. Testing

Each claim is checked by running something, not by reading.

- **Every new till route** is tried without `take-orders`, without the ordering permission and
  outside the profile's zones, and is refused each time.
- **The "today" rule**, on a venue whose cutover is not midnight: yesterday's change on a free table
  is ignored; on a table with an open tab it still applies; once the tab closes the table returns
  to the saved plan.
- **Joins:** seats from a saved join, and the till asking without one; free + free, seated + free,
  seated + seated; Split puts each table back; a fixed table never moves, including when a move is
  sent straight to the route; a fixed join ends when the party leaves.
- **Spares and reset:** a placed spare is unplaced again at reset; an occupied table waits for its
  tab to close.
- **Saving:** a save from an older copy is refused; a duplicate name is refused beside its field;
  automatic names number on from the highest in use.
- **Delete:** a free table goes and its name is reusable; a seated table leaves the saved plan at
  once, stays on today's plan until its party leaves, then goes and frees its name; refused with
  an upcoming booking.
- **History:** renaming a table after its party closed leaves the party's name and a reprinted
  receipt unchanged.
- **Migration:** the upgrade test, and the foreign-key list and generated SQL above.
- **Browser, in real Chromium:** editor dragging, Undo/Redo, the unsaved-changes prompt
  (`*.unsaved.test.ts`), axe checks in both themes; the map's crop and fit; long-press compared
  with drag; a fixed table springing back. Both apps are opened and looked at in light and dark at
  phone width.

## 14. Later work, not in this design

- Which states and signals exist, and their colours and dots (A267). This design builds the fill,
  the dot, the flash notice and the status pin, and uses a stand-in set until then.
- Named plans per department ("Lunch"), each with a plan per zone, chosen by service period as
  menus are.
- Bookings using seats and saved joins for availability; a minimum party size.
- Reports per zone or per table.
- Walls, counters and other scenery on the plan.
- Moving a table to another zone; delete and add it again instead.

## 15. Owner decisions, 2026-10-08

1. Zones are Square's sections; a zone has at most one floor plan.
2. One saved plan per zone, plus today's plan that resets at the cutover and on a button. Named
   plans per department come later.
3. Staff can move, rotate, join and split, take tables off, place spares and change seats for
   today. Anyone who may take orders may do it.
4. A join of movable tables merges them on the map; fixed tables join parties without moving.
   Split only undoes a merge; a communal table is laid out as one-person fixed tables.
5. Occupied tables wait at reset; each table also has Back to its saved place.
6. Seats: one number, a guide for bookings, never a limit on the till.
7. The plan is cropped to its tables and fitted to the screen; names hide when too small; colour
   and dots carry the status; details are one tap away.
8. Tapping an occupied table opens its order, with a flash notice for urgent statuses and a status
   pin for details; a long-press opens the details sheet.
9. Spare tables instead of made-up temporary ones; staff never create tables.
10. Tables are created in bulk in the editor; table names are copied as text when a party closes,
    so a rename never changes history and a free table can be deleted.
11. Storage is the saved plan plus today's changes stamped with the business day.
