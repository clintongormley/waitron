# A1308 dv6: a profile's ordering scope lives on the profile — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** `device_profile_service_access` (one row per profile) and `device_profile_zones` (its zone
list) fold into three `device_profiles` columns: the department it orders for, the zone it starts
in, and the zones it may order in (a JSON list, `null` for every zone of the department). The
configuration export prunes switched-off zones from the list (gap 2); gap 3 is not built
([dv0](2026-11-08-a1308-dv0-json-list-references.md) decision 4). Measurement M4 runs here.

**Spec:** [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1 (lists
table, row `order_zone_ids`), §1.2 (the three columns, the two new CHECKs), §4 rows
`device_profile_service_access`, `device_profile_zones`, §5 the same rows and the `device_profiles`
row, §7 gaps 2–3 and M4. Rules: [slice rules](2026-11-08-a1308-slice-rules.md). Area order:
[dv1](2026-11-08-a1308-dv1-devices-row.md). Uses [dv0](2026-11-08-a1308-dv0-json-list-references.md).

**Base:** `main` after dv5, and after A1002's second cut **if lane K is building it** (decision 1).
Lines read at `a086eedfb7`; a cite whose code no longer says what this plan says is a stop (rules
§5.1), one that only moved is not.

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

`device_profiles` gains:

| Column (drizzle) | Type | Was |
| --- | --- | --- |
| `order_department_id` (`orderDepartmentId`) | `id`, null, key to `departments` | `device_profile_service_access.department_id` |
| `order_starting_zone_id` (`orderStartingZoneId`) | `id`, null, key to `floor_zones` | `.starting_zone_id` |
| `order_zone_ids` (`orderZoneIds`) | `json<string[] \| null>`, null | `device_profile_zones` rows, and `.every_zone` (null = every zone) |

CHECKs:
- `device_profiles_order_scope_ck` — `(order_department_id is null) = (order_starting_zone_id is
  null) and (order_department_id is not null or order_zone_ids is null)` (the side table's NOT
  NULLs restated, §1.2).
- `device_profiles_order_zone_ids_ck` — `jsonShapeCheck(t.orderZoneIds, "array")` (a null passes it,
  dv0).
- `device_profiles_kds_timeout_ck` — `form_factor <> 'kds' or inactivity_timeout_seconds is null`
  (§1.2; today only `validateInactivityTimeout` forces it, `packages/db/src/schema/device-profiles.ts:40-41`).

`device_profile_service_access` and `device_profile_zones` are deleted.

The meaning is today's, written as columns: no department = no restriction (today: no access row,
`packages/db/src/schema/venue-service/service.ts:160-161`); a department with `order_zone_ids`
null = every zone of it (today `every_zone` true); a department with `[]` = no zone (today
`every_zone` false and no zone rows).

**Configuration transfer** (`CORE_CONFIGURATION_TRANSFER`, `packages/db/src/configuration-transfer.ts:76`):

```ts
{
  name: "device_profiles",
  leaveBehindWhenSet: "retired_at",
  jsonReferences: [{ column: "order_zone_ids", paths: [["*"]] }],
}
```

and the two venue-service declarations go (`packages/venue-service/src/configuration-transfer.ts:705-706`).
No "clear these columns instead" declaration is added: a live profile cannot point at a switched-off
department or zone, because switching one off refuses while a live profile uses it
(`packages/venue-service/src/service-delete.ts:217-226`) and scoping a profile to one is refused
(`packages/venue-service/src/profile-access.ts:358-361`); dv0 decision 4.

## M4: the measurement, written before the code

**What runs** (Task 1, before any schema change, against today's tables so the result is a
baseline): a venue with a department D1 and zones Z1 and Z2 in it; profile P1 scoped to D1 starting
at Z1 with zones `[Z1, Z2]`; then Z2 is switched off **by a raw write** (`update floor_zones set
active = 0`). The product never reaches this state: switching a zone off while a live profile uses it
is refused (`packages/venue-service/src/service-delete.ts:217-226`), and deleting a zone already
clears it from every profile (`service-delete-settings.ts:383-386`). So this case tests the export's
defence against a state the product prevents, and it passes the same before and after the change.
Export, import into a fresh venue, read P1. **Expected, before and after:** P1 arrives and keeps D1,
Z1 and the zone list `[Z1]`. **The failing
result** (design §8 M4): a profile missing, an id from the old venue in a list, or a dead id
carried across. The design's fallback is the export code itself ("Export has to clear those
columns instead"); if the `jsonReferences` declaration cannot give today's result, stop (rules §5.4).

The case lives in `apps/server/src/configuration-transfer.test.ts` (the suite that already
round-trips real venues) as `describe("device profile scope round trip (M4)")`; dv7 and dv8 add the
printer and kitchen-view parts to it.

## Decisions this plan makes

1. **A1002's second cut lands first and owns admission.** It already removes both admission tables
   and places role ids as JSON on the profile (its plan, Task 1: "Remove both admission link
   tables/person exceptions; place explicit role-ID JSON on device/reason/bill-limit owners"), and
   it needs only slices 2 and 3a (build order). This slice does not touch admission. If A1002's cut
   has **not** landed when this starts, this slice still does not touch admission (rules §8: it is
   built on the new shape afterwards); `device_profile_admission_persons` then goes with A1002, as
   the owner decided (README U6). A1002's plan names no column; use the design's
   `device_profiles.admitted_roles` (`tables-devices.md` §1.2), with a `jsonShapeCheck` and a dv0
   `jsonReferences` entry. For A1002: dv0's import refuses an id not in the bundle, so built-in roles
   that import keeps under fixed ids must be in its id map (dv0 decision 3, "a row an import keeps
   by a fixed key"). **If this slice goes first** (A1002's cut not started), rules §8 then holds
   A1002's cut 2 until the devices area has finished with `device_profiles` (after dv8), because its
   admission column is a schema change in an area A1308 is changing. The backlog
   entry "Task 2's review found no test that fails when `device_profile_admission_roles` or
   `device_profile_admission_persons` is left out of `apps/server/src/testing/clear-provision-fixture.ts`"
   (`docs/backlog/architecture.md:1315-1316`) is finished by whichever change deletes those tables
   (A1002's cut), which deletes the entry.
2. **The readers keep their signatures and results.** `readProfileServiceAccess`,
   `assertProfileZone`, `readProfileZones`, `readProfilesZones`, `setProfileServiceAccess`,
   `setProfileServiceScope`, `readProfileServiceScopes`, `readProfileDepartments`
   (`packages/venue-service/src/profile-access.ts:45-308`) read and write the columns.
   `checkedScope` (`:342`) still refuses an unknown or switched-off department or zone, so no dead
   id is written.
3. **A zone's delete removes it from every list with dv0's `removeIdFromJson`**
   (`packages/venue-service/src/service-delete-settings.ts:383` today deletes the link rows), keeping
   "zero zones still means no zones" (`:394`). An obsolete profile's scope is cleared by setting the
   three columns to null (`:384-386` today deletes its access row). Starting-zone moves (`:378-382`)
   update `order_starting_zone_id`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Admitted roles | A1002's second cut (decision 1) |
| `printer_lists`, `kitchen_views`, `card_readers` | dv7, dv8, the payments slice |
| The zones a device remembers per profile | dv10 |

## Files

**Modify**
- `packages/db/src/schema/device-profiles.ts`; `packages/db/src/schema/venue-service/service.ts:159-214`
  (delete both tables); `packages/db/src/index.ts:456-457`; `packages/venue-service/src/index.ts:23-24`;
  `packages/db/src/classification.ts:338-339`; `packages/venue-service/src/classification.ts:20-21`;
  `packages/db/src/configuration-transfer.ts:76`; `packages/venue-service/src/configuration-transfer.ts:705-706`.
- `packages/venue-service/src/profile-access.ts:45-394`, `provisioning.ts:153-176`,
  `service-delete.ts:200-210`, `service-delete-settings.ts:74-100`, `:378-386`.
- `apps/dashboard/src/api/live-queries.ts:50-51`, `:108`, `:401-402`;
  `packages/venue-service/src/dashboard/live-queries.ts` (if it names either table).
- `apps/server/src/testing/clear-provision-fixture.ts:23-24`.
- `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473`, `:476`: the bundle's
  `device_profiles` rows change shape and two tables leave it, so its format version goes up by one
  (rules §9; as dv2 did).
- `scripts/schema-constraints.test.ts:103-107`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (two tables to `REMOVED_TABLES`;
  `device_profiles` column edits).
- Tests that write either table directly (20 files; `git grep -l "deviceProfileServiceAccess\|deviceProfileZones\|device_profile_service_access\|device_profile_zones" -- '*.test.ts'`):
  set-up only, through `setProfileServiceScope` where they can, raw column writes where a case
  needs a shape the writer refuses.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/device-profiles.scope.test.ts`.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 35, profile-access 110, provisioning and the two delete flows 45, transfer declarations and version 15, lists 10 | ~215 |
| Tests: scope CHECK test 110, M4 case 100, set-up re-pointed in 20 files 280, guard lists 10 | ~500 |
| **Total** | **~715** |

Not counted: generated files; deleted schema text. About 2½ hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/device-profiles.scope.test.ts src/schema/device-profiles.inactivity.test.ts src/classification.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/profile-access.test.ts src/provisioning.test.ts src/service-delete-settings.test.ts src/service.test.ts src/configuration-transfer.test.ts src/classification.test.ts
pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts src/management-api.device-profiles.test.ts src/till-api.profile-zones.test.ts src/till-api.profile-actions.test.ts src/device-zones-api.test.ts src/service-delete.integration.test.ts src/management-api.service-delete.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts
pnpm --filter @waitron/db --filter @waitron/venue-service --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/module-seams.test.ts
git grep -n "deviceProfileServiceAccess\|deviceProfileZones\|device_profile_service_access\|device_profile_zones" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing. (A suite name above that does not exist at the base is replaced by the
suite covering the same function; list it in the pull request.)

## Expected protection-list difference

Under all six headers:

```text
missing index device_profile_service_access.primary key(device_profile_id)
missing index device_profile_zones.primary key(device_profile_id,zone_id)
missing table device_profile_service_access
missing table device_profile_zones
changed table device_profiles.columnOrder
extra table device_profiles.checks[device_profiles_kds_timeout_ck]
extra table device_profiles.checks[device_profiles_order_scope_ck]
extra table device_profiles.checks[device_profiles_order_zone_ids_ck]
extra table device_profiles.columns[order_department_id]
extra table device_profiles.columns[order_starting_zone_id]
extra table device_profiles.columns[order_zone_ids]
extra table device_profiles.foreignKeys[order_department_id->departments(id)]
extra table device_profiles.foreignKeys[order_starting_zone_id->floor_zones(id)]
```

Under the two `change-feed` headers, also the three `waitron_change_device_profile_service_access_*`
and three `waitron_change_device_profile_zones_*` triggers `missing`, and
`changed trigger waitron_change_device_profiles_update.when`.

Reasons (`tables-devices.md` §5): "device_profile_service_access: PK (one row per profile), NOT NULL
department/start zone, FKs to department, zone, profile — one row per profile holds by
construction; the NOT NULLs become the all-or-nothing CHECK; the FKs move onto the columns";
"device_profile_zones: PK, FK to the access row cascade, zone FK — **given up**: `checkedScope`
validates the zones; the department scope is the CHECK on `device_profiles`". The kds timeout CHECK
is new (§1.2).

## Stop points (beyond rules §5)

1. M4's failing result.
2. A fixture saves a kds profile with an inactivity timeout and a case asserts behaviour that needs
   it (the new CHECK refuses the row).
3. A1002's second cut has changed `profile-access.ts` or the transfer lists in a way this plan's
   cites no longer match (rebase, then re-read; if a decision here conflicts with its, stop).

## Needs

dv0 (declarations, `jsonShapeCheck`, `removeIdFromJson`); dv5 (last change to core before this).
A1002's second cut: landed, or not started (then it waits for the devices area, decision 1).

## In-flight work folded in (rules §8)

- **A1002's second cut (lane K):** decision 1. Order: A1002 cut 2 → dv6. dv0 lands before A1002
  cut 2 so its role-id list uses `jsonReferences`.
- **A790 Cut A:** no profile columns.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: M4 against today's tables

- [ ] **Step 1:** write the M4 case as described: P1 scoped with `setProfileServiceScope`, Z2
  switched off by the raw write. Run it on the base tables: it must PASS (today's behaviour is the
  baseline). If it fails on the base, stop: today's export does not do what this plan reads.
- [ ] **Step 2:** commit the case.

### Task 2: the columns, the CHECKs, the readers

- [ ] **Step 1: failing test** `device-profiles.scope.test.ts`: "a profile is unrestricted,
  scoped to every zone of a department, or scoped to a list" (three rows stored: all null; D +
  start + null; D + start + `["z"]`); "refuses a department without a starting zone and the
  reverse" (`device_profiles_order_scope_ck`); "refuses a zone list without a department"; "refuses
  a zone list that is not an array" (`{}` raises `device_profiles_order_zone_ids_ck`); "refuses a
  timeout on a kds profile, keeps one on a till" (`device_profiles_kds_timeout_ck`). Run: FAIL.
- [ ] **Step 2:** schema; delete the two tables; rebuild core. Run: PASS.
- [ ] **Step 3:** re-point the 20 test files' set-up (assertions unchanged). Rewrite
  `profile-access.ts` over the columns (decision 2), `provisioning.ts`'s "unscoped" read
  (`isNull(deviceProfiles.orderDepartmentId)`), `service-delete.ts`'s scope read, and decision 3 in
  `service-delete-settings.ts`. Run the venue-service and server suites in the finish line: PASS.
  Commit (cite README §5 U1 for nothing: no table changes set).

### Task 3: the transfer declarations and M4 again

- [ ] **Step 1:** the declaration above; delete the venue-service entries. Run the M4 case: PASS
  with its assertions unchanged (stop 1 otherwise). Add one case: "a zone list naming a deleted
  zone exports without it" (a raw column write of a zone id that names no `floor_zones` row; the
  exported list lacks it).
- [ ] **Step 2:** run `scripts/id-columns-are-references.test.ts`: it sees `order_zone_ids` by its
  `json_valid` CHECK and passes because it is declared. Prove by deletion: remove the
  `jsonReferences` entry, see the guard report `device_profiles.order_zone_ids`; restore. Commit.

### Task 4: lists, protection list, finish

- [ ] **Step 1:** live queries, classification, schema-constraints, the clear fixture, the demo-seed
  test. Run the full finish line.
- [ ] **Step 2:** protection list after; `compare`; mark each line in the pull request.
- [ ] **Step 3:** `docs/developers/conventions-data.md`, dv0's section: add `order_zone_ids` as
  its first real user. Guides: none (nothing a person sees changes).
- [ ] **Step 4:** commit; `/finish-branch`; reset dev slots and Santet after landing.
