# A1308 dv2: printers absorb their holder and pickup roles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** One row per printer holds who has it. `printer_holders` folds into two `printers`
columns; the `pickup_roles` JSON list becomes two flags; the unused `ticket_scope` goes; three
CHECKs the code already holds join the table.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §3 R1, R4, R5;
[tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1.6 (all but the `a4`
columns, which are dv4's), §4 rows `printers` and `printer_holders`, §5 rows `printers` and
`printer_holders`. Rules: [slice rules](2026-11-08-a1308-slice-rules.md), cited "rules §n".
Area overview and order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv1. Line numbers read at `a086eedfb7`; a cite that no longer says what this
plan says is a stop (rules §5.1); a cite that only moved is not.

**Owner lands:** no (rules §6: nothing fiscal, no invoice number, no hashed value).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## What it builds

- `printers` gains `held_by_device_id` (`id`, null, key to `devices` with **no delete action**) and
  `held_at` (`tsString`, null). `printer_holders` is deleted.
- `printers.pickup_roles` becomes `picks_up_receipts` and `picks_up_payment_slips` (`flag`, not
  null, default true each, matching today's default `["receipt","payment_slip"]`,
  `packages/db/src/schema/printers.ts:60-62`).
- `printers.ticket_scope`, `printTicketScope` and `printers_ticket_scope_ck` are deleted
  (`printers.ts:23-24`, `:53`, `:73`; the column's own comment says it is unused).
- New CHECKs: `printers_held_pair_ck` (`(held_by_device_id is null) = (held_at is null)`),
  `printers_held_portable_ck` (`held_by_device_id is null or portable = 1`), `printers_deleted_ck`
  (`deleted_at is null or active = 0`).
- Every reader and writer of the holder and the pickup list moved onto the row. **Wire shapes do
  not change:** the API still sends and accepts `pickupRoles` as an array; the server builds it in
  the fixed order `receipt`, then `payment_slip`, from the two flags.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `printers.kind`, the `a4` columns, `ipp` | dv3 (`kind`), dv4 (the rest) |
| A printer list on profiles | dv7 |
| `location_id`, `printers_local_key_key` without the location | Slice 5 (landed) |

## Decisions this plan makes

1. **The holder key has no delete action** (coordinator's decision, 2026-11-08, departing from §5's
   "the device side becomes ON DELETE SET NULL"). The reviewer showed on `node:sqlite` that `set null`
   together with `printers_held_pair_ck` refuses a raw device delete anyway (setting only
   `held_by_device_id` to null leaves `held_at` set) and breaks `useVenueDb`'s reset whenever a
   printer is held, because the reset empties `devices` before `printers`. Devices are never
   hard-deleted in product code (`apps/server/src/device-delete.ts:208-218`); a raw delete of a
   holding device is refused, which the test below pins. If `useVenueDb`'s reset then fails on a
   held printer, its table order is the fix (empty `printers`' holder first), not the key.
2. **`printers.ts` and `devices.ts` reference each other.** Declare the new key with a lazy column,
   `(): AnySQLiteColumn => devices.id`, as `print_jobs.resend_of` does
   (`packages/db/src/schema/print-jobs.ts:69`). SQLite takes a key to a table created later in the
   same file.
3. **How each holder statement maps** (in `packages/layouts/src/device-equipment.ts`):
   insert-or-ignore on the printer (`:467-469`) → `update printers set held_by_device_id = ?,
   held_at = ? where id = ? and held_by_device_id is null`; insert-or-replace (`:400-406`) →
   unconditional update of both columns; insert (`:452`) → update; delete by printer (`:587`,
   `:616`) → set both null for those ids; delete by device (`:474-478`, `:484`) → set both null
   where `held_by_device_id` is the device (and the `notInArray` condition kept).
4. **`setPrinterPortable` writes one statement when a printer becomes fixed**
   (`device-equipment.ts:607`, `:615-616`): `portable = false, held_by_device_id = null, held_at =
   null` together. Today it updates `portable` and then deletes the holder; in that order the new
   `printers_held_portable_ck` would refuse the first statement.
5. **The configuration export leaves the holder out.** Add `held_by_device_id` and `held_at` to
   `printers`' `omit` (`packages/db/src/configuration-transfer.ts:95-100`): devices are not exported
   (`tables-devices.md` §7, last bullet). Replace `isPrinterPickupSet` (`:110-124`) and its call
   (`:40-41`) with a check that `picks_up_receipts` and `picks_up_payment_slips`, when present, are
   0 or 1 (`setup.request_invalid`, `field: "printers.picks_up_receipts"` /
   `"printers.picks_up_payment_slips"`).
6. **The export's format version goes up by one** (rules §9: the bundle's `printers` rows change
   shape). Today it is `10` in four places, `packages/provisioning/src/configuration-transfer.ts:123`,
   `:160`, `:473`, `:476`; take whatever `main` holds and add one, in all four together (if an earlier
   slice made it one constant, change the constant). Tests that build a bundle by hand use the new
   number; a test that pins "an older version is refused" keeps its assertion with the old number.

## Files

**Modify**
- `packages/db/src/schema/printers.ts`; `packages/db/src/index.ts:162` (drop `printTicketScope`),
  `:189` (drop `printerHolders`); `packages/db/src/schema/index.ts:42`;
  `packages/db/src/classification.ts:112`; `packages/db/src/configuration-transfer.ts:40-41`,
  `:95-100`, `:110-124`.
- `packages/layouts/src/device-equipment.ts:8`, `:202-205`, `:392-406`, `:452`, `:467-484`,
  `:580-587`, `:607-617`.
- `packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:473`, `:476` (decision 6).
- `packages/printing/src/printers.ts:40`, `:81`, `:102`, `:117`, `:176-182` (map flags ↔ array).
- `apps/server/src/device-equipment.ts:4`, `:93-94`, `:360-392` (the pickup branch reads the two
  flags and builds the same ordered array).
- `apps/server/src/print-api.ts:1109`, `:1196` (unchanged wire; `requirePickupRoles` at `:1700-1705`
  stays).
- `apps/server/src/device-delete.ts:17`, `:95-99`; `apps/server/src/printer-delete.ts:14`, `:55-59`,
  `:180`.
- `apps/dashboard/src/api/live-queries.ts:104`, `:117`, `:132` (drop `printer_holders`).
- `apps/server/src/testing/clear-provision-fixture.ts` (if it lists `printer_holders`).
- `docs/backlog/architecture.md:1301-1303` (the `ticket_scope` entry, deleted).
- `scripts/schema-constraints.test.ts:258-259` (replace with `["printers", ["held_by_device_id"], "devices"]`).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`printer_holders` to
  `REMOVED_TABLES`; the `printers` column edits beside the existing ones at `:140-260`).
- Tests that write holders or the pickup column directly (11 files with `printerHolders`, the raw
  `pickupRoles` inserts among the 17 files naming it): set-up only.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/db/src/schema/printers.checks.test.ts`.
**Delete:** `packages/db/src/schema/printer-holders.ts` and `printer-holders.test.ts`.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 35, layouts holder statements 55, printing flag mapping 25, server equipment 20, delete flows 15, export check and version 25, lists 10 | ~185 |
| Tests: checks test 120, holder set-up re-pointed in 11 files 90, pickup set-up re-pointed 50, guard lists 10 | ~270 |
| **Total** | **~455** |

Not counted: generated files; the two deleted files. About 2 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/printers.checks.test.ts src/classification.test.ts
pnpm --filter @waitron/layouts exec vitest run src/device-equipment.db.test.ts src/device-printers.db.test.ts
pnpm --filter @waitron/printing exec vitest run
pnpm --filter @waitron/server exec vitest run src/device-equipment.test.ts src/device-equipment-api.test.ts src/device-delete.db.test.ts src/printer-delete.db.test.ts src/print-api.test.ts src/print-api.printer-wiring.test.ts src/receipt-print.test.ts src/configuration-transfer.test.ts src/management-api.device-profiles.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/printers-screen.test.ts
pnpm --filter @waitron/db --filter @waitron/layouts --filter @waitron/printing --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts
git grep -n "printerHolders\|printer_holders\|pickupRoles: printers\|ticketScope\|printTicketScope\|ticket_scope" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts' ':!apps/server/src/working-order.ts'
```

The grep prints nothing (`working-order.ts`'s `ticketScope` is an unrelated local name,
`:2613-2841`).

## Expected protection-list difference

Under all six headers:

```text
missing index printer_holders.primary key(printer_id)
missing table printer_holders
missing table printers.checks[printers_ticket_scope_ck]
missing table printers.columns[pickup_roles]
missing table printers.columns[ticket_scope]
changed table printers.columnOrder
extra table printers.checks[printers_deleted_ck]
extra table printers.checks[printers_held_pair_ck]
extra table printers.checks[printers_held_portable_ck]
extra table printers.columns[held_at]
extra table printers.columns[held_by_device_id]
extra table printers.columns[picks_up_payment_slips]
extra table printers.columns[picks_up_receipts]
extra table printers.foreignKeys[held_by_device_id->devices(id)]
```

Under the two `change-feed` headers, also:

```text
missing trigger waitron_change_printer_holders_delete
missing trigger waitron_change_printer_holders_insert
missing trigger waitron_change_printer_holders_update
changed trigger waitron_change_printers_update.when
```

Reasons (`tables-devices.md` §5): "printer_holders: PK `printer_id` (one holder) — holds by
construction (one column); new CHECKs pair it with `held_at` and `portable`"; "FKs cascade with
printer and with device — the printer side is moot (same row); the device side becomes ON DELETE
SET NULL", overruled by decision 1 (no delete action: a holding device cannot be removed); `printers_ticket_scope_ck` is "dropped with the unused column"; `printers_deleted_ck` is
new (§1.6). `pickup_roles` had no CHECK of its own to carry (its shape was checked only on import).

## Stop points (beyond rules §5)

1. A test asserts behaviour that depends on the stored order of `pickup_roles` (for example the
   refusal field `apps/server/src/device-equipment.ts:372` picks from `pickupRoles[0]`). After this
   slice the first role is always `receipt` when both are set. If a case stored
   `["payment_slip","receipt"]` and asserts the payment-slip field, behaviour moves: stop.
2. drizzle-kit refuses the `printers` ↔ `devices` key cycle.
3. A holder case passes only with a different holder outcome (the statement mapping in decision 3
   changed what wins a race).

## Needs

dv1 (it regenerated core's starting migration last; nothing else).

## In-flight work folded in (rules §8)

- **A405 PRs 3–4** (lane B, schema-free, `docs/superpowers/plans/2026-11-05-a405-printer-details.md:313-344`):
  they change `printers-screen.ts` and the resend route, not these columns. If either is open when
  this starts, it rebases after; nothing to fold.
- **D1, PR #2594** (landed 2026-11-08, `5f11ab6405`): added `print_jobs_printer_kind_idx`; not this table.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the new columns and CHECKs

- [ ] **Step 1: failing test** `printers.checks.test.ts` (`useVenueDb` core, a seeded device, raw
  inserts): "a held printer names its device and the time, both or neither" (`held_by_device_id`
  without `held_at` and the reverse raise `printers_held_pair_ck`); "only a portable printer can be
  held" (`portable = 0` with a holder raises `printers_held_portable_ck`; `portable = 1` stores);
  "a deleted printer is off" (`deleted_at` with `active = 1` raises `printers_deleted_ck`); "pickup
  defaults to both" (a printer inserted with neither flag reads both true); "a raw device delete is
  refused while it holds a printer" (foreign-key error; control: after the holder is cleared the
  same delete succeeds).
- [ ] **Step 2:** run: FAIL. Edit the schema (decisions 2, the CHECKs, the flags, drop
  `ticket_scope`); rebuild core; run: PASS. Commit.

### Task 2: the holder moves onto the row

- [ ] **Step 1:** re-point every test's holder set-up and raw reads from `printer_holders` to the
  two columns (assertions unchanged; a read helper `heldBy(tx, printerId)` in
  `packages/db/src/testing/` is allowed if four or more files need it, with its `exports` entry in
  `packages/db/package.json`). Run the layouts and server equipment suites: FAIL.
- [ ] **Step 2:** apply decision 3 and decision 4 in `device-equipment.ts`; re-point
  `apps/server/src/device-equipment.ts:93-94`, `device-delete.ts:95-99`, `printer-delete.ts:55-59`;
  delete `printer-delete.ts:180` (deleting a printer clears its own holder in the update at `:182`,
  which also sets `held_by_device_id` and `held_at` to null). Delete the schema file and its list
  entries. Rebuild core.
- [ ] **Step 3:** run every suite in the finish line that names holders: PASS. Commit (cite README
  §5 U1 only if a table moves set; none does here).

### Task 3: pickup roles as two flags

- [ ] **Step 1:** re-point raw test inserts of `pickupRoles` to the flags. Run
  `@waitron/printing` and the server pickup cases in `device-equipment-api.test.ts`: FAIL.
- [ ] **Step 2:** map in `packages/printing/src/printers.ts`: a write takes the array and sets each
  flag by membership; a read returns `[...(receipts ? ["receipt"] : []), ...(slips ?
  ["payment_slip"] : [])]`. `apps/server/src/device-equipment.ts:360-392` reads the flags and builds
  the same array. Decision 5 for the export. Run: PASS (stop 1 if not). Commit.

### Task 4: lists, protection list, finish

- [ ] **Step 1:** live queries, schema-constraints, the demo-seed baseline test, the clear fixture.
  Run the full finish line.
- [ ] **Step 2:** protection list after; `compare`; mark each line in the pull request.
- [ ] **Step 3:** backlog: delete "Drop `printers.ticket_scope` at the next reset — OPEN (3d, W20)"
  from `docs/backlog/architecture.md`'s "What A1308 retires" (`:1301-1303`); the column is gone. No
  other entry names `printer_holders` or `pickup_roles` (`grep -rn "printer_holders\|pickup_roles"
  docs/backlog*`; if one does, it is finished here too). `docs/developers/conventions-data.md`:
  nothing. Commit; `/finish-branch`; reset dev slots and Santet after landing.
