# Service periods, opening hours and departments — detail

The open entries are listed in [the backlog](../backlog.md), under "Service periods, opening hours and departments". This file holds
their full text.

## Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC APPROVED 2026-10-07

- **Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC
  APPROVED 2026-10-07; remaining work is slice 7 and slice 6 Part C, each planned
  then built without stopping for the owner**
  ([slice 1 plan](../superpowers/plans/2026-10-07-a366-slice-1-service-periods.md); slice 2 plan
  written ahead: [slice 2 plan](../superpowers/plans/2026-10-08-a366-slice-2-zone-closed-times-and-named-days.md)). Opening hours and the menu timetable become one idea: a period is
  a name with one customer menu plus staff-only menus, a department's day is time ranges each given
  a period, with last-order and leftover windows set by its signed end offset. Zones can be closed for part of
  their department's time; prep stations lose their hours and fallbacks; routing cells can name
  periods; a printer shared by stations prints one combined ticket; watchers become kitchen
  screens and monitors on device profiles; receipts gain department overrides/translated text with
  live venue defaults.
  [Spec](../superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md); §13 is
  the seven-slice build order and §15 the defaults the owner accepted. It replaces A254 §4, A261
  §4–§7 in part, and §2 of the devices, menus and service zones spec; it folds in S11.
  Slice 5's plan is written ahead of lane D (A366-5p, 2026-10-08): [slice 5 plan](../superpowers/plans/2026-10-08-a366-slice-5-monitors.md),
  in two pull requests — kitchen screens and monitors after slice 1 (Part A, #1479), and watchers
  retired after slice 4 (Part B, #1502): watcher copies
  and slips, the watcher routes and refusals, the Prep stations Watchers tab and the four watcher
  tables are gone, and a pass printer is a printer listed on every station. A venue's existing
  watchers and their printer settings are deleted with the tables, so its pass printer prints
  nothing until a manager lists it on every station (decision P5; pre-live, no data migration). Revised 2026-10-08 to the owner's answers (any device may run a station or pass
  screen; a kitchen display's screen has buttons; a monitor has none), with the decisions the
  revision added listed at its end.
  Slice 7's plan is written ahead of lane D too (A366-7p, 2026-10-08): [slice 7 plan](../superpowers/plans/2026-10-08-a366-slice-7-receipts-per-department.md),
  revised 2026-10-10 to the owner's later receipt overrides, in two pull requests: each department's
  receipt with translated subtitle and footer, then the department page's Receipt tab after
  slice 6. Parts 3A and 6A have landed (#1469/#1488). Slice 7's pure shapes,
  two-language resolver, validators and scoped department persistence are built on Lane E's
  receipt branch, together with department/defaults routes and bounded global reads.
  Thermal receipts now resolve the saved department and current venue defaults; automatic
  document failures use a savepoint while the sale and drawer keep their own failure rules.
  A4/PDF presentation and delivery contacts are also built on the receipt branch.
  Draft previews now compose department translations and unsaved venue defaults through POST,
  with an independent language. Server ticket constructors now attach current receipt trim,
  address and separate venue settings. The till now renders that answer's presentation and
  boot no longer carries authored receipt text or address. Invoice-first, recovered-card and
  cash replay checks are built. The department draft/save editor is mounted on the receipt
  branch, with active-default selection, disabled-department maintenance and authored-draft
  previews and a separate preview-language picker. The independent venue defaults editor is
  staged on that branch with its own
  query/save scope, refusal and reconnect checks; mounting it on the page, separate
  language/description actions, remaining page lifecycle checks and caller retirement remain.
  This documentation revision is complete: venue logo/subtitle/footer stay live defaults,
  A4 omits optional current address, and slice 7 adds no consent step. The separate core
  delivery rewrite is [one backlog entry](printers.md#remove-the-consent-step-from-emailed-receipts).
  Slice 4's plan is written ahead of lane D (A366-4p, 2026-10-08): [slice 4 plan](../superpowers/plans/2026-10-08-a366-slice-4-prep-stations.md),
  revised 2026-10-09 to the owner's answers to its 28 decisions and re-read on main, in two pull
  requests. Part A is built: combined tickets on shared printers, period choices in routing cells,
  the station editor, and the "Where is this made?" tester and the Stations tab's live kitchen
  numbers removed. Part B (#1497) is built: it removes station hours and fallbacks, asks what to do with unfinished
  dishes at closure or Disable, and shows each station's computed times in Opening hours.
  The owner answered its decisions 29–37 on 2026-10-09; the changes
  to 29, 33 and 35 are built (A455), and 32 needed nothing.
  Slice 6's remaining work is Part C's floor-plan entry,
  in Lane D after A429. [Slice 6 plan](../superpowers/plans/2026-10-08-a366-slice-6-departments.md).

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

Tabs without tables and the remaining department-name survey stay open. Re-check the advisor
questions in [the earlier spec](../superpowers/specs/2026-10-03-departments-service-styles-hours-design.md)
and the compliance question list before carrying them forward. A366 supersedes its service-style
and hours proposals; the historical spec keeps its dated pointers.

## Smaller notes from the Hours reviews

- Smaller notes: the participant-failure route case checks the status, not the body's code;
  nothing pins which of two repeated
  midnights a clock change picks; with
  the whole-venue closure on, a kept period at a skipped minute is refused on a field the closure
  has disabled; on a phone the calendar's cells break a long
  special-date name mid-word (a design choice for the owner). The separate Hours client's
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
