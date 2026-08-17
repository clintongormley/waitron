# Bookings-1 — Staff-entered table reservations

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** the bookings surface (sub-project 17) — the last of the three table-service surfaces designed
2026-08-17 (after floor plan + KDS). **Runs SUPERVISED**. Its core is independent, but two chosen
integrations couple it to **TS-1** (seat-opens-a-tab) and **FP-1** (reserved-on-floor) — both specced,
**unbuilt**.

There is **no booking / reservation / customer / guest / contact concept anywhere in the tree** (grep:
zero hits across schema, code, and specs) — bookings is a genuinely new entity, and a booking's contact
details are **new columns, not an FK** (no customer table to reference). Slice 1 is **staff-entered**
reservations from the dashboard; **no public/online booking surface** (backlog sub-project 17).

## 0. Owner decisions this slice is built on (2026-08-17)

- **Staff-entered, dashboard-only.** No online/QR/public booking in slice 1.
- **Contact is free-text** (name + phone + notes) — no customer/CRM entity (none exists).
- **Optional table assignment** — a nullable link to a TS-1 `dining_tables` row.
- **Seat opens a tab** — when the party arrives, "seat" opens a tab on the assigned table (TS-1
  `openTab`) and links booking↔tab. If no table is assigned yet, the seat action takes one.
- **Reserved-on-floor** — an assigned table shows "Reservada HH:MM" on the FP-1 floor plan around the
  booking time (an extension to FP-1's occupancy read).
- **Day-list view** — a per-day list sorted by time (not a calendar grid).
- **Local wall-clock date + time** — a booking is a wall-clock appointment ("Martes 20:00"), stored as
  a local `date` + `time`, **not** an instant (§2b, the #52 lesson).
- **`booking.manage` permission** — manager + admin (no front-of-house role exists; mirrors
  `purchase.manage`).

## 1. Scope

**In:** a `bookings` entity (tenant + location) + CRUD; `booking_status` lifecycle
(`booked → seated → completed / no_show / cancelled`); a **seat** verb that opens a TS-1 tab on the
assigned table and links it; a dashboard **day-list** bookings screen + create/edit form; and an
extension to FP-1's floor read so an assigned table shows its imminent reservation.

**Out:** any public/online/QR booking; a customer/CRM entity (contact is free-text); reminders /
SMS / email; availability or double-booking prevention (staff judge it — no slotting engine);
recurring bookings; a calendar grid (day-list only); deposits/pre-payment (bookings touch no fiscal
path).

## 2. Data model

All non-fiscal, pre-production (**no backfill** — CLAUDE.md §3, §5).

### 2a. `bookings` (new, `packages/db/src/schema/`)

Tenant + location scoped, following the built **`shifts`** shape (separate `tenant_id` + `location_id`
FKs, `onDelete restrict`, tenant-consistency via RLS —
`packages/workforce/src/schema/shifts.ts:38-41,60-74`), which needs **no change to `locations`** (unlike
a composite location FK, which would require a `(tenant_id, id)` unique `locations` does not yet carry —
grounding §5).

```text
bookings
--------
id             uuid PK
tenant_id      uuid → tenants (restrict)
location_id    uuid → locations (restrict)
booking_date   date  NOT NULL          -- venue-local wall-clock (see 2b)
booking_time   time  NOT NULL          -- venue-local wall-clock
party_size     int   NOT NULL          -- CHECK > 0
contact_name   text  NOT NULL
contact_phone  text  NULL
notes          text  NULL
table_id       uuid  NULL  composite FK (tenant_id, table_id) → dining_tables (tenant_id, id)   -- optional (TS-1)
tab_id         uuid  NULL  composite FK (tenant_id, tab_id) → working_orders (tenant_id, id)     -- set on seat (TS-1)
status         booking_status NOT NULL DEFAULT 'booked'
created_by     uuid → persons (restrict)          -- who took the booking
created_at     timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)                             -- house pattern for composite-FK targets
INDEX (tenant_id, location_id, booking_date)       -- the day-list scan
```

`booking_status` = a new pgEnum `['booked','seated','completed','no_show','cancelled']`.

FORCE RLS + a `bookings_tenant_isolation` policy + `GRANT SELECT,INSERT,UPDATE ON bookings TO app_user`
(no DELETE — cancel, never hard-delete) in a **hand-written custom migration** (model
`0036_till_layouts_rls.sql:24-30`; the two composite FKs to `dining_tables` / `working_orders`
hand-written too, since those are TS-1 tables). Auto-covered by the fiscal `inmutabilidad` scan (keys on
`tenant_id` — `inmutabilidad.test.ts:168-185`); run it after the migration.

### 2b. Why local `date` + `time`, not an instant (the #52 lesson)

The workforce registro stores a clock-in as an **instant + explicit offset** (`time_entries.event_at` +
`event_offset_minutes`, `time-entries.ts:75-76`) and renders it via `localWallClock`
(`projection.ts:171-180`) — because a clock-in is a real *moment*, and #52 fixed a bug where such an
instant was rendered as UTC. A **booking is different**: it is a future **wall-clock intention**
("Tuesday 20:00 at the venue"), not a moment that has occurred. Storing it as a local `date` + `time`
is therefore semantically correct and **cannot** repeat the #52 mistake (there is no instant to
misrender). It also avoids net-new timezone math the codebase does not yet have — the dashboard's own
time entry currently stamps wall-time as UTC-offset-0 as a documented shortcut (`shift-dialog.ts:85-86`),
which bookings must **not** copy. The one place "now" matters — the reserved-on-floor imminence check
(§4) — computes the venue's current wall-clock from the location's `timeZone`
(`tenants.ts:85`, default `Europe/Madrid`) at **read time** via `Intl`, storing no offset.

### 2c. Migration

One `packages/db` migration set (number via `db:generate` — **not hardcoded**): create `bookings` + the
`booking_status` enum (auto), then a **custom** part (FORCE RLS + policy + grants; the two composite FKs
to `dining_tables`/`working_orders`; the `party_size > 0` CHECK). Commit journal + snapshot. Re-run
`inmutabilidad`. **Sequences after TS-1** (the FK targets).

## 3. Behaviour

New code in a **dedicated `apps/server/src/booking-api.ts`** module (the `purchasing-api.ts` pattern:
one permission constant, a `gated()` wrapper = `withTenant` + `asAppUser` + `authorizeManager(permission)`,
`requireManagementSession(c)` first for a pre-DB 401 — `purchasing-api.ts:53,198-211`), mounted in
`boot.ts` beside the others (`boot.ts:340-345`). A `@waitron/…` service extraction is a later refactor if
it grows.

### 3a. CRUD + lifecycle verbs (`booking.manage`-gated)

- `createBooking(tx, cfg, { bookingDate, bookingTime, partySize, contactName, contactPhone?, notes?, tableId? }) → { id }`
  — validates `partySize > 0` (`booking.invalid`), the `tableId` (if given) is an active `dining_tables`
  row (`table.not_found`, reused from TS-1). `status = 'booked'`.
- `listBookings(tx, cfg, { date }) → Booking[]` — the location's bookings for that `booking_date`,
  ordered by `booking_time`, all statuses (the screen filters/labels).
- `updateBooking(tx, cfg, id, patch) → void` — edit fields while `booked`; `booking.not_found`.
- `cancelBooking(tx, cfg, id) → void` — `booked|seated → cancelled` (`booking.invalid_transition`).
- `markNoShow(tx, cfg, id) → void` — `booked → no_show`.
- `completeBooking(tx, cfg, id) → void` — `seated → completed`.

### 3b. Seat → open a tab (TS-1 integration)

`seatBooking(tx, cfg, id, { tableId? }) → { tabId }`:

1. the booking must be `booked` (`booking.invalid_transition`);
2. resolve the table: the passed `tableId` ?? the booking's `table_id`; if neither, `booking.table_required`;
3. call TS-1's **`openTab(tx, cfg, { tableId })`** (unchanged) — which enforces one-open-tab-per-table
   (`tab.already_open` bubbles up if the table is busy);
4. set the booking's `table_id` (if newly chosen), `tab_id = the new tab`, `status = 'seated'`.

**No fiscal path is touched** — `openTab` opens a pre-fiscal working order (TS-1 §5); the booking is
commercial metadata. `seatBooking` is `booking.manage`-gated like the rest (a host action).

### 3c. HTTP (`booking-api.ts`, management API)

`GET /management-api/bookings?date=YYYY-MM-DD`, `POST /management-api/bookings`,
`PATCH /management-api/bookings/:id`, `POST /management-api/bookings/:id/seat` (`{ tableId? }`),
`POST /management-api/bookings/:id/cancel`, `.../no-show`, `.../complete`. Each `gated("booking.manage")`,
`requireManagementSession` first, `run`/`createErrorBoundary`-wrapped with a per-surface `STATUS` map,
UUID path params via `requireUuidId`.

## 4. Reserved-on-floor (FP-1 read extension)

Extend FP-1's `listTablesWithState(tx, cfg, locationId?)` so each table carries
`nextReservation: { time: string; partySize: int; contactName: string } | null` — the table's next
`booked` reservation for **today** (`booking_date = today-in-venue-tz`) at or after the venue's current
wall-clock, within a lookahead window (default the rest of the day). The floor renders "**Reservada
HH:MM**" from it (distinct from occupancy/status/`served`/`listos`). "Today" and "now" are the venue-local
values computed from `locations.timeZone` at read time (§2b). This is a coordination change to FP-1's
unbuilt read (§7).

## 5. Fiscal safety (H2)

**None.** Bookings are pre-sale commercial metadata; `seatBooking` reuses TS-1's non-fiscal `openTab`;
nothing writes a `registros_facturacion` row, a `huella`, an invoice number, or a chain link, and the
pay/collect path is untouched. The plan states this with a grep receipt (no booking field reaches
`record-sale.ts` / the alta builders).

## 6. Client — dashboard (`apps/dashboard`)

A **bookings screen** modelled on `purchases-screen.ts` + `purchase-form.ts` (a flat list widget + a
`wt-dialog` create/edit form + CRUD-over-API, single-flighted, reload-on-success —
`purchases-screen.ts:88-196`):

- a **date picker** (`<input type="date">`, seeded to `today()` — `date-utils.ts:20`) driving a **day
  list** of that date's bookings by time, each row showing time · party · name · status, with
  **Seat / No-show / Cancel / Edit** actions per row;
- a **create/edit form** (`wt-dialog`): `<input type="date">` + `<wt-input type="time">` (the
  `purchase-form`/`shift-dialog` entry pattern, but stored as plain local `date`/`time` — §2b, **not**
  the `${day}T${time}Z` shortcut), `party_size`, `contact_name`, `contact_phone`, `notes`, and an
  optional table picker (from TS-1's tables);
- **Seat** prompts for a table if none is assigned, then calls `POST …/seat`.

Wired into the dashboard shell (`dashboard-app.ts` `Screen` union + nav + `#renderScreen`, the FP-1/other
screens' pattern); `DashboardApi` gains the booking methods (local types); a `.test.ts` + `.a11y.test.ts`
both themes.

## 7. Conventions

- **English identifiers** — `bookings`, `booking_date`, `booking_time`, `party_size`, `contact_name`,
  `contact_phone`, `table_id`, `tab_id`, `booking_status`, `created_by`. No new `SPANISH_WORDS`; UI copy
  en/es ("Reserva", "Reservada").
- **Domain error codes** — `booking.not_found`, `booking.invalid` (bad party size), `booking.invalid_transition`,
  `booking.table_required`. Declared in the throwing module's registry (`import "./errors.js"`); reuse
  TS-1's `table.not_found` / `tab.already_open`. Never renamed once shipped.
- **Permission** — a **new `booking.manage`**, added to `PERMISSIONS` + the `MANAGER` set
  (`permissions.ts:7-56`), mirroring `purchase.manage` (manager + admin). **No front-of-house role
  exists** (only staff/supervisor/manager/admin, and no operational write permission below manager); if
  floor staff should take bookings, granting `booking.manage` lower is a **later decision and a new
  pattern** — default manager+admin. **Churn:** grep for any test pinning the `PERMISSIONS` array and
  update it in the same change (CLAUDE.md §3 stale-list trap).
- No backwards-compat / data-migration code (pre-production).

## 8. Testing

- **Real Postgres** — `bookings` cross-tenant RLS (by deletion of the tenant predicate) + negative
  `WITH CHECK`; visible/writable under `app_user`; `inmutabilidad` green after the migration
  (`bookings` `relforcerowsecurity = true`).
- **PGlite** — CRUD + `booking.invalid` (party_size ≤ 0); the lifecycle guards (`cancel`/`no-show`/
  `complete` legal moves + `booking.invalid_transition` on illegal ones); **`seatBooking`** opens a tab
  and links it (`tab_id` set, `status = seated`), `booking.table_required` when no table, and
  `tab.already_open` bubbling when the table is busy; `listBookings(date)` ordering + date filter.
- **Floor read** — `nextReservation` surfaces the next imminent `booked` reservation and clears once the
  time passes / the booking is seated/cancelled; venue-local "today"/"now" from `locations.timeZone`.
- **Fiscal** — the H2 grep receipt (no booking field in `record-sale.ts` / alta builders).
- **Dashboard** — the day list renders by time; create/edit stores plain local `date`/`time` (**not**
  UTC-marked); seat calls the route; `.a11y` both themes.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (dashboard). Run `packages/db` unfiltered;
  `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 9. Sequencing / dependencies

- **Core is independent** — the `bookings` entity, CRUD, lifecycle, and the day-list screen need neither
  TS-1 nor FP-1 and could build first. **Two features couple it:** `seatBooking` needs TS-1
  (`dining_tables` + `openTab`), and reserved-on-floor needs FP-1 (`listTablesWithState`). So the **full
  slice executes after TS-1 + FP-1**; a thinner cut (bookings CRUD + day-list, table link as a plain
  nullable uuid, no seat-opens-tab, no floor indicator) could land earlier if wanted — the plan notes the
  split. Re-verify TS-1's `openTab`/`dining_tables` and FP-1's read against real code first (CLAUDE.md §1).
- **No online booking** — a public/QR surface, availability, reminders, and a customer entity are all
  later, none needing a destructive migration (pre-production).

## 10. Provenance

Designed against the live tree on 2026-08-17 via a targeted read (cited inline): grep confirming **no
booking/reservation/customer/contact concept** exists; `packages/workforce/src/schema/shifts.ts:38-74`
(the tenant+location separate-FK shape) and `time-entries.ts:75-76` + `projection.ts:171-180` (the
instant+offset / `localWallClock` pattern the #52 fix established — and why a wall-clock booking does
**not** follow it); `apps/dashboard/src/{date-utils.ts:20, screens/purchases-screen.ts:88-196,
widgets/purchase-form.ts:380-395, widgets/shift-dialog.ts:85-86}` (the screen/form template + the
store-as-UTC shortcut to avoid); `apps/server/src/purchasing-api.ts:53,198-211` (the `gated()` module
pattern) + `boot.ts:340-345` (mounting); `packages/identity/src/permissions.ts:7-56` +
`schema/persons.ts:20` (the permission list + **no host role**); `packages/db/src/schema/tenants.ts:85`
(`locations.timeZone`). Dependencies on TS-1 (`dining_tables`, `openTab`, `tab.already_open`) and FP-1
(`listTablesWithState`) are cited to their specs, re-verified in the plan once those slices land.
