# A1308 venue and box, PR vb4: a department's sale rules and transfer desk are columns of the department — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). Implementers are
> dispatched as `subagent_type: "implementer"`.

**Goal:** `department_sale_policies` and `department_transfer_desks` fold into `departments`: how a
department's orders start and are paid, its collection numbers, its receipt printing and trading
name, and the device profile that receives its transfers become columns of the department row.

**Architecture:** Six columns and four CHECKs on `departments`; every reader drops its join, every
writer updates the department row. The receiving profile becomes a nullable key to
`device_profiles` with `on delete set null` (today the desk row is deleted with the profile, so a
department loses its desk either way). Configuration export carries the columns with the department.

**Tech Stack:** Drizzle on `node:sqlite`, Hono routes (unchanged wire), Vitest.

**Spec:** [tables-venuebox.md](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.10 (the
`order_start` … `print_trading_name` and `transfer_desk_profile_id` rows), §5 (the
`department_sale_policies` rows), §6.6; [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§4 (`department_transfer_desks` → a departments column, R4). [os2](2026-11-08-a1308-os2-bill-identity.md) :56
and [os3](2026-11-08-a1308-os3-service-context.md) :48 leave this column to this area.

**Lands:** the lane (rules §6).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

## What it builds

1. `departments` (`packages/db/src/schema/venue-service/service.ts:25-54`) gains, from
   `department_sale_policies` (`:92-113`), with today's types and enum types (`:87-90`, shared with
   `zone_sale_policies`):
   `order_start` (not null, default `'counter'`), `paid_when` (not null, default `'prepay'`),
   `collection_number` (not null, default `'none'`), `receipt_print_mode` (not null, default
   `'auto'`), `print_trading_name` (flag, not null, default `true`, as today's column); and
   `transfer_desk_profile_id` (nullable, foreign key `departments_transfer_desk_profile_fk` →
   `device_profiles.id`, `on delete set null`). CHECKs `departments_order_start_ck`,
   `departments_paid_when_ck`, `departments_collection_number_ck`, `departments_receipt_mode_ck`,
   each the same `enumCheck` the side table used.
   **`print_trading_name` keeps today's default, `true`** (plan review, 2026-11-08): `createDepartment`
   (`:190-192`), setup's default department (`provisioning.ts:72-75`), the demo seed's deli department
   (`apps/server/scripts/demo-seed/seed-floor.ts:71`), `department-receipts.test.ts:609-614` (which
   asserts `printTradingName: true`) and the Madrid capture's recorded default all rely on it; the
   editor's create path writes `false` explicitly (`operations.ts:728-735`) and keeps doing so. What
   goes is the read fallback for a department with no policy row (`false`,
   `readDepartmentReceiptPolicy`, `department-receipts.ts:331-348`): every department now has the
   column, so a fixture that inserts a bare department reads `true` there (stop point 2).
2. Readers read the columns: `listServiceZones` (`operations.ts:110-118`), `resolveZoneContext`
   (`:499-506`), `resolveSalePolicy` (`:551-564`: the inner join goes, and the query gains
   `departments.active = 1` — today the missing policy row of a retired department is one way it
   answers `service_zone.not_found`; after the fold the values stay on an inactive department, so the
   active check takes that place), `listSalePolicies` (`:622`),
   `readDepartmentReceiptPolicy` (`department-receipts.ts:331-348`), `service-delete-settings.ts:177-180`
   and `:185-189`, `department-transfers.ts:42-61, :194, :308, :443-450`.
3. Writers update the department row: `createDepartment` (`operations.ts:190-192`: the values go on
   the department insert), `updateDepartment` (`:237-239`), `setDepartmentSalePolicyField`
   (`:667-670`), `saveDepartmentEditSettings` (`:728-735`: an update of three columns),
   `saveDepartmentReceiptSettings` (`department-receipts.ts:350-369`), setup's default department
   (`provisioning.ts:72-75`), `setDepartmentTransferSettings` (`department-transfers.ts:133-139`:
   one update of `transfer_desk_profile_id`, null to clear). The service-end deletes of the two side
   tables (`service-delete-settings.ts:411-413, :416-417`) become an update setting
   `transfer_desk_profile_id = null`; the policy values stay on the inactive department, as the
   department row itself stays (`:428-435`).
4. Configuration transfer (`packages/venue-service/src/configuration-transfer.ts`): the two tables
   leave the list (`:702`, `:710`); `validateReceiptModes` (`:580-589`) and `validateOrderStarts`
   (`:630-638`) read the department rows; `validateServicePolicyCompleteness` (`:591-600`) loses its
   `departments`/`department_sale_policies` tuple (the zone tuples are the floor slice's, fk1);
   `validateDepartmentTransfers` (`:432-441`) checks `departments.transfer_desk_profile_id` names a
   profile in the bundle. The bundle's format version goes up by one from `main`'s (rules §9).
5. Live updates: `department-transfer-api.ts:131` wakes on `departments`; the dashboard dependency
   lists drop the two names (`apps/dashboard/src/api/live-queries.ts:64, :72, :504`;
   `packages/venue-service/src/dashboard/live-queries.ts:34, :42, :246`;
   `apps/dashboard/src/screens/department-receipt-editor.ts:267`) — each already lists
   `departments`, or gains it.
6. Lists: classification (`packages/db/src/classification.ts:327, :330`;
   `packages/venue-service/src/classification.ts:9, :12`), exports (`packages/db/src/index.ts:445`,
   `packages/venue-service/src/index.ts:12`), `apps/server/src/testing/clear-provision-fixture.ts:18`,
   the demo seed (`apps/server/scripts/demo-seed/seed-floor.ts:55-57, :71`), the Madrid capture.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `department_receipts` | vb5 |
| `operation_description` as a column | vb6 (owner) |
| `zone_sale_policies` → `floor_zones` | floor slice [fk1](2026-11-08-a1308-fk1-zone-service-rules.md) |
| `department_transfer_destinations`, `department_transfer_requests` | stay tables (README §4); orders area |

## Files

Modify: `packages/db/src/schema/venue-service/service.ts`, `department-transfers.ts` (the desk table
goes; destinations stay); `packages/venue-service/src/operations.ts`, `department-receipts.ts`,
`department-transfers.ts`, `provisioning.ts`, `service-delete-settings.ts`, `configuration-transfer.ts`,
`classification.ts`, `index.ts`, `dashboard/live-queries.ts`; `packages/db/src/classification.ts`,
`index.ts`; `apps/server/src/department-transfer-api.ts`; `apps/dashboard/src/api/live-queries.ts`,
`screens/department-receipt-editor.ts`; `apps/server/src/testing/clear-provision-fixture.ts`;
`apps/server/scripts/demo-seed/seed-floor.ts`; the configuration bundle's version constant (where
`version: 10` is built, `packages/provisioning/src/configuration-transfer.ts:123` and its type at `:160`, and the import's version check).

Tests: the 10 inserts into `departmentSalePolicies` in 9 files and the one into
`departmentTransferDesks` (`git grep -n "insert(departmentSalePolicies)\|insert(departmentTransferDesks)" -- '*.test.ts' '**/testing/**' '**/test/**'`)
become an update of the department, by hand; raw SQL naming the two tables likewise
(`git grep -n "department_sale_policies\|department_transfer_desks" -- '*.test.ts'`).

Guards: `scripts/schema-constraints.test.ts` (foreign keys, CHECK names; `:79` names
`department_sale_policies`), `packages/db/src/schema/venue-service/migrations.test.ts`,
`scripts/id-columns-are-references.test.ts` if it lists either table,
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.

Madrid: fold with `madridWithFoldedTables` ([fk1](2026-11-08-a1308-fk1-zone-service-rules.md) Task
6): `{ from: "department_sale_policies", into: "departments", match: { from: "department_id", into: "id" }, columns: { order_start: "order_start", paid_when: "paid_when", collection_number: "collection_number", receipt_print_mode: "receipt_print_mode", print_trading_name: "print_trading_name" } }`
and `{ from: "department_transfer_desks", into: "departments", match: { from: "department_id", into: "id" }, columns: { receiving_profile_id: "transfer_desk_profile_id" } }`.
If fk1 has not landed, build `madridWithFoldedTables` exactly as fk1's Task 6 specifies (same file,
same interface), so whichever lands second reuses it.

Docs: `docs/developers/conventions-data.md` "Department and zone service settings" (`:4942-4964`
names `department_sale_policies.order_start`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Code | Tests |
| --- | --- | --- |
| Schema, lists, exports | ~50 | — |
| Readers and writers | ~150 | ~80 (fixtures re-pointed) |
| Configuration transfer and format bump | ~40 | ~60 (re-pointed bundle rows) |
| New rule cases | — | ~70 |
| Madrid (helper reused) | ~20 | — |
| **Total** | **~260** | **~210** |

About 470 counted lines; 2–3 hours.

## Finish line

1. `pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/department-receipts.test.ts src/department-transfers.test.ts src/service-delete-settings.test.ts src/configuration-transfer.test.ts src/routes.test.ts src/provisioning.test.ts src/schema/service.test.ts src/dashboard/live-queries.test.ts`
2. `pnpm --filter @waitron/server exec vitest run src/department-transfer-api.test.ts src/department-receipt-settings-api.test.ts src/till-api.service-periods.test.ts src/receipt-print.test.ts src/configuration-transfer.test.ts src/configuration-import.test.ts src/service-delete.history.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts scripts/demo-seed/seed.test.ts`
3. `pnpm --filter @waitron/db exec vitest run src/schema/venue-service/migrations.test.ts`;
   `pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/screens/department-receipt-editor.test.ts`
4. Root: `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/id-columns-are-references.test.ts scripts/starting-migrations.test.ts`
5. `git grep -n "departmentSalePolicies\|department_sale_policies\|departmentTransferDesks\|department_transfer_desks" -- apps packages scripts ':!**/drizzle/**' ':!**/test-fixtures/**'`
   prints only the Madrid fold and `configuration-v1-*.json`.
6. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `venue` headers:

```text
missing index department_sale_policies.primary key(department_id)
missing index department_transfer_desks.primary key(department_id)
missing table department_sale_policies
missing table department_transfer_desks
changed table departments.columnOrder
extra table departments.columns[order_start]
extra table departments.columns[paid_when]
extra table departments.columns[collection_number]
extra table departments.columns[receipt_print_mode]
extra table departments.columns[print_trading_name]
extra table departments.columns[transfer_desk_profile_id]
extra table departments.foreignKeys[transfer_desk_profile_id->device_profiles(id)]
extra table departments.checks[departments_collection_number_ck]
extra table departments.checks[departments_order_start_ck]
extra table departments.checks[departments_paid_when_ck]
extra table departments.checks[departments_receipt_mode_ck]
```

Under the two `change-feed` headers also:

```text
missing trigger waitron_change_department_sale_policies_delete
missing trigger waitron_change_department_sale_policies_insert
missing trigger waitron_change_department_sale_policies_update
missing trigger waitron_change_department_transfer_desks_delete
missing trigger waitron_change_department_transfer_desks_insert
missing trigger waitron_change_department_transfer_desks_update
changed trigger waitron_change_departments_update.when
```

Why: appendix §1.10 and §5 ("CHECKs on `departments`; FK unnecessary (same row)"); the side tables'
own keys to `departments` go with them, so no separate line. Made by simulation on `a086eedfb7`'s
built change-feed `venue.db` (two tables and their triggers dropped, the six columns, four CHECKs and
the key written into `departments`' stored text): every line above except the last, which the
simulation did not rewrite (the update trigger compares every column, as vb2's simulation showed for
`taxpayer`). Slice 5a changes `departments`' indexes first; they print nothing here.

## Stop points (beyond rules §5)

1. A test now resolves a zone where it expected `service_zone.not_found` because its department
   had no policy row (`resolveSalePolicy`'s inner join is gone): behaviour moved (rules §5.3). No
   product writer leaves a department without policy values today (item 3's writers each write
   one; the import refuses a bundle without, `:591-600`), so such a test is a fixture state; ask.
2. A test reads `print_trading_name` for a department it inserted bare (no policy row) and expects
   `false` — the read fallback is gone and the column says `true`: rules §5.3, ask.
3. fk1 is in flight when this starts and both change `validateServicePolicyCompleteness`: wait for
   it (rules §7). Whichever of fk1 and this PR lands second uses the other's names (`floor_zones`'
   policy columns, `seedZone`, `madridWithFoldedTables`, `scripts/a1308/lib/fold-inserts.mjs`); a
   shape that disagrees with this plan (for example fk1 naming the shared enum types differently) is
   a stop.

## Needs

vb1. Outside: 5a (`departments` loses `location_id`). fk1 before or after, not in flight at the same
time (stop point 3).

---

## Task 1: The columns, the rules and their tests

**Files:** `packages/db/src/schema/venue-service/service.ts`, `department-transfers.ts`;
`packages/venue-service/src/schema/service.test.ts` (or `packages/db/src/schema/venue-service/migrations.test.ts`
where the side table's CHECK cases live today).

- [ ] **Step 1:** `pnpm protection-list list --out <A>` from `apps/server`.
- [ ] **Step 2: Write the failing tests:** "refuses a department whose order start is not table or
  counter" (and one each for `paid_when`, `collection_number`, `receipt_print_mode`, asserting the
  CHECK's name in the error); "accepts each allowed value"; "a new department reads counter,
  prepay, none, auto and prints its trading name"; "a zone of an inactive department resolves no
  sale policy" (`resolveSalePolicy` answers `service_zone.not_found`); "deleting the receiving profile clears the department's
  transfer desk and keeps the department" (`on delete set null`); "refuses a transfer desk naming no
  profile".
- [ ] **Step 3: Run** them — FAIL.
- [ ] **Step 4: Implement** item 1; rebuild core.
- [ ] **Step 5: Run** — PASS. **Commit** `git commit -s -m "departments: sale rules and the transfer desk become columns"`.

## Task 2: Readers, writers, transfer and lists

**Files:** the rest under Files.

- [ ] **Step 1:** Re-point the fixtures (hand edits); run Finish-line items 1–3 and note every
  failure.
- [ ] **Step 2: Implement** items 2–6. Check that `madridWithFoldedTables` gives an unmatched
  department the column's declared default (`true`), as fk1's Task 6 specifies.
- [ ] **Step 3: Run** Finish-line items 1–5 — PASS. Any assertion that would have to change is
  rules §5.3.
- [ ] **Step 4:** Docs paragraph; `pnpm protection-list list --out <B>`; `compare`; paste and mark.
- [ ] **Step 5: Commit** `git commit -s -m "departments: every reader and writer uses the department row"`.
