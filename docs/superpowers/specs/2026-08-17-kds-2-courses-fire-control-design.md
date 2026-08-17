# KDS-2 — Courses & fire control

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** the second KDS slice (sub-project 12). **Runs SUPERVISED**. **Builds on
[KDS-1](2026-08-17-kds-1-stations-routing-tickets-design.md)** (`ticket_items`, `fireLines`,
`listStationQueue`, the station display) — specced, **unbuilt**.

KDS-1 fires every line to the kitchen the moment its round is sent. That is wrong for a sit-down table:
a table's mains should not cook alongside its starters. KDS-2 adds **courses** (a venue-defined
sequence — Entrantes / Principales / Postres) and **hold-and-fire**: the first course fires on send,
later courses are **held** (visible-but-greyed on the station display) until someone **fires** them.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Courses are a venue-configured set** — a `kitchen_courses` config (name + order), the same shape
  family as `kitchen_stations` (KDS-1) / statuses / zones. (Over a fixed built-in set.)
- **Course assignment: product default + per-line override** — a product carries a default course
  (`products.course_id`, exactly like `products.station_id`), overridable when ringing. (Over
  round=course and waiter-picks-every-line.)
- **Fire control is a venue setting** — `fire_control` = **`waiter`** (default) or **`kitchen`**; KDS-2
  builds **both** (waiter-fire from the tab, kitchen-fire from the station display), the setting deciding
  which surface shows the affordance. `expo` is a **future third value** (KDS-3). **The first course
  auto-fires**; held courses show **greyed** on the station display. (This mirrors how real table service
  works — the first course starts immediately, later courses fire on a timing judgement, usually the
  server's; genuine venue variation → configurable.)

## 1. Scope

**In:** a `kitchen_courses` config entity + CRUD + a dashboard editor; `products.course_id` (default) +
`working_order_lines.course_id` (resolved at ring time, overridable); `ticket_items` gains
`course_id` (snapshotted) + `fired_at` (held/fired); a **course resolver** at ring time; auto-fire of
the first course + a **`fireCourse`** verb; the **`fire_control`** venue setting; the KDS-1 station
display grouped by course with held items greyed + a kitchen fire action; the tab-ordering screen gaining
a course picker + a waiter fire action.

**Out → KDS-3:** the `expo` fire mode + the expo/pass view. **Out:** a timer/auto-fire mode; per-guest
seat numbers; coursing across a *joined* multi-table tab beyond what the tab already models; any change to
KDS-1's station routing or the fiscal path.

## 2. Data model

All non-fiscal, pre-production (**no backfill** — CLAUDE.md §3, §5).

### 2a. `kitchen_courses` (new, `packages/db/src/schema/`)

Tenant + location config (the `kitchen_stations` shape).

```text
kitchen_courses
---------------
id            uuid PK
tenant_id     uuid → tenants (restrict)
location_id   uuid  composite FK (tenant_id, location_id) → locations
name          text NOT NULL          ("Entrantes", "Principales", "Postres")
display_order int  NOT NULL DEFAULT 0    -- THE COURSE SEQUENCE (lowest = first, auto-fired)
active        bool NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)
UNIQUE (tenant_id, location_id, name)
```

FORCE RLS + `kitchen_courses_tenant_isolation` policy + `GRANT SELECT,INSERT,UPDATE TO app_user` (no
DELETE — deactivate) in a **hand-written custom migration** (model `0036`). Auto-covered by
`inmutabilidad` (keys on `tenant_id`).

### 2b. Course columns + `fired_at`

```text
products.course_id             uuid NULL  composite FK (tenant_id, course_id) → kitchen_courses   -- product default
working_order_lines.course_id  uuid NULL  composite FK (tenant_id, course_id) → kitchen_courses   -- resolved at ring time, overridable
ticket_items.course_id         uuid NULL  composite FK (tenant_id, course_id) → kitchen_courses   -- snapshotted at fire time (like station_id)
ticket_items.fired_at          timestamptz NULL      -- NULL = HELD (greyed, not workable); set = fired (workable)
```

- Additive-nullable on existing tables (catalogue `products`; KDS-1's `working_order_lines` already
  carries KDS-adjacent fields; KDS-1's `ticket_items`). A null `course_id` means "no course" — such lines
  fire immediately (treated as the earliest course).
- A held item (`fired_at IS NULL`) shows on the station display **greyed** and **cannot advance**
  (`queued→preparing→ready` is gated on `fired_at IS NOT NULL`).

### 2c. `fire_control` venue setting

`fire_control` on `locations` (like KDS-1's `bump_mode`): `'waiter'` (default) | `'kitchen'` (a pgEnum
`fire_control_mode`, extensible with `'expo'` in KDS-3). Governs only which **UI** surfaces the fire
action — the `fireCourse` verb is the same either way (§3c).

### 2d. Migration

One `packages/db` migration set (number via `db:generate`): create `kitchen_courses` + the
`fire_control_mode` enum; add `products.course_id`, `working_order_lines.course_id`,
`ticket_items.course_id`, `ticket_items.fired_at`, `locations.fire_control`; custom part = FORCE RLS +
policy + grants on `kitchen_courses` + the four composite FKs. Commit journal + snapshot. Re-run
`inmutabilidad`. **Sequences after KDS-1** (the `ticket_items` / `working_order_lines` targets).

## 3. Behaviour (`apps/server`, beside KDS-1's `kitchen.ts` / `working-order.ts`)

### 3a. Course config + assignment (`till.configure`)

- `createCourse`/`listCourses`/`updateCourse`/`deactivateCourse` → `course.name_taken`/`course.not_found`.
- `setProductCourse(productId, courseId | null)` — the product default (catalogue config).
- The `fire_control` setting is read/written with the other venue config.

### 3b. Course resolution at ring time (extend KDS-1's line-add path)

When a line is added (`addTabRound` / the order path), resolve `course_id = <override> ?? product.course_id`
and store it on `working_order_lines`. The tab-ordering UI (§5) offers a per-line course override.

### 3c. Fire (auto-first + `fireCourse`)

- **At fire time** (KDS-1's `fireLines` creating `ticket_items`), each item snapshots `course_id` from its
  line and computes `fired_at`: **fired (`now()`) if** its course is already fired for this order **or**
  its course is the order's **earliest** course (min `display_order`, nulls treated as earliest); **else
  NULL (held)**. So the first course auto-fires; later courses are held.
- `fireCourse(tx, cfg, orderId, courseId) → void` — sets `fired_at = now()` on all **held** items of that
  order + course; idempotent (already-fired items untouched); `course.not_found` for an unknown course.
  **Operational** — `requireSession` (a waiter or kitchen operator). The `fire_control` setting decides
  which UI shows the button, **not** who may call it (both surfaces are session-gated).
- **Advance is gated on fired** — `advanceTicketItem` (KDS-1) refuses a held item
  (`ticket.item_held`, a new code) so the kitchen can't bump food it hasn't started.

### 3d. HTTP

Config on the management API (`till.configure`): courses CRUD, product course, `fire_control`.
Operational on the till API (`requireSession`): `POST /api/orders/:id/courses/:courseId/fire` (fireCourse).
The station read (`listStationQueue`, KDS-1) now returns each item's `course` + `fired_at`; grouping/greying
is the client's. Reuse `run` / `STATUS` / `requireUuidId`.

## 4. Fiscal safety (H2)

**None.** Courses + fire are pre-fiscal kitchen coordination over KDS-1's non-fiscal ticket model; the
pay/collect path is byte-unchanged. The plan states this with a grep receipt (no course/fire field reaches
`record-sale.ts` / the alta builders).

## 5. Client

### 5a. Station display (extend KDS-1's `till-station-screen`)

Group the queue **by course** (course header, in `display_order`); **held** items (`fired_at IS NULL`)
render **greyed** and non-advanceable; fired items behave as KDS-1. When `fire_control = 'kitchen'`, each
held course shows an **"Empezar curso"** action → `POST …/courses/:id/fire`. Bump still per-line / whole-ticket
(KDS-1), but only on fired items.

### 5b. Tab-ordering screen (extend the FP-1 table-ordering screen)

A **per-line course picker** (default from the product, overridable) when ringing a round. When
`fire_control = 'waiter'`, the tab shows a **"Fire <course>"** action per held course → `POST
…/courses/:id/fire`. (The FP-1 ordering screen is where a waiter already works the tab — the natural home
for waiter-fire.)

### 5c. Dashboard (extend the KDS-1 Cocina config)

A **Cursos** panel (course CRUD + order) beside the Estaciones panel; the `fire_control` setting toggle;
and a **course** field on the product editor (beside the product's station). `till.configure`-gated,
`@waitron/ui`, both-theme a11y.

## 6. Conventions

- **English identifiers** — `kitchen_courses`, `course_id`, `fired_at`, `fire_control`,
  `fire_control_mode`, `display_order`. No new `SPANISH_WORDS`; UI copy en/es.
- **Domain error codes** — `course.name_taken`, `course.not_found`, `ticket.item_held`. `import
  "./errors.js"`; reuse KDS-1's `ticket.invalid_transition` / `station.*`. Never renamed once shipped.
- **Permissions** — `till.configure` (config), `requireSession` (fire). No new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `kitchen_courses` cross-tenant RLS (by deletion) + negative `WITH CHECK`;
  `inmutabilidad` green after the migration.
- **PGlite** — course CRUD + `course.name_taken`/`not_found`; the **course resolver** (product default +
  override); **auto-fire-first** (send a round with two courses → the earliest course's items are `fired_at`-set,
  the later course's are NULL); **`fireCourse`** fires a held course's items + is idempotent; **advance
  refuses a held item** (`ticket.item_held`) and works once fired; a **null-course line** fires immediately.
- **Fiscal** — the H2 grep receipt.
- **Till / dashboard** — the station display groups by course + greys held + shows the kitchen fire action
  under `fire_control='kitchen'`; the tab shows the course picker + the waiter fire action under
  `'waiter'`; dashboard course CRUD + product-course + the setting; `.a11y` both themes.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (till, dashboard). Run `packages/db` unfiltered;
  `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on KDS-1** (`ticket_items`, `fireLines`, `listStationQueue`, `advanceTicketItem`, the station
  display) and touches the **FP-1** tab-ordering screen (the waiter-fire home + the course picker) → build
  after KDS-1 (→ TS-1/FP-1). Re-verify those symbols against real code first (CLAUDE.md §1).
- **KDS-3 adds** the `expo` `fire_control` value + the expo/pass view; the `fire_control` enum and the
  `fireCourse` verb are built to carry it (an additive enum value + a new surface).

## 9. Provenance

Designed against the live tree + the KDS-1 design on 2026-08-17. The reused patterns: `kitchen_stations`
(the config shape), `products.station_id` (the product-default mirror), `ticket_items` + `fireLines` +
`advanceTicketItem` + `listStationQueue` (KDS-1, the fire/advance/read hosts), `locations.bump_mode` (the
venue-setting mirror for `fire_control`), and the FP-1 tab-ordering screen (the waiter-fire home) — all
cited to the KDS-1 / FP-1 specs, re-verified against real code in the plan once those slices land
(CLAUDE.md §1). The kitchen-practice claims in §0 are general table-service practice, stated as such, not
a cited source.
