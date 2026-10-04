# The dashboard's Orders screen — design

> **Update, 2026-10-02 (B27c):** Find a bill on tills and handhelds replaces the counter's
> read-only Left without paying list and its GET route. Earlier descriptions of the list record
> the starting design.

> **Update, 2026-10-02 (B27b):** The owner's later C126 decision supersedes the "Invoice not
> credited" mark below. C126 is to credit an invoiced bill in full when cancelled, so the Orders
> screen shows Cancelled and its credit note without that mark. The earlier paragraphs record the
> design before this decision; Task 2's screen follows the later rule.

**Status:** approved by the owner on 2026-10-02 (~07:50, relayed by the supervising watcher), with
answers to the seven choices; section 12 records them, and each is also stated at its site as
"Owner, 2026-10-02". Two answers left something for this document to recommend: what a person
without `report.view` must not see (section 6), and how a reprint is audited (section 4.5). Each is
marked **Owner point (recommended default)**, with the alternative, so the owner can overturn it;
the plan builds the default. Facts about today's code were first read on `main` at `5c1a1c2df`,
and re-checked on `658399acc` (2026-10-02, after #1009–#1016); each carries a pointer, and none
was run unless the text says so.

## 1. Why

Once a bill is paid, nothing in Waitron shows it again. No till or dashboard screen lists finished
orders; the dashboard's Sales and takings screen shows totals only (`docs/backlog.md`, B16's entry:
"completed orders cannot be looked up"). Bills a table left without paying (B17, #991) are listed
only in the counter's held-orders card on the till, which the default phone and tablet layouts do
not have, and nothing on any screen collects them: the list is read-only
(`apps/till/src/widgets/unpaid-departures.ts`, its header comment). (Update 2026-10-02, B31: a
handheld whose layout adds a held-orders card now loads and shows the list too.)

The owner, 2026-10-01 ~19:21, on B17's question 2: "really all orders should be visible on the
dashboard so we can just filter by unpaid". And: once that screen exists, the till's "Left without
paying" list goes, and a returning guest's debt is collected at the till from a lookup.

## 2. Words used here

- **Bill** — a list of items paid as one. The code calls it a *working order* (`working_orders`,
  `packages/db/src/schema/orders.ts`). A counter (deli) order is a bill with no party.
- **Party** — guests seated together; holds tables and one or more bills (`parties`,
  `packages/db/src/schema/parties.ts`).
- **Invoice** — the simplified (or full) invoice a bill is filed as: a row in `sales`
  (`packages/db/src/schema/sales.ts`). A bill has at most one (`sales_working_order_id_key`).
- **Credit note** — an invoice that corrects an earlier one (`sales.corrects_sale_id` set). Its total
  may be negative.
- **Invoice with no bill** — a `sales` row whose `working_order_id` is null. A walk-up sale at the
  till is NOT one: `POST /api/sales` with no `workingOrderId` creates an open bill first and files
  the sale against it (`createOpenOrder` in `payWorkingOrder`, `apps/server/src/till-sale.ts`,
  around `:487`; read, not run). The invoices with no bill are credit notes, full invoices that
  replace simplified ones (substitutions, `sale_substitutions`), and sales the demo seed and other
  scripts write straight through core `recordSale` (`apps/server/scripts/demo-seed/seed-sales.ts`,
  around `:278`).
- **Debt** — the amount a bill still owes after its table left without paying (`unpaid_departures`).
- **Copy** — a receipt printed again for an invoice already filed. It carries the receipt's
  "duplicate" line (`DUPLICADO` in Spanish: `formatReceipt`, `apps/server/src/receipt-ticket.ts:170`;
  the words, `packages/country-es/src/receipt-labels.ts:25`) and files nothing.
- **Business day** — the trading day a moment belongs to, using the location's time zone and its
  day cut-over hour (`packages/reporting/src/business-day.ts`).

## 3. How it works today

**What is stored.** A bill's own status is one of `open`, `placed`, `settled`, `abandoned`
(`orders.ts:26-34`, with the database refusing other transitions). `placed` means sent and frozen:
under the `invoice_first` order flow its invoice is issued then; under `ticket_then_pay` the invoice
is issued only when it is collected (`apps/server/src/till-sale.ts`, around `:1593`). A bill has an
`opened_at` (indexed: `working_orders_opened_at_idx`) and a `settled_at`, but no "placed at" column
and no "opened by" column; the moment it was placed is the `order_placed` entry in
`order_amendments` (`packages/db/src/schema/order-amendments.ts`).

**What is derived.** Everything else is read from other tables:

| Fact                     | Where it comes from                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Invoiced                 | a `sales` row whose `working_order_id` is the bill                                                         |
| Paid                     | a `sale_settlements` row for that invoice                                                                   |
| Voided                   | a `sale_voids` row for that invoice; `recordVoid` leaves the bill's own status as it was (`packages/core/src/record-void.ts`) |
| Credited                 | credit notes whose `corrects_sale_id` is the invoice; `correctionsCents`, `apps/server/src/sale-due.ts`    |
| Amount still owed        | invoice total plus its credit notes (`readIssuedSales`, `sale-due.ts`); before an invoice, the lines less received bill payments (`apps/server/src/parties.ts`, around `:438`) |
| Left without paying      | an `unpaid_departures` row for the bill (`packages/db/src/schema/unpaid-departures.ts`)                    |
| Cancelled                | status `abandoned`                                                                                         |

**Invoice numbers** are stored as a series id plus an integer, and shown as `<series code>/<number>`,
for example `A/12` (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:87`). The whole string
is not stored in any core table, so a search by invoice number parses the code and the number.

**Who.** An invoice records the person who rang it (`sales.operator_id`); each line records the
person it is credited to (`working_order_lines.credited_to`); a party records who opened and closed
it. None is a foreign key: `persons` belongs to another migration set.

**Where.** Neither a bill nor an invoice stores a location. It is reached through the till
(`tills.location_id`) or the node (`nodes.location_id`), or per bill through
`order_service_contexts.location_id` (venue-service). Only one location exists today: first boot
creates one (`apps/server/src/provision.ts`, around `:53`) and multi-location is in the backlog.

**Existing lists.** The till reads open bills (`GET /api/working-orders`), counter orders waiting
(`GET /api/orders/counter-waiting`) and unpaid departures (`GET /api/unpaid-departures`). The
dashboard's report routes (`/management-api/reports/*`, `apps/server/src/report-api.ts`) are gated
on `report.view` and return totals, never individual invoices. The scripts under `apps/server/scripts` issue credit notes
through `recordCorrection` (`settle-invoice-first.ts`, `daily-close-demo.ts`, `modelo-303-demo.ts`).
_(2026-10-02, C126: the till's cancel route now issues one too, for the whole invoice, when it
cancels a placed order whose invoice was issued — `creditWholeInvoice`,
`apps/server/src/cancel-credit.ts`.)_
Which till or dashboard paths, if any, reach a void, a credit note or a substitution was not traced
for this spec, and none needs to be: the screen reads these rows whoever wrote them.

**Who reaches the dashboard.** Any active person with a password can sign in: sign-in checks the
person's status and password, not their role (`completeManagerLogin`,
`packages/identity/src/manager-login.ts:49-58`), and an invitation takes any role, staff included
(`POST /management-api/staff`, `apps/server/src/management-api.ts:826-872`). Both read, not run. A
staff-role session gets no sidebar (`hasNav`, `apps/dashboard/src/dashboard-app.ts:1165`) and
every screen it asks for resolves to its own schedule (`#permittedScreen`, `:1364`).

**Reprinting today.** Three routes print something again (found with
`grep -rn "reprint\|resend" apps/server/src`, then read, not run):

- `POST /api/sales/:id/reprint` (`apps/server/src/till-api.ts:1484-1492`) prints a copy of a
  bill's receipt. It takes the bill id and needs a till session and no permission; when the
  request carries a device, that device must have the `print-receipt` capability (the check is
  skipped when it carries none, `assertDeviceCapability`, `apps/server/src/device-session.ts:346`).
  `reprintSale` → `printSaleReceipt(…, duplicate: true)` (`apps/server/src/till-sale.ts:632-648`,
  `:1743-1749`) rebuilds the receipt from the filed record (`readSettledTicket`, `:568`) and
  enqueues one `document` job (`enqueueReceiptReprint`, `apps/server/src/receipt-print.ts:134-150`)
  on the receipt printer of the till the server is configured with — the route passes the
  server's own config (`till-api.ts:1489`) and the printer is found by its `tillId`
  (`receipt-print.ts:64`), not by the calling device, unlike collecting, which takes the till from
  the device (`deviceTillCfg`, `till-api.ts:1569`). It prints in the language the sale was filed
  in (`sales.locale`; `receipt-print.ts:89`), so a location whose receipt language changed since
  (#1014) still gets the original's language. No job is made when that till has no active receipt
  printer, and no row records who asked. Its sibling `POST /api/sales/:id/receipt`
  (`till-api.ts:1470-1482`) prints the unmarked original instead.
  _(2026-10-02, C114: the route now takes an optional `language`, and the till asks for one when
  the country offers several; a request naming none still prints in `sales.locale`. See
  `docs/backlog.md`, C113's entry.)_
- `POST /management-api/print-jobs/:id/resend` (`apps/server/src/print-api.ts:1096-1102`), the
  Printers screen's resend, gated on `print.resend`, sends a finished document job's stored bytes
  again to the same printer (`resendPrintJob`, `packages/printing/src/outbox.ts:72-84`). A
  receipt resent this way is a byte-for-byte repeat of the original job, unmarked if that was the
  original, and a receipt never printed (the location's receipt printing is not automatic:
  `enqueueSaleReceipt`, `receipt-print.ts:122-126`) has no job to resend. It records no person
  either: `print_jobs` has no person column (`packages/db/src/schema/print-jobs.ts`).
- `POST /api/orders/:id/reprint` (`till-api.ts:1457`) reprints kitchen tickets, not a receipt.

None of the three opens the drawer: a drawer kick is a separate `drawer` job
(`receipt-print.ts:15-16`), and a drawer job can never be resent (`canResendPrintJob`,
`outbox.ts:56-66`). #1011 (B29, landed 2026-10-02) changed none of these paths: it changed how the
automatic drawer openings choose a printer (`drawerPrinter`, `receipt-print.ts:29-43`, which also
needs the till's new "Opens the cash drawer" setting, `tills.opens_drawer`), and no reprint calls
it. _2026-10-03: superseded by A238, `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`: the setting is gone, and a device's profile decides._

## 4. The proposal

### 4.1 What a row is: one bill

Each row is **one bill**, with its invoice beside it when it has one. An invoice with no bill (a
script-written sale, such as the demo seed's history) is its own row. A credit note is not a row: it
shows on the row of the invoice it corrects. A full invoice that replaces simplified ones is not a
row either: it shows in the detail of each bill it replaced, and the reports leave it out of totals
the same way (`notSubstituteClause`, `packages/reporting/src/business-day.ts`).

Why the bill and not the alternatives:

- **One row per invoice** would miss every bill not yet invoiced — open bills, and bills sent under
  `ticket_then_pay` — which are exactly the ones a manager asks about ("what is still open?").
- **One row per party** would hide a split table: two bills of one party, one paid and one owing,
  would share a row whose status is neither.
- A bill has at most one invoice, so the bill row loses nothing an invoice row would show.

A bill cancelled before anything was sent is noise in this list. A cancelled bill is listed only if
it was sent (it has an `order_placed` entry) or it held lines when cancelled (owner, 2026-10-02,
choice 6: as recommended). The plan's first task checks, on the `main` it starts from, whether a
cancelled bill keeps its lines; if it does not, the second condition is dropped and recorded.

### 4.2 Status — one per row

Each row shows exactly one status, decided in this order:

1. **Open** — the bill is `open`.
2. **Voided** — the invoice has a `sale_voids` row. It is checked this early because a void does
   not change the bill's own status, so a voided bill is still `placed` or `settled` and would
   otherwise read Waiting for payment or Paid.
3. **Left without paying** — an `unpaid_departures` row exists, the invoice is not settled, and the
   bill is still `placed`. A debt cancelled at the till afterwards reads Cancelled (rule 6), since
   the cancel route accepts any `placed` bill. _(2026-10-02, C126: no longer any. Such a bill has
   an issued invoice once its table has left, and the cancel now refuses an invoiced bill in
   several cases, some listed in `docs/backlog.md`, C126's entry; otherwise it credits the invoice
   in full, so the row reads Cancelled with Credited in full.)_ A
   debt whose credit notes bring it to nothing keeps this status, with the "Credited in full" mark
   and nothing in Still owed; the till's lookup (section 5) leaves it out, as today's till list
   does (`listUnpaidDepartures`, `apps/server/src/unpaid-departure.ts`, around `:265`).
4. **Waiting for payment** — the bill is `placed`, not settled, with no departure row.
5. **Paid** — settled. A bill paid after its table left shows **Paid**, with "left without paying
   on <date>" in its detail.
6. **Cancelled** — `abandoned`. A sent bill can be cancelled after its invoice was issued: the
   till's cancel route and `cancelPlacedOrder` (`apps/server/src/working-order.ts`, around `:4778`)
   do not look for an invoice (read, not run). Such a row reads Cancelled with an **Invoice not
   credited** mark, shows the invoice number, and leaves Still owed blank, because nothing will
   collect it. Owner, 2026-10-02 (choice 7, option a): this screen keeps the mark, and whether the
   till should refuse that cancel, or credit the invoice as it cancels, is queued separately as
   lane C's C126, which measures the gap first. This design does not change the cancel.
   _(2026-10-02, C126: the cancel now credits the whole invoice with an R5 corrective invoice in the
   same transaction, needs `sale.rectify`, and settles the invoice owing nothing, which alone
   would read Paid; since C126 `BILL_STATUS` (`apps/server/src/orders-list.ts`) checks an
   abandoned bill right after Voided, so such a bill reads Cancelled with Credited in full. Owner, 2026-10-02 ~12:05: drop the
   Invoice not credited mark — such bills show as Cancelled with their credit note. See
   `docs/backlog.md`, C126's entry.)_

Separately, a row with credit notes carries a **Credited** mark ("in full" when the credit notes
bring it to zero, "in part" otherwise). It is a mark rather than a status because a paid bill can
also be credited.

### 4.3 Filters and search

Controls above the table, applied by the server (section 4.6):

- **Status** — All, Open, Waiting for payment, Left without paying, Paid, Cancelled, Voided, plus one
  grouped choice, **Unpaid**: Waiting for payment and Left without paying together. The owner's
  "filter by unpaid" is this choice.
- **Dates** — a from/to range of business days, defaulting to today's business day, with an
  **Any date** switch. Choosing a status never changes the dates: picking Unpaid or Left without
  paying keeps the range chosen (owner, 2026-10-02, choice 3, overturning the recommended switch to
  Any date). So Unpaid on the default range shows only bills opened today, and a debt from last
  week needs Any date or a range that reaches back to it; the address can hold "unpaid, any date",
  so a link to every debt can still be shared. A bill belongs to the business day it was OPENED in,
  while the Sales screen counts an invoice on the day it was ISSUED
  (`packages/reporting/src/business-day.ts`), so a bill opened before the cut-over hour and paid
  after it falls on different days on the two screens. The screen says "opened" in its date label
  for that reason.
- **Credited** — show only rows with a credit note.
- **Staff** — one person, matching a bill when any of its lines is credited to them
  (`working_order_lines.credited_to`), because that is who served the dish (owner, 2026-10-02,
  choice 4: as recommended); an invoice with no bill matches the person who rang it. Chosen from
  everyone who appears on a bill, including people since suspended or gone, not only today's
  active staff.
- **Table** — a table label, matching any bill whose party sat at it.
- **Location** — hidden while the venue has one location.
- **Search** — one box. A value shaped like an invoice number (`A/12`) finds that invoice. A bare
  number finds that number in every series AND the bill with that order number, because the order
  number is what the ticket shows and what staff type back in (`working_orders.order_number`,
  `packages/db/src/schema/orders.ts`); a bill sent under `ticket_then_pay` has no invoice yet, so
  the order number is the only number anyone holds for it. Order numbers are not unique over time,
  so a bare number usually needs the date range. Invoice numbers also match a credit note's number
  and show the row it corrects. Any other text matches a party's name or a table's label.

### 4.4 Columns

Opened (date and time) · Bill (order number, or label) · Table or Counter · Invoice (`A/12`, with
the credit notes' numbers under it) · Status · Total · Still owed · Staff · the row menu.

**Total** is the invoice's total when there is one, otherwise the sum of the bill's lines. **Still
owed** uses the same figures the till's collect uses (`readIssuedSales` for an invoice; lines less
received bill payments before one), so the two can never disagree; it is blank when nothing is
owed. The row menu is the `actions` column, `pinned: "end"` (CLAUDE.md §3). It holds View details,
and Reprint receipt (section 4.5) for a bill with an invoice. Status, Staff and Still owed
are choosable columns.

### 4.5 What a row opens

Clicking a row opens a detail dialog (`wt-dialog`), reading one bill:

- the lines as invoiced (or, before an invoice, as they stand), with who each is credited to;
- the invoice and each credit note: number, issue time, total, who rang it;
- payments: tenders with their method and tip, bill payments taken before the invoice, and refunds;
- each line's price before any comp or discount touched it
  (`working_order_lines.list_unit_price_gross`). The adjustments themselves (who asked, who
  approved, why) are not shown: they belong to the adjustments module, which this core route may
  not name (CLAUDE.md §3, the composition rule), and that module has no read of one bill's
  adjustments. Showing them is a later item;
- the party, its tables and when it opened and closed;
- for a debt: when the table left, the reason, who recorded and who authorised it, and the amount.

The detail also lists each copy of the receipt printed from this screen: when, by whom, and on
which printer (from the reprint record below).

#### Reprint receipt

Owner, 2026-10-02 (choice 5, amended ~09:50): reprinting is in this build, to a printer the person
picks. It uses the till copy's `print-receipt` device capability when a device is bound; a browser
without a device binding needs a dashboard session. Issuing a credit note from the dashboard stays a later item of its own: there is
still no HTTP route that issues one (scripts call core `recordCorrection`, section 3).
_(2026-10-02, C126: the till's cancel route now issues one for an invoiced bill it cancels, for
the whole invoice; issuing one for part of a bill still has no route.)_

- **Who.** Any dashboard session. The till copy checks `print-receipt` on a bound device
  (`apps/server/src/till-api.ts:1484-1489`; `device-session.ts:338-350`) and allows a caller with
  no device binding. The dashboard applies the same device check and the Orders visibility scope:
  a staff session cannot print an older finished bill hidden from its list and detail.
- **Where.** In a row's menu and in its detail dialog, on a row that is a bill with an invoice,
  including Voided. An invoice with no bill (section 4.1) offers no reprint: the
  copy is rebuilt from the bill (`readSettledTicket` reads the invoice by its bill,
  `apps/server/src/till-sale.ts:568-590`).
- **Printer.** Chosen from the venue's active printers in a `wt-combobox`, read from
  `GET /management-api/orders/printers`. It lists active printers at the sale till's location for
  any dashboard session; the report's printer route requires `report.view` and cannot serve staff.
- **Route.** `POST /management-api/orders/:id/reprint` with `{ printerId }`, `:id` the bill, the
  same id the till's reprint takes. It builds on the till's copy path, not on the Printers screen's
  resend: it rebuilds the receipt from the filed record with `readSettledTicket` and lays it out
  with `formatReceipt(…, duplicate: true)`, through the same function the till's reprint will call
  once `enqueueReceiptReprint` (`apps/server/src/receipt-print.ts:134-150`) is split into "find the
  till's printer" and "enqueue a copy on this printer". The resend is not used because it repeats
  the original job's bytes, which carry no copy mark, prints only on the printer that job used,
  and has nothing to repeat for a receipt that was never printed (section 3).
- **The copy is the till's copy.** It carries the "duplicate" line, prints in the language the
  sale was filed in (`sales.locale`), is laid out for the picked printer's paper width and
  resolution (as the category report is, `report-api.ts:389-418`), and carries the practice
  warning on a Demo or Prepare venue, as the till's does (`receipt-ticket.ts:160-163`).
  _(2026-10-02, C114: `enqueueReceiptReprint` and `enqueueReceiptCopy` (split by #1027) take an
  optional `language`, so the till's copy may print its fixed words and formatting in another of
  the pack's receipt languages, names still in `sales.locale`. The Orders screen's copy passes
  none, so it prints in the language the sale was filed in.)_
- **It files nothing and changes no stored fiscal value.** It reads the invoice, its lines, its
  payments and its filed record (`backend.filedReceiptFor`, `till-sale.ts:600`), and writes no
  `sales` row, no fiscal record, no settlement and no tender: only the print job, the reprint
  record, and the session's last-seen time, which checking the permission updates
  (`resolveManagementSession`, `packages/identity/src/management-session.ts:87-92`).
- **It never opens the drawer** (CLAUDE.md §5). It enqueues exactly one `document` job and never a
  `drawer` job, and writes no `drawer_opens` row, whether or not the picked printer has a cash
  drawer. The copy's own job can be resent from the Printers screen like any document, and a
  resend never kicks the drawer (section 3).
- **Refusals.** A bound device without `print-receipt`: `device.forbidden_action` (403). A bill that does not exist, or
  has no invoice, or a row with no bill: `working_order.not_found` (404), one code for every "no
  bill with an invoice by this id", as `working_order.not_placed` covers several causes
  (`apps/server/src/errors.ts:260-264`). A voided invoice is copied as the till copies it. An unknown or inactive printer,
  or one at another location: `printer.not_found` (404), from the route's own look-up of the
  location's active printers, the code the print queue itself answers for an inactive one
  (`packages/printing/src/outbox.ts:35-39`). A missing or malformed `printerId`:
  `management.request_invalid` naming `printerId`. No new code.

**Owner decision, 2026-10-02 ~09:50: the reprint record.** Each dashboard reprint writes one row in
a new core table, `receipt_reprints` — the invoice (`sale_id`), the print job (`print_job_id`), who
asked (`person_id`) and when — in the same transaction as the print job, and the table is declared
append-only, so the record cannot be edited or deleted afterwards. Today no reprint records who
asked (section 3), so there is nothing to reuse. It is the one new table in this design, and needs
a migration; the plan's first pull request carries it. Alternatives: (b) a `requested_by` column on
`print_jobs`, which the till's reprint and the Printers resend could later fill too, but puts an
audit fact on a delivery-queue row the printer agent updates as it prints
(`print_jobs` is classified `state`, `packages/db/src/classification.ts:111`); (c) no table, only
a line in the server's log, which needs no migration but is not kept with the venue's data and is
shown nowhere. The till's own reprint is left unrecorded by this design (section 12).

### 4.6 Server

The list route, `GET /management-api/orders`, open to every dashboard session, with the limit
section 6 states for a person without `report.view` (owner, 2026-10-02, choice 2). It takes the
filters above and returns one page of rows plus a cursor for the next page; the screen shows
"Show more", as the adjustment report does
(`packages/adjustments/src/dashboard/adjustment-report-screen.ts`). Filtering and paging are done
by the server because `wt-data-table` filters and sorts only the rows it was given and has no
paging (`packages/ui/src/components/wt-data-table.ts`), and a venue's whole history is too many
rows to send. Rows are ordered newest first by `opened_at`, then id. An invoice with no bill sorts
by its issue time.

A second route, `GET /management-api/orders/:id`, returns one bill's detail, under the same limit:
a bill the list would not show the caller answers `working_order.not_found`. A third,
`GET /management-api/orders/staff`, names everyone who appears on a bill, for the Staff filter.
A fourth, `POST /management-api/orders/:id/reprint`, prints a copy (section 4.5).

Each page is read with a fixed number of queries, never one per row: the bills of the page, then
their invoices, credit notes, settlements, departures, tables and people, each in one read (the
"resolve shared data once" rule, CLAUDE.md §3). Business days use the location's clock, as the
reports do (`resolveVenueClock`, `apps/server/src/report-api.ts`). The list and detail need no new
table and no migration; the reprint record does (section 4.5). With a date range the read uses
`working_orders_opened_at_idx`; a read with no date range scans every bill (measured by the review
with `EXPLAIN QUERY PLAN` on `node:sqlite` against the plan's query shape), so an Any-date read for
Open, Waiting for payment, Left without paying or Unpaid — and every read for a person without
`report.view`, which is limited to those statuses — starts from the bills whose own status is
`open` or `placed`, through the existing `working_orders_tenant_status_idx`. Search and All with
Any date still read the whole history, a page at a time.

### 4.7 The screen

A core dashboard screen, **Orders**, in the nav's first group beside Overview and Sales, with no
permission gate, like those two (`NAV_GROUPS`, `apps/dashboard/src/dashboard-app.ts:146-153`):
every dashboard login sees it (owner, 2026-10-02, choice 2). A staff-role session, which today has
no sidebar and only its own schedule (section 3), gets a sidebar with two entries, My schedule and
Orders (section 6). For a person without `report.view` the Status control offers only the
statuses they can be shown (section 6). Its query is declared in
`apps/dashboard/src/api/live-queries.ts` with the tables it reads as dependencies, so the list
refreshes when a bill changes, and every refresh after the first read is passive (CLAUDE.md §3:
automatic dashboard reads do not keep a session signed in). The filters are kept in the address
(`apps/dashboard/src/navigation.ts`), so a link to "unpaid, any date" can be shared. A178's filled
form fields have landed for the dashboard (A178a–c: #1010, #1012, #1015; `docs/backlog.md`, A178's
entry), so the filter bar and the reprint dialog use the shared field components that
`docs/developers/design-system.md` → Forms names; the table follows
`apps/dashboard/src/widgets/product-list.ts`.

## 5. The till: collecting a debt from a lookup

The owner's point: once the Orders screen exists, the counter's "Left without paying" list is
removed, and a returning guest's debt is collected at the till. Collecting needs a till, because it
takes money: `POST /api/working-orders/:id/collect` (`apps/server/src/till-api.ts`, around
`:1563`) settles an existing invoice with the tender given, and the bill then leaves every unpaid
list. No till screen calls it for a debt today.

How the till finds the debt — owner, 2026-10-02 (choice 1): option (a), as recommended. The three
options as they were put:

- **(a) A "Find a bill" box on the till.** Staff type the invoice number from the guest's copy, or
  the table and day, or the party's name. The till shows matching unpaid bills; choosing one opens
  a payment dialog that collects through the collect route, offering cash or a card keyed on a
  machine Waitron does not talk to — what that route takes (`collectOrder`,
  `apps/server/src/till-sale.ts`). It is not the basket's usual payment step, because that step
  loads a sent bill through `getPlacedCounterOrder`, which refuses a party's bill
  (`isNull(workingOrders.partyId)`, `apps/server/src/working-order.ts`, around `:3323`), and every
  debt is a party's bill. Paying a debt on the integrated card reader is a later item. It works on
  any till and needs no dashboard. **Recommended.**
- **(b) "Send to till" from the dashboard.** A manager finds the debt on the Orders screen and sends
  it to a chosen till, where it appears ready to pay. It needs a way to push a bill to one till,
  which does not exist.
- **(c) Keep a list on the till, searchable.** The present list, moved into a dialog any till can
  open, with the same search. Closest to today, but it is the list the owner asked to remove.

The counter list is removed in the SAME change that lands Find a bill, so `main` never has a
period with no way to see a debt at the till.

> **Update (2026-10-02, B29, landed as #1011):** a handheld now places, collects and cancels like a
> till. Of the refusals for being a handheld, only the Open drawer button's remains; integrated card
> payment and printing still need the device profile's capability. The collect route runs under
> the device's own till (`deviceTillCfg`, `apps/server/src/till-api.ts:1569`), which allows a cash
> drawer only on a till (`apps/server/src/device-session.ts:301-312`), so a handheld collecting a
> debt opens no drawer. Find a bill is therefore offered on a handheld too (the plan's Task 3).

Collecting part of a debt stays out of scope, as B17 left it (`docs/backlog.md`, B17's entry).

## 6. Permissions

Owner, 2026-10-02 (choice 2): every dashboard login sees the Orders screen, not only people holding
`report.view`. A staff-role session, which today has no sidebar and only its own schedule
(section 3), gets a sidebar with two entries, My schedule and Orders, and no page search, which two
entries do not need; every other role reaches Orders from the nav like Sales.

The dashboard copy uses the till's `print-receipt` device capability when a device is bound
(section 4.5). Collecting at the till still needs a till session and no extra permission.

**Owner decision, 2026-10-02 ~09:50: what a person without `report.view` sees.** They see
unfinished bills — Open, Waiting for payment and Left without paying — at any business day, plus
finished bills — Paid, Cancelled and Voided — opened on today's business day. "Today" uses the
venue's time zone and day cutover, as the date filter does. A date filter still limits the rows
within that permitted set. The detail route applies the same scope; an older finished bill answers
`working_order.not_found`. An invoice with no bill stays outside this scope. The Status control
offers every status because today's finished bills can be filtered. The bill's opened time, rather
than payment or cancellation time, determines its business day.

## 7. Refusals

`GET /management-api/orders` refuses a malformed filter (an unknown status, a backwards date range,
an unreadable cursor) with `management.request_invalid` and the offending `field`, as the report
routes do (`apps/server/src/report-api.ts:86`), so the screen can show the refusal beside that
control. A backwards range names the field `range`, not `from` or `to` (`requireRange`,
`packages/server-kit/src/request-screens.ts`), so the screen shows that refusal under the To date.
A bill id that does not exist, or that the list would not show the
caller, answers `working_order.not_found`, the code the till's routes use for it. A session that
is missing or expired answers as every management route does. The reprint's refusals are in
section 4.5. No new error code is expected.

## 8. Out of scope

Issuing a credit note from the dashboard (a later item of its own, section 4.5); recording who
asked for the till's own reprint (section 12); collecting part of a debt; exporting the list; a
location filter while one location exists; editing a bill from the dashboard; changing the till's
cancel of an invoiced bill (C126, section 4.2).

## 9. Testing

- Server: each status in section 4.2 produced by the product's own write paths (sell, place,
  collect, cancel, record departure, credit), never inserted by hand, and the route's answer for
  each; the order of precedence (a departure later collected reads Paid); search by `A/12`, by a bare
  number, by a credit note's number, by a table and by a name; paging across a page boundary with two
  bills opened at the same moment; the business-day window at the cut-over hour; a staff-role
  session served unfinished bills at any date and today's paid bill but not an older paid bill,
  the detail of an older paid bill answering `working_order.not_found`, and `status=paid` showing
  only today's paid bills; no session refused; and the number of
  queries per page staying the same for 1 row and 50.
- Reprint: a staff session's reprint enqueues exactly one `document` job on the picked printer,
  carrying the "duplicate" line, and one `receipt_reprints` row naming that person; no `drawer`
  job and no `drawer_opens` row, on a printer that has a cash drawer; the count of `sales` rows and
  fiscal records and the invoice's stored values the same before and after; a voided invoice also
  gets a copy; a bound device without `print-receipt`, a bill with no invoice and an inactive
  printer each refused with its code; the record refusing an update and a delete.
- Still owed: the same figure the till's collect would charge, asserted against the collect route on
  the same bill, including a bill with a credit note.
- Dashboard (browser mode): filters write the address and restore from it; choosing Unpaid keeps
  the dates; the row menu column is pinned; the detail dialog shows each section; refreshes after
  the first read are passive; a staff session sees My schedule and Orders in its sidebar and only
  every status; Reprint receipt shows for a bill with an invoice, sends the picked
  printer, and says where it went. LOOK at the screen in both themes and at phone width.
- Till: Find a bill finds a debt by each key; paying it settles the invoice and removes it from the
  dashboard's Unpaid filter; the counter list is gone.
- The golden huella test and `inmutabilidad` pass unedited: nothing here writes a fiscal record,
  the reprint included.

## 10. Build order

Three pull requests, each leaving `main` working:

1. Server: the list, detail and staff routes, the reprint route and its record (the one migration),
   with their tests. Lane E builds it as B27a.
2. Dashboard: the Orders screen, its detail dialog, Reprint receipt, and the staff session's
   sidebar. B27b.
3. Till: Find a bill, and the removal of the counter's "Left without paying" list in the same
   change. B27c.

The plan is `docs/superpowers/plans/2026-10-01-dashboard-orders.md`.

## 11. Work on the same code

Lane B's B29 landed as #1011 on 2026-10-02, while this amendment was being written: a handheld now
collects (section 5), and each till has an "Opens the cash drawer" setting that the automatic
drawer openings read (section 3). It took core migration `0063`, so the reprint record's migration
takes whatever number `drizzle-kit` assigns next; the plan names none. A178's filled
fields have landed for the dashboard; A178f, still to come, removes the shared native-select styles
and adds a guard against native selects, which is why the filter bar uses `wt-combobox`
(section 4.7). C113 has landed (#1014): a sale is filed in its location's receipt language, and the
reprint prints in the language the sale was filed in (section 3). Lane C's C123 moves the
receipt's caption, QR and VERI\*FACTU line, and the reprint lays out its copy with the same
`formatReceipt`, so whichever lands second rebases; a copy then follows C123's layout with no
change here. C124 narrows the order-line triggers behind C113's language-change refusal, not these
routes. _(2026-10-02: C114, branch `feat/receipt-reprint-language`, gives
`enqueueReceiptReprint` and `enqueueReceiptCopy` (split by #1027) an optional `language`; section
4.5's reprint passes none, so it prints in the language the sale was filed in.)_ Lane C's C126 may change the till's cancel (section 4.2). _(2026-10-02: C126, built in
lane B, does: the cancel credits an issued invoice in full; see section 4.2.)_ The plan's tasks check
open pull requests before starting, as every lane does.

## 12. The owner's answers, and what is left

Owner, 2026-10-02 (~07:50, relayed by the supervising watcher):

1. **How the till finds a debt:** (a) a "Find a bill" box on the till, as recommended (section 5).
2. **Who sees the Orders screen:** every dashboard login, not only `report.view`; the later owner
   decision in section 6 limits older finished bills for a session without it.
3. **Dates when filtering Unpaid:** keep the chosen range; no switch to Any date (section 4.3).
4. **Who counts as a bill's "staff":** anyone a line is credited to, as recommended (section 4.3).
5. **Reprint from the dashboard:** included, to a picked printer, using the till copy's
   `print-receipt` device gate (section 4.5). Credit notes stay a later item.
6. **Cancelled bills:** listed only when sent or holding lines, as recommended (section 4.1).
7. **A sent bill cancelled after its invoice was issued:** Cancelled with an "Invoice not credited"
   mark on this screen; the till's cancel is queued separately as C126 (section 4.2).
   _(2026-10-02, C126: built — the cancel credits the issued invoice in full; see section 4.2; the
   mark is dropped (owner, 2026-10-02 ~12:05, §4.2).)_

The owner confirmed the append-only `receipt_reprints` table on 2026-10-02 ~09:50. The same
answer allows a voided invoice's copy and limits staff to today's finished bills, as described
above. The till's own reprint still records nobody (section 3); recording it in the same table is
outside this build.
