# A1308 venue and box, PR vb8: a department's hours move into `opening_hours` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** `department_days` and `department_day_ranges` go; a department's painted ranges are
`opening_hours` rows with `department_id` set (vb7 created the table and its rules). The readers
that joined the department and zone halves with `UNION ALL` become single reads of `opening_hours`.

**Architecture:** Every department reader and writer keeps its exported name and signature. A
department range's `kind` is `period` when it names a menu period and `closed` when it does not (a
special-day date only), which `opening_hours_kind_by_owner_ck` already enforces.

**Tech Stack:** Drizzle on `node:sqlite`, Vitest.

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.14, §5 (the
`department_days`/`department_day_ranges` rows), §6.2; vb7's plan for the table.

**Lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. **Department writers:** `writeDepartmentSeasonWeeks` (`packages/venue-service/src/season-weeks.ts:98-136`)
   deletes the department's rows for the season and inserts one row per range (`kind: "period"`,
   `period_id`); no row for an empty day. `saveSpecialDay`'s department branch
   (`special-days.ts:1048-1069`) deletes the department's rows for the date and inserts its ranges
   (`period` with a period, else `closed`). `deletePeriod` (`period-delete.ts:176-205`): with no
   replacement it deletes the period's rows (the empty special-date day cleanup at `:186-200` has
   nothing left to clean: no day rows); with a replacement it updates `period_id`.
   `joinTouchingRanges` (`:214-259`, private) reads, deletes and updates `opening_hours` rows. With
   no day ids, it takes **day keys** instead: `deletePeriod` reads the distinct
   (`department_id`, `season_id`, `weekday`, `special_day_date_id`) of the period's rows before the
   update (in place of `dayIds`, `:176-181`), and `joinTouchingRanges` reads every row of the
   department matching one of those keys and groups them by the key
   `` `${department_id}|${season_id ?? ""}|${weekday ?? ""}|${special_day_date_id ?? ""}` ``; the
   cutover choice per group is unchanged (a dated group uses its date's cutover, an undated one the
   cutover in force at `at`, `:235-242`). The service-end
   delete (`service-delete-settings.ts:409`) deletes the department's rows, still before
   `delete(menuPeriods)` (`:410`), because the period key has no delete rule.
2. **Department readers:** `readDepartmentSeasonWeeks` (`season-weeks.ts:208-254`); `readSpecialDay`
   (`special-days.ts:872-883`); `paintedIn` (`period-delete.ts:48-90`); `seasonDeleteImpact`
   (`seasons.ts:199-210`); `listVenueReadiness` (`operations.ts:301-315`); the service-delete impact
   (`service-delete-settings.ts:165-171`).
3. **One read where there were two:** `occurrencesOf` (`special-days.ts:259-288`) and the special-day
   paint read in `businessDayClockConflicts` (`business-day-schedule.ts:116-141`) select once from
   `opening_hours` (left-joining `menu_periods` where the department half did); its two season reads
   (`:59-75`, `:77-93`) stay two selects, now both from `opening_hours`, because they join different
   parents (`menu_periods`/`departments` and `floor_zones`).
4. **Configuration transfer:** the two tables leave the list (`configuration-transfer.ts:720-721`);
   `validateSeasonWeeks`' department part (`:274-318`) validates `opening_hours` rows with
   `department_id` set (a period of the same department, `closed` only on a date), refusing with
   `opening_hours.<column>`; vb7's "department rows refused" line goes. Format version +1 (rules §9).
5. **Lists:** classification (`packages/db/src/classification.ts:370-371`,
   `packages/venue-service/src/classification.ts:48-49`), exports (`packages/db/src/index.ts:440, :480`,
   `packages/venue-service/src/index.ts:7-8, :52-53`), live dependencies (the department names in
   the same `dashboard/live-queries.ts` entries vb7 changed, `menu-periods-painted-in` at `:207-208`,
   `apps/dashboard/src/api/live-queries.ts:68-71, :382-385`; staffing's spread of
   `CALENDAR_MONTH_PLAN_READS`, `packages/staffing/src/dashboard/live-queries.ts:23, :41`, follows
   by itself); `clear-provision-fixture.ts:9` (its comment about the period key stays true for
   `opening_hours`); the Madrid transform extended to department rows.

## What it leaves out

| Left out | Owner |
| --- | --- |
| The bundle "One rule for zone closures and department hours, after A760's opening_hours" (`docs/backlog.md:651`) | after this PR, on the new table; this PR updates nothing in it except that its heading's precondition is now met (say so in the PR) |
| "The special-day-then-season rule is written out in several places" (`docs/backlog/service-periods.md:60`) | its own entry |
| `staffing_days` (same one-owner shape) | people area |

## Files

Modify: `packages/db/src/schema/venue-service/seasons.ts` (department tables go), `index.ts`;
`packages/venue-service/src/season-weeks.ts`, `special-days.ts`, `period-delete.ts`,
`business-day-schedule.ts`, `service-delete-settings.ts`, `seasons.ts`, `operations.ts`,
`configuration-transfer.ts`, `classification.ts`, `index.ts`, `dashboard/live-queries.ts`;
`packages/db/src/classification.ts`, `index.ts`; `apps/dashboard/src/api/live-queries.ts`;
`apps/server/src/testing/clear-provision-fixture.ts`; `seed.madrid-baseline.test.ts`; the bundle
version constant.

Tests naming the department tables, re-pointed (`git grep -n "departmentDays\|departmentDayRanges\|department_days\|department_day_ranges" -- '*.test.ts' '**/testing/**'`):
chiefly `packages/venue-service/src/configuration-transfer.test.ts`, `business-day-schedule.test.ts`,
`period-delete.test.ts`, `period-delete-routes.test.ts`, `day-resolver.test.ts`, `season-weeks.test.ts`,
`menu-timetable.test.ts`, `service-delete-settings.test.ts`, `packages/staffing/src/paint.test.ts`,
`rota.test.ts`, `scripts/schema-constraints.test.ts`. Seeding helpers that write department days
(`apps/server/scripts/demo-seed/seed.ts:143, :154`, `seed-floor.ts:189, :199`,
`apps/server/src/testing/floor-today-venue.ts:182`, `signed-in-till.ts:194`,
`packages/venue-service/src/testing/zone-menus.ts:81`) go through `writeDepartmentSeasonWeeks` or
`replaceMenuWeek` already and need no change unless they insert rows directly.

Madrid: the vb7 transform also builds department rows from `department_days` ⋈
`department_day_ranges` (`kind` = `period` when `period_id` is set, else `closed`; `zone_id` null)
and removes the two tables and their counts.

Docs: `docs/developers/conventions-data.md` "Opening hours store…", "Menu timetables share the
special-day calendar" (`:626`), "Seasons and season weeks" (`:724`), "Special days" (`:819`): the
table names they cite.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Department writers (season, special day, period delete, join by day key) | ~175 | ~170 (re-pointed, plus the day-key case) |
| Readers and the unified reads | ~110 | ~110 (re-pointed) |
| Transfer validator, format | ~60 | ~80 |
| Lists, Madrid | ~40 | — |
| Empty-week checks (Task 1, two cases) | — | ~40 |
| **Total** | **~385** | **~410** |

About 795 counted lines; 3 hours; split the dispatch after Task 2.

## Finish line

1. Task 1's result is in the PR description.
2. `pnpm --filter @waitron/venue-service exec vitest run` — the whole package (its suites hold the
   department-hours behaviour; check `memory_pressure | grep free` first).
3. `pnpm --filter @waitron/staffing exec vitest run`; `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts src/setup-opening-hours.test.ts src/till-api.service-periods.test.ts src/service-delete.integration.test.ts src/provision.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/demo-seed/seed.test.ts`;
   `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts`
4. Root: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/id-columns-are-references.test.ts`
5. `git grep -n "departmentDays\|departmentDayRanges\|department_days\|department_day_ranges\|zoneDays\|zone_days" -- apps packages scripts ':!**/drizzle/**' ':!**/test-fixtures/**'`
   prints only the Madrid transform and `configuration-v1-*.json`.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
missing index department_day_ranges.primary key(id)
missing index department_day_ranges_day_idx
missing index department_days.primary key(id)
missing index department_days_date_key
missing index department_days_department_key
missing index department_days_season_key
missing table department_day_ranges
missing table department_days
```

Under the two `change-feed` headers also:

```text
missing trigger waitron_change_department_day_ranges_delete
missing trigger waitron_change_department_day_ranges_insert
missing trigger waitron_change_department_day_ranges_update
missing trigger waitron_change_department_days_delete
missing trigger waitron_change_department_days_insert
missing trigger waitron_change_department_days_update
```

Why: appendix §5 ("FKs and CHECKs move to `opening_hours`; the unique day keys and the composite-key
target are dropped because there is no day row any more"; "the department is on the same row").
`opening_hours` prints nothing: vb7 made it whole. By analogy with vb7's simulated zone lines (the
index names read from the base, `packages/db/drizzle/0000_baseline.sql:2725-2760`).

## Stop points (beyond rules §5)

1. Task 1 finds a department reader that tells an empty saved week from no week. This is a real
   risk here, not only in theory: `deletePeriod` today deletes a dated day row when its last range
   goes but keeps a season's day row "for its weekday even when empty" (`period-delete.ts:186-187`),
   and after the move nothing is left of either. Pre-declared proposal, for the watcher to confirm
   before it is taken: that reader treats an absent week as an empty week, as `seasonWeekList`
   already does (`season-weeks.ts:188-196`) and as appendix §6.2 says every reader does; the
   reader's own test gains the case. If the watcher declines, stop.
2. `period-delete.ts`'s "empty special-date day" cleanup (`:186-200`) turns out to be observable (a
   test asserts a day row's absence or presence): ask before deleting the assertion.
3. A behaviour suite needs a changed assertion: rules §5.3.

## Needs

vb7. Outside: none beyond vb7's.

---

## Task 1: Does any department reader tell an empty saved week from no week?

- [ ] **Step 1:** As vb7's Task 1, for departments, with two cases: "a department week saved with
  every day empty reads the same as a week never saved", and "a season week whose only period was
  deleted with no replacement reads the same as a week never saved" (the `period-delete.ts:186-187`
  path), through `readDepartmentSeasonWeeks`' callers —
  `day-resolver.ts:220`, `menu-timetable.ts:165, :693`, `planned-service-guides.ts:97`,
  `routing-periods.ts:114`, `seasons.ts:156`, `zone-closure-hours.ts:39` — and `listVenueReadiness`.
  Failing prints: any answer differs. Run on vb7's head (the base of this PR).
- [ ] **Step 2:** Equal → keep the test. Different → stop point 1.

## Task 2: Writers

- [ ] **Step 1:** `pnpm protection-list list --out <A>`. Write the failing tests: `season-weeks.test.ts`
  "a department week writes one row per range and none for an empty day"; `special-days.test.ts`
  "a closed stretch on a date is a `closed` row with no period"; `period-delete.test.ts` "deleting a
  period with no replacement deletes its rows, and with one moves them" and "a replacement that
  touches a neighbouring range on the same season weekday joins them, and leaves the same weekday
  of another season and of another department alone" (the day-key grouping).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** item 1.
- [ ] **Step 4: Run** — PASS. **Commit** `git commit -s -m "opening hours: a department's hours are written to opening_hours"`.

## Task 3: Readers, unified reads, transfer, lists

- [ ] **Step 1:** Delete the two tables from `seasons.ts`; rebuild core; run Finish-line items 2–3 to
  list failures.
- [ ] **Step 2: Implement** items 2–5 and the Madrid transform.
- [ ] **Step 3: Run** Finish-line items 2–5 — PASS.
- [ ] **Step 4:** Docs; `pnpm protection-list list --out <B>`; `compare`; paste and mark.
- [ ] **Step 5: Commit** `git commit -s -m "opening hours: department days go; every reader reads opening_hours"`.
