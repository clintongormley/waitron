# A1308 orders and sales, PR 5: the line is the dish — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **OWNER LANDS THIS PULL REQUEST** (owner, 2026-11-09: confirmed). It renames `sale_line_portions`, an append-only ledger table
> written in the sale's transaction (`linkSalePortions` after `recordSale`,
> `apps/server/src/till-sale.ts:999-1028`, `bill-payments.ts:739-753`, `working-order.ts:7312-7326`),
> to `sale_line_dishes` and changes what its rows point at. It changes no `sales` row, invoice number or
> hash input, so rules §6 does not require the owner; this plan sends it to the owner anyway, because it
> rewrites part of the immutable sale record and the refund-value read that money depends on
> (`apps/server/src/cancellation-refund-value.ts:40-89`). It holds nothing else, so the lane can land
> os6 onwards while it waits only where a later PR needs it (Needs, in each).

**Goal:** Delete `order_portions` and `working_line_portions`: a dish's identity is its order line id,
and the three facts the registry held (its cohort, its number in the cohort, whether it is a whole
portion) become columns of the line, frozen once set. `sale_line_portions` becomes `sale_line_dishes`,
pointing at the dish line.

**Architecture:** Measure M4 and M5 first. Add `cohort_id`, `cohort_ordinal`, `whole_portion` to
`working_order_lines` with a unique `(cohort_id, cohort_ordinal)`, an all-or-none CHECK limited to dish
rows, and a freeze trigger. `apps/server/src/order-portions.ts` keeps its function names; their bodies
read the line. `order_portion_events.portion_id` becomes a plain `line_id` (the events table itself
goes in os6).

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.2 ("the
line is the dish's identity"), §1.15, §4, §5 (order_portions, working_line_portions,
sale_line_portions), §6 item 1, §8 M4, M5; README §5 U9 (`sale_line_portions` → `sale_line_dishes`);
A803 §3.1 and §3.9 as amended on the plans branch (2026-11-08). Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. **M4 and M5** measured (Task 1).
2. `working_order_lines.cohort_id` (text), `cohort_ordinal` (integer), `whole_portion` (flag), all null;
   unique index `working_order_lines_cohort_ordinal_key` on `(cohort_id, cohort_ordinal)`; CHECK
   `working_order_lines_cohort_ck`: the three all null or all set, set only when `parent_line_id is
   null`, and `cohort_ordinal >= 1`; trigger `working_order_lines_cohort_fixed` refusing any change to
   the three once `cohort_id` is set (it replaces `order_portions` being append-only). The open-parent
   update trigger lists the three in its three pinning branches (served, kitchen group, sent stamp).
3. `sale_line_dishes` (`id` PK, `sale_line_id` key to `sale_lines` restrict, `dish_line_id` key to
   `working_order_lines` restrict), unique `sale_line_dishes_sale_line_dish_key`
   `(sale_line_id, dish_line_id)`, index `sale_line_dishes_dish_line_idx`; core, `ledger`, append-only.
4. `order_portion_events.portion_id` → `line_id`, plain id with no key (a cancelled dish's line is
   deleted and the event outlives it, §1.23); its kind and destination CHECKs unchanged. It also gains
   `detail` (JSON, not null, default `{}`, the column `order_events` has, §1.23): `recordPortionEvents`
   writes `{ "cohortId": …, "ordinal": … }` from the line before it moves or is deleted, so a dish that
   left a bill still says which cohort and number it had. os6 carries `detail` into `order_events` as is.
5. `order_portions`, `working_line_portions`, `sale_line_portions` deleted.
6. A446's pre-bill link read, if it goes through a deleted table, re-pointed (Task 4).

## What it leaves out

| Left out | Owner |
| --- | --- |
| `order_portion_events` into `order_events` | os6 |
| Recalled draft lines | os7 |
| Any change to how dishes are grouped on paper or priced | none |

## Files

- Modify: `packages/db/src/schema/orders.ts` (three columns, index, CHECK)
- Delete: `packages/db/src/schema/order-portions.ts`. Create from it
  `packages/db/src/schema/sale-line-dishes.ts` (`saleLineDishes`) and
  `packages/db/src/schema/order-portion-events.ts` (`orderPortionEvents` with `lineId`; os6 deletes it)
- Modify: `packages/db/triggers/core.sql` (new trigger; open-parent update lists);
  `packages/db/src/trigger-refusals.ts` (`DISH_IDENTITY_FIXED_REFUSAL = "a dish's cohort is fixed once set"`)
- Modify: `packages/db/src/index.ts`, `packages/db/src/classification.ts:79-93`,
  `packages/migrations/migrations.manifest.json:21-22`
- Modify: `apps/server/src/order-portions.ts:165-410` (all binding functions),
  `apps/server/src/portion-sale-projection.ts`, `apps/server/src/cancellation-refund-value.ts:40-140`,
  `apps/server/src/adjustments-apply.ts:438, :564-567`, `apps/server/src/orders-list.ts:760-776`,
  `apps/server/src/working-order.ts:1168, :1310-1360, :1747, :3290, :3416, :4273, :4440-4455,
  :4938, :6116, :6708, :6808`, `apps/server/src/draft-recall.ts:144, :255-275`,
  `apps/server/src/order-groups.ts:221-233, :394`, `apps/server/src/order-drafts.ts:519`
- Modify (sale paths, owner's review): `apps/server/src/till-sale.ts:1028, :1670, :1835`,
  `apps/server/src/bill-payments.ts:753`, `apps/server/src/working-order.ts:7326` (calls only; the
  function name `linkSalePortions` becomes `linkSaleDishes`)
- Modify (tests): `packages/db/src/schema/order-portions.test.ts` (→ `sale-line-dishes.test.ts`);
  `apps/server/src/order-portions.lifecycle.test.ts`, `order-portions.counter.test.ts`,
  `order-portions.filing.test.ts`, `move-dishes.test.ts`, `adjustments-apply.test.ts`,
  `bill-refunds.card.test.ts`, `till-api.fiscal-sale-paths.test.ts`, `testing/adjustment-venue.ts`,
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:32-36` (drop `order_portions`,
  `sale_line_portions`, `working_line_portions` from `ADDED_TABLES`; add `sale_line_dishes`; push the
  three line columns); `scripts/append-only-triggers.test.ts:62, :69`; `scripts/schema-constraints.test.ts`;
  `scripts/behavioural-triggers.test.ts`

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 55, triggers 30, `order-portions.ts` 130, readers 120, call renames 15 | the deleted table definitions (60); generated files |
| Tests | new schema and trigger cases 120; re-pointed portion suites 250; `todayLine` 30 | — |

About 750 counted lines; about 3 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/sale-line-dishes.test.ts src/schema/orders.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/order-portions.lifecycle.test.ts src/order-portions.counter.test.ts src/order-portions.filing.test.ts src/move-dishes.test.ts src/adjustments-apply.test.ts src/bill-refunds.card.test.ts src/till-api.fiscal-sale-paths.test.ts src/draft-recall.test.ts src/kitchen-print.test.ts src/orders-list.test.ts src/tender-refund-balance.test.ts --reporter=dot
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts --reporter=dot
```

The fiscal pair runs unedited and passes: this PR must not reach the record.

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `order_portions` | `missing table order_portions`; `missing index order_portions.primary key(id)`; `missing index order_portions_cohort_ordinal_key` | all |
| `order_portions` | `missing trigger order_portions_append_only_update`, `_append_only_delete` | migrated, change-feed |
| `order_portions` | `missing trigger waitron_change_order_portions_insert`, `_update`, `_delete` | change-feed |
| `working_line_portions` | `missing table working_line_portions`; `missing index working_line_portions.primary key(working_order_line_id)`; `missing index working_line_portions_portion_key` | all |
| `working_line_portions` | `missing trigger waitron_change_working_line_portions_insert`, `_update`, `_delete` | change-feed |
| `sale_line_portions` | `missing table sale_line_portions`; `missing index sale_line_portions.primary key(id)`; `missing index sale_line_portions_portion_idx`; `missing index sale_line_portions_sale_line_portion_key` | all |
| `sale_line_portions` | `missing trigger sale_line_portions_append_only_update`, `_append_only_delete` | migrated, change-feed |
| `sale_line_portions` | `missing trigger waitron_change_sale_line_portions_insert`, `_update`, `_delete` | change-feed |
| `sale_line_dishes` | `extra table sale_line_dishes`; `extra index sale_line_dishes.primary key(id)`; `extra index sale_line_dishes_sale_line_dish_key`; `extra index sale_line_dishes_dish_line_idx` | all |
| `sale_line_dishes` | `extra trigger sale_line_dishes_append_only_update`, `_append_only_delete` | migrated, change-feed |
| `sale_line_dishes` | `extra trigger waitron_change_sale_line_dishes_insert`, `_update`, `_delete` | change-feed |
| `order_portion_events` | `missing table order_portion_events.columns[portion_id]`; `extra table order_portion_events.columns[line_id]`; `missing table order_portion_events.foreignKeys[portion_id->order_portions(id)]` | all |
| `order_portion_events` | `extra table order_portion_events.columns[detail]`; `changed table order_portion_events.columnOrder` | all |
| `order_portion_events` | `changed trigger waitron_change_order_portion_events_update.when` | change-feed |
| `working_order_lines` | `extra table working_order_lines.columns[cohort_id]`, `[cohort_ordinal]`, `[whole_portion]`; `extra table working_order_lines.checks[working_order_lines_cohort_ck]`; `extra index working_order_lines_cohort_ordinal_key` | all |
| `working_order_lines` | `changed table working_order_lines.columnOrder` | all |
| `working_order_lines` | `extra trigger working_order_lines_cohort_fixed`; `changed trigger working_order_lines_require_open_parent_update.body` | all |
| `working_order_lines` | `changed trigger waitron_change_working_order_lines_update.when` | change-feed |

The tool keys columns by name (`apps/server/scripts/protection-list/compare.ts:82-85`), so the
rename prints as one missing and one extra column plus the column-order change.

Where the protections went (§5): `order_portions_cohort_ordinal_key` →
`working_order_lines_cohort_ordinal_key`; `order_portions_ordinal_ck` → the cohort CHECK;
`order_portions`' append-only triggers → the freeze trigger; `working_line_portions`' primary key and
unique portion become inherent (one row); `sale_line_portions`' unique pair, index, keys and
append-only triggers → `sale_line_dishes`' (the portion key becomes a line key, restrict). Dropped with
a reason: a dish's registry row outliving its line (§1.2, owner 2026-11-04).

## Stop points (beyond rules §5)

- M4 or M5 gives its failing result (Task 1).
- Any `fiscal-verifactu` or `packages/core` file needs a change.

## Needs

- **In this area:** os4 (same table, same trigger).
- **Outside:** A446 landed (build order); if its pre-bill table stores portion ids rather than line
  ids, that is a stop — A446's backlog entry says it stores line ids (`docs/backlog/fiscal.md:58-61`).

---

## Global Constraints

- Rules §1–§9. **The line id is the dish's identity**: every `registerPortions` caller makes a fresh line
  id with a fresh dish (`working-order.ts:1747`, `:6708`, `order-groups.ts:394`, `draft-recall.ts:275`),
  and `registerPortions` refuses to rebind a line (`order-portions.ts:173-179`).
- `whole_portion` = `not order_portions.measured`.
- A sale line stands for the dish lines it groups and for their extras' rows (`order-portions.ts:386-410`).

## Review Focus

1. **A cancelled dish's number in its cohort** may be given again (M4). The test that decides it is in
   Task 1.
2. **A sold dish line deleted later** (M5): with the restrict key, the delete is refused; today it
   silently succeeds.
3. **A line created before portions existed** ("unbound": no cohort) keeps its by-position refund
   value (`cancellation-refund-value.ts:79-82`). Test: the existing unbound case, re-pointed.
4. **Moving a dish keeps its cohort** (lines move in place, `working-order.ts:4189-4200`). Test:
   `move-dishes.test.ts`, re-pointed.
5. **An extra row never carries a cohort.** Test: Task 2's CHECK case.

---

### Task 1: M4 and M5

**Files:** none committed beyond Task 2's; results in the PR.

- [ ] **Step 1: M5** runs after Task 3, on the branch, as the design says (tables-ordersales.md §8 M5):
  with `sale_line_dishes.dish_line_id` restricting deletes (Task 2), run
  `pnpm --filter @waitron/server exec vitest run --reporter=dot` (check free memory first).
  **Failing:** any failure whose error is the foreign key refusing a `working_order_lines` delete
  (`restrictRefused(error)`, `packages/db/src/constraint-target.ts:240-247`): a path deletes a sold dish
  line, which today silently succeeds; stop and ask the watcher, naming the path. **Passing:** none.
  Control: Task 2's `"refuses deleting a dish line a sale line points at"` fails the same way, so the
  failing case is visible. (A probe on the base cannot fail: `cancelPortions` unbinds before every whole-dish
  delete, `order-portions.ts:372-380` before `working-order.ts:3290, :3416`, and the binding's key forces
  that order.)
- [ ] **Step 2: M4** runs after Task 3 (it needs the new read). Reuse of a cancelled dish's number is
  what the design expects, not itself a failure. Run `order-portions.lifecycle.test.ts`,
  `order-portions.counter.test.ts`, `draft-recall.test.ts`, `till-api.fiscal-sale-paths.test.ts`, and the
  new case in Task 3 Step 1. **Failing:** any failure caused by an ordinal given twice in one cohort
  (unique error on `working_order_lines_cohort_ordinal_key`, or a projection pairing two dishes wrongly).
  **Fallback** (§8 M4): store the cohort's next ordinal on its first dish row (`cohort_next_ordinal`,
  integer, null except on ordinal 1, frozen by the same trigger except for increases); the watcher
  confirms before the builder takes it.

### Task 2: The dish columns, the freeze trigger, `sale_line_dishes`

**Files:** `packages/db/src/schema/orders.ts`, `sale-line-dishes.ts`, `order-portion-events.ts`;
`packages/db/triggers/core.sql`; `packages/db/src/trigger-refusals.ts`; `packages/db/src/schema/orders.test.ts`,
`sale-line-dishes.test.ts`; `scripts/behavioural-triggers.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `orders.test.ts`: `"refuses a cohort on an extra row"`, `"refuses a cohort without its ordinal or
    whole-portion flag"`, `"refuses ordinal 0"` (all `working_order_lines_cohort_ck`); `"refuses two
    dishes with one number in one cohort"` (unique); controls: a dish with all three, an extra with none.
  - `behavioural-triggers.test.ts`: `"a dish's cohort is fixed once set"` — changing `cohort_id`,
    `cohort_ordinal` or `whole_portion` of a dish whose cohort is set is refused with
    `DISH_IDENTITY_FIXED_REFUSAL`, **on an open bill too**; accepting controls: setting them on a line
    whose `cohort_id` is null, and moving the line to another open bill (`working_order_id` changes,
    the cohort does not). Add the trigger to `EXPECTED_TRIGGERS`.
  - `sale-line-dishes.test.ts`: `"refuses one dish linked twice to one sale line"`; `"refuses deleting a
    dish line a sale line points at"` (M5's guard); `"refuses any update or delete of a link"`
    (append-only).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Trigger: `CREATE TRIGGER working_order_lines_cohort_fixed BEFORE UPDATE OF
  cohort_id, cohort_ordinal, whole_portion ON working_order_lines FOR EACH ROW WHEN old.cohort_id IS NOT
  NULL AND (new.cohort_id IS NOT old.cohort_id OR new.cohort_ordinal IS NOT old.cohort_ordinal OR
  new.whole_portion IS NOT old.whole_portion) BEGIN SELECT raise(abort, '<constant>'); END;`. Add the
  three columns to all three pinning branches of the open-parent update trigger. Classification:
  `appendOnly("sale_line_dishes", "ledger", "which dish lines each filed sale row stands for; written
  with the sale, never corrected")`; the manifest swaps the two names. Rebuild core.
- [ ] **Step 4: Run; PASS. Commit** `feat(db): the order line is the dish; sale_line_dishes points at it`.

### Task 3: The binding functions read the line

**Files:** `apps/server/src/order-portions.ts` and the readers under Files; tests.

**Interfaces** (names kept unless stated):
- `PortionRef` loses `portionId`; it is `{ lineId, pricingCohortId, ordinal, measured }`.
  `registerPortions(tx, portions)` disappears: `expandPortionRows` (`:46-104`) returns rows that already
  carry `cohortId`, `cohortOrdinal`, `wholePortion`, written by the caller's insert. Its four callers drop
  the call.
- `readPortionBindings(tx, lineIds): Promise<Map<string, { lineId; cohortId; ordinal }>>` reads lines
  whose `cohort_id` is not null.
- `readGrowingPortions` reads `max(cohort_ordinal)` over the cohort's **current** lines (M4).
- `readWholePortionLines` joins the dish line (`coalesce(parent_line_id, id)`) and tests
  `whole_portion`.
- `cancelPortions(tx, orderId, lineIds, actorId)` records the `cancelled` events with `lineId` and
  no longer unbinds; `deletePortionBindings` is deleted.
- `linkSalePortions` → `linkSaleDishes(tx, saleId, identities)`; `OrderLineIdentity.portionIds` →
  `dishLineIds` (`working-order.ts:1237` area; `adjustments-apply.ts:564-567` destructures it).
- `cancellation-refund-value.ts`: links by `dish_line_id`.

- [ ] **Step 1: Re-point the tests** (assertions unchanged) and add, in
  `order-portions.lifecycle.test.ts`: `"a dish ordered x3 is three lines numbered 1 to 3 in one
  cohort"`; `"a cancelled dish's number is given to the next dish of its cohort"` (M4's probe: order a
  dish ×3, cancel dish 3, raise the quantity by one; the new dish's `cohort_ordinal` is **3**, because
  `max(cohort_ordinal)` over the cohort's current lines is 2; the bill then sells, and its sale lines link
  each dish line once). Reuse is expected (design §8 M4); the case fails only if the sale or a projection
  breaks.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the interfaces; delete the joins to `orderPortions`/`workingLinePortions`
  at `orders-list.ts:760-776` and `working-order.ts:1310-1360, :4440-4455` in favour of the line's columns.
  **The test helper `todayLine`** (`apps/server/src/testing/adjustment-venue.ts:695-790`) reads the cohort
  and ordinal of dishes still on the bill from their lines, and of dishes that left it from
  `order_portion_events` rows with `from_order_id = bill`, through their `detail.cohortId` and
  `detail.ordinal` (item 4), keyed by `line_id` where it keyed by portion id. Its assertions and its
  "a row of several dishes left" refusal (`:743-745`) are unchanged.
- [ ] **Step 4: Run** the Finish line's server command; then Task 1 Step 2 (M4).
- [ ] **Step 5: Commit** `refactor(server): read a dish's cohort from its line`.

### Task 4: A446's link, registries, finish

- [ ] **Step 1: A446.** `git grep -n "sale_line_portions\|saleLinePortions\|working_line_portions\|workingLinePortions" -- apps packages`
  after Task 3: anything left in A446's pre-bill code (its link from a pre-bill to the invoices its lines
  reached) reads `sale_line_dishes.dish_line_id = <pre-bill line id>` instead. A446's table keeps its
  line ids unchanged.
- [ ] **Step 2:** Delete the old tables' exports and classification entries; update
  `scripts/append-only-triggers.test.ts` (`EXPECTED` loses `order_portions`, `sale_line_portions`, gains
  `sale_line_dishes`), `scripts/schema-constraints.test.ts`, the Madrid lists.
- [ ] **Step 3:** Rebuild core; Finish line (fiscal pair unedited, PASS); protection list.
- [ ] **Step 4: Docs.** Grep `docs/developers/` and the guides for "portion" sentences that describe the
  registry ("kept for good", "portion id"); reword to the line. Keep "portion" as a word for a dish on
  paper where the guides use it for staff.
- [ ] **Step 5: Commit**, `/finish-branch`, PR with "Owner lands" in its first lines after the reset line.
