# A1308 orders and sales, PR 8: a sale's receipt facts are columns of the sale — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **OWNER LANDS THIS PULL REQUEST** (rules §6: it changes `sales`). It holds nothing that does not
> change `sales` or its two ledger neighbours, so the lane can land other PRs while it waits.

**Goal:** Fold `sale_receipt_guests` and `sale_receipt_headers` into `sales` as four columns fixed when
the sale is written, in `recordSale`'s one insert; give `sales`, `sale_voids` and `unpaid_departures`
their person keys; drop "tenant" from `sales`' issue-time index.

**Architecture:** `RecordSaleInput` (`packages/core/src/record-sale.ts:62-102`) gains an optional
`receipt`; `recordSale` writes it through `insertSale` (`packages/core/src/insert-sale.ts:18`). The
five sale paths compute the receipt facts **before** `recordSale` instead of writing two rows after it.
The fiscal backend's input (`SaleForFiscalRecord`, `packages/fiscal/src/backend.ts:487`) does not
change, and nothing in `fiscal-verifactu` reads these columns.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.13, §1.24
(`voided_by` key), §4 (`sale_receipt_guests`, `sale_receipt_headers` → merge into sales), §5 (sales);
README §5 U9 ("index names … drop the word"), U11. Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." Second line: "Owner lands: changes `sales`."

---

## What it builds

1. `sales` gains `receipt_guest_count` (integer, null), `receipt_department_id` (null, key to
   `departments`), `receipt_trading_name` (text, null), `receipt_prints_trading_name` (flag, null);
   CHECKs `sales_receipt_guest_count_ck` (null, or a whole number 1–999, today's
   `sale_receipt_guests_guest_count_ck`) and `sales_receipt_header_ck`
   (`(receipt_trading_name is null) = (receipt_prints_trading_name is null) and (receipt_department_id is
   null or receipt_trading_name is not null)`), and `sales_receipt_guest_count_recorded_ck`
   (`receipt_guest_count is null or receipt_trading_name is not null`): `readPrintedGuests` reads the
   count only when the trading name is set (Global Constraints), so a count without one would be stored
   and never printed.
2. `RecordSaleInput.receipt?: SaleReceiptFacts`, written in the insert.
3. Person keys: `sales.authorized_by`, `sales.operator_id` (`packages/db/src/schema/sales.ts:110-113`),
   `sale_voids.voided_by` (`sale-voids.ts:19-20`), `unpaid_departures.recorded_by` and `.authorized_by`
   (`unpaid-departures.ts:25-26`) → `persons`.
4. `sales_tenant_issued_idx` renamed `sales_issued_idx` (`sales.ts:122`).
5. The two side tables deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| `sales.fiscal_*`, `invoice_series`, the void's fiscal path | fiscal (owner lands) |
| `tenders` and `sale_settlements` | unchanged; `tenders` person columns (none today) |
| `receipt_reprints`, `invoice_pdf_downloads` | os9 |

## Files

- Modify: `packages/db/src/schema/sales.ts` (four columns, two CHECKs, three keys, index rename),
  `sale-voids.ts`, `unpaid-departures.ts`
- Delete: `packages/db/src/schema/sale-receipt-guests.ts` and `.test.ts` (cases move to
  `packages/db/src/schema/sales.test.ts`); the `saleReceiptHeaders` block of
  `packages/db/src/schema/venue-service/service.ts:137-157`
- Modify: `packages/db/src/index.ts`, `packages/db/src/classification.ts:26, :334`,
  `packages/venue-service/src/classification.ts:16`, `packages/venue-service/src/backup-verification.ts:10`,
  `packages/migrations/migrations.manifest.json:14, :30`
- Modify: `packages/core/src/record-sale.ts:62-102` (input type) and the call into `insertSale`;
  `packages/core/src/insert-sale.ts`
- Modify: `packages/venue-service/src/operations.ts:581-605` (`recordSaleReceiptHeader` becomes
  `saleReceiptHeader(tx, zoneId): Promise<SaleReceiptHeader>`, a read; `readSaleReceiptHeader` reads
  `sales`); `packages/venue-service/src/department-receipts.ts:300-311`; `packages/venue-service/src/service.ts:89-90, :199-200`;
  `packages/module/src/module.ts:876, :916`
- Modify: `apps/server/src/receipt-guests.ts:27-73` (`recordSaleReceiptFacts` → `saleReceiptFacts`;
  `readPrintedGuests`)
- Modify (the five sale paths): `apps/server/src/till-sale.ts:999-1029, :1651-1671, :1818-1836`,
  `apps/server/src/bill-payments.ts:739-754`, `apps/server/src/working-order.ts:7312-7327`
- Modify (tests): `packages/core/src/record-sale.test.ts`; `packages/db/src/schema/sales.test.ts`;
  the 10 test files naming `saleReceiptGuests` and the 11 naming `saleReceiptHeaders`
  (`git grep -l`), including `packages/venue-service/src/sale-receipt-headers.test.ts`,
  `backup-verification.test.ts`, `classification.test.ts`, `packages/db/src/classification.test.ts`;
  `scripts/append-only-triggers.test.ts:71-72`; `scripts/schema-constraints.test.ts`;
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:22` (drop the `RENAMED_COLUMNS` entry;
  `REMOVED_TABLES` gains both tables; push the four `sales` columns);
  `apps/server/scripts/demo-seed/testing/madrid-renamed-columns.test.ts` (11 lines name
  `sale_receipt_guests` as its example: re-point the example at another captured table)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 40, core 25, venue-service 40, server 60 | deleted schema (50) and test file; generated files |
| Tests | new CHECK and key cases 90, re-pointed reads 180 | — |

About 450 counted lines; about 2.5 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/sales.test.ts src/classification.test.ts --reporter=dot
pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts --reporter=dot
pnpm --filter @waitron/venue-service exec vitest run src/sale-receipt-headers.test.ts src/department-receipts.test.ts src/backup-verification.test.ts src/classification.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/receipt-guests.routes.test.ts src/receipt-language.test.ts src/till-api.receipt.test.ts src/bill-payments-api.test.ts src/sale-operation-description.integration.test.ts src/service-delete.integration.test.ts src/till-sale.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run scripts/demo-seed --reporter=dot
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts --reporter=dot
```

The fiscal pair runs unedited and passes.

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `sale_receipt_guests` | `missing table sale_receipt_guests`; `missing index sale_receipt_guests.primary key(sale_id)` | all |
| `sale_receipt_headers` | `missing table sale_receipt_headers`; `missing index sale_receipt_headers.primary key(sale_id)` | all |
| both | `missing trigger <t>_append_only_update`, `<t>_append_only_delete` | migrated, change-feed |
| both | `missing trigger waitron_change_<t>_insert`, `_update`, `_delete` | change-feed |
| `sales` | `extra table sales.columns[receipt_guest_count]`, `[receipt_department_id]`, `[receipt_trading_name]`, `[receipt_prints_trading_name]`; `changed table sales.columnOrder` | all |
| `sales` | `extra table sales.checks[sales_receipt_guest_count_ck]`, `[sales_receipt_header_ck]`, `[sales_receipt_guest_count_recorded_ck]` | all |
| `sales` | `extra table sales.foreignKeys[receipt_department_id->departments(id)]`, `[authorized_by->persons(id)]`, `[operator_id->persons(id)]` | all |
| `sales` | `missing index sales_tenant_issued_idx`; `extra index sales_issued_idx` | all |
| `sales` | `changed trigger waitron_change_sales_update.when` | change-feed |
| `sale_voids` | `extra table sale_voids.foreignKeys[voided_by->persons(id)]` | all |
| `unpaid_departures` | `extra table unpaid_departures.foreignKeys[recorded_by->persons(id)]`, `[authorized_by->persons(id)]` | all |

Where the protections went (§5): the guest-count CHECK moves; the department key moves; both tables'
append-only triggers are inherited from `sales`' (`sales_append_only_update`, `_delete`, unchanged).
`sales_recipient_identity_insert`, `sales_series_invoice_number_key` and `sales_working_order_id_key`
are untouched. Dropped with a reason: venue-service's backup check naming `sale_receipt_headers` as
immutable (`backup-verification.ts:10`): `sales` is checked as immutable by core's own policy.

## Stop points (beyond rules §5)

- A sale path writes `sales.operator_id`, `authorized_by`, `sale_voids.voided_by` or
  `unpaid_departures.*_by` with an id that is not a person (the readiness runner,
  `packages/provisioning/src/fiscal-readiness-runner.ts:112`, and the demo seed, `apps/server/scripts/demo-seed/seed-sales.ts:300`,
  are the likely places). Fixtures create the person; a product writer that cannot is a stop.
- Any file under `packages/fiscal*` or `packages/core/src` other than `record-sale.ts` and
  `insert-sale.ts` needs a change.

## Needs

- **In this area:** os3 (`saleReceiptFacts` reads the bill's zone from the bill).
- **Outside:** none beyond batch 1.

---

## Global Constraints

- Rules §1–§9. The printed receipt is unchanged: the guest line, the trading name and the department's
  header come out exactly as today.
- **When the facts are recorded:** a sale written through one of the five sale paths always has
  `receipt_trading_name` set (today's header is written with `""` when the zone has no policy,
  `operations.ts:586-591`); a sale written by any other path (substitution, correction, readiness, demo
  seed) has all four null, as it has no side rows today.
- A full invoice stores no guest count (`receipt-guests.ts:44`).

## Review Focus

1. **A simplified sale whose guest choice was "no line"** prints no guest line, while **a sale with no
   recorded facts** prints the live default (`receipt-guests.ts:56-73`). With one column the two are told
   apart by `receipt_trading_name` (null = not recorded). Test: Task 2's two cases.
2. **A full invoice** keeps reading the live default for its guest line. Test: Task 2.
3. **A party over 999 guests** stores no guest line (`storableDefault`, `:50-53`). Test: existing case,
   re-pointed.
4. **A zone with no sale policy** stores `""` and `false`. Test: existing `sale-receipt-headers` case,
   re-pointed.
5. **A sale replayed** (the same request twice) writes nothing new: the facts are part of the one
   insert, so a refused duplicate writes no orphan side row. Test: existing replay case in
   `till-sale.test.ts`, re-pointed.

---

### Task 1: The columns and keys

**Files:** `packages/db/src/schema/sales.ts`, `sale-voids.ts`, `unpaid-departures.ts`;
`packages/db/src/schema/sales.test.ts`.

- [ ] **Step 1: Write the failing tests:** `"refuses a receipt guest count of 0, 1000 or 2.5"`;
  `"refuses a trading name without its print flag, or a department without a trading name"`;
  `"refuses a guest count without a trading name"` (`sales_receipt_guest_count_recorded_ck`);
  `"refuses a receipt department, operator or authoriser that does not exist"`; controls: a sale with all
  four facts, and one with none. In the sale-void and unpaid-departure schema tests: `"refuses a voider /
  recorder / authoriser who is not a person"` with controls.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement**; rename the index; rebuild core.
- [ ] **Step 4: Run; PASS. Commit** `feat(db): a sale's receipt facts and people are columns of the sale`.

### Task 2: Written in `recordSale`'s insert

**Interfaces:**
- `SaleReceiptFacts = { guestCount: number | null; departmentId: string | null; tradingName: string;
  printsTradingName: boolean }` in `packages/core/src/record-sale.ts`; `RecordSaleInput.receipt?:
  SaleReceiptFacts`.
- `saleReceiptFacts(tx, workingOrderId: string, counterparty: RecordSaleInput["counterparty"],
  guestCount: GuestCountChoice): Promise<SaleReceiptFacts>` in `apps/server/src/receipt-guests.ts`,
  replacing `recordSaleReceiptFacts`; a full invoice gets `guestCount: null`.
- `VENUE_SERVICE.saleReceiptHeader(tx, zoneId: string | null): Promise<{ departmentId; tradingName;
  printsTradingName }>` replaces `recordSaleReceiptHeader`; `readSaleReceiptHeader(tx, saleId)` keeps its
  name and result, reading `sales`.

- [ ] **Step 1: Re-point and add tests.** In `record-sale.test.ts`: `"writes the receipt facts in the
  sale's own row"`. In `receipt-guests.routes.test.ts` (re-pointed): `"a simplified sale stored with no
  guest line prints none"` and `"a sale with no recorded receipt facts prints the live default"`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Each of the five sale paths calls `saleReceiptFacts` before `recordSale`
  and passes `receipt`; delete the five `recordSaleReceiptFacts` calls. `readPrintedGuests` reads
  `sales.receipt_guest_count` when `counterparty_tax_id is null and receipt_trading_name is not null`,
  otherwise `readReceiptGuests`. `receiptDepartmentForSale` reads `sales.receipt_department_id`.
- [ ] **Step 4: Run** the Finish line's core, venue-service and server commands; PASS.
- [ ] **Step 5: Commit** `refactor(core): write a sale's receipt facts with the sale`.

### Task 3: Delete; registries; finish

- [ ] **Step 1:** Delete the two tables' schema, exports, classification entries (core and
  venue-service), manifest names and the backup-verification name; update
  `scripts/append-only-triggers.test.ts` (`EXPECTED` loses both), `scripts/schema-constraints.test.ts`,
  the classification and backup tests, the Madrid lists and `madrid-renamed-columns.test.ts`'s example.
- [ ] **Step 2:** Rebuild core; Finish line (the fiscal pair unedited); protection list.
- [ ] **Step 3:** Grep `docs/developers/` for the two table names; reword each sentence.
- [ ] **Step 4: Commit**, `/finish-branch`, PR (first two lines as above). The owner lands it.
