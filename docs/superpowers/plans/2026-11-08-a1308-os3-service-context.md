# A1308 orders and sales, PR 3: a bill's zone, department and service mode live on the bill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `order_service_contexts` into `working_orders` as `zone_id`, `department_id` and
`service_mode`, all three set together or all three null, pinned on a settled bill.

**Architecture:** The venue-service functions keep their names and signatures
(`recordOrderServiceContext`, `retargetOrderServiceContext`, `getOrderServiceContext`,
`findOrderServiceContext`, `orderZoneIdSql`, `orderInZones`, `findOrderServiceModes`,
`findOrderServiceZones`, `copyOrderServiceContext`, `packages/venue-service/src/operations.ts:1066-1180,
:1363-1378`); their bodies read and write the three columns. Every caller outside venue-service is
untouched except the change-event name and the tests.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.1, §4
(`order_service_contexts` → merge), §5 ("`zone_id`, `department_id` and `service_mode` stay pinned on a
settled bill"), §8 M8. Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane (rules §6: nothing fiscal; the receipt header that reads the zone is os8's).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. `working_orders.zone_id` (key to `floor_zones`), `department_id` (key to `departments`),
   `service_mode` (text), all null; CHECKs `working_orders_service_mode_ck`
   (`service_mode is null or service_mode in ('table_tab','prepay','ticket_then_pay')`, today's
   `order_service_contexts_mode_ck`) and `working_orders_service_context_ck` (all three null or all
   three set). The columns stay nullable: a bill with no recorded context is refused
   `order.service_context_missing` at 11 non-test sites today (`git grep -n service_context_missing
   -- apps packages ':!*.test.ts'`).
2. `working_orders_enforce_transition` pins the three columns wherever it pins `party_id` and in os2's
   settled branch, and leaves them free in the open and placed branches where `party_id` is free (a
   placed bill moving zone, `retargetOrderServiceContext`, `operations.ts:1083-1104`).
3. `order_service_contexts` deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| The line's own department snapshot (`offer_department_id`, `department_name`) | os4 |
| `sale_receipt_headers` | os8 |
| `department_transfer_desks` → `departments.transfer_desk_profile_id` | venue and box |
| Person key on `department_transfer_requests.resolved_by` | os11 |

## Files

- Modify: `packages/db/src/schema/orders.ts` (three columns, two CHECKs, two keys; import
  `floorZones`, `departments`)
- Modify: `packages/db/triggers/core.sql` (`working_orders_enforce_transition`)
- Modify: `packages/db/src/schema/venue-service/service.ts:216-247` (delete `orderServiceContexts`)
- Modify: `packages/db/src/index.ts:466`, `packages/db/src/classification.ts:352`,
  `packages/venue-service/src/classification.ts:34`, `packages/venue-service/src/index.ts:36`
- Modify: `packages/venue-service/src/operations.ts:1066-1180, :1363-1378`;
  `packages/venue-service/src/service-delete.ts:125-140`; `packages/venue-service/src/department-receipts.ts:316-320`;
  `packages/venue-service/src/department-transfers.ts:470-485`
- Modify: `apps/server/src/department-transfer-api.ts:133`
- Modify: `apps/dashboard/src/api/live-queries.ts:46`, `packages/venue-service/src/dashboard/live-queries.ts:16`
  (drop the name; `working_orders` is already in both lists, `apps/dashboard/src/api/live-queries.ts:43`)
- Modify (tests): the 15 test files naming `orderServiceContexts` and the 23 naming
  `order_service_contexts` (two lists in "Size"); `packages/db/src/schema/orders.transition.test.ts`;
  `packages/db/src/schema/venue-service/migrations.test.ts`; `scripts/schema-constraints.test.ts`
  (three rows); `scripts/behavioural-triggers.test.ts:657` (`MOVABLE_ORDER_COLUMNS`); `apps/dashboard/src/api/live-queries.test.ts`, `packages/venue-service/src/dashboard/live-queries.test.ts`;
  `packages/venue-service/src/backup-verification.test.ts` (7 lines);
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`REMOVED_TABLES` gains
  `order_service_contexts`; push the three columns onto `working_orders`)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 30, trigger lines 30, `operations.ts` bodies 60, other readers 30 | the deleted schema block (32 lines); generated files |
| Tests | M8 cases 90; re-pointed set-up in about 35 files, about 6 lines each, 210 | — |

About 450 counted lines; about 2 hours. Test files naming the identifier: `bill-payments.test.ts`,
`invoice-choice-delivery.test.ts`, `invoice-email-contact.test.ts`, `management-api.service-delete.test.ts`,
`order-creation-zone.test.ts`, `sale-operation-description.test.ts`, `service-delete.history.test.ts`,
`tender-refund-authorization.test.ts`, `till-api.presented-bill-zone.test.ts`,
`till-api.service-periods.test.ts`, `till-api.zone-closed.test.ts` (apps/server), and
`department-receipts.test.ts`, `department-transfers.test.ts`, `schema/service.test.ts`,
`service-delete.test.ts` (venue-service). Naming the table in SQL: see
`git grep -lw order_service_contexts -- apps packages scripts ':!*.json' ':!*.sql'`.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/orders.transition.test.ts src/schema/orders.test.ts src/schema/venue-service/migrations.test.ts --reporter=dot
pnpm --filter @waitron/venue-service test
pnpm --filter @waitron/server exec vitest run src/order-creation-zone.test.ts src/till-api.zone-closed.test.ts src/till-api.presented-bill-zone.test.ts src/till-api.service-periods.test.ts src/management-api.service-delete.test.ts src/service-delete.integration.test.ts src/service-delete.history.test.ts src/till-api.move-bill.test.ts src/watch-zones.test.ts src/working-order.test.ts --reporter=dot
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts --reporter=dot
```

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `order_service_contexts` | `missing table order_service_contexts`; `missing index order_service_contexts.primary key(working_order_id)` | all |
| `order_service_contexts` | `missing trigger waitron_change_order_service_contexts_insert`, `_update`, `_delete` | change-feed |
| `working_orders` | `extra table working_orders.columns[zone_id]`, `[department_id]`, `[service_mode]` | all |
| `working_orders` | `extra table working_orders.checks[working_orders_service_mode_ck]`, `[working_orders_service_context_ck]` | all |
| `working_orders` | `extra table working_orders.foreignKeys[zone_id->floor_zones(id)]`, `[department_id->departments(id)]` | all |
| `working_orders` | `changed table working_orders.columnOrder` | all |
| `working_orders` | `changed trigger working_orders_enforce_transition.body` | all |
| `working_orders` | `changed trigger waitron_change_working_orders_update.when` | change-feed |

Where the old protections went (§5): the mode CHECK, the zone key and the department key move to
`working_orders` under the names above; the cascade from the bill is inherent; `location_id` already
went in slice 5. The all-or-none CHECK is new: one row held all three as `NOT NULL` before.

## Stop points (beyond rules §5)

- A suite changes the zone, department or mode of a **settled** bill (design says none does:
  `moveSettledBillToCounter` keeps its zone, `apps/server/src/move-bill.ts:333-336`, and the merge's zone
  change reaches open and placed bills only, `apps/server/src/table-actions.ts:250-253`).
- `orderInZones` callers depend on "an order with no context row" meaning something other than "all
  three columns null" (12 call sites outside `operations.ts`; read them before Task 2's Step 3).

## Assertions that change, by design (rules §4)

- `scripts/behavioural-triggers.test.ts:657` `MOVABLE_ORDER_COLUMNS` gains `zone_id`, `department_id`,
  `service_mode`: a presented bill's move may change them (a placed bill moving zone adopts the new zone's
  context, `retargetOrderServiceContext`, `operations.ts:1083-1104`), as they are free wherever `party_id`
  is free on an open or placed bill (tables-ordersales.md §5). The test reads the columns live (`:658-663`).
  Any other changed assertion is a stop.

## Needs

- **In this area:** os2 (it rewrote the trigger's settled branch; this PR adds three columns to it).
- **Outside:** batch 1 (slice 5 removed `order_service_contexts.location_id`).

---

## Global Constraints

- Rules §1–§9. Behaviour unchanged: an order's context is the zone it was opened in, retargeted when
  an open or placed bill moves zone, copied to a split bill, and never changed once settled.

## Review Focus

1. **A bill with no recorded context** reads as missing (`findOrderServiceContext` returns `null`),
   exactly as when it had no row. Test: Task 2 Step 1, first case.
2. **`orderInZones`' "or has no recorded zone" half** (`operations.ts:1137-1149`) keeps a bill with a
   null zone. Test: Task 2.
3. **The transfer desk's live stream** (`apps/server/src/department-transfer-api.ts:126-139`) now
   wakes on every `working_orders` change, not only context changes, because the context is a column
   of the bill. It already re-reads on a 15-second timer and debounces with `pending`; the PR says so.
   Test: the existing department-transfer API stream case, re-pointed.
4. **A settled bill's zone is pinned.** Test: Task 1.
5. **A split bill copies its source's context** (`copyOrderServiceContext`, `:1363-1378`) as one
   update of the new bill. Test: existing `draft-split.test.ts` and `transfer-lines.test.ts` cases.

---

### Task 1: The columns and the trigger (M8, second half)

**Files:** `packages/db/src/schema/orders.ts`; `packages/db/triggers/core.sql`;
`packages/db/src/schema/orders.test.ts`, `orders.transition.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `orders.test.ts`: `"refuses a zone without a department and mode"` (each of the six partial
    combinations refused, naming `working_orders_service_context_ck`; control: all three set, and all
    three null); `"refuses a service mode outside the three"` (`working_orders_service_mode_ck`);
    `"refuses a zone or department that does not exist"` (foreign key).
  - `orders.transition.test.ts`, M8 "a case per folded column on placed and settled bills": for each of
    the three columns, `"a placed bill may change its <column>"` accepted, and `"a settled bill keeps
    its <column>"` refused with `TRANSITION_REFUSAL`; `"the handover stamp refuses a zone change in the
    same update"`. `"the exception names every column"` now also passes for the three (it reads the
    branch text; it fails until the trigger lists them).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the columns and CHECKs; in `core.sql` add `new.zone_id IS old.zone_id AND
  new.department_id IS old.department_id AND new.service_mode IS old.service_mode` to the two handover
  branches, the delivery-table release branch and os2's settled branch. Rebuild core.
- [ ] **Step 4: Run** the two files and `scripts/behavioural-triggers.test.ts`; PASS.
- [ ] **Step 5: Commit** `feat(db): a bill's zone, department and service mode are columns of the bill`.

### Task 2: venue-service reads and writes the columns

**Files:** `packages/venue-service/src/operations.ts`, `service-delete.ts`, `department-receipts.ts`,
`department-transfers.ts`; `apps/server/src/department-transfer-api.ts:133`; the two live-query lists;
tests.

**Interfaces:** unchanged signatures, listed in Architecture. `recordOrderServiceContext` becomes
`update working_orders set zone_id, department_id, service_mode where id = ?` on the bill its caller
just inserted (`apps/server/src/working-order.ts:1739-1743`); `copyOrderServiceContext` the same on
the new bill; `orderZoneIdSql(orderId)` returns `(select zone_id from working_orders wz where wz.id =
${orderId})`; `orderInZones(orderId, zoneIds)` returns a condition true when that zone is null or in
`zoneIds`.

- [ ] **Step 1: Re-point the tests** (assertions unchanged): each insert or read of
  `orderServiceContexts` in set-up becomes the bill's three columns; each raw `order_service_contexts`
  SQL becomes `working_orders`. Add in `packages/venue-service/src/operations.test.ts`:
  `"a bill with no recorded context is found missing"` (`findOrderServiceContext` → `null`,
  `getOrderServiceContext` throws `order.service_context_missing`) and `"orderInZones keeps a bill with
  no zone"`.
- [ ] **Step 2: Run; they fail to compile** after the schema export is removed.
- [ ] **Step 3: Implement.** `department-transfer-api.ts:133`: `resource.type === "working_orders"`.
  Drop `"order_service_contexts"` from both live-query lists (`working_orders` is already named by
  each query that named it).
- [ ] **Step 4: Run** the Finish line's venue-service, server and dashboard commands; PASS.
- [ ] **Step 5: Commit** `refactor(venue-service): read a bill's service context from the bill`.

### Task 3: Delete the table; registries; finish

- [ ] **Step 1:** Delete `orderServiceContexts` (`service.ts:216-247`), its exports, the two
  classification entries; update `scripts/schema-constraints.test.ts`, the venue-service
  `backup-verification.test.ts` lines, `schema/venue-service/migrations.test.ts`, the Madrid lists.
- [ ] **Step 2:** Rebuild core; Finish line; protection list against the prediction.
- [ ] **Step 3: Docs.** Grep `docs/developers/` for `order_service_contexts` and "service context
  row"; reword each sentence to the columns.
- [ ] **Step 4: Commit**, `/finish-branch`, PR.
