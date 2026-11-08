# A1308 orders and sales, PR 1: order numbers read from the bills — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `working_order_counters`: a new bill takes the next order number as one more than the
highest `working_orders.order_number`, under the venue file's write lock, and a new unique index on
`order_number` refuses a repeat. In the same pass, give the station queue's "uncollected bills" read
an index of its own, and drop the word "tenant" from `working_orders`' status index.

**Architecture:** One starting-migration change to core's set (slice rules §2), made through the
rebuild command. `allocateOrderNumber` keeps its name and moves from an upsert on the counter to a
`max()+1` read that the new unique index answers with a seek. No other table changes here.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) (§4 "the next order number …
read from the rows they describe", §5 U6) and [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§1.1, §4 (`working_order_counters` → delete), §5, §6 item 2, §8 M1. **Rules:**
[slice rules](2026-11-08-a1308-slice-rules.md), cited, not repeated.

**Who lands:** the lane. This PR changes no `sales` row, invoice number, fiscal record or hash input
(rules §6): an order number is "not a fiscal series" (`packages/db/src/allocate-order-number.ts:13-16`).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

---

## What it builds

(The A803 §3.1 and §3.9 text, "the line is the dish's identity; moves keep a line's id", is done: the
coordinator made that docs edit on the plans branch on 2026-11-08, before A446's plan. Nothing here.)

1. **Order numbers from the bills.** `working_orders.order_number` gains `UNIQUE`
   (`working_orders_order_number_key`); `allocateOrderNumber(tx)` returns
   `coalesce(max(order_number), 0) + 1`; `working_order_counters` and its schema file are deleted.
   Measure M1 first (Task 1).
2. **The A1370 follow-up index** `working_orders_uncollected_idx`, a partial index for the
   "uncollected, non-abandoned bills" subquery at `apps/server/src/working-order.ts:8270`.
3. **`working_orders_tenant_status_idx` renamed `working_orders_status_idx`** (design U9, "index
   names … drop the word"; each area renames its own).
4. The backlog entries it finishes are deleted (Task 4).

## What it leaves out

| Left out | Owner |
| --- | --- |
| `bill_identities`, `bill_edit_states`, `bill_number_allocations` into `working_orders` | os2 |
| `order_service_contexts` into `working_orders` | os3 |
| `working_orders.location_id` | already gone: batch 1 slice 5 (assumed landed) |
| The transition trigger's column lists | os2 rewrites it; this PR changes no column, so the trigger body is untouched |
| M9/M10 (`service_commands` replay lookup and pruning) | the `housekeeping` job slice, batch 3; no PR here changes `service_commands` |
| "Measure the remaining top-level-dish reads (A1370 follow-up)" | stays in the "Query plans and indexes" bundle: it is a measurement across many reads with a year of data, not an index this table rewrite owns |

## Files

- Modify: `packages/db/src/schema/orders.ts:79-82` (comment and `orderNumber`), `:115` (index rename),
  table callback (two new indexes)
- Modify: `packages/db/src/allocate-order-number.ts` (whole file, 28 lines)
- Delete: `packages/db/src/schema/working-order-counters.ts`
- Modify: `packages/db/src/index.ts` (drop the `workingOrderCounters` export; `allocateOrderNumber`
  export at `:285` stays)
- Modify: `packages/db/src/classification.ts:96-100` (the `working_order_counters` entry)
- Modify: `packages/db/src/backup-evidence.ts:101` (drop `"working_order_counters"` from the immutable list)
- Modify: `apps/server/src/working-order.ts:1711` (`allocateOrderNumber(tx)` without `cfg.nodeId`)
- Modify: `packages/db/src/testing/seed.ts:122-138` (`seedWorkingOrder`'s default number); `packages/bookings/src/testing/fake-core.ts:72`,
  `packages/reporting/test/fixtures.ts:472` (same default)
- Modify (tests): `apps/server/src/order-creation-zone.test.ts:142-149`,
  `apps/server/src/till-api.unroutable-dish.test.ts:404`, `apps/server/src/till-api.zone-required.test.ts:261-266`,
  `apps/server/src/party-table-actions.test.ts:2711, :3118`, `apps/server/src/draft-split.test.ts`
  (2 lines naming `workingOrderCounters`), `scripts/schema-constraints.test.ts:341`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:38` (`REMOVED_TABLES`)
- Modify (test): `packages/db/src/allocate-order-number.test.ts` (exists: `:35`, `:42`, `:50`, `:81`);
  `apps/server/src/working-order.test.ts:160-164` (the `setupVenue` comment)
- Modify (test): `apps/server/src/history-read-plans.test.ts` (one case)
- Generated: `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`,
  `scripts/migration-baseline-epoch.json` via the rebuild command (never by hand)
- Docs: `docs/backlog/architecture.md` (two entries deleted)
- Fixture files that M1 shows repeat a number: listed in the PR description (Task 1 decides)

## Size

| | Counted (hand-written) | Not counted |
| --- | --- | --- |
| Code | about 70 lines | the deleted schema file (20 lines); generated migration files |
| Tests | about 140 lines, plus whatever M1's fixture fixes need (estimate below) | output of the codemod, if Task 1 needs one |
| Docs | about 5 lines (backlog) | — |

Fixture risk: 189 test files write a literal `orderNumber:` (`git grep -c "orderNumber: [0-9]" -- apps packages`
gives 510 lines), 14 of them write `orderNumber: 1` twice or more, and `seedWorkingOrder` (292
calls) defaults to 1 (`packages/db/src/testing/seed.ts:132`). Task 1 changes that default, which
removes most collisions; its measured result decides whether hand fixes stay under about 300 lines or
a codemod is needed. Target total: under 500 counted lines; about 2 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/allocate-order-number.test.ts src/schema/orders.transition.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/history-read-plans.test.ts src/order-creation-zone.test.ts src/till-api.unroutable-dish.test.ts src/till-api.zone-required.test.ts src/party-table-actions.test.ts src/draft-split.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts --reporter=dot
```

Each prints a `Tests` count with no failure (CLAUDE.md §4: a run without a count proves nothing).
Then the protection list (rules §3) prints exactly the lines below.

## Expected protection-list difference

Both compositions (`fiscal-verifactu`, `fiscal-none`); "all phases" means `sql-only`, `migrated`
and `change-feed`, venue database.

| Table | Line | Phases | Reason |
| --- | --- | --- | --- |
| `working_order_counters` | `missing table working_order_counters` | all | deleted (tables-ordersales.md §4; design U6) |
| `working_order_counters` | `missing index working_order_counters.primary key(node_id)` | all | its primary key goes with it |
| `working_order_counters` | `missing trigger waitron_change_working_order_counters_insert`, `…_update`, `…_delete` | change-feed | a classified table's change-feed triggers go with it |
| `working_orders` | `extra index working_orders_order_number_key` | all | the one guard against a repeated number (§1.1 "UNIQUE (new)") |
| `working_orders` | `missing index working_orders_tenant_status_idx`, `extra index working_orders_status_idx` | all | rename (design U9) |
| `working_orders` | `extra index working_orders_uncollected_idx` | all | A1370 follow-up |

No `changed trigger` line: no column is added, so neither `working_orders_enforce_transition` nor
`waitron_change_working_orders_update` changes.

## Stop points (beyond rules §5)

- Task 1's measurement gives a failing result named there.
- A product path inserts a `working_orders` row with a number it did not get from
  `allocateOrderNumber` (Task 1 Step 1 lists them; at HEAD there is one product insert site,
  `apps/server/src/working-order.ts:1713`, plus three test helpers).

## Assertions that change, by design (rules §4)

- `packages/db/src/allocate-order-number.test.ts:42` `"numbers each node independently"` (expects
  `[1, 2, 1]`): numbers are now one series per venue, so it becomes `"a second node continues the venue's
  numbers"` (`[1, 2, 3]`), design §1.1 and §6 item 2. `:35` loses its node argument; `:50` and `:81` keep
  their assertions.
- The comment at `apps/server/src/working-order.test.ts:163` ("`allocateOrderNumber` counts per node, so
  the order number is that test's own — always 1 on the first park") becomes false. Delete that
  sentence; if a case there asserts order number 1 on a shared database, it is a fixture fix under Task 1,
  listed in the PR.
- Any other changed assertion is a stop.

## Needs

- **In this area:** nothing. **Outside:** batch 1 landed (1a's rebuild command; slice 5 removed
  `working_orders.location_id` and `venueLocationId`). A446 (the pre-bill) landed first (build
  order, "Work beside A1308"). A739 landed or not started: it adds `order_payment_contexts` with a
  key to `working_orders` (A739 plan Task 3); this PR does not touch that key.

## Area files for the package move

The CI package move (agreed 2026-11-08, design not written) moves `apps/server`'s domain areas into
their own packages, paired with the A1308 area. These `apps/server/src` files belong to orders and
sales (each with its `*.test.ts`, `*.e2e.test.ts` and `*.<topic>.test.ts` siblings):

- Bills and ordering: `working-order.ts`, `order-drafts.ts`, `draft-recall.ts`, `draft-source.ts`,
  `order-groups.ts` (shared with kitchen: it also prints HOLD tickets), `order-portions.ts`,
  `portion-sale-projection.ts`, `order-preview.ts`, `order-places.ts`, `order-number-slip.ts`,
  `order-state-counts.ts`, `bill-actions.ts`, `bill-allocation.ts`, `bill-editing.ts`,
  `bill-identities.ts`, `bill-lookup-api.ts`, `bill-request.ts`, `bill-unsent.ts`, `move-bill.ts`,
  `line-cancel*.ts`, `line-service-cancel.ts`, `line-service-state.ts`, `department-transfer-api.ts`,
  `find-bill-*.ts`
- Money before the invoice: `bill-payments.ts`, `bill-payments-api.ts`, `bill-payments-loop.ts`
- Sales, receipts and invoices: `till-sale.ts`, `sale-due.ts`, `sale-operation-description.ts`,
  `issuance-pass.ts`, `orders-api.ts`, `orders-list.ts`, `orders-reprint.ts`, `orders-invoice-pdf.ts`,
  `receipt-*.ts`, `invoice-*.ts`, `transaction-receipt*.ts`, `unpaid-departure*.ts`,
  `cancellation-refund-value.ts`
- Refunds (the refunds PRs, os12–os13): `bill-refunds.ts`, `bill-refund-alerts.ts`, `tender-refund*.ts`,
  `tender-refunds.ts`
- Test helpers: `src/testing/bill-identities.ts`, `party-bill-of.ts`, `order-venue.ts`,
  `whole-payment-fixture.ts`, `zone-payment-venue.ts`, `adjustment-venue.ts`

Not this area's: `kitchen*.ts`, `pass-*.ts`, `station-*.ts`, `table-actions.ts`, `parties.ts`
(floor and kitchen); `attendance-*.ts` (people); `print-*.ts` (devices).

**Where the move sits in this sequence:** between os1 and os2. os1 touches few server files; os2 to
os11 rewrite most of the files above, so moving them first means each later PR edits them in their
final package. If A1453 places this area's move later, it goes after os11 and before os12, never in
the middle of os2–os11. The move is not planned here.

---

## Global Constraints

- Rules §1–§9 apply. Generated migration files only through
  `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- An order number stays a plain positive integer (`count` column), never reused once its bill
  exists, typed back in to retrieve the order (`packages/db/src/schema/orders.ts:79-81`). "Never reused"
  holds within the copy of the venue the box holds: after a restore that lost the most recent bills, their
  numbers are given out again, because the next number is read from the bills the copy has. The PR
  description says so; today's per-node counter has the same property, since the counter is in the same
  file.
- No backwards-compatibility code (CLAUDE.md §3, "No backwards-compatibility … until production").

## Review Focus

1. **A promoted or restored box continues the venue's numbers.** Today each node has its own counter
   starting at 1 (`working-order-counters.ts:5`), so a box that took over started again at 1. After
   this PR it continues from the highest number in the copy it holds. The design wants one unique
   number per bill (§1.1); this is the consequence, and the PR description says so in plain words.
   Test: Task 2's "a second node continues the venue's numbers".
2. **A refused order allocates nothing.** Three suites assert today that a refused order left the
   counter unchanged; they now assert that `max(order_number)` is unchanged and no row was added.
3. **Two orders in one transaction** (a split creates bills inside one transaction,
   `working-order.ts:1711` runs per bill): `max()+1` reads the earlier insert of the same
   transaction. Test: Task 2's "two bills in one transaction take consecutive numbers".
4. **The partial index is actually used.** A partial index whose predicate the query does not imply is
   ignored silently. Test: Task 3's query-plan case.
5. **A test fixture that writes a number the database already holds** now fails with a unique error
   rather than passing. Task 1 counts them before any fix.

---

### Task 1: Measure M1 before changing the allocator

**Files:** Modify `packages/db/src/schema/orders.ts`, `packages/db/src/testing/seed.ts`; scratch
script outside the repository (not committed).

The design's M1 (tables-ordersales.md §8): time `max(order_number)+1` at 90,000 and 900,000 bills,
and run the suites with the unique index.

- [ ] **Step 1: List every insert into `working_orders`.** `git grep -n "insert(workingOrders)\|insert into working_orders" -- apps packages ':!*.test.ts'`.
  Expected at HEAD: `apps/server/src/working-order.ts:1713` (product), and the test helpers
  `packages/db/src/testing/seed.ts:129`, `packages/bookings/src/testing/fake-core.ts:72`,
  `packages/reporting/test/fixtures.ts:472`; the demo seed inserts none. Any other product insert is a stop.
  The two package helpers write a literal number: give each the same "next free number" default as
  `seedWorkingOrder` (Step 2).
- [ ] **Step 2: Add the index only.** In `orders.ts`'s table callback:
  `uniqueIndex("working_orders_order_number_key").on(t.orderNumber)`. Change `seedWorkingOrder`'s
  default from `orderNumber: 1` to the next free number, read with the same expression Task 2 uses
  (`select coalesce(max(order_number), 0) + 1 from working_orders`), kept only when `values` names
  no `orderNumber`. Rebuild core's set.
- [ ] **Step 3: Time the read.** In a scratch folder, migrate a venue with `applyMigrations`, insert
  90,000 then 900,000 `working_orders` rows with numbers 1…N, and time 1,000 calls of the read.
  Record median and maximum, and `EXPLAIN QUERY PLAN`. **Passing:** the plan names
  `working_orders_order_number_key` (SQLite's min/max optimisation, shown as a `SEARCH` or
  `USING COVERING INDEX`), and the median is under 0.5 ms at 900,000 on a developer Mac (state the
  machine; design U11 "the bench"). **Failing:** a `SCAN working_orders`. The failing case should
  print `SCAN`; run the same read once with the index dropped as the control and see it print `SCAN`.
- [ ] **Step 4: Run the suites with the index.** `pnpm --filter @waitron/db test` and
  `pnpm --filter @waitron/server exec vitest run --reporter=dot` (measure free memory first;
  CLAUDE.md §2 allows a broad local run to investigate). Record every failure that names
  `working_orders_order_number_key` or `UNIQUE constraint failed: working_orders.order_number`,
  grouped by file.
- [ ] **Step 5: Decide, and write the decision in the PR.**
  - Failures only in test fixtures that write a literal number twice: fix each by dropping the literal
    (the helper allocates) or by giving distinct numbers where an assertion names the number. If more
    than 40 files need it, write `scripts/a1308/os1-order-number-fixtures.mjs`, idempotent, that
    deletes `orderNumber: <literal>` from `seedWorkingOrder(…)` calls whose test file never asserts that
    literal; its output is uncounted (rules §1), and the fixes left after it are listed in the PR.
  - **Failing result that changes the design** (tables-ordersales.md §8 M1): a product path that
    needs a repeated number. Then the counter stays and this PR is reduced to Tasks 3–4. Stop and ask
    the watcher (rules §5.4).
- [ ] **Step 6: Commit** `test(db): M1, order numbers unique and read from the bills`.

### Task 2: Delete the counter

**Files:** `packages/db/src/allocate-order-number.ts`, `packages/db/src/schema/working-order-counters.ts`
(delete), `packages/db/src/schema/orders.ts:79-82`, `packages/db/src/index.ts`,
`packages/db/src/classification.ts:96-100`, `packages/db/src/backup-evidence.ts:101`,
`apps/server/src/working-order.ts:1711`; tests listed under Files.

**Interfaces:** Produces `allocateOrderNumber(tx: Transaction): Promise<number>` (the `nodeId`
parameter goes; the one caller is `working-order.ts:1711`).

- [ ] **Step 1: Write the failing tests** in the existing `packages/db/src/allocate-order-number.test.ts`
  (and change `:42` as "Assertions that change, by design" says):
  - `"the first bill of a venue is number 1"`: `expect(await allocateOrderNumber(tx)).toBe(1)`.
  - `"two bills in one transaction take consecutive numbers"`: allocate, insert a row with it,
    allocate again: `[1, 2]`.
  - `"a second node continues the venue's numbers"`: seed bills 1–3 with `nodeId` A, then allocate in a
    transaction whose bills are written for node B: `4`.
  - `"a number a bill holds is refused a second time"`: inserting two `working_orders` rows with
    `orderNumber: 7` throws `UNIQUE constraint failed: working_orders.order_number`; the accepting
    control inserts 7 and 8.
- [ ] **Step 2: Run them; the first three fail to compile** (the function still takes `nodeId`).
- [ ] **Step 3: Implement.** One `select coalesce(max(order_number), 0) + 1` under the caller's
  transaction; keep the module comment's point that `withTransaction` serialises writers
  (`allocate-order-number.ts:7-11`) and say the unique index is the guard. Replace the comment at
  `orders.ts:79-81` with one line: the number is unique and read from the bills. Delete the schema file,
  its export, its classification entry and its backup-evidence name.
- [ ] **Step 4: Re-point the three "a refused order allocated no number" suites.** Each snapshot of
  `working_order_counters` becomes a snapshot of `select count(*), max(order_number) from working_orders`;
  the assertion stays `toEqual(before)` (rules §4: re-pointed, same assertion). In
  `party-table-actions.test.ts:2711, :3118` drop the table name from the listed-tables arrays; in
  `draft-split.test.ts` replace the counter read the same way.
- [ ] **Step 5: Update the guards.** `scripts/schema-constraints.test.ts:341` loses its
  `working_order_counters` row. `seed.madrid-baseline.test.ts`: add `"working_order_counters"` to
  `REMOVED_TABLES` (its captured count is 0 in every phase, read from
  `packages/country-es/test-fixtures/demo/madrid-before-move.manifest.json:249`).
- [ ] **Step 6: Run** the Finish line's db and server commands; expect PASS with counts.
- [ ] **Step 7: Commit** `feat(db): read the next order number from the bills; delete working_order_counters`.

### Task 3: The uncollected-bills index and the status index's name

**Files:** `packages/db/src/schema/orders.ts:115` and its table callback;
`apps/server/src/history-read-plans.test.ts`.

- [ ] **Step 1: Write the failing test** in `history-read-plans.test.ts`, describe
  `"current service reads with collected history"`: `"finds uncollected, non-abandoned bills through
  their own index"` — run `EXPLAIN QUERY PLAN` on the subquery `onStationQueues` builds
  (`apps/server/src/working-order.ts:8266-8271`) and assert a row whose detail contains
  `working_orders_uncollected_idx`. Control in the same case: the plan for
  `select id from working_orders where status <> 'abandoned'` (no `collected_at` term) does not name it.
- [ ] **Step 2: Run it; it fails** (no such index).
- [ ] **Step 3: Implement.** `index("working_orders_uncollected_idx").on(t.id).where(sql\`${t.collectedAt} is null and ${t.status} <> 'abandoned'\`)`;
  rename `working_orders_tenant_status_idx` to `working_orders_status_idx`. Rebuild core.
- [ ] **Step 4: Run** `history-read-plans.test.ts`; PASS.
- [ ] **Step 5: Commit** `perf(db): index the uncollected bills the station queue reads (A1370 follow-up)`.

### Task 4: Protection list, backlog, finish

- [ ] **Step 1:** Run the protection list on the base and the branch (rules §3); paste the report
  into the PR and mark each line against the table above.
- [ ] **Step 2: Backlog.** In `docs/backlog/architecture.md` delete "`working_order_counters`: decide
  the remaining DELETE restriction (A805 follow-up)" (What A1308 retires) and "Index the uncollected,
  non-abandoned bill lookup in A1308's orders slice (A1370 follow-up)" (Query plans bundle), and
  correct each bundle heading's entry count.
- [ ] **Step 3:** `/finish-branch`, then the PR (rules §9).
