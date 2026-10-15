# Opening hours rebuilt around seasons and special days

**Status:** design, 2026-10-11, backlog **A506**. The product rules come from the owner's backlog text
(`docs/backlog/service-periods.md`, section A506) and the nine mockups in
[`docs/backlog/mockups/a506-opening-hours-seasons/`](../../backlog/mockups/a506-opening-hours-seasons/),
which the owner agreed on 2026-10-11. Everything else here is the designer's choice: each one is
marked **(default)** where it applies, and section 16 lists them. Three of them are put to the owner
as questions; the default is built unless the owner answers otherwise. Behaviour below is the target
design, not a claim about what runs today. Section 2 records the code read on main `9f0121f2f`:
every pointer there was READ, none was run.

**What this replaces.** Where this document disagrees with an earlier one, this one wins:

- [Service times, departments, zones and prep stations](2026-10-07-service-times-departments-and-stations-design.md)
  (A366): section 9.2 (the Opening hours page) whole; section 7's named-day kinds and named-day
  hours; section 6's "closed times are set per day of the normal week and per named day"; the
  "Normal week" and "Named day" rows of section 3; and section 8's "deleting a period that a cell
  names warns first", which section 8 below replaces with what actually happens to the cell. Its
  section 9's opening line gains a fourth page, Periods.
- The backlog's two older Opening hours presentation entries, which the owner folded into A506
  (real-week headings; dated-save refusals), are settled in sections 10.2 and 10.6.

## 1. Why

One standard week does not fit a venue whose hours change with the season, and copying a week into
future dates would bury the special days among ordinary ones (owner, backlog A506).

## 2. The code today (read on main `9f0121f2f`)

All paths are under `packages/venue-service/src/` unless written in full. "Deleted with its parent"
below means the database removes the row when the row it points at is deleted (an `on delete
cascade` foreign key).

- **Storage.** A department has one week: `menu_day_timetables` holds a row per department per
  weekday (or per named day), and `menu_slots` holds its painted ranges, each naming a period
  (`schema/menus.ts`). A zone's closed times are `zone_closed_times`, per weekday or per named day
  (`schema/zone-closed-times.ts`). A named day is one row of `special_dates` with one date, a kind
  (`holiday` or `working_day`), an optional yearly repeat, an own-hours switch and a close-the-whole-
  venue switch (`schema/hours.ts`). These tables are in the venue-service migration set and
  classified `state` (`classification.ts`). Official public holidays are not stored; they come from
  the country pack's calendar, which today holds 2026 only, keyed per year
  (`packages/country-es/src/data/es-2026.ts:38`: a row's key is `${SOURCE}:${row}`, so a holiday has
  no key that carries into the next year).
- **How a date's hours are chosen.** `departmentDay` (`menu-timetable.ts:292`) picks ONE timetable
  for a date: none on a whole-venue closed day, the date's own when it has own hours and this
  department has one, else the weekday's (`timetableOn`, `menu-timetable.ts:339-348`). Zone closures
  repeat the rule (`zone-closed-times.ts:169`, `:210`). A named day's own hours are a COPY of the week
  made when its switch is turned on (`hours.ts:88-135`); later week edits never reach it.
- **That rule is written out at least six times on the server** — `departmentDay`,
  `zoneClosureDay` and `closedZoneIdsAt`, `calendarDays` (`hours.ts:358-367`),
  `stationServiceTimes` (`station-service-times.ts:133-150`), `findScheduleEndOffsetClash`
  (`period-end-offset.ts:60`) and `validateMenuTimetables` in `configuration-transfer.ts` — and five
  more times in the dashboard (`real-week.ts`, `opening-hours-week.ts`, `opening-hours-zone-week.ts`,
  `opening-hours-all.ts`, `opening-hours-day.ts`, under `packages/venue-service/src/dashboard/`).
- **Who reads hours** (followed from the storage up to each entry point): see section 12, which
  lists every reader and what it reads afterwards.
- **A named day's kind has three readers, not one.** The backlog's search found only the Calendar's
  colour (`named-days.ts`, the `tone` choice). The kind also decides the Calendar's local-holiday
  coverage line and whether the venue counts as a holiday source (`holidays.ts:161-201`), and
  `hours.ts:375` computes a colour from it that the named-days read then discards.
- **Deleting a period** is refused with `menu_period.in_use` while any painted range, past or
  future, names it (`deleteMenuPeriod`, `menu-timetable.ts:693-702`). Once allowed, its routing-cell
  lines are deleted with it (`schema/routing.ts:114-118`), and so are its staff menus and today's
  "keep open" extensions (`schema/period-extensions.ts:23-27`); the dashboard warns about the routing
  lines first.
- **Nothing in reporting reads hours**; reports read only the business-day start.

## 3. Words used here

| Word | Meaning |
| --- | --- |
| Season | A named stretch of the year, from its start date to the day before the next season's start. Repeats every year. |
| Season week | One department's seven days in one season, painted with periods. |
| Special day | A name over a list of dates, optionally repeating every year (on the same month and day, or, for a public holiday's date, wherever the holiday's name falls; section 5), with paint laid over the season. |
| Public holiday | A date from the official lists for the venue's address. It is a mark on the calendar, not a stored row; it becomes a special day only when someone edits it. |
| Ordinary date | A date that is in no special day. It follows its season's week. |
| Paint | A range on one day, in 15-minute steps, naming a period or Closed. |
| Painter | The full-screen editor for a season week or a special day. |
| Business day | Changeover to changeover (`locations.day_cutover`, 06:00 by default), as today: Friday's bar until 03:00 is Friday. |
| Day resolver | The one server function that works out what runs on a business day (section 6). |

## 4. Seasons

- **Every venue has seasons, four by default:** Winter from 1 December, Spring from 1 March, Summer
  from 1 June, Autumn from 1 September (the mockup's dates). Repeating every year is what a season
  is, not an option. Provisioning a venue creates them (section 11).
- **A season has a name and a start date only** (a day and a month); it ends the day before the next
  season starts. So the seasons always cover the whole year, with no gaps and no overlaps.
- **Moving a start date moves the neighbouring season's end.** The new dates hold for this year and
  later ones until changed again; there is no one-year-only exception (owner). The change takes
  effect at once, today included: a start moved to today changes what the till sells from the next
  request. Past days are not kept as they were, since nothing reads past hours (section 2). A start
  cannot be 29 February (not every year has it) and two seasons cannot start on the same day — both
  refused with `season.invalid` naming `startsOn` **(default)**.
- **Adding and removing seasons** **(default, confirmed by the owner 2026-10-11)**. "+ Season" asks for a name and a
  start date; the new season takes its days from the season they belonged to and starts with a COPY
  of that season's weeks, so no date's hours change until someone paints. Deleting a season gives its
  days to the season before it and deletes its weeks, after a confirmation naming the departments
  that had painted it. One season always remains. Renaming is in the same dialog as the start date
  (the chip's ✎).
- **Each season has its own week for each department**, painted as the week is today. The venue
  holds the seasons and no hours of its own (owner).
- **A date's season is decided by its business day**, never the clock date: the bar open until 03:00
  on the last night of Autumn is still Autumn at 02:00.

## 5. Special days

- **Two kinds** (owner): public holidays, from the official lists as today, and the venue's own
  special days. Today's own-holiday / working-day split goes, with the three readers in section 2;
  section 10.1 says what the Calendar shows instead.
- **One special day is a name over any number of dates** ("Christmas company dinners", 14–23
  December), optionally repeating every year (on the same month and day, or, for a public holiday's date, wherever the holiday's name falls; see below). Dates are added on a small calendar,
  singly or as ranges. Names need not be unique **(default)**: one-off "Viernes Santo" in 2026 and
  another in 2027 can both exist.
- **A date belongs to at most one special day.** Adding a date another special day already covers is
  refused with `special_day.date_taken`, naming the other special day **(default)**. A repeating
  special day covers its dates in its first year and every later year, never earlier ones (as
  `occurrenceIn` does today, `named-day-rules.ts:17`), so it collides with a one-off date only in
  those years. A repeating 29 February applies in leap years only **(default)**.
- **Each date has its own paint.** The editor shows one column per date (mockup 4), so 20 December
  can be closed while the 19th runs Lunch until 16:30. A repeating special day keeps each date's
  paint every year; the weekday changes, the paint does not.
- **The season shows through** (owner). Each date starts with its season's hours; what is painted on
  top replaces them for that stretch of time, and unpainted time keeps following the season. There
  is no "own hours" or "season's hours" switch. Worked example (owner): under Winter's Dinner
  20:00–23:30, painting Dinner 19:00–22:00 still leaves the season's Dinner until 23:30; painting
  Closed over 22:00–23:30 ends the night at 22:00.
- **The season shows through as it is now**: a special day stores only its own paint, never a copy
  of the season, so a later change to the season week reaches every special date at once. This
  replaces today's copy made when the own-hours switch is turned on (`hours.ts:88-135`).
- **Closed** (owner: "a date's Closed tick shuts all of it … closing Christmas Day is one tick").
  - **The Closed tick is one per date and closes the whole venue**: every department and zone,
    including a department added later. It is stored once per date, not per department. The tick
    sits under the date's heading in the painter whichever department is shown.
  - **Closing one department for a whole date** is done by painting Closed across that department's
    whole day.
  - **Closing part of a date** is painting Closed over that stretch.
- **A public holiday works the same way.** Clicking one opens the special-day painter pre-filled with
  the holiday's official name and its date, and saving creates a special day holding that date. When
  a special day of that name already exists, the dialog first offers to add the date to it (the
  control mockup 5 has). An unedited public holiday follows its season, as today.
- **"Every year" on a public holiday's date follows the holiday's official name** (owner,
  2026-10-11 ~22:45, question 2 answered (b)): "Every year follows the holiday's official name (for
  example "Viernes Santo") to wherever it falls in the next year's list", and "if the name changes
  then the holiday will be missing the following year. we should be able to warn in that case".
  - When a date is saved into a special day, the server records the official name of the public
    holiday on that date in the venue's own list for that year, if there is one (`holiday_name`,
    section 11). A date with no holiday name repeats on the same month and day, as above.
  - In a later year, a repeating date with a holiday name falls on the date the venue's list for
    that year gives a holiday of exactly that name. A fixed holiday (25 December) therefore keeps
    its date, and Good Friday moves with Easter.
  - When that year's list has no holiday of that name, or there is no list for that year yet, the
    date does not apply that year, and the venue is warned: the year view says, under its legend,
    "Viernes Santo (Every year) has no public holiday of that name in 2027", and the venue's
    readiness list carries the same line while the year is the current or next one **(default)**.
    Not applying is the default because the other choice, keeping the old month and day, would
    close or reshape an ordinary day the venue never chose **(default)**.
- **Drawing.** A date that is in a special day is drawn as a special day; if it is also a public
  holiday it keeps the public-holiday mark (mockup 2's 8 December is a public holiday whose hours
  were changed, drawn with the holiday's name in red) **(default)**. A year with no official list
  yet shows no public-holiday marks, and says so under the legend ("Public holidays for 2027 are not
  available yet") **(default)**.
- **Every change to a single date is a special day.** An ordinary date cannot be edited on its own:
  clicking it (mockup 5) says which season it follows and offers "Edit the Winter week", "Make this
  a special day…" and adding it to an existing special day.

## 6. What is open at a moment

The day resolver answers "what does department D (and zone Z) run on business day d". Every reader
in section 12 calls it; no other code, on the server or in the dashboard, works hours out itself.

1. Find the business day d and the minute from the changeover, as today (`serviceMomentAt`,
   `service-day.ts:111`; once A495 lands, its dated changeover).
2. Find d's season: the season with the latest start on or before d's day and month, wrapping from
   the last season of the year into the first.
3. Start from that season's week for D, on d's weekday. Unpainted time is closed (owner: no fallback
   period).
4. If d is a date of a special day: if its Closed tick is set, the whole venue is closed that day.
   Otherwise lay each range painted for D on that date over the day, replacing that stretch — a
   period range runs that period, a Closed range closes.
5. Join touching stretches of the same period into one range, so the season's Dinner 20:00–23:30
   under a painted Dinner 19:00–22:00 is one Dinner 19:00–23:30. This matters to A432's end offset
   (the minutes before or after a period's END when ordering stops), which counts from the joined end.
6. Zones (section 7) are worked out the same way from the zone's own season week and special-day
   paint, and are never open where the department is closed.

Everything today's resolver does around that choice stays:

- **The day before.** For a positive end offset that runs past the changeover, the resolver works
  out the previous business day on its own — its own season and its own special day — not by
  reusing today's.
- **Ranges and the changeover.** A range cannot cross the changeover, and an end equal to the
  changeover is the full day.
- **Extensions.** "Keep Lunch open until 14:30 today" applies on top of the resolved day, as today.
- **Clock changes.** A time the clocks skip is refused on save for a dated day. Today that check
  (`clockTimeSkipped`, `service-day.ts:168`) runs when a named date's hours are saved (for a
  repeating one, its next occurrence, `menu-timetable.ts:762`), when a named date is moved or
  duplicated, on configuration import, and for a "keep open" end time. It now runs on every
  special-day date's paint (a repeating one's next occurrence) and still on keep-open and import.
  Nothing refuses a skipped time in a season week, which has no date, as today for the week. The
  resolver compares the wall-clock reading with the stored times (`serviceMomentAt` and
  `rangeInForce`, `service-day.ts:114-135`), so a range starting or ending at a skipped time starts
  or ends when the clocks jump (a probe on the night of 29 March 2026, Europe/Madrid, during this
  spec's review showed exactly that).

**The end-offset check runs on resolved days.** A432's check today pairs each weekday with the next,
and each named date with its neighbours (`period-end-offset.ts:60-103`). It now checks, AS RESOLVED
(the season with any special-day paint laid over it):

- each season's seven weekday-to-next-weekday pairs;
- at each season boundary, the seven pairs from the last day of one season, on each weekday, to the
  first day of the next;
- each one-off special date with the day before and the day after;
- each repeating special date under each of the seven weekdays it can fall on, with its neighbours.

It runs on every hours save, and again when a season is added, deleted or moved, since each of those
changes which week a date lies under. A refusal names the season or the special day and date.

## 7. Zones

- A zone follows its department except where it is marked closed, as today (owner).
- A zone's closed times are per season week, painted in the season painter with the zone chosen in
  the department picker ("Dining room and Terrace follow Restaurant", mockup 3): the department's
  periods drawn faded, and Closed to paint.
- On a special day the zone's season closures show through like the department's hours. The zone's
  paint row there has Closed and **"Open"**, so a special day can open a zone its season week keeps
  closed. "Open" still cannot open a zone while its department is closed **(default)**.
- The Departments and zones page's one-line summary of a zone's closed times
  (`dashboard/department-zones.ts:349-400`) summarises the CURRENT season's week, naming the season
  ("Winter: closed after 23:30 Mon–Thu") **(default)**, and its link opens the season painter on that
  zone.

## 8. Periods

- **A page of their own**, under Venue operations beside Opening hours (owner, mockup 6): one list,
  periods grouped under their department as A493 groups zones, with columns Period (colour and
  name), Customer menu, Staff-only menus, Floor plan (greyed until A504) and Painted in.
- **Painted in** lists the seasons and special days whose paint names the period, each opening that
  editor. A special day is listed when it has a date today or later, or repeats **(default)**; past
  one-off special days are not. A period painted nowhere shows "Not painted anywhere", since nothing
  will sell its menu. Row ⋮: Edit, Open in Opening hours, Delete.
- **One period dialog**, opened from the page and from the painter (mockup 7): name, colour, customer
  menu (with what it includes), staff-only menus, floor plan (from A504) and Painted in. Save stays
  quiet until the draft changes (CLAUDE.md §3, A331). From the painter, "+ New period" opens it as
  "Add and paint with it" (mockup 9) and ✎ on a paint chip opens it to edit; a period saves when its
  dialog saves, separately from the painter's Save, because the Periods page and the till use it at
  once (owner). The painter's unsaved painting stays underneath.
- **Deleting a period that is in use** (mockup 8) says where it is painted — the number of seasons
  and of special days, counted as Painted in counts them — and which routing cells name it, and
  offers a period of the same department to take its place:
  - **Without a replacement:** its painted time becomes closed in the seasons, and the season shows
    through on special days (owner, mockup 8). Its routing-cell lines go, so the cell's "Any other
    time" station takes that time (owner, 2026-10-13, A578). A "keep open" extension of it for today ends, and
    the dialog says so when one exists.
  - **With a replacement:** every painted range of it becomes the replacement (touching stretches
    of the replacement then join); each routing-cell line naming it is deleted, as without a
    replacement (owner; changed 2026-10-13, A578); and today's "keep open" extension moves to the
    replacement **(default)**.
  - Past one-off special days' paint is changed the same way. They are not counted in the dialog,
    as nothing reads past hours (section 2).
  - This replaces today's refusal, `menu_period.in_use`, which is retired. The delete, the repaint,
    the routing change and the extension change are one transaction.

## 9. Prep station times

A station still has no hours to set: it is open whenever something it makes can be ordered (2026-10-07
spec, section 8). The read-only view moves to **a fourth Prep stations tab, "Times", with a station picker at
the top, showing the chosen station's month view of section 10.2: one bar per day, ‹ › to step
months** (owner, 2026-10-11 ~22:50, question 3 answered (c) — not the row menu and not a picker on
Opening hours). It answers "what are the kitchen's times three
weeks from now" for any date, seasons and special days included, where the old view showed the
normal week or one real week. It is worked out on the server from the day resolver and routing.
Lane C's A507 is rebuilding the same page (it moves the row menu to its own column on the right and
the timings into the station dialog), so the slice that adds Times builds on A507 as landed.

**2026-10-14 (A688):** a station more than one department feeds draws one track per department on
each date, in department order, under a Rows key; see the A688 decision in docs/backlog/kitchen.md.

## 10. Dashboard

The Venue operations menu holds Departments (and zones), Opening hours, Periods and Prep stations.
Nothing on them shows live state.

### 10.1 Opening hours: the year (mockup 1)

- The page opens on a year, ‹ › stepping years. Days are coloured by season; public holidays,
  special days and closed days are marked (legend: Public holiday, Special day, Closed). A date is
  drawn "closed" when the whole venue is closed on it (its Closed tick) or every department is
  closed all day.
- Season chips show each range and edit its name and start (✎); "+ Special day" opens the
  special-day painter on an empty special day.
- Without the named day's kind, the Calendar's local-holiday line becomes one sentence for a venue
  whose official list has no local holidays: "Town holidays are not in the official lists — add them
  as special days." **(default)**. The venue no longer counts as a holiday source (section 2).
- Clicking a month opens the month.

### 10.2 Opening hours: the month (mockup 2)

- Each day shows its hours as a bar per department, with "‹ year" back and ‹ › stepping months. It
  replaces the Day tab and the Real week switch.
- The department picker offers All departments (a bar per department) or one department (a bar for
  it and one per zone, the zone's closed time drawn as a gap) **(default)**. That is what remains of
  the old All departments view (the backlog's open point), and it is enough because the month shows
  every department side by side for any date, seasons and special days applied.
- Season chips for the seasons the month touches; special-day names and "closed" on their dates.
- **Real-week headings, from the older backlog entry:** a date heading never repeats its weekday
  (the column heading carries it), and the date and the Today marker stay readable in EN/ES, both
  themes, at 1280 and 390 px.
- Clicking a date opens: the special-day painter on its special day; for a public holiday not yet
  in a special day, the painter pre-filled as section 5 says; for an ordinary date, mockup 5's dialog.

### 10.3 The painter (both editors; mockups 3, 4, 9)

All of the owner's painter text in backlog A506 applies as written; in short:

- Full screen, one bar holding close, what is being edited, the season or department picker, and
  Cancel and Save, which stay visible however the grid scrolls. The bar links to the Periods page;
  leaving with unsaved painting asks first (`draftScopeFor`, CLAUDE.md §3). Save stays quiet until
  the draft changes (A331).
- One row of periods to paint with, plus Closed and "+ New period"; each chip has ✎. Choose one,
  drag down a column. 15 minutes is a thin row (about 5 px), so most of a day fits on a laptop
  screen; the grid scrolls by itself while a drag passes its top or bottom edge.
- Dragging over an existing block replaces that stretch. Two touching stretches of the same period
  are stored and drawn as one block. Click a block to change its period or Delete it (Backspace
  too): on a special day the season then shows through; in a season week the time becomes closed.
- Each column's ⋮ has "Copy to…" (ticking several days or dates) and Clear; the day name and its ⋮
  share one line.
- **One draft per painter, across departments and zones** **(default)**: switching the picker keeps
  what was painted for the department left, and Save sends every edited department and zone of
  this season (or special day) in one request, written in one transaction. A refusal never loses
  the draft.

### 10.4 The special-day painter (mockup 4)

- One column per date instead of Monday to Sunday; the season's hours drawn faded under the paint.
- A side panel: Name (required), Dates (chips; "+ Add dates…" opens a small calendar for single
  dates or ranges), Every year (No / Yes), and the "season shows through" explanation.
- Each date has its Closed tick under its heading (the whole venue, section 5).
- Delete (in the bar) deletes the special day: its dates follow their seasons again.
- **Saving keeps what was not edited.** The save compares the date list by value: it adds the dates
  added, removes the dates removed, and leaves every other date's row and paint alone. A
  department's or zone's paint is replaced only when the draft edited it. Rewriting a date that
  stays would delete every department's paint on it, because paint is deleted with its date.

### 10.5 The Periods page and dialog

Section 8; mockups 6–9.

### 10.6 Refusals (from the older backlog entry)

A refusal naming no field, on an editor saving several dates or days at once, shows only beside the
action that failed — the painter's Save — and keeps its retry and the draft. A refusal naming a
date or a day (`date`, `weekday`) also shows on that column's heading. Today one general refusal is
drawn beside every date's Save (`opening-hours-week.ts:356-371`, `opening-hours-zone-week.ts:291-309`).
The painter has one Save, and a test pins both cases.

## 11. Storage

All new tables are in the venue-service migration set, classified `state`.

| Table | Holds |
| --- | --- |
| `seasons` | id, location, name, `starts_on` (`MM-DD`, never `02-29`). Unique (location, starts_on) and (location, name). |
| `special_days` | id, location, name, `repeats_yearly`. |
| `special_day_dates` | id, special day (deleted with it), location, `date` (`YYYY-MM-DD`), `closed_all_day` (the whole-venue tick), `holiday_name` (the official name of the public holiday on `date` when saved, or none; added by slice 2's migration, section 5). Unique (location, date); the repeat collision of section 5 is checked in code, as the database cannot express it. |
| `department_days` | id, department (deleted with it), and EITHER season (deleted with it) and weekday OR special-day date (deleted with it). One row per (department, season, weekday) and per (department, special-day date). |
| `department_day_ranges` | id, day (deleted with it), period (or none for Closed — Closed only on special-day dates), starts_at, ends_at, on 15-minute steps. Touching ranges of the same period are joined on write. |
| `zone_days` / `zone_day_ranges` | The same for a zone: per season and weekday, or per special-day date; a range is `closed`, or `open` on special-day dates only. |

- `menu_periods` is unchanged. A range's period key is NOT deleted with its period, as `menu_slots`'
  is not today: deleting a period goes through section 8's repaint first.
- The old `menu_day_timetables`, `menu_slots`, `zone_closed_times` and `special_dates` go, with every
  reader (section 12). `holiday_geographies` and the official lists are unchanged.
- Every foreign key and unique index is declared in the TypeScript schema (CLAUDE.md §3). The plan
  lists the foreign keys pointing at each dropped table before dropping it: a drop with foreign keys
  on deletes the rows of children set to be deleted with it and fails on other children holding rows.
  The review of this spec read the schema and found none of the second kind pointing at these four
  tables from outside them (read, not run).
- **Provisioning creates the four default seasons** for every new venue, unconditionally, and the
  new department's "Open" period is painted into all four (section 12). Configuration import
  replaces the venue's seasons and special days with the exported ones.

**Migration: venues reset (owner).** The owner's text says "Pre-live, so venues reset rather than
carry today's hours across", and CLAUDE.md §3 forbids data-migration code before go-live. So the
migration creates the new tables and drops the old ones, and carries nothing. A box that upgrades
without a reset has no seasons and is closed until reset or re-provisioned; the PR's first line says
so, and the demo venue is rebuilt with `wa-wt reset demo`. The migration-upgrade test may gain
sample values for the new tables (owner rule of 2026-10-11 in lane A's queue).

## 12. Every reader moves

| Reader today | After |
| --- | --- |
| `departmentDay`, `resolveDepartmentService`, `resolveDefaultMenu`, `routingAt` (the sale path: whether a basket's dishes may be ordered now in `apps/server/src/working-order.ts`, a zone's offers and the till's menu state in `operations.ts`) | The day resolver (section 6). |
| `zoneClosureDay`, `closedZoneIdsAt`, `assertZoneTakesNewOrders`, `readZoneKeepOpenState` (starting, moving and transferring orders; `GET /api/zones`) | The day resolver's zone answer. |
| `keep-open.ts` (`readKeepOpen`, `keepPeriodOpen`, `keepZoneOpen`) | The resolved day; extensions unchanged. |
| `findScheduleEndOffsetClash`, `endOffsetClash`, `assertPeriodEndOffsets` (`apps/server/src/venue-details.ts:244`) | Resolved days, the set in section 6. |
| `stationServiceTimes` | The day resolver per date, for the Times view (section 9). |
| `inPeriodOrder` (`routing-periods.ts`), reached from the routing grid, the routing preview and `stationDestinations` in `station-times.ts` | Earliest start across every season's weeks **(default)**. |
| `listVenueReadiness`'s `department.no_periods` | Raised when the department has no painted range in any season week **(default)**. |
| `readOpeningHoursModel`, `readNamedDaysModel`, `readCalendarDays`, `readHolidays` | A year and month read from the resolver, plus the seasons, special days and public holidays. |
| Named-day copy and duplicate: `switchNamedDayHours` (`hours.ts:88`), `duplicateSpecialDate` (`hours.ts:271`), `duplicateHolidayNamedSpecialDates` (`holidays.ts:283`), `POST …/special-dates/:id/duplicate` (`routes.ts:407`), and the calendar hooks `SpecialDateParticipant` / `MENU_TIMETABLE_CALENDAR_PARTICIPANT` (`menu-timetable.ts:807`) | Gone. A special day has no own-hours copy, and "duplicate to next year" is "Every year" or adding a date. |
| `placeOpenPeriod` (`provisioning.ts:105`, `operations.ts:205`), `apps/server/src/setup-opening-hours.ts` | Paints "Open" Monday–Friday 09:00–17:00 into every season; the setup check recognises that shape in all four. |
| `configuration-transfer.ts` | Exports and imports seasons, special days and their paint; validation calls the resolver's checks, not a copy of them. |
| Demo seed (`apps/server/scripts/demo-seed/seed-floor.ts`, `seed.ts`) | Seasons and special days. |
| `apps/server/src/testing/clear-provision-fixture.ts` | Lists the new tables instead of the old. |
| `scripts/schema-constraints.test.ts` (pins the old tables' foreign keys and unique indexes) | Pins the new ones. Under the lane rule a changed guard under `scripts/` is asked of the owner before it changes. |
| The venue-service contract (`VenueServiceContribution`, `packages/module/src/module.ts:522`; the seat `VENUE_SERVICE` is in `apps/server/src/modules.ts`), which carries `closedZoneIdsAt`, `resolveDepartmentService`, `routingAt` and `resolveDefaultMenu` | Changes with them — a cross-package contract, so the full review path. |
| Live-query dependency lists (`dashboard/live-queries.ts`, `apps/dashboard/src/api/live-queries.ts`) | Name the new tables wherever hours are read, including `routing`, whose period order now depends on them. |
| The five dashboard copies of the layering | Gone: the dashboard draws answers the server worked out. |
| `dashboard/department-zones.ts` zone summary (`:349-400`) | Section 7. |
| Links into today's tabs: `department-zones.ts:461` (a zone's week), `departments-list.ts:76` and `department-page.ts:94` (readiness "set up periods"), `station-table.ts:78` (a station's week), `apps/setup/src/screens/done-screen.ts:187` | Zone → the season painter on that zone; readiness → the Periods page; station → its Times view; setup Done → the Opening hours year. |

**2026-10-12 (A506-1):** `GET /api/zones` now reads through one seat, `readZoneClosingStates`
(`packages/module/src/module.ts`), which answers each zone's closed state and closing summary
together; see the plan's Task 1.5 note.

The plan re-runs this follow-the-call-chain search on the base it is written from, since other lanes
are changing these files now (section 15).

## 13. Routes and permissions

The management routes stay under the existing Opening hours permissions; the plan names each. In
outline: read a year or a month (resolved days per department and zone, seasons, special days,
public holidays); save a season (name, start); add and delete a season; save a season's weeks (every
edited department and zone, one request); create, save and delete a special day (name, dates,
repeat, Closed ticks, and each edited department's and zone's paint per date, one request); the
period routes gain the Painted-in read and delete-with-replacement.

Error codes follow the domain-concept rule (CLAUDE.md §3). New: `season.invalid`,
`season.not_found`, `special_day.invalid`, `special_day.not_found`, `special_day.date_taken`.
Retired with the old model: `special_date.date_taken`, `special_date.keeps_week`,
`special_date.not_found`, `menu_period.in_use`. `menu_timetable.invalid`, `zone_closed_time.invalid`
and `hours.invalid` stay if the plan finds the new routes still refuse those shapes, else go; each
change runs `scripts/alert-codes.test.ts` and `scripts/errors-reachable.test.ts`.

## 14. Testing

- **Real-database tests of the resolver** (`useVenueDb`). The season-boundary test is built so each
  wrong answer looks different from the right one. It uses 2030, where 30 November, Autumn's last
  day, is a Saturday (checked with `date`). Autumn's Saturday has Dinner 20:00–02:00; Winter's
  Saturday has Late bar 20:00–02:00; Winter's Sunday is closed until 09:00. At 00:15 on Sunday
  1 December by the clock, the right answer (business day Saturday 30 November, in Autumn) is
  Dinner. Choosing the season by the clock date gives Winter's Saturday's Late bar; choosing the
  weekday by the clock date as well gives closed. The test prints the period it got, so a failure
  names which wrong rule ran.
- Across midnight with a special day on the first night only; a repeating special day in its second
  year and before its first; 29 February; a season start moved while a special date lies under it;
  and the owner's worked example (Dinner 19:00–22:00 over Winter's 20:00–23:30, then Closed over
  22:00–23:30).
- **Through the till routes**, not only the function. Pricing reads no hours (it passes
  `withDefault: false` to `listZoneOffers`, `apps/server/src/working-order.ts`); what the hours decide
  at the till is whether a dish may be ordered now, refused with `menu_period.not_running`
  (`apps/server/src/till-api.service-periods.test.ts` pins it today). So at 00:15 on that night a
  dish from Autumn's Dinner menu is accepted, and a dish only Winter's Late bar offers is refused
  with that code.
- Saving a special day that edited only Restaurant leaves Bar's paint on every date unchanged.
- Deleting a period, with and without a replacement: painted ranges, special-day paint, routing
  lines and today's extension afterwards, each asserted by value; refusals asserted by code.
- The end-offset check across each of section 6's pairs, including a season added, deleted and
  moved.
- Browser tests for the painter (drag, replace, join, Copy to…, the Closed tick, the draft kept
  across the picker, Save quiet until a change, the unsaved-leave question) and the refusals of
  section 10.6; LOOK checks EN/ES, both themes, 390 and 1280 px, for every screen.

## 15. Build order (the plan cuts these finer)

Each slice leaves `main` green and working on its own. Building waits for other lanes' branches that
change the same files to land first:

- A495 (`feat/a495-business-day-history`, lane D) changes `menu-timetable.ts`, `zone-closed-times.ts`,
  `hours.ts`, `named-days.ts`, `holidays.ts`, `routes.ts`, `keep-open.ts` and
  `station-service-times.ts`: no slice touching those starts until A495 lands.
- A494 (`feat/a494-venue-settings-page`) and A507 (prep stations, lane C) are checked the same way
  (`git diff --stat main...<branch>`) before each slice.

The order:

1. **Seasons, on the server and under the existing screens.** Storage for seasons and season weeks
   (venues reset), provisioning's four seasons, the day resolver's season step, and every reader in
   section 12 that reads "the week" — including the named-day own-hours copy and duplicate, the
   end-offset fallback, `stationServiceTimes`, `calendarDays` and the five dashboard copies, which
   each read the date's season. The existing Week tab gains a season picker so `main` keeps working.
   The plan splits this into several pull requests (server storage and resolver; the server readers;
   the dashboard readers), each well under one implementer's limit.
2. **Special days replace named days.** Storage, laying special-day paint over the season, the
   whole-venue Closed tick, the end-offset set of section 6, configuration transfer, and the retired
   copy and duplicate code; the existing Calendar edits the new shape. Named days dropped.
3. **The year and month views** (10.1, 10.2), replacing the Day tab and Real week.
4. **The full-screen painters** (10.3, 10.4), replacing the Week tab; refusals (10.6); the links of
   section 12 re-pointed.
5. **The Periods page and dialog**, and deleting with a replacement (section 8).
6. **The station Times view** (section 9), after A507 lands, and removing what is left of the old
   tabs.

Slices 1, 2 and 5 change what the till sells, change storage or change a cross-package contract,
so each takes the full review path (CLAUDE.md's risk triggers); 3, 4 and 6 take it where they touch
those too.

## 16. Defaults, and the owner's questions

Asked of the owner in lane A's `questions.md`, each with a worked example; all three answered
2026-10-11 (~22:45 and ~22:50):

1. Seasons can be added and removed; a new season copies the weeks of the season it splits
   (section 4). Answered: the default.
2. "Every year" on a public holiday's special day follows the holiday's official name, with a
   warning when a year's list has no holiday of that name (section 5). Answered (b), with the
   warning added by the owner; where the warning shows and what happens when a year has no list
   are defaults.
3. Prep station times are a fourth Prep stations tab, "Times", with a station picker (section 9).
   Answered (c).

Settled by the owner's own words, after the review of this spec: the whole-venue Closed tick
(section 5), and venues reset rather than carrying hours across (section 11).

Smaller defaults, stated where they apply and not asked: `season.invalid` for 29 February or a
shared start; a start's change takes effect at once; 29 February repeats only in leap years; one
special day per date; special-day names need not be unique; a holiday's edits drawn with its mark;
the "not available yet" line for a year with no official list; skipped clock times in season weeks;
the zone's "Open" paint on special days; the zone summary's current season; Painted in lists only
special days still to come or repeating; extensions on delete; one painter draft
across departments; the month's picker; period order and readiness across all seasons; the
Calendar's local-holiday sentence.

## 17. Later work, not in this design

- A504's floor plan per period (the Periods page and dialog show its column greyed until it lands).
- A495's dated business-day start: whatever check A495 lands with for "a change would reinterpret
  an existing range" must read the season weeks and special-day paint; the slice that moves the
  readers moves that check too.
