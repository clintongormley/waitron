# A504: floor plan sets, one per service period, and layouts published for a later date

**Status: draft for owner approval, 2026-10-17; revised the same day after a fresh-context
review.** Written by lane B while the owner is away. Nothing here is built. Statements about
today's code were read in the code at commit `c7bd97bf1` and cite where; two were also run, and say
so. Statements about the new behaviour are proposals. The owner answers the open points in one
question (decisions 1–10, section 11); each section gives the recommended default first, then the
alternatives, each with a worked example.

Mock-ups: [docs/backlog/mockups/a504-floor-plans/](../../backlog/mockups/a504-floor-plans/). They
are static drawings in the house colours, not screenshots of running code.

## 1. What the owner asked for

From the backlog entry ([till.md, A504](../../backlog/till.md#a504-floor-plans-published-for-a-future-date-and-one-per-service-period)):

- **A layout can go live on a chosen date**, as a menu can (owner, 2026-10-11).
- **Different layouts for different periods of the day**, for example lunch and dinner, with a
  decision on what happens to occupied tables when the period changes (owner, 2026-10-11).
- **Floor plans get a page of their own (owner, 2026-10-16).** What is edited is a named set of
  floor plans, one layout per zone, and a period picks the set it uses. The Departments list's
  per-zone floor plan link goes when that page lands. This supersedes the 2026-10-08 plan's "the
  dashboard has no `floor` screen and no Floor plan nav item" (`docs/superpowers/plans/2026-10-08-floor-plan.md:5946`).

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
- **The saved plan reaches the till only at a reset**, and "saving mid-service changes nothing on
  the till" (floor plan spec §6.3, owner 2026-10-08). A reset copies the saved plan into today's
  plan (`resetZone`, `apps/server/src/floor-today-store.ts:93-104`). It happens on the first read of
  the floor in a new business day (`ensureToday`, `floor-today-store.ts:533-580`), when staff press
  "Reset to saved plan" in the zone menu (`POST /api/zones/:id/today/reset`,
  `apps/server/src/floor-today-api.ts:226`), and when the dashboard saves a zone that has no
  today's plan yet (`floor-plan.ts:421-425`).
- **Occupied tables wait at a reset.** A table with an open party, held by a module, in a merge with
  such a table, or in a split group with one busy is left where it is and marked pending
  (`planReset`, `apps/server/src/floor-reset-plan.ts:80-87`); later reads catch it up once it is
  free (`catchUpZone`, `floor-today-store.ts:219-228`). A live table whose saved-plan table is gone
  is removed (`targetsFromMaster`, `floor-reset-plan.ts:131-183`).
- **A reset undoes every change staff made for the day to a free table**, including "Take off for
  today": the copied row sets `takenOff: false` and clears today's name (`todayColumns`,
  `floor-today-store.ts:430-439`). The approved floor plan spec says of today's changes: "It is all
  undone at the next reset anyway" (`2026-10-08-floor-plan-design.md:178-180`).
- **What the till reads, and when.** The floor's tables come from `GET /api/tables/state`, one row
  per table (`apps/till/src/api/client.ts:3412-3414`; server `apps/server/src/till-api.ts:2675-2685`),
  which runs `ensureToday` first, so any such read can be the one that resets a zone. Zones come
  from a separate read, `GET /api/zones` (`client.ts:3403`; `till-api.ts:2689`), which does not run
  `ensureToday`. Two 15-second timers re-read them, both read in the code, not run:
  - **Tables, on the map only.** While a zone's map is on screen the floor screen asks for a
    re-read every 15 seconds (`#watchFloor`, `apps/till/src/screens/till-floor-screen.ts:691-701`),
    which fetches the tables only (`#pollFloor` and `#refreshFloor`, `apps/till/src/till-app.ts:7883-7911`).
    The list's tables are not re-read on a timer (backlog, till.md "Refresh the floor without a
    staff action in a zone's list view").
  - **Zones, on the map and the list.** The menu-checking timer, started at sign-in
    (`till-app.ts:3892`), ticks every 15 seconds (`POLL_MS`, `apps/till/src/state/menu-state-poll.ts:4`,
    `42`, `56`), and each tick re-reads the zones whenever the floor screen shows and no order is open
    (`onTick`, `till-app.ts:2176-2185`).

  Both are also read when the floor is first loaded (`till-app.ts:7798-7808`) and when the till
  moves to the floor (`till-app.ts:7852-7857`), and the zones after "keep open" changes and when a
  held order's move opens (`till-app.ts:12338`, `12390`).
- **Periods.** A period belongs to one department (`menu_periods.department_id`,
  `packages/venue-service/src/schema/menus.ts:10-36`), and a zone belongs to one department
  (`zone_service_policies`, `packages/venue-service/src/schema/service.ts:51-79`). Which period is
  running in a department at a moment, today's "keep open" included, is answered by
  `resolveDepartmentService` (`packages/venue-service/src/menu-timetable.ts:373-468`; keep open is
  applied at lines 413-414). It reads the department's day afresh on every call (`menu-timetable.ts:383`),
  so a repaint changes the menus on the next request. Venue-service is a mandatory module
  (`tier: "mandatory"`, `packages/composition/src/modules.ts:135`), and the server already calls it
  directly (`VENUE_SERVICE`, `apps/server/src/working-order.ts:168`).
- **Periods of one department do not overlap.** Painted ranges that overlap are refused
  (`invalid(field, "overlap")`, `packages/venue-service/src/service-day.ts:76-80`), and a "keep open"
  cuts into the next range rather than running beside it (`withExtension`, `service-day.ts:161-184`).
- **"Keep open" can reopen a period that has already ended.** When no period is running, the period
  it extends is the last one that ran (`keepOpenSubject`, `menu-timetable.ts:338-358`). Run
  2026-10-17: `pnpm exec vitest run src/keep-open.test.ts -t "reopens the last ended period"` in
  `packages/venue-service` passed (1 passed, 53 skipped); in it, a lunch painted 12:00–14:00 is kept
  open at 15:10 until 16:00, and reads back as running.
- **The Periods page and period dialog keep a place for this.** The list has a Floor plan column
  showing a muted dash (`packages/venue-service/src/dashboard/periods-screen.ts:304-308`); the
  dialog has a disabled Floor plan field reading "Not available yet" (`period-dialog.ts:591-600`;
  strings `period.floor_plan`, `period.floor_plan_later`,
  `packages/venue-service/src/dashboard/strings.ts:716-717`, Spanish "Plano de sala"). "+ Add
  period" is one toolbar button (`periods-screen.ts:325-335`) whose dialog asks for the department.
  The period delete dialog's choice is "Replace with" / "Sustituir por", with "None" / "Ninguno"
  first (`strings.ts:737-738`, `1582-1583`).
- **The menus' "publish later".** A menu edition queued for later is a fixed copy of the menu with
  the instant it goes live (`menu_scheduled_publications`,
  `packages/catalogue/src/schema/publication.ts:100-136`). On a menu's Preview tab, "Publish later"
  opens a form with a **Date** and a **Time**; queued editions are listed under "Scheduled versions"
  with a "Goes live" column and a row menu with "Change time" and "Cancel this version", the cancel
  asking first with "Keep it" (`apps/dashboard/src/i18n/strings.ts:2799-2852`). A request that would
  put a newer version live before an older one is refused, naming the versions in the way: Publish
  now is refused while an older version waits ("must go live first. Cancel it, or publish once it is
  live"), and so is a schedule out of order (design-system.md, "A menu's queued versions sit above
  Unpublished changes"; strings `menu_publications.in_the_way_*`, `strings.ts:2836-2847`).
- **The floor plan editor's header is Undo, Redo, Cancel, Save** (A502, owner 2026-10-11;
  design-system.md "The floor plan editor's header is the owner's exception" and "Its header ends
  with Undo and Redo, then Cancel beside Save").

## 3. Words used here, and the example venue

- **Set** (Spanish "conjunto"): a named group of layouts, one for each zone of one department, such
  as "Standard" or "Dinner". A period picks a set.
- **Layout**: where each of one zone's tables stands in one set, and which are put away (spares).
  Today's "saved plan" is a layout.
- **Switch**: replacing a zone's today's plan with another set's layout during the business day.
  It is a reset, with the rules in section 7.4.

Every example uses one invented venue, **Casa Marina**, and the mock-ups draw the same one:

- **Restaurant** department, periods **Lunch** 13:00–16:00 and **Dinner** 20:00–23:30.
  - **Inside**: tables 1–12, plus the joined table **4+5** (8 seats, made of 4 and 5). "Standard"
    stands 1–12 apart and leaves 4+5 off: 12 on the plan, 1 spare. "Dinner" stands 4+5 in place of
    4 and 5: 11 on the plan, none spare.
  - **Terrace**: T1–T16. "Standard" puts T1–T10 out and keeps T11–T16 in the store room: 10 on the
    plan, 6 spare. "Dinner" puts T1–T8 out: 8 on the plan, 8 spare.
  - A third set, **Private party**, used by no period: Inside 4 on the plan, 9 spare; Terrace none.
- **Bar** department, one period **All day**, one zone **Bar**, one set "Standard".

## 4. What a set holds, and whose sets they are

### 4.1 Sets belong to a department (decision 1)

**Default: each department has its own sets**, and a set holds one layout for each of that
department's zones. A period can pick only its own department's sets. The floor plan spec's
later-work list already describes this ("Named plans per department … chosen by service period as
menus are", [2026-10-08 spec](2026-10-08-floor-plan-design.md) §14).

> Restaurant has "Standard", "Dinner" and "Private party", each with an Inside and a Terrace
> layout; Bar has its own "Standard". The Dinner period is offered Restaurant's three, never Bar's.

**Alternative: sets are venue-wide**, each holding a layout for every zone in the venue.

> One "Dinner" set holds Inside, Terrace and Bar layouts. Its Bar layout is used only if a Bar
> period also picks Dinner, so on a normal night editing it changes nothing, which is easy to
> mistake.

**The default set.** Each department has one set marked default, used by a new period until
someone picks another and by a zone on a day its department runs no period. The first set is
"Standard". The default cannot be deleted; another set can be made the default from its row menu.

### 4.2 Tables are shared; a layout says where they stand (decision 2)

**Default: a zone's tables are the same tables in every set.** A table's name, seats and "Moveable"
belong to the table. Each layout holds, for each table, its place, size, shape and turn, or that it
is put away. Adding, renaming or deleting a table in any set's editor does it for the zone, in
every set: a new table is a spare in the other sets.

A joined table (A503) is a table of the zone in the same way: its name, seats and the tables it is
made of are shared. Each layout either places it, and then its tables are off that layout, or
leaves it off, and then its tables can stand on their own. A joined table a layout leaves off is not
offered as a spare on the till while its tables stand on the map.

> Inside's table 4 exists once. In "Standard" it stands alone; in "Dinner" it is part of 4+5. A
> party seated at table 4 at 15:55 is still at table 4 after the 16:00 switch, with its bills and
> kitchen tickets untouched; once it leaves, 4 and 5 become 4+5.

Why: everything live points at a `dining_tables` row, which follows exactly one saved-plan table
(`dining-tables.ts:26`), and a live table whose saved-plan table disappears is removed at the next
reset (`floor-reset-plan.ts:131-183`). Shared tables keep one live table per piece of furniture
through every switch.

**Alternative: each set has its own tables, and tables with the same name in two sets are treated
as one at a switch.**

> Dinner's editor makes its own "4". If someone renames it "4 window", the link is lost: at the
> switch lunch's 4 is removed once free and a new "4 window" is created. The venue-wide unique name
> rule (`dining-tables.ts:29`) also means two sets can never use one name for two different tables.
> Seats can differ per set, which is what this buys.

## 5. The Floor plans page (decision 3)

Mock-up: [1-floor-plans-page.png](../../backlog/mockups/a504-floor-plans/1-floor-plans-page.png).

**Default.**

- **Where:** a page called **Floor plans** in the sidebar's Operations group, beside Departments
  and zones and the Calendar, at `/manage/floor-plans`. It needs `venue.configure`, as the editor
  does today (`apps/dashboard/src/dashboard-app.ts:282`); someone with only `venue.view` sees the
  list with no buttons and no row menus.
- **What it lists:** one table grouped by department, as the Periods list is. Under each
  department, a row per set: its name, "Default" beside the default set, "Used by" (a chip per
  period that picks it, or "Not used"), and the row menu. Under each set, a row per zone: the
  zone's name (a link to the editor), "12 on the plan · 1 spare", a "Scheduled" cell naming a layout
  waiting for a later date ("From 1 Jun 2027"), and the row menu, **Edit** and **Publish later…**
  (section 9). A layout that places none of the zone's tables reads "No tables on the plan"; a zone
  with no tables at all reads "No tables yet".
- **+ New set** is one toolbar button beside the page title, as "+ Add period" is
  (`periods-screen.ts:325-335`). Its dialog asks **Department** first, then **Name** (unique within
  the department) and **Start from** (that department's sets, the default first); the new set starts
  as a copy of the chosen set's layouts. Save is quiet and disabled until the fields are filled
  (design-system.md → Forms).
- **Row menu of a set:** **Rename…**, **Copy…** (asks a name; copies every layout in use, not
  waiting ones), **Make default** (not on the default), **Delete…** (not on the default).
- **Delete…** asks "Delete {set}?", says which periods use it and that the tables stay, and offers
  **Replace with**, the period delete dialog's wording, preselected to the default set. Unlike
  that dialog it has no "None", because every period needs a set. Cancel on the left, a danger
  **Delete {set}** on the right. Deleting a set a zone is using right now does not change the till
  then (section 7.2), and the dialog says so per case: for zones using it now, "{zones} keep today's
  layout until {period} ends", where {period} is the period each zone recorded (deleted at 14:00:
  "until Lunch ends"; at 17:00: "until Dinner ends"); when no zone is using it, no such line.
- **The editor** keeps its contract, its header included (Undo, Redo, Cancel, Save). Its title
  gains the set's name, "Inside · Dinner", and a line under it says "Tables are shared by every set.
  Adding, renaming or deleting one here does it in every set." Its address becomes
  `/manage/floor-plans/set/{set}/zone/{zone}`, and Close returns to the Floor plans page.
- **The Departments list's per-zone Floor plan link goes** (owner, 2026-10-16;
  `packages/venue-service/src/dashboard/departments-list.ts:239`).

**Alternative A: sets are chosen inside the editor.** No new page; the editor gains a set picker.

> To see which sets exist and which periods use each, the owner opens each zone in turn.

**Alternative B: the page, one row per set with the zones as buttons inside it.** Shorter, but a
waiting layout's date has no row of its own.

## 6. A period picks its set (decision 4)

Mock-up: [2-period-floor-plan-field.png](../../backlog/mockups/a504-floor-plans/2-period-floor-plan-field.png).

**Default.**

- **The period dialog's Floor plan field becomes a required dropdown** of the department's sets, the
  default marked "(default)". A new period starts on the default set. Opened from a painter's
  "+ New period" (`fromPainter`, `period-dialog.ts:150`), the field shows too, starting on the
  default, so a period never exists without a set.
- **The Periods list's Floor plan column shows the set's name.**
- **A719 first.** A719 (lane A, owner 2026-10-15) removes this column and field "until A504", turns
  the Periods page into a window opened from the Calendar, and moves Delete… into the dialog's
  bottom row with its danger look ([service-periods.md, A719](../../backlog/service-periods.md#a719-periods-become-a-window-opened-from-the-calendar),
  points 4 and 5; design-system.md, "A destructive action in the row … keeping its danger look").
  A504 adds the column and field back to that window. Both change `periods-screen.ts` and
  `period-dialog.ts`, so A719 lands first.
- **A change to this field during service does not move the till's tables** (section 7.2).

> Lunch → Standard, Dinner → Dinner, Bar's All day → Bar's Standard.

**Alternative: the field may be left empty, meaning "the default set".**

> The owner makes "Private party" the Restaurant's default for a week; every period left empty
> follows it without being opened, but the list shows "—" and nobody can tell which set Lunch uses
> without knowing the default.

**For a change that comes back every year, seasons already do the job.** A "Summer lunch" period
painted only in the Summer season can pick a "Terrace summer" set, with no dates to schedule.

## 7. When a zone switches (decisions 5, 6 and 7)

### 7.1 Which set a zone uses (decision 5)

**Default: a zone uses the set of the period running now; when none is running, the next period
later the same business day; when none is left, the last that ran that day; on a day with no
period at all, the department's default set.** "Running" is `resolveDepartmentService`'s answer,
"keep open" included. A period's end offset, which only moves when orders stop, plays no part.

> A normal Tuesday: from the day's start until 16:00 Inside and Terrace use Standard. At 16:00 Lunch
> ends and nothing runs until 20:00, so they switch to Dinner's set at 16:00, giving staff the
> afternoon to set the room up. If at 15:50 a manager keeps Lunch open until 16:45, the switch
> happens at 16:45.

**Alternative A: switch only when the next period starts.** The switch happens at 20:00, as dinner
guests arrive; the map does not show the dinner layout while staff set up.

**Alternative B: never by itself.** The zone menu offers "Switch to Dinner plan"; nobody presses it
on a busy evening.

### 7.2 Settings changed during service wait for the next change of period (decision 6)

The owner ruled that "saving mid-service changes nothing on the till" (floor plan spec §6.3). A
switch rule worked out afresh on every read would break that: changing a period's Floor plan
field, making another set the default, deleting the set in use or repainting the day would each
move the till's tables within seconds.

**Default: honour the ruling. Each zone records, at the moment it takes a set, the period it took
it for and the moment its rule can next give another answer** (the end of the running period, or of
the next period when none runs, or the end of the business day). Until that moment the zone keeps
its set whatever is changed on the dashboard; at that moment the rule is worked out again with the
settings as they then stand. **If the answer is the set already in use, nothing is reset:** only the
recorded period and moment move on. Two periods that share one set therefore follow each other with
no reset, and a period kept open before it ends just moves the moment.

> At 14:00 the owner changes Dinner's Floor plan from "Dinner" to "Private party". Nothing moves on
> the till. At 16:00, when Lunch ends, Inside and Terrace switch to Private party.
>
> At 14:00 a manager repaints today so Lunch ends at 15:00. The menus follow at once, because they
> read the day afresh (`menu-timetable.ts:383`); the floor keeps Standard until 16:00, the moment it
> recorded, then switches to Dinner's set.
>
> At 17:00 the owner deletes "Dinner", replacing it with "Standard". The till keeps today's copy of
> Dinner's layout until Dinner ends at 23:30; "Reset to … plan" in the zone menu, pressed meanwhile,
> uses Standard.
>
> At 15:50 a manager keeps Lunch open until 16:45, so at 16:00 the rule still gives Standard: nothing
> is reset, and the recorded moment becomes 16:45. At 16:10 the manager cancels the keep open; the
> floor keeps Standard until 16:45, the moment it recorded, then switches to Dinner's set.
>
> Monday is a day with no period, so the zones take the default set, Standard, until the day ends.
> At 11:00 the owner paints a lunch for today: the menus offer it at once, but the floor takes its
> set only from tomorrow's start.

**"Reset to … plan" in the till's zone menu (default: onto the recorded set).** It resets onto the
recorded set's current layout, as "Reset to saved plan" does today. So it brings early an edit to
that set's layouts, and, when that set has been deleted, the replacement chosen in the delete
dialog. It does not bring early a changed Floor plan field, a new default set or a repaint: they
wait for the recorded moment.

> At 14:00 a manager repaints today so Lunch ends at 15:00. At 15:10 a waiter presses "Reset to
> Standard plan": the zone resets onto Standard, the set it recorded, not onto Dinner's set.

Its label names the set it would reset onto: the recorded set, or, after that set is deleted, the
replacement ("Reset to Standard plan" in the 17:00 example above).

**Alternative for the button: it works the rule out afresh.** Pressed at 15:10 in the example above,
it resets onto Dinner's set and records Dinner. The button then brings every dashboard change early,
but staff pressing it to tidy the room can change the whole layout by surprise.

**The cost of the floor read.** Today `ensureToday` finds the zones needing work in one query that
starts from `floor_plans` (`floor-today-store.ts:541-565`, `.from(floorPlans)` at line 543). With
one row per set plus a waiting row there, that query has to be rebuilt to start from the zones and
today's rows, and gains the test on the recorded moment; the department's periods are worked out only
for zones whose moment has passed, so between boundaries a read does no more than that one query.

**Alternative: the switch follows the settings live.** Every floor read works out each department's
running period and switches any zone whose answer changed, so the 14:00 changes above move the
till's tables within seconds. Departs from the 2026-10-08 ruling, and makes every 15-second floor
read work out each department's periods; that cost would need measuring.

### 7.3 "Keep open" after a period has ended (decision 7)

"Keep open" can reopen a period that has already ended (section 2).

**Default: reopening an ended period does not bring its layout back.** The zone keeps the set it
switched to until that set's period ends.

> Lunch ends at 16:00 and Inside switches to Dinner's layout; staff start setting up 4+5. At 16:10 a
> manager keeps Lunch open until 17:00 for a late group. Lunch's menu is orderable again, but the
> floor stays on Dinner's layout; the late group is seated at a free table where it stands.

**Alternative: the floor follows, so there are two resets.** At 16:10 Inside switches back to
Standard: free tables, 4+5 included, go back to their lunch places, undoing the setting-up. At 17:00
it switches to Dinner again.

### 7.4 What a switch does (decision 8)

**Default: a switch is the reset the till already performs, onto the new set's layout, with one
difference: tables taken off for today stay off.**

There is still no timer on the server. Any floor read after a zone's recorded moment performs the
switch: `GET /api/tables/state` already runs `ensureToday` (`till-api.ts:2675-2685`), and under
section 10's default `GET /api/zones` runs it too. A till on the floor screen, map or list, re-reads
the zones every 15 seconds, and on the map the tables too (section 2), so it shows the change within
about 15 seconds of the boundary; this was read in the code, not measured. On the list, the table
rows themselves are refreshed only after a staff action or when the till comes back to the floor,
as today. A till on another screen shows it when it comes back to the floor.

What each kind of table does, from today's reset rules (`floor-reset-plan.ts:80-87`), at Inside at
16:00:

| On the till at the switch | What happens |
| --- | --- |
| A free table | Goes to its place in the new layout at once, or into store if the new layout puts it away. |
| Table 3, with lunch guests | Stays where it is until its party leaves; then it moves. |
| Table 7, bill asked for | The same: it has a party. |
| Tables 4 and 5, free, which Dinner joins as 4+5 | Become 4+5 at once. |
| Table 4, if a party sat there | Stays alone until the party leaves; then 4+5 forms. |
| A group staff made for guests | Stays together until the party leaves; then each table goes to its new place. |
| Tables 11 and 12, pushed together at 15:00 with nobody seated | Come apart at once, as "Reset to saved plan" does today. |
| Tables split off a joined table, one busy | The group waits until none is busy (`splitWithBusy`). |
| Table 9, taken off at noon with a wobbly leg | **Stays off** (new). |
| A spare placed for today, free | Goes back into store, or to its place if the new layout places it. |
| A table renamed for today, free | Loses today's name, as at any reset. |

A change a waiter sends from a map drawn before the switch is refused as "the floor has changed"
(`floor_today.out_of_date`), because a reset moves the room's revision (floor plan spec §6, A579
part 2a); the till reads again and the waiter tries again.

Known gaps this makes more frequent: a table waiting for its guests can stand where the new layout
puts another table (A600,
[till.md](../../backlog/till.md#a600-the-floor-wide-reset-and-its-catch-up-do-not-look-at-what-stands-in-a-saved-place)),
and a reset does not wait for food on its way to an ordinary table (A565). Today those can happen
once a day; with switches, at every change of period. The plan decides whether to fix them first.

**Alternative A: exactly today's reset; taken-off tables come back.** Table 9 reappears at 16:00 and
someone takes it off again.

**Alternative B: only tables nobody changed today move.** Staff set-ups survive until tomorrow, but
the dinner layout is only partly applied: 11 and 12 stay pushed together all evening.

### 7.5 What the till shows (also decision 8)

Mock-ups: [3-till-switch-notice.png](../../backlog/mockups/a504-floor-plans/3-till-switch-notice.png)
and [4-till-switch-notice-phone.png](../../backlog/mockups/a504-floor-plans/4-till-switch-notice-phone.png).

**Default: a one-line notice under the zone tabs**, "Dinner plan since 16:00. 2 tables move when
their guests leave." The count falls as tables catch up; at none the sentence ends at "since 16:00".
It has a close button, stays closed on that till for that switch, and blocks nothing. It comes from
the zones read, so it appears on the map and on the list at the next 15-second zones re-read
(section 7.4). The zone menu's "Reset to saved plan" (`floor.reset_plan`,
`apps/till/src/i18n/strings.ts:855`) becomes "Reset to Dinner plan", naming the set it would reset
onto (section 7.2); its question keeps today's words.

**Alternatives:** also draw a dashed outline where each waiting table will go (clearer, but outlines
can sit over other tables, the A600 gap); or no notice.

## 8. Words, in English and Spanish

| Where | English | Spanish |
| --- | --- | --- |
| Sidebar, page title | Floor plans | Planos de sala |
| Page button, dialog title | + New set / New set | + Nuevo conjunto / Nuevo conjunto |
| Field | Start from | A partir de |
| Column, chip | Used by / Not used | Usado por / Sin usar |
| Badge, menu item | Default / Make default | Predeterminado / Hacer predeterminado |
| Delete dialog choice | Replace with | Sustituir por |
| Cell | {n} on the plan · {m} spare | {n} en el plano · {m} de reserva |
| Cell | No tables on the plan / No tables yet | Ninguna mesa en el plano / Aún no hay mesas |
| Editor line | Tables are shared by every set. Adding, renaming or deleting one here does it in every set. | Las mesas son comunes a todos los conjuntos. Añadir, renombrar o eliminar una aquí lo hace en todos. |
| Zone menu, schedule | Publish later… / Schedule {zone} · {set} | Publicar más tarde… / Programar {zone} · {set} |
| Editor title while waiting | {zone} · {set} · goes live {date} | {zone} · {set} · se publica el {date} |
| Editor line on the layout in use | A layout for {date} is waiting. It replaces this one then; changes saved here are not copied into it. | Hay un plano esperando para el {date}. Entonces sustituye a este; los cambios guardados aquí no se copian en él. |
| Chip, menu | From {date} / Change date / Cancel this layout / Keep it | Desde el {date} / Cambiar fecha / Cancelar este plano / Mantenerlo |
| Till notice | {set} plan since {time}. {n} tables move when their guests leave. | Plano {set} desde las {time}. {n} mesas se moverán cuando se vayan sus clientes. |
| Till zone menu | Reset to {set} plan | Volver al plano {set} |

Today's Spanish for "Reset to saved plan" is "Volver al plano guardado" (`apps/till/src/i18n/strings.ts:2372`).

## 9. Publishing a layout for a later date (decision 9)

Mock-up: [5-publish-later.png](../../backlog/mockups/a504-floor-plans/5-publish-later.png).

**Default: a set's layout of one zone can wait to go live from a chosen business day. It starts
from the Floor plans page, takes a date and no time, and keeps the editor's header as it is.**

- **Starting it:** the zone row's menu on the Floor plans page has **Publish later…**. It opens the
  menus' compact form: "Schedule Terrace · Standard", "The layout goes live at the start of the
  business day you choose, on the venue's clock (Europe/Madrid).", one required **Date**, Close on
  the left and **Schedule** on the right. Schedule opens the editor on a copy of the layout in use,
  titled "Terrace · Standard · goes live 1 Jun 2027", with its usual Undo, Redo, Cancel, Save. Save
  stores the waiting layout; Cancel stores nothing. The date is chosen before drawing so that
  "Publish later" needs no button of its own in the editor, whose header order is the owner's
  (A502).
- **"Goes live" means the start of that business day:** the first floor read on or after it puts the
  waiting layout in place of the set's layout, and resets the zone if that set is in use, as a new
  day's reset does today.
- **One waiting layout per set and zone.** While one waits, the zone row's menu does not offer
  Publish later… (it is hidden, not refused). The zone row shows "From 1 Jun 2027"; the chip's menu has
  **Edit**, **Change date** and **Cancel this layout**, the cancel asking "Cancel the layout scheduled
  for 1 Jun 2027?" with **Keep it**. Editing it keeps its date.
- **Saving the layout in use while one waits is allowed, and the editor says what happens:** a line
  under its title reads "A layout for 1 Jun 2027 is waiting. It replaces this one then; changes
  saved here are not copied into it."
- **Tables are shared (section 4.2).** Bringing out T11–T16, which already exist as spares, changes
  nothing for other sets. A table added while editing the waiting layout is created in the zone at
  its Save, and is a spare in every other layout from then on; a table deleted anywhere is gone from
  the waiting layout too.
- **Once live, the old layout is not kept.**

> 20 April: on the Floor plans page the owner opens Terrace · Standard's menu, chooses Publish
> later…, picks 1 June 2027, drags T11–T16 out of the store room in the editor, and saves. Nothing
> changes on the till. On 15 May a waiter reports T3 wobbles; the owner moves it in Terrace ·
> Standard and saves, and the editor's line reminds them the 1 June layout still has T3 where it
> was, so they also open the waiting layout from its chip and move it there. On 1 June the first
> floor read puts the summer rows on the till.

**Alternative A: follow menus and refuse.** While a layout waits, Save on the layout in use is
refused: "The layout scheduled for 1 Jun 2027 must go live first. Cancel it, or save once it is
live." (modelled on `menu_publications.in_the_way_now`). In the example, the wobbly T3 cannot be
fixed on the till until June without cancelling the summer layout.

**Alternative B: a date and a time, as menus have,** with several waiting layouts allowed in date
order and the menus' out-of-order refusals. A layout timed for 21:00 lands mid-service under
section 7.4.

**Alternative C: date the period's choice, not the layout.** The period dialog gains "From [date]
use [set]"; the owner copies Standard to "Summer", moves T11–T16 out there, and sets the date on
Lunch and on Dinner.

**Alternative D: a waiting layout is fixed, as a menu edition is;** to change it, cancel and
schedule again.

## 10. Data model sketch, migration and the A760 squash

A sketch for the plan to settle, not a final schema.

**Core (`packages/db`), all classified `state` like today's floor tables
(`packages/db/src/classification.ts:105-112`):**

- **`floor_plan_sets`** (new): `id`, `location_id`, `name`. No department column: departments live in
  the venue-service module, and a core table cannot refer to a module's table (CLAUDE.md §3, the
  module-graph rule).
- **`floor_plans`** becomes one row per zone per set, plus at most one waiting row: gains `set_id`
  and `starts_on` (a business date; null for the layout in use). `floor_plans_zone_key` gives way to
  one layout in use, and one waiting, per zone and set. `revision` and `saved_at` stay per layout, so
  the "out of date" save check (`floor_plan.out_of_date`, `floor-plan.ts:276-279`) works per layout.
- **`floor_plan_tables`** becomes the zone's tables: `plan_id` is replaced by `zone_id`, keeping name,
  seats and fixed; places move to a new **`floor_plan_placements`** (`plan_id`, `plan_table_id`, x, y,
  width, height, shape, turn; no row means put away). `floor_plan_table_sizes` gains `plan_id`.
  `floor_plan_table_parts` stays per joined table, shared by every layout.
- **`floor_today_zones`** gains `set_id` (the set in use), `period_id` (the period it was taken for,
  null on a day with none) and `holds_until` (the moment of section 7.2). `ensureToday`'s query is
  rebuilt to start from the zones and gains `holds_until <= now` (section 7.2, "The cost of the floor
  read").
- **`floor_reset_tables`** works as today; a switch writes it as a reset does, copying `taken_off`
  from today's row instead of clearing it.

**Venue-service (`packages/venue-service`):**

- **`department_floor_plan_sets`** (new): `set_id` (primary key, foreign key to the core table),
  `department_id`, `is_default`, at most one default per department.
- **`menu_periods.floor_plan_set_id`** (new, required, foreign key to `floor_plan_sets`).
- **A seat answer** for "which set, for which period, until when" for a zone at a moment, from
  `resolveDepartmentService`'s periods and runs, which the core floor code calls as it already calls
  `VENUE_SERVICE` (`apps/server/src/working-order.ts:168`).

**What the till reads.** The notice's facts belong to a zone, and the till already re-reads the
zones every 15 seconds on the floor screen, map and list (section 2), so they go on `GET /api/zones`:
each zone gains `planSet` (the name of the set in use and the time it came in) and `waitingToMove`
(how many tables wait at their old place). For the zones read to show a switch it must also be able
to perform one, so `GET /api/zones` runs the floor catch-up as `GET /api/tables/state` does
(`till-api.ts:2675-2685`; today it does not, `till-api.ts:2689`). This costs no extra request.
(Alternative: put the facts on each table row of `GET /api/tables/state`, the read that performs the
switch today; but the list does not re-read tables on a timer, so the list would show the notice
only after a staff action.)
The dashboard's live subscriptions name the new tables as sources (`scripts/live-subscriptions.test.ts`),
and the configuration export, which lists `floor_plans` today (`packages/db/src/configuration-transfer.ts:53`),
adds them.

**Migration: yes, in core and in venue-service.** `floor_plan_tables` loses its place columns, which
drizzle does by rebuilding the table; before shipping, the foreign keys pointing at it are listed (at
least `dining_tables.plan_table_id`, `floor_reset_tables.plan_table_id`, `floor_plan_table_parts`,
`floor_plan_table_sizes`) and the generated SQL read (CLAUDE.md §3's rebuild rules, including "a
rebuild must not also add a column" on drizzle-kit 0.31). Under the pre-live rule (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production") nothing is carried
forward: seeds write a "Standard" set per department and the dev venues are reset. **Cost to the
owner:** the Santet real-data venue loses its floor plans at that reset and is rebuilt with
`local/square/reset.sh`. **Alternative:** a small step in the migration moves each zone's plan into a
"Standard" set, so Santet keeps its layouts; it is the carry-forward code the pre-live rule otherwise
leaves out, so it needs the owner's say-so.

**A760, the migration squash.** Its plan
([2026-10-16-a760-migration-squash.md](../plans/2026-10-16-a760-migration-squash.md)) starts only after
migration branches finish or are withdrawn, under a full freeze. A504's build either lands before the
freeze, and its migrations are folded into the squash, or starts after the squash lands. It must not
be in progress when the freeze begins. This design adds no migration.

## 11. Owner decisions asked

The question file numbers them 1–10: (1) sets per department; (2) shared tables; (3) the page; (4)
the period's field; (5) when a zone switches; (6) settings changed during service; (7) keep open
after a period ended; (8) what a switch does and the till's notice; (9) publishing for a later date;
(10) build order and the reset.

## 12. Out of scope, and gaps for the plan

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
  `packages/venue-service/src/schema/seasons.ts:164`, `203`; `zone_extensions`,
  `packages/venue-service/src/schema/zone-extensions.ts`, A366). The older `zone_closed_times` table
  is gone (`packages/venue-service/src/migrations.test.ts:191-197`). The rule here follows the
  department's period; whether a zone kept open past its department's period keeps its layout is for
  the plan.
- **Bookings.** A booking on a table the evening's set puts away: the editor could warn, the booking
  screen could refuse. Left for the bookings work.
- **A600 and A565** (section 7.4).
- **History of past layouts.**
- **Seats per layout** (only under section 4.2's alternative).
- **Help mode (A582)** should explain when a layout reaches the till.
- **A766** (the till's plan grows while a table is dragged) touches only the till's map and can land
  in either order.

## 13. Where this departs from earlier decisions

- **"A zone has at most one floor plan" and "One saved plan per zone"** (floor plan spec §15,
  decisions 1 and 2, owner 2026-10-08). A zone has one layout per set. Decision 2 also said "Named
  plans per department come later", which this is.
- **"Today's plan resets automatically at the day cutover, and on Reset to saved plan"** (floor plan
  spec §6.3). A change of period is a third, mid-day reset. The same section's ruling, "saving
  mid-service changes nothing on the till", is kept by the default of section 7.2; the alternative
  there departs from it.
- **"It is all undone at the next reset anyway"** (floor plan spec §6, of staff's changes for the
  day; `2026-10-08-floor-plan-design.md:178-180`). Under the default of section 7.4 a change of period
  keeps tables taken off for today off. An end-of-day reset and "Reset to … plan" still undo
  everything.
- **"Like menus"** (owner, 2026-10-11). The default differs from menus in four ways: a date and no
  time; one waiting layout per set and zone instead of a queue of versions; the waiting layout can be
  edited; and saving the layout in use while one waits is allowed with a warning, where menus refuse
  Publish now while an older version waits. Section 9's alternatives A, B and D are the menus'
  behaviour.
- **The editor's header** (A502, owner 2026-10-11) is kept as Undo, Redo, Cancel, Save: Publish
  later starts on the Floor plans page instead.
- **The Departments list's floor plan link** (A718) and **the 2026-10-08 plan's "no Floor plan nav
  item"** go, as the owner decided on 2026-10-16.

## 14. What was verified, and what was not

- **Run:** the keep-open reopening test (section 2). **Read and cited:** everything else in section 2,
  including that one department's painted ranges cannot overlap (`service-day.ts:76-80`) and that
  keep open cuts into the next range (`service-day.ts:161-184`).
- **Not measured:** how soon a till shows a switch. "About 15 seconds" rests on reading
  `#watchFloor`, `#pollFloor` and the menu-checking timer's `onTick`; no till was run across a period
  boundary.
- **Expected, not tested:** that `planReset`'s waiting rules carry over unchanged to a reset onto
  another set's layout, and that recording `holds_until` makes keep open, repaints and deletions
  behave as sections 7.2 and 7.3 describe.
