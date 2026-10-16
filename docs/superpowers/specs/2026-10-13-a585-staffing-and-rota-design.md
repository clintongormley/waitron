# A585 — Staffing needs and the rota: who the venue needs, when, and who fills it

> 2026-10-16: A763 redesigns the Rota view. One Show menu replaces decision 9's By area | By
> person switch and the area picker, and the people panel goes. See
> [A763](../../backlog/workforce.md#a763-the-rota-view-redesigned-one-show-menu-no-button-per-cell-an-empty-week-that-says-why).

> 2026-10-16: A724 replaces the painters’ bare opening-hour guides with named period bands and
> station sending-department lanes, and calls the season painter a standard week. See its
> [Part 1 plan](../plans/2026-10-16-a724-staffing-guide-bands.md). The month’s day-box work stays open.

> 2026-10-16: A720 Part 5 removes the Staffing month’s season chips and legend; every day opens the
> shared day box. See design-system.md, the Staffing view.

> **2026-10-15:** A585 part 8 retires the dashboard Rota screen and its shift dialog, and drops
> the free-text shift/template `role`. Plan shifts in Calendar → Rota; staffing owns its shift
> editor. References below describe the code when this document was written.

Date: 2026-10-13. Status: design agreed with the owner in chat; awaiting review of this written spec.

> 2026-10-15 implementation pointer: part 5 adds published-only own shifts, copying a published
> week into a draft, module descriptions on both own schedules and the warnings read. The
> [part 5 plan](../plans/2026-10-13-a585-staffing-and-rota.md#part-a585-5--workforce-what-staff-see-copying-a-week-describing-shifts-warnings)
> records its interfaces. The Rota views and retirement in parts 6–8 remain open.

> 2026-10-15 implementation pointer: part 6 adds the area rota, slot filling and picker, and the
> month's unfilled counts. Parts 7–8 still provide editing, the person view, labour warnings,
> publishing, changing a week and retiring the old screen. The day-length question A644 remains
> open; part 6 keeps the existing slot limit.


> 2026-10-15 implementation pointer: part 7 adds the person view, labour warnings and candidate
> previews, publication, changing a published week, and a protected shift editor with swap
> confirmations. Part 8 still retires the old Rota screen and free-text role columns. See the
> [part 7 plan](../plans/2026-10-13-a585-staffing-and-rota.md#part-a585-7--the-rota-by-person-warnings-publish-and-change-this-week).

## Why

Opening hours say when each department serves customers: the Restaurant's Lunch, say, 13:00–16:00.
Staff work longer and in more shapes than that. The kitchen preps for hours before Lunch, and the
terrace is set up before service and cleared after it. Nothing in Waitron says who the venue needs at
those times, or lets a manager build a rota against that need.

What exists today (2026-10-13, read on `main` at be26fc41f):

- A shift (`packages/workforce/src/schema/shifts.ts:12`) names a person, a location, a start, an end
  and a free-text `role`. It names no department, station or period.
- The Rota screen (`apps/dashboard/src/screens/roster-screen.ts`) is a grid of people × weekdays, and
  its shift dialog (`apps/dashboard/src/widgets/shift-dialog.ts`) takes the role as plain text.
- There is no list of job roles anywhere. The only roles are sign-in permission levels
  (`personRole` in `packages/identity/src/schema/persons.ts`: staff, supervisor, manager, admin).
- The labour-agreement checks exist (`validateRoster`, `packages/workforce/src/roster-validation.ts:380`:
  rest between shifts, daily and weekly maximums, weekly rest, breaks owed, night work, the annual
  overtime cap), but the dashboard shows them only in the answer to Publish.
- A person's own shifts on the till and in My schedule come from `listShiftsForPerson`
  (`packages/workforce/src/schedule-reads.ts:54`), which returns draft shifts as well as published
  ones.
- A published shift cannot be changed (`updateShift` and `removeShift` refuse `roster.not_draft`,
  `packages/workforce/src/clocking.ts`), and publishing a second version for the same period
  attaches only shifts that belong to no version (`publishRoster`, `clocking.ts:520`).

## What the owner said

> "the times from the periods give you the times that each of the stations needs to be open but
> there's more to it than that … the kitchen needs to be open from 12 to 3 but it also needs four
> hours before that for prep or the terrace needs setting out so that's half an hour before and half
> an hour after … it's that we want to assign the shifts to these spaces so we need a roles
> functionality and this is not the user roles … you may have a head chef and two sous chefs working
> in the kitchen you may need a manager in the bar and three waiters" (2026-10-13 ~10:00)

> "it's not correct to say that lunch + kitchen = 1 head chef and 1 sous chef because that may be true
> on tuesday but friday may need 1 head + 2 sous chefs. so i think this is something we need to paint
> as well" (2026-10-13)

## Four pieces, in this order (owner, 2026-10-13)

The owner also asked for labour rules per person and, ideally, a solver that drafts the rota. That
is too much for one design, so it is four pieces, each with its own spec and plan:

1. **A585 — staffing needs and the rota** (this spec).
2. **A586 — labour rules and hours balance per person.** The country module supplies the defaults,
   as `workforce-es` does today with one `convenio_config` row per location (`resolveWorkTimeRuleset`,
   `packages/workforce-es/src/convenio.ts:39`). The venue keeps named agreements, and each person's
   contract names the one that applies. Each person gets a running total of hours clocked and
   rostered against the hours they should have worked, with annual leave counted (open point 6).
   Planned together with A10, whose overtime figures read the same rules.
3. **A587 — availability**: "can't work Wednesdays", preferred days. The `availability` table exists
   and nothing uses it.
4. **A588 — the solver**: fills a draft rota from the open slots, each person's rules, availability,
   contracted hours and staff roles, for the manager to adjust.

A585 is shaped so the later pieces add to it without changing it. A slot is just something to fill,
so the solver becomes a second way of filling it. The warnings read whatever rules apply, so A586
changes where the rules come from and nothing else.

## Decisions (owner, 2026-10-13)

1. **The first use is filling slots.** The needs show on the rota as empty slots, and the manager
   puts a person in each. Gaps stay visible and are counted.
2. **Needs are painted onto departments and prep stations**, not zones (not for now). A prep station
   gets staffing paint but still no opening hours: the A366 decision that a station has no hours of
   its own stands. Terrace waiters, or a duty manager, are painted onto a department.
3. **A painted block is one staff role, a number of people, a start and an end**, on a season's
   weekday or a special day's date. It makes that many slots with exactly those times, and one slot
   is one shift. There is no separate "prep period": a block simply starts before the service hours,
   which the painter shows faintly behind it. Needs differ by day ("Tuesday one sous chef, Friday
   two"), so they are painted, not set once per period.
4. **The venue keeps a list of staff roles, and each person holds as many as apply.** A slot's
   picker lists the holders first; "Show everyone" lets a manager put anyone in, and the slot is then
   marked as filled outside the role.
5. **A shift is the commitment; repainting never changes or removes one.** Slots are worked out from
   the current paint every time they are shown, and the rota flags where the shifts and the paint
   differ.
6. **Copying paint between days is in the first version** (the shared painter's "Copy to…").
   Out of the first version: open slots offered on the till, a labour-cost estimate, planned versus
   actual by role, zones, and generating the rota.
7. **The painter draws blocks side by side** where they overlap, like a calendar app (mockup 1,
   option A). Rejected: a headcount lane per role (staggered shifts come out the wrong shape) and a
   list per day (it does not work like opening hours).
8. **One calendar.** The Opening hours page becomes **Calendar**, with a view switch: **Opening
   hours | Staffing | Rota**. Seasons, special days, the month and the painter frame are shared
   (mockups 2–4).
9. **The Rota view has a second switch, By area | By person**, and the old Rota screen goes.
10. **People see their own shifts** on the till and in My schedule, now with the area and staff role,
    and **only from a published week**.
11. **Labour warnings show while the rota is built**, not only after Publish. They never stop
    publishing (owner decision 2026-08-02, unchanged).

## Mockups

Saved in [docs/backlog/mockups/a585-staffing/](../../backlog/mockups/a585-staffing/). The names, dates
and hours in them are examples.

1. [How a day's staffing is painted](../../backlog/mockups/a585-staffing/1-painter-approaches.png):
   the three options; A was chosen.
2. [The Calendar's Staffing view](../../backlog/mockups/a585-staffing/2-calendar-staffing-views.png):
   the month, and the season painter in Staffing view.
3. [The Rota view, by area](../../backlog/mockups/a585-staffing/3-rota-by-area.png).
4. [The Rota view, by person](../../backlog/mockups/a585-staffing/4-rota-by-person.png), with the
   picker, the publish warnings and the till's My schedule.

## Words

- **Staff role**: a job position such as Head chef, Sous chef or Waiter. Always "staff role" on
  screen and in code, never bare "role", which already means a sign-in permission level
  (`personRole`) and the free-text field on a shift.
- **Area**: a department or a prep station, whichever a block or shift belongs to.
- **Block**: one painted need (a staff role, a number of people, a start, an end) on one area's day.
- **Slot**: one place for one person, worked out from a block. Never stored.

## Where it lives

A new module, `staffing` (`packages/staffing`), with its own migration set and its own dashboard
screens. Its descriptor `requires` core, `identity` (people), `venue-service` (seasons, special days,
departments, the painter) and `workforce` (shifts, rota versions, the labour checks). None of those
learns that staffing exists: the Calendar's view switch is a seam `venue-service` offers and staffing
fills (decision 8).

The seam is new. The calendar participants the menu timetable used were removed in A506-5, so the
plan chooses the mechanism, through `@waitron/dashboard-modules` like other module-owned screens.

The alternative was to add all of this to `workforce`. That would make `workforce` depend on
`venue-service`, and it would collide with A10, which changes `workforce` next.

## What it stores

All five tables are classified `state` in `STAFFING_CLASSIFICATION`. Each is per location, as seasons
and shifts are. Every foreign key and unique index is declared in the TypeScript schema (CLAUDE.md
§3).

- **`staff_roles`**: id, location, name, colour, position (for ordering). The name is unique per
  location.
- **`person_staff_roles`**: person, staff role. Its primary key is the pair.
- **`staffing_days`**: one area's day. It holds the area as EITHER a department OR a prep station
  (exactly one, enforced by a CHECK), and the day as EITHER a season and a weekday OR a special day's
  date (exactly one, the same either/or shape as `department_days`,
  `packages/venue-service/src/schema/seasons.ts:92`). It is unique per area and day.
- **`staffing_blocks`**: day, staff role, how many people (1 or more), start, end. Times are 15-minute
  steps on the business day, as opening-hours ranges are, so a block may run past midnight to the
  day's changeover.
- **`shift_assignments`**: shift (the primary key, a foreign key to `shifts` that cascades on
  delete), area (department or station, exactly one), staff role. A shift with no row here is "not in
  a slot".

A special day's row for an area **replaces the season's weekday for that area entirely**, blocks and
all; with no row, the season's weekday shows through. A special-day row with no blocks means nobody
is needed that day **(default)**. Per-stretch layering, which opening hours use, has no clear
meaning once blocks overlap.

Staffing paint is independent of opening hours. A date on which the whole venue is closed can still
need staff (a deep clean, a delivery), so the hours never hide or remove staffing paint **(default)**.

Blocks never name a period, so deleting a period (A578's path) never touches staffing. Deleting a
department or a station only switches it off (`service-delete.ts:329`, `station-delete.ts:215`), so
its staffing paint is kept but hidden everywhere, its shifts show under "Not in a slot", and the
paint comes back if it is switched on again. Deleting a season or a special day's date deletes its
staffing days and blocks with it; whether the delete's confirmation counts them is open (it needs a
seam venue-service does not have) **(default: no count)**. (Corrected 2026-10-13 after the plan
review: an earlier version said departments and stations are deleted.)

Configuration export and import carry `staff_roles`, `person_staff_roles`, `staffing_days` and
`staffing_blocks`. They do not carry `shift_assignments`, because shifts are not exported today
(`WORKFORCE_CONFIGURATION_TRANSFER`, `packages/workforce/src/configuration-transfer.ts`, lists
`employments`, `availability` and `shift_templates`).

New tables mean a venue reset when this lands. Waitron is not live, so no data migration is written
(CLAUDE.md §3).

## Working out slots, and matching shifts to them

A pure function, browser-safe and with no database, so the dashboard and the server share it:

1. **Slots for a date and area**: find the date's season and special day the way the day resolver
   does (`readDayPlan`, `packages/venue-service/src/day-resolver.ts`), take the special day's row for
   the area if there is one and otherwise the season weekday's, and turn each block into its number
   of slots.
2. **Match**: for each date, area and staff role, pair shifts with slots by largest overlap first,
   then by earliest start, then by id, so the same week always draws the same way. Then report:
   - **filled**: a slot fully covered by its shift;
   - **partly uncovered**: the slot's time that its shift does not cover ("uncovered 14:00–17:00");
   - **unfilled**: a slot with no shift;
   - **over**: a shift that pairs with no slot ("not needed");
   - **outside role**: a paired shift whose person does not hold the staff role.

A shift belongs to the business day it starts in (`serviceMomentAt`,
`packages/venue-service/src/service-day.ts:113`), so an 18:00–00:30 shift is matched on its starting
day.

## The Calendar

**Staffing view, the month** (mockup 2, top). It is the month of A506-7 with the same season chips
and stepping. Each day shows, per area, how many people are needed; once the week has a rota it also
shows how many slots are unfilled. The picker offers All areas or one area. "Rota for this week"
opens the Rota view on that week.

**Staffing view, the painters** (mockup 2, bottom). These are the A506-8 season painter and the A506-9
special-day painter: the same full-screen frame, season or date stepping, one draft, Cancel and Save,
the unsaved-changes guard (`draftScopeFor`) and, on each column, "Copy to…" and Clear. With
Staffing selected:

- the picker lists departments and prep stations, grouped;
- the chips are staff roles plus "Add staff role", with a "How many" stepper;
- dragging down a column adds a block of the chosen staff role and number; dragging an edge resizes
  it; clicking it lets you change its staff role or number, or delete it;
- overlapping blocks sit side by side in the column;
- behind them, faintly, are the area's hours: a department's painted hours, or a prep station's
  times as worked out today (`stationServiceTimes`, `packages/venue-service/src/station-service-times.ts:76`).

The blocks need their own drawing part: A506-8's paint grid holds one period at a time per column
(its `Paint` model, plan Task 8.2). The frame, the ruler, the time steps, the drag-to-scroll and the
copy all come from A506-8.

On a special day, "Follow the season" removes the special day's row for that area, so the season
shows through again. Clear leaves an empty row, meaning nobody is needed.

## The Rota view

**By area** (mockup 3). One real week (Monday to Sunday) and one area. The rows are staff roles, and
each day lists that role's slots with the person in each, drawn by the matching above: filled,
partly uncovered, unfilled (dashed, "+ unfilled"), over, outside role. Unlinked shifts at the
location for that week are in a last row, "Not in a slot", and can be given an area and a staff role.
The header counts what needs attention ("2 unfilled · 1 partly uncovered · 1 over"), and a side panel
lists everyone's hours that week across all areas against their contracted hours.

**The picker**: clicking an unfilled slot lists the people who hold its staff role, each with whether
they are free, their hours that week against their contract, and any warning the shift would cause
(mockup 4). "Show everyone" lists everyone else. Choosing someone creates the shift (`addShift`) and
its `shift_assignments` row in one transaction.

**By person** (mockup 4). The same week, every area, one row per person, with their staff roles and
their week's hours. "+ Add shift" in a cell adds a shift for a chosen area and staff role. If nothing
is painted for it, it shows as over.

**Warnings while planning.** Every change to the week re-runs `validateRoster` over the whole
location's week, not only the area on screen. A shift that breaks a rule carries the warning, and
the header counts them. Until A586 lands the rules are the location's one `convenio_config` row. If
the location has no row, the view shows a single notice ("Labour rules are not set up") in place of
the warnings, and nothing else changes **(default)**.

**Publishing** keeps today's model: one draft rota version per location and week, published with one
button from either view. Publish lists the warnings and offers "Back to the rota" or "Publish anyway".

**Changing a published week.** "Change this week" on a published week creates a new draft version
for the same week and copies its shifts, with their `shift_assignments` rows, into it. Staff keep
seeing the published version until the new one is published and supersedes it. This replaces
today's behaviour, in which a published shift can never be changed again.

**Everything that reads "the rota" reads only the current published version**: the till's schedule,
My schedule, and A10's "had a rota shift and never clocked in" check. `listShiftsForPerson` changes
to match (decision 10).

## What people see

The till's schedule (`apps/till/src/screens/till-schedule-screen.ts`) and the dashboard's My
schedule show each shift as "time · area · staff role" (for example "09:00–15:00 · Kitchen · Sous
chef"), from `shift_assignments`, in place of the free-text role. Swaps, cover requests and time off
work as today.

## What goes

- The Rota screen (`roster-screen.ts`) and its shift dialog (`shift-dialog.ts`), replaced by the
  Calendar's Rota view.
- The free-text `role` on `shifts` and on `shift_templates`, once nothing writes it. The column is
  dropped in the part that retires the old screen.

## Order of work and collisions

- **After the A506 chain** in lane A (A506-7, -8, -9, -11, -12, A577, A578). The painters, the month
  and the Calendar rename all build on what it lands.
- **A10** follows A506 in lane A and changes `packages/workforce`. A585's own changes to
  `packages/workforce` are the published-only read, "Change this week", and dropping `role`. They
  are planned after A10-1 to A10-3, or together with them. The `staffing` package and its screens can
  be built alongside A10 in another lane.
- **Review weight: full.** This adds tables (a venue reset), a seam other code depends on (the
  calendar's view switch), and changes what staff are shown and which shifts count as the rota.

## Testing

- **Node tests** for the pure functions: slots for a date with and without a special day; a special
  day with an empty row; matching with staggered shifts, a shift cut short, a shift outside its role,
  an over shift, and a tie broken the same way twice; a shift past midnight matched on its starting
  day.
- **Database tests** (`useVenueDb`) for the CHECKs on `staffing_days`, the cascades (season,
  special day's date, shift), a switched-off department or station hiding its paint and moving its
  shifts to "Not in a slot", "Change this week" copying the assignments, the
  published-only read, and a refused write asserting its domain error code.
- **Browser tests** for the painter: drawing, resizing, overlapping blocks side by side, "Copy to…",
  Clear and "Follow the season", and the unsaved-changes guard (`*.unsaved.test.ts`). For the Rota
  views: every slot state drawn, the picker's order and warnings, a change re-drawing the warnings,
  and Publish with warnings. Each also gets accessibility tests in both themes (`*.a11y.test.ts`).
- **Guards**: the schema-constraint, classification, module-graph and configuration-transfer suites
  pick up the new set.

## Out of scope

Zones; labour rules per person (A586); availability (A587); generating the rota (A588); open slots
on the till; a labour-cost estimate; planned versus actual by staff role; shift templates.

## Open points

1. **Deleting a staff role** that paint or shifts use: refuse while any shift links to it, and
   otherwise delete its blocks after a confirmation that counts them **(default)**.
2. **A person loses a staff role**: their existing shifts in it become "outside role"; nothing is
   moved or deleted **(default)**.
3. **Which week starts the Rota view**: Monday to Sunday, matching today's Rota screen (`mondayOf`,
   `roster-screen.ts`) and `weekStartOf` (`roster-validation.ts`) **(default)**.
4. **Calendar date or business day.** Matching places a shift on the business day it starts in
   (changeover 06:00 by default). The rota versions and the labour checks place it on the CALENDAR
   date it starts (`shiftLocalDate`; `publishRoster` attaches by it). A shift starting between
   midnight and the changeover, say Monday 01:00, is matched on Sunday's business day but attached to
   Monday's week. **Settled in the plan (Task 6.1):** a rota week holds its roster version's shifts
   (and unattached shifts by calendar date), and places each on its business day; the Rota view
   always attaches a shift to the week it was filled in. A version's shift whose business day falls
   outside the week is listed under "Not in a slot" on the week's first or last day. The labour
   checks keep grouping by calendar date; that difference is accepted and tested.
5. **Swaps when a published week is changed** (owner, 2026-10-13: "just warn that one exists,
   because it may still be valid after the change"). "Change this week" moves every swap request
   still waiting for a decision onto the copy of its shift, and warns that the week has open
   requests; deleting or moving a shift that has one warns first. Decided swaps stay with the old
   shifts as history.
6. **Each person's running total** (owner, 2026-10-13: "we do need to keep a running total compared
   to the hours they should have worked … we need to incorporate annual leave into this count too").
   Hours clocked and rostered against the hours the person should have worked so far, with approved
   annual leave counted, and the yearly overtime cap judged against it. Built with A586, which
   becomes "Labour rules and hours balance per person", because "should have worked" depends on each
   person's agreement (yearly hours, reference period, which kinds of leave count) and worked hours
   come from clocking (A10). Until then the rota shows each person's week against their contract,
   and the other checks run over the week with a week either side.
7. **Counting staffing paint in a season's or special day's delete confirmation** needs a seam
   venue-service does not have; not built **(default: no count)**.
