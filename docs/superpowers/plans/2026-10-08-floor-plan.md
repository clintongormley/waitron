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
> slice 1 has not built yet. Slice 2 was expanded on 2026-10-10, after slice 1 landed (#1493),
> and slice 3 on the same day, after slice 2 landed (#1506).
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
    preview on the zone page arrives with A366-6, not here. (Amended 2026-10-10 at slice 2's
    expansion: A366-6A, #1488, landed first and left `venue-operations-screen.ts` an 11-line shell,
    and the departments spec keeps the zone's ⋮ menu to Rename, Move and Disable, so slice 2 puts an
    "Edit floor plan" link on the zone's panel beside its Opening hours link,
    `packages/venue-service/src/dashboard/department-zones.ts:390-404`, with no "Add a floor plan"
    variant: that and the preview are A366 Part C's; slice 2 decision 17.)
13. **The till's map still re-reads rather than being pushed to**: on tab select, after its own
    actions, as today (`apps/till/src/till-app.ts:4823`), and now also every 15 seconds while a
    map is showing, so two waiters see each other's moves. A push stream like the department
    transfers' (`apps/server/src/department-transfer-api.ts:65`) is later work. (Amended
    2026-10-10 at slice 3's expansion: the tab-select read is now `till-app.ts:4979`; the 15-second
    read is the floor screen's, only for a zone on the new map, slice 3 decision 13.)
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

**Slice 3** (added at its expansion):
- The seat dialog's hint "Optional. Leave it empty if you don't know yet." / "Opcional. Déjalo
  vacío si aún no lo sabes." (`seat.guest_count_hint`, `apps/till/src/i18n/strings.ts:546`, `:1679`),
  replaced by the table's seats or "Covers" (slice 3 decision 12). No test named it at `28f150197`
  (a grep of `apps/` and `packages/` for the key and both sentences found only `strings.ts` and
  `seat-dialog.ts:151`).

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
| `packages/ui/src/history.ts` | 2 | undo/redo over draft snapshots (moved from `packages/ui-core` at slice 2's expansion, slice 2 decision 11) |
| `packages/ui/src/components/wt-floor-plan-canvas.ts` | 2 | the editor's canvas |
| `packages/ui/src/components/wt-sheet.ts` | 2 | a sheet docked at the bottom of a narrow screen |
| `apps/dashboard/src/screens/floor-plan-draft.ts` | 2 | the editor's draft: what it sends, when it changed, each edit |
| `apps/dashboard/src/screens/floor-plan-editor.ts` | 2 | the full-page editor |
| `apps/dashboard/src/screens/floor-plan-tables-panel.ts` | 2 | the tables list and Add tables |
| `apps/dashboard/src/screens/floor-plan-table-panel.ts` | 2 | the selected table's panel |
| `packages/ui/src/gestures.ts` | 3 | tap, double-tap, long-press, drag, pinch |
| `packages/ui-core/src/tokens/colors.css` | 3 | the table fill colours (added at slice 3's expansion) |
| `packages/ui/src/floor-map-fills.ts` | 3 | the map's fill and dot names and their style sheet (added at slice 3's expansion) |
| `packages/ui/src/components/wt-floor-map.ts` | 3 | the till's map |
| `apps/till/src/state/floor-map.ts` | 3 | the stand-in statuses and which tables a planned zone shows (added at slice 3's expansion) |
| `apps/till/src/widgets/table-details-sheet.ts` | 3, 4 | the long-press details sheet |
| `apps/till/src/widgets/table-status.ts` | 3 | the order screen's flash notice and status pin (added at slice 3's expansion) |
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
// The master plan — edited by the dashboard only.
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
  `delivery_table_id = null, delivery_table_label = label`. It decides nothing; `removeLiveTables` (Task 1.9) calls it
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
  `packages/bookings/src/errors.ts` (`table.booked { tableId }`; note 2026-10-10: since slice 2 it
  also carries `date` (YYYY-MM-DD) and `time` (HH:MM) of the earliest upcoming booking)
- Create: `packages/bookings/src/table-removal.ts`, `packages/bookings/src/table-removal.test.ts`
- Generated: a bookings migration (`pnpm --filter @waitron/bookings db:generate`), one `ALTER TABLE … ADD`

**Interfaces:**
- Produces:

```ts
// packages/module/src/module.ts
export interface TableRemoval {
  /** The refusal for each of `tableIds` this module still needs; a table it lets go of has no entry. A throw is not a refusal: it fails the caller, the till's floor read included. */
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
3. every `apply` whose label changes, to a spare name from `spareLabels` (the id, numbered until no
   current or final name in the location holds it) (first pass; amended 2026-10-10);
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
/** Removes the live tables for good, returning those it kept: each a module refuses, having changed nothing, and each something unknown still names, having kept its reset row and the table itself. (Amended 2026-10-10: one call for the whole list, asking the modules once.) */
export async function removeLiveTables(tx: Transaction, cfg: Pick<TillConfig, "locationId">, removals: readonly TableRemoval[], tableIds: readonly string[], now: Date): Promise<Set<string>>;
```

`tablesTied` (amended 2026-10-10: one call answers for every candidate table): a `party_tables` row of an OPEN party names the table (held, or left earlier while
the party is still open); or an order names it in `delivery_table_id` and either its `status` is
`open` or `placed`, or the floor's pending-delivery test holds — the floor's own condition,
`foodOnItsWay` (`apps/server/src/delivery-release.ts`), which both queries read (not abandoned, `collected_at` null, and a ticket item with
`made_here = 0`).

(amended 2026-10-10, as built in slice 1) `removeLiveTables` first asks every module's `refuse`; if
any refuses (bookings: an upcoming booking), it changes nothing for that table and returns it among those kept. `catchUpZone`
asks the same before planning, and treats a refused table as it treats a held one, except that it
never seeds it (the planner's `refused` flag): it waits whole, on today's plan
with its reset row pending, until the refusal clears.

`removeLiveTables`: each removal's `release`; `releaseDeliveries(tx, id, label)`; delete its
`floor_today_join_tables` row (a merge left with fewer than two members goes with its members),
its `floor_today_tables` row and its `floor_reset_tables` row; then the `dining_tables` row. A
foreign-key refusal at that last delete (rows of a module switched off since, or of a party closed
before slice 1) is caught by `isRefusal(error, FOREIGN_KEY_VIOLATION)`
(`packages/db/src/sql-state.ts:24`; every key into `dining_tables` is `no action`, which this engine
refuses with code 787 — measured twice by the plan reviews on Node v26.7.0 `node:sqlite`;
`restrictRefused` matches only 1811) and the table is returned among those kept; `catchUpZone` then hides the table and
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
number 0–999, placement ranges as Task 1.1's checks, not both `id` and `liveTableId` (unless the `liveTableId` is that master table's own live table, as
`readZonePlan` sends it; amended 2026-10-10), a join has
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
it("refuses deleting a table a module still needs", async () => { /* a fake TableRemoval whose refuse answers table.booked for the table */ });
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
} | null; // null: the table has no today's row
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

Branch `feat/floor-plan-editor`, after slice 1 (landed as #1493). Expanded to step level on
2026-10-10, unattended, and revised the same day on a fresh-context review's findings; every
`file:line` in this slice was read at `main` `29801d74a`.

What the slice builds: two pure helpers in `packages/ui` (plan geometry, an undo history), two new
primitives (`wt-floor-plan-canvas`, `wt-sheet`), and a full-page dashboard editor at
`/manage/floor-plan/zone/<zoneId>` that reads and saves through slice 1's routes
(`GET`/`PUT /management-api/zones/:id/floor-plan`, `apps/server/src/management-api.ts:1813-1835`),
opened from a link on the zone's panel on the department page. Nothing on the till changes in this
slice except what a zone's first save already does (decision 16 of the plan).

**What slice 1 built that the editor works with** (read, not run):

- `readZonePlan` answers the master tables, each with its live table (`liveTableId`), then the
  zone's active live tables that follow no master table and never did, as entries with `id: null`
  and `placement: null` (`apps/server/src/floor-plan.ts:114-174`, the adoptable ones at
  `:157-166`). So a zone with no master plan opens with every table unplaced. A join reads as
  `{ id, seats, tableIds }` with master ids (`:139-155`).
- A save is `{ revision, tables: [{ id?, liveTableId?, key, label, seats, fixed, placement }],
  joins: [{ seats, tableKeys }] }` (`floor-plan.ts:47-60`; the dashboard's copies are `FloorPlan`
  and `FloorPlanSave`, `apps/dashboard/src/api/client.ts:611-645`). The route checks the shape
  before permission (`management-api.ts:468-504`, called at `:1827`), then `checkZonePlanSave`
  (`floor-plan.ts:283-350`). A GET answer is not a valid save as it stands (Task 1.14's amendment).
- A save cannot delete a table offered for adoption: one the save leaves out stays a live table
  outside the plan, its name blocks the save's names (`floor-plan.ts:260-262`), and the next read
  offers it again (`:157-166`).
- Refusals the editor must place, with their params: `floor_plan.out_of_date { zoneId, revision }`
  (`floor-plan.ts:305-307`); `floor_plan.invalid { field }` naming `tables.<i>.<name>` or
  `joins.<i>.<name>`, `<i>` being the entry's index in the save (`:176-232`); `table.label_taken
  { label }`, the trimmed label (`:334-340`); `table.not_found { tableId }` (`:322-331`);
  `table.booked { tableId }`, where `tableId` is the deleted master table's LIVE table
  (`packages/bookings/src/table-removal.ts:29`, through `floor-plan.ts:342-348`). The dashboard's
  wording for the first three is at `apps/dashboard/src/i18n/codes.ts:509-532`, and
  `table.booked`'s at `packages/bookings/src/dashboard/strings.ts:98-101`, registered when that
  module loads (`:104-105`). A rejected dashboard request carries `{ code, params, status }`
  (`packages/dashboard-kit/src/request.ts:119-125`).
- `saveZonePlan` answers `{ revision, ids }`, `ids` mapping each key to its master id
  (`floor-plan.ts:360-466`); the dashboard client's `saveFloorPlan` and `getFloorPlan` are at
  `client.ts:2790-2803`.

### Slice 2 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review.

1. **The editor's address is `/manage/floor-plan/zone/<zoneId>`, not `/manage/floor-plan/<zoneId>`.**
   The dashboard's path codec reads each value after a label (`packages/ui/src/url-state.ts:58-76`,
   labels per screen in `apps/dashboard/src/navigation.ts:3-27`), so a bare id after the screen is
   never read. A `back` query names the page Close returns to.
2. **Close goes to `back` when it is a `/manage/` path on this origin, else to `/manage`.** Close is
   a link, so the dashboard's own link handling (`apps/dashboard/src/dashboard-app.ts:1541-1571`)
   takes it through the leave question. The editor is core code and never names a module's screen;
   the department page passes its own address as `back` (Task 2.7).
3. **Keys.** A master table's key is its id; an adoptable live table's is `live:<liveTableId>`; a
   new table's is `new:<n>`, `n` counting from 1 per editor visit. A saved join's draft key is its
   id, a new one's `join:<n>`. The save sends `id` only for an entry that has a master id and
   `liveTableId` only for an adoptable one (the server also accepts a master entry carrying its own
   live table, `floor-plan.ts:313-317`, but nothing needs it), and each join's `tableKeys` through
   the same keys.
4. **A successful save marks what was sent as saved at once, and keeps what was edited since.** The
   editor re-keys the sent draft from the answer's `ids` (key → master id; an adopted table keeps its
   `liveTableId`) and commits it as the saved state; it re-keys the current draft the same way,
   which keeps an edit made while the save was pending, and resets Undo and Redo to it, because the
   old keys are gone; Save stays active when the current draft differs from what was sent. The
   selection and a field's refusal are re-keyed too, and the answer's `revision` is taken. Only then
   does it read the plan again, to refresh; the read replaces the draft only while nothing has
   changed since the save. A failed read is shown as a read's failure, not a failed save (CLAUDE.md
   §3): the next change or Save clears it, and it never replaces an action's message. A later Save
   sends master ids, never `new:` or `live:` keys again.
5. **On `floor_plan.out_of_date`** the code's sentence shows with a "Load newer plan" button;
   pressing it replaces the draft with a fresh read and empties Undo and Redo, writing nothing. The
   press is the person's choice to drop their draft, so it does not ask again. Save stays enabled.
   _Note 2026-10-10: the button shipped as "Reload" / "Recargar", to match the English code
   sentence; this plan's later mentions of "Load newer plan" mean it._
6. **`table.booked` names a table the draft has deleted, so there is no field to put it beside.** The
   message is "<name>: <the code's sentence>", the name taken from the plan as opened (matched by
   `liveTableId`). Undo brings the table back. This replaces the task list's "beside it in the panel".
   Owner 2026-10-10: replaced — the table comes back as last saved, outlined, with 'Booked 12 Oct,
   21:00' beside it and in the tables list; no message above the buttons.
7. **A refusal that names a table selects it.** `table.label_taken { label }` selects the draft table
   whose trimmed name is that label; `floor_plan.invalid { field: "tables.<i>.<name>" }` selects the
   table whose key is `tables[i].key` in the body that was SENT (not the draft's `<i>`th table at
   answer time, which may have changed); when the draft no longer has that key, nothing is selected
   and the refusal's own sentence shows. When the panel shows the field named (`label`, `seats`,
   `fixed`, `placement.shape`, `placement.width`, `placement.height`, `placement.rotation`), the
   sentence goes under it and the generic "Correct the highlighted fields to continue."
   (`form.fix_fields`, `apps/dashboard/src/i18n/strings.ts:592`) above the buttons; for a field it
   does not show (`placement.x`, `id`, `key` …) the table is still selected and the refusal's own
   sentence goes above the buttons. A `joins.<i>.…` refusal, and any other, shows its own sentence
   above the buttons and selects nothing. It clears at the next change to that field or the next
   Save. The editor's own checks at Save — every name non-empty once trimmed, and unique in the
   draft — mark a field the same way and keep Save disabled until fixed (design-system.md → Forms).
   At phone width a refusal that selects a table also opens the sheet (decision 13).
8. **Names used elsewhere.** The editor reads the venue's tables once when it opens
   (`listTables({ includeDisabled: true })`, `client.ts:2806`) and counts as taken, for Add tables'
   check and its automatic numbering, every name of a table in another zone, and of a switched-off
   table in this zone that no draft table follows (`liveTableId`). The server blocks this zone's
   never-planned tables a save does not adopt (`floor-plan.ts:260-262`); the dashboard's table list
   does not say which tables were ever planned (`client.ts:586-597`), so a switched-off table
   waiting for its removal is counted too, which only ever refuses more. A master name of another
   zone that is not yet on today's plan is caught by the server at Save (decision 7).
9. **The editor reads its plan on opening, after a save, on Load newer plan and when its address
   names another zone; it subscribes to no live updates.** `getFloorPlan`'s live-query entry
   (`apps/dashboard/src/api/live-queries.ts:324-330`) stays unused in this slice; another person's
   save reaches the editor as `floor_plan.out_of_date`. The zone's name comes from `listZones()`
   (`client.ts:2775-2777`), which lists active zones only; for a zone it does not list the heading
   is "Floor plan".
10. **Undo covers every change since the editor opened or last saved, with no limit.** This departs
    from spec §4's "every change since the editor opened": a save gives new tables their master ids
    and adopts live tables, so a step from before it would bring back keys the server no longer
    knows (decision 4). Typing into one field of one table is one step: the history merges
    consecutive pushes that carry the same merge key.
11. **The undo history lives in `packages/ui/src/history.ts`, not `packages/ui-core`.**
    `@waitron/ui-core` is the account-controls package shared with Waitron Cloud
    (`packages/ui-core/README.md:1-6`); `packages/ui` is mutation-tested at the same bar of 90. The
    file map is amended to match.
12. **The editor draws one grid square as 12 CSS pixels** (`GRID_SQUARE_PX`). The grid fills the
    visible area and reaches at least 8 squares past the furthest table right and down. Names hide
    below 28 px as decision 11 says, in the editor too (a 2 × 2 stool is 24 px); every table keeps
    its name as its accessible name, and the tables list is the tap-sized way to select a table drawn
    smaller than `--wt-tap-min`.
13. **The side panel sits beside the canvas while the editor is 600 px wide or more; below that it
    is a new `wt-sheet` docked at the bottom.** No sheet primitive exists (`packages/ui/src/components/`
    holds none). Collapsed, the sheet shows its heading (the selected table's name, else "Tables");
    expanded, its content scrolls within 60% of the viewport's height. Slice 3's details sheet may
    reuse it.
14. **Add tables opens in a `wt-modal` with 1 table, 4 seats, automatic naming with the zone's name
    as the prefix, and Fixed in place off.** Add is enabled at open, as Duplicate is
    (`saveActionState(…, { savableAtOpen: true })`, `apps/dashboard/src/screens/canvas-editor-screen.ts:1059`).
    1 to 100 tables at once. The list sorts names with numbers in numeric order ("Terrace 2" before
    "Terrace 10"). The editor's strings are its own keys, not the old floor screen's, which slice 5
    removes.
15. **Placing an unplaced table puts it at `firstFreeSpot` as an 8 × 8 rectangle, not rotated**
    (decision 9's new-table size, fixed or not). Remove from plan forgets its place and size.
16. **The line under the header** says when the till's TABLES follow, not where they are drawn (the
    till draws today's places only from slice 3): before a zone's first save, "Your first save
    updates the till's tables. After that, saved changes wait for the next business day."; after,
    "Saved changes reach the till's tables when the next business day starts." (owner 2026-10-10:
    now "Your first save goes live now; later changes, tomorrow." and "Your changes will go live
    tomorrow.", the owner's 2026-10-10 overrides, built as an extra task after 2.5b.) A table a party sits
    at waits for its tab to close either way (the plan's decision 3). The task list's "with Reset on
    the till for sooner" names a till button slice 4 builds; Task 4.5 adds those words when it does
    (noted there).
17. **The entry point is a link on the zone's panel, beside its Opening hours link, labelled "Edit
    floor plan" for every active zone, and it reads nothing.** The departments spec keeps the zone's
    ⋮ menu to Rename, Move and Disable and puts "Edit floor plan" on the zone
    (`docs/superpowers/specs/2026-10-07-service-times-departments-and-stations-design.md:267-271`),
    and A366 slice 6's plan says A429's Task 2.7 adds it to the zone panel
    (`docs/superpowers/plans/2026-10-08-a366-slice-6-departments.md:203-207`). The panel draws that
    block only for an active zone (`packages/venue-service/src/dashboard/department-zones.ts:390-404`).
    "Add a floor plan" for a zone with no tables, and the preview, are A366 Part C's (Task C1),
    which reads the plan for the preview anyway; a fixed label here saves a read on every zone
    shown. The module checks no permission: a module's dashboard context carries none
    (`packages/dashboard-kit/src/contract.ts:14-17`); the Departments screen needs
    `venue_service.manage`, granted from manager up (`packages/venue-service/src/permissions.ts:5-7`),
    and the role map gives `venue.configure` to manager and admin (`packages/identity/src/permissions.ts:55-80`,
    read, not run); the editor screen and its routes check `venue.configure` themselves. This
    replaces the task list's "hide it otherwise".
18. **The header's Close, Undo, Redo and Save sit in a `wt-form-actions`, whose `error` carries the
    editor's one message**, so it shows on its own line above the buttons. That is the Forms rule's
    "bottom message", at the top here because the editor's Save is in its header (spec §4).
19. **The look pass (Task 2.8) photographs the editor from a Vitest browser file that is never
    committed**, with fixture plans, not from a dev stack: the shared dev venue holds the owner's
    real data (Task 1.16's amendment).
20. **A table offered for adoption has no Delete**, only Remove from plan when placed: a save cannot
    delete it (see "What slice 1 built"), so Delete would vanish from the draft and come back at the
    next read. Removing it stays a job for the old floor screen until slice 5.

**Mutation runs.** `packages/ui`'s floor of 90 bites only in the weekly run
(`docs/developers/ci-and-gates.md:323`), so each task that adds a `packages/ui` file runs Stryker on
that file once, as one bounded step: `gtimeout 900 pnpm --filter @waitron/ui exec stryker run
--mutate <file>`. Read the score it prints for the file (at least 90; a surviving mutant gets an
exact-value assertion, not an exclude). If it cannot start under the browser setup or runs out of
time, try nothing else: say so in the commit message, and the weekly run is the check.

### Task 2.1: Plan geometry

**Files:**
- Create: `packages/ui/src/floor-plan-geometry.ts`, `packages/ui/src/floor-plan-geometry.test.ts`
- Modify: `packages/ui/src/index.ts` (export the module beside the floor exports, `:46-73`)

`@waitron/ui` already exports a `Placement` type, the old permille one (`packages/ui/src/index.ts:66`,
from `floor.ts`), so the grid placement here is `PlanPlacement`, the same shape as the dashboard
client's `PlanPlacement` (`apps/dashboard/src/api/client.ts:599-609`). Every test in `packages/ui`
runs in real Chromium (`packages/ui/vitest.config.ts`, `browser.enabled: true`); there is no Node
project, so "node tests" in the earlier task list meant pure tests.

**Interfaces:**
- Produces:

```ts
export const GRID_SQUARE_PX = 12;          // slice 2 decision 12
export const NEW_TABLE_SIZE = 8;           // decision 9
export const NAME_MIN_PX = 28;             // decision 11
export type PlanShape = "rect" | "round";
export interface PlanPlacement { x: number; y: number; width: number; height: number; shape: PlanShape; rotation: number }
/** An axis-aligned box in grid squares; may be fractional and, for a crop, negative. */
export interface PlanRect { x: number; y: number; width: number; height: number }
export function snapToSquare(px: number, squarePx?: number): number;      // Math.round(px / squarePx)
export function clampToGrid(value: number): number;                       // whole, 0–999
export function rotationFromAngle(degrees: number): number;                // nearest 15, 0–345
// Note 2026-10-10: removed in slice 2's finish; the canvas uses floor.ts's snapRotation.
export function rotatedRect(p: PlanPlacement): PlanRect;                   // box around the table turned about its centre
export function bounds(placements: readonly PlanPlacement[]): PlanRect | null;
export function cropToTables(placements: readonly PlanPlacement[], margin?: number): PlanRect | null; // margin 2, not clamped at 0
export function fitScale(crop: PlanRect, viewport: { width: number; height: number }): number;       // px per square
export function gridExtent(placements: readonly PlanPlacement[], visible: { columns: number; rows: number }, margin?: number): { columns: number; rows: number }; // margin 8
export function firstFreeSpot(placed: readonly PlanPlacement[], size?: { width: number; height: number }, columns?: number): { x: number; y: number }; // size 8 × 8, columns 40
export function showsName(p: Pick<PlanPlacement, "width" | "height">, squarePx: number): boolean;      // shorter side × squarePx ≥ 28
export function automaticNames(prefix: string, existing: Iterable<string>, count: number): string[];
```

`rotatedRect` swaps width and height exactly at 90° and 270° and keeps them at 0° and 180° (no
trigonometry there: `Math.cos(Math.PI / 2)` is not 0, so a turned 8 × 4 would come out 4.000…01
wide); other angles use `|cos|` and `|sin|`. `firstFreeSpot` scans rows from `y = 0` down and, in
each row, `x` from 0 to `max(columns, ceil(bounds.right)) - size.width`; a spot is free when the
candidate, grown by one square on every side, overlaps no placed table's `rotatedRect`. Two boxes
overlap when each starts more than `1e-9` before the other ends, so touching edges, and edges a
rounding error apart, do not overlap. Below every table a spot is always free. `automaticNames`
trims the prefix; a label counts when it is exactly the prefix, one space and digits (an empty
prefix: digits alone), compared character for character as the server compares names
(`floor-plan.ts:278-282`); it numbers on from the highest such number.

- [ ] **Step 1: Write the failing tests** in `floor-plan-geometry.test.ts`. Every case asserts exact
  values (`toEqual`, not `toBeCloseTo`, except the 45° case), because `packages/ui` is
  mutation-tested and a loose assertion lets mutants live:

```ts
it("snaps pixels to the nearest whole square", () => { /* 17 → 1, 18 → 2, -7 → -1, with squarePx 12; 25 with squarePx 10 → 3 (2.5 rounds up) */ });
it("clamps a coordinate to 0–999 in whole squares", () => { /* -3 → 0, 1000 → 999, 12.4 → 12, 0 → 0, 999 → 999 */ });
it("turns an angle into a 15° step from 0 to 345", () => { /* 7 → 0, 8 → 15, 90 → 90, -10 → 345, 352 → 345, 353 → 0, 720 → 0 */ });
it("leaves an unturned table's box as it is", () => { /* x 10 y 5 w 8 h 4 rot 0 → { x: 10, y: 5, width: 8, height: 4 } */ });
it("turns a table about its centre, exactly at right angles", () => {
  /* x 10 y 10 w 8 h 4: rot 90 → { x: 12, y: 8, width: 4, height: 8 }; rot 270 → the same; rot 180 → { x: 10, y: 10, width: 8, height: 4 } (toEqual) */
});
it("boxes a table turned 45° around its corners", () => { /* x 0 y 0 w 8 h 4 rot 45: width and height 12·√2/2 ≈ 8.4853 (toBeCloseTo 4 places); centre stays at (4, 2) */ });
it("bounds nothing as null and several tables as their union", () => { /* [] → null; (0,0,8,8) and (20,10,4,4) → { x: 0, y: 0, width: 24, height: 14 } */ });
it("crops to the tables with a two-square margin, below 0 when a table touches the edge", () => { /* one table x 10 y 5 w 8 h 4 → { x: 8, y: 3, width: 12, height: 8 }; at (0,0,8,8) → { x: -2, y: -2, width: 12, height: 12 }; [] → null */ });
it("crops a rotated table by its turned box", () => { /* x 10 y 10 w 8 h 4 rot 90 → { x: 10, y: 6, width: 8, height: 12 } */ });
it("fits a crop to the space by its tighter side", () => { /* crop 12 × 8 in 600 × 300 → 37.5; in 600 × 800 → 50 */ });
it("keeps the grid the visible size with no tables, and 8 squares past the furthest table", () => {
  /* [] with visible 50 × 30 → 50 × 30; a table at x 200 y 3 w 8 h 4 → { columns: 216, rows: 30 };
     a table at x 0 y 40 w 8 h 4 → { columns: 50, rows: 52 } */
});
it("finds the top-left spot of an empty plan", () => { /* [] → { x: 0, y: 0 } */ });
it("leaves a one-square gap beside a table", () => { /* (0,0,8,8) → { x: 9, y: 0 } */ });
it("moves to the next free row when a row is full", () => { /* (0,0,40,8) → { x: 0, y: 9 } */ });
it("avoids a turned table's whole box", () => {
  /* (0,0,8,2) rot 90 occupies x 3–5, y -3–5 → { x: 6, y: 0 } (its unturned box would give 9); the same at rot 270 → { x: 6, y: 0 } */
});
it("treats a spot exactly a gap away as free", () => { /* (0,0,8,8) rot 180 → { x: 9, y: 0 }, the same as unturned */ });
it("shows a name at 28 px and hides it below", () => { /* 2 × 2 at 14 px → true; at 13.9 → false; 2 × 9 at 12 → false (shorter side 24 px); 3 × 3 at 12 → true */ });
it("numbers on from the highest name with the prefix", () => {
  /* ("Terrace", ["Terrace 1", "Terrace 5", "Terrace bar 3", "Terraces 9", "terrace 7"], 3)
     → ["Terrace 6", "Terrace 7", "Terrace 8"] */
});
it("starts at 1 when no name has the prefix, and trims the prefix", () => { /* (" Bar ", ["T1"], 2) → ["Bar 1", "Bar 2"] */ });
it("reads a leading zero as its number", () => { /* ("Terrace", ["Terrace 05"], 1) → ["Terrace 6"] */ });
it("numbers bare digits when the prefix is empty", () => { /* ("", ["4", "T1", "12a"], 2) → ["5", "6"] */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/floor-plan-geometry.test.ts`.
  Expected: the test file fails to load, because `./floor-plan-geometry.js` does not exist.
- [ ] **Step 3: Implement** the module and its export. No DOM: these are plain functions.
- [ ] **Step 4: Run** the same command (expected: PASS, read the `Tests` count); then
  `pnpm --filter @waitron/ui typecheck`, `pnpm --filter @waitron/ui lint` and
  `pnpm exec prettier --check packages/ui/src/floor-plan-geometry.ts packages/ui/src/floor-plan-geometry.test.ts packages/ui/src/index.ts`.
- [ ] **Step 5: Mutation** — the bounded run under "Mutation runs" above, on
  `src/floor-plan-geometry.ts`.
- [ ] **Step 6: Commit** — `git commit -s`, e.g. "Floor plan editor: grid geometry — snapping,
  turned boxes, crop and fit, free spots and automatic names (A429 slice 2)".

### Task 2.2: Undo and redo

**Files:**
- Create: `packages/ui/src/history.ts`, `packages/ui/src/history.test.ts`
- Modify: `packages/ui/src/index.ts` (export `UndoHistory`)

Named `UndoHistory`, not `History`, which is the DOM's type for `window.history`. Snapshots are
stored as given; the editor passes immutable values, so nothing is copied here.

**Interfaces:**
- Produces:

```ts
export class UndoHistory<T> {
  constructor(initial: T);
  get current(): T;
  get canUndo(): boolean;
  get canRedo(): boolean;
  /** Makes `state` current and empties Redo. When `mergeKey` equals the previous push's, and no
   * undo, redo or reset came between, `state` replaces the current one instead of adding a step. */
  push(state: T, mergeKey?: string): void;
  /** The new current state, or undefined (and nothing changes) when there is nothing to undo. */
  undo(): T | undefined;
  redo(): T | undefined;
  /** One state, no Undo, no Redo. */
  reset(state: T): void;
}
```

- [ ] **Step 1: Write the failing tests** in `history.test.ts`:

```ts
it("starts with its first state and nothing to undo or redo", () => { /* current "a"; canUndo false; canRedo false; undo() undefined; redo() undefined; current still "a" */ });
it("undoes and redoes in order", () => { /* push b, push c; undo → "b"; undo → "a"; undo → undefined, current "a", canUndo false; redo → "b"; redo → "c"; canRedo false */ });
it("a new push after Undo empties Redo", () => { /* push b; undo; push c: canRedo false; undo → "a" */ });
it("merges pushes that carry the same key", () => { /* push(b, "label:t1"); push(c, "label:t1"): current "c"; undo → "a" */ });
it("does not merge different keys, or a push with no key", () => { /* push(b, "k"); push(c, "x"); undo → "b". push(d); push(e): undo → "d" */ });
it("does not merge across an undo", () => { /* push(b, "k"); undo; push(c, "k"); undo → "a" (a wrong merge would replace "a" and leave nothing to undo) */ });
it("does not merge across a redo or a reset", () => { /* push(b, "k"); undo; redo; push(c, "k"); undo → "b". reset("z"); push(y, "k"); undo → "z" */ });
it("resets to one state", () => { /* push b, push c, undo; reset("z"): current "z", canUndo false, canRedo false */ });
it("keeps every step", () => { /* 500 pushes of 1…500 on 0; 500 undos reach 0; the 501st answers undefined */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/history.test.ts`.
  Expected: the file fails to load; `./history.js` does not exist.
- [ ] **Step 3: Implement** two arrays (past, future) and the last merge key, cleared by `undo`,
  `redo` and `reset`.
- [ ] **Step 4: Run** the same command (PASS, read the count); typecheck, lint and `prettier --check`
  on the three files as in Task 2.1.
- [ ] **Step 5: Mutation** — the bounded run on `src/history.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: an undo history that keeps every step and merges
  typing (A429 slice 2)".

### Task 2.3a: The canvas — drawing and selecting

**Files:**
- Create: `packages/ui/src/components/wt-floor-plan-canvas.ts`,
  `packages/ui/src/components/wt-floor-plan-canvas.test.ts`,
  `packages/ui/src/components/wt-floor-plan-canvas.a11y.test.ts`
- Modify: `packages/ui/src/index.ts` (export the class and its types), `packages/ui/demo/main.ts`
  (the workbench), `docs/developers/design-system.md` (a row in the primitives table, `:534-563`,
  and a short paragraph: what it draws, its three events, that names hide below 28 px)

**Interfaces:**
- Consumes: Task 2.1's `PlanPlacement`, `GRID_SQUARE_PX`, `gridExtent`, `showsName`.
- Produces:

```ts
export interface PlanCanvasTable { key: string; label: string; fixed: boolean; placement: PlanPlacement }
export interface FloorPlanCanvasCopy { label: string; fixed: string; rotate: string } // rotate: "Rotate {name}"
export interface TableSelect { key: string | null }
export interface TableMove { key: string; x: number; y: number }      // Task 2.3b
export interface TableRotate { key: string; rotation: number }         // Task 2.3b
@customElement("wt-floor-plan-canvas")
export class WtFloorPlanCanvas extends LitElement {
  @property({ attribute: false }) tables: PlanCanvasTable[] = [];   // placed tables only
  @property() selected: string | null = null;
  @property({ attribute: false }) copy: Partial<FloorPlanCanvasCopy> = {}; // English defaults "Floor plan", "Fixed", "Rotate {name}"
}
// Events, each a CustomEvent named as below, carrying `detail`, bubbles: true, composed: true:
// wt-table-select (TableSelect), wt-table-move (TableMove, Task 2.3b), wt-table-rotate (TableRotate, Task 2.3b)
```

Behaviour: a scrolling viewport (`part="viewport"`) holds the grid (`part="grid"`), sized
`gridExtent(placements, visible) × GRID_SQUARE_PX`, where `visible` is the viewport's size in whole
squares rounded up (a `ResizeObserver`); its lines are a background drawn from `--wt-color-border`.
Each table is a `<button type="button" part="table">` positioned at `x × 12`, `y × 12`, sized
`width × 12` by `height × 12`, turned with `rotate(<rotation>deg)` about its centre; round tables
get `border-radius: 50%`, rectangles `--wt-radius-sm`. Its background reads
`--wt-color-surface-lifted`, its border `--wt-color-border`, a selected table's border
`--wt-color-primary`, and `aria-pressed` says which is selected. Its accessible name is its label,
plus ", Fixed" (`copy.fixed`) for a fixed table, which also draws a corner marker
(`part="fixed-marker"`). The visible name shows only when `showsName(placement, 12)`. The tables sit
in a `role="group"` named `copy.label`. A click on a table stops the click and sends
`wt-table-select { key }`; a click on empty grid sends `{ key: null }`. Selection is the parent's
to keep: the canvas sends, the parent sets `selected`. The canvas reflects no `disabled`, and its
tables are drawn at the plan's true size, below `--wt-tap-min` when small (slice 2 decision 12).

- [ ] **Step 1: Write the failing tests.** Mount with `mount`/`mountInShadowRoot` from
  `packages/ui/src/test-helpers.ts:11-48`; a token test as `wt-choice-row.test.ts:56-69` does (set
  the token on `host`, read the computed style); the a11y file as
  `wt-floor-canvas.a11y.test.ts:1-71` does, with `mountThemed` and `expectNoA11yViolations` in
  both themes.

```ts
// wt-floor-plan-canvas.test.ts
it("draws each table at its grid place and size", async () => { /* t1 at x 2 y 3 w 8 h 4: offset from the grid's corner 24, 36 px; 96 × 48 px */ });
it("turns a table about its centre", async () => { /* rotation 90: transform matrix of rotate(90deg); transform-origin "48px 24px" */ });
it("draws a round table as a circle when its sides match", async () => { /* round 8 × 8: border-radius 50%; rect: border-radius equals --wt-radius-sm */ });
it("marks a fixed table and says so in its name", async () => { /* fixed t2: fixed-marker present; aria-label "T2, Fixed"; t1: no marker, aria-label "T1" */ });
it("hides a name drawn under 28 px and keeps it as the accessible name", async () => { /* 2 × 2 "Bar 1": no visible text; aria-label "Bar 1"; 3 × 3: text "Bar 1" shows */ });
it("fills the visible area with grid when there are no tables", async () => { /* host 600 × 360 px: grid 600 × 360 */ });
it("draws 8 squares past the furthest table", async () => { /* host 600 px wide, a table at x 100 w 8: grid 1392 px wide */ });
it("a click on a table asks to select it and stops the click", async () => {
  /* mountInShadowRoot; document listener gets wt-table-select { key: "t1" }, bubbles, composed;
     a click listener on the shadow host's parent sees no click */
});
it("a click on empty grid asks to clear the selection", async () => { /* detail { key: null } */ });
it("Enter on a focused table selects it", async () => { /* focus t1's button; userEvent.keyboard("{Enter}") → { key: "t1" } */ });
it("draws the selected table as pressed", async () => { /* selected "t1": aria-pressed "true" on t1, "false" on t2 */ });
it("paints from tokens", async () => {
  /* host sets --wt-color-surface-lifted rgb(1, 2, 3) → table background; --wt-color-primary
     rgb(4, 5, 6) → the selected table's border colour; --wt-color-border rgb(7, 8, 9) appears in
     the grid's computed background-image */
});
it("names the group from its copy", async () => { /* copy { label: "Plano" } → role group named "Plano" */ });

// wt-floor-plan-canvas.a11y.test.ts — describe.each(["light", "dark"])
test("no tables", …); test("tables, none selected", …); test("a table selected, one fixed, one too small for its name", …);
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-plan-canvas.test.ts src/components/wt-floor-plan-canvas.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement** (design-system.md → "Adding a primitive", `:2995-3023`: `baseStyles`
  first, `delegatesFocus`, tokens only), add it to the workbench and the primitives table. Before
  trusting the a11y test, remove the tables' `aria-label` and watch it fail, then restore it.
- [ ] **Step 4: Run** the same command and then `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`
  (it finds new components itself), `pnpm exec vitest run scripts/style-token-names.test.ts`,
  typecheck, lint and `prettier --check` on the changed files. Expected: all pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-plan-canvas.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: a canvas primitive that draws the plan's tables
  on a grid and selects them (A429 slice 2)".

### Task 2.3b: The canvas — dragging, nudging, turning and growing

**Files:**
- Modify: `packages/ui/src/components/wt-floor-plan-canvas.ts`, its `.test.ts` and `.a11y.test.ts`,
  the design-system paragraph from Task 2.3a

**Interfaces:**
- Consumes: Task 2.1's `snapToSquare`, `clampToGrid`, `rotationFromAngle`, `gridExtent`.
- Produces: the `wt-table-move` and `wt-table-rotate` events (Task 2.3a's types).

Behaviour: pointerdown on a table starts a drag owned by that pointer (listeners on `window`, as
`wt-floor-canvas.ts:385-434` does); while it moves, the table is drawn at
`clampToGrid(start + snapToSquare(pointer delta))` on each axis, and the grid's extent is worked out
from that drawn place, so the grid grows as the table goes right or down. Release sends one
`wt-table-move { key, x, y }` when the place changed, and nothing when it did not. A pointer cancel
puts the table back and sends nothing; a second pointer is ignored during a drag. Fixed tables move
in the editor like any other (fixed is about today's plan). The arrow keys on a focused table send a
move of one square (prevented and stopped), and nothing at an edge. The selected table shows a
rotation handle (`part="rotate-handle"`, a `<button>` at least `--wt-tap-min` square, named
`copy.rotate` with the table's name), drawn as a SIBLING of the table's `<button>` — a button inside
a button is invalid HTML — and placed above the table's top edge; dragging it sends, on release,
`wt-table-rotate { key, rotation: rotationFromAngle(angle) }`, the angle measured clockwise from
straight up around the table's centre (`atan2(dx, -dy)`); ArrowRight and ArrowLeft on the handle
send ±15, wrapping at 0 and 345.

- [ ] **Step 1: Write the failing tests**, with pointer events dispatched as
  `wt-floor-canvas.test.ts:456-476` does (down on the token, move and up on `window`, one
  `pointerId`) and keys pressed with `userEvent.keyboard` on a focused button:

```ts
it("a drag snaps to whole squares and moves on release", async () => {
  /* t1 at (2, 3): down, move by (+30, +13) px, up → one wt-table-move { key: "t1", x: 5, y: 4 } (30/12 = 2.5 rounds to 3) */
});
it("draws the table where the drag has it before release", async () => { /* after the move, before up: t1's left offset 60 px, top 48 px; no event yet */ });
it("a drag past the top or left edge stops at 0", async () => { /* move by (-100, -100) → { x: 0, y: 0 } */ });
it("a drag that ends where it began sends nothing", async () => { /* move by (+5, +5) px → no wt-table-move */ });
it("the grid grows while a table is dragged right and down", async () => { /* host 600 px; drag t1 by +1440 px → before release the grid is (122 + 8 + 8) × 12 = 1656 px wide */ });
it("a pointer cancel puts the table back and sends nothing", async () => { /* … t1 back at 24, 36 px */ });
it("a second pointer cannot take over a drag", async () => { /* down id 1, down id 2 on t2, move id 2: t2 does not move; up id 1 moves t1 */ });
it("the arrow keys move a focused table one square", async () => { /* t1 (2, 3): ArrowRight → (3, 3); ArrowLeft → (1, 3); ArrowDown → (2, 4); ArrowUp → (2, 2); each keydown defaultPrevented */ });
it("an arrow key at an edge sends nothing", async () => { /* table at (0, 0): ArrowLeft and ArrowUp → no event; at (999, 999): ArrowRight and ArrowDown → none */ });
it("other keys do nothing", async () => { /* "a" → no event, not prevented */ });
it("shows the rotation handle on the selected table only, beside its button", async () => {
  /* selected "t1": one handle, named "Rotate T1", not inside t1's button (button.contains(handle) false); copy.rotate "Girar {name}" → "Girar T1" */
});
it("dragging the handle turns the table in 15° steps", async () => {
  /* release right of the centre → rotation 90; below → 180; at 50° from up → 45; left → 270 */
});
it("the arrow keys on the handle turn by 15° and wrap", async () => { /* rotation 0: ArrowRight → 15, ArrowLeft → 345; rotation 345: ArrowRight → 0 */ });
it("each event bubbles out of a shadow root", async () => { /* mountInShadowRoot; document hears wt-table-move and wt-table-rotate with their details */ });
// a11y file: add "a selected table with its rotation handle" in both themes
```

- [ ] **Step 2: Run and watch them fail** — the Task 2.3a command. Expected: the new cases fail (no
  move or rotate event is sent; no handle is drawn); the 2.3a cases still pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Task 2.3a command, then the same guards as in Task 2.3a. Expected: all pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-plan-canvas.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor plan editor: drag a table to the grid, nudge it with the
  arrow keys and turn it with a handle (A429 slice 2)".

### Task 2.4a: The editor's draft

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-draft.ts`,
  `apps/dashboard/src/screens/floor-plan-draft.test.ts`

Pure functions over the editor's draft; every edit returns a new draft and leaves its input
unchanged, so Task 2.2's history can keep each one.

**Interfaces:**
- Consumes: `FloorPlan`, `FloorPlanSave`, `PlanPlacement` (`apps/dashboard/src/api/client.ts:599-645`);
  `firstFreeSpot`, `NEW_TABLE_SIZE` (Task 2.1).
- Produces:

```ts
export interface DraftTable { key: string; id: string | null; liveTableId: string | null; label: string; seats: number | null; fixed: boolean; placement: PlanPlacement | null }
export interface DraftJoin { key: string; seats: number; tableKeys: string[] }
export interface FloorPlanDraft { tables: DraftTable[]; joins: DraftJoin[] }
export function draftFromPlan(plan: FloorPlan): FloorPlanDraft;                      // keys per slice 2 decision 3
export function saveFromDraft(revision: number, draft: FloorPlanDraft): FloorPlanSave;
/** After a save: each key the answer names becomes that master id, as key and id (decision 4). */
export function rekeyDraft(draft: FloorPlanDraft, ids: Readonly<Record<string, string>>): FloorPlanDraft;
/** Same tables by key with the same values, and the same joins as sets of members with their seats. */
export function sameDraft(a: FloorPlanDraft, b: FloorPlanDraft): boolean;
export function checkDraft(draft: FloorPlanDraft): { key: string; problem: "label_missing" | "label_repeated" } | null;
export function isAdoptable(table: DraftTable): boolean;                                                // id null and liveTableId set (decision 20)
export function patchTable(draft: FloorPlanDraft, key: string, patch: Partial<Pick<DraftTable, "label" | "seats" | "fixed" | "placement">>): FloorPlanDraft;
export function moveTable(draft: FloorPlanDraft, key: string, x: number, y: number): FloorPlanDraft;   // keeps size, shape and rotation; an unplaced table: unchanged
export function rotateTable(draft: FloorPlanDraft, key: string, rotation: number): FloorPlanDraft;
export function placeTable(draft: FloorPlanDraft, key: string): FloorPlanDraft;                         // slice 2 decision 15
export function deleteTable(draft: FloorPlanDraft, key: string): FloorPlanDraft;                        // also from every join; a join left with fewer than 2 goes; an adoptable table: unchanged
export function addTables(draft: FloorPlanDraft, tables: { label: string; seats: number | null; fixed: boolean }[], nextKey: () => string): FloorPlanDraft; // appended, unplaced
export function addJoin(draft: FloorPlanDraft, tableKeys: string[], seats: number, key: string): FloorPlanDraft;
export function removeJoin(draft: FloorPlanDraft, joinKey: string): FloorPlanDraft;
```

- [ ] **Step 1: Write the failing tests** (fixture: master `m1` "T1" placed at (2, 3) 8 × 8 rect
  with live `l1`, master `m2` "T2" unplaced with live `l2`, adoptable `{ id: null, liveTableId: "l9",
  label: "T9" }`, join `j1` of `m1`, `m2` seats 6, revision 3):

```ts
it("keys master tables by id, adoptable ones by their live table, joins by id", () => {
  /* keys ["m1", "m2", "live:l9"]; T9 has id null, liveTableId "l9"; joins [{ key: "j1", seats: 6, tableKeys: ["m1", "m2"] }] */
});
it("sends a save with a key per table and each join as keys", () => {
  /* saveFromDraft(3, draft) toEqual { revision: 3, tables: [{ id: "m1", key: "m1", … }, { id: "m2", key: "m2", … },
     { liveTableId: "l9", key: "live:l9", label: "T9", … }], joins: [{ seats: 6, tableKeys: ["m1", "m2"] }] };
     "liveTableId" in the m1 entry is false; "id" in the l9 entry is false */
});
it("sends a new table with neither id nor live table", () => { /* after addTables: { key: "new:1", label, seats, fixed, placement: null }, no id key, no liveTableId key */ });
it("re-keys a saved draft from the answer's ids", () => {
  /* add "T5" (new:1), join m1 + new:1 as join:1; rekeyDraft(d, { m1: "m1", m2: "m2", "live:l9": "m9", "new:1": "m5" }) →
     T9 { key: "m9", id: "m9", liveTableId: "l9" }; T5 { key: "m5", id: "m5", liveTableId: null }; join:1's tableKeys ["m1", "m5"];
     saveFromDraft of it sends { id: "m9", key: "m9", … } with no liveTableId and { id: "m5", key: "m5", … } */
});
it("counts a draft moved and moved back as unchanged", () => { /* sameDraft(open, moveTable(moveTable(open, "m1", 5, 4), "m1", 2, 3)) true */ });
it("counts a seat, a name, a turn or Fixed as a change", () => { /* each patch → false */ });
it("compares joins as sets", () => { /* j1 with tableKeys ["m2", "m1"] → true; seats 7 → false; a join removed → false */ });
it("counts a deleted table added back as new as a change", () => { /* delete m1, add "T1" with the same values: key "new:1" → false */ });
it("finds an empty or repeated name, first in table order", () => {
  /* T2 "  " → { key: "m2", problem: "label_missing" }; T9 " T1 " → { key: "live:l9", problem: "label_repeated" }; fine → null */
});
it("moves a placed table and keeps its size, shape and turn", () => { /* moveTable(m1, 5, 4) → { x: 5, y: 4, width: 8, height: 8, shape: "rect", rotation: 0 }; input draft unchanged */ });
it("leaves an unplaced table where it is when asked to move it", () => { /* moveTable(m2, 5, 4) → same draft value */ });
it("places a table at the first free spot as an 8 × 8 rectangle", () => { /* placeTable(m2) → m2.placement { x: 11, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 } (m1 spans x 2–10) */ });
it("deletes a table from its joins, and a join left with one table goes", () => {
  /* join m1+m2+new:1: delete new:1 → join m1+m2; join m1+m2: delete m2 → no joins */
});
it("does not delete a table offered for adoption", () => { /* isAdoptable(T9) true, isAdoptable(T1) false; deleteTable(d, "live:l9") → same draft value */ });
it("adds tables unplaced with fresh keys", () => { /* nextKey yields new:1, new:2 → two tables, placement null, id null, liveTableId null, in that order after T9 */ });
it("adds and removes a join", () => { /* addJoin(["m1", "live:l9"], 4, "join:1"); removeJoin("j1") → joins [{ key: "join:1", seats: 4, tableKeys: ["m1", "live:l9"] }] */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-draft.test.ts`.
  Expected: the file fails to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command (PASS, read the count); `pnpm --filter @waitron/dashboard typecheck`,
  `pnpm --filter @waitron/dashboard lint`, `prettier --check` on the two files.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the draft — what it sends, how a save re-keys it,
  when it has changed, and each edit (A429 slice 2)".

### Task 2.4b: The editor page — opening, editing and undo

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-editor.ts` (`dashboard-floor-plan-editor`),
  `apps/dashboard/src/screens/floor-plan-editor.test.ts`,
  `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`
- Modify: `apps/dashboard/src/navigation.ts` — `"floor-plan": { zone: "zone" }` in `children`
  (`:6-27`), which the page needs to read its zone; `apps/dashboard/src/navigation.test.ts` (one
  case); `apps/dashboard/src/i18n/strings.ts` (EN and ES)

**Interfaces:**
- Consumes: `getFloorPlan`, `listZones`, `listTables` (`client.ts:2790`, `:2775`, `:2806`);
  `UndoHistory` (Task 2.2); `wt-floor-plan-canvas` (Tasks 2.3a, 2.3b); Task 2.4a's functions;
  `draftScopeFor`, `saveActionState` (`packages/ui/src/leave-controller.ts:115-147`);
  `UrlStateController` with `dashboardPath`.
- Produces: the page, and the contract its panels use (Tasks 2.5b, 2.5c, 2.6a, 2.6b) — they
  dispatch, bubbling and composed:

```ts
// floor-plan-change: { draft: FloorPlanDraft; mergeKey?: string } — the page pushes it onto its history
// floor-plan-select: { key: string | null }
```

Behaviour: the page reads `zone` from its URL and `back` from the query (slice 2 decisions 1, 2),
then loads the plan, the zone list and the table list; a load failure shows the code's sentence
(`codeMessage(codeOf(error))`) in place of the canvas, with Close. It keeps an
`UndoHistory<FloorPlanDraft>` and the opened draft. Its draft scope is taken in `willUpdate` while
`isConnected` and the plan has loaded, as `canvas-editor-screen.ts:314-337` takes one
(`equal: sameDraft`, `restore` resets the history to the restored draft and clears the selection),
disposed on disconnect, with `requestUpdate()` on reconnect. When its URL controller reports
another zone (the dashboard asks about unsaved changes before the address changes, Task 2.4c), it
disposes the scope, clears the draft, the history and the selection, and loads the new zone; an
answer for the old zone that arrives later is dropped. The heading is the zone's name (decision 9).
The header's `wt-form-actions` holds Close (an `<a href=${back}>` drawn like a secondary button, as
`wt-row-actions.ts:50-78` draws a slotted link), Undo and Redo (secondary, disabled while there is
nothing to undo or redo) and Save (`saveActionState`; this task gives Save its look only, and Task
2.4d its handler). Under the header, decision 16's line. The canvas gets the draft's placed tables
and the selection; `wt-table-move` and `wt-table-rotate` push `moveTable` and `rotateTable`;
`wt-table-select` sets the selection. Undo or Redo that removes the selected table clears the
selection. Strings (EN / ES): `floor_plan_editor.title` "Floor plan" / "Plano de sala";
`floor_plan_editor.undo` "Undo" / "Deshacer"; `floor_plan_editor.redo` "Redo" / "Rehacer";
`floor_plan_editor.first_note` "Your first save updates the till's tables. After that, saved
changes wait for the next business day." / "El primer guardado actualiza las mesas de la caja.
Después, los cambios guardados esperan al siguiente día de actividad."; `floor_plan_editor.note`
"Saved changes reach the till's tables when the next business day starts." / "Los cambios
guardados llegan a las mesas de la caja al empezar el siguiente día de actividad." (owner
2026-10-10: now "Your first save goes live now; later changes, tomorrow." / "Tu primer guardado se
aplica ya; los cambios posteriores, mañana." and "Your changes will go live tomorrow." / "Tus
cambios se aplicarán mañana.", the owner's 2026-10-10 overrides, built as an extra task after 2.5b); Close and Save
reuse `action.close` and `action.save` (`strings.ts:475`, `:548`).

- [ ] **Step 1: Write the failing tests.** Mount with `mountWidget` and a stubbed API, the URL set
  first with `history.replaceState`. A change of address is driven as the dashboard's URL
  controller hears one with no guard installed: `history.pushState` then a `popstate` event
  (`packages/ui/src/navigation-guard.ts:49-60`).

```ts
// floor-plan-editor.test.ts
it("opens the zone the URL names, headed with its name", async () => { /* getFloorPlan("z1"); h1 "Terrace" */ });
it("heads a zone the zone list lacks as Floor plan", async () => { /* listZones → [] → h1 "Floor plan" */ });
it("draws placed tables and leaves unplaced ones off the canvas", async () => { /* canvas.tables keys ["m1"] */ });
it("says what a first save does, and when a saved plan's changes reach the till", async () => { /* revision 0 → first_note text; revision 3 → note text */ });
it("a move from the canvas changes the draft and wakes Save", async () => { /* dispatch wt-table-move { key: "m1", x: 5, y: 4 } from the canvas → canvas.tables[0].placement.x 5; Save variant "primary", enabled */ });
it("Undo puts the move back and quiets Save; Redo brings it back", async () => { /* Undo → x 2, Save "secondary" and disabled, Redo enabled; Redo → x 5, Save "primary" */ });
it("a change after Undo empties Redo", async () => { /* move, Undo, rotate → Redo disabled */ });
it("a turn from the canvas turns the table", async () => { /* wt-table-rotate { key: "m1", rotation: 90 } → placement.rotation 90 */ });
it("selecting a table is not a change", async () => { /* wt-table-select { key: "m1" } → canvas.selected "m1"; Save quiet; Undo disabled */ });
it("takes a panel's change and merges typing", async () => {
  /* dispatch floor-plan-change { draft: patchTable(d, "m1", { label: "T1a" }), mergeKey: "label:m1" } then
     { label: "T1ab" } with the same key; one Undo → label "T1" */
});
it("Undo that removes the selected table clears the selection", async () => { /* select a table added by a floor-plan-change; Undo → canvas.selected null */ });
it("another zone in the address loads that zone afresh", async () => {
  /* move m1, select it; pushState /manage/floor-plan/zone/z2 + popstate → getFloorPlan("z2"); h1 "Bar"; canvas.selected null; Undo disabled; Save quiet */
});
it("a late answer for the zone it left is dropped", async () => { /* z1's read deferred; move to z2 (answers); resolve z1's: h1 still "Bar", canvas shows z2's tables */ });
it("a load failure shows its sentence and no canvas", async () => { /* getFloorPlan rejects { code: "zone.not_found" } → "That zone no longer exists"; no wt-floor-plan-canvas */ });
it("Close links to the way back, or to /manage when it is not a dashboard path", async () => { /* back "/manage/overview" → href "/manage/overview"; back "https://evil.example/" → "/manage"; no back → "/manage" */ });

// navigation.test.ts, as :93-103
it("reads the floor plan editor's zone from its path", () => { /* /manage/floor-plan/zone/z1 → read("zone") "z1" */ });

// floor-plan-editor.a11y.test.ts — describe.each(["light", "dark"]): a loaded plan; a table selected; a load failure
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts src/navigation.test.ts`.
  Expected: the two new files fail to load; the navigation case fails (`read("zone")` is null).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`,
  the dashboard's typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the page opens a zone's plan and moves and turns
  tables with Undo and Redo (A429 slice 2)".

### Task 2.4c: The editor in the dashboard — its screen and leaving it

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-editor.unsaved.test.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` — import beside `canvas-editor-screen.js` (`:70`);
  `"floor-plan"` in `CORE_SCREENS` (`:98-130`); `{ screen: "floor-plan", requiresPermission:
  "venue.configure" }` in `UNLISTED_SCREENS` (`:243-247`); `fill` for `"floor-plan"` as for the
  catalogue (`:1406`; the `.body.fill` rule is at `:596-600`); a `case "floor-plan"` in
  `#renderScreen` beside `case "canvas-editor"` (`:2016-2019`).
  `apps/dashboard/src/dashboard-app.test.ts` (one case). `apps/dashboard/src/screens/floor-plan-editor.ts`
  only if a leave case below finds a fault.

**Interfaces:**
- Consumes: Task 2.4b's page.
- Produces: the screen `floor-plan`, open to a session holding `venue.configure`.

The leave cases mount the whole `dashboard-app` as
`apps/dashboard/src/dashboard-app.backup-unsaved.test.ts:13-60` does, at
`/manage/floor-plan/zone/z1?back=%2Fmanage%2Foverview`, with `venue.configure`, and use an `unload()`
helper as `canvas-editor-screen.unsaved.test.ts:95-99` does.

- [ ] **Step 1: Write the failing tests:**

```ts
// dashboard-app.test.ts, as the "/manage/email" case at :2918-2938
it.each([["manager", "dashboard-floor-plan-editor"], ["supervisor", "dashboard-overview-screen"]])("opens the floor plan editor at /manage/floor-plan/zone/z1 as %s, only with venue.configure", …);

// floor-plan-editor.unsaved.test.ts (whole app)
it("an untouched editor closes without asking", async () => { /* click Close → pathname "/manage/overview"; no question */ });
it("Close asks after a move, and Keep stays with the move", async () => { /* pathname unchanged; m1 still at x 5 */ });
it("Discard on Close leaves and writes nothing", async () => { /* pathname "/manage/overview"; saveFloorPlan not called */ });
it("undoing every change closes without asking", async () => { /* move, Undo, Close → no question */ });
it("a sidebar link asks before leaving a changed plan", async () => { /* … */ });
it("opening another zone's editor asks first, and Discard opens it fresh", async () => {
  /* move; navigationGuardFor(window)!.write(new URL("/manage/floor-plan/zone/z2", location.origin)) → question; Discard → getFloorPlan("z2"); Undo disabled */
});
it("the browser's unload prompt holds a changed plan", async () => { /* unload() true after a move; false after Undo */ });
it("put back after a detached update, the editor still asks before Close discards a change", async () => {
  /* reattachAfterDetachedUpdate(editor) (apps/dashboard/src/widgets/test-helpers.ts:88-97), then move, then Close → question
     — #1422's reconnect case, modelled on recipe-screen.unsaved.test.ts:397-407 */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.unsaved.test.ts src/dashboard-app.test.ts -t "floor plan"`.
  Expected: the path opens the overview, so every case fails.
- [ ] **Step 3: Implement** the registration. With the reconnect case passing, delete the
  `isConnected` check in the page's `willUpdate` and watch that case fail, then restore it.
- [ ] **Step 4: Run** the same command without `-t`, plus `src/screens/floor-plan-editor.test.ts`,
  the dashboard's typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: a dashboard screen for managers that asks before
  leaving unsaved changes (A429 slice 2)".

### Task 2.4d: Saving, and the newer plan

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
  (EN and ES), `apps/dashboard/src/screens/floor-plan-editor.unsaved.test.ts`,
  `apps/dashboard/src/screens/floor-plan-editor.a11y.test.ts`,
  `docs/developers/design-system.md` (name the editor in the Forms list of pages that follow the
  save rule, `:1759`)
- Create: `apps/dashboard/src/screens/floor-plan-editor.save.test.ts`

**Interfaces:**
- Consumes: `saveFloorPlan` (`client.ts:2795-2803`); `saveFromDraft`, `rekeyDraft` (Task 2.4a).
- Produces, for Task 2.4e: the body last sent (`sent: FloorPlanSave | null`) and the page's one
  message slot, which remembers whether a read or an action set it.

Behaviour: Save returns at once while `saveActionState(scope).unchanged` or while saving (Task 2.4e
adds the editor's own checks before sending). Otherwise it keeps the draft and the body it sends,
`saveFromDraft(revision, draft)`, and sends it. Editing stays open while the save is pending. On
success (decision 4): the saved state is `rekeyDraft(sentDraft, ids)` and is committed as the
scope's baseline; the current draft becomes `rekeyDraft(currentDraft, ids)` and the history is reset
to it, so an edit made while the save was pending is kept and Save stays active when the current
draft differs from what was sent; the selection, and Task 2.4e's `fieldError.key`, are mapped
through `ids` too (a selected `new:1` becomes its master id); `revision` becomes the answer's. Then a
re-read, whose answer replaces the draft only while the scope is not dirty. On
`floor_plan.out_of_date`: decision 5. Any other refusal is Task 2.4e's. A save's answer that arrives
after the page has left, or after another load began, is ignored (a request counter, as
`canvas-editor-screen.ts:832-871` keeps).

The header's message slot (decision 18) carries both a read's failure and an action's, and
remembers which one set it (CLAUDE.md §3; `docs/developers/dashboard-live-updates.md`): a failed
re-read shows its sentence as a read's message, which the next change or the next Save clears; a
read's failure never replaces an action's message; and a read's success clears only a read's
message. Save stays quiet after a failed re-read, since the write succeeded.

New strings: `floor_plan_editor.load_newer` "Load newer plan" / "Cargar el plano más reciente". (Note 2026-10-10: shipped as `floor_plan_editor.reload`, "Reload" / "Recargar", in Task 2.8's look pass.)

- [ ] **Step 1: Write the failing tests** in `floor-plan-editor.save.test.ts` (Task 2.4a's fixture
  plan; a change is made by dispatching `floor-plan-change` from inside the page):

```ts
it("a press that reaches an untouched Save's handler sends nothing and shows nothing", async () => { /* host .click() on Save, as canvas-editor-screen.save-state.test.ts:172-180 */ });
it("Save sends the draft with a key per table and joins as keys", async () => {
  /* move m1 to (5, 4); Save → saveFloorPlan("z1", saveFromDraft(3, the moved draft)) toEqual, with tables[0].placement.x 5 and joins [{ seats: 6, tableKeys: ["m1", "m2"] }] */
});
it("a save marks the sent draft saved at once and reads the plan again", async () => {
  /* answer { revision: 4, ids: { m1: "m1", m2: "m2", "live:l9": "m9" } }; the re-read deferred: Save "secondary", disabled; Undo disabled;
     then the re-read answers: getFloorPlan called twice */
});
it("an edit made while the save is pending is kept, and Save stays active", async () => {
  /* move m1 to (5, 4); Save (deferred); move m1 to (7, 4); the save answers: m1 at x 7; Save "primary" and enabled; Undo disabled;
     Close asks (the scope is dirty against the sent draft) */
});
it("a selected new table keeps its selection under its master id", async () => {
  /* add "T5" (new:1), select it; Save answers ids { …, "new:1": "m5" } → canvas.selected "m5" */
});
it("a failed re-read after a save shows as a read's failure, and the next Save sends master ids", async () => {
  /* add "T5" (new:1); save answers { revision: 4, ids: { …, "live:l9": "m9", "new:1": "m5" } }; the re-read rejects { code: "server.internal" }:
     message "Something went wrong, try again"; Save quiet. Move m5 → the message goes; Save → body revision 4, tables include
     { id: "m5", key: "m5", … } and { id: "m9", key: "m9", … }; no key starts with "new:" or "live:" */
});
it("a read's failure does not replace an action's message", async () => {
  /* a save refused { code: "server.internal" } shows its sentence; a later Load newer plan read that fails leaves the action's sentence in place */
});
it("a re-read answer does not replace a draft changed since the save", async () => { /* re-read deferred; move m1 to x 7; re-read answers x 5: m1 stays at 7, Save loud */ });
it("a save in progress keeps a second press from sending", async () => { /* deferred save; two presses; one call */ });
it("an older copy offers the newer plan, keeping Save available", async () => {
  /* reject { code: "floor_plan.out_of_date", params: { zoneId: "z1", revision: 4 } } → message "Someone else changed this floor plan. Reload it and try again";
     Load newer plan shown; Save enabled */
});
it("Load newer plan replaces the draft and writes nothing", async () => { /* second read has m1 at x 7 → canvas m1 x 7; Save quiet; Undo disabled; saveFloorPlan called once */ });
// floor-plan-editor.unsaved.test.ts (whole app):
it("a departed save's answer cannot change a reconnected editor", async () => {
  /* as recipe-screen.unsaved.test.ts:408 on: deferred save; remove and re-add the editor; resolve; Save still "primary"; the question still opens on Close */
});
it("an accepted save leaves without asking", async () => { /* move, Save, Close → no question */ });
// a11y file: add "an older copy's message with Load newer plan" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.save.test.ts src/screens/floor-plan-editor.unsaved.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new cases fail (Save sends nothing).
- [ ] **Step 3: Implement**, and add the editor to design-system.md's Forms list.
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts`, the dashboard's
  typecheck and lint, and `prettier --check` on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: Save sends the plan, keeps edits made while it
  was sending, and offers the newer plan when someone else saved first (A429 slice 2)".

### Task 2.4e: Placing a refusal, and the editor's own name checks

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts`, `apps/dashboard/src/i18n/strings.ts`
  (EN and ES)
- Create: `apps/dashboard/src/screens/floor-plan-editor.refusals.test.ts`

**Interfaces:**
- Consumes: Task 2.4d's `sent` body and message slot; `checkDraft` (Task 2.4a).
- (Note 2026-10-10: the panel takes a list, `fieldErrors`, one per refused field, since slice 2's finish.)
- Produces, for Task 2.6a's panel: the page's `fieldError: { key: string; field: "label" | "seats" |
  "fixed" | "width" | "height" | "shape" | "rotation"; message: string } | null` (a server field
  `tables.<i>.placement.width` becomes `width`, and so on).

Behaviour: before sending, if `checkDraft` fails, the page selects the table, sets `fieldError` on
`label` ("Enter a name." / "Escribe un nombre." for `label_missing`; `table.label_taken`'s sentence
for `label_repeated`) and the generic sentence above the buttons, and sends nothing; Save then stays
disabled while `checkDraft` still fails. On a refusal from the server: decisions 6 and 7,
`tables.<i>` read through Task 2.4d's `sent` body; a `table.label_taken` whose label no draft table
carries, and any refusal not named there, shows its own sentence above the buttons. These are
action messages (Task 2.4d's slot). New strings: `floor_plan_editor.name_missing` "Enter a name." /
"Escribe un nombre."; `floor_plan_editor.booked` "{name}: {message}" (both languages). (Owner
2026-10-10: a `table.booked` refusal now puts the table back, marked, with no message above the
buttons, and the string is now "Booked {date}, {time}" / "Reservada el {date}, {time}" (the owner's
2026-10-10 overrides, built as an extra task after 2.5b).)

- [ ] **Step 1: Write the failing tests** in `floor-plan-editor.refusals.test.ts` (Task 2.4a's
  fixture plan; changes by dispatching `floor-plan-change`). The file imports
  `@waitron/dashboard-modules`, as `apps/dashboard/src/dashboard-app.test.ts` does, so that bookings'
  code sentences, `table.booked`'s among them, are registered
  (`packages/bookings/src/dashboard/strings.ts:104-105`):

```ts
it("a taken name selects its table and shows the generic sentence", async () => {
  /* rename m2 to "Patio 1"; reject { code: "table.label_taken", params: { label: "Patio 1" } } → canvas.selected "m2";
     page fieldError { key: "m2", field: "label", message: "A table with that name already exists" }; message "Correct the highlighted fields to continue."; Save enabled */
});
it("an invalid field selects the table that was sent at its index", async () => {
  /* save deferred (sent tables: m1, m2, live:l9); meanwhile a floor-plan-change deletes m1, so the draft's index 1 is now live:l9;
     reject { code: "floor_plan.invalid", params: { field: "tables.1.seats" } } → selected "m2" (sent tables[1]), fieldError.field "seats" */
});
it("an invalid field of a table deleted since sending selects nothing", async () => {
  /* add "T5" (new:1, sent at index 3); save deferred; delete new:1; reject field "tables.3.label" → no selection; message "Check the floor plan's tables and try again" */
});
it("an invalid field the panel does not show selects the table and shows the refusal's own sentence", async () => { /* field "tables.0.placement.x" → selected "m1"; fieldError null; message "Check the floor plan's tables and try again" */ });
it("a refusal about a join selects nothing and shows its own sentence", async () => { /* field "joins.0.tableKeys" → selection unchanged; message "Check the floor plan's tables and try again" */ });
// Note 2026-10-10: stale — decision 6's owner replacement (the table comes back marked, no message) applies.
it("a booked table the draft deleted is named, and Undo brings it back", async () => {
  /* delete m2; reject { code: "table.booked", params: { tableId: "l2" } } → message "T2: This table has an upcoming booking. Move the booking first"; Undo → m2 back */
});
it("a failure with no field shows the server's sentence and leaves Save enabled", async () => { /* reject { code: "server.internal" } */ });
it("an empty name stops the save, selects its table and keeps Save disabled until fixed", async () => {
  /* m2 label "  "; Save → no call; selected "m2"; fieldError { field: "label", message: "Enter a name." }; Save disabled;
     label "T2b" → Save enabled; fieldError null */
});
it("a repeated name stops the save the same way", async () => { /* l9 renamed "T1" → selected "live:l9"; message under label "A table with that name already exists" */ });
it("the next change to the refused field clears its sentence", async () => { /* after the taken-name refusal, rename m2 → fieldError null; the generic sentence goes */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.refusals.test.ts`.
  Expected: the file's cases fail (a refusal selects nothing and marks no field).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.save.test.ts` and
  `src/screens/floor-plan-editor.test.ts`, the dashboard's typecheck and lint, and `prettier --check`
  on the changed files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: each refusal points at its table, and a missing
  or repeated name stops Save (A429 slice 2)".

### Task 2.5a: `wt-sheet`

**Files:**
- Create: `packages/ui/src/components/wt-sheet.ts`, `packages/ui/src/components/wt-sheet.test.ts`,
  `packages/ui/src/components/wt-sheet.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts`, `docs/developers/design-system.md`
  (primitives table, `:534-563`, and a short paragraph)

**Interfaces:**
- Produces:

```ts
@customElement("wt-sheet")
export class WtSheet extends LitElement {
  @property() heading = "";
  @property({ type: Boolean, reflect: true }) expanded = false;
}
// Event wt-sheet-toggle: { expanded: boolean }, bubbles: true, composed: true; the toggle's click is stopped.
```

Behaviour: a block with a top border (`--wt-color-border`) and the surface colour
(`--wt-color-surface`). Its toggle (`part="toggle"`, a `<button>` at least `--wt-tap-min` tall,
`aria-expanded`, `aria-controls` naming the body) shows the heading; pressing it flips `expanded`
and sends `wt-sheet-toggle`. The body (`part="body"`, default slot) is hidden while collapsed;
expanded, it scrolls within `60dvh`. Where it docks is its parent's choice. Every spacing reads a
`--wt-space-*` token.

- [ ] **Step 1: Write the failing tests:**

```ts
it("shows only its heading while collapsed", async () => { /* slotted text not visible; toggle text "Tables"; aria-expanded "false" */ });
it("pressing the toggle opens it and tells the page", async () => {
  /* mountInShadowRoot; document hears wt-sheet-toggle { expanded: true }; host.expanded true; aria-expanded "true"; a click listener on the host's parent sees no click */
});
it("pressing it again closes it", async () => { /* { expanded: false } */ });
it("the page can open it", async () => { /* el.expanded = true → body visible; attribute "expanded" reflected */ });
it("names the body it controls", async () => { /* toggle's aria-controls equals the body's id */ });
it("scrolls a long body within 60% of the viewport's height", async () => { /* page.viewport(390, 800); 2000 px of content → body clientHeight 480; scrollHeight > clientHeight */ });
it("its toggle is at least the tap size", async () => { /* toggle height ≥ 44 px (--wt-tap-min) */ });
it("paints from tokens", async () => { /* host sets --wt-color-surface rgb(1, 2, 3) → background; --wt-color-border rgb(4, 5, 6) → top border colour */ });
// a11y file — describe.each(["light", "dark"]): collapsed; expanded with content
```

- [ ] **Step 2: Run and watch it fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-sheet.test.ts src/components/wt-sheet.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement**; break the toggle's name on purpose and watch the a11y test fail, then
  restore it.
- [ ] **Step 4: Run** the same command, `src/no-hardcoded-chrome.test.ts`, `scripts/style-token-names.test.ts`,
  typecheck, lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-sheet.ts`.
- [ ] **Step 6: Commit** — e.g. "A sheet primitive that docks at the bottom of a phone screen and
  opens from its heading (A429 slice 2)".

### Task 2.5b: The tables list, tap to place, and the sheet on a phone

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-tables-panel.ts` (`floor-plan-tables-panel`),
  `apps/dashboard/src/screens/floor-plan-tables-panel.test.ts`
- Modify: `apps/dashboard/src/screens/floor-plan-editor.ts` (the panel beside the canvas at 600 px
  and over, inside a `wt-sheet` below, decided from the page's own width with a `ResizeObserver`),
  `floor-plan-editor.test.ts`, `floor-plan-editor.refusals.test.ts`, `floor-plan-editor.a11y.test.ts`,
  `apps/dashboard/src/i18n/strings.ts`

**Interfaces:**
- Consumes: Task 2.4a's `placeTable`; `wt-sheet` (Task 2.5a); `wt-button`.
- Produces:

```ts
@customElement("floor-plan-tables-panel")
export class FloorPlanTablesPanel extends LitElement {
  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() selected: string | null = null;
  @property() zoneName = "";                                                        // Task 2.5c
  @property({ attribute: false }) takenElsewhere: ReadonlySet<string> = new Set(); // Task 2.5c, slice 2 decision 8
  @property({ attribute: false }) nextKey!: () => string;                          // Task 2.5c, the page's new:<n>
}
// sends floor-plan-change and floor-plan-select (Task 2.4b's contract)
```

Behaviour: a heading "Tables", then each draft table as a row button, sorted with numbers in order
(`Intl.Collator(locale, { numeric: true })`), a placed table's row drawn muted and marked
`data-placed`. Pressing an unplaced table sends `placeTable` and selects it; pressing a placed one
selects it. Below 600 px the page puts the panel in a `wt-sheet` whose heading is the selected
table's name, else "Tables"; a refusal that selects a table (Task 2.4e) also expands the sheet.
Strings (EN / ES): `floor_plan_editor.tables` "Tables" / "Mesas".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-tables-panel.test.ts — draft: m1 "Terrace 1" placed (0, 0) 8 × 8, m2 "Terrace 10" unplaced, m3 "Terrace 2" unplaced, "Terrace bar 3" unplaced
it("lists the tables in numeric order, placed ones muted", async () => { /* rows "Terrace 1", "Terrace 2", "Terrace 10", "Terrace bar 3"; data-placed only on Terrace 1 */ });
it("pressing an unplaced table places it at the first free spot and selects it", async () => {
  /* floor-plan-change: m3.placement { x: 9, y: 0, width: 8, height: 8, shape: "rect", rotation: 0 }; floor-plan-select { key: "m3" } */
});
it("pressing a placed table selects it and changes nothing", async () => { /* select { key: "m1" }; no change event */ });

// floor-plan-editor.test.ts
it("puts the panel beside the canvas at 1280 px and in a collapsed sheet at 390 px", async () => {
  /* page.viewport(1280, 800): aside holds floor-plan-tables-panel, no wt-sheet; page.viewport(390, 844): wt-sheet holds it, expanded false, heading "Tables"; restore the viewport */
});
it("the sheet's heading names the selected table", async () => { /* select m1 → heading "T1" */ });
// floor-plan-editor.refusals.test.ts
it("at 390 px a refusal that selects a table opens the sheet", async () => { /* table.label_taken for m2 → wt-sheet expanded true */ });
// floor-plan-editor.a11y.test.ts: add "the tables list" and "the sheet collapsed and expanded at 390 px", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-tables-panel.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the page's new cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, the dashboard's typecheck and lint, `prettier --check`.
  Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the tables list, tap to place, and a bottom sheet
  on a phone (A429 slice 2)".

### Task 2.5c: Add tables

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-tables-panel.ts`,
  `floor-plan-tables-panel.test.ts`, `floor-plan-editor.ts` (passes `zoneName`, `takenElsewhere`,
  `nextKey`), `floor-plan-editor.a11y.test.ts`, `apps/dashboard/src/i18n/strings.ts`
- Create: `apps/dashboard/src/screens/floor-plan-tables-panel.unsaved.test.ts`

**Interfaces:**
- Consumes: Task 2.4a's `addTables`; Task 2.1's `automaticNames`; `wt-modal`, `wt-number-stepper`,
  `wt-combobox`, `wt-input`, `wt-switch`, `wt-form-actions`.

Behaviour: "Add tables" opens a `wt-modal` (decision 14) with: Tables (`wt-number-stepper`,
`name="table-count"`, 1–100, required), Seats (`wt-number-stepper`, `name="seats"`, 0–999,
clearable, empty meaning none), Names (`wt-combobox`, `name="naming"`, Automatic or Custom, no
search), then for Automatic a Prefix (`wt-input`, `name="prefix"`, the zone's name to start, its
hint the names it will give: "Terrace 11" for one table, "Terrace 11 to Terrace 15" for more), for
Custom one `wt-input` per table (`name="table-name"`, required), and Fixed in place (`wt-switch`,
`name="fixed"`). Add checks each custom name: empty is "Enter a name.", and one repeated in the
batch, already in the draft, or in `takenElsewhere` is `table.label_taken`'s sentence, beside its
field, with the generic sentence in the dialog's `wt-form-actions`; Add then stays disabled until
they are fixed. Automatic names count the draft's names and `takenElsewhere` as used. Add sends
`addTables` and closes; Cancel and Escape add nothing. The dialog's input is its own draft scope,
child of the page's (`savableAtOpen: true`). The page builds `takenElsewhere` from its table list
as decision 8 says. Strings (EN / ES), all `floor_plan_editor.*`: "Add tables" / "Añadir mesas";
"Number of tables" / "Número de mesas"; "Seats" / "Plazas" (its own key, decision 14); "Names" /
"Nombres"; "Automatic" / "Automáticos"; "Custom" / "Personalizados"; "Prefix" / "Prefijo"; "{first}
to {last}" / "De {first} a {last}"; "Name {n}" / "Nombre {n}"; "Fixed in place" / "Fija en su sitio".

- [ ] **Step 1: Write the failing tests** (Task 2.5b's draft, zone "Terrace"):

```ts
// floor-plan-tables-panel.test.ts
it("Add tables opens with one table, four seats and the zone's name as prefix", async () => { /* count "1", seats "4", naming "automatic", prefix "Terrace", hint "Terrace 11", Add primary and enabled */ });
it("the hint gives the first and last names for more than one table", async () => { /* count 5 → "Terrace 11 to Terrace 15" */ });
it("automatic names number on from the highest with the prefix", async () => {
  /* count 3 → added labels "Terrace 11", "Terrace 12", "Terrace 13", seats 4, fixed false, placement null, keys new:1–3 */
});
it("a name used in another zone counts for the numbering", async () => { /* takenElsewhere {"Terrace 40"} → "Terrace 41" */ });
it("custom naming shows one name field per table", async () => { /* count 3, Custom → three wt-input name="table-name", labelled "Name 1"–"Name 3" */ });
it("a custom name in use is refused beside its field", async () => {
  /* names "Patio 1", "Terrace 2" → second field's error "A table with that name already exists"; form message "Correct the highlighted fields to continue."; no change event; Add disabled;
     second name "Patio 2" → error gone, Add enabled */
});
it("a custom name used in another zone, or twice in the batch, is refused the same way", async () => { /* … */ });
it("an empty custom name asks for a name", async () => { /* "Enter a name." */ });
it("Fixed in place adds fixed tables", async () => { /* fixed true on every added table */ });
it("an empty seat count adds tables with no seats", async () => { /* seats null */ });
it("Cancel adds nothing", async () => { /* no change event */ });
// floor-plan-editor.test.ts
it("counts this zone's switched-off tables no draft table follows as taken", async () => {
  /* listTables answers { id: "l7", label: "Terrace 30", zoneId: "z1", active: false } → Add tables' hint "Terrace 31" */
});

// floor-plan-tables-panel.unsaved.test.ts — inside a LeaveController test app, as canvas-editor-screen.unsaved.test.ts:31-44
it("an untouched Add tables closes on Escape without asking", async () => { /* … */ });
it("typed custom names ask before Escape, and Keep keeps them", async () => { /* … */ });
it("a changed count asks before Cancel, and Discard closes without adding", async () => { /* … */ });

// floor-plan-editor.a11y.test.ts: add "Add tables open, automatic" and "Add tables open, custom, with a refused name", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-tables-panel.test.ts src/screens/floor-plan-tables-panel.unsaved.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the new cases fail (no Add tables).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `scripts/native-form-fields.test.ts`, the dashboard's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: Add tables with automatic or custom names
  (A429 slice 2)".

### Task 2.6a: The selected table's panel — its fields, Place, Remove from plan and Delete

**Files:**
- Create: `apps/dashboard/src/screens/floor-plan-table-panel.ts` (`floor-plan-table-panel`),
  `apps/dashboard/src/screens/floor-plan-table-panel.test.ts`
- Modify: `floor-plan-editor.ts` (the panel above the tables list while a table is selected, given
  `fieldError`), `floor-plan-editor.refusals.test.ts`, `floor-plan-editor.test.ts`, `floor-plan-editor.a11y.test.ts`, `strings.ts`

**Interfaces:**
- Consumes: Task 2.4a's `patchTable`, `placeTable`, `deleteTable`, `isAdoptable`; Task 2.4e's
  `fieldError`.
- Produces:

```ts
@customElement("floor-plan-table-panel")
export class FloorPlanTablePanel extends LitElement {
  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() tableKey = "";
  @property({ attribute: false }) fieldError: { field: string; message: string } | null = null;
  @property({ attribute: false }) nextJoinKey!: () => string;   // the page's join:<n>, Task 2.6b
}
// sends floor-plan-change (merge keys "<field>:<tableKey>" for typed fields) and floor-plan-select { key: null } after Delete
```

Behaviour, for the selected table: Name (`wt-input`, `name="table-name"`, required); Seats
(`wt-number-stepper`, `name="seats"`, 0–999, clearable); Fixed in place (`wt-switch`,
`name="fixed"`); for a placed table, Shape (`wt-combobox`, `name="shape"`, Rectangle or Round, no
search), Width and Height (`wt-number-stepper`, `name="width"`, `name="height"`, 1–99) and Rotation
(`wt-combobox`, `name="rotation"`, 0° to 345° in 15° steps, no search) — the canvas handle is the
pointer's way, this the keyboard's; Place (an unplaced table) or Remove from plan (a placed one,
`patchTable(placement: null)`); Delete (danger, no question: Undo brings it back, spec §4), not
shown for a table offered for adoption (decision 20). `fieldError` shows under the field it names.
Strings (EN / ES), all `floor_plan_editor.*`: "Name" / "Nombre"; "Seats" (Task 2.5c's key); "Shape" /
"Forma"; "Rectangle" / "Rectángulo"; "Round" / "Redonda"; "Width" / "Ancho"; "Height" / "Largo";
"Rotation" / "Giro"; "Place" / "Colocar"; "Remove from plan" / "Quitar del plano".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-table-panel.test.ts — Task 2.4a's fixture, m1 selected
it("shows the selected table's values", async () => { /* name "T1", seats "4", fixed off, shape "rect", width "8", height "8", rotation "0" */ });
it("typing a name sends one merged change", async () => { /* typing "a" then "b" → two floor-plan-change events, mergeKey "label:m1", last label "T1ab" */ });
it("an empty seat count sends no seats", async () => { /* clear → seats null */ });
it("Fixed in place, shape, width, height and rotation each send their change", async () => { /* fixed true; shape "round"; width 10; height 6; rotation 45 */ });
it("an unplaced table offers Place and no shape or size", async () => { /* select m2: no shape/width/height/rotation fields; Place → m2 placed at the first free spot */ });
it("Remove from plan makes the table a spare", async () => { /* placement null */ });
it("Delete removes the table and clears the selection", async () => { /* change: no m1, j1 gone (it had two tables); select { key: null } */ });
it("a table offered for adoption has Remove from plan but no Delete", async () => {
  /* live:l9 placed by a change: Remove from plan shown, no [data-test=delete]; unplaced: Place shown, still no Delete */
});
it("shows a refusal under the field it names", async () => { /* fieldError { field: "seats", message: "…" } → seats stepper error; name field none */ });
// floor-plan-editor.refusals.test.ts
it("a taken name from Save shows under the table's name field", async () => { /* completes Task 2.4e's case: the panel's name field shows "A table with that name already exists" */ });
// floor-plan-editor.test.ts
it("Undo of a Delete brings back the table and its join", async () => { /* … */ });
// floor-plan-editor.a11y.test.ts: add "a placed table's panel", "an unplaced table's panel", "a refusal under a field", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts src/screens/floor-plan-editor.refusals.test.ts src/screens/floor-plan-editor.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the new page cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts`,
  `scripts/native-form-fields.test.ts`, the dashboard's typecheck and lint, `prettier --check`.
  Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: the selected table's name, seats, shape, size,
  turn, Place, Remove from plan and Delete (A429 slice 2)".

### Task 2.6b: The selected table's joins

**Files:**
- Modify: `apps/dashboard/src/screens/floor-plan-table-panel.ts`, `floor-plan-table-panel.test.ts`,
  `floor-plan-editor.ts` (passes `nextJoinKey`), `floor-plan-editor.a11y.test.ts`, `strings.ts`
- Create: `apps/dashboard/src/screens/floor-plan-table-panel.unsaved.test.ts`

**Interfaces:**
- Consumes: Task 2.4a's `addJoin`, `removeJoin`; `wt-modal`, `wt-combobox`, `wt-number-stepper`.

Behaviour: under the selected table's fields, Joins: each join this table is in as "with T2 ·
seats 6" and Remove, then Add join, which opens a `wt-modal` with Tables (`wt-combobox multiple`,
`name="join-tables"`, the zone's other draft tables) and Seats (`wt-number-stepper`,
`name="join-seats"`, 1–999, required); its Add waits, quiet and disabled, until at least one table
and the seats are chosen, and its input is a draft scope of its own. Strings (EN / ES), all
`floor_plan_editor.*`: "Joins" / "Uniones"; "with {tables} · seats {seats}" / "con {tables} ·
{seats} plazas"; "Add join" / "Añadir unión".

- [ ] **Step 1: Write the failing tests:**

```ts
// floor-plan-table-panel.test.ts — m1 selected
it("lists the table's joins and removes one", async () => { /* "with T2 · seats 6"; Remove → joins [] */ });
it("Add join waits for a table and the seats", async () => {
  /* open: Add "secondary", disabled; choose T9 → still disabled; seats 4 → "primary", enabled; Add → join { tableKeys: ["m1", "live:l9"], seats: 4, key: "join:1" } */
});
it("Add join offers the zone's other tables only", async () => { /* options T2, T9; not T1 */ });
// floor-plan-table-panel.unsaved.test.ts — inside a LeaveController test app: Add join untouched Escape closes; a chosen table asks first, Keep keeps it
// floor-plan-editor.a11y.test.ts: add "a table with a join" and "Add join open", in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-table-panel.test.ts src/screens/floor-plan-table-panel.unsaved.test.ts src/screens/floor-plan-editor.a11y.test.ts`.
  Expected: the new file fails to load; the join cases fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/screens/floor-plan-editor.test.ts` and
  `src/screens/floor-plan-editor.refusals.test.ts`, `scripts/native-form-fields.test.ts`, the
  dashboard's typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor plan editor: a table's saved joins, with Add join and Remove
  (A429 slice 2)".

### Task 2.7: The entry point

**Files:**
- Modify: `packages/venue-service/src/dashboard/department-zones.ts` (the zone panel's link block,
  `:390-404`), `packages/venue-service/src/dashboard/strings.ts` (EN beside
  `venue.zone_opening_hours`, `:42`; ES beside `:733`),
  `packages/venue-service/src/dashboard/department-zones.test.ts`,
  `packages/venue-service/src/dashboard/department-zones.a11y.test.ts`,
  `docs/developers/design-system.md` (one sentence under "Departments and zones", `:3498`)

**Interfaces:**
- Produces: a link on the zone panel; no new read.

Behaviour (slice 2 decision 17): in the active zone's block, beside the Opening hours link
(`department-zones.ts:396-402`), a second link
`<a data-test="zone-floor-plan" href="/manage/floor-plan/zone/<zoneId>?back=<this page's address>">`
reading "Edit floor plan" / "Editar plano de sala". The way back is the department page's zone
address (`/manage/venue-operations/department/<departmentId>/view/zones/zone/<zoneId>`, the form
`department-settings.ts:533` builds). A module links to a core screen by address, as
`prep-stations-screen.ts:1139` links to `/manage/devices`. It reads nothing, so the request-recording
assertions — `department-zones.test.ts:87-89` with its `toEqual` at `:116-124`, and
`department-zones-hours.test.ts:148-163` — stay as they are; the review that asked to stub the plan
read for them did so for a menu that read the plan, which this task no longer builds.

- [ ] **Step 1: Write the failing tests** in `department-zones.test.ts`, choosing the zone by setting
  `el.zone` (pressing a zone button only sends `zone-change`, `department-zones.ts:217-228`):

```ts
it("the zone panel links Edit floor plan to the editor with the way back", async () => {
  /* mount("z2") → [data-test=zone-floor-plan] href "/manage/floor-plan/zone/z2?back=%2Fmanage%2Fvenue-operations%2Fdepartment%2Fd1%2Fview%2Fzones%2Fzone%2Fz2"; text "Edit floor plan" */
});
it("follows the zone the page names", async () => { /* el.zone = "z1"; await update → href names z1 in both places */ });
it("a disabled zone shows no floor plan link", async () => { /* as the disabled-zone case at :165 on: no [data-test=zone-floor-plan] */ });
it("the zone's ⋮ menu stays Rename, Move and Disable", async () => { /* wt-row-actions holds no floor plan link */ });
it("names the link in Spanish", async () => { /* setLocale("es") → "Editar plano de sala" */ });
// department-zones.a11y.test.ts: the active zone's panel with both links, in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/department-zones.test.ts src/dashboard/department-zones.a11y.test.ts`.
  Expected: no `[data-test=zone-floor-plan]` link.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/dashboard/department-zones-hours.test.ts`,
  `src/dashboard/department-zones.unsaved.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts`,
  the package's typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Departments: a zone's panel links to its floor plan editor (A429
  slice 2)".

### Task 2.8: Look

**Files:** none committed. A throwaway `apps/dashboard/src/screens/floor-plan-editor.look.test.ts`
is written, run and deleted (slice 2 decision 19). Screenshots go to
`/Users/clintongormley/waitron-campaign/a429-2-shots/`, outside the repository: `page.screenshot`
is given that literal absolute path (a `~` is not expanded), or, if Vitest refuses a path outside
the package, the screenshots land in the package's git-ignored `__screenshots__` folder and are
copied there with `cp`, then removed from the package.

Mount the editor as Task 2.4b's tests do, with fixture plans: an empty zone (no tables at all), a
zone like the demo seed's terrace (a dozen placed tables, two fixed 2 × 2 stools, one turned 45°,
a join), a table selected, Add tables open in custom naming, and a refusal shown (`table.label_taken`
under a name, and `floor_plan.out_of_date` with Load newer plan). Take each in English and Spanish
(`setLocale`), light and dark (`mountWidget`'s `theme`), at 1280 × 800 and 390 × 844
(`page.viewport`), the sheet both collapsed and expanded at 390, named
`<state>-<lang>-<theme>-<width>.png`. Also take the department page's zone panel with its link, in
both languages and themes, from a venue-service test file written and deleted the same way.

- [ ] **Step 1:** Write the throwaway files and run them
  (`pnpm --filter @waitron/dashboard exec vitest run src/screens/floor-plan-editor.look.test.ts`).
  Expected: every screenshot exists (`ls /Users/clintongormley/waitron-campaign/a429-2-shots/ | wc -l`
  equals the count taken).
- [ ] **Step 2:** Open each screenshot and look: text cut off or overlapping, a name drawn on a
  token too small for it, the header's buttons wrapping badly at 390 px, the sheet covering the
  selected table, contrast in dark, Spanish strings longer than their space, product text that could
  be shorter where its meaning is plain (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to (a
  failing assertion, then the change), and rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the package (`git status`
  shows none of them) and run every slice 2 test file named above, the guards named above, and the
  three packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Floor plan editor: fixes from looking at it in
  both languages, both themes, on a phone and a laptop (A429 slice 2)", the message listing what was
  looked at and where the screenshots are.

**Slice 2 done when:** the focused tests above pass; `/finish-branch` runs the full wave; CI is green
on the head (`ui`'s mutation floor runs only weekly, so the per-file Stryker runs above are the
check); design-system.md names both primitives and the editor; the backlog's A429 entry says slice
2 landed and what it left.

## Slice 3 — the till's map (spec §5)

Branch `feat/floor-plan-till-map`, after slice 2 (landed as #1506). Expanded to step level on
2026-10-10, unattended, and revised the same day on a fresh-context review's findings; every
`file:line` in this slice was read at `main` `28f150197` and checked again at `f18ff0767` (#1507,
which changed none of the cited code files; only the backlog's line numbers moved).

What the slice builds: a gesture recogniser and a map primitive in `packages/ui`
(`gestures.ts`, `wt-floor-map`), the table fill colours as tokens, and, on the till, the floor screen
drawing a planned zone on the new map, the seat dialog's seats placeholder, a 15-second re-read, a
details sheet, and on the order screen a flash notice and a status pin. A zone with no today's plan
keeps the old map, tray and Edit plan (the plan's decision 2); three changes reach every zone: the
seat dialog's new placeholder (decision 12), the app's rule for which table read wins (decision 13),
and the order screen's status pin and flash notice, which show for any party the floor read lists
(decision 16).
Nothing on the server changes.

**A182** (retire canvases) had not started at `f18ff0767`: the backlog says "Nothing has carried
that out" (`docs/backlog.md:2403-2404`). The floor stays a card in the canvas grid
(`apps/till/src/widgets/card-grid.ts:470-480`). If A182 has started when this slice is dispatched,
the driver reads that branch first and moves this slice's floor-screen tasks onto it.

**A414.** The floor screen's `.screen` drops its side padding at phone width
(`apps/till/src/screens/till-floor-screen.ts:80-91`), and
`apps/till/src/screens/device-screens.phone-margin.test.ts:74-86` (the floor row) and `:137-155`
(the loop) hold it. This slice keeps the `.screen` selector and adds a planned-zone row to that
file (Task 3.3b), so the case stays where it is.

**What earlier slices built that this slice works with** (read, not run):

- The till's table-state answer carries `today` (`apps/till/src/api/client.ts:1831-1849` for
  `TodayPlacement` and `TableToday`, `:1899-1900` on `TableState`; the server's twin at
  `apps/server/src/working-order.ts:6986-6994`). A taken-off table's `placement` is null
  (`readTodayTables`, `working-order.ts:7245-7283`, at `:7274`), and its `takenOff` is true.
- `GET /api/tables/state` runs the day's reset and the catch-up before it reads, and answers only
  the device profile's zones (`apps/server/src/till-api.ts:2186-2198`). `listTablesWithState` lists
  only tables whose `dining_tables.active` is true (`working-order.ts:7166`), so a table a reset hid
  is not in the answer at all.
- A live table that was never in a plan gets no reset row (`targetsFromMaster` skips it,
  `apps/server/src/floor-reset-plan.ts:141`), so in a zone with a master plan such a table has
  `today: null` beside tables that have rows (the plan's decision 17).
- A reset copies no merges: today's joins are written only by slice 4's merge routes, and
  `floor-today-store.ts` only reads and deletes them (`:370-376`; `leaveMerges`,
  `apps/server/src/floor-today-merges.ts:9`). So until slice 4, a merge reaches the map only from a
  test fixture; the map draws it anyway (spec §5), and slice 4's look pass sees a real one.
- Every existing floor-screen fixture sets `today: null` (`till-floor-screen.test.ts:40`,
  `.parties.test.ts:29`, `.signals.test.ts:52`, `.a11y.test.ts:40`, `.unsaved.test.ts:29`), so the
  existing cases keep exercising the old view.
- Slice 2's geometry gives `cropToTables` (two-square margin), `fitScale`, `rotatedRect`,
  `snapToSquare`, `clampToGrid` and `showsName` (`packages/ui/src/floor-plan-geometry.ts:39-95`,
  `:154-156`). `wt-floor-plan-canvas` follows a drag with listeners on `window`
  (`packages/ui/src/components/wt-floor-plan-canvas.ts:534-611`). `wt-sheet` is a bar drawn in the
  page's flow, docked by its parent (`packages/ui/src/components/wt-sheet.ts:7`), not an overlay.
- The till re-reads the floor on tab select (`#onTabSelect`, `apps/till/src/till-app.ts:4979`) and on
  the floor screen's `floor-refresh` event (`:5014-5027`, listener `:9026`); `#refreshFloor` assigns
  whatever answer comes back, in any order. The station and expo screens already re-read every 15
  seconds from their own `setInterval` (`till-station-screen.ts:55`, `:332`; `till-expo-screen.ts:63`).
- The till's idle logout restarts on a `pointerdown` or `keydown` that reaches the app's host
  (`#onInteraction`, `till-app.ts:1380`, listened for at `:1401-1402`, calling
  `SessionActivity.noteInteraction`, `apps/till/src/session-activity.ts:93-95`), and when
  `SessionActivity.configure` re-arms it (`session-activity.ts:72-78`, called through
  `#configureSessionActivity` at `till-app.ts:2428`, `:2566` and `:8619`); no table read restarts
  it. On the server, the till's session lookup has no idle expiry (it matches the token and an
  unended session, `apps/server/src/till-session.ts:113`), and a request not marked passive records
  a device sighting at most once a minute (`:117-118`; `sightingDue` and `recordSighting`,
  `apps/server/src/device-session.ts:276-300`). So the 15-second re-read keeps no waiter signed in,
  and **the map must never stop a `pointerdown` or `keydown`**: the `wt-*` rule's "stop the
  triggering event" applied to them would log out a waiter who only uses the map.
- `wt-toast` closes itself after `duration` ms, or when its message or close button is pressed, and
  pauses while hovered or focused (`packages/ui/src/components/wt-toast.ts:62`, `:94-101`, `:123-134`).

### Slice 3 decisions (added at expansion)

Each is the default this slice builds; the owner may override any at review. Each says what it costs
if it is wrong.

1. **A zone is drawn on the new map when any table the till lists in it has a today's row**
   (`today !== null`); otherwise the floor screen draws the old canvas, tray and Edit plan as today.
   Cost if wrong: none expected; a zone with a master plan always has rows once its first save ran.
2. **In a planned zone, the map draws the tables with a place on today's plan; the list lists those
   plus every table that must stay reachable** — one a party holds, one with a delivery on its way,
   one needing clearing, even without a place, and a never-planned table (`today: null`, decision
   17). Taken-off tables and free spares appear in neither. In map view the listed tables without a
   place sit in the existing tray under the map ("Unplaced", `floor.unplaced`). Cost: a free spare
   is out of reach until slice 4's Add a spare table.
3. **Edit plan is hidden while a planned zone shows.** Its placement writes move the old columns,
   which the new map does not read. Cost: none; slice 5 removes the editor.
4. **The stand-in status set.** Fill, most urgent first: needs clearing; bill requested (a
   `bill_requested` signal); seated (a party holds it, or a delivery is on its way); reserved (free,
   with a booking today); free. Dot, at most one: forgotten (`timingBand` forgotten) before ready
   (`readyToServe > 0`, which counts dishes the pass has sent too). A merge shows its most urgent
   member's fill and dot. Cost: none lasting; A267 replaces the set.
5. **The fills are ten new tokens in `packages/ui-core/src/tokens/colors.css`**,
   `--wt-color-table-<fill>` and `--wt-color-on-table-<fill>` for `free`, `seated`, `bill`,
   `clearing` and `reserved`, beside the calendar's day colours. The dots read
   `--wt-color-success` (ready) and `--wt-color-danger` (forgotten) on a `--wt-color-surface` ring,
   and every table's outline is `--wt-color-field-line`. Starting values are in Task 3.2a; its
   contrast test decides. Cost: a retheme later, in one file.
6. **The map's fill and dot names (`FloorMapFill`, `FloorMapDot`) live in `packages/ui`**, and the
   till maps its table state onto them (`apps/till/src/state/floor-map.ts`). Cost: A267 renames
   them in two places.
7. **Gestures.** A touch or pen tap acts on release at once. A mouse click on a table waits 300 ms
   for a second click; a double-click opens the details sheet instead. Two taps count as a double
   tap within 300 ms and 24 px. A press held 500 ms, moving under 8 px, marks the table held, and
   its release opens the details sheet: details open on release, not at 500 ms, so that slice 4 can
   turn a hold into a drag. A press that moves 8 px or more before the hold pans the map, wherever
   it started. Once two fingers have pinched, nothing else happens until every finger lifts.
   Right-click, the ContextMenu key and Shift+F10 also open details (the keyboard's way; slice 4's
   Join with… is in that sheet), each exactly once: Shift+F10 is handled on `keydown`, because macOS
   sends no `contextmenu` for it (the review's probe). Whether a `contextmenu` still follows a
   prevented Shift+F10 `keydown` on Linux was not measured (the review saw a prevented ContextMenu
   key suppress it on macOS), so swallowing the next `contextmenu` after Shift+F10 is a safeguard. A mouse press with Ctrl held starts no gesture, so on macOS, where Ctrl+click
   sends `contextmenu`, it opens details; elsewhere a Ctrl+click does nothing. Cost: mouse users wait
   300 ms for a table to open.
8. **The view.** The map fits the zone's crop when it first draws tables, when `fitKey` (the zone)
   changes, on a double tap on empty space, and on a resize unless the person has panned or zoomed
   since. A re-read keeps the view. Zoom runs from half to four times the fitted size; a pan stops
   with the crop's centre at the map's edge. The mouse wheel pans; Ctrl+wheel, which is also what a
   laptop trackpad's pinch sends, zooms ×2 per 100 of `deltaY` about the pointer. A focus a press
   gives pans nothing; keyboard movement between tables is decision 18's. There is no Fit button.
   Cost: a keyboard user cannot zoom.
9. **Drawing.** No grid lines on the till's map. A single table shows its name when its own
   shorter side (width or height, before turning) is 28 px or more, the plan's decision 11. A merge
   is one button covering its members' turned boxes, its name shown when that union box's shorter
   side is 28 px or more, labelled with its tables in number order joined by "+", naming a first
   word the tables share once, as `partyTablesName` does with ", "
   (`packages/shared/src/party-name.ts:7-17`): "Terrace 4+5", "4+10", "Bar 1+Stool 2". The map has
   no `delegatesFocus`, unlike design-system.md → "Adding a primitive" item 4 (`:3053-3056`): it is a
   container of table buttons, and the review's probe in headless Chromium 153 found that a click on
   empty space in a `delegatesFocus` host focused its first button. Its host is `overflow: clip`, not
   `hidden`, which the same probe found the browser scrolled when an off-screen table took focus.
   Pressing a merge sends the first member's id (seating every
   member is slice 4's, the plan's decision 18). Tables smaller than `--wt-tap-min` stay their true
   size, as in the editor (slice 2 decision 12); the list is the tap-sized way in. Cost: a small
   stool is hard to hit on a phone until zoomed.
10. **The map's height on the floor screen is `65dvh`, never under six tap heights.** Cost: the look
    pass may change one rule.
11. **`wt-table-drag-end` is built here, and nothing listens until Task 4.4.** During a hold-drag
    the table is drawn under the finger, snapped to whole squares; release sends
    `{ tableId, x, y, targetId }` and the table is drawn back where `tables` puts it. Cost: a held
    table that is dragged springs back with no message until slice 4.
12. **The seat dialog's placeholder** is the table's seats for today ("6 seats"; a merge's
    `joinSeats`), else the old `capacity` in a zone with no plan, else "Covers". It replaces the
    current hint "Optional. Leave it empty if you don't know yet." wherever the dialog is used
    (listed under "Behaviour this plan removes"); the label stays "Guests" and the field stays
    optional and unmarked. Cost: the word "optional" is no longer said.
13. **The 15-second re-read is the floor screen's**, only while a planned zone's map shows (not the
    old map, not the list), and it asks through the existing `floor-refresh` event. In the app every
    table read takes a number as it starts, and an answer is applied only when its number is higher
    than the last applied one; `#refreshFloor` answers true when its own answer or a newer one was
    applied, because the two callers that use its answer read `this.tables` straight after
    (`#retakePartyFromFloor`, `till-app.ts:5308`; Move a bill, `:7074-7076`); its other seven calls
    (`:4907`, `:4998`, `:5015`, `:5172`, `:7401`, `:7973`, `:8595`) ignore the answer. So a poll that answers late never replaces
    an action's newer read, and an action's read is never dropped because an older poll answered
    first. Cost: a list view and the old map go on reading only on tab select and after actions.
14. **The details sheet is a `wt-dialog`** (the till's dialogs all are; `wt-sheet` is an in-flow bar),
    opened from the map and from the order screen's status pin. It saves nothing, so it takes no
    draft scope and has no `*.unsaved.test.ts`. The list view's cards keep their details inline, as
    today, and do not open it. Cost: none.
15. **The flash notice is a `wt-toast`** (4 s) at the top of the window, placed by the equipment
    toast's own rule (`till-app.ts:1078-1083`: fixed, `--wt-space-3` from the sides, below the safe
    area, `z-index: 10`), shown when the order screen draws a party whose table has dishes ready, a
    forgotten order or a bill requested, and again only when the party changes. When the equipment
    toast is open too, the two sit in the same place at the same `z-index`, and the notice, later in
    the page (the toasts are drawn at `till-app.ts:9111-9131`, the tab shell holding the order screen
    at `:9299-9340`, and neither the shell's `.region` nor its `.drill`, `tab-shell.ts:182-207`, sets
    a `z-index` or a transform), is painted over it for its 4 s; the equipment toast stays until
    dismissed (`.duration=${0}`, `:9125`) and shows again when the notice goes (read, not run; the
    look pass photographs both open). Cost: where the order screen stays mounted (the canvas
    layout's order card), reopening the same party shows no second notice.
16. **The status pin and the notice live in one new till widget, `till-table-status`**, placed in the
    order screen's `.head-actions` before the Tab button, so the 5,036-line order screen gains one
    element. The pin is hidden when the order has no party or the floor read has no row for it. The
    pin is as fresh as the app's last table read: the 15-second re-read runs only while a planned
    map shows, so on an order screen the pin changes after the order screen's own actions re-read
    the floor, not while it sits open. Cost: a status that changed while the order was open (a dish
    made ready) shows only after the next action.
17. **The look pass photographs from Vitest browser files that are never committed**, with fixtures,
    as slice 2 decision 19 did.
18. **One table is in the Tab order; the arrow keys move between tables** (a roving tab stop, the
    controller's ruling on the re-check). The tab stop is the table last focused, while the map still
    draws it, else the first in reading order (by the top of its box, then its left). ArrowRight and
    ArrowDown move to the next table in reading order, ArrowLeft and ArrowUp to the previous one,
    Home and End to the first and last; each move pans the target into view by the least distance
    and then focuses it with `focus({ preventScroll: true })`. The reason: with `overflow: clip` the
    map cannot scroll, so Tab-focusing an off-edge table scrolled the nearest scrolling parent
    instead (the review's probe in Chromium 153: the map's box stayed at 0 and the outer div moved
    300; panning inside `focusin` did not undo it), and the till's tab shell body is such a parent
    (`overflow: auto`, `apps/till/src/widgets/tab-shell.ts:190-194`). Cost if wrong: keyboard users
    move between tables with the arrow keys, not Tab; and Tab into the map lands on the tab-stop
    table wherever the view has left it, so after a pan that put it off-screen, Tab can still scroll
    the parent, which an arrow key never does.

**Mutation runs.** As slice 2: each task that adds a `packages/ui` file runs
`gtimeout 900 pnpm --filter @waitron/ui exec stryker run --mutate <file>` once, and a survivor gets
an exact-value assertion. If it cannot start or runs out of time, say so in the commit message.

**Fake timers.** Every browser test here that fakes time fakes only the timers it needs
(`vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`, or `setInterval`/`clearInterval`
for the re-read), as `packages/ui/src/components/wt-toast.test.ts:279` and
`apps/till/src/screens/till-station-screen.test.ts:1839` do, so `requestAnimationFrame` stays
real, and calls `vi.useRealTimers()` in `afterEach`. A case that waits for a resize or a dialog's
close awaits a real animation frame (`await new Promise(requestAnimationFrame)`) or the dialog's
`wt-close` event, never a sleep (`docs/developers/testing-guide.md:1055`, and the dialog-close
rule after it). `gestures.ts` and `wt-floor-map.ts` schedule nothing with `requestAnimationFrame`.

**Forms.** Nothing this slice draws saves anything: the details sheet, the status pin and the flash
notice only show and send events, and the seat dialog keeps its draft scope and
`seat-dialog.unsaved.test.ts` unchanged (only its hint changes). So A331's save rule
(`draftScopeFor`, `saveActionState`, an early return, an `*.unsaved.test.ts` with #1422's reconnect
case) applies to no form here; slice 4's Change seats for today is the first that will need it.

**Pointer events** are dispatched as `wt-floor-plan-canvas.test.ts` dispatches them: `pointerdown`
on the element pressed (`bubbles: true, composed: true`, a `pointerId`, `pointerType`,
`clientX`/`clientY`, `button: 0`), then `pointermove`, `pointerup` and `pointercancel` on `window`.
Synthetic events cannot show what the browser does with focus or scrolling after a real press, so
the cases about those use `userEvent.click` (a real Playwright click) instead.

### Task 3.1: Gestures

**Files:**
- Create: `packages/ui/src/gestures.ts`, `packages/ui/src/gestures.test.ts`
- Modify: `packages/ui/src/index.ts` (export beside the floor exports, `:44-99`)

**Interfaces:**
- Produces:

```ts
export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const SLOP_PX = 8;
export const DOUBLE_TAP_PX = 24;
export interface GesturePoint { target: EventTarget | null; x: number; y: number; pointerType: string } // client px; target = composedPath()[0] of the pointerdown
export interface GestureHandlers {
  tap?(at: GesturePoint): void;
  /** The second of two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX; sent instead of a second tap. */
  doubleTap?(at: GesturePoint): void;
  /** The press has stayed within SLOP_PX for LONG_PRESS_MS. */
  holdStart?(at: GesturePoint): void;
  /** A hold released without moving SLOP_PX. */
  longPress?(at: GesturePoint): void;
  /** A hold that then moved; dx, dy from where the press began. */
  holdDrag?(at: GesturePoint & { dx: number; dy: number }): void;
  holdDrop?(at: GesturePoint & { dx: number; dy: number }): void;
  /** A press that moved SLOP_PX or more before the hold; dx, dy since the last call (the first call: since the press). */
  pan?(by: { dx: number; dy: number }): void;
  /** Two pointers: their distance's ratio since the last call, their midpoint now (client px), and how far it moved. */
  pinch?(change: { ratio: number; x: number; y: number; dx: number; dy: number }): void;
  /** The gesture ended without its own end: a pointercancel at any point, or a second pointer
   * arriving during a hold or a hold's drag. */
  cancel?(): void;
}
export class Gestures {
  constructor(host: HTMLElement, handlers: GestureHandlers);
  /** True from a pointerdown until every pointer of the gesture lifts or cancels. */
  get active(): boolean;
  disconnect(): void;
}
```

Behaviour: `pointerdown` on `host` starts tracking (a mouse's non-primary buttons, and a mouse
press with Ctrl held, start nothing; slice 3 decision 7); the module only listens, and never stops
or prevents a pointer event, so the app's idle logout still hears every press;
`pointermove`, `pointerup` and `pointercancel` are heard on `window` while a gesture is active, and
removed when it ends. The hold is a `setTimeout(LONG_PRESS_MS)`; the double-tap window is a
`setTimeout(DOUBLE_TAP_MS)` started by a tap, so a second tap while it is pending is a double tap.
No clock is read, so fake timers drive both. A third pointer is ignored. `disconnect()` removes the
host's listener, any window listeners, and both timers.

- [ ] **Step 1: Write the failing tests** in `gestures.test.ts`. Host:
  `mount('<div style="width: 600px; height: 300px"><button id="b">B</button></div>')`
  (`packages/ui/src/test-helpers.ts:11`); handlers are `vi.fn()`s; points are client px.

```ts
it("a press released in place is a tap, at once", () => { /* touch down/up on #b → tap once with { target: b, pointerType: "touch" } and the release's x, y; no other handler */ });
it("a second tap within 300 ms and 24 px is a double tap, not a tap", () => { /* tap; advance 299; tap 20 px away → tap once, doubleTap once */ });
it("two taps 300 ms apart are two taps", () => { /* advance 300 between → tap twice, doubleTap never */ });
it("two taps 25 px apart are two taps", () => { /* tap at (10, 10); tap at (35, 10) within 300 ms → tap twice, doubleTap never */ });
it("a press held 500 ms marks the hold, and its release is a long-press, not a tap", () => {
  /* advance 499 → holdStart not called; advance 1 → holdStart({ target: b }); up → longPress once; tap never */
});
it("moving 7 px still holds", () => { /* move +7, 0; advance 500 → holdStart; up → longPress */ });
it("moving 8 px before the hold pans, from where the press began", () => {
  /* move to +8, 0 → pan { dx: 8, dy: 0 }; to +30, +5 → pan { dx: 22, dy: 5 }; advance 500 → no holdStart; up → no tap, no longPress */
});
it("a hold that moves drags, measured from the press", () => {
  /* hold; move +40, 0 → holdDrag { dx: 40, dy: 0, target: b }; up at +50, +10 → holdDrop { dx: 50, dy: 10 }; longPress never */
});
it("two pointers pinch about their midpoint", () => {
  /* down 1 at (200, 150), down 2 at (300, 150); move 2 to (400, 150) → pinch { ratio: 2, x: 300, y: 150, dx: 50, dy: 0 } */
});
it("a second pointer during a hold cancels it", () => { /* hold #b; down 2 → cancel once; up both → no longPress, no tap */ });
it("after a pinch nothing happens until every pointer lifts", () => { /* pinch; up 2; move 1 by 60 → no pan; up 1 → no tap; active false */ });
it("a third pointer is ignored", () => { /* pinching with 1, 2; down 3 and move 3 → no further pinch */ });
it("pointercancel ends the press", () => { /* down; pointercancel → cancel once; up → no tap; active false */ });
it("a mouse's right button starts nothing", () => { /* mouse down/up with button 2 → no tap; active false throughout */ });
it("a mouse press with Ctrl held starts nothing", () => { /* mouse button 0, ctrlKey true, down/up → no tap; active false */ });
it("never stops or prevents a press", () => { /* dispatch the press on #b with cancelable: true → a document pointerdown listener hears it, and defaultPrevented is false */ });
it("another pointer's moves do not move a one-finger press", () => { /* down 1; move pointerId 9 by 50 → no pan */ });
it("disconnect stops listening and clears the hold", () => { /* down; disconnect(); advance 500 → no holdStart; down/up → no tap */ });
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/ui exec vitest run src/gestures.test.ts`.
  Expected: the file fails to load; `./gestures.js` does not exist.
- [ ] **Step 3: Implement** the state machine (idle → pressed → held | panning; pressed or held →
  pinching on a second pointer; pinching → spent until every pointer lifts; any → idle on the last
  up or cancel) and its export.
- [ ] **Step 4: Run** the same command (PASS, read the `Tests` count); `pnpm --filter @waitron/ui typecheck`,
  `pnpm --filter @waitron/ui lint`, `pnpm exec prettier --check packages/ui/src/gestures.ts packages/ui/src/gestures.test.ts packages/ui/src/index.ts`.
- [ ] **Step 5: Mutation** — the bounded run on `src/gestures.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a gesture recogniser that tells tap, double tap, hold,
  hold-and-drag, pan and pinch apart (A429 slice 3)".

### Task 3.2a: The table fill colours

**Files:**
- Modify: `packages/ui-core/src/tokens/colors.css` (all four blocks: the light default, the dark
  preference, explicit light, explicit dark, each after `--wt-color-on-day-closed`),
  `packages/ui-core/src/tokens/colors.test.ts` (a `describe.each` beside the calendar's,
  `:325-366`)
- Create: `packages/ui/src/floor-map-fills.ts`, `packages/ui/src/floor-map-fills.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type FloorMapFill = "free" | "seated" | "bill" | "clearing" | "reserved";
export type FloorMapDot = "ready" | "forgotten";
export const FLOOR_MAP_FILLS: readonly FloorMapFill[];
/** `[data-fill="<fill>"]` paints background `--wt-color-table-<fill>` and colour `--wt-color-on-table-<fill>`. */
export const floorMapFillStyles: CSSResult;
```

Starting values (fill / text), from the existing palette where one fits:

| Fill | Light | Dark |
| --- | --- | --- |
| `free` | `#dff3e8` / `#16181d` | `#183626` / `#eceef2` |
| `seated` | `#1f6feb` / `#ffffff` | `#4c8dff` / `#06101f` |
| `bill` | `#7e3fb8` / `#ffffff` | `#c39bf0` / `#1d0b33` |
| `clearing` | `#f5a623` / `#241500` | `#f5b34a` / `#241500` |
| `reserved` | `#fde7c8` / `#16181d` | `#4a3a1c` / `#eceef2` |

A node script on 2026-10-10 computed each pair's contrast with the formula `colors.test.ts:14-24`
uses: 4.63 (`seated`, light) is the lowest. That is arithmetic on the hex values, not a run of the
test; the test in Step 1 is the check.

- [ ] **Step 1: Write the failing tests.**

```ts
// colors.test.ts — describe.each(["light", "dark"])("table fill colours (%s)")
test("each fill has its own text colour, readable on it at 4.5:1 or more", …); /* for each of the five, ratio(on, fill) ≥ 4.5 */
test("the five fills are different colours", …);                                /* new Set(values).size === 5 */
test("the dots are readable on the surface ring at 3:1 or more", …);            /* ratio(success, surface) and ratio(danger, surface) ≥ 3 */
test("the OS preference gives them the same values as the explicit theme", …);  /* as the calendar's case at :355-366 */

// floor-map-fills.test.ts — mount a div styled with floorMapFillStyles in a shadow root
it("paints each fill from its tokens", async () => {
  /* for each fill: host sets --wt-color-table-<fill> rgb(1, 2, 3) and --wt-color-on-table-<fill> rgb(4, 5, 6) →
     [data-fill=<fill>] background-color rgb(1, 2, 3), color rgb(4, 5, 6) */
});
it("lists the five fills", () => { /* FLOOR_MAP_FILLS toEqual ["free", "seated", "bill", "clearing", "reserved"] */ });
```

- [ ] **Step 2: Run and watch them fail** — `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts`
  (the new cases read empty tokens and fail on `luminance`'s hex check) and
  `pnpm --filter @waitron/ui exec vitest run src/floor-map-fills.test.ts` (fails to load).
- [ ] **Step 3: Implement.** If a contrast case fails, change that value and say which in the commit.
- [ ] **Step 4: Run** both commands, `pnpm exec vitest run scripts/style-token-names.test.ts`, both
  packages' typecheck and lint, `prettier --check` on the changed `.ts` files (`colors.css` too).
- [ ] **Step 5: Commit** — e.g. "Floor map: table colours for free, seated, bill requested, needs
  clearing and reserved, in both themes (A429 slice 3)". (No mutation run: the new `packages/ui`
  file is a style sheet and a list.)

### Task 3.2b: `wt-floor-map` — drawing and fitting

**Files:**
- Create: `packages/ui/src/components/wt-floor-map.ts`, `packages/ui/src/components/wt-floor-map.test.ts`,
  `packages/ui/src/components/wt-floor-map.a11y.test.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/demo/main.ts` (the workbench, beside
  `wt-floor-plan-canvas`, `:30`, `:126`), `docs/developers/design-system.md` (a row in the
  primitives table after `wt-sheet`, `:565`, and a paragraph after `wt-sheet`'s, `:589-594`)

**Interfaces:**
- Consumes: `PlanPlacement`, `cropToTables`, `fitScale`, `rotatedRect`, `bounds`, `showsName`
  (Task 2.1); `FloorMapFill`, `FloorMapDot`, `floorMapFillStyles` (Task 3.2a).
- Produces:

```ts
export interface FloorMapTable {
  id: string; label: string; placement: PlanPlacement;
  fill: FloorMapFill; dot: FloorMapDot | null;
  joinId: string | null;
  /** Read after the name: "Seated, 2 ready". A merge's members carry the same value. */
  description: string;
}
export interface FloorMapCopy { label: string } // the tables' group name; English default "Tables"
export interface FloorMapTap { tableId: string }
export interface FloorMapDetails { tableId: string }                                        // Task 3.2c
export interface FloorMapDrop { tableId: string; x: number; y: number; targetId: string | null } // Task 3.2d
@customElement("wt-floor-map")
export class WtFloorMap extends LitElement {
  @property({ attribute: false }) tables: FloorMapTable[] = [];   // placed tables only
  @property() fitKey = "";                                         // a change fits the view again
  @property({ attribute: false }) copy: Partial<FloorMapCopy> = {};
  /** `undefined` reads `prefers-reduced-motion` on every render; a test sets it. */
  @property({ attribute: false }) reducedMotion?: boolean;
}
```

Behaviour: the host is `display: block; position: relative; overflow: clip; touch-action: none;
user-select: none; -webkit-touch-callout: none` (the last two keep an iPad's long-press from
selecting text or offering its callout) on `--wt-color-surface`; its size is the parent's. It sets
no `shadowRootOptions` (no `delegatesFocus`, slice 3 decision 9). The view is `{ scale, x, y }`: a grid point
`(gx, gy)` is drawn at `(x + gx × scale, y + gy × scale)` px from the host's corner. Fitting sets
`scale = fitScale(crop, size)` and centres the crop. The host's size comes from a `ResizeObserver`.
Tables are grouped by `joinId` (no join: a group of one). Each group is one
`<button type="button" part="table" data-table-id=<first member's id>>` placed at the union of its
members' `rotatedRect`s and transparent itself (`pointer-events: none`), holding one
`<span part="shape" data-fill data-shape>` per member (`pointer-events: auto`), sized
`width × scale` by `height × scale` and turned `rotate(<rotation>deg)` about its centre, round shapes
`border-radius: 50%`, every shape outlined 1 px `--wt-color-field-line`, painted by
`floorMapFillStyles`. Members are ordered by `label` with `Intl.Collator(undefined, { numeric: true })`;
the group's label is `mapLabel(labels)`: when every label has a first word and they all share it,
that word once and then the rest of each joined by "+" ("Terrace 4+5"), else the labels joined by
"+" ("4+10"), the rule of `partyTablesName` (`packages/shared/src/party-name.ts:7-17`) with "+" for
its ", "; `mapLabel` is exported from the component's file. The visible name (`part="name"`,
centred, in the fill's text colour) shows only when `showsName(placement, scale)` for a single
table, which reads the table's own width and height, and `showsName(<the union box>, scale)` for a
merge. The accessible name is
`<label>, <description>`. A group's dot (`part="dot" data-dot`) sits at the box's top-right, a
`--wt-space-3` circle in `--wt-color-success` (ready) or `--wt-color-danger` (forgotten) with a
`calc(var(--wt-space-1) / 2)` `--wt-color-surface` ring (a literal width over 1 px is refused by
`packages/ui/src/no-hardcoded-chrome.test.ts:50-55`); it flashes (a 1 s opacity animation) unless motion is reduced, with the
same `@media (prefers-reduced-motion: reduce)` guard the floor's cards use
(`till-floor-screen.ts:213-217`). The groups sit in a `role="group"` named `copy.label`. The view
fits when tables are first drawn, when `fitKey` changes, and on every resize (Task 3.2d narrows
that). Changing `tables` alone keeps the view.

- [ ] **Step 1: Write the failing tests.** Host `<wt-floor-map style="width: 600px; height: 300px">`;
  `t(id, label, placement, over?)` builds a free table with no dot, no join and description "Free".
  The fitted view of one table at x 10, y 5, 8 × 4 is scale 37.5 (crop 12 × 8 in 600 × 300), drawn
  at left 150, top 75, 300 × 150 px.

```ts
it("fits the zone's tables to the map when it first draws them", async () => { /* t1's [part=table] box relative to the host: { left: 150, top: 75, width: 300, height: 150 } */ });
it("turns a table about its centre", async () => { /* rotation 90: the shape's transform is matrix(0, 1, -1, 0, 0, 0); the crop is now 8 × 12, scale 25, and the button's box 100 × 200 */ });
it("draws a round table as a circle", async () => { /* shape "round": border-radius 50% */ });
it("draws a merge as one button named with its tables in number order", async () => {
  /* "10" at (8, 0) 8 × 8 and "4" at (0, 0) 8 × 8, both joinId "j1": one [part=table], two [part=shape], data-table-id is "4"'s id,
     name text "4+10", aria-label "4+10, Free" */
});
it("names a merge's shared first word once", () => { /* mapLabel(["Terrace 4", "Terrace 5"]) → "Terrace 4+5"; ["4", "10"] → "4+10"; ["Bar 1", "Stool 2"] → "Bar 1+Stool 2" */ });
it("hides a turned table's name by its own size, not its turned box", async () => {
  /* the crop of the next case plus "L" at (20, 8) 2 × 8 turned 45°, kept inside it: its turned box is about 7 squares wide (≈ 92 px), its own shorter side 2 (≈ 26 px) → no [part=name] */
});
it("hides a name drawn under 28 px and keeps it as the accessible name", async () => {
  /* "B1" at (0, 0) 2 × 2 and "B2" at (36, 16) 3 × 3: crop 43 × 23 → scale 300/23 ≈ 13.04; B1 (26.1 px): no [part=name], aria-label "B1, Free"; B2 (39.1 px): name "B2" */
});
it("paints a table from its fill's tokens", async () => { /* fill "bill"; host sets --wt-color-table-bill rgb(1, 2, 3), --wt-color-on-table-bill rgb(4, 5, 6) → shape background rgb(1, 2, 3), name colour rgb(4, 5, 6) */ });
it("outlines every table in the field-line colour", async () => { /* host sets --wt-color-field-line rgb(7, 8, 9) → shape border-color */ });
it("shows one dot in its colour", async () => {
  /* dot "ready", host --wt-color-success rgb(1, 1, 1) → [part=dot][data-dot=ready] background rgb(1, 1, 1); "forgotten" reads --wt-color-danger; null → no dot */
});
it("flashes the dot unless motion is reduced", async () => { /* reducedMotion false → animation-name not "none"; true → "none" */ });
it("names the tables' group from its copy", async () => { /* default "Tables"; copy { label: "Mesas" } → role group named "Mesas" */ });
it("keeps the view when the tables change", async () => { /* add an 8 × 4 table at (60, 5): t1 still 300 px wide at left 150 */ });
it("fits again when fitKey changes", async () => { /* then fitKey "z2" → both tables fitted: crop 62 × 8, scale 600/62 → t1 width ≈ 77.4 (toBeCloseTo 1) */ });
it("fits again when the map is resized", async () => { /* host width 300 px, await a real animation frame twice → scale 25: t1 200 × 100 */ });
it("draws an empty group with no tables", async () => { /* tables [] → no [part=table]; no error */ });

// wt-floor-map.a11y.test.ts — describe.each(["light", "dark"]), mountThemed as wt-floor-plan-canvas.a11y.test.ts:1-40
test("one table in each fill", …); test("a ready dot and a forgotten dot", …); test("a merge, and a name too small to draw", …);
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: both files fail to load.
- [ ] **Step 3: Implement** (design-system.md → "Adding a primitive", `:3046`: `baseStyles` first,
  tokens only; not its `delegatesFocus`, slice 3 decision 9), the workbench entry and the design-system row and paragraph (what
  it draws, its three events, names below 28 px, the dot and reduced motion, that `fitKey` refits,
  and why it has no `delegatesFocus` and clips rather than hides its overflow; Task 3.2e adds its
  one tab stop and arrow keys).
  Before trusting the a11y file, drop the buttons' `aria-label` and watch it fail, then restore it.
- [ ] **Step 4: Run** the same command, `pnpm --filter @waitron/ui exec vitest run src/no-hardcoded-chrome.test.ts`,
  `pnpm exec vitest run scripts/style-token-names.test.ts`, typecheck, lint, `prettier --check`.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: a primitive that draws today's tables fitted to the
  screen, with a colour and a dot each and merges as one shape (A429 slice 3)".

### Task 3.2c: `wt-floor-map` — taps and details

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, its `.a11y.test.ts`, the design-system
  paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.taps.test.ts`

**Interfaces:**
- Consumes: `Gestures`, `DOUBLE_TAP_MS` (Task 3.1).
- Produces: `wt-table-tap` (`FloorMapTap`) and `wt-table-details` (`FloorMapDetails`), each a
  `CustomEvent` with `bubbles: true, composed: true`.

Behaviour (slice 3 decision 7): the map owns one `Gestures` on its host, made in
`connectedCallback` and disconnected in `disconnectedCallback`. A gesture's target is a table when
its composed path holds a `[part=table]` button; its id is that button's `data-table-id`.
- `tap` on a table: touch and pen send `wt-table-tap` at once; a mouse waits `DOUBLE_TAP_MS` and
  sends it unless a `doubleTap` on the same table came first, which sends `wt-table-details`.
- `holdStart` on a table sets `data-held` on its button; `longPress` clears it and sends
  `wt-table-details`; `cancel` clears it.
- `contextmenu` on the map is always prevented; on a table, while no gesture is active (a mouse's
  right button, a macOS Ctrl+click, the ContextMenu key), it sends `wt-table-details`, unless a
  Shift+F10 `keydown` came just before it.
- `keydown` of Shift+F10 on a table is prevented and sends `wt-table-details` (macOS sends no
  `contextmenu` for it), and, as a safeguard (decision 7), notes that the next `contextmenu` is swallowed; the
  note is cleared by the next `keydown` or `pointerdown`, so a macOS right-click after it still
  works.
- A `click` on a table with `detail === 0` (Enter or Space on a focused button) sends
  `wt-table-tap`; a pointer's own click is ignored, since the gesture already acted.
- Events: the map stops a `click` or `contextmenu` it re-emits as a `wt-*` event, as the `wt-*`
  event rule asks, and never stops a `pointerdown` or `keydown`, which the app's idle logout listens
  for at its host (see "What earlier slices built"; the Shift+F10 `keydown` is prevented, not
  stopped).

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.taps.test.ts`, with Task 3.2b's host and
  one table t1 (fitted at left 150, top 75, 300 × 150), points relative to the host, fake
  `setTimeout`/`clearTimeout`:

```ts
it("a touch tap on a table asks to open it, at once", async () => { /* mountInShadowRoot; document hears wt-table-tap { tableId: "t1" }, bubbles, composed */ });
it("a mouse click on a table waits for a second click", async () => { /* mouse down/up → nothing; advance 300 → wt-table-tap */ });
it("a mouse double-click on a table asks for its details instead", async () => { /* two clicks 100 ms apart → wt-table-details { tableId: "t1" }; advance 300 → no wt-table-tap */ });
it("a real mouse click opens a table once", async () => { /* userEvent.click on t1's shape (a real click, detail 1); advance 300 → exactly one wt-table-tap */ });
it("a hold on a table marks it, and its release asks for details", async () => { /* advance 500 → t1 [data-held]; up → wt-table-details; no wt-table-tap; data-held gone */ });
it("a right-click asks for details once and stops the browser's menu", async () => {
  /* dispatch a cancelable contextmenu on t1's shape → defaultPrevented true; exactly one wt-table-details { tableId: "t1" } */
});
it("Shift+F10 asks for details exactly once, whether or not the platform sends a contextmenu", async () => {
  /* focus t1; userEvent.keyboard("{Shift>}{F10}{/Shift}") → one wt-table-details, whether or not the platform follows it with a contextmenu;
     then dispatch keydown Shift+F10 followed by a synthetic contextmenu on t1 → one more, not two */
});
it("a right-click after a Shift+F10 that sent no contextmenu still works", async () => {
  /* keydown Shift+F10 alone (one event); then pointerdown with button 2 and a contextmenu → a second wt-table-details */
});
it("the ContextMenu key asks for details once", async () => { /* focus t1; userEvent.keyboard("{ContextMenu}") → exactly one wt-table-details */ });
it("a press on a table still reaches the page", async () => { /* a document pointerdown and keydown listener each hear a press and a key on t1 (the idle logout's events) */ });
it("a contextmenu during a touch hold sends nothing more", async () => { /* touch down on t1, contextmenu at 400 ms → prevented; no wt-table-details until release */ });
it("Enter on a focused table asks to open it", async () => { /* userEvent.keyboard("{Enter}") → wt-table-tap */ });
it("a merge sends its first member's id", async () => { /* tap on "10"'s shape in the merge of 4 and 10 → { tableId: <4's id> } */ });
it("a tap on empty space sends nothing", async () => { /* touch tap at (20, 20) → neither event */ });
it("a second finger during a hold cancels it", async () => { /* hold t1; second pointer down → data-held gone; release both → no wt-table-details */ });
// wt-floor-map.a11y.test.ts: add "a table held" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.taps.test.ts src/components/wt-floor-map.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: the new cases fail (no event is sent); Task 3.2b's cases pass.
- [ ] **Step 3: Implement.** Then delete the `detail === 0` check and watch "a real mouse click
  opens a table once" count two taps, then restore it.
- [ ] **Step 4: Run** the same command and Task 3.2b's guards. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Floor map: tap a table to open it, hold or double-click it for its
  details (A429 slice 3)". (The mutation run is Task 3.2d's, once the file is whole.)

### Task 3.2d: `wt-floor-map` — pan, pinch, wheel and the held table's drag

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, the design-system paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.view.test.ts`

**Interfaces:**
- Consumes: Task 3.2c's `Gestures`; `snapToSquare`, `clampToGrid` (Task 2.1).
- Produces: `wt-table-drag-end` (`FloorMapDrop`), `bubbles: true, composed: true`.

Behaviour (slice 3 decisions 8 and 11):
- `pan` moves the view; `pinch` scales it about the midpoint (`x' = m − (m₀ − x) × ratio`, with `m₀`
  the old midpoint and `m` the new one, both relative to the host); scale is clamped to
  `[fit / 2, fit × 4]`, and then the view so that the crop's centre stays within the host.
- `doubleTap` on empty space fits the view.
- `wheel`: Ctrl held zooms by `2 ** (−deltaY / 100)` about the pointer, else pans by `−deltaX`,
  `−deltaY`; prevented either way.
- A pan, pinch or wheel marks the view touched; a resize then keeps it (narrowing Task 3.2b's
  "every resize"), and a fit clears the mark.
- `holdDrag` draws the held group moved by `snapToSquare(d, scale)` squares, its first member
  clamped by `clampToGrid`; `holdDrop` sends `wt-table-drag-end` with that member's new `x`, `y`,
  and `targetId`: the `data-table-id` of the first other table under the release point
  (`this.shadowRoot.elementsFromPoint`), else null; then the drawn place returns to `tables`'.
  `cancel` drops a drawn drag.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.view.test.ts`, with Task 3.2b's host and
  fitted view (t1 at left 150, top 75, 300 × 150; a second table t2 at x 20, y 5, 4 × 4 where a case
  needs one, the expected numbers worked out afresh for that crop), points relative to the host,
  fake `setTimeout`/`clearTimeout`:

```ts
it("dragging empty space pans the map", async () => { /* touch at (20, 20), move to (120, 40) → t1 left 250, top 95 */ });
it("a drag that starts on a table pans too, before the hold", async () => { /* down on t1, advance 100, move 20 px → panned 20; up → no wt-table-tap */ });
it("a pan stops with the plan's centre at the map's edge", async () => { /* move by +1000, 0 → t1 left 450 */ });
it("a double tap on empty space fits again", async () => { /* pan, then two taps at (20, 20) → t1 left 150 */ });
it("a double tap on a table does not fit", async () => { /* pan +50; touch double tap on t1 → t1 left 200 still */ });
it("pinching zooms about the fingers", async () => { /* (200, 150) and (300, 150), second to (400, 150) → t1 { left: 100, top: 0, width: 600, height: 300 } */ });
it("zoom stops at half and at four times the fitted size", async () => { /* pinch to a tenth → t1 width 150; then far out → width 1200 */ });
it("the wheel pans, and Ctrl+wheel zooms about the pointer", async () => {
  /* wheel deltaY 100 → t1 top -25; refit; Ctrl+wheel deltaY -100 at (300, 150) → t1 { left: 0, top: 0, width: 600 }; each defaultPrevented */
});
it("a resize after a pan keeps the person's view, and one after a fit fits", async () => {
  /* pan +50; host width 500, two real animation frames → t1 still 300 wide; double tap empty; host width 300, two frames → t1 200 wide */
});
it("a real click on empty space after a pan moves nothing and focuses nothing", async () => {
  /* real timers; pan +50; note document.activeElement; userEvent.click on the host at an empty point → t1 left unchanged; document.activeElement unchanged
     (with delegatesFocus the review's probe saw the first table take focus and the view jump to it) */
});
it("a real click on a table focuses it without panning", async () => {
  /* real timers; pan t1 half off the left edge; userEvent.click on its visible part → t1 left unchanged; t1 is the shadow root's activeElement */
});
it("a hold then a drag draws the table under the finger in whole squares, and drops it", async () => {
  /* hold t1, move +75, 0 → t1 left 225 (2 squares); up over empty → wt-table-drag-end { tableId: "t1", x: 12, y: 5, targetId: null }; then t1 left 150 */
});
it("a drop over another table names it", async () => { /* with t2 drawn: hold t1, move until the pointer is over t2's shape, release → targetId "t2" */ });
it("a drag past the top or left stops at 0", async () => { /* only t at (1, 1) 8 × 4: hold, move -200, -200 → drop x 0, y 0 */ });
it("a cancelled drag sends nothing and puts the table back", async () => { /* hold, move +75, pointercancel → no wt-table-drag-end; t1 left 150 */ });
it("the drop event bubbles out of a shadow root", async () => { /* mountInShadowRoot; document hears wt-table-drag-end */ });
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.view.test.ts src/components/wt-floor-map.taps.test.ts src/components/wt-floor-map.test.ts`.
  Expected: the new cases fail (nothing pans, no drop is sent); the others pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `src/components/wt-floor-map.a11y.test.ts` and Task 3.2b's
  guards. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts`.
- [ ] **Step 6: Commit** — e.g. "Floor map: pinch, drag and the wheel to look around, and a held
  table's drop (A429 slice 3)".

### Task 3.2e: `wt-floor-map` — one tab stop and the arrow keys

**Files:**
- Modify: `packages/ui/src/components/wt-floor-map.ts`, `wt-floor-map.a11y.test.ts`, the
  design-system paragraph from Task 3.2b
- Create: `packages/ui/src/components/wt-floor-map.keys.test.ts`

**Interfaces:**
- Consumes: Task 3.2d's view and its least-distance pan.
- Produces: nothing new for other tasks; keyboard behaviour only (slice 3 decision 18).

Behaviour: every table button has `tabindex="-1"` except the tab stop, which has `tabindex="0"`:
the table last focused (by key or by press) while the map still draws it, else the first in reading
order (sorted by the top of its box, then its left). On a focused table, ArrowRight and ArrowDown
move to the next table in reading order, ArrowLeft and ArrowUp to the previous, Home and End to the
first and last, stopping at the ends; each is prevented (never stopped: the idle logout listens for
`keydown`), pans the target into view by the least distance, makes it the tab stop, and focuses it
with `focus({ preventScroll: true })`. Other keys pass through, so Task 3.2c's Enter, Space and
Shift+F10 still work.

- [ ] **Step 1: Write the failing tests** in `wt-floor-map.keys.test.ts` (real timers; t1, t2 and
  t3 in reading order, t3 placed so that the fitted view, zoomed by a pinch, leaves it below the
  bottom edge):

```ts
it("puts exactly one table in the Tab order, the first in reading order", async () => { /* tabindex 0 on t1 only; -1 on t2, t3 */ });
it("Tab enters the map once and leaves it on the next Tab", async () => {
  /* a button before and after the map; focus the first, userEvent.keyboard("{Tab}") → t1 focused; "{Tab}" again → the button after the map */
});
it("the arrow keys move between tables in reading order, Home and End to the ends", async () => {
  /* focus t1; ArrowRight → t2; ArrowDown → t3; ArrowDown → t3 still; ArrowLeft → t2; Home → t1; End → t3; each keydown defaultPrevented */
});
it("the table last focused is the tab stop", async () => { /* arrow to t2 → tabindex 0 on t2 only; tables re-set without t2 → t1 again */ });
it("arrowing to a table below the edge pans it in without scrolling the map or its parent", async () => {
  /* the map inside <div style="height: 200px; overflow: auto"> with 400 px of content after the map; zoom so t3 is below the map's bottom edge;
     focus t2, ArrowDown → t3 focused; t3's box inside the map's; the parent's scrollTop unchanged (0); the map's scrollLeft and scrollTop 0 */
});
it("a keydown on a table still reaches the page", async () => { /* a document keydown listener hears ArrowRight from t1 */ });
// wt-floor-map.a11y.test.ts: the existing states now carry one tab stop; add "focus on the second table after an arrow key" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-floor-map.keys.test.ts src/components/wt-floor-map.a11y.test.ts`.
  Expected: the new cases fail (every table is in the Tab order; arrows do nothing), except "a
  keydown on a table still reaches the page", a guard that passes before the change.
- [ ] **Step 3: Implement.** Then replace `preventScroll: true` with a plain `focus()` and watch the
  parent's `scrollTop` case fail, then restore it.
- [ ] **Step 4: Run** every `wt-floor-map` test file and Task 3.2b's guards. Expected: pass.
- [ ] **Step 5: Mutation** — the bounded run on `src/components/wt-floor-map.ts` (Task 3.2d's run,
  repeated now that the file has grown).
- [ ] **Step 6: Commit** — e.g. "Floor map: one tab stop, and the arrow keys move between tables
  without scrolling the page (A429 slice 3)".

### Task 3.3a: The till's stand-in statuses and map tables

**Files:**
- Create: `apps/till/src/state/floor-map.ts`, `apps/till/src/state/floor-map.test.ts`
- Modify: `apps/till/src/i18n/strings.ts` (EN after `floor.open_station`, `:534`; ES in the same
  place of the `es` block)

**Interfaces:**
- Consumes: `TableState` (`apps/till/src/api/client.ts:1861-1904`); `signalOf`
  (`apps/till/src/state/table-signals.ts`); `FloorMapTable`, `FloorMapFill`, `FloorMapDot`
  (Tasks 3.2a, 3.2b).
- Produces:

```ts
export interface StandInStatus { fill: FloorMapFill; dot: FloorMapDot | null }
export function standInStatus(table: TableState): StandInStatus;         // slice 3 decision 4
export function combinedStatus(statuses: readonly StandInStatus[]): StandInStatus;
export function statusWords(table: TableState, status: StandInStatus): string; // "Seated, 2 ready"
export function pinText(table: TableState, status: StandInStatus): string;     // "2 ready", Task 3.5
export function isPlannedZone(zoneTables: readonly TableState[]): boolean;      // decision 1
export function mapTables(zoneTables: readonly TableState[]): FloorMapTable[]; // placed, not taken off; a merge's members share one status and its words
export function listedTables(zoneTables: readonly TableState[]): TableState[]; // decision 2
export function seatsFor(table: TableState): number | null;                     // decision 12: joinSeats ?? seats; no today's row: capacity
```

Words (`statusWords` is the fill's word, then the dot's, joined by ", "): free `floor.free`;
reserved `floor.reserved` and the time ("Reserved 20:30"); seated `floor.status_seated`; bill
`signal.bill_requested` ("Bill requested" / "Cuenta pedida", `apps/till/src/i18n/strings.ts:543`, `:1676`, already the bill chip's words); clearing `floor.needs_clearing`; dot ready "<n> " + `floor.ready`; forgotten
`floor.forgotten`. `pinText` is the dot's words if there is a dot, else for seated with
`pendingToServe > 0` "<n> " + `floor.to_serve`, else the fill's word.

New strings (EN / ES): `floor.status_seated` "Seated" / "Ocupada"; `floor.map_label` "Tables" / "Mesas" (Task 3.3b); `floor.seats` "{n} seats" /
"{n} plazas" and `floor.seats_one` "1 seat" / "1 plaza" (Tasks 3.3c, 3.4).

- [ ] **Step 1: Write the failing tests** (a `table(over)` fixture like
  `till-floor-screen.test.ts:20-45`, with `today` set where a case needs it; `setLocale` restored in
  `afterEach`):

```ts
it("a free table is free, a booked free one reserved", () => { /* { fill: "free", dot: null }; nextReservation { time: "20:30" } → "reserved" */ });
it("a party or a delivery on its way makes it seated, even when booked", () => { /* state open-tab → "seated"; delivery-pending → "seated"; open-tab + reservation → "seated" */ });
it("a bill requested beats seated, and needs clearing beats both", () => { /* signals [bill_requested] → "bill"; condition needs_clearing + bill signal → "clearing" */ });
it("a forgotten order's dot beats ready dishes'", () => { /* readyToServe 2 → "ready"; + timingBand forgotten → "forgotten"; timingBand overdue alone → null */ });
it("a merge shows its most urgent member", () => { /* [seated/ready, free/null] → seated/ready; [bill/null, seated/forgotten] → bill/forgotten */ });
it("says the status in words", () => {
  /* "Free"; "Reserved 20:30"; seated + 2 ready → "Seated, 2 ready"; bill + forgotten → "Bill requested, Forgotten"; "Needs clearing"; es: "Ocupada, 2 listos" */
});
it("gives the pin its shortest word", () => { /* forgotten → "Forgotten"; ready 2 → "2 ready"; bill → "Bill requested"; seated, pendingToServe 3 → "3 to serve"; seated, nothing → "Seated" */ });
it("calls a zone planned when any of its tables has a today's row", () => { /* [today null, today {…}] → true; all null → false; [] → false */ });
it("maps placed tables, leaving out spares and taken-off ones", () => {
  /* t1 placed; t2 placement null (spare); t3 takenOff → [t1] with { id, label, placement, fill, dot, joinId, description } toEqual */
});
it("gives a merge's members one status and one description", () => {
  /* t4 seated with 2 ready, t5 free, both joinId "j1" → both fill "seated", dot "ready", description "Seated, 2 ready" */
});
it("lists what is on today's plan and what must stay reachable", () => {
  /* placed free t1; free spare t2; taken-off t3; seated unplaced t4; needs-clearing unplaced t5; delivery-pending unplaced t6; never planned (today null) t7
     → [t1, t4, t5, t6, t7] in the order given */
});
it("reads a table's seats for today, a merge's for the merge, and the old capacity without a plan", () => {
  /* today.seats 6 → 6; joinSeats 10 → 10; today null, capacity 4 → 4; today.seats null → null */
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm --filter @waitron/till exec vitest run src/state/floor-map.test.ts`.
  Expected: fails to load.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, `pnpm --filter @waitron/till typecheck`,
  `pnpm --filter @waitron/till lint`, `prettier --check` on the three files. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: the stand-in table statuses and which tables a planned
  zone shows (A429 slice 3)".

### Task 3.3b: The floor screen on the new map

**Files:**
- Modify: `apps/till/src/screens/till-floor-screen.ts` (render's zone filter and view choice,
  `:633-656`; `#map`, `:727-752`; the Edit plan toggle, `:682-693`, and its state, `editing`,
  `:428`, `#toggleEdit`, `:534-537`, and `#onTrayTap`, `:775-781`; the card's seat count,
  `:899-905` and the clearing card's, `:873-877`; styles), `apps/till/src/screens/till-floor-screen.a11y.test.ts`,
  `apps/till/src/screens/device-screens.phone-margin.test.ts` (one row in `screens`, `:73-135`)
- Create: `apps/till/src/screens/till-floor-screen.map.test.ts`

**Interfaces:**
- Consumes: Task 3.3a's functions; `wt-floor-map` and its `wt-table-tap` (Tasks 3.2b–3.2e).

Behaviour: after the zone filter (`visible`, `:646-648`), when `isPlannedZone(visible)` the screen
uses `listedTables(visible)` for the list, `mapTables(visible)` for the map, and the listed tables
without a place for the tray; the view defaults to the map when the map has a table, else the list
(as `:656`). The map is `<wt-floor-map data-floor-map .tables .fitKey=${activeKey ?? ""}
.copy=${{ label: t("floor.map_label") }}>`, styled `height: 65dvh; min-height: calc(var(--wt-tap-min) * 6)`,
with the tray below it drawn by the existing `#trayItem` in view mode only. `wt-table-tap` stops
and runs `#openTable` on the table it names, as `#onCanvasOpen` does (`:543-548`), so a closed zone
still refuses a free table and a table needing clearing still offers Mark cleared. Edit plan is
not drawn while the active zone is planned, and `editing`, which today outlives a change of zone
(`:428`, set only by `#toggleEdit`, `:534-537`), is set false whenever the active zone is planned,
so `#onTrayTap` (`:775-781`), which places a tray table while editing, opens it instead. A planned
table's list card shows `seatsFor(table)` in the place of `capacity`. A zone with no today's rows
takes today's path.

- [ ] **Step 1: Write the failing tests** in `till-floor-screen.map.test.ts` (fixtures as
  `till-floor-screen.test.ts:7-45`, plus `today(over)` building a placed `TableToday`):

```ts
it("draws a planned zone on the new map, not the old canvas", async () => {
  /* t1 today placed → wt-floor-map present, no wt-floor-canvas; map.tables toEqual mapTables([t1]); map.fitKey "z1"; map.copy.label "Tables" */
});
// A guard that passes before the change too, so it is not one of Step 2's failures:
it("keeps the old canvas for a zone with no today's rows", async () => { /* placed("t1") with today null → wt-floor-canvas, no wt-floor-map */ });
it("a tap on a free table asks for its guests", async () => { /* dispatch wt-table-tap { tableId: "t1" } from the map → till-seat-dialog with tableLabel "1" */ });
it("a tap on a seated table opens its order", async () => { /* open-table { tableId: "t1", seated: true } */ });
it("a tap on a table needing clearing offers Mark cleared", async () => { /* [data-clear-dialog] open */ });
it("a closed zone refuses the map's free table", async () => { /* as till-floor-screen.test.ts:928-940, through the new map */ });
it("a tap naming a table the floor no longer has does nothing", async () => { /* no dialog, no event */ });
it("leaves taken-off tables and free spares out of the map and the list", async () => { /* t2 spare, t3 taken off beside placed t1: map.tables ids ["t1"], no tray item for either; toggle to list: no [data-table] for either */ });
it("puts a seated table with no place under the map, and in the list", async () => { /* tray [data-tray-table=t4]; list card t4 */ });
it("lists a never-planned table of a planned zone", async () => { /* t7 today null beside planned t1 → list card t7; tray t7 */ });
it("shows today's seats on a planned table's card", async () => { /* today.seats 6, capacity 4 → ".capacity" text "6 pax" */ });
it("hides Edit plan while a planned zone shows", async () => {
  /* canEdit; planned z1 active → no [data-edit-toggle]; select unplanned z2's tab → [data-edit-toggle] shown */
});
it("an Edit plan left on in another zone does not place a planned zone's tray table", async () => {
  /* canEdit, api with setTablePlacement as a vi.fn(); in unplanned z2 press Edit plan; select planned z1 (with seated unplaced t4 in its tray);
     tap [data-tray-table=t4] → open-table { tableId: "t4", seated: true }; setTablePlacement not called */
});
it("gives the map the active zone as its fitKey", async () => { /* two planned zones; select z2 → fitKey "z2" and z2's tables */ });
it("opens on the list when a planned zone has nothing placed", async () => { /* only a seated unplaced table → list view */ });

// device-screens.phone-margin.test.ts — a case beside the loop (:137-155): at 411 px a planned zone with one placed table draws its
// wt-floor-map inside the screen's content box: the map's box has left 8 and right 403 (8 + 395); at 1280 px left 40 and right 1240.
// (A row in `screens` would read only .screen's padding, which the map cannot change.)
// till-floor-screen.a11y.test.ts — "a planned zone's map" and "a planned zone's list" in both themes
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.map.test.ts src/screens/device-screens.phone-margin.test.ts src/screens/till-floor-screen.a11y.test.ts`.
  Expected: the new file's cases fail (no `wt-floor-map`), except the old-canvas guard, which
  passes before and after; the phone-margin case fails because there is no map to measure.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus every existing floor file
  (`src/screens/till-floor-screen.test.ts src/screens/till-floor-screen.parties.test.ts src/screens/till-floor-screen.signals.test.ts src/screens/till-floor-screen.unsaved.test.ts`),
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/native-form-fields.test.ts`, the
  till's typecheck and lint, `prettier --check`. Expected: pass, with no existing case changed; one
  that needs changing is a STOP (the plan's header rule).
- [ ] **Step 5: Commit** — e.g. "Till floor: a zone with a floor plan shows today's plan as a map
  of coloured tables (A429 slice 3)".

### Task 3.3c: The seats placeholder and the 15-second re-read

**Files:**
- Modify: `apps/till/src/widgets/seat-dialog.ts` (a `seats` property beside `tableLabel`, `:38`;
  the hint, `:151`), `apps/till/src/widgets/seat-dialog.test.ts`,
  `apps/till/src/screens/till-floor-screen.ts` (`#seatDialog`, `:824-835`; the re-read timer beside
  the reminder timer, `:444-465`), `apps/till/src/till-app.ts` (`#refreshFloor`, `:5018-5027`, and
  every assignment of `this.tables`: `:1323`, `:4939`, `:5022`, `:6980`, `:6982`),
  `apps/till/src/till-app.test.ts` (beside the floor-refresh cases, `:6486-6526`),
  `apps/till/src/till-app-parties.test.ts` (one case),
  `apps/till/src/i18n/strings.ts` (`seat.covers`; `seat.guest_count_hint` deleted, EN `:546` and ES
  `:1679`, once nothing reads it)
- Create: `apps/till/src/screens/till-floor-screen.refresh.test.ts`

**Interfaces:**
- Produces: `TillSeatDialog.seats: number | null` (default null); the floor screen sends
  `floor-refresh` every 15 s while a planned zone's map shows.

Behaviour: the dialog's hint is `countText(seats, "floor.seats", "floor.seats_one")` when `seats`
is a number, else `t("seat.covers")` ("Covers" / "Cubiertos"). The floor passes
`seatsFor(table)`. The floor's re-read is a `setInterval(15_000)` started in `updated` when the map
view of a planned zone is drawn and cleared when it is not, and in `disconnectedCallback`; each tick
sends `floor-refresh`, as the placement writes do (`:576-578`).
The interval is started only when none is running, so a render while the map stays up leaves the
running one alone. In the app (slice 3 decision 13), every table read takes a number as it starts
(`const read = ++this.#tablesRead`), at each place that reads and writes `this.tables` (`:1321-1323`,
`:4934-4939`, `:5020-5022`, `:6978-6982`), and applies its answer, an empty list from
`#reloadTables`'s failure included, only when `read` is higher than `#tablesApplied`, then sets
`#tablesApplied = read`. `#refreshFloor` answers true when `#tablesApplied >= read` after its own
answer or failure, that is when its own answer or a newer one was applied.

The dialog keeps its draft scope and its `seat-dialog.unsaved.test.ts` as they are: only the hint
changes, so A331's save rule is not reopened here.

- [ ] **Step 1: Write the failing tests:**

```ts
// seat-dialog.test.ts
it("shows the table's seats as the placeholder", async () => { /* seats 6 → native input placeholder "6 seats"; seats 1 → "1 seat"; es → "6 plazas" */ });
it("says Covers when the table has no seats", async () => { /* seats null → "Covers"; es "Cubiertos" */ });

// till-floor-screen.refresh.test.ts — fake setInterval/clearInterval
it("gives the seat dialog today's seats, a merge's, or the old capacity", async () => { /* tap planned t1 (seats 6) → dialog.seats 6; merge member (joinSeats 10) → 10; unplanned zone, capacity 4 → 4 */ });
it("asks for the floor every 15 s while a planned zone's map shows", async () => { /* advance 14_999 → 0 floor-refresh; +1 → 1; +15_000 → 2 */ });
// A guard that passes before the change too:
it("does not ask while the list shows, or for the old map", async () => { /* toggle to list → none in 30 s; an unplanned zone's map → none */ });
it("a redraw while the map stays up keeps the running interval", async () => { /* advance 10_000; set tables (a re-read); advance 5_000 → 1 floor-refresh, not 0 */ });
it("starts again when the map comes back, and stops when the screen leaves", async () => { /* list → map → 1 after 15 s; remove the element → none; re-add → 1 after 15 s */ });

// till-app.test.ts, as :6486
it("an older poll that answers after the action's refresh began does not replace it", async () => {
  /* two floor-refresh events, A then B, both deferred; resolve B with [tableB], then A with [tableA] → floor(el).tables toEqual [tableB] */
});
// A guard that passes before the change too (today assigns every answer); Step 3 uses it:
it("an action's refresh is applied when an older poll answers first", async () => {
  /* A then B deferred; resolve A with [tableA] → tables [tableA]; resolve B with [tableB] → tables [tableB] (a "drop when the counter moved" rule would drop B here) */
});
// till-app-parties.test.ts, with its Move a bill stubs (its api fixture stubs moveBill at :295):
it("Move a bill's floor read is not replaced by an older poll that answers later", async () => {
  /* a floor-refresh poll deferred; move a bill (till-app.ts:7068-7076), whose floor read answers with the party at its new revision; then the poll answers with the old revision →
     the order screen's `tables` row for the moved table (it is given the app's this.tables, :8851) holds the new revision. (Its `party` would pass today too:
     #rememberOrderParty, :5388-5394, copies the party from the move's own read into orderParty, which the screen reads, :8856; the table row is what the late poll overwrites today.) */
});
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/seat-dialog.test.ts src/screens/till-floor-screen.refresh.test.ts src/till-app.test.ts -t "seats|Covers|15 s|list shows|map stays up|map comes back|older poll"`
  and `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts -t "older poll"`.
  Expected: each new case fails (the old hint shows; no `floor-refresh` is sent; the late answer
  wins), except two guards that pass before the change: "does not ask while the list shows, or for
  the old map" and "an action's refresh is applied when an older poll answers first".
- [ ] **Step 3: Implement.** With the app cases passing, replace "higher than the last applied" by
  "no read started since" and watch "an action's refresh is applied when an older poll answers
  first" fail, then restore it.
- [ ] **Step 4: Run** the four files without `-t`, `src/widgets/seat-dialog.unsaved.test.ts`,
  `src/widgets/seat-dialog.a11y.test.ts`, `src/screens/till-floor-screen.map.test.ts`, the till's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: the seat dialog suggests the table's seats, and a
  floor plan map re-reads every 15 seconds (A429 slice 3)".

### Task 3.4: The details sheet

**Files:**
- Create: `apps/till/src/widgets/table-details-sheet.ts` (`till-table-details-sheet`),
  `apps/till/src/widgets/table-details-sheet.test.ts`, `apps/till/src/widgets/table-details-sheet.a11y.test.ts`,
  `apps/till/src/screens/till-floor-screen.details.test.ts`
- Modify: `apps/till/src/screens/till-floor-screen.ts` (a `#details` state holding a table id and
  heading; the sheet beside `#seatDialog` and `#clearDialog`, `:722`), `apps/till/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `seatsFor` (Task 3.3a); `signalChips`, `signalChipStyles` (`apps/till/src/widgets/signal-chips.ts:20`, `:62`),
  `renderFloorChips` (`packages/ui/src/floor-chips.ts:43`); `trackDialog`.
- Produces:

```ts
@customElement("till-table-details-sheet")
export class TillTableDetailsSheet extends LitElement {
  @property({ attribute: false }) table: TableState | null = null; // null: closed
  @property() heading = "";                                         // the name as drawn: "Terrace 4+5", or the party's name on the order screen
  /** Injectable clock for Time to fire; unset reads Date.now() on each render. */
  @property({ attribute: false }) now?: number;
}
// details-close: no detail, bubbles, composed — on Close, Escape and after Mark cleared
// mark-cleared: { tableId }, bubbles, composed — the app's existing event (till-app.ts:9076)
```

Behaviour (spec §5, slice 3 decision 14): a `wt-dialog` with `trackDialog()`, open while `table` is
set, headed `heading`. Lines, each only when it applies: today's seats ("6 seats"); the party's
name when it differs from the table's (as `shownPartyName`, `till-floor-screen.ts:51-54`);
"Guests: 4" (`floor.guests`); what is owed (`floor.details_owed`, the party's `outstanding`
through `formatMoney`) or "Paid" (`floor.paid`) when nothing is; "Bills: 2" when more than one;
kitchen progress, each count above zero joined by " · " ("3 to serve · 2 ready · 1 en route",
`floor.to_serve`, `floor.ready`, `floor.en_route`); the unsent drafts (as `#unsent`, `:991-997`);
the signal chips; "Time to fire" (`floor.fire_due`) when the party's held group is due, judged as the
floor's card judges it (`reminderDueAt(table.party?.reminder) <= now`, `#fireDue`,
`till-floor-screen.ts:467-469`, shown on the card at `:921-925`), so a planned zone, whose map has no
room for it, keeps it one press away; "Reserved 20:30"; "2 to deliver" (`floor.pending_delivery`);
"Free" when none of these apply. The floor passes the clock it last drew with (`#drawnAt`, set in
`willUpdate`, `till-floor-screen.ts:459-461`), so when its reminder timer redraws the floor at the
due time (`#watchReminders`, `:471-482`) the open sheet is drawn again with the later clock and
shows Time to fire. Opened from the order screen's pin (Task 3.5) it is given no clock and reads
`Date.now()` when it draws, which happens when its `table` changes, so there it shows Time to fire
only after the next table read one of the order screen's actions brings. Footer: Close (`floor.details_close`, secondary) and, for a table needing clearing,
Mark cleared (`floor.mark_cleared`, primary), which sends `mark-cleared` and then `details-close`.
The floor screen opens it on the map's `wt-table-details`, with the heading of the map group the
table belongs to, and closes it on `details-close`. It reads the table by id from `tables` on each
render, so a re-read updates it, and a re-read that no longer has the table closes it.

New strings (EN / ES): `floor.details_owed` "Owes {amount}" / "Debe {amount}"; `floor.details_close`
"Close" / "Cerrar".

- [ ] **Step 1: Write the failing tests:**

```ts
// table-details-sheet.test.ts — mountWidget, a fixed locale
it("is closed with no table", async () => { /* wt-dialog open false */ });
it("heads itself with the name it is given and shows today's seats", async () => { /* heading "Terrace 4+5"; "6 seats" */ });
it("shows a seated party: its name, guests, what it owes, its bills and its kitchen progress", async () => {
  /* party name "Ana" (displayName ≠ label), "Guests: 4", "Owes " + formatMoney("47.50", currentLocale()), "Bills: 2",
     pendingToServe 3, readyToServe 2, enRoute 1 → "3 to serve · 2 ready · 1 en route" */
});
it("says Paid when the party owes nothing", async () => { /* outstanding "0.00", no open tab */ });
it("says Time to fire when the held group is due, and not before", async () => {
  /* party.reminder.dueAt 12:00:00Z; now 11:59:59Z → no [data-fire-due]; now 12:00:00Z → "Time to fire" */
});
it("shows the signal chips, the booking and a delivery", async () => { /* a bill_requested chip [data-chip]; "Reserved 20:30"; "2 to deliver" */ });
it("says Free for a free table with nothing on it", async () => { /* free, no booking, no seats → the only line is "Free"; no [data-mark-cleared] */ });
it("offers Mark cleared only for a table needing clearing, and closes after it", async () => {
  /* mountInShadowRoot-style host listener hears mark-cleared { tableId: "t1" } then details-close; a free table has no [data-mark-cleared] */
});
it("Close asks to close", async () => { /* details-close once */ });
it("Escape asks to close", async () => { /* keyboard Escape; await the wt-dialog's wt-close event, then expect details-close */ });

// till-floor-screen.details.test.ts
it("opens the sheet on the map's request, headed as the map draws the table", async () => { /* wt-table-details { tableId: "t4" } on a merge of "Terrace 4" and "Terrace 5" → sheet.table.id "t4", heading "Terrace 4+5" */ });
it("the open sheet shows Time to fire when the floor redraws at the due time", async () => {
  /* floor now 11:59:59Z, t4's reminder due 12:00:00Z, sheet open → no [data-fire-due]; set the floor's now to 12:00:00Z → the sheet shows "Time to fire" */
});
it("a re-read updates the open sheet", async () => { /* set tables with t4's readyToServe 2 → sheet shows "2 ready" */ });
it("a re-read without the table closes the sheet", async () => { /* open for t4; set tables without t4 → no open till-table-details-sheet (table null) */ });
it("Mark cleared in the sheet reaches the app and closes the sheet", async () => { /* document hears mark-cleared { tableId }; sheet closed */ });

// table-details-sheet.a11y.test.ts — describe.each(["light", "dark"]): a free table; a seated party with everything; a table needing clearing
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/table-details-sheet.test.ts src/widgets/table-details-sheet.a11y.test.ts src/screens/till-floor-screen.details.test.ts`.
  Expected: the files fail to load.
- [ ] **Step 3: Implement.** Before trusting the a11y file, remove the dialog's heading and watch it
  fail, then restore it.
- [ ] **Step 4: Run** the same command, `src/screens/till-floor-screen.map.test.ts`, the till's
  typecheck and lint, `prettier --check`. Expected: pass.
- [ ] **Step 5: Commit** — e.g. "Till floor: hold a table, or double-click it, for its details
  sheet (A429 slice 3)".

### Task 3.5: The flash notice and the status pin

**Files:**
- Create: `apps/till/src/widgets/table-status.ts` (`till-table-status`),
  `apps/till/src/widgets/table-status.test.ts`, `apps/till/src/widgets/table-status.a11y.test.ts`
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`.head-actions`, markup
  `:2549-2577`: the widget before the Tab button, given `.tables=${this.tables}` and
  `.party=${this.party}`, props at `:1166-1168`), `apps/till/src/screens/till-table-order-screen.test.ts`
  (one case), `apps/till/src/i18n/strings.ts`

**Interfaces:**
- Consumes: `standInStatus`, `combinedStatus`, `pinText` (Task 3.3a); `floorMapFillStyles`
  (Task 3.2a); `till-table-details-sheet` (Task 3.4); `wt-toast`.
- Produces:

```ts
@customElement("till-table-status")
export class TillTableStatus extends LitElement {
  @property({ attribute: false }) tables: TableState[] = [];
  @property({ attribute: false }) party: TableParty | null = null;
}
```

Behaviour (slice 3 decisions 15 and 16): the party's rows are the tables whose `party.id` is the
party's, in `party.tableIds` order; with none, the widget draws nothing. The pin is a
`<button class="status-pin" data-status-pin>` at least `--wt-tap-min` tall: a swatch
(`<span data-fill=<fill>>` painted by `floorMapFillStyles`) and `pinText` of the first row with
the combined status; its accessible name is `table.status_pin` with the text. Pressing it opens the
details sheet for the first row, headed `party.displayName`. The flash notice is a
`<wt-toast data-flash-notice tone="info" .duration=${4000}>` fixed to the top of the window by a
copy of the equipment toast's rule (`till-app.ts:1078-1083`: `position: fixed; inset-inline:
var(--wt-space-3); top: calc(var(--wt-space-3) + env(safe-area-inset-top)); z-index: 10`; what
happens when both are open is in slice 3 decision 15), whose message is,
joined by " · ", what applies of: ready dishes (`countText(readyToServe, "table.flash_ready",
"table.flash_ready_one")`), a forgotten order (`table.flash_forgotten`), a bill requested
(`signal.bill_requested`). It is shown (`show()`) on the first render with a party that has any of them,
and again only when `party.id` changes; the widget remembers the last party id it judged while
connected.

New strings (EN / ES): `table.flash_ready` "{n} ready to serve" / "{n} listos para servir";
`table.flash_ready_one` "1 ready to serve" / "1 listo para servir"; `table.flash_forgotten`
"Forgotten order" / "Pedido olvidado"; `table.flash_close` "Close" / "Cerrar";
`table.status_pin` "Table details: {status}" / "Detalles de la mesa: {status}".

- [ ] **Step 1: Write the failing tests** (fake `setTimeout`/`clearTimeout` where a case waits):

```ts
// table-status.test.ts
it("draws nothing without a party or without its table", async () => { /* party null → empty; party with no row in tables → empty */ });
it("pins the table's status in its colour and shortest word", async () => {
  /* row seated, readyToServe 2 → pin text "2 ready", swatch data-fill "seated", aria-label "Table details: 2 ready" */
});
it("paints the pin's swatch from the fill's token", async () => { /* host sets --wt-color-table-seated rgb(1, 2, 3) → swatch background */ });
it("the pin opens the details sheet, headed with the party's name", async () => { /* party { name: null, displayName: "Terrace 4, 5" } (the floor read's displayName is partyDisplayName, apps/server/src/working-order.ts:7330, joining with ", ", packages/shared/src/party-name.ts:3, :18-20) → click → till-table-details-sheet table.id "t4", heading "Terrace 4, 5" */ });
it("flashes what the waiter must see when the order opens", async () => {
  /* readyToServe 2 and a bill_requested signal → wt-toast[data-flash-notice] open, message "2 ready to serve · Bill requested" */
});
it("says a forgotten order", async () => { /* timingBand forgotten → "Forgotten order" */ });
it("flashes nothing when nothing is urgent", async () => { /* seated, nothing ready → toast not open */ });
it("the notice goes on its own after 4 s", async () => { /* advance 3_999 → open; +1 → closed */ });
it("the notice goes with a tap", async () => { /* click the toast's message button → closed */ });
it("the notice blocks nothing", async () => {
  /* while open: no dialog[open] in the widget; document.elementFromPoint at a button placed mid-page beside the widget returns that button */
});
it("does not flash again for the same party, and does for another", async () => {
  /* close it; set party to a new object with the same id → not reopened; party with another id and an urgent row → open */
});

// till-table-order-screen.test.ts
it("shows the table's status in its head actions", async () => { /* mount with tables [row of party p1] and party p1 → .head-actions till-table-status with .party p1 */ });

// table-status.a11y.test.ts — describe.each(["light", "dark"]): the pin for each fill; the notice open; the sheet open from the pin
```

- [ ] **Step 2: Run and watch them fail** —
  `pnpm --filter @waitron/till exec vitest run src/widgets/table-status.test.ts src/widgets/table-status.a11y.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.test.ts -t "head actions"`.
  Expected: the new files fail to load; the order-screen case finds no `till-table-status`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files without `-t`, `src/screens/till-table-order-screen.a11y.test.ts`,
  `src/screens/device-screens.phone-margin.test.ts`, the till's typecheck and lint, `prettier --check`.
  Expected: pass, no existing case changed.
- [ ] **Step 5: Commit** — e.g. "Till order: a notice for dishes ready, a forgotten order or a bill
  asked for, and a status pin that opens the table's details (A429 slice 3)".

### Task 3.6: Look

**Files:** none committed. Throwaway files `packages/ui/src/components/wt-floor-map.look.test.ts`
and `apps/till/src/screens/till-floor-screen.look.test.ts` are written, run and deleted (slice 3
decision 17). Screenshots go to `/Users/clintongormley/waitron-campaign/a429-3-shots/`, by that
literal absolute path, or, if Vitest refuses a path outside the package, through the package's
git-ignored `__screenshots__` folder and `cp`, then removed from the package (as Task 2.8).

States, each in English and Spanish (`setLocale`), light and dark (`mountWidget`'s `theme`), on the
handheld at 390 × 844 and the till at 1280 × 800 (`page.viewport`), named
`<state>-<lang>-<theme>-<width>.png`: a planned zone like the demo seed's terrace (a dozen tables,
two 2 × 2 fixed stools, one turned 45°) with every fill and both dots; a merge; the map zoomed in
and panned; a table held; the list view of a planned zone with the tray; the seat dialog with
"6 seats" and with "Covers"; the details sheet for a free table, a seated party with everything,
and a table needing clearing; the order screen with its status pin and the flash notice showing,
and once more with the equipment toast open too (slice 3 decision 15 says the notice is drawn over
it; the screenshot is the check, from `till-app` mounted whole, since the equipment toast is the
app's).

- [ ] **Step 1:** Write the throwaway files and run them
  (`pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.look.test.ts`, and the
  `packages/ui` one). Expected: `ls /Users/clintongormley/waitron-campaign/a429-3-shots/ | wc -l`
  equals the count taken.
- [ ] **Step 2:** Open each screenshot and look: a name on a token too small for it, a dot hidden by
  a neighbour, fills hard to tell apart in either theme, the map too tall or too short beside the
  zone tabs at 1280 or at 390, the tray crowding the map, the sheet's lines wrapping badly, the pin
  pushing the Tab button off a 390 px row, the notice covering the order's first line, Spanish
  longer than its space, product text that could be shorter (owner rule).
- [ ] **Step 3:** Fix what the look found, each fix test-first in the task file it belongs to (a
  failing assertion, then the change), and rerun that file.
- [ ] **Step 4:** Delete the throwaway files and any screenshots left in the packages (`git status`
  shows none), then run every slice 3 test file named above, the guards named above, and the three
  packages' typecheck and lint.
- [ ] **Step 5: Commit** the fixes, if any — e.g. "Till floor map: fixes from looking at it in both
  languages, both themes, on a phone and a till (A429 slice 3)", the message listing what was looked
  at and where the screenshots are.

**Slice 3 done when:** the focused tests above pass; `/finish-branch` runs the full wave; CI is green
on the head (`ui`'s and `ui-core`'s mutation floors run only weekly, so the per-file Stryker runs
above are the check); design-system.md names `wt-floor-map`; the backlog's A429 entry says slice 3
landed and what it left.

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
- **Task 4.4: Dragging on the map** — (the map's hold feedback and `wt-table-drag-end` are built in
  Tasks 3.2c and 3.2d; this task listens to them) long-press-drag moves a movable table (snap on release), drop
  on another table joins (asks seats when there is no saved join, suggesting the sum), a fixed
  table's copy follows the finger and springs back with a linking line; a party at several fixed
  tables is drawn in one colour with a thin linking line and one label; `Join with…` in the
  details sheet for keyboard and screen-reader users.
- **Task 4.5: The sheet's actions and the zone menu** — Split, Rotate, Change seats for today, Back
  to its saved place, Take off for today; the zone menu (⋮, `wt-row-actions`) with Add a spare
  table ("No spare tables — add some in the floor plan editor" when none), Taken off today with Put
  back, and Reset to saved plan (asks first). (Added at slice 2's expansion, slice 2 decision 16:
  the dashboard editor's line under its header, `floor_plan_editor.note`, gains "or sooner with
  Reset to saved plan on the till" once that button exists.)
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
