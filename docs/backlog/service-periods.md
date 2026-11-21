# Service periods, opening hours and departments — detail

The open entries are listed in [the backlog](../backlog.md), under "Service periods, opening hours and departments". This file holds
their full text.

## Refresh service settings on an open till

A till already signed in keeps its loaded payment flow when a department or zone policy changes.
Its menu-state poll does not carry the policy, and reloading offers after a menu change still
keeps that flow. A fresh sign-in reads the changed policy. Decide when an empty till should adopt
new settings and how an existing basket keeps its recorded facts, then update the poll and its
consumer. Left open by A366 slice 6 Part A. This entry does not establish when the behavior began.

## Split an order's recorded service mode into two facts

The owner requested this future change on 2026-10-09 while answering slice 6 decision 4.
`working_orders.service_mode` combines where service happens and when payment is due.
Replace it later with two plain facts: served-at (`table/counter`) and payment-due
(`before-kitchen/collection/end-tab`). The split is outside slice 6: keep its existing three
modes (`table_tab/prepay/ticket_then_pay`), recorded orders and till behaviour unchanged there.

Trace the writer/snapshot and every reader before choosing the replacement contract. Cited
readers at the slice 6 audited base `87b46b024fcac68a6240949964768b9fbc7d4972`:
`apps/server/src/till-sale.ts:1548` (payment dispatch), `apps/server/src/receipt-print.ts:216`
(collection ticket at payment), `apps/server/src/working-order.ts:3111-3128`
(`serviceModesMatch`) (2026-10-30: deleted in A803 slice 3 Task 3b; the comparison now lives only in `assertServiceModesMatch` and `modesMatch` in `working-order.ts`) and `apps/server/src/move-bill.ts:245` (table-mode check). Also trace
venue-service's record/retarget/read context functions and the till API/client/order-flow
readers listed in slice 6 decision 4. These are source pointers, not a runtime receipt or
an exhaustive future implementation plan. Preserve payment, money/VAT, hashes, drawer and
login behaviour; decide the future schema/contract and test it separately.

## Smaller notes from the Hours reviews

Nothing pins which of two repeated midnights a clock change picks. The separate Hours client's
read-window and lifecycle notes and station-cell checks are retired with that page (slice 4 Part B).

## The Business day start dialog repeats the server's conflict-counting rule

The Business day start dialog works out its conflict count by repeating the server's rule for
counting a conflict once whatever its season (`#conflictLines`,
`apps/dashboard/src/screens/business-day-start-editor.ts`), so a change to that rule on the server
would make the dialog miscount without any test noticing. The server could return how many conflicts
it left off its list instead, which adds a field to the shared preview type.

## The special-day-then-season rule is written out in several places

With named days gone (A506-5), the rule "special day, then season" is still written out in
`day-resolver.ts` (twice, for departments and for zones) and `business-day-schedule.ts`; special-day paint is
read by separately written queries in `special-days.ts` and `business-day-schedule.ts`;
`specialDateIn` and `sharedSpecialDate` live in the database module `special-days.ts` rather than
the browser-safe repeat rules. Each could collapse to one place.

## Two date helpers read years 0 to 99 as 1900 to 1999

`isLocalDate` (`packages/venue-service/src/hours-rules.ts`) and `addMonths`
(`packages/venue-service/src/dashboard/calendar-grid.ts`) still build dates with `Date.UTC`, which
reads years 0–99 as 1900–1999 (#1616 fixed `addDays` and `weekdayOf`). Unreachable from the screens,
which start at year 100; changing `isLocalDate` would change which dates the server accepts from
outside (menu publication dates, imports), so it needs a decision.

## A special-day grid uses the first date's changeover

The special-day editor draws every date from the first date's business-day start and shows a
notice when the selected dates have different starts. Zone closures are stored whole and read
against each actual day's department hours; drawing each date on its own start remains open.

## Loose ends left by A788

Found while building A788 (the business-day start changes at the next changeover). Unless an entry
says it was run, it comes from a per-task review recorded in the build's ledger and was read in the
code, not run again here.

- **A862.** The special-day painter's season days draw a past day's range uncut where the Calendar cuts it
  (`readSeasonDays`, `packages/venue-service/src/opening-hours-calendar.ts`, passes no cut).
- **A863.** A clash sentence names a range by its period, zone or department and its times only
  (`clockChangeConflictText`, `packages/venue-service/src/dashboard/clock-change-conflict.ts`), so
  a range in another department or on another weekday reads as if it were the one being edited.
- **A864, the clash list.** `businessDayClockConflicts`
  (`packages/venue-service/src/business-day-schedule.ts`) keeps the first 20 distinct ranges with
  the season set aside, then returns every conflict row for those ranges, one per season the range
  is painted in; `conflictCount` counts distinct ranges. The dialog shows each row as its own line
  and adds what was counted beyond the list to the count (`#conflictLines`,
  `apps/dashboard/src/screens/business-day-start-editor.ts`), with no "and N more" line.
- **A865, the clash order.** One implementer saw the order between departments vary from run to
  run, and a review traced the order of one special day's dates to their random row ids.
  Reported by A788's implementers, not reproduced since.
- **A866.** A zone keep-open saved for tonight in a deactivated department still blocks a start
  change (`keptOpenConflicts`, `packages/venue-service/src/business-day-schedule.ts`, reads every
  department's zone extensions). (2026-10-24, A789 slice 2: the period half is gone.)
- **A867, a crossing range hides an overlap.** A range that fails on its own is listed as crossing
  the new start; the day's other ranges are marked overlapping only when no range fails on its own
  (`overlapping` in `businessDayClockConflicts`). A review's probe: 13:00–16:00, 15:00–17:00 and
  22:00–04:30 moving 05:00 → 03:00 lists only 22:00–04:30. No test pins either half.
- **A868.** Renaming a special day is refused while any stored range clashes with a waiting start,
  though renaming a period or a season is not (`saveSpecialDay`,
  `packages/venue-service/src/special-days.ts`).
- **A869, a one-off day after the change.** While 03:00 waits, a one-off special day on 2026-11-05
  with 04:00–12:00, which fits the 03:00 start that date will have, is refused
  `special_day.invalid` (reason `order`): `saveSpecialDay` parses one-off dates under the starts
  already in force (`settledClock`). Task 11 left it unchanged, per its implementer, read in the
  code.
- **A872, repeated work.** A preview or a Save (`apps/server/src/business-day-start.ts`) works the
  plan out with `planBusinessDayStart`, and `clockTransitionAt`
  (`apps/server/src/business-day-changeover.ts`) works it out again, then once more for each of up
  to 20 moments when it looks for when a Save refused across a clocks change can be made.
- **A873.** A refused Save's message in the Business-day start dialog stops "The business-day clock
  changed. Close and reopen to review it." from appearing when the clock then changes
  (`business-day-start-editor.ts`, the guard in `willUpdate`).
- **A874.** The Business day card re-reads at a waiting change's moment by the browser's clock, and
  once more if that answer still shows the change waiting; a server clock still behind at the
  second answer leaves the New start row up until the next refresh.
- **A876, a long day under a special day's paint.** On a day a start change makes longer than 24
  hours, a season range past the 24th hour is cut at it when any special day is painted on that
  date, and kept whole when none is: `cutSeason` (`packages/venue-service/src/day-resolver.ts`)
  caps the day at 1440 minutes for the paint layer, which works on one 1440-minute day. Found by
  A788's finish review, which ran it. Next: teach the paint layer a day longer than 1440
  minutes, or decide the cut is the intended drawing.
- **A877, one write gate for waiting starts.** Each hours writer derives its clocks and calls
  `assertWaitingChangeFits` itself. Move that check into the shared write gate.

## Loose ends left by A720.

- Try the Calendar's long press on a real phone. The long press that opens the special-day
  editor, and the long press then drag that picks a run (`day-picking.ts`), were checked only
  under headless Chromium's touch emulation. Check on an Android and an iOS phone that the page
  stops scrolling, no number is selected, and no click or menu follows the lift.

## Loose ends left by A506-4 (#1597).

- `assertOwnPeriods` names a refused slot by its sorted position, not its position in the request
  (`packages/venue-service/src/menu-timetable.ts`; read in the code, not run).
- The clock-skip check runs before touching ranges are joined: two halves of one period meeting
  at a skipped 02:30 are refused, while the joined range is accepted.
- [The special-day-then-season rule is written out in several places](#the-special-day-then-season-rule-is-written-out-in-several-places).
- `business-day-schedule.ts` copies the changeover lookup of
  `packages/shared/src/business-day-clock.ts` (`oldCutoverOn`) to avoid validating the clock on
  every day; a lookup exported from `shared` that validates once would remove the copy.

## A1084. A confirmed late dish routes by the period running when it is sent, not the period the kitchen agreed for

A routing cell's line for Lunch does not apply to a Lunch dish confirmed
after Lunch: it goes where the running period's line, or the cell's every-period target, sends it.
A table's mojito on the Midday menu, with Cocktails routed Lunch → Downstairs bar and otherwise
Upstairs bar, confirmed at 14:05 is made Upstairs (`apps/server/src/till-api.service-periods.test.ts`,
"makes a table's cocktail confirmed late at 14:05 at the Upstairs bar, not Lunch's Downstairs
bar"). Routing it by the ended period is a module-contract change across the fire, hold and
release paths: the router resolves one period per department per resolver (`routingAt`,
`packages/venue-service/src/routing-store.ts`, filling `periods` from `runningPeriod`);
`MakerResolver.makers` and `extraMakers` answer by product, not by line
(`packages/module/src/module.ts`), so one fire holding a tortilla confirmed late and one picked
now could not be routed apart; the resolver is asked for extras made at their own station, by
`fireLines` and by `heldNoRouteLines`, and held dishes are routed again when released
(`apps/server/src/working-order.ts`); and the line's context stores the ended period's name, not
its id. Left open by A789 slice 3, #2051 (plan D33).

## Bundle: Business-day start checks after A760

4 entries, size L.

- **Loose ends left by A788 (the business-day start changes at the next changeover).**
  [Detail](service-periods.md#loose-ends-left-by-a788)
- **Loose ends left by A506-3 (#1591).**
  [Detail](service-periods.md#the-business-day-start-dialog-repeats-the-servers-conflict-counting-rule)
- **Loose ends left by A506-4 (#1597).**
  [Detail](service-periods.md#loose-ends-left-by-a506-4-1597)
- **The start-time part of the business-day check's `transition_strip` reason never decides it**
  (`inStrip(minutes(startsAt))`, `business-day-schedule.ts`): `endpoint_day` wins first.
  Delete it or give it a case that needs it — left open by A789 slice 1, #1948.

## Decisions and deliberate limits

- **A877, watcher 2026-11-21.** Keep the hours read per waiting change. The Save planner keeps at
  most two changes waiting.

- **Nothing stops a dish being ordered for someone standing at a counter** (owner, 2026-11-17).
  A counter zone sells every menu of its department, burger included; telling a standing guest
  "you'd need a table for this" is the waiter's job. A till at a counter can order for a counter
  sale or for a table elsewhere. A per-zone choice of menus (A1548) was withdrawn for this. Set menus are the exception: they go only on
  a seated table's bill ([set-menu design](../superpowers/specs/2026-11-17-set-menus-design.md)).

- **A1546, watcher 2026-11-15 17:05:** special-day bands and month runs use dashed purple; season lines remain solid and purple remains selectable. Day boxes show selected stations, or all without a station filter, to managers in every view. Viewers keep their station-read exclusion. The season-hours link remains on special dates too.

- **Pop-up in painters (A1545, owner, 2026-11-15).** Keep the small period pop-up inside
  the Calendar painters; elsewhere use the Periods pages. The owner chose “Pop-up in painters”
  in the watcher’s window at 19:31, recorded by the watcher at 19:55.

- **A holiday name has one date per year in each place** (lane C's default, 2026-11-15, with the
  2027 holiday data). `readHolidayDates` (`packages/venue-service/src/holidays.ts`) keeps only a
  name's first date in a year. Rather than change that reader, the test "never gives two holidays
  one name in a year, in any place a venue can choose" in `packages/country-es/src/holidays.test.ts`
  fails on shipped data that gives a name two dates in one place.

_2026-11-14, A1536: Seasons and Periods now have module-contributed pages beside Calendar.
The A719/A721 window decisions below describe their earlier presentation; see
[the current page contracts](../developers/design-system.md#periods-page). Cancel on Seasons now
restores its draft in place; navigation asks before discarding. The page's chooser uses pale season
tints and full phone labels, and its fields name their row._

_2026-11-15, A1545 Periods slice: the list’s rows now open individual edit pages and its pinned
row menus offer Edit and Delete. The Calendar painters retain their period dialogs pending the
owner’s answer; the historical A719 dialog decisions below do not describe the list’s editor._

_2026-11-15 at 19:31: the owner chose to keep the painter pop-ups; see “Pop-up in painters”
above. The pending question in the earlier slice note is closed._

_2026-11-15, A1545 Seasons slice: Seasons now has a list and individual Add/Edit pages, with
deletion in the list menu. The older A721 table-editing receipts below describe its earlier
presentation; see the [current contract](../developers/design-system.md#seasons-page)._

_2026-11-14: DEAD-CODE-1 retires the separate menu-week and closed-week HTTP routes;
the season painter continues saving through the season-week route._

- **Zone closures are stored whole and apply only during the department's resolved hours**
  (owner, 2026-11-06; admission answer, 2026-11-15). Hours changes retain the stored stretch.
  Outside department hours, seating, guest and bill moves and transfer acceptance follow the
  same rules as other zones of a closed department; ended-menu orders still ask for late-send
  confirmation. The owner confirmed at 01:54, “Yes, like any zone”, to the corrected question
  “After the department closes, may staff use 'Kitchen agreed' to send a late order into a zone
  whose own closure is still running?” The watcher recorded that answer in Lane K's questions.md
  and cleared landing. This replaces the 00:41 answer's withdrawn ordering premise.
  The demo Terrace's stored closure ends at literal 05:00, including with a 06:00
  business-day start; 05:00–06:00 is outside that stored closure.
- **One legal seller for the first venue (owner, 2026-10-21, A898).** Every department
  sells under the same company and tax identity. A different legal seller needs its own venue.

- **`seasons.colour` has no CHECK and no trigger (A721 plan, Decision 1; plan default).** A CHECK
  makes drizzle-kit rebuild `seasons`, whose `DROP TABLE` empties every season's weeks; a wrong value
  only paints grey. `saveSeasons` and the configuration transfer refuse one
  (developers/conventions-data.md, "2026-10-17, A721").

- **Existing seasons became grey; a new venue's are Spring green, Summer amber, Autumn orange and
  Winter blue (A721 plan, Decision 2; plan default, sent to the owner as an FYI, 2026-10-17).** No
  data migration, pre-live. (2026-10-27, A918 slice 3: the colours are the same in every
  language; the names are now written in the venue's staff language, from
  `packages/venue-service/src/starter-content.ts`.)

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
  _2026-11-12: the action in Decisions 12 and 14 now reads "Add season" / "Añadir temporada", per
  [Wording](../developers/design-system.md#wording)._

- **The bin removes a row from the draft and a note under the table says what Save will delete
  (A721 plan, Decision 15; plan default, sent to the owner as an FYI, 2026-10-17)**: where its days
  go and which departments lose hours, with no confirmation step. The last row's bin is disabled;
  Cancel is the only undo.

- **A season list arriving while the Seasons window is open is folded into the draft field by field
  (A721 plan, Decision 17; plan default, sent to the owner as an FYI, 2026-10-17).** A field the
  person changed keeps their value; a season deleted elsewhere is dropped if untouched or binned,
  and kept with "This season no longer exists." if touched, and Save waits until it is binned.

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
  2026-11-17: all retired `/manage/…` addresses follow that same rule; dashboard paths now start at `/`.

- **Periods and staff roles pick from thirteen calendar colours, in rainbow order (owner,
  2026-10-17, option (a) of the A753 swatch board).**
  Red, orange, amber, lime, green, teal, cyan, blue, indigo, purple, pink, brown, grey
  (`CALENDAR_COLOURS`, `packages/venue-service/src/hours-types.ts`). The order is the board's; it
  is the order the colour panel shows and the order a new period or staff role takes the first
  unused colour in. **2026-10-18, A783:** sixteen, adding yellow after amber, sky after cyan and
  magenta after purple (`packages/shared/src/calendar-colours.ts`); a fourth new period or role
  now takes yellow.

- **A new staff role's colour is chosen once, when its dialog opens
  ([A753 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 5; plan default,
  sent to the owner as an FYI).** It is the first colour, in `CALENDAR_COLOURS` order, that no other
  role uses, or the first (red) when every colour is used. If the roles list arrives after the
  dialog opened, the marks on the colours update but the chosen colour does not move. The other
  roles never include the one being edited, nor the one the dialog has just created and stays open
  on when only its people failed to save.

- **The Staff roles list names every holder, whatever their status ([A753 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 6; plan
  default, sent to the owner as an FYI).** The names come from the Staff roles list route, which
  `venue.view` opens, not from the people list, which needs `person.manage`. Every active person's
  name was already readable without signing in (`GET /management-api/staff-roster`); a pending or
  suspended holder's name is the one widening. The receipt is in #1828.

- **The Staff roles list shows five holders' names, then "plus N more" ([A753 plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a753-calendar-colours.md), Decision 7;
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

- **The Week's address takes over `view/week` ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 1; plan default, sent to the owner as an FYI, 2026-10-17).** The Week is
  `/manage/opening-hours/view/week[/department/<id>|/station/<id>][/week/<yyyy-mm-dd>]`, matching the Year's and
  the Month's addresses. An old `view/week` bookmark now opens the Week instead of the season
  painter; the painter keeps its own `/view/season/…` addresses, and an address with no view that
  names a season, department, zone or `?station=` still opens it.
  2026-11-17: the Week's current address starts `/opening-hours/view/week`; the `/manage` prefix above is retired.

- **Every block in the Week shows its whole label on pointing or tapping, not only the clipped ones
  ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 4; plan default, sent to the owner as an FYI, 2026-10-17).** Telling which labels are clipped would mean measuring text, and a
  label that fits, shown again in full, says nothing wrong. The tip sits above the block, and below
  it only when there is no room above it inside the area the Week scrolls in.

- **The Week draws every day on one scale, the week's longest day ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 5; plan default, sent to the owner as an FYI, 2026-10-17).** Each
  block sits on its own day from that day's changeover, so a shorter day's track ends early and the
  ruler and the blocks agree on a week holding a 25-hour day. Deliberate limit: a week whose days
  have different changeovers (a scheduled change of when the business day starts) labels the ruler
  from Monday's.

- **On a phone the Week shows one day, below 560 px of its own width, the Month's breakpoint
  ([A722 Part 2](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 11; plan default, sent to the owner as an FYI, 2026-10-17).**
  A `ResizeObserver` reads it, because the narrow Week draws different things and its ‹ › step a
  day. The phone's day title has no year link, following board 5; the Year is one press further,
  through the Month's year link.

- **The Week's `week` pair holds the shown date, not a Monday ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 2; plan default, sent to the owner as an FYI, 2026-10-17).**
  At desktop width the Week shows the Monday-to-Sunday week holding it, on a phone that day alone,
  so ‹ › step a week or a day and resizing a window keeps the address. A missing, malformed or
  out-of-range date shows the week (or day) holding the venue's today, and the address is left as
  written, as a bad month is.

- **Nothing is painted in the Week, and it has no long press ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 7; plan default, sent to the owner as an FYI, 2026-10-17).**
  A day's name opens the day box, and making a special day is one press further, from there.

- **"Open this week" is in the day box over the Year and the Month, for a viewer too, and not over the Week ([A722 Part 1](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 8; plan default, sent to the owner as an FYI, 2026-10-17).**
  It changes nothing, so a viewer gets it. It is the box's last button.

- **A prep station in the Calendar's Show draws one row per department that sends it dishes, named by the department even when only one does ([A722 Part 3](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 10; plan default, sent to the owner as an FYI, 2026-10-17).**
  The Times tab names a lone row after the station, and keeps doing so. The day box still lists
  every department's opening hours: it is about the day, and a station is a way of looking at the
  dates. If the station list cannot be read, Show offers departments only, with no alert.
  **2026-10-17:** A725 retires the Times tab; Calendar's station view above remains the current
  surface. The earlier sentence about the lone Times row records the pre-retirement behavior.

- **A read-only Calendar offers no prep stations in Show ([A722 Part 3](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-17-a722-calendar-week-view.md), Decision 12; plan default, sent to the owner as an FYI, 2026-10-17).**
  Stations go only to those who could already open the Times tab, which needs
  `venue.configure`. A read-only Calendar reads no station list and no station times, and
  ignores a `station` in its address. Whether a supervisor (`venue.view` without
  `venue.configure`) gets a read-only station view is the owner's open question: backlog.md,
  "Supervisors have no dashboard path to a prep station's times".

- **A viewer gets the day box too (A720, 2026-10-15).** A viewer's box makes no special day; it
  offers "Show {season}'s standard week", which opens the read-only painter. In Staffing a viewer's
  box offers "Show {special day} staffing" and "Show {season}'s standard week".
  _2026-11-15, A1546: Opening hours now links its season-hours line instead of a separate Show/Edit button; Staffing keeps its actions._

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
  has no Year view (A759). Its day box shows each area's total and the role, headcount and times
  of each staffing block, as the [19 November plan](../superpowers/plans/2026-11-19-dash-staffing-day-box.md) describes.

- **The "VAT class for new products" default is a venue setting (owner, 2026-10-16, A755).** It sits
  on Venue settings' Defaults card beside the default receipt language, and both are saved together
  under `venue.configure`, not `menu.manage`.

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
  [spec](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/specs/2026-10-11-opening-hours-seasons-design.md).

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
  [design](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/specs/2026-10-11-a495-business-day-history-design.md) records DST and
  UTC-clock limits. `apps/server/src/business-day-history.test.ts` compares recorded fiscal,
  invoice-series and close rows before and after scheduling; it does not establish external
  filing behavior.
  2026-10-18, A788: dated scheduling, Replace, Cancel and the pause on hours edits are retired. A new
  start takes effect at the next changeover, and opening hours stay editable while it waits; a write
  that clashes with the waiting start is refused `hours.clock_change_conflict`. See
  [the design](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md).


- **Hierarchy Delete is permanent (A435 step 6, 2026-10-11).** One complete impact is rechecked
  inside the write transaction. (2026-11-14, A1528: the preview no longer lists the item's own
  settings; see conventions-data.md → Permanent hierarchy deletion.) Live work refuses; no work is abandoned. All saved, today, reset
  and join descendants are removed together. Department-owned routing, periods, hours overrides
  and transfer settings go; shared menus, venue calendars and holidays stay. Deleted receipt
  settings and media stay for internal printing, with no editor or import/export access.
- **Profiles and defaults stay within surviving configuration (A435 step 6, 2026-10-11).** A
  nonretired ordering profile bound to the department, or losing its only effective zone, refuses
  Delete even without an active device. A removed start/default uses the declared surviving order,
  never invented configuration or wider access. An explicit empty KDS parent stays empty; Every
  stays Every. A default change does not rewrite historical department attribution. Closed today,
  opening hours and hardware Disable remain separate. The
  [reconciliation](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md)
  records the complete limits.

- **Permanent station Delete is separate from Close for today (A435 step 5, 2026-10-10).**
  Close keeps its Send/Leave choice. Delete refuses held, queued or preparing food and explicit
  effective KDS bindings, including off devices; fired ready food may stay as history. Deleting
  a base routing rule removes all its period children. Incoming daily destinations clear without
  reopening the referring stations. A fully Every-stations screen does not block deletion, and
  an emptied explicit/profile screen scope stays empty rather than widening to Every.

- **Zone and period extensions remain separate (A366 slice 3 Part B, 2026-10-09).** Cancelling
  a department's period extension does not delete its zones' overrides. **2026-10-24, A789 slice
  2:** the period extension is gone; a zone extension is measured against its department's own
  hours for the day, and the zone line still reports its own closure.

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
  _2026-11-14 (A1308 5h):_ the old table is removed; see the [drop plan](https://github.com/clintongormley/waitron/blob/0a049fa0ff84a09bb0eb863af66338c63ebeb087/docs/superpowers/plans/2026-11-08-a1308-5h-locations-drop.md).
- **Venue details (A261 step 7, #1281).** Changes needing another fiscal/geographic context or
  history removal use a separately approved setup/reset instead. Later
  Hours/holidays/menu builds retain their own compatibility tests.
- **Address changes during a local-holiday or area save (#1305's open points, A261 step 6).** An
  address change that lands after Save is pressed but before the page has read the new address is not
  caught: the route takes no expected address, and an area save already on its way has the same
  gap. The address-change warning names only the new city, though a province change also
  triggers it. The owner decided on 2026-10-06 not to queue these, or the clear-area control
  (a way to clear a chosen holiday area back to "not chosen"; the route accepts it).

### A723's plan defaults sent to the owner as an FYI

Left open by A723 (#1849).

A723's plan made these choices by default and sent them to the owner to overrule if wanted
([plan](../superpowers/plans/2026-10-18-a723-painters-standard-week.md), "Decisions this plan
makes"):

Decisions 1 and 3 are superseded by the stored-whole, read-intersection rule above (2026-11-15).

- Decision 6: the Opening hours screen closes a painter after a clean save; paint made during the
  save keeps it open, unsaved.
- Decision 7: a zone's day on which its department is closed shows "<department> closed all day"
  behind the zone's paint, which stays drawn on top.

A762's plan, Decision 3 (#1850), superseded Decision 9 (the special-day editor kept the day's name as its
heading): the editor is now titled "<name>: special day, <dates>".

### A762's plan defaults sent to the owner as an FYI

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
  _2026-11-12: the unnamed new day's heading now reads "Add special day" / "Añadir día especial",
  per [Wording](../developers/design-system.md#wording)._
- Decision 8: the Staffing month draws a special day's dates as one purple run over the season's
  line, joined across the gaps within a week and broken at a week's end; two special days on
  neighbouring dates are two runs.
- Decision 10: the special-day editor's Delete comes after Cancel with the danger look, and Save
  stands apart. This extends the owner's 2026-10-16 rule for a form's bottom row
  (`[Cancel] [Delete] … [Save]`, design-system.md → Forms) to a painter's top bar.

- **A failed re-read of the prep-station list keeps the stations already shown** in the
  Calendar's Show picker; only a list that never loaded leaves Show with departments only. Kept
  so a brief network drop does not lose a manager's chosen station — left open by A722 Part 3's
  Codex review, #1834.
