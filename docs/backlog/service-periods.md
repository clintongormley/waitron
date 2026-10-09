# Service periods, opening hours and departments — detail

The open entries are listed in [the backlog](../backlog.md), under "Service periods, opening hours and departments". This file holds
their full text.

## Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC APPROVED 2026-10-07

- **Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC
  APPROVED 2026-10-07; remaining work is slices 4–7, each planned then built without
  stopping for the owner**
  ([slice 1 plan](../superpowers/plans/2026-10-07-a366-slice-1-service-periods.md); slice 2 plan
  written ahead: [slice 2 plan](../superpowers/plans/2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md)). Opening hours and the menu timetable become one idea: a period is
  a name with one customer menu plus staff-only menus, a department's day is time ranges each given
  a period, with last-order and leftover windows set by its signed end offset. Zones can be closed for part of
  their department's time; prep stations lose their hours and fallbacks; routing cells can name
  periods; a printer shared by stations prints one combined ticket; watchers become kitchen
  screens and monitors on device profiles; receipts move to departments with translated text.
  [Spec](../superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md); §13 is
  the seven-slice build order and §15 the defaults the owner accepted. It replaces A254 §4, A261
  §4–§7 in part, and §2 of the devices, menus and service zones spec; it folds in S11.
  Slice 5's plan is written ahead of lane D (A366-5p, 2026-10-08): [slice 5 plan](../superpowers/plans/2026-10-08-a366-slice-5-monitors.md),
  in two pull requests — kitchen screens and monitors after slice 1, watcher printers retired
  after slice 4. Revised 2026-10-08 to the owner's answers (any device may run a station or pass
  screen; a kitchen display's screen has buttons; a monitor has none), with the decisions the
  revision added listed at its end.
  Slice 7's plan is written ahead of lane D too (A366-7p, 2026-10-08): [slice 7 plan](../superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md),
  revised 2026-10-09 to the owner's receipt answers, in two pull requests: each department's
  receipt with translated subtitle and footer, then the department page's Receipt tab after
  slice 6. Lane E's build follows slice 6 Part A before
  slice 7 Part A; the documentation revision is complete and receipt implementation stays open.
  Slice 4's plan is written ahead of lane D (A366-4p, 2026-10-08): [slice 4 plan](../superpowers/plans/2026-10-08-a366-slice-4-prep-stations.md),
  in two pull requests — combined tickets on shared printers, period choices in routing cells and
  the station editor after slice 1; station hours, fallbacks and the tester removed, with each
  station's worked-out times, after slices 2 and 3 — with its open decisions at its top.
  Slice 6's plan is written ahead of lane D (A366-6p, 2026-10-08): [slice 6 plan](../superpowers/plans/2026-10-08-a366-slice-6-departments.md),
  in three pull requests — the department list and page, "How orders start" and the service
  settings shared by departments and zones, now (it needs slice 1 only); each zone's closed times
  on its Zones tab after slice 2; the floor plan on the Zones tab after A429's editor — with its
  open decisions at its top.

## Opening hours dated-save refusal presentation

Reproduce a server refusal with no field on a week with multiple own-hours named days. The slice 2
Task 22 review reported the same general refusal beside unrelated dates' Save actions
(`opening-hours-week.ts` / `opening-hours-zone-week.ts`). Keep the failed date's retry and draft
scope while limiting the message to the action that failed. Receipt: Lane D
`receipts/a366-2/task22-review.md`; final reviewers did not run this presentation case.

## Opening hours real-week headings

Remove the repeated weekday from a real-week row's heading: it combines the full weekday with a
formatted date that also names the weekday. Keep the date and Today marker readable in EN/ES,
both themes, at 1280 and 390. Receipt: Lane D `receipts/a366-2/task22-review.md` and final visual
captures under `receipts/a366-2/finish-visuals`.

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

## Changing the business-day start after saving service hours

The second A366-1 review directly changed the stored setting from 05:00 to 03:00. A saved
22:00–04:30 range and an all-day 05:00–05:00 range then reported closed; re-saving the latter
returned `menu_timetable.invalid` (`empty`). The settings route was not run. Reproduce through
that route before deciding whether to remap, refuse the change, or require re-authoring the hours.
Receipt: campaign lane D `receipts/a366-1/finish-second-report.md`, finding 2 (2026-10-08).

## Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly implemented through A261

- **Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly
  implemented through A261.** The first department is named after the venue; the
  four-value service style splits into separate settings, and a tab no longer needs a table; hours
  come from venue-wide day types plus a calendar; a per-department switch prints the trading name.
  [Spec](../superpowers/specs/2026-10-03-departments-service-styles-hours-design.md); §6 lists what is
  open, including advisor questions Q21, Q14, Q27 and Q22.
  Its §4 day types and §5 placement are revised by A261. A261 step 2 names the sole department on
  Departments and zones; other screens still await their own one-department survey. Tab billing
  remains open; the shared calendar is built by A261 step 5 (below), and its public holidays by
  step 6.

## Smaller notes from the Hours reviews

- Smaller notes: the calendar's day read repeats the subject precedence `resolveSubjects` holds
  and matches a cell by id alone; one `hours-client.test.ts` case detaches in the same turn and
  cannot fail; the participant-failure route case checks the status, not the body's code; the
  time-zone route case never asserts `nextTransition`; nothing pins which of two repeated
  midnights a clock change picks; no test opens Hours from a department's link end to end; with
  the whole-venue closure on, a kept period at a skipped minute is refused on a field the closure
  has disabled; on a phone the calendar's cells break a long
  special-date name mid-word (a design choice for the owner); the test where the live feed
  delivers nothing does not check that its two reads cover different ranges; and no test sends
  the default station with a blank inherited cell.

## Province edits in Venue details

- **Province edits in Venue details.** `apps/server/src/venue-details.ts` still refuses every
  province change (`geography_context` before sales). The step 7 plan allowed a change keeping
  the same derived context, holiday region included, once a sourced province-to-region map
  existed; step 6 ships that map (`packages/country-es/src/data/regions.ts`). Allowing it is a
  separate decision; nothing in step 6 changes it.

## Smaller notes from the public holidays reviews

- **Smaller notes from the reviews:** there is no control to clear a chosen area back to "not
  chosen" (the route accepts it); the area names "Arán" and "Lleida, fuera del territorio de
  Arán" are Spanish data labels shown untranslated in English; `renameSpecialDate`
  checks the name before the date's id, so a blank name for another venue's date answers
  `hours.invalid` rather than not found.

## Decisions and deliberate limits

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
