# Floor plans — implementation plan (A429)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this plan removes"), and only in a separate commit
> whose message begins `Changed test checks (A429 slice N):` and lists each `file:line` with its
> before and after. Any other assertion that turns out to need changing is a STOP: report it, do
> not edit it. Adding fixture rows, or a key to a whole-shape pin, is allowed.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer
> past about 150 calls with the task unfinished stops at a passing or cleanly red point,
> commits, and returns a handover: done, left, files, each check's state.
>
> **How the slices are written.** Slice 1 is written to step level below. Slices 2–5 are listed
> as tasks with their files, interfaces and tests; each is expanded to step level in this file,
> on that slice's own branch, after the slice before it lands, and the expansion gets one
> fresh-context review before dispatch. Their steps would otherwise be written against code
> slice 1 has not built yet.
>
> **Revised 2026-10-08** after a fresh-context review against the spec and the code, which ran
> the behavioural trigger guard, drizzle-kit and the engine's foreign-key codes. Every `file:line`
> below was read at `main` `16b280dc0`, except `management-api.ts`, read at `25cd6d599`.

**Goal:** a zone's tables are laid out in a saved floor plan edited on the dashboard, and the
till shows today's plan — the saved plan plus today's changes made on the till — as a map whose
job is status and rearranging, with the details one tap away.

**Architecture:** new core tables hold the saved plan (one per zone: positions and saved joins)
and today's changes (stamped with the business day; no job runs at the cutover). A pure resolver
(`apps/server/src/floor-today.ts`) applies the "today" rule. Table names are copied as text when
a party closes, and onto past orders and bookings when their table is deleted, so a table can
really be deleted; modules take part in a
delete through a new module seat. The dashboard gets a full-page editor; the till gets a new map
primitive with pinch, pan and long-press; today's changes are till routes gated like joining.
The old placement columns, routes, tabs and the till's layout-editor card go last.

**Tech stack:** TypeScript, drizzle on SQLite (`node:sqlite`), Hono, Lit, Vitest (node and real
Chromium browser projects).

**Spec:** [Floor plans](../specs/2026-10-08-floor-plan-design.md). Backlog: A429.

**Risk path:** FULL ceremony on every slice: migrations (slices 1 and 5), a module-contract change
and a changed cross-package contract (the till's table-state answer, slice 1), and new till
routes behind profile and zone checks (slice 4).

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan.

1. **Today's-plan changes check what joining checks today: the device profile's `take-orders`
   action and the zone.** The spec (§6, §10, §13) also names "the person's ordering permission";
   there is no such permission (`PERMISSIONS`, `packages/identity/src/permissions.ts:5-37`), and
   seat, join, move and split check only the profile and the zone
   (`apps/server/src/till-api.ts:2250-2379`). The spec's "the same checks as joining today" is
   what this plan builds, and §13's "without the ordering permission" case is dropped.
2. **The old columns go in slice 5, not slice 1.** Dropping `pos_x`, `pos_y`, `shape`, `rotation`
   and `active` while the old floor screen and the till's layout editor still read them would
   break both for three slices. Slices 1–4 only ADD (tables, columns, a trigger change); slice 5
   removes the old pieces and rebuilds `dining_tables` (`zone_id` required, `capacity` renamed
   `seats`). Until slice 5 the new code reads `capacity` as the table's seats. Only slice 5 needs
   a venue reset.
3. **A counter order delivered to a table keeps its link until the table is deleted**, not until
   it is issued. Delete then copies the table's name into a new
   `working_orders.delivery_table_label` and drops the link, and every reader of an order's table
   falls back to that copy (Task 1.5 lists them). Spec §8 says "when it is issued", but the
   floor's pending-delivery count, the watcher board, the expo queue, kitchen headers and overdue
   orders read the link after the bill is settled, until the food is collected
   (`apps/server/src/working-order.ts:7015-7024`, `:6652`; `watcher-board.ts:41-58`;
   `packages/reporting/src/overdue-orders.ts:57`); a delivery can be collected before it is paid,
   and the receipt's table name is frozen at payment from the link (`till-sale.ts:815`,
   `packages/db/src/party-table-labels.ts:82-114`); and an order with no kitchen items can never
   be marked collected (`working-order.ts:5836-5843`). The transition trigger gains one branch
   that allows exactly that release, on any status (Task 1.4).
4. **A party's table names are kept as a list** (`parties.table_names`, the `labelList` column
   builder, `packages/db/src/schema/columns.ts:169`), because the order list returns `tables:
   string[]` (`apps/server/src/orders-list.ts:360-365`). The party's `party_tables` rows are deleted
   in the same transaction that closes it.
5. **Delete always takes the table off the saved plan at once; an open party is tied to it on
   today's plan, not the saved one** (owner, 2026-10-08, replacing spec §8's "allowed only on a
   free table"). A table a party sits at stays where it stood on today's plan until the party
   leaves. The row itself goes for good once nothing ties it: no open party holds it or used it
   earlier in its meal (the names are copied at close, so the row must last until then), and no
   order to it is unpaid or has food on its way. That clean-up runs whenever any party closes,
   the plan is saved or a table is deleted. Until then the table cannot be seated, joined or moved
   to, and lists leave it out. Its name is free again once it is gone for good — not "at once"
   as spec §8 says, because a party may still be sitting at it under that name.
6. **A past booking keeps its table's name when the table is deleted**, not when the booking
   ends: the delete asks every enabled module, through a new module seat, first whether it still
   needs the table (bookings: a `booked` booking from today on refuses with `table.booked`) and
   then to let go of it (bookings copies the name into a new `bookings.table_label`).
7. **Removing a seated table from the saved plan is allowed** (owner, 2026-10-08): it keeps its
   place on today's plan until its party leaves, then becomes a spare — the same "occupied tables
   wait" rule as the reset (spec §6.3).
8. **Delete acts at once** from the editor, after a confirmation, and is not part of the draft or
   of Undo. Every other editor change is in the draft.
9. **Plan coordinates are whole grid squares**, `x` and `y` naming the top-left corner of the
   unrotated table, which rotates about its centre: `x` and `y` 0–999, width and height 1–99,
   rotation 0–345 in steps of 15. A table cannot be dragged past the top or left edge; the grid
   grows only right and down. New tables are 8 × 8.
10. **The save check compares a revision number**, not the time of the save, because two saves in
    one millisecond would compare equal. `saved_at` stays, for display.
11. **A table's name hides when its drawn token's shorter side is under 28 CSS pixels** (the spec
    leaves the size to this plan).
12. **The editor opens from the Departments and zones screen**: "Edit floor plan" (or "Add a floor
    plan" for a zone with no tables) in the zone row's menu
    (`packages/venue-service/src/dashboard/venue-operations-screen.ts:1536-1574`). Lane D's A366-6
    rebuilds that screen into the department page and carries the action across. The plan's
    preview on the zone page arrives with A366-6, not here.
13. **The till's map still re-reads rather than being pushed to**: on tab select, after its own
    actions, as today (`apps/till/src/till-app.ts:4823`), and now also every 15 seconds while a
    map is showing, so two waiters see each other's moves. A push stream like the department
    transfers' (`apps/server/src/department-transfer-api.ts:65`) is later work.
14. **A join of fixed tables is a party join only**: it uses today's join route and leaves no
    row in today's plan, so the link ends when the party leaves (spec §6.1).
15. **The configuration export carries the saved plan** (`floor_plans`, `floor_plan_tables`,
    `floor_plan_joins`, `floor_plan_join_tables`), not today's plan.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`.
- Work in the slice's worktree (`python3 ~/workspace/tools/worktree.py new waitron <branch>
  --headless`); never commit to `main`.
- A shipped migration file is never edited. New migrations only. Slice 5's pull request's first
  line says **"venue reset needed"**.
- No data-migration code before go-live (CLAUDE.md §3).
- drizzle-kit 0.31.11: a generation that rebuilds a table must not also add a column to it.
  Slices 1–4 generate no rebuild: after each `db:generate`, `grep -l '__new_' <new files>` prints
  nothing.
- Every foreign key and unique index is declared in the TypeScript schema; no `ON DELETE cascade`
  on a key into `dining_tables` (slice 5's rebuild would empty the child, CLAUDE.md §3).
- Tables are core (`packages/db`), classified `state` with the `STATE` reason
  (`packages/db/src/classification.ts:6`). The commit adding them says why they are core: tables
  and zones are core, and the till's live floor reads them on every screen.
- Error codes name the domain concept; a code thrown in `apps/server` is declared in
  `apps/server/src/errors.ts`, given an HTTP status in each `STATUS` map that can surface it
  (`management-api.ts:251`, `till-api.ts:370`) and wording in English and Spanish in
  `apps/dashboard/src/i18n/codes.ts` (and the till's equivalent where the till shows it).
- `AppError` carries `code` and `params` (`packages/shared/src/errors.ts:57`). Rejected writes in
  tests assert the domain code.
- Multi-table writes take one `tx: Transaction`; queries on one transaction are awaited in turn.
- New UI reads `--wt-*` tokens only; a screen does not draw its own `<select>`, `<textarea>` or text
  `<input>`; forms follow `docs/developers/design-system.md` → Forms (Save quiet and disabled until
  the draft changes: `draftScopeFor`, `saveActionState`, an early return in the save handler); a
  page holding staged input has a `*.unsaved.test.ts`; a new `wt-*` primitive has a token-painting
  test and a sibling `*.a11y.test.ts` covering each state in both themes; `wt-*` events are named
  `wt-*`, carry `detail`, bubble and are composed.
- Strings in English and Spanish.
- Coverage stays at 98/98/98/95 in every package touched.
- Comments only for an invariant or a non-obvious why; no history.

## Behaviour this plan removes

Tests pinning these may change, under the commit rule above.

**Slice 1:**
- `DELETE /management-api/tables/:id` switching a table off (`management-api.ts:1806`,
  `tables.ts:189`): it now deletes. The old floor screen's Disable sends `PATCH {active:false}`
  instead.
- A closed party's `party_tables` rows surviving the close, and the order list reading closed
  parties' tables through them (`orders-list.ts:230`, `:243`, `:409-425`).
- A finished delivery order keeping `delivery_table_id` once its table is deleted (it keeps
  the name instead).

**Slice 5:**
- The floor screen's Config tab, per-zone tabs and Disable/Enable; the placement routes on the
  dashboard and the till (`management-api.ts:1818`, `:1854`; `till-api.ts:2996`, `:3037`); the
  till's `table-layout-editor` card (`apps/till/src/widgets/card-grid.ts:371-381`,
  `apps/till/src/layout.ts:104`, `packages/layouts/src/card-contract.ts:73-86`); `sizeForCapacity`,
  `FLOOR_ASPECT` and the permille placement (`packages/ui/src/floor.ts`); a table's `active` flag
  and every reader of it (listed in Task 5.2).

## Review focus

The five conditions most likely to bite a person that no single task's happy path exercises. Each
has its test in the task named.

1. **A table still seated from yesterday.** At 07:00, after a 06:00 cutover, a table seated last
   night that a waiter moved keeps its moved place until its tab closes, then returns to the
   saved plan; a free table moved yesterday is back in place (Tasks 1.2 and 1.12).
2. **Swapping two names in one save.** "Terrace 1" and "Terrace 2" renamed to each other in the
   editor save without a duplicate-name refusal (Task 1.10).
3. **Deleting a table with history, or with a party at it.** A table whose party closed last
   week, which a delivered order went to, and whose past booking is kept, deletes; its name shows
   unchanged on that party in the order list, on the delivered order and on the booking. A table
   deleted while a party sits there stays on the till's map where it stood, can take no new party,
   and is gone — its name free — once the party leaves (Tasks 1.3, 1.4, 1.6, 1.8, 1.9).
4. **Two people editing.** A save made from a copy older than the last save is refused with
   `floor_plan.changed` and nothing is written; the editor offers to load the newer plan
   (Tasks 1.10 and 2.4).
5. **A fixed table sent a move anyway.** A move request for a fixed table, sent straight to the
   route, is refused and nothing moves (Task 4.3).

## File map

| File | Slice | Responsibility |
| --- | --- | --- |
| `packages/db/src/schema/floor-plans.ts` | 1 | the seven new tables |
| `packages/db/drizzle/01xx_*.sql` | 1, 5 | generated and custom migrations |
| `apps/server/src/floor-today.ts` | 1 | the pure "today" rule |
| `apps/server/src/floor-plan.ts` | 1 | read and save a zone's saved plan |
| `apps/server/src/floor-today-store.ts` | 1, 4 | reading (1) and writing (4) today's plan |
| `apps/server/src/tables.ts` | 1, 5 | `deleteTable`; later the `active` removal |
| `packages/module/src/module.ts` | 1 | the `tableRemoval` seat |
| `packages/bookings/src/table-removal.ts` | 1 | bookings' part in a delete |
| `packages/ui/src/floor-plan-geometry.ts` | 2 | grid, crop, fit, automatic names |
| `packages/ui-core/src/history.ts` | 2 | undo/redo over draft snapshots |
| `packages/ui/src/components/wt-floor-plan-canvas.ts` | 2 | the editor's canvas |
| `apps/dashboard/src/screens/floor-plan-editor.ts` | 2 | the full-page editor |
| `packages/ui/src/gestures.ts` | 3 | tap, double-tap, long-press, drag, pinch |
| `packages/ui/src/components/wt-floor-map.ts` | 3 | the till's map |
| `apps/till/src/widgets/table-details-sheet.ts` | 3, 4 | the long-press details sheet |
| `apps/server/src/floor-today-api.ts` | 4 | the till's today's-plan routes |

---

## Slice 1 — storage and reads

Branch `feat/floor-plan-storage`. Lands on its own: the till and dashboard look the same after
it, except that Disable on the old floor screen is now a PATCH and the order list reads copied
names.

### Task 1.1: The new tables and columns

**Files:**
- Create: `packages/db/src/schema/floor-plans.ts`, `packages/db/src/schema/floor-plans.test.ts`
- Modify: `packages/db/src/schema/index.ts` and `packages/db/src/index.ts` (exports, beside
  `dining-tables`), `packages/db/src/schema/dining-tables.ts` (`fixed`),
  `packages/db/src/schema/parties.ts` (`table_names`), `packages/db/src/classification.ts` (seven `classify` rows after
  `dining_tables`, `:92`), `packages/db/src/configuration-transfer.ts` (four saved-plan tables
  after `dining_tables`, `:36-40`), `scripts/schema-constraints.test.ts` (the new keys and unique
  indexes, as the file lists `dining_tables`' at `:115-117`)
- Generated: one new core migration under `packages/db/drizzle/` with its snapshot and journal entry

**Interfaces:**
- Produces (all exported from `@waitron/db`):

```ts
export const floorPlanShape = enumType(["rect", "round"]);
export const floorPlans;           // floor_plans: id, zone_id (unique, FK floor_zones), revision count not null default 0, saved_at ts not null
export const floorPlanTables;      // floor_plan_tables: id, plan_id (FK), table_id (FK dining_tables), x, y, width, height, shape, rotation; unique (plan_id, table_id)
export const floorPlanJoins;       // floor_plan_joins: id, plan_id (FK), seats count not null
export const floorPlanJoinTables;  // floor_plan_join_tables: id, join_id (FK), table_id (FK); unique (join_id, table_id)
export const floorTodayTables;     // floor_today_tables: id, table_id (FK), business_day day not null, x, y, rotation, width, height, shape (all nullable), taken_off flag not null default false, spare_placed flag not null default false, seats count (nullable); unique (table_id, business_day)
export const floorTodayJoins;      // floor_today_joins: id, business_day day not null, seats count not null; index on business_day
export const floorTodayJoinTables; // floor_today_join_tables: id, join_id (FK), table_id (FK), before_x, before_y, before_rotation not null; unique (join_id, table_id)
// dining_tables.fixed: flag not null default false
// dining_tables.deleted_at: tsString (nullable) — set by Delete while something still ties the table (decision 5)
// parties.table_names: labelList (nullable)
```

Checks, each named `<table>_<what>_ck`: `x` and `y` between 0 and 999; `width` and `height`
between 1 and 99; `rotation` between 0 and 345 and `rotation % 15 = 0` (on `floor_plan_tables`,
`floor_today_tables` where not null, and `before_rotation`); `shape` by `enumCheck`; `seats >= 1`
on both join tables; on `floor_today_tables`, `(x is null) = (y is null)`, `width`, `height` and
`shape` all null or all set, and set only with `x`, and `seats` null or `>= 0`.

- [ ] **Step 1: Write the failing tests.** In `floor-plans.test.ts`, set up as
`dining-tables.test.ts:13-30` does (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, a tenant, a
location), plus one zone and two tables. Each refusal is caught outside the transaction (CLAUDE.md
§3) and asserted the way the sibling schema tests assert a check, with their `checkFailed` helper
(`packages/db/src/schema/bill-payments.test.ts:321-325`); the `toThrow` lines below show intent.

```ts
it.each([
  ["rotation 20", { rotation: 20 }, "floor_plan_tables_rotation_ck"],
  ["rotation 360", { rotation: 360 }, "floor_plan_tables_rotation_ck"],
  ["x -1", { x: -1 }, "floor_plan_tables_x_ck"],
  ["width 0", { width: 0 }, "floor_plan_tables_width_ck"],
  ["shape square", { shape: "square" }, "floor_plan_tables_shape_ck"],
])("refuses a saved position with %s", async (_name, patch, constraint) => {
  await expect(insertPosition({ ...GOOD_POSITION, ...patch })).rejects.toThrow(constraint);
});
it("keeps one saved position per table per plan", async () => {
  await insertPosition(GOOD_POSITION);
  await expect(insertPosition(GOOD_POSITION)).rejects.toThrow(/UNIQUE/);
});
it("keeps one plan per zone", async () => { /* second floor_plans row for the zone refused */ });
it("refuses today's x without y", async () => { /* floor_today_tables { x: 3, y: null } refused */ });
it("keeps one row per table per business day", async () => { /* second (table, day) refused */ });
it("accepts a valid plan, join and today's rows and reads them back", async () => { /* round trip incl. dining_tables.fixed default false, parties.table_names ['T1','T2'] */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`. Expected: cannot import `./floor-plans.js`.

- [ ] **Step 3: Implement** the schema file with the column vocabulary from `./columns.js` only
(CLAUDE.md §3), export it, add `fixed`, `deleted_at` and `table_names`, the seven
`classify(..., "state", STATE)` rows and the four transfer entries. Then generate:
`pnpm --filter @waitron/db db:generate`. Read the generated SQL: seven `CREATE TABLE`s, three
`ALTER TABLE … ADD`, the indexes, and no `__new_` (no rebuild).

- [ ] **Step 4: Run the tests and the guards** —
`pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts` and
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts`. Expected: all pass; read each `Tests` count.

- [ ] **Step 5: Commit** — message states why the tables are core (Global constraints).

### Task 1.2: The "today" rule

**Files:**
- Create: `apps/server/src/floor-today.ts`, `apps/server/src/floor-today.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanShape = "rect" | "round";
export interface Placement { x: number; y: number; width: number; height: number; shape: PlanShape; rotation: number }
export interface SavedPosition extends Placement { tableId: string }
export interface TodayChange { tableId: string; businessDay: string; x: number | null; y: number | null; rotation: number | null; width: number | null; height: number | null; shape: PlanShape | null; takenOff: boolean; sparePlaced: boolean; seats: number | null }
export interface TodayJoinRow { id: string; businessDay: string; seats: number; members: { tableId: string; beforeX: number; beforeY: number; beforeRotation: number }[] }
export interface TodayTable { tableId: string; placement: Placement | null; seats: number | null; spare: boolean; takenOff: boolean; joinId: string | null; joinSeats: number | null }
export const NEW_TABLE_SIZE = 8;
/** A row from `rowDay` applies today, or later only while one of its tables is held. */
export function isLive(rowDay: string, businessDay: string, tableIds: readonly string[], held: ReadonlySet<string>): boolean;
export function resolveTodayPlan(input: {
  businessDay: string;
  tables: readonly { id: string; seats: number | null }[]; // the zone's tables
  saved: readonly SavedPosition[];
  changes: readonly TodayChange[];
  joins: readonly TodayJoinRow[];
  held: ReadonlySet<string>; // tables an open party holds now
}): TodayTable[]; // one per input table, input order
```

Rules: a change or join applies when `isLive`. Of several live changes for one table, the latest
`businessDay` wins. Placement = saved placement with the change's `x`/`y`/`rotation` laid over
it; a table with no saved placement is shown only when its live change has `sparePlaced` and
`x`/`y`, at the change's `width`, `height` and `shape` when set (a table kept where it stood,
Task 1.9), else `NEW_TABLE_SIZE` square `rect`; otherwise `placement` is null and `spare` true.
`takenOff` gives `placement: null`. Seats = the change's `seats` if not null, else the table's.
A table in a live join carries its `joinId` and `joinSeats`.

- [ ] **Step 1: Write the failing tests:**

```ts
const T1 = "t1", T2 = "t2";
const saved: SavedPosition[] = [{ tableId: T1, x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }];
const base = { businessDay: "2026-10-09", tables: [{ id: T1, seats: 4 }, { id: T2, seats: 2 }], saved, changes: [], joins: [], held: new Set<string>() };
const change = (over: Partial<TodayChange>): TodayChange => ({ tableId: T1, businessDay: "2026-10-09", x: null, y: null, rotation: null, width: null, height: null, shape: null, takenOff: false, sparePlaced: false, seats: null, ...over });

it("shows the saved plan when nothing changed today, and a table with no position as a spare", () => {
  expect(resolveTodayPlan(base)).toEqual([
    { tableId: T1, placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }, seats: 4, spare: false, takenOff: false, joinId: null, joinSeats: null },
    { tableId: T2, placement: null, seats: 2, spare: true, takenOff: false, joinId: null, joinSeats: null },
  ]);
});
it("lays today's move and rotation over the saved position", () => {
  const [t1] = resolveTodayPlan({ ...base, changes: [change({ x: 20, y: 10, rotation: 45 })] });
  expect(t1.placement).toEqual({ x: 20, y: 10, width: 8, height: 8, shape: "rect", rotation: 45 });
});
it("ignores yesterday's move on a free table", () => {
  const [t1] = resolveTodayPlan({ ...base, changes: [change({ businessDay: "2026-10-08", x: 20, y: 10 })] });
  expect(t1.placement?.x).toBe(0);
});
it("keeps yesterday's move on a table still held", () => {
  const [t1] = resolveTodayPlan({ ...base, held: new Set([T1]), changes: [change({ businessDay: "2026-10-08", x: 20, y: 10 })] });
  expect(t1.placement?.x).toBe(20);
});
it("places a spare placed today at the new-table size", () => {
  const [, t2] = resolveTodayPlan({ ...base, changes: [change({ tableId: T2, sparePlaced: true, x: 30, y: 30 })] });
  expect(t2).toMatchObject({ spare: false, placement: { x: 30, y: 30, width: 8, height: 8, shape: "rect", rotation: 0 } });
});
it("keeps the size and shape of a table kept where it stood", () => {
  const [, t2] = resolveTodayPlan({ ...base, changes: [change({ tableId: T2, sparePlaced: true, x: 30, y: 30, width: 4, height: 6, shape: "round" })] });
  expect(t2.placement).toEqual({ x: 30, y: 30, width: 4, height: 6, shape: "round", rotation: 0 });
});
it("unplaces yesterday's placed spare once nobody sits there", () => {
  const [, t2] = resolveTodayPlan({ ...base, changes: [change({ tableId: T2, businessDay: "2026-10-08", sparePlaced: true, x: 30, y: 30 })] });
  expect(t2).toMatchObject({ spare: true, placement: null });
});
it("hides a table taken off today", () => {
  const [t1] = resolveTodayPlan({ ...base, changes: [change({ takenOff: true })] });
  expect(t1).toMatchObject({ takenOff: true, placement: null });
});
it("uses today's seats over the table's", () => {
  const [t1] = resolveTodayPlan({ ...base, changes: [change({ seats: 6 })] });
  expect(t1.seats).toBe(6);
});
it("keeps a merge from yesterday while any member is held, and drops it when none is", () => {
  const join: TodayJoinRow = { id: "j", businessDay: "2026-10-08", seats: 6, members: [{ tableId: T1, beforeX: 0, beforeY: 0, beforeRotation: 0 }, { tableId: T2, beforeX: 9, beforeY: 0, beforeRotation: 0 }] };
  expect(resolveTodayPlan({ ...base, joins: [join], held: new Set([T2]) })[0].joinId).toBe("j");
  expect(resolveTodayPlan({ ...base, joins: [join] })[0].joinId).toBeNull();
});
it("takes the latest live change when two days' rows apply", () => {
  const rows = [change({ businessDay: "2026-10-08", x: 20, y: 10 }), change({ x: 40, y: 10 })];
  expect(resolveTodayPlan({ ...base, held: new Set([T1]), changes: rows })[0].placement?.x).toBe(40);
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today.test.ts`. Expected: cannot import `./floor-today.js`.
- [ ] **Step 3: Implement** the two functions as stated. No database access in this file.
- [ ] **Step 4: Run** the same command. Expected: PASS, 11 tests.
- [ ] **Step 5: Commit.**

### Task 1.3: A party keeps its table names when it closes

**Files:**
- Modify: `apps/server/src/parties.ts` (`closeParty`, `:605-639`), `apps/server/src/table-actions.ts`
  (`combineParties`, `:164-236`), `apps/server/src/orders-list.ts` (`:228-231` search, `:241-244`
  table filter, `:409-425` `readPartyTables`)
- Test: `apps/server/src/party-table-names.test.ts` (new), plus the existing
  `apps/server/src/orders-list.test.ts` cases for tables (run, not edited)
- Existing assertions this empties: `apps/server/src/parties.test.ts:479`, `:1030`, `:1049` and
  `:1396` assert `membershipsOf(…).every((m) => m.leftAt !== null)`, which an empty list passes.
  In the `Changed test checks` commit each becomes: the party has no `party_tables` rows, and its
  `tableNames` is the expected list.

**Interfaces:**
- Produces: `export async function closePartyTables(tx: Transaction, partyId: string): Promise<void>`
  in `parties.ts` — writes the labels of every table the party ever held (`party_tables` joined to
  `dining_tables`, ordered by `joined_at`, `id`; each label once) into `parties.table_names`, then
  deletes the party's `party_tables` rows. Called by `closeParty` after `leaveForClearing` (the
  `parties_clear_table_status` trigger reads the rows when the state changes, so they must still
  exist then) and by `combineParties` for the closed `from` party after its rows are left.

- [ ] **Step 1: Write the failing tests** (set up as `party-table-actions.test.ts` does:
`useVenueDb` + `setupPartyVenue`; helpers `seat`, `join`, `inTx`, `partyRow` from
`./testing/party-venue.js`):

```ts
it("copies the names of every table the party held, in order, and lets go of the tables", async () => {
  const t4 = await v.table("Terrace 4"), t5 = await v.table("Terrace 5");
  const { partyId } = await seat(v, t4);
  await join(v, partyId, t5);
  await finish(v, partyId); // finishTable through inTx, as till-api's route does
  expect((await partyRow(v, partyId)).tableNames).toEqual(["Terrace 4", "Terrace 5"]);
  expect(await inTx(v, (tx) => tx.select().from(partyTables).where(eq(partyTables.partyId, partyId)))).toEqual([]);
});
it("keeps the old name on the closed party and its reprinted receipt after the table is renamed", async () => {
  /* seat, order, pay and issue, finish, then updateTable(label "Patio 4"); partyRow.tableNames
     still ["Terrace 4"]; listOrders' row for the party's bill has tables ["Terrace 4"];
     readReceiptOrder (receipt-order.ts) for the bill still names "Terrace 4" */
});
it("copies the names of a party merged into another when the merge closes it", async () => {
  /* seat A at t1 and B at t2, joinTables(A, t2, {bills:"separate"}) — B closes into A;
     partyRow(B).tableNames equals ["T2"] and B has no party_tables rows */
});
it("finds a closed party in the order list by an old table name and filters by it", async () => {
  /* listOrders with search "Terrace" and with table "Terrace 4" both return the closed party's bill */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/party-table-names.test.ts`. Expected: `tableNames` is `null`.
- [ ] **Step 3: Implement** `closePartyTables`; call it from both paths. In `orders-list.ts`, read
a closed party's tables from `parties.table_names` and an open party's from `party_tables` as now;
the search and table-filter clauses also match `exists (select 1 from json_each(p.table_names)
where value like … )` (and `= … collate nocase`) — add the `parties` join to the row query if
`r` does not carry `table_names` yet.
- [ ] **Step 4: Run** the new file, then `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts src/party-table-actions.test.ts src/till-api.table-actions.test.ts src/unpaid-departure.test.ts`. Expected: all pass.
- [ ] **Step 5: Commit.**

### Task 1.4: An order delivered to a table can let go of it, keeping its name

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`deliveryTableLabel: label("delivery_table_label")`
  beside `deliveryTableId`, `:88`)
- Generated: a core migration adding the column (`pnpm --filter @waitron/db db:generate`; one
  `ALTER TABLE … ADD`, no `__new_`), THEN a custom one
  (`pnpm --filter @waitron/db db:generate:custom --name delivery_table_release`) that drops and
  re-creates `working_orders_enforce_transition` as `0117_bill_invoice_delivery_transition.sql`
  has it, with exactly these changes:
  - the presented-bill branch (`0117:17-37`) and the two collection branches (`0117:38-59`,
    `:60-81`) each also require `new.delivery_table_label IS old.delivery_table_label`;
  - one new branch, the release: `old.delivery_table_id IS NOT NULL AND new.delivery_table_id IS
    NULL AND old.delivery_table_label IS NULL AND new.delivery_table_label IS NOT NULL AND` every
    other column of `working_orders` `IS old` (any status). Take the column list from the schema;
    `scripts/behavioural-triggers.test.ts:793` builds the same list for its own checks.
- Create: `apps/server/src/delivery-release.ts`, `apps/server/src/delivery-release.test.ts`
- Run: `scripts/behavioural-triggers.test.ts`, `packages/db/src/schema/orders.transition.test.ts`

**Interfaces:**
- Produces: `export async function releaseDeliveries(tx: Transaction, tableId: string, label: string): Promise<void>`
  — one update: every `working_orders` row with `delivery_table_id` = the table gets
  `delivery_table_id = null, delivery_table_label = label`. It decides nothing; `purgeDeletedTables` (Task 1.8) calls it
  only for a deleted table nothing ties any more, so no live order is ever released.

- [ ] **Step 0: STOP check.** Spec §8 stops the work if a table involved is append-only. Run
`git grep -n "appendOnly(" -- 'packages/*/src/*classification*.ts'` and confirm `working_orders`,
`parties`, `party_tables`, `dining_tables` and `bookings` are not among them (they are `state`:
`packages/db/src/classification.ts:92`, `:119`, `:146-151`; `packages/bookings/src/classification.ts:10`).
If any is, stop and report.
- [ ] **Step 1: Write the failing tests.** Make delivered orders through the walk-up sale path
that sets `delivery_table_id` (`createOpenOrder`, called from `till-sale.ts:540`; `counterOrder`
in `testing/party-venue.ts:398` goes through `parkOrder`, which takes no table — extend the helper
with an optional table, or add a sibling, whichever reads better):

```ts
it("lets go of the table on a settled, collected order and keeps its name", async () => {
  /* deliver to "Terrace 4", settle, handOverOrder; releaseDeliveries(t4, "Terrace 4");
     billRow: deliveryTableId null, deliveryTableLabel "Terrace 4" */
});
it("lets go of the table on a settled order never collected, and on an abandoned one", async () => { /* … */ });
it.each([
  ["the name alone", { delivery_table_label: "X" }],
  ["the link without a name", { delivery_table_id: null }],
  ["the release with another column", { delivery_table_id: null, delivery_table_label: "X", order_number: 99 }],
])("refuses %s on a settled order", async (_name, set) => {
  /* raw update, caught OUTSIDE withTransaction; message 'working order cannot make that transition' */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/delivery-release.test.ts`. Expected: cannot import `./delivery-release.js`.
- [ ] **Step 3: Implement** both migrations and the helper. Diff the custom migration's trigger
against `0117` by eye: only the three added `IS` clauses and the new branch.
- [ ] **Step 4: Run** the file; `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/migration-upgrade.test.ts scripts/migrations-match-schema.test.ts`; `pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts`. Expected: all pass (the review measured the behavioural guard at 2 failures with the column and no trigger change; this task's trigger change is what makes it pass).
- [ ] **Step 5: Commit.**

### Task 1.5: Everything that reads an order's table falls back to the kept name

**Files:**
- Modify: `packages/db/src/party-table-labels.ts` (`LabelledOrder` gains `deliveryTableLabel:
  string | null`; `orderTableLabels`, `:82-114`, answers the live table's label while
  `deliveryTableId` is set, else `deliveryTableLabel`, else `order.label`), and every caller that
  builds a `LabelledOrder` selects the new column: `apps/server/src/receipt-order.ts:29`, `:46`,
  `:52`; `kitchen-print.ts:385`, `:390`, `:1281`, `:1305`; `working-order.ts:6691`, `:7129`;
  `move-bill.ts:271`; `packages/reporting/src/overdue-orders.ts:57`, `:140`;
  `apps/server/src/orders-list.ts:150-160` (`delivery_label` =
  `coalesce(dd.label, wo.delivery_table_label)`)
- Read, and say in the commit why each needs no change: `department-transfer-api.ts:200`,
  `watch-zones.ts:37-53`, the floor's pending count (`working-order.ts:7015-7024`), the expo queue
  (`:6652`) — each reads only live orders, and the purge (Task 1.8) releases only a table with
  no live order, so a released order never reaches it. If one does reach released orders, give it the same fallback.
- Test: `apps/server/src/delivery-release.test.ts` (extend), `packages/db/src/party-table-labels.test.ts` if it exists (else the server test)

- [ ] **Step 1: Write the failing tests** — after `releaseDeliveries` on a settled delivered
order: `readReceiptOrder` for it names "Terrace 4"; `listOrders` shows `tables: ["Terrace 4"]`
and `counter: false`; a kitchen ticket reprint header for it names "Terrace 4"; and, the case
the review found, an order delivered and collected BEFORE payment, then settled, freezes
"Terrace 4" into its label even when the table is released between collection and payment
(`orderTableLabels` with `deliveryTableId` null and `deliveryTableLabel` set).
- [ ] **Step 2: Run and watch them fail.** Expected: `tables: []`, `counter: true`, the receipt
without the table.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/receipt-order.test.ts src/kitchen-print.test.ts src/orders-list.test.ts src/move-bill.test.ts`, `pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.6: The table-removal module seat, and bookings' part in it

**Files:**
- Modify: `packages/module/src/module.ts` (beside `FloorAnnotator`, `:62`, and the descriptor's
  `floorAnnotations`, `:855`), `packages/module/src/index.ts`, `apps/server/src/modules.ts`
  (`enabledTableRemovals`, beside `enabledFloorAnnotators`, `:20`),
  `packages/composition/src/modules.ts:265` (the bookings descriptor gains `tableRemoval`),
  `packages/bookings/src/schema/bookings.ts` (`tableLabel: label("table_label")`),
  `packages/bookings/src/bookings.ts` (`listBookings`, `getBooking` return `tableLabel`),
  `packages/bookings/src/errors.ts` (`table.booked { tableId }`)
- Create: `packages/bookings/src/table-removal.ts`, `packages/bookings/src/table-removal.test.ts`
- Generated: a bookings migration (`pnpm --filter @waitron/bookings db:generate`), one `ALTER TABLE … ADD`

**Interfaces:**
- Produces:

```ts
// packages/module/src/module.ts
export interface TableRemoval {
  /** Throws an AppError while this module still needs the table. */
  refuse(tx: Transaction, cfg: { locationId: LocationId }, tableId: string, now: Date): Promise<void>;
  /** Lets go of every row naming the table, keeping `label` as text where history needs it. */
  release(tx: Transaction, cfg: { locationId: LocationId }, tableId: string, label: string): Promise<void>;
}
// WaitronModule: readonly tableRemoval?: TableRemoval;
// apps/server/src/modules.ts
export function enabledTableRemovals(modules: readonly WaitronModule[]): readonly TableRemoval[];
// packages/bookings/src/table-removal.ts
export const BOOKINGS_TABLE_REMOVAL: TableRemoval;
// booking JSON gains tableLabel: string | null
```

`refuse` throws `table.booked { tableId }` when a `booked` booking names the table on the venue's
today or later (today from the venue's wall clock, as `floor.ts`'s `venueWallClock` computes it —
move `venueWallClock` and `safeTimeZone` into a shared file in the package rather than copying
them). `release` sets `table_label = label, table_id = null` on every booking naming the table.

- [ ] **Step 1: Write the failing tests** in `table-removal.test.ts` (set up as
`packages/bookings/src/floor.test.ts` does):

```ts
it("refuses while a booking from today on is booked at the table", async () => {
  await expect(inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, cfg, tableId, now))).rejects.toMatchObject({ code: "table.booked", params: { tableId } });
});
it("does not refuse for yesterday's booking, or a cancelled or completed one today", async () => { /* … */ });
it("keeps the table's name on past bookings when it lets go", async () => {
  /* release(tableId, "Terrace 4"); getBooking returns tableId null, tableLabel "Terrace 4" */
});
```

and beside `enabledFloorAnnotators`' test: a module without the seat contributes nothing; the
bookings module contributes `BOOKINGS_TABLE_REMOVAL`.

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/bookings exec vitest run src/table-removal.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement**; generate the bookings migration and check it has no `__new_`.
- [ ] **Step 4: Run** the file, `pnpm --filter @waitron/bookings test:coverage`, `pnpm exec vitest run scripts/module-seams.test.ts scripts/module-graph-honesty.test.ts`, `pnpm --filter @waitron/composition exec vitest run`. Expected: pass; coverage at its bar.
- [ ] **Step 5: Commit.**

### Task 1.7: The bookings screen shows a deleted table's kept name

**Files:**
- Modify: `packages/bookings/src/dashboard/client.ts:45-52` (booking type gains `tableLabel`),
  `packages/bookings/src/dashboard/bookings-screen.ts:258` (a booking whose `tableId` is null and
  `tableLabel` set shows the label)
- Test: the bookings screen's browser test file

- [ ] **Step 1: Write the failing test** (Chromium): a past booking with `tableId: null,
tableLabel: "Terrace 4"` shows "Terrace 4" in its table cell; a booking with neither shows the
screen's existing "no table" text.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the screen's tests. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.8: Delete a table

**Files:**
- Modify: `apps/server/src/tables.ts` (`deleteTable`; `deactivateTable`, `:189-202`, is deleted —
  nothing else calls it once the route changes, `updateTable` writes `active` itself),
  `apps/server/src/management-api.ts` (the DELETE route, `:1806`; deps type `:167` gains
  `tableRemovals?: readonly TableRemoval[]`, default `[]`), `apps/server/src/boot.ts` (the
  management API mount, `:1541`, passes `enabledTableRemovals(setsToMigrate)`), `STATUS`
  (`management-api.ts:251`: `table.booked: 409`), `apps/dashboard/src/api/client.ts`
  (`deactivateTable(id)` sends `PATCH /management-api/tables/:id {active:false}`; new
  `deleteTable(id)` sends `DELETE`), `apps/dashboard/src/i18n/codes.ts` (`table.booked`, EN and ES)
- Test: `apps/server/src/table-delete.test.ts` (new); `apps/server/src/management-api.test.ts`
- Existing tests that use `DELETE /management-api/tables/:id` (lines at `main` `25cd6d599`):
  `:1243` and `:1270` pin switching off by DELETE (removed behaviour: change them in the
  `Changed test checks` commit, to `PATCH {active:false}`); `:1280`, `:1305`, `:1318`, `:1666`,
  `:1697`, `:1753` use it as setup to switch a table off — change them to `PATCH {active:false}`
  in the same commit, listed.

**Interfaces:**
- Consumes: `TableRemoval` (Task 1.6), `closePartyTables` on every close (Task 1.3),
  `releaseDeliveries` (Task 1.4).
- Produces:

```ts
export async function deleteTable(tx: Transaction, cfg: TillConfig, tableId: string, removals: readonly TableRemoval[], now?: Date): Promise<void>;
/** Whether anything still ties the table to service: an open party that holds it or used it earlier
 *  in its meal, or an order to it that is unpaid or whose food is on its way. */
export async function tableTied(tx: Transaction, tableId: string): Promise<boolean>;
/** Removes, for good, every deleted table nothing ties any more. */
export async function purgeDeletedTables(tx: Transaction, cfg: TillConfig): Promise<void>;
```

`deleteTable`, in one transaction (decision 5):
1. The table exists in this venue and is not already deleted, else `table.not_found`.
2. Each removal's `refuse` (bookings: an upcoming booking, `table.booked`); then each removal's
   `release`.
3. Delete its saved position and its saved-join memberships (and any saved join left with fewer
   than two members, with its members); set `dining_tables.deleted_at`.
4. `purgeDeletedTables`, which removes it at once when nothing ties it.

`tableTied`: a `party_tables` row of an OPEN party names it (held, or left earlier in the meal);
or an order names it in `delivery_table_id` and either its `status` is `open` or `placed`, or the
floor's pending-delivery test holds (not abandoned, `collected_at` null, has ticket items — the
conditions at `working-order.ts:7015-7023`).

`purgeDeletedTables`: for each table with `deleted_at` set and not `tableTied`:
`releaseDeliveries(tx, id, label)`; delete its `floor_today_join_tables` rows (and any today's
join left with fewer than two members, with its members), its `floor_today_tables` rows, then the
`dining_tables` row. A foreign-key refusal at that last delete (rows of a module switched off since
it was deleted, or of a party closed before slice 1) leaves the table for a later purge: catch it
by `isRefusal(error, FOREIGN_KEY_VIOLATION)` (`packages/db/src/sql-state.ts:24`; every key into
`dining_tables` is `no action`, which this engine refuses with code 787 — measured by the plan
review on Node v26.7.0 `node:sqlite`; `restrictRefused` matches only 1811 and would never fire) and
carry on with the next table — a refused statement backs out only itself (CLAUDE.md §3). Any
other error is rethrown.

- [ ] **Step 1: Write the failing tests:**

```ts
it("removes a free table with history at once, and its name can be used again", async () => {
  /* a party seated and finished at it (Task 1.3 released it); a delivered order to it, settled and
     collected; a settled delivered order never collected that had no ticket items; a saved
     position; a saved join of it with two others. deleteTable: the row is gone, both orders keep
     deliveryTableLabel, the saved join now has two members, the position is gone; createTable
     with the same label succeeds */
});
it("takes a seated table off the saved plan at once but keeps the row while the party sits there", async () => {
  /* seat at t4; deleteTable: no saved position or saved join for t4, deletedAt set, the row
     remains; finish the party: the row is gone */
});
it("keeps a table an open party moved away from until that party closes", async () => { /* … */ });
it("keeps a table while an order to it is unpaid, and removes it at the next purge once paid and collected", async () => { /* … */ });
it("refuses while a module refuses, and changes nothing", async () => {
  /* a fake TableRemoval whose refuse throws table.booked; release never called; the saved position
     is still there and deletedAt is null */
});
it("drops a saved join left with one table", async () => { /* join of t1+t2, delete t2: no join rows remain */ });
it("leaves a table something unknown still names for a later purge, without failing", async () => {
  /* insert a party_tables row for a CLOSED party by hand (as before slice 1); deleteTable resolves;
     deletedAt set, the row remains; delete the stray row; purgeDeletedTables: the row is gone */
});
it("refuses deleting a table already deleted", async () => { /* table.not_found */ });
```

and in `management-api.test.ts`: `DELETE /management-api/tables/:id` answers 204 and the table is
gone from `GET /management-api/tables?includeDisabled=true` (Task 1.9 hides a deleted table still
in use; until then assert only a free table); 409 `table.booked` from a refusing removal; 403 for
staff; 401 without a session.

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/table-delete.test.ts`. Expected: `deleteTable` is not exported.
- [ ] **Step 3: Implement.** Then the dashboard client change and its test (the assertion pinning
`deactivateTable`'s DELETE request is removed behaviour: change it in the `Changed test checks`
commit).
- [ ] **Step 4: Run** the new file, `src/management-api.test.ts`, `src/tables.test.ts`,
`pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-screen.test.ts src/api/client.test.ts`.
Expected: pass.
- [ ] **Step 5: Commit** (and the separate `Changed test checks (A429 slice 1):` commit).

### Task 1.9: A deleted table still in use stays where it stands until it is free

**Files:**
- Create: `apps/server/src/floor-today-store.ts`, `apps/server/src/deleted-table-in-use.test.ts`
- Modify: `packages/reporting/src/index.ts` (export `businessDayOf`, `business-day.ts:170`);
  `apps/server/src/tables.ts` (`deleteTable` keeps a held table where it stands before step 3;
  `listTables`, `:110-136`, leaves out deleted tables, with `includeDisabled` too);
  `apps/server/src/parties.ts` and `apps/server/src/table-actions.ts` (`closePartyTables`' callers
  run `purgeDeletedTables` after it); every path that seats, joins or moves a party to a table
  treats a deleted table as `table.not_found` (`openTab`, `working-order.ts:1201`;
  `readTargetTable`, `move-bill.ts:225`; `seatTable`, `parties.ts:78`);
  `listTablesWithState` (`working-order.ts:7027`) leaves out a deleted table unless a party holds
  it; `report-api.ts:170-172` (`countOpenTables`) leaves out deleted tables;
  `packages/venue-service/src/operations.ts` (`:225-233`, `:254`, `:311-321`: removal impact and
  zone switch-off ignore deleted tables); `packages/bookings/src/bookings.ts:60`
  (`requireActiveTable` refuses a deleted table as it refuses an inactive one)

**Interfaces:**
- Consumes: `deleteTable`, `purgeDeletedTables` (Task 1.8).
- Produces:

```ts
// floor-today-store.ts
export async function todayBusinessDay(tx: Transaction, cfg: TillConfig, now: Date): Promise<string>; // businessDayOf(now, await readLocationClock(tx, cfg.locationId))
/** A held table about to lose its saved position keeps it on today's plan until its party leaves. */
export async function keepWhereItStands(tx: Transaction, cfg: TillConfig, tableId: string, now: Date): Promise<void>;
```

`keepWhereItStands` does nothing when no party holds the table, or when the table already has a
live today's row with a position. Otherwise it writes (or updates) today's row for the table with
`spare_placed = true` and the saved position's `x`, `y`, `rotation`, `width`, `height` and `shape`.
That row stays live while the party holds the table (the "today" rule), so the table stays where
it stood; once the party leaves, the row stops applying.

- [ ] **Step 1: Write the failing tests:**

```ts
it("keeps a deleted, seated table on today's plan where it stood", async () => {
  /* saved position x 10 y 4, 8×8 round; seat; deleteTable; floorRow(t).today.placement equals
     the old saved position */
});
it("drops it from the till and the tables list once the party leaves", async () => {
  /* finish: listTablesWithState has no row for it; GET /api/tables has none */
});
it("does not list a deleted table still in use on the dashboard", async () => {
  /* listTables(includeDisabled) leaves it out while the party sits there */
});
it.each(["seat", "join", "move guests to", "move a bill to"])(
  "refuses to %s a deleted table still in use", async (verb) => { /* table.not_found */ });
it("frees the name once the table is gone for good, not before", async () => {
  /* while seated: createTable with its label → table.label_taken; after finish → succeeds */
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/deleted-table-in-use.test.ts`. Expected: no `today` placement; the deleted table still listed.
- [ ] **Step 3: Implement.** Find every other reader that should skip a deleted table with
`git grep -n "diningTables\|dining_tables" -- 'apps/*/src/*.ts' 'packages/*/src/*.ts' ':!*.test.ts'`;
for each not named above, decide and say in the commit why it may still see deleted rows (a read
by id of a table an open party holds may; a list a person chooses from may not).
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/table-delete.test.ts src/party-table-actions.test.ts src/till-api.tables.test.ts src/report-api.test.ts`, `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts`, `pnpm --filter @waitron/bookings exec vitest run`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.10: Read and save a zone's saved plan

**Files:**
- Create: `apps/server/src/floor-plan.ts`, `apps/server/src/floor-plan.test.ts`
- Modify: `apps/server/src/errors.ts` (`floor_plan.changed { zoneId }`, `floor_plan.invalid
  { field }`)

**Interfaces:**
- Consumes: `Placement`, `PlanShape` from `./floor-today.js`.
- Produces:

```ts
export interface PlanTable { id: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }
export interface PlanJoin { id: string; seats: number; tableIds: string[] }
export interface ZonePlan { zoneId: string; revision: number; savedAt: string | null; tables: PlanTable[]; joins: PlanJoin[] }
export interface ZonePlanSave {
  revision: number; // the copy's revision; 0 when the zone had no plan
  tables: { id?: string; key: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }[];
  joins: { seats: number; tableKeys: string[] }[];
}
export async function readZonePlan(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<ZonePlan>;
export async function saveZonePlan(tx: Transaction, cfg: TillConfig, zoneId: string, input: ZonePlanSave): Promise<{ revision: number; ids: Record<string, string> }>; // ids: key → table id
```

`readZonePlan` lists every table of the zone that is not deleted (`zone_id` = zone,
`deleted_at` null; until slice 5 also `active`), its
seats from `capacity`, placement from `floor_plan_tables`, and the plan's joins; a zone with no
plan reads `revision: 0, savedAt: null`, every table unplaced.

`saveZonePlan`, in order: zone exists (`zone.not_found`); `input.revision` equals the stored
revision (else `floor_plan.changed`, nothing written); each entry's checks, naming the field as
`tables.<index>.<name>` or `joins.<index>.<name>` (`floor_plan.invalid`): label trimmed and
non-empty, seats null or a whole number 0–999, placement ranges as Task 1.1's checks, a join has
two or more distinct keys all in `tables` and seats ≥ 1; an `id` that is not a table of this zone
is `table.not_found`; a duplicate label within the input or against a table outside the input is
`table.label_taken { label }`; an `id` of a deleted table is `table.not_found`; a table of the
zone that is not deleted and is missing from the input (someone added it since the copy was
read) is `floor_plan.changed`. Then write, in this order: every changed label to the row's own
id (first pass); the new tables (`zone_id` = zone); every changed label to its final value
(second pass), so neither a swap nor a new table taking a renamed table's old name collides
(the plan review measured the other order failing with `UNIQUE constraint failed`); `capacity`
and `fixed`; delete then insert the plan's positions, and its joins and members (nothing outside
those tables holds a key into them); bump `revision`, set `saved_at`. A held table whose saved position this save removes is first
kept where it stands (`keepWhereItStands`, Task 1.9; decision 7). Last, `purgeDeletedTables`.

- [ ] **Step 1: Write the failing tests** (`setupPartyVenue`; its tables zone):

```ts
it("reads a zone with no plan as revision 0 with every table unplaced", async () => { /* … */ });
it("saves positions, new tables and joins in one go and reads them back", async () => {
  const t1 = await v.table("T1");
  const { revision, ids } = await inTx(v, (tx) => saveZonePlan(tx, v.cfg, v.tables.zoneId, {
    revision: 0,
    tables: [
      { id: t1, key: "a", label: "T1", seats: 4, fixed: false, placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } },
      { key: "b", label: "Bar 1", seats: 1, fixed: true, placement: { x: 10, y: 0, width: 3, height: 3, shape: "round", rotation: 0 } },
    ],
    joins: [{ seats: 5, tableKeys: ["a", "b"] }],
  }));
  expect(revision).toBe(1);
  const plan = await inTx(v, (tx) => readZonePlan(tx, v.cfg, v.tables.zoneId));
  expect(plan.tables.find((t) => t.id === ids.b)).toMatchObject({ label: "Bar 1", fixed: true, seats: 1 });
  expect(plan.joins).toEqual([{ id: expect.any(String), seats: 5, tableIds: [t1, ids.b] }]);
});
it("refuses a save from an older copy and writes nothing", async () => {
  /* save at revision 0 → 1; a second save still saying revision 0 is refused floor_plan.changed;
     the plan reads as the first save left it */
});
it("swaps two tables' names in one save", async () => { /* T1↔T2 */ });
it("refuses a name used by another table in the venue, naming it", async () => {
  /* a table "Patio 1" in another zone; saving a new table "Patio 1" → table.label_taken {label} */
});
it.each([
  ["tables.0.label", { label: "  " }],
  ["tables.0.placement.rotation", { placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 10 } }],
  ["tables.0.placement.x", { placement: { x: 1000, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } }],
  ["tables.0.seats", { seats: -1 }],
])("refuses %s", async (field, patch) => { /* floor_plan.invalid {field} */ });
it("refuses a join of one table", async () => { /* joins.0.tableKeys */ });
it("keeps a seated table taken off the plan where it stands today, a spare once the party leaves", async () => {
  /* seat at t1; save with t1's placement null; floorRow(t1).today.placement is its old position;
     finish the party: today.spare is true */
});
it("refuses a save missing a table of the zone", async () => { /* a table added after the copy: floor_plan.changed */ });
it("renames T1 to T9 and adds a new T1 in one save", async () => { /* … */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.11: The saved plan's dashboard routes

**Files:**
- Modify: `apps/server/src/management-api.ts` (two routes beside the zone routes, `:1663-1720`;
  `STATUS`: `floor_plan.changed: 409`, `floor_plan.invalid: 400`),
  `apps/dashboard/src/api/client.ts` (types `FloorPlan`, `FloorPlanSave` mirroring Task 1.10's, and
  `getFloorPlan(zoneId)`, `saveFloorPlan(zoneId, body)`), `apps/dashboard/src/api/live-queries.ts`
  (`getFloorPlan: ["floor_plans", "floor_plan_tables", "floor_plan_joins", "floor_plan_join_tables", "dining_tables"]`),
  `apps/dashboard/src/i18n/codes.ts` (`floor_plan.changed`, `floor_plan.invalid`, EN and ES)
- Test: `apps/server/src/management-api.test.ts` (a new `describe("floor plans")`), the dashboard
  client test file

**Interfaces:**
- Produces: `GET /management-api/zones/:id/floor-plan` → 200 `ZonePlan`;
  `PUT /management-api/zones/:id/floor-plan` with `ZonePlanSave` → 200 `{ revision, ids }`. Both
  through `withVenueAuth` (`venue.configure`, `management-api.ts:420`) and `requireZoneId`
  (`:339`). The body is shape-checked in the route (`management.request_invalid { field }` for a
  non-object, a non-array `tables`/`joins`, a non-string `label`/`key`, a non-boolean `fixed`), and
  value-checked by `saveZonePlan`.

- [ ] **Step 1: Write the failing tests**: manager reads an empty plan (200, revision 0); saves
(200, revision 1) and reads it back; an older copy is 409 `floor_plan.changed`; a bad rotation is
400 `floor_plan.invalid {field: "tables.0.placement.rotation"}`; `tables` not an array is 400
`management.request_invalid {field: "tables"}`; staff is 403; no session is 401; an unknown zone is
404 `zone.not_found`. Use the file's `req`, `managerCookie`, `staffCookie` and `createZone` helpers
(`management-api.test.ts:223-259`).
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "floor plans"`. Expected: 404 for the route.
- [ ] **Step 3: Implement** the routes, the client methods and the strings.
- [ ] **Step 4: Run** that command, `pnpm exec vitest run scripts/live-subscriptions.test.ts`, and the dashboard client test. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.12: Today's plan in the till's table-state read

**Files:**
- Create: `apps/server/src/floor-today-state.test.ts`
- Modify: `apps/server/src/floor-today-store.ts` (created in Task 1.9),
  `apps/server/src/working-order.ts` (`TableState`, `:6852`; `listTablesWithState`, `:6900`),
  `apps/till/src/api/client.ts` (`TableState`, `:1748`, gains the same field)

**Interfaces:**
- Consumes: `resolveTodayPlan`, `TodayTable` (Task 1.2); `todayBusinessDay` (Task 1.9).
- Produces:

```ts
// floor-today-store.ts
export async function readTodayPlans(tx: Transaction, cfg: TillConfig, now: Date): Promise<{ businessDay: string; byTable: Map<string, TodayTable> }>;
// TableState gains:
today: TodayTable | null; // null for a table in no zone
```

`readTodayPlans` reads the business day (`businessDayOf(now, await readLocationClock(tx,
cfg.locationId))`), the held set (`party_tables.left_at is null`), every zone's saved positions,
and today's rows and joins that could be live (business day equal to today, or earlier and naming
a held table), then calls `resolveTodayPlan` once per zone. It never writes. `listTablesWithState`
passes its own `now` through.

- [ ] **Step 1: Write the failing tests** — a venue whose cutover is 04:00 (update
`locations.day_cutover`), `now` passed to `listTablesWithState` as 2026-10-09 05:00 venue time
(so the business day is 2026-10-09 and 03:00 the same calendar morning belongs to 2026-10-08):

```ts
it("shows a table at its saved position", async () => { /* saved plan via saveZonePlan; floorRow(t1).today.placement.x is 0 */ });
it("ignores yesterday's move on a free table", async () => { /* floor_today_tables row for 2026-10-08 x 20 → today.placement.x 0 */ });
it("keeps yesterday's move while the table's tab is open, and returns it to the saved plan when the tab closes", async () => {
  /* seat t1; row for 2026-10-08 x 20 → x 20; finish the party → x 0 */
});
it("reads a change written at 03:00 as yesterday's", async () => {
  /* row stamped 2026-10-08 (the business day of 03:00 on 2026-10-09 with a 04:00 cutover), table free → ignored */
});
it("lists a zone table with no saved position as a spare", async () => { /* today.spare true */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-state.test.ts`. Expected: `today` is undefined.
- [ ] **Step 3: Implement.** Keep `posX`… on `TableState` until slice 5.
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts src/working-order.test.ts src/till-api.profile-zones.test.ts`. Whole-shape pins of `TableState` (`toEqual`) gain the `today` key (allowed: adding a key to a whole-shape pin). Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.13: Seeds and test helpers write saved plans

**Files:**
- Modify: `apps/server/scripts/demo-seed/floor.ts` (`DEMO_TABLES`: add a grid placement and
  `fixed` for bar stools beside today's permille placement), `apps/server/scripts/demo-seed/seed-floor.ts`
  (`:211-231`: after creating the tables, one `saveZonePlan` per zone), the demo seed's test
- Test: the demo seed's existing test file (find it: `git grep -l seedFloor -- '*.test.ts'`)

**Interfaces:**
- Consumes: `saveZonePlan` (Task 1.10).

The grid placement keeps the demo's layout. The old `posX`/`posY` is the table's CENTRE in
thousandths (`wt-floor-canvas.ts:276-278` draws it with `translate(-50%,-50%)`), and the new `x`/`y`
is the corner (decision 9): `x = round(posX / 1000 * 120 - width / 2)`, `y = round(posY / 1000 *
80 - height / 2)`, clamped at 0 (a 120 × 80 grid, the old canvas's 3:2), size from today's `sizeForCapacity`
equivalents (S 6 × 6, M 8 × 8, L 10 × 8, XL 14 × 8), `shape` round for `round`, else rect. The bar
seats become 2 × 2 round fixed tables.

- [ ] **Step 1: Write the failing test**: after the demo seed, every demo zone with tables has a
saved plan, every table of it is placed, the bar stools are `fixed`, and no two tables in one
zone overlap (compare their rectangles; rotation ignored).
- [ ] **Step 2: Run and watch it fail.** Expected: no saved plan.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the seed test; start the demo stack (`wa-wt demo <worktree-name>`) and
`GET /management-api/zones/<terrace>/floor-plan` once to see the seed's plan read back.
- [ ] **Step 5: Commit.**

**Slice 1 done when:** focused tests above pass; `/finish-branch` runs the full wave; CI is green on
the head; the backlog's A429 entry says slice 1 landed and what it left.

---

## Slice 2 — the dashboard editor (spec §4)

Branch `feat/floor-plan-editor`, after slice 1 lands. Tasks to be expanded to step level on the
branch.

- **Task 2.1: Plan geometry** — `packages/ui/src/floor-plan-geometry.ts` (pure, node tests):
  `GRID_SQUARE_PX`, `snapToSquare`, `clampToGrid` (0–999), `bounds(tables)`, `cropToTables(tables,
  margin = 2)`, `fitScale(crop, viewport)`, `firstFreeSpot(tables, size)`,
  `rotatedRect(placement)`, `automaticNames(prefix, existingLabels, count)` (numbers on from the
  highest number used with that prefix: "Terrace 6…15"). Tests include a prefix that is a prefix
  of another ("Terrace" vs "Terrace bar 3"), an empty zone, and a rotated table's crop.
- **Task 2.2: Undo and redo** — `packages/ui-core/src/history.ts`: a snapshot stack
  (`push(state)`, `undo()`, `redo()`, `canUndo`, `canRedo`, `reset(state)`), with redo cleared on
  a new push; node tests. The editor's draft scope compares the current snapshot with the opened
  one, so undoing every change makes Save quiet again.
- **Task 2.3: `wt-floor-plan-canvas`** — a new primitive: draws the grid and the tables
  (`Placement` + label + fixed marker), grows the grid as tables move right or down, drag snaps
  to the grid, arrow keys nudge the selected table one square, a rotation handle in 15° steps,
  click selects; events `wt-table-select`, `wt-table-move`, `wt-table-rotate`. Token-painting
  test, `*.a11y.test.ts` (both themes; selected and unselected), keyboard tests with dispatched
  events (CLAUDE.md §4).
- **Task 2.4: The editor page** — `apps/dashboard/src/screens/floor-plan-editor.ts`, a core
  screen `floor-plan` (URL `/manage/floor-plan/<zoneId>`, in `UNLISTED_SCREENS`,
  `dashboard-app.ts:238`, drawn full height like the catalogue's `.body.fill`, `:1410`): header
  with the zone's name, Close, Undo, Redo, Save; `draftScopeFor` + `saveActionState`; Save sends
  `saveFloorPlan`; on `floor_plan.changed` a message offers to load the newer plan (nothing is
  overwritten); `floor-plan-editor.unsaved.test.ts`.
- **Task 2.5: The side panel and Add tables** — tables list (placed greyed, tap an unplaced one to
  place it at `firstFreeSpot`), and "Add [n] tables with [s] seats": automatic naming (prefix defaulting to the zone's
  name) or custom naming,
  Fixed in place; a taken name refused beside its field (`table.label_taken`, matched by label);
  new tables arrive unplaced. A bottom sheet below 600 px wide (a `wt-*` sheet primitive if none
  exists — add it to `packages/ui` with its two tests).
- **Task 2.6: The selected table's panel** — name, seats (`wt-number-stepper`), shape, width and
  height, rotation, Fixed in place, its saved joins with Add (which tables, seats) and Remove,
  Remove from plan, Delete (confirm, then `deleteTable`; `table.booked` shown in the panel; on
  success the table leaves the draft, and when a party sits there the confirmation says it stays
  on the till until they leave).
- **Task 2.7: The entry point** — "Edit floor plan" / "Add a floor plan" in the zone row's menu on
  Departments and zones (`venue-operations-screen.ts:1536-1574`), linking to the editor's URL;
  needs `venue.configure` as well as the screen's own permission (hide it otherwise).
- **Task 2.8: Look** — EN and ES, light and dark, 1280 px and 390 px: empty zone, a seeded zone, a
  selected table, Add tables, a refusal; screenshots kept outside the repository.

## Slice 3 — the till's map (spec §5)

Branch `feat/floor-plan-till-map`, after slice 2. Coordinate with A182 (canvases retired) and
A414 (device screens on a phone) if either has started.

- **Task 3.1: Gestures** — `packages/ui/src/gestures.ts`: one pointer state machine telling tap,
  double-tap, long-press (500 ms, under 8 px of movement), long-press-then-drag and drag-on-empty
  (pan) apart, and two pointers as pinch; browser tests with real dispatched pointer events and
  fake timers advanced through an awaited animation frame (CLAUDE.md §4).
- **Task 3.2: `wt-floor-map`** — draws a `TodayTable[]` cropped to its tables with a two-square
  margin and fitted (Task 2.1), pinch to zoom, drag to pan, double-tap empty space to fit again;
  each table a fill colour and at most one flashing dot (reduced motion: no flash); the name
  hidden under 28 px (decision 11); merges drawn as one shape with both names ("4+5"). Events
  `wt-table-tap`, `wt-table-details`, `wt-table-drag-end`. The stand-in status set (spec §5) is a
  pure function `standInStatus(tableState) → { fill, dot }` in the till, with tokens for each
  fill. Token and a11y tests.
- **Task 3.3: The till floor screen on the new map** — `apps/till/src/screens/till-floor-screen.ts`
  uses `wt-floor-map` from `TableState.today`; the list view lists today's tables; the seat
  dialog's covers placeholder is "4 seats" from today's seats, or "Covers"; the 15-second re-read
  while a map shows (decision 13).
- **Task 3.4: The details sheet** — `apps/till/src/widgets/table-details-sheet.ts`, opened by
  long-press (double-click with a mouse): party name, covers, amount owed, kitchen progress,
  signals, reserved time, and Mark cleared; slice 4 adds the other actions.
- **Task 3.5: Flash notice and status pin** — on the order screen
  (`till-table-order-screen.ts`, in `.head-actions`, `:396-418`): a notice for ready-to-serve,
  forgotten and bill requested that goes on its own after 4 s or on a tap and blocks nothing; a
  pin with the colour and a short word or count that opens the details sheet.
- **Task 3.6: Look** — handheld at 390 px and the till at 1280 px, both themes, EN and ES.

## Slice 4 — today's plan on the till (spec §6)

Branch `feat/floor-plan-today`, after slice 3.

- **Task 4.1: Today's writes** — in `floor-today-store.ts`: `moveToday`, `rotateToday`,
  `takeOffToday` (refused `tab.already_open` while held), `putBackToday`, `placeSpareToday`,
  `seatsToday`, `backToSaved` (deletes the table's live row), `placeSpareToday` putting the spare
  in the middle of the zone's current crop, `resetZone` (deletes every live row
  and join of the zone whose tables are free; held ones wait). Each write first deletes the zone's
  stale rows, and moves a table's live older row to today before changing it. Moving a fixed table
  is refused `table.fixed`.
- **Task 4.2: Today's routes** — `apps/server/src/floor-today-api.ts`, mounted by `till-api.ts`:
  `POST /api/tables/:id/today/{move,rotate,take-off,put-back,place,seats,back}` and
  `POST /api/zones/:id/today/reset`, each `requireSession(deps, c, { action: "take-orders" })`
  then `checkZones` first in the transaction (`till-api.ts:2250` pattern). Each gets its row in
  the two maps' doc tables and route lists
  (`till-api.profile-actions.test.ts:43-91`, `:225`; `till-api.profile-zones.test.ts:62-126`,
  `:414`) and so a refusing case without `take-orders` and outside the zone.
- **Task 4.3: Merge on join** — `POST /api/parties/:id/join` and a new
  `POST /api/tables/:id/today/merge` (two free tables, no party) take `side: "left" | "right" |
  "top" | "bottom"`; the server places the dragged table touching the target on that side at the
  target's rotation, records a today's join with each member's position before it, seats from the
  saved join with exactly these tables or from the request (refused `floor_plan.invalid
  {field:"seats"}` when neither); free + free, seated + free (the party extends) and seated +
  seated (the existing combine flow); tables in zones of different service areas are refused
  `service_zone.join_mismatch` on the merge route as on the join route (`table-actions.ts:112-118`).
  Fixed tables: the join route joins the party and writes no today's join; two free fixed tables
  become one new party seated at both, through the seat dialog (seat the first, join the second); a move of a fixed table sent to any route is refused (Review focus 5). Split on a
  free merge deletes the join and restores the positions; with a party it runs `splitTable` and
  restores the split table's position.
- **Task 4.4: Dragging on the map** — long-press-drag moves a movable table (snap on release), drop
  on another table joins (asks seats when there is no saved join, suggesting the sum), a fixed
  table's copy follows the finger and springs back with a linking line; a party at several fixed
  tables is drawn in one colour with a thin linking line and one label; `Join with…` in the
  details sheet for keyboard and screen-reader users.
- **Task 4.5: The sheet's actions and the zone menu** — Split, Rotate, Change seats for today, Back
  to its saved place, Take off for today; the zone menu (⋮, `wt-row-actions`) with Add a spare
  table ("No spare tables — add some in the floor plan editor" when none), Taken off today with Put
  back, and Reset to saved plan (asks first).
- **Task 4.6: Look** — as Task 3.6, plus a drag in progress and a merge.

## Slice 5 — removing the old pieces (spec §11)

Branch `feat/floor-plan-retire-old`, after slice 4. PR first line: **"venue reset needed"**.

- **Task 5.1: Remove the old screens and routes** — the floor screen's Config tab, per-zone tabs
  and Disable/Enable (the Floor nav item opens the departments screen's zone list or is removed —
  decide with the owner in the slice's plan expansion); the four placement routes and their client
  methods; the `table-layout-editor` card type (contract, layout permission map, card grid);
  `wt-floor-canvas` if nothing else uses it, `sizeForCapacity`, `FLOOR_ASPECT`, `defaultTraySlot`,
  `isTableZoneless`; `TableState`'s `posX`, `posY`, `shape`, `rotation`.
- **Task 5.2: `active` and `capacity` go** — every reader of `dining_tables.active` moves to "the
  table exists" (`working-order.ts:1201`, `:7027`; `move-bill.ts:225`; `report-api.ts:170-172`;
  `tables.ts`; `venue-service/src/operations.ts:225-233`, `:254`, `:321`;
  `department-transfers.ts:414-415`; `packages/bookings/src/bookings.ts:60`); zone switch-off no
  longer switches tables off; `capacity` is read as `seats`.
- **Task 5.3: The migration** — one generation adds `seats` (no rebuild); code switches to it; a
  second generation drops `capacity`, `active`, `pos_x`, `pos_y`, `shape`, `rotation` and makes
  `zone_id` required (a rebuild), wrapped by custom migrations that drop and re-create
  `parties_clear_table_status` around it as `0043`/`0045` do. Before shipping: list every foreign
  key pointing at `dining_tables` (today `party_tables`, `working_orders`, `bookings`, and slice 1's
  four) and read the generated SQL; add the step's expected refusal to
  `scripts/migration-upgrade.test.ts` (as `core/0044_drop_table_bill_pointer`, `:279-282`); run
  the guards named in CLAUDE.md §3's regeneration rule. Seeds and test helpers that insert a table
  with no zone get one (`packages/reporting/test/fixtures.ts:496`, `:541`;
  `scripts/behavioural-triggers.test.ts:274`; the configuration fixture
  `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:199-213`).
- **Task 5.4: Docs** — `docs/developers/design-system.md` (the editor and the map),
  `docs/developers/conventions-data.md` (the "today" rule; names copied as text; delete), the
  backlog, and CLAUDE.md if a rule was paid for.
