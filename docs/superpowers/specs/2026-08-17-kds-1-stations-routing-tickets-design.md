# KDS-1 — Stations, routing & the per-line ticket rework

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner via the visual
companion + terminal); plan alongside. **Track:** the first slice of the **KDS track** (sub-project 12).
**Runs SUPERVISED** (owner in the loop), NOT in the unattended campaign. **Interacts with shipped #63**
(counter-POS prepare/collect — `order_prep`), and depends on **TS-1** (tab rounds firing to the kitchen)
and **FP-1** (the ready→floor feedback) — both specced, **unbuilt**.

Today the kitchen sees a **single prep row per order** (`order_prep`, `PK (tenant_id,
working_order_id)`), advanced as a whole (`apps/server/src/working-order.ts:899`) and shown as a pure
whole-order view (`apps/till/src/widgets/prep-queue.ts:31`). #63 built this deliberately as a
prep-queue **view, "not a KDS"**
([design §Summary](2026-08-06-counter-pos-prepare-collect-design.md), `:22`, `:69-70`). That model
**cannot** represent a tab firing successive rounds, or one order's lines going to different stations —
the exact gap TS-1 §8 flagged. KDS-1 replaces it with a **per-line, per-station ticket model**, adds a
**station** concept and **routing**, a **per-station display**, and closes the **ready→floor** loop with
FP-1.

## 0. Owner decisions this slice is built on (2026-08-17, visual companion + terminal)

- **Full-scope KDS, sliced.** The owner chose the fullest KDS (route+display + courses + expo + ready→floor)
  and to **slice it**: **KDS-1** (this) = stations + routing + the ticket rework + a per-station display
  + ready→floor; **KDS-2** = courses & fire control; **KDS-3** = expo/pass. Design KDS-1 only, then
  reassess.
- **Routing: per-category default + per-product override.** A line's station resolves
  `product.station_id ?? category.station_id ?? the location's default station`, **snapshotted onto the
  ticket item at fire time** (re-categorising a product later never reroutes food already sent). Chosen
  over per-product-only and per-category-only.
- **Ticket model: rework + unify.** Replace `order_prep`'s one-row-per-order with **per-line/per-station
  ticket items**; the counter prep-queue becomes the **default station** (its cards group a station's
  items by order, preserving #63's counter UX). One coherent model, no parallel prep tables — chosen over
  a new model beside `order_prep`. Touches shipped #63 (pre-production, so no data migration, but the code
  changes are substantive — §8).
- **Display: session-gated now, device identity deferred.** A till-app **station-display screen** where
  kitchen staff log in (existing PIN → session) and pick a station — reusing all existing auth. A code
  receipt confirmed **no device/station authentication exists today** (till boot is unauthenticated;
  device "identity" is process env vars; the only wire-token is the server-to-server sync Bearer). So the
  **true always-on device identity is a from-scratch subsystem** — deferred to its own later slice, not
  KDS-1 (§8).
- **Display UI: kanban default, switchable to a ticket rail.** Same tickets, two lenses (the FP-2
  map/list toggle pattern).
- **Bump: per-line by default, whole-ticket configurable.** The per-line ticket-item state is the source
  of truth; "bump the whole ticket" is a convenience that advances all a ticket's lines, enabled by a
  venue setting (default **line-only**).
- **Ready ≠ served.** A ticket item reaching **`ready`** is *kitchen-done, awaiting pickup* — distinct
  from FP-1's `served_at` (*waiter carried it out*). The floor gains a "**N listos**" signal; the waiter
  still marks `served`.

## 1. Scope

**In:**

- a `kitchen_stations` config entity (tenant + location, one **default**) + CRUD + a dashboard editor;
- routing config — `categories.station_id` (default) + `products.station_id` (override) — and a
  fire-time **station resolver** that snapshots the station onto each ticket item;
- the **ticket rework**: replace `order_prep` with per-line/per-station **`ticket_items`**
  (`queued → preparing → ready`); rework the fire points (`placeOrder`, `sendToPrep`, and — new — a tab's
  round-send), the advance verb (per-line + a configurable whole-ticket bump), and the queue read
  (per-station, grouped by order); port #63's counter prep-queue onto the default station;
- a till **station-display screen** (session-gated; station picker; kanban ⇄ rail; bump);
- the **ready→floor** extension to FP-1's occupancy read (a `readyToServe` count → "N listos");
- a **bump-mode** venue setting (`line` default / `ticket`).

**Out → KDS-2:** courses + hold/fire. **Out → KDS-3:** the expo/pass aggregation view. **Out → its own
slice:** the always-on **device/station identity** (pairing, device tokens, a validator distinct from
`requireSession`) — KDS-1's display is session-gated. **Out entirely:** any change to the fiscal path
(pay/collect stay as-is); multi-node kitchen routing beyond today's one-node-per-venue (ticket items stay
node-scoped as `order_prep` was).

## 2. Data model

All non-fiscal, pre-production (**no backfill**; the `order_prep` replacement drops and recreates —
CLAUDE.md §3, §5).

### 2a. `kitchen_stations` (new, `packages/db/src/schema/`)

```text
kitchen_stations
----------------
id            uuid PK
tenant_id     uuid → tenants (restrict)
location_id   uuid  composite FK (tenant_id, location_id) → locations
name          text NOT NULL          ("Cocina", "Plancha", "Barra")
display_order int  NOT NULL DEFAULT 0
is_default    bool NOT NULL DEFAULT false   (the counter/pass fallback station)
active        bool NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)                                       -- composite-FK target
UNIQUE (tenant_id, location_id, name)                        -- no dup names
UNIQUE (tenant_id, location_id) WHERE is_default             -- exactly one default per location
```

FORCE RLS + `kitchen_stations_tenant_isolation` policy + `GRANT SELECT,INSERT,UPDATE TO app_user` (no
DELETE — deactivate) in a **hand-written custom migration** (model: `0036_till_layouts_rls.sql:24-30`).
Auto-covered by the fiscal `inmutabilidad` scan (it keys on the `tenant_id` column —
`packages/fiscal-verifactu/src/inmutabilidad.test.ts:168-185`); run it after the migration.

### 2b. Routing columns

```text
categories.station_id  uuid NULL  composite FK (tenant_id, station_id) → kitchen_stations   -- category default
products.station_id    uuid NULL  composite FK (tenant_id, station_id) → kitchen_stations   -- per-product override
```

Additive-nullable on the existing catalogue tables (`packages/db/src/schema/catalogue.ts:45-57`
categories, `:61-116` products); their existing RLS policies + grants cover the new columns. **Resolution
(fire time):** `product.station_id ?? category.station_id ?? the location's default kitchen_station`. If a
location has no default station, firing throws `station.no_default` (a misconfiguration — fail loud, do
not silently drop food from the kitchen).

### 2c. `ticket_items` (new — replaces `order_prep`)

```text
ticket_items
------------
id                     uuid PK
tenant_id              uuid → tenants (restrict)
node_id                uuid  composite FK (tenant_id, node_id) → nodes           -- node-scoped, as order_prep was
working_order_id       uuid                                                       -- for grouping by order
working_order_line_id  uuid  composite FK (tenant_id, working_order_line_id) → working_order_lines (cascade)
station_id             uuid  composite FK (tenant_id, station_id) → kitchen_stations   -- SNAPSHOTTED at fire time
state                  prep_state NOT NULL DEFAULT 'queued'                       -- reuse the enum, minus 'collected' (§2d)
queued_at              timestamptz NOT NULL DEFAULT now()
preparing_at           timestamptz NULL
ready_at               timestamptz NULL

UNIQUE (tenant_id, working_order_line_id)     -- one ticket item per line
INDEX (tenant_id, station_id, state)          -- the per-station queue scan (cf. order_prep_queue_idx)
```

- **Replaces `order_prep`** (`packages/db/src/schema/order-prep.ts:36-70`). `order_prep` is **dropped**
  (pre-production). The composite FK to `working_order_lines` (cascade) is the analogue of
  `order_prep`'s order-FK (`order-prep.ts:56-60`); node FK mirrors `:63-67`.
- FORCE RLS + policy + `GRANT SELECT,INSERT,UPDATE TO app_user` (no DELETE — a cancelled/abandoned line's
  item is cascaded via the line FK, as `order_prep` relied on the order FK) — custom migration.
  Node-scoped and single-writer-per-row (the owning node), so it enrols in the app-level sync later like
  any node-scoped table (no KDS-1 sync work).

### 2d. `prep_state` enum — drop `collected`

`order_prep`'s enum is `['queued','preparing','ready','collected']` (`order-prep.ts:19`). Ticket items are
**kitchen** states only: `queued → preparing → ready`. **`collected` moves to the order level** — a
counter order's handover is `working_orders.collected_at` (added), set by the existing collect action;
the default-station display drops an order once collected. This removes the #63 conflation of "kitchen
done" with "customer handed the order" (§8). Keep the enum values `queued/preparing/ready` (reuse or a new
`ticket_state` enum — the plan picks; if reusing, `collected` becomes an unused value, acceptable
pre-production).

### 2e. `bump_mode` venue setting

`line` (default) / `ticket`. Home: a nullable column on `locations` (or the venue-config surface the plan
identifies) — a single per-location flag, default `line`. Governs only the display's convenience
whole-ticket bump; the per-line state is always the truth.

### 2f. Migration

One `packages/db` migration set (number via `db:generate` — **not hardcoded**): create `kitchen_stations`
+ `ticket_items`; add `categories.station_id`, `products.station_id`, `working_orders.collected_at`, the
`bump_mode`; **drop `order_prep`**; custom part = FORCE RLS + policies + grants on the two new tables, the
composite FKs, and the `WHERE is_default` partial unique. Commit journal + snapshot. Re-run `inmutabilidad`.

## 3. Behaviour (`apps/server`)

### 3a. Station config + routing (`apps/server/src/tables.ts` or a new `kitchen.ts`)

- `createStation` / `listStations` / `updateStation` / `deactivateStation` + `setDefaultStation`
  (flips `is_default`, atomically clearing the prior default) → `station.name_taken` / `station.not_found`.
  `till.configure`-gated.
- `setCategoryStation(categoryId, stationId | null)` / `setProductStation(productId, stationId | null)` —
  routing config, `till.configure`-gated (catalogue config).

### 3b. Fire → create ticket items (`apps/server/src/working-order.ts`)

Rework the three **fire points** to insert `ticket_items` (one per new line, station resolved + snapshotted):

- **`placeOrder`** (`working-order.ts:615`, currently inserts one `order_prep` at `:704-709`) — now inserts
  a ticket item per line.
- **`sendToPrep`** (`:845`, Mode P) — same, per line.
- **Tab round-send (new)** — TS-1's `addTabRound` fires its new lines to the kitchen (the capability TS-1
  §8 deferred to "the KDS slice"). This is why KDS-1 depends on TS-1.

A shared `fireLines(tx, cfg, orderId, lines)` resolves each line's station (§2b) and inserts the items;
`station.no_default` if the location has no default.

### 3c. Advance (bump) + read

- `advanceTicketItem(tx, cfg, itemId, to: 'preparing'|'ready')` — per-line bump; `WHERE state = <legal
  predecessor>` (mirror `advancePrep`'s conditional-UPDATE shape, `working-order.ts:910-930`), empty
  `returning` → **`ticket.invalid_transition`** (`{ ticketItemId }`); `to='queued'` refused. A
  **whole-ticket bump** (`advanceTicket(tx, cfg, orderId, stationId, to)`) advances every not-yet-`to`
  item of that order at that station (used when `bump_mode = 'ticket'`, or the "bump all" affordance).
- `listStationQueue(tx, cfg, stationId)` — the station's items (`state != 'ready'` plus a short-lived
  ready tail, excluding abandoned orders — mirror `listPrepQueue`'s abandoned filter,
  `working-order.ts:956-961`), **grouped by order** (each group = one order's lines at this station, with
  table/counter label + elapsed time). Node-scoped.
- All operational — **session-gated** (`requireSession`), as `advancePrep` is today.

### 3d. Ready → floor (extend FP-1's read)

FP-1's `listTablesWithState` returns `pendingToServe` (lines with `served_at IS NULL`). KDS-1 adds
**`readyToServe`** = lines whose ticket item is `ready` **and** `served_at IS NULL` (kitchen-done, not yet
carried). The floor renders "**N listos**" from it, distinct from "por servir". (A coordination change to
FP-1's unbuilt read — §8.)

### 3e. Counter collect (port #63)

The counter prep-queue's "advance to collected" becomes an **order-level** collect: `working_orders.collected_at`
set by the existing collect flow (`collectOrder`, `till-sale.ts:1311`, unchanged fiscally); the
default-station display drops a collected order. #63's `advancePrep(..., 'collected')` branch
(`working-order.ts:924-930`) is removed with the rework.

### 3f. HTTP

Config on the **management API** (`till.configure`, `authorizeManager` — the layout-routes model): stations
CRUD, `setDefaultStation`, category/product station, `bump_mode`. Operational on the **till API**
(`requireSession`): `GET /api/stations`, `GET /api/stations/:id/queue`, `POST /api/ticket-items/:id/advance`
(`{ to }`), `POST /api/orders/:id/stations/:sid/advance` (whole-ticket). Fire is internal (called by
place/sendToPrep/round-send, not a public route). Reuse `run` + `STATUS` + `requireUuidId`.

## 4. Fiscal safety (H2)

**None.** KDS-1 adds config + a prep model + a display, and replaces one non-fiscal prep table with
another. The pay/collect fiscal path is **byte-unchanged** (`collectOrder`/`recordSale`/`settleSale`
untouched; `working_orders.collected_at` is a non-fiscal handover marker, not a fiscal field). The plan
greps `record-sale.ts` + the alta builders to prove no station/ticket/`collected_at` field is read into a
filed record, and pins the huella is independent of them.

## 5. Client

### 5a. Till station-display screen (`apps/till/src/screens/`, new)

Session-gated; a **station picker** (from `GET /api/stations`); the queue from `GET /api/stations/:id/queue`,
grouped by order. **Kanban view** (Nuevo / Preparando / Listo columns) ⇄ **ticket-rail view** (a card per
order) toggle. **Per-line bump** (tap a line → `advance`); a **whole-ticket** affordance when `bump_mode =
'ticket'` (or a "bump all" button). Age colouring. Reuses the `till-prep-queue` widget's event→app→server
shape (`prep-queue.ts:88-96` dispatches, `till-app.ts:576-585` handles) but with the new per-line/per-station
entry shape. Registered in the till screen machine (`till-app.ts:37` union, `#renderScreen` `:782-816`,
imports `:10-13`).

### 5b. Dashboard config (`apps/dashboard`)

Station CRUD + default + `bump_mode` in the Sala/venue config (a "Cocina" panel — reuse the FP-1 Sala editor
shell, or a new screen); category→station on the catalogue category editor; product→station override on the
product editor — all `till.configure`-gated, `@waitron/ui` primitives, both-theme a11y.

## 6. Conventions

- **English identifiers** — `kitchen_stations`, `station_id`, `ticket_items`, `working_order_line_id`,
  `is_default`, `display_order`, `bump_mode`, `collected_at`. No new `SPANISH_WORDS`; UI copy localised en/es.
- **Domain error codes** — `station.name_taken`, `station.not_found`, `station.no_default`,
  `ticket.invalid_transition` (`{ ticketItemId }`). Declared in `apps/server/src/errors.ts` (`import
  "./errors.js"`). `order_prep.invalid_transition` (`errors.ts:343`) stays declared (never renamed) but its
  throw sites are removed with the rework — leave it in the registry. Never renamed once shipped.
- **Permissions:** reuse `till.configure` (config) + `requireSession` (operate). No new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `kitchen_stations` + `ticket_items` cross-tenant RLS (by deletion of the tenant
  predicate) + the `WHERE is_default` partial-unique (a second default rejected); both visible/writable
  under `app_user`; `inmutabilidad` green after the migration (both new tables `relforcerowsecurity = true`);
  a **concurrent-fire** race (two rounds firing at once → distinct ticket items, no unique collision — the
  per-line `working_order_line_id` unique is the guard).
- **PGlite** — station CRUD + `setDefaultStation` (flips atomically) + `station.name_taken`/`not_found`;
  the **routing resolver** (product override > category > default; `station.no_default` when none);
  `fireLines` snapshots the station (re-point the product's station afterwards → the existing item is
  unchanged — the load-bearing snapshot test); `advanceTicketItem` per-line + guards
  (`ticket.invalid_transition` on skip/repeat/backwards); `advanceTicket` whole-ticket; `listStationQueue`
  grouping + abandoned exclusion; the **ready→floor** read (`readyToServe` counts ready-not-served,
  distinct from `pendingToServe`).
- **Fiscal** — extend the FP-1 huella-independence test to station/ticket/`collected_at` (grep + filed-identical).
- **Till / dashboard** — the station screen renders kanban ⇄ rail, per-line bump calls advance, `bump_mode`
  toggles the whole-ticket affordance; dashboard station CRUD + routing config; `.a11y` both themes.
- **#63 regression** — the counter flow still works end to end on the reworked model: a walk-up order fires
  ticket items to the default station, advances, and collects (`collected_at`), leaving the default-station
  queue. **Preserve #63's behavioural assertions** (CLAUDE.md) — update the prep-queue tests to the new
  shape, do not delete the behaviours they pinned.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (till, dashboard, ui). Run `packages/db`
  unfiltered; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies / risk

- **Reworks shipped #63 code** — `order_prep` (dropped), `placeOrder`'s enqueue, `sendToPrep`, `advancePrep`,
  `listPrepQueue`, the `till-prep-queue` widget, and the `POST /api/working-orders/:id/prep` + `GET
  /api/prep-queue` routes all change from whole-order to per-line/per-station. Real blast radius on working
  counter-POS code. Pre-production means no data migration, but the code + tests are substantive — the plan
  re-verifies every #63 site against real code and preserves its behavioural assertions.
- **Depends on TS-1 + FP-1** (both unbuilt): TS-1 for tab round-send firing to the kitchen (§3b); FP-1 for
  the ready→floor read extension (§3d). The counter-only rework touches shipped code, but the **full loop
  executes after TS-1 + FP-1**. Re-verify TS-1's `addTabRound` and FP-1's `listTablesWithState` against real
  code first (CLAUDE.md §1).
- **The always-on device identity is deferred** (§0) — its own later slice (useful beyond KDS: trusting the
  till device itself). KDS-1's display is session-gated.
- **KDS-2 (courses) and KDS-3 (expo)** layer on this: KDS-2 adds a `course` on the line/ticket + hold/fire;
  KDS-3 an expo view aggregating a table's tickets across stations.

## 9. Provenance

Designed against the live tree on 2026-08-17 via two targeted reads (cited inline): the prep/catalogue read
— `packages/db/src/schema/order-prep.ts:19,36-70` (one-row-per-order, PK `:53`, enum `:19`),
`apps/server/src/working-order.ts:615,704-709,845,899,924-930,956-961,966` (fire/advance/list),
`apps/till/src/widgets/prep-queue.ts:31,88-96` (pure-view widget), `packages/db/src/schema/catalogue.ts:45-57,61-116`
(categories/products — **no station field**, `category_id` the only handle), `orders.ts:167` (snapshotted
category label), `docs/.../2026-08-06-counter-pos-prepare-collect-design.md:22,69-70,354-385` ("not a KDS"),
`apps/server/src/errors.ts:343` (`order_prep.invalid_transition`); and the device-auth read —
`apps/server/src/till-api.ts:190-247` (unauthenticated boot), `till-config.ts:44-82` (`TillConfig`, no token),
`till-session.ts:76-95` (`requireSession`), `apps/server/src/sync-api.ts:77-88` (the only wire-token, a
server-to-server Bearer) — confirming **no device/station auth exists** and it is net-new (deferred).
Dependencies on TS-1 (`addTabRound`) and FP-1 (`listTablesWithState`, `served_at`) are cited to their specs,
re-verified in the plan once those slices land.
