# Delete hardware and venue setup, archive products for good (design)

Status: design, 2026-10-08, backlog A435. Written from `main` 49a80d770. Six pull requests, one per step in
[Build order](#build-order); each gets its own plan.

## What the owner asked for

The owner wants to delete printers, devices and most other things in the database cleanly, rather
than only disabling them. The usual obstacle is an id held by a historical record, such as a sale or
a print job.

Decisions taken while designing, all by the owner on 2026-10-08:

1. **Deletion is a permanent deleted state, not row removal.** The row stays in the database and the
   thing is gone everywhere a person can see or use it. Removing rows was rejected: it would drop
   about forty database links, and rebuild sales, the fiscal invoice records, time entries and order
   changes to do it, the last two hash-chained.
2. **Disable stays beside Delete for hardware only**: printers, card readers and devices. Kitchen
   stations, courses, tables, zones and departments lose Disable and get Delete only. Products lose
   Disable and get Archive only.
3. **Products are archived for good.** No way back. A new product may take an archived product's
   name.
4. **Archived products appear in a read-only Archived filter** in the product list.
5. **Deleting a printer cancels the jobs waiting on it**, after the person confirms.
6. **Archiving a product that a live or scheduled menu includes is refused** until the menu is
   republished without it.
7. **In scope:** printers, card readers, devices, kitchen stations, courses, tables, zones,
   departments and products. **Out of scope:** nodes, invoice series and locations, because the
   fiscal chain and invoice numbering hang off them, and people, whose time entries are a legally
   required working-time record (anonymising a person is separate work).

## The shared model

### Two shapes of deleted

- **Hardware (printers, card readers, devices)** keeps its on/off switch and gains a `deleted_at`
  time. Delete sets `deleted_at` and switches the record off, so every list, till read and check that
  already skips disabled records skips deleted ones with no change. The places that deliberately show
  DISABLED records — the disabled lists, the Enable actions, hardware matching when a printer or
  reader is found again, and a disabled device knocking to come back — learn to skip deleted ones
  too.
- **Everything else (products, kitchen stations, courses, tables, zones, departments)** already has
  an `active` column. For these kinds "off" becomes "deleted" (archived, for products), permanently:
  the server refuses every change from off to on, and the Enable and Disable actions and the
  "show disabled" toggles go. No column is added. A record disabled today is therefore deleted once
  its step lands, which needs no data conversion and is allowed before go-live (CLAUDE.md §3, "No
  backwards-compatibility … until Waitron is in production").
- **A course nothing refers to is still removed for real**, as `removeCourse` does today
  (`apps/server/src/kitchen.ts`); only a course something refers to takes the deleted state.

### What a deleted record frees

Every uniqueness rule on these kinds stops counting deleted records, so a new record can take the
name. For hardware the physical identity is freed too: a USB or Bluetooth printer's key
(`printers_local_key_key`, `packages/db/src/schema/printers.ts`) and a card reader's provider id
(`card_readers_provider_ref_key`, `packages/payments/src/schema/card-readers.ts`) become unique only
among records that are not deleted. Finding the same hardware again creates a NEW record; today it
re-enables the old one. The rules that already count disabled records (and so must change) include
`station.name_taken`, `zone.name_disabled`, `department.name_disabled` and the course name key; the
step for each kind lists the rest from the schema, not from this sentence.

A deleted record cannot be enabled, edited or brought back. A read or write that names one by id
answers the kind's existing `*.not_found` code, except a product, which stays readable and refuses a
write with a new `product.archived`.

### Three kinds of link

A row elsewhere that holds a deleted record's id is one of three kinds:

- **History** — finished records that never change: sales, fiscal records, settled orders, finished
  print jobs, payments, incidents, drawer openings, time entries. **Left exactly as they are.**
  Because the deleted record's row stays, every screen and report that looks its name up still finds
  it.
- **Live work** — things in progress: queued print jobs, sign-ins, payments in progress, seated
  parties, unfinished kitchen tickets, open orders. Each kind below says whether live work **refuses**
  the delete or is **ended** by it.
- **Settings** — configuration links: a device's receipt printer, a station's printers, routing rules,
  device-profile links. **Removed**, or cleared where the link is a column on another record.

### Every delete is two calls with one set of rules

1. **The impact read** answers, for one record: what refuses the delete (each reason, with what it
   names), what live work the delete will end (counts), and which settings links it will remove or
   clear (named where a person would recognise them: devices, stations, profiles, menus).
2. **The delete** recomputes the same impact inside ONE `withTransaction` and acts on it. A refusal
   that appeared since the read refuses the delete with its code. Live work that appeared since the
   read is ended too; the confirmation's counts are what was true when it was shown.

The dashboard shows the impact in one confirmation dialog, with the refusals first, then what will be
ended, then what will be removed, and the words "This can't be undone." The delete action is
disabled while any refusal stands. The dialog is ONE shared component, placed where both
`apps/dashboard` and `packages/venue-service/src/dashboard` (zones, departments, stations) can import
it; the printers step decides where, following the design-system rules for whichever home it picks.

Each refusal answers its own error code, named for the domain concept. Existing codes that already
say the right thing are reused — `device.payment_in_progress`, `reader.payment_in_progress`,
`zone.table_in_use`, `department.last_active` — and new ones follow their siblings' prefixes.

### Routes

`DELETE /management-api/stations/:id`, `/tables/:id` and `/zones/:id` disable today. They become the
real delete, and the department delete route in `packages/venue-service/src/routes.ts` likewise.
For stations, courses, tables, zones and departments, an `active` field in a `PATCH` is refused,
because disabling no longer exists for them; the course delete route keeps its `?disable=true` form
only until the courses step removes it. Every dashboard caller moves in the same change. Products
are the exception: Archive stays the product editor save with `active: false`, and the on-to-off
change in `patchProduct` is where its refusals run. Hardware gains a delete route beside its
existing disable route. Each delete route requires the same permission as editing that kind today.

### What does not change

No fiscal, sales or hash-chained table is touched, and no history column loses its database link.
The schema changes are `deleted_at` on the three hardware tables and narrower uniqueness rules.
Adding a column does not rebuild a table on this engine; a step that must change a CHECK beside the
new column follows the two-generation rule in CLAUDE.md §3.

## Each kind

The links below were inventoried on 2026-10-08 by reading the schema and the code; each step's plan
re-checks its kind's list against the schema before building on it.

### Printers

- **Refused by:** nothing.
- **Ended, after confirmation:**
  - Jobs waiting, printing, or failed but still retryable are marked failed with a "printer deleted"
    reason. Cash-drawer jobs are included. The dialog shows the count.
  - Receipt invoice deliveries waiting on it are ended as disabling ends them today
    (`endDeactivatedInvoicePrintDeliveries`, `apps/server/src/invoice-print.ts`).
  - Whoever holds it, if it is a portable printer, is released (`printer_holders`).
- **Removed or cleared:** a device's receipt, payment-slip and drawer printer (cleared; the dialog
  names the devices); its rows in `device_profile_printers`, `station_printers` and
  `watcher_printers` (the dialog names the profiles, stations and watchers).
- **Freed:** its USB or Bluetooth key, and its host and port for discovery's match
  (`printers-screen.ts`'s `#disabledPrinter`), so finding it again offers to add a new printer.
- **History kept:** finished print jobs, drawer openings, receipt reprints. The order-detail reprint
  list (`apps/server/src/orders-list.ts`, `readReprints`) and the job preview inner-join `printers`,
  and keep working because the row stays.

### Card readers

- **Refused by:** a payment in progress on it (`reader.payment_in_progress`).
- **The card provider:** a reader still paired is unpaired at the provider first, exactly as Unpair
  does (`POST …/readers/:id/unpair`, `apps/server/src/payments-api.ts`). If the provider cannot be
  reached the delete is refused. An already-unpaired reader is deleted without contacting the
  provider. The unpair marker stays on the deleted row; adopting the same physical reader later goes
  through the provider check and creates a new record.
- **Removed:** its rows in `device_card_readers`, `device_profile_card_readers` and
  `card_reader_holders`.
- **Not deletable:** the seeded demo reader, which management routes already hide.

### Devices

- **Refused by:** a card payment, bill payment or refund in progress on it
  (`device.payment_in_progress`).
- **Ended:** its open sign-ins and the equipment it holds, as Revoke does today
  (`POST /management-api/devices/:id/revoke`); a pending request from it to come back
  (`join_requests` carrying its id).
- **No way back:** its stored token is cleared, and the returning-device check
  (`provenDisabledDevice`, `apps/server/src/join-requests.ts`) skips deleted devices, so that browser
  knocking again arrives as a new device.
- **Removed:** its rows in `device_made_here_stations`, `device_approved_profiles` and
  `device_card_readers`.
- **Not touched:** open orders rung up on it; an order belongs to its table or bill.
- **History kept:** sales, fiscal records, order changes, time entries, bill payments, refunds,
  payments, incidents, drawer openings, daily-close snapshots. Alerts, the cash-up by device and the
  stuck-payment lists name devices through a join to `devices`, and keep working.

### Kitchen stations

- **Refused by:**
  - It is its location's default station.
  - A kitchen-screen device is bound to it; a kitchen screen must keep a station or a watcher, so it
    is moved first. The dialog names the screens.
  - A ticket not yet finished is queued, preparing or held there.
- **Cleared:** a staff choice of this station on an unsent line of an open order
  (`working_order_lines.make_at_station_id`, and `order_draft_lines` on open drafts), so the line
  routes normally when it is sent.
- **Removed:** its routing rules (the dialog counts them; those products fall back to default
  routing), its printers, watcher links, "made here" rows and device-profile links, its hours,
  special-date hours, day states and timing, its own fallback, and every other station's fallback
  that points at it (the dialog names those stations).
- **Freed:** its name.

### Courses

- **Nothing refers to it:** removed for real, as today.
- **Something refers to it:** takes the deleted state. Products set to it lose it (the dialog counts
  them; they fire earliest). Lines and tickets already in progress keep the course and fire as
  normal, because the row stays, so nothing refuses.
- **Freed:** its name.

### Tables

- **Refused by:** a party seated at it; an unsettled delivery order to it; a booking for it that is
  booked or seated. The dialog lists each.
- **Removed:** nothing; a table's only link is its own zone.
- **Freed:** its label within the zone.

### Zones

- **Refused by:** anything that refuses deleting one of its tables; an open order served in the zone;
  a pending transfer request into it; being the only zone a device profile serves (the dialog names
  the profiles).
- **Deleted with it:** its tables.
- **Removed:** its routing rules, watcher links, menu assignments, department link and sale policy,
  and its place in device profiles. Where it was a profile's starting zone, the profile starts in its
  next remaining zone.
- **Freed:** its name.

### Departments

- **Refused by:** being the last department (`department.last_active`); anything that refuses deleting
  one of its zones; an open order served in it; a pending transfer request to or from it; being the
  only department a device profile can serve.
- **Deleted with it:** its zones and their tables.
- **Removed:** its menu assignments, timetables, periods and slots; its opening and special-date
  hours; its sale policy; its transfer desks and every transfer route to or from it; device profiles'
  access to it.
- **History kept:** issued receipt headers and line contexts already copy the department's name.
- **Freed:** its name.

The zone and department dialogs count everything deleted with them and name every refusal wherever it
sits, so one dialog shows the whole picture.

### Products

- **Archive replaces Disable** on the product list row, the editor footer, the variant table and the
  folder bulk action; deleting a folder's contents archives the products in it. Products land before
  the shared dialog exists, so they keep their own confirmation dialogs, reworded and showing the
  live-menu refusal. The confirmation says "This can't be undone." The dashboard's warnings that say "You can enable it again"
  (`product.disable_warning` and its siblings in `apps/dashboard/src/i18n/strings.ts`) are rewritten.
- **Refused while a published menu includes it**, live now or scheduled to go live: as a dish, as any
  of its variants, as an extras item, or as a home-screen shortcut. The refusal names the menus. A
  published version that is neither live nor scheduled does not count. To retire something on a live
  menu: take it out, publish, then archive; the sold-out switch stops sales meanwhile. A bulk archive
  or folder delete with any such product inside is refused whole, and lists them.
- **Variants:** archiving a product archives every variant. A variant can be archived on its own. No
  save brings an archived variant back.
- **The server refuses every write to an archived product or variant** with `product.archived`:
  switching it on, editing it, and adding it to an extras list, which today is allowed. Adding one
  to a menu or a home-screen shortcut is already refused, with `menu_section.membership_invalid`
  (`checkRef`, `packages/catalogue/src/section-members.ts`), and keeps that code. The paths to close, from the 2026-10-08 inventory:
  `patchProduct` (`packages/catalogue/src/operations.ts`), `writeProductVariants`
  (`packages/catalogue/src/variants.ts`), the product editor save
  (`PUT /management-api/products/:id/editor`), the product update route, and the extras-list save
  (`packages/catalogue/src/extras.ts`). The dashboard's three Enable actions are removed.
- **Removed when archived:** its places in menu drafts (as today) and in extras lists (new; the
  dialog says so in its warning rather than counting them, which would need a new read). Its recipe, options and routing rules stay, for the read-only view.
- **The sold-out switch** is left as it was. Every reader that sells a product requires it to be on
  AND available, so an archived product never sells whatever the switch says; the read-only view does
  not show the switch.
- **Dashboard:** the Status filter offers Active and Archived; an archived product opens read-only,
  with no Save, Archive or availability control; the "Show disabled" toggles go.
- **Configuration export and import** carry archived products still archived, as today.
- **Backlog:** the owner's decision answers the entry "There is no permanent delete for a product
  that was never sold", which the commit adding this spec removed in favour of A435.

## Build order

Each step is one plan and one pull request, in this order:

1. **Products: permanent archive.** Catalogue only and independent of the rest.
2. **Printers.** Builds the shared pieces: the impact read and delete pattern, `deleted_at` and the
   narrower uniqueness rules on hardware, and the shared confirmation dialog.
3. **Card readers.**
4. **Devices.**
5. **Courses and kitchen stations.**
6. **Tables, zones and departments.**

Every step touches permissions, a migration or a route other code depends on, so each takes the full
review path.

## Testing

Each step carries, for its kinds:

- each refusal, asserting its error code, never just that an error was thrown;
- each piece of live work ended, and each settings link removed or cleared, checked in the database;
- after a delete, the name — and for hardware the physical identity — can be taken by a new record,
  and finding the same hardware again creates a new record;
- a deleted record refuses Enable, edit and every other write;
- history still names it: for printers the reprint list; for devices an alert, the cash-up and the
  stuck-payment lists; for stations a kitchen screen's queue;
- the impact read and the delete agree, and a refusal created between the two makes the delete
  refuse;
- the dialog shows refusals, ended work and removed links, and its delete action stays disabled while
  a refusal stands.

The products step adds:

- each live-menu refusal — dish, variant, extras item and shortcut, on a live version and on a
  scheduled one — and that a version neither live nor scheduled does not refuse;
- an archived dish, variant and extras item, each with the sold-out switch still on, is unavailable
  on a live menu and cannot be ordered or paid for;
- every former Enable path refuses with `product.archived`, including adding to an extras list;
- the existing tests asserting a restore (the inventory found them in `product-names.db.test.ts`,
  `menu-removal.test.ts`, `product-editor.test.ts`, `variants.db.test.ts`, `catalogue-api.test.ts`
  and the dashboard's catalogue, product-list, product-editor, variant-table and catalogue-browser
  suites) become refusal tests rather than being deleted.
