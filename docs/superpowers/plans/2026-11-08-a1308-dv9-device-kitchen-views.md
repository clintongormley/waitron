# A1308 dv9: a device's kitchen views live on the device, and "taken away" is worked out — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** What a device chose to show on its kitchen screens (`device_kitchen_screens`, `…_stations`,
`…_zones`) folds into `devices.kitchen_views`, the same shape dv8 gave profiles. The stored
"taken away" notes (`device_kitchen_screen_removals`) are deleted: what a narrowing took is worked
out as the device's choice minus what its profile now allows. Measurement M2 decides that this is
safe, first.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U6 (`device_kitchen_screen_removals`:
"derivable when a profile is saved"), §10 ("Removed kitchen stations — A display no longer lists
them as 'no longer available'"); [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md)
§1 (lists table row `devices.kitchen_views`), §1.1, §4 rows `device_kitchen_screen*`, §5 the same
rows and `device_kitchen_screen_removals`, §6 items 1–2, §8 M2. Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv8. Lines read at `a086eedfb7`; dv8 rewrote the profile half of
`packages/venue-service/src/kitchen-screens.ts`, so the device-half lines cited here have moved
within the file; a cited function that no longer does what this plan says is a stop (rules §5.1).

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## M2: the measurement, written before the code

**What runs** (Task 1, on today's tables, before any schema change): `readEffectiveChoices` and
`resolveDevices` (`packages/venue-service/src/kitchen-screens.ts:429-438`, `:693-780`) are changed
to ignore `device_kitchen_screen_removals` and work out "taken away" from the device's stored choice
and its profile's current views, by this rule:

- a kind the device chose that its profile no longer offers (`boundOf` returns `undefined`,
  `:782-787`) is taken away whole;
- in an explicit station or zone list the device chose, an id the profile's view no longer allows
  (the profile's list is explicit and lacks it) is taken away;
- a list the device left as "every" loses nothing: it shows what the profile allows, and nothing is
  listed as no longer available.

Then: `pnpm --filter @waitron/venue-service exec vitest run src/kitchen-screens.test.ts` and
`pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device-api.pass.test.ts src/device-api.station-move.test.ts src/management-api.device-profiles.test.ts`.

**Predicted result** (`tables-devices.md` §8 M2, from a reading of `kitchen-screens.ts:788-890`):
the only failing cases are devices whose choice is "every station" or "every zone" and which used
to list the narrowed items as "no longer available". Those are the behaviour the owner changed
(README §10), and their assertions change in this slice, each listed by name in the pull request
with the reason "owner, 2026-11-04: a display no longer lists removed stations as no longer
available".

**The failing result** (rules §5.4): any other failure, which "would mean a removal row carries a
fact that cannot be derived". **The design's fallback:** keep `device_kitchen_screen_removals` and
fold only the three choice tables. The watcher confirms before the builder takes it; the builder
then drops Task 3's removal parts and the removal lines of the protection-list prediction.

## What it builds (if M2 passes)

- `devices.kitchen_views` (`json<StoredKitchenViews>("kitchen_views").notNull().default({})`, dv8's
  type; `devices_kitchen_views_ck` with `jsonShapeCheck(…, "object")`). On a device,
  `showNonPassStations: null` means the profile's value applies (`tables-devices.md` §1, after the
  lists table).
- `device_kitchen_screens`, `device_kitchen_screen_stations`, `device_kitchen_screen_zones`,
  `device_kitchen_screen_removals` deleted (`packages/db/src/schema/venue-service/kitchen-screens.ts:105-225`).
- In `packages/venue-service/src/kitchen-screens.ts`, with every exported signature kept:
  - `readChoices` (`:379-415`) reads the column; `readRemovals` and `lessRemovals` (`:417-466`) give
    way to the M2 rule as one function, `takenAway(choice, offer): { kinds, stations, zones }`;
  - `setDeviceKitchenScreens` (`:551-588`) writes the column after its existing checks
    (`checkChoice`, `checkedChoice`, `:468-536`); `setDeviceKitchenScreenDisplay` (`:590-603`)
    rewrites one view's `showNonPassStations`; `countDeviceKitchenScreens` (`:606-617`) counts the
    object's keys; `removeDeviceKitchenScreens` (`:619-630`) sets `{}`;
  - `narrowDevices` (`:799-896`) writes nothing; it still returns the `NarrowedDevice[]` notice
    worked out from `before` and `after`, where "already taken" means taken under `before` by the
    M2 rule (replacing `recordedKeys`, `:824-827`);
  - `assertKitchenDisplayHasScreen`, `assertPassScreenZone`, `readStationScreens` (`:928-1004`)
    read effective choices the same way; `readStationScreens` finds station displays with
    `json_type(devices.kitchen_views, '$.station') is not null` in place of its join at `:977-983`.
- A station's or zone's delete removes the id from every device's views with dv0's
  `removeIdFromJson(tx, devices.kitchenViews, id)` (`packages/venue-service/src/station-delete-settings.ts:145`,
  `service-delete-settings.ts:395-397`); the removal deletes (`station-delete-settings.ts:149`,
  `service-delete-settings.ts:401-403`) go.
- `deleteDevice` sets `kitchenViews: {}` in its existing update (`apps/server/src/device-delete.ts:208-217`)
  instead of calling `removeDeviceKitchenScreens` at `:206` (the contribution method stays for its
  other callers, if any; delete it if none).

Devices are not in the configuration export, so `kitchen_views` on `devices` needs no transfer
declaration (`tables-devices.md` §7 lists only the profile's).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The zones a device remembers per profile | dv10 |
| Dashboard wording | Nothing changes: "No longer available" still shows for an explicit list (`slots`, `:635-655`) |

## Files

**Modify**
- `packages/db/src/schema/devices.ts`; `packages/db/src/schema/venue-service/kitchen-screens.ts:105-225`;
  `packages/db/src/index.ts`, `packages/venue-service/src/index.ts` (exports);
  `packages/db/src/classification.ts:345-348`; `packages/venue-service/src/classification.ts:27-30`.
- `packages/venue-service/src/kitchen-screens.ts` (device half), `station-delete-settings.ts:25-121`,
  `:145`, `:149`, `service-delete-settings.ts:395-403`.
- `apps/server/src/device-delete.ts:134`, `:206`, `:208-217`.
- `apps/dashboard/src/api/live-queries.ts:52-55`, `:142`; `packages/venue-service/src/dashboard/live-queries.ts`.
- `apps/server/src/testing/clear-provision-fixture.ts:25-28`.
- `scripts/schema-constraints.test.ts:121-128`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (four tables to `REMOVED_TABLES`;
  the `devices` column edit).
- Tests writing the four tables directly: set-up through `setDeviceKitchenScreens` or a raw column
  write; tests that wrote removal rows to stage a narrowing stage it by narrowing the profile
  through `setProfileKitchenScreens` instead.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/devices.kitchen-views.test.ts`.

**Delete** (pure deletion): the cases in `packages/db/src/schema/venue-service/migrations.test.ts`
for the four tables.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 20, `kitchen-screens.ts` device half 160, delete flows 20, device delete 10, lists 10 | ~220 |
| Tests: shape test 40, M2 assertion changes 40, set-up re-pointed (`kitchen-screens.test.ts`, server device suites, delete suites) 260, guard lists 10 | ~350 |
| **Total** | **~570** |

About 3 hours, M2 included.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/devices.kitchen-views.test.ts src/schema/venue-service/migrations.test.ts src/classification.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/kitchen-screens.test.ts src/station-delete-settings.test.ts src/service-delete-settings.test.ts src/classification.test.ts src/dashboard/live-queries.test.ts src/dashboard/prep-stations-screen.test.ts src/service.test.ts
pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device-api.pass.test.ts src/device-api.station-move.test.ts src/device-api.delete.test.ts src/device-delete.db.test.ts src/management-api.device-profiles.test.ts src/station-delete.test.ts src/management-api.station-disable.test.ts src/floor-delete.bookings.test.ts src/order-groups.test.ts src/served.test.ts src/till-api.test.ts src/join-api.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/devices-screen.test.ts
pnpm --filter @waitron/db --filter @waitron/venue-service --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/migration-upgrade.test.ts
git grep -n "deviceKitchenScreen\|device_kitchen_screen" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Under all six headers:

```text
missing index device_kitchen_screen_removals.primary key(id)
missing index device_kitchen_screen_removals_device_idx
missing index device_kitchen_screen_stations.primary key(device_id,screen,station_id)
missing index device_kitchen_screen_zones.primary key(device_id,screen,zone_id)
missing index device_kitchen_screens.primary key(device_id,screen)
missing table device_kitchen_screen_removals
missing table device_kitchen_screen_stations
missing table device_kitchen_screen_zones
missing table device_kitchen_screens
changed table devices.columnOrder
extra table devices.checks[devices_kitchen_views_ck]
extra table devices.columns[kitchen_views]
```

(Primary-key names copied from the base list in Task 0.) Under the two `change-feed` headers, also
the twelve `waitron_change_device_kitchen_screen*` triggers `missing` (three per table) and
`changed trigger waitron_change_devices_update.when`.

Reasons (`tables-devices.md` §5): "device_kitchen_screens: device FK deliberately `no action` —
moot: the list is on the device's own row"; the screen and station/zone tables as in dv8;
"device_kitchen_screen_removals: device/station/zone FKs, screen CHECK, one-target CHECK, index —
dropped with the table" (§6 item 2; README U6).

## Stop points (beyond rules §5)

1. M2's failing result (above).
2. A case's assertion must change and it is not in M2's predicted class.
3. The `NarrowedDevice[]` notice from a profile save differs from today's for a set-up the M2 rule
   should cover identically (the notice is worked out at save time "from the before and after
   settings, so it is unchanged", §6 item 2).

## Needs

dv8 (the shared type; the profile half already on JSON), dv0 (`removeIdFromJson`).

## In-flight work folded in (rules §8)

- **A773-2** (#2440 added `show_non_pass_stations` to device screens): carried in the view object.
- Nothing open touches these tables (`git grep -l device_kitchen_screen docs/superpowers/plans/`
  finds only landed A773-2 plans).

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base;
  copy the primary keys' names into the prediction.

### Task 1: M2

- [ ] **Step 1:** on today's tables, make the read change described under M2 (only the reads; the
  removal rows are still written). Run the five suites. Write every failing case's name and why it
  failed into the pull request description draft.
- [ ] **Step 2:** if every failure is in the predicted class, change those assertions to the new
  behaviour (each with a one-line comment naming README §10's decision) and commit "M2: taken away
  is worked out from the profile". Otherwise stop (fallback above).

### Task 2: the column

- [ ] **Step 1: failing test** `devices.kitchen-views.test.ts`: "a device's views are an object,
  `{}` by default" and "refuses an array" (`devices_kitchen_views_ck`). Run: FAIL.
- [ ] **Step 2:** schema; rebuild core; run: PASS. Commit.

### Task 3: the device half on the column; the removals go

- [ ] **Step 1:** re-point test set-up (as in Files). Run the venue-service and server suites:
  FAIL.
- [ ] **Step 2:** rewrite the device half as in "What it builds"; the delete flows; device delete.
  Delete the four tables and every list entry. Rebuild core. Run the full finish line: PASS (stops
  2–3). Commit.

### Task 4: protection list, finish

- [ ] Protection list after; `compare`; mark each line. Delete nothing from the backlog (no entry
  names these tables; checked with `grep -rn "kitchen_screen_removals" docs/backlog*`). Commit;
  `/finish-branch`; reset dev slots and Santet after landing.
