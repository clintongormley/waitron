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
> **Revised 2026-10-08**, twice: after a fresh-context review against the spec and the code
> (which ran the behavioural trigger guard, drizzle-kit and the engine's foreign-key codes), and
> after the owner's answer that the master plan and today's plan are separate plans (decision 3).
> Slice 1's tasks 1.1, 1.2 and 1.8–1.16 were rewritten for the second revision, reviewed fresh
> (which ran the planner's rules as code, drizzle-kit and the foreign-key code), and revised again
> on its findings. Every `file:line` below was read at `main` `16b280dc0`,
> except `management-api.ts`, read at `25cd6d599`.

**Goal:** a zone's tables are laid out in a master floor plan edited freely on the dashboard; at
each day's reset the master is copied into today's plan, which the till shows and staff change
during service, as a map whose job is status and rearranging, with the details one tap away.

**Architecture:** two separate plans. The **master plan** is its own set of tables
(`floor_plans`, `floor_plan_tables`, `floor_plan_joins`), edited only by the dashboard and read
by nothing live. **Today's plan** is the live tables — `dining_tables`, which parties, orders and
bookings already point at — each with a row of today's state (`floor_today_tables`: position,
size, shape, seats, fixed, taken off) and today's merges (`floor_today_joins`). A reset copies the
master into today's plan: at the first floor read or write of a new business day (nothing runs at
the cutover itself) and on the Reset button. A table a party sits at waits, and catches up with
the master when its tab closes. A pure planner (`apps/server/src/floor-reset-plan.ts`) decides
what a reset does. Table names are copied as text when a party closes, and onto past orders and
bookings when a live table is removed, so a table the master no longer has can really go. The
dashboard gets a full-page editor; the till gets a new map primitive with pinch, pan and
long-press; today's changes are till routes gated like joining. The old placement columns,
routes, tabs and the till's layout-editor card go last.

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
2. **The old columns go in slice 5, not slice 1.** Dropping `pos_x`, `pos_y`, `shape`, `rotation`,
   `capacity` and `active` while the old floor screen and the till's layout editor still read them
   would break both for three slices. Slices 1–4 only ADD; slice 5 removes the old pieces and
   rebuilds `dining_tables` (`zone_id` required). Only slice 5 needs a venue reset. Until slice 5 a
   zone with no master plan works the old way.
3. **The master plan and today's plan are separate plans** (owner, 2026-10-08, replacing spec
   §6.3's "the owner's edits show through" and §9's "saved plan plus today's changes"). The master
   is edited freely and affects nothing live until a reset copies it into today's plan; everything
   live (parties, orders, bookings, the till's map) points only at today's tables. A reset happens
   at the first floor read or write of a new business day, and on Reset to saved plan. A table a
   party sits at keeps everything about today, a merge included, until its tab closes, then
   catches up. Each reset records what it copied, table by table (`floor_reset_tables`), and a
   table catches up to THAT record, so a master edit saved after the reset waits for the next one
   even when a party finishes in between.
4. **Delete is part of the editor's draft, covered by Undo.** Saving removes the master table. Its
   live table stays on today's plan until the next reset, or, if a party sits there then, until the
   party leaves; it is removed for good once nothing ties it — no open party holds it or used it
   earlier in its meal (the names are copied at close, so the row must last until then), and no
   order to it is unpaid or has food on its way. Its name is free on today's plan from then.
   **An upcoming booking assigned to the table refuses the delete** (`table.booked`; owner,
   2026-10-08: the booking is moved first). Bookings are otherwise later work.
5. **A counter order delivered to a table keeps its link until the table is removed**, not until
   it is issued. Removal then copies the table's name into a new
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
6. **A party's table names are kept as a list** (`parties.table_names`, the `labelList` column
   builder, `packages/db/src/schema/columns.ts:169`), because the order list returns `tables:
   string[]` (`apps/server/src/orders-list.ts:360-365`). The party's `party_tables` rows are deleted
   in the same transaction that closes it.
7. **A past booking keeps its table's name when the live table is removed**: removal asks every
   enabled module, through a new module seat, to let go of the table (bookings copies the name into
   a new `bookings.table_label`); the same seat's refusal is what decision 4's booking rule uses.
8. **A name waits for its table.** Names are unique across the venue. A master name may not be one
   a live table outside every plan uses (the save refuses it). At a reset, a table whose new name
   a waiting live table still uses — in any zone — keeps its old name, and a new table is not yet
   created, until the name is free; a table being removed frees its name only once its removal has
   succeeded. Staff never add or rename tables on today's plan; they keep spares in reserve
   (owner, 2026-10-08).
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
    merge, so the link ends when the party leaves (spec §6.1).
15. **The configuration export carries the master plan** (`floor_plans`, `floor_plan_tables`,
    `floor_plan_joins`, `floor_plan_join_tables`), not today's state.
16. **A zone's first master plan starts from its live tables, and its first save builds today's
    plan at once.** The editor opening a zone with no master offers the zone's current tables as
    the draft; saving links each to its live table and runs a reset for that zone. A table seated
    at that first reset gets its place on today's plan from the master at once, so the till can
    draw it, and keeps its current name until it is free.
17. **Until slice 5, a live table with no master table that was never in one is left alone by
    resets** — the old floor screen can still add tables to any zone, and a reset must not delete
    them overnight; the editor offers them for adoption. A live table whose master table was
    deleted is marked (`dining_tables.planned` stays true, `plan_table_id` goes null), so the reset
    knows to remove it. The old screen may no longer rename, rezone or switch on or off a planned
    table (`table.in_floor_plan`), or a reset would revert it or bring back a table it hid. Slice 5
    removes the old screen and the distinction.
18. **A merge with anyone seated at it waits as a whole** at a reset, every member included.
    Seating a party at a free merge seats it at every member (slice 4).
19. **Catching up happens at the next floor read or change**, not inside every path that frees a
    table: the till's table-state read and its seat, finish, move, join and split routes run the
    catch-up (and the day's reset) first. The till re-reads after its own actions and every 15
    seconds, and a delivery being paid or collected frees a table without any table route
    running.

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
- A closed party's `party_tables` rows surviving the close, and the order list reading closed
  parties' tables through them (`orders-list.ts:230`, `:243`, `:409-425`).
- A finished delivery order keeping `delivery_table_id` once its table is removed (it keeps the
  name instead).

**Slice 5:**
- The floor screen's Config tab, per-zone tabs and Disable/Enable, and
  `DELETE /management-api/tables/:id` switching a table off (`management-api.ts:1806`,
  `tables.ts:189`); the placement routes on the dashboard and the till (`management-api.ts:1818`,
  `:1854`; `till-api.ts:2996`, `:3037`); the till's `table-layout-editor` card
  (`apps/till/src/widgets/card-grid.ts:371-381`, `apps/till/src/layout.ts:104`,
  `packages/layouts/src/card-contract.ts:73-86`); `sizeForCapacity`, `FLOOR_ASPECT` and the
  permille placement (`packages/ui/src/floor.ts`); a table's `active` flag, `capacity` and every
  reader of them (listed in Task 5.2).

## Review focus

The five conditions most likely to bite a person that no single task's happy path exercises. Each
has its test in the task named.

1. **A table still seated at the cutover.** At 07:00, after a 06:00 cutover, a table seated last
   night that a waiter moved keeps its moved place, its merge and its name while the party sits
   there; every free table is back to the master; when the tab closes the table catches up
   (Tasks 1.8 and 1.12).
2. **A table deleted from the master while a party sits at it.** It stays on today's plan through
   the next reset, can take no new party once its master is gone and the reset has run, and goes —
   its name free, its history kept on the party, the delivered order and the booking — when the
   party leaves (Tasks 1.3–1.6, 1.9, 1.12).
3. **A name moving between tables.** The master renames "Terrace 4" to "Terrace 9" and adds a new
   "Terrace 4" while the old one is occupied at the reset: the new one appears when the old one is
   free, and nothing is refused (Tasks 1.2 and 1.12).
4. **A master edit saved mid-service.** The owner renames, moves, adds and deletes tables while a
   party is seated elsewhere in the zone; the party finishes; nothing on the till changes until
   the next reset (Task 1.8).
5. **A fixed table sent a move anyway.** A move request for a fixed table, sent straight to the
   route, is refused and nothing moves (Task 4.3).

## File map

| File | Slice | Responsibility |
| --- | --- | --- |
| `packages/db/src/schema/floor-plans.ts` | 1 | the master plan's and today's tables |
| `packages/db/drizzle/01xx_*.sql` | 1, 5 | generated and custom migrations |
| `apps/server/src/floor-reset-plan.ts` | 1 | the pure reset planner |
| `apps/server/src/floor-today-store.ts` | 1, 4 | building today's plan from the master (1), today's writes (4) |
| `apps/server/src/floor-plan.ts` | 1 | read, check and save a zone's master plan |
| `apps/server/src/table-removal.ts` | 1 | removing a live table the master no longer has |
| `packages/module/src/module.ts` | 1 | the `tableRemoval` seat |
| `packages/bookings/src/table-removal.ts` | 1 | bookings' part in a removal |
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

Branch `feat/floor-plan-storage`. Lands on its own: the till and dashboard look the same after it
(the order list reads copied names, and the old screen refuses to rename a planned table); zones
get master plans and today's plans from the seed, and the server answers the master plan's routes
and today's state.

### Task 1.1: The master plan's tables, today's tables, and the new columns

**Files:**
- Create: `packages/db/src/schema/floor-plans.ts`, `packages/db/src/schema/floor-plans.test.ts`
- Modify: `packages/db/src/schema/index.ts` and `packages/db/src/index.ts` (exports, beside
  `dining-tables`), `packages/db/src/schema/dining-tables.ts` (`plan_table_id`, `planned`),
  `packages/db/src/schema/parties.ts` (`table_names`), `packages/db/src/classification.ts` (nine
  `classify` rows after `dining_tables`, `:92`), `packages/db/src/configuration-transfer.ts` (the
  four master-plan tables after `dining_tables`, `:36-40`), `scripts/schema-constraints.test.ts`
  (the new keys and unique indexes, as the file lists `dining_tables`' at `:115-117`)
- Generated: one new core migration under `packages/db/drizzle/` with its snapshot and journal entry

**Interfaces:**
- Produces (all exported from `@waitron/db`):

```ts
export const floorPlanShape = enumType(["rect", "round"]);
// The master plan — edited by the dashboard only; nothing live reads it.
export const floorPlans;          // floor_plans: id, zone_id (unique, FK floor_zones), revision count not null default 0, saved_at ts not null
export const floorPlanTables;     // floor_plan_tables: id, plan_id (FK), label not null, seats count (nullable), fixed flag not null default false, x, y, width, height, shape, rotation (nullable; all null = a spare); unique (plan_id, label)
export const floorPlanJoins;      // floor_plan_joins: id, plan_id (FK), seats count not null
export const floorPlanJoinTables; // floor_plan_join_tables: id, join_id (FK), plan_table_id (FK floor_plan_tables); unique (join_id, plan_table_id)
// What the zone's last reset copied (decision 3): one row per planned live table, plus one per table it is to create.
export const floorResetTables;    // floor_reset_tables: id, zone_id (FK floor_zones), table_id (FK dining_tables, nullable: a table to create), label not null, seats count (nullable), fixed flag not null default false, the six placement columns (nullable), remove flag not null default false, pending flag not null default false; unique (table_id)
// Today's plan — the live tables' state for the day.
export const floorTodayZones;     // floor_today_zones: id, zone_id (unique, FK floor_zones), business_day day not null, generation count not null default 0
export const floorTodayTables;    // floor_today_tables: id, table_id (unique, FK dining_tables), seats count (nullable), fixed flag not null default false, the six placement columns (nullable; all null = an unplaced spare), taken_off flag not null default false
export const floorTodayJoins;     // floor_today_joins: id, zone_id (FK floor_zones), seats count not null
export const floorTodayJoinTables;// floor_today_join_tables: id, join_id (FK), table_id (unique, FK dining_tables), before_x, before_y, before_rotation not null
// dining_tables.plan_table_id: id (nullable), FK floor_plan_tables — the master table this live table follows
// dining_tables.planned: flag not null default false — true once the table has followed a master table (decision 17)
// parties.table_names: labelList (nullable)
```

As built, `floor_reset_tables` also has `plan_table_id` (nullable, a plain no-action foreign key to
`floor_plan_tables`: the master table the target was copied from; `saveZonePlan` sets it null before
deleting a master table) and `placed` (flag not null default false: today's row has been set from
the target, so a later catch-up only retries its name). Migration 0130 adds indexes on
`floor_reset_tables (zone_id, pending)` and `floor_today_joins (zone_id)` (amended 2026-10-10, as
built in slice 1).

`dining-tables.ts` and `floor-plans.ts` reference each other: declare `plan_table_id`'s key with
a lazy column, as `parties.ts` does for `main_bill_id` (`(): AnySQLiteColumn => floorPlanTables.id`).

Checks, each named `<table>_<what>_ck`: `x` and `y` between 0 and 999; `width` and `height`
between 1 and 99; `rotation` between 0 and 345 and `rotation % 15 = 0` (and `before_rotation`);
`shape` by `enumCheck`; on `floor_plan_tables`, `floor_reset_tables` and `floor_today_tables` the
six placement columns all null or all set; `seats` null or between 0 and 999 on tables, and `>= 1`
on both join tables.

- [ ] **Step 1: Write the failing tests.** In `floor-plans.test.ts`, set up as
`dining-tables.test.ts:13-30` does (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`, a tenant, a
location), plus one zone, a plan and two live tables. Each refusal is caught outside the
transaction (CLAUDE.md §3) and asserted the way the sibling schema tests assert a check, with their
`checkFailed` helper (`packages/db/src/schema/bill-payments.test.ts:321-325`); the `toThrow` lines
below show intent.

```ts
it.each([
  ["rotation 20", { rotation: 20 }, "floor_plan_tables_rotation_ck"],
  ["rotation 360", { rotation: 360 }, "floor_plan_tables_rotation_ck"],
  ["x -1", { x: -1 }, "floor_plan_tables_x_ck"],
  ["width 0", { width: 0 }, "floor_plan_tables_width_ck"],
  ["shape square", { shape: "square" }, "floor_plan_tables_shape_ck"],
  ["a position without a size", { width: null }, "floor_plan_tables_placement_ck"],
])("refuses a master table with %s", async (_name, patch, constraint) => {
  await expect(insertMasterTable({ ...GOOD_MASTER_TABLE, ...patch })).rejects.toThrow(constraint);
});
it("accepts a master spare with no position at all", async () => { /* all six null */ });
it("keeps names unique within a plan", async () => { /* second "T1" on the plan refused */ });
it("keeps one plan, and one today's row, per zone", async () => { /* … */ });
it("keeps one today's row and one reset row per live table, and a table in one merge at a time", async () => { /* … */ });
it("round-trips a plan, reset rows, today's rows and the new columns", async () => {
  /* incl. a reset row with table_id null; dining_tables.planned default false, plan_table_id,
     parties.table_names ['T1','T2'] */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`. Expected: cannot import `./floor-plans.js`.
- [ ] **Step 3: Implement** the schema with the column vocabulary from `./columns.js` only
(CLAUDE.md §3), export it, add the columns, the nine `classify(..., "state", STATE)` rows and the
four transfer entries. Generate: `pnpm --filter @waitron/db db:generate`. Read the SQL: nine
`CREATE TABLE`s, three `ALTER TABLE … ADD` (the review's run of the earlier draft produced
`ADD plan_table_id text REFERENCES floor_plan_tables(id)` and no rebuild), the indexes, and no
`__new_`.
- [ ] **Step 4: Run the tests and the guards** —
`pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts` and
`pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/migrations-match-schema.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/behavioural-triggers.test.ts`. Expected: all pass; read each `Tests` count.
- [ ] **Step 5: Commit** — message states why the tables are core (Global constraints).

### Task 1.2: The reset planner

**Files:**
- Create: `apps/server/src/floor-reset-plan.ts`, `apps/server/src/floor-reset-plan.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanShape = "rect" | "round";
export interface Placement { x: number; y: number; width: number; height: number; shape: PlanShape; rotation: number }
/** What a reset copies for one table: the master's values, or that the table goes. */
export interface Target { tableId: string | null; label: string; seats: number | null; fixed: boolean; placement: Placement | null; remove: boolean }
export interface LiveTable {
  id: string;
  label: string;
  held: boolean;        // an open party sits there now
  tied: boolean;        // held, or used earlier by a party still open, or an order to it unpaid or with food on its way
  hasToday: boolean;    // it has a today's row
  mergedWithHeld: boolean; // it is in a today's merge with a held table
}
export interface ResetPlan {
  apply: { target: Target; label: string | null }[];  // label null: keep the current name, the target's is still in use
  seed: Target[];       // held tables with no today's row: today's row from the target, name kept; the target stays pending
  create: Target[];     // tables to create, whose names are free
  remove: string[];     // to remove for good (Task 1.9)
  hide: string[];       // to take off today's plan, tied, removed once free
  pending: Target[];    // still to do at a later catch-up: waiting tables, names in use, creates not made, tied removals
}
export function planReset(input: { targets: readonly Target[]; live: readonly LiveTable[]; takenElsewhere: ReadonlySet<string> }): ResetPlan;
export function targetsFromMaster(master: readonly { id: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }[], live: readonly { id: string; planTableId: string | null; planned: boolean }[]): Target[];
```

`targetsFromMaster` (the reset's targets): one per planned live table — its master table's values,
or `remove: true` when its `planTableId` is null or names no master table; none for a live table
not `planned` (decision 17); one with `tableId: null` per master table no live table follows.

`planReset`, rules, for one zone:
- A target whose table is `held`, or `mergedWithHeld`, waits: it is in `pending`. A held table
  with no today's row also goes in `seed` (decision 16).
- A `remove` target whose table is not `tied` goes in `remove`; if tied but not held, in `hide`
  and `pending`.
- Every other target with a `tableId` goes in `apply`; with no `tableId`, in `create`.
- **Names.** A name is in use when a live table keeps it after this plan: a waiting table, a
  table in `remove` or `hide` (a removal frees its name only once it has succeeded, so its name is
  free at the next pass), an `apply` that keeps its current name, and every name in
  `takenElsewhere` (the venue's live tables outside the zone). Start with every `apply` taking its
  target's name and every `create` made; then, repeatedly, an `apply` whose target name is in use
  or taken by another entry keeps its current name (`label: null`, and its target also goes in
  `pending`), and such a `create` is dropped to `pending`; when two entries want one free name,
  the one listed first in `targets` keeps it. Stop when a pass changes nothing; it ends, because an
  entry only ever moves from "new name" to "keeps its name" or "not created".

- [ ] **Step 1: Write the failing tests:**

```ts
const t = (tableId: string | null, label: string, over: Partial<Target> = {}): Target => ({ tableId, label, seats: 4, fixed: false, placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }, remove: false, ...over });
const l = (id: string, label: string, over: Partial<LiveTable> = {}): LiveTable => ({ id, label, held: false, tied: false, hasToday: true, mergedWithHeld: false, ...over });
const none = new Set<string>();
const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

it("copies the target onto every free table", () => {
  expect(planReset({ targets: [t("a", "T1")], live: [l("a", "T1")], takenElsewhere: none }).apply).toEqual([{ target: t("a", "T1"), label: "T1" }]);
});
it("leaves a seated table, and the free table merged with it, pending", () => {
  const plan = planReset({ targets: [t("a", "T1"), t("b", "T2")], live: [l("a", "T1", { held: true, tied: true }), l("b", "T2", { mergedWithHeld: true })], takenElsewhere: none });
  expect(plan.apply).toEqual([]);
  expect(plan.pending.map((x) => x.tableId)).toEqual(["a", "b"]);
});
it("seeds a seated table that has no today's row, keeping its name", () => {
  const plan = planReset({ targets: [t("a", "Patio 1")], live: [l("a", "T1", { held: true, tied: true, hasToday: false })], takenElsewhere: none });
  expect(plan.seed).toEqual([t("a", "Patio 1")]);
  expect(plan.pending).toEqual([t("a", "Patio 1")]);
});
it("creates a table the target adds", () => {
  expect(planReset({ targets: [t(null, "T2")], live: [], takenElsewhere: none }).create).toEqual([t(null, "T2")]);
});
it("removes a free table, and hides one still tied", () => {
  const plan = planReset({ targets: [t("a", "T1", { remove: true }), t("b", "T2", { remove: true })], live: [l("a", "T1"), l("b", "T2", { tied: true })], takenElsewhere: none });
  expect(plan).toMatchObject({ remove: ["a"], hide: ["b"] });
});
it("swaps two names in one plan", () => {
  const plan = planReset({ targets: [t("a", "T2"), t("b", "T1")], live: [l("a", "T1"), l("b", "T2")], takenElsewhere: none });
  expect(plan.apply.map((x) => x.label)).toEqual(["T2", "T1"]);
});
it("makes a new table wait for a name a seated table still uses", () => {
  const plan = planReset({ targets: [t("a", "Terrace 9"), t(null, "Terrace 4")], live: [l("a", "Terrace 4", { held: true, tied: true })], takenElsewhere: none });
  expect(plan.create).toEqual([]);
  expect(plan.pending.map((x) => x.label)).toEqual(["Terrace 9", "Terrace 4"]);
});
it("does not hand a removed table's name on in the same pass", () => {
  const plan = planReset({ targets: [t("a", "T1", { remove: true }), t("b", "T1"), t(null, "T3"), t("c", "T3", { remove: true })], live: [l("a", "T1"), l("b", "T2"), l("c", "T3")], takenElsewhere: none });
  expect(plan.remove).toEqual(["a", "c"]);
  expect(plan.apply).toEqual([{ target: t("b", "T1"), label: null }]);
  expect(plan.create).toEqual([]);
});
it("never gives two tables one name", () => {
  // b is seated as T2, so a keeps T1; c may not then take T1
  const plan = planReset({ targets: [t("a", "T2"), t("b", "T3"), t("c", "T1")], live: [l("a", "T1"), l("b", "T2", { held: true, tied: true }), l("c", "T4")], takenElsewhere: none });
  expect(sorted(plan.apply.map((x) => [x.target.tableId, x.label]))).toEqual(sorted([["a", null], ["c", null]]));
});
it("treats a name used in another zone as in use", () => {
  expect(planReset({ targets: [t(null, "Bar 1")], live: [], takenElsewhere: new Set(["Bar 1"]) }).create).toEqual([]);
});
it("builds targets from the master, leaving out a table the master never had", () => {
  const master = [{ id: "m1", label: "T1", seats: 4, fixed: false, placement: null }, { id: "m2", label: "T2", seats: 2, fixed: false, placement: null }];
  const live = [{ id: "a", planTableId: "m1", planned: true }, { id: "b", planTableId: null, planned: true }, { id: "c", planTableId: null, planned: false }];
  expect(targetsFromMaster(master, live).map((x) => [x.tableId, x.label, x.remove])).toEqual([["a", "T1", false], ["b", expect.any(String), true], [null, "T2", false]]);
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-reset-plan.test.ts`. Expected: cannot import `./floor-reset-plan.js`.
- [ ] **Step 3: Implement.** No database access in this file. A `remove` target carries the live
table's current label.
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
  `delivery_table_id = null, delivery_table_label = label`. It decides nothing; `removeLiveTable` (Task 1.9) calls it
  only for a table nothing ties any more, so no live order is ever released.

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
  (`:6652`) — each reads only live orders, and removal (Task 1.9) happens only to a table with
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
  /** The refusal for each of `tableIds` this module still needs; a table it lets go of has no entry. */
  refuse(tx: Transaction, cfg: { locationId: LocationId }, tableIds: readonly string[], now: Date): Promise<ReadonlyMap<string, AppError>>;
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

`refuse` answers `table.booked { tableId }` for each table a `booked` booking names on the venue's
today or later (amended 2026-10-10: as built, the seat takes a list of tables and answers a map, so
bookings reads the venue's day once and asks about every table in one query) (today from the venue's wall clock, as `floor.ts`'s `venueWallClock` computes it —
move `venueWallClock` and `safeTimeZone` into a shared file in the package rather than copying
them). `release` sets `table_label = label, table_id = null` on every booking naming the table.

- [ ] **Step 1: Write the failing tests** in `table-removal.test.ts` (set up as
`packages/bookings/src/floor.test.ts` does):

```ts
it("refuses while a booking from today on is booked at the table", async () => {
  const refused = await inTx((tx) => BOOKINGS_TABLE_REMOVAL.refuse(tx, cfg, [tableId], now));
  expect(refused.get(tableId)).toMatchObject({ code: "table.booked", params: { tableId } });
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

### Task 1.8: Building today's plan from the master

**Files:**
- Create: `apps/server/src/floor-today-store.ts`, `apps/server/src/floor-today-store.test.ts`

**Interfaces:**
- Consumes: `planReset`, `targetsFromMaster` and their types (Task 1.2); `venueMomentAt` and
  `readLocationClock` from `@waitron/reporting` (`business-day.ts:202`, `:220`; both exported —
  `businessDayOf` is not, and its callers must check the clock first, `:166-169`).
- Produces:

```ts
export async function todayBusinessDay(tx: Transaction, cfg: TillConfig, now: Date): Promise<string | null>; // venueMomentAt(now, clock)?.businessDay; null for a clock it cannot read
/** Copies the zone's master into today's plan: replaces the zone's reset rows with targetsFromMaster, then catches up. */
export async function resetZone(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, now: Date): Promise<void>;
/** Applies the zone's PENDING reset rows that can be applied now, repeating while a pass changes something. */
export async function catchUpZone(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, now: Date): Promise<void>;
/** For each zone with a master plan: resetZone when its today's plan is for an earlier business day (or it has none), else catchUpZone when it has pending rows. */
export async function ensureToday(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], now: Date): Promise<void>;
```

`removals` is an argument, never optional, so no caller can skip the modules' part (Task 1.9 uses
it; until then pass it through). A clock that cannot be read leaves today's plan as it is.
`catchUpZone` takes `now` too, for the modules' `refuse` (Task 1.9). The reset's `Target`
(`floor-reset-plan.ts`) carries `planTableId`, the master table it was copied from (amended
2026-10-10, as built in slice 1).

`resetZone`: write `floor_today_zones` (business day, generation + 1); replace the zone's
`floor_reset_tables` rows with `targetsFromMaster` (every row pending); `catchUpZone`.

`catchUpZone`: read the zone's pending reset rows as targets, its live tables (`held` from
`party_tables` rows whose `left_at` is null; `tied` from `tablesTied`, Task 1.9 — until then
`tied = held`; `hasToday`; `mergedWithHeld` from `floor_today_join_tables`), and
`takenElsewhere` (labels of every live table of the venue outside the zone); call `planReset`;
apply it in this order:
1. `remove`: Task 1.9 (until then treated as `hide`);
2. `hide`: the table leaves its today's merge (a merge left with fewer than two members goes with
   its members), its today's row is deleted, and `active` is set false, so every existing reader
   that skips an inactive table skips it (`openTab`, `working-order.ts:1201`; `readTargetTable`,
   `move-bill.ts:225`; the floor read, `:7027`; `listTables`) until slice 5;
3. every `apply` whose label changes, to the row's own id (first pass);
4. `create`: a `dining_tables` row (`location_id` = `cfg.locationId`, `zone_id`, label,
   `plan_table_id` = the target's `planTableId`, so a new table links to its master by id, not by
   name, `planned` true) and its today's row (amended 2026-10-10, as built in slice 1);
5. every `apply`: the final label (second pass); then, only when the reset row is not yet `placed`,
   today's row set from the target (seats, fixed, placement, `taken_off` false), `active` true, the
   table leaves any today's merge (a merge left with fewer than two members goes with its
   members), and the row is marked `placed`. A reset places a table once; a later catch-up of a
   row still pending for its name only retries the name, keeping the day's moves and merges
   (amended 2026-10-10, as built in slice 1);
6. `seed`: a today's row from the target, label unchanged;
7. reset rows: a target not in `pending` stops being pending; a created one gets its new
   `table_id`.
Then run again while the pass changed anything (a removal frees names for the next pass).

The reset rows keep the targets of the last reset, applied or not, so nothing later than the reset
reaches the till until the next one (decision 3; slice 4's Back to its saved place reads them).

- [ ] **Step 1: Write the failing tests** (`setupPartyVenue`; write a master plan by inserting
rows directly — Tasks 1.10 and 1.11 build the save; a helper `masterOf(v, zoneId, tables)` in the
test):

```ts
it("builds today's plan from the master on the first reset", async () => {
  /* master T1 at (0,0) 8×8, T2 a spare; resetZone: T1's today's row placed at (0,0), T2's
     unplaced; floor_today_zones generation 1; no reset row pending */
});
it("leaves a seated table and its merge alone, and catches them up once free", async () => {
  /* reset; seat T1; join the party to T2 (both held); merge T1+T2 by hand; change both in the
     master (T1 x 20, renamed "Patio 1"); resetZone: T1 and T2 keep today's places, names and merge,
     their rows pending; finish the party; catchUpZone: T1 at x 20 named "Patio 1", the merge gone */
});
it("does not bring a mid-service master edit to the till before the next reset", async () => {
  /* reset; rename and move T1 in the master, add T3, delete T2; seat and finish a party at T1;
     catchUpZone: nothing changed — T1 as before, no T3, T2 still there; resetZone: all three apply */
});
it("adds a table the master gained, and hides one it lost", async () => { /* active false, no today row */ });
it("seeds a table seated at the first reset, keeping its name until it is free", async () => { /* … */ });
it("does not reset a zone with no master plan", async () => { /* ensureToday: no floor_today_zones row */ });
it("resets at the first read of a new business day, and only once", async () => {
  /* cutover 04:00 (update locations.day_cutover); ensureToday at 2026-10-09 03:30 venue time,
     then at 05:00: generation goes 1 → 2; again at 06:00: still 2 */
});
it("leaves a table the master never had untouched", async () => { /* planned false: no today row, active unchanged */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-store.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.9: Removing a live table the master no longer has

**Files:**
- Create: `apps/server/src/table-removal.ts`, `apps/server/src/table-removal.test.ts`
- Modify: `apps/server/src/floor-today-store.ts` (`catchUpZone` removes `remove` tables; `tied`
  from `tablesTied`)

**Interfaces:**
- Consumes: `TableRemoval` (Task 1.6), `releaseDeliveries` (Task 1.4), `closePartyTables` on every
  close (Task 1.3).
- Produces:

```ts
/** The tables of `tableIds` an open party holds or used earlier in its meal, or an order to which is unpaid or has food on its way. */
export async function tablesTied(tx: Transaction, tableIds: readonly string[]): Promise<Set<string>>;
/** Removes the live table for good. Returns false when a module refuses, having changed nothing, or when something unknown still names it, having kept its reset row and the table itself. */
export async function removeLiveTable(tx: Transaction, cfg: Pick<TillConfig, "locationId">, removals: readonly TableRemoval[], tableId: string, now: Date): Promise<boolean>;
```

`tablesTied` (amended 2026-10-10: one call answers for every candidate table): a `party_tables` row of an OPEN party names the table (held, or left earlier while
the party is still open); or an order names it in `delivery_table_id` and either its `status` is
`open` or `placed`, or the floor's pending-delivery test holds — the conditions at
`working-order.ts:7015-7023` exactly (not abandoned, `collected_at` null, and a ticket item with
`made_here = 0`).

(amended 2026-10-10, as built in slice 1) `removeLiveTable` first asks every module's `refuse`; if
any refuses (bookings: an upcoming booking), it changes nothing and answers `false`. `catchUpZone`
asks the same before planning, and treats a refused table as held: it waits whole, on today's plan
with its reset row pending, until the refusal clears.

`removeLiveTable`: each removal's `release`; `releaseDeliveries(tx, id, label)`; delete its
`floor_today_join_tables` row (a merge left with fewer than two members goes with its members),
its `floor_today_tables` row and its `floor_reset_tables` row; then the `dining_tables` row. A
foreign-key refusal at that last delete (rows of a module switched off since, or of a party closed
before slice 1) is caught by `isRefusal(error, FOREIGN_KEY_VIOLATION)`
(`packages/db/src/sql-state.ts:24`; every key into `dining_tables` is `no action`, which this engine
refuses with code 787 — measured twice by the plan reviews on Node v26.7.0 `node:sqlite`;
`restrictRefused` matches only 1811) and answered `false`; `catchUpZone` then hides the table and
keeps its reset row pending, so it is tried again. A refused statement backs out only itself
(CLAUDE.md §3), so the releases before it stand: orders and bookings keep the table's name and no
longer point at it, and the table is off today's plan, which `catchUpZone` then hides anyway. Any
other error is rethrown.

- [ ] **Step 1: Write the failing tests:**

```ts
it("removes a free table the master lost, keeping its name on the history", async () => {
  /* a party seated and finished at it (Task 1.3 copied the name); a delivered order to it, settled
     and collected; a settled delivered order never collected that had no ticket items; delete its
     master table; resetZone: the row is gone, both orders keep deliveryTableLabel "T4", the party
     keeps tableNames ["T4"] */
});
it("frees the name for a table created in the same catch-up", async () => {
  /* master deletes T1 and renames T2 to "T1": after resetZone, T2 is named "T1" (second pass) */
});
it.each([
  ["a party that moved away and is still open"],
  ["an unpaid order to it"],
  ["food still on its way to it"],
])("hides rather than removes a table tied by %s, and removes it once free", async () => { /* … */ });
it("asks each module to let go", async () => { /* a fake TableRemoval records release(tableId, label) */ });
it("leaves a table something unknown still names, hidden and pending, without failing", async () => {
  /* insert a party_tables row for a CLOSED party by hand (as before slice 1); resetZone resolves;
     the row remains, inactive; delete the stray row; catchUpZone: the row is gone */
});
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/table-removal.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement**; wire it into `catchUpZone`.
- [ ] **Step 4: Run** the file and `src/floor-today-store.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.10: Reading the master plan, and checking a save

**Files:**
- Create: `apps/server/src/floor-plan.ts`, `apps/server/src/floor-plan.test.ts`
- Modify: `apps/server/src/errors.ts` (`floor_plan.out_of_date { zoneId, revision }`, the plan's
  current revision, `floor_plan.invalid { field }`)

**Interfaces:**
- Consumes: `Placement`, `PlanShape` (Task 1.2).
- Produces:

```ts
export interface PlanTable { id: string | null; liveTableId: string | null; label: string; seats: number | null; fixed: boolean; placement: Placement | null }
export interface PlanJoin { id: string; seats: number; tableIds: string[] }
export interface ZonePlan { zoneId: string; revision: number; savedAt: string | null; tables: PlanTable[]; joins: PlanJoin[] }
export interface ZonePlanSave {
  revision: number; // the copy's revision; 0 when the zone had no master plan
  tables: { id?: string; liveTableId?: string; key: string; label: string; seats: number | null; fixed: boolean; placement: Placement | null }[];
  joins: { seats: number; tableKeys: string[] }[];
}
export async function readZonePlan(tx: Transaction, cfg: TillConfig, zoneId: string): Promise<ZonePlan>;
/** Every check of a save; throws the first refusal, writes nothing. */
export async function checkZonePlanSave(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, input: ZonePlanSave): Promise<void>;
```

`readZonePlan`: the zone's master tables and joins, plus the zone's active live tables that follow
no master and were never planned (`plan_table_id` null, `planned` false), offered for the editor
to adopt (`id` null, `liveTableId` set, seats from `capacity`, unplaced). A zone with no master
plan reads `revision: 0, savedAt: null` and only those (decision 16).

`checkZonePlanSave`, in order: zone exists (`zone.not_found`); `input.revision` equals the stored
revision (else `floor_plan.out_of_date`); each entry, naming the field as `tables.<index>.<name>`
or `joins.<index>.<name>` (`floor_plan.invalid`): label trimmed and non-empty, seats null or a whole
number 0–999, placement ranges as Task 1.1's checks, not both `id` and `liveTableId`, a join has
two or more distinct keys all in `tables` and seats ≥ 1; an `id` that is not a master table of
this zone, or a `liveTableId` that is not an adoptable live table of this zone, is
`table.not_found`; a duplicate label within the input, one used by a master table of another zone,
or one used by any live table of the venue that follows no master and is not adopted by this
input, is `table.label_taken { label }` (decision 8); a master table of the zone missing from the
input is a delete, and when its live table exists each removal's `refuse` is asked (bookings:
`table.booked`).

- [ ] **Step 1: Write the failing tests** (`setupPartyVenue`; its tables zone):

```ts
it("offers a zone's live tables as the first draft", async () => { /* revision 0, liveTableId set, ids null */ });
it("offers a table the old screen added to a planned zone for adoption", async () => { /* … */ });
it("refuses a save from an older copy", async () => { /* floor_plan.out_of_date */ });
it("refuses a name a master table of another zone uses, naming it", async () => { /* table.label_taken {label} */ });
it("refuses a name a live table outside the plan uses", async () => { /* … */ });
it.each([
  ["tables.0.label", { label: "  " }],
  ["tables.0.placement.rotation", { placement: { x: 0, y: 0, width: 8, height: 8, shape: "rect", rotation: 10 } }],
  ["tables.0.placement.x", { placement: { x: 1000, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } }],
  ["tables.0.seats", { seats: -1 }],
  ["tables.0.id", { id: "<a master id>", liveTableId: "<a live id>" }],
])("refuses %s", async (field, patch) => { /* floor_plan.invalid {field} */ });
it("refuses a join of one table", async () => { /* joins.0.tableKeys */ });
it("refuses deleting a table a module still needs", async () => { /* a fake TableRemoval whose refuse throws table.booked */ });
it("accepts deleting a table a party sits at", async () => { /* seat at T1; a save without T1 passes the checks */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`. Expected: cannot import.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.11: Saving the master plan

**Files:**
- Modify: `apps/server/src/floor-plan.ts`, `apps/server/src/floor-plan.test.ts`

**Interfaces:**
- Consumes: `checkZonePlanSave` (Task 1.10), `resetZone` (Task 1.8).
- Produces: `export async function saveZonePlan(tx: Transaction, cfg: TillConfig, removals: readonly TableRemoval[], zoneId: string, input: ZonePlanSave, now?: Date): Promise<{ revision: number; ids: Record<string, string> }>; // ids: key → master table id`

After `checkZonePlanSave`, write in this order: the plan's saved joins and their members are
deleted (a member row points at a master table, so a master table in a join cannot be deleted
before them — the review's probe of such a delete answered 787); deleted master tables (their live
table's `plan_table_id` set null; `planned` stays true, so the next reset removes it); master labels
in two passes, new master tables between them; seats, fixed and placement; the joins and members
inserted; `liveTableId` entries link their live table (`plan_table_id`, `planned` true); `revision`
bumped, `saved_at` set. Last: when the zone has no today's plan yet, `resetZone` (decision 16).
Nothing else live changes.

- [ ] **Step 1: Write the failing tests:**

```ts
it("saves a first plan, links the live tables and builds today's plan", async () => {
  /* save the draft with T1 placed and a new "Bar 1" fixed: revision 1; T1 follows its master;
     Bar 1 has a live row; both have today's rows */
});
it("changes nothing live when a later save moves, renames or deletes a table", async () => {
  /* after the first save: save T1 at x 30 renamed "Patio 1", Bar 1 deleted; live T1 still at x 0
     named "T1"; Bar 1 still on today's plan; after resetZone: T1 at 30 "Patio 1", Bar 1 gone */
});
it("deletes a table that is in a saved join", async () => { /* join T1+T2+T3, delete T3: the join has T1+T2 */ });
it("swaps two tables' names in one save", async () => { /* T1↔T2 */ });
it("renames T1 to T9 and adds a new T1 in one save", async () => { /* … */ });
it("writes nothing when a check refuses", async () => { /* a stale revision: the plan reads as before */ });
it("deletes a table a party sits at, and the party stays", async () => {
  /* seat at T1; save without T1: revision 2; live T1 unchanged and still seated */
});
```

- [ ] **Step 2: Run and watch it fail.** Expected: `saveZonePlan` is not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 1.12: The till catches today's plan up on every floor read and change

**Files:**
- Modify: `apps/server/src/till-api.ts` (deps type, `:231`, gains `tableRemovals?: readonly
  TableRemoval[]`, read as `deps.tableRemovals ?? []` at each call; `GET /api/tables/state`,
  `:2216`, and the seat, finish, move, join and split routes, `:2250-2379`, call `ensureToday`
  first in their transaction), `apps/server/src/boot.ts` (the till API's deps, beside
  `floorAnnotators`, `:1420`: `tableRemovals: enabledTableRemovals(setsToMigrate)`)
- Test: `apps/server/src/floor-catch-up.test.ts` (new)

**Interfaces:**
- Consumes: `ensureToday` (Tasks 1.8, 1.9); `enabledTableRemovals` (Task 1.6).

`ensureToday` resets or catches up only ACTIVE zones, so a switched-off zone's tables stay off, and
finds the zones with work due (no today's plan, an earlier business day, or a pending reset row) in
one query (amended 2026-10-10, as built in slice 1).

Catching up happens at the next floor read or change, not inside each path that frees a table
(decision 19): the till re-reads the floor after its own actions and, from slice 3, every 15
seconds, and a delivery being paid or collected frees a table without any table route running.

- [ ] **Step 1: Write the failing tests** (through the routes, as `till-api.tables.test.ts` mounts
them, with the server's real `ensureToday`):

```ts
it("brings a table back to the master on the first floor read after its party finishes", async () => {
  /* reset; seat T1; move T1 today; change T1 in the master; reset (T1 waits); finish;
     GET /api/tables/state: T1 at the master's place */
});
it("removes a table deleted from the master once its party finishes", async () => {
  /* seat T4; delete T4 from the master; reset (T4 waits, still on the map); finish; read: T4 gone */
});
it("creates a new table that was waiting for its name once the old one is free", async () => {
  /* Review focus 3: master renames "Terrace 4" (seated) to "Terrace 9" and adds a new "Terrace 4";
     reset; finish; read: "Terrace 9" and a new "Terrace 4" both on the map */
});
it("frees a table when its delivery is collected, at the next read", async () => { /* … */ });
it("resets before seating on a new business day", async () => { /* POST seat at 05:00 after a 04:00 cutover: generation went up first */ });
it("does nothing when no reset happened while the table was taken", async () => {
  /* seat, move today, finish, read: the table keeps today's place until the next reset */
});
```

- [ ] **Step 2: Run and watch them fail.** Expected: the table keeps today's place after the party.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts src/till-api.table-actions.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts`. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.13: The old floor screen cannot change a table the master owns

**Files:**
- Modify: `apps/server/src/tables.ts` (`updateTable`, `:138-186`: a name, zone or `active` change
  on a `planned` table is refused `table.in_floor_plan { tableId }`; capacity still changes),
  `apps/server/src/errors.ts`, `STATUS` (`management-api.ts:251`: `table.in_floor_plan: 409`),
  `apps/dashboard/src/i18n/codes.ts` (EN and ES: "This table is in a floor plan; change it in the
  floor plan editor.")
- Test: `apps/server/src/tables.test.ts`

(amended 2026-10-10, as built in slice 1) The same refusal covers the old screen's Disable
(`deactivateTable`) and a placement into a different zone (`setTablePlacement`); a change is refused
only when the value actually differs from the stored one, because the old screen resends the
unchanged name and zone; and in `updateTable` a missing zone answers `zone.not_found` before the
floor-plan check.

Until slice 5 removes the old screen, this keeps decision 17's promise: a reset never reverts a
change made there, and a table a reset hid cannot be switched back on behind the master's back. The
old screen still adds tables; `readZonePlan` offers them for adoption (Task 1.10).

- [ ] **Step 1: Write the failing tests**: on a planned table, renaming, moving to another zone,
and switching on or off are each refused `table.in_floor_plan`; changing capacity succeeds; on a
table never planned, all four succeed as today.
- [ ] **Step 2: Run and watch them fail.** **Step 3: Implement.** **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/tables.test.ts src/management-api.test.ts`. **Step 5: Commit.**

### Task 1.14: The master plan's dashboard routes

**Files:**
- Modify: `apps/server/src/management-api.ts` (deps type, `:167`, gains `tableRemovals?:
  readonly TableRemoval[]`, read as `deps.tableRemovals ?? []`; two routes beside the zone routes,
  `:1663-1720`; `STATUS` at `:251`: `floor_plan.out_of_date: 409`, `floor_plan.invalid: 400`,
  `table.booked: 409`), `apps/server/src/boot.ts` (the management API mount, `:1541`, passes
  `tableRemovals`), `apps/dashboard/src/api/client.ts` (types `FloorPlan`, `FloorPlanSave` mirroring
  Task 1.10's, and `getFloorPlan(zoneId)`, `saveFloorPlan(zoneId, body)`),
  `apps/dashboard/src/api/live-queries.ts` (`getFloorPlan: ["floor_plans", "floor_plan_tables",
  "floor_plan_joins", "floor_plan_join_tables", "dining_tables"]`), `apps/dashboard/src/i18n/codes.ts`
  (`floor_plan.out_of_date`, `floor_plan.invalid`, EN and ES; `table.booked`'s in bookings'
  `BOOKINGS_CODE_MESSAGES`, `packages/bookings/src/dashboard/strings.ts`)
- Test: `apps/server/src/management-api.test.ts` (a new `describe("floor plans")`), the dashboard
  client test file

**Interfaces:**
- Produces: `GET /management-api/zones/:id/floor-plan` → 200 `ZonePlan`;
  `PUT /management-api/zones/:id/floor-plan` with `ZonePlanSave` → 200 `{ revision, ids }`. Both
  through `withVenueAuth` (`venue.configure`, `management-api.ts:420`) and `requireZoneId`
  (`:339`). The body is shape-checked in the route (`management.request_invalid { field }` for a
  non-object, a non-array `tables`/`joins`, a non-string `label`/`key`, a non-boolean `fixed`), and
  value-checked by `checkZonePlanSave`.
- (amended 2026-10-10, as built in slice 1) The route checks the body's shape (`revision`, `tables`,
  `joins`, each table's `key`, `label`, `fixed`, `placement`, `id` and `liveTableId`, each join's
  `tableKeys`) before it checks permission, as its sibling routes do. A GET answer is not a valid
  save as it stands: the editor adds a `key` to each table and turns each join's `tableIds` into
  `tableKeys` first (slice 2's editor does this).

- [ ] **Step 1: Write the failing tests**: manager reads a first draft (200, revision 0); saves
(200, revision 1) and reads it back; an older copy is 409 `floor_plan.out_of_date`; a bad rotation is
400 `floor_plan.invalid {field: "tables.0.placement.rotation"}`; `tables` not an array is 400
`management.request_invalid {field: "tables"}`; a refusing removal is 409 `table.booked`; staff is
403; no session is 401; an unknown zone is 404 `zone.not_found`. Use the file's `req`,
`managerCookie`, `staffCookie` and `createZone` helpers.
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "floor plans"`. Expected: 404 for the route.
- [ ] **Step 3: Implement** the routes, the wiring, the client methods and the strings.
- [ ] **Step 4: Run** that command, `pnpm exec vitest run scripts/live-subscriptions.test.ts`, and the dashboard client test. Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.15: Today's plan in the till's table-state answer

**Files:**
- Create: `apps/server/src/floor-today-state.test.ts`
- Modify: `apps/server/src/working-order.ts` (`TableState`, `:6852`; `listTablesWithState`,
  `:6900`), `apps/till/src/api/client.ts` (`TableState`, `:1748`, gains the same field)

**Interfaces:**
- Produces — `TableState` gains:

```ts
today: {
  placement: Placement | null; // null: an unplaced spare, or taken off
  seats: number | null;
  fixed: boolean;
  takenOff: boolean;
  joinId: string | null;
  joinSeats: number | null;
} | null; // null: the table has no today's row (its zone has no master plan yet)
```

`listTablesWithState` reads today's rows and merges; it never writes (Task 1.12's route runs
`ensureToday` before it).

- [ ] **Step 1: Write the failing tests**: a zone with a master plan — each table's `today`
matches its today's row, a spare has `placement: null`, a merge's tables share `joinId`; a zone
with no master plan — `today` is null.
- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/server exec vitest run src/floor-today-state.test.ts`. Expected: `today` is undefined.
- [ ] **Step 3: Implement.** Keep `posX`… on `TableState` until slice 5.
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/server exec vitest run src/till-api.tables.test.ts src/working-order.test.ts src/till-api.profile-zones.test.ts`. Whole-shape pins of `TableState` (`toEqual`) gain the `today` key (allowed: adding a key to a whole-shape pin). Expected: pass.
- [ ] **Step 5: Commit.**

### Task 1.16: The demo seed writes master plans

**Files:**
- Modify: `apps/server/scripts/demo-seed/floor.ts` (`DEMO_TABLES`: a grid placement and `fixed`
  for bar stools beside today's permille placement), `apps/server/scripts/demo-seed/seed-floor.ts`
  (`:211-231`: after creating the tables, one `saveZonePlan` per zone from its first draft, which
  links the tables and builds today's plan), the demo seed's test
- Test: the demo seed's existing test file (find it: `git grep -l seedFloor -- '*.test.ts'`)

**Interfaces:**
- Consumes: `readZonePlan`, `saveZonePlan` (Tasks 1.10, 1.11).

The grid placement keeps the demo's layout. The old `posX`/`posY` is the table's CENTRE in
thousandths (`wt-floor-canvas.ts:276-278` draws it with `translate(-50%,-50%)`), and the new `x`/`y`
is the corner (decision 9): `x = round(posX / 1000 * 120 - width / 2)`, `y = round(posY / 1000 *
80 - height / 2)`, clamped at 0 (a 120 × 80 grid, the old canvas's 3:2), size from today's
`sizeForCapacity` equivalents (S 6 × 6, M 8 × 8, L 10 × 8, XL 14 × 8), `shape` round for `round`,
else rect. The bar seats become 2 × 2 round fixed tables.

- [ ] **Step 1: Write the failing test**: after the demo seed, every demo zone with tables has a
master plan and a today's plan, every table is placed in both, the bar stools are `fixed`, and no
two tables in one zone overlap (compare their rectangles; rotation ignored).
- [ ] **Step 2: Run and watch it fail.** Expected: no master plan.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the seed test; start the demo stack (`wa-wt demo <worktree-name>`) and
`GET /management-api/zones/<terrace>/floor-plan` once to see the seed's plan read back.
  (amended 2026-10-10, as built in slice 1) The live demo-stack check was replaced by a read-back
  with `readZonePlan` inside the seed test (`seed-floor.test.ts`), because the shared dev venue
  holds the owner's real data. The overlap check measures each table by the box around it once
  turned about its centre, not the unturned rectangle; measured that way, dining tables 5, 7 and 8
  overlapped neighbours, so their `posY` moved down slightly to clear.
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
  `saveFloorPlan`; on `floor_plan.out_of_date` a message offers to load the newer plan (nothing is
  overwritten); a zone with no master plan opens on its live tables as the draft (decision 16); a
  line under the header says the till changes at the next reset, with Reset on the till for
  sooner; `floor-plan-editor.unsaved.test.ts`.
- **Task 2.5: The side panel and Add tables** — tables list (placed greyed, tap an unplaced one to
  place it at `firstFreeSpot`), and "Add [n] tables with [s] seats": automatic naming (prefix defaulting to the zone's
  name) or custom naming,
  Fixed in place; a taken name refused beside its field (`table.label_taken`, matched by label);
  new tables arrive unplaced. A bottom sheet below 600 px wide (a `wt-*` sheet primitive if none
  exists — add it to `packages/ui` with its two tests).
- **Task 2.6: The selected table's panel** — name, seats (`wt-number-stepper`), shape, width and
  height, rotation, Fixed in place, its saved joins with Add (which tables, seats) and Remove,
  Remove from plan, Delete (it leaves the draft, and Undo brings it back; on Save a
  `table.booked` refusal names the table, beside it in the panel — decision 4).
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
- **Task 3.2: `wt-floor-map`** — draws the zone's tables from `TableState.today`, cropped to its tables with a two-square
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

- **Task 4.1: Today's writes** — in `floor-today-store.ts`, each on the table's today's row, each
  after `ensureToday(tx, cfg, removals, now)`: `moveToday`, `rotateToday`, `takeOffToday` (refused `tab.already_open`
  while held), `putBackToday`, `placeSpareToday` (an unplaced spare placed in the middle of the
  zone's current crop), `seatsToday`, `backToSaved` (the table's today's row set from its row in
  `floor_reset_tables` — what the last reset copied, not the master as it is now; hidden when that
  row says the table goes). Reset to saved plan is `resetZone` (Task 1.8).
  Moving a fixed table is refused `table.fixed`.
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
  master's saved join with exactly these tables' master tables or from the request (refused `floor_plan.invalid
  {field:"seats"}` when neither); free + free, seated + free (the party extends) and seated +
  seated (the existing combine flow); tables in zones of different service areas are refused
  `service_zone.join_mismatch` on the merge route as on the join route (`table-actions.ts:112-118`).
  Seating a party at a free merge seats it at every member (decision 18).
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
- **Task 5.2: `active`, `capacity` and `planned` go** — every live table follows a master table
  (zones still without one get one from their live tables, as decision 16's first draft); a table
  hidden by a reset (Task 1.8 sets `active` false) is known instead by having no today's row; every
  reader of `dining_tables.active` moves to that (`working-order.ts:1201`, `:7027`; `move-bill.ts:225`; `report-api.ts:170-172`;
  `tables.ts`; `venue-service/src/operations.ts:225-233`, `:254`, `:321`;
  `department-transfers.ts:414-415`; `packages/bookings/src/bookings.ts:60`); zone switch-off no
  longer switches tables off; seats are read from today's row.
- **Task 5.3: The migration** — one generation drops `capacity`, `active`, `planned`, `pos_x`,
  `pos_y`, `shape`, `rotation` and makes
  `zone_id` required (a rebuild), wrapped by custom migrations that drop and re-create
  `parties_clear_table_status` around it as `0043`/`0045` do. Before shipping: list every foreign
  key pointing at `dining_tables` (today `party_tables`, `working_orders`, `bookings`, and slice 1's
  `floor_today_tables` and `floor_today_join_tables`) and read the generated SQL; add the step's expected refusal to
  `scripts/migration-upgrade.test.ts` (as `core/0044_drop_table_bill_pointer`, `:279-282`); run
  the guards named in CLAUDE.md §3's regeneration rule. Seeds and test helpers that insert a table
  with no zone get one (`packages/reporting/test/fixtures.ts:496`, `:541`;
  `scripts/behavioural-triggers.test.ts:274`; the configuration fixture
  `apps/server/src/testing/fixtures/configuration-v1-before-printing-retirement.json:199-213`).
- **Task 5.4: Docs** — `docs/developers/design-system.md` (the editor and the map),
  `docs/developers/conventions-data.md` (the two plans, the reset and the catch-up; names copied as text; removal), the
  backlog, and CLAUDE.md if a rule was paid for.
