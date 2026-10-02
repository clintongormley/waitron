# The dashboard's Orders screen — design

**Status:** draft for the owner's review (2026-10-01, lane C item B27s). Nothing is built until the
owner approves. Section 4 is this document's proposal; section 12 lists the choices that are the
owner's to make, each with a recommended default. Facts about today's code were read on `main` at
`5c1a1c2df` and line numbers re-checked after #1002 and #1004 landed; each carries a pointer, and none was run unless the text says so.

## 1. Why

Once a bill is paid, nothing in Waitron shows it again. No till or dashboard screen lists finished
orders; the dashboard's Sales and takings screen shows totals only (`docs/backlog.md`, B16's entry:
"completed orders cannot be looked up"). Bills a table left without paying (B17, #991) are listed
only in the counter's held-orders card on the till, which the default phone and tablet layouts do
not have, and nothing on any screen collects them: the list is read-only
(`apps/till/src/widgets/unpaid-departures.ts`, its header comment).

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
  around `:483`; read, not run). The invoices with no bill are credit notes, full invoices that
  replace simplified ones (substitutions, `sale_substitutions`), and sales the demo seed and other
  scripts write straight through core `recordSale` (`apps/server/scripts/demo-seed/seed-sales.ts`,
  around `:278`).
- **Debt** — the amount a bill still owes after its table left without paying (`unpaid_departures`).
- **Business day** — the trading day a moment belongs to, using the location's time zone and its
  day cut-over hour (`packages/reporting/src/business-day.ts`).

## 3. How it works today

**What is stored.** A bill's own status is one of `open`, `placed`, `settled`, `abandoned`
(`orders.ts:26-34`, with the database refusing other transitions). `placed` means sent and frozen:
under the `invoice_first` order flow its invoice is issued then; under `ticket_then_pay` the invoice
is issued only when it is collected (`apps/server/src/till-sale.ts`, around `:1576`). A bill has an
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
Which till or dashboard paths, if any, reach a void, a credit note or a substitution was not traced
for this spec, and none needs to be: the screen reads these rows whoever wrote them.

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

A bill cancelled before anything was sent is noise in this list. Proposal: a cancelled bill is
listed only if it was sent (it has an `order_placed` entry) or it held lines when cancelled. The
plan's first task checks, on the `main` it starts from, whether a cancelled bill keeps its lines; if
it does not, the second condition is dropped and recorded.

### 4.2 Status — one per row

Each row shows exactly one status, decided in this order:

1. **Open** — the bill is `open`.
2. **Voided** — the invoice has a `sale_voids` row. It is checked this early because a void does
   not change the bill's own status, so a voided bill is still `placed` or `settled` and would
   otherwise read Waiting for payment or Paid.
3. **Left without paying** — an `unpaid_departures` row exists, the invoice is not settled, and the
   bill is still `placed`. A debt cancelled at the till afterwards reads Cancelled (rule 6), since
   the cancel route accepts any `placed` bill. A
   debt whose credit notes bring it to nothing keeps this status, with the "Credited in full" mark
   and nothing in Still owed; the till's lookup (section 5) leaves it out, as today's till list
   does (`listUnpaidDepartures`, `apps/server/src/unpaid-departure.ts`, around `:265`).
4. **Waiting for payment** — the bill is `placed`, not settled, with no departure row.
5. **Paid** — settled. A bill paid after its table left shows **Paid**, with "left without paying
   on <date>" in its detail.
6. **Cancelled** — `abandoned`. A sent bill can be cancelled after its invoice was issued: the
   till's cancel route and `cancelPlacedOrder` (`apps/server/src/working-order.ts`, around `:4712`)
   do not look for an invoice (read, not run). Such a row reads Cancelled with an **Invoice not
   credited** mark, shows the invoice number, and leaves Still owed blank, because nothing will
   collect it. Whether that cancel should be allowed at all is choice 7.

Separately, a row with credit notes carries a **Credited** mark ("in full" when the credit notes
bring it to zero, "in part" otherwise). It is a mark rather than a status because a paid bill can
also be credited.

### 4.3 Filters and search

Controls above the table, applied by the server (section 4.6):

- **Status** — All, Open, Waiting for payment, Left without paying, Paid, Cancelled, Voided, plus one
  grouped choice, **Unpaid**: Waiting for payment and Left without paying together. The owner's
  "filter by unpaid" is this choice.
- **Dates** — a from/to range of business days, defaulting to today's business day. Choosing Unpaid
  or Left without paying switches the range to **Any date**, because a debt from last week is still
  owed today (choice 3). A bill belongs to the business day it was OPENED in, while the Sales screen
  counts an invoice on the day it was ISSUED (`packages/reporting/src/business-day.ts`), so a bill
  opened before the cut-over hour and paid after it falls on different days on the two screens. The
  screen says "opened" in its date label for that reason.
- **Credited** — show only rows with a credit note.
- **Staff** — one person (choice 4 says who counts), chosen from everyone who appears on a bill,
  including people since suspended or gone, not only today's active staff.
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
owed. The row menu is the `actions` column, `pinned: "end"` (CLAUDE.md §3). Status, Staff and
Still owed are choosable columns.

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

**Not in the first build** (choice 5): reprinting the receipt from the dashboard, and issuing a
credit note from it. Both are actions on a filed invoice. Reprinting today is a till route that needs
the device's `print-receipt` capability and takes the bill id (`POST /api/sales/:id/reprint`,
`apps/server/src/till-api.ts`, around `:1472`); the dashboard has no device and no chosen printer. Issuing a
credit note has no HTTP route at all. Each is its own item once the owner says how it should work.

### 4.6 Server

One new route, `GET /management-api/orders`, gated on `report.view` (choice 2). It takes the filters
above and returns one page of rows plus a cursor for the next page; the screen shows "Show more",
as the adjustment report does (`packages/adjustments/src/dashboard/adjustment-report-screen.ts`).
Filtering and paging are done by the server because `wt-data-table` filters and sorts only the rows
it was given and has no paging (`packages/ui/src/components/wt-data-table.ts`), and a venue's whole
history is too many rows to send. Rows are ordered newest first by `opened_at`, then id. An invoice
with no bill sorts by its issue time.

A second route, `GET /management-api/orders/:id`, returns one bill's detail.

Each page is read with a fixed number of queries, never one per row: the bills of the page, then
their invoices, credit notes, settlements, departures, tables and people, each in one read (the
"resolve shared data once" rule, CLAUDE.md §3). Business days use the location's clock, as the
reports do (`resolveVenueClock`, `apps/server/src/report-api.ts`). No new table and no migration. With a date range
the read uses `working_orders_opened_at_idx`; a read with no date range scans every bill (measured by
the review with `EXPLAIN QUERY PLAN` on `node:sqlite` against the plan's query shape), so an Any-date
read for Open, Waiting for payment, Left without paying or Unpaid starts from the bills whose own
status is `open` or `placed`, through the existing `working_orders_tenant_status_idx`. Search and
All with Any date still read the whole history, a page at a time.

### 4.7 The screen

A core dashboard screen, **Orders**, in the nav's first group beside Overview and Sales, shown to a
person holding `report.view`. Overview and Sales carry no permission gate in the nav today
(`apps/dashboard/src/dashboard-app.ts`, `NAV_GROUPS`), so Orders is the first gated item there. Its query is declared in `apps/dashboard/src/api/live-queries.ts` with
the tables it reads as dependencies, so the list refreshes when a bill changes, and every refresh
after the first read is passive (CLAUDE.md §3: automatic dashboard reads do not keep a session
signed in). The filters are kept in the address (`apps/dashboard/src/navigation.ts`), so a link to
"unpaid, any date" can be shared. Form fields use the filled style of A178 if it has landed when
this is built, otherwise today's fields; the table follows `apps/dashboard/src/widgets/product-list.ts`.

## 5. The till: collecting a debt from a lookup

The owner's point: once the Orders screen exists, the counter's "Left without paying" list is
removed, and a returning guest's debt is collected at the till. Collecting needs a till, because it
takes money: `POST /api/working-orders/:id/collect` (`apps/server/src/till-api.ts`, around `:1548`) settles an
existing invoice with the tender given, and the bill then leaves every unpaid list. No till screen
calls it for a debt today.

How the till finds the debt — three options (choice 1):

- **(a) A "Find a bill" box on the till.** Staff type the invoice number from the guest's copy, or
  the table and day, or the party's name. The till shows matching unpaid bills; choosing one opens
  a payment dialog that collects through the collect route, offering cash or a card keyed on a
  machine Waitron does not talk to — what that route takes (`collectOrder`,
  `apps/server/src/till-sale.ts`). It is not the basket's usual payment step, because that step
  loads a sent bill through `getPlacedCounterOrder`, which refuses a party's bill
  (`isNull(workingOrders.partyId)`, `apps/server/src/working-order.ts`, around `:3284`), and every
  debt is a party's bill. Paying a debt on the integrated card reader is a later item. It works on
  any till and needs no dashboard. **Recommended.**
- **(b) "Send to till" from the dashboard.** A manager finds the debt on the Orders screen and sends
  it to a chosen till, where it appears ready to pay. It needs a way to push a bill to one till,
  which does not exist.
- **(c) Keep a list on the till, searchable.** The present list, moved into a dialog any till can
  open, with the same search. Closest to today, but it is the list the owner asked to remove.

Whichever is chosen, the counter list is removed in the SAME change that lands the till's
replacement, so `main` never has a period with no way to see a debt at the till. Today collecting
refuses a handheld (`assertNotHandheld` on the collect route); lane B's B29 is queued to let a
handheld do what a till can by permission, and this design follows whatever B29 lands.

> **Update (2026-10-02, B29, branch `feat/service-handheld-permissions`):** a handheld now places,
> collects and cancels like a till. Of the refusals for being a handheld, only the Open drawer
> button's remains; integrated card payment and printing still need the device profile's capability.

Collecting part of a debt stays out of scope, as B17 left it (`docs/backlog.md`, B17's entry).

## 6. Permissions

Seeing the list and the detail needs `report.view`, which supervisors, managers and admins hold
(`packages/identity/src/permissions.ts`). Collecting at the till needs what collecting needs today: a
till session and no extra permission. No new permission is proposed.

## 7. Refusals

`GET /management-api/orders` refuses a malformed filter (an unknown status, a backwards date range,
an unreadable cursor) with `management.request_invalid` and the offending `field`, as the report
routes do (`apps/server/src/report-api.ts:86`), so the screen can show the refusal beside that
control. A backwards range names the field `range`, not `from` or `to` (`requireRange`,
`packages/server-kit/src/request-screens.ts`), so the screen shows that refusal under the To date. A bill id that does not exist answers `working_order.not_found`, the code the till's routes
use for it. No new error code is expected.

## 8. Out of scope

Reprinting and crediting from the dashboard (section 4.5); collecting part of a debt; exporting the
list; a location filter while one location exists; editing a bill from the dashboard.

## 9. Testing

- Server: each status in section 4.2 produced by the product's own write paths (sell, place,
  collect, cancel, record departure, credit), never inserted by hand, and the route's answer for
  each; the order of precedence (a departure later collected reads Paid); search by `A/12`, by a bare
  number, by a credit note's number, by a table and by a name; paging across a page boundary with two
  bills opened at the same moment; the business-day window at the cut-over hour; a person without
  `report.view` refused; and the number of queries per page staying the same for 1 row and 50.
- Still owed: the same figure the till's collect would charge, asserted against the collect route on
  the same bill, including a bill with a credit note.
- Dashboard (browser mode): filters write the address and restore from it; Unpaid switches the dates
  to Any date; the row menu column is pinned; the detail dialog shows each section; refreshes after
  the first read are passive. LOOK at the screen in both themes and at phone width.
- Till (once choice 1 is made): the lookup finds a debt by each key; paying it settles the invoice
  and removes it from the dashboard's Unpaid filter; the counter list is gone.
- The golden huella test and `inmutabilidad` pass unedited: nothing here writes a fiscal record.

## 10. Build order

Three pull requests, each leaving `main` working:

1. Server: the list and detail routes, with their tests.
2. Dashboard: the Orders screen.
3. Till: the debt lookup (choice 1), and the removal of the counter's "Left without paying" list in
   the same change.

The plan is `docs/superpowers/plans/2026-10-01-dashboard-orders.md`.

## 11. Work on the same code

Lane B's B29 changes what a handheld may do (section 5). A178's filled fields change the form
controls (section 4.7). Lane C's C113 and C123 change receipts, not these routes. The plan's tasks
check open pull requests before starting, as every lane does.

## 12. Choices for the owner

1. **How the till finds a debt:** (a) a "Find a bill" box on the till — recommended; (b) "Send to
   till" from the dashboard; (c) a searchable list kept on the till.
2. **Who sees the Orders screen:** `report.view` (supervisors and up) — recommended — or every
   person with a dashboard login.
3. **Dates when filtering Unpaid:** switch to Any date — recommended — or keep the chosen range.
4. **Who counts as a bill's "staff":** anyone a line is credited to — recommended, because it is who
   served the dish — or the person who rang the invoice, or the person who opened the party.
5. **Reprint and credit note from the dashboard:** left out of this build — recommended, each its own
   item later — or reprint included, to a printer the manager picks, gated on `print.resend`.
6. **Cancelled bills:** listed only when sent or holding lines — recommended — or all of them.
7. **A sent bill cancelled after its invoice was issued** (section 4.2): show it as Cancelled with an
   "Invoice not credited" mark — recommended for this screen — and, separately, decide whether the
   till should refuse that cancel (or credit the invoice as it cancels). The second half is a
   question about today's till, not about this screen; it is raised on its own in the campaign's
   questions file.
