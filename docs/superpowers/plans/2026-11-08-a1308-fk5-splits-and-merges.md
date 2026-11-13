# A1308 fk5 — today's splits and merges live on the live table; `floor_today_joins` becomes `table_merges`: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

**Amendment, 2026-11-11:** restore main's reviewed storage fold. The watcher at Lane E
`questions.md` 22:22 cleared [PR A: stale splits](2026-11-11-a1308-fk5-stale-split.md) and
[PR B: ordinary groups](2026-11-11-a1308-fk5-ordinary-groups.md) before fk3, fk4 and this fold.
Sol drafted those plans; Claude reviewed the prior combined revision (491 s, verdict CHANGE);
the driver corrected F1–F7; the watcher cleared splitting, staging and publication with no further
read. No owner approval of these detailed plans is claimed. The watcher's 17:12 interpretation of
the owner's R1 Proposal 3 “yes” withdraws split-origin storage. Struck text below is no longer work
to build. After PR B, no code reads or writes `floor_today_split_parts`; references remain only in
schema, exports, classification and transfer lists (excluding generated migrations). Its removal
here is a pure deletion. Reconcile the historical consumer/test paths below with PR B's retirements;
port only surviving merge work. Original size figures below predate that deletion; all predictions
remain unverified and are checked on the selected base.

**Current-main reconciliation, 2026-11-13:** the watcher cleared this bounded port in
Lane E `questions.md` at 03:15. fk4b's four merge columns join the `dining_tables` quiet
group; surviving today-merge subscription readers use `dining_tables.today`, retaining their
base interests and the old twelve-reader set. Transfers/menu keep the cleared polling choice.
The preflight predicted both update-trigger `.when` and `.body`. The measured comparison changes
only `.when`: the trigger body tests the unchanged complement of saved columns. Classification and till
`live-connection` dependency assertions follow the retired table names. The exact column
inventory in `packages/db/src/schema/dining-tables.test.ts` gains only the four `merge_*`
columns; `apps/server/src/backup-verification-target.test.ts`'s steady pin changes only for
the two retired tables and the merge rename, with the inventory difference checked first.
These are storage assertion ports; every changed expectation is listed in the pull request.
At 04:03 the watcher also cleared excluding `seed.madrid-baseline.test.ts` from the rename CLI:
its adapter reads the frozen capture's historical names, while the capture files stay byte for byte.

**Goal:** the last two of the floor's seven tables retire; surviving merge membership folds into `dining_tables`:
~~`floor_today_split_parts` (a part split off its joined table today) becomes
`dining_tables.split_from_table_id`~~; delete that dormant table instead, and `floor_today_join_tables` (a table in one of today's merges,
with where it stood before) becomes `dining_tables.merge_id` and `merge_before_x/_y/_rotation`.
`floor_today_joins` (the merge itself: its name and seats) is renamed `table_merges` (design U9).

**Architecture:** ~~`floor_today_split_parts_part_key`~~ retires with its table; merge membership is
unique on the live table (`floor_today_join_tables_table_key`). A committed rename script renames the merge table everywhere in
code; the fixture script folds test inserts. After this pull request a physical table is three rows:
its design, its live row, its reset copy (README §4).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) U9 (the rename);
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.3 (split and merge groups,
the merge CHECKs, ~~`deleteWithItsSplit`~~), §1.8, §5, §8 items 2 and 3 (`dining_tables` half).

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6).

## What it builds

- ~~`dining_tables.split_from_table_id` (self key, `NO ACTION`, not-self CHECK, index);~~
  `dining_tables.merge_id` (key to `table_merges`, index) and `merge_before_x`, `merge_before_y`,
  `merge_before_rotation` with their range CHECKs and a CHECK that the three are set exactly when
  `merge_id` is (appendix §1.3, new); `dining_tables_off_floor_ck` gains `merge_id is null`.
- `floor_today_joins` → `table_merges` with its index, key and seats CHECK renamed
  (`table_merges_zone_idx`, `table_merges_seats_ck`).
- `floor_today_split_parts` and `floor_today_join_tables` are deleted.
- `scripts/a1308/fk5-rename-merges.mjs` (rename, rules §1) and `scripts/a1308/fk5-split-merge-fixtures.mjs`
  (test inserts).
- §8.3 for `dining_tables`: every key into it is `ON DELETE NO ACTION`.
- The export leaves out ~~`split_from_table_id` and~~ the four `merge_*` columns; `table_merges` is not
  exported (neither was `floor_today_joins`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| Anything outside the floor | — |
| Renaming code identifiers that say "join" for a merge (`writeMerge`'s locals, `joinId` fields outside the floor helpers) | not renamed: the rename covers the table and its Drizzle object only |

## Files

- Modify: `packages/db/src/schema/dining-tables.ts`, `packages/db/src/schema/floor-plans.ts`
  (`floorTodayJoins` :348-366 renamed `tableMerges`; delete `floorTodayJoinTables` :368-395 and
  `floorTodaySplitParts` :397-418), `packages/db/src/index.ts`, `packages/db/src/classification.ts:132-134`,
  `packages/db/src/configuration-transfer.ts:78-80`, `scripts/schema-constraints.test.ts:164-168`,
  `packages/db/src/floor-today-columns.ts` (fk4's helpers gain `mergeOf` and `LEFT_MERGE`).
- Modify (call sites; `git grep -n -w -e floorTodaySplitParts -e floorTodayJoinTables -e
  floor_today_split_parts -e floor_today_join_tables -- apps packages ':!*.test.ts'` lists every
  line): `apps/server/src/floor-today-merges.ts`, `floor-revision.ts:82-95`, `floor-today-store.ts`
  (:428-431, :735-756, :905-912, :1235-1245, :1265-1300), `floor-today-split.ts`,
  `floor-today-split-group.ts`, `floor-today-reset-table.ts`, `floor-today-name.ts`,
  `floor-today-mark-moved.ts`, `floor-today-table.ts`, `floor-today-parts.ts:48-53`,
  `floor-delete.ts:60-75, 184-188`, `table-removal.ts:110-130`, `working-order.ts:9142-9170`,
  `packages/db/src/joined-parts.ts:43-58, 71, 100-101`, `packages/db/src/party-table-labels.ts:15-60`,
  `apps/server/src/testing/floor-today-venue.ts`.
- Modify (lists): `apps/dashboard/src/api/live-queries.ts`, `packages/venue-service/src/dashboard/live-queries.ts`.
- Create: `scripts/a1308/fk5-rename-merges.mjs` and `.test.mjs`, `scripts/a1308/fk5-split-merge-fixtures.mjs`
  and `.test.mjs`.
- Generated (uncounted): core's starting migration and the epoch file.
- Docs: `docs/developers/conventions-data.md` :2203-2205 ("A part split off today (a
  `floor_today_split_parts` row)"), :2244 (`floor_today_joins.name`), the incoming-keys paragraph
  (:2294-2303: add a dated line naming the keys Task 1's test lists), and every other sentence in "A
  zone's floor plan" naming the three tables.

## Size

| Part | Counted lines |
| --- | --- |
| Schema, helpers, lists | 80 |
| ~~Split call sites~~ | ~~70~~ |
| Merge call sites (`floor-today-merges.ts` holds most) | 150 |
| Raw SQL (`joined-parts.ts`, `working-order.ts`) | 30 |
| Rename script and test | 50 |
| Fixture script config and test | 40 |
| New tests (schema, §8.3, ~~`deleteWithItsSplit`~~, merge end) | 160 |
| Hand edits to tests (reads and deletes the scripts report) | 140 |
| Docs | 25 |
| The tests the assertions table lists | 15 |
| **Total** | **≈ 760** |

Uncounted: both scripts' output (the rename touches about 45 files; the folds 17 test files),
deletions, generated files.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/floor-*.test.ts src/joined-split-layout.test.ts \
  src/joined-parts.test.ts src/table-removal.test.ts \
  src/tables.test.ts src/till-api.tables.test.ts src/till-api.split-bill.test.ts \
  src/till-api.table-actions.test.ts src/today-names.test.ts src/working-order.test.ts \
  src/configuration-transfer.floor-kitchen.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db exec vitest run src/schema src/joined-parts.test.ts src/party-table-labels.test.ts \
  src/floor-today-columns.test.ts
pnpm --filter @waitron/bookings exec vitest run src/floor.test.ts src/table-removal.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/live-today-wake.test.ts \
  scripts/starting-migrations.test.ts scripts/id-columns-are-references.test.ts scripts/a1308
node scripts/a1308/fk5-rename-merges.mjs && node scripts/a1308/fk5-split-merge-fixtures.mjs --write $(git ls-files '*.test.ts' 'apps/*/src/testing/*.ts' 'packages/*/src/testing/*.ts') && git diff --exit-code
```

Every floor suite (appendix §8 item 2) passes with its assertions unchanged. If the bench has
landed, `bench compare` base against branch shows `same` or `faster` for `floor.read` and
`floor.open`.
(2026-11-10: the bench no longer runs per slice; a `Sale-path read changed:` line in the pull
request takes this step's place. See
[when the bench runs](../../developers/testing-guide.md#when-the-bench-runs).)

## Expected protection-list difference

Under all six venue headers unless "change-feed only".

| Table | Lines |
| --- | --- |
| `floor_today_split_parts` (pure deletion after PR B; no split-origin column or replacement protections) | `missing table floor_today_split_parts`; `missing index floor_today_split_parts_joined_idx`; `missing index floor_today_split_parts_part_key`; `missing index floor_today_split_parts.primary key(id)`; change-feed only: three `missing trigger waitron_change_floor_today_split_parts_*` |
| `floor_today_join_tables` (§5: key and table FK "implicit: same row"; join FK and before-CHECKs move) | `missing table floor_today_join_tables`; `missing index floor_today_join_tables_table_key`; `missing index floor_today_join_tables.primary key(id)`; change-feed only: three `missing trigger waitron_change_floor_today_join_tables_*` |
| `floor_today_joins` → `table_merges` (§5: "kept on `table_merges`") | `missing table floor_today_joins`; `missing index floor_today_joins_zone_idx`; `missing index floor_today_joins.primary key(id)`; `extra table table_merges`; `extra index table_merges_zone_idx`; `extra index table_merges.primary key(id)`; change-feed only: three `missing trigger waitron_change_floor_today_joins_*` and three `extra trigger waitron_change_table_merges_*` |
| `dining_tables` | ~~`extra table dining_tables.columns[split_from_table_id]`~~; `extra table dining_tables.columns[merge_id]`, `[merge_before_x]`, `[merge_before_y]`, `[merge_before_rotation]`; `changed table dining_tables.columnOrder`; ~~`extra table dining_tables.foreignKeys[split_from_table_id->dining_tables(id)]`~~; `extra table dining_tables.foreignKeys[merge_id->table_merges(id)]`; ~~`extra table dining_tables.checks[dining_tables_split_from_not_self_ck]`~~; `extra table dining_tables.checks[dining_tables_merge_before_x_ck]`, `[dining_tables_merge_before_y_ck]`, `[dining_tables_merge_before_rotation_ck]`, `[dining_tables_merge_before_ck]`; `changed table dining_tables.checks[dining_tables_off_floor_ck].expression`; ~~`extra index dining_tables_split_from_idx`~~; `extra index dining_tables_merge_idx`; change-feed only: `changed trigger waitron_change_dining_tables_update.when` and `.body` |

`dining_tables_merge_idx` is not in the appendix: `floor_today_join_tables` had no index on
`join_id`, but members are now found by `merge_id` and a merge's delete checks the key, so it is
added; say so in the pull request.

## Stop points (beyond rules §5)

1. §8.3 lists a cascade or `SET NULL` into `dining_tables`, or a key the test's list does not name.
2. A merge or split suite passes only with a changed assertion (appendix §8 item 2).
3. The rename script would rename a string that is not the table or its Drizzle object (for example
   inside a translation file or a recorded fixture): stop and list it.

## Needs

- fk4 (the `dining_tables` today columns and `dining_tables_off_floor_ck`, `floor-today-columns.ts`,
  `scripts/live-today-wake.test.ts`; fk4b too, if §8.7 failed), fk3, fk1, fk0 (the fixture library).
- Batch 1: 1a, 5.

## Assumptions about batch 1

B1, B3, B4 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1). Rename
scripts follow 1a's convention for "re-run on the base and compare" (rules §1); this plan assumes the
reviewer runs `node scripts/a1308/fk5-rename-merges.mjs` on the base and diffs.

## In-flight work folded in

- A1347, A1348, A1352, A1362, A1365 (after a split, `docs/backlog/till.md`) change no table and
  rebase; the room revision they read keeps its meaning.
- A1349 (take-over rows only in Split a table) changes no table.

## Assertions that change, by design

The rename script turns every `floor_today_joins` into `table_merges` in these files; the rest is
by hand.

| Where | Change | Design |
| --- | --- | --- |
| `apps/dashboard/src/api/live-queries.test.ts:107-108`, `:215-216`, `:1033-1034`, `:1110-1111` | `floor_today_join_tables`, `floor_today_split_parts` → `dining_tables` (de-duplicated); `floor_today_joins` → `table_merges` (script) | §1.3, §1.8, U9 |
| `apps/server/src/table-removal.test.ts:366-373` (`LETS_GO`) | the `floor_today_join_tables.table_id` and both `floor_today_split_parts` entries go; ~~`"dining_tables.split_from_table_id": "deleteWithItsSplit"` is added (the one new key into `dining_tables`)~~ | §1.3, §5 |
| `apps/server/src/service-delete.integration.test.ts:882-884` | `floor_today_join_tables`, `floor_today_split_parts` leave the snapshot list; `floor_today_joins` becomes `table_merges` (script) | §1.3, §1.8 |
| `apps/server/src/floor-delete.bookings.test.ts:77-78` | `floor_today_join_tables` leaves the list; `floor_today_joins` becomes `table_merges` (script) | §1.3, §1.8 |

## Global constraints

- Rules §1–§9. Every key stays `NO ACTION` (conventions-data.md: "Cascading here would allow removal
  to discard the records the release and refusal paths must handle").
- A merge ends in two statements, in this order: clear the members (`LEFT_MERGE`), then delete the
  `table_merges` row; the reverse is refused by the key.

## Review Focus

1. ~~**A table hidden while split** keeps `split_from_table_id` (appendix §1.3: deliberately outside the
   off-floor CHECK). Test: Task 3's `a hidden part still names its joined table`.~~
2. ~~**Removing a joined table that parts still name** clears their `split_from_table_id`, deletes the
   table, and restores the values if the delete is refused again (`deleteWithItsSplit`). Test:
   Task 3.~~
3. **A merge's members leaving one by one** (Back to saved place, take off) until one remains, then
   the merge ends. Test: existing `floor-today-merges.test.ts`, unchanged.
4. **Taking a merged table off today's map** must leave the merge first, or the off-floor CHECK
   refuses it. Test: existing take-off cases, unchanged (they pass only if `leaveMerges` runs first,
   which `hideTable` does, `floor-today-store.ts:845-848`).
5. **The room's print** still reads the merge's name and seats ~~and the split~~. Test: existing
   `floor-revision.test.ts`, unchanged.

---

## Task 0: Base protection list

- [ ] As fk1 Task 0; keep `<A>`.

## Task 1: Schema, the rename, and §8.3

**Interfaces (produced):** `tableMerges` (was `floorTodayJoins`: `id`, `zoneId`, `seats`, `name`);
~~`diningTables.splitFromTableId`~~, `diningTables.mergeId`, `mergeBeforeX`, `mergeBeforeY`, `mergeBeforeRotation`;
in `floor-today-columns.ts`: `mergeOf = { tableId: diningTables.id, mergeId: diningTables.mergeId,
beforeX: diningTables.mergeBeforeX, beforeY: …, beforeRotation: … }`, `type MergeMember`,
`LEFT_MERGE = { mergeId: null, mergeBeforeX: null, mergeBeforeY: null, mergeBeforeRotation: null }`.

- [ ] **Step 1: The rename script.** `scripts/a1308/fk5-rename-merges.mjs` replaces, as whole words,
  `floor_today_joins` → `table_merges`, `floorTodayJoins` → `tableMerges`,
  `floor_today_joins_zone_idx` → `table_merges_zone_idx`, `floor_today_joins_seats_ck` →
  `table_merges_seats_ck`, `floor_today_joins_zone_fk` → `table_merges_zone_fk`, in tracked `*.ts`,
  `*.mjs` and `*.json` files under `apps/`, `packages/` and `scripts/`, skipping `*/drizzle/*`,
  `scripts/migration-baseline-epoch.json`, `packages/country-es/test-fixtures/**` and
  `scripts/a1308/**`. Its test: each pattern on a fixture string; `floor_today_join_tables` is not
  touched; running twice equals running once. Run it; commit its output alone.
- [ ] **Step 2: Write the failing schema tests** (`packages/db/src/schema/dining-tables.test.ts`):
  ~~`refuses a table split from itself` (`dining_tables_split_from_not_self_ck`); `stores a part
  split from its joined table` (succeeds);~~ `refuses a merge member with no before-place`
  (`dining_tables_merge_before_ck`); `refuses a before-place with no merge` (same); `refuses a merge
  on a table off the floor` (`dining_tables_off_floor_ck`); `refuses ending a merge that members
  still name` (`FOREIGN KEY constraint failed` on deleting the `table_merges` row first); `ends a
  merge members first` (succeeds).
  **§8.3:** `every key into dining_tables is ON DELETE NO ACTION` — on a fully migrated database
  (`migrationOptionsFor(manifestSets(), null)`), read `pragma_foreign_key_list` for every table and
  assert the keys whose parent is `dining_tables` are exactly `{(party_tables, table_id),
  (working_orders, delivery_table_id), (floor_reset_tables, table_id), (bookings, table_id)}`
  ~~plus `(dining_tables, split_from_table_id)`~~, each `NO ACTION`. **Failing result named in advance:** any
  other `on_delete`. A different set (another area added a key) is stop point 1, not a failure of
  the design.
- [ ] **Step 3: Run**; expect fail.
- [ ] **Step 4: Implement.** ~~Self key and~~ merge key with lazy references; checks
  `merge_before_x/y` via `rangeCheck(…, 0, 999)`, rotation via the rotation check (export
  `rotationCheck` from `floor-plans.ts`); `dining_tables_merge_before_ck`: `(merge_id is null) =
  (merge_before_x is null) and (merge_id is null) = (merge_before_y is null) and (merge_id is null) =
  (merge_before_rotation is null)`; add `and merge_id is null` to the off-floor CHECK's second arm;
  indexes ~~`dining_tables_split_from_idx`,~~ `dining_tables_merge_idx`. Delete the two side tables;
  update exports, classifications (`table_merges` replaces `floor_today_joins`), transfer `omit`
  (`dining_tables` gains ~~`split_from_table_id`,~~ `merge_id`, `merge_before_x`, `merge_before_y`,
  `merge_before_rotation`), and `schema-constraints.test.ts` rows (~~add `["dining_tables",
  ["split_from_table_id"], "dining_tables"]`~~ is withdrawn; add `["dining_tables", ["merge_id"], "table_merges"]`).
- [ ] **Step 5: Rebuild** core; run Step 3's tests; expect pass. **Commit.**

## Task 2: The fixture script

- [ ] `scripts/a1308/fk5-split-merge-fixtures.mjs`: ~~`{ child: "floorTodaySplitParts", parent:
  "diningTables", key: "partTableId", fields: { joinedTableId: "splitFromTableId", id: null } }` and~~
  `{ child: "floorTodayJoinTables", parent: "diningTables", key: "tableId", fields: { joinId:
  "mergeId", beforeX: "mergeBeforeX", beforeY: "mergeBeforeY", beforeRotation:
  "mergeBeforeRotation", id: null } }`. Test, run with `--write`, prettier, hand-edit the reports by
  Task 3's rules, list them. **Commit** script + output, then hand edits.

## Task 3: Call sites

| Old | New |
| --- | --- |
| ~~`leftJoin(floorTodaySplitParts, eq(floorTodaySplitParts.partTableId, diningTables.id))`, reading `joinedTableId`~~ | ~~`diningTables.splitFromTableId`, no join~~ |
| ~~"the parts split off J": `from(floorTodaySplitParts).where(eq(…joinedTableId, J))`~~ | ~~`from(diningTables).where(eq(diningTables.splitFromTableId, J))`~~ |
| ~~insert a split row `{ joinedTableId: J, partTableId: P }`~~ | ~~`update(diningTables).set({ splitFromTableId: J }).where(eq(diningTables.id, P))`~~ |
| ~~delete split rows where joined in `putBack`~~ | ~~`update(diningTables).set({ splitFromTableId: null }).where(inArray(diningTables.splitFromTableId, putBack))`~~ |
| `leftJoin(floorTodayJoinTables, …tableId…)` reading `joinId`, `beforeX/Y/Rotation` | `mergeOf.<field>`, no join |
| `leftJoin(tableMerges, eq(tableMerges.id, floorTodayJoinTables.joinId))` | `leftJoin(tableMerges, eq(tableMerges.id, diningTables.mergeId))` |
| insert member `{ joinId, tableId, beforeX, beforeY, beforeRotation }` | `update(diningTables).set({ mergeId, mergeBeforeX, mergeBeforeY, mergeBeforeRotation }).where(eq(diningTables.id, tableId))` |
| delete members of a merge, then the merge | `update(diningTables).set(LEFT_MERGE).where(eq(diningTables.mergeId, M))`, then `delete(tableMerges)` |
| ~~raw SQL `floor_today_split_parts s … s.part_table_id = X`~~ | ~~`X`'s row: `… .split_from_table_id is not null` (or `= J` for the joined side)~~ |
| raw SQL `floor_today_join_tables m … m.table_id = X` | `X`'s row: `… .merge_id is not null` |

~~`deleteWithItsSplit` (`table-removal.ts:110-130`): clear `splitFromTableId` on the rows naming the
table (`returning` their ids); if none, answer `false`; retry the delete; refused again, set
`splitFromTableId` back to the table on those ids and answer `false` (appendix §1.3). The table's own
`split_from_table_id` no longer blocks its delete and needs no step.~~

~~**Step 1: Write the failing tests** (`apps/server/src/table-removal.test.ts`,
  `floor-today-split.test.ts`): `removing a joined table its parts name clears the parts and deletes
  it`; `a refused removal puts the parts' split back` (a booking holds the table, so the retry is
  refused: afterwards both parts still name it); `a hidden part still names its joined table`
  (`hideTable` on a split part: `on_floor = 0`, `split_from_table_id` unchanged).~~
- [ ] **Step 3: Implement** the surviving merge rows above; the split-only red step is withdrawn.
- [ ] **Step 4: Run** the Finish-line commands; every floor suite passes unchanged. **Commit.**

## Task 4: Lists, Madrid baseline, docs, finish

- [ ] Live-query lists: drop `floor_today_split_parts`, `floor_today_join_tables`; the rename made
  `floor_today_joins` into `table_merges`; each read that named a dropped table names `dining_tables`
  (and `table_merges` where it named the merge). `scripts/live-today-wake.test.ts`'s pinned list
  follows. Madrid baseline: ~~fold split rows (`part_table_id` → `id`)~~; drop the empty split
  snapshot entry and fold merge-member rows into `dining_tables` (`table_id` → `id`), rename `floor_today_joins` to `table_merges` in the expected snapshot
  (the seed writes no row to any of the three).
- [ ] Docs as listed under Files. Protection list compare; paste and mark. Finish line;
  `/finish-branch`.
