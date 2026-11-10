# A1308 fk9 — `ticket_items.working_order_id`: measured, then dropped or guarded: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every step also
> follows [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules").

> **2026-11-10 (watcher decision, from the owner's "make these tests periodic rather than
> automatic"):** this slice no longer builds or times a bench venue inside its own steps, and the
> stop points that read a `bench compare` result no longer apply. Instead its pull request says
> `Sale-path read changed:` and names the measurement this plan's bench steps describe, for the next
> periodic run to report. Where the slice's own correctness turns on how SQLite plans a query (an
> index choice), check that plan with `EXPLAIN QUERY PLAN` on the box image's SQLite (CLAUDE.md §4).
> See [when the bench runs](../../developers/testing-guide.md#when-the-bench-runs).

**Goal:** settle appendix §8 item 1. `ticket_items.working_order_id` is a copy of its line's bill
(`working_order_lines.working_order_id`) with no key ("Denormalised grouping key",
`packages/db/src/schema/ticket-items.ts:42-45`), rewritten on every line move
(`apps/server/src/working-order.ts:4266-4271`). R6 says a copy goes unless a measurement shows it is
needed. This pull request measures the kitchen reads with and without it on slice 0's year of
trading, then either drops the column or keeps it with triggers so the two copies cannot drift.

**Architecture:** the measurement is made on the real routes. Task 1 rewrites every read of the
column to go through the line (the column is still there and still written), Task 2 times base
against branch on the same built year, and Task 3 takes one of two branches decided in advance.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, slice 0's bench (`bench build`,
`bench measure`, `bench compare`), the slice-1a rebuild command.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) R6, §6 ("Nothing lands on reasoning
alone"), U11 ("The bench");
[appendix](../specs/2026-11-02-rationalisation/tables-floorkitchen.md) §1.17 (the `−
working_order_id` row), §5 (`ticket_items_order_idx` "goes only with its column"), §6, §8 item 1.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

**Who lands:** the lane (rules §6).

## What it builds

- Every read of `ticket_items.working_order_id` reads `working_order_lines.working_order_id` through
  the ticket's line (65 reads at `a086eedfb7`: `git grep -n -E 'ticketItems\.workingOrderId' --
  apps packages ':!*.test.ts' | wc -l`; the appendix counted 57 on `e0da0ad18a`), plus the raw SQL
  in `apps/server/src/find-bill-bills.ts:71`.
- Two bench cases the bench lacks: the pass screen's release read and the print-problem read.
- Then **one** of:
  - **Branch A (the join is not noticeably slower):** `ticket_items.working_order_id` and
    `ticket_items_order_idx` are dropped; the three ticket inserts and the line-move update stop
    writing it.
  - **Branch B (it is):** Task 1's read rewrite is reverted; the column stays, guarded by triggers
    `ticket_items_bill_matches_line_insert`, `ticket_items_bill_matches_line_update` (refuse a ticket
    whose copy differs from its line's bill) and `working_order_lines_carry_ticket_bill` (a line's
    move carries its tickets' copy with it), as the appendix's fallback says ("add a CHECK-by-trigger
    that it equals the line's bill so the two copies cannot drift").

## What it leaves out

| Left out | Owner |
| --- | --- |
| "Index the dishes not yet fired" (`docs/backlog/till.md`, bundle "Query plans and indexes, measured on a year of data") | that bundle; it is measured on the same bench year, so the watcher may add it here as a separate task |
| `ticket_items.node_id` | fk8 (§8 item 8) |
| The bill-side partial index for uncollected bills (A1370 follow-up) | the orders and sales area |

## Files

- Modify (reads): `apps/server/src/working-order.ts` (18 reads), `kitchen-print.ts` (16),
  `kitchen-allergy.ts` (5), `former-numbers.ts` (3), `order-groups.ts` (4), `station-closing.ts`
  (3), `pass-board.ts` (2), `rest-of-order.ts` (2), and one each in `delivery-release.ts`,
  `department-transfer-api.ts`, `dish-kitchen.ts`, `kitchen-release.ts`, `made-here.ts`,
  `parties.ts`, `pass-coverage.ts`, `pass-release.ts`, `station-delete.ts`, `station-move.ts`,
  `unpaid-departure.ts`, all in `apps/server/src/`; `packages/reporting/src/overdue-orders.ts:56`;
  the test helper `apps/server/src/testing/kitchen-allergy-fixture.ts:79` (the 66th read);
  `apps/server/src/find-bill-bills.ts:71`.
- Modify (bench): `apps/server/scripts/bench/measure.ts` (two cases).
- Branch A: `packages/db/src/schema/ticket-items.ts:42-45, 83`, `apps/server/src/working-order.ts:2041,
  2335, 4266-4271, 5205`; `scripts/a1308/fk9-ticket-fixtures.mjs` and `.test.mjs`.
- Branch B: `packages/db/triggers/core.sql`, `packages/db/src/trigger-refusals.ts`
  (`TICKET_BILL_REFUSAL`), `scripts/behavioural-triggers.test.ts`, `scripts/floor-kitchen-triggers.test.ts`
  (its pinned list gains the three names), `packages/db/src/schema/ticket-items.ts:42-44` (the comment
  says what now keeps the copy honest).
- Generated (uncounted): core's starting migration and the epoch file.

## Size

| Part | Counted lines |
| --- | --- |
| Read rewrite (about 66 sites; most already join the line) | 200 |
| Two bench cases | 40 |
| Branch A: schema, writers, fixture script (insert rule and test-read rule) and its test | 130 |
| Branch B instead: three triggers, refusal constant, behavioural cases with accepting controls | 110 |
| New tests (a moved line's dishes read under the new bill; Branch A's or B's) | 80 |
| Hand edits to tests (Branch A: the raw-SQL reads the script reports, at least 26, and reads it cannot rewrite) | 120 |
| **Total** | **≈ 570** (Branch A) or **≈ 430** (Branch B, the rewrite reverted) |

Uncounted: Branch A's script output: `workingOrderId` removed from `insert(ticketItems)` objects
(about 16 test files: `git grep -l "insert(ticketItems)" -- '*.test.ts' | wc -l`), and the test reads
of `ticketItems.workingOrderId` rewritten through the line (294 lines in 99 test files at
`a086eedfb7`). At least 26 more test lines read `working_order_id` on `ticket_items` in raw SQL (for
example `station-outputs-down.test.ts:166`); the script reports them and they are hand-edited.
Deletions and generated files are uncounted too.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/kitchen-print*.test.ts src/kitchen-allergy*.test.ts \
  src/pass-*.test.ts src/station-*.test.ts src/working-order*.test.ts src/order-groups*.test.ts \
  src/former-numbers*.test.ts src/rest-of-order*.test.ts src/made-here*.test.ts \
  src/unpaid-departure*.test.ts src/find-bill*.test.ts src/move-bill*.test.ts \
  src/report-api.overdue-orders.test.ts scripts/bench
pnpm --filter @waitron/reporting exec vitest run src/overdue-orders.test.ts
pnpm --filter @waitron/db exec vitest run src/schema/ticket-items.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts \
  scripts/floor-kitchen-triggers.test.ts scripts/starting-migrations.test.ts scripts/a1308
```

Plus the bench result files and `bench compare` output pasted in the pull request.

## Expected protection-list difference

Branch A, under all six venue headers unless "change-feed only":

| Table | Lines |
| --- | --- |
| `ticket_items` (§6: "read through the line") | `missing table ticket_items.columns[working_order_id]`; `changed table ticket_items.columnOrder`; `missing index ticket_items_order_idx`; change-feed only: `changed trigger waitron_change_ticket_items_update.when` |

Branch B, under all six venue headers (the triggers are in core's starting migration):

| Table | Lines |
| --- | --- |
| `ticket_items` | `extra trigger ticket_items_bill_matches_line_insert`; `extra trigger ticket_items_bill_matches_line_update` |
| `working_order_lines` | `extra trigger working_order_lines_carry_ticket_bill`; change-feed only: `changed trigger waitron_change_working_order_lines_update.order` (the compare numbers triggers on one table, timing and event by creation order, `apps/server/scripts/protection-list/compare.ts:164-185`, and the new after-update trigger is created before the feed's) |

## Stop points (beyond rules §5)

1. Slice 0's bench has not landed: this pull request waits (Task 2 cannot run).
2. Task 2's comparison lands in the stop zone defined in Task 2 Step 3 (no case fails, but one case's
   95th percentile rose by more than half): stop and let the watcher read it. By that definition a
   stop is never also a pass.
3. Branch B needs a trigger on `working_order_lines`, the orders and sales area's table: do not start
   Branch B while an orders pull request that changes `working_order_lines` is in flight (rules §7).
4. A read cannot be rewritten without changing its answer (a ticket whose line was deleted is read
   by bill: impossible today, since the line's delete cascades to the ticket, but stop if found).

## Needs

- Slice 0's second pull request (the bench), landed.
- fk8 (lane order; `scripts/floor-kitchen-triggers.test.ts` from fk6), fk0 (the splice helpers).
- Batch 1: 1a, 5.

## Assumptions

- The bench's commands and cases are as slice 0's plan, Task 5-6
  (`docs/superpowers/plans/2026-11-04-a1308-slice-0-bench.md:244-330`): `bench build --out <dir>
  [--days 360] [--bills-per-day 250] [--seed 1]`, `bench measure --venue <dir> --out <file>`, `bench
  compare --before <file> --after <file>`, and cases `kitchen.queue`, `kitchen.screen`,
  `kitchen.pass`, `kitchen.pass-screen`, `dashboard.open` (which includes the overdue report). If the
  landed bench differs, use what landed and say so.
- The design's "reference box" is the reference micro PC when one is available, otherwise one
  machine for both runs (README U11: "Pass and fail compare before and after on the same machine").
- B1, B3 as in [fk1](2026-11-08-a1308-fk1-zone-service-rules.md#assumptions-about-batch-1).

## In-flight work folded in

- A1403 (unpaid kitchen stop) and A1378 (kitchen paper) read tickets by bill and change no table;
  whichever lands second rebases and re-runs Task 1's rewrite rule on its new reads.
- The orders area's slices rewrite `working-order.ts`; a read they add after this lands follows the
  same rule (Branch A: there is no column to read).

## Global constraints

- Rules §1–§9. The measurement's pass and fail are written below before anything is timed.

## Review Focus

1. **A moved line's dishes** read under the bill they moved to, in every kitchen read. Test: Task 1's
   `a moved dish shows under its new bill on every kitchen read`.
2. **A split line** (the split's copy of the line's moves, near `working-order.ts:5213`; :5105-5116 is now
   `copyKitchenPrintLinks`) reads its new ticket under the
   right bill. Test: existing split suites, unchanged.
3. **Branch B: a direct ticket write with a wrong bill** is refused, and a line move carries every
   ticket of the line. Test: Task 3B.
4. **The overdue report** groups by the line's bill. Test: existing `overdue-orders.test.ts`,
   unchanged.
5. **Find a bill** (`find-bill-bills.ts:71`) still finds bills with kitchen work. Test: existing
   find-bill suite, unchanged.

---

## Task 0: Base protection list and base bench

- [ ] In the throwaway base worktree: `pnpm protection-list list --out <A>`; `pnpm --filter
  @waitron/server bench build --out <Y> --seed 1` (360 days, 250 bills a day: about 360,000 ticket
  items and 360,000 lines, the appendix's sizes); keep `<Y>`.

## Task 1: Reads go through the line

The rule: where a query reads `ticketItems.workingOrderId`, read `workingOrderLines.workingOrderId`
and, if the query does not already join the line, add `innerJoin(workingOrderLines,
eq(workingOrderLines.id, ticketItems.workingOrderLineId))`; a filter `eq(ticketItems.workingOrderId,
X)` or `inArray(…)` becomes the same filter on `workingOrderLines.workingOrderId`. Raw SQL
`ti.working_order_id` becomes a join to `working_order_lines` on `ti.working_order_line_id`.

- [ ] **Step 1: Write the test** `apps/server/src/kitchen-ticket-bill.test.ts`: `a moved dish shows
  under its new bill on every kitchen read` — send two dishes on bill B1, move one to B2 through the
  move route; then the station queue, the pass board, the overdue report and the kitchen paper's
  order label read that dish under B2 and the other under B1. (It passes at the base, because the
  move rewrites the copy; it must keep passing.)
- [ ] **Step 2:** Rewrite every read by the rule. Run the Finish-line server and reporting commands;
  expect pass with assertions unchanged. **Commit** ("read the ticket's bill through its line").

## Task 2: Measure (§8 item 1)

- [ ] **Step 1:** Add two cases to `apps/server/scripts/bench/measure.ts`: `kitchen.pass-release`
  (the read `releasePassItems`, `apps/server/src/pass-release.ts:51`, makes before it writes, timed
  through `POST /api/device/pass-screen/release` on a copy, as the bench's other write-adjacent
  cases are) and `print.problems` (`printersInTrouble`, `apps/server/src/print-job-trouble.ts:110`,
  through its management route), each with a test in `measure.test.ts` like the existing cases.
- [ ] **Step 2:** `bench measure --venue <Y> --out before.json` with the base commit's server code
  (in the base worktree, with the two new cases cherry-picked there), and `bench measure --venue <Y>
  --out after.json` with this branch at Task 1's commit, on the same machine; `bench compare`.
- [ ] **Step 3: Decide**, by limits written now (coordinator decision, 2026-11-08). Every comparison
  is before against after on the same machine (README U11), case by case, on the 95th percentile:
  - **A case fails** when its after-value is more than double its before-value; or, for the kitchen
    reads only (`kitchen.queue`, `kitchen.screen`, `kitchen.pass`, `kitchen.pass-screen`,
    `kitchen.pass-release`), when its before-value is under 50 ms and its after-value is above 50 ms
    (appendix §8.1: "the p95 of the station queue read more than doubles, or exceeds 50 ms"). The
    50 ms limit does not apply to `print.problems` or `dashboard.open` (three requests, one a day's
    overview report, which may already exceed 50 ms).
  - **Failing result (Branch B):** any case fails.
  - **Stop zone (stop point 2):** no case fails, but some case's after-value is more than 1.5 times
    its before-value.
  - **Passing result (Branch A):** no case fails and none is in the stop zone.
  Paste both result files and the comparison. A failing result is a stop for the watcher's
  confirmation (rules §5.4) before Branch B.

## Task 3A (passing result): drop the column

- [ ] **Step 1: Write the failing test** (`packages/db/src/schema/ticket-items.test.ts`): `ticket_items
  has no bill column` (`pragma table_info` has no `working_order_id`; `pragma index_list` has no
  `ticket_items_order_idx`).
- [ ] **Step 2:** Remove the column and the index from the schema; remove `workingOrderId` from the
  inserts at `working-order.ts:2041` and `:2335` (the copy at `:5205` spreads the old row and
  follows) and delete the update at `:4266-4271`
  (`stampSentOrderNumber` beside it stays). `scripts/a1308/fk9-ticket-fixtures.mjs` (its own rules on fk0's
  splice helpers; test and idempotence) drops the `workingOrderId` key from
  `insert(ticketItems).values({…})` objects in tests, and rewrites each test read of
  `ticketItems.workingOrderId` by Task 1's rule (adding the line join when the query has none);
  it reports raw SQL naming `working_order_id` on `ticket_items` and any query it cannot join. Run
  it, hand-edit the reports, list them. Rebuild core.
- [ ] **Step 3: Run** the Finish line; expect pass. **Commit.**

## Task 3B (failing result, confirmed): keep the column, make drift impossible

- [ ] **Step 1:** `git revert` Task 1's commit (the reads go back to the column, which stays faster).
- [ ] **Step 2: Write the failing tests** in `scripts/behavioural-triggers.test.ts`, each with an
  accepting control (the file's rule): `ticket_items_bill_matches_line_insert` refuses a ticket whose
  `working_order_id` is not its line's bill with `TICKET_BILL_REFUSAL`, and accepts the matching one;
  `ticket_items_bill_matches_line_update` refuses changing a ticket's copy to another bill, and
  accepts setting it to its line's bill; `working_order_lines_carry_ticket_bill`: updating a line's
  `working_order_id` leaves its ticket's copy equal to the new bill, and updating any other column
  of the line leaves the ticket untouched.
- [ ] **Step 3: Implement** in `core.sql`:

  ```sql
  CREATE TRIGGER ticket_items_bill_matches_line_insert BEFORE INSERT ON ticket_items
  WHEN NEW.working_order_id IS NOT (SELECT working_order_id FROM working_order_lines WHERE id = NEW.working_order_line_id)
  BEGIN SELECT RAISE(ABORT, 'a ticket''s bill must be its line''s bill'); END;
  CREATE TRIGGER ticket_items_bill_matches_line_update
  BEFORE UPDATE OF working_order_id, working_order_line_id ON ticket_items
  WHEN NEW.working_order_id IS NOT (SELECT working_order_id FROM working_order_lines WHERE id = NEW.working_order_line_id)
  BEGIN SELECT RAISE(ABORT, 'a ticket''s bill must be its line''s bill'); END;
  CREATE TRIGGER working_order_lines_carry_ticket_bill AFTER UPDATE OF working_order_id ON working_order_lines
  BEGIN UPDATE ticket_items SET working_order_id = NEW.working_order_id WHERE working_order_line_id = NEW.id; END;
  ```

  `TICKET_BILL_REFUSAL = "a ticket's bill must be its line's bill"` in `trigger-refusals.ts`. The
  explicit update at `working-order.ts:4266-4271` stays (it now writes the value the trigger already
  wrote, which the update trigger accepts). Add the three names to `scripts/floor-kitchen-triggers.test.ts`.
  Replace the column's comment (`ticket-items.ts:42-44`) with one line: the copy is kept equal to
  the line's bill by `ticket_items_bill_matches_line_*` and `working_order_lines_carry_ticket_bill`.
  Rebuild core.
- [ ] **Step 4: Run** the Finish line; expect pass. **Commit.**

## Task 4: Protection list, finish

- [ ] Protection list compare against `<A>`; paste and mark against Branch A's or Branch B's table.
  Finish line; `/finish-branch`.
