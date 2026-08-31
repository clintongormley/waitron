# KDS order-timing alerts — design

**Status:** approved (brainstorm 2026-08-30). Demo Tier B #9 in `docs/backlog.md`.

## 1. Problem

The owner wants to "spot orders taking too long, or forgotten" (2026-08-29). The KDS station
queue already *ages* every order into three colour buckets — fresh `<5 min` / warm `<10` / hot
`≥10` — but the thresholds are hardcoded, the aging is passive colour (nothing escalates, no
count, no cross-station view), and a dish that is cooked but never run to the table is invisible.

This feature turns that passive colour into a configurable, escalating, cross-surface alert:

- **Per-station configurable thresholds** (the 5/10 constants become owner-set, per station).
- **Three escalation bands** — warm → overdue → **forgotten**.
- **Active surfacing** on every screen that shows an order: the KDS station queue, the expo
  pass, the floor (a table with a forgotten order **flashes red**), and a **manager overview**
  ("orders taking too long").

### 1.1 Explicitly out of scope

- **Real-time server push (SSE/WebSocket).** Considered and deferred (owner, 2026-08-30). The app
  is pull-only; this feature stays pull-only, using a **client-side ticking clock** so bands
  advance live between action-refreshes. A real push subsystem remains the backlog's *"handheld
  live updates"* item (`docs/backlog.md` → Debt → cross-cutting), which is where the eventual
  websocket work lives. Nothing here should be shaped around a push model.
- **Per-station *kind*** (bar/kitchen/grill as data). Stations are name-only today; thresholds are
  per-station-row, not per-kind.
- **Unbumped-since-fire "neglect" metric.** Bands are total-age based (see §3), not a separate
  neglect clock.

## 2. Non-negotiable constraints

- **Nothing may block a sale** (CLAUDE.md §5). This feature is read-model classification plus one
  config column; it touches **no** `registros`/huella/alta path. The fiscal write path must be
  **byte-unchanged** — grep-proven, per house habit.
- **No colour/motion as the only signal** (a11y house rule; the existing accent is a left border,
  never colour-behind-text). Every band carries a non-colour tell (count badge, label, icon), and
  the forgotten *flash* has a `prefers-reduced-motion` steady-red fallback.
- **Spanish schema vocabulary where it is fiscal; English identifiers otherwise.** These are
  operational-config columns on `kitchen_stations`, not fiscal tables — English column names
  (`warm_after_minutes`, …), consistent with the existing `bump_mode`/`fire_control` siblings.

## 3. The single age definition

**One definition, used by every surface.** A kitchen line ages from `ticket_items.queued_at`
(the moment it reached its station after fire) and **stops when it reaches the guest**:

- table-service line → `working_order_lines.served_at`
- counter order → `working_orders.collected_at`

So a line still cooking ages on the **station queue**; a line bumped-but-not-run keeps aging on the
**expo/floor** (the truly "forgotten" dish); once served/collected it is off the clock entirely.

**Band** for a line = `now − queued_at`, in minutes, compared against **that line's station's**
three thresholds:

| age                              | band        |
| -------------------------------- | ----------- |
| `< warm_after_minutes`           | `fresh`     |
| `≥ warm, < overdue`              | `warm`      |
| `≥ overdue, < forgotten`         | `overdue`   |
| `≥ forgotten_after_minutes`      | `forgotten` |

Because every fired line snapshots a `station_id` (`working-order.ts:677`), the per-station
thresholds always resolve — no fallback logic needed.

- An **order's** band = the worst band across its **unserved** lines.
- A **table's** band = the worst band across its orders' unserved lines.

Ordering of the band scale (for "worst"): `fresh < warm < overdue < forgotten`.

## 4. Data model

Three columns on `kitchen_stations` (`packages/db/src/schema/kitchen-stations.ts`):

```ts
warmAfterMinutes:      integer("warm_after_minutes").notNull().default(5),
overdueAfterMinutes:   integer("overdue_after_minutes").notNull().default(10),
forgottenAfterMinutes: integer("forgotten_after_minutes").notNull().default(15),
```

A custom migration (`drizzle-kit generate --custom`) does the `ALTER TABLE ADD COLUMN` **plus** a
named `CHECK`:

```sql
ALTER TABLE kitchen_stations
  ADD CONSTRAINT kitchen_stations_thresholds_ordered
  CHECK (warm_after_minutes < overdue_after_minutes
     AND overdue_after_minutes < forgotten_after_minutes);
```

`kitchen_stations` is a `tenant_id`-bearing, already-FORCE-RLS'd table, so this is a **plain
column add** — no new policy, no new grants. The `NOT NULL DEFAULT` keeps every existing station
inert-but-sensible (5/10/15). The `inmutabilidad` guard
(`packages/fiscal-verifactu`, scans every `tenant_id` table) must stay green after the migration.

## 5. The shared classifier and the ticking clock

Two small shared pieces kill the current 5/10 duplication (today `station-queue.ts:405` and
`till-expo-screen.ts:469` each hardcode their own buckets).

### 5.1 `classifyBand` — pure, in `packages/shared`

```ts
export type TimingBand = "fresh" | "warm" | "overdue" | "forgotten";
export interface StationThresholds {
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}
export function classifyBand(
  queuedAtMs: number,
  nowMs: number,
  t: StationThresholds,
): TimingBand;           // fresh below warm; boundary is ≥ (at-threshold counts as the higher band)
export const BAND_RANK: Record<TimingBand, number>;   // fresh 0 … forgotten 3, for worst-wins
```

`packages/shared` is importable by **both** `apps/server` (read-models) and the frontend apps, so
the server's authoritative band and the client's ticked band use identical logic. (It is a
GENERIC-package under the english-only guard — identifiers stay English; `fresh/warm/overdue/
forgotten` are English.)

### 5.2 The ticking clock — a Lit reactive controller in `@waitron/ui`

A `TickingClock` reactive controller (or a `useTickingClock` helper) that bumps a host's injectable
`now` every ~15–30 s via `setInterval`, cleared on `hostDisconnected`. Widgets already accept
`@property now?: number` — the controller just drives it, so a screen sitting untouched watches an
order climb fresh → warm → overdue → forgotten **client-side from the timestamps + thresholds the
server already handed it**. It honours `prefers-reduced-motion` for the *flash* animation only (the
ticking itself is unaffected — bands still advance).

New orders still arrive on the existing action-refresh; the tick advances only the aging of data
the client already holds.

## 6. Server read-models (band on the DB clock)

Each read-model that feeds an affected screen gains the per-line age and the joined station
thresholds, and computes the authoritative band with the same `now()`-based SQL the expo queue
already uses (`floor(extract(epoch from (now() - queued_at)) / 60)`):

- **`listStationQueue`** — per-line age + band (join `kitchen_stations` thresholds).
- **`listExpoQueue`** (`working-order.ts:2773`) — already computes `openedMinutes`; add per-line
  band off `queued_at` + the line's station thresholds, and the order's worst band.
- **`listTablesWithState`** — add a per-table **worst band** over unserved lines, so the floor
  knows which tables to flash without shipping every line.

The client still re-derives bands from the tick, but the server band is authoritative on fetch and
seeds the first render (no flash-of-wrong-colour).

> **Correlated-subquery caution** (CLAUDE.md §3): a per-line band that reaches out to the outer
> table inside a `sql` scalar subquery must use qualified column literals and be checked with
> `query.toSQL()` — the `dining_tables`/`working_orders` base-vs-join bug lives exactly here.

## 7. The surfaces

### 7.1 KDS station queue (`apps/till/src/widgets/station-queue.ts`)

- Three bands (was two): `warm` amber, `overdue` red, `forgotten` red **+ repeating flash**
  (reduced-motion → steady red + icon/label). Still a **left-border accent**, never behind text.
- Apply the accent to the **kanban** lens too (today only the rail lens accents).
- A **per-station overdue count badge** in the header ("3 overdue") — the count is legible, not
  merely inferred from colours.
- Drop the hardcoded `#ageBucket` 5/10; call `classifyBand` with the station's thresholds; drive
  `now` from the `TickingClock`.

### 7.2 Expo pass (`apps/till/src/screens/till-expo-screen.ts`)

- Swap the hardcoded 5/10 for `classifyBand` + per-line station thresholds.
- A forgotten **item** on a card is flagged (its station is lagging); the card head shows the
  order's worst band.
- An **overdue/forgotten count** across the whole pass at the top.

### 7.3 Floor / till — the flash-red requirement

- `listTablesWithState` returns each table's worst band; the floor renders a table whose worst
  unserved line is **forgotten** with a **flashing-red** tile (reduced-motion → steady red +
  badge). `warm`/`overdue` get a subtler steady accent so the escalation reads as one scale:
  **amber (warm) → red (overdue) → flashing-red (forgotten)**.
- The `TickingClock` drives the flash so a table starts flashing while the floor sits idle.

### 7.4 Manager overview — "orders taking too long"

- A fifth `GET /management-api/reports/*` route (`apps/server/src/report-api.ts`), reusing
  `buildReportContext`, gated **`report.view`** (supervisor+), backed by a new reporting query
  (`packages/reporting`) returning currently-open orders whose worst unserved line is `overdue` or
  `forgotten` — table/order, station, age, band — **worst-first**.
- Surfaced on the existing `dashboard-overview-screen`: a **count tile** ("2 orders overdue") plus
  a short **list** (table · station · minutes · band).
- **This is the one screen that refetches on an interval** (~30 s) — a passive monitoring board,
  which is what polling is for. Still no server push.

## 8. Config editing — the per-station threshold editor

The station CRUD form on the kitchen screen (`apps/dashboard/src/screens/kitchen-screen.ts`) gains
three minute fields (warm / overdue / forgotten) per station, saved through the **existing**
station `PATCH /management-api/stations/:id` verb — extend `updateStation`
(`apps/server/src/kitchen.ts`) to accept and validate the three values — gated **`till.configure`**
(manager+), the same path `bump_mode`/`fire_control` already use. Client-side validation mirrors
the DB `CHECK` (`warm < overdue < forgotten`); the route rejects a bad set with
`management.request_invalid`. Defaults (5/10/15) mean an owner who never opens it still gets
sensible behaviour.

No new permissions: config = `till.configure`, overview = `report.view`.

## 9. Error handling

- Thresholds are `NOT NULL DEFAULT` + DB `CHECK`, so a malformed save is rejected at the route and
  an un-ordered set can never persist.
- Nothing here touches a sale or the fiscal chain — §5's "nothing blocks a sale" is untouched, to
  be grep-confirmed byte-unchanged on the fiscal write path.
- A station with no lines simply reports no bands; a served/collected line drops off the clock.

## 10. Testing (TDD, failing-test-first)

- **`classifyBand` unit** — every boundary (exactly-at vs just-under each threshold), all four
  bands, injected clock; `BAND_RANK` worst-wins. Proven by boundary cases, not a happy path.
- **Read-model (real-PG where RLS/joins matter)** — `listStationQueue` / `listExpoQueue` /
  `listTablesWithState` return the right band for a line at a given age against its station's
  thresholds; worst-line-wins for an order/table; **a served/collected line drops off the clock**
  (the load-bearing "until served" rule — advance `served_at`/`collected_at`, assert band clears).
- **Reports route** — overdue/forgotten only, worst-first; `report.view` gate (401/403).
- **`updateStation` validation** — the route/`CHECK` rejects `warm ≥ overdue ≥ forgotten`; proven
  by deletion of the guard.
- **Migration (real-PG)** — columns exist with defaults, the `CHECK` bites, RLS/grants unchanged;
  run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (`kitchen_stations` is a
  `tenant_id` table).
- **Widget** — the ticking clock advances a band with no refetch (inject `now`, assert
  accent/badge/flash class change); reduced-motion renders the steady fallback.

## 11. Boot threading

Per-station thresholds reach the till/KDS/expo widgets the way `bumpMode`/`fireControl` already do
— through the boot/read-model payload (`apps/server/src/till-api.ts`), not a separate fetch. The
floor and station-queue read-models carry each line's station thresholds so the client can tick
locally. The manager overview fetches its own `/reports/` route.

## 12. Files touched (map)

- **schema/migration:** `packages/db/src/schema/kitchen-stations.ts` + a custom migration + its
  `_rls` sibling if the generator emits one; the RLS-settability test.
- **shared:** `packages/shared/src/…` — `classifyBand`, `TimingBand`, `BAND_RANK`,
  `StationThresholds` (+ barrel export).
- **ui:** `@waitron/ui` — the `TickingClock` reactive controller.
- **server read-models:** `apps/server/src/working-order.ts` (`listStationQueue`, `listExpoQueue`,
  `listTablesWithState`), `apps/server/src/kitchen.ts` (`updateStation`),
  `apps/server/src/management-api.ts` (station PATCH body), `apps/server/src/report-api.ts` (new
  route), `apps/server/src/till-api.ts` (boot threading).
- **reporting:** `packages/reporting/src/…` — the overdue-orders query.
- **till widgets/screens:** `station-queue.ts`, `till-expo-screen.ts`, the floor screen/table tile.
- **dashboard:** `kitchen-screen.ts` (threshold editor), `dashboard-overview-screen.ts` (count
  tile + list).

## 13. Follow-ups (recorded, not built here)

- **Real-time push** — the flash/counts advance via a client clock only; new orders still need an
  action-refresh on the operational screens. A push channel is the deferred *handheld live
  updates* subsystem; this feature is designed to drop straight onto it later (the surfaces already
  react to fresh read-model data).
- **Station kind** (bar/kitchen/grill as data) — would let thresholds default per kind; name-only
  today.
- **Unbumped-since-fire neglect metric** — a truer "nobody has touched this" signal than total
  age; deferred.
- **Delivery-order floor flash** (implementation ruling, 2026-08-31) — `listTablesWithState.timingBand`
  is scoped to the open **tab** only, matching every existing floor urgency field
  (`pendingToServe`/`readyToServe`/`enRoute`). A **counter/delivery order** pinned to a table via
  `working_orders.delivery_table_id` therefore does NOT flash the floor tile, though it is still banded
  and visible on the station queue and expo board. Extending the floor to flash for a delivery order
  going cold is a follow-up (add a `del`-lateral to the floor read-model's worst-band reduction).
- **Idle-floor escalation** (implementation ruling, 2026-08-31) — unlike the station queue and expo
  (which carry per-item `queuedAt` + `thresholds` and re-derive the band on a `TickingClock` tick), the
  floor read-model ships only the reduced worst `timingBand` per table (§5.3, "without shipping every
  line"), so the floor has nothing to re-tick and no `TickingClock` is wired. A table therefore only
  escalates a band on the floor's next refetch (a table action), not while the floor sits open and
  untouched. §7.4 keeps polling to the manager overview alone, so closing this would mean shipping
  per-table raw age (or a min-time-to-next-band-crossing) so the floor can advance client-side. Deferred.
- **Simplify-pass follow-ups (finish-branch, 2026-08-31)** — the four cleanup lenses surfaced these,
  all deferred (the branch had already passed the authoritative whole-branch review; each is either
  YAGNI, visually-unverifiable, or a considered refactor deserving its own reviewed change). Recorded,
  not dismissed:
  - **Shared flash helper.** `@keyframes age-forgotten-flash`, `#prefersReducedMotion()`, and the
    `age-*` accent-class helper are near-identical across `station-queue.ts`, `till-expo-screen.ts`,
    `till-floor-screen.ts`, and `wt-table-token.ts`. Extract a `prefersReducedMotion(override?)` +
    `timingAccentClass(band, reducedMotion)` into `@waitron/ui` (all four already depend on it) plus a
    shared CSS fragment. Kills the most drift-prone duplication.
  - **Floor ring-width divergence.** `till-floor-screen.ts` hardcodes a `2px` box-shadow ring while
    `wt-table-token.ts` uses `var(--wt-space-1)` (4px) for the same "one visual language" accent —
    either an unintended drift or intentional per-element sizing (denser list card vs map token).
    **Needs a visual check** to decide which; then align (and de-hardcode the `2px`). The
    `no-hardcoded-chrome` guard did not catch it because it scans `packages/ui` only, not `apps/till`.
  - **Dead server band fields.** `StationQueueItem.band`, `ExpoItem.band`, `ExpoOrder.worstBand` are
    classified server-side but the till widgets recompute locally from `queuedAt`+`thresholds` on every
    render (for the `TickingClock` re-tick) and never read the server value — confirmed by the widgets'
    own comments and test fixtures. Dropping them (keep `queuedAt`/`thresholds`, which ARE read) removes
    3 wire fields + their SQL/JS + fixture noise. `OverdueOrder.band` (dashboard) and `TableState.timingBand`
    (floor) ARE read — keep those. Deferred because it touches the read-models' age→band behavioural
    assertions (preserve them) + ~6 fixtures.
  - **`computeOverdueOrders` `tableLabel` per-line.** The correlated `dining_tables` subquery runs once
    per fired line though its value is per-order; resolve once per surviving order after grouping.
    Bounded (30s poll, small table). Also: its join graph + `tableLabel` subquery are copied verbatim
    from `listExpoQueue` — a shared query-shape helper could serve both.
  - **Per-render band recompute.** `till-expo-screen.ts`/`station-queue.ts` recompute each item/group
    band 2-3× per render (badge count + card + item flag); a per-render `Map<id, band>` removes it.
    O(1) over tens of items — marginal.
  - **`isValidStationThresholds` predicate.** The `warm<overdue<forgotten` rule is written out in the DB
    CHECK, the server route, and the dashboard precheck; `classifyBand` assumes it without checking. A
    shared predicate in `@waitron/shared` beside `classifyBand` would let both TS call sites share it.
