# A1308 pa4: a card reader's holder, a device's choice and a profile's list move onto their owners' rows — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** `card_reader_holders` becomes `card_readers.held_by_device_id`, `device_card_readers`
becomes `devices.card_reader_id`, `device_profile_card_readers` becomes the JSON list
`device_profiles.card_readers`, and `card_readers.active` goes (it always equals
`disabled_at is null`).

**Architecture:** Each link table holds at most one row per owner (primary key `reader_id`, or
`device_id`) or is a short ordered list owned by one profile (README §3 R4's exception), so each
becomes a column on its owner. `devices.card_reader_id` holds the reader as a plain id with no key,
because core's `devices` cannot name a table of the switchable payments set (README §5 U11). The
JSON list uses dv0's shape CHECK and clearing helper. Everything that reads or writes the three
tables lives in `packages/payments` and `apps/server` (`tables-fiscal.md` §1.3), so the change is
local to them plus two column declarations in core's schema. The wire stays as it is: `active` is
still sent, computed from `disabled_at`.

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Hono, Vitest 4.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R4, §5 U11 ("Card
readers on a device"); [`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md)
§1.3 (`card_readers`, the profile list, `devices.card_reader_id`), §4 rows `card_reader_holders`,
`card_readers`, `device_card_readers`, `device_profile_card_readers`, §5 the same four rows, §6
("Whether a reader is enabled"); [`tables-devices.md`](../specs/2026-11-02-rationalisation/tables-devices.md)
§1 (the list table's `device_profiles.card_readers` row: default `{}`), §1.1 (`card_reader_id`),
§7 item 1 (`card_readers` does not travel, so `omit`). Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after **Needs**. Line numbers read at `a086eedfb7`.

**Who lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core, payments; backups and exports from
before this cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply. Rebuild both sets: `pnpm --filter @waitron/server migration-baseline rebuild --set core`
  and `--set payments`.
- Owner decisions copied from the design: "`device_card_readers` becomes the column
  `devices.card_reader_id` … Null means 'use the profile's default'"; "A profile's card readers
  become a list on the profile … `{ids: [...], defaultId}`"; "No unique index on
  `held_by_device_id`. One device holding two readers is not refused today" (a takeover takes the
  new reader before releasing the old, `packages/payments/src/device-readers.ts:349-355` then
  `:413-419`).
- The stored list is an object. Its default is `{}` (`tables-devices.md` §1: "stays `{}` when that
  module is off"); every write stores `{ "ids": [...], "defaultId": <id or null> }`; a read treats a
  missing `ids` as `[]` and a missing `defaultId` as `null`.
- The JSON list follows dv0: CHECK `device_profiles_card_readers_ck` = `jsonShapeCheck(t.cardReaders, "object")`;
  a deleted reader's id is removed with `removeIdFromJson(tx, deviceProfiles.cardReaders, id)`;
  `card_readers` goes in `device_profiles`' configuration `omit` list, which dv0's guard accepts for
  a `json_valid` column.
- `card_readers.held_by_device_id` → `devices.id` `ON DELETE SET NULL` (a cascade would now delete
  the reader; devices and readers are only ever soft-deleted, so neither action fires today,
  `tables-fiscal.md` §5).
- Wire shapes do not change: `ProfileReaderList` (`{ readerIds, defaultReaderId }`), reader rows'
  `active`, the routes' refusal codes.

## Review Focus

1. **Taking over a reader another device holds** (scan or confirmed choice): the new holder is
   written before the old device lets go, and the old device's choice of that reader is cleared.
   `device-readers.test.ts`'s takeover cases keep their assertions.
2. **Deleting a reader that is a profile's default and another profile's second choice.** Both
   lists lose it, the default becomes `null`, and the devices choosing it go back to Use default.
   `card-reader-delete.db.test.ts` keeps its assertions; Task 3 adds the two-profile case.
3. **Saving a profile's list with a duplicate, an unknown reader, a deleted reader or the demo
   reader.** The same refusals as today (`management.request_invalid` field `readerIds`,
   `reader.not_found`), now decided inside `setProfileReaderList`. Task 2.
4. **A box with payments switched off.** Core's `devices` and `device_profiles` must still accept
   writes with the payments set absent (the reason the key was given up). Task 1's core-only case.
5. **An exported configuration.** `device_profiles.card_readers` is left out of the export and an
   import refuses it if present; an imported profile starts with `{}`. Task 1.

## What it builds

- `card_readers`: `held_by_device_id` added, `active` dropped; schema `card-reader-holders.ts`,
  `device-card-readers.ts`, `device-profile-card-readers.ts` deleted with their classification rows,
  exports (`packages/payments/src/index.ts:146-148`) and live-update names.
- `devices.card_reader_id` (core, `packages/db/src/schema/devices.ts`), plain id, declared right
  after `invoicePrinterId` (the place `tables-devices.md` §1.1 draws and dv1's plan names), with a
  comment stating why it has no key.
- `device_profiles.card_readers` (core, `packages/db/src/schema/device-profiles.ts`), JSON object,
  default `{}`, shape CHECK, and `omit: ["card_readers"]` on `device_profiles` in
  `CORE_CONFIGURATION_TRANSFER` (`packages/db/src/configuration-transfer.ts:76`).
- `device-readers.ts` rewritten over the columns; `setProfileReaderList` takes over the route's
  known-reader and no-duplicate checks.
- `card-reader-delete.ts`, `device-delete.ts`, `device-equipment.ts:99-103`, `payments-api.ts`
  reader routes, `till-api.ts:383`, `till-setup.ts:70`, `alert-sources.ts:774`, `box-health.ts:307`,
  `boot.ts:529`, `packages/payments/src/backup-verification.ts:179` read and write the columns.
- Payments' backup check gains a plain-id check: every `devices.card_reader_id` and every id in
  `device_profiles.card_readers` names a `card_readers` row. Its `referencesValid` walks only the
  payments schema's keys (`backup-verification.ts:127-160`), so without it the two reference cases
  for the old link tables would lose their subject.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Activity-log kinds `card_reader.*` and `device_profile.card_readers_changed` (`tables-fiscal.md` §3) | follow-ups, not built in A1308 (README §5 U11) |
| The other JSON lists on `device_profiles` and `devices` (`printer_lists`, `order_zone_ids`, `kitchen_views`, `admitted_roles`, `made_here_station_ids`) | the devices area (`dv5`–`dv7`) and A1002 |
| A unique index on `held_by_device_id` | not built (owner decision above) |
| Exporting card readers in a configuration | not built: readers are not exported today (`packages/payments/src/configuration-transfer.ts`) |

## Files

**Modify**
- `packages/payments/src/schema/card-readers.ts`, `schema/index.ts:8-11`, `index.ts:145-148`,
  `classification.ts:19-22`, `device-readers.ts` (whole file), `backup-verification.ts:127-160, :179`.
- `packages/payments/test/seed.ts:23-24, :185-188`.
- `packages/db/src/schema/devices.ts:25-60`, `schema/device-profiles.ts:33-56`,
  `configuration-transfer.ts:76`.
- `apps/server/src/card-reader-delete.ts:16-20, :109-142, :217-224, :251-253, :276-288`,
  `device-delete.ts:25-27, :100-105, :129-134, :205, :207-216`, `device-equipment.ts:18, :99-103`,
  `payments-api.ts:34-35, :195-209, :533-605, :639-662, :761-835, :965-1057`,
  `till-api.ts:383` and `till-setup.ts:70` (both filter `cardReaders.active`),
  `alert-sources.ts:774`, `box-health.ts:307`, `boot.ts:529-540`, `testing/bill-venue.ts:32, :231-260`.
- `apps/dashboard/src/api/live-queries.ts:125-158, :420-437`.
- Guards: `scripts/schema-constraints.test.ts:57-58, :91-92, :95-96, :406` (delete) and add
  `["card_readers", ["held_by_device_id"], "devices"]`.

**Create:** `packages/payments/src/schema/card-reader-columns.test.ts`.

**Delete** (pure deletion): the three schema files above;
`packages/payments/src/schema/{card-reader-holders.test.ts,device-card-readers.fk.test.ts,device-profile-card-readers.test.ts}`
— their cases re-homed in Task 1, listed there.

**Tests re-pointed** (set-up and direct reads of the old tables; assertions kept):
`packages/payments/src/{device-readers,backup-verification,migrations,schema-ownership}.test.ts`,
`packages/payments/src/schema/card-readers.fk.test.ts`, `packages/payments/src/testing/fake-provider.test.ts`,
`apps/server/src/{card-reader-delete.db,device-delete.db,device-equipment,device-equipment-api,payments-api,join-e2e,till-api.fiscal-sale-paths,bill-payments-api,bill-payments.card}.test.ts`,
`apps/dashboard/src/screens/payments-screen.delete.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`,
`packages/provisioning/src/configuration-transfer.reader-slip-setting.test.ts` (its `select *` rows
lose `active`; values otherwise equal); readers seeded with `active` in
`apps/server/src/alert-sources.test.ts:1085`, `alerts-api.test.ts:715`, `box-health.test.ts:98`
(`over` values that set `active: false` become `disabledAt`), and the raw insert at
`till-api.receipt.test.ts:2403` (the `active` column and its value go).

**Assertions changed by design** (the column is gone, `tables-fiscal.md` §6):
- `apps/server/src/boot-card-provider.test.ts:48` (`active: true` → `disabledAt: null`) and `:52`
  (`{ active: false }` → `disabledAt` not null), the demo reader's on/off read.
- `packages/payments/src/backup-verification.test.ts`: fixture inserts `:91-97` become the columns
  (`held_by_device_id` on the reader; `card_reader_id` on a seeded `devices` row; the list on a
  seeded `device_profiles` row); value-change rows `:265-267` (`device_card_readers`,
  `device_profile_card_readers`, `card_reader_holders`) **deleted**, one row
  `["card_readers", "held_by_device_id=null"]` added; reference rows `:288-293` for the three
  tables **deleted** and replaced by `["card_readers", "held_by_device_id"]` (a schema key, walked
  as before) and two cases for the plain-id check: `devices.card_reader_id = 'missing'` and a
  profile list naming `'missing'`, each `invalid`; the table list at `:411` loses
  `card_reader_holders`; `update card_readers set active=1` (`:306`, `:317`, `:322`) becomes
  `disabled_at=null`.

## Size

| Part | Counted lines |
| --- | --- |
| Schema (three columns, CHECK, omit, classification, exports) | ~45 |
| `device-readers.ts` rewrite | ~190 |
| Delete flows, equipment, routes, till start and setup reads, alerts, health, boot, backup check (with the plain-id check), live names, seeds | ~200 |
| New schema test file | ~140 |
| Re-pointed tests, changed-by-design cases and guard | ~385 |
| **Total** | **~960** |

**If the count passes ~1,000** (decision D3): stop after Task 2 and split. pa4a: `card_readers.active`
goes and `card_reader_holders` becomes `held_by_device_id` (the holder functions in
`device-readers.ts`, `readReaderHolders`, the `active` readers, the backup cases for those).
pa4b: `device_card_readers` and `device_profile_card_readers` become the two core columns (the
choice and list functions, the delete flows' choice and list parts, the plain-id check). Each half
keeps this plan's tests for its tables and its own lines of the protection-list prediction.

Uncounted: three schema files and three schema tests deleted (~330 lines); generated files for
core and payments. About 3 hours.

## Finish line

```bash
pnpm --filter @waitron/payments test
pnpm --filter @waitron/db exec vitest run src/schema/devices.test.ts src/schema/devices.fk.test.ts src/schema/device-profiles.trigger.test.ts
pnpm --filter @waitron/server exec vitest run src/card-reader-delete.db.test.ts src/device-delete.db.test.ts src/device-delete.history.test.ts src/device-equipment.test.ts src/device-equipment-api.test.ts src/payments-api.test.ts src/join-e2e.test.ts src/till-api.fiscal-sale-paths.test.ts src/bill-payments-api.test.ts src/bill-payments.card.test.ts src/boot-card-provider.test.ts src/box-health.payments-off.test.ts src/reader-slip-setting.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.reader-slip-setting.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.delete.test.ts src/screens/payments-screen.test.ts src/api/live-queries.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/two-file-foreign-keys.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/payments --filter @waitron/db --filter @waitron/server --filter @waitron/dashboard --filter @waitron/provisioning typecheck
git grep -n -E 'card_reader_holders|device_card_readers|device_profile_card_readers|cardReaderHolders|deviceCardReaders|deviceProfileCardReaders|cardReaders\.active' -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'   # prints nothing
```

## Expected protection-list difference

Six venue headers. Reasons: `tables-fiscal.md` §5 rows `card_readers` ("Unchanged" partial unique
kept), `card_reader_holders` ("built into the shape … device FK becomes SET NULL"),
`device_card_readers` ("the reader FK is given up"), `device_profile_card_readers` ("Given up for
`device_profiles.card_readers`"); §6 (`active`); dv0's shape CHECK.

**Under all six headers** (16 lines each, 96):

```text
missing table card_reader_holders
missing table device_card_readers
missing table device_profile_card_readers
missing index card_reader_holders.primary key(reader_id)
missing index device_card_readers.primary key(device_id)
missing index device_profile_card_readers.primary key(device_profile_id,reader_id)
missing index device_profile_card_readers_profile_default_key
missing table card_readers.columns[active]
extra table card_readers.columns[held_by_device_id]
extra table card_readers.foreignKeys[held_by_device_id->devices(id)]
changed table card_readers.columnOrder
extra table devices.columns[card_reader_id]
changed table devices.columnOrder
extra table device_profiles.columns[card_readers]
extra table device_profiles.checks[device_profiles_card_readers_ck]
changed table device_profiles.columnOrder
```

**Under the two `change-feed` headers** (12 lines each, 24): `missing trigger
waitron_change_<t>_{insert,update,delete}` for the three dropped tables; `changed trigger
waitron_change_card_readers_update.when` (one term out, one in), `changed trigger
waitron_change_devices_update.when` and `changed trigger waitron_change_device_profiles_update.when`
(one term in each).

**120 lines.** No `card_readers_provider_ref_key` line: it is kept unchanged.

## Stop points (beyond rules §5)

1. A devices-and-printing slice that changes `devices` or `device_profiles` is in flight (rules §7);
   the watcher sequences the two.
2. dv0's `jsonShapeCheck` or `removeIdFromJson` is not on `main`, or has a different signature
   from the one in **Global Constraints**.
3. A reader of `card_readers.active` outside the **Files** list (`git grep -n "active" -- <file>` on
   a file that selects from `cardReaders`).
4. A behaviour test in the re-pointed list fails with a changed value (not a changed table name).
5. The counted size passes ~1,000 (the split above).

## Needs

- **Outside this area:** slice 1a; dv0 (devices area: the JSON list helpers); not the refunds slice
  (decision D2, coordinator review 2026-11-08); the location sweep
  (5: `devices.location_id` gone, so the devices columns this predicts are against that shape);
  A739 Cut A is already on `main` (`prints_own_slip_automatically`, `9fd55c4066`).
- **In this area:** none strictly. Built after pa3 so the payments set is not changed by two lane
  pull requests at once.
- **Coordination:** the devices writer's plans leave `devices.card_reader_id` and
  `device_profiles.card_readers` to this pull request; no devices slice may be in flight with it
  (stop point 1).

---

### Task 0: base list

- [ ] From `apps/server`, `pnpm protection-list list --out <empty absolute dir A>` on the base.
  Check stop points 1 and 2.

### Task 1: the columns

**Interfaces:**
- `packages/db/src/schema/device-profiles.ts`: `export interface DeviceProfileCardReaders { ids?: string[]; defaultId?: string | null }`;
  column `cardReaders: json<DeviceProfileCardReaders>("card_readers").notNull().default({})`.
- `packages/db/src/schema/devices.ts`: `cardReaderId: id("card_reader_id")`, right after
  `invoicePrinterId`, with the comment
  "No foreign key: `card_readers` is in the switchable payments set (design U11).
  `selectDeviceReader` checks the reader, and a reader delete clears this column."
- `packages/payments/src/schema/card-readers.ts`: `heldByDeviceId: id("held_by_device_id")`,
  `foreignKey({ columns: [t.heldByDeviceId], foreignColumns: [devices.id], name: "card_readers_holder_fk" }).onDelete("set null")`;
  `active` removed; the table comment becomes "Disable sets `disabled_at`; Delete also sets
  `deleted_at`; payments keep the row either way."

- [ ] **Step 1: Write the failing tests** in `card-reader-columns.test.ts`:
  - "a reader has at most one holder, and one device may hold two readers" (re-homes
    `card-reader-holders.test.ts:57, :70`): two readers both held by one device succeed; the
    holder is one column, so "a second holder" cannot be written.
  - "deleting a device's row frees the reader it held" (`delete from devices` with keys on →
    `held_by_device_id` null; the reader row stays).
  - "refuses a holder that is not a device" → `FOREIGN_KEY_VIOLATION`.
  - "a profile's reader list is an object" → `device_profiles_card_readers_ck` refuses `[]`,
    `'x'` and `3`; accepts `{}` and `{"ids":["r"],"defaultId":"r"}`; a new profile reads `{}`.
  - "core's device tables take writes with the payments set absent" (`useVenueDb({ migrations:
    [CORE_MIGRATIONS] })`): a `devices` insert with `card_reader_id` null and one with an id
    naming nothing both succeed (re-homes `device-card-readers.fk.test.ts:95`'s reader half as
    the decision that replaced it; its device half is the row itself).
  - Re-homed and dropped: `device-card-readers.fk.test.ts:48` → Task 2's device-choice cases;
    `:71` "second chosen reader" → **dropped**, one column cannot hold two;
    `device-profile-card-readers.test.ts:48` "second default" → **dropped**, `defaultId` is one
    field; `:71` → Task 2's list cases.
  - In `packages/provisioning/src/configuration-transfer.reader-slip-setting.test.ts` (or the
    boundaries suite): "a profile's reader list does not travel" — export holds no `card_readers`
    key on `device_profiles`; an import of a bundle carrying it is refused `setup.request_invalid`
    `{ field: "device_profiles.card_readers" }`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Add the three columns, the CHECK and `omit: ["card_readers"]`; delete the three
  schema files, their exports and classification rows; rebuild `core` and `payments`.
- [ ] **Step 4:** Run: PASS (the package does not typecheck until Task 2; nothing is pushed between).
- [ ] **Step 5:** Commit `git commit -s -m "payments: reader holder, device choice and profile list become columns"`.

### Task 2: `device-readers.ts` over the columns

**Interfaces** (signatures unchanged unless shown):
- `readProfileReaderList(tx, profileId): Promise<ProfileReaderList>` — reads
  `device_profiles.card_readers`, maps `ids ?? []` / `defaultId ?? null`.
- `setProfileReaderList(tx, profileId, list): Promise<{ ok: true } | { ok: false; refusal: "default_not_listed" } | { ok: false; refusal: "duplicate" } | { ok: false; refusal: "unknown_reader"; readerId: string }>`
  — checks, in this order and writing nothing on a refusal: duplicates, each id with
  `isKnownReader`, the default on the list; then writes `{ ids, defaultId }` (it does not touch
  `device_profiles.updated_at`, as the separate table did not) and calls
  `settleProfileReaderDevices`.
- `export async function isKnownReader(tx: Transaction, readerId: string): Promise<boolean>` —
  moved from `payments-api.ts:199-209`: an undeleted reader that is not `DEMO_READER_ID`.
- `appendReaderToProfiles(tx, readerId, profileIds)` — for each named profile not listing it,
  appends to `ids` (never the default).
- `readerHeldBy(tx, readerId)` — `card_readers.held_by_device_id`.
- `readReaderStates` — choices from `devices.card_reader_id`, defaults (and with `lists`, whole
  lists) from `device_profiles.card_readers`, readers with `heldByDeviceId` as `holderDeviceId` and
  `active` computed as `disabled_at is null`; still three queries however many devices.
- `selectDeviceReader`, `settleDeviceReader`, `releaseDeviceReader`, `clearUnlistedReaderChoice`,
  `settleProfileReaderDevices` — the same rules, each holder write an `UPDATE card_readers SET
  held_by_device_id = …` and each choice write an `UPDATE devices SET card_reader_id = …`. Only
  the settle path's acquires (`settleDeviceReader`, `:389-412`) add `AND held_by_device_id IS NULL`,
  as its insert and `onConflictDoNothing` did. **The takeover in `selectDeviceReader` (`:349-355`)
  has no such clause**: it replaces the holder unconditionally, as its `onConflictDoUpdate` did,
  and writes the new holder before the old device lets go (`:356-366`), as now.
- `payments-api.ts`: `requireKnownReader` keeps its name and refusal, calling `isKnownReader`; the
  profile PUT (`:1019-1057`) drops its own duplicate check and loop, maps `duplicate` →
  `management.request_invalid` `{ field: "readerIds" }`, `unknown_reader` → `reader.not_found`
  `{ id }`, `default_not_listed` → today's `device_profile.invalid`.

- [ ] **Step 1: Write the failing tests** in `device-readers.test.ts` (each new, beside the kept
  cases): "refuses a duplicate in a profile's list and writes nothing"; "refuses an unknown,
  deleted or demo reader in a profile's list and writes nothing"; "stores the list in order with
  its default and reads it back unchanged"; "a device's choice is its `card_reader_id`, and Use
  default clears it".
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Rewrite `device-readers.ts` to the interfaces. Re-point the existing cases'
  set-up and direct reads (`select … from card_reader_holders` → `select id, held_by_device_id from
  card_readers`; `device_card_readers` → `devices.card_reader_id`; the profile table → the column).
- [ ] **Step 4:** `pnpm --filter @waitron/payments exec vitest run src/device-readers.test.ts src/schema`
  and `pnpm --filter @waitron/server exec vitest run src/payments-api.test.ts src/device-equipment.test.ts src/device-equipment-api.test.ts`:
  PASS. Commit.

### Task 3: delete flows, routes and the other readers

- [ ] **Step 1: Write the failing test** in `card-reader-delete.db.test.ts`: "deleting a reader
  that is one profile's default and another profile's second reader removes it from both lists,
  clears the default, and puts the choosing devices on Use default" (asserts both profiles'
  `readProfileReaderList` and the devices' `card_reader_id`).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement:
  - `card-reader-delete.ts:109-142` (the impact): `choosing` = devices with `card_reader_id = id`;
    `inheriting` = active devices with no choice whose profile's `json_extract(card_readers,
    '$.defaultId') = id`; `listed` = profiles with `exists (select 1 from
    json_each(card_readers, '$.ids') where value = id)` and `isDefault` from `defaultId`;
    `holders` = the reader's `held_by_device_id` device. `removeCardReader` (`:276-288`):
    `update devices set card_reader_id = null where card_reader_id = id`,
    `removeIdFromJson(tx, deviceProfiles.cardReaders, id)`, and the reader update setting
    `held_by_device_id: null`, `deletedAt`, `disabledAt` (no `active`). `:217-224`, `:251-253`:
    drop `active`.
  - `device-delete.ts`: impact `:100-105` reads readers `where held_by_device_id = id`, `:129-134`
    reads the device's `card_reader_id` joined to `card_readers`; delete `:205`; the soft-delete
    update (`:207-216`) also sets `cardReaderId: null`; `releaseDevice` releases readers through
    `releaseDeviceReader`.
  - `device-equipment.ts:99-103`: `readReaderHolders` selects `id, held_by_device_id` from
    `card_readers` where it is not null.
  - `payments-api.ts`: `:541` and `:771` filter `disabled_at is null` instead of `active`;
    `:597` and `:653-656` stop writing `active`; `:791` selects `active` as
    `sql<boolean>\`${cardReaders.disabledAt} is null\``; `:799-814` takes `chosenReaderId` from
    `devices.cardReaderId` and `defaultReaderId` from `json_extract(device_profiles.card_readers,
    '$.defaultId')` through an inner join to `device_profiles`; `:970-975` reads
    `devices.cardReaderId`.
  - `alert-sources.ts:774`, `box-health.ts:307`, `till-api.ts:383`, `till-setup.ts:70`:
    `isNull(cardReaders.disabledAt)` in place of `eq(cardReaders.active, true)`.
    `boot.ts:529-540`: select and compare `disabledAt` instead of `active` for the demo reader.
    `packages/payments/src/backup-verification.ts:179`: `… and disabled_at is null and deleted_at is null …`.
    In the same file, `referencesValid` (`:127-160`) ends with the plain-id check: when `devices`
    and `card_readers` both exist, any `devices.card_reader_id` naming no reader fails it; when
    `device_profiles` exists, any id in `json_each(card_readers, '$.ids')` or its `$.defaultId`
    naming no reader fails it.
  - Live names (`live-queries.ts`): drop `card_reader_holders`, `device_card_readers`,
    `device_profile_card_readers` everywhere; `listReaders` → `["card_readers", "device_profiles",
    "devices"]`; `listReaderHolders` → `["card_readers", "payments"]`; `getProfileReaders` →
    `["device_profiles", "card_readers"]`; `getReaderDeleteImpact` keeps `card_readers`,
    `payments`, `devices`, `device_profiles`.
  - Seeds: `packages/payments/test/seed.ts:185-188` sets `heldByDeviceId` on the reader insert;
    `apps/server/src/testing/bill-venue.ts:231-260` the same, and its device choice on `devices`.
- [ ] **Step 4:** Re-point the remaining tests in **Files**. Run the **Finish line**: PASS.
- [ ] **Step 5:** Commit `git commit -s -m "payments: reader delete, device delete and routes use the new columns"`.

### Task 4: guards, protection list, finishing

- [ ] `scripts/schema-constraints.test.ts`: delete the six rows for the three tables and
  `device_profile_card_readers_profile_default_key`; add `["card_readers", ["held_by_device_id"], "devices"]`.
  Run the root guards. Protection list after (`--out <B>`), `compare`, paste and mark. Commit;
  `/finish-branch`; the PR says dev slots and Santet are reset after landing.
