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

## The Business day start dialog repeats the server's conflict-counting rule

Left open by A506-3, #1591.

The Business day start dialog works out its conflict count by repeating the server's rule for
counting a conflict once whatever its season (`rangeKey`,
`apps/dashboard/src/screens/business-day-start-editor.ts`), so a change to that rule on the server
would make the dialog miscount without any test noticing. The server could return how many conflicts
it left off its list instead, which adds a field to the shared preview type.

## A venue with no seasons cannot edit a week from the dashboard

Left open by A506-3, #1591.

A venue with no seasons cannot edit a week from the dashboard: since A506-8 the season painter
draws nothing without a season (read in `season-painter.ts`'s render, not run). Provisioning gives
every venue four seasons, and deleting the last one is refused (`season.invalid`, reason `last`,
`deleteSeason` in `packages/venue-service/src/seasons.ts`), so this is believed unreachable — read in
the code, not run.

## The special-day-then-season rule is written out in several places

Left open by A506-4, #1597.

With named days gone (A506-5), the rule "special day, then season" is still written out in
`day-resolver.ts` (twice, for departments and for zones), `business-day-schedule.ts` and
`period-end-offset.ts`, and the end-offset check relies on list order for it; special-day paint is
read by four separately written queries in `special-days.ts` and `business-day-schedule.ts`;
`specialDateIn` and `sharedSpecialDate` live in the database module `special-days.ts` rather than
the browser-safe repeat rules, which leaves import loops with `business-day-schedule.ts` and
`menu-timetable.ts`. Each could collapse to one place.

## The zone editor's closed-times sentences without a season name

Left open by A506-5, #1603.

The zone editor's closed-times summary uses its sentences without a season name
(`venue.zone_closed_days`, `venue.zone_closed_summary`, and `venue.zone_open_with_department`)
only when the venue has no seasons at all: `zoneClosedWeek`
(`packages/venue-service/src/dashboard/zone-closed-week.ts`) picks them when neither the current
season nor a first season exists. Provisioning gives every venue four seasons, and deleting the
last one is refused (`season.invalid`, reason `last`, `deleteSeason` in
`packages/venue-service/src/seasons.ts`), so this is believed unreachable — read in the code, not
run; no test names those keys.

## A department or zone delete's preview never counts a special day's painted hours

Left open by A506-5, #1603.

A department or zone delete's preview never counts a special day's painted hours, yet the delete
removes them: `readServiceDeleteSettings` (`packages/venue-service/src/service-delete-settings.ts`) counts
only `department_days` and `zone_days` rows that have a season, while
`clearServiceDeleteSettings` deletes all of the department's `department_days` and the zones'
`zone_days`, special-day rows included. The season-only count predates A506-5 (it came with A506-1,
#1577; special-day paint was first written in A506-4); until A506-5 the preview's timetable, slot and
closed-time lines at least counted the old named-day hours, so now it discloses no dated hours at
all.

## The readiness line for a repeating holiday date names the official holiday

Left open by A506-5, #1603.

The readiness line for a repeating holiday date with no match names the stored official holiday
name ("Natividad del Señor"), not the special day's own ("Christmas Day"), and says "no public
holiday of that name" when the cause is that the year's whole list has not shipped yet.
The Year's missing-holiday warning (`#warnings`,
`packages/venue-service/src/dashboard/opening-hours-year.ts`) uses the same sentence and the same
name, though its read carries the special day's own `name`; a fix covers both.

## The end-offset check accepts a cutoff past the changeover

Left open by A506-9, #1651.

The end-offset check accepts a period whose cutoff runs past the changeover: A506-9's LOOK saved
Late 00:30–03:00 with a 180-minute offset, a cutoff of 06:00 past a 05:00 changeover. The check
compares a cutoff only with the start of the next period (`findEndOffsetClash`,
`period-end-offset.ts`, reached from the "runs into what follows it" checks in
`menu-timetable.ts`). Decide whether a cutoff past the changeover is refused.

## A date another manager removed stays in the special-day draft

Left open by A506-9, #1651.

A date another manager removed stays in the draft when this draft changed its paint or its Closed
tick (`merge`, `special-day-painter.ts`). If only the Closed tick changed, Save puts the date back
with no paint, though it had paint before the removal. The painter shows the date before Save, so
nothing is lost unseen. Found by reading, not run; decide whether that date should be dropped too.

## Painting stops short of an off-quarter-hour changeover

Left open by A506-8, #1634.

On a venue whose business day changes over off the quarter hour, painting starts at the first
quarter hour after the changeover and ends at the last one before it (a 05:50 changeover paints
from 06:00 to 05:45, `stepAt` in `paint-model.ts`), so 05:45–06:00 cannot be painted. The reason is that the
server refuses a time off the quarter hour (`service-day.ts`, the `step` refusal); that refusal
was read in the code, not run.

## A season painter save writes each edited week whole

Left open by A506-8, #1634.

A save writes each edited week whole, all seven days. If another manager's save of the same week
is stored after the read this painter's copy of the week came from and before this save is stored,
this save puts back the days they changed, and nothing shows it. A fix needs the server to refuse
a week changed since the draft was read, or to write only the changed days. Read in the code
(`save` in `season-painter.ts` sends every day; `saveSeasonWeeks` in `season-weeks.ts`), not run
against the server.

## Two date helpers read years 0 to 99 as 1900 to 1999

Left open by A506-6, #1609.

`isLocalDate` (`packages/venue-service/src/hours-rules.ts`) and `addMonths`
(`packages/venue-service/src/dashboard/calendar-grid.ts`) still build dates with `Date.UTC`, which
reads years 0–99 as 1900–1999 (#1616 fixed `addDays` and `weekdayOf`). Unreachable from the screens,
which start at year 100; changing `isLocalDate` would change which dates the server accepts from
outside (menu publication dates, imports), so it needs a decision.

## A718. Departments and zones: a column for the receipt and floor plan, a trimmed zone editor

**A718 (owner, 2026-10-15).** Mockup: [departments and zones](mockups/a718-a727-calendar-and-stations/12-departments-and-zones.png).
Files: `packages/venue-service/src/dashboard/departments-list.ts`, `zone-edit-dialog.ts`.

1. **The zone editor's Save sits too far right.** The fields stop short of the dialog's right edge
   but the button row runs to it; the row ends where the fields end.
2. **The zone editor drops three things:** the season sentence ("Autumn: open whenever the
   department is"), the "Opening hours (normal week)" link, and the floor-plan link ("Add a floor
   plan" / "Edit floor plan") with its preview (`zone-edit-dialog.ts:256-260`). The floor plan is
   reached from the new column (point 4); opening hours from the Calendar.
3. **No column picker** above the Departments table.
4. **A column for each row's other editor** ("Also edit" in the mockup; the heading is the
   implementer's call): "Receipt" on a department row where a receipt can be edited
   (`receiptAvailable`, `departments-list.ts`), "Add floor plan" or "Floor plan" on a zone row.
   Edit receipt leaves the department's ⋮ menu.

Landing this deletes the open notes it makes moot: "The zone editor's closed-times sentences without
a season name", "Closing a painter opened from the zone dialog's 'Opening hours (normal week)' link
lands on the Opening hours Year", and "The zone editor's 'Edit floor plan' link is not hidden without
`venue.configure`" — re-file that last one against the new column if it is still true there.

## A719. Periods become a window opened from the Calendar

**A719 (owner, 2026-10-15).** Mockups: [the Periods window](mockups/a718-a727-calendar-and-stations/13-periods-window.png),
[list rows and the period dialog](mockups/a718-a727-calendar-and-stations/11-periods-page-and-dialog.png) (drawn before the window; its
rows and dialog still apply). Files: `packages/venue-service/src/dashboard/periods-screen.ts`,
`period-dialog.ts`, `period-editing.ts`, and the `periods` page in `index.ts`.

1. **The Periods page and its sidebar entry go; a Periods window replaces them.** It lists the
   periods grouped by department — colour, name, customer menu, staff-only menus, "Painted in" and a
   bin — with "+ Add period". A row opens the existing period dialog on top: a period has too many
   fields to edit inside its row, unlike a season (A721).
2. **Where it opens:** a "Periods…" button beside "Seasons…" on the Calendar Year's season row (A721
   adds "Seasons…"; if A719 lands first it adds "Periods…" alone); the
   painters' "Periods" link (`periodsLink`, `period-editing.ts`), which today navigates away and now
   opens the window on top of the painter so unsaved paint stays; and the Departments warning "Set up
   periods" (`departments-list.ts:219`), which opens the Calendar with the window open. The window
   uses the Calendar's existing `window/<id>` address pair. Extend its window handler with `periods`,
   reuse `calendarWindowPath`, and declare the destination in venue-service's `searchDestinations`.
   Keep the retained painter outside the window's draft ancestry.
3. **An unused period shows its colour.** Today a period painted nowhere gets an empty dashed square
   and a greyed name (`swatch-unpainted`, `periods-screen.ts`); "Not painted anywhere" already says
   so. Fill the square and drop the grey.
4. **No Floor plan column or field until A504.** Remove the disabled field from the period dialog
   and the column from the list, and change A504's entry — which says they are kept for it — to say
   A504 adds them back.
5. **Delete… moves into the dialog's bottom row**, left of Cancel and Save; today it sits alone in
   the body.
6. **The colour is chosen in a popup**, the shared chooser A725 point 7 describes, not a row of
   squares. Whichever of A719, A721 and A725 lands first builds it.

Its button goes on the Year view's season row.

## A720. The Calendar's Year and Month views: one toolbar, a day box, days picked on the grid

**A720 (owner, 2026-10-15).** Mockups: [Year](mockups/a718-a727-calendar-and-stations/01-year-view.png),
[Month](mockups/a718-a727-calendar-and-stations/03-month-view.png). Files: `packages/venue-service/src/dashboard/opening-hours-screen.ts`,
`opening-hours-year.ts`, `opening-hours-month.ts`; for point 7,
`packages/staffing/src/dashboard/staffing-month.ts`.

3. **A day box instead of the panel that makes the page jump.** Today clicking a day in the Year
   view adds a panel under that month, which grows it and pushes the next row of months down by a
   different amount per month. Instead, clicking a day in the Year or Month view opens a floating
   box: the date, the holiday or special day's name, which season's standard hours apply (or which
   a special day replaces), and each department and zone with its periods and times. Its buttons:
   "Make a special day" or "Edit special day", "Edit {season}'s standard week", and "Open this
   week" (A722). Pointing at a holiday or special day shows its name. Escape or a click elsewhere
   closes the box; nothing on the page moves.
4. **Days are picked on the grid.** A click picks one day; a drag, or a click then a shift-click,
   picks a run; a double-click (a long press on a phone) opens the special-day editor with those
   dates, or the special day already there. No hint line (owner: discoverable enough). Keyboard: the
   arrows move, Shift with an arrow extends, Enter opens. The special-day editor's date picker uses
   the same code (A723 point 7).
7. **The Staffing view's month follows**: no seasons or special-days row, and the same day box,
   offering "Edit {special day} staffing" or "Edit {season}'s standard week" (A724).

Season colours come from A721; until it lands the views keep today's tints.

## A721. Seasons: a Seasons window edited in its table, and a stored colour for each season

**A721 (owner, 2026-10-15).** Mockup: [the Seasons window](mockups/a718-a727-calendar-and-stations/02-seasons-window.png). Files:
`packages/venue-service/src/dashboard/season-chips.ts`, the season dialog, `season-tint.ts`, and
the season schema and routes. Migration: a colour per season (pre-live, so no data migration).

1. **A "Seasons…" window**, opened from a "Seasons…" button on the Calendar Year's season row
   (A720 left it to A721), replaces the existing addressable chooser at `window/seasons` and lists every season in the order it
   starts in the year. Each row edits its colour (A725's popup chooser), name and start date in
   place; "Runs until" is worked out from the next season and is not typed; a bin removes the row.
   "+ Season" adds a row offered the next unused colour. One Save sends every change and closes the
   window; Cancel discards. The separate season editor and the chips' ✎ go.
2. **Each season stores its colour.** Today `seasonTints` colours a season by its place in the list
   it is handed, so February's Month view, handed only Winter and Spring, paints Winter yellow while
   the Year paints it blue. A stored colour is the same on every view. Landing deletes the open note
   "Season colours differ between Opening hours' Year and its month (and the Times tab)".

## A722. A Week view in the Calendar

**A722 (owner, 2026-10-15).** Mockups: [Week](mockups/a718-a727-calendar-and-stations/04-week-view.png),
[on a phone](mockups/a718-a727-calendar-and-stations/05-week-view-phone.png). Depends on A720.

Register the new view in venue-service's search destinations when it exists; A727 deliberately
keeps `/view/week` out of search while it still means the old season painter.

1. **One real week** — holidays, special days and closed days included, unlike a painter's standard
   week — for the department chosen in Show and its zones, or one row per department for All
   departments. Time runs left to right from the day's changeover to the next morning, one row per
   department or zone; the department's blocks carry their period and times, and a zone row is drawn
   faded where it only follows the department and labelled where it differs. A zone's own hours
   from `zoneOwnHours` (`packages/venue-service/src/zone-own-hours.ts`).
2. **A block too short for its label shows the whole label** — department or zone, period, times —
   when it is pointed at or tapped (Lunch 16:00–17:00 is a sliver).
3. **Which week the Week button opens:** the week of the day last clicked; otherwise this week, when
   the year or month on screen holds today; otherwise the first week of the month (or year) on
   screen. ‹ › step a week.
4. **On a phone, one day at a time:** each row as its times in words over a thin bar, ‹ › or a swipe
   for the next day.
5. **No painting here.** Clicking a day's name opens A720's day box.
6. **Show lists prep stations too** (here and in the Month view): choosing one draws one row per
   department that sends it dishes, from each period's start to its last orders — what A725 retires
   with the Times tab. The same reading as A724 point 2.

## A723. The season painter and the special-day editor: say what they are, close on Save, keep a zone's closures inside opening hours

**A723 (owner, 2026-10-15).** Mockups: [season painter](mockups/a718-a727-calendar-and-stations/06-season-painter.png),
[special-day editor](mockups/a718-a727-calendar-and-stations/07-special-day-editor.png). Files:
`packages/venue-service/src/dashboard/season-painter.ts`, `special-day-painter.ts`, `paint-row.ts`,
`painter-frame.ts`, `add-dates-calendar.ts`, `strings.ts`, and the server's season-week and
special-day write routes.

1. **"Standard", not "normal"**, wherever a season's week is named: the painter's title becomes
   "Autumn: standard week", and strings such as "Follow the normal week" (`opening.follow_week`)
   follow.
2. **A line under the top bar says what is being edited:** "Every week from 5 Sept to 30 Nov opens
   these hours, except on special days."
3. **The "… follow Santet Deli Co" note leaves the top bar** (`painter.zone_follows`,
   `painter.zones_follow`).
4. **Save closes.** One Save sends every department and zone changed, then closes the painter; a
   refused save keeps it open with its message beside Save. The same in the special-day editor. The
   design notes' sentence that "the painter stays open and the answer becomes the saved state"
   (design-system.md, the special-day painter) changes with it. Owner: you can paint a zone without
   saving first, so one Save at the end is enough.
5. **A zone's Closed paint covers only times its department is open.** Dragging Terrace's Closed
   from 23:30 to 03:00 keeps 23:30–02:00, when Santet Deli Co closes; the server refuses a zone
   closure outside its department's hours from any route.
6. **A period chip's edit control is a visible "✎ Edit" button** (`paint-row.ts:165`), not a bare ✎.
7. **The special-day editor's Range button goes.** A click adds or removes a date; a drag or a
   shift-click adds a run; one hint line says so. The same picking code as A720 point 4.

## Decisions and deliberate limits

- Once two special days share a date, a save of either day that keeps that date is refused with
  `special_day.date_taken` (A577, #1702, 2026-10-14).

- **Opening hours are seasons and special days (A506, owner, 2026-10-11).** Every venue has
  seasons that cover the whole year and repeat every year, each with its own week per department;
  a special day is painted over its dates, and its unpainted time follows the season; periods have
  a page of their own; the venue holds no hours of its own. The rules are in the
  [spec](../superpowers/specs/2026-10-11-opening-hours-seasons-design.md), with
  [mockups](mockups/a506-opening-hours-seasons/).

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
