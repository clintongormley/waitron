# A1308 pa5: adjustments drop the comped-extras copy, measure the splits list, and key their people — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** `adjustments.comped_extras` goes (no product code reads it); measurement 6 decides whether
`adjustments.splits` becomes a column on `adjustment_lines` or stays as this area's one list of row
ids inside JSON; `adjustments.requested_by`, `approved_by` and `credited_to` get keys to `persons`.

**Architecture:** All three tables are in core's set (README §5 U1; the code stays in
`packages/adjustments`, the schema in `packages/db/src/schema/adjustments/`). Measurement 6 runs
first, as a throwaway probe in the one writer that records both an adjustment's splits and its
`adjustment_lines` rows; its answer picks Task 4a or Task 4b, both written here in advance.

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Vitest 4.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R4, §5 U11;
[`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md) §1.4 (`adjustments`:
"Dropped: `comped_extras`", "`splits` breaks R4"; `adjustment_lines`), §4 rows `adjustments`,
`adjustment_lines`, §5 rows `adjustments`, `adjustment_lines`, §6 ("The extras a comp zeroed"),
§7 (People: `requested_by`, `approved_by` get keys), §8 item 6. Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).

**Base:** `main` after **Needs**. Line numbers read at `a086eedfb7`.

**Who lands:** the lane (rules §6: adjustments change neither `sales` nor a hashed value; the bill's
filed lines come from `working_order_lines`, untouched here).

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported."

## Global Constraints

- Rules §1–§9 apply. Rebuild with `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- `adjustment_reasons` is not touched: its role lists become role ids in A1002's second cut, which
  also clears them when a role is deleted or retired and carries them through the configuration
  import ([A1002 plan](2026-11-08-a1002-custom-roles.md) Task 1, "place explicit role-ID JSON on
  device/reason/bill-limit owners"; [A1002 design](../specs/2026-10-22-a1002-custom-roles-design.md)
  §4, §6). `settings.adjustments` is slice 1b-ii's.
- `adjustment_refunds` is not touched: its `tender_refund_id` → `refund_id` is the orders area's
  refunds slice (`tables-ordersales.md` §1.11).
- The person keys are `restrict` (README U11: "until a row can be deleted, the key refuses
  deletion"). A fixture that invents a person id creates the person first (rules §4).
- Every assertion this plan changes or deletes is listed in its task with the reason.

## Review Focus

1. **A whole comp of a pizza with priced olives.** The olives' reduction is still recorded, now
   only in `adjustment_lines` (`apps/server/src/adjustments-apply.ts:1301-1326`). Task 2 re-points
   the B11f case to those rows.
2. **A partial comp of a dish with a free extra.** If measurement 6 passes, the free extra's split
   must still be recoverable for the receipt (`receipt-adjustments.ts:105-108, :155-156`); the probe
   is built to catch exactly the zero-reduction rows a filter drops (`adjustments-apply.ts:477, :1324-1327`).
3. **A manager approving an adjustment** whose person row exists: the key accepts it; a made-up id
   is refused. Task 3.
4. **The backup check on a restored copy.** `packages/adjustments/src/backup-verification.ts:62-90`
   now also checks the three person keys; its fixture people must exist. Task 3.
5. **A cancel**, which records an adjustment with no splits and no lines (`line-cancel.ts:403`):
   unchanged by either branch of Task 4. `line-cancel.test.ts` runs in Task 2.

## What it builds

- `adjustments.comped_extras` dropped: schema, `NewAdjustment.compedExtras`, the plan field and its
  three writes in `adjustments-apply.ts`.
- Measurement 6, early (Task 1), with its probe not committed.
- Keys `adjustments_requested_by_fk`, `adjustments_approved_by_fk`, `adjustments_credited_to_fk`
  → `persons.id`, `restrict`; the "No key yet" comment at `adjustments.ts:57` deleted.
- Either `adjustment_lines.split_from_line_id` replacing `adjustments.splits` (Task 4a), or the
  decision to keep `splits` stated at the column and in the backlog (Task 4b).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Reason role lists as role ids, their clearing and import mapping | A1002 cut 2 |
| `adjustment_settings` → `settings.adjustments` | 1b-ii |
| `adjustment_refunds.tender_refund_id` → `refund_id` | the refunds slice |
| Activity-log kinds `adjustment_reason.created/changed/deleted/reordered` (`tables-fiscal.md` §3) | follow-ups, not built in A1308 (README U11) |
| A key on `working_order_lines.credited_to` | the orders area |
| Person keys outside this area (the bundle entry "Person-id columns … have no foreign key", `docs/backlog/architecture.md:1229-1233`) | each area for its own columns; this PR does not delete the shared entry |

## Files

**Modify**
- `packages/db/src/schema/adjustments/adjustments.ts:28-58, :85-93`; (Task 4a only)
  `schema/adjustments/adjustment-lines.ts`.
- `packages/adjustments/src/record.ts:28-31, :53-88`; (4a) `:125-180` (`readBillAdjustments`).
- `apps/server/src/adjustments-apply.ts:225-229, :812, :930-935, :1049, :1449-1451`; (4a)
  `:1286, :1308, :1373-1405, :1469-1479`; (4a) `apps/server/src/order-portions.ts:203-230` (copies
  set the new column to null). `apps/server/src/receipt-adjustments.ts` is **not** modified in
  either branch: it reads `BillAdjustment.splits`, whose shape stays; 4a's order case guards its one
  order-sensitive read (`:105-108`).
- Guards: `scripts/schema-constraints.test.ts:42-43` (add three rows).
- Docs (4b): `docs/backlog/architecture.md` "## Decisions and deliberate limits" (`:1594`), one entry.

**Create:** `packages/db/src/schema/adjustments/people.test.ts`.

**Tests re-pointed:** (4a only) `packages/adjustments/src/backup-verification.test.ts:44`, whose
fixture insert names `splits` (the column goes; the split moves to an `adjustment_lines` fixture
row); `apps/server/src/adjustments-apply.test.ts:405-449`,
`apps/server/src/order-portions.adjustments.test.ts:300-323, :370-380, :485-514`,
`packages/adjustments/src/{record,backup-verification,personal-data,personal-data.coverage,reports,routes,refund-links,operations}.test.ts`,
`packages/adjustments/src/schema/adjustment-lines.test.ts`,
`packages/db/src/schema/adjustments/migrations.test.ts:167-290`,
`packages/db/src/classification.test.ts:114`.

## Size

| Part | Counted lines |
| --- | --- |
| `comped_extras`: schema, record, apply | ~20 |
| Person keys: schema, guard | ~15 |
| New tests (`people.test.ts`, re-pointed B11f case, the free-extra case) | ~110 |
| Fixtures creating people; re-pointed assertions | ~140 |
| Task 4b: column comment, backlog entry | ~15 |
| **Total, if measurement 6 fails (expected)** | **~300** |
| Task 4a instead of 4b: column, writer, reader, copies, order case, tests | +~270 → **~570** |

Uncounted: generated core files. 1½ hours (4b) or 3 hours (4a).

## Finish line

```bash
pnpm --filter @waitron/adjustments test
pnpm --filter @waitron/db exec vitest run src/schema/adjustments src/classification.test.ts
pnpm --filter @waitron/server exec vitest run src/adjustments-apply.test.ts src/order-portions.adjustments.test.ts src/draft-recall-adjustments.test.ts src/adjustments-bill-payments.test.ts src/adjustments-extra-cancel.test.ts src/adjustments-report.test.ts src/bill-editing.adjustments.test.ts src/receipt-adjustments.test.ts src/line-cancel.test.ts src/split-off-extras.split.test.ts src/draft-recall-split.test.ts src/order-portions.filing.test.ts src/order-portions.counter.test.ts src/full-comp.fiscal-identity.test.ts src/personal-data-adjustments.worked-example.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/db --filter @waitron/adjustments --filter @waitron/server typecheck
git grep -n -E 'comped_extras|compedExtras' -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'   # prints nothing
```

## Expected protection-list difference

Six venue headers (core's tables are in both compositions). Reasons: `tables-fiscal.md` §1.4
("Dropped: `comped_extras`"), §7 and README U11 (person keys), §8 item 6 (Task 4a only).

**Under all six headers** (5 lines each, 30):

```text
missing table adjustments.columns[comped_extras]
changed table adjustments.columnOrder
extra table adjustments.foreignKeys[requested_by->persons(id)]
extra table adjustments.foreignKeys[approved_by->persons(id)]
extra table adjustments.foreignKeys[credited_to->persons(id)]
```

**Under the two `change-feed` headers** (1 each, 2): `changed trigger
waitron_change_adjustments_update.when` (one term removed).

**32 lines with Task 4b.** With Task 4a instead, add under all six headers `missing table
adjustments.columns[splits]`, `extra table adjustment_lines.columns[split_from_line_id]`,
`changed table adjustment_lines.columnOrder`, and under the two `change-feed` headers `changed
trigger waitron_change_adjustment_lines_update.when` (**52 lines**; the `adjustments` `.when` line
then loses two terms).

## Stop points (beyond rules §5)

1. Task 1 prints the failing result (rules §5.4). The watcher confirms Task 4b before it is built.
2. Task 1 passes but a reader of `splits` outside `receipt-adjustments.ts` and `record.ts`
   appears (`git grep -n "\.splits\b" -- apps packages ':!*.test.ts'`).
3. An adjustment test fails with a changed value after Task 2 (not a removed `compedExtras` key).

## Needs

- **Outside this area:** slice 1a; the orders area's refunds slice (build order; it also rebuilds
  core and touches `adjustment_refunds`, so the two are not in flight together, rules §7).
- **In this area:** none; pa5 can be built in any gap between pa1–pa4.

---

### Task 0: base list

- [ ] From `apps/server`, `pnpm protection-list list --out <empty absolute dir A>` on the base.

### Task 1: measurement 6 — does every split's new row have an `adjustment_lines` row? (early)

The design: "Not established here: whether every split's new line already has an
`adjustment_lines` row … If every split has a row, `splits` becomes a `split_from_line_id` column on
`adjustment_lines`. If not, `splits` stays and is recorded as the one place this area keeps row ids
inside JSON." Read, not run: the writer drops zero reductions before writing lines
(`adjustments-apply.ts:477`, `:1324-1327`), so a carved extra priced €0.00 would give a split with no
line; this measurement is what decides.

- [ ] **Step 1: the probe** (in a scratch copy of the branch or uncommitted, reverted after). In
  `adjustments-apply.ts`, right after the `adjustment_lines` insert (`:1469-1479`):
  `const lowered = new Set(taken.map((t) => t.lineId)); const missing = splits.filter((s) => !lowered.has(s.to)); if (missing.length > 0) throw new Error(\`M6 PROBE ${JSON.stringify(missing)}\`);`
  `line-cancel.ts:403` records no splits and is not probed.
- [ ] **Step 1b: a targeted case, committed.** The suites may hold no free extra, so add to
  `adjustments-apply.test.ts`, beside B11f, "a partial comp of a dish with a free extra records the
  extra's split": a bill of Pizza × 2 with an extras item priced €0.00 added for this case only
  (through the catalogue write path the fixture already uses, `testing/adjustment-venue.ts:400-420`;
  the shared fixture's default menu is not changed); comp one pizza; assert the adjustment's
  `splits` contains a pair whose `from` is the free extra's row. It asserts what the record holds
  today, so it passes before and after; with the probe in, it is the case most likely to print
  `M6 PROBE` (a carved €0.00 row has no reduction, so no line).
- [ ] **Step 2: control first.** Temporarily push a made-up `{ from: "x", to: "y" }` onto `splits`
  before the check; run `src/adjustments-apply.test.ts`; see `M6 PROBE` failures; remove it.
- [ ] **Step 3: run** the server command in **Finish line** (every suite that applies comps and
  discounts, including the A803 portion, split-extras and draft-recall suites, and Step 1b's case). Failing result,
  stated in advance: any test fails with `M6 PROBE`. Pass: none does.
- [ ] **Step 4:** Revert the probe. Write the commands, the control's output and the result (with
  the first failing test's name and the `missing` pairs, if any) into the PR description and the
  Task 4 commit message. Failing → stop point 1, then Task 4b; passing → Task 4a.

### Task 2: `comped_extras` goes

- [ ] **Step 1: Re-point the tests** (assertions changed, each with its reason — the column is
  dropped because no product code reads it, `tables-fiscal.md` §1.4, and its facts for priced
  extras already sit in `adjustment_lines`):
  - `adjustments-apply.test.ts:405-414` "records the dish's extras row on a whole comp of the
    dish" → "lowers the dish's extras row with it on a whole comp": the adjustment's
    `adjustment_lines` include a row for each id in `extras` (Olives at €1.50 lowered to €0.00,
    `testing/adjustment-venue.ts:286`). The describe title becomes "the extras rows a whole comp
    lowers with their dish (B11f)".
  - `:416-427` keeps its other assertions; its `compedExtras` line is deleted.
  - `:429-449`: the `compedExtras: []` keys are deleted from both `toMatchObject` calls.
  - `order-portions.adjustments.test.ts:322` and `:376-377`: the `compedExtras` projection and its
    strip are deleted; `:491` deleted (nothing comped with the croquetas); `:503-514` "records both
    olives as comped extras" → "lowers both olives with the pizzas": the lowered lines that are
    extras rows, named through `ids`, are `["Olives 0.00"]` for `grouped` and
    `["Olives 0.00", "Olives 0.00"]` for `portions` (the same values the old assertion held).
  - `packages/adjustments/src/{record,backup-verification,personal-data.coverage}.test.ts` and
    `packages/db/src/schema/adjustments/migrations.test.ts:249`: the column leaves their lists and
    inserts.
- [ ] **Step 2:** Run those files: FAIL (the column still exists, or the new line read is absent).
- [ ] **Step 3:** Remove `compedExtras` from `adjustments.ts:50-52`, `record.ts:30-31, :61`, and
  `adjustments-apply.ts:228, :812, :930-935, :1049, :1451`. Rebuild core.
- [ ] **Step 4:** Run the **Finish line**'s adjustments, db and server commands: PASS. Commit
  `git commit -s -m "adjustments: drop the comped-extras copy; the lowered lines already hold it"`.

### Task 3: the three person keys

- [ ] **Step 1: Write the failing test** `packages/db/src/schema/adjustments/people.test.ts`
  (`useVenueDb` with `CORE_MIGRATIONS`): "accepts an adjustment whose requester, approver and
  credited person exist"; "refuses each of the three naming nobody" (`it.each` over the three
  columns, `isRefusal(error, FOREIGN_KEY_VIOLATION)`); "an approver and a credited person may be
  empty" (null accepted).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Add the three keys (`restrict`) in `adjustments.ts:85-93`; delete the comment at
  `:57`. Add `["adjustments", ["requested_by"], "persons"]`, `["adjustments", ["approved_by"],
  "persons"]`, `["adjustments", ["credited_to"], "persons"]` to `scripts/schema-constraints.test.ts`.
  Rebuild core.
- [ ] **Step 4:** Fixtures: every test in **Files** that inserts an adjustment with an invented
  person id (`randomUUID()`, `"requester"`, `"approver"`, `"former-person"`) seeds those persons
  first with the package's existing person seed (`packages/adjustments/src/reports.test.ts:59`
  shows the insert); `packages/adjustments/src/backup-verification.test.ts:44` seeds them in both
  the before and after databases so `referencesValid` (`backup-verification.ts:62-90`) still
  passes. No expected value changes.
- [ ] **Step 5:** Run the **Finish line**: PASS. Commit
  `git commit -s -m "adjustments: requester, approver and credited person are keys to persons"`.

### Task 4a (only if measurement 6 passed): `splits` becomes `adjustment_lines.split_from_line_id`

**Interfaces:**
- `adjustmentLines.splitFromLineId: id("split_from_line_id")` (null; no key, as `line_id` has
  none, `adjustment-lines.ts:5-9`).
- The writer (`adjustments-apply.ts:1469-1479`) writes, for each `taken` row, the `from` of the
  split whose `to` is that row's `lineId`, else null. `order-portions.ts:203-230`'s copies write
  null (a copy is not the adjustment's own split).
- `readBillAdjustments` (`record.ts:148`) keeps returning `splits: AdjustmentSplit[]`, built from
  `select line_id, split_from_line_id from adjustment_lines where adjustment_id in (…) and
  split_from_line_id is not null order by rowid` — insertion order, which is `taken`'s order
  (`adjustments-apply.ts:1469-1479`), not today's `splits` order (carved rows, then second prices,
  then row splits, `:1286, :1308, :1405`). The receipt's only order-sensitive read is
  `record.splits.find((split) => split.from === record.lineId)` (`receipt-adjustments.ts:107`); the
  writer therefore inserts, for a line that is the `from` of more than one split, the carved part's
  row first. `receipt-adjustments.ts` does not change.
- `NewAdjustment.splits` stays as the writer's input; `adjustments.splits` (column) and the
  `AdjustmentSplit` storage type's column go.

- [ ] **Step 1:** failing tests in `packages/adjustments/src/record.test.ts`: "reads each split back
  from the lowered line it made" (an adjustment recorded with two splits and their lines returns
  the same pairs from `readBillAdjustments`); "a copied line carries no split"; and in
  `apps/server/src/receipt-adjustments.test.ts`, "a part comped off a line that also splits into
  two prices prints on the carved row" (one line is the `from` of a carve and a second-price split;
  the receipt places the comp on the carved row, as today).
- [ ] **Step 2:** Implement; rebuild core; every suite in **Finish line** passes with unchanged
  assertions on `splits` (they read through `readBillAdjustments` or the receipt).
- [ ] **Step 3:** Commit.

### Task 4b (if measurement 6 failed, after the watcher confirms): `splits` stays

- [ ] **Step 1:** Replace the comment at `adjustments.ts:47-49` with the decision, stated at its
  site: "Row ids inside JSON, the one place adjustments keep them (design R4): a split's new row can
  have no `adjustment_lines` row — measurement 6, A1308 pa5. No key: a cancel deletes the line."
- [ ] **Step 2:** Add under `docs/backlog/architecture.md` "## Decisions and deliberate limits"
  one entry: "`adjustments.splits` keeps row ids inside JSON (A1308 pa5, measurement 6)", with the
  first failing case and that configuration import never carries adjustments, so the R4 import cost
  does not apply. Commit.

### Task 5: protection list and finishing

- [ ] Protection list after (`--out <B>`), `compare`, paste and mark against the 32-line (4b) or
  52-line (4a) prediction. `/finish-branch`.
