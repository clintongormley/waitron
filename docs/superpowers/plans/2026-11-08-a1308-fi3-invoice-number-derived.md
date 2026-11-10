# A1308 fiscal 3: the next invoice number is read from the sales — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **2026-11-10 (watcher decision, from the owner's "make these tests periodic rather than
> automatic"):** this slice no longer builds or times a bench venue inside its own steps, and the
> stop points that read a `bench compare` result no longer apply. Instead its pull request says
> `Sale-path read changed:` and names the measurement this plan's bench steps describe, for the next
> periodic run to report. Where the slice's own correctness turns on how SQLite plans a query (an
> index choice), check that plan with `EXPLAIN QUERY PLAN` on the box image's SQLite (CLAUDE.md §4).
> See [when the bench runs](../../developers/testing-guide.md#when-the-bench-runs).

**Goal:** Drop `invoice_series.next_number`, the stored counter, and allocate each invoice number as
the series' largest issued number plus one, read from `sales`; settle the A805 follow-up for
`invoice_series` with a database guard that lets only `retired_at` change, once. Measure first, with
the fallback (keep the counter) decided in advance.

**Architecture:** Every allocated number becomes a `sales` row in the same transaction
(`packages/core/src/record-sale.ts:270`, `record-correction.ts:265`, `record-substitution.ts:171`,
each followed by `insertSale`), `sales` is append-only, and `UNIQUE (series_id, invoice_number)`
already refuses a reused number whatever allocated it (`packages/db/src/allocate-number.ts:24-27`).
So `coalesce(max(invoice_number), 0) + 1` over the series, read in the same serial write
transaction, gives today's number; a rollback returns it exactly as today. `invoice_series` stays a
table (core, both fiscal modules number sales). A hand-written trigger in core's trigger file holds
a series fixed after creation except its one-time retirement.

**Tech stack:** TypeScript, drizzle-orm on `node:sqlite`, Vitest; slice 0's bench and fi2's
`bench grow-fiscal`.

**Spec:** [tables-fiscal.md](../specs/2026-11-02-rationalisation/tables-fiscal.md) §0.2, §1.2
(`invoice_series`), §5 (`invoice_series` rows), §6, §8 item 1; README "Additions of 6 November
2026" (`invoice_series`: "Settle the remaining delete or update refusal", landed by the owner);
[`docs/developers/grants-retirement-audit.md`](../../developers/grants-retirement-audit.md):145-146
("inspect column-scoped updates and allocation separately"); rules
[2026-11-08-a1308-slice-rules.md](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after fi2. Line numbers read at `a086eedfb7`.

**Owner lands:** yes (rules §6: invoice numbering).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply.
- **No sale gets a different number.** For every allocation path, the number allocated equals what
  the counter would have given: strictly increasing per series, starting at 1, a rolled-back number
  given again. fi1's record suites and the core recording suites pin it.
- One allocation is always followed by its `sales` insert before the next allocation from the same
  series in the same transaction. The three callers do this today; the function's comment states it
  as the invariant, and the unique key on `sales` stays the backstop.
- Measurement before code (Task 1).

## Review Focus

1. **Two allocations before one insert.** If any caller allocated twice before inserting, both would
   get the same number and the second insert would be refused. Task 2's "two sales in one
   transaction" case and a `git grep -n allocateInvoiceNumber` read check it.
2. **Tests that "advanced the counter".** About a dozen restore and hour-recovery tests set
   `next_number` to 123, 456, 777 or 917 to prove a restore keeps or discards progress. They now
   advance by inserting one sale numbered one below; their assertions stay
   (`restore-emergency-crash.e2e.test.ts:772` still expects 917).
3. **The guard refusing a legitimate write.** Retirement (`retireNodeSeriesTx`,
   `packages/db/src/reserved-identity.ts:119-127`; `allocation.ts:455-458`) must still pass.
4. **A correlated subquery that binds to the wrong table.** `nextInvoiceNumberOf(invoiceSeries.id)`
   inside `.select(…).from(invoiceSeries)` is the CLAUDE.md §3 trap: drizzle renders a column of
   the `.from()` table as a bare `"id"`, which the subquery binds to `sales`' own columns. Task 2's
   "answers 4, not 1" case and the script's refusal (Task 3) check it; a reviewer reads the emitted
   SQL with `.toSQL()`.

---

## What it builds

- `allocateInvoiceNumber(tx, seriesId)` reads instead of updating; `series.not_found` unchanged.
- `nextInvoiceNumberOf(seriesId)`, a SQL expression exported from `@waitron/db`, used by the
  allocator and by tests that read "the series' next number". It names every column with its table
  in full (`"sales"."invoice_number"`, `"sales"."series_id"`, and for a column argument
  `"invoice_series"."id"` or the alias's name), never through a bare `${column}`, because drizzle
  renders a column of the outer query's `.from()` table without its table, and the subquery then
  compares `sales`' own columns (CLAUDE.md §3, "A `sql` scalar subquery correlated to the OUTER
  query's table"; `docs/developers/conventions-data.md:406-411`).
- `invoice_series.next_number` and `invoice_series_next_number_ck` dropped; its `>= 1` guarantee is
  `sales_invoice_number_ck` (`packages/db/src/schema/sales.ts:148`).
- The backup evidence check loses its counter comparison (`backup-evidence.ts:280`); the node check
  stays.
- Trigger `invoice_series_guard_update` in `packages/db/triggers/core.sql`: refuses any update that
  changes `id`, `node_id`, `code` or `purpose`, or that changes `retired_at` once it is set. The
  A805 decision for `invoice_series`, stated at the trigger and in the audit:
  - **UPDATE:** only `retired_at`, from empty to a time, once. Why: a sale's printed and filed
    number is built from its series' code (`formatInvoiceNumber`, `record-sale.ts:105`), so a
    changed code would make a reprint disagree with the filed record, and an un-retired series
    would number again after a restore opened its replacement.
  - **DELETE:** no trigger. A series that numbered any sale cannot be deleted: `sales.series_id` and
    `verifactu_series_conflicts.series_id` are foreign keys with no delete action. An unused series
    holds no number, so deleting it loses nothing; test set-ups that delete one keep working.
- Measured: the number half of tables-fiscal §8 item 1.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The order-number counter (`working_order_counters`) | The orders-and-sales slice (design U6) |
| The chain head | fi2 |
| `scripts/a799/` facts (`nextNumber` there is a field of an external comparison format, `facts.mjs:158`) | Unchanged: not this table |

## Interfaces

```ts
// packages/db/src/allocate-number.ts, re-exported from "@waitron/db"
/**
 * `(select coalesce(max("sales"."invoice_number"), 0) + 1 from "sales" where "sales"."series_id" = <seriesId>)`.
 * A column argument is rendered `"<its table or alias>"."<its name>"`; a string is a bound value.
 */
export function nextInvoiceNumberOf(seriesId: AnyColumn | string): SQL<number>;
/** Reads the next number. The caller inserts the sale under it before allocating again. */
export function allocateInvoiceNumber(tx: Transaction, seriesId: string): Promise<number>;

// packages/db/src/trigger-refusals.ts
export const INVOICE_SERIES_CHANGE_REFUSAL = "invoice_series: only retired_at may be set, once";

// apps/server/src/testing/advance-series.ts (test-only; apps/server excludes src/testing from coverage, vitest.config.ts:43)
/** Inserts, for each live series of the node, one sale numbered `nextNumber - 1`. */
export function advanceSeriesTo(db: Database, nodeId: string, nextNumber: number): Promise<void>;
```

## Files

**Modify**
- `packages/db/src/allocate-number.ts` (all), `packages/db/src/index.ts:284`.
- `packages/db/src/schema/series.ts:13-21` (comment), `:30`, `:44`.
- `packages/db/src/backup-evidence.ts:280`.
- `packages/db/src/reserved-identity.ts:40`, `:115-118` (comment: the update is now guarded),
  `:131` (comment).
- `packages/db/src/immutability.sql.md:54-55`, `packages/provisioning/README.md:284`,
  `apps/server/src/errors.ts:1683` (each sentence that says the counter exists).
- `packages/db/triggers/core.sql` (the trigger), `packages/db/src/trigger-refusals.ts`.
- `packages/fiscal-verifactu/src/testing/seed.ts:106` (drop `nextNumber: 1`).
- `apps/server/src/testing/staged-hour-crash.ts:156`, `:279`, `:288`;
  `apps/server/src/testing/staged-hour-restore.ts:147`, `:269`, `:282`;
  `apps/server/test/hour-recovery-host.ts:207` (each `set({ nextNumber: N })` becomes
  `advanceSeriesTo(…, N)`).
- `scripts/behavioural-triggers.test.ts` (the trigger's cases), `scripts/schema-constraints.test.ts`
  (`invoice_series_next_number_ck` leaves its list).
- Tests that read or seed the counter (about 110 files name `nextNumber` or `next_number` for this
  table at `a086eedfb7`; a `nextNumber: 1` in an insert is deleted, a read becomes
  `nextInvoiceNumberOf(invoiceSeries.id)` under the same property name).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (the capture's `next_number`).

**Create**
- `apps/server/src/testing/advance-series.ts`.
- `scripts/a1308/fiscal-next-number.mjs` — a re-pointing script (rules §1): in tracked `.ts` files
  under `apps/` and `packages/`, every `invoiceSeries.nextNumber` that is a value inside a
  `.select({ … })` object becomes `nextInvoiceNumberOf(invoiceSeries.id)` (adding the import from
  `@waitron/db`), and every `nextNumber: <literal>` property inside a `.values({ … })` call on
  `invoiceSeries` is removed. Same parser and idempotence rules as fi1's script; it prints every
  site it could not classify, and those are hand edits listed in the pull request.
  **It refuses the correlated shape** (exit 1, printing `file:line`, in both write and `--check`
  modes): any `sql` tagged template in the files it reads whose text has a `select` and a
  `from ${sales}` (or `from sales`) and which interpolates a column of `invoiceSeries` (or of an
  alias of it) directly, rather than through `nextInvoiceNumberOf`. That is the shape that renders
  `where "series_id" = "id"` and answers from `sales`' own row. The refusal has a fixture test
  (below) and its control: the same text through `nextInvoiceNumberOf` passes. Raw SQL strings
  naming `next_number` on `invoice_series` are hand edits:
  `git grep -n "next_number" -- '*.test.ts' | /usr/bin/grep invoice_series` printed 33 lines at
  `a086eedfb7`. A read (for example `apps/server/src/unpaid-departure.test.ts:258`) becomes
  `(select coalesce(max(sales.invoice_number), 0) + 1 from sales where sales.series_id = invoice_series.id) as <the same name>`,
  with the outer table named in full for the same reason; an insert loses the column (Task 3
  Step 2); an update that moves the counter (`backup-evidence.test.ts:334`, `:346`,
  `payments-api.stuck.test.ts:1488`, `backup-verification.installed.test.ts:235`,
  `recover-provisioned-venue.test.ts:56`) becomes `advanceSeriesTo` or, where it only proved the
  counter could drift from the sales, goes with that case (Task 3 Step 3), named in the pull
  request. Two are comments in the fiscal pair, `packages/fiscal-verifactu/src/write-path.e2e.test.ts:310`
  and `:435` (at `a086eedfb7`: "reverts `invoice_series.next_number` and the `cadenas` head"; fi2
  cuts the `cadenas` half): after this plan the rollback reverts only the sale and record rows, so
  both comments drop `invoice_series.next_number`, a comment-only hand edit to the pair named in
  the pull request; no assertion in the pair changes.

**Generated:** `packages/db/drizzle/*`, `scripts/migration-baseline-epoch.json`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: allocator 25, schema and comments 15, backup check 2, trigger 15, refusal constant 2, test helper 40 | ~100 |
| Script 145 (with the correlated-shape refusal) | ~145 |
| Tests: allocator cases 85 (with the column-form and alias cases), script fixtures 30, trigger cases 70, counter set-ups converted 40, raw-SQL sites the script cannot reach 80 (33 lines found), plan test 40, demo capture 15 | ~360 |
| **Total** | **~605** |

Not counted: the script's output, deleted `nextNumber: 1` properties, the generated migration.

## Finish line

```bash
node scripts/a1308/fiscal-next-number.mjs --check    # nothing to change
pnpm --filter @waitron/db exec vitest run src/allocate-number.test.ts src/schema/series.test.ts src/reserved-identity.test.ts src/backup-evidence.test.ts
pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts src/record-correction.test.ts src/record-substitution.test.ts src/record-void.test.ts src/issuance-refusal.test.ts
pnpm --filter @waitron/server exec vitest run src/restore-emergency-crash.e2e.test.ts src/restore-emergency-attempts.test.ts src/hour-recovery-placement-1.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts src/restore-operation-placement.test.ts src/transactional-series.test.ts src/till-sale-integrated.db.test.ts src/invoice-selection.test.ts src/restore.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/venue-series-owner.test.ts src/first-setup-activation.test.ts
# and fi1's record suites
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -nw "next_number\|invoice_series_next_number_ck" -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts' ':!scripts/a799/**' ':!packages/db/src/allocate-order-number.ts' ':!packages/db/src/schema/working-order-counters.ts'
```

The grep prints nothing. The two excluded files are the order-number counter's, whose own column is
also `next_number` (`working-order-counters.ts:10`, and the comment at `allocate-order-number.ts:13`);
the orders-and-sales slice os1 deletes the first and rewrites the second, so on fi3's base the
exclusions may match nothing. CI runs the remaining package suites (CLAUDE.md §2). And Task 1 and Task 5's
measurements pass as stated.

## Expected protection-list difference

Six headers: both compositions (`fiscal-none`, `fiscal-verifactu`) × the three phases, all
`database=venue`. Under `phase=sql-only` and `phase=migrated`, these five lines (four entries), in
this order:

```text
changed table invoice_series.columnOrder
old: ["id","node_id","code","purpose","next_number","retired_at"]
new: ["id","node_id","code","purpose","retired_at"]
missing table invoice_series.columns[next_number]
missing table invoice_series.checks[invoice_series_next_number_ck]
extra trigger invoice_series_guard_update
```

Under `phase=change-feed`, for both compositions, the same plus the live-update trigger's column
list, between the `checks` line and the `extra` line:

```text
changed trigger waitron_change_invoice_series_update.when
old: new."id"is not old."id"or new."node_id"is not old."node_id"or new."code"is not old."code"or new."purpose"is not old."purpose"or new."next_number"is not old."next_number"or new."retired_at"is not old."retired_at"
new: new."id"is not old."id"or new."node_id"is not old."node_id"or new."code"is not old."code"or new."purpose"is not old."purpose"or new."retired_at"is not old."retired_at"
```

`invoice_series` is a live-update source: every table core classifies is one except the three
named in `NOT_CHANGE_SOURCES` (`packages/db/src/classification.ts:490-494`), and
`invoice_series` is classified at `:113`. A run of `pnpm protection-list list` on `a086eedfb7`
showed `waitron_change_invoice_series_insert`, `_update` and `_delete` under both compositions'
`phase=change-feed`, the update trigger's `when` naming `next_number`. The trigger's `order` does
not change: the new guard is the only `BEFORE UPDATE` trigger on the table, and the tool numbers
triggers within one table, timing and event (`compare.ts:165-185`).

How these lines were produced (a prediction, not a run of the branch): the `a086eedfb7` list with,
in every venue entry, `next_number` and its CHECK removed from `invoice_series`, the
`next_number` comparison removed from the update trigger's `when`, and a `BEFORE UPDATE` trigger
`invoice_series_guard_update` added; then `pnpm protection-list compare` against the unchanged
list. It printed exactly the lines above, in that order, under the six headers. The trigger appears
under `phase=sql-only` too, because core's hand-written triggers are part of its starting migration
(rules §2). Design reasons: tables-fiscal §5 ("CHECK `next_number >= 1` | Dropped with the column;
`sales_invoice_number_ck` (`>= 1`) holds the same guarantee"); README "Additions of 6 November
2026" for the trigger; the change-feed line follows the column (rules §3).

## Stop points (beyond rules §5)

1. **Measurement fails** (rules §5.4). Fallback, confirmed by the watcher first: keep `next_number`
   and the updating allocator; the pull request keeps only the guard (with `next_number` added to
   the columns an update may change, and the reason at the trigger) and records the measurement.
2. Any change to the bytes of a record's hashed fields, to what is sent to AEAT, or to which series
   or number a sale gets: any of fi1's record suites or the core recording suites fails.
3. `git grep -n "allocateInvoiceNumber("` finds a caller that does not insert its sale before another
   allocation can happen.
4. A converted counter test still fails after `advanceSeriesTo` (for example a backup or restore
   check that now sees a sale with no fiscal record): report which check; do not change its
   assertion.
5. The guard refuses a write a product path makes.

## Needs

fi2 (and its `bench grow-fiscal`). Slice 1a's `packages/db/triggers/core.sql`. Slice 0's bench,
on branch `feat/a1308-s0-bench` (not on `main` on 2026-11-08), lands before fi2 and so before this.

**Landed by: owner.**

---

### Task 0: record the base protection list

- [ ] As fi1 Task 0, into `<A>`.

### Task 1: measure before writing the code (tables-fiscal §8 item 1, number half)

- [ ] **Step 1: The base venues.** If fi2's "after" venues were built on a commit whose schemas
  equal this base (`git diff --quiet <that-sha> <base-sha> -- 'packages/*/src/schema' 'packages/*/drizzle'`),
  reuse them and fi2's after-measurements as this pull request's "before". Otherwise build and grow
  as fi2 Task 1 Step 4 on the base.
- [ ] **Step 2: Plan the derived read** on both venues with `node:sqlite` (never the `sqlite3`
  command line):

  ```bash
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});
  const s=db.prepare("select series_id from sales group by series_id order by count(*) desc limit 1").get().series_id;
  console.log(db.prepare("explain query plan select coalesce(max(invoice_number), 0) + 1 from sales where series_id = ?").all(s).map(r=>r.detail));' <venue>/venue.db
  ```

  **Passing:** one line, `SEARCH sales USING COVERING INDEX <the unique index on (series_id, invoice_number)> (series_id=?)`
  (today `sales_series_invoice_number_key`, `packages/db/src/schema/sales.ts:122`; the
  orders-and-sales slice may have renamed it). **Failing:** `SCAN sales`. A failing result is stop 1.
- [ ] **Step 3: Time the allocation alone** on both base venues with `node:sqlite`, as fi2 Task 1
  Step 6 (prepared once, 100 unmeasured runs, then 10,000, median per call), inside a transaction
  rolled back at the end so the counter is left as it was: today's
  `update invoice_series set next_number = next_number + 1 where id = ? returning next_number`.
  Keep the median for Task 5. A route's timing is too coarse to rely on for one statement (fi2,
  Review Focus 3), so route timings are reported, not judged.

### Task 2: the allocator (test first)

**Files:** `packages/db/src/allocate-number.ts`, `allocate-number.test.ts`, `src/index.ts`.

- [ ] **Step 1: Failing tests** in `allocate-number.test.ts` (existing cases keep their assertions):
  - "the first number of a new series is 1"; "after sales numbered 1–3 it is 4";
  - "read beside its series it answers 4, not 1": two series, A with sales numbered 1–3 and B with
    none; `tx.select({ code: invoiceSeries.code, next: nextInvoiceNumberOf(invoiceSeries.id) }).from(invoiceSeries).orderBy(invoiceSeries.code)`
    answers `[{ code: A, next: 4 }, { code: B, next: 1 }]`, and the statement's `.toSQL().sql`
    contains `"sales"."series_id" = "invoice_series"."id"`. The shape written with a bare
    `${seriesId}` answers 1 for A (the failing case this test exists for);
  - the same through an alias (`alias(invoiceSeries, "s")`): A answers 4;
  - "a rolled-back sale's number is given again": allocate and insert inside a transaction that
    throws; the next allocation returns the same number;
  - "two sales recorded in one transaction get consecutive numbers": `recordSale` twice in one
    `withTransaction`; numbers n and n+1;
  - "reads only": `select name from pragma_table_info('invoice_series') where name = 'next_number'`
    is empty and the allocator's statement is a `select` (capture it as fi2's plan test does);
  - "an unknown series is refused `series.not_found`" (existing, unchanged).
- [ ] **Step 2:** `pnpm --filter @waitron/db exec vitest run src/allocate-number.test.ts`. FAIL.
- [ ] **Step 3: Implement** `nextInvoiceNumberOf` and the allocator: check the series exists
  (`series.not_found`), then `select ${nextInvoiceNumberOf(seriesId)}`. Name every column in full,
  as `apps/server/src/floor-today-store.ts:1120` does
  (`` (table, name) => sql`${table}.${sql.identifier(name)}` ``); for a column argument, the table is
  `getTableName(column.table)` (an alias's name for an alias). What was run when this plan was
  written (drizzle-orm 0.45.4, the workspace's copy, through its `sqlite-proxy` driver on a
  `node:sqlite` database with series `s1` and sales numbered 1–3, a scratch script outside the
  repository): the bare-interpolation shape rendered
  `select (select coalesce(max("invoice_number"), 0) + 1 from "sales" where "series_id" = "id") from "invoice_series"`
  and answered 1; the fully named shape rendered
  `… where "sales"."series_id" = "invoice_series"."id") from "invoice_series"` and answered 4; with
  `alias(invoiceSeries, "s")` it rendered `"sales"."series_id" = "s"."id"`. With a string id both
  shapes bound it and answered 4, so only the column form shows the difference. Rewrite the function comment
  from the current one (`:11-29`): keep the rollback and regulation paragraphs, replace "One
  statement … cannot be separated" with the invariant "the caller inserts the sale under this number
  before allocating again; `sales_series_invoice_number_key` refuses a reuse whatever happens".
  Drop the column and the CHECK from `schema/series.ts` and rewrite its comment (`:13-21`): the
  next number is the series' largest sale number plus one.
  `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4:** Run the Step 2 file and the core recording suites of the Finish line. PASS.
- [ ] **Step 5:** Commit: "Allocate invoice numbers from the series' sales (A1308 fiscal 3)".

### Task 3: re-point what read or set the counter

- [ ] **Step 1:** Write `scripts/a1308/fiscal-next-number.mjs` (Files) with fixture tests in a
  sibling `.test.mjs`: a `.select` re-pointed with its import added; a `.values` property removed;
  idempotent; it refuses `` sql`(select max(${sales.invoiceNumber}) from ${sales} where ${sales.seriesId} = ${invoiceSeries.id})` ``
  naming its line; control: the same read written `nextInvoiceNumberOf(invoiceSeries.id)` passes.
  Run it; commit its output alone.
- [ ] **Step 2:** Write `advanceSeriesTo` (insert through `insertSale` from `@waitron/core`, one sale
  per live series of the node, `invoiceNumber: nextNumber - 1`, other fields fixed test values).
  Convert the seven `set({ nextNumber: N })` sites (Files) and the sites the script printed. Raw SQL
  inserts naming `next_number` (`git grep -n "next_number) values"`) lose the column; one with a
  value other than 1 also inserts the sales that value implies.
- [ ] **Step 3:** `backup-evidence.ts:280` keeps `s.node_id <> i.node_id` and loses the counter
  condition; its test case for a counter behind the sales goes (its table column no longer exists:
  list it in the pull request).
- [ ] **Step 4: The demo capture.** The capture's `invoice_series` rows hold `next_number` (3 rows in
  `provisioned` and `seeded`). Drop the column from the expected capture the way earlier slices
  dropped columns (a dropped-column adapter beside `RENAMED_COLUMNS`), asserting first that each
  captured value equals 1 + the largest captured sale number of that series (no sales: 1).
- [ ] **Step 5:** Run the Finish line's server, provisioning and fiscal lines. PASS. Commit:
  "Tests read the next number from the sales (A1308 fiscal 3)".

### Task 4: the series guard (A805)

- [ ] **Step 1: Failing cases** in `scripts/behavioural-triggers.test.ts`, on a database migrated
  through `applyMigrations` as the file already does: changing a series' `code`, `purpose`,
  `node_id` or `id` each raises `INVOICE_SERIES_CHANGE_REFUSAL`; setting `retired_at` on a retired
  series raises it; clearing `retired_at` raises it. Accepting controls: `retireNodeSeriesTx` on a
  live series succeeds; deleting a series no sale names succeeds; deleting one a sale names fails
  with a foreign-key error (the decision that no delete trigger is needed).
- [ ] **Step 2:** Run it. FAIL.
- [ ] **Step 3:** Add to `packages/db/triggers/core.sql`:

  ```sql
  CREATE TRIGGER invoice_series_guard_update BEFORE UPDATE ON invoice_series
  WHEN new.id IS NOT old.id OR new.node_id IS NOT old.node_id OR new.code IS NOT old.code
    OR new.purpose IS NOT old.purpose
    OR (old.retired_at IS NOT NULL AND new.retired_at IS NOT old.retired_at)
  BEGIN SELECT RAISE(ABORT, 'invoice_series: only retired_at may be set, once'); END
  ```

  as its own statement, separated by a `--> statement-breakpoint` line like the file's others (the
  file holds statements only, with no comments: slice 1a's `readTriggers` parses each one). The why
  goes on the constant in `trigger-refusals.ts` as a comment: the printed number is built from the
  code, a restore's retirement is final, and delete is left to the foreign keys from `sales` and
  `verifactu_series_conflicts`. Rebuild core. Update the comment at
  `reserved-identity.ts:115-118` ("Nothing in the database refuses this update" is no longer true:
  the guard allows exactly this update).
- [ ] **Step 4:** Run it and `scripts/starting-migrations.test.ts`. PASS. Commit: "Hold an invoice
  series fixed except its one retirement (A1308 fiscal 3, A805)".

### Task 5: measure after, compare, finish

- [ ] **Step 1:** Build, grow and plan on this branch as fi2 Task 5 Step 1 (the Task 1 query), and
  time the derived read alone as Task 1 Step 3 (the Task 1 query, same counts). **Failing**, either
  of: `SCAN sales` in the plan; or, at either size, the derived read's median per call more than
  twice the base statement's. That is stop 1. Then `pnpm bench compare` at both sizes, reported
  (with `sale.counter` and `payment.final` named), not judged.
- [ ] **Step 2:** Protection list: compare with `<A>`; exactly "Expected protection-list difference".
  Paste it, the read medians and both compare tables into the pull request.
- [ ] **Step 3: Documents** (rules §9): tables-fiscal.md §8 item 1, a dated line with the result;
  delete "`invoice_series`: decide the remaining UPDATE/DELETE restriction (A805 follow-up)" from the
  bundle in `docs/backlog/architecture.md`; add to `grants-retirement-audit.md` after `:144`:
  "**2026-11-xx:** `invoice_series` was settled by A1308 fiscal 3: an update may only set
  `retired_at`, once (`invoice_series_guard_update`); a delete is refused by the foreign keys from
  `sales` and `verifactu_series_conflicts` once any sale names the series." In
  `docs/developers/conventions-data.md`, any sentence about the counter says the number is read
  from the sales: at `a086eedfb7` `git grep -nw next_number -- docs/developers` finds
  `conventions-data.md:5392` ("`invoice_series.next_number` carries across …", the reason for one
  database per environment), which becomes "an invoice series' numbering (its largest sale number)
  carries across …", and `grants-retirement-audit.md:19`, historical, left alone.
- [ ] **Step 4:** Commit; `/finish-branch` (full wave). After landing, `wa-wt reset` the dev slots and
  the Santet venue.
