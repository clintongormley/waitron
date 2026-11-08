# A1308 dv8: a profile's kitchen views live on the profile — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** The three tables that hold what a profile allows its kitchen screens to show
(`device_profile_kitchen_screens`, `…_stations`, `…_zones`) fold into one JSON column,
`device_profiles.kitchen_views`. Up to three views (station, pass, pass monitor), each with its
stations and zones (`null` for every one) and, for the two pass views, whether to show other
stations' dishes. The device side is dv9.

**Spec:** [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1 (lists
table rows `kitchen_views`; the value shape; "Separate columns rather than one document"), §1.2,
§4 rows `device_profile_kitchen_screen*`, §5 rows `device_profile_kitchen_screens` and
`*_kitchen_screen_stations`/`_zones`, §6 item 1, §7 gap 1 and M4. Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv7. Lines read at `a086eedfb7`; a cite whose function no longer does what
this plan says is a stop (rules §5.1).

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

```ts
// packages/db/src/schema/venue-service/kitchen-screens.ts keeps KITCHEN_SCREEN_KINDS and gains:
export type StoredKitchenView = {
  readonly stationIds: readonly string[] | null; // null = every station
  readonly zoneIds: readonly string[] | null;    // null = every zone; always null on "station"
  readonly showNonPassStations?: boolean | null; // pass views only; null on a device = the profile's
};
export type StoredKitchenViews = Partial<Record<KitchenScreenKind, StoredKitchenView>>;

// packages/db/src/schema/device-profiles.ts
kitchenViews: json<StoredKitchenViews>("kitchen_views").notNull().default({}),
// check("device_profiles_kitchen_views_ck", jsonShapeCheck(t.kitchenViews, "object"))
```

(`StoredKitchenViews` is declared once and dv9's `devices.kitchen_views` uses it too.)

- The three `device_profile_kitchen_screen*` tables are deleted, with their schema text in
  `packages/db/src/schema/venue-service/kitchen-screens.ts:17-104`.
- In `packages/venue-service/src/kitchen-screens.ts`: `readStored` (`:63-131`) reads the column and
  keeps its result exactly: ids filtered to switched-on stations and zones (a dead or switched-off
  id drops at read, as the inner joins do today), stations sorted with `compareStationNames` then
  id, zones by display order, name, id (`:96-110`). `replaceProfileKitchenScreens` (`:160-208`)
  validates as today (`checkedStations`, `checkedZones`, "a station view has no zone list" at
  `:179`) and writes the column in one update; `insertScreen` and `insertLists` (`:252-295`) go.
  `addProfileKitchenScreen` (`:297-343`, test set-up only) merges into the column.
  `readProfileKitchenScreens`, `setProfileKitchenScreens`, `copyProfileKitchenScreens` keep their
  signatures and results. `narrowDevices` keeps reading the profile through `profileScreens` (the
  device side is unchanged until dv9).
- A station's or zone's delete removes its id from every profile's views with dv0's
  `removeIdFromJson(tx, deviceProfiles.kitchenViews, id)`
  (`packages/venue-service/src/station-delete-settings.ts:146-148`;
  `service-delete-settings.ts:398-400`), keeping "an explicit list emptied by a delete stays
  explicit" (`service-delete-settings.ts:394`). The "bound screens" impact read in
  `station-delete-settings.ts`' `settings` (`:25-121`) finds profiles with `json_tree`.
- Configuration transfer: `device_profiles`' declaration gains
  `{ column: "kitchen_views", paths: [["*", "stationIds", "*"], ["*", "zoneIds", "*"]] }`; the three
  venue-service entries go (`packages/venue-service/src/configuration-transfer.ts:707-709`).

## Decisions this plan makes

1. **A view's keys are only the three kinds**, enforced by the writer's types and by
   `replaceProfileKitchenScreens`' loop over `KITCHEN_SCREEN_KINDS`. No database CHECK on keys
   (§1: a CHECK cannot look inside JSON). The old `*_screen_ck` CHECKs are given up (§5).
2. **`showNonPassStations` is stored only on the two pass views**, as `hasDisplay` decides today
   (`kitchen-screens.ts:48-49`); a station view's object has no such key.
3. **The stored object keeps the writer's id order;** readers sort for display as today.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `devices.kitchen_views`, the device tables, `device_kitchen_screen_removals`, M2 | dv9 |

## Files

**Modify**
- `packages/db/src/schema/device-profiles.ts`; `packages/db/src/schema/venue-service/kitchen-screens.ts:17-104`
  (delete the three tables, add the types); `packages/db/src/index.ts` and
  `packages/venue-service/src/index.ts` (their exports); `packages/db/src/classification.ts:342-344`;
  `packages/venue-service/src/classification.ts:24-26`; `packages/db/src/configuration-transfer.ts:76`;
  `packages/venue-service/src/configuration-transfer.ts:707-709`.
- `packages/venue-service/src/kitchen-screens.ts:1-343`; `station-delete-settings.ts:25-121`,
  `:146-148`; `service-delete-settings.ts:398-400` (and its impact read of profile zone rows, if any).
- `apps/dashboard/src/api/live-queries.ts:56-58`; `packages/venue-service/src/dashboard/live-queries.ts`.
- `apps/server/src/testing/clear-provision-fixture.ts:29-31`.
- `scripts/schema-constraints.test.ts:108-120`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (three tables to `REMOVED_TABLES`;
  the `device_profiles` column edit).
- Tests writing the three tables directly (`git grep -l "deviceProfileKitchenScreen\|device_profile_kitchen_screen" -- '*.test.ts'`):
  set-up through `setProfileKitchenScreens` or `addProfileKitchenScreen`.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/device-profiles.kitchen-views.test.ts`.

**Delete** (pure deletion, uncounted): the cases in `packages/db/src/schema/venue-service/migrations.test.ts`
that test the three deleted tables' keys and CHECKs (their replacements are the writer's refusals,
already covered in `packages/venue-service/src/kitchen-screens.test.ts`).

## Size

| Counted | Lines |
| --- | --- |
| Code: schema and types 30, `kitchen-screens.ts` profile half 120, delete flows 30, transfer 5, lists 10 | ~195 |
| Tests: shape test 50, set-up re-pointed (`kitchen-screens.test.ts`, the server and venue-service suites) 230, M4 extension 50, guard lists 10 | ~340 |
| **Total** | **~535** |

About 2½ hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/device-profiles.kitchen-views.test.ts src/schema/venue-service/migrations.test.ts src/classification.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/kitchen-screens.test.ts src/station-delete-settings.test.ts src/service-delete-settings.test.ts src/provisioning.test.ts src/configuration-transfer.test.ts src/classification.test.ts src/dashboard/live-queries.test.ts src/dashboard/prep-stations-screen.test.ts
pnpm --filter @waitron/server exec vitest run src/management-api.device-profiles.test.ts src/device-api.pass.test.ts src/device-api.test.ts src/station-delete.test.ts src/management-api.station-disable.test.ts src/floor-delete.bookings.test.ts src/configuration-transfer.test.ts src/served.test.ts src/order-groups.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts
pnpm --filter @waitron/db --filter @waitron/venue-service --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts
git grep -n "deviceProfileKitchenScreen\|device_profile_kitchen_screen" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Under all six headers:

```text
missing index device_profile_kitchen_screen_stations.primary key(device_profile_id,screen,station_id)
missing index device_profile_kitchen_screen_zones.primary key(device_profile_id,screen,zone_id)
missing index device_profile_kitchen_screens.primary key(device_profile_id,screen)
missing table device_profile_kitchen_screen_stations
missing table device_profile_kitchen_screen_zones
missing table device_profile_kitchen_screens
changed table device_profiles.columnOrder
extra table device_profiles.checks[device_profiles_kitchen_views_ck]
extra table device_profiles.columns[kitchen_views]
```

(The primary keys' column lists are as the base list prints them; Task 0 copies them from it.)
Under the two `change-feed` headers, also the nine `waitron_change_device_profile_kitchen_screen*`
triggers `missing` (three per table) and `changed trigger waitron_change_device_profiles_update.when`.

Reasons (`tables-devices.md` §5): "`device_profile_kitchen_screens`: composite PKs, screen CHECKs,
`*_station_zones_ck` — one view per kind is the object's keys; the kinds and 'a station view has no
zone list' move to the writers"; "`*_kitchen_screen_stations`, `*_kitchen_screen_zones`: PKs,
cascades, station and zone FKs, screen CHECKs, not-station CHECK — **given up**: `checkedStations`
and `checkedZones` validate ids; a dead id drops at read".

## Stop points (beyond rules §5)

1. A case's resolved screens (stations, zones, their order, `showNonPassStations`) differ from
   today's for the same set-up.
2. The dashboard's narrowing notice on a profile save (`NarrowedDevice[]` from
   `setProfileKitchenScreens`) changes for the same set-up.
3. M4's kitchen part fails.

## Needs

dv7 (last change to `device_profiles`' transfer declaration), dv0.

## In-flight work folded in (rules §8)

- **A773-2** (kitchen board, landed through #2446) is the code's current shape; nothing open.
- **The floor and kitchen slice** may have renamed `kitchen_stations` columns used by `readStored`
  (`active`, `name`); use its names.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base;
  copy the three primary keys' exact names from it into the prediction.

### Task 1: M4's kitchen part, against today's tables

- [ ] Extend dv6's M4 `describe`: profile P1's pass view lists stations `[S1, S2]` (S2 switched
  off) and zones `[Z1]`; its station view lists every station (`null`). Export, import, read with
  `readProfileKitchenScreens`: the pass view lists S1's new id only, zones Z1's new id, the station
  view still `null`. Run on the base: PASS (baseline). **Failing result after Task 2:** an old id,
  S2 carried across, or a view missing. Commit.

### Task 2: the column, the writer, the readers

- [ ] **Step 1: failing test** `device-profiles.kitchen-views.test.ts`: "stores views as an object"
  and "refuses an array or text" (`device_profiles_kitchen_views_ck`). Run: FAIL.
- [ ] **Step 2:** schema; delete the three tables; rebuild core. Rewrite the profile half of
  `kitchen-screens.ts` as above; the two delete flows. Re-point test set-up. Run every suite in
  the finish line: PASS with assertions unchanged (stops 1–2). Commit.

### Task 3: transfer, M4, lists

- [ ] The declaration; run M4: PASS (stop 3). Guard proof by deletion as dv6. Live queries,
  classification, schema-constraints, clear fixture, demo-seed. Run the full finish line. Commit.

### Task 4: protection list, finish

- [ ] Protection list after; `compare`; mark each line. `docs/developers/conventions-data.md`,
  dv0's section: add `kitchen_views`. Commit; `/finish-branch`; reset dev slots and Santet after
  landing.
