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

## Smaller notes from the public holidays reviews

- **Smaller notes from the reviews:** there is no control to clear a chosen area back to "not
  chosen" (the route accepts it); the area names "Arán" and "Lleida, fuera del territorio de
  Arán" are Spanish data labels shown untranslated in English.

## The Business day start dialog repeats the server's conflict-counting rule

Left open by A506-3, #1591.

The Business day start dialog works out its conflict count by repeating the server's rule for
counting a conflict once whatever its season (`#conflictLines`,
`apps/dashboard/src/screens/business-day-start-editor.ts`), so a change to that rule on the server
would make the dialog miscount without any test noticing. The server could return how many conflicts
it left off its list instead, which adds a field to the shared preview type.

## The special-day-then-season rule is written out in several places

Left open by A506-4, #1597.

With named days gone (A506-5), the rule "special day, then season" is still written out in
`day-resolver.ts` (twice, for departments and for zones), `business-day-schedule.ts` and
`period-end-offset.ts`, and the end-offset check relies on list order for it; special-day paint is
read by four separately written queries in `special-days.ts` and `business-day-schedule.ts`;
`specialDateIn` and `sharedSpecialDate` live in the database module `special-days.ts` rather than
the browser-safe repeat rules, which leaves import loops with `business-day-schedule.ts` and
`menu-timetable.ts`. Each could collapse to one place.

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

## A server write that changes a department's hours leaves its zones' closures outside them

Left open by A723 (#1849).

A write that changes only a department's hours is not refused and does not cut the zone closures
already stored: the menu-week route (`replaceMenuWeek`), deleting a period (`period-delete.ts`),
moving a zone to another department (`configureZone`, `operations.ts`), and a season-week request
that sends only a department. A closure left outside the new hours stays stored, and the next save
of that zone is refused, naming that day, until the stretch is deleted or repainted. In the
painters, changing a department's day cuts the closures painted for its zones on that same season
day or special date; a special date's zone paint is not cut when the season week under it changes
(see "A change to a department's season week can leave a special date's zone closure outside its
new hours", below). Decide whether those writes should cut the closures too. (A723 plan, Decision 3; the list of
writes is the plan's reading of the code, not run here.)

## The zone-closure hours check runs at the routes, not inside the writers

Left open by A723 (#1849).

The check that a zone closure lies inside its department's hours runs in the season-week,
closed-week and special-day routes and in the configuration import (`configuration-transfer.ts`),
not inside the writers. The season-week and closed-week routes pass `assertSeasonClosuresInHours`
(`zone-closure-hours.ts`) to `saveSeasonWeeks` and `replaceZoneClosedWeek` as their optional
`afterWrite` hook, which the writer runs after its writes; the special-day routes call
`assertDatedClosuresInHours` after `saveSpecialDay` returns. A caller that passes no hook, or calls
`saveSpecialDay` directly (tests and the demo seed today), is not checked, and a new route must
pass or call the check itself. The plan counted 123 test set-ups that build zone states through the writers and
would break under a check inside them. (A723 plan, Decision 1.)

## Unticking a special date's "Closed all day" brings back its zone paint unchecked

Left open by A723 (#1849).

The server does not check zone closures on a date ticked closed all day
(`assertDatedClosuresInHours` skips it), because the day's resolver ignores zone paint there. Zone
paint stored on that date counts again once the tick is removed, and the save that removes the
tick checks only the zone paint the request sends, which the editor limits to paint that differs
from what is saved. So a stored closure outside the department's hours that date is not caught.
(A723 plan, Decision 4.)

## A change to a department's season week can leave a special date's zone closure outside its new hours

Left open by A723 (#1849).

A special date's department hours come from the season week its date falls in, with the day's own
paint laid over them. A change to that week (a season-painter save, the menu-week route) or to
which week a date falls in (moving a season's start, deleting a season) changes those hours, and
nothing checks the zone closures stored on special dates against them: the season-week check reads
only the zone weeks a request sends, and the special-day check only the zone paint a special-day
save sends.

## A yearly special day's zone paint is checked against its stored date only

Left open by A723 (#1849).

`assertDatedClosuresInHours` checks each stored date against its department's hours on that date.
A special day that repeats every year falls in later years on other weekdays, and perhaps in other
seasons, where the department's hours can differ; its zone closures are not checked there.

## A special day whose dates have different changeovers is cut on the first date's changeover

Left open by A723 (#1849).

The special-day editor draws every date from the first date's changeover (`cutover`,
`special-day-painter.ts`) and cuts every date's zone Closed paint on it, while the server checks
each date on its own changeover (`serviceDayContext` in `assertDatedClosuresInHours`). On a special
day whose dates have different changeovers (dates either side of a scheduled change to the
business day's start, `cutoverForBusinessDay`), the two can disagree: the server refuses, and the
editor shows its reason. Read in the code, not run.

## The season-week and closed-week routes do not lower-case a zone or season id, as the special-day route does

Found during A723 (#1849).

The season-week route (`PUT …/seasons/:seasonId/weeks`) and the closed-week route
(`PUT …/zones/:zoneId/closed-week`) take a zone or season id as sent (`requireUuidParam`,
`requireBodyUuid`, `requireWeekList`, `routes.ts`), so an upper-case id finds no row and is
answered as not found (404); the special-day route lower-cases a zone or department id before
storing it (`special-days.ts`). Measured during A723 with a temporary test: an upper-case zone id,
and then an upper-case season id, sent to each of the two routes was answered 404
(`service_zone.not_found`, `season.not_found`). It predates A723. Decide whether the two routes lower-case ids too.

## A cut-away zone stroke hides another day's refusal marker until the next Save

Left open by A723 (#1849).

In both opening-hours painters, a change to a zone's day whose Closed paint is cut away entirely
replaces the whole refusal beside Save with "A zone can only close while its department is open."
(the `paint-outside` handlers in `season-painter.ts` and `special-day-painter.ts`), so the marker
a refused Save put on another day's heading disappears too. The next Save marks it again; the newest
message wins.

## A season closure on a special date is not cut or checked against that date's shorter hours

Found during A723 (#1849).

On a special date, a zone's closures from its season week still apply, with the date's zone paint
laid over them (`layerZonePaint` in `resolveZoneClosedDays`, `day-resolver.ts`). When the
department's paint for that date shortens its hours, nothing cuts or checks those season closures:
the special-day painter cuts only a zone's paint on that date and skips a zone with none (`paint`,
`special-day-painter.ts`), and the special-day routes check only the closed ranges in the zone
paint the request sends (`assertDatedClosuresInHours`, `zone-closure-hours.ts`). So a season
closure can lie outside that date's department hours. Found by reading the code, not run.

## A723's plan defaults sent to the owner as an FYI

Left open by A723 (#1849).

A723's plan made these choices by default and sent them to the owner to overrule if wanted
([plan](../superpowers/plans/2026-10-18-a723-painters-standard-week.md), "Decisions this plan
makes"):

- Decision 1: the zone-closure hours check runs at the routes and the import, not in the writers.
- Decision 3: the server checks only the zone closures a request writes; a department-only change
  leaves stored closures as they are.
- Decision 6: the Opening hours screen closes a painter after a clean save; paint made during the
  save keeps it open, unsaved.
- Decision 7: a zone's day on which its department is closed shows "<department> closed all day"
  behind the zone's paint, which stays drawn on top.

A762's plan, Decision 3 (#1850), superseded Decision 9 (the special-day editor kept the day's name as its
heading): the editor is now titled "<name>: special day, <dates>".

## A762's plan defaults sent to the owner as an FYI

Left open by A762, #1850.

A762's plan made these choices by default and sent them to the owner to overrule if wanted
([plan](../superpowers/plans/2026-10-18-a762-painter-colour-bands.md), "Decisions this plan
makes"):

- Decision 1: the band is a strip, not a tinted bar: `--wt-space-2` tall, the bar's full width,
  rounded ends, above the bar, `aria-hidden`, in the season's line colour. Nothing but colour sits
  on it, so it needs only 3:1 against the painter's background, which `season-tint.test.ts` holds.
- Decision 2: a special day's colour is the Calendar's special-day purple
  (`SPECIAL_DAY_LINE`, `--wt-color-palette-purple`); special days store no colour.
- Decision 3: both special-day painters, Opening hours' too, are titled "<name>: special day,
  <dates>"; "<name>: special day" with no dates; "New special day" before a new day has a name.
  It supersedes A723's Decision 9.
- Decision 8: the Staffing month draws a special day's dates as one purple run over the season's
  line, joined across the gaps within a week and broken at a week's end; two special days on
  neighbouring dates are two runs.
- Decision 10: the special-day editor's Delete comes after Cancel with the danger look, and Save
  stands apart. This extends the owner's 2026-10-16 rule for a form's bottom row
  (`[Cancel] [Delete] … [Save]`, design-system.md → Forms) to a painter's top bar.

## A purple season looks like a special day

Left open by A762, #1850.

A purple season's line (`--wt-color-station-purple-dot`) against the special-day purple
(`--wt-color-palette-purple`) is 1.26:1 in light and 1.63:1 in dark (hand-computed over the token
values, the plan's "Receipts for the contrast decisions"). So a purple season's band in the
painters looks like the special-day band, and its line in the Staffing month like a special day's
run. What tells them apart today: the painter's heading says "standard week" or "special day", and
the month's special-day run is joined across the gaps between its dates where a season's line
keeps them. Options: keep purple out of the season chooser, or give the special-day marks a shape
of their own.

## Two holidays with one name in one year's list

**Two holidays with one name in one year's list** (retro review of #1603). The holiday dates a
save reads keep only each name's first date in the year (`readHolidayDates`,
`packages/venue-service/src/holidays.ts`), so a repeating date saved on the second is stored with
no holiday name, unless another holiday shares that day, and repeats on its month and day; in
a later year a name with two dates is followed to the first of them, a rule nobody chose. No
shipped list has one: a probe on 2026-10-13 over every province and area of
`packages/country-es/src/data/es-2026.ts` read 729 holidays in 61 lists and found no name twice.
Re-check when a new year's list is added.

## A855. The till's zones read builds date formatters on every call

**A855 (2026-10-18).** About 0.75 ms of each `GET /api/zones` goes on `new Intl.DateTimeFormat`
inside `serviceMomentAt` and `serviceDayContext` (`packages/venue-service`), through the
business-day helpers in `@waitron/reporting` and `@waitron/shared`. A504 took the read's median from
1.436 to 3.004 ms on one bench. Both figures were measured before the finish review made the
read take the clock and the day once (median about 3.1 to 2.0 ms on another bench); re-measure
before acting. Next: keep one formatter per time zone. Left open by A504.

## Loose ends left by A788

Found while building A788 (the business-day start changes at the next changeover). Unless an entry
says it was run, it comes from a per-task review recorded in the build's ledger and was read in the
code, not run again here.

- **A864, the clash list.** `businessDayClockConflicts`
  (`packages/venue-service/src/business-day-schedule.ts`) keeps the first 20 distinct ranges with
  the season set aside, then returns every conflict row for those ranges, one per season the range
  is painted in; `conflictCount` counts distinct ranges. The dialog shows each row as its own line
  and adds what was counted beyond the list to the count (`#conflictLines`,
  `apps/dashboard/src/screens/business-day-start-editor.ts`), with no "and N more" line. On the demo
  venue a 21:00 start listed 91 lines under a count of 105 (A788's look check, Task 15). The cap
  predates A788 (`git blame`: 061240c87, A506-2, 2026-10-12). The A506-3 loose end about the dialog
  repeating the server's counting rule is the same seam.
- **A865, the clash order.** One implementer saw the order between departments vary from run to
  run, and a review traced the order of one special day's dates to their random row ids.
- **A867, a crossing range hides an overlap.** A range that fails on its own is listed as crossing
  the new start; the day's other ranges are marked overlapping only when no range fails on its own
  (`overlapping` in `businessDayClockConflicts`). A review's probe: 13:00–16:00, 15:00–17:00 and
  22:00–04:30 moving 05:00 → 03:00 lists only 22:00–04:30.
- **A869, a one-off day after the change.** While 03:00 waits, a one-off special day on 2026-11-05
  with 04:00–12:00, which fits the 03:00 start that date will have, is refused
  `special_day.invalid` (reason `order`): `saveSpecialDay` parses one-off dates under the starts
  already in force (`settledClock`). Task 11 left it unchanged, per its implementer, read in the
  code.
- **A870, past one-off days.** On a date before today's business day, the last-orders check counts
  weekly, season and repeating special-day ranges as absent only on a venue holding a start change
  (a waiting one included); on a venue holding none it checks a past one-off day over its season's
  ranges as before, so the same paint can be refused on one venue and accepted on the other.
- **A872, repeated work.** A preview or a Save (`apps/server/src/business-day-start.ts`) works the
  plan out with `planBusinessDayStart`, and `clockTransitionAt`
  (`apps/server/src/business-day-changeover.ts`) works it out again, then once more for each of up
  to 20 moments when it looks for when a Save refused across a clocks change can be made.

## Decisions and deliberate limits

- **`seasons.colour` has no CHECK and no trigger (A721 plan, Decision 1; plan default).** A CHECK
  makes drizzle-kit rebuild `seasons`, whose `DROP TABLE` empties every season's weeks; a wrong value
  only paints grey. `saveSeasons` and the configuration transfer refuse one
  (developers/conventions-data.md, "2026-10-17, A721").

- **Existing seasons became grey; a new venue's are Spring green, Summer amber, Autumn orange and
  Winter blue (A721 plan, Decision 2; plan default, sent to the owner as an FYI, 2026-10-17).** No
  data migration, pre-live.

- **Two seasons may share a colour (A721 plan, Decision 3; plan default).** The chooser names the
  other seasons that use each colour, as for periods.

- **The Seasons window lists the season in force on 1 January first, then the rest by start, and
  does not re-sort while editing (A721 plan, Decision 12; plan default, sent to the owner as an FYI,
  2026-10-17).** "+ Season" appends; the list comes back sorted after Save.

- **A season's start is a Day and a Month combobox side by side (A721 plan, Decision 13; plan
  default, sent to the owner as an FYI, 2026-10-17)**, not the single field mockup 02 draws: no
  primitive picks a month and day, and a 365-option list was rejected.

- **The Seasons window draws its own wide `wt-modal`, footer `[Cancel] … [Save]`, with "+ Season"
  under the table (A721 plan, Decision 14; plan default, sent to the owner as an FYI, 2026-10-17).**
  Mockup 02's "+ Season" in the footer predates the 2026-10-16 footer rule. Cancel, Escape and Back
  ask before discarding changes.

- **The bin removes a row from the draft and a note under the table says what Save will delete
  (A721 plan, Decision 15; plan default, sent to the owner as an FYI, 2026-10-17)**: where its days
  go and which departments lose hours, with no confirmation step. The last row's bin is disabled;
  Cancel is the only undo.

- **A season list arriving while the Seasons window is open is folded into the draft field by field
  (A721 plan, Decision 17; plan default, sent to the owner as an FYI, 2026-10-17).** A field the
  person changed keeps their value; a season deleted elsewhere is dropped if untouched or binned,
  and kept with "This season no longer exists." if touched, and Save waits until it is binned.

- **A zone closure outside its department's hours is refused with the reason `outside_hours` on
  each route's own code (A723 plan, Decision 2; plan default).** The season-week and closed-week
  routes answer `zone_closed_time.invalid`, the special-day routes `special_day.invalid` with
  `field: "zonePaint.<i>.ranges.<k>"`; the configuration import keeps
  `setup.request_invalid { field: "zone_day_ranges" }`.

- **A special-day zone's Open paint is not bounded, and a date ticked closed all day is not checked
  (A723 plan, Decision 4; plan default).** The day's resolver ignores zone paint on such a date.

- **The painters cut a zone's closures only on the days a change touches, and nothing on Save
  (A723 plan, Decision 5; plan default).** A day nobody changed keeps a stored out-of-hours stretch,
  and a season-painter Save that sends that zone's week is refused for it, marking that day.

- **"Standard week" in English and "semana estándar" in Spanish wherever Opening hours names a
  season's week (A723 plan, Decision 8; plan default).** `day.standard` ("Horario habitual de
  {season}") names hours, not a week, and stays.

- **A special day's dates are written as runs (A762 plan, Decision 4; plan default).** "24 Dec",
  "12–15 Feb", "30 Jan – 2 Feb", in date order, joined by ", ", with years only when the dates span
  more than one; a U+2060 word joiner after a one-month run's dash keeps it from breaking there.

- **Only the season painters have a line under the bar (A762 plan, Decision 5; plan default).** A
  special-day heading already names its dates.

- **The staffing special-day painter reads its dates from its read's first area (A762 plan,
  Decision 6; plan default)**, as every area carries the same dates; no server read changed.

- **When the band shows (A762 plan, Decision 7; plan default).** A special-day painter's from the
  moment it opens; a staffing season painter's once its read names the season's colour; a viewer's
  too.

- **Staffing's Spanish says "semana estándar" in the four strings that name a season's week (A762
  plan, Decision 9; plan default).** `staffing.day.standard` and `staffing.day.replaces` name the
  staffing, not a week, and stay.

- **In the Calendar's Month and Week a day's name breaks only between its words, a word too wide
  for its place cut with "…" and kept whole in the name's title; the day box shows the name whole,
  breaking only a word wider than the box. The Month's empty track is `--wt-color-track`, as the
  Week's (owner, 2026-10-17, A784).**

- **The Periods window's "+ Add period" sits beside its heading (A719, owner 2026-10-17).**
  `wt-modal` has no header slot, so the window has no modal heading: it is named by its
  `aria-label`, and `periods-list` draws an `h2` "Periods" with "+ Add period" beside it.

- **The Periods window has no "Open in Calendar"; a period row opens the period dialog (A719).**
  The window is already in the Calendar, and Painted in's chips open each painter. The row menu
  went; a bin in the pinned column opens the delete dialog.

- **The period dialog's Delete… keeps its danger look in the bottom row (A719)**, after Cancel in
  the `cancel` slot, by design-system.md → Forms (owner, 2026-10-16). The A719 mockups, drawn on
  2026-10-15 before that rule, draw it plain.

- **No redirect for an old `/manage/periods` address (A719).** Until Waitron is in production
  there is no backwards-compatibility code (CLAUDE.md §3); the address falls back as any unknown
  page does.

- **Periods and staff roles pick from thirteen calendar colours, in rainbow order (owner,
  2026-10-17, option (a) of the A753 swatch board, `docs/backlog/mockups/a753-calendar-colours/`).**
  Red, orange, amber, lime, green, teal, cyan, blue, indigo, purple, pink, brown, grey
  (`CALENDAR_COLOURS`, `packages/venue-service/src/hours-types.ts`). The order is the board's; it
  is the order the colour panel shows and the order a new period or staff role takes the first
  unused colour in. **2026-10-18, A783:** sixteen, adding yellow after amber, sky after cyan and
  magenta after purple (`packages/shared/src/calendar-colours.ts`); a fourth new period or role
  now takes yellow.

- **A new staff role's colour is chosen once, when its dialog opens
  ([A753 plan](../superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 5; plan default,
  sent to the owner as an FYI).** It is the first colour, in `CALENDAR_COLOURS` order, that no other
  role uses, or the first (red) when every colour is used. If the roles list arrives after the
  dialog opened, the marks on the colours update but the chosen colour does not move. The other
  roles never include the one being edited, nor the one the dialog has just created and stays open
  on when only its people failed to save.

- **The Staff roles list names every holder, whatever their status ([A753 plan](../superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 6; plan
  default, sent to the owner as an FYI).** The names come from the Staff roles list route, which
  `venue.view` opens, not from the people list, which needs `person.manage`. Every active person's
  name was already readable without signing in (`GET /management-api/staff-roster`); a pending or
  suspended holder's name is the one widening. The receipt is in #1828.

- **The Staff roles list shows five holders' names, then "plus N more" ([A753 plan](../superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 7;
  chosen on the screen, 2026-10-17, and sent to the owner as an FYI).** `HOLDER_NAMES_SHOWN`
  (`packages/staffing/src/dashboard/staff-roles-screen.ts`) stays 5, chosen on the demo venue: at
  1280 px wide, ten names (a role held by 12 people) overflowed the People cell and hid "plus 2
  more", while five fit on one line; at 390 px the table scrolls sideways at either value. The
  pictures are in #1828.

- **The Calendar has no Year | Month switch; the title moves between views (A759, owner
  2026-10-16).** A month's name in the Year opens that month; in the Month's "‹ February 2026 ›" the
  year is a link that opens the Year; the Week opens from the day box's "Open this week"; there is
  no Week button. The Month's "‹ title ›", and Staffing's, keeps one width, as wide as the
  longest month-and-year title in any interface language, so the arrows stay put. When the Year
  cannot be read it lists the twelve month names, so the Month stays reachable. The station Times
  tab's year and Staffing's year are plain text, since neither has a Year view.

- **The Week's address takes over `view/week` ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 1; plan default, sent to the owner as an FYI, 2026-10-17).** The Week is
  `/manage/opening-hours/view/week[/department/<id>|/station/<id>][/week/<yyyy-mm-dd>]`, matching the Year's and
  the Month's addresses. An old `view/week` bookmark now opens the Week instead of the season
  painter; the painter keeps its own `/view/season/…` addresses, and an address with no view that
  names a season, department, zone or `?station=` still opens it.

- **Every block in the Week shows its whole label on pointing or tapping, not only the clipped ones
  ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 4; plan default, sent to the owner as an FYI, 2026-10-17).** Telling which labels are clipped would mean measuring text, and a
  label that fits, shown again in full, says nothing wrong. The tip sits above the block, and below
  it only when there is no room above it inside the area the Week scrolls in.

- **The Week draws every day on one scale, the week's longest day ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 5; plan default, sent to the owner as an FYI, 2026-10-17).** Each
  block sits on its own day from that day's changeover, so a shorter day's track ends early and the
  ruler and the blocks agree on a week holding a 25-hour day. Deliberate limit: a week whose days
  have different changeovers (a scheduled change of when the business day starts) labels the ruler
  from Monday's.

- **On a phone the Week shows one day, below 560 px of its own width, the Month's breakpoint
  ([A722 Part 2](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 11; plan default, sent to the owner as an FYI, 2026-10-17).**
  A `ResizeObserver` reads it, because the narrow Week draws different things and its ‹ › step a
  day. The phone's day title has no year link, following board 5; the Year is one press further,
  through the Month's year link.

- **The Week's `week` pair holds the shown date, not a Monday ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 2; plan default, sent to the owner as an FYI, 2026-10-17).**
  At desktop width the Week shows the Monday-to-Sunday week holding it, on a phone that day alone,
  so ‹ › step a week or a day and resizing a window keeps the address. A missing, malformed or
  out-of-range date shows the week (or day) holding the venue's today, and the address is left as
  written, as a bad month is.

- **Nothing is painted in the Week, and it has no long press ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 7; plan default, sent to the owner as an FYI, 2026-10-17).**
  A day's name opens the day box, and making a special day is one press further, from there.

- **"Open this week" is in the day box over the Year and the Month, for a viewer too, and not over the Week ([A722 Part 1](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 8; plan default, sent to the owner as an FYI, 2026-10-17).**
  It changes nothing, so a viewer gets it. It is the box's last button.

- **A prep station in the Calendar's Show draws one row per department that sends it dishes, named by the department even when only one does ([A722 Part 3](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 10; plan default, sent to the owner as an FYI, 2026-10-17).**
  The Times tab names a lone row after the station, and keeps doing so. The day box still lists
  every department's opening hours: it is about the day, and a station is a way of looking at the
  dates. If the station list cannot be read, Show offers departments only, with no alert.
  **2026-10-17:** A725 retires the Times tab; Calendar's station view above remains the current
  surface. The earlier sentence about the lone Times row records the pre-retirement behavior.

- **A read-only Calendar offers no prep stations in Show ([A722 Part 3](../superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 12; plan default, sent to the owner as an FYI, 2026-10-17).**
  Stations go only to those who could already open the Times tab, which needs
  `venue_service.manage`. A read-only Calendar reads no station list and no station times, and
  ignores a `station` in its address. Whether a supervisor (`venue.view` without
  `venue_service.manage`) gets a read-only station view is the owner's open question: backlog.md,
  "Supervisors have no dashboard path to a prep station's times".

- **A viewer gets the day box too (A720, 2026-10-15).** A viewer's box makes no special day; it
  offers "Show {season}'s standard week", which opens the read-only painter. In Staffing a viewer's
  box offers "Show {special day} staffing" and "Show {season}'s standard week".

- **The Calendar's keys (A720, 2026-10-15).** The arrow keys move and pick one day, Shift with an
  arrow stretches the run, Enter opens the special-day editor and Space opens the day box; for a
  viewer both open the box. In a screen reader's reading mode Enter arrives as a click and opens the
  box, whose special-day action opens the editor for that day; a run is picked with Shift and the
  arrows in its focus mode.

- **Picking a run on a phone (A720, 2026-10-15).** A tap picks a day and opens its box, and a finger
  that moves at once scrolls the page. A long press starts a run, a move after it stretches the run,
  and a lift with no move opens the editor on the day or on the run that holds it. The owner may
  overrule this.

- **A run that crosses another special day's date (A720, 2026-10-15)** opens a new special day
  holding every date of the run, and its Save is refused for the held date
  (`special_day.date_taken`). A double-click or long press on a held date opens that special day
  instead.

- **Staffing's month (A720, 2026-10-15)** has no legend, and its year is plain text, since Staffing
  has no Year view (A759). Its day box lists each area's number of people; role names and times
  wait for the month read to carry each block (backlog: "Staffing's day box: each area's staff
  roles and times").

- **The "VAT class for new products" default is a venue setting (owner, 2026-10-16, A755).** It sits
  on Venue settings' Defaults card beside the default receipt language, and both are saved together
  under `venue.configure`, not `catalogue.manage`.

- **Venue settings' Venue card says why a field is locked in one sentence per reason at its foot
  (owner, 2026-10-17: accepted as built, A755)**, such as "Locked: the venue has recorded sales.",
  and the "· locked" marker beside the field names which field it is, where the mock-up's foot
  named the field in the sentence.

- **A venue's province never changes (owner, 2026-10-17).** The Venue card shows Province as a
  locked row, and `apps/server/src/venue-details.ts` refuses every province change.

- **The legal paragraph beside the fixed receipt language stays in the setup wizard (owner,
  2026-10-17)** (`fixedReceiptLocale.reason`, `apps/setup/src/screens/venue-screen.ts`), though
  A755 took it out of Venue settings.

- **Venue settings' Venue card has no "?" buttons (owner, 2026-10-16, A755)**, though its fields start
  filled in: what a change does shows in its review box once the field changes
  ([design-system.md](../developers/design-system.md) → Forms).

- **The Calendar's day box does not add a date to an existing special day (A720, 2026-10-15).** The
  ordinary-date dialog it replaced offered that; a date is added from the special day's own editor,
  whose date picker does it, and a special day is deleted from its editor too.

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
  2026-10-17, A721: the Seasons window's delete note keeps the same list.

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
  2026-10-18, A788: dated scheduling, Replace, Cancel and the pause on hours edits are retired. A new
  start takes effect at the next changeover, and opening hours stay editable while it waits; a write
  that clashes with the waiting start is refused `hours.clock_change_conflict`. See
  [the design](../superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md).


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
