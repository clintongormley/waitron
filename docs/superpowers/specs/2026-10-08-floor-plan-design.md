# Floor plans: the saved plan, today's plan and the till's map

> 2026-10-16, A747: the owner replaced empty joined-seat defaults with editable totals in the till and dashboard. The [current decision](../../backlog/till.md#joined-table-seat-suggestions-owner-2026-10-16-a747) supersedes the empty-default wording below.

> 2026-10-16, A718: a zone's floor plan opens from the Departments list's Floor plan / Add floor plan link, not from the zone editor, which no longer shows a preview. This supersedes "Opening it" and "the editor's preview on the zone" below.

> **2026-10-11 supersession.** A435 step 6 adds permanent hierarchy Delete. This floor design still governs individual-table Undo, master/today release and location-wide labels. See the
> [step 6 reconciliation](../plans/2026-10-11-a435-6-tables-zones-departments-delete.md). Earlier behavior and receipts below remain historical.


**Status:** owner decisions of 2026-10-08, from one brainstorm that used Square for Restaurants'
floor plan editor as the reference. The owner approved this written spec on 2026-10-08, and changed it the same day while
reviewing the implementation plan: the master plan and today's plan are separate plans (§3, §6.3,
§8, §9, §15 items 12–14). Not built. Behaviour below is the target design, not a claim
about what runs today; section 2 is the only part that describes today's code, and it cites where.

**What this replaces.** Where this document disagrees with an earlier one, this one wins:

- [Venue operations](2026-10-03-venue-operations-design.md) (A261) §8, first bullet: the editor
  still only lays tables out and has no zone settings, but it now also creates, names and deletes
  tables, and holds their seats and saved joins.
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
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
- **Saved plan** (the master plan): the zone's plan as the owner laid it out in the editor. It is
  edited freely and nothing live reads it.
- **Today's plan**: what the till shows and everything live points at: a copy of the saved plan
  made at the last reset, as staff have changed it since. (Owner, 2026-10-08: the two are separate
  plans; this replaces "the saved plan plus today's changes".)
- **Spare table**: a table of the zone that the saved plan does not place.
- **Fixed table**: a table marked "Fixed in place", such as a bar stool or a seat at a communal
  table. It never moves on today's plan.
- **Join**: one party at several tables. For movable tables a join also merges them on the map.

## 4. The saved-plan editor (dashboard)

> 2026-10-16: A671 replaces this section's side-panel arrangement, placement click targets and
> new joined-table placement. See the current [editor contract](../../developers/design-system.md#departments-and-zones)
> and the [owner's decisions](../../backlog/till.md#a671-the-floor-plan-editors-side-panel-less-text-nothing-jumps).


> Owner override, 2026-10-11 (A502): the selected table's form is Name; Seats beside Shape; and a
> Moveable switch, which replaces Fixed in place here and in Add tables. Width, height and turn are
> set on the plan, and Remove from plan and Delete leave the panel; its joins stay until A503. See
> [design-system.md](../../developers/design-system.md).

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
    > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
    >
    > Added 2026-10-12 by A503 part 2 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table is a table on the saved plan made of two or more tables not placed on the plan (`floor_plan_table_parts`); each reset copies its parts (`floor_reset_table_parts`), and a part still joined cannot be seated, joined to a party, moved to, given a bill, merged, put on the map as a spare, named as an order's table or chosen for a department transfer (`table.in_joined_table`). It cannot yet be split.
    >
    > Added 2026-10-13 by A503 part 3: Split tables… now splits parts off a joined table for the day (§6.2).
  - **Remove from plan:** the table becomes a spare in the saved plan; today's plan changes at its
    next reset.
  - **Delete:** section 8. It is part of the draft, so Undo brings it back until Save.
- **New table defaults:** a square of 8 × 8 grid squares, not rotated, movable.
- **Saving** writes the whole plan, its tables, their positions and its saved joins in one
  transaction. A save made from a copy older than the plan's last save is refused
  (`floor_plan.out_of_date`) and offers to reload the newer plan; it never overwrites it silently.
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.

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
> Owner override, 2026-10-10 (A472): Guests has no placeholder. The floor map follows the zone's
> proportions with a height cap; Bill requested chips use the map's purple, the pin's swatch
> follows its words, and a single-table sheet says "Table 9" / "Mesa 9". The four-second notice
> stays as built. These supersede the corresponding defaults below.

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

> Added 2026-10-12 by A503 part 2 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table is a table on the saved plan made of two or more tables not placed on the plan (`floor_plan_table_parts`); each reset copies its parts (`floor_reset_table_parts`), and a part still joined cannot be seated, joined to a party, moved to, given a bill, merged, put on the map as a spare, named as an order's table or chosen for a department transfer (`table.in_joined_table`). It cannot yet be split.
>
> Added 2026-10-13 by A503 part 3: Split tables… now splits parts off a joined table for the day (§6.2).
>
> Changed 2026-10-13 by A579 part 3c ([design](2026-10-13-a579-flattened-joined-tables-design.md)): the sheet no longer offers **Split**; a table in a group offers **Split tables…** (§6.2).

## 6. Today's plan

Anyone who may take orders may change today's plan: the device profile's `take-orders` action and
the person's ordering permission, the same checks as joining today, plus the zone check. It is all
undone at the next reset anyway.

> Added 2026-10-13 by A579 part 2a ([design](2026-10-13-a579-flattened-joined-tables-design.md)):
> each room has a revision that every reset moves by one, as does each request, or catch-up
> outside a reset, that changes its plan for the day. The floor read carries it on each table,
> the table routes and the zone reset answer it as it stands after the change, and a change sent
> from an older one is refused (`floor_today.out_of_date`). Until part 2b a change that sends none
> is still applied.

> Added 2026-10-13 by A579 part 2b: the till sends the revision with every table route, the zone
> reset and a party join that makes a merge, and any of those that sends none is refused
> (`management.request_invalid`); only the zone reset may send `null`.

### 6.1 Moving and joining

- **A movable table dropped on empty space** moves there for today.
- **A movable table dropped on another movable table** joins them. The dragged table snaps to touch
  the target on the side nearest the drop (or, where a table of the target's merge already stands
  there, the next free side), taking the target's rotation, and the two draw as one
  shape labelled with both names ("4+5"). Its seats for today come from the saved join with exactly
  these tables; with none, the till asks, suggesting the tables' seats added together. Then:
  - two free tables are merged with no party, for example to set up for a booking;
  - a seated table and a free one: the party extends onto the free table;
  - two seated tables: the existing combine flow runs, where the waiter chooses one bill or keeps
    the bills separate (table-actions design).
  The merge stays after the party leaves, until it is split or reset.

- **A join involving a fixed table** moves nothing. While dragging, a copy of the table follows the
  finger; over a target, a line links the two and the target is highlighted; on release the copy
  goes at once, with no animation. The tables are joined as one party, drawn in one colour with a
  thin linking line and one label. Two free fixed tables become one new party seated at both,
  through the seat dialog. Fixed tables are never merged, so the link ends when the party leaves.
- **Join with…** in the details sheet does the same as dropping, chosen from a list, for keyboard
  and screen-reader users. A join across zones of different service areas is still refused
  (`service_zone.join_mismatch`).

> Owner override, 2026-10-10 (A429 slice 4, plan decision 7): "the saved join" here means today's
> copy of it. Each reset copies the saved plan's joins into today's plan, and a merge takes its
> seats from that copy; a join saved during the day waits for the next reset.

> Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.

> Changed 2026-10-13 by A579 part 3a ([design](2026-10-13-a579-flattened-joined-tables-design.md)): pushing a joined table into a group splits it, and the group holds that table's real tables instead.

### 6.2 The other changes

- **Split** on a free merge separates it; with a party seated it runs today's "split a table"
  action. Either way each table returns to where it stood before the join.
- **Rotate** turns the table 15° for today.
- **Change seats for today** sets the table's (or the merge's) seats for today.
- **Take off for today** hides a free table from the map and the list. Refused while a tab is open
  at it, while it needs clearing, while food is on its way to it, or while it is in a merge.
- **The zone menu (⋮)** holds:
  - **Add a spare table:** lists the zone's spares; picking one places it in the middle of the map,
    ready to drag. With none, it says "No spare tables". Staff never create tables.
  - **Taken off today:** each taken-off table with Put back.
  - **Reset to saved plan:** asks first.
- **Back to its saved place** undoes every change to that one table for today.

> Added 2026-10-13 by A503 part 3 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table
> with two or more parts still joined also offers **Split tables…**, which stands the chosen parts on
> the map as tables of their own until the reset puts the joined table back whole. Back to its saved
> place is refused (`joined_table.parts_split_off`) on a joined table while any of its parts is split
> off, and Take off for today is refused (`table.in_joined_table`) for a part still joined or a joined
> table with fewer than two parts still joined.

> Added 2026-10-13 by A503 part 4 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table
> with tables split off, and each of those split-off tables that is free, also offers **Join
> again**, when that would leave two or more of its tables joined; it puts the free split-off tables
> back into the joined table. A table split off offers neither Back to its saved place nor Take off
> for today, and the server refuses both on it (`table.split_off`). Join again ends the split for
> the tables it takes back.
>
> Superseded 2026-10-13 by A579 part 4b: Join again is gone; Reset table (below) is offered in its place.

> Added 2026-10-13 by A579 part 3b ([design](2026-10-13-a579-flattened-joined-tables-design.md)):
> Split tables… also splits tables off a group (the server does; the till offers it from part 3c).
> Each ticked table leaves the group as a table leaves a group, back where it stood before it. With
> guests seated, a ticked table they hold comes off without them, needing clearing where the venue
> uses it, and the guests keep the tables that stay (owner question 2). With nobody seated, when
> what stays is two or more tables of one joined table, side by side in its order and standing where
> it lays them out, every one of its tables split off and no food on its way to them, that joined
> table is put back over them, clearing their "needs clearing" marks, whole when all its tables stay
> (owner question 3).

> Superseded 2026-10-13 by A579 part 3c ([design](2026-10-13-a579-flattened-joined-tables-design.md)):
> the group's **Split** goes. **Split tables…** on a table of a group lists the group's tables, and each
> ticked one leaves as a table leaves a group; on a joined table with tables still joined it lists those,
> and splits them off the joined table as it does outside a group.

> Added 2026-10-13 by A579 part 4a ([design](2026-10-13-a579-flattened-joined-tables-design.md)): the
> server's **Reset table** takes back every free table split off a joined table (a "needs clearing"
> mark or a group nobody sits at does not keep one apart) and puts the joined table at its saved
> place (one saved with no place goes where Join again would put it), refused when another table stands in that place (`table.place_taken`, owner question 5) or
> when the tables it needs are in a group with guests (`joined_table.tables_in_group`). The till
> offers it from part 4b, in place of Join again.

> Changed 2026-10-13 by A579 part 4b: the till offers **Reset table** where it offered Join again, and
> also on a free table split off a joined table whose other split-off tables are in a group with guests,
> where the server refuses it (`joined_table.tables_in_group`); when those tables are all in one group,
> the till's sentence names them and the group; otherwise it shows the plain sentence, which names neither. When every table comes back it is one tap; with some apart, its window
> names them and asks the seats. It also keeps apart a free table split off whose group has guests at
> any of its tables, which part 4a took back and whose group it ended.

### 6.3 Reset

- Today's plan resets automatically at the day cutover, and on Reset to saved plan.
- **Occupied tables wait.** A table with an open tab, a merge included, keeps today's position
  until its tab closes, then returns to the saved plan. A placed spare goes back to being unplaced
  the same way.
- Nothing runs at the cutover itself: the first read or change of the floor in a new business day
  makes the copy.
- **The saved plan reaches the till only at a reset** (owner, 2026-10-08, replacing "the owner's
  edits show through": saving mid-service changes nothing on the till). A table added, moved,
  renamed or deleted in the saved plan changes on the till at the next reset — at once with Reset
  to saved plan, and for an occupied table when its tab closes after that.

> Added 2026-10-12 by A503 part 2 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table is a table on the saved plan made of two or more tables not placed on the plan (`floor_plan_table_parts`); each reset copies its parts (`floor_reset_table_parts`), and a part still joined cannot be seated, joined to a party, moved to, given a bill, merged, put on the map as a spare, named as an order's table or chosen for a department transfer (`table.in_joined_table`). It cannot yet be split.
>
> Added 2026-10-13 by A503 part 3: Split tables… now splits parts off a joined table for the day (§6.2).
>
> Added 2026-10-13 by A579 part 1 ([design](2026-10-13-a579-flattened-joined-tables-design.md)): a reset, or a later catch-up of its pending rows, that puts a split joined table back whole also clears the "needs clearing" mark of each table split off it that the reset's copy of the saved plan still makes one of its parts; a table that copy stands apart or leaves out keeps its mark (owner, "Clear the mark").

## 7. Seats

- A table has one number, its **seats**: the most it seats properly. A saved join has its own seats
  ("4+5 seats 6"); seats are never added up automatically, because pushed-together tables lose
  places where they meet.
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
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
- **Delete** removes the table from the saved plan, with its saved joins. **Changed by the owner,
  2026-10-08** (this replaces "allowed only on a free table" and "its name can be used again at
  once"): everything live points at today's plan, so Delete in the saved plan is never refused
  because of a party. The table stays on today's plan until the next reset, or, if a party sits
  there then, until the party leaves; it is gone for good once no open party holds it or used it
  earlier in its meal and no order to it is unpaid or on its way, and its name is free on today's
  plan from then. Delete is refused while an upcoming booking is assigned to the table: the
  booking is moved first (owner, 2026-10-08); bookings are otherwise later work. Because nothing in the past points at a table, Disable and Enable go away: a table
  is placed, a spare, or deleted.
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
- **Before building**, every reader of a closed party's tables and of `orders.delivery_table_id` is
  listed. Each one either moves to the copied text or is shown to read only open parties. If any of
  the tables involved is append-only, the work stops and asks the owner.

## 9. Storage

All new tables are venue-wide and classified `state`. They live in the core beside `dining_tables`
and `floor_zones`, not in a module: tables and zones are core, and the till's live floor reads them
on every screen. The commit adding them states this reason.

- **`dining_tables`** are today's plan's tables, which parties, orders and bookings already point
  at. Each names the saved-plan table it follows. `zone_id` becomes required; `capacity`, `pos_x`,
  `pos_y`, `shape`, `rotation` and `active` go. `status_id` and `needs_clearing_since` stay.
- **Floor plan:** one per zone for now, with the time of its last save, which the save check
  compares. The later department-level named plans add a column here and today's plans become their
  defaults.
- **Saved-plan tables:** plan, name, seats, fixed, and x, y, width, height (whole grid squares),
  shape, rotation (0–345, a multiple of 15); a spare has no position.
- **Saved joins:** a join of a plan, with its seats, and its member tables.
  > Owner override, 2026-10-10: each reset also copies the saved joins into today's plan
  > (`floor_reset_joins`, `floor_reset_join_tables`), and a merge's seats come from that copy (plan
  > decision 7, Tasks 4.3e and 4.3f).
  >
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.

  > Added 2026-10-12 by A503 part 2 ([design](2026-10-12-a503-joined-tables-design.md)): a joined table is a table on the saved plan made of two or more tables not placed on the plan (`floor_plan_table_parts`); each reset copies its parts (`floor_reset_table_parts`), and a part still joined cannot be seated, joined to a party, moved to, given a bill, merged, put on the map as a spare, named as an order's table or chosen for a department transfer (`table.in_joined_table`). It cannot yet be split.
  >
  > Added 2026-10-13 by A503 part 3: Split tables… now splits parts off a joined table for the day (§6.2).
- **Today's tables:** one row per live table: seats, fixed, position, size, shape, rotation, taken
  off, and which reset it last caught up with. Each zone records the business day of its today's
  plan and a count of its resets.
  > Changed 2026-10-13 by A579 part 2a: that count is now the room's revision, which every reset
  > moves by one, as does each request, or catch-up outside a reset, that changes the room (§6).
- **Today's joins:** a zone, its seats, and its member tables, each with where it stood before the
  join.
- **The reset** copies the saved plan onto every table nobody sits at, adds the tables the saved
  plan gained, and removes those it lost; a table a party sits at catches up when its tab closes.
  (Owner, 2026-10-08: this replaces "today's changes stamped with the business day" and the
  "today" rule.)
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

> Added 2026-10-13 by A503 part 3: the till's routes gain `POST /api/tables/:id/today/split-off`
> (split parts off a joined table), with the same checks.

> Changed 2026-10-13 by A579 part 3b: split-off also splits tables off a group (§6.2).

> Changed 2026-10-13 by A579 part 3c: `POST /api/tables/:id/today/split` (the group's Split) is
> removed; split-off does its work.

> Added 2026-10-13 by A503 part 4: and `POST /api/tables/:id/today/join-again` (join a split joined
> table's free tables again), with the same checks.

> Added 2026-10-13 by A579 part 4a: and `POST /api/tables/:id/today/reset` (Reset table), with the
> same checks; Join again's route stays until part 4b.

> Changed 2026-10-13 by A579 part 4b: `POST /api/tables/:id/today/join-again` is removed; Reset table
> does its work.

> Added 2026-10-13 by A579 part 2a: the table routes and the zone reset answer
> `200 { zoneId, revision }` instead of 204, and the party join, move and split-table answers gain
> `zoneRevisions` when they changed a room.

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
- **The reset**, on a venue whose cutover is not midnight: the first read of a new business day
  copies the saved plan onto every free table; a table with an open tab keeps today's place; once
  the tab closes it catches up with the saved plan. Saving the saved plan changes nothing on the
  till until a reset.
- **Joins:** seats from a saved join, and the till asking without one; free + free, seated + free,
  seated + seated; Split puts each table back; a fixed table never moves, including when a move is
  sent straight to the route; a fixed join ends when the party leaves.
  > Changed 2026-10-13 by A579 part 3c: the group's Split is gone; Split tables… on a group puts each ticked table back.
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
- **Spares and reset:** a placed spare is unplaced again at reset; an occupied table waits for its
  tab to close.
- **Saving:** a save from an older copy is refused; a duplicate name is refused beside its field;
  automatic names number on from the highest in use.
- **Delete:** the table leaves the saved plan at once and today's plan at the next reset, or when
  its party leaves after that; its name is then free; refused with an upcoming booking.
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
  > Superseded 2026-10-12 by A503 part 1 ([design](2026-10-12-a503-joined-tables-design.md)): saved joins, the editor's Joins section and the till's copy of them are gone; a service merge's seats come only from the till, whose seats prompt opens empty.
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
11. Storage is the saved plan plus today's changes stamped with the business day. (Replaced by 12.)
12. Added while reviewing the plan: the saved plan and today's plan are separate plans. The saved
    plan is edited freely; it is copied into today's plan at the reset; everything live points at
    today's plan only.
13. Added while reviewing the plan: deleting a table in the saved plan is never refused because of
    a party; it leaves today's plan at the next reset, or when its party leaves after that.
14. Added while reviewing the plan: an upcoming booking must be moved before its table can be
    deleted; bookings are otherwise left for later.
