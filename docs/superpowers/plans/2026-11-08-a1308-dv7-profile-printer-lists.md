# A1308 dv7: a profile's printer lists live on the profile — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** `device_profile_printers` folds into one JSON column, `device_profiles.printer_lists`:
for each job (receipt, payment slip, cash drawer, invoice) the printers offered in order and the
default. The writer takes over the database's three unique keys; deleting a printer clears it from
every list, since "a stale id is not harmless on a printer list" (`tables-devices.md` §1).

**Spec:** [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1 (lists
table row `printer_lists`, "A stale id is not harmless on a printer list"), §1.2, §4 row
`device_profile_printers`, §5 rows `device_profile_printers` (both), §7 gap 1 and M4. README §3 R4.
Rules: [slice rules](2026-11-08-a1308-slice-rules.md). Area order:
[dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv6. Lines read at `a086eedfb7`; dv4 already took the `page_printer_id`
reads out of the files cited here, so their line numbers have moved within those functions. A cite
whose function no longer does what this plan says is a stop (rules §5.1).

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

```ts
// packages/db/src/schema/device-profiles.ts
export type PrinterListRole = "receipt" | "payment_slip" | "cash_drawer" | "invoice";
/** A profile's printers per job, in display order, and each job's default (on its list, or null).
 *  An absent role is an empty list with no default. */
export type StoredPrinterLists = Partial<
  Record<PrinterListRole, { readonly ids: readonly string[]; readonly defaultId: string | null }>
>;
printerLists: json<StoredPrinterLists>("printer_lists").notNull().default({}),
// check("device_profiles_printer_lists_ck", jsonShapeCheck(t.printerLists, "object"))
```

- `device_profile_printers` is deleted.
- `packages/layouts/src/device-printers.ts` keeps its exported names and types
  (`ProfilePrinterLists`, `emptyPrinterLists`, `readProfilePrinterLists`, `setProfilePrinterLists`);
  `foldPrinterLists` (`:59-75`) becomes `printerListsFrom(stored: StoredPrinterLists):
  ProfilePrinterLists` and its reverse `storedPrinterListsFrom(lists): StoredPrinterLists` (a role
  with an empty list and no default is left out of the stored object, so `{}` means "nothing
  listed").
- `setProfilePrinterLists` (`:104-151`) keeps every refusal it has (deleted or unknown printer,
  default off its list, a new drawer printer with no drawer, an A4 printer on a non-invoice list)
  and **adds** the one the unique keys held: a printer listed twice for one role is refused
  `device_profile.invalid` with `reason: "duplicate_printer"` and `field` the list's key (`tables-devices.md`
  §5: "Duplicates within a role are refused by the route (`management-api.ts:532`), with the unique
  key behind it, so the writer takes that check over"). It writes the column in one update; the
  delete-then-insert at `:136-150` goes.
- `deletePrinter` (`apps/server/src/printer-delete.ts:178`) calls dv0's
  `removeIdFromJson(tx, deviceProfiles.printerLists, id)`; a default naming the printer becomes
  `null` and the id leaves every list. Its impact read (`:80-110`) finds profiles and default-using
  devices from the column (`exists (select 1 from json_tree(device_profiles.printer_lists) where
  atom = ?)`, then the role and default worked out in code).
- Configuration transfer: `device_profiles`' declaration (dv6) gains
  `{ column: "printer_lists", paths: [["*", "ids", "*"], ["*", "defaultId"]] }`;
  `device_profile_printers` leaves `CORE_CONFIGURATION_TRANSFER`
  (`packages/db/src/configuration-transfer.ts:102`).

## Decisions this plan makes

1. **Role keys are the database's existing role words** (`receipt`, `payment_slip`, `cash_drawer`,
   `invoice`, `device_profile_printers_role_ck`), not the API's camel-case list names. The writer
   refuses any other key by type; there is no database CHECK on keys (a CHECK cannot read inside
   JSON, §1).
2. **Order is the array's order.** Today `position` orders rows (`device-printers.ts:90`); the array
   keeps the order the writer was given.
3. **New refusal words.** `packages/layouts/src/errors.ts:31-41` gains `"duplicate_printer"` in
   `device_profile.invalid`'s `reason`. If `apps/dashboard/src/i18n/codes.ts` words that code per
   reason, add EN "A printer is listed twice for one job." and ES "Una impresora aparece dos veces
   para la misma tarea."; the route's own refusal (`management-api.ts:539-540`) still answers first
   for API calls, so a person sees it only from a direct call.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `card_readers` on the profile | Payments slice |
| `kitchen_views` | dv8 |
| Wire shape of the lists | Unchanged: the API sends `ProfilePrinterLists` as today |

## Files

**Modify**
- `packages/db/src/schema/device-profiles.ts`; delete `packages/db/src/schema/device-profile-printers.ts`
  and its test; `packages/db/src/schema/index.ts:41`, `packages/db/src/index.ts:185-188`;
  `packages/db/src/classification.ts:111`; `packages/db/src/configuration-transfer.ts:76`, `:102`.
- `packages/layouts/src/device-printers.ts`, `device-equipment.ts` (the profile-list reads near
  `:150-172`, `:368-382`, `:500-517`), `device-profile-store.ts:113-129`, `:300-303` (a profile
  delete no longer deletes rows; a copy copies the column), `errors.ts:31-41`.
- `apps/server/src/printer-delete.ts:80-110`, `:178`; `demo-printer.ts:96-102`;
  `device-equipment.ts:376-387` (the pickup scan's "listed for receipts or slips" check reads the
  column); `print-api.ts:1645-1680` (`readPrinterProfileUses`).
- `apps/server/src/testing/invoice-printer.ts` (write the column).
- `apps/server/scripts/demo-seed/testing/madrid-semantics.ts:241-242` (drop the table's key rule);
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`REMOVED_TABLES`, the
  `device_profiles` column edit).
- `apps/dashboard/src/api/live-queries.ts:106`, `:121`, `:399`; `apps/dashboard/src/i18n/codes.ts`
  (decision 3, if needed).
- `scripts/schema-constraints.test.ts:100-101`.
- Tests writing `device_profile_printers` directly (17 files): set-up through
  `setProfilePrinterLists` or a raw column write.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/layouts/src/device-printers.lists.test.ts` (the writer's new refusal and the
JSON round trip).

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 20, device-printers 70, device-equipment 60, profile store 20, printer delete 40, demo printer, equipment scan and used-by 40, transfer 5, errors and words 10, lists 10 | ~275 |
| Tests: writer test 90, set-up re-pointed in 17 files 170, M4 extension 50, guard lists 10 | ~320 |
| **Total** | **~595** |

About 2½ hours.

## Finish line

```bash
pnpm --filter @waitron/layouts exec vitest run src/device-printers.lists.test.ts src/device-printers.db.test.ts src/device-equipment.db.test.ts src/device-profile-store.db.test.ts
pnpm --filter @waitron/server exec vitest run src/printer-delete.db.test.ts src/printer-delete-history.test.ts src/demo-printer.test.ts src/device-equipment.test.ts src/device-equipment-api.test.ts src/management-api.device-profiles.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/receipt-print.test.ts src/configuration-transfer.test.ts src/till-api.profile-zones.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/device-profiles-screen.test.ts
pnpm --filter @waitron/db --filter @waitron/layouts --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts scripts/errors-reachable.test.ts
git grep -n "deviceProfilePrinters\|device_profile_printers\|foldPrinterLists" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing.

## Expected protection-list difference

Under all six headers:

```text
missing index device_profile_printers.primary key(id)
missing index device_profile_printers_profile_role_default_key
missing index device_profile_printers_profile_role_printer_key
missing table device_profile_printers
changed table device_profiles.columnOrder
extra table device_profiles.checks[device_profiles_printer_lists_ck]
extra table device_profiles.columns[printer_lists]
```

Under the two `change-feed` headers, also the three `waitron_change_device_profile_printers_*`
triggers `missing` and `changed trigger waitron_change_device_profiles_update.when`.

Reasons (`tables-devices.md` §5): "device_profile_printers: three unique keys, role CHECK, target
CHECK — **given up**: `setProfilePrinterLists` refuses a default off its list, a missing or deleted
printer and, on any list but the invoice one, an A4 printer. One default per role is the shape.
Duplicates within a role are refused by the route … so the writer takes that check over";
"FKs to printers, restrict — clearing moved to `deletePrinter`". (The target CHECK and the
page-printer key left in dv4.)

## Stop points (beyond rules §5)

1. A case asserts an order of printers that differs from the order given to the writer.
2. `printer-delete-history.test.ts` or the delete impact's targets change (the impact's named
   profiles and devices must be the same list).
3. M4's printer part fails (below).

## Needs

dv6 (the `device_profiles` transfer declaration), dv4 (one printer id space), dv0.

## In-flight work folded in (rules §8)

- **A405 PR 2** ("Used by", landed #2511) is `readPrinterProfileUses`; its assertions in
  `print-api.test.ts` stay unchanged.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: M4's printer part, against today's table

- [ ] **Step 1:** extend dv6's `describe("device profile scope round trip (M4)")` with: profile P1
  lists receipt printers `[R1, R2]` with default R2, invoice printers `[R1, A1]` (A1 an A4 printer)
  with default A1; a printer R3 deleted through `deletePrinter` was on P1's slip list. Export,
  import, read P1's lists through `readProfilePrinterLists`: each id names a printer of the new
  venue, in the same order, defaults kept, and R3 absent. Run on the base table: PASS (baseline).
  **Failing result after Task 2:** an old venue's id, a missing printer, or R3 present. Commit.

### Task 2: the column, the writer, the readers

- [ ] **Step 1: failing test** `device-printers.lists.test.ts`: "stores each job's printers in the
  order given, and the default" (read back equal); "refuses a printer listed twice for one job"
  (`reason: "duplicate_printer"`, `field: "receiptPrinterIds"`) "and allows the same printer on two
  jobs"; "an empty job is not stored" (the column reads `{}` after saving all-empty lists);
  "refuses a column that is not an object" (raw `'[]'` raises `device_profiles_printer_lists_ck`).
  Run: FAIL.
- [ ] **Step 2:** schema; delete the table; rebuild core; the writer and readers as above; the
  profile store, equipment reads, delete flow, demo printer, pickup scan, used-by; the test helper.
  Re-point the 17 test files' set-up. Run the finish line's layouts and server suites: PASS.
  Commit.

### Task 3: transfer, M4, lists

- [ ] **Step 1:** the transfer declaration; run M4: PASS unchanged (stop 3 otherwise). Prove the
  guard by deletion as dv6 did for `order_zone_ids`.
- [ ] **Step 2:** live queries, classification, schema-constraints, demo-seed files. Run the full
  finish line. Commit.

### Task 4: protection list, finish

- [ ] **Step 1:** protection list after; `compare`; mark each line.
- [ ] **Step 2:** `docs/developers/conventions-data.md`, dv0's section: `printer_lists` and that
  `deletePrinter` is what keeps a deleted printer off every list (nothing in the database backs it,
  `tables-devices.md` §1). Commit; `/finish-branch`; reset dev slots and Santet after landing.
