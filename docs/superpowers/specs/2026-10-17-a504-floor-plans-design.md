# A504: floor plan sets, one per service period

**Revision 2, 2026-10-17: follows the owner's answers of 2026-10-17 ~10:45** (lane B's
`questions.md`, "OWNER ANSWERS 2026-10-17 ~10:45 … A504"). Publishing a layout for a later date is
dropped; a period's change of layout is offered on the till and applied only when someone presses
Update layout.

**Status: revised design for the owner's check, 2026-10-17.** Nothing here is built. Statements
about today's code were read in the code at commit `4933c60eb` and cite where; one was also run,
and says so. Statements about the new behaviour are proposals. The owner's ten answers are recorded
in section 10. The details the answers left open are the numbered defaults in "Decisions this
revision makes" below; each can be overridden by quoting its number.

Mock-ups: [docs/backlog/mockups/a504-floor-plans/](../../backlog/mockups/a504-floor-plans/). They
are static drawings in the house colours, not screenshots of running code.

## Decisions this revision makes

Each is a default the owner can override. Section numbers point to the detail.

1. **What records which layout a zone is showing.** Today's record of a zone's day,
   `floor_today_zones`, gains three facts: the set its today's plan was last made from, that
   layout's revision at the time, and the period it was made for (none on a day with no period).
   Every reset writes them: the day's first, Update layout and Reset to … plan. Nothing stores
   which layout is due (section 7.1).
2. **How a layout becomes due, and how the till finds out.** There is no timer on the server. The
   till's zones read, which it already repeats every 15 seconds on the floor screen, works out for
   each zone which layout is due now and compares it with the recorded one. A different set, or the
   same set at a newer revision, is a due layout. The read writes nothing (section 7.1).
3. **Which layout is due.** The set of the period running now; when none is running, of the next
   period later the same business day; when none is left, of the last that ran that day; on a day
   with no period, the department's default set. A period whose Floor plan field is empty uses the
   default set. "Keep open" made before a period ends moves the moment (answer 5(a)'s example)
   (section 7.1).
4. **"Keep open" after a period has ended (answer 7(a)).** Once a zone has been updated to a later
   period's layout, an earlier period that is kept open again does not make its own layout due
   again: the due period is never one that starts earlier in the day than the period the zone
   recorded (section 7.1).
5. **The banner and its words.** One line above the map or the list, under the zone tabs:
   "**{period} layout is ready.** [Update layout]" ("El plano de {period} está listo.
   [Actualizar plano]") when the due layout is for a different period from the recorded one, and
   "**A newer layout is ready.** [Update layout]" ("Hay un plano más reciente. [Actualizar plano]")
   otherwise: a changed Floor plan field, a new default set, an edit saved to the layout, or a
   deleted set. It has no close button, and it is shown only to someone who can change today's
   plan, the same rule as the zone menu (section 7.2).
6. **Update layout asks nothing.** One press applies the due layout, as the owner's example has
   it. The till sends the layout it was offered; if a newer one has become due meanwhile, the press
   is refused and the banner shows the newer one (section 7.2).
7. **What Update layout does to each table** is answer 8(a)'s rule: free tables go to their new
   places at once, free 4 and 5 become 4+5, tables taken off for today stay off, and free tables
   pushed together today come apart. A table with guests waits (section 7.3).
8. **"Needs moving".** A table that waited shows "Needs moving" once its guests have gone, instead
   of moving on the map by itself; "Mark moved" moves it. The record is the waiting row today's
   reset already keeps (`floor_reset_tables.pending`); no new column. A waiting change that does
   not move the table (only today's name or its seats) still applies by itself (section 7.4).
9. **The same for every reset.** Reset to … plan and the day's first reset use "Needs moving" too,
   in place of today's silent catch-up, so a table never jumps on the map while nobody is looking
   (section 7.4).
10. **Needs clearing comes first.** A table that needs clearing and moving shows "Needs clearing";
    once marked cleared it shows "Needs moving" (section 7.4).
11. **A table that needs moving is not seated until it is marked moved**, as a table that needs
    clearing is not; tapping it opens the Mark moved question (section 7.4).
12. **How "Needs moving" looks.** On the map, the table stays in its old place with a "Needs
    moving" status chip in the warning colour, as "Needs clearing" has (`till-floor-screen.ts:1677-1684`).
    On the list, it is the same plain card as a table needing clearing, with "Needs moving" and a
    "Mark moved" button (`till-floor-screen.ts:1956-1969`) (section 7.4).
13. **A600.** Update layout leaves a free table where it is, showing "Needs moving", when a table
    that waits stands in its new place; Mark moved refuses while another table stands in the new
    place, with the words "{other} is standing in {table}'s new place. Move {other} first." It
    reuses Reset table's check (`refusePlaceTaken`, `apps/server/src/floor-today-reset-table.ts:158-191`).
    So these paths never put a table down on another one, which is what A600 describes; its backlog
    entry is deleted when A504 lands (section 7.5).
14. **"Reset to … plan" stays in the zone menu, beside the banner's Update layout.** It resets onto
    the layout the zone recorded, as it stands now, undoing all of today's changes as "Reset to
    saved plan" does today (taken-off tables come back). It never brings a different set: while
    another layout is due, the banner stays. Its label names the recorded set ("Reset to Dinner
    plan", "Volver al plano Dinner"); while that set has been deleted the item is not offered
    (section 7.6).
15. **The day's first reset stays automatic**, as today (floor plan spec §6.3), and lands on the
    layout due at that moment (section 7.6).
16. **On a phone, List and Map go into the zone menu.** Below the till's phone width the menu's
    first entry is "List" (on the map) or "Map" (on the list), then a muted heading "Today's plan ·
    {zone}" ("Plano de hoy · {zone}"), then the three today's-plan items. The heading is new (today
    the menu has no heading; "Today's plan" is only its button's spoken name, `floor-zone-menu.ts:136`)
    and appears only on a phone. On a phone the ⋮ button shows whenever the floor shows, holding
    only List or Map for someone who cannot change today's plan (section 7.7).
17. **The Floor plan field.** The default set appears once in the dropdown, as "Standard (default)"
    in grey, and choosing it empties the field. The Periods window's Floor plan column shows when
    any department has a zone with tables; a period of a department without one shows nothing
    there (section 6).
18. **The first set.** A department starts with no sets. Its first "+ Add set" asks no "Start
    from", starts with no tables, and becomes the default. Later ones ask "Start from" and start as
    a copy (section 5).

## 1. What the owner asked for

From the backlog entry ([till.md, A504](../../backlog/till.md#a504-floor-plan-sets-one-per-service-period))
and the owner's answers:

- **Different layouts for different periods** of the day, for example lunch and dinner, with a
  decision on what happens to occupied tables when the period changes (owner, 2026-10-11).
- **Floor plans get a page of their own (owner, 2026-10-16).** What is edited is a named set of
  floor plans, one layout per zone, and a period picks the set it uses. The Departments list's
  per-zone floor plan link goes when that page lands. This supersedes the 2026-10-08 plan's "the
  dashboard has no `floor` screen and no Floor plan nav item" (`docs/superpowers/plans/2026-10-08-floor-plan.md:5951`).
- **No publication dates for layouts (owner, 2026-10-17).** The 2026-10-11 wish that "a layout can
  go live on a chosen date, as a menu can" is dropped as "probably overkill". A change that comes
  back every year is done with seasons: a "Summer lunch" period painted only in the Summer season
  picks a "Terrace summer" set.
- **A change of layout is offered, never applied by itself (owner, 2026-10-17).** The till shows a
  banner and moves tables only when someone presses Update layout.
- **On a phone, List goes into the ⋮ menu (owner, 2026-10-17).**

## 2. What exists today

- **A zone has at most one saved plan.** `floor_plans` has one row per zone, enforced by
  `floor_plans_zone_key` (`packages/db/src/schema/floor-plans.ts:78-94`, the key at line 87). The
  saved plan's tables are `floor_plan_tables`, each holding its name, seats, "fixed", and its place
  on the plan or none (a spare) in the same row (`floor-plans.ts:97-116`). A joined table is a
  saved-plan table whose parts are listed in `floor_plan_table_parts` (`floor-plans.ts:119-141`).
- **Live tables follow a saved-plan table.** Each `dining_tables` row is the table parties, orders
  and bookings point at, and names the one saved-plan table it follows (`plan_table_id`,
  `packages/db/src/schema/dining-tables.ts:26`). Table names are unique across the venue
  (`dining_tables_location_label_key`, `dining-tables.ts:29`), and the editor's save refuses a name
  used in another zone (`namesTaken`, `apps/server/src/floor-plan.ts:231`).
- **The saved plan reaches the till only at a reset**, and "saving mid-service changes nothing on
  the till" (floor plan spec §6.3, owner 2026-10-08). A reset copies the saved plan into today's
  plan (`resetZone`, `apps/server/src/floor-today-store.ts:93-104`). It happens on the first read of
  the floor in a new business day (`ensureToday`, `floor-today-store.ts:533-576`), when staff press
  "Reset to saved plan" in the zone menu (`POST /api/zones/:id/today/reset`,
  `apps/server/src/floor-today-api.ts:226`, which needs the device's `take-orders` action, line
  228), and when the dashboard saves a zone that has no today's plan yet (`floor-plan.ts:426`).
- **Occupied tables wait at a reset, then move by themselves.** A table with an open party, held
  by a module, in a merge with such a table, or in a split group with one busy is left where it is
  and its row is marked pending (`planReset`, `apps/server/src/floor-reset-plan.ts:62`, the rule at
  lines 80-87); later reads apply it once the table is free (`catchUpZone`,
  `floor-today-store.ts:219-227`). A live table whose saved-plan table is gone is removed
  (`targetsFromMaster`, `floor-reset-plan.ts:131`).
- **A reset undoes every change staff made for the day to a free table**, including "Take off for
  today": the copied row sets `takenOff: false` and clears today's name (`todayColumns`,
  `floor-today-store.ts:433-440`). The approved floor plan spec says of today's changes: "It is all
  undone at the next reset anyway" (`2026-10-08-floor-plan-design.md:178-180`).
- **Reset table refuses to put a table down on another.** It throws `table.place_taken` when a
  table stands in the place it would put a joined table back (`refusePlaceTaken`,
  `apps/server/src/floor-today-reset-table.ts:158-191`). The floor-wide reset and its catch-up have
  no such check (backlog A600,
  [till.md](../../backlog/till.md#a600-the-floor-wide-reset-and-its-catch-up-do-not-look-at-what-stands-in-a-saved-place)).
- **"Needs clearing".** A table whose party has gone is marked with a time
  (`dining_tables.needs_clearing_since`, `dining-tables.ts:24`) and reads as `needs_clearing`
  (`apps/server/src/working-order.ts:7556-7564`); seating it is refused `table.needs_clearing`
  (`working-order.ts:1408`). On the till's map it carries a "Needs clearing" status chip in the
  warning colour (`apps/till/src/screens/till-floor-screen.ts:1677-1684`), and tapping it asks
  "Table {table} needs clearing" with Cancel and Mark cleared (`#clearDialog`,
  `till-floor-screen.ts:1920-1952`). On the list it is a plain card with "Needs clearing" and a
  Mark cleared button (`#clearingCard`, `till-floor-screen.ts:1956-1969`). Spanish "Por recoger" /
  "Marcar recogida" (`apps/till/src/i18n/strings.ts:2410-2411`).
- **What the till reads, and when.** The floor's tables come from `GET /api/tables/state`, one row
  per table (`apps/till/src/api/client.ts:3452`; server `apps/server/src/till-api.ts:2593-2605`),
  which runs the floor's catch-up first. Zones come from a separate read, `GET /api/zones`
  (`client.ts:3442`; `till-api.ts:2607`), which does not; it already works out each zone's own
  closing state at the moment of the read (`readZoneClosingStates`, `till-api.ts:2621`). Two
  15-second timers re-read them, both read in the code, not run:
  - **Tables, on the map only.** While a zone's map is on screen the floor screen asks for a
    re-read every 15 seconds (`#watchFloor`, `till-floor-screen.ts:701-711`), which fetches the
    tables only (`#pollFloor` and `#refreshFloor`, `apps/till/src/till-app.ts:8497-8530`). The
    list's tables are not re-read on a timer.
  - **Zones, on the map and the list.** The menu-checking timer, started at sign-in
    (`till-app.ts:3993`), ticks every 15 seconds (`POLL_MS`, `apps/till/src/state/menu-state-poll.ts:4`,
    `43`), and each tick re-reads the zones whenever the floor shows and no order is open (`onTick`,
    `till-app.ts:2221-2230`).
- **The zone toolbar.** The zone tabs, then List (or Map) and the zone menu ⋮ at the right end of
  the same row (`till-floor-screen.ts:1772-1790`; `.actions` has `margin-inline-start: auto`,
  line 249). The ⋮ is drawn only for someone who can change today's plan, on a zone with a plan
  (`#zoneMenu`, `till-floor-screen.ts:1626-1628`; `canChangeToday` is the `take-orders`
  capability, `till-app.ts:12710`). Its items are Add a spare table, Taken off today and Reset to
  saved plan, with no heading (`apps/till/src/widgets/floor-zone-menu.ts:133-160`). The till's phone
  width is `PHONE_WIDTH`, `(max-width: 40rem)` (`apps/till/src/widgets/language-chooser-styles.ts:4`).
- **Periods.** A period belongs to one department (`menu_periods.department_id`,
  `packages/venue-service/src/schema/menus.ts:14`), and a zone belongs to one department
  (`zone_service_policies`, `packages/venue-service/src/schema/service.ts:51-79`). Which period is
  running in a department at a moment, today's "keep open" included, is answered by
  `resolveDepartmentService` (`packages/venue-service/src/menu-timetable.ts:373`; keep open is
  applied at line 414). It reads the department's day afresh on every call (`menu-timetable.ts:383`).
  Venue-service is a mandatory module (`tier: "mandatory"`, `packages/composition/src/modules.ts:135`),
  and the server already calls it directly (`VENUE_SERVICE`, imported at
  `apps/server/src/working-order.ts:170`, used at line 478).
- **Periods of one department do not overlap.** Painted ranges that overlap are refused
  (`invalid(field, "overlap")`, `packages/venue-service/src/service-day.ts:76-80`), and a "keep
  open" cuts into the next range rather than running beside it (`withExtension`,
  `service-day.ts:161-184`).
- **"Keep open" can reopen a period that has already ended.** When no period is running, the
  period it extends is the last one that ran (`keepOpenSubject`, `menu-timetable.ts:338-358`). A
  stored keep open holds the day, the period and its start and end, not when it was made
  (`period_extensions`, `packages/venue-service/src/schema/period-extensions.ts:7-16`). Run
  2026-10-17 at `4933c60eb`: `pnpm exec vitest run src/keep-open.test.ts -t "reopens the last ended
  period"` in `packages/venue-service` passed (1 passed, 53 skipped); in it, a lunch painted
  12:00–14:00 is kept open at 15:10 until 16:00, and reads back as running.
- **The Periods window (A719, landed 2026-10-17).** The Periods list is a window opened from the
  Calendar (`periods-list` inside `opening-hours-screen.ts:444`). Its top row holds the "Periods"
  heading on the left and "+ Add period" on the right (a toolbar laid out `space-between`,
  `packages/venue-service/src/dashboard/periods-list.ts:64-71`, `294-305`), whose dialog asks for
  the department. Its columns are Period, Customer menu, Staff-only menus,
  Painted in and a delete button (`periods-list.ts:250-292`). The period dialog's fields are
  Department (when adding from that button), Name, Colour, Customer menu, Staff-only menus and
  Period end offset, then Painted in, with Cancel and Delete… on the left and Save on the right
  (`period-dialog.ts:443-573`). A719 removed the old disabled Floor plan field and column. The
  period delete dialog's choice is "Replace with" / "Sustituir por", with "None" / "Ninguno"
  (`packages/venue-service/src/dashboard/strings.ts:748-749`, `1603-1604`).
- **The floor plan editor's header is Undo, Redo, Cancel, Save** (A502, owner 2026-10-11;
  design-system.md, "The floor plan editor's header is the owner's exception", line 2518).

## 3. Words used here, and the example venue

- **Set** (Spanish "conjunto"): a named group of layouts, one for each zone of one department, such
  as "Standard" or "Dinner". A period picks a set, or leaves the field empty for the default set.
- **Layout**: where each of one zone's tables stands in one set, and which are put away (spares).
  Today's "saved plan" is a layout.
- **Due layout**: the layout a zone should be showing by the rule of section 7.1. The till shows it
  only when someone presses Update layout.

Every example uses one invented venue, **Casa Marina**, and the mock-ups draw the same one:

- **Restaurant** department, periods **Lunch** 13:00–16:00 and **Dinner** 20:00–23:30. Lunch's
  Floor plan field is empty (the default set, "Standard"); Dinner's is "Dinner".
  - **Inside**: tables 1–12, plus the joined table **4+5** (8 seats, made of 4 and 5). "Standard"
    stands 1–12 apart and leaves 4+5 off: 12 on the plan. "Dinner" stands 4+5 in place of 4 and 5:
    11 on the plan. "Private party" stands 4+5, 1, 2 and 3: 4 on the plan, 6–12 spare.
  - **Terrace**: T1–T16. "Standard" puts T1–T10 out and keeps T11–T16 in the store room: 10 on the
    plan, 6 spare. "Dinner" puts T1–T8 out: 8 on the plan, 8 spare. "Private party" puts none out.
- **Bar** department, one period **All day** (Floor plan empty), one zone **Bar**, one set
  "Standard".

A table counts once: a joined table that stands counts, its tables do not; a joined table left off
while its tables stand is not a spare (section 4.2), so Standard's Inside has no spares.

## 4. What a set holds, and whose sets they are

### 4.1 Sets belong to a department (answer 1(a))

Each department has its own sets, and a set holds one layout for each of that department's zones.
A period can pick only its own department's sets. The floor plan spec's later-work list already
describes this ("Named plans per department … chosen by service period as menus are",
[2026-10-08 spec](2026-10-08-floor-plan-design.md) §14).

> Restaurant has "Standard", "Dinner" and "Private party", each with an Inside and a Terrace
> layout; Bar has its own "Standard". The Dinner period is offered Restaurant's three, never Bar's.

**The default set.** Each department with any set has exactly one default. A period whose Floor
plan field is empty uses it, and so does a zone on a day its department runs no period. The
department's first set becomes the default (decision 18). The default has no Delete…; another set
is made the default from its row menu first.

### 4.2 Tables are shared; a layout says where they stand (answer 2(a))

A zone's tables are the same tables in every set. A table's name, seats and "Moveable" belong to
the table. Each layout holds, for each table, its place, size, shape and turn, or that it is put
away. Adding, renaming or deleting a table in any set's editor does it for the zone, in every set:
a new table is a spare in the other sets.

A joined table (A503) is a table of the zone in the same way: its name, seats and the tables it is
made of are shared. Each layout either places it, and then its tables are off that layout, or
leaves it off, and then its tables can stand on their own. A joined table a layout leaves off is not
offered as a spare on the till while its tables stand on the map. So a joined table can be its
separate tables in another set: Dinner places 4+5, Standard has 4 and 5 apart.

> Inside's table 4 exists once. In "Standard" it stands alone; in "Dinner" it is part of 4+5. A
> party seated at table 4 at 15:55 is still at table 4 after Update layout, with its bills and
> kitchen tickets untouched.

Why: everything live points at a `dining_tables` row, which follows exactly one saved-plan table
(`dining-tables.ts:26`), and a live table whose saved-plan table disappears is removed at the next
reset (`targetsFromMaster`, `floor-reset-plan.ts:131`). Shared tables keep one live table per piece
of furniture through every change of layout.

## 5. The Floor plans page (answer 3(a))

Mock-up: [1-floor-plans-page.png](../../backlog/mockups/a504-floor-plans/1-floor-plans-page.png).

- **Where:** a page called **Floor plans** in the sidebar's Operations group, beside Departments
  and zones and the Calendar, at `/manage/floor-plans`. It needs `venue.configure`, as the editor
  does today (`apps/dashboard/src/dashboard-app.ts:282`); someone with only `venue.view` sees the
  list with no buttons and no row menus.
- **What it lists:** one table grouped by department, as the Periods list is. Under each
  department, a row per set: its name, "Default" beside the default set, "Used by" (a chip per
  period that picks it, the default's chips including the periods whose field is empty, or "Not
  used"), and the set's row menu. Under each set, a row per zone: the zone's name, a link that
  opens the editor on that layout, and "12 on the plan · 1 spare" (the spare part left out when
  there are none). A layout that places none of the zone's tables reads "No tables on the plan";
  a zone with no tables at all reads "No tables yet". Zone rows have no menu. A department with no
  set reads "No sets yet".
- **+ Add set** ("+ Añadir conjunto") is one button beside the page title, as "+ Add period" is
  beside its heading (`periods-list.ts:294-305`). Its dialog, titled "Add set", asks
  **Department** first, then **Name** (unique within the department), then, when the department
  already has a set, **Start from** (that department's sets, the default first); the new set
  starts as a copy of the chosen set's layouts. A department's first set asks no Start from,
  starts with no tables, and becomes the default (decision 18). Save is quiet and disabled until
  the fields are filled (design-system.md → Forms).
- **A set's row menu:** **Rename…**, **Copy…** (asks a name), **Make default** (not on the
  default), **Delete…** (not on the default).
- **Delete…** asks "Delete {set}?", says which periods use it and that the tables stay, and offers
  **Replace with**, the period delete dialog's wording, preselected to the default, which is shown
  as "Standard (default)" in grey and empties those periods' field. When a zone is showing the set
  today it adds "On the floor, {zones} keep today's layout until someone presses Update layout."
  Cancel on the left, a danger **Delete {set}** on the right.
- **The editor** keeps its contract, its header included (Undo, Redo, Cancel, Save). Its title
  gains the set's name, "Inside · Dinner", and a line under it says "Tables are shared by every set.
  Adding, renaming or deleting one here does it in every set." Its address becomes
  `/manage/floor-plans/set/{set}/zone/{zone}`, and Close returns to the Floor plans page.
- **The Departments list's per-zone Floor plan link goes** (owner, 2026-10-16;
  `packages/venue-service/src/dashboard/departments-list.ts:236-240`).

## 6. A period picks its set (answer 4(b), changed)

Mock-up: [2-period-floor-plan-field.png](../../backlog/mockups/a504-floor-plans/2-period-floor-plan-field.png).

- **The period dialog gains an optional Floor plan field**, a dropdown of the department's sets,
  after Period end offset and before Painted in. It shows only when the period's department has a
  zone with tables. Its first option is the default set, shown in grey as "Standard (default)";
  choosing it empties the field, and an empty field is shown that way, never as a dash (decision
  17). The other sets follow by name.
- **A period added before its department has any set stays empty**, and so follows the department's
  first set once it is made.
- **The Periods window gains a Floor plan column**, after Staff-only menus. It shows the set's name,
  or the default's name with "(default)" in grey when the field is empty. It shows when any
  department has a zone with tables; a period of a department without one shows nothing in it.
- **"+ Add period" stays at the top beside the "Periods" heading**, where A719 kept it
  (`periods-list.ts:294-305`).
- **A change to this field never moves the till's tables by itself.** If it makes a different
  layout due, the till shows the banner (section 7.2).

> Lunch → "Standard (default)" in grey, Dinner → Dinner, Bar's All day → "Standard (default)" in
> grey. Make "Private party" the Restaurant's default for a week and Lunch follows it without
> being opened; the list then reads "Private party (default)".

## 7. Changing layout on the till (answers 5, 6, 7 and 8, replaced by one model)

The owner's worked example, which this section turns into rules:

> At 16:00 Lunch ends. Nothing on the map moves by itself. A banner above the map: "Dinner layout
> is ready. [Update layout]". At 16:20 a waiter presses it: free tables jump to their dinner
> places, 4 and 5 become 4+5; table 9, taken off at noon, stays off. Tables 3 and 7 still have
> lunch guests and stay put. When table 3's guests pay, table 3 shows "Needs moving"; once someone
> has carried it to its dinner place they press "Mark moved", and only then does the map move it.
> At 17:00 the owner changes Dinner's set to "Private party" on the dashboard: the banner comes
> back, "A newer layout is ready. [Update layout]"; nothing changes until someone presses it. If
> nobody does, the till keeps the dinner layout until Dinner ends.

### 7.1 Which layout is due, and how it is noticed (decisions 1–4)

**The record.** `floor_today_zones` gains `set_id`, `layout_revision` and `period_id`: the layout
today's plan was last made from, its revision then, and the period it was made for. The day's
first reset, Update layout and Reset to … plan write them.

**The rule.** For a zone at a moment, the due period is the period running now in the zone's
department ("keep open" included); when none is running, the next period later the same business
day; when none is left, the last that ran that day; on a day with no period, none. The due set is
the due period's Floor plan field, or the department's default when the field is empty or there is
no due period. The due layout is that set's layout of the zone at its current revision.

**One exception, for answer 7(a):** the due period is never a period that starts earlier in the
day than the period the zone recorded. A period's start here is its painted start that day.

**Noticing.** The zones read (`GET /api/zones`) works out the due layout of each zone it returns
and compares it with the record. When they differ, the zone carries the banner's facts: whether
the due layout is for another period and that period's name, and the set and revision on offer.
The read writes nothing. The till re-reads the zones every 15 seconds on the floor screen, map and
list (section 2), so a banner appears within about 15 seconds of the moment; this was read in the
code, not measured. Working out the due layout costs one department-day reading per department on
every zones read, which the plan measures.

How the owner's earlier examples come out:

> **A normal Tuesday.** From the day's first read until 16:00, Inside and Terrace record Standard
> for Lunch. At 16:00 Lunch ends and Dinner is next, so Dinner's set is due: the banner reads
> "Dinner layout is ready." If at 15:50 a manager keeps Lunch open until 16:45, the banner comes at
> 16:45.
>
> **Two periods sharing a set.** If Dinner's field were empty too, the due layout at 16:00 would be
> the one already recorded, so no banner comes.
>
> **A repaint.** At 14:00 a manager repaints today so Lunch ends at 15:00: the banner comes at
> 15:00.
>
> **A changed field.** At 14:00 the owner changes Dinner's Floor plan to "Private party": nothing
> shows while Lunch runs; at 16:00 the banner offers the Private party layout, worded "Dinner
> layout is ready."
>
> **A deleted set.** At 17:00, with Inside showing Dinner, the owner deletes "Dinner", replacing it
> with the default: the banner reads "A newer layout is ready." and offers Standard.
>
> **Keep open after the end (answer 7(a)).** Lunch ends at 16:00; at 16:05 a waiter presses Update
> layout, and Inside records Dinner. At 16:10 a manager keeps Lunch open until 17:00. Lunch starts
> earlier in the day than Dinner, so the due period stays Dinner: no banner, and the floor stays on
> Dinner's layout; the late group sits at a free table where it stands. Had nobody pressed Update
> layout by 16:10, the banner would go away while Lunch runs again and come back at 17:00.
>
> **A day with no period.** Monday has no period, so the day's first reset records the default,
> Standard. At 11:00 the owner paints a lunch for today only, with "Private party" in its field:
> it is the next period, so the banner offers it at once, "Lunch layout is ready."
>
> **Nobody presses.** At 17:00 the owner changes Dinner's set to Private party and nobody presses
> Update layout. The till keeps the Dinner layout. After Dinner ends at 23:30 it is the last period
> that ran, so the banner stays until the next business day's first reset, which lands on the
> layout due then (decision 15).

### 7.2 The banner and Update layout (decisions 5 and 6)

Mock-ups: [3-till-update-layout.png](../../backlog/mockups/a504-floor-plans/3-till-update-layout.png)
and [4-till-update-layout-phone.png](../../backlog/mockups/a504-floor-plans/4-till-update-layout-phone.png).

- **Where:** one line under the zone tabs' row, above the map or the list, for the zone on screen.
- **Words:** "**{period} layout is ready.**" when the due layout is for another period than the
  one recorded; "**A newer layout is ready.**" otherwise. The button is **Update layout**.
- **Who sees it:** someone who can change today's plan, the rule the zone menu already uses
  (`till-floor-screen.ts:1626-1628`). Others see no banner.
- **No close button.** It stays while a different layout is due, because it is the only way to
  reach Update layout.
- **One press, no question.** The till sends the room's revision, as every today's-plan change
  does, and the set and revision it was offered. If either has moved, the server refuses as "the
  floor has changed" (`floor_today.out_of_date`), the till reads again, and the banner shows what
  is due now.

### 7.3 What Update layout does (decision 7, answer 8(a))

A reset onto the due layout with today's reset rules (`planReset`, `floor-reset-plan.ts:80-87`),
with one difference: tables taken off for today stay off. At Inside at 16:20:

| On the till when Update layout is pressed | What happens |
| --- | --- |
| A free table | Goes to its place in the new layout at once, or into store if the new layout puts it away. |
| Table 3, with lunch guests | Stays where it is; shows "Needs moving" when its party has gone. |
| Table 7, bill asked for | The same: it has a party. |
| Tables 4 and 5, free, which Dinner joins as 4+5 | Become 4+5 at once. |
| Table 4, if a party sat there | Stays alone; when the party has gone, 4 shows "Needs moving", and Mark moved forms 4+5. |
| A group staff made for guests | Stays together; when the party has gone, each table that moves shows "Needs moving". |
| Tables 11 and 12, pushed together at 15:00 with nobody seated | Come apart at once, as "Reset to saved plan" does today. |
| Tables split off a joined table, one busy | The group waits until none is busy (`splitWithBusy`), then shows "Needs moving". |
| Table 9, taken off at noon with a wobbly leg | **Stays off.** |
| A spare placed for today, free | Goes back into store, or to its place if the new layout places it. |
| A table renamed for today, free | Loses today's name, as at any reset. |
| A free table whose new place a waiting table stands in | Stays where it is and shows "Needs moving" (decision 13). |

A change a waiter sends from a map drawn before Update layout is refused as "the floor has changed"
(`floor_today.out_of_date`), because a reset moves the room's revision (floor plan spec §6, A579
part 2a); the till reads again and the waiter tries again.

### 7.4 "Needs moving" (decisions 8–12)

- **When:** a table whose change waited, once nothing holds it any more (the waiting rules of
  `planReset`, `floor-reset-plan.ts:80-87`), shows "Needs moving" instead of moving on the map. A
  waiting change that leaves the table where it is, such as only clearing today's name, applies by
  itself as today.
- **Every reset:** Update layout, Reset to … plan and the day's first reset all leave waiting
  tables this way. Today's catch-up (`catchUpZone`, `floor-today-store.ts:219-227`) keeps applying
  the changes that do not move a table, and removals of tables deleted from the plan.
- **Record:** the waiting `floor_reset_tables` row (`pending`, `floor-plans.ts:179`) that today's
  reset already writes. A pending row whose table no longer waits is a table that needs moving; no
  new column.
- **Mark moved** applies that row: the map draws the table in its new place. It needs the same
  `take-orders` action as the zone menu's changes (`floor-today-api.ts:228`) and sends the room's
  revision.
- **Order:** a table that needs clearing shows "Needs clearing" first; once marked cleared it shows
  "Needs moving".
- **Seating:** a table that needs moving is not offered for seating until it is marked moved, as a
  table that needs clearing is not (`working-order.ts:1408`). Tapping it asks "Table {table} needs
  moving" with "Mark it moved once it stands in its new place.", Cancel and Mark moved, the shape
  of the Needs clearing question (`till-floor-screen.ts:1920-1952`).
- **Map:** the table stays in its old place, in its free colour, with a "Needs moving" status chip
  in the warning colour, as the Needs clearing chip is drawn (`till-floor-screen.ts:1677-1684`).
- **List:** the plain card a table needing clearing has (`till-floor-screen.ts:1956-1969`), reading
  "Needs moving" with a "Mark moved" button. The list's tables are re-read after a staff action or
  when the till comes back to the floor, not on a timer (section 2), so on the list "Needs moving"
  can show late, as "Needs clearing" can today.

### 7.5 A600 (decision 13)

A600 says the floor-wide reset and its catch-up can put a table down where another one stands. In
this design no table moves on the map by itself any more, and both places a table is put down
check first, with Reset table's check (`refusePlaceTaken`, `floor-today-reset-table.ts:158-191`):

- **Update layout** leaves a free table where it is, showing "Needs moving", when a table that is
  waiting stands in its new place.
- **Mark moved** is refused while another table stands in the new place: "{other} is standing in
  {table}'s new place. Move {other} first." ("{other} ocupa el nuevo sitio de {table}. Mueve
  {other} primero.").

> Dinner's layout puts table 2 where table 3 stands at lunch. At 16:20 table 3 still has guests, so
> table 2 stays put and shows "Needs moving". Someone presses Mark moved on 2 too early and is told
> "3 is standing in 2's new place. Move 3 first." Table 3's guests pay; table 3 shows "Needs
> moving", is carried and marked moved; then 2 is marked moved.

A600's backlog entry is deleted when A504 lands, because these are the paths it names. A565 (a
reset does not wait for food on its way to an ordinary table) is unchanged; with Needs moving such
a table no longer jumps on the map by itself, but its change still does not wait for the food.

### 7.6 Reset to … plan and the day's first reset (decisions 14 and 15)

- **Reset to … plan** stays in the zone menu. It resets onto the recorded set's layout as it stands
  now, undoing all of today's changes as "Reset to saved plan" does today, taken-off tables
  included, and records the revision it used. So it brings an edit to that layout, and the banner
  "A newer layout is ready." goes if that edit was all that differed. It never brings another set:
  while another set is due, the banner stays. Its label names the recorded set: "Reset to Dinner
  plan" ("Volver al plano Dinner"); its question keeps today's words, "Reset {zone}?" with
  "Free tables go back now, occupied ones once free." and a danger **Reset** (`floor.reset_title`,
  `floor.reset_body`, `floor.reset_confirm`, `apps/till/src/i18n/strings.ts:868-870`). While the
  recorded set has been deleted, the item is not offered.
- **The day's first reset** stays automatic, on the first floor read of a new business day
  (`ensureToday`), and lands on the layout due at that moment. Its query starts from `floor_plans`
  today (`floor-today-store.ts:541-544`), which will hold a row per set, so the plan rebuilds it to
  start from the zones.

### 7.7 List and Map on a phone (decision 16)

Mock-up: [4-till-update-layout-phone.png](../../backlog/mockups/a504-floor-plans/4-till-update-layout-phone.png).

Below `PHONE_WIDTH` the List/Map button leaves the toolbar; the ⋮ stays alone at the right of the
tabs' row. The menu reads, top to bottom: **List** (on the map) or **Map** (on the list); the
muted heading **Today's plan · Inside**; Add a spare table; Taken off today; Reset to Dinner plan.
On a phone the ⋮ shows whenever the floor shows, and for someone who cannot change today's plan, or
on a zone with no plan, it holds only List or Map. Wider than `PHONE_WIDTH`, nothing changes:
List/Map and ⋮ sit at the right end of the tabs' row and the menu has no heading.

## 8. Words, in English and Spanish

| Where | English | Spanish |
| --- | --- | --- |
| Sidebar, page title | Floor plans | Planos de sala |
| Page button, dialog title | + Add set / Add set | + Añadir conjunto / Añadir conjunto |
| Field (second and later sets) | Start from | A partir de |
| Column, chip | Used by / Not used | Usado por / Sin usar |
| Badge, menu item | Default / Make default | Predeterminado / Hacer predeterminado |
| Empty Floor plan field, Replace with's first choice | {set} (default) | {set} (predeterminado) |
| Delete dialog choice | Replace with | Sustituir por |
| Delete dialog line | On the floor, {zones} keep today's layout until someone presses Update layout. | En sala, {zones} mantienen el plano de hoy hasta que alguien pulse Actualizar plano. |
| Cell | {n} on the plan · {m} spare | {n} en el plano · {m} de reserva |
| Cell | No tables on the plan / No tables yet / No sets yet | Ninguna mesa en el plano / Aún no hay mesas / Aún no hay conjuntos |
| Editor line | Tables are shared by every set. Adding, renaming or deleting one here does it in every set. | Las mesas son comunes a todos los conjuntos. Añadir, renombrar o eliminar una aquí lo hace en todos. |
| Period dialog field, Periods column | Floor plan | Plano de sala |
| Till banner | {period} layout is ready. / A newer layout is ready. | El plano de {period} está listo. / Hay un plano más reciente. |
| Till banner button | Update layout | Actualizar plano |
| Till table state, button | Needs moving / Mark moved | Por mover / Marcar movida |
| Till question | Table {table} needs moving / {table} needs moving | La mesa {table} está por mover / {table} está por mover |
| Till question body | Mark it moved once it stands in its new place. | Márcala como movida cuando esté en su nuevo sitio. |
| Till refusal | {other} is standing in {table}'s new place. Move {other} first. | {other} ocupa el nuevo sitio de {table}. Mueve {other} primero. |
| Till zone menu | Reset to {set} plan | Volver al plano {set} |
| Till zone menu heading, phone only | Today's plan · {zone} | Plano de hoy · {zone} |

"Por mover" and "Marcar movida" follow "Por recoger" and "Marcar recogida"
(`apps/till/src/i18n/strings.ts:2410-2411`). Today's Spanish for "Reset to saved plan" is "Volver al
plano guardado" (`strings.ts:2401`), and "Today's plan" is "Plano de hoy" (`strings.ts:2395`).

## 9. Data model sketch, migration and the A760 squash

A sketch for the plan to settle, not a final schema.

**Core (`packages/db`), all classified `state` like today's floor tables
(`packages/db/src/classification.ts:108-118`):**

- **`floor_plan_sets`** (new): `id`, `location_id`, `name`. No department column: departments live in
  the venue-service module, and a core table cannot refer to a module's table (CLAUDE.md §3, the
  module-graph rule).
- **`floor_plans`** becomes one row per zone per set: gains `set_id`; `floor_plans_zone_key` gives
  way to one layout per zone and set. `revision` and `saved_at` stay per layout, so the "out of
  date" save check (`floor_plan.out_of_date`, `floor-plan.ts:278`) works per layout, and the
  revision is what section 7.1 compares.
- **`floor_plan_tables`** becomes the zone's tables: `plan_id` is replaced by `zone_id`, keeping name,
  seats and fixed; places move to a new **`floor_plan_placements`** (`plan_id`, `plan_table_id`, x, y,
  width, height, shape, turn; no row means put away). `floor_plan_table_sizes` gains `plan_id`.
  `floor_plan_table_parts` stays per joined table, shared by every layout. Whether adding, renaming
  or deleting a shared table moves every layout's revision, so the till offers it, is for the plan;
  the proposal is yes.
- **`floor_today_zones`** gains `set_id` (set null when the set is deleted), `layout_revision` and
  `period_id` (section 7.1).
- **`floor_reset_tables`** works as today; Update layout writes it as a reset does, copying
  `taken_off` from today's row instead of clearing it, and the catch-up stops applying a pending row
  that moves its table (section 7.4).

**Venue-service (`packages/venue-service`):**

- **`department_floor_plan_sets`** (new): `set_id` (primary key, foreign key to the core table),
  `department_id`, `is_default`, exactly one default per department that has a set.
- **`menu_periods.floor_plan_set_id`** (new, optional, foreign key to `floor_plan_sets`; empty
  means the department's default).
- **A seat answer** for "which period and set are due for each zone at a moment, given the period
  each recorded", from `resolveDepartmentService`'s periods and runs, which the core floor code
  calls as it already calls `VENUE_SERVICE` (`apps/server/src/working-order.ts:170`, `478`).

**What the till reads and sends.** Each zone on `GET /api/zones` gains the recorded set's name
(for Reset's label, absent when the set is deleted) and, when a different layout is due, the
banner's facts (section 7.1). Each table on `GET /api/tables/state` can read `needs_moving`. Two new
writes, both under `take-orders` and the room's revision like the zone reset
(`floor-today-api.ts:226-228`): Update layout for a zone, and Mark moved for a table. The dashboard's
live subscriptions name the new tables as sources (`scripts/live-subscriptions.test.ts`), and the
configuration export, which lists `floor_plans` today (`packages/db/src/configuration-transfer.ts:53`),
adds them.

**Migration: yes, in core and in venue-service.** `floor_plan_tables` loses its place columns, which
drizzle does by rebuilding the table; before shipping, the foreign keys pointing at it are listed (at
least `dining_tables.plan_table_id`, `floor_reset_tables.plan_table_id`, `floor_plan_table_parts`,
`floor_plan_table_sizes`) and the generated SQL read (CLAUDE.md §3's rebuild rules, including "a
rebuild must not also add a column" on drizzle-kit 0.31). Under the pre-live rule (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production") nothing is carried
forward (answer 10(a)): seeds write a "Standard" set per department, and the dev venues and the
Santet real-data venue are reset when it lands; Santet's floor plans are rebuilt with
`local/square/reset.sh`.

**Build order (answer 10(a)).** After A719, which has landed (#1838). The A760 migration squash
([2026-10-16-a760-migration-squash.md](../plans/2026-10-16-a760-migration-squash.md)) starts only
under a full freeze; A504's build either lands before that freeze, and its migrations are folded
into the squash, or starts after the squash lands. It is never in progress across it.

## 10. The owner's answers (2026-10-17 ~10:45)

1. **(a)** Each department has its own sets (section 4.1).
2. **(a)** Tables are shared by every set; a joined table can be its separate tables in another set
   (section 4.2).
3. **(a)** The page, with "+ Add set", no Scheduled column and no zone-row menu (section 5).
4. **(b), changed:** the Floor plan field is optional, an empty field meaning the default, shown as
   "Standard (default)" in grey; the first set becomes the default; the default cannot be deleted
   until another is made default; the field shows only when the department has a zone with tables
   (section 6).
5, 6 and 8. **Replaced** by one model: a layout becomes due when a period ends or when a dashboard
   change makes a different one due; the till applies it only when someone presses Update layout;
   occupied tables show "Needs moving" when free (section 7).
7. **(a)** Reopening an ended period does not bring its layout back (section 7.1).
9. **Dropped:** no publication dates for layouts (section 1).
10. **(a)** Build after A719; before or after the A760 squash, never across it; reset the dev
    venues and Santet when it lands (section 9).

New: on a phone, List and Map go into the ⋮ menu (section 7.7).

## 11. Out of scope, and gaps for the plan

- **Zones in no department.** The Departments list has "Unassigned zones" (design-system.md, "Unassigned
  zones keep their Add to department action"). Such a zone has no department, so no sets: the plan
  decides whether it keeps a single layout of its own or has no floor plan until assigned.
- **A zone added to a department, or moved between departments,** has no layout in that
  department's existing sets. Proposed: every existing set gets a layout with all its tables put
  away; the plan confirms.
- **Deleting a department** (A435 step 6) must delete its sets and their layouts with it; the impact
  read in its delete dialog should count them
  ([reconciliation](../plans/2026-10-11-a435-6-tables-zones-departments-delete.md)).
- **A zone's own closed times and "keep open"** (`zone_days` and `zone_day_ranges`,
  `packages/venue-service/src/schema/seasons.ts`; `zone_extensions`,
  `packages/venue-service/src/schema/zone-extensions.ts`, A366). The rule here follows the
  department's period; whether a zone kept open past its department's period changes what is due is
  for the plan.
- **Joined tables that wait in parts.** Which of a waiting group's tables show "Needs moving", and
  whether one Mark moved moves the whole group, is for the plan; the proposal is that each table
  that moves shows it, and Mark moved on one applies its group's change.
- **Bookings.** A booking on a table the evening's set puts away: the editor could warn, the booking
  screen could refuse. Left for the bookings work.
- **A565** (section 7.5).
- **History of past layouts.**
- **Help mode (A582)** should explain the banner and "Needs moving".

## 12. Where this departs from earlier decisions

- **"A zone has at most one floor plan" and "One saved plan per zone"** (floor plan spec §15,
  decisions 1 and 2, owner 2026-10-08). A zone has one layout per set. Decision 2 also said "Named
  plans per department come later", which this is.
- **"Today's plan resets automatically at the day cutover, and on Reset to saved plan"** (floor plan
  spec §6.3). Update layout is a third reset, by hand. The same section's ruling, "saving
  mid-service changes nothing on the till", holds: a dashboard change is offered at once, as the
  owner decided on 2026-10-17, but changes nothing until someone presses Update layout.
- **"Occupied tables wait … until its tab closes, then returns to the saved plan"** (floor plan spec
  §6.3). A waiting table now shows "Needs moving" and moves on the map only when marked moved, at
  every reset.
- **"It is all undone at the next reset anyway"** (floor plan spec §6, of staff's changes for the
  day; `2026-10-08-floor-plan-design.md:178-180`). Update layout keeps tables taken off for today
  off. The day's first reset and "Reset to … plan" still undo everything.
- **"Like menus, a layout can go live on a chosen date"** (owner, 2026-10-11). Dropped by the owner
  on 2026-10-17.
- **The Departments list's floor plan link** (A718) and **the 2026-10-08 plan's "no Floor plan nav
  item"** go, as the owner decided on 2026-10-16.

## 13. What was verified, and what was not

- **Run:** the keep-open reopening test (section 2), at `4933c60eb`. **Read and cited:** everything
  else in section 2.
- **Not measured:** how soon a till shows the banner. "About 15 seconds" rests on reading the
  menu-checking timer's `onTick`; no till was run across a period boundary. The cost of working out
  each department's due layout on every zones read is not measured.
- **Expected, not tested:** that `planReset`'s waiting rules carry over unchanged to Update layout
  onto another set's layout; that the exception of section 7.1 is enough for answer 7(a) in every
  order of keep open and Update layout; and that Reset table's place check serves Update layout and
  Mark moved as it is.
