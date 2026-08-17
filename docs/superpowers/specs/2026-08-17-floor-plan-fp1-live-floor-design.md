# Floor plan — FP-1: table service, operable from a live floor

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner via the visual
companion); plan to follow. **Track:** the first slice of the **floor-plan track** (sub-project 11).
**Runs SUPERVISED** (owner in the loop), NOT in the unattended campaign — see
[docs/backlog.md](../../backlog.md) "Table-service track". **Builds on the table-service core**
([TS-1 tables + tabs](2026-08-17-table-service-ts1-tables-and-tabs-design.md),
[TS-2 configurable statuses](2026-08-17-table-service-ts2-configurable-statuses-design.md)) — both
specced, **unbuilt**.

The table-service core (TS-1–TS-5) is entirely **headless**: verbs + HTTP routes, no screens
(`apps/till/src/screens/` has `lock` / `counter` / `ticket` / `schedule` / `allergen` and no floor or
tab screen; `packages/db/src/schema/` has no `dining_tables`). So **there is no front-of-house UI for
table service at all** — a waiter cannot open, ring, or pay a tab from a screen. FP-1 is that UI: it
renders TS-1's derived occupancy and TS-2's status, and its taps drive TS-1's `openTab` /
`addTabRound` / void / pay and TS-2's `setTableStatus`. It is the slice that makes table service
**operable**.

The floor-plan surface is large (a full ordering UI **plus** a spatial editor in two apps **plus** a
new per-line marker), so it is split **operable-first** into two slices (owner decision, 2026-08-17):
**FP-1** (this) makes table service usable, rendering the live floor as **occupancy-coloured cards
grouped by zone**; **FP-2** adds the spatial canvas + drag-drop edit mode on top. FP-1 ships **no
spatial positioning** — a deliberate cut, not an omission (§9).

## 0. Owner decisions this slice is built on (2026-08-17, brainstormed with the visual companion)

- **Full service from the floor.** Tapping a table opens/continues/pays its tab — the floor is the
  operator surface, not a read-only dashboard.
- **Hybrid storage, positions optional.** A `floor_zones` config table plus (in FP-2) nullable
  placement columns on `dining_tables`; a table with no position is still fully usable from the list.
  FP-1 delivers the zones half; FP-2 the placement half.
- **Author in both** the dashboard and an on-till edit mode — **the on-till editor is inherently
  spatial, so it lands in FP-2**. FP-1's authoring is the dashboard "Sala" config screen (zones +
  tables), which needs no canvas.
- **Shape fidelity: preset size (from `capacity`) + rotation** — an FP-2 concern (placement columns
  `shape`, `rotation`); FP-1 stores none of it.
- **Tap → straight into a full-width ordering screen**, with the tab behind a **badged pull-out
  drawer** (revised from a first "action-sheet-first" mock — the touch till has no room for grid + tab
  side by side).
- **Delivery marker: a per-line `served_at`** the waiter ticks off ("Servido") — a **front-of-house
  delivery acknowledgement**, explicitly distinct from KDS kitchen routing (rounds still do not reach
  the kitchen; that is the KDS sub-project). This is a genuine, owner-accepted addition to TS-1's line
  model (§9).
- **Screens are widget-composed on the #81 seam** — a sensible default arrangement now, authorable via
  the layout editor later, not a rewrite.

## 1. Scope

**In:**

- a `floor_zones` config entity (tenant + location scoped) + CRUD + a dashboard "Sala" config editor;
- a real `dining_tables.zone_id` FK, **superseding TS-1's free-text `zone`** (§2, §9);
- a per-line **`served_at`** marker on `working_order_lines` + `markLineServed` / clear;
- the occupancy read (TS-1's `listTablesWithState`) extended with `zoneId` and a **`pendingToServe`**
  count;
- a till **live floor screen** — zones as tabs, tables as occupancy-coloured cards, TS-2 status badge,
  "N por servir" badge; tap → order;
- a till **table-ordering screen** — full-width product grid + a current-round bar (Enviar ronda =
  `addTabRound`) + a badged pull-out **tab drawer** (Pendiente de servir with Servido ticks, Servido,
  total, **Cobrar**, **Estado**, and a disabled **Mover · Dividir** placeholder for TS-3/TS-5).

**Out → FP-2:** the spatial canvas; placement columns (`pos_x`, `pos_y`, `shape`, `rotation`); the
drag-drop **edit mode** (dashboard **and** on-till "Editar plano"); the unplaced-tray-on-a-map. **Out
entirely:** KDS kitchen routing (rounds do not reach the kitchen — `served_at` is a FoH ack only —
this is the KDS sub-project); TS-3 move/join, TS-4 transfer, TS-5 split (their entry points appear as
the disabled **Mover · Dividir** button); wiring the floor/ordering screens **into** the layout editor
(they are built **on** the seam so it is additive later, but the editor UI for them is not in FP-1).

## 2. Data model

All non-fiscal, all pre-production (drop/recreate, **no backfill** — CLAUDE.md §3, §5).

### 2a. `floor_zones` (new, `packages/db/src/schema/`)

Tenant + location scoped venue config — the same shape family as TS-2's `table_service_statuses` and
#81's `till_layouts`.

```text
floor_zones
-----------
id            uuid PK
tenant_id     uuid  → tenants (restrict)
location_id   uuid  composite FK (tenant_id, location_id) → locations
name          text  NOT NULL          ("Comedor", "Terraza", "Barra")
display_order int   NOT NULL DEFAULT 0
active        bool  NOT NULL DEFAULT true    (deactivate, never hard-delete — tables reference it)
created_at    timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)                    -- so dining_tables can composite-FK it
UNIQUE (tenant_id, location_id, name)     -- no duplicate zone names in a venue
```

FORCE RLS + a `floor_zones_tenant_isolation` policy (`USING/WITH CHECK (tenant_id =
current_tenant_id())`) + `GRANT SELECT, INSERT, UPDATE ON floor_zones TO app_user` (no DELETE —
deactivate) in a **hand-written custom migration**, modelled on
`packages/db/drizzle/0036_till_layouts_rls.sql:24-30` (a mutable tenant-scoped config table — the
closest existing shape). `.enableRLS()` alone is insufficient (CLAUDE.md §3). `current_tenant_id()` is
already defined by `packages/db/drizzle/0001_tenancy_rls.sql:52-65` and fails closed on an unset
`app.tenant_id`.

As a **core** `tenant_id`-bearing table, `floor_zones` is **automatically enumerated** by the fiscal
`inmutabilidad` scan — it keys on the presence of a `tenant_id` column, not on package
(`packages/fiscal-verifactu/src/inmutabilidad.test.ts:168-185`), running over
`[CORE, IDENTITY, FISCAL]` migrations (`:22-25`) and asserting `nonCompliant` is empty (`:214-221`). A
missing FORCE therefore fails that suite red (the exact gap `nodes` shipped with, CLAUDE.md §3). Note
`packages/db`'s own `immutability.test.ts` will **not** catch it — that scan keys on `reject_mutation`
triggers (`:238-242`), i.e. immutable tables only, and `floor_zones` is mutable. Run
`pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after the migration.

### 2b. `dining_tables.zone_id` — supersedes TS-1's free-text `zone`

```text
dining_tables.zone_id  uuid NULL  composite FK (tenant_id, zone_id) → floor_zones (tenant_id, id)
```

TS-1 gives `dining_tables` a free-text `zone text NULL`
([TS-1 §2a](2026-08-17-table-service-ts1-tables-and-tabs-design.md), lines "terrace"/"bar"/"inside").
FP-1 replaces it with a real `zone_id` FK. Because **both TS-1 and FP-1 are unbuilt**, this is a
build-order coordination, not a migration of live data (§9): FP-1's migration **drops** `dining_tables.zone`
and adds `zone_id`. Nullable — a table with no zone falls into a default "Sin zona" bucket in the read
(§3c). Additive nullable column on the existing FORCE-RLS `dining_tables`; TS-1's policy + `app_user`
grants already cover it (grants table-wide, RLS row-level — as #78's `products.image` add; confirm by
the RLS test, §7).

### 2c. `working_order_lines.served_at` (new nullable column)

```text
served_at  timestamptz NULL   (front-of-house delivery ack; NULL = not yet served)
```

Added to `working_order_lines` (`packages/db/src/schema/orders.ts:130-192`) after `category`
(`:167`), using the `timestamp(..., { withTimezone: true, mode: "string" })` idiom `working_orders.settled_at`
already uses (`orders.ts:89`). It lives on the **shared** line table — counter and walk-up lines
(`recordSale`) simply never set it. Nullable and additive; `working_orders`'s existing policy + grants
cover it. **Only tab ordering writes it** (`markLineServed`, §3b). It is **never read into a filed
record** (§4).

### 2d. Migration

One `packages/db` migration set (number via `pnpm --filter @waitron/db db:generate` against the live
tree — **do not hardcode**; the campaign / other slices may consume numbers first): the auto part
(create `floor_zones`; drop `dining_tables.zone`, add `dining_tables.zone_id` **column**; add
`working_order_lines.served_at`) plus a **custom** part (FORCE RLS + policy + grant on `floor_zones`,
and the `zone_id` composite FK). `db:generate` should emit only those column changes — verify. Commit
the `meta/_journal.json` + snapshot. No backfill (pre-production). **This migration necessarily
sequences after TS-1's `dining_tables` migration** (it alters that table).

## 3. Behaviour

New code in `apps/server` beside TS-1/TS-2's `tables.ts` / `working-order.ts`; the config editor in
`apps/dashboard`; the screens in `apps/till`. (Terminology: `apps/server` is the backend HTTP app, not
the domain `node`.)

### 3a. Zone config (`apps/server/src/tables.ts`)

- `createZone(tx, cfg, { name, displayOrder? }) → { id }` — throws `zone.name_taken` (catch the
  `(tenant_id, location_id, name)` unique 23505 → mapped code).
- `listZones(tx, cfg) → FloorZone[]` — the location's `active` zones by `display_order`.
- `updateZone(tx, cfg, id, { name?, displayOrder?, active? }) → void` — `zone.not_found`,
  `zone.name_taken`.
- `deactivateZone(tx, cfg, id) → void` — sets `active = false`; `zone.not_found`. (Reactivate via
  `updateZone`.)

**Gated on the existing `till.configure` permission** — it already exists
(`packages/identity/src/permissions.ts:16`, granted to `MANAGER` at `:51` and admin via `ALL`), and
TS-2's status config + #81's layouts already gate venue config on it. **No new permission.**

### 3b. Delivery marker (`apps/server/src/working-order.ts`, beside the TS-1 tab verbs)

- `markLineServed(tx, cfg, tabId, lineNo) → void` — sets `served_at = now()` on one line of an **open**
  tab; `unmarkLineServed` clears it to NULL. Throws `tab.not_open` (order not `open`/not a tab),
  `tab.line_not_found`. An **operational** verb — gated by the operator **session** (`requireSession`,
  `apps/server/src/till-session.ts:76`), the same gate ringing a sale uses (there is no operator-level
  permission for selling — sale ringing is session-only, `till-sale.ts` carries no `authorize`).
- **Fiscal boundary (H2):** a pre-fiscal write on an `open` order; touches nothing filed (§4).

### 3c. Occupancy read (extend TS-1's `listTablesWithState`)

TS-1 defines `listTablesWithState(tx, cfg, locationId?) → TableState[]`; TS-2 extends it with
`status`. FP-1 extends it further:

```text
TableState (FP-1 additions) = {
  ...TS-1/TS-2 fields (state, hasOpenTab, tabId?, tabLineCount?, tabTotal?, pendingDeliveries, status?),
  zoneId?: uuid,
  pendingToServe: int,     -- open-tab lines with served_at IS NULL; 0 for a free table
}
```

`pendingToServe` is a `COUNT` over `working_order_lines` (the tab's order, `served_at IS NULL`),
LEFT-joined so a free table reads 0. The floor screen fetches this via TS-1's `GET /api/tables/state`
and `GET /api/zones` (below) and **groups client-side by zone** — no new grouped "floor state"
endpoint (a trivial later nicety if wanted). Location-scoped, so it gathers orders across nodes by
construction (as TS-1).

### 3d. HTTP

Config lives on the **management API** (`apps/server/src/management-api.ts`, `mountManagementApi` at
`:186`) — the dashboard's auth surface — gated by `requireManagementSession` (`:278`…) then
`authorizeManager(till.configure)`, exactly as the layout routes do
(`GET /management-api/layout` `:437-450`, `PUT` `:461-484`):

| Verb + path | Body | Gate |
|-------------|------|------|
| `GET /management-api/zones` | — | `till.configure` |
| `POST /management-api/zones` | `{ name, displayOrder? }` | `till.configure` |
| `PATCH /management-api/zones/:id` | `{ name?, displayOrder?, active? }` | `till.configure` |
| `DELETE /management-api/zones/:id` | — (deactivate) | `till.configure` |

**Table config** (create/edit/deactivate/assign-zone) the dashboard "Sala" screen also needs is
**TS-1's entity**. TS-1 §3d put table CRUD on the **till** API (`/api/tables`), but the dashboard
authenticates by management-session, not the operator cookie — so FP-1 needs table config reachable on
the **management** API. **Coordination point with TS-1** (§9): the clean rule is **config →
management-api + `till.configure` (dashboard); operational read → till api + session**. FP-1 exposes
table config on `/management-api/tables*` (thin wrappers over TS-1's verbs) and keeps TS-1's
`/api/tables/state` as the till's operational read. The plan pins the exact placement once TS-1 lands.

On the **till** API (`apps/server/src/till-api.ts`, `mountTillApi` at `:134`), operator-session-gated
(`requireSession`, `till-api.ts:255`…), UUID path params via the `requireUuidId()` guard
(`:118-126` → 4xx not 500):

| Verb + path | Meaning |
|-------------|---------|
| `GET /api/zones` | zones for the floor tab-bar (read) |
| `GET /api/tables/state` | TS-1's read, now with `zoneId` + `pendingToServe` |
| `POST /api/working-orders/:id/lines/:lineNo/served` | `markLineServed` (DELETE clears it) |

Tab open / add-round / void / pay reuse TS-1's routes unchanged (`POST /api/tables/:id/tab`,
`POST /api/working-orders/:id/round`, `DELETE …/lines/:lineNo`, and pay via the existing sale path).
All new routes wrapped in the shared `run` error boundary (`till-api.ts:107`, `management-api.ts:135`)
and mapped through the `STATUS` code→HTTP tables (`till-api.ts:84-101`, `management-api.ts:80-128`).

## 4. Fiscal safety (H2)

**Commercial/pre-fiscal lane only — the immutable fiscal core is untouched.** Grep-verified in the
plan and cited:

- FP-1 adds two **non-fiscal** things to the schema: a config table (`floor_zones`), a `zone_id` FK,
  and a nullable `served_at` on lines. Nothing writes a `registros_facturacion` row, a `huella`, an
  invoice number, or a chain link.
- **Pay reuses TS-1's pay-closes-the-tab path** (`payWorkingOrder → recordSale`,
  `packages/core/src/record-sale.ts`) **UNCHANGED.** The plan greps `record-sale.ts` + the alta
  builders (`packages/fiscal-verifactu/src/backend.ts`) to prove **`served_at` is not read into the
  filed record**, and pins a test that the **huella is independent of `served_at`** — the same basket
  filed with all lines served and with none served produces the identical huella (mirrors the
  `entorno`-not-in-hash invariant, CLAUDE.md §5).
- The safe long-lived tab state is **`open`** (TS-1 §5, unchanged): `open` files nothing; the tab
  settles straight from `open` via the pay path. `served_at` never changes that.

## 5. Client — till (`apps/till`), on the #81 widget seam

The till routes screens by a string-union machine (`till-app.ts:37` `type Screen`, `:138` state,
`#renderScreen` `:782-816`, side-effect imports `:10-13`). FP-1 adds two members —
`"floor"` and `"table-order"` — with imports, `#renderScreen` cases, and transition handlers
(mirroring `#onShowSchedule` `:718-721` / `#onBackToCounter` `:724-727`). The boot fetch
(`#boot` `:278-295`, `getTill` `:279`) is unchanged.

Both screens are **widget-composed** so the layout editor can arrange them later without a rewrite
(the #81 property, `layout.ts` `WidgetType` `:14-15` / `WidgetInstance` `:18-22` / `LayoutDef` `:25`;
`till-counter-screen`'s `#widget` map `:189-222`). FP-1 ships a **fixed default arrangement**; wiring
these into the editor is deferred (§1). New widget types (`floor-grid`, `tab-drawer`, `round-bar`)
extend `WidgetType` and add `#widget` cases.

### 5a. Floor screen (`till-floor-screen`)

Renders `GET /api/tables/state` + `GET /api/zones`, grouped by zone:

- **Zone tabs** across the top (from `listZones`, by `display_order`); a "Sin zona" tab for unzoned
  tables; a running "N open · €X" summary.
- **Table cards**, occupancy as colour (TS-1's derived `state`): **free** (outlined/neutral),
  **open-tab** (accent + live `tabTotal` · `tabLineCount` · time-open), **delivery-pending** (dashed,
  from TS-1's counter-delivery signal). A **TS-2 status badge** (`status.label` + `status.color`) rides
  on top, shown whether free or occupied. A **"N por servir"** badge when `pendingToServe > 0`.
- **Tap**: free → `openTab` then the ordering screen; open → the ordering screen for the existing tab.
- Non-spatial: **cards in a responsive grid**, not positioned. (FP-2 replaces the grid with the
  positioned canvas; the card component is reused as the on-canvas token.)

### 5b. Table-ordering screen (`till-table-order-screen`)

Reuses `WorkingOrderStore` (`till-app.ts:136`) + `product-grid` / `basket` / `total` / `tender-pay`
(`apps/till/src/widgets/`, store-driven, `basket.ts:57-90`):

- **Full-width product grid**; taps accumulate a **current round** in a slim bottom bar (a `basket`
  bound to a round-scoped store). **Enviar ronda** → TS-1's `addTabRound` (append-only, no re-price;
  new lines start **un-served**).
- **Pull-out tab drawer** behind a right-edge handle **badged with `pendingToServe`**: **Pendiente de
  servir** (each line a "Servido ✓" → `markLineServed`; a "Servir todo" batches the per-line calls),
  **Servido**, **total**, **Cobrar** (TS-1's pay path — wired to the existing `tender-pay`/pay flow
  with the tab's order id; no new fiscal verb), **Estado** (TS-2 `setTableStatus`), and a **disabled
  Mover · Dividir** placeholder for TS-3/TS-5.
- New client methods on `TillApi` (`apps/till/src/api/client.ts`, `#request` `:518-536`, locally-mirrored
  types per the file's rule `:1-22`): `listZones`, `getTablesState`, `openTab`, `addTabRound`,
  `markLineServed`; pay reuses `recordSale`/`pay` (`:323-325` / `:337-344`) against the tab's order.

## 6. Dashboard — "Sala" config screen (`apps/dashboard`)

A new screen mirroring the #81 layout editor (`apps/dashboard/src/screens/layout-screen.ts`, gated on
`till.configure`, backed by `/management-api/*`). Wire it into the shell exactly as the others: a
`Screen` union member (`dashboard-app.ts:29-39`), a side-effect import (`:8-17`), a manager-nav button
(`#nav` `:209-262`), and a `#renderScreen` case (`:270-296`); a `.test.ts` + `.a11y.test.ts` in **both
themes** on the existing dashboard Chromium shard; `@waitron/ui` primitives.

Two panels:

- **Zonas** — CRUD (name, display order, activate/deactivate) → `/management-api/zones`.
- **Mesas** — table CRUD (label, plazas, zone, activate/deactivate) → `/management-api/tables*`
  (TS-1's entity, §3d). Assigning a table's zone is the FP-1-relevant field; the rest is TS-1's CRUD
  surfaced.

`DashboardApi` (`apps/dashboard/src/api/client.ts`) gains the matching methods with **local** types.
(The spatial floor editor is FP-2; this screen is data-form config only.)

## 7. Conventions

- **English identifiers** — `floor_zones`, `zone_id`, `served_at`, `display_order`, `name`, `active`.
  No new `SPANISH_WORDS` (`packages/db/src/english-only.ts:115`+); UI copy is localised en/es via the
  app i18n layers. `packages/db` is already in `GENERIC_PACKAGES` (`english-only.ts:8-24`), so the
  schema tokens are scanned — keep them English.
- **Domain-named error codes** (never the package — CLAUDE.md §3): `zone.name_taken`, `zone.not_found`.
  Reuse TS-1's `table.*` / `tab.*` (`tab.not_open`, `tab.line_not_found`). Declared in **`apps/server`'s
  registry** (`apps/server/src/errors.ts`, the `declare module "@waitron/shared"` block `:16-383`) and
  imported by the throwing file (`import "./errors.js"`, per `till-api.ts:42`). NB the root
  `errors-reachable` guard covers `packages/*` barrels, **not** `apps/*` — keep the import present.
  Never renamed once shipped. (Confirmed no `zone.*` code exists yet.)
- **Permissions:** reuse `till.configure` (config) + `requireSession` (operate). No new permission.
- No backwards-compat / data-migration code (pre-production).

## 8. Testing

- **Real Postgres (Testcontainers)** — `floor_zones` cross-tenant RLS isolation, proven by deletion of
  the tenant predicate, and the negative `WITH CHECK` cross-tenant INSERT refusal; the new columns
  (`dining_tables.zone_id`, `working_order_lines.served_at`) visible to the non-superuser `app_user`
  under the existing policies (differential — fails if `asAppUser` is dropped). `TESTCONTAINERS_RYUK_DISABLED=true`
  locally (CLAUDE.md §4).
- **PGlite** — zone CRUD incl. `zone.name_taken` / `zone.not_found`; `markLineServed` set/clear + its
  guards (`tab.not_open` on a settled order, `tab.line_not_found`); `listTablesWithState` returns
  `zoneId` and a correct `pendingToServe` (add a round → 2 pending; serve one → 1; pay → free, 0); the
  H2 huella-independence test (§4).
- **Guards** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` green after the migration
  (`floor_zones` reports `relforcerowsecurity = true`); `english-only` (root project) green; run
  `packages/db` **unfiltered** so tree-wide guards load (CLAUDE.md §4).
- **Till / dashboard** — floor screen renders occupancy + status + "por servir" badges and groups by
  zone; the ordering screen sends a round via `addTabRound`, ticks a line served, and opens Cobrar;
  the dashboard "Sala" screen CRUDs zones + assigns a table's zone; `.a11y` both themes.
- Coverage **98/98/98/95** (`packages/db`, `apps/server`), **95/95/90/88** (`apps/till`,
  `apps/dashboard`).

## 9. Owner-review / open questions / coordination

- **`served_at` is a genuine addition to the table-service core** (§0). It changes TS-1's line model
  and lightly overlaps KDS territory (delivery), but is scoped strictly to a **front-of-house ack** —
  no kitchen routing, no firing. Accepted by the owner (2026-08-17). KDS later builds kitchen routing
  **on top** of it, not instead of it.
- **`zone_id` supersedes TS-1's `zone text`.** Both unbuilt, so FP-1's migration drops the text column
  and adds the FK — a build-order coordination, not a data migration. **Alternative:** amend TS-1 to
  ship `zone_id` from the start (introduces a forward dependency on `floor_zones`). Default: keep TS-1
  as specced, let FP-1 introduce the real zones. Confirm at build time.
- **Table config auth surface (§3d).** TS-1 put `/api/tables` CRUD on the till API; the dashboard needs
  it on the management API. FP-1 adopts the rule **config → management-api/`till.configure`;
  operational read → till api/session** and exposes `/management-api/tables*`. The plan pins the exact
  wiring once TS-1 lands; if TS-1 has already shipped table CRUD on the till API by then, FP-1 either
  moves it or adds a management wrapper (pre-production — either is cheap).
- **FP-1 ships no spatial positioning** — the live floor is zone-grouped cards. Confirmed operable-first
  (owner, 2026-08-17); the spatial map + editor is FP-2.
- **KDS-before-floor-plan** remains the open sequencing call TS-1 §8 raised (does the kitchen see tabs
  from the start?). Unchanged by FP-1; FP-1 delivers front-of-house first, which is the assumed order.

## 10. Provenance

Designed against the live tree on 2026-08-17 via a targeted read (cited inline with `file:line`):
`apps/till/src/till-app.ts`, `layout.ts`, `screens/till-counter-screen.ts`, `widgets/`,
`api/client.ts`; `apps/dashboard/src/dashboard-app.ts`, `screens/layout-screen.ts`; `apps/server/src/{till-api,management-api,till-session,errors}.ts`;
`packages/db/src/schema/orders.ts`, `english-only.ts`; `packages/identity/src/permissions.ts`;
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`; `packages/db/drizzle/{0001_tenancy_rls,0036_till_layouts_rls}.sql`.
The "no table-service UI / no `dining_tables`" claims: `apps/till/src/screens/` listed (no floor/tab
screen), `packages/db/src/schema/` listed (no `dining_tables`), and a repo-wide grep found no
`table.*` / `tab.*` / `zone.*` error code — all consistent with TS-1/TS-2 being specced but unbuilt.
The `till.configure`-already-exists and `served_at`-column-placement claims are read from
`permissions.ts:16` and `orders.ts:167`/`:89` respectively. Dependencies on TS-1/TS-2 verbs
(`openTab`, `addTabRound`, `listTablesWithState`, `setTableStatus`, the pay path) are cited to their
**specs**, which the plan re-verifies against real code once those slices land (CLAUDE.md §1).
