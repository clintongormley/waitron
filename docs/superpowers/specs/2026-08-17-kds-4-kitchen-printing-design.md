# KDS-4 — Kitchen printing (station → printer, print-on-fire)

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan alongside. **Track:** the KDS
track (sub-project 12), **Slice B** of the kitchen-printers ask — the thin routing layer on the
[printing subsystem](2026-08-17-printing-subsystem-design.md) (Slice A) and
[KDS-1](2026-08-17-kds-1-stations-routing-tickets-design.md). **Runs SUPERVISED**. Both dependencies are
specced, **unbuilt**.

The printing subsystem (Slice A) can drive any printer via a central outbox + agents; KDS-1 fires order
lines to stations. KDS-4 connects them: a **station's fired items print a paper ticket** at each printer
attached to that station — so a screen-less prep station gets paper, and a **group printer** attached to
every station prints them all.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Many-to-many station ↔ printer.** A station has zero-or-more printers; a printer serves one-or-more
  stations (the group printer → all). (Screens are already many-per-station via device bindings — no work
  here.)
- **Print-on-fire.** When a station's items fire (KDS-1's fire point), a ticket prints at each of that
  station's printers.
- **`ticket_scope` per printer** (from Slice A): **`station`** (the printer prints only the firing
  station's items) or **`order`** (a consolidated whole-event ticket — for a group/pass printer).

## 1. Scope

**In:** a `station_printers` many-to-many; **print-on-fire** wired into KDS-1's `fireLines` (+ the
`fireCourse`/round paths); a **kitchen-ticket formatter** (using Slice A's ESC/POS builder); the
dashboard station↔printer mapping; a **reprint** action.

**Out:** the printing transport/agent machinery (Slice A owns it); customer-receipt printing + the cash
drawer (later Slice-A consumers); `cloud_poll` (Slice A fast-follow); auto-reprint on printer recovery.

## 2. Data model

Pre-production, non-fiscal (**no backfill**).

### 2a. `station_printers` (new many-to-many, `packages/db/src/schema/`)

```text
station_printers
----------------
tenant_id   uuid → tenants (restrict)
station_id  uuid  composite FK (tenant_id, station_id) → kitchen_stations   (KDS-1)
printer_id  uuid  composite FK (tenant_id, printer_id) → printers           (Slice A)
PRIMARY KEY (tenant_id, station_id, printer_id)
```

Tenant scoped (the station + printer already carry the location). FORCE RLS + a tenant-isolation policy +
`GRANT SELECT,INSERT,DELETE TO app_user` (a mapping row is added/removed, not updated) in a hand-written
custom migration; the two composite FKs hand-written (both targets are other slices' tables). Enumerated
by `inmutabilidad`. No other schema change — `ticket_scope` lives on `printers` (Slice A).

## 3. Behaviour

### 3a. Config (`printer.manage`)

`attachPrinterToStation` / `detachPrinterFromStation(tx, cfg, { stationId, printerId })` — validate the
station (`station.not_found`, KDS-1) and printer (`printer.not_found`, Slice A) are live; INSERT/DELETE
the mapping (idempotent). `listStationPrinters` for the dashboard.

### 3b. Print-on-fire (extend KDS-1's `fireLines` / the fire paths)

When a **fire event** turns held/new ticket items **active** (KDS-1's `fireLines` at round-send, and
KDS-2's `fireCourse`), after the items are written, **enqueue print jobs** (via Slice A's
`enqueuePrintJob`) — **never inline hardware, never blocking the fire** (the job is an outbox INSERT):

- group the event's **newly-fired** items **by station**;
- for each such station, for each **attached printer**:
  - `ticket_scope = 'station'` → format a ticket of **that station's** newly-fired items and enqueue it
    to that printer;
  - `ticket_scope = 'order'` → this printer wants the **whole event**; enqueue **one** consolidated ticket
    of **all** the event's newly-fired items (across stations) **once per printer** (dedupe, so a group
    printer attached to N stations prints one ticket per fire, not N).

A printer attached to a station with no items in this event prints nothing. All enqueues happen in the
same tx as the fire (so a rolled-back fire enqueues nothing), but delivery is the async agent (Slice A).

### 3c. Kitchen-ticket formatter (`apps/server` or a `@waitron/kitchen` helper)

`formatKitchenTicket({ scope, stationName?, tableLabel, orderNumber, firedAt, courses: [{name, items:[{qty,name}]}] }) → Uint8Array` — built on **Slice A's ESC/POS builder** (`init`/`text`/`line`/`cut`).
A **`station`** ticket headers the station name; an **`order`** ticket headers the order/table and groups
items by station. Bold the table/order; large qty×name lines; a cut at the end. (Modifiers/notes are a
later add — the catalogue has none yet.)

### 3d. Reprint

`reprintOrderTickets(tx, cfg, orderId)` (`requireSession`) — re-enqueue the current tickets for an order
(e.g. a jam ate the paper). A `POST /api/orders/:id/reprint`; surfaced on the station display + expo.

### 3e. HTTP

Config on management (`printer.manage`): `POST/DELETE /management-api/stations/:sid/printers/:pid`,
`GET …/stations/:sid/printers`. Operational on the till (`requireSession`): the reprint route. Print-on-fire
is internal (no route).

## 4. Fiscal safety (H2)

**None**, and the **never-block invariant holds** (Slice A): print-on-fire only INSERTs outbox rows, so a
broken/absent kitchen printer can never delay a fire or a sale. Nothing touches `record-sale.ts` / the
alta builders (grep receipt).

## 5. Client — dashboard (`apps/dashboard`)

The **Impresoras** screen (Slice A) / the **Cocina** config (KDS-1) gains the **station ↔ printer**
mapping: on a printer, a multi-select of the stations it serves (attach the group printer to all in one
place); mirrored read on a station. `printer.manage`-gated; `@waitron/ui`; both-theme a11y. `DashboardApi`
gains `attachPrinterToStation`/`detach`/`listStationPrinters`. The station display + expo gain a
**Reprint** action per order.

## 6. Conventions

- **English identifiers** — `station_printers`, `station_id`, `printer_id`. No new `SPANISH_WORDS`; UI copy
  en/es.
- **Domain error codes** — reuse `station.not_found` (KDS-1) + `printer.not_found` (Slice A); no new code.
  `import "./errors.js"` where thrown.
- **Permissions** — `printer.manage` (mapping config), `requireSession` (reprint). No new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `station_printers` cross-tenant RLS (by deletion) + negative `WITH CHECK`;
  `inmutabilidad` green.
- **PGlite** — attach/detach (idempotent) + `station.not_found`/`printer.not_found`; **print-on-fire**:
  firing a station's items enqueues a `station`-scope ticket to its attached printers (assert the outbox
  job's printer + that its bytes contain the station's items); a **group printer** (`ticket_scope='order'`)
  attached to two stations gets **one** consolidated ticket per fire (dedupe — the load-bearing test); a
  printer attached to an uninvolved station prints nothing; **the fire never blocks** (no hardware I/O —
  reuses Slice A's guarantee); reprint re-enqueues.
- **Fiscal** — the H2 grep + the never-block assertion.
- **Dashboard** — the station↔printer multi-select attaches/detaches; the reprint action; `.a11y` both
  themes.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (dashboard). Run `packages/db` unfiltered;
  `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on the printing subsystem (Slice A)** (`enqueuePrintJob`, the ESC/POS builder, `printers` +
  `ticket_scope`) **and KDS-1** (`kitchen_stations`, `fireLines`, the fire paths — plus KDS-2's `fireCourse`
  for course firing). Build after both. Re-verify those symbols against real code first (CLAUDE.md §1).
- **Thin by design** — no transport/agent/hardware code lives here; KDS-4 is routing + formatting + config.

## 9. Provenance

Designed on 2026-08-17 against the printing-subsystem + KDS-1/KDS-2 designs. Reused: `enqueuePrintJob` +
the ESC/POS builder + `printers`/`ticket_scope` (Slice A), `kitchen_stations` + `fireLines` + the fire
paths + `fireCourse` (KDS-1/KDS-2) — all cited to those specs, re-verified in the plan once they land
(CLAUDE.md §1). The dedupe rule for an `order`-scope group printer (one ticket per fire, not per station)
is the one piece of genuinely new logic and is pinned by a load-bearing test (§7).
