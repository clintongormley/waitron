# KDS-3 — Expo / pass

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** the third KDS slice (sub-project 12), completing the KDS design. **Runs SUPERVISED**. **Builds
on [KDS-1](2026-08-17-kds-1-stations-routing-tickets-design.md)** (ticket model, stations, the station
display) **and [KDS-2](2026-08-17-kds-2-courses-fire-control-design.md)** (courses, `fired_at`,
`fireCourse`, the `fire_control` setting) — both specced, **unbuilt**.

KDS-1/2 give each **station** its own queue. But no one sees a **table's whole order across stations** —
so nobody can tell when a table's *main course* is ready to leave as one plate-up, or coordinate the
grill and the cold station finishing together. That is the **expediter / pass**. KDS-3 adds a dedicated
**expo display** aggregating every open order across all stations by course, with the pass's coordination
levers: **fire** the next course, **bump a whole course ready** across its stations in one tap, and mark
a course **away** (plated and dispatched — feeding the floor an "en camino" hint).

## 0. Owner decisions this slice is built on (2026-08-17)

- **A dedicated expo display** — a new pass screen (session-gated now, reusing KDS-1's display infra; an
  `expo` **device kind** can be added once device-identity is built). (Over a "pass station" that would
  conflate a routing target with a cross-station aggregator, and over a dashboard-only overview.)
- **The fullest pass action set** — the aggregated view **plus** fire-the-next-course (wiring KDS-2's
  `expo` `fire_control` value) **plus** a course-level **away** marker (feeds a floor "en camino" hint —
  a new state between kitchen-`ready` and waiter-`served`) **plus** a one-tap **bump-course-ready** across
  all a course's stations.

## 1. Scope

**In:** `ticket_items.away_at` (course dispatched from the pass); the `expo` value on KDS-2's
`fire_control` enum; a cross-station **expo read** (all open orders, by course, across stations); expo
verbs — `bumpCourseReady`, `markCourseAway` (and reuse KDS-2's `fireCourse` under the `expo` mode); a
**floor** extension (`enRoute` → "en camino"); the **expo display** screen (session-gated).

**Out:** an `expo` **device kind** (a future device-identity `device_kind` value + a device group — the
expo display is session-gated now); per-guest seat coursing; auto-away/timers; any change to the fiscal
path or to KDS-1's station routing.

## 2. Data model

All non-fiscal, pre-production (**no backfill**).

### 2a. `ticket_items.away_at` (new nullable column)

```text
ticket_items.away_at  timestamptz NULL   -- the pass dispatched this item's course (plated & sent); NULL = not away
```

Item lifecycle now: **held** (`fired_at IS NULL`) → **fired** → `queued → preparing → ready` → **away**
(`away_at` set). Additive-nullable on KDS-1's `ticket_items`; its policy + grants cover it.

### 2b. `fire_control` gains `expo`

KDS-2's `fire_control_mode` enum (`['waiter','kitchen']`) gains **`'expo'`** — under it, the fire action
lives on the expo display, not the tab or the station. (An additive enum value.)

### 2c. Migration

One `packages/db` migration set (number via `db:generate`): add `ticket_items.away_at`; `ALTER TYPE
fire_control_mode ADD VALUE 'expo'`. No new table, no custom RLS part (the column inherits `ticket_items`'
RLS). Re-run `inmutabilidad` (the ALTER must not disturb FORCE). **Sequences after KDS-2** (the
`fire_control_mode` enum + `ticket_items` targets). *(Note: `ADD VALUE` to a Postgres enum cannot run
inside a transaction with its use in the same migration — the plan splits it if `db:generate` wraps the
migration in a tx; enum-add then a separate statement.)*

## 3. Behaviour (`apps/server`, beside KDS-1/2's kitchen code)

### 3a. Expo read (cross-station)

`listExpoQueue(tx, cfg, locationId?) → ExpoOrder[]` where each `ExpoOrder` is

```text
ExpoOrder = {
  orderId, tableLabel?, orderNumber, openedMinutes,
  courses: [ { courseId, courseName, displayOrder, fired: bool, away: bool,
               items: [ { id, name, qty, stationName, state, firedAt, awayAt } ] } ]
}
```

— every **open** order (excluding fully-away/collected/abandoned orders), its `ticket_items` grouped by
**course** (in `display_order`) then listing items with their **station** + kitchen state. A course is
`fired` when its items have `fired_at`, `away` when they have `away_at`. This is the cross-station join
KDS-1's per-station `listStationQueue` deliberately is not. Node-scoped.

### 3b. Expo verbs (operational, `requireSession`)

- `bumpCourseReady(tx, cfg, orderId, courseId) → void` — advance **every fired, not-yet-ready** item of
  that order+course (across all its stations) to `ready` in one call (reusing KDS-1's per-item advance
  logic in a set-based UPDATE). Held items are skipped (not fired); no-op if none.
- `markCourseAway(tx, cfg, orderId, courseId) → void` — set `away_at = now()` on the order+course's items
  that are **`ready`** (you dispatch what's plated); `course.not_found` for an unknown course. Idempotent
  on already-away items. An order whose every item is `away` (or served) leaves the expo read.
- `fireCourse` (KDS-2) is **reused** — under `fire_control = 'expo'`, the expo display surfaces it.

### 3c. Away → floor (extend the FP-1 / KDS-1 read)

Extend `listTablesWithState` (already carrying KDS-1's `readyToServe`) with **`enRoute`** = the table's
tab lines whose ticket item is `away` and `served_at IS NULL` (dispatched, not yet acknowledged by the
waiter). The floor renders the most advanced hint per table: **en camino** (`enRoute`) over **listos**
(`readyToServe`) over **por servir** (`pendingToServe`). The waiter's `served_at` (FP-1) remains the final
ack.

### 3d. HTTP

Operational on the till API (`requireSession`): `GET /api/expo/queue`; `POST
/api/orders/:id/courses/:cid/ready` (`bumpCourseReady`); `POST /api/orders/:id/courses/:cid/away`
(`markCourseAway`); `fireCourse` reuses KDS-2's route. Config: the dashboard `fire_control` toggle gains
the `expo` option (KDS-2's setting surface). Reuse `run` / `STATUS` / `requireUuidId`.

## 4. Fiscal safety (H2)

**None.** The expo is a read + coordination markers over KDS-1/2's non-fiscal ticket model; `away_at`
and the floor `enRoute` touch nothing filed; the pay path is byte-unchanged. Grep receipt in the plan.

## 5. Client — the expo display (`apps/till`, new `till-expo-screen`)

Session-gated; a full-screen pass board of every open order (a card per order), each grouped by **course**
in `display_order`:

- per course: a **fire** action when held **and** `fire_control='expo'`; a **"Curso listo"**
  (`bumpCourseReady`) when fired; an **"En camino / Away"** (`markCourseAway`) when ready — the pass's
  three levers, shown by course state;
- per item: name · qty · **station** · state (so the expo sees the grill lagging the cold station);
- age/urgency colouring; away courses drop off.

Reuses KDS-1's token/queue rendering; the new shape is the cross-station **per-order** grouping. Registered
in the till screen machine; `TillApi` gains `getExpoQueue` / `bumpCourseReady` / `markCourseAway` (and
reuses `fireCourse`). `.a11y` both themes.

## 6. Conventions

- **English identifiers** — `away_at`, `expo`. Floor field `enRoute`. No new `SPANISH_WORDS`; UI copy en/es
  ("En camino").
- **Domain error codes** — reuse `course.not_found`, `ticket.*`; no new code needed (the expo verbs are
  set-based and idempotent). `import "./errors.js"` where thrown.
- **Permissions** — `requireSession` (expo actions); `till.configure` (the `fire_control='expo'` setting).
  No new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **PGlite** — `listExpoQueue` aggregates an order across two stations grouped by course, with fired/away
  flags; `bumpCourseReady` advances all a course's fired items to ready (skips held) across stations;
  `markCourseAway` sets `away_at` on the ready items + is idempotent; a fully-away order drops out of the
  expo read; the floor `enRoute` counts away-not-served, and the floor precedence (en camino > listos >
  por servir) is correct.
- **Real Postgres** — the `fire_control_mode` `ADD VALUE 'expo'` migration applies and `inmutabilidad`
  stays green; `ticket_items.away_at` visible/writable under `app_user`.
- **Fiscal** — the H2 grep receipt.
- **Till** — the expo board groups by order+course, shows the three per-course levers by state, and the
  actions call the routes; `.a11y` both themes.
- Coverage **98/98/98/95** (db, server), **95/95/90/88** (till). Run `packages/db` unfiltered;
  `TESTCONTAINERS_RYUK_DISABLED=true` locally.

## 8. Sequencing / dependencies

- **Builds on KDS-1 + KDS-2** (`ticket_items`, courses, `fired_at`, `fireCourse`, the `fire_control` enum,
  the station-display infra) and extends the **FP-1/KDS-1 floor read** (`enRoute`) → build after KDS-1 +
  KDS-2 (→ TS-1/FP-1). Re-verify those symbols against real code first (CLAUDE.md §1).
- **The `expo` device kind** — once **device identity** is built, an `expo_pass` `device_kind` + a device
  group let the pass screen run always-on without a login (the KDS-3 expo screen is built session-gated
  and gains device mode then, exactly as the KDS-1 station display does). Additive.
- **This completes the KDS track's design** — KDS-1 (core), KDS-2 (courses), KDS-3 (expo) + the device
  identity spin-off are all specced + planned.

## 9. Provenance

Designed against the KDS-1 + KDS-2 designs on 2026-08-17. Reused: `ticket_items` + `advanceTicketItem` +
`listStationQueue` (KDS-1, the item model + per-station read this aggregates over), `fired_at` +
`fireCourse` + `fire_control_mode` (KDS-2, the course/fire host the `expo` value + away extend),
`listTablesWithState` + `readyToServe`/`served_at` (FP-1/KDS-1, the floor read `enRoute` extends), and the
KDS-1 station-display infra (the expo screen's base). All cited to the KDS-1/KDS-2/FP-1 specs, re-verified
against real code in the plan once those slices land (CLAUDE.md §1). The Postgres enum `ADD VALUE`
transaction caveat (§2c) is a known PostgreSQL constraint, to be verified against `db:generate`'s output
in the plan.
