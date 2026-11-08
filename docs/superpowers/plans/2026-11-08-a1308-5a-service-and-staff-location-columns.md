# A1308 slice 5a: `location_id` leaves the service, calendar, staff and booking tables — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking. Every rule in [the slice rules](2026-11-08-a1308-slice-rules.md)
> applies; this plan cites them as "rules §n".

**Lands:** the lane (rules §6). Nothing here touches sales, invoice numbering, the fiscal records,
the fiscal identity, AEAT sending or a value that feeds a fiscal hash.

**Pull request's first line:** "Every venue is reset: core, workforce, workforce-es, bookings;
backups and exports from before this cannot be restored or imported." (rules §2).

**Needs before it:** slice 1a (the rebuild command and `packages/db/triggers/core.sql`). It does
not need 1b. In the build order it is the first part of slice 5.

## The location sweep, in one place

The location sweep is A1301's last work (its design's S18e and S20–S28), rebuilt on A1308's fresh
starting migrations. Nine pull requests, in this strict order (four landed by the owner):

| Part | What | Lands | Needs |
| --- | --- | --- | --- |
| **5a (this)** | `location_id` leaves the service, calendar, staff and booking tables | lane | 1a |
| [5b](2026-11-08-a1308-5b-venue-document.md) | The venue document (`settings.venue`): name and address | lane | 5a, 1b-i, 1b-ii |
| [5c](2026-11-08-a1308-5c-languages-and-holiday-area.md) | Receipt languages (with the language triggers and the §8.2 timing), content languages and the holiday area join the venue document | lane | 5b |
| [5d](2026-11-08-a1308-5d-venue-clock-and-fiscal-settings.md) | The venue's clock (time zone, day start), fiscal territory and operation description leave `locations`; the fiscal pair stops reading a location | **owner** | 5c |
| [5e](2026-11-08-a1308-5e-floor-and-device-location-columns.md) | `location_id` leaves the floor, kitchen, printing, device, order, refund and join tables; the default menu becomes a flag on `catalogues` | lane (the owner may take it: refund trigger) | 5d, 4a-ii |
| [5f](2026-11-08-a1308-5f-backups-without-venue-id.md) | Archives name no venue id; the fiscal recovery-pack check; `nodes` loses `location_id`; the live-venue guard reads the venue document | **owner** | 5e, the owner's answer to the venue-id design's question 6 |
| [5f-ii](2026-11-08-a1308-5f-ii-invoice-path-parameters.md) | The unread `cfg` parameters on the invoice path go | **owner** | 5f |
| [5g](2026-11-08-a1308-5g-cloud-venue-id.md) | Cloud assigns the venue's id (pairing v2); the bucket stream and recovery kit name no venue id | **owner**, with the Cloud lane | 5f-ii, the Cloud lane's plan and pull request |
| [5h](2026-11-08-a1308-5h-locations-drop.md) | `locations` and `venueLocationId` go; the whole-tree check | lane | 5g |

Words used in all nine:

- A **location** is today's `locations` row; the **venue** is the premises, the only place there is
  once the sweep ends (A1301 design §1).
- `venueLocationId(tx)` (`packages/db/src/venue.ts:123-125`) is A1301's interim helper that returns
  the one `locations` row's id so code can still fill a `location_id` column. The sweep deletes it.
- A **second-location case** is a test whose only purpose is a row at another location. A1301's
  rule: such a test is deleted with the check it proves, never rewritten (A1301 plan, "Cross-location
  tests are deleted, not rewritten"; design §8 item 7).
- The **fiscal pair** is `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden hash
  case) and `inmutabilidad.test.ts`; A1301 runs them unedited (A1301 plan, "The fiscal pair").

**Every committed script run in the sweep is checked the same way** (rules §1). The builder
defines one file list and uses it for every run and every re-run:

```zsh
FILES=(${(0)"$(git ls-files -z -- 'apps/**/*.ts' 'packages/**/*.ts' 'scripts/**/*.ts' ':!**/drizzle/**')"})
```

It commits the hand edits that come before the run (the schema, for a column drop), then the
script's output alone, with prettier applied, then the hand edits after. The reviewer re-runs it:
`git checkout <the commit before the output commit>`, the same script command over the same file
list, `pnpm exec prettier --write` on the files it changed, then `git diff --exit-code <the output
commit>`. The pull request body names both commits and the command.

## What it builds

A1301's S20, S21 and S22, cut down to what is left after A760 (rules §2: dropping a column is a
schema edit plus the rebuild command; there are no table rebuilds, trigger dances or upgrade
`RESETS` entries any more).

1. **Eighteen tables lose `location_id`**, its foreign key to `locations`, and the location part of
   every index:
   - core (venue-service tables, `packages/db/src/schema/venue-service/`): `departments`,
     `order_service_contexts`, `zone_service_policies` (all three in `service.ts:25-247`),
     `routing_cells` (`routing.ts`), `seasons`, `special_days`, `special_day_dates`
     (`seasons.ts:22-95`);
   - bookings: `bookings` (`packages/bookings/src/schema/bookings.ts:37`);
   - workforce: `attendance_day_work`, `attendance_source_state`, `attendance_operation_facts`,
     `attendance_questions` (`packages/workforce/src/schema/attendance.ts:21-205`),
     `attendance_response_commands` (`attendance-responses.ts:17-30`), `roster_versions`,
     `shift_templates`, `shifts`, `staff_roles` (`schema/staffing/staffing.ts:25-44`);
   - workforce-es: `convenio_config` (`packages/workforce-es/src/schema/convenio-config.ts:41-…`).
2. **Index decisions** (each is the design's: A1301 design §4 "Unique keys that include
   `location_id` lose that column"; a key whose only column was `location_id` becomes a partial
   unique index on the flag column, never an expression, A1301 §4 and tables-venuebox §1.10):

   | Today | After |
   | --- | --- |
   | `departments_location_name_key` (`location_id`,`name`) where active | `departments_name_key` (`name`) where active |
   | `departments_one_default_per_location_key` (`location_id`) where `is_default` | `departments_one_default_key` (`is_default`) where `is_default` |
   | `zone_service_policies_one_counter_default_key` (`location_id`) where `is_counter_default` | same name, (`is_counter_default`) where `is_counter_default` |
   | the seven `routing_cells_*_key` indexes | same names and predicates, `location_id` taken out of the column list |
   | `seasons_location_starts_key`, `seasons_location_name_key` | `seasons_starts_key` (`starts_on`), `seasons_name_key` (`name`) |
   | `special_day_dates_location_date_key` | `special_day_dates_date_key` (`date`) |
   | `bookings_location_date_idx` | `bookings_date_idx` (`booking_date`) — the index the A1301 plan's "Indexes that lead with `location_id`" asked for |
   | `attendance_day_work_scope_uq`, `_due_idx`; `attendance_operation_facts_day_idx`; `attendance_questions_shift_uq`, `_subject_uq`; `attendance_source_state_scope_uq`, `_watch_idx`; `roster_versions_published_period_uq` | same names, `location_id` taken out of the column list (A1301 working-time plan, "Carried to other slices", S22) |
   | `roster_versions_location_idx`, `shift_templates_location_idx`, `convenio_config_location_uq` | deleted (their only column was `location_id`) |
   | `staff_roles_location_name_key` | `staff_roles_name_key` (`name`) |

   The two composite foreign keys onto `attendance_questions(id, person_id, location_id)`
   (`attendance_questions.canonical_question_id…` and `attendance_response_commands.question_id…`)
   become keys onto `(id, person_id)`, which `attendance_questions_subject_uq` now holds. The
   protection is unchanged: today a command with a question always carries the location
   (`attendance-response-commands.ts:266`), so the old key was enforced exactly when the new one is.
3. **`convenio_config` becomes one row** (A1301 design §2.2): `id` becomes `count("id").primaryKey()`
   with CHECK `convenio_config_singleton_ck` (`id = 1`), as `tenants` does
   (`packages/db/src/schema/tenants.ts:38-55`). Its readers and writer
   (`packages/workforce-es/src/convenio.ts:64,121` and the insert near them) read and write `id = 1`.
4. **Product code stops filling or filtering the column**: every `venueLocationId` call that fed one
   of these tables, and every `location_id = …` condition on them, goes (the list is under Files).
   `bookingsOnDay` (`packages/bookings/src/bookings.ts:107`) and `staffRolesNamed`
   (`packages/staffing/src/staff-roles.ts:151,170`) lose the location condition they kept only for
   the old index (A1301 plan, "Indexes that lead with `location_id`").
5. **Second-location cases on these tables are deleted**, and the raw second-location branch of
   workforce's `seedLocation` (`packages/workforce/test/fixtures.ts:55` area) goes with them
   (backlog A1301 entry, "Fixture lines the helpers could not take").
6. **The personal-data download's rota file loses its `location` field** and its readme words
   (backlog A1301 entry: "the personal-data export's `location` key and its readme line go with
   S22"): `packages/workforce/src/personal-data.ts:1,67,76,187` (the `locations` join goes) and
   `apps/server/src/i18n/personal-data-readme.ts:71` ("their times, location and the state of the
   rota" → "their times and the state of the rota") and `:194` ("sus horas, el centro y el estado"
   → "sus horas y el estado"). This takes the A1301 working-time plan's second option (drop the
   field), so `personal-data.test.ts`'s index-only read case needs no exception.
7. `AttendanceResponseReceipt.locationId` (`packages/workforce/src/attendance-contract.ts:41`) goes
   with the column it mirrors (working-time plan, "Carried to other slices").
8. **The configuration export changes**: the transferred tables are exported with `select *`
   (`packages/provisioning/src/configuration-transfer.ts:68-101`), so their rows lose `location_id`.
   The bundle's format rises by one from `main`'s value (rules §9); the previous format is refused as
   `setup.configuration_outdated`.
9. **The Madrid capture gains a "dropped columns" transform.** The capture
   (`packages/country-es/test-fixtures/demo/madrid-before-move.*`) is frozen and never regenerated
   (A1301 plan, "Carried to the schema plan"); `seed.madrid-baseline.test.ts` already renames columns
   (`RENAMED_COLUMNS`, `:22`) and adds or removes empty tables (`ADDED_TABLES`, `REMOVED_TABLES`,
   `:24-39,121-135`), but nothing drops a column from captured rows. A new
   `apps/server/scripts/demo-seed/testing/madrid-dropped-columns.ts` (with its test) removes named
   columns from each phase's table rows and column lists, and the test lists this slice's
   `location_id` columns. `madrid-semantics.ts:248` (the `routing_cells` key) loses `location_id`.
   The demo seed's raw SQL on these tables stops filtering by the column:
   `apps/server/scripts/demo-seed/seed-catalogue.ts:60` (departments) and `:119`, `seed-floor.ts:41`
   (zone service policies).
10. **A committed, idempotent script** removes the `locationId` key from inserts into these tables
   across the tree: `scripts/a1308/drop-location-id.mjs` with its test (Task 1). 5d, 5e and 5f re-run it
   with their own table lists; 5h deletes it.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| `holiday_geographies.location_id` (the table is deleted) | 5c |
| `nodes.location_id` | 5f (owner) |
| `devices`, `working_orders`, `tender_refunds`, `join_requests`, `dining_tables`, `floor_plan_sets`, `floor_zones`, `kitchen_stations`, `kitchen_courses`, `print_agents`, `printers`, `print_jobs`, `page_printers` | 5e (needs 5d's edit to the fiscal pair, because `write-path.e2e.test.ts:552-555` reads `devices.location_id`) |
| `location_catalogues` | 4a-ii deletes it (coordinator, 2026-11-08) |
| The configuration import's rule that fills every foreign key into `locations` with the venue's row (`packages/provisioning/src/configuration-transfer.ts:658-690,738-740`) | 5e: other transferred tables still point at `locations` until then |
| Merging `zone_service_policies` into `floor_zones`, `department_days` into `opening_hours` and the rest | the area slices (floor and kitchen, venue and box); this slice only removes the column |
| Deleting `attendance_source_state` (README U6) | people and working time; this slice only removes its column |

## Work beside this slice (rules §8)

- In-flight pull requests checked on 2026-11-08 (`gh pr list --state open`, then
  `gh pr view <n> --json files`): none changes a table this slice changes. #2570 edits only comments
  in `packages/db/src/schema/orders.ts` and `working-order-counters.ts`; #2594 adds an index to
  `print_jobs` (5e's table, not this one). A790 Cut A (#2455) adds six tables, none with a
  `location_id` (read at its head `f1f184de51`: `git show pr/2455:packages/db/src/schema/<file>.ts`
  for the four schema files), and its plan forbids adding one
  (`docs/superpowers/plans/2026-11-04-a790-venue-document-printer-routing.md:17`); the sweep needs
  nothing from it either way.
- The builder re-runs that check at its base. A schema change to one of this slice's eighteen tables
  that is open when the slice starts is a stop (rules §5.5).

## Files

Run at the worktree's base before starting; each prints today's count for the size estimate:

```zsh
git grep -c -E "locationId|location_id" -- 'packages/venue-service/src/*' 'packages/staffing/src/*' 'packages/bookings/src/*' 'packages/workforce/src/*' 'packages/workforce-es/src/*' 'apps/server/src/attendance-*.ts' ':!*.test.ts' ':!**/schema/**'
# 51 lines in 21 files at a086eedfb7
for t in departments orderServiceContexts zoneServicePolicies routingCells seasons specialDayDates specialDays bookings attendanceDayWork attendanceOperationFacts attendanceQuestions attendanceResponseCommands attendanceSourceState rosterVersions shiftTemplates shifts staffRoles convenioConfig; do print "$t $(git grep -l "insert($t)" -- '*.test.ts' '**/testing/**' '**/test/**' | wc -l)"; done
# 185 file-hits at a086eedfb7 (departments 44, shifts 21, specialDays 16, specialDayDates 16, …)
```

Create:

- `scripts/a1308/drop-location-id.mjs`, `scripts/a1308/drop-location-id.test.mjs` (Task 1).

Modify — schema (then `pnpm --filter @waitron/server migration-baseline rebuild --set <name>` for
`core`, `bookings`, `workforce`, `workforce-es`):

- `packages/db/src/schema/venue-service/service.ts`, `routing.ts`, `seasons.ts` (and the schema
  comments that use "location" as prose there, A1301 plan "Carried to the schema plan", 2026-11-05
  item);
- `packages/bookings/src/schema/bookings.ts`;
- `packages/workforce/src/schema/attendance.ts`, `attendance-responses.ts`, `roster-versions.ts`
  (and its prose comment `:52`), `shift-templates.ts` (and `:16`), `shifts.ts`,
  `staffing/staffing.ts`;
- `packages/workforce-es/src/schema/convenio-config.ts` (and its prose comments `:27,93,99`).

Modify — product code (each line a `venueLocationId` call or a location condition, from the grep
above and the `venueLocationId` list at a086eedfb7):

- `packages/venue-service/src/operations.ts:180,399,459,1074,1372`, `provisioning.ts:32` (and the
  three uses of `venueRowId` it serves), `routing-store.ts:337`, `seasons.ts:54,178`,
  `special-days.ts:1007`, `testing/zone-menus.ts` (2 lines);
- `packages/bookings/src/bookings.ts:79,107` (and `bookingsOnDay`'s parameter),
  `testing/fake-core.ts` (2 lines);
- `packages/staffing/src/staff-roles.ts:151,170` (`assertNameFree`'s venue parameter);
- `packages/workforce/src/attendance-questions.ts:138`, `attendance-response-commands.ts:266`,
  `attendance-state.ts:42`, `clocking.ts:305,326,424` (raw SQL: the `location_id` column and value
  go from the two inserts, the condition from the read), `attendance-contract.ts:41`,
  `personal-data.ts:1,67,76,187`;
- `packages/workforce-es/src/convenio.ts:64,121` (and its insert);
- `apps/server/src/attendance-capture.ts:103`, `attendance-discovery.ts:81,206,438,553` (the
  equalities S13e2 and S13f kept, working-time plan "Carried to other slices"),
  `attendance-integrated.ts:47`, `attendance-source-changes.ts:62` (and its conflict target, which
  names the unique index whose columns change, `:93-98` at the working-time plan's head);
- `apps/server/src/i18n/personal-data-readme.ts:71,194`.

Modify — tests and helpers: the script's output, plus the hand edits Task 4 lists.

Modify — guards and lists: `scripts/schema-constraints.test.ts` (foreign keys, unique index names
`:480-515`, CHECK names), `packages/workforce/src/index.test.ts:285`,
`packages/bookings/src/migrations.test.ts:76`, `packages/bookings/src/schema/bookings.test.ts:38`,
`packages/workforce/src/migrations.test.ts`, `packages/workforce-es/src/migrations.test.ts`,
`packages/db/src/schema/venue-service/migrations.test.ts` (each pins index columns),
`scripts/id-columns-are-references.test.ts` if it lists a dropped column,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and the new
`testing/madrid-dropped-columns.ts` (item 9), `testing/madrid-semantics.ts:248`,
`demo-seed/seed-catalogue.ts:60,119`, `demo-seed/seed-floor.ts:41`; the bundle-format rows
(`packages/provisioning/src/configuration-transfer.ts` `version`, `packages/provisioning/test/configuration-bundle.ts`,
`apps/server/src/configuration-import.test.ts`).

Docs: `docs/backlog/architecture.md` (A1301 entry: the S20, S21, S22 lines this finishes; "What
A1308 retires" has none for these tables), `docs/developers/conventions-data.md` lines naming
`convenio_config_location_uq` or "per location" for these tables
(`git grep -n -i "location" docs/developers/conventions-data.md` and read each hit).

Regenerated by the rebuild command, never by hand: `packages/{db,bookings,workforce,workforce-es}/drizzle/**`,
`scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted (hand-written) |
| --- | --- |
| The script and its test | ~200 + ~160 |
| Schema edits (index re-keys, the singleton, composite keys; column lines are deletions) | ~70 |
| Product code changes beyond deletions (signatures, `and(…)` reduced to one condition, raw SQL lists) | ~120 |
| Hand edits in tests (raw SQL column lists, index-plan and index-list assertions, `convenio_config` id) | ~200 |
| Docs, readme strings | ~25 |
| Bundle format rows | ~20 |
| Madrid "dropped columns" transform and its test; demo-seed SQL | ~60 + ~10 |
| **Total** | **~865** |

Not counted: the script's output (rules §1), deleted lines (deleted second-location cases, deleted
`locationId:` lines), the regenerated migration files. About 3 hours; the script run is mechanical
but the fallout touches ~185 test files, so the implementer dispatch is split at Task 4 (rules §1,
the 150-call handover).

## Finish line

Read the `Tests` count of every Vitest run, never the exit status alone (CLAUDE.md §4).

1. `pnpm exec vitest run scripts/a1308/drop-location-id.test.mjs` passes, and the reviewer's re-run
   (under "The location sweep, in one place") gives the output commit exactly; running the script
   again on the pull request's tree changes nothing.
2. ```zsh
   git grep -n -E "locationId|location_id|venueLocationId" -- 'packages/venue-service/src/*' 'packages/staffing/src/*' 'packages/bookings/src/*' 'packages/workforce/src/*' 'packages/workforce-es/src/*' 'apps/server/src/attendance-*.ts'
   ```
   prints only lines about `holiday_geographies` (`packages/venue-service/src/holidays.ts`, 5c) and
   test lines that seed a table 5e still owns (for example `seedKitchenStation(…, { locationId })`).
3. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/personal-log-params.test.ts scripts/english-only.test.ts scripts/errors-reachable.test.ts` passes.
4. Focused suites pass: `pnpm --filter @waitron/bookings exec vitest run`, `pnpm --filter @waitron/staffing exec vitest run`,
   `pnpm --filter @waitron/workforce-es exec vitest run`, and in `@waitron/workforce`,
   `@waitron/venue-service` and `@waitron/server` the files the script or a hand edit touched
   (`git diff --name-only origin/main -- '<pkg>/**/*.test.ts'`). Check free memory first
   (`memory_pressure | grep free`).
5. In `packages/bookings/src/bookings.test.ts`, the case renamed "plans the day list on the date
   index, not a scan" sees `USING INDEX bookings_date_idx`; in
   `packages/staffing/src/staff-roles.test.ts:139` the plan names `staff_roles_name_key`.
6. The fiscal pair passes unedited (A1301 plan, "The fiscal pair": both runs print a `Tests` line,
   `git diff --exit-code origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts` exits 0).
7. From `apps/server`, `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Every line below appears under each of the six `DIFF composition=… phase=… database=venue` headers
(two compositions × `sql-only`, `migrated`, `change-feed`), except `trigger waitron_change_*`
lines, which appear only under the two `change-feed` headers. `node.db` prints nothing. `changed`
lines are followed by `old:`/`new:` lines, not repeated here; a `columnOrder` line's two lists
differ only by `location_id`.

**How this list was made (a simulation, not the real build):** on 2026-11-08 at `a086eedfb7` the
built `fiscal-verifactu` change-feed `venue.db` from `pnpm protection-list list` was copied, its
schema text was edited as this plan says (column and foreign key removed, indexes as in the table
above, `convenio_config`'s id and CHECK, the update triggers' `when` without the column), and the
copy was compared with the original through the tool's own `readSchema` and `compareSchemaLists`
(script kept at
`/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/60457ed1-4051-43f0-8e47-e2be7ba7709b/scratchpad/a1308-5/sim.ts`).
A control: an earlier run that dropped only `shifts`' column printed only `shifts` lines. What the
simulation cannot show is the generator's own index text; a predicate or column written
differently by drizzle-kit would print an extra `changed index … .predicate` line, which is a stop.

Reason for every line: A1301 design §4 ("Tables carrying `location_id`", "Unique keys that include
`location_id` lose that column") and §2.2 for `convenio_config`.

```text
changed index attendance_day_work_due_idx.columns[0].column
changed index attendance_day_work_due_idx.columns[1].column
changed index attendance_day_work_due_idx.columns[1].key
missing index attendance_day_work_due_idx.columns[2]
changed index attendance_day_work_scope_uq.columns[0].column
changed index attendance_day_work_scope_uq.columns[1].column
changed index attendance_day_work_scope_uq.columns[1].key
missing index attendance_day_work_scope_uq.columns[2]
changed index attendance_operation_facts_day_idx.columns[0].column
changed index attendance_operation_facts_day_idx.columns[1].column
changed index attendance_operation_facts_day_idx.columns[2].column
changed index attendance_operation_facts_day_idx.columns[3].column
changed index attendance_operation_facts_day_idx.columns[3].key
missing index attendance_operation_facts_day_idx.columns[4]
changed index attendance_questions_shift_uq.columns[1].column
changed index attendance_questions_shift_uq.columns[2].column
changed index attendance_questions_shift_uq.columns[2].key
missing index attendance_questions_shift_uq.columns[3]
changed index attendance_questions_subject_uq.columns[2].column
changed index attendance_questions_subject_uq.columns[2].key
missing index attendance_questions_subject_uq.columns[3]
changed index attendance_source_state_scope_uq.columns[0].column
changed index attendance_source_state_scope_uq.columns[1].column
changed index attendance_source_state_scope_uq.columns[2].column
changed index attendance_source_state_scope_uq.columns[3].column
changed index attendance_source_state_scope_uq.columns[3].key
missing index attendance_source_state_scope_uq.columns[4]
changed index attendance_source_state_watch_idx.columns[0].column
changed index attendance_source_state_watch_idx.columns[1].column
changed index attendance_source_state_watch_idx.columns[2].column
changed index attendance_source_state_watch_idx.columns[3].column
changed index attendance_source_state_watch_idx.columns[3].key
missing index attendance_source_state_watch_idx.columns[4]
missing index bookings_location_date_idx
missing index convenio_config.primary key(id)
missing index convenio_config_location_uq
missing index departments_location_name_key
missing index departments_one_default_per_location_key
missing index roster_versions_location_idx
changed index roster_versions_published_period_uq.columns[0].column
changed index roster_versions_published_period_uq.columns[1].column
changed index roster_versions_published_period_uq.columns[2].column
changed index roster_versions_published_period_uq.columns[2].key
missing index roster_versions_published_period_uq.columns[3]
changed index routing_cells_all_zone_key.columns[0].column
changed index routing_cells_all_zone_key.columns[1].column
changed index routing_cells_all_zone_key.columns[1].key
missing index routing_cells_all_zone_key.columns[2]
changed index routing_cells_category_every_zone_key.columns[0].column
changed index routing_cells_category_every_zone_key.columns[1].column
changed index routing_cells_category_every_zone_key.columns[1].key
missing index routing_cells_category_every_zone_key.columns[2]
changed index routing_cells_category_zone_key.columns[0].column
changed index routing_cells_category_zone_key.columns[1].column
changed index routing_cells_category_zone_key.columns[2].column
changed index routing_cells_category_zone_key.columns[2].key
missing index routing_cells_category_zone_key.columns[3]
changed index routing_cells_no_category_every_zone_key.columns[0].column
changed index routing_cells_no_category_every_zone_key.columns[1].column
changed index routing_cells_no_category_every_zone_key.columns[1].key
missing index routing_cells_no_category_every_zone_key.columns[2]
changed index routing_cells_no_category_zone_key.columns[0].column
changed index routing_cells_no_category_zone_key.columns[1].column
changed index routing_cells_no_category_zone_key.columns[2].column
changed index routing_cells_no_category_zone_key.columns[2].key
missing index routing_cells_no_category_zone_key.columns[3]
changed index routing_cells_product_every_zone_key.columns[0].column
changed index routing_cells_product_every_zone_key.columns[1].column
changed index routing_cells_product_every_zone_key.columns[1].key
missing index routing_cells_product_every_zone_key.columns[2]
changed index routing_cells_product_zone_key.columns[0].column
changed index routing_cells_product_zone_key.columns[1].column
changed index routing_cells_product_zone_key.columns[2].column
changed index routing_cells_product_zone_key.columns[2].key
missing index routing_cells_product_zone_key.columns[3]
missing index seasons_location_name_key
missing index seasons_location_starts_key
missing index shift_templates_location_idx
missing index special_day_dates_location_date_key
missing index staff_roles_location_name_key
changed index zone_service_policies_one_counter_default_key.columns[0].column
changed table attendance_day_work.columnOrder
missing table attendance_day_work.columns[location_id]
missing table attendance_day_work.foreignKeys[location_id->locations(id)]
changed table attendance_operation_facts.columnOrder
missing table attendance_operation_facts.columns[location_id]
missing table attendance_operation_facts.foreignKeys[location_id->locations(id)]
changed table attendance_questions.columnOrder
missing table attendance_questions.columns[location_id]
missing table attendance_questions.foreignKeys[canonical_question_id,person_id,location_id->attendance_questions(id,person_id,location_id)]
missing table attendance_questions.foreignKeys[location_id->locations(id)]
changed table attendance_response_commands.columnOrder
missing table attendance_response_commands.columns[location_id]
missing table attendance_response_commands.foreignKeys[question_id,person_id,location_id->attendance_questions(id,person_id,location_id)]
missing table attendance_response_commands.foreignKeys[location_id->locations(id)]
changed table attendance_source_state.columnOrder
missing table attendance_source_state.columns[location_id]
missing table attendance_source_state.foreignKeys[location_id->locations(id)]
changed table bookings.columnOrder
missing table bookings.columns[location_id]
missing table bookings.foreignKeys[location_id->locations(id)]
changed table convenio_config.columnOrder
changed table convenio_config.columns[id].type
missing table convenio_config.columns[location_id]
missing table convenio_config.foreignKeys[location_id->locations(id)]
changed table departments.columnOrder
missing table departments.columns[location_id]
missing table departments.foreignKeys[location_id->locations(id)]
changed table order_service_contexts.columnOrder
missing table order_service_contexts.columns[location_id]
changed table roster_versions.columnOrder
missing table roster_versions.columns[location_id]
missing table roster_versions.foreignKeys[location_id->locations(id)]
changed table routing_cells.columnOrder
missing table routing_cells.columns[location_id]
missing table routing_cells.foreignKeys[location_id->locations(id)]
changed table seasons.columnOrder
missing table seasons.columns[location_id]
missing table seasons.foreignKeys[location_id->locations(id)]
changed table shift_templates.columnOrder
missing table shift_templates.columns[location_id]
missing table shift_templates.foreignKeys[location_id->locations(id)]
changed table shifts.columnOrder
missing table shifts.columns[location_id]
missing table shifts.foreignKeys[location_id->locations(id)]
changed table special_day_dates.columnOrder
missing table special_day_dates.columns[location_id]
missing table special_day_dates.foreignKeys[location_id->locations(id)]
changed table special_days.columnOrder
missing table special_days.columns[location_id]
missing table special_days.foreignKeys[location_id->locations(id)]
changed table staff_roles.columnOrder
missing table staff_roles.columns[location_id]
missing table staff_roles.foreignKeys[location_id->locations(id)]
changed table zone_service_policies.columnOrder
missing table zone_service_policies.columns[location_id]
missing table zone_service_policies.foreignKeys[location_id->locations(id)]
changed trigger waitron_change_attendance_day_work_update.when
changed trigger waitron_change_attendance_operation_facts_update.when
changed trigger waitron_change_attendance_questions_update.when
changed trigger waitron_change_attendance_response_commands_update.when
changed trigger waitron_change_attendance_source_state_update.when
changed trigger waitron_change_bookings_update.when
changed trigger waitron_change_convenio_config_update.when
changed trigger waitron_change_departments_update.when
changed trigger waitron_change_order_service_contexts_update.when
changed trigger waitron_change_roster_versions_update.when
changed trigger waitron_change_routing_cells_update.when
changed trigger waitron_change_seasons_update.when
changed trigger waitron_change_shift_templates_update.when
changed trigger waitron_change_shifts_update.when
changed trigger waitron_change_special_day_dates_update.when
changed trigger waitron_change_special_days_update.when
changed trigger waitron_change_staff_roles_update.when
changed trigger waitron_change_zone_service_policies_update.when
extra table attendance_questions.foreignKeys[canonical_question_id,person_id->attendance_questions(id,person_id)]
extra table attendance_response_commands.foreignKeys[question_id,person_id->attendance_questions(id,person_id)]
extra table convenio_config.checks[convenio_config_singleton_ck]
extra index bookings_date_idx
extra index departments_name_key
extra index departments_one_default_key
extra index seasons_name_key
extra index seasons_starts_key
extra index special_day_dates_date_key
extra index staff_roles_name_key
```

Gained: `convenio_config_singleton_ck` (the design's one-row rule). Lost, each by design: the
location half of every key listed (one venue, A1301 §1) and the foreign keys into `locations`.

## Stop points (beyond rules §5)

1. 1a's rebuild command does not exist, or refuses a set this slice names.
2. The script reports a `locationId` property it cannot classify in a file that seeds one of these
   tables and the typecheck still passes with it in place (a value read elsewhere): list it, do not
   guess.
3. A case can only pass after its assertion changes, other than: the index names in the plan-reading
   and index-listing cases named under Finish line 5 and Files; the deleted second-location cases;
   `convenio_config`'s id shape in its own schema test. Each of those is "Assertions that change, by
   design" below.
4. A behaviour on a one-venue box changes: for example a staff-role name refusal that no longer
   fires, or a booking list that returns other rows.

## Assertions that change, by design

- The index names and columns pinned in `bookings.test.ts:241-254`, `migrations.test.ts:76`,
  `schema/bookings.test.ts:38`, `staff-roles.test.ts:139`, `workforce/src/index.test.ts:285`,
  `scripts/schema-constraints.test.ts` and the three `migrations.test.ts` files: A1301 §4 re-keys
  them. Each assertion keeps its shape (the read still uses an index, not a scan).
- Second-location cases on these tables are deleted, by title, each listed in the pull request
  (A1301 plan, "Cross-location tests are deleted, not rewritten").
- `convenio_config`'s schema test: a second row is refused by the singleton CHECK instead of by
  `convenio_config_location_uq` (A1301 §2.2).
- The rota file of the personal-data download has no `location` key (backlog A1301 entry).
- The bundle-format rows: the new number, the previous one refused as outdated (rules §9).

---

### Task 1: The script, test first

**Files:** create `scripts/a1308/drop-location-id.mjs`, `scripts/a1308/drop-location-id.test.mjs`.

**Interfaces:**

```text
node scripts/a1308/drop-location-id.mjs --tables <identifier,…>
    [--helper-prop <function>.<property>,…] [--helper-arg <function>#<index>,…]
    [--write] <file…>
```

It parses each file alone with `typescript`'s `createSourceFile` (no type checker), as
`scripts/a1301-seed-codemod.mjs:103` does, and splices text by node positions (its `applyEdits`,
`:113`, is the model), never reprinting; `pnpm exec prettier --write` tidies the touched files
afterwards. Without `--write` it prints what it would change and the report, and writes nothing.

Rules, applied in this order, each only in files that are not the fiscal pair (it prints
`<path>: fiscal pair file: never rewritten` for those two and skips them):

1. **Insert and update chains.** In a call chain `<x>.insert(<T>).values(<V>)`,
   `<x>.insert(<T>).values(<V>).onConflict…(…)` or `<x>.update(<T>).set(<V>)` where `<T>` is an
   identifier named in `--tables`, and `<V>` is an object literal or an array literal of object
   literals, delete each property named `locationId` (a `PropertyAssignment` or a
   `ShorthandPropertyAssignment`), with its trailing comma and its line when it sits alone on one.
   In an `onConflictDoNothing({ target: [...] })` or `onConflictDoUpdate({ target: [...] })` of such
   a chain, delete an array element `<T>.locationId`.
2. **Helper properties** (`--helper-prop seedKitchenStation.locationId`): in a call to that function
   name (a bare identifier or the last name of a property access), delete the property from each
   object-literal argument.
3. **Helper arguments** (`--helper-arg seedNode#1`): delete that argument (0-based) of each call to
   that function when it is the call's last argument.
4. **Leftovers, until nothing changes.** Delete a variable statement with one declaration whose
   name is an identifier with no remaining reference in the file (references: identifier tokens of
   that text that are not a property name, a declaration name or inside the statement itself), when
   its initializer, after stripping `await`, parentheses, `as …` and `!`, is a call to
   `venueLocationId`, `locationId` or `brandLocationId`, or a property access whose name is
   `locationId`. Then delete each import specifier named `venueLocationId`, `locationId`,
   `LocationId` or `brandLocationId` that is no longer referenced, and an import declaration it
   empties.
5. **Report.** For every scanned file, print `path:line: hand edit: <line text>` for each remaining
   line matching `/\blocationId\b|location_id|venueLocationId/`.

Running it twice changes nothing the second time (idempotence: rules §1).

- [ ] **Step 1: Write the failing tests** (Vitest, as the other `scripts/*.test.mjs` files) calling the exported `transformSource(path, source, options)`:
  - "drops locationId from an insert into a listed table and leaves an unlisted one":
    `db.insert(shifts).values({ personId, locationId: venue, startsAt })` loses the key;
    `db.insert(printers).values({ locationId: venue })` with `--tables shifts` is unchanged.
  - "drops it from every row of an array insert, and from an update's set".
  - "drops a shorthand property, a multi-line property and a conflict target element".
  - "drops a helper property and a helper's last argument" (`seedKitchenStation(db, { locationId })`,
    `seedNode(db, venueId)` → `seedNode(db)`), and leaves `seedNode(db, venueId, other)` alone.
  - "deletes a venue-id declaration left with no reference, then its import": a file with
    `import { venueLocationId, withTransaction } from "@waitron/db";` and
    `const venueId = await venueLocationId(db);` used only in a removed property ends with neither.
  - "keeps a declaration still read elsewhere, and reports the read".
  - "never touches the fiscal pair": the two paths return their source unchanged with the report
    line.
  - "a second run changes nothing" for each fixture above.
  - "reports a remaining location_id in raw SQL".
- [ ] **Step 2:** `pnpm exec vitest run scripts/a1308/drop-location-id.test.mjs` — fails (no module).
- [ ] **Step 3:** Write the script. Export `transformSource`; the command line reads the files, calls
  it, writes when `--write`, prints the report.
- [ ] **Step 4:** Run the test; it passes. Root coverage measures `scripts/**/*.mjs` (`vitest.config.ts:119`)
  at 98/98/98/95 (CLAUDE.md §2): run `pnpm exec vitest run --coverage scripts/a1308/drop-location-id.test.mjs`
  and read the file's row.
- [ ] **Step 5:** Commit (`git commit -s`), message naming rules §1.

### Task 2: The schema

**Files:** the schema files listed under Files; regenerated migrations.

- [ ] **Step 1: Take the base protection list** (rules §3) in a throwaway worktree of the base
  commit: from its `apps/server`, `pnpm protection-list list --out <empty absolute dir A>`.
- [ ] **Step 2: Write the failing database cases** (rules §4: a refusal and a legitimate write for
  each new rule):
  - in `packages/workforce-es`'s schema test: "keeps one convenio row": inserting `id = 2` is
    refused with `checkFailed(error, "convenio_config_singleton_ck")`
    (`packages/db/src/constraint-target.ts:197`); inserting `id = 1` succeeds; a second `id = 1` is
    refused by the primary key.
  - in `packages/db/src/schema/venue-service/migrations.test.ts` (or the departments schema test it
    sits beside): "allows one default department": a second `is_default = 1` department is refused
    naming `departments_one_default_key`; two `is_default = 0` succeed. The same pair for
    `zone_service_policies_one_counter_default_key`.
  - in `packages/workforce/src/migrations.test.ts`: "a command's question belongs to its person": a
    command naming a question of another person is refused (foreign key, written through, CLAUDE.md
    §3 "refused at the first WRITE"); the same person succeeds.
- [ ] **Step 3:** Run them; they fail (the singleton CHECK and the new index names do not exist).
- [ ] **Step 4:** Edit the schema files: delete each `locationId` column and its `foreignKey(…)` /
  `.references(…)`, write each index as in the table under "What it builds", the composite keys
  onto `(id, person_id)`, and `convenio_config`'s `id` and CHECK. Delete or reword the prose
  comments listed under Files (prefer deleting, CLAUDE.md §1).
- [ ] **Step 5:** `pnpm --filter @waitron/server migration-baseline rebuild --set core`, then
  `--set bookings`, `--set workforce`, `--set workforce-es` (rules §2). Never edit `drizzle/*` or the
  epoch file by hand.
- [ ] **Step 6:** Run the Step 2 cases; they pass. Commit the schema edits alone (the tree does not
  typecheck until Task 3; this commit exists so the reviewer can re-run the script from it).

### Task 3: Product code and the script run

- [ ] **Step 1:** Run the script over the tree with the 5a table list:

  ```zsh
  T=departments,orderServiceContexts,zoneServicePolicies,routingCells,seasons,specialDayDates,specialDays,bookings,attendanceDayWork,attendanceOperationFacts,attendanceQuestions,attendanceResponseCommands,attendanceSourceState,rosterVersions,shiftTemplates,shifts,staffRoles,convenioConfig
  node scripts/a1308/drop-location-id.mjs --tables "$T" --write $FILES > <report file outside the repository>
  git diff --name-only -z | xargs -0 pnpm exec prettier --write
  ```

  (`$FILES` is a zsh array, defined under "The location sweep, in one place"; an unquoted string
  would be one argument, CLAUDE.md global "The Bash tool's shell is zsh".) Commit the script's output alone, so the reviewer can re-run it (rules §1).
- [ ] **Step 2:** Hand-edit the product code listed under Files that the script left (conditions,
  signatures, raw SQL). `bookingsOnDay(tx, date)` and `assertNameFree(tx, name, staffRoleId)` lose
  the venue parameter; their callers follow. `convenio.ts` reads `.where(eq(convenioConfig.id, 1))`
  and writes `id: 1`.
- [ ] **Step 3:** The personal-data rota file: delete the `location` selection, the join and the
  `location:` field (`personal-data.ts:1,67,76,187`); edit the two readme strings exactly as under
  "What it builds" item 6.
- [ ] **Step 4:** Typecheck the touched packages (`pnpm --filter <pkg> typecheck` for venue-service,
  bookings, staffing, workforce, workforce-es, server) and run the focused suites of the product
  files changed. Commit.

### Task 4: Tests the script did not finish

Split point: a fresh implementer may take this task from the Task 3 commit.

- [ ] **Step 1:** Work through Task 3's report file by file. Each `hand edit` line is one of:
  - a raw SQL insert naming `location_id` for one of these tables: remove the column and its value;
  - a second-location case (it creates or names a second location for one of these tables):
    delete the case by title and add the title to the pull request's list;
  - a test-helper parameter or return that carried the id only for these tables: remove it;
  - a line about a table 5c, 5d or 5e owns: leave it.
- [ ] **Step 2:** Re-point the index assertions named under "Assertions that change, by design";
  rename the bookings case as Finish line 5 says.
- [ ] **Step 3:** Delete workforce's `seedLocation` second-location branch once no caller passes a
  second location (`packages/workforce/test/fixtures.ts`).
- [ ] **Step 4:** Run Finish lines 2–6. Commit.

### Task 5: Lists, docs, protection list, finish

- [ ] **Step 1:** Update the guards and lists under Files. Write the Madrid "dropped columns"
  transform test first (a captured row loses the named column; an unnamed column stays; a table not
  in the capture is refused), then the transform (item 9). Raise the bundle format and its rows
  (item 8).
- [ ] **Step 2:** Backlog: in `docs/backlog/architecture.md`'s A1301 entry, delete the S20/S21/S22
  points this finishes (`bookingsOnDay`'s kept condition, `staffRolesNamed`'s, the `seedLocation`
  branch, the personal-data `location` key); update "Still open" to "5b–5h of A1308's slice 5".
- [ ] **Step 3:** From `apps/server`, `pnpm protection-list list --out <B>` and
  `pnpm protection-list compare --old <A> --new <B> --report <file>`; paste the report into the pull
  request and mark each line against the prediction (rules §3).
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch` (rules §9).
