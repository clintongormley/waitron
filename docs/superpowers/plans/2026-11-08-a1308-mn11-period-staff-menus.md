# A1308 menu and photos, PR mn11: a period's staff menus are a list on the period — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** `menu_period_staff_menus` becomes `menu_periods.staff_menu_ids`, a JSON list of menu ids in
display order, carried through a configuration export and import by slice dv0's shared JSON-list
machinery so the ids arrive as the importing venue's.

**Architecture:** README R4's exception: a short list owned by one row may be JSON (owner,
2026-11-04). Its cost is stated here and paid here: the database no longer refuses an unknown menu
id in the list (code does, and menus are never deleted), and the import must rewrite ids inside the
list, which dv0 provides through a `jsonReferences` declaration. Reads that joined the side table
read the list with `json_each`, ordered by its position.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Vitest, slice 1a's rebuild command, dv0's
`jsonReferences` and `jsonShapeCheck`.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R4;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §1.21, §5 (the
`menu_period_staff_menus` and `menu_periods` rows), §8 item 5;
[dv0](2026-11-08-a1308-dv0-json-list-references.md) (its "Interfaces" in Task 1 and the clearing helper
in Task 4); [slice rules](2026-11-08-a1308-slice-rules.md).

**Base and names:** cites are `file:line` at `a086eedfb7` with mn1/mn3's paths and names (`menus` is
today's `catalogues`; `menuId: menuId` in an error's params was `catalogueId: menuId`). Batch 1,
dv0 and mn1–mn10 have landed. A missing identifier this plan does not explain is a stop (rules §5.1).

**Who lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. **`menu_periods.staff_menu_ids`**, json not null default `[]`, with CHECK
   `menu_periods_staff_menu_ids_ck` = `jsonShapeCheck(t.staffMenuIds, "array")` (dv0). The side table
   `menu_period_staff_menus` goes (`packages/db/src/schema/venue-service/menus.ts:47-68`), with its
   copied `department_id` and `display_order` (tables-menu.md §1.21). `menu_periods_department_key`
   stays: `department_day_ranges` and `routing_cell_periods` still target it (§1.21).
2. **Writes.** `writeMenuPeriod` (`packages/venue-service/src/menu-timetable.ts:340-426`) keeps every
   check it has (an array, no duplicate, not the period's own menu, each menu active and existing,
   `:353-364`) and writes the list in the period's own insert or update; the delete-and-insert of
   side rows (`:414-424`) goes. `placeOpenPeriod` (`:77-95`) writes `[]` as today.
3. **Reads** (each keeps its output and order):
   - `departmentDay` (`menu-timetable.ts:183-190`), `updateMenuPeriod` (`:433-449`),
     `readOpeningHoursModel` (`:684-690`, `:734`), `packages/venue-service/src/routing-periods.ts:45-53`:
     read `staff_menu_ids` from the period rows they already load.
   - `zonePeriodMembership` (`packages/venue-service/src/operations.ts:804-841`): the staff query joins
     `json_each(menu_periods.staff_menu_ids)` and `menus` on `menus.id = json_each.value` with
     `menus.active = 1`, ordered by period name, period id, then `json_each.key` (the list's position,
     which is today's `display_order`). This read is on the path that resolves a zone's menus for a
     till; its cost is measured in Task 3.
   - `service-delete-settings.ts:161-164` (what a department delete would remove) counts the lists'
     ids instead of side rows; the delete at `:405-408` goes, since deleting the periods (`:410`)
     takes their lists.
4. **Configuration export and import.** The `menu_periods` entry
   (`packages/venue-service/src/configuration-transfer.ts:714`) gains
   `jsonReferences: [{ column: "staff_menu_ids", paths: [["*"]] }]` (dv0's declaration); the
   `menu_period_staff_menus` entry (`:715`) goes. The import check (`:136-155`) moves onto the list:
   for each period, refuse `menu_periods.staff_menu_ids` when the value is not an array of strings,
   repeats an id, holds the period's own menu or names a menu the bundle lacks; the order check
   (`display_order`) has nothing left to check. dv0's export drops an id naming no exported menu and
   its import rewrites each id to the importing venue's (dv0 decision 3).
5. **R4's other cost: a deleted menu.** Menus are never deleted, only made inactive
   (tables-menu.md §1.21; `git grep -n "delete(catalogues)"` outside tests found nothing at
   `a086eedfb7`). Task 1 repeats that grep for `delete(menus)`; if it finds a product path, that path
   calls dv0's `removeIdFromJson(tx, menuPeriods.staffMenuIds, menuId)` in the same transaction
   (stop point 1 decides).
6. **Lists:** classification (`packages/db/src/classification.ts:336`;
   `packages/venue-service/src/classification.ts:18`), exports (`packages/db/src/index.ts`,
   `packages/venue-service/src/index.ts`), live-query lists (`apps/dashboard/src/api/live-queries.ts`,
   `packages/venue-service/src/dashboard/live-queries.ts`: the screens that listed
   `menu_period_staff_menus` list `menu_periods`, which they already name), test helpers that insert
   side rows (`packages/venue-service/src/testing/zone-menus.ts`, `apps/server/src/testing/floor-today-venue.ts`,
   `apps/server/src/testing/clear-provision-fixture.ts`) and the demo seed
   (`apps/server/scripts/demo-seed/seed-floor.ts`, 3 sites). The bundle format moves on by one.
7. **dv0's guard** (`scripts/id-columns-are-references.test.ts`, extended by dv0 to know a JSON column)
   sees `staff_menu_ids` as handled through its `jsonReferences` entry.

## Measurement (tables-menu.md §8 item 5)

Export and import a period with two staff menus, through the real configuration export and import.
**Failing result:** `staff_menu_ids` arrives naming the exporting venue's menu ids, or in another
order. This is a committed test (Task 2), written before the declaration; it fails on today's code
for the first reason (the side table's ids are rewritten as whole values, but a list's are not,
`scripts/id-columns-are-references.test.ts:24-25`), and passes once dv0's declaration is in place.
The design names no fallback other than fixing the import; if it still fails with the declaration,
stop (rules §5.4).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Other JSON lists (`device_profiles.order_zone_ids`, `kitchen_stations.printer_ids`) | the devices and floor-and-kitchen slices, on the same dv0 machinery |
| A database refusal of an unknown menu in the list | nobody: R4's stated cost (item 5) |

## Files

- Schema: `packages/db/src/schema/venue-service/menus.ts`; `packages/db/src/schema/venue-service/index.ts`;
  `packages/db/src/index.ts`; `packages/db/src/classification.ts`
- Venue service: `menu-timetable.ts`, `operations.ts`, `routing-periods.ts`, `service-delete-settings.ts`,
  `configuration-transfer.ts`, `classification.ts`, `index.ts`, `dashboard/live-queries.ts`,
  `testing/zone-menus.ts`
- Server: `apps/server/src/testing/floor-today-venue.ts`, `testing/clear-provision-fixture.ts`,
  `scripts/demo-seed/seed-floor.ts`; `apps/server/src/configuration-transfer.test.ts` (the measurement)
- Dashboard: `apps/dashboard/src/api/live-queries.ts`
- Regenerated: core's `drizzle/**`, the epoch file
- Guards: `scripts/schema-constraints.test.ts` (foreign keys: remove `menu_period_staff_menus`' two;
  CHECKs: add `menu_periods_staff_menu_ids_ck`), `scripts/live-subscriptions.test.ts`,
  `scripts/id-columns-are-references.test.ts` (runs), `scripts/classification-complete.test.ts` (runs)
- Tests: `packages/venue-service/src/menu-timetable.test.ts` (or the files that cover
  `saveMenuPeriod`/`updateMenuPeriod`; find with `git grep -l staffMenuIds -- 'packages/venue-service/src/*.test.ts'`),
  `operations.test.ts`, `routing-periods.test.ts`, `service-delete-settings.test.ts`,
  `configuration-transfer.test.ts`; the Madrid baseline
- Docs: `docs/developers/conventions-data.md` "Service-period configuration" (`:1908-1948` at
  `a086eedfb7`) where it names the side table

## Size

| | Code | Tests |
| --- | --- | --- |
| Column, CHECK, writes | 40 | 60 |
| Reads (four sites and `json_each`) | 60 | 60 |
| Transfer declaration and import check | 30 | 70 (the measurement among them) |
| Lists, helpers, demo seed | 40 | 30 |
| Madrid transform, docs | 25 | 25 |
| **Counted** | **195** | **245** |

About 440 counted lines. About 2 hours.

## Finish line

1. `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts -t "staff menus"`
   passes: "a period's staff menus arrive as the importing venue's ids, in order", with a `Tests` count.
2. `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/routing-periods.test.ts src/service-delete-settings.test.ts`
   passes, including "lists a zone's staff menus in the period's order, active ones only".
3. `git grep -n -E "menuPeriodStaffMenus|menu_period_staff_menus" -- apps packages scripts` prints
   only the captured fixtures.
4. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading; not run. `node.db` nothing; `venue.db` six headers.

In all six:

```text
missing table menu_period_staff_menus
missing index menu_period_staff_menus.primary key(period_id,menu_id)
extra table menu_periods.columns[staff_menu_ids]
changed table menu_periods.columnOrder
old: [<base order>]
new: [<with staff_menu_ids>]
extra table menu_periods.checks[menu_periods_staff_menu_ids_ck]
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_menu_period_staff_menus_delete
missing trigger waitron_change_menu_period_staff_menus_insert
missing trigger waitron_change_menu_period_staff_menus_update
changed trigger waitron_change_menu_periods_update.when
old: <base comparison>
new: <with staff_menu_ids>
```

Why, from tables-menu.md §5: the side table's primary key and menu key "moved to code" (`writeMenuPeriod`
refuses a duplicate, an unknown or an inactive menu; the import check moves onto the list); its
composite period key "not needed (the list is on the period)"; `menu_periods_department_key` kept;
the new array CHECK (§1.21 "Protections"). The removed table's foreign keys print no line of their
own. If the side table's primary key is not a named composite key in the base (its schema names it
`menu_period_staff_menus_pk`, `menus.ts:56`), its index line reads as the tool prints it.

## Stop points (beyond rules §5)

1. A product path deletes a row of `menus` (item 5).
2. The measurement still fails with dv0's declaration (rules §5.4).
3. dv0's `jsonReferences` or `jsonShapeCheck` is named differently when this PR starts.
4. A read's expected order changes in an existing test.

## Needs

- **Outside this area:** dv0 (JSON-list machinery; its plan says it lands before its first user and
  waits on nothing); batch 1.
- **In this area:** mn3 (names). It touches no table mn4–mn10 changed.

## Global Constraints

- Rules §1–§9; core rebuilt.
- One transaction per request; queries awaited in turn (CLAUDE.md §3).

## Review Focus

1. **The list keeps its order** from save to read to export to import.
2. **An inactive menu is still left out** of a zone's staff menus, as the join on active menus did.
3. **Import refuses an id the bundle lacks** rather than keeping the exporting venue's id.

---

### Task 1: The column, the writes and the reads

- [ ] **Step 1:** Base protection list (rules §3). Run `git grep -n -E "delete\\((menus|catalogues)\\)" -- apps packages ':!*.test.ts'`;
  anything found is stop point 1.
- [ ] **Step 2: Failing cases.** Every ordering case creates its menus with fixed ids whose sorted
  order differs from the list order, so an implementation that orders by id instead of by position
  fails: `M1 = "00000000-0000-4000-8000-000000000003"`, `M2 = "…0001"`, `M3 = "…0002"` (same prefix),
  saved as `[M1, M2, M3]`, which sorts as `[M2, M3, M1]`.
  - venue-service schema test (raw SQL): `"refuses staff menus that are not a JSON array"` (`'{}'`,
    `'"x"'`, `'nope'` → `menu_periods_staff_menu_ids_ck`; controls `'[]'`, `'["<id>"]'`).
  - `"saves and reads staff menus in order"`: save `[M1, M2, M3]`, read `[M1, M2, M3]`.
  - `"refuses a duplicate, the period's own menu, and an inactive menu"`: the existing refusals keep
    their codes (`menu_period.invalid { field: "staffMenuIds" }`; `menu.not_found`).
  - `operations.test.ts` `"lists a zone's staff menus in the period's order, active ones only"`: a
    period with `[M1, M2, M3]` where M2 is inactive lists M1 then M3.
  - `service-delete-settings.test.ts`: the existing "what a department delete removes" case keeps its
    counts.
- [ ] **Step 3–5:** Run (fail); implement items 1–3; rebuild core; run (pass). **Commit.**

### Task 2: Export and import (the measurement)

- [ ] **Step 1: Write the measurement first** in `apps/server/src/configuration-transfer.test.ts`:
  `"a period's staff menus arrive as the importing venue's ids, in order"`: on the source venue, a
  department period with staff menus `[M1, M2, M3]` (the fixed ids above, so the exported list's
  order is not its sorted order); export, and assert the bundle's `staff_menu_ids` is `[M1, M2, M3]`;
  import on a fresh venue; the imported period's `staff_menu_ids` equals the imported ids of M1, M2,
  M3 in that order (found by menu name), and none equals a source id. The importing venue's ids are
  generated, so on that side an order-by-id implementation would pass by chance one time in six; the
  export-side assertion is what pins order against a sort. Run it before adding the declaration: it must fail by naming the source's ids (the
  failing result named above); paste that output.
- [ ] **Step 2:** Add the declaration and move the import check (item 4); add cases
  `"refuses an imported list naming a menu the bundle lacks"` and `"…repeating a menu"`
  (`setup.request_invalid { field: "menu_periods.staff_menu_ids" }`).
- [ ] **Step 3:** Run — PASS. Bundle format on by one, with the refusal row at
  `apps/server/src/configuration-import.test.ts:204`. **Commit.**

### Task 3: The zone read's cost, lists, Madrid baseline, finish

- [ ] **Step 1:** Time `zonePeriodMembership` for one zone with 8 periods of 3 staff menus each, as 3
  rounds of 200 samples after 20 untimed, on the base and the branch, same machine (a scratch script,
  not committed). The branch's median more than 10% above the highest of the base's 3 round medians is
  a failing measurement: stop and ask (rules §5.4). The design reasoned "a handful of menus" and names
  no fallback; the watcher decides.
- [ ] **Step 2:** Lists, helpers, demo seed (item 6); guards.
- [ ] **Step 3: Madrid baseline:** fold captured `menu_period_staff_menus` rows into each captured
  period's `staff_menu_ids`, ordered by `display_order` then `menu_id`; drop the table and its count.
- [ ] **Step 4:** Docs; Finish line; paste the protection-list report, marking each line;
  `/finish-branch`; push once.
