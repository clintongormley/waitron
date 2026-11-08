# A1308 venue and box, PR vb7: `opening_hours`, and a zone's hours move into it — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** Create `opening_hours`, the one table of painted time ranges for a department or a zone
(appendix §1.14), with every CHECK the design gives it, and move the zone half into it:
`zone_days` and `zone_day_ranges` go. The department half follows in vb8.

**Architecture:** One row per painted range, owned by a department or a zone, on a season's weekday
or a special-day date; the "day" container rows disappear. Every zone reader and writer keeps its
exported name and signature and reads or writes `opening_hours` rows with `zone_id` set. Readers that
today join the department and zone halves with `UNION ALL` read the zone half from `opening_hours`
until vb8 makes them one query.

**Why two PRs:** the whole move touches about 600 lines of queries and validators plus about 430
test lines that name the four tables (measured 2026-11-08 at `a086eedfb7`), past rules §1's cap. The
zone half is the smaller and goes first, so the new table and all its rules land with the fewest
readers changed; the price is about 30 lines of `UNION ALL` branches rewritten twice.

**Tech Stack:** Drizzle on `node:sqlite`, Vitest.

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.14, §5 (the
`zone_days`/`zone_day_ranges` rows, the step and kind CHECKs, the new kind-by-owner CHECK), §6.2;
`docs/developers/conventions-data.md` "Opening hours store "no claim" as no row" (`:494`) and "Zone
closed times" (`:678`).

**Lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. **`opening_hours`** in `packages/db/src/schema/venue-service/opening-hours.ts` (export
   `openingHours`), core set, classified `state`:

   | column | builder | null | key |
   | --- | --- | --- | --- |
   | `id` | `id`, `$defaultFn(newId)` | no | primary key |
   | `department_id` | `id` | yes | → `departments.id`, cascade (`opening_hours_department_fk`) |
   | `zone_id` | `id` | yes | → `floor_zones.id`, cascade (`opening_hours_zone_fk`) |
   | `season_id` | `id` | yes | → `seasons.id`, cascade (`opening_hours_season_fk`) |
   | `weekday` | `count`, 0 = Sunday | yes | |
   | `special_day_date_id` | `id` | yes | → `special_day_dates.id`, cascade (`opening_hours_date_fk`) |
   | `kind` | `enumType(["period", "closed", "open"])` | no | |
   | `period_id` | `id` | yes | (`period_id`, `department_id`) → `menu_periods(id, department_id)`, no delete rule (`opening_hours_period_fk`) |
   | `starts_at`, `ends_at` | `timeOfDay` | no | |

   CHECKs: `opening_hours_one_owner_ck` `(department_id is null) <> (zone_id is null)`;
   `opening_hours_one_day_ck` `(season_id is null) <> (special_day_date_id is null) and (season_id is null) = (weekday is null)`;
   `opening_hours_weekday_ck` `weekday is null or weekday between 0 and 6`;
   `opening_hours_step_ck` (today's step expression, `seasons.ts:159-162`);
   `opening_hours_kind_ck` (`enumCheck`);
   `opening_hours_kind_by_owner_ck`:
   `(department_id is not null and ((kind = 'period' and period_id is not null) or (kind = 'closed' and period_id is null and special_day_date_id is not null))) or (zone_id is not null and period_id is null and (kind = 'closed' or (kind = 'open' and special_day_date_id is not null)))`
   — the rule the writers check today (`season-weeks.ts:105-108, :155-160`; the import's
   `configuration-transfer.ts:313-318, :336-341`).
   Indexes: `opening_hours_department_day_idx` (`department_id`, `season_id`, `weekday`, `starts_at`)
   where `department_id is not null`; `opening_hours_zone_day_idx` (`zone_id`, `season_id`,
   `weekday`, `starts_at`) where `zone_id is not null`; `opening_hours_special_day_date_idx`
   (`special_day_date_id`); `opening_hours_season_idx` (`season_id`).
   No unique day keys: several ranges per day were always allowed (appendix §5).
2. **Zone writers:** `writeZoneSeasonWeeks` (`packages/venue-service/src/season-weeks.ts:138-165`)
   deletes the zone's rows for the season and inserts one row per range (`kind: "closed"`); no row
   for a day with no range. `saveSpecialDay`'s zone branch (`special-days.ts:1073-1088`) deletes the
   zone's rows for the date and inserts its ranges with their `kind`. The service-end delete
   (`service-delete-settings.ts:376`) deletes `opening_hours` where `zone_id` is one of the zones —
   it no longer relies on a cascade from `zone_service_policies` (appendix §1.14).
3. **Zone readers:** `readZoneSeasonWeeks` (`season-weeks.ts:256-282`, an inner join to `seasons`
   with `zone_id is not null and season_id is not null`); `occurrencesOf`'s zone branch
   (`special-days.ts:263-288`); `readSpecialDay`'s (`:886-895`); `businessDayClockConflicts`' two
   zone reads (`business-day-schedule.ts:77-93, :135-140`); the service-delete impact
   (`service-delete-settings.ts:172-176`).
4. **Configuration transfer:** `zone_days`, `zone_day_ranges` leave the list
   (`packages/venue-service/src/configuration-transfer.ts:722-723`); `opening_hours` joins it after
   `seasons`, `special_day_dates`, `floor_zones` and `menu_periods` (keys are checked at commit,
   `packages/provisioning/src/configuration-transfer.ts:709-721`); `validateSeasonWeeks`' zone part
   (`:320-345`) validates `opening_hours` rows with `zone_id` set and refuses with field names
   `opening_hours.<column>`. Department rows of `opening_hours` are refused by the validator until
   vb8 (the bundle carries none). Format version +1 (rules §9).
5. **Lists:** classification (`packages/db/src/classification.ts:372-373` → one `opening_hours`
   entry; `packages/venue-service/src/classification.ts:50-51`); exports (`packages/db/src/index.ts:441, :481`;
   `packages/venue-service/src/index.ts`); live dependencies (`packages/venue-service/src/dashboard/live-queries.ts:38-41, :57-60, :163-166, :178-181, :193-196, :231-234, :263-266`;
   `apps/dashboard/src/api/live-queries.ts:68-71, :382-385`) name `opening_hours` in place of the
   two zone names; `apps/server/src/testing/clear-provision-fixture.ts:10` deletes `opening_hours`;
   the Madrid canonical key (`apps/server/scripts/demo-seed/testing/madrid-semantics.ts:187-198`)
   gains `opening_hours` keyed by (owner, season or date, weekday, `starts_at`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| `department_days`, `department_day_ranges`; collapsing the `UNION ALL` readers | vb8 |
| "One rule for zone closures and department hours, after A760's opening_hours" (`docs/backlog.md:651`, bundle of 8) | builds after vb8 on the new table; it changes behaviour, not tables (rules §8) |
| "A department or zone delete's preview never counts a special day's painted hours" (`docs/backlog/service-periods.md:68`) | its own entry; the impact read stays season-only here, as the behaviour suites require |
| `zone_service_policies` folding into `floor_zones` | floor slice [fk1](2026-11-08-a1308-fk1-zone-service-rules.md) (it re-points `zone_days.zone_id` at `floor_zones` if it lands first; whichever lands second uses the other's names, stop point 3) |

## Files

Create: `packages/db/src/schema/venue-service/opening-hours.ts`; `opening-hours.test.ts` beside it.

Modify: `packages/db/src/schema/venue-service/seasons.ts` (zone tables go), `index.ts`;
`packages/venue-service/src/season-weeks.ts`, `special-days.ts`, `business-day-schedule.ts`,
`service-delete-settings.ts`, `configuration-transfer.ts`, `classification.ts`, `index.ts`,
`dashboard/live-queries.ts`; `packages/db/src/classification.ts`, `index.ts`;
`apps/dashboard/src/api/live-queries.ts`; `apps/server/src/testing/clear-provision-fixture.ts`;
`apps/server/scripts/demo-seed/testing/madrid-semantics.ts`, `seed.madrid-baseline.test.ts`; the
bundle version constant (`packages/provisioning/src/configuration-transfer.ts:123, :160`).

Tests naming the zone tables (re-pointed; `git grep -n "zoneDays\|zoneDayRanges\|zone_days\|zone_day_ranges" -- '*.test.ts' '**/testing/**'`):
chiefly `packages/venue-service/src/configuration-transfer.test.ts`, `business-day-schedule.test.ts`,
`zone-closed-times.test.ts`, `season-weeks.test.ts`, `packages/db/src/schema/venue-service/migrations.test.ts`,
`scripts/schema-constraints.test.ts`.

Madrid: a transform (in `seed.madrid-baseline.test.ts`, ~30 lines) builds each phase's expected
`opening_hours` rows from the capture's `zone_days` ⋈ `zone_day_ranges` (row id = the range's id;
`zone_id`, `season_id`, `weekday`, `special_day_date_id` from the day; `kind` from the range;
`department_id` and `period_id` null), adds the table's columns and keys, and removes the two zone
tables and their counts.

Docs: `docs/developers/conventions-data.md` "Opening hours store "no claim" as no row" and "Zone
closed times" sections: the table names they cite.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Table, CHECKs, indexes | ~70 | ~120 (each CHECK refused and accepted, cascade, period key) |
| Zone writers and readers | ~110 | ~110 (re-pointed) |
| Transfer validator, format | ~50 | ~60 |
| Lists, fixture, Madrid | ~60 | — |
| Empty-week check (Task 1) | — | ~40 |
| **Total** | **~290** | **~330** |

About 620 counted lines; 3 hours.

## Finish line

1. Task 1's result is in the PR description.
2. `pnpm --filter @waitron/db exec vitest run src/schema/venue-service/opening-hours.test.ts src/schema/venue-service/migrations.test.ts`
3. `pnpm --filter @waitron/venue-service exec vitest run src/season-weeks.test.ts src/seasons.test.ts src/special-days.test.ts src/business-day-schedule.test.ts src/zone-closed-times.test.ts src/zone-closure-hours.test.ts src/day-resolver.test.ts src/service-delete-settings.test.ts src/configuration-transfer.test.ts src/dashboard/live-queries.test.ts src/dashboard/opening-hours-client.test.ts`
4. `pnpm --filter @waitron/staffing exec vitest run`; `pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/configuration-import.test.ts src/service-delete.integration.test.ts src/floor-delete.bookings.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/demo-seed/seed.test.ts`;
   `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts`
5. Root: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts`
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
missing index zone_day_ranges.primary key(id)
missing index zone_day_ranges_day_idx
missing index zone_days.primary key(id)
missing index zone_days_date_key
missing index zone_days_season_key
missing table zone_day_ranges
missing table zone_days
extra index opening_hours.primary key(id)
extra index opening_hours_department_day_idx
extra index opening_hours_season_idx
extra index opening_hours_special_day_date_idx
extra index opening_hours_zone_day_idx
extra table opening_hours
```

Under the two `change-feed` headers also:

```text
missing trigger waitron_change_zone_day_ranges_delete
missing trigger waitron_change_zone_day_ranges_insert
missing trigger waitron_change_zone_day_ranges_update
missing trigger waitron_change_zone_days_delete
missing trigger waitron_change_zone_days_insert
missing trigger waitron_change_zone_days_update
extra trigger waitron_change_opening_hours_delete
extra trigger waitron_change_opening_hours_insert
extra trigger waitron_change_opening_hours_update
```

Why: appendix §1.14 and §5 (the zone tables' keys and CHECKs move to `opening_hours`, their unique
day keys are dropped, the kind-by-owner CHECK is gained; all inside the table object). Made by
simulation on `a086eedfb7`'s built change-feed `venue.db` (zone tables and triggers dropped,
`opening_hours` and its four indexes created): every line above, with one change-feed trigger
standing in for the three.

## Stop points (beyond rules §5)

1. **Task 1 finds a caller that tells a saved-but-empty week from a never-saved one.** Today the
   writers keep 7 day rows even for empty days, and `groupWeeks` (`season-weeks.ts:168-186`) makes
   an entry for a saved week with no ranges; after the move there is no row. Appendix §6.2 says
   every reader treats the two alike (read, not run). If one does not, ask; the design names no
   fallback.
2. fk1 is in flight (both change `zone_days` and `service-delete-settings.ts`): wait for it (rules §7).
3. **fk1 and this PR disagree on the zone's shape.** The zone owner here is `floor_zones` (appendix
   §1.14), the table fk1 folds `zone_service_policies` into and re-points `zone_days.zone_id` at
   ([fk1](2026-11-08-a1308-fk1-zone-service-rules.md) :97, :208, :322). Whichever of fk1 and this
   PR lands second uses the other's names: if fk1 landed first, read `floor_zones`' columns, the
   zone-delete step in `service-delete-settings.ts` and the seed helper `seedZone` as fk1 left them
   and move its re-pointed `zone_days` key into `opening_hours_zone_fk` (the protection-list lines
   above do not change: the whole `zone_days` table prints missing); if this PR lands first, fk1
   finds `opening_hours`, not `zone_days`. A difference beyond that — the zone key not on
   `floor_zones.id`, a cascade fk1 dropped, a zone row fk1 deletes some other way — is a stop.
4. A behaviour suite needs a changed assertion: rules §5.3.

## Needs

vb1. Outside: 5a (`seasons`, `special_day_dates` without `location_id`); 1a's
`scripts/starting-migrations.test.ts` and `packages/db/triggers/core.sql`. fk1 before or after, never
at the same time; whichever lands second uses the other's names (stop point 3).

---

## Task 1: Does any reader tell an empty saved week from no week? (appendix §6.2, run)

**Files:** `packages/venue-service/src/season-weeks.test.ts` (one new case, kept).

- [ ] **Step 1: Write the test on the base** — "a zone week saved with every day empty reads the same
  as a week never saved": save an all-empty week for zone A with `writeZoneSeasonWeeks`, leave zone
  B unsaved, then for both compare `seasonWeekList(seasons, (await readZoneSeasonWeeks(tx)).get(id))`
  and the answers of `readZoneClosedTimes` (`zone-closed-times.ts:143`),
  `readPlannedServiceGuides` (`planned-service-guides.ts:79`) and the season split read in
  `saveSeasons` (`seasons.ts:150-157`), plus `replaceZoneClosedWeek`'s use at
  `zone-closed-times.ts:100`, `resolveZoneClosedDays`' read (`day-resolver.ts:255, :271`) and
  `saveSeasonWeeks`' read (`season-weeks.ts:351`). Also list every use of the returned
  map's keys: `git grep -n -E "ZoneSeasonWeeks\(" -- packages/venue-service/src ':!*.test.ts'` and read
  each for `.has(`, `.size`, `.keys(` or iteration.
- [ ] **Step 2:** Say what failing prints: any answer for A differs from B's. Run on the base.
- [ ] **Step 3:** Equal → keep the test (it pins the rule for the move). Different → stop point 1.

## Task 2: The table and its rules

**Files:** `opening-hours.ts`, `opening-hours.test.ts`, `index.ts`, classification, guards.

- [ ] **Step 1:** `pnpm protection-list list --out <A>`.
- [ ] **Step 2: Write the failing tests** in `opening-hours.test.ts`, each asserting the named CHECK
  or a foreign-key error, each with its accepted twin: "refuses a row with both owners" and "with
  neither"; "refuses a weekday without a season" and "a season and a date together"; "refuses
  weekday 7"; "refuses 10:10"; "refuses a zone row with a period"; "refuses `open` on a zone's season
  week" (accepts it on a date); "refuses a department row of kind `period` without a period";
  "refuses `closed` on a department's season week" (accepts it on a date); "refuses a period of
  another department" (the two-column key); "deleting a zone, a season or a date deletes its
  rows".
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** item 1; rebuild core.
- [ ] **Step 5: Run** — PASS. **Commit** `git commit -s -m "opening hours: one table for every painted range, with its rules"`.

## Task 3: The zone half moves

**Files:** items 2–5.

- [ ] **Step 1:** Delete the zone tables from `seasons.ts`; run Finish-line items 3–4 to list the
  failures.
- [ ] **Step 2: Implement** items 2–5 and the Madrid transform.
- [ ] **Step 3: Run** Finish-line items 2–5 — PASS (Task 1's case included).
- [ ] **Step 4:** Docs; `pnpm protection-list list --out <B>`; `compare`; paste and mark.
- [ ] **Step 5: Commit** `git commit -s -m "opening hours: a zone's closed and open times live in opening_hours"`.
