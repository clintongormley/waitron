# A1308 dv10: an approved profile's row remembers the device's zones — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** `device_zone_selections` (one row per device and profile: the starting zone the device
chose) and `device_zone_selection_zones` (the zones it chose) merge into `device_approved_profiles`,
which has the same key. Two writers change so approving profiles no longer wipes the device's zone
memory, and withdrawing a profile's approval forgets its zones (owner, 2026-11-04).

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §10 ("Withdrawing a device's
approval — Also forgets the floor zones it chose under that profile");
[tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1 (lists table row
`device_approved_profiles.zone_ids`), §1.3 (all of it), §4 rows `device_approved_profiles`,
`device_zone_selection_zones`, `device_zone_selections`, §5 the same rows. Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv9. Lines read at `a086eedfb7`; a cite that no longer says what this plan
says is a stop (rules §5.1).

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

`device_approved_profiles` (`packages/db/src/schema/device-approved-profiles.ts`):

| Column | Type | Rule |
| --- | --- | --- |
| `device_id` | pk part, key to `devices` | **no action** (was cascade): `deleteDevice` deletes the rows explicitly (`apps/server/src/device-delete.ts:204`) |
| `device_profile_id` | pk part, key to `device_profiles` | cascade (kept) |
| `starting_zone_id` (`startingZoneId`) | `id`, null, key to `floor_zones` | was `device_zone_selections.starting_zone_id` |
| `zone_ids` (`zoneIds`) | `json<string[] \| null>`, null | `null` = the device never saved a zone choice under this profile; `[]` = saved, then a delete took its last zone |

CHECKs: `device_approved_profiles_start_ck` (`starting_zone_id is null or zone_ids is not null`) and
`device_approved_profiles_zone_ids_ck` (`jsonShapeCheck(t.zoneIds, "array", { nullable: true })`).
`device_zone_selections` and `device_zone_selection_zones` are deleted.

**What a row means now** (§1.3): the device's active profile still counts as approved with or
without a row (`apps/server/src/device.ts:186-187`); saving a zone choice under the active profile
now writes a row for it. Every reader of "approved alternatives" already leaves the active profile
out (`readApprovedAlternatives`, `device.ts:156`); this slice adds the same condition to the one
reader that does not:

- `device-delete.ts:124-128` (the delete impact's "approved profiles"): add
  `ne(deviceApprovedProfiles.deviceProfileId, devices.deviceProfileId)` (join `devices`), so a zone
  memory row for the active profile is not listed as an approval. Its zone-memory count
  (`:135`, `countDeviceZoneSelections`) counts rows with `zone_ids is not null`.

**The two writers that change** (§1.3, quoted):

- `keepApprovedAfterSwitch` "stops deleting the new active profile's row" (`device.ts:233-240`
  goes; the insert of `from` at `:227-232` stays).
- `approveDeviceProfiles` "stops deleting every row and re-inserting" (`device.ts:209-213`): it
  deletes only rows whose profile is neither in the new list nor the active profile, and inserts
  the new ones with `onConflictDoNothing` targeted at the primary key. A row whose profile stays
  approved keeps its zones; a withdrawn profile's row goes with its zones (the owner's decision).

**The zone writer and readers** (`packages/venue-service/src/device-zone-selection.ts`), signatures
kept: `readDeviceZoneSelection` (`:25-117`) reads the row's two columns (`stored === undefined`
becomes "no row, or `zone_ids` null"); `setDeviceZoneSelection` (`:119-156`) upserts the row's
`starting_zone_id` and `zone_ids` in one statement; `countDeviceZoneSelections` (`:158-167`) as
above; `removeDeviceZoneSelections` (`:169-171`) sets both columns null on the device's rows (the
rows themselves are approvals and stay until `deleteDevice` removes them). The snapshot hash
(`:89-105`) keeps its inputs and order, so a client's saved snapshot keeps matching for the same
state.

**A zone's delete** (`packages/venue-service/src/service-delete-settings.ts:388-393`): remove the
zone from every row's `zone_ids` with dv0's `removeIdFromJson`, and set `starting_zone_id` null
where it names the zone; a saved list can become `[]`, which differs from never saved (§1.3, the
read handles it at `device-zone-selection.ts:73`). The impact read (`:226-247`) searches the
column with `json_each`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| An `activity_log` kind for approval changes | Follow-up outside A1308 (README U11) |
| Approved profiles in the configuration export | Not exported today (devices are not); nothing to add |

## Files

**Modify**
- `packages/db/src/schema/device-approved-profiles.ts`; delete
  `packages/db/src/schema/venue-service/device-zone-selection.ts`; `packages/db/src/index.ts:458-459`,
  `packages/venue-service/src/index.ts:25-26`; `packages/db/src/classification.ts:340-341`;
  `packages/venue-service/src/classification.ts:22-23`.
- `apps/server/src/device.ts:190-246`; `apps/server/src/device-delete.ts:124-135`, `:204`, `:207`.
- `packages/venue-service/src/device-zone-selection.ts`; `service-delete-settings.ts:226-247`,
  `:388-393`.
- `apps/dashboard/src/api/live-queries.ts:139` (and any list naming the two tables).
- `scripts/schema-constraints.test.ts:34-38`, `:89-90`.
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (two tables to `REMOVED_TABLES`;
  `device_approved_profiles` column edits).
- Tests writing the two tables directly (3 files, `git grep -l "deviceZoneSelection\|device_zone_selection" -- '*.test.ts'`).
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/device-approved-profiles.test.ts`.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 30, `device.ts` 25, device delete 10, zone selection 50, delete settings 20, lists 10 | ~145 |
| Tests: schema test 90, two new writer cases 60, set-up re-pointed 60, guard lists 10 | ~220 |
| **Total** | **~365** |

About 1½ hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/device-approved-profiles.test.ts src/classification.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/device-zone-selection.test.ts src/service-delete-settings.test.ts src/classification.test.ts
pnpm --filter @waitron/server exec vitest run src/device.test.ts src/device-api.test.ts src/device-zones-api.test.ts src/device-delete.db.test.ts src/device-api.delete.test.ts src/till-api.profile-zones.test.ts src/service-delete.integration.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db --filter @waitron/venue-service --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/migration-upgrade.test.ts
git grep -n "deviceZoneSelections\|deviceZoneSelectionZones\|device_zone_selection" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Under all six headers:

```text
missing index device_zone_selection_zones.primary key(device_id,device_profile_id,zone_id)
missing index device_zone_selections.primary key(device_id,device_profile_id)
missing table device_zone_selection_zones
missing table device_zone_selections
changed table device_approved_profiles.columnOrder
changed table device_approved_profiles.foreignKeys[device_id->devices(id)].onDelete
extra table device_approved_profiles.checks[device_approved_profiles_start_ck]
extra table device_approved_profiles.checks[device_approved_profiles_zone_ids_ck]
extra table device_approved_profiles.columns[starting_zone_id]
extra table device_approved_profiles.columns[zone_ids]
extra table device_approved_profiles.foreignKeys[starting_zone_id->floor_zones(id)]
```

(`onDelete` changes from `cascade` to `no action`.) Under the two `change-feed` headers, also the six
`waitron_change_device_zone_selection*` triggers `missing` and
`changed trigger waitron_change_device_approved_profiles_update.when`.

Reasons (`tables-devices.md` §5): "device_approved_profiles: PK, both FKs cascade — kept on the
merged table (device side becomes no action, deleted explicitly at `device-delete.ts:204`)";
"device_zone_selections: PK, FKs device / profile cascade / start zone — the PK and FKs move onto
`device_approved_profiles`"; "device_zone_selection_zones: PK, composite FK cascade, zone FK —
**given up**: the shape holds one owner; duplicates and unknown zones are refused by
`setDeviceZoneSelection`, which already checks both"; the start CHECK is new (§1.3).

## Stop points (beyond rules §5)

1. A device's alternatives list (`readApprovedProfiles`, the switch screen) shows its active profile
   after it saved a zone choice.
2. A test asserts that approving profiles clears zone memory of a profile that stays approved (the
   old wipe), other than the owner's withdrawn-profile case.

## Needs

dv9 (last core change), dv6 (`readProfileZones` on the profile's columns), dv0.

## In-flight work folded in (rules §8)

None open (`git grep -l device_zone_selection docs/superpowers/plans/` finds only the landed A797
plan).

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the merged table

- [ ] **Step 1: failing test** `device-approved-profiles.test.ts`: "a row with no zone memory, one
  with a saved list and start, one with a saved empty list" (stored); "refuses a start with no saved
  list" (`device_approved_profiles_start_ck`); "refuses a zone list that is not an array"; "deleting
  a device with rows is refused, and deleting a profile removes its rows" (raw deletes with keys on).
  Run: FAIL.
- [ ] **Step 2:** schema; delete the two tables; rebuild core. Run: PASS. Commit.

### Task 2: the writers and readers

- [ ] **Step 1: failing cases** in `apps/server/src/device.test.ts`: "approving profiles keeps the
  zones a device saved under a profile that stays approved"; "withdrawing a profile's approval
  forgets the zones saved under it"; "switching profile keeps the zones saved under the new active
  profile"; "a zone choice saved under the active profile does not list it as an alternative". Run:
  FAIL.
- [ ] **Step 2:** the two writers, the device-delete impact and count, the zone writer and readers,
  the zone delete; re-point the three tests' set-up. Run the finish line: PASS (stops 1–2). Commit.

### Task 3: lists, protection list, finish

- [ ] Live queries, classification, schema-constraints, demo-seed. Protection list after;
  `compare`; mark each line. `apps/server/src/guide/{en,es}/devices.md`: if a sentence says
  re-approving a profile resets the device's zones, change it to say withdrawing the approval does
  (grep "zone" in both); otherwise none. Commit; `/finish-branch`; reset dev slots and Santet after
  landing.
