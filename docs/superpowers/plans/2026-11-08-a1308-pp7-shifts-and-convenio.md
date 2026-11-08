# A1308 pp7 — a shift is one row, always on a rota week, and the convenio is one row: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `shift_assignments` (one optional row per shift naming its role and area) folds into
`shifts` as `role_id`, `department_id` and `station_id`; `shifts.roster_version_id` becomes required,
and deleting a draft rota week deletes its shifts; `convenio_config` (the Spanish collective-agreement
rules) is held to one row by a CHECK.

**Words used here.** A *rota week* is a `roster_versions` row: one week's planned shifts, draft,
published or superseded. A shift's *area* is the department (front of house) or kitchen station it
fills; a shift with no role fills no slot ("not in a slot", `staffing.ts:149`).

**Architecture:** three columns and one CHECK on `shifts`; every reader that joined
`shift_assignments` reads the shift's own columns; the code that handled a shift with no rota week
(attaching it later) is deleted, because nothing can write one any more. `convenio_config`'s id
becomes the integer 1, as `pay_period_settings` does (`packages/workforce/src/schema/pay-period-settings.ts:9`, `:14`).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §3 R1; [people
appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1 `shifts`, `convenio_config`,
`staffing_blocks`; §4 and §5 (rows for `shifts`, `shift_assignments`, `convenio_config`,
`staffing_blocks`).

**First line of the pull request:** "Every venue is reset: workforce, workforce-es; backups and
exports from before this cannot be restored or imported." (rules §2; drop `workforce-es` if Task 4
finds slice 5 already made `convenio_config` one row)

**Who lands:** the lane (rules §6: nothing fiscal).

**Cites** read at `a086eedfb7`. A1002 cut 2 has rewritten the staffing role code (`staff-roles.ts`,
`rota.ts`) and replaced `staff_roles` with `roles`; slice 5 removed `location_id`. 

---

## What it builds

- `shifts` (`packages/workforce/src/schema/shifts.ts`) gains:
  - `role_id` `id`, null, `shifts_role_fk` → `roles(id)` on delete restrict (A1002 retires a role a
    shift used rather than deleting it, design §6).
  - `department_id` `id`, null, `shifts_department_fk` → `departments(id)` on delete **restrict**.
  - `station_id` `id`, null, `shifts_station_fk` → `kitchen_stations(id)` on delete **restrict**.
  - `shifts_one_area_ck`: `(role_id is null and department_id is null and station_id is null) or
    (role_id is not null and (department_id is null) <> (station_id is null))` — the old
    `shift_assignments_one_area_ck` (`staffing.ts:180-183`), extended for "no slot".
- `roster_version_id` not null; `shifts_roster_version_fk` on delete cascade (was set null,
  `shifts.ts:38-42`).
- `shift_assignments` deleted, with its classification row (`packages/workforce/src/classification.ts`
  `WORKFORCE_CLASSIFICATION`), exports, the staffing backup check's use
  (`packages/staffing/src/backup-verification.ts`), live-query dependencies
  (`packages/staffing/src/dashboard/live-queries.ts:11`, `:17` → `shifts`), personal data
  (`packages/staffing/src/personal-data.ts`), and the Madrid fixtures' rows (pp1 assumption B2).
- Writers: `addRotaShift` (`packages/staffing/src/rota.ts:226-253`), the slot change (`:300-310`)
  and the copy (`:352`) set the three columns on `shifts` instead of inserting an assignment.
  The workforce copy of a week into a new draft is raw SQL (`packages/workforce/src/clocking.ts:326-334`,
  `insert into shifts (…) select …`) and must carry `role_id`, `department_id` and `station_id`, or a
  copied week loses its slots. Readers: `rota-data.ts:40-60`, `describe-shifts.ts`, A1002's role-use check (whatever query it
  uses to ask "has a shift used this role?" now reads `shifts.role_id`).
- Deleted, because a shift always has a rota week: `unattachedWeek` and its calls
  (`rota.ts:266-290`, `:337`), the unattached-shift reads (`apps/server/src/workforce-api.ts:134-143`,
  `rota-data.ts:46-50`), the publish step that attaches week-less shifts
  (`packages/workforce/src/clocking.ts:504-512`), and the null branch of `shiftForWrite`
  (`clocking.ts:455-470`).
- `convenio_config` (`packages/workforce-es/src/schema/convenio-config.ts`): `id` becomes
  `count("id").primaryKey().default(1)` with `convenio_config_singleton_ck` (`id = 1`), unless slice 5
  already holds it to one row (Task 4).
- If A1002 cut 2 left `staffing_blocks.staff_role_id` (`staffing.ts:127`), it is renamed `role_id`
  with its key name `staffing_blocks_role_fk` kept, by the same rule; if A1002 already renamed it,
  nothing.

## Decision recorded here: restrict, not cascade, on a shift's area

The appendix draws `department_id` and `station_id` on `shifts` as "cascade — from
`shift_assignments`". On `shift_assignments`, cascade deleted the *assignment* when a department or
station row was deleted, leaving the shift. On `shifts` it would delete the *shift*, including
published ones. Nothing in the product deletes a department or station row: both are switched off
(`active = false`: departments in `packages/venue-service/src/service-delete.ts`, stations in
`apps/server/src/station-delete.ts:194`), and at `a086eedfb7`
`git grep -n "delete(departments)\|delete(kitchenStations)"` finds only tests. A published shift is
attendance evidence (the checker reads published weeks' shifts), so a cascade would delete evidence
through a path that marks no attendance day. Restrict keeps every protection and changes no product
behaviour. This is open question 3 in the area's return; if the watcher wants
cascade, only the two key actions and their protection-list lines change.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `roles` and `person_roles`, retiring a role, the rota's role list | A1002 cut 2 (landed) |
| Rota warnings for someone outside a role | unchanged (README §10 "Applied as the design") |
| `convenio_config` replaced by rule sets per person | A586 |
| `shift_templates`, `availability`, `employments` | unchanged (amended R5) |
| Marking attendance days when a shift changes | pp9 |

## Files

- Modify (schema): `packages/workforce/src/schema/shifts.ts`, `schema/staffing/staffing.ts`
  (delete `shiftAssignments`), `schema/index.ts`, `packages/workforce/src/index.ts`,
  `packages/workforce/src/classification.ts`, `packages/staffing/src/index.ts`,
  `packages/staffing/src/classification.ts`, `packages/workforce-es/src/schema/convenio-config.ts`.
- Modify (code): `packages/staffing/src/rota.ts`, `rota-data.ts`, `describe-shifts.ts`,
  `personal-data.ts`, `backup-verification.ts`, `staff-roles.ts` (the role-use query),
  `dashboard/live-queries.ts`; `packages/workforce/src/clocking.ts`;
  `apps/server/src/workforce-api.ts:120-150`; `packages/workforce-es/src/convenio.ts:64`, `:121`
  (look up the one row) and `packages/workforce-es/test/fixtures.ts:26`.
- Tests: `packages/staffing/src/rota.test.ts`, `rota-data` users, `describe-shifts.test.ts`,
  `personal-data.test.ts`, `personal-data.coverage.test.ts`, `backup-verification.test.ts`,
  `schema/constraints.test.ts`, `staff-roles.test.ts`, `month.test.ts`, `routes.test.ts`,
  `dashboard/live-queries.test.ts`, `dashboard/client.test.ts`; `packages/workforce/src/scheduling.test.ts:282-297`,
  `attendance-rota.test.ts:174`, `index.test.ts`, `staffing-migrations.test.ts`, `schema-ownership.test.ts`;
  `apps/server/src/attendance-rota.test.ts:174`, `:269`, `:299`, `personal-data-export-api.workforce.test.ts:327`,
  `boot.shift-descriptions.test.ts`, `workforce-api.test.ts`; `scripts/schema-constraints.test.ts`
  (the `shift_assignments` rows move to `shifts`).
- Shift fixtures with no rota week: every test insert into `shifts` without `rosterVersionId`
  (38 `insert(shifts)` calls in 21 files at `a086eedfb7`) gains a version; a shared helper
  `seedRosterWeek(db, periodStart)` in `packages/workforce/test/fixtures.ts` makes one.
- Generated (uncounted): workforce's and workforce-es's starting migrations, snapshots, epoch.
- Docs: `apps/server/src/guide/{en,es}/` only if a guide says a shift can exist outside a rota week
  (grep "not in a slot", "unattached").

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Schema: three columns, CHECK, two key changes, convenio id | 40 |
| Writers and readers in staffing, the raw-SQL week copy | 120 |
| Workforce publish and server read deletions' replacements (if any remain) | 20 |
| Convenio lookup | 15 |
| Classification, exports, live queries, backup check, personal data | 40 |
| Fixture versions (`seedRosterWeek` and its uses) | 90 |
| New tests: CHECK, keys, cascade, convenio singleton, slot writes | 200 |
| Re-pointed tests (assignment rows read from `shifts`) | 80 |
| **Total** | **≈ 615** |

Uncounted: deleted code (`unattachedWeek`, the attach step, the unattached reads,
`shiftAssignments`) and generated files.

## Finish line

```bash
pnpm --filter @waitron/staffing exec vitest run
pnpm --filter @waitron/workforce exec vitest run src/scheduling.test.ts src/clocking.test.ts \
  src/attendance-rota.test.ts src/index.test.ts src/staffing-migrations.test.ts src/schema-ownership.test.ts \
  src/personal-data.test.ts
pnpm --filter @waitron/workforce-es exec vitest run src/convenio.test.ts src/convenio-roster.test.ts src/schema-ownership.test.ts
pnpm --filter @waitron/server exec vitest run src/workforce-api.test.ts src/attendance-rota.test.ts \
  src/personal-data-export-api.workforce.test.ts src/boot.shift-descriptions.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/live-subscriptions.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts \
  scripts/id-columns-are-references.test.ts
git grep -nE 'shift_assignments|shiftAssignments|unattachedWeek' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

(Staffing's whole suite is small and runs in a few seconds; it covers the rota screen's model.)

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. Measured on the base list:
`shift_assignments`, `shifts` and `convenio_config` each have the three change-feed triggers.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `shift_assignments` | `missing table shift_assignments`; `missing index shift_assignments.primary key(shift_id)`; change-feed only: `missing trigger waitron_change_shift_assignments_insert`, `…_update`, `…_delete` | "CHECK one area → `shifts` CHECK (extended for 'no staffing role'); FKs → on `shifts`" |
| `shifts` | `extra table shifts.columns[role_id]`, `extra table shifts.columns[department_id]`, `extra table shifts.columns[station_id]`; `changed table shifts.columnOrder`; `changed table shifts.columns[roster_version_id].notNull`; `changed table shifts.foreignKeys[roster_version_id->roster_versions(id)].onDelete` (`old: "SET NULL"`, `new: "CASCADE"`, in the list's own spelling); `extra table shifts.foreignKeys[role_id->roles(id)]`; `extra table shifts.foreignKeys[department_id->departments(id)]`; `extra table shifts.foreignKeys[station_id->kitchen_stations(id)]`; `extra table shifts.checks[shifts_one_area_ck]`; change-feed only: `changed trigger waitron_change_shifts_update.when` | "FK roster_version set null → becomes not null + cascade"; the assignment's FKs move here (restrict on area: decision above) |
| `convenio_config` (if Task 4 changes it) | `changed table convenio_config.columns[id].type` (`TEXT` → `INTEGER`), and `.defaultValue`; `extra table convenio_config.checks[convenio_config_singleton_ck]`; `missing index convenio_config.primary key(id)` (an integer primary key has no separate index) | "UNIQUE location → a one-row check" |
| `staffing_blocks` (only if A1002 left `staff_role_id`) | `missing table staffing_blocks.columns[staff_role_id]`; `extra table staffing_blocks.columns[role_id]`; `changed table staffing_blocks.columnOrder` if the position moves; the key prints as `missing …foreignKeys[staff_role_id->roles(id)]` and `extra …foreignKeys[role_id->roles(id)]`; change-feed only: `changed trigger waitron_change_staffing_blocks_update.when` | "`staff_role_id` renamed `role_id`" |

Any other line is a stop. Rows the base list shows for `shifts` that A1002 already changed (for
example a role key on `shift_assignments`) are compared against the base after A1002, not today's.

## Stop points (beyond rules §5)

1. A product path writes a shift with no rota week (the `NOT NULL` refuses it in a suite). At
   `a086eedfb7` both inserts pass a version (appendix §1, `clocking.ts:127-128`, `:326-329`,
   `:413-419`).
2. A test asserts that deleting a published week leaves its shifts (other than the one named in
   Task 3).
3. A1002's role retirement queries `shift_assignments` in a way that does not translate to one
   `shifts.role_id` read (for example it counts assignments per week): stop and ask.
4. A1406-2 (paid breaks and split limits, `docs/superpowers/plans/2026-11-08-a1406-work-time-policies.md`)
   adds `convenio_config` columns. If it is in flight when this plan starts, wait (rules §8); if it
   landed, rebuild workforce-es after it.

## Needs

- A1002 cut 2 (roles and the staffing role code); batch 1 (slice 5, 1a).
- pp6 only for workforce's starting migration order (both rebuild `--set workforce`; either order
  works by rules §2.4).

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- The rota's behaviour is unchanged: same warnings, same slots, same copy-week result.
- Every commit `git commit -s`.

## Review Focus

1. **The CHECK accepts the two legitimate shapes** (no slot at all; a role with exactly one area)
   and refuses the rest.
2. **A shift moved out of its slot** clears all three columns in one update.
3. **Cascade from a draft week** deletes its shifts; nothing deletes a published week in product.

---

### Task 1: Columns and CHECK on `shifts`, assignments read from the shift

**Files:** `shifts.ts`, `staffing.ts`, `rota.ts`, `rota-data.ts`, `describe-shifts.ts`,
`personal-data.ts` (staffing), `staff-roles.ts`, `live-queries.ts`, staffing's backup check and
classification, the tests that read assignment rows.

- [ ] **Step 1: Write the failing tests** (`packages/staffing/src/schema/constraints.test.ts`;
  and in `packages/workforce/src/scheduling.test.ts` `"copying a published week into a draft keeps
  each shift's role and area"`, through the raw-SQL copy at `clocking.ts:326-334`):
  `"accepts a shift in no slot"`, `"accepts a shift with a role in a department"`, `"…in a
  station"`, `"refuses a role with no area"`, `"refuses a role in both a department and a
  station"`, `"refuses an area with no role"`, `"refuses a role that does not exist"`, `"refuses
  deleting a role a shift uses"`, `"refuses deleting a department a shift fills"`, and in
  `rota.test.ts` `"adding a shift to a slot writes its role and area on the shift"`, `"moving a
  shift out of its slot clears role and area"`, `"copying a week copies each shift's slot"`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** the columns and CHECK; move every writer and reader; delete
  `shiftAssignments` and its lists. Re-point the tests that read `shift_assignments` rows to read
  the same three values from `shifts` (assertions unchanged in value).
- [ ] **Step 4: Rebuild** `--set workforce`; run the staffing suite.
- [ ] **Step 5: Commit** `git commit -s -m "Fold a shift's slot into the shift (pp7)"`.

### Task 2: Every shift on a rota week

**Files:** `shifts.ts`, `rota.ts`, `rota-data.ts`, `clocking.ts`, `workforce-api.ts`, fixtures.

- [ ] **Step 1: Write the failing tests:** in `scheduling.test.ts`,
  `"refuses a shift with no rota week"`; `"deleting a draft week deletes its shifts"`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** the not-null and cascade; delete the week-less code paths listed in
  "What it builds"; add `seedRosterWeek` and give every week-less fixture insert a week (the
  fixture's assertions do not change: a draft week is what the old code would have attached the
  shift to on first edit, `rota.ts:286-289`).
- [ ] **Step 4: Rebuild** `--set workforce`; run the finish line's workforce and server runs.
- [ ] **Step 5: Commit** `git commit -s -m "Every shift belongs to a rota week; a draft week takes its shifts with it"`.

### Task 3: The test that asserted the old delete

**Files:** `packages/workforce/src/scheduling.test.ts:282-297`.

`"detaches — never deletes — a shift when its roster version is deleted (ON DELETE set null)"`
asserts the behaviour the design changes ("becomes not null + cascade", appendix §5). It is replaced
by Task 2's `"deleting a draft week deletes its shifts"`; delete it in Task 2's commit and say so in
the commit body. This is the one intended assertion change in this plan.

### Task 4: `convenio_config` is one row

**Files:** `convenio-config.ts`, `convenio.ts`, `test/fixtures.ts`, `convenio.test.ts`.

- [ ] **Step 1: Read the table as slice 5 left it.** If it already has a one-row rule, skip this
  task and drop the convenio rows from the prediction and `workforce-es` from the first line.
- [ ] **Step 2: Write the failing tests:** `"refuses a second convenio row"`, `"reads the venue's
  convenio as the one row"`, `"treats no row as no rules"` (rota warnings,
  `apps/server/src/workforce-api.ts:285-288`, keep their meaning).
- [ ] **Step 3: Implement** the integer id with default 1 and the CHECK; the two reads drop any key
  and read the row.
- [ ] **Step 4: Rebuild** `--set workforce-es`; run the workforce-es finish-line run.
- [ ] **Step 5: Commit** `git commit -s -m "Hold convenio_config to one row"`.

### Task 5: Protection list, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** Run the finish line; `/finish-branch`.
