# Service periods, opening hours and departments — detail

The open entries are listed in [the backlog](../backlog.md), under "Service periods, opening hours and departments". This file holds
their full text.

## Refresh service settings on an open till

A till already signed in keeps its loaded payment flow when a department or zone policy changes.
Its menu-state poll does not carry the policy, and reloading offers after a menu change still
keeps that flow. A fresh sign-in reads the changed policy. Decide when an empty till should adopt
new settings and how an existing basket keeps its recorded facts, then update the poll and its
consumer. Left open by A366 slice 6 Part A; the branch's real-route and browser probes are in
its review receipts. This entry does not establish when the behavior began.

## Split an order's recorded service mode into two facts

The owner requested this future change on 2026-10-09 while answering slice 6 decision 4.
`order_service_contexts.service_mode` combines where service happens and when payment is due.
Replace it later with two plain facts: served-at (`table/counter`) and payment-due
(`before-kitchen/collection/end-tab`). The split is outside slice 6: keep its existing three
modes (`table_tab/prepay/ticket_then_pay`), recorded orders and till behaviour unchanged there.

Trace the writer/snapshot and every reader before choosing the replacement contract. Cited
readers at the slice 6 audited base `87b46b024fcac68a6240949964768b9fbc7d4972`:
`apps/server/src/till-sale.ts:1548` (payment dispatch), `apps/server/src/receipt-print.ts:216`
(collection ticket at payment), `apps/server/src/working-order.ts:3111-3128`
(`serviceModesMatch`) and `apps/server/src/move-bill.ts:245` (table-mode check). Also trace
venue-service's record/retarget/read context functions and the till API/client/order-flow
readers listed in slice 6 decision 4. These are source pointers, not a runtime receipt or
an exhaustive future implementation plan. Preserve payment, money/VAT, hashes, drawer and
login behaviour; decide the future schema/contract and test it separately.

## Who authorised today's station or period change

The approved [slice 3 plan](../superpowers/plans/2026-10-08-a366-slice-3-station-controls.md)
leaves the authorising person unstored (decision 14). The station-day and period-extension rows
hold the choice, but no person ID. Decide whether to retain that identity before adding a history
view; this is separate from checking the manager's permission and PIN before a write.

## Sending grace when a period extension is replaced or expires

Decide whether a positive end offset should keep an earlier period's dishes sendable after you
extend another period, and after an extended last period reaches the business-day changeover.
The approved slice 3 decision 4 keeps one extension per department and day, replaces that row,
and reads only today's extension. Two real-store probes on 2026-10-09 observed the resulting
limit: Lunch extended to 14:45 with a +15-minute offset was sendable at 14:50 before extending
Afternoon, then was not; a night period extended to 06:00 was sendable at 05:59, then was not
at 06:05 despite its +15-minute offset. These probes measured the current behavior; they do not
settle which behavior you want. Retaining an earlier or yesterday's effective end needs a decision
about the row's meaning and cleanup before changing the reader or writer.

## Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly implemented through A261

Tabs without tables and the remaining department-name survey stay open. Re-check the advisor
questions in [the earlier spec](../superpowers/specs/2026-10-03-departments-service-styles-hours-design.md)
and the compliance question list before carrying them forward. A366 supersedes its service-style
and hours proposals; the historical spec keeps its dated pointers.

## Smaller notes from the Hours reviews

- Smaller notes: nothing pins which of two repeated midnights a clock change picks. The separate Hours client's
  read-window and lifecycle notes and station-cell checks are retired with that page (slice 4 Part B).

## Province edits in Venue details

- **Province edits in Venue details.** `apps/server/src/venue-details.ts` still refuses every
  province change (`geography_context` before sales). The step 7 plan allowed a change keeping
  the same derived context, holiday region included, once a sourced province-to-region map
  existed; step 6 ships that map (`packages/country-es/src/data/regions.ts`). Allowing it is a
  separate decision; nothing in step 6 changes it.

## Smaller notes from the public holidays reviews

- **Smaller notes from the reviews:** there is no control to clear a chosen area back to "not
  chosen" (the route accepts it); the area names "Arán" and "Lleida, fuera del territorio de
  Arán" are Spanish data labels shown untranslated in English.

## A506. Opening hours rebuilt around seasons and special days

**A506 (owner, 2026-10-11) — OPEN.** Agreed with the owner over mockups. Spec (2026-10-11; the owner's three questions answered the same evening):
[opening hours seasons design](../superpowers/specs/2026-10-11-opening-hours-seasons-design.md). Supersedes
section 9.2, and the named-day hours of section 7, of
[the 2026-10-07 service times spec](../superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md).
Pre-live, so venues reset rather than carry today's hours across (CLAUDE.md §3).

**Progress.** A506-1: seasons and per-season department and zone weeks are stored, the
till sells and closes by the business day's season, and a configuration transfer carries and
checks them. Special days are not written yet. A506-2: every server reader reads the season tables,
and nothing writes the old weekday rows of `menu_day_timetables`, `menu_slots` or `zone_closed_times`.
A506-3: the two week routes save one named season; the Week tab has a season picker, and the Day tab
and every real week draw each date's own season; the Business day start dialog names the season of
each conflict in a season's week.
A506-4 landed in #1597: special days are stored and saved through the API, the till sells and
closes by their paint, end-offset and changeover checks read them, and a configuration transfer
carries and checks them; the dashboard shows none of their paint until A506-5.
A506-3b landed in #1599: the zone editor's closed-times summary reads the current season's week
and names the season; a zone's single `week` left the Opening hours model.
A506-5 landed in #1603: the Calendar edits special days through the special-day dialog; named
days, the venue as a holiday source and the four old hours tables (`special_dates`,
`menu_day_timetables`, `menu_slots`, `zone_closed_times`) are gone.
A506-10 landed in #1607: a period in use can be deleted through the API, with another period of
its department taking over its paint, routing lines and keep-open extensions, or with none; two
reads list where each period is painted and what the delete dialog shows (one-off special days with
no date still to come left out). The Periods page that uses
them is A506-11, and the old refusing delete stays until then.
A506-6 landed in #1609: seasons are added, renamed, moved and deleted from the season chips and
their dialog (+ Season), and a move or a deletion is refused when a period's end offset would
run into the next day's hours; Opening hours opens on the Year, which replaced the Calendar
tab, and setup's Done link opens it.
A506-7 landed in #1623: a month view, reached from the Year, draws each date's hours as a bar per
department and opens a dialog on an ordinary date; it replaced the Day tab and the Real week
switch, and the dashboard's dated week views went.
A506-8 landed in #1634: a full-screen season painter edits one season's week for every department
and zone, saving the edited weeks in one request; it replaced the Week tab's editors, and opens
from a season chip, an ordinary date and a zone's Opening hours link.
A506-9 (#1651): the special-day painter replaces the special-day dialog and the per-date editor; it
edits one special day's name, dates, Every year and each date's department and zone paint in a
full-screen painter with its own address, opens from the Year, the month and an ordinary date, and
saves only the paint the draft changed. An old `/view/date` address opens the month instead.

**Left open by A506-1, for the later parts.**
- No test yet gives a second department its own paint on the same special day.

**Left open by A506-3, for the later parts.**
- With no season in the address, the All departments week left open across a season change keeps
  showing the old season (the picker names it) until the address changes. The season painter always
  writes its season into the address. Read in the code (`resolveSeason`, `opening-hours-screen.ts`),
  not run since A506-8.
- The Business day start dialog works out its conflict count by repeating the server's rule for
  counting a conflict once whatever its season (`rangeKey`,
  `apps/dashboard/src/screens/business-day-start-editor.ts`), so a change to that rule on the server
  would make the dialog miscount without any test noticing. The server could return how many conflicts
  it left off its list instead, which adds a field to the shared preview type.
- A venue with no seasons cannot edit a week from the dashboard: since A506-8 the season painter
  draws nothing without a season (read in `season-painter.ts`'s render, not run). Provisioning gives
  every venue four seasons, and deleting the last one is refused (`season.invalid`, reason `last`,
  `deleteSeason` in `packages/venue-service/src/seasons.ts`), so this is believed unreachable — read in
  the code, not run.

**Left open by A506-4, for the later parts.**
- The Periods tab's "Placed on" column counts season weeks only, so a period placed only on a special
  day reads "Not placed". A506-11 rebuilds that page.
- A business-day changeover conflict reports "Invalid or overlapping range" before "Range crosses the
  new start" (`packages/venue-service/src/business-day-schedule.ts`, season lines too).
- A special-day line in the Business day start dialog shows its date unformatted ("2026-11-03").
- `assertOwnPeriods` and `skippedSlot` in `packages/venue-service/src/menu-timetable.ts` name a refused
  slot by its sorted position, not its position in the request (read in the code, not run).
- The clock-skip check runs before touching ranges are joined: two halves of one period meeting at a
  skipped 02:30 are refused, while the joined range is accepted.
- With named days gone (A506-5), the rule "special day, then season" is still written out in
  `day-resolver.ts` (twice, for departments and for zones), `business-day-schedule.ts` and
  `period-end-offset.ts`, and the end-offset check relies on list order for it; special-day paint is
  read by four separately written queries in `special-days.ts` and `business-day-schedule.ts`;
  `specialDateIn` and `sharedSpecialDate` live in the database module `special-days.ts` rather than
  the browser-safe repeat rules, which leaves import loops with `business-day-schedule.ts` and
  `menu-timetable.ts`. Each could collapse to one place.
- `business-day-schedule.ts` copies the changeover lookup of `packages/shared/src/business-day-clock.ts`
  (`oldCutoverOn`) to avoid validating the clock on every day; a lookup exported from `shared` that
  validates once would remove the copy.

**Left open by A506-5, for the later parts.**
- The zone editor's closed-times summary uses its sentences without a season name
  (`venue.zone_closed_days`, `venue.zone_closed_summary`, and `venue.zone_open_with_department`)
  only when the venue has no seasons at all: `zoneClosedWeek`
  (`packages/venue-service/src/dashboard/zone-closed-week.ts`) picks them when neither the current
  season nor a first season exists. Provisioning gives every venue four seasons, and deleting the
  last one is refused (`season.invalid`, reason `last`, `deleteSeason` in
  `packages/venue-service/src/seasons.ts`), so this is believed unreachable — read in the code, not
  run; no test names those keys.
- A department or zone delete's preview never counts a special day's painted hours, yet the delete
  removes them: `readServiceDeleteSettings` (`packages/venue-service/src/service-delete-settings.ts`) counts
  only `department_days` and `zone_days` rows that have a season, while
  `clearServiceDeleteSettings` deletes all of the department's `department_days` and the zones'
  `zone_days`, special-day rows included. The season-only count predates A506-5 (it came with A506-1,
  #1577; special-day paint was first written in A506-4); until A506-5 the preview's timetable, slot and
  closed-time lines at least counted the old named-day hours, so now it discloses no dated hours at
  all.
- Two special days can come to share a date after both were saved — two repeating ones, or a
  one-off and a repeating date that follows a holiday's name: a save compares dates only in the
  years whose holiday lists exist then, so "Good Friday" (every year, saved on a
  public holiday) and "Fair" (every year, 26 March) both save while only 2026's list ships; when
  2027's list puts Viernes Santo on 26 March, every reader gives the day to the date standing there
  on its own terms (a one-off, one repeating on its month and day, or one following a holiday's
  name in the year it was saved) over one only following a
  holiday's name there (`standingInYear`, `packages/venue-service/src/repeat-rules.ts`; the same
  holds when a holiday-area change moves the holiday), the readiness list says nothing,
  and every later save of either day that keeps its clashing date is refused with
  `special_day.date_taken`. Shown by the
  A506-5 finish-branch review with the two rows inserted as a 2026-only save stores them. A
  configuration import reaches the same state another way: it compares a holiday-following date
  in its first year only (`NO_HOLIDAY_DATES`, `packages/venue-service/src/configuration-transfer.ts`).
  Wanted: a readiness line for such a clash, whichever kinds of date meet, in the current or next
  year.
- The readiness line for a repeating holiday date with no match names the stored official holiday
  name ("Natividad del Señor"), not the special day's own ("Christmas Day"), and says "no public
  holiday of that name" when the cause is that the year's whole list has not shipped yet.
  The Year's missing-holiday warning (`#warnings`,
  `packages/venue-service/src/dashboard/opening-hours-year.ts`) uses the same sentence and the same
  name, though its read carries the special day's own `name`; a fix covers both.
- Once a stored holiday date's year has passed, each order's service-state read (`readServiceDayPlan`)
  also reads the tenant, location and holiday area to find that year's holiday: about 100 µs of
  roughly 860 µs per call, measured over 2000 calls on a Madrid test venue during the A506-5
  finish-branch review. One way to remove it is a cache that outlives the transaction.
- The "Add to" offer reads every special day with every date (`GET …/special-days`) to show a name
  and a latest date.

**Left open by A506-9, for the later parts.**
- A special day whose dates start their business day at different times is painted on one grid
  drawn from the first date's changeover, with a notice saying so (ruling R1 of A506-9), so the
  other dates' columns start their day at the first date's changeover rather than their own
  (`cutover`, `special-day-painter.ts`).
- `GET …/named-days` (`readSpecialDaysModel`, `named-days.ts`) has no dashboard caller since the
  per-date editor went; server suites still pin it. Remove it, or keep it with a stated reason.
- `range-dialog.ts` (`<range-dialog>`, with its repeated-time note) has no caller since the
  per-date editor went; only its own tests and `dated-clock-grid.test.ts` load it.
- The end-offset check accepts a period whose cutoff runs past the changeover: A506-9's LOOK saved
  Late 00:30–03:00 with a 180-minute offset, a cutoff of 06:00 past a 05:00 changeover. The check
  compares a cutoff only with the start of the next period (`findEndOffsetClash`,
  `period-end-offset.ts`, reached from the "runs into what follows it" checks in
  `menu-timetable.ts`). Decide whether a cutoff past the changeover is refused.

**Left open by A506-8, for the later parts.**
- The painter cannot resize a block by dragging its edge (ruling R1 of A506-8); mockup 3's hint
  mentioned it. Painting over a block lengthens it, and painting Closed shortens it.
- On a venue whose business day changes over off the quarter hour, painting starts at the first
  quarter hour after the changeover and ends at the last one before it (a 05:50 changeover paints
  from 06:00 to 05:45, `stepAt` in `paint-model.ts`), so 05:45–06:00 cannot be painted. The reason is that the
  server refuses a time off the quarter hour (`service-day.ts`, the `step` refusal); that refusal
  was read in the code, not run.
- A save writes each edited week whole, all seven days. If another manager's save of the same week
  is stored after the read this painter's copy of the week came from and before this save is stored,
  this save puts back the days they changed, and nothing shows it. A fix needs the server to refuse
  a week changed since the draft was read, or to write only the changed days. Read in the code
  (`save` in `season-painter.ts` sends every day; `saveSeasonWeeks` in `season-weeks.ts`), not run
  against the server.
- An edited week keeps all its days when a live update changes a day the manager did not paint, so a
  later Save sends that day's old hours back. The one exception is the first read that started after
  a save of that week answered, with no other save in flight: it takes in the stored days not
  repainted since (`rebaseDays`). This is A506-8's rule, asserted by "a live model refresh keeps an
  edited week and reseeds the ones not edited" in `season-painter.test.ts`. Following unedited days
  one by one would reverse that assertion, so it is an owner decision. Special days (PR #1651,
  A506-9) already follow per date: a live update takes the stored paint on every date the draft did
  not change, asserted in `special-day-painter.races.test.ts`.
- `ModelWatches.reread` (`model-watch.ts`) holds back reads that started before a save only for its
  own client's watches. Another `OpeningHoursApi` on the same live data still applies them. Read in
  the code, not run.
- The routes `PUT …/departments/:departmentId/menu-week` and `PUT …/zones/:zoneId/closed-week`
  (`routes.ts`) are called by no client now that the painter saves through
  `PUT …/seasons/:seasonId/weeks`. Remove them, or keep them with a stated reason.
- Without a navigation guard, which only test harnesses lack, the painter's history mark is copied
  to later entries, so ✕ can go back to a later entry of the same screen.
- The navigation guard's `write()` and `rewrite()` both refuse while a leave question is open, so a live refresh that
  moves the painter to another season at that moment leaves the address on the old season.
- Closing a painter opened from the zone dialog's "Opening hours (normal week)" link, on
  Departments and zones, lands on the Opening hours Year, not back on Departments and zones
  (ruling R20). It does what "else the Year" in ruling R14 says, but a manager loses their place.
- At 390 px a block too short for both lines, such as a one-hour block, shows its period's name
  but not its times (ruling R21). Only its spoken label names them (`paint-grid.ts`).

**Left open by A506-7, for the later parts.**
- Public holidays' names show in Spanish in the English interface (seen on the month view, #1623):
  the official lists carry one name per holiday. Believed to predate A506-7; not checked against
  the year view's history.
- At 390 px a long name in a month cell breaks mid-word ("Christ|mas"): the dashboard page declares
  no language, so the browser cannot hyphenate.
- The special-day painter's note under "Every year" (`special.holiday_note`, from #1603) says "each
  year" twice in English and reads as awkwardly in Spanish.
- The stations service-times route's dated week (`stationServiceTimes(..., "dated")`), and
  `watchStationTimes`'s `normal` flag, have no dashboard caller since A506-7.
- With no readable venue clock the station view reads the week of 5 January 2026, a fallback the
  screen already used before A506-7; the station view is replaced in A506-12.

**Left open by A506-6, for the later parts.**
- A season dialog whose season another session deletes says "This season no longer exists." but
  stays open with Save and Delete still live (`season-dialog.ts`, #1616); the zone and department
  dialogs close instead and say so on the page. Pressing either is refused by the server with the
  same message, so nothing breaks; closing it like the others is the open choice.
- `isLocalDate` (`packages/venue-service/src/hours-rules.ts`) and `addMonths`
  (`packages/venue-service/src/dashboard/calendar-grid.ts`) still build dates with `Date.UTC`, which
  reads years 0–99 as 1900–1999 (#1616 fixed `addDays` and `weekdayOf`). Unreachable from the screens,
  which start at year 100; changing `isLocalDate` would change which dates the server accepts from
  outside (menu publication dates, imports), so it needs a decision.

**Why.** One standard week does not fit a venue whose hours change with the season, and copying a
week into future dates would bury the special days among ordinary ones.

**Seasons.**
- Every venue has seasons, four by default: Spring, Summer, Autumn, Winter. Repeating every year is
  what a season is, not an option.
- A season has a name and a start date only; it ends the day before the next season starts. So the
  seasons always cover the whole year, with no gaps and no overlaps.
- Moving a start date moves the neighbouring season's end. The new dates hold for this year and
  later ones until changed again; there is no one-year-only exception.
- Each season has its own week for each department, painted as today's normal week is.

**Special days.**
- Two kinds: public holidays (from the official lists, as today) and the venue's own special days.
  Today's own-holiday / working-day split goes: a search of non-test code found the kind read only to
  choose the Calendar's colour (`packages/venue-service/src/named-days.ts`, the `tone` choice).
- One special day is a name over any number of dates ("Christmas company dinners", 14–23 December),
  optionally repeating every year (on the same month and day, or, for a public holiday's date,
  wherever the holiday's name falls; spec section 5). Dates are added on a small calendar, singly or
  as ranges.
- **The season shows through.** Each date starts with the season's hours; what is painted on top
  replaces them for that stretch of time, and unpainted time keeps following the season. A
  special day has no "own hours" or "season's hours" switch. Worked example: under Winter's Dinner
  20:00–23:30, painting Dinner 19:00–22:00 still leaves the season's Dinner until 23:30; painting
  Closed over 22:00–23:30 ends the night at 22:00. The editor draws the season faded under the
  paint so this is visible.
- Closed is painted over part of a date, or a date's Closed tick shuts all of it. A public holiday
  works the same way, so closing Christmas Day is one tick.
- Every change to a single date is a special day. An ordinary date cannot be edited on its own: it
  says which season it follows and offers "Edit the Winter week", "Make this a special day…" and
  adding it to an existing special day.

**Periods get a page of their own** (owner, 2026-10-11): a period decides what is offered at a time
of day — the customer menu, the staff-only menus and, once A504 lands, the floor plan — so it is
more than a paint colour. Under Venue operations, beside Opening hours:
- One list, periods grouped under their department as A493 groups zones, with columns Period
  (colour and name), Customer menu, Staff-only menus, Floor plan (shown greyed until A504) and
  Painted in (the seasons and special days that use it, each opening that editor). A period painted
  nowhere is flagged, since nothing will sell its menu. Row ⋮: Edit, Open in Opening hours, Delete.
  The owner chose this over one card per period.
- One period dialog, opened from the page and from the painter: name, colour, customer menu (with
  what it includes), staff-only menus, floor plan (from A504) and Painted in. Save stays quiet until
  the draft changes.
- Deleting says where the period is painted and which routing cells name it, and offers a period to
  take its place. The mockup's answer without one: its painted time becomes closed in the seasons
  and the season shows through on special days.

**Venue, department, zone.** The venue holds the seasons and special days and no hours of its own
(owner's choice). Departments paint periods; a zone follows its department except where it is marked
closed, as today.

**Screens** (images in `docs/backlog/mockups/a506-opening-hours-seasons/`):
1. `1-calendar-year.png` — the Opening hours page opens on a year. Days are coloured by season;
   public holidays, special days and closed days are marked. Season chips show each range and
   edit its start (✎). "+ Special day".
2. `2-calendar-month.png` — clicking a month opens it, each day's hours drawn as a bar per
   department, with "‹ year" back. It replaces the Day tab and the Real week switch.
3. `3-season-week-editor.png` — a season's week, full screen: no banner and no side menu.
4. `4-special-day-editor.png` — a special day, in the same full-screen editor, one column per
   date instead of Monday to Sunday; name, dates and every-year in a side panel.
5. `5-ordinary-date.png` — clicking an ordinary date.
6. `6-periods-page.png` — the Periods page.
7. `7-period-dialog.png` — the period dialog.
8. `8-period-delete.png` — deleting a period that is in use.
9. `9-new-period-in-painter.png` — "+ New period" from inside the painter.

**The painter (both editors).**
- Full screen, with one bar holding close, what is being edited, the season or department
  picker, and Cancel and Save, which stay visible however the grid scrolls. Save stays quiet until
  the draft changes (CLAUDE.md §3, A331).
- One row of periods to paint with, plus Closed and "+ New period". Choose one, drag down a column.
- 15 minutes is a thin row (about 5px in the mockup; the owner's screenshot of today's grid shows
  under three hours at once), so most of a day fits on a laptop screen; the grid scrolls by itself while a drag passes its top or bottom edge.
- Dragging over an existing block replaces that stretch; nothing has to be cleared first.
- Two touching stretches of the same period are stored and drawn as one block.
- Click a block to select it: change its period from a list, or Delete (Backspace too). Deleting
  on a special day lets the season show through; in a season's week the time becomes closed.
- No fallback period (owner): what is painted applies, anything unpainted in a season's week is
  closed.
- Each column's ⋮ has "Copy to…", ticking several days or dates at once, and Clear. A special
  fortnight is painted once, copied across, and the odd dates changed after.
- The day name and its ⋮ share one line.
- **Periods from inside the painter.** Each period in the paint row has ✎, and "+ New period"
  opens the period dialog over the painter ("Add and paint with it"); the unsaved painting stays
  underneath. A period saves when its dialog saves, separately from the painter's Save, because the
  Periods page and the till use it at once (owner, 2026-10-11). The bar links to the Periods page;
  leaving with unsaved painting asks first.

**For the spec to settle** (settled in the spec's sections 8, 9, 10.2, 12 and 14; its review found the
kind has three readers, not one, and that `station-times.ts` reads the week only through routing's
period order — spec section 2).
- What reads hours today and must read seasons and special days instead. A search for the
  special-days table outside tests found `menu-timetable.ts`, `zone-closed-times.ts`,
  `holidays.ts`, `hours.ts`, `named-days.ts`, `configuration-transfer.ts`, `routes.ts` and the
  live queries in `packages/venue-service/src/`, plus `apps/dashboard/src/api/live-queries.ts`;
  prep station times (`station-times.ts`) read the week. Follow each call chain; a search is not a
  complete list.
- Deleting a period in use: the mockup shows one answer (above); the spec confirms it, and what a
  routing cell naming the period becomes (the 2026-10-07 spec, section 8, only warns).
- Where the read-only prep station times live, now that the tabs go.
- What the till sells at a moment is decided by these hours, so the sale-path resolver's
  season-then-special-day layering needs real-database tests across a season boundary and across
  midnight.

## Decisions and deliberate limits

- A season delete's confirmation names only the departments with hours in it, though the delete
  also removes the zones' closed times for that season (`seasonDeleteImpact`,
  `packages/venue-service/src/seasons.ts`). Owner, 2026-10-13 ~08:42: keep as built.

- **Business-day changes are dated (A495, 2026-10-11).** You schedule one future start, from
  two to 366 business-calendar dates ahead. You can replace or cancel it before the preceding
  business day begins. Time-zone edits remain locked after history or a dated start. A pending
  change pauses time-affecting hours edits; names, colours and menus remain editable. Recurring
  hours must remain valid under retained starts; an all-day range or a conflicting endpoint
  needs re-authoring before scheduling. Reports keep historical date boundaries, not snapshots
  of authored hours. Full backups retain the timeline; configuration export refuses a pending
  change and otherwise exports the active start with no history. The
  [design](../superpowers/specs/2026-10-11-a495-business-day-history-design.md) records DST and
  UTC-clock limits. `apps/server/src/business-day-history.test.ts` compares recorded fiscal,
  invoice-series and close rows before and after scheduling; it does not establish external
  filing behavior.


- **Hierarchy Delete is permanent (A435 step 6, 2026-10-11).** One complete impact is rechecked
  inside the write transaction. Live work refuses; no work is abandoned. All saved, today, reset
  and join descendants are removed together. Department-owned routing, periods, hours overrides
  and transfer settings go; shared menus, venue calendars and holidays stay. Deleted receipt
  settings and media stay for internal printing, with no editor or import/export access.
- **Profiles and defaults stay within surviving configuration (A435 step 6, 2026-10-11).** A
  nonretired ordering profile bound to the department, or losing its only effective zone, refuses
  Delete even without an active device. A removed start/default uses the declared surviving order,
  never invented configuration or wider access. An explicit empty KDS parent stays empty; Every
  stays Every. A default change does not rewrite historical department attribution. Closed today,
  opening hours and hardware Disable remain separate. The
  [reconciliation](../superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md)
  records the complete limits.

- **Permanent station Delete is separate from Close for today (A435 step 5, 2026-10-10).**
  Close keeps its Send/Leave choice. Delete refuses held, queued or preparing food and explicit
  effective KDS bindings, including off devices; fired ready food may stay as history. Deleting
  a base routing rule removes all its period children. Incoming daily destinations clear without
  reopening the referring stations. A fully Every-stations screen does not block deletion, and
  an emptied explicit/profile screen scope stays empty rather than widening to Every.

- **Zone and period extensions remain separate (A366 slice 3 Part B, 2026-10-09).** Cancelling
  a department's period extension does not delete its zones' overrides. In the server keep-open
  suite, a retained zone override until 01:30 still leaves the 01:15 dish submission refused
  with `menu_period.not_running` after the period extension is cancelled. The zone line reports
  its own closure, rather than the department's combined availability.

- **A department row's arrow (A301, #1335, A261 step 2).** Departments start open, unlike the
  Products, menu Structure and menu prices trees, which start closed, and a folded department is
  not remembered after a reload: the table remembers only the branches a person opens, only in a
  tree that starts closed and turns on `rememberExpanded`, which of those three only the Products
  tree does.
- **A9 wages** will read the calendar's holiday facts through its own composition contract;
  nothing in Hours computes pay. (A261 step 5, Hours, #1298.)
- **Step 7 time zone and cutover** (A261). #1281 refuses a time zone or cutover change once the
  venue has any sale, working order or daily close. Hours keeps wall times and date keys as stored and
  reads again on a `locations` change; allowing a change after trading would need its own
  decision on what stored hours mean.
- **Venue details (A261 step 7, #1281).** Changes needing another fiscal/geographic context or
  history removal use a separately approved setup/reset instead. Later
  Hours/holidays/menu builds retain their own compatibility tests.
- **Address changes during a local-holiday or area save (#1305's open points, A261 step 6).** An
  address change that lands after Save is pressed but before the page has read the new address is not
  caught: the route takes no expected address, and an area save already on its way has the same
  gap. The address-change warning names only the new city, though a province change also
  triggers it. The owner decided on 2026-10-06 not to queue these, or the clear-area control
  (listed among the smaller notes from the public holidays reviews, above).
