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

## A493. Departments and zones as one list, edited in dialogs

**A493 (owner, 2026-10-11) — OPEN. Starts after A435 step 6 lands** (lane E, in progress). That step
changes the same screens and replaces a zone's and a department's Disable with Delete
([plan](../superpowers/plans/2026-10-11-a435-6-tables-zones-departments-delete.md)). The owner's
mockup is the private canvas https://claude.ai/artifact/Tya5FcmK39ESBkQ2hTaA7s, which has four
boards: the list, Edit department, Edit zone and Edit receipt.

**The list.** "Departments and zones" becomes one list. Each department is a row, and its zones are
indented beneath it. The columns are name, service style (how orders start), counter service (when
counter service is used) and print receipt. The row menu is the last column, keyed `actions` and
`pinned: "end"`:
- a department's menu: Edit, Add a zone, Edit receipt, Delete;
- a zone's menu: Edit, Add floor plan (Edit floor plan once it has one), Delete.

Clicking a row opens its edit dialog, as products do. The department page and its Settings, Zones
and Receipt tabs go away. With them goes a fault the owner hit: the menu link "Departments and
zones" reopened the last department instead of the list, and showed "This department no longer
exists." when that department was gone. The cause is that the shell reads the department from the
page address (`packages/venue-service/src/dashboard/venue-departments-shell.ts`, `#restore` and
`#content`).

**Zones.** A zone can set its own service settings (`zone_sale_policies`,
`packages/venue-service/src/schema/service.ts`). In the list, a value the zone takes from its
department is shown in grey italic, and a value it sets itself in normal text. The zone dialog
offers "Same as department (…)" as a choice for each setting. Each zone row has a drag handle, and
dropping a zone on another department moves it there, replacing today's "Move to department". The
row being dragged must stay visible while it moves: it follows the house rule for a dragged row
(design-system.md, the `--wt-color-surface-lifted` paragraph).

**Edit department dialog.** Department name, then trading name (moved up from "On the receipt"),
how orders start, when counter service is used, and the collection-ticket switch. "Print a receipt"
and "Print the trading name above the legal name" move to the receipt dialog. The "On the receipt"
heading and the "Edit the receipt" link go.

**Edit receipt dialog.** A wide dialog with the form beside the printed preview. It holds:
- print a receipt;
- the trading-name switch;
- print the venue's address;
- logo, phone and email;
- the description sent to the tax agency (today the venue-wide "Sent to the tax agency (not
  printed)" field on `apps/dashboard/src/screens/receipts-screen.ts`);
- subtitle and footer per language.

Each fiscal record carries its own description, but how a sale picks today's venue-wide value has
not been traced: trace it before moving the field. The languages listed are the venue's content
languages that have receipt wording (Spanish, Catalan, Galician and Basque today,
`packages/country-es/src/receipt-labels.ts`), plus the venue's receipt language, which comes first.
Headings carry the language name alone, with one line saying the others print as copies on request.
That replaces "Catalan (receipts)" and "Spanish (copies)"
(`apps/dashboard/src/screens/department-receipt-editor.ts`). The language rule is A497's.

**The venue receipt page goes.** There are no venue-wide receipt defaults any more
(`apps/dashboard/src/screens/venue-receipt-defaults-editor.ts`). Each department holds its own
logo, subtitle, footer, address switch and tax-agency description. A new department starts with an
empty receipt. The venue's receipt language moves to Venue settings. Nothing is live, so stored
venue defaults may be dropped rather than carried over (CLAUDE.md §3, last rule).

## A495. Change the business-day start from a future date

**A495 (owner, 2026-10-11) — OPEN.** Fiscal-adjacent: the owner lands it.

Today the time zone and the business-day start cannot be changed once the venue has a sale, an
order or a daily close (`apps/server/src/venue-details.ts`, A261 step 7, #1281). The reason is in
[the venue details plan](../superpowers/plans/2026-10-05-venue-details.md), items C4 and C5:
- reports work out each day's window from the CURRENT time zone and start, so a change would
  regroup old sales;
- a daily close is append-only and hash-chained, and it stores its business day but not the start
  used to work it out, so recomputed reports would disagree with recorded closes.

The owner wants the start to be changeable. Store it with the date it takes effect, so earlier days
keep the start they had, and have reports, closes and anything else keyed by business day read the
start in force on each day. The same plan lists those other readers: station overrides (C6), and
backups and email (C8). Whether the time zone takes the same route is part of the design. Related
open entry: "Changing the business-day start after saving service hours" (A366-1 follow-up).

## A506. Opening hours rebuilt around seasons and special days

**A506 (owner, 2026-10-11) — OPEN.** Agreed with the owner over mockups. Spec (2026-10-11, three defaults asked of the owner):
[opening hours seasons design](../superpowers/specs/2026-10-11-opening-hours-seasons-design.md). Supersedes
section 9.2, and the named-day hours of section 7, of
[the 2026-10-07 service times spec](../superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md).
Pre-live, so venues reset rather than carry today's hours across (CLAUDE.md §3).

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
  optionally repeating on the same dates every year. Dates are added on a small calendar, singly or
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

**Taken in from older entries.**
- Real-week headings: a date heading must not repeat the weekday, and the date and Today marker
  stay readable in EN/ES, both themes, at 1280 and 390. Receipt: Lane D
  `receipts/a366-2/task22-review.md` and `receipts/a366-2/finish-visuals`.
- Dated-save refusals: a refusal naming no field, on an editor saving several dates, shows only
  beside the action that failed and keeps its retry and draft. The slice 2 Task 22 review saw one
  general refusal beside unrelated dates' Save actions (`opening-hours-week.ts`,
  `opening-hours-zone-week.ts`). Receipt: Lane D `receipts/a366-2/task22-review.md`.

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
- Where the read-only prep station times live, now that the tabs go; and whether the month's "All
  departments" picker is enough of the old All departments view.
- What the till sells at a moment is decided by these hours, so the sale-path resolver's
  season-then-special-day layering needs real-database tests across a season boundary and across
  midnight.

## Decisions and deliberate limits

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
