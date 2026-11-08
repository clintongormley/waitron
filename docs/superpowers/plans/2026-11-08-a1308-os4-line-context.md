# A1308 orders and sales, PR 4: a dish line carries what it was sold as — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `working_line_contexts` (the menu, department, unit, allergens and late-send facts
frozen when a line is added) into `working_order_lines`, so a line is written once, with its context,
in the insert that creates it.

**Architecture:** Measure first (M2 wider rows, M3 duplicated fields). Then add the context columns to
`working_order_lines`, replace the venue-service writer `recordLineContexts` (an insert into the side
table after the line insert) with `lineContextColumns`, which returns the columns for the caller's own
insert, and keep the three readers' names (`listLineContexts`, `readLinesSoldInEach`,
`readLateSendMarks`). The open-parent update trigger pins every new column on placed and settled bills.

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest.

**Spec:** [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.2, §4
(`working_line_contexts` → merge), §5 (working_order_lines; working_line_contexts), §6 item 5, §8 M2
and M3. README §5 U11 (person keys). Rules: [slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane. No sale, invoice number or hash input changes: the sale copies lines by value
(`sale_lines`, tables-ordersales.md §1.14), and none of these columns is copied into it.

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## What it builds

1. **M2 and M3** measured, with their results in the PR (Task 1).
2. `working_order_lines` gains: `menu_item_id` (key to `menu_items`), `menu_id`, `menu_name`,
   `menu_version_id` (key to `menu_versions`), `offer_department_id`, `department_name`, `unit_id`
   (plain id, as today: `service.ts:263` has no key), `sold_in_each` (flag), `hardware_unit`,
   `allergens`, `diet`, `diet_override`, `late_period_name`, `late_confirmed_by` (key to `persons`),
   all null; and, **only if M3 says so**, `offer_unit_name`, `offer_unit_precision`, `offer_vat_class`,
   `offer_category_name`. `diet_derivation` is not carried: batch 1 slice 4a removed it with recipes.
3. CHECKs: `working_order_lines_hardware_unit_ck` (`hardware_unit is null or in ('kg','g','mg')`);
   `working_order_lines_context_ck`: `menu_item_id`, `menu_id`, `menu_name`, `offer_department_id`,
   `department_name`, `unit_id`, `sold_in_each` all null or all set (they were `NOT NULL` on the side
   row, `service.ts:252-266`); if the `offer_` columns stay, `_offer_unit_precision_ck` (0–3) and
   `_offer_vat_class_ck` (the four classes), and they join the all-or-none CHECK.
4. `working_order_lines.credited_to` gains its key to `persons` (`orders.ts:217`, "No key yet"; U11).
5. `working_order_lines_require_open_parent_update` lists every new column in its three pinning
   branches (served, kitchen group, sent stamp; today `0000_baseline.sql:3385-3503`).
6. `working_line_contexts` deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| The dish identity columns (`cohort_id`, …) and `order_portions` | os5 |
| The allergen column's normalisation of repeated kinds ("What A1308 retires", first entry) | menu and photos: it names "A1308's one allergen column", the product's (`tables-menu.md`); the line copies the product's normalised value |
| `line_service_cancellations.actor_id` key | os11 |
| The line locale triggers | unchanged here; slice 5 re-pointed them at `settings.venue` |

## Files

- Modify: `packages/db/src/schema/orders.ts` (`workingOrderLines`: columns, CHECKs, keys)
- Modify: `packages/db/triggers/core.sql` (`working_order_lines_require_open_parent_update`)
- Modify: `packages/db/src/schema/venue-service/service.ts:249-310` (delete `workingLineContexts`)
- Modify: `packages/db/src/index.ts:479`, `packages/db/src/classification.ts:353`,
  `packages/venue-service/src/classification.ts:35`, `packages/venue-service/src/index.ts:50`
- Modify: `packages/venue-service/src/operations.ts:1183-1272` (three readers), `:1273-1361`
  (`recordWorkingLineContexts` → `lineContextColumns`), `:1380-1414` (delete the two copy functions);
  `packages/venue-service/src/service.ts:72-82, :183-190, :255`; `packages/module/src/module.ts:1197-1235`
- Modify (callers): `apps/server/src/working-order.ts:1739-1747` (`createOpenOrder`), `:3152`
  (round), `:4997-5042` (split row), `:6700-6708` (edit); `apps/server/src/draft-recall.ts:212, :274`;
  `apps/server/src/order-groups.ts:340-354` if its rows reach an insert that needs the columns
- Modify: `packages/catalogue/src/menu-structure.ts:162` (comment names the old table)
- Modify (tests): `packages/db/src/schema/orders.test.ts`; the 14 test files naming
  `workingLineContexts` and the 13 naming `working_line_contexts` (`git grep -l`); `scripts/schema-constraints.test.ts`
  (three rows); `scripts/behavioural-triggers.test.ts` (open-parent accepting/refusing cases for one new
  column); `packages/db/src/schema/venue-service/migrations.test.ts`;
  `apps/server/src/personal-data-actions.coverage.test.ts` (`working_order_lines.late_confirmed_by`
  joins `NOT_YET`; `credited_to` already there); Madrid lists (`REMOVED_TABLES` gains
  `working_line_contexts`; push the new `working_order_lines` columns)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | schema 45, trigger 25, `lineContextColumns` and readers 90, callers 70 | deleted side-table schema (62) and copy functions (35); generated files |
| Tests | new CHECK/key/trigger cases 90; re-pointed set-up in about 25 files 200 | M2/M3 scratch scripts (not committed) |

About 520 counted lines; about 3 hours.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/orders.test.ts src/schema/venue-service/migrations.test.ts --reporter=dot
pnpm --filter @waitron/venue-service exec vitest run src/operations.test.ts src/menu-timetable.test.ts --reporter=dot
pnpm --filter @waitron/server exec vitest run src/working-order.test.ts src/working-order.customer-fallback.test.ts src/kitchen-print.test.ts src/kitchen-print.language.test.ts src/issuance-pass.test.ts src/till-sale.test.ts src/bill-payments-api.test.ts src/order-portions.counter.test.ts src/order-portions.filing.test.ts src/service-delete.integration.test.ts src/draft-split.test.ts src/personal-data-actions.coverage.test.ts --reporter=dot
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
```

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `working_line_contexts` | `missing table working_line_contexts`; `missing index working_line_contexts.primary key(working_order_line_id)` | all |
| `working_line_contexts` | `missing trigger waitron_change_working_line_contexts_insert`, `_update`, `_delete` | change-feed |
| `working_order_lines` | `extra table working_order_lines.columns[<c>]` for each of the 14 columns in item 2 (18 if M3 keeps the `offer_` four) | all |
| `working_order_lines` | `extra table working_order_lines.checks[working_order_lines_hardware_unit_ck]`, `[working_order_lines_context_ck]` (and the two `offer_` CHECKs if kept) | all |
| `working_order_lines` | `extra table working_order_lines.foreignKeys[menu_item_id->menu_items(id)]`, `[menu_version_id->menu_versions(id)]`, `[late_confirmed_by->persons(id)]`, `[credited_to->persons(id)]` | all |
| `working_order_lines` | `changed table working_order_lines.columnOrder` | all |
| `working_order_lines` | `changed trigger working_order_lines_require_open_parent_update.body` | all |
| `working_order_lines` | `changed trigger waitron_change_working_order_lines_update.when` | change-feed |

Where the side table's protections went (§5): the menu item and menu version keys move; the unit
precision, hardware unit and VAT class CHECKs move (the last two onto the `offer_` columns only if
kept, since the line already has `working_order_lines_unit_precision_ck` and `_vat_class_ck`); the
side row's `NOT NULL`s become the all-or-none CHECK; the cascade from the line is inherent.

## Stop points (beyond rules §5)

- M2 or M3 gives its failing result (Task 1).
- Slice 0's bench has not landed when Task 1 Step 2 starts.
- A caller needs a line's context after the line's insert and before `lineContextColumns` can run
  (the order's service context must exist first; os3 made it a column of the bill set at
  `working-order.ts:1739-1743`).

## Needs

- **In this area:** os3 (`lineContextColumns` reads the bill's department from the bill).
- **Outside:** batch 1 4a (no `diet_derivation`), slice 5 (locale triggers, `location_id`). Menu and
  photos' PRs that change `menu_items` or `menu_versions` have landed (rules §7), because this PR adds
  keys into them. Slice 0's bench year for M2.

---

## Global Constraints

- Rules §1–§9. A line's context is frozen when the line is written: no product path updates it
  (tables-ordersales.md §5: "Nothing updates a context or portion row today").
- The line's department snapshot can differ from the bill's after a move
  (`packages/venue-service/src/operations.ts:1080`, "retaining existing line snapshots"), so it stays a
  column of the line, named `offer_department_id`.

## Review Focus

1. **A split or copied line keeps its source's context.** Today `copyLineContext` copies the side row
   (`working-order.ts:5042`); now the split insert at `:4997` names the context columns from `row`.
   Test: `draft-split.test.ts`'s existing context assertions, re-pointed.
2. **A recalled line keeps its context** (`draft-recall.ts:212, :274`). Test: existing recall cases.
3. **An extra line** (a child of a dish) gets the same context as before: today's writer covers every
   line its caller passes. Test: Task 3's "an extra under a dish carries its own sold-in-each".
4. **A placed bill's line context cannot change.** Test: Task 2's trigger cases.
5. **The till bill read does not slow down** (M2).

---

### Task 1: M2 and M3

**Files:** none committed; results go in the PR description.

- [ ] **Step 1: M3, duplicated fields** (tables-ordersales.md §8 M3). On the base commit, add a
  temporary probe (not committed) at the end of `recordWorkingLineContexts`
  (`operations.ts:1273`) that reads each written line's own `unit_name`, `unit_precision`,
  `vat_class`, `category` and appends every difference from the context it wrote to a file named by
  `process.env.M3_OUT`. Run `pnpm --filter @waitron/server exec vitest run --reporter=dot` and a demo
  seed with `salesDays: 7` (`seedDemoRestaurant`, as `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:55`
  calls it). Classify every difference:
  (a) the line's `unit_name` null for an "Each" unit (`working-order.ts:947`);
  (b) the line's `category` null where the context has `"Uncategorised"` (`operations.ts:1341`);
  (c) anything else. **Passing (drop the `offer_` columns):** only (a) and (b), both derivable — (a)
  from `unit_id` and (b) as `category ?? "Uncategorised"` in the readers that return the context.
  **Failing (keep both, named apart):** any (c). Control: the probe must print at least one (a) on the
  demo seed, or it is not reading what it should.
- [ ] **Step 2: M2, wider rows** (§8 M2). With slice 0's bench (`bench build`, `bench measure`,
  `bench compare`, plan `2026-11-04-a1308-slice-0-bench.md` Tasks 5–6), add two timed cases for this
  PR only, run on the base and the branch on the same machine: `GET /api/working-orders/:id`
  (`apps/server/src/till-api.ts:1990`) for a 40-line bill, and `enqueueKitchenTickets`
  (`apps/server/src/kitchen-print.ts:859`) for the same bill at one station, 200 samples × 3 rounds.
  **Failing:** `bench compare` prints `slower` (median above the base's highest round median by over
  10%) on either case — the "real need" (R6) to keep the context in a side table; stop and ask the
  watcher, and the fallback is to keep `working_line_contexts` and close this PR with only item 4.
  **If slice 0's bench has not landed, stop for the watcher** (rules §5); do not build an ad hoc bench.
- [ ] **Step 3:** Write both results, with the commands, into the PR description draft.

### Task 2: The columns, CHECKs, keys and trigger lists

**Files:** `packages/db/src/schema/orders.ts`, `packages/db/triggers/core.sql`,
`packages/db/src/schema/orders.test.ts`, `scripts/behavioural-triggers.test.ts`.

- [ ] **Step 1: Write the failing tests** in `orders.test.ts`, describe `"a line's sold-as context"`:
  `"refuses a context with its menu but no unit"` (each missing member of the all-or-none set,
  one case with a loop; `working_order_lines_context_ck`); control: all set, and all null.
  `"refuses a hardware unit outside kg, g, mg"`. `"refuses a menu item, menu version, late confirmer or
  credited person that does not exist"` (foreign key; fixtures create the person first, rules §4).
  In `behavioural-triggers.test.ts`: `"a placed bill's line keeps its sold-as context"` — updating
  `menu_name` on a placed bill's line is refused with `OPEN_PARENT_REFUSAL`; the accepting control
  updates it on an open bill.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement**; add `AND new.<c> IS old.<c>` for each new column to all three pinning branches of
  the open-parent update trigger. Rebuild core.
- [ ] **Step 4: Run; PASS. Commit** `feat(db): a working line carries the context it was sold in`.

### Task 3: Write the context in the line's own insert

**Files:** `packages/venue-service/src/operations.ts`, `service.ts`; `packages/module/src/module.ts`;
the callers listed under Files; tests.

**Interfaces:**
- Produces `lineContextColumns(tx: Transaction, workingOrderId: string, lines: readonly
  LineContextInput[], offers: ZoneOffers): Promise<ReadonlyMap<string, LineContextColumns>>` on the
  `VENUE_SERVICE` seam, replacing `recordLineContexts`. `LineContextInput` is today's line argument
  (`operations.ts:1276-1285`); `LineContextColumns` is the insert shape of the new columns. It throws
  what `recordWorkingLineContexts` throws today (`department.not_found`,
  `service_zone.offer_not_allowed`).
- `copyLineContext` and `copyLineContexts` are deleted from the seam: a copy is a line insert that
  names the source row's context columns.
- `listLineContexts(tx, workingOrderId)`, `readLinesSoldInEach(tx, lineIds)`, `readLateSendMarks(tx,
  lineIds)` keep their signatures and results; they read `working_order_lines`, a line with null
  `menu_item_id` counting as "no context" as a missing side row did. If M3 dropped the `offer_`
  columns, `listLineContexts` derives `unitName` (from `units` by `unit_id`) and `categoryName`
  (`category ?? "Uncategorised"`) so its result is unchanged.

- [ ] **Step 1: Re-point the tests** (assertions unchanged): reads of `workingLineContexts` become the
  line's columns. Add `"an extra under a dish carries its own sold-in-each"` and `"a line split onto a
  new bill carries its source's context"` in `apps/server/src/working-order.test.ts`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Each caller calls `lineContextColumns` before its `insertInChunks(tx,
  workingOrderLines, rows)` and spreads the map's entry into each row; at `createOpenOrder` move
  `recordOrderContext` (`:1739-1743`) above the line insert so the department is readable. The split at
  `:4997` copies the context columns from `row`.
- [ ] **Step 4: Run** the Finish line's venue-service and server commands; PASS.
- [ ] **Step 5: Commit** `refactor(venue-service): write a line's context in the line's own insert`.

### Task 4: Delete the table; registries; finish

- [ ] **Step 1:** Delete `workingLineContexts` and its exports and classification entries; update
  `scripts/schema-constraints.test.ts`, `migrations.test.ts`, Madrid lists, the personal-data
  coverage list; reword `packages/catalogue/src/menu-structure.ts:162`'s comment to name
  `working_order_lines.menu_item_id`.
- [ ] **Step 2:** Rebuild core; Finish line; protection list against the prediction.
- [ ] **Step 3:** Grep `docs/developers/` for `working_line_contexts`; reword each sentence.
- [ ] **Step 4: Commit**, `/finish-branch`, PR, with M2 and M3 in the description.
