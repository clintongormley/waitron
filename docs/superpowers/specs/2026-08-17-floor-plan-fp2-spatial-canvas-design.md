# Floor plan — FP-2: spatial canvas + drag-drop edit mode

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner via the visual
companion + terminal); plan alongside. **Track:** the second slice of the **floor-plan track**
(sub-project 11). **Runs SUPERVISED** (owner in the loop), NOT in the unattended campaign. **Builds on
[FP-1](2026-08-17-floor-plan-fp1-live-floor-design.md)** (live floor + operable table service), which
builds on **[TS-1](2026-08-17-table-service-ts1-tables-and-tabs-design.md)** +
**[TS-2](2026-08-17-table-service-ts2-configurable-statuses-design.md)** — all specced, **unbuilt**.

FP-1 makes table service operable and renders the live floor as **occupancy-coloured cards grouped by
zone** — deliberately non-spatial. FP-2 adds the **spatial floor plan**: nullable placement coordinates
on `dining_tables`, a canvas that draws each table at its position (reusing FP-1's occupancy card as the
on-canvas token), a **map/list toggle**, and a **drag-drop edit mode** shared by the dashboard and an
on-till "Editar plano" toggle. This is the "visual one" the owner pictured; FP-1 was the operable base
it sits on.

## 0. Owner decisions this slice is built on (2026-08-17, brainstormed with the visual companion)

Settled during the FP-1 companion session and confirmed for FP-2:

- **Interaction:** drag-to-place, a shapes palette, a grid-snap toggle, a selection inspector
  (label / plazas / shape / zone). (Live-floor spatial rendering: "this is the direction".)
- **Shape fidelity: preset size from `capacity` + rotation** (chosen over free-resize and
  preset-no-rotation) → placement columns `shape` + `rotation`; **size is derived from plazas, not
  stored**.
- **Coordinates: normalized on a fixed-aspect canvas** — `pos_x` / `pos_y` as per-mille integers of the
  canvas, a fixed aspect ratio for all zones in this slice, so the plan renders correctly on any screen
  (touch till, dashboard, phone). No real-world room dimensions.
- **Map default + list toggle** — the floor screen shows the spatial map when the zone has ≥1 placed
  table, with a toggle back to FP-1's card/list view; unplaced tables sit in a tray on the map.
- **Tables only** — no walls / doors / bar / free labels / background images this slice (purely additive
  later; nullable data, no migration pain).
- **Author in both, on-till edit is manager-on-till** (2026-08-17, informed by a code receipt — §3c):
  editing config *from the till* is genuinely new auth surface (no till route calls `authorize()`
  today). FP-2 gates the on-till editor by the **operator's own `till.configure` role** (a manager/admin
  logged into the till) — a new till route that calls `authorize()` for the role check, **no supervisor
  PIN-override parsing** (deferred). The dashboard editor uses the well-precedented
  `authorizeManager(till.configure)`.
- **Shared canvas component in `@waitron/ui`** (confirmed both apps depend on it) — the drag-drop canvas
  is a `wt-*` component consumed by till + dashboard, not forked per app.

## 1. Scope

**In:**

- placement columns on `dining_tables` (`pos_x`, `pos_y`, `shape`, `rotation`), all nullable
  (unplaced = tray);
- `setTablePlacement` / `clearPlacement` verbs + validation (`placement.invalid`);
- `listTablesWithState` extended to return the placement fields;
- a **shared `@waitron/ui` canvas component** that renders tokens (position + size-from-plazas +
  rotation, occupancy colour + badges in view mode) and, in edit mode, supports drag + grid-snap + a
  shapes palette + a rotate handle + a selection inspector, emitting placement changes;
- the till **floor screen map view** (canvas + unplaced tray + map/list toggle) and an on-till **"Editar
  plano"** edit toggle (manager-on-till gated);
- the dashboard **Sala** editor's per-zone **floor-plan editor**;
- placement persistence routes: dashboard (`authorizeManager(till.configure)`) and on-till
  (`authorize(till.configure)`, operator role — **net-new till auth hop**).

**Out (deferred, each purely additive — nullable data / new route, no destructive migration):** decor
(walls, bar, labels), background images, per-zone real-world dimensions (fixed aspect for now),
collision/overlap detection (free placement, overlap allowed), a **supervisor-PIN-override** path for
on-till editing (manager-on-till only this slice → a later slice adds override parsing + the first
till-side override route), and any change to FP-1's occupancy/status/served model.

## 2. Data model

All non-fiscal, all pre-production (no backfill — CLAUDE.md §3, §5).

### 2a. Placement columns on `dining_tables` (added to the FP-1/TS-1 table)

```text
dining_tables (FP-2 additions)
------------------------------
pos_x     smallint NULL   0..1000 (per-mille of canvas width)
pos_y     smallint NULL   0..1000 (per-mille of canvas height)
shape     floor_table_shape NULL   enum('round','square','rect')
rotation  smallint NULL   0..359 (degrees; edit UI snaps to 15°)
```

- A **new pgEnum** `floor_table_shape` (`'round' | 'square' | 'rect'`).
- **Size is not stored** — derived from `dining_tables.capacity` at render time via fixed thresholds
  (`≤2 → S`, `3–4 → M`, `5–6 → L`, `≥7 → XL` → token dimensions). A table with no `capacity` renders at
  a default M.
- **All four columns nullable together** — a table is "placed" iff `pos_x` **and** `pos_y` are non-null
  (the validator sets/clears them as a set; §3a). `shape`/`rotation` default to `round`/`0` when placed
  without an explicit choice.
- **Canvas aspect** is a fixed constant (defined once, client + any server-side default; a landscape
  ratio suited to a till, e.g. 3:2 — pinned in the plan). Per-zone dimensions can later live on
  `floor_zones` (FP-1) — additive, out of scope here.
- Additive-nullable on the existing FORCE-RLS `dining_tables`; TS-1's policy + `app_user` grants already
  cover them (grants table-wide, RLS row-level — confirm by the RLS test, §9). No new table, so
  `inmutabilidad` needs nothing new (it already covers `dining_tables`); re-run it after the migration
  to be sure the ALTER did not disturb FORCE.

### 2b. Migration

One `packages/db` migration set (number via `pnpm --filter @waitron/db db:generate` — **not hardcoded**):
create the `floor_table_shape` enum + add the four columns to `dining_tables`. `db:generate` should emit
only that — verify. Commit `meta/_journal.json` + snapshot. No custom part is required (no new table,
no new policy — the columns inherit `dining_tables`'s RLS). No backfill. **Sequences after FP-1's
migration** (which adds `zone_id`).

## 3. Behaviour

New code in `apps/server` beside FP-1's `tables.ts`; the shared canvas in `packages/ui`; the screens in
`apps/till` / `apps/dashboard`.

### 3a. Placement verbs (`apps/server/src/tables.ts`)

- `setTablePlacement(tx, cfg, tableId, { zoneId, posX, posY, shape, rotation }) → void` — validates: the
  table is `active` (`table.not_found`); the `zoneId` is a live zone (`zone.not_found` — reuse FP-1's);
  `posX` / `posY` are integers in `0..1000`; `shape` ∈ the enum; `rotation` in `0..359` — any failure →
  **`placement.invalid`** (a 400 whose params **name the offending field, never echo the value** —
  CLAUDE.md §1). Writes the four columns (+ `zone_id`).
- `clearPlacement(tx, cfg, tableId) → void` — sets `pos_x = pos_y = shape = rotation = NULL` (the table
  returns to the unplaced tray); `table.not_found` if absent.

### 3b. Read (extend `listTablesWithState`)

FP-1's read already returns `zoneId` + `pendingToServe`. FP-2 adds `posX?`, `posY?`, `shape?`,
`rotation?` (all null for an unplaced table). The map view derives size from the already-present
`capacity`. No new endpoint — the fields flow through TS-1's `GET /api/tables/state`.

### 3c. HTTP — two write paths, one novel

**Dashboard (management API — precedented).** `PUT /management-api/tables/:id/placement`
(`{ zoneId, posX, posY, shape, rotation }`) and `DELETE …/placement` (clear), gated exactly like the
layout routes: `requireManagementSession` then `authorizeManager(tx, { managementSessionId, permission:
"till.configure" })` (`packages/layouts/src/store.ts:56` / `management-api.ts:444` are the model).

**On-till (till API — NET-NEW auth surface).** `PUT /api/tables/:id/placement` (+ `DELETE`), gated by
the **operator's own role**: `requireSession(deps, c)` returns `{ personId, sessionId }`
(`till-session.ts:76-95`), and the route passes the **`sessionId`** (today only `personId` is used) to
a verb that calls `authorize(tx, { sessionId, permission: "till.configure" })`
(`packages/identity/src/authorize.ts:39-42`; role satisfied at `:54`). **No `override` is parsed** — a
regular waiter cannot edit; only a manager/admin operator (the roles that hold `till.configure`,
`permissions.ts:16` / `:51` / `:63`) can. This is the **first till route to call `authorize()`** and the
first to gate on `till.configure` (today `till.configure` is dashboard-only via `authorizeManager`, and
no till route calls `authorize()` — verb pattern to mirror, minus the override, is `record-void.ts:58-62`).
The plan builds and tests this hop explicitly, proving the gate by deletion.

All new routes wrapped in the shared `run` boundary (`till-api.ts:107`, `management-api.ts:135`), UUID
path params via `requireUuidId` (`:118-126`, 4xx not 500), `placement.invalid` in both `STATUS` maps.

## 4. Fiscal safety (H2)

**None.** FP-2 adds four nullable columns to a non-fiscal table and two config verbs/routes. Nothing goes
near `computeHuella` / the hash chain / `registros_facturacion` / invoice numbering / the alta builders;
the pay path is byte-unchanged. The plan states this with a grep receipt over `record-sale.ts` + the alta
builders, and pins that the huella is independent of any placement field (a placed table and the same
basket walk-up produce the identical huella — the FP-1 test already covers `served_at`; extend the
assertion set to placement).

## 5. Client — the shared canvas + the till map view

### 5a. Shared canvas component (`packages/ui`, e.g. `wt-floor-canvas`)

A `@waitron/ui` Lit element (the `wt-*` convention — `index.ts:4-11`), consumed by both apps
(`apps/till` + `apps/dashboard` already depend on `@waitron/ui`, `package.json:16`):

- **Props:** `.zone`, `.tables` (each with placement + occupancy/status/served fields), `.editable`
  (bool), `.gridSnap` (bool).
- **View mode:** a fixed-aspect canvas; each placed table drawn at (`posX`,`posY`)‰, sized from
  `capacity`, rotated by `rotation`, rendered as the **FP-1 occupancy token** (colour + status badge +
  "N por servir") — the token component is shared so occupancy semantics are not re-implemented. Tap a
  token → `open-table` (the FP-1 event). Unplaced tables are **not** drawn (the host renders the tray).
- **Edit mode (`editable`):** drag a token (position updates; grid-snap rounds to the grid), a shapes
  palette to set `shape`, a rotate handle (15° snap), a selection inspector (label / plazas / shape /
  zone / deactivate); dropping a tray table onto the canvas places it. Emits
  `placement-change { tableId, posX, posY, shape, rotation, zoneId }` and `placement-clear { tableId }`
  for the host to persist.

### 5b. Till floor screen (extend FP-1's `till-floor-screen`)

- A **map/list toggle**: **map** (the shared canvas, view mode) when the current zone has ≥1 placed
  table, else **list** (FP-1's cards); a manual toggle overrides for the session (local, not persisted).
- An **unplaced tray** strip (tables with null position) — tap to open, or (in edit mode) drag onto the
  canvas.
- An **"Editar plano"** toggle, **shown only when the operator holds `till.configure`** (role read from
  the session/`getTill` context) — entering edit mode passes `.editable` to the canvas and persists
  `placement-change` / `-clear` via `PUT/DELETE /api/tables/:id/placement`. The server re-checks the gate
  (client hiding is convenience, not security — CLAUDE.md).
- New `TillApi` methods: `setTablePlacement(tableId, body)`, `clearPlacement(tableId)` (local types).

### 5c. Dashboard Sala editor (extend FP-1's `sala-screen`)

A per-zone **floor-plan editor** tab: the same `wt-floor-canvas` in edit mode, persisting
`placement-change` / `-clear` via `PUT/DELETE /management-api/tables/:id/placement`. New `DashboardApi`
methods mirror the till's. The zone/table CRUD panels from FP-1 are unchanged.

## 6. Conventions

- **English identifiers** — `pos_x`, `pos_y`, `shape`, `rotation`, `floor_table_shape`. No new
  `SPANISH_WORDS`; UI copy localised en/es.
- **Domain error code** — `placement.invalid` (400; params name the field, never the value). Declared in
  `apps/server/src/errors.ts` (`import "./errors.js"`); reuse `table.*` / `zone.*` from FP-1. Never
  renamed once shipped.
- **Permissions:** reuse `till.configure` (both the dashboard `authorizeManager` path and the new till
  `authorize` path). No new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — the four placement columns visible + writable under the non-superuser `app_user`
  (differential — fails if `asAppUser` is dropped); `inmutabilidad` green after the ALTER (`dining_tables`
  still `relforcerowsecurity = true`). **The on-till `authorize(till.configure)` gate proven by
  deletion** — a manager operator's `PUT /api/tables/:id/placement` succeeds, a staff operator's is
  **403**, and dropping the `authorize` call makes the staff case wrongly succeed (red). Same for the
  dashboard route's `authorizeManager`.
- **PGlite** — `setTablePlacement` happy path + each `placement.invalid` branch (coord out of range, bad
  shape, bad rotation, inactive zone); `clearPlacement` nulls all four; `listTablesWithState` returns the
  placement fields (and null for an unplaced table).
- **`packages/ui`** — `wt-floor-canvas`: renders a token at the right scaled position + rotation + size;
  a drag in edit mode emits `placement-change` with grid-snapped coords; the rotate handle emits a
  15°-snapped `rotation`; a11y both themes. Coverage 95/95/90/88.
- **Till / dashboard** — the map/list toggle (map when placed, list otherwise); the tray; "Editar plano"
  hidden for a non-manager operator; placement persists via the route. `.a11y` both themes.
- **Fiscal** — extend FP-1's huella-independence assertion to placement (grep receipt + a filed-identical
  test).
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (ui, till, dashboard). Run `packages/db`
  unfiltered for tree-wide guards; `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies / open questions

- **Blocked on FP-1** (which is blocked on TS-1/TS-2). FP-2 is the spatial layer over FP-1's operable
  base; execute only after FP-1 lands. Re-verify FP-1's `listTablesWithState`, `sala-screen`,
  `till-floor-screen`, and the FP-1 occupancy-token component against real code before extending them
  (CLAUDE.md §1).
- **On-till editing is manager-on-till only** (§0/§3c). The **supervisor-PIN-override** path — the first
  till route to parse an override — is deferred; note it as the natural FP-3 (or a table-service auth
  slice), since building it also unlocks override-gated table actions generally.
- **Fixed canvas aspect** — one constant this slice; per-zone dimensions/background are later and additive
  on `floor_zones`.
- **No collision detection** — tables may overlap; acceptable for a manually-arranged small floor.

## 9. Provenance

Designed against the live tree on 2026-08-17, building on the FP-1 design and a targeted auth-surface
read (cited inline with `file:line`): `packages/identity/src/authorize.ts:39-67` (signature, role check
`:54`, override path `:58-67` — **not used this slice**), `record-void.ts:58-62` (the verb-side
`authorize` pattern to mirror), `apps/server/src/till-api.ts` (mount `:134`, `run` `:107`, `requireUuidId`
`:118-126`; **no route calls `authorize()` today** — grep hit only the `:205` comment),
`till-session.ts:76-95` (`requireSession` returns `{ personId, sessionId }`; `sessionId` currently
unused), `packages/identity/src/permissions.ts:16`/`:51`/`:63` (`till.configure` = manager + admin, not
supervisor/staff), `packages/layouts/src/store.ts:56` + `management-api.ts:444` (the `authorizeManager`
dashboard model), and `packages/ui/src/index.ts:4-11` + `apps/{till,dashboard}/package.json:16` (the
shared `wt-*` library both apps consume). The dependency on FP-1/TS-1/TS-2 symbols (`dining_tables`,
`listTablesWithState`, the occupancy token, `sala-screen`, `till-floor-screen`) is cited to their
**specs**, re-verified against real code in the plan once those slices land.
