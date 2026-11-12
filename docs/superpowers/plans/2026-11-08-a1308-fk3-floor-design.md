# A1308 fk3 — the floor's design tables take in their parts, kept sizes and set names: implementation plan

> 2026-11-12: implementation instructions are superseded by the [fk3 refresh](2026-11-12-a1308-fk3-floor-design-refresh.md), Claude-read and pending watcher clearance after fk5 PR B. This file remains the historical plan; the refresh uses PR B's ordinary groups and records the unlanded fixture-tool prerequisite.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Goal:** four side tables of the floor's design fold into their parents:
`floor_plan_table_parts` → `floor_plan_tables.part_of_table_id`, `floor_reset_table_parts` →
`floor_reset_tables.part_of_reset_table_id`, `floor_plan_table_sizes` → `floor_plan_placements`
(a row with no place keeps the size), and `department_floor_plan_sets` → `floor_plan_sets`.

**Architecture:** each side table is unique on the row it describes (a part has one joined table; a
layout holds one row per design table; a set has one department), so one column or one row holds
it. Behaviour does not move: the floor suites keep every assertion (appendix §8 item 2).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §4 ("the floor");
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.2, §1.4, §1.5, §1.7, §5,
§8 items 2 and 3 (the `floor_plan_tables` half).

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6).

## What it builds

- `floor_plan_tables.part_of_table_id` (self key, `ON DELETE NO ACTION`, not-self CHECK, index).
- `floor_reset_tables.part_of_reset_table_id` (the same shape on the reset copy).
- `floor_plan_placements.x`, `y`, `shape`, `rotation` become nullable; `width`, `height` stay not
  null. A row with no place is "off this layout, size kept". The placement CHECK becomes "x, y,
  shape and rotation all set or all null".
- `floor_plan_sets.department_id` (not null, key to `departments`), `name`, `is_default`, with a
  unique name per department, one default per department, and the non-blank name CHECK.
- The four side tables are deleted.
- The core-to-module seam `FloorPlanSets` loses `create(tx)`: venue-service writes the whole
  `floor_plan_sets` row itself, since both now live in core (`packages/module/src/module.ts:58-61`).
- A schema test that every key into `floor_plan_tables` is `ON DELETE NO ACTION` (appendix §8.3).
- Raises the configuration bundle's format version by one (rules §9): the export stops carrying
  `floor_plan_table_parts`, `floor_plan_table_sizes` and `department_floor_plan_sets`
  (`packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| A composite key `menu_periods(floor_plan_set_id, department_id)` → `floor_plan_sets(id, department_id)`, which would let the database refuse another department's set (`packages/db/src/schema/venue-service/menus.ts:21-27`) | the menu area, which rewrites `menu_periods` |
| `floor_today_*` tables | fk4, fk5 |
| `location_id` on `floor_plan_sets` | slice 5 (assumed landed; after it the set row holds only its id) |

## Files

- Modify: `packages/db/src/schema/floor-plans.ts` (`floorPlanSets` :80-95, `floorPlanTables`
  :121-141, `floorPlanPlacements` :143-170, `floorResetTables` :228-266; delete
  `floorPlanTableParts` :172-196, `floorPlanTableSizes` :198-222, `floorResetTableParts` :268-293);
  delete `packages/db/src/schema/venue-service/floor-plan-sets.ts`; `packages/db/src/index.ts`;
  `packages/db/src/classification.ts:126,127,129,337`; `packages/venue-service/src/classification.ts:19`;
  `packages/db/src/configuration-transfer.ts:86-87`;
  `packages/venue-service/src/configuration-transfer.ts:107-119,713`;
  `scripts/schema-constraints.test.ts:152-160`.
- Modify (parts): `apps/server/src/floor-plan.ts:111-156, 510-630`,
  `apps/server/src/floor-plan-sets.ts:160-185`, `apps/server/src/floor-today-store.ts:239-249,
  295-320, 375-390, 735-750, 1060-1085`, `apps/server/src/floor-today-mark-moved.ts:255-280`,
  `apps/server/src/floor-today-parts.ts:37-94`, `apps/server/src/floor-delete.ts:155-170, 195-210`,
  `apps/server/src/working-order.ts:9150-9160`, `packages/db/src/joined-parts.ts:15-179`.
- Modify (sizes): `apps/server/src/floor-plan.ts:120-145, 540-604`,
  `apps/server/src/floor-plan-sets.ts:100-134, 196-212, 283-288`,
  `apps/server/src/floor-today-parts.ts:40-80`, `apps/server/src/floor-delete.ts:203-204`.
- Modify (sets): `apps/server/src/floor-plan-sets.ts:240-288` (`floorPlanSetsFor`, `removeSets`),
  `packages/module/src/module.ts:58-61`, `packages/venue-service/src/floor-plan-set-store.ts`
  (`linkFloorPlanSet` :22-38, `insertLink` :40-55, readers :70-100, :200-212, writers :300-325,
  :390-397, `createFloorPlanSet` :253-275), `packages/venue-service/src/floor-layout-due.ts:130-150`,
  `packages/venue-service/src/menu-timetable.ts:390-402`,
  `packages/venue-service/src/service-delete.ts:300-311`,
  `packages/venue-service/src/service-delete-settings.ts:155-161`,
  `packages/venue-service/src/index.ts` (export `addFloorPlanSet`, drop `linkFloorPlanSet`).
- Modify (lists): `apps/dashboard/src/api/live-queries.ts:75,191,484-491`,
  `packages/venue-service/src/dashboard/live-queries.ts:45,97-113`,
  `packages/bookings/src/dashboard/live-queries.ts:3`,
  `apps/server/scripts/demo-seed/testing/madrid-semantics.ts:208-216`,
  `apps/server/src/testing/floor-sets.ts`, `apps/server/src/testing/floor-today-venue.ts:141`.
- Create: `scripts/a1308/fk3-design-fixtures.mjs` and `.test.mjs`.
- Generated (uncounted): core's starting migration and the epoch file.
- Docs: `docs/developers/conventions-data.md` "A zone's floor plan" (:2045-2110, the paragraphs
  naming `floor_plan_table_parts`, `department_floor_plan_sets`, `floor_reset_table_parts`), and the
  2026-10-18 key measurement paragraph (:2304-2316, add a dated line: the keys are now the four in
  Task 1's test).

## Size

| Part | Counted lines |
| --- | --- |
| Schema, lists, seam | 90 |
| Parts readers and writers (TypeScript and raw SQL in `joined-parts.ts`) | 150 |
| Sizes readers and writers | 70 |
| Sets store, readers, delete paths, transfer validator | 110 |
| Fixture script config and test | 50 |
| New tests (schema refusals and legitimate writes, §8.3 keys, layout read of a kept size) | 170 |
| Hand edits to tests (set inserts that must carry a department, `linkFloorPlanSet` callers, size reads) | 130 |
| Madrid semantics key, docs | 40 |
| Format version and the tests the assertions table lists | 25 |
| **Total** | **≈ 835** |

Uncounted: the script's output (parts and kept-size inserts in 6 test files), deletions, generated files.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/floor-plan.test.ts src/floor-plan-layouts.test.ts \
  src/floor-plan-sets.test.ts src/floor-layout-due.test.ts src/floor-reset-plan.test.ts \
  src/floor-catch-up.test.ts src/floor-today-store.test.ts src/floor-today-api.test.ts \
  src/floor-today-mark-moved.test.ts src/floor-today-reset-table.test.ts \
  src/floor-today-split.test.ts src/floor-today-split-group.test.ts src/floor-today-merges.test.ts \
  src/floor-delete.test.ts src/floor-delete.bookings.test.ts src/joined-split-layout.test.ts \
  src/joined-split-layout.rejoin.test.ts src/joined-parts.test.ts src/table-removal.test.ts \
  src/tables.test.ts src/management-api.floor-plan-sets.test.ts src/till-api.zones-layout.test.ts \
  scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db exec vitest run src/schema src/joined-parts.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/floor-plan-set-store.test.ts \
  src/floor-plan-set-routes.test.ts src/floor-layout-due.db.test.ts src/menu-timetable-routes.test.ts \
  src/service-delete.test.ts src/configuration-transfer.test.ts
pnpm --filter @waitron/bookings exec vitest run src/floor.test.ts src/bookings.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts \
  scripts/id-columns-are-references.test.ts scripts/a1308
node scripts/a1308/fk3-design-fixtures.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts') && git diff --exit-code
```

Every floor suite named passes **with its assertions unchanged** (appendix §8 item 2; rules §4).

## Expected protection-list difference

Under all six venue headers unless "change-feed only".

| Table | Lines |
| --- | --- |
| `floor_plan_table_parts` (§5: "implicit: one column per row"; index, CHECK, keys move) | `missing table floor_plan_table_parts`; `missing index floor_plan_table_parts_joined_idx`; `missing index floor_plan_table_parts_part_key`; `missing index floor_plan_table_parts.primary key(id)`; change-feed only: `missing trigger waitron_change_floor_plan_table_parts_insert`, `_update`, `_delete` |
| `floor_plan_tables` | `extra table floor_plan_tables.columns[part_of_table_id]`; `changed table floor_plan_tables.columnOrder`; `extra table floor_plan_tables.foreignKeys[part_of_table_id->floor_plan_tables(id)]`; `extra table floor_plan_tables.checks[floor_plan_tables_part_of_not_self_ck]`; `extra index floor_plan_tables_part_of_idx`; change-feed only: `changed trigger waitron_change_floor_plan_tables_update.when` |
| `floor_reset_table_parts` (same reason) | `missing table floor_reset_table_parts`; `missing index floor_reset_table_parts_joined_idx`; `missing index floor_reset_table_parts_part_key`; `missing index floor_reset_table_parts.primary key(id)`; change-feed only: three `missing trigger waitron_change_floor_reset_table_parts_*` |
| `floor_reset_tables` | `extra table floor_reset_tables.columns[part_of_reset_table_id]`; `changed table floor_reset_tables.columnOrder`; `extra table floor_reset_tables.foreignKeys[part_of_reset_table_id->floor_reset_tables(id)]`; `extra table floor_reset_tables.checks[floor_reset_tables_part_of_not_self_ck]`; `extra index floor_reset_tables_part_of_idx`; change-feed only: `changed trigger waitron_change_floor_reset_tables_update.when` |
| `floor_plan_table_sizes` (§5: "unique `floor_plan_placements(plan_id, plan_table_id)`"; width/height CHECKs were already on placements) | `missing table floor_plan_table_sizes`; `missing index floor_plan_table_sizes_plan_table_key`; `missing index floor_plan_table_sizes.primary key(id)`; change-feed only: three `missing trigger waitron_change_floor_plan_table_sizes_*` |
| `floor_plan_placements` (§5: "x, y, shape, rotation all-or-none") | `changed table floor_plan_placements.columns[x].notNull`, `[y]`, `[shape]`, `[rotation]` (each `old: true`, `new: false`); `changed table floor_plan_placements.checks[floor_plan_placements_placement_ck].expression` |
| `department_floor_plan_sets` (§5 / §6: "one home: `floor_plan_sets`") | `missing table department_floor_plan_sets`; `missing index department_floor_plan_sets_name_key`; `missing index department_floor_plan_sets_one_default_key`; `missing index department_floor_plan_sets.primary key(set_id)`; change-feed only: three `missing trigger waitron_change_department_floor_plan_sets_*` |
| `floor_plan_sets` | `extra table floor_plan_sets.columns[department_id]`, `[name]`, `[is_default]`; `changed table floor_plan_sets.columnOrder`; `extra table floor_plan_sets.foreignKeys[department_id->departments(id)]`; `extra table floor_plan_sets.checks[floor_plan_sets_name_ck]`; `extra index floor_plan_sets_name_key`; `extra index floor_plan_sets_one_default_key`; change-feed only: `changed trigger waitron_change_floor_plan_sets_update.when` |

## Stop points (beyond rules §5)

1. §8.3 prints a cascade or `SET NULL` on any key into `floor_plan_tables`: stop (the design says
   every key stays `NO ACTION`; the fallback is to make that key `NO ACTION`, which the watcher
   confirms).
2. A floor suite fails only because a part row can now be deleted alone (appendix §1.4: "a part row
   can now be deleted alone, which the link table refuses"): stop, do not add a guard.
3. A reader of placements that the plan does not list counts a kept-size row as placed.

## Needs

- fk0 (`lib/fold-inserts.mjs`), fk1 (the zone fixtures). fk2 is not needed, but lands first (lane order).
- Batch 1: 1a, 5.

## Assumptions about batch 1

B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).
Slice 5 leaves `floor_plan_sets` as `id` alone (appendix §1.5: "After A1301 removes `location_id`,
the core row would hold nothing but its id").

## In-flight work folded in

- None changes these tables (plans after 2026-11-01 searched for the four table names).
- A803's remaining pre-bills work (through A446) and A1347–A1366 change no table here.

## Assertions that change, by design

| Where | Change | Design |
| --- | --- | --- |
| `apps/dashboard/src/api/live-queries.test.ts:210, :212` | `getFloorPlan`'s `floor_plan_table_parts` → `floor_plan_tables`, `floor_plan_table_sizes` → `floor_plan_placements` (de-duplicated) | §1.2, §1.7 |
| same file `:214` | `getSalesOverview`'s `floor_reset_table_parts` → `floor_reset_tables` | §1.4 |
| same file `:1146` | `department_floor_plan_sets` → `floor_plan_sets` | §1.5 |
| `apps/server/src/service-delete.integration.test.ts:876-878` | `floor_plan_table_parts`, `floor_plan_table_sizes`, `floor_reset_table_parts` leave the snapshot list (their values are in `floor_plan_tables`, `floor_plan_placements`, `floor_reset_tables`, already listed) | §1.2, §1.4, §1.7 |
| venue-service transfer tests | error `field` values `department_floor_plan_sets.*` → `floor_plan_sets.*` (Task 4) | §1.5 |

## Global constraints

- Rules §1–§9. Every new key is `ON DELETE NO ACTION` (appendix §1.2, §1.4).
- The `floor_reset_tables` reset deletes a zone's rows in **one** statement, which the self key
  allows (appendix §1.4, tested 2026-11-04 on a stand-in); never delete parts first in a separate
  statement that leaves a part naming a deleted row.

## Review Focus

1. **A kept-size row read as a placed table.** Every reader that treated "a placement row exists"
   as "on this layout" must now ask `x is not null`. Test: Task 3's `a table taken off keeps its size
   and counts as spare`.
2. **Copying a set copies kept sizes once.** `copyLayouts` used to copy two tables; now one. Test:
   the existing `floor-plan-sets.test.ts` copy cases, assertions unchanged.
3. **A joined table split across a save:** a save that removes a part clears its
   `part_of_table_id`, and one that adds it sets it, in the same transaction as the revision move.
   Test: the existing `floor-plan.test.ts` parts cases, unchanged.
4. **A set renamed to another set's name, or a second default, in one department.** Refused by the
   indexes as before. Test: Task 1's refusal cases plus the existing store cases.
5. **Deleting a department's last set** while a zone's today record names it: `removeSets` still
   empties the recorded set (fk4 moves that record onto `floor_zones`). Test: existing
   `floor-plan-sets.test.ts`, unchanged.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0 (rules §3); keep `<A>`.

## Task 1: Schema, and the incoming-key measurement

**Interfaces (produced):** `floorPlanTables.partOfTableId: string | null`;
`floorResetTables.partOfResetTableId: string | null`; `floorPlanPlacements.x/y/shape/rotation`
nullable; `floorPlanSets.departmentId: string`, `name: string`, `isDefault: boolean`.

- [ ] **Step 1: Write the failing tests** in `packages/db/src/schema/floor-plans.test.ts`
  (constraint name in each refusal; a legitimate write beside each):
  - `refuses a design table that is part of itself` (`floor_plan_tables_part_of_not_self_ck`);
    `stores a part naming its joined table` (succeeds).
  - `refuses a part naming a table that does not exist` (`FOREIGN KEY constraint failed`).
  - `refuses deleting a joined table its parts still name`; `deletes a zone's design tables in one
    statement` (succeeds) — the two halves of appendix §1.4's stand-in, on the real tables, for both
    `floor_plan_tables` and `floor_reset_tables`.
  - `refuses a placement with x but no shape` (`floor_plan_placements_placement_ck`); `stores a
    kept size with no place` (x, y, shape, rotation null; width 4, height 2: succeeds); `refuses a
    kept size with no width` (`NOT NULL constraint failed`).
  - `refuses two sets of one name in a department` (`floor_plan_sets_name_key`); `refuses a second
    default` (`floor_plan_sets_one_default_key`); `refuses a blank set name` (`floor_plan_sets_name_ck`);
    `allows the same name in two departments` (succeeds).
  - **§8.3 (the `floor_plan_tables` half):** `every key into floor_plan_tables is ON DELETE NO
    ACTION` — read `pragma_foreign_key_list` for every table of a fully migrated database
    (`useVenueDb` with `migrationOptionsFor(manifestSets(), null)`), keep the rows whose `table` is
    `floor_plan_tables`, and assert the set of `(from table, from column, on_delete)` equals
    `{(dining_tables, plan_table_id, NO ACTION), (floor_plan_placements, plan_table_id, NO ACTION),
    (floor_reset_tables, plan_table_id, NO ACTION), (floor_plan_tables, part_of_table_id, NO ACTION)}`.
    **Failing result named in advance:** any other `on_delete`, or a key missing or extra. The
    design's fallback is to declare that key `NO ACTION`; stop point 1.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/floor-plans.test.ts`;
  expect fail.
- [ ] **Step 3: Implement.** Self keys use a lazy reference (`(): AnySQLiteColumn =>
  floorPlanTables.id`) and no `onDelete`. Indexes `floor_plan_tables_part_of_idx` on
  `part_of_table_id` and `floor_reset_tables_part_of_idx` on `part_of_reset_table_id`; checks
  `…_part_of_not_self_ck` as `<column> <> id`. Placements: drop `.notNull()` from the four columns;
  replace `...placeChecks("floor_plan_placements", t)` with the six range/enum checks it makes (same
  names) plus `floor_plan_placements_placement_ck` over x, y, shape, rotation only (export a
  `fourPlacedCheck` beside `placeChecks`). Sets: the three columns, `foreignKey` to `departments.id`
  (lazy reference: `departments` is in `venue-service/service.ts`), `uniqueIndex(
  "floor_plan_sets_name_key").on(t.departmentId, t.name)`, `uniqueIndex(
  "floor_plan_sets_one_default_key").on(t.departmentId).where(sql\`${t.isDefault}\`)`,
  `check("floor_plan_sets_name_ck", sql\`trim(${t.name}) <> ''\`)` — the old table's three
  protections under new names. Delete the three side tables and `department_floor_plan_sets`, their
  exports, classifications, transfer entries and `schema-constraints.test.ts` rows; add rows for the
  three new keys.
- [ ] **Step 4: Rebuild** core; run Step 2; expect pass. **Commit.**

## Task 2: The fixture script

- [ ] **Step 1:** `scripts/a1308/fk3-design-fixtures.mjs` runs `runFoldCli` with
  `{ child: "floorPlanTableParts", parent: "floorPlanTables", key: "partTableId", fields: {
  joinedTableId: "partOfTableId", id: null } }` and `{ child: "floorResetTableParts", parent:
  "floorResetTables", key: "partResetTableId", fields: { joinedResetTableId: "partOfResetTableId",
  id: null } }`, plus one extra rule: an `insert(floorPlanTableSizes)` becomes
  `insert(floorPlanPlacements)` with the same values (the kept-size row), and its import follows.
  Inserts of `floorPlanSets` and `departmentFloorPlanSets` are reported, not rewritten: a set row now
  needs its department and name in its own insert.
- [ ] **Step 2:** Its test (one case per rule, a report case, idempotence); run it; then run the
  script with `--write`, prettier, hand-edit the reports (each set insert gains `departmentId`,
  `name`, `isDefault` from the department-set insert that followed it, which is deleted; each
  `linkFloorPlanSet(tx, { setId, departmentId, name })` after `floorPlanSetsFor().create(tx)`
  becomes `addFloorPlanSet(tx, { departmentId, name })` from Task 4). List hand edits in the pull
  request. **Commit** script + output, then hand edits.

## Task 3: Parts and kept sizes

**Interfaces:**
- `layoutTables(tx, zoneId, planId)` (`floor-plan.ts:111-156`) keeps its answer: each design table
  with `partOf`, its place when the layout's row has `x` set, and its kept width and height when the
  row exists with `x` null.
- The raw SQL in `packages/db/src/joined-parts.ts` and `working-order.ts:9150-9160` is rewritten by
  one rule: a join `floor_reset_table_parts p on p.part_reset_table_id = R.id` becomes a read of
  `R.part_of_reset_table_id`, and `p.joined_reset_table_id = J.id` becomes
  `R.part_of_reset_table_id = J.id`; the same for `floor_plan_table_parts` with
  `part_of_table_id`. "The parts of J" becomes `select … from floor_reset_tables R where
  R.part_of_reset_table_id = J.id`.

- [ ] **Step 1: Write the failing tests** (`apps/server/src/floor-plan.test.ts`):
  - `a table taken off keeps its size and counts as spare` — save a layout with table T placed at
    4×2, save again with T off: `readLayout` shows T unplaced with width 4, height 2;
    `readLayouts` counts it `spare`, not `onPlan`; the layout holds one `floor_plan_placements` row
    for T with `x` null.
  - `placing a kept table again drops nothing but its place` — save T back on at (3, 5): one row,
    `x = 3`, size unchanged unless sent.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** `writeSave` (`floor-plan.ts:498-638`): delete every placement row of a deleted
  design table, in any layout (as `:529-534` does today: "A deleted table may stand in another set's
  layout of the zone too"; a row left in another set's layout would make the design table's delete
  refused by its key), and the saved layout's own rows; then write one row per (plan, table) — placed values for tables on the layout,
  `x/y/shape/rotation` null with the kept width and height for tables taken off (where the code
  inserted `floorPlanTableSizes` at :598), using one upsert on `(plan_id, plan_table_id)`; parts:
  clear `part_of_table_id` for the zone's tables, then set it from the save's parts (the delete at
  :517-521 and insert at :628). `floor-plan-sets.ts`: `copyLayouts` copies placement rows only;
  `readLayouts` counts `onPlan` from rows with `x is not null` and always reads `partOf` from
  `floor_plan_tables` (delete the two-branch read at :164-185 and its comment);
  `deletePlans` deletes placements only. `floor-today-store.ts`: the reset (:239-249) deletes the
  zone's reset rows in one statement; `copyParts` (:295-320) sets `part_of_reset_table_id` with one
  `update … where id in (…)` per joined row; the reads at :375-390, :735-750 and the SQL at
  :1060-1085 follow the rule above. `floor-today-mark-moved.ts:255-280` and
  `floor-today-parts.ts:37-94` follow it too (`floor-today-parts` reads the placement row's width and
  height whether or not it is placed, where it read both tables). `floor-delete.ts:155-170` deletes
  the zones' reset rows in one statement; :195-210 clears `part_of_table_id` on the doomed design
  tables before deleting them and drops the sizes delete.
- [ ] **Step 4: Run** the Finish-line server command; expect pass, assertions unchanged.
- [ ] **Step 5: Commit.**

## Task 4: Set names on the set row

**Interfaces:**
- `FloorPlanSets` (`packages/module/src/module.ts:58`) loses `create`; `floorPlanSetsFor()`
  (`apps/server/src/floor-plan-sets.ts:250-262`) drops it.
- `addFloorPlanSet(tx: Transaction, input: { departmentId: string; name: string }):
  Promise<string>` replaces `linkFloorPlanSet` (exported from `@waitron/venue-service`): checks the
  department is active (`department.not_found`), refuses a held name (`floor_plan_set.name_taken`,
  as `insertLink` does), inserts the `floor_plan_sets` row with `isDefault` true when the department
  has none, answers its id.
- `createFloorPlanSet(tx, core, input)` calls `addFloorPlanSet` where it called `core.create` and
  `insertLink` (:271-272).

- [ ] **Step 1: Write the failing test** (`floor-plan-set-store.test.ts`): `a new set is one row
  with its department, name and default` — `addFloorPlanSet` twice in one department: two
  `floor_plan_sets` rows, the first `is_default = 1`, the second `0`; a third with a held name is
  refused `floor_plan_set.name_taken`.
- [ ] **Step 2: Run**; expect fail.
- [ ] **Step 3: Implement.** Every `departmentFloorPlanSets` read becomes a `floorPlanSets` read with
  `setId` → `id` (`floor-plan-set-store.ts`, `floor-layout-due.ts:130-150`,
  `menu-timetable.ts:390-402`, `service-delete.ts:300-311`, `service-delete-settings.ts:155-161`);
  writers at `floor-plan-set-store.ts:300-325` update `floorPlanSets`; :390-397's delete goes
  (`removeSets` deletes the row). `configuration-transfer.ts:107-119` validates
  `floor_plan_sets.department_id`, `.name`, `.is_default` (field names `floor_plan_sets.<column>`,
  the only assertion changes this task allows; list them). `madrid-semantics.ts:208-216` keys a set
  by its own `department_id` and `name`.
- [ ] **Step 4: Run** the Finish-line venue-service command; expect pass.
- [ ] **Step 5: Commit.**

## Task 5: Lists, Madrid baseline, docs, finish

- [ ] **Step 1:** Live-query lists: drop `floor_plan_table_parts`, `floor_plan_table_sizes`,
  `floor_reset_table_parts`, `department_floor_plan_sets`; make sure each read that named one still
  names its parent (`floor_plan_tables`, `floor_plan_placements`, `floor_reset_tables`,
  `floor_plan_sets`). Madrid baseline: fold the parts tables (match `part_table_id` → `id`, column
  `joined_table_id` → `part_of_table_id`; reset parts likewise), sizes (rows become placement rows
  with null place — if fk1's helper cannot express a row move, add a `moveRows` option to it), and
  `department_floor_plan_sets` (match `set_id` → `id`; `department_id`, `name`, `is_default`).
- [ ] **Step 2:** Raise the bundle format version by one from `main`'s value
  (`packages/provisioning/src/configuration-transfer.ts:123, 160, 473-476`), with a case that the old
  number is refused `setup.configuration_outdated`. Docs as listed under Files.
- [ ] **Step 3: Protection list** compare; paste and mark.
- [ ] **Step 4:** Finish line; `/finish-branch`.
