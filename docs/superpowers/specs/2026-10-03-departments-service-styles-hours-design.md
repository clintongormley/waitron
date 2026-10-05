# Departments, service styles and opening hours

> **Update, 2026-10-05 (A261 step 2):** The "What exists today" section below records the code
> as it stood on 2026-10-03. The [Departments and zones plan](../plans/2026-10-04-departments-and-zones.md)
> replaces live venue-wide pay timing and receipt printing with department defaults and optional
> zone overrides, and prints an enabled department trading name above the legal issuer name.

> **2026-10-04 follow-up:** the [devices, menus and service zones design](2026-10-04-devices-menus-and-service-zones-design.md)
> replaces the unrestricted-device proposal in §2 with profile-based departmental access and
> allowed zones, and records accepted transfers through a shared receiving desk. Its written spec
> awaits review; the service-setting and advisor questions below remain separate.

**Status:** Draft, 2026-10-03. It records the owner's decisions from a design conversation that day,
marked **Owner, 2026-10-03**. Everything else is a proposal the owner has not yet confirmed. No plan
has been written. Backlog entry: A254.

**2026-10-03, later the same day:** the venue operations design
([2026-10-03-venue-operations-design.md](2026-10-03-venue-operations-design.md), A261) builds on this
spec. It replaces §4's day types with special dates, and places §5's trading-name switch in the
Departments and zones table, printing the trading name first on the receipt.

The conversation started from one question: how do departments, service zones and prep stations fit
together? The answer showed three problems:

- a service style that mixes several separate choices into one setting;
- opening hours that cannot handle a public holiday;
- a department's trading name that nothing uses.

## 1. What exists today

Checked against `main` at `837f00fc8` by reading the code; nothing was run.

- **Venue** (`locations`, `packages/db/src/schema/tenants.ts`): one physical premises. It holds the
  address, time zone, business-day cutover, receipt languages, tax region, the receipt print setting
  (`receipt_print_mode`) and a venue-wide `order_flow`. A database holds one venue.
- **Department** (`departments`, `packages/venue-service/src/schema/service.ts`): a line of business
  inside the venue. It has a name, a trading name, a default service style and weekly hours. Setup
  creates the first one, named `"Venue"` in English for both name and trading name
  (`packages/venue-service/src/provisioning.ts`).
- **Service zone** (`floor_zones` plus `zone_service_policies`): a floor area. Each zone belongs to
  one department, offers menus, may override the department's service style, and one zone per venue
  is the *counter default*. A new order takes its table's zone, otherwise the till's own default zone
  (`device_zone_defaults`), otherwise the counter default (`resolveNewOrderZone`,
  `packages/venue-service/src/operations.ts`).
- **Prep station** (`kitchen_stations`): where a dish is made. Routing (`chooseMaker`,
  `packages/venue-service/src/routing.ts`) tries ordered exceptions (which may name a zone), then
  folder claims, then the venue's default station. A closed station's work then goes to its
  fallback. Departments play no part in routing.
- **What an order records.** The order records its zone, department and service style
  (`order_service_contexts`). Each line records the department it was sold under
  (`working_line_contexts`). Moving a bill to another zone switches the order to the new zone's
  department and style, and the lines keep theirs (`adoptZone`, `apps/server/src/move-bill.ts`).
- **Service style** has four values: `table_tab`, `prepay`, `invoice_first` and `ticket_then_pay`.
  The venue-wide `order_flow` has three (all but `table_tab`) and is used when an order has no style
  recorded.
- **Department hours** are stored and editable. The only readers found are the listing route, the
  demo seed and configuration export, so nothing acts on them. Stations have weekly hours, a fallback,
  and a manager's whole-day "open today" or "closed today" (`station_day_states`). Nothing can give
  different hours for one date.
- **The receipt header** prints the taxpayer's legal name (the issuer name filed with AEAT), then an
  optional owner-written subtitle, then the NIF (`apps/server/src/receipt-ticket.ts`). Neither the
  venue name nor any department name is printed. The trading name is shown only on the Venue
  operations screen.
- **Tabs.** A table tab is a *party* (`packages/db/src/schema/parties.ts`). A party has an optional
  name, but it is always opened at a table (`openParty` and `seatTable`, `apps/server/src/parties.ts`).
  Counter orders can be parked as *held orders* with an optional label, picked up on any till, and
  moved to a table (`apps/till/src/widgets/held-orders.ts`).

## 2. Departments

- **Owner, 2026-10-03: most venues have one department, and the owner should not have to think about
  it until there is a second one.**
- **Owner, 2026-10-03: setup names the first department after the venue** instead of `"Venue"`. The
  department takes a copy of the venue's name for both its name and its trading name, so renaming the
  venue later does not rename the department. The owner can rename it.
- **Proposed:** while only one department is active, the dashboard hides the department everywhere.
  No department column and no department picker on a zone. All of it appears once a second
  department is added. Which screens show departments has not been surveyed.
- **Proposed, not yet confirmed: a device gets no department of its own.** The owner asked whether a
  device should belong to one department. The till's default zone already does that job, because the
  zone belongs to one department, and it also picks the menus. It is a home, not a restriction:
  every device can do everything (owner, 2026-10-03, A238), and the counter screen can switch zones.
  The venue-wide counter default stays as the fallback for a device that has no default zone yet.
- **Owner, 2026-10-03: a tab must be able to move between departments**, for example started at the
  deli counter, moved to a table and paid there. Moving a bill does this today (§1).

## 3. Service style becomes separate settings

The four-value style answers several separate questions at once, and the owner pointed out more
that it cannot express. Proposed replacement: separate settings, each with a department default and
an optional zone override, as the style works today. The venue-wide `order_flow` goes, because it
duplicates them.

### 3.1 A tab or a one-off sale

- **Owner, 2026-10-03: a tab is not tied to a table.** A tab can be held by a table, by a counter
  position ("the 4th stool at the bar"), or by a name or other identifier: a person or group
  standing in the bar drinking together. The owner sees these as the same kind of tab as an open
  order at the deli counter.
- So "tab or one-off" is chosen per order, not set per zone, and `table_tab` stops being a service
  style.
- Today a held counter order with a label comes close to a named tab without a table. What has to be
  decided before building:
  - Does each round on a counter tab go to the kitchen or bar when it is ordered, as at a table, or
    when it is paid, as a pay-first counter order does today?
  - Do counter positions need their own records, or is a label enough?
  - Does a counter tab need what a party has: guest count, several bills, splitting, the
    "asked for the bill" mark?

### 3.2 A one-off counter sale

- **Pay before the order goes to the kitchen, or at collection.**
- **Collection ticket: print a numbered ticket, or none** ("5.50 €, please"). This is separate from
  the receipt.
- **Receipt: always, on request, or never.** This is today's `receipt_print_mode`. It moves from the
  venue to the department, with a zone override. In every mode the sale is issued and filed at
  payment, and the setting only decides whether the receipt prints automatically
  (`enqueueSaleReceipt`, `apps/server/src/receipt-print.ts`). A reprint is always available.

### 3.3 When the invoice is issued

- **Owner, 2026-10-03: drop "invoice first" for counter sales.** Its purpose was to save a second
  trip to the printer. Asking "do you want a receipt?" saves that trip most of the time.
- **For a tab, both orders of events are acceptable to the owner (2026-10-03):**
  - *The printed bill is the invoice.* Later changes need a correcting invoice. The owner's view:
    that is normal, and corrections such as "we didn't have this" have to be handled anyway.
  - *A pre-bill first, the invoice at payment.* This costs a second print only when the customer
    wants a receipt, which most do not.
- This stays a choice until the advisor answers. The approved
  [service design](2026-09-20-service-ordering-and-billing-design.md) §6 issues a bill's invoice when
  the bill is fully paid, and leaves printing the invoice first waiting on the advisor. The open
  questions are Q21, Q14, Q27 and Q22 in [asesor-questions.md](../../compliance/asesor-questions.md).
  "Most customers decline the receipt" holds only if Q22 allows printing on request (§3.4).

### 3.4 May a venue print the receipt only on request? — open, Q22

Read at source on 2026-10-03 from the consolidated texts on boe.es:

- RD 1619/2012 (BOE-A-2012-14696), Reglamento art. 1: *«Los empresarios o profesionales están
  obligados a expedir y entregar, en su caso, factura u otros justificantes por las operaciones que
  realicen en el desarrollo de su actividad empresarial o profesional»*.
- Same, art. 17: *«Los originales de las facturas expedidas […] deberán ser remitidos por los
  obligados a su expedición o en su nombre a los destinatarios de las operaciones»*.
- Same, art. 18: *«La obligación de remisión de las facturas que se establece en el artículo 17
  deberá cumplirse en el mismo momento de su expedición o bien, cuando el destinatario sea un
  empresario o profesional que actúe como tal, antes del día 16 del mes siguiente […]»*.
- RDLeg 1/2007 (BOE-A-2007-20555) art. 63.3: *«En los contratos con consumidores y usuarios, estos
  tendrán derecho a recibir la factura en papel»*, and electronic delivery needs the consumer's
  express consent.

Read together, the text places delivery to a consumer at the moment of issue. Nothing in it says
delivery happens only if the customer asks. The only loose words are art. 1's *«en su caso»*
("where applicable"). [verifactu-findings.md](../../compliance/verifactu-findings.md) §9 and §15.6
already read it this way and flag `on_request` and `never` as being in tension with art. 1.
[Q22](../../compliance/asesor-questions.md) puts the question to the advisor; it has no answer yet.
Until it does, "ask whether they want a receipt" is an operator's choice that carries this risk,
and it should not be the default.

## 4. Opening hours

- **Owner, 2026-10-03: zones have no hours, and closing a zone is not a system feature.** The waiter
  closes the terrace; the system is not involved.
- **Owner, 2026-10-03: department hours never stop sales.** They are the venue's public opening
  hours, the ones roadmap item 19 (Opening hours and channel sync, for Google Business Profile and
  Maps) would publish. Only stations act on hours, by sending work to a fallback station.
- **Owner, 2026-10-03: day types are set for the whole venue, and hours are set per day type.**
  - The venue defines day types, for example "Normal", "Eve of a holiday" and "Public holiday".
  - Each department and each station sets its hours for each day type.
  - A calendar assigns a day type to a date, and each weekday has a usual day type.
  - Custom overrides for one date, per department or station, remain possible.
  - Example: Tuesday is a public holiday, so Monday becomes "Eve of a holiday" and Tuesday "Public
    holiday". Then the deli (normally 9:00–17:00) is closed on Tuesday, the restaurant opens
    12:00–23:00 and the kitchen station 12:00–21:00 instead of 9:00–21:00. That is two calendar
    entries, not one edit per department and station.
- The station's existing whole-day "open today" or "closed today" stays as the one-off override.
- The wages work in A9 also needs a public-holiday calendar. Build one calendar for both.

## 5. The trading name on the receipt

- **Owner, 2026-10-03: a per-department switch prints the department's trading name on the receipt.**
  It is an extra line, so the legal name and NIF the regulations require still print (RD 1619/2012
  art. 7.1.d, as cited in `apps/server/src/receipt-ticket.ts`).
- With §2's default, a single-department venue's trading name starts as the venue's name, which is
  usually the brand customers know.

## 6. Open before planning

1. Confirm or reject §2's proposal that devices get no department.
2. Decide the questions in §3.1 about counter tabs.
3. The advisor's answers to Q21, Q14, Q27 and Q22 (§3.3, §3.4).
4. Survey which screens show departments, for §2's hiding.
5. How existing venues move from the four-value style to the new settings. Before go-live this is a
   drop and recreate, as CLAUDE.md §3 allows.
