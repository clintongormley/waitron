# A1308 dv5: one invoice printer column per device, and a trigger that proves a receipt printer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** The second half of A4 printers joining `printers` (dv4 moved the rows). On `devices`,
`invoice_printer_id` names either kind and `invoice_page_printer_id` goes; a trigger takes over the
plain key's old proof that a receipt, slip or drawer choice is a thermal printer. On
`device_profile_printers`, `page_printer_id` goes and `printer_id` becomes not null (dv7 then folds
the table into `printer_lists`). A station's printer list refuses an A4 printer.

**Spec:** [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1.1 (the trigger,
`invoice_printer_id`), §5 rows `devices` and `device_profile_printers`, §6 item 7, §7 floorkitchen
bullet ("A station's printer list must refuse an A4 printer"). Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv4. Lines read at `a086eedfb7`; a cite whose code no longer says what this
plan says is a stop (rules §5.1), one that only moved is not.

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

- **`devices`:** `invoice_page_printer_id` is dropped (`packages/db/src/schema/devices.ts:54-58`);
  `invoice_printer_id` (key to `printers`, restrict) names either kind. Two hand-written triggers in
  `packages/db/triggers/core.sql`: `devices_receipt_printer_kind_insert` (`BEFORE INSERT ON devices`)
  and `devices_receipt_printer_kind_update` (`BEFORE UPDATE OF receipt_printer_id,
  payment_slip_printer_id, cash_drawer_printer_id ON devices`), each raising
  `DEVICE_PRINTER_KIND_REFUSAL = "a receipt, slip or drawer printer must be a receipt printer"`
  (`packages/db/src/trigger-refusals.ts`) when any of the three names a printer whose `kind` is not
  `receipt`. dv4's `printers_kind_fields_ck` keeps the proof true after the device row is written: a
  printer's kind cannot be changed alone.
- **Device code:** `chosenPrinterOf` and `choiceColumns` (`packages/layouts/src/device-equipment.ts:31-52`)
  read and write one invoice column; the device state type (`:80-92`) and its read (`:133-243`) lose
  `invoicePagePrinterId`; `apps/server/src/device.ts:81` (the type) and `:126` (the read) likewise;
  `apps/server/src/device-delete.ts` only if it names the column. The wire field `pagePrinterId` on
  devices' invoice choices (dashboard and till clients) is filled from `invoice_printer_id` when that
  printer is `a4` (dv4 decision 2: no wire change).
- **`device_profile_printers`:** `page_printer_id`, `device_profile_printers_target_ck` and
  `device_profile_printers_profile_role_page_printer_key` go; `printer_id` becomes not null.
  `foldPrinterLists` (`packages/layouts/src/device-printers.ts:56-75`) reads `printerId` only;
  `setProfilePrinterLists` (`:104-151`) writes `printerId` for every row and keeps refusing an A4
  printer on any list but the invoice one (`:95-103`); `readPrinterProfileUses`
  (`apps/server/src/print-api.ts:1645-1680`) and `device-profile-store.ts:113-129` read one id.
- **Configuration export:** `device_profile_printers` rows lose a column, so the bundle's format
  version goes up by one (rules §9; `packages/provisioning/src/configuration-transfer.ts:123`,
  `:160`, `:473`, `:476`, as dv2 did).
- **Stations:** the station-printer writer (`apps/server/src/station-printers.ts:22-72`, or the floor
  slice's writer of `kitchen_stations.printer_ids`) refuses an `a4` id with `printer.not_found`, as
  an unknown id is refused today.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Profile printer lists as JSON (`device_profile_printers` deleted) | dv7 |
| Card reader column on `devices` | Payments slice |

## Files

**Modify:** `packages/db/src/schema/devices.ts`, `device-profile-printers.ts`;
`packages/db/triggers/core.sql`; `packages/db/src/trigger-refusals.ts`;
`packages/layouts/src/device-equipment.ts`, `device-printers.ts`, `device-profile-store.ts`;
`apps/server/src/device.ts:78-83`, `:120-130`; `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473`, `:476`; `apps/server/src/device-equipment.ts` (if it names the
column); `apps/server/src/print-api.ts:1645-1680`; `apps/server/src/station-printers.ts` (or the floor
slice's writer); `scripts/behavioural-triggers.test.ts` (`EXPECTED` at `:97-110`, one `describe`);
`scripts/schema-constraints.test.ts:102`, `:131`; `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`
(column edits). Test files naming `invoicePagePrinterId` or a profile row's `pagePrinterId` (the rest
of dv4's 41): set-up only. Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/devices.printer-kind.test.ts`.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 20, triggers and refusal 25, layouts 60, device.ts 10, used-by and profile store 20, station writer 5, version 5 | ~145 |
| Tests: trigger test 70, behavioural guard 25, station refusal case 20, set-up re-pointed in ~12 files 110 | ~225 |
| **Total** | **~370** |

About 1½ hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/devices.printer-kind.test.ts src/schema/devices.test.ts src/schema/device-profile-printers.test.ts
pnpm --filter @waitron/layouts exec vitest run src/device-equipment.db.test.ts src/device-printers.db.test.ts src/device-profile-store.db.test.ts
pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device-equipment-api.test.ts src/device.test.ts src/management-api.device-profiles.test.ts src/print-api.test.ts src/station-printers.test.ts src/till-api.profile-zones.test.ts src/invoice-choice-delivery.test.ts src/configuration-transfer.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/widgets/invoice-recipient-dialog.test.ts
pnpm --filter @waitron/db --filter @waitron/layouts --filter @waitron/server typecheck
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/schema-constraints.test.ts scripts/migration-upgrade.test.ts
git grep -n "invoicePagePrinterId\|invoice_page_printer_id\|deviceProfilePrinters.pagePrinterId" -- apps/server/src packages ':!**/test-fixtures/**'
```

The grep prints nothing (the till's and dashboard's wire names are outside the search on purpose).

## Expected protection-list difference

Under all six headers:

```text
missing index device_profile_printers_profile_role_page_printer_key
missing table device_profile_printers.checks[device_profile_printers_target_ck]
missing table device_profile_printers.columns[page_printer_id]
missing table device_profile_printers.foreignKeys[page_printer_id->printers(id)]
missing table devices.columns[invoice_page_printer_id]
missing table devices.foreignKeys[invoice_page_printer_id->printers(id)]
changed table device_profile_printers.columnOrder
changed table device_profile_printers.columns[printer_id].notNull
changed table devices.columnOrder
extra trigger devices_receipt_printer_kind_insert
extra trigger devices_receipt_printer_kind_update
```

Under the two `change-feed` headers, also `changed trigger waitron_change_devices_update.when` and
`changed trigger waitron_change_device_profile_printers_update.when`.

Reasons (`tables-devices.md` §5): "devices: FK from `receipt_printer_id`, `payment_slip_printer_id`,
`cash_drawer_printer_id` as proof of a thermal printer — the new trigger on `devices`"; "`invoice_printer_id
is null or invoice_page_printer_id is null` goes: one column cannot hold two" (§1.1); the profile
list's target CHECK and page-printer key go with the column, held by `setProfilePrinterLists` (§5,
the `device_profile_printers` row); `printer_id` not null restates "exactly one target" with one
target.

## Stop points (beyond rules §5)

1. A device fixture names an A4 printer in a receipt, slip or drawer column, and the case asserts
   behaviour around it (the trigger now refuses it).
2. A till or dashboard test needs a change.
3. The station-printer writer cannot be found under either name.

## Needs

dv4.

## In-flight work folded in (rules §8)

None open beyond dv4's.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the device trigger and the invoice column

- [ ] **Step 1: failing test** `devices.printer-kind.test.ts`: "refuses an A4 printer as a device's
  receipt, slip or drawer printer, on insert and on update" (three columns × two statements, each
  raising `DEVICE_PRINTER_KIND_REFUSAL`); "keeps an A4 printer as its invoice printer, and a receipt
  printer in every column"; "an update that does not touch the three columns is not checked" (rename
  a device whose receipt column names a receipt printer). Run: FAIL.
- [ ] **Step 2:** drop `invoice_page_printer_id`; add the triggers and words; pin them in
  `scripts/behavioural-triggers.test.ts` with a `describe` shaped like
  `device_profile_form_factor_locked`'s (`:1512-1518`). The device code as above. Rebuild core. Run
  the test, the layouts equipment suite and the device suites: PASS. Commit.

### Task 2: one id per profile printer row; stations refuse A4

- [ ] **Step 1:** failing case in `station-printers.test.ts`: "a station refuses an A4 printer".
  Re-point the profile tests' set-up. Run: FAIL.
- [ ] **Step 2:** drop the page column, CHECK and key; the readers and writer; the station refusal.
  Rebuild core. Run the full finish line. Commit.

### Task 3: protection list, finish

- [ ] Protection list after; `compare`; mark each line. Commit; `/finish-branch`; reset dev slots and
  Santet after landing.
