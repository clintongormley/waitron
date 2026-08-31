# KDS Order-Timing Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the KDS's passive age-colouring into configurable, escalating (warm → overdue → forgotten) order-timing alerts across the station queue, expo pass, floor, and a manager dashboard overview.

**Architecture:** Per-station threshold columns on `kitchen_stations` drive one shared pure classifier (`classifyBand`, `packages/shared`). Server read-models compute the authoritative band on the DB clock; a client-side `TickingClock` reactive controller (`@waitron/ui`) advances bands live between action-refreshes with no server push. A new `report.view`-gated reports route feeds a manager overview.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL (real-PG + PGlite test targets), Lit web components, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-kds-order-timing-alerts-design.md`

## Global Constraints

- **Nothing may block a sale.** This feature touches no `registros`/huella/alta path; the fiscal write path stays byte-unchanged (grep-confirm).
- **No colour/motion as the only signal.** Every band carries a non-colour tell (count badge, label, icon); the forgotten flash has a `prefers-reduced-motion` steady-red fallback. Accents are a left border, never colour-behind-text.
- **English identifiers** (these are operational-config columns, not fiscal): `warm_after_minutes`, `overdue_after_minutes`, `forgotten_after_minutes`; bands `fresh | warm | overdue | forgotten`.
- **Band boundary rule:** at-threshold counts as the HIGHER band (`elapsedMin >= threshold`). Order: `fresh < warm < overdue < forgotten`.
- **Defaults:** warm 5, overdue 10, forgotten 15 (minutes). `NOT NULL DEFAULT` + DB `CHECK (warm < overdue < forgotten)`.
- **Age definition:** a line ages from `ticket_items.queued_at` until it reaches the guest (`working_order_lines.served_at`, or `working_orders.collected_at` for counter). Order/table band = worst band over UNSERVED lines.
- **Gate before every push:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`; for coverage-affecting packages run `pnpm --filter <pkg> test:coverage`.
- **Every commit is `git commit -s`.**

---

## File Structure

- `packages/db/src/schema/kitchen-stations.ts` — add three threshold columns.
- `packages/db/drizzle/00NN_kds_timing_thresholds.sql` (+ generated snapshot) — custom migration: `ADD COLUMN` ×3 + `CHECK`.
- `packages/shared/src/timing.ts` (+ `index.ts` re-export, + `timing.test.ts`) — `classifyBand`, `TimingBand`, `StationThresholds`, `BAND_RANK`, `worstBand`.
- `packages/ui/src/ticking-clock.ts` (+ `index.ts` re-export, + `ticking-clock.test.ts`) — the reactive controller.
- `apps/server/src/working-order.ts` — thread band/thresholds into `listStationQueue`, `listExpoQueue`, `listTablesWithState`.
- `apps/server/src/till-api.ts` — boot threading of per-station thresholds where needed.
- `apps/server/src/kitchen.ts` + `apps/server/src/management-api.ts` — `updateStation` accepts thresholds; PATCH body validation.
- `packages/reporting/src/overdue-orders.ts` (+ test) — the overdue-orders query.
- `apps/server/src/report-api.ts` — a fifth `/management-api/reports/*` route.
- `apps/till/src/widgets/station-queue.ts` — 3 bands + count badge + kanban accent + `TickingClock`.
- `apps/till/src/screens/till-expo-screen.ts` — `classifyBand` + counts.
- the floor screen/table tile (`apps/till/src/…`) — worst-band flash.
- `apps/dashboard/src/screens/kitchen-screen.ts` — threshold editor.
- `apps/dashboard/src/screens/dashboard-overview-screen.ts` — count tile + list + interval refetch.

---

## Task 1: Threshold columns + migration

**Files:**
- Modify: `packages/db/src/schema/kitchen-stations.ts:54-58`
- Create: `packages/db/drizzle/00NN_kds_timing_thresholds.sql` (via `pnpm --filter @waitron/db db:generate:custom`)
- Test: `packages/db/src/schema/kitchen-stations.rls.test.ts` (extend) and a migration assertion.

**Interfaces:**
- Produces: `kitchenStations.warmAfterMinutes`, `.overdueAfterMinutes`, `.forgottenAfterMinutes` (`integer`, notNull, defaults 5/10/15). DB constraint `kitchen_stations_thresholds_ordered`.

- [ ] **Step 1: Write the failing real-PG test.** In `kitchen-stations.rls.test.ts`, add a test that inserts a station and reads back the three columns default 5/10/15, and that an out-of-order `UPDATE` (warm=10, overdue=5) is rejected by the CHECK.

```ts
it("carries ordered timing thresholds with sane defaults", async () => {
  const db = getDb();
  const [row] = await db.execute(sql`
    select warm_after_minutes as w, overdue_after_minutes as o, forgotten_after_minutes as f
    from kitchen_stations where id = ${stationId}`);
  expect(row).toMatchObject({ w: 5, o: 10, f: 15 });
  await expect(
    db.execute(sql`update kitchen_stations set warm_after_minutes = 20 where id = ${stationId}`),
  ).rejects.toThrow(/kitchen_stations_thresholds_ordered/);
});
```

- [ ] **Step 2: Run it, watch it fail** (`column does not exist`). Run: `pnpm --filter @waitron/db test kitchen-stations`

- [ ] **Step 3: Add the columns** to `kitchen-stations.ts` after `displayOrder` (`:54`):

```ts
warmAfterMinutes: integer("warm_after_minutes").notNull().default(5),
overdueAfterMinutes: integer("overdue_after_minutes").notNull().default(10),
forgottenAfterMinutes: integer("forgotten_after_minutes").notNull().default(15),
```

- [ ] **Step 4: Generate the custom migration** — `pnpm --filter @waitron/db db:generate:custom` — then hand-edit the emitted SQL to add the columns AND the CHECK (Drizzle emits the `ADD COLUMN`s; add the constraint yourself):

```sql
ALTER TABLE "kitchen_stations" ADD COLUMN "warm_after_minutes" integer DEFAULT 5 NOT NULL;
ALTER TABLE "kitchen_stations" ADD COLUMN "overdue_after_minutes" integer DEFAULT 10 NOT NULL;
ALTER TABLE "kitchen_stations" ADD COLUMN "forgotten_after_minutes" integer DEFAULT 15 NOT NULL;
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_thresholds_ordered"
  CHECK ("warm_after_minutes" < "overdue_after_minutes"
     AND "overdue_after_minutes" < "forgotten_after_minutes");
```

No new GRANT/policy needed — `app_user` already holds `UPDATE` on `kitchen_stations`, and these are plain columns on the already-FORCE-RLS'd table.

- [ ] **Step 5: Run the db suite + the fiscal guard.** Run: `pnpm --filter @waitron/db test:coverage` then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`. Expected: PASS (thresholds default correctly; the `tenant_id`-table RLS scan still green).

- [ ] **Step 6: Commit.** `git add -A && git commit -s -m "feat(db): per-station KDS timing thresholds (warm/overdue/forgotten)"`

---

## Task 2: The shared band classifier

**Files:**
- Create: `packages/shared/src/timing.ts`, `packages/shared/src/timing.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Interfaces:**
- Produces:
```ts
export type TimingBand = "fresh" | "warm" | "overdue" | "forgotten";
export interface StationThresholds {
  warmAfterMinutes: number; overdueAfterMinutes: number; forgottenAfterMinutes: number;
}
export const BAND_RANK: Record<TimingBand, number>; // fresh 0, warm 1, overdue 2, forgotten 3
export function classifyBand(queuedAtMs: number, nowMs: number, t: StationThresholds): TimingBand;
export function worstBand(bands: Iterable<TimingBand>): TimingBand; // "fresh" for empty
```

- [ ] **Step 1: Write the failing tests** (`timing.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { BAND_RANK, classifyBand, worstBand } from "./timing.js";

const T = { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 };
const at = (min: number) => classifyBand(0, min * 60_000, T);

describe("classifyBand", () => {
  it("is fresh below warm", () => expect(at(4.99)).toBe("fresh"));
  it("warm exactly at the warm threshold", () => expect(at(5)).toBe("warm"));
  it("warm just under overdue", () => expect(at(9.99)).toBe("warm"));
  it("overdue exactly at the overdue threshold", () => expect(at(10)).toBe("overdue"));
  it("overdue just under forgotten", () => expect(at(14.99)).toBe("overdue"));
  it("forgotten exactly at the forgotten threshold", () => expect(at(15)).toBe("forgotten"));
  it("clamps a future queuedAt to fresh", () => expect(classifyBand(60_000, 0, T)).toBe("fresh"));
});

describe("worstBand", () => {
  it("picks the highest-ranked band", () =>
    expect(worstBand(["fresh", "overdue", "warm"])).toBe("overdue"));
  it("is fresh for an empty set", () => expect(worstBand([])).toBe("fresh"));
});

it("BAND_RANK orders the scale", () =>
  expect([BAND_RANK.fresh, BAND_RANK.warm, BAND_RANK.overdue, BAND_RANK.forgotten])
    .toEqual([0, 1, 2, 3]));
```

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/shared test timing`

- [ ] **Step 3: Implement** (`timing.ts`):

```ts
/** The order-age escalation band for a KDS line/order/table. See the order-timing-alerts spec. */
export type TimingBand = "fresh" | "warm" | "overdue" | "forgotten";

export interface StationThresholds {
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

export const BAND_RANK: Record<TimingBand, number> = {
  fresh: 0,
  warm: 1,
  overdue: 2,
  forgotten: 3,
};

/** Classify a line's age (now − queuedAt, in minutes) against its station's thresholds. At-threshold
 * counts as the higher band; a future queuedAt (clock skew) clamps to fresh. */
export function classifyBand(queuedAtMs: number, nowMs: number, t: StationThresholds): TimingBand {
  const elapsedMin = Math.max(0, (nowMs - queuedAtMs) / 60_000);
  if (elapsedMin >= t.forgottenAfterMinutes) return "forgotten";
  if (elapsedMin >= t.overdueAfterMinutes) return "overdue";
  if (elapsedMin >= t.warmAfterMinutes) return "warm";
  return "fresh";
}

/** The worst (highest-ranked) band in a set; fresh when empty. */
export function worstBand(bands: Iterable<TimingBand>): TimingBand {
  let worst: TimingBand = "fresh";
  for (const b of bands) if (BAND_RANK[b] > BAND_RANK[worst]) worst = b;
  return worst;
}
```

- [ ] **Step 4: Re-export** from `index.ts`:

```ts
export { BAND_RANK, classifyBand, worstBand } from "./timing.js";
export type { StationThresholds, TimingBand } from "./timing.js";
```

Add the same three symbols to `index.test.ts`'s re-export assertion if it enumerates the surface.

- [ ] **Step 5: Run** `pnpm --filter @waitron/shared test:coverage`. Expected: PASS.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(shared): classifyBand order-timing band classifier"`

---

## Task 3: The TickingClock reactive controller

**Files:**
- Create: `packages/ui/src/ticking-clock.ts`, `packages/ui/src/ticking-clock.test.ts`
- Modify: `packages/ui/src/index.ts` (re-export)

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export class TickingClock implements ReactiveController {
  now: number;                                     // current wall-clock ms, updated each tick
  constructor(host: ReactiveControllerHost, intervalMs?: number); // default 20_000
}
```
On `hostConnected` it starts a `setInterval` that sets `now = Date.now()` and calls `host.requestUpdate()`; on `hostDisconnected` it clears the interval. A host binds a widget property to `this.clock.now`.

- [ ] **Step 1: Write the failing test** using Vitest fake timers + a stub host:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TickingClock } from "./ticking-clock.js";

class StubHost {
  updates = 0;
  controllers: { hostConnected?(): void; hostDisconnected?(): void }[] = [];
  addController(c: { hostConnected?(): void; hostDisconnected?(): void }) { this.controllers.push(c); }
  requestUpdate() { this.updates++; }
}

describe("TickingClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("advances now and requests an update each interval while connected", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    const first = clock.now;
    vi.advanceTimersByTime(3000);
    expect(clock.now).toBeGreaterThanOrEqual(first);
    expect(host.updates).toBe(3);
  });

  it("stops ticking after disconnect", () => {
    const host = new StubHost();
    const clock = new TickingClock(host as never, 1000);
    clock.hostConnected();
    clock.hostDisconnected();
    vi.advanceTimersByTime(5000);
    expect(host.updates).toBe(0);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/ui test ticking-clock`

- [ ] **Step 3: Implement** (`ticking-clock.ts`):

```ts
import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Drives a host's re-render on a fixed interval so time-based UI (KDS order-age bands) advances
 * live between action-refreshes WITHOUT any server push — the pull-only order-timing mechanism
 * (see the order-timing-alerts spec §5.2). The widget binds an age/clock property to `now`.
 */
export class TickingClock implements ReactiveController {
  now = Date.now();
  #host: ReactiveControllerHost;
  #intervalMs: number;
  #timer?: ReturnType<typeof setInterval>;

  constructor(host: ReactiveControllerHost, intervalMs = 20_000) {
    this.#host = host;
    this.#intervalMs = intervalMs;
    host.addController(this);
  }

  hostConnected(): void {
    this.#timer = setInterval(() => {
      this.now = Date.now();
      this.#host.requestUpdate();
    }, this.#intervalMs);
  }

  hostDisconnected(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
```

- [ ] **Step 4: Re-export** from `packages/ui/src/index.ts`: `export { TickingClock } from "./ticking-clock.js";`

- [ ] **Step 5: Run** `pnpm --filter @waitron/ui test:coverage`. Expected: PASS. (If coverage of the constructor's default-arg branch dips, add a no-arg construction assertion.)

- [ ] **Step 6: Commit.** `git commit -s -m "feat(ui): TickingClock reactive controller for live order-age bands"`

---

## Task 4: Server read-models — band + thresholds

**Files:**
- Modify: `apps/server/src/working-order.ts` — `listStationQueue`, `listExpoQueue` (`:2773`), `listTablesWithState`
- Modify: `apps/server/src/till-api.ts` — ensure the per-line station thresholds ride the station-queue/expo payloads
- Test: the sibling real-PG suites for these read-models (e.g. `working-order.*.test.ts`)

**Interfaces:**
- Consumes: `classifyBand`, `worstBand`, `TimingBand`, `StationThresholds` from `@waitron/shared` (Task 2); the threshold columns (Task 1).
- Produces (payload additions — later UI tasks depend on exactly these names):
  - `StationQueueItem` gains `band: TimingBand` and the group gains `thresholds: StationThresholds` (per station — the widget re-derives on tick).
  - `ExpoItem` gains `band: TimingBand`; `ExpoOrder` gains `worstBand: TimingBand`.
  - `listTablesWithState` rows gain `timingBand: TimingBand` (worst over unserved lines; `"fresh"` when none).

- [ ] **Step 1: Write the failing real-PG read-model test.** Assert: a line queued 12 min ago at a station with defaults reads `band: "overdue"`; once its `served_at` is set the order/table band clears to `fresh`; worst-line-wins across two lines.

```ts
it("bands a line by its station thresholds and stops at served", async () => {
  // fire a line, backdate queued_at to 12 min ago
  await db.execute(sql`update ticket_items set queued_at = now() - interval '12 minutes'
                       where working_order_line_id = ${lineId}`);
  let q = await listStationQueue(ctx, stationId);
  expect(q[0].items[0].band).toBe("overdue");
  // serve it → drops off the clock (worst band clears)
  await db.execute(sql`update working_order_lines set served_at = now() where id = ${lineId}`);
  const tables = await listTablesWithState(ctx);
  expect(tables.find((t) => t.id === tableId)?.timingBand).toBe("fresh");
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/server test working-order` (real-PG; needs `TESTCONTAINERS_RYUK_DISABLED=true`).

- [ ] **Step 3: Implement.** In each read-model, join `kitchen_stations` for the three thresholds and compute an age minutes value with the existing DB-clock idiom (see `working-order.ts:2802`):

```ts
// per line, in the SELECT:
ageMinutes: sql<number>`floor(extract(epoch from (now() - ${ticketItems.queuedAt})) / 60)::int`,
warmAfter: kitchenStations.warmAfterMinutes,
overdueAfter: kitchenStations.overdueAfterMinutes,
forgottenAfter: kitchenStations.forgottenAfterMinutes,
```

Then in the JS mapping, classify (do NOT rely on the SQL for the band label — reuse the shared classifier so server and client agree):

```ts
const thresholds = { warmAfterMinutes: r.warmAfter, overdueAfterMinutes: r.overdueAfter,
                     forgottenAfterMinutes: r.forgottenAfter };
const band = classifyBand(Date.now() - r.ageMinutes * 60_000, Date.now(), thresholds);
```

For `listTablesWithState` and `listExpoQueue`, restrict the band computation to UNSERVED lines (`served_at is null` for table lines; exclude collected orders), and reduce with `worstBand`. Add `thresholds` to the station-queue group so the widget can re-tick. Follow the CLAUDE.md §3 correlated-subquery caution — if any band subquery correlates to the base table, qualify the columns and check `query.toSQL()`.

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage` (or the targeted read-model suites first). Expected: PASS.

- [ ] **Step 5: Confirm the fiscal write path is untouched.** Run: `git diff --stat` and grep the diff for any `registros`/`envios`/`huella`/`alta` path — there must be none. `git grep -n "computeHuella\|appendToChain" apps/server/src/working-order.ts` unchanged.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(server): order-timing band on station-queue/expo/floor read-models"`

---

## Task 5: Configurable thresholds — updateStation + PATCH validation

**Files:**
- Modify: `apps/server/src/kitchen.ts` — `updateStation` (`:142`)
- Modify: `apps/server/src/management-api.ts` — the station `PATCH /management-api/stations/:id` body (`:~1224-1311`)
- Test: the kitchen/management route suite

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `updateStation` accepts optional `warmAfterMinutes`, `overdueAfterMinutes`, `forgottenAfterMinutes`; the route validates they are positive integers with `warm < overdue < forgotten` before the UPDATE, throwing `management.request_invalid` otherwise (never surfacing the raw CHECK violation).

- [ ] **Step 1: Write the failing route test.** A `PATCH` with `{warmAfterMinutes: 3, overdueAfterMinutes: 8, forgottenAfterMinutes: 12}` persists; a `PATCH` with `warm >= overdue` returns 400 `management.request_invalid`; the route stays `till.configure`-gated (403 without it).

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/server test management`

- [ ] **Step 3: Implement.** Extend the PATCH body schema/validation to parse the three optional integers, reject an out-of-order or non-positive set with `management.request_invalid` (mirror the existing station-name validation shape), and pass them to `updateStation`, which adds them to its `set({...})`. Keep the existing name/display-order update behaviour intact.

- [ ] **Step 4: Run** `pnpm --filter @waitron/server test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(server): edit per-station timing thresholds via station PATCH"`

---

## Task 6: Reporting overdue-orders query + route

**Files:**
- Create: `packages/reporting/src/overdue-orders.ts`, `packages/reporting/src/overdue-orders.test.ts`
- Modify: `packages/reporting/src/index.ts` (export)
- Modify: `apps/server/src/report-api.ts` — a fifth `GET /management-api/reports/overdue-orders` route
- Test: the report-api route suite

**Interfaces:**
- Consumes: `classifyBand`, `worstBand`, `TimingBand` (Task 2); the threshold columns (Task 1).
- Produces:
```ts
export interface OverdueOrder {
  orderId: string; orderNumber: number; tableLabel: string | null;
  stationName: string; ageMinutes: number; band: TimingBand; // "overdue" | "forgotten"
}
export function computeOverdueOrders(db, ctx): Promise<OverdueOrder[]>; // worst-first
```
Route `GET /management-api/reports/overdue-orders`, gated `report.view`, returns `{ orders: OverdueOrder[] }`.

- [ ] **Step 1: Write the failing query test** (real-PG or the reporting test target used by siblings like `top-sellers.test.ts`): two open orders, one with a line 11 min old (overdue) and one 16 min old (forgotten) plus one fresh order; assert only the two are returned, forgotten first, each with its station + age; a served line is excluded.

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/reporting test overdue-orders`

- [ ] **Step 3: Implement `computeOverdueOrders`** — select open orders' unserved lines joined to `kitchen_stations` thresholds and `ticket_items.queued_at`, compute `ageMinutes` on the DB clock, classify with the shared classifier, keep only `overdue`/`forgotten`, reduce to one row per order at its worst band, order by band rank desc then age desc. Follow the `top-sellers.ts` structure for the query/context shape.

- [ ] **Step 4: Add the route** in `report-api.ts` beside `/reports/overview`, reusing `buildReportContext`, gated `report.view` (copy the overview route's guard). Add a route test for 401 (no session) / 403 (no `report.view`) / 200 shape.

- [ ] **Step 5: Run** `pnpm --filter @waitron/reporting test:coverage && pnpm --filter @waitron/server test report`. Expected: PASS.

- [ ] **Step 6: Commit.** `git commit -s -m "feat(reporting): overdue-orders query + report.view route"`

---

## Task 7: KDS station-queue widget — 3 bands + count badge

**Files:**
- Modify: `apps/till/src/widgets/station-queue.ts` (`#ageBucket` `:405`, `#rail` `:426`, `#kanban`, styles `:228-234`)
- Test: `apps/till/src/widgets/station-queue.test.ts`

**Interfaces:**
- Consumes: `classifyBand`, `TimingBand` (Task 2); `TickingClock` (Task 3); the `band`/`thresholds` payload additions (Task 4).

- [ ] **Step 1: Write the failing widget test.** With an injected `now`, a group whose oldest line is 12 min old renders `age-overdue`; 16 min renders `age-forgotten` and the header shows an overdue count badge (e.g. `"1 overdue"`); the kanban lens also carries the accent. Assert the `prefers-reduced-motion` path renders the steady-red class (no animation class) — drive via a `reducedMotion` property or a matchMedia stub.

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/till test station-queue`

- [ ] **Step 3: Implement.** Replace `#ageBucket`'s hardcoded 5/10 with `classifyBand(Date.parse(queuedAt), this.now ?? Date.now(), group.thresholds)`; render `age-${band}`; add `age-overdue`/`age-forgotten` CSS (red border; `age-forgotten` adds a `@keyframes` flash guarded by `@media (prefers-reduced-motion: reduce)` → steady). Apply the accent in `#kanban` too. Add a per-station overdue+forgotten count badge to the header (count groups whose band rank ≥ overdue). Instantiate a `TickingClock` in the widget and bind `now` to it (so an idle display still advances) — keep the `now` property injectable for tests (only fall back to the clock when `now` is unset).

- [ ] **Step 4: Run** `pnpm --filter @waitron/till test:coverage`. Expected: PASS. (Browser-mode vitest — do not run concurrently with other browser suites, per repo memory.)

- [ ] **Step 5: Commit.** `git commit -s -m "feat(till): KDS station queue — warm/overdue/forgotten bands + overdue count"`

---

## Task 8: Expo pass — shared classifier + counts

**Files:**
- Modify: `apps/till/src/screens/till-expo-screen.ts` (`#ageBucket` `:469`, card head `:364`)
- Test: `apps/till/src/screens/till-expo-screen.test.ts`

**Interfaces:**
- Consumes: `classifyBand`, `worstBand`, `TimingBand` (Task 2); `TickingClock` (Task 3); `ExpoItem.band` / `ExpoOrder.worstBand` (Task 4).

- [ ] **Step 1: Write the failing test.** A card whose worst item is forgotten shows the forgotten accent + a forgotten item flag; a top-of-screen count reads the overdue+forgotten order count.

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/till test expo`

- [ ] **Step 3: Implement.** Drop the hardcoded 5/10 `#ageBucket`; use the server `band`/`worstBand` on first render and re-derive on tick with `classifyBand` from the item's thresholds (thread station thresholds onto `ExpoItem` in Task 4 if not already). Flag a forgotten item; show the pass-wide overdue/forgotten count; wire a `TickingClock`.

- [ ] **Step 4: Run** `pnpm --filter @waitron/till test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(till): expo pass order-timing bands + overdue count"`

---

## Task 9: Floor — a forgotten table flashes red

**Files:**
- Modify: the floor screen / table tile in `apps/till/src/` (the consumer of `listTablesWithState`) and/or `packages/ui/src/floor.ts` if the tile lives there
- Test: the floor screen/tile test

**Interfaces:**
- Consumes: `listTablesWithState` rows' `timingBand` (Task 4); `TickingClock` (Task 3); `TimingBand` (Task 2).

- [ ] **Step 1: Write the failing test.** A table whose `timingBand` is `forgotten` renders the flashing-red tile class; under `prefers-reduced-motion` it renders steady red + an overdue badge; `warm`/`overdue` render the subtler steady accent; `fresh` renders none.

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/till test floor` (or `pnpm --filter @waitron/ui test floor` if the tile is in ui).

- [ ] **Step 3: Implement.** Map `timingBand` → a tile modifier class; `forgotten` gets a `@keyframes` red flash guarded by `@media (prefers-reduced-motion: reduce)` (steady red + a visible "overdue" badge/icon, never colour alone). Wire a `TickingClock` on the floor so a table begins flashing while the floor sits idle. Keep the escalation scale visually coherent with the KDS accents (amber → red → flashing-red).

- [ ] **Step 4: Run** the owning package's `test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(till): floor tile flashes red for a forgotten table"`

---

## Task 10: Kitchen screen — per-station threshold editor

**Files:**
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts` (station CRUD form)
- Modify: the dashboard API client method for `updateStation` (`apps/dashboard/src/…` `api.updateStation`) to carry the three fields
- Test: `apps/dashboard/src/screens/kitchen-screen.test.ts`

**Interfaces:**
- Consumes: the station PATCH threshold fields (Task 5).

- [ ] **Step 1: Write the failing test.** The station form shows three minute inputs (warm/overdue/forgotten) seeded from the station's values; Save calls `api.updateStation(id, {warmAfterMinutes, overdueAfterMinutes, forgottenAfterMinutes})`; a client-side out-of-order set (`warm >= overdue`) shows a validation message and does not call the API.

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/dashboard test kitchen-screen`

- [ ] **Step 3: Implement.** Add the three number fields to the station edit form (using the dashboard's existing field primitives), seed from the loaded station, validate `warm < overdue < forgotten` before dispatch (mirror the server rule), thread through `api.updateStation`. Reload on success (the existing `#load` idiom).

- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(dashboard): edit per-station timing thresholds on the kitchen screen"`

---

## Task 11: Dashboard overview — overdue count tile + list

**Files:**
- Modify: `apps/dashboard/src/screens/dashboard-overview-screen.ts` (`#load` `:97`, render `:115-121`)
- Modify: the dashboard API client to add `getOverdueOrders()` → `GET /management-api/reports/overdue-orders`
- Test: `apps/dashboard/src/screens/dashboard-overview-screen.test.ts`

**Interfaces:**
- Consumes: the `/reports/overdue-orders` route + `OverdueOrder` shape (Task 6).

- [ ] **Step 1: Write the failing test.** On load the screen calls `api.getOverdueOrders()`, renders a count tile ("2 orders overdue") and a short list (table · station · minutes · band, worst-first); with zero overdue it renders a calm zero-state. Assert a slow interval refetch is scheduled on connect and cleared on disconnect (fake timers).

- [ ] **Step 2: Run, watch it fail.** Run: `pnpm --filter @waitron/dashboard test overview`

- [ ] **Step 3: Implement.** Add `getOverdueOrders()` to the dashboard API; in the overview screen fetch it alongside `getSalesOverview()`; render the count tile + list using existing dashboard primitives; schedule a `setInterval` (~30s) refetch in `connectedCallback`, clear it in `disconnectedCallback`. This is the one screen that polls (a passive monitor) — no push.

- [ ] **Step 4: Run** `pnpm --filter @waitron/dashboard test:coverage`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -s -m "feat(dashboard): overview overdue-orders tile + list (polled)"`

---

## Final verification (before finishing the branch)

- [ ] Full gate: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
- [ ] Coverage for every touched package: `pnpm --filter @waitron/db --filter @waitron/shared --filter @waitron/ui --filter @waitron/reporting --filter @waitron/server --filter @waitron/till --filter @waitron/dashboard test:coverage`
- [ ] Fiscal guard: `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` (green — `kitchen_stations` still FORCE-RLS'd)
- [ ] Confirm the fiscal write path diff is empty (Task 4 Step 5).
- [ ] Update `docs/backlog.md`: move Tier B #9 / KDS operations "Order timings — PARTIAL" to complete; record the deferred follow-ups (real-time push already lives under *handheld live updates*; station-kind; unbumped-neglect metric).
- [ ] Then run the `finish-branch` skill (simplify + two-reviewer review + PR + CI/Copilot).
