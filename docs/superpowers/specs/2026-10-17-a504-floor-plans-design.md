# A504: floor plan sets, one per service period, and layouts published for a later date

**Status: draft for owner approval, 2026-10-17.** Written by lane B while the owner is away. Nothing
here is built. Every statement about today's code was read, not run, and cites where it was read;
every statement about the new behaviour is a proposal. The owner answers the open decisions in one
question (sub-decisions 1–8, section 11); each section below gives the recommended default first,
then the alternatives, each with a worked example.

Mock-ups: [docs/backlog/mockups/a504-floor-plans/](../../backlog/mockups/a504-floor-plans/). They
are static drawings in the house colours, not screenshots of running code.

## 1. What the owner asked for

From the backlog entry ([till.md, A504](../../backlog/till.md#a504-floor-plans-published-for-a-future-date-and-one-per-service-period)):

- **A layout can go live on a chosen date**, as a menu can (owner, 2026-10-11).
- **Different layouts for different periods of the day**, for example lunch and dinner, with a
  decision on what happens to occupied tables when the period changes (owner, 2026-10-11).
- **Floor plans get a page of their own (owner, 2026-10-16).** What is edited is a named set of
  floor plans, one layout per zone, and a period picks the set it uses. The Departments list's
  per-zone floor plan link goes when that page lands.

## 2. What exists today

- **A zone has at most one saved plan.** `floor_plans` has one row per zone, enforced by
  `floor_plans_zone_key` (`packages/db/src/schema/floor-plans.ts:78-94`). The saved plan's tables
  are `floor_plan_tables`, each holding its name, seats, "fixed", and its place on the plan or none
  (a spare) in the same row (`floor-plans.ts:97-116`). A joined table is a saved-plan table whose
  parts are listed in `floor_plan_table_parts` (`floor-plans.ts:119-141`).
- **Live tables follow a saved-plan table.** Each `dining_tables` row is the table parties, orders
  and bookings point at, and names the one saved-plan table it follows (`plan_table_id`,
  `packages/db/src/schema/dining-tables.ts:26`). Table names are unique across the venue
  (`dining_tables_location_label_key`, `dining-tables.ts:29`), and the editor's save refuses a name
  used in another zone (`namesTaken`, `apps/server/src/floor-plan.ts:231-243`).
- **The saved plan reaches the till only at a reset** (floor plan spec §6.3, owner 2026-10-08). A
  reset copies the saved plan into today's plan (`resetZone`, `apps/server/src/floor-today-store.ts:93-104`).
  It happens on the first read of the floor in a new business day (`ensureToday`,
  `floor-today-store.ts:533-580`), when staff press "Reset to saved plan" in the zone menu
  (`POST /api/zones/:id/today/reset`, `apps/server/src/floor-today-api.ts:226`), and on a zone's
  very first save (`floor-plan.ts:422-426`).
- **Occupied tables wait at a reset.** A table with an open party, held by a module, in a merge with
  such a table, or in a split group with one busy is left where it is and marked pending
  (`planReset`, `apps/server/src/floor-reset-plan.ts:80-87`); each later read catches it up once it
  is free (`catchUpZone`, `floor-today-store.ts:219-228`). A live table whose saved-plan table is
  gone is removed (`targetsFromMaster`, `floor-reset-plan.ts:131-183`).
- **A reset undoes every change staff made for the day to a free table**, including "Take off for
  today": the copied row sets `takenOff: false` and clears today's name (`todayColumns`,
  `floor-today-store.ts:430-439`).
- **What the till reads.** The till has no push subscription for the floor. Its floor read is
  `GET /api/tables/state` (`apps/server/src/till-api.ts:2675-2685`), which runs `ensureToday`
  first, so any read can be the one that resets a zone. The floor screen re-reads every 15 seconds
  while a zone's map is on screen (`#watchFloor`, `apps/till/src/screens/till-floor-screen.ts:691-701`),
  and after each staff action. The list view is not re-read on a timer (backlog, till.md "Refresh
  the floor without a staff action in a zone's list view").
- **Periods.** A period belongs to one department (`menu_periods.department_id`,
  `packages/venue-service/src/schema/menus.ts:10-36`), and a zone belongs to one department
  (`zone_service_policies`, `packages/venue-service/src/schema/service.ts:51-79`). Which period is
  running in a department at a given moment, today's "keep open" extension included, is answered by
  `resolveDepartmentService` (`packages/venue-service/src/menu-timetable.ts:373-468`; the extension
  is applied at lines 413-414). Venue-service is a mandatory module (`tier: "mandatory"`,
  `packages/composition/src/modules.ts:135`), and the server already calls it directly
  (`VENUE_SERVICE`, `apps/server/src/working-order.ts:168`).
- **The Periods page and period dialog keep a place for this.** The list has a Floor plan column
  showing a muted dash (`packages/venue-service/src/dashboard/periods-screen.ts:304-308`); the
  dialog has a disabled Floor plan field reading "Not available yet"
  (`period-dialog.ts:591-600`; strings `period.floor_plan`, `period.floor_plan_later`,
  `packages/venue-service/src/dashboard/strings.ts:716-717`, Spanish "Plano de sala").
- **The menus' "publish later".** A menu's edition queued for later is a fixed copy of the menu
  with the instant it goes live (`menu_scheduled_publications`,
  `packages/catalogue/src/schema/publication.ts:100-136`): states queued, activated and cancelled;
  two queued editions of one menu cannot share an instant. On a menu's Preview tab, "Publish later"
  opens a small form with a **Date** and a **Time** on the venue's clock; the queued editions are
  listed under "Scheduled versions" with a "Goes live" column, and each row's menu has "Change
  time" and "Cancel this version", the cancel asking first with "Keep it" as the way out
  (`apps/dashboard/src/i18n/strings.ts:2799-2852`; design-system.md, the paragraph beginning "A
  menu's queued versions sit above Unpublished changes").

## 3. Words used here

- **Set** (Spanish "conjunto"): a named group of layouts, one for each zone of one department,
  such as "Standard" or "Dinner". A period picks a set.
- **Layout**: where each of one zone's tables stands in one set, and which are left off (spares).
  Today's "saved plan" is a layout.
- **The set in use**: the set a zone's today's plan was last copied from.
- **Switch**: replacing a zone's today's plan with another set's layout during the business day.
  It is a reset, with the rules in section 7.

The worked examples use one invented venue, **Casa Marina**: department **Restaurant** with zones
**Inside** (tables 1–12) and **Terrace** (T1–T16), periods **Lunch** 13:00–16:00 and **Dinner**
20:00–23:30; and department **Bar** with zone **Bar** and one period, **All day**.

## 4. What a set holds, and whose sets they are

### 4.1 Sets belong to a department (sub-decision 1)

**Default: each department has its own sets**, and a set holds one layout for each of that
department's zones. A period can pick only its own department's sets. This is what the floor plan
spec's later-work list already describes ("Named plans per department … chosen by service period as
menus are", [2026-10-08 spec](2026-10-08-floor-plan-design.md) §14), so it needs no new owner ruling.

> Casa Marina: Restaurant has "Standard" and "Dinner", each with an Inside and a Terrace layout;
> Bar has only "Standard", with its Bar layout. Dinner's dialog offers Standard and Dinner, never
> the Bar's set.

**Alternative: sets are venue-wide**, each holding a layout for every zone in the venue.

> Casa Marina: one "Dinner" set holds Inside, Terrace and Bar layouts. Restaurant's Dinner period
> uses its Inside and Terrace layouts; the Bar layout inside it is used only if a Bar period also
> picks Dinner. Editing Dinner's Bar layout changes nothing on a normal night, which is easy to
> mistake.

**The default set.** Each department has one set marked default. It is used by a new period until
someone picks another, and by a zone on a day when its department runs no period at all. The first
set is called "Standard" and is the default. The default cannot be deleted; another set can be made
the default from its row menu.

### 4.2 Tables are shared; a layout says where they stand (sub-decision 2)

**Default: a zone's tables are the same tables in every set.** A table's name, seats and
"Moveable" belong to the table. Each set's layout holds, for each table, its place, size, shape
and turn, or that it is off the plan (a spare). Adding, renaming or deleting a table in any set's
editor does it for the zone, in every set: a new table appears as a spare in the other sets.

A joined table (a table made of other tables, A503) is a table of the zone in the same way: its
name, seats and the tables it is made of are shared. Each layout either places it, and then its
tables are off that layout, or leaves it off, and then its tables can stand on their own. A joined
table a layout leaves off is not offered as a spare on the till while its tables stand on the map.

> Casa Marina's Terrace: tables T1–T16 exist once. In "Standard", T1–T10 stand in rows and T11–T16
> are spares stacked in the store room. In "Dinner", T4 and T5 stand as the joined table "Long
> table" (8 seats) and T9–T16 are spares. A party seated at T4 at 15:55 is at the same table T4
> after the 16:00 switch, so its order, bills and kitchen tickets are untouched.

Why: everything live points at a `dining_tables` row, and a live table today follows exactly one
saved-plan table (`dining-tables.ts:26`); a live table whose saved-plan table disappears is removed
at the next reset (`floor-reset-plan.ts:131-183`). Shared tables keep one live table per piece of
furniture through every switch, so a switch never deletes and recreates a table.

**Alternative: each set has its own tables, and tables with the same name in two sets are treated
as the same table at a switch.**

> Dinner's editor creates its own "T4". At 16:00 the switch finds lunch's T4 and dinner's T4 share
> a name and keeps the live table. If someone renames dinner's copy "T4 window", the link is lost:
> at the switch lunch's T4 is removed once free and a new "T4 window" is created, and the venue-wide
> unique name rule (`dining-tables.ts:29`) means the two sets can never use the same name for two
> different tables. Seats can differ per set, which is the one thing this buys.

## 5. The Floor plans page (sub-decision 3)

Mock-up: [1-floor-plans-page.png](../../backlog/mockups/a504-floor-plans/1-floor-plans-page.png).

**Default.**

- **Where:** a page called **Floor plans** (Spanish "Planos de sala") in the sidebar's Operations
  group, beside Departments and zones and the Calendar, at `/manage/floor-plans`. It needs
  `venue.configure`, as the editor does today (`apps/dashboard/src/dashboard-app.ts:282`); someone
  with only `venue.view` sees the list with no buttons and no row menus.
- **What it lists:** one table grouped by department, as the Periods list is. Under each
  department, a row per set: its name, "Default" beside the default set's name, "Used by" (a chip
  per period that picks it, or "Not used"), and the row menu. Under each set, a row per zone: the
  zone's name, "12 on the plan · 4 spare", a "Scheduled" cell naming any layout waiting for a later
  date ("From 1 Jun 2027"), and an **Edit** link that opens the editor on that set's layout of that
  zone. A layout that places none of the zone's tables reads "No tables on the plan"; a zone
  with no tables at all reads "No tables yet" and its link says **Add tables**.
- **+ New set** (one per department heading, as "+ Add period" is) opens a small dialog: **Name**
  (required, unique within the department) and **Start from** (the department's sets, the default
  first). The new set starts as a copy of the chosen set's layouts. Save is quiet and disabled until
  the name is typed (design-system.md → Forms).
- **Row menu of a set:** **Rename…**, **Copy…** (asks a name, then copies every layout but not the
  scheduled ones), **Make default** (not on the default), and **Delete…** (not on the default).
- **Delete…** asks "Delete {set}?" and names the periods that use it, with **Use instead**
  preselected to the default set: Cancel on the left and a danger **Delete {set}** button on the
  right, as the period delete dialog has. A set in use right now can be deleted: its zones
  switch to the replacement at the next read of the floor, as in section 7.
- **The editor** keeps its contract (design-system.md → Departments and zones); its title gains the
  set's name, "Terrace · Dinner", and its address becomes `/manage/floor-plans/set/{set}/zone/{zone}`.
  Close goes back to the Floor plans page. A sentence under the title says the tables are shared:
  "Tables are shared by every set. Adding, renaming or deleting one here does it in every set."
- **The Departments list's per-zone Floor plan link goes** (owner, 2026-10-16;
  `packages/venue-service/src/dashboard/departments-list.ts:239`). Its zone row gains nothing in
  its place; the Floor plans page is found from the sidebar and from page search.

**Alternative A: sets are chosen inside the editor.** No new page; the editor gains a set picker
beside the zone's name, with New set, Rename and Delete in a menu there.

> The owner opens Departments › Terrace › Floor plan and switches the picker from Standard to
> Dinner. Seeing which sets exist, and which periods use each, means opening each zone in turn.

**Alternative B: one row per set, zones as buttons inside the row** (no zone rows). Shorter, but the
"Scheduled" information has no row of its own and must be squeezed into the set's row.

## 6. A period picks its set (sub-decision 4)

Mock-up: [2-period-floor-plan-field.png](../../backlog/mockups/a504-floor-plans/2-period-floor-plan-field.png).

**Default.**

- **The period dialog's Floor plan field becomes a required dropdown** of the department's sets,
  the default set marked "(default)". A new period starts on the default set. When the dialog is
  opened from a painter's "+ New period" (`fromPainter`, `period-dialog.ts:149`), the field is shown
  too, starting on the default, so a period never exists without a set.
- **The Periods list's Floor plan column shows the set's name** in place of the dash.
- **A719 is respected.** A719 (lane A, owner 2026-10-15) removes this column and field "until A504"
  and turns the Periods page into a window opened from the Calendar
  ([service-periods.md, A719](../../backlog/service-periods.md#a719-periods-become-a-window-opened-from-the-calendar),
  point 4). A504 adds them back to whichever form exists when it is built: the window's list and
  the dialog with Delete… in its bottom row. If A719 has not landed when A504's build starts, the
  plan says which goes first; the default is A719 first, because both change
  `periods-screen.ts` and `period-dialog.ts`.

> Casa Marina: Lunch → "Standard", Dinner → "Dinner", Bar's All day → "Standard" (Bar's own).

**Alternative: the field may be left empty, meaning "the default set".** The list then shows "—"
for most periods, and changing which set is the default changes every period left empty at once.

> The owner makes "Summer" the Restaurant's default in June; Lunch, left empty, follows it without
> being opened; Dinner, set to "Dinner", does not. Handy, but a reader of the list cannot tell
> which set Lunch uses without knowing the default.

**For a change that comes back every year, seasons already do the job.** A period is painted into
seasons (A506). "Summer lunch", painted only in the Summer season and picking "Terrace summer",
uses that set every summer with no dates to schedule. Dated layouts (section 8) are for one-off
changes.

## 7. When a zone switches, and what the till shows (sub-decisions 5 and 6)

### 7.1 Which set a zone uses at a given moment (sub-decision 5)

**Default: the set of the period running now; when none is running, the set of the next period
starting later the same business day; when none is left, the set of the last period that ran that
day; on a day with no period at all, the department's default set.** "Running" is
`resolveDepartmentService`'s answer, so a period kept open today ("keep open", A366) delays the
switch until it ends (`menu-timetable.ts:413-414`). A period's end offset, which only moves when
orders stop, plays no part.

> Casa Marina, Restaurant, a normal Tuesday: from the day's start until 16:00 the zones use
> Standard (Lunch running, or Lunch next). At 16:00 Lunch ends and nothing runs until 20:00, so the
> zones take Dinner's set at 16:00, giving staff four hours to set the room up for dinner. If a
> manager keeps Lunch open until 16:45, the switch happens at 16:45.

**Alternative A: switch only when the next period starts.** The gap keeps the previous period's set.

> The switch happens at 20:00, when the dinner guests are already arriving; staff set up the room
> in the afternoon without the map showing them where the tables go.

**Alternative B: never automatically; the till offers the switch.** At the end of a period the
zone menu (⋮) offers "Switch to Dinner's plan", and the next business day starts on the first
period's set.

> Nobody presses it on a busy evening, and the map shows lunch's layout all night.

### 7.2 What a switch does (sub-decision 6)

**Default: a switch is the reset the till already performs, onto the new set's layout, with one
difference: tables taken off for today stay off.**

How it happens: there is still no timer on the server. Every floor read already runs `ensureToday`
(`till-api.ts:2675-2685`); it gains one more test per zone: "is the set in use the set this moment
calls for?". When not, it resets the zone onto the new set's layout. The floor screen re-reads
every 15 seconds while a map is showing (`till-floor-screen.ts:691-701`), so a till looking at the
map shows the new layout within about 15 seconds of the boundary; a till on another screen shows it
when it next reads the floor.

What each kind of table does, using today's reset rules (`floor-reset-plan.ts:80-87`):

| On the till at the switch | What happens |
| --- | --- |
| A free table | Goes to its place in the new layout at once, or off the map if the new layout leaves it off. |
| A table with guests | Stays where it is, as it is, until its party leaves; then it moves. |
| A joined table with guests ("Long table") | Stays whole until its party leaves; then the new layout applies: if the new layout leaves it off, its tables stand on their own. |
| A free joined table the new layout leaves off | Comes apart at once; its tables go to their own places. |
| A group staff joined for guests (two tables pushed together) | Stays together until the party leaves; then each table goes to its new place. |
| A group staff joined with nobody seated, for example ready for a booking | Undone at once, as "Reset to saved plan" does today. |
| Tables split off a joined table, one of them busy | The whole group waits until none is busy (`splitWithBusy`). |
| A table taken off for today (a broken leg) | **Stays off** (new). A reset today puts it back (`floor-today-store.ts:430-439`). |
| A spare placed for today, free | Goes back to the store room, or to its place if the new layout places it. |
| A table renamed for today, free | Loses today's name, as at any reset. |

A change a waiter sends from a map drawn before the switch is refused as "the floor has changed"
(`floor_today.out_of_date`), because a reset moves the room's revision (floor plan spec §6, A579
part 2a); the till re-reads and the waiter tries again. No new refusal is needed.

> Casa Marina, 16:00. Inside: tables 3 and 7 still have lunch guests; table 9 was taken off at
> noon with a wobbly leg; staff pushed 11+12 together at 15:00 for nobody in particular. At 16:00
> the dinner layout applies to every free table; 3 and 7 stay put until their guests pay, then
> move; 9 stays off; 11 and 12 come apart and go to their dinner places.

Known gap this makes more frequent: a table waiting for its guests can stand where the new layout
puts another table, and a reset does not look at what stands in a place (A600,
[till.md](../../backlog/till.md#a600-the-floor-wide-reset-and-its-catch-up-do-not-look-at-what-stands-in-a-saved-place)).
Today that happens at most once a day, at the cutover or on the button; with switches it can happen
at every period change. The default here does not fix A600; the plan should decide whether A600 is
fixed first. Likewise A565 (a reset does not wait for food on its way to an ordinary table).

**Alternative A: a switch is exactly today's reset; taken-off tables come back.** Simpler, and the
same as "Reset to saved plan". Table 9 above reappears at 16:00 and someone has to take it off
again.

**Alternative B: a switch moves only tables that are free and unchanged today**; anything staff
changed today keeps the change until the next day. Staff set-ups survive, but the dinner layout is
only partly applied, and a group of free tables pushed together at lunch stays pushed together all
evening.

### 7.3 What the till shows (also sub-decision 6)

Mock-ups: [3-till-switch-notice.png](../../backlog/mockups/a504-floor-plans/3-till-switch-notice.png)
(desktop) and [4-till-switch-notice-phone.png](../../backlog/mockups/a504-floor-plans/4-till-switch-notice-phone.png)
(390 px).

**Default: a one-line notice under the zone tabs**, on the map and on the list, for the zone that
switched: "Dinner plan since 16:00. 2 tables move when their guests leave." The count falls as
tables catch up; when it reaches none the sentence ends at "since 16:00". It has a close button and
does not come back for that switch once closed on that till. It blocks nothing. The zone menu's
"Reset to saved plan" becomes "Reset to Dinner plan" (`floor.reset_plan`,
`apps/till/src/i18n/strings.ts:855`), and its confirmation keeps today's words, "Free tables go back
now, occupied ones once free."

**Alternative A: also draw where each waiting table will go**, as a dashed outline with its name, so
staff can set up around it. Clearer, but outlines can sit on top of other tables (the A600 gap
above) and they add drawing work to the map.

**Alternative B: no notice.** The map simply changes; staff learn the rhythm.

## 8. Publishing a layout for a later date (sub-decision 7)

Mock-up: [5-publish-later.png](../../backlog/mockups/a504-floor-plans/5-publish-later.png).

**Default: a set's layout of one zone can be saved to go live from a chosen business day, reusing
the menus' "Publish later" words, with a date and no time.**

- **In the editor**, beside Save, a **Publish later** button opens a compact form, as the menus'
  does: heading "Schedule Terrace · Dinner", intro "The layout as drawn goes live at the start of
  the business day you choose, on the venue's clock (Europe/Madrid).", one required **Date** field
  ("Choose a date."), Close on the left and **Schedule** on the right. The layout in use is not
  changed. The header order becomes Undo, Redo, Cancel, Publish later, Save.
- **"Goes live" means the start of that business day**: the first floor read on or after the day's
  start (the day cutover) puts the scheduled layout in place of the set's layout and resets the
  zone if that set is in use, exactly as a new day's reset does today. Usually the venue is closed
  then, so a dated layout rarely lands mid-service; if the venue trades across its cutover, the
  section 7 rules apply.
- **On the Floor plans page**, the zone's row shows "From 1 Jun 2027", and opens a small list
  headed "Scheduled layouts" with the menus' columns, "Goes live" and the row menu: **Open**,
  **Change date** and **Cancel this layout**, the cancel asking "Cancel the layout scheduled for 1
  Jun 2027?" with **Keep it** and **Cancel this layout**.
- **A scheduled layout can be opened and edited**; its Save keeps its date. (Menus differ: a queued
  menu edition is fixed, and is changed only by cancelling it and scheduling again.)
- **Several dates may wait for one zone of one set**, at most one per date; each goes live in turn.
  A second layout for a date already taken is refused under the Date field: "A layout for Terrace
  · Standard is already scheduled for 1 Jun 2027. Change its date or cancel it, then try again."
  As in the menus' form, the dismiss button reads "Close", because that sentence tells the manager
  to cancel something.
- **Tables are shared (section 4.2)**, so a table added while editing a scheduled layout is created
  in the zone when that Save is pressed, and is a spare in every other layout until then; a table
  deleted there is deleted everywhere, with today's Delete rules.
- **Once live, the old layout is not kept.** There is no history of past layouts.

> Casa Marina, 20 April: the owner opens Terrace · Standard, drags T11–T16 out of the store room
> into two new rows, and presses Publish later, 1 June 2027. Nothing changes on the till. The
> Floor plans page shows "From 1 Jun 2027" on Terrace · Standard. On 1 June the first read of the
> floor puts the summer rows on the till's Terrace map.

**Alternative A: a date and a time, as menus have.** The form gains Time, with the menus' rules for
a time the clock skips or repeats. A layout timed for 21:00 lands mid-service under the section 7
rules.

**Alternative B: date the period's choice, not the layout.** The period dialog gains "From [date]
use [set]". Layouts are never scheduled; to change Terrace from 1 June the owner makes a "Summer"
set and dates Lunch's switch to it.

> The owner copies Standard to "Summer", moves T11–T16 out in Summer's Terrace layout, then opens
> Lunch and Dinner in turn and sets "From 1 Jun 2027 use Summer" on each. Two periods to remember
> instead of one layout, but the old set stays for September.

**Alternative C: scheduled layouts are fixed, as menu editions are.** To change one, cancel it and
schedule a new copy.

## 9. Data model sketch, migration and the A760 squash

A sketch for the plan to settle, not a final schema.

**Core (`packages/db`), all classified `state` like today's floor tables
(`packages/db/src/classification.ts:105-112`):**

- **`floor_plan_sets`** (new): `id`, `location_id`, `name`. No department column: departments live
  in the venue-service module, and a core table cannot refer to a module's table (CLAUDE.md §3, the
  module-graph rule).
- **`floor_plans`** becomes one row per zone per set per date: gains `set_id` (foreign key to
  `floor_plan_sets`) and `starts_on` (a business date; null for the layout in use). The single-zone
  key `floor_plans_zone_key` is replaced by one layout in use per zone and set, and one per zone,
  set and date. `revision` and `saved_at` stay per layout, so the "out of date" save check
  (`floor_plan.out_of_date`, `floor-plan.ts:276-279`) works per layout.
- **`floor_plan_tables`** becomes the zone's tables: `plan_id` is replaced by `zone_id`, keeping
  name, seats and fixed; its place moves to a new **`floor_plan_placements`** (`plan_id`,
  `plan_table_id`, x, y, width, height, shape, turn; no row means a spare in that layout).
  `floor_plan_table_sizes` (the size kept while off the plan) gains `plan_id`.
  `floor_plan_table_parts` stays per joined table, shared by every layout.
- **`floor_today_zones`** gains `set_id`: the set in use, which `ensureToday` compares with the set
  the moment calls for.
- **`floor_reset_tables`** keeps working as today; a switch writes it as a reset does. To keep a
  taken-off table off (section 7.2), a switch copies `taken_off` from today's row instead of
  clearing it.

**Venue-service (`packages/venue-service`):**

- **`department_floor_plan_sets`** (new): `set_id` (primary key, foreign key to the core table),
  `department_id`, `is_default`, with at most one default per department.
- **`menu_periods.floor_plan_set_id`** (new, required, foreign key to `floor_plan_sets`).
- **A seat answer** for "which set does this zone use now", computed from
  `resolveDepartmentService`'s periods and runs, which the core floor code calls as it already calls
  `VENUE_SERVICE` (`apps/server/src/working-order.ts:168`).

**What the till reads.** `GET /api/tables/state` stays the till's floor read, polled as today. Each
zone in the answer gains the set in use, the time it was switched in, and how many tables wait to
move, which is all the notice in section 7.3 needs. The dashboard's live subscriptions name the new
tables as their sources (`scripts/live-subscriptions.test.ts`), and the configuration export, which
lists `floor_plans` today (`packages/db/src/configuration-transfer.ts:53`), adds the new tables.

**Migration: yes, two sets of migrations, core and venue-service.** `floor_plan_tables` loses its
place columns, which drizzle does by rebuilding the table; before shipping, the foreign keys
pointing at it are listed (at least `dining_tables.plan_table_id`, `floor_reset_tables.plan_table_id`,
`floor_plan_table_parts` and `floor_plan_table_sizes`) and the generated SQL read (CLAUDE.md §3,
the rebuild rules, including "a rebuild must not also add a column" with drizzle-kit 0.31). Under
the pre-live rule (CLAUDE.md §3, "No backwards-compatibility or data-migration code until Waitron is
in production") nothing is carried forward: seeds write a "Standard" set per department, and the dev
venues are reset. **Cost to the owner:** the Santet real-data venue loses its floor plans at that
reset and is rebuilt with `local/square/reset.sh`.

**A760, the migration squash.** The squash plan
([2026-10-16-a760-migration-squash.md](../plans/2026-10-16-a760-migration-squash.md)) starts only
after migration branches finish or are withdrawn, under a full freeze. A504's build therefore either
lands before the freeze, and its migrations are folded into the squashed sets, or starts after the
squash lands, and adds ordinary migrations on top. It must not be in progress when the freeze
begins. This design adds no migration.

## 10. Out of scope, and follow-ups

- **Bookings.** A booking assigned to a table the evening's set leaves off the plan: the editor
  could warn, and the booking screen could refuse. Left for the bookings work.
- **A600 and A565** (section 7.2): decide in the plan whether either is fixed first.
- **A zone moved to another department** keeps its layouts in the old department's sets; what it
  should do is for the plan to settle.
- **History of past layouts**, and seeing which layout was in use on a past date.
- **Seats per layout** (only under section 4.2's alternative).
- **Help mode (A582)** should carry the explanation of when a layout reaches the till.
- **A766** (the till's plan grows while a table is dragged) touches the till's map only; it does
  not conflict with this design and can land in either order.

## 11. Owner decisions asked

The question file numbers them 1–8:

1. Sets per department or venue-wide (section 4.1).
2. Shared tables or tables per set (section 4.2).
3. The Floor plans page's shape (section 5).
4. The period's Floor plan field: required with the default preselected, or optional (section 6).
5. When a zone switches (section 7.1).
6. What a switch does to tables, and the till's notice (sections 7.2 and 7.3).
7. Publishing for a later date: what is dated, date only or date and time, editable or fixed
   (section 8).
8. Build order and the reset: after A719, before or after the A760 squash, and Santet reset
   (sections 6 and 9).

## 12. Where this departs from earlier decisions

- **"A zone has at most one floor plan" and "One saved plan per zone"** (floor plan spec §15,
  decisions 1 and 2, owner 2026-10-08). A zone now has one layout per set. The same decision 2
  said "Named plans per department come later", which this is.
- **"Today's plan resets at the day cutover and on a button"** (floor plan spec §6.3 and decision
  2). A period switch is a third kind of reset, in the middle of the business day.
- **A reset puts back tables taken off for today** (`floor-today-store.ts:430-439`). Under the
  default, a period switch does not. This is a coded behaviour, not an owner ruling.
- **"Like menus"** (owner, 2026-10-11): the default dates a layout with a date and no time, and lets
  a scheduled layout be edited; menus take a date and a time and keep a queued edition fixed.
  Section 8's alternatives A and C are the exact menus behaviour.
- **The Departments list's floor plan link** (A718, owner 2026-10-16) goes, as the owner already
  decided on 2026-10-16.

## 13. Not verified

Everything in section 2 was read in the code at commit `c7bd97bf1`, not run. In particular:

- That the till shows a switch within about 15 seconds rests on reading `#watchFloor` and the
  floor read's call to `ensureToday`; no till was run across a period boundary.
- That `planReset`'s waiting rules carry over unchanged to a reset onto another set's layout is the
  design's expectation, not something tested.
- That periods of one department never overlap in time was not checked; section 7.1 assumes one
  period runs at a time per department.
