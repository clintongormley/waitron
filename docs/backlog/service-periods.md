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
row being dragged must stay visible while it moves, which is the same fault as A499's column
chooser.

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

## A494. The Venue settings page: layout, editing and the legal name

**A494 (owner, 2026-10-11) — OPEN.**

- **Scrolling.** The page scrolls the header bar away but is cut off where the left menu ends, so
  its foot cannot be reached.
- **Layout.** It uses a lot of space. Show the address as one block of text, with no label per
  line.
- **Fixed identity.** At the top, show the legal name, tax ID and country as one compact, read-only
  line. They never appear on the edit form: no screen can change them (`apps/server/src/venue-details.ts`
  edits name, address, province, time zone and business-day start only).
- **The locked note.** In edit mode, "The venue has recorded sales; this value is locked." appears
  under each of the three locked fields. Say it once.
- **"?" buttons.** The address fields' "?" buttons (`wt-help-tooltip`,
  `apps/dashboard/src/screens/venue-details-panel.ts`) fall under A237's rule and are listed there.
- **Switching tabs.** Edit mode survives a switch to another Venue settings tab and back. With
  nothing changed, a switch leaves edit mode. With changes, it brings up the unsaved-changes prompt.
  The panel has a draft scope (`draftScopeFor`), but whether a switch with real changes prompts
  today was not tried.
- **VAT class for new products** (A356, #1371). It moves to Products and menus under its own
  heading. Today it is a second, unheaded panel on the venue details tab ("catalogue-defaults" in
  `apps/dashboard/src/dashboard-app.ts`), shown only to people with `person.manage`, the
  staff-management permission. Give it a products permission.
- **Changing the legal name, keeping the tax ID.** Add a guarded "Change legal name" action on
  venue details. It applies from the next sale; receipts already issued and records already filed
  keep the old name. The Veri\*Factu hash does not include the name: `buildCadenaAlta` in
  `@waitron/verifactu` 0.2.1 (`dist/huella.js`) hashes the tax ID, invoice number, date, invoice
  type, tax and total amounts, the previous hash and the record's time. So the chain still verifies
  across the change; prove that with a test. `tenants` is a write-path table that only
  `packages/provisioning/src/venue-apply.ts` may write (`scripts/write-path-tables.json`), so this
  adds a writer and changes that list. Fiscal-adjacent: the owner lands it.

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
