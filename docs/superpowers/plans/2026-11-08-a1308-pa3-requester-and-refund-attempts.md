# A1308 pa3: who started a card payment, the provider's refund record, and the reconciliation ledger's name — implementation plan

> **2026-11-12, payment decisions recorded by the watcher at 11:38:** the owner answered
> "Yes, one way" to every whole or part payment using the Pay window's route; the counter's quick
> sale becomes "save, then pay" in one request. For a bill comped to €0.00, "Comp closes it": the
> comp that brings it to zero closes it and files the €0.00 invoice at once. For part payments on a
> presented bill, "Yes, allow parts". For a card confirmed long after payment (22:50 timeout,
> confirmed 09:00), the owner asked "surely we would have cancelled the order the same day?";
> build nothing special for it. The record is `~/waitron-campaign-e/questions.md`, 2026-11-12 11:38,
> answering Fable R5 §3 (`~/waitron-campaign-m/reports/r5.md`). Before building os12, pa3 or pp11,
> rewrite those plans for one payment route. A "one way to pay" slice comes before os12; the
> watcher will assign it to a lane when the payment slices approach.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** `payments` records who started each card payment (`requested_by`); `payment_refunds`
becomes append-only, loses the two columns it copied from its payment and gains a key on
`authorized_by`; `scheduled_runs` is renamed `reconciliation_runs`.

**Architecture:** Three small changes to the payments set, landed together to save a venue reset.
`requested_by` travels on the existing payment-start parameters (`CollectParams`, `InitiateParams`,
the manual-card parameters) down to `insertPayment`, and pa1's guard trigger holds it fixed.
`payment_refunds` is already insert-only in product code, so declaring it `appendOnly()` changes no
writer. The rename is done by a committed, idempotent script (rules §1).

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Node script
(`.mjs`), Vitest 4.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §5 U9 (`scheduled_runs` →
`reconciliation_runs`), U11 (person keys); [`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md)
§1.3 (`requested_by`; `payment_refunds`), §5 (`payment_refunds` row), §6 (the refund's copied
provider and reference); [`tables-venuebox.md`](../specs/2026-11-02-rationalisation/tables-venuebox.md)
§1.15 and §5 (`scheduled_runs_key` "kept on `reconciliation_runs`, the unique key renamed to
match"); [`jobs.md`](../specs/2026-11-02-rationalisation/jobs.md) R2 ("Each provider keeps one
stable key on those rows, `payments.reconcile.stripe` today"); [`tables-people.md`](../specs/2026-11-02-rationalisation/tables-people.md)
§7 "payments area". Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).

**Base:** `main` with pa1 landed (pa2 may or may not have landed; nothing here depends on it). Line
numbers read at `a086eedfb7`.

**Who lands:** the lane (rules §6: none of its tables is fiscal).

**Pull request's first line:** "Every venue is reset: payments; backups and exports from before
this cannot be restored or imported." The description also says that `payment_refunds` is newly
marked append-only, so a box's first start after it could raise `append_only.triggers_restored`
(CLAUDE.md §3); every venue is reset, so none will.

## Global Constraints

- Rules §1–§9 apply. Rebuild with `pnpm --filter @waitron/server migration-baseline rebuild --set payments`.
- The reconciliation duty's stored key never changes: `payments.reconcile.${reconciler.provider}`
  (`apps/server/src/reconcile-duty.ts:19`), `RECONCILE_DUTY` (`apps/server/src/pass.ts:10`).
- The rename script is `scripts/a1308/pa3-reconciliation-runs.mjs`; running it on its own output
  changes nothing; hand edits after it are listed in the PR description (rules §1).
- `requested_by` is optional on every parameter type (omitted means null), so test call sites do
  not change; every server path that starts a card payment passes the signed-in person.
- Never edit `packages/country-es/test-fixtures/demo/madrid-before-move.*` (hash-pinned) or
  `docs/developers/grants-retirement-audit.md` (a dated record).

## Review Focus

1. **A whole-order card payment on a reader that times out and is resolved later.** The row was
   written `attempting` with `requested_by`; the later resolution must not touch it (guard). Task 1
   pins it through the guard's fixed list and a provider-path case.
2. **A manual card payment keyed off a standalone terminal.** It writes its row inside the sale
   transaction (`packages/payments/src/manual.ts:39-58`); it must carry the person too. Task 1.
3. **A refund attempt the provider refused.** `recordFailedRefund` (`store.ts:274-291`) still writes
   its row after the column drop, and the refund ceiling still counts only `succeeded` rows. Task 2.
4. **The reconciliation ledger after the rename on a box that had Stripe runs.** Every venue is
   reset, so no old rows exist; the duty key is unchanged so a fresh ledger derives from the most
   recent complete period. Task 3 runs the ledger suites.
5. **Two sweeps racing to claim the same period** (`claimGap`). With the named conflict target the
   race still yields exactly one claim. Task 3 runs `store.concurrency.test.ts`.

## What it builds

- `payments.requested_by` (null, FK → `persons`, restrict), fixed by `payments_guard_update`,
  written by `insertPayment` from `NewPayment.requestedBy`; `CollectParams.requestedBy`,
  `InitiateParams.requestedBy`, `ManualCardPaymentParams.requestedBy`; the server's five start
  sites pass `operator.personId`.
- `payment_refunds`: `appendOnly()`; `provider` and `payment_ref` dropped; `payment_refunds_authorized_by_fk`
  → `persons`; the payments manifest's `appendOnlyTables` becomes `["payment_refunds"]`.
- `scheduled_runs` → `reconciliation_runs` (table, unique key, four CHECKs, schema file, test file,
  identifiers) by script; `claimGap`'s conflict target named (a loose end on this table).
- A739 Cut B's two tables are in core on its branch (`packages/db/src/classification.ts` on
  `feat/a739-payment-window`), so the orders area folds them; Task 4 runs only if pa1 Task 0 found
  them in the payments set after all.
- Backlog: "`payment_refunds`: decide the remaining DELETE restriction (A805 follow-up)" deleted
  (`docs/backlog/architecture.md:1280`); the `claimGap` sentence removed from
  `docs/backlog/architecture.md:196-199`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The attendance checker reading `payments.requested_by`, and deleting the in-flight poller `apps/server/src/attendance-integrated.ts:19-152` | the people area (`tables-people.md` §7); see Open question 1 in the area return |
| The till-side refund pointing at `payment_refunds` instead of copying its reference and outcome (`tables-fiscal.md` §6, "neither area has settled it") | not built; needs the orders area to agree |
| `payment_refunds`' own refund-attempt history kinds in `activity_log` | none proposed |
| Folding `packages/scheduler` into `packages/payments` | already done by A760 part 3 (#2539: `packages/payments/src/reconciliation-schedule/`) |
| The reconcile job on the job runner | batch 3 (`jobs.md` R2) |

## Files

**Create:** `scripts/a1308/pa3-reconciliation-runs.mjs`; `apps/server/src/payments-requested-by.test.ts`.

**Modify (hand):**
- `packages/payments/src/schema/payments.ts` (column, key), `schema/payment-refunds.ts:12-36`,
  `triggers/payments.sql`, `classification.ts:13`, `provider.ts:40-74, :317-326`,
  `store.ts:39-55, :76-99, :256-264, :284-291`, `manual.ts:20-58`, `simulator.ts:120-130`,
  `testing/fake-provider.ts`, `testing/fake-async-provider.ts`,
  `reconciliation-schedule/store.ts:99`.
- `packages/payments-stripe/src/provider.ts:159`, `device-provider.ts:105-145`,
  `hosted-provider.ts:37`; `packages/payments-sumup/src/provider.ts:168`.
- `apps/server/src/till-sale.ts:1038, :1415-1426, :2224`, `bill-payments.ts:1220, :1495-1505`.
- `packages/migrations/migrations.manifest.json:60`.
- Guards: `scripts/append-only-triggers.test.ts` (add `payment_refunds`),
  `scripts/schema-constraints.test.ts` (keys below), `scripts/behavioural-triggers.test.ts`
  (one case).
- Docs: `docs/developers/conventions-data.md:1426` and `docs/backlog/architecture.md:274` (name
  `payment_refunds` (payments) where pa1 removed `payment_resolutions`),
  `docs/backlog/architecture.md:196-199, :1280`.

**Modify (by the script):** every tracked file under `apps/`, `packages/`, `scripts/`,
`eslint.config.js` (its boundary exception for `packages/payments/src/schema/scheduled-runs.*`,
`:190`) and `docs/developers/conventions-data.md` naming `scheduled_runs`, `scheduledRuns` or `scheduled-runs`
(168 lines at `a086eedfb7`), excluding `**/drizzle/**`, `packages/country-es/test-fixtures/**` and
`scripts/a1308/**`; and `git mv` of `packages/payments/src/schema/scheduled-runs.ts` →
`reconciliation-runs.ts` and `packages/payments/src/scheduled-runs-migrations.test.ts` →
`reconciliation-runs-migrations.test.ts`.

**Tests re-pointed:** `packages/payments/src/store.test.ts` (`:178, :197, :760, :777, :1675` read
`payment_ref` from the payment by a join; `:1646-1650` set the two refunds' dates with
`vi.setSystemTime` before each `recordRefund` instead of updating the rows, which append-only now
refuses; `authorized_by` values become seeded person ids);
`packages/payments-stripe/src/provider.test.ts:388-390, :408-410` (`… from payment_refunds where
payment_ref = …` becomes a join to `payments` on `payment_id`, same expected rows);
`packages/payments/src/backup-verification.test.ts:77` (the fixture's refund insert loses the two
columns; the reference rows gain `["payment_refunds", "authorized_by"]` and
`["payments", "requested_by"]`, with the person seeded in both databases); every whole `beforeEach`
block that deletes `payment_refunds` and then `payments` (pure deletion: the refund delete would
now read as if it worked, and `useVenueDb` empties the tables before each test anyway; the files are
those in pa2's **Files** list); and any fixture passing an invented `authorizedBy` (create the
person first, rules §4).

## Size

| Part | Counted lines |
| --- | --- |
| `requested_by`: schema, trigger line, params, `insertPayment`, providers, server sites | ~70 |
| `payment_refunds`: schema, classification, manifest, store inserts | ~25 |
| Rename script | ~60 |
| `claimGap` target; A739 keys (if any) | ~15 |
| Re-pointed refund reads (Stripe provider tests, backup check) | ~25 |
| New tests (`payments-requested-by`, store cases, refunds append-only/key, guard case) | ~170 |
| Re-pointed tests, fixtures, guards, docs | ~80 |
| **Total** | **~460** |

Uncounted: the script's output (~170 lines), the deleted `beforeEach` lines, the generated files.
About 2½ hours.

## Finish line

```bash
node scripts/a1308/pa3-reconciliation-runs.mjs && git diff --quiet   # second run on the PR's tree changes nothing
pnpm --filter @waitron/payments test
pnpm --filter @waitron/payments-stripe test
pnpm --filter @waitron/payments-sumup test
pnpm --filter @waitron/server exec vitest run src/payments-requested-by.test.ts src/reconcile-duty.test.ts src/held-payments.scheduler.test.ts src/pass.db.test.ts src/handover-stepdown.real.test.ts src/bill-payments.card.test.ts src/till-sale-reconciliation.test.ts src/tender-refund-recovery.test.ts src/tender-refund-balance.test.ts src/bill-refunds.card.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/first-setup-empty-database.test.ts
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/append-only-migration-sets.test.ts scripts/schema-constraints.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/payments --filter @waitron/payments-stripe --filter @waitron/payments-sumup --filter @waitron/server typecheck
git grep -n -E 'scheduled_runs|scheduledRuns|scheduled-runs' -- apps packages scripts eslint.config.js docs/developers ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**' ':!scripts/a1308/**' ':!docs/developers/grants-retirement-audit.md'   # prints nothing
```

## Expected protection-list difference

Six venue headers. Reasons: `tables-fiscal.md` §1.3 and §5 (`payment_refunds` row: "gains the
append-only pair"), §6 (copied columns); README U11 (person keys); `tables-venuebox.md` §5
(`scheduled_runs_key` renamed).

**Under all six headers** (14 lines each, 84):

```text
extra table payments.columns[requested_by]
extra table payments.foreignKeys[requested_by->persons(id)]
changed table payments.columnOrder
changed trigger payments_guard_update.body
missing table payment_refunds.columns[provider]
missing table payment_refunds.columns[payment_ref]
changed table payment_refunds.columnOrder
extra table payment_refunds.foreignKeys[authorized_by->persons(id)]
missing table scheduled_runs
missing index scheduled_runs_key
missing index scheduled_runs.primary key(id)
extra table reconciliation_runs
extra index reconciliation_runs_key
extra index reconciliation_runs.primary key(id)
```

The `payments_guard_update.body` `new:` differs from `old:` only by the term
`AND new.requested_by IS old.requested_by`. `reconciliation_runs`' columns, CHECK expressions and
index columns equal `scheduled_runs`' with the names' prefix changed (check by eye in the
`protection-list.json` entries; `compare` prints whole new and missing tables, not their fields).

**Under the four `migrated` and `change-feed` headers** (2 each, 8): `extra trigger
payment_refunds_append_only_update`, `extra trigger payment_refunds_append_only_delete`.

**Under the two `change-feed` headers** (2 each, 4): `changed trigger
waitron_change_payments_update.when` (one term added), `changed trigger
waitron_change_payment_refunds_update.when` (two terms removed). `scheduled_runs` is not a change
source, so its rename adds no change-feed line.

**96 lines.** If Task 4 applies, add under all six headers `extra table
order_payment_contexts.foreignKeys[person_id->persons(id)]` and `extra table
bill_payment_slip_copies.foreignKeys[person_id->persons(id)]` (108).

## Stop points (beyond rules §5)

1. A server path that starts a card payment has no signed-in person to pass (Task 1 Step 4's
   list is incomplete). Ask; do not pass a made-up id.
2. A product writer updates or deletes `payment_refunds` (`git grep -n -E "update\(paymentRefunds\)|delete\(paymentRefunds\)"`
   over non-test files prints a line).
3. The rename script's second run changes anything, or its output touches a file the **Files**
   list excludes.
4. Task 4 applies (A739's tables are in the payments set): the manifest's payments
   `appendOnlyTables` must then be `["bill_payment_slip_copies", "payment_refunds"]`, not the
   `["payment_refunds"]` Task 2 writes. Ask before building it.

## Needs

- pa1 (the trigger file, the guard). Outside the area: as pa1.
- **Not in flight at the same time as the orders area's refunds slice** (decision D2, coordinator
  review 2026-11-08): both change refund test set-ups (`store.test.ts`, the refund suites).

---

### Task 0: base list

- [ ] From `apps/server`, `pnpm protection-list list --out <empty absolute dir A>` on the base.

### Task 1: `requested_by`

**Interfaces:**
- `NewPayment.requestedBy?: string` (`store.ts:39-55`); `insertPayment` writes `requestedBy:
  params.requestedBy ?? null`.
- `CollectParams.requestedBy?: string` and `InitiateParams.requestedBy?: string`
  (`provider.ts`), doc comment: "The person who started the payment, written on the provider's
  first `payments` row for it." `ManualCardPaymentParams.requestedBy?: string` (`manual.ts`).
- Every provider passes it to the store call that writes the payment's first row: Stripe
  `insertAttempting` (`payments-stripe/src/provider.ts:159`), the on-device adapter's `common`
  object (`device-provider.ts`), `insertInitiated` (`hosted-provider.ts:37`), SumUp
  `insertAttempting` (`payments-sumup/src/provider.ts:168`), the simulator (`simulator.ts:127-128`),
  the two test fakes.

- [ ] **Step 1: Write the failing tests.**
  - `packages/payments/src/store.test.ts`: "writes who started the payment on every first row"
    — `insertAttempting`, `insertCapturedPayment`, `insertFailedPayment`, `insertInitiated` and
    `recordManualCardPayment` each given a seeded person's id; `select requested_by from payments
    where payment_ref = ?` equals it; "leaves it empty when nobody is named" (null).
  - `payments-guard.test.ts`: add `requested_by` to the fixed-column `it.each` (null → value is
    refused too: it is set at insert, never later).
  - `apps/server/src/payments-requested-by.test.ts` (fixtures `testing/bill-payment-fixture.ts`
    and `testing/whole-payment-fixture.ts`, the simulator provider): "a bill card payment, a bill
    manual card payment, a whole-order card payment and a whole-order manual card payment each
    record the signed-in person as requested_by" — four cases, each asserting the `payments` row's
    `requested_by` equals the operator's person id.
  - `packages/payments/src/schema/payments-follow-ups.test.ts`: "refuses a requester who is not a
    person" → `FOREIGN_KEY_VIOLATION`.
- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3:** Add `requestedBy: id("requested_by")` as the table's last column (after pa1's
  `holdDecidedAt`, so the `columnOrder` change is one name appended) with
  `payments_requested_by_fk` → `persons.id` `restrict`; add `AND new.requested_by IS
  old.requested_by` after the `bill_payment_id` term of `payments_guard_update`; rebuild the set.
- [ ] **Step 4:** Thread the parameter (Interfaces). Server sites, each passing
  `operator.personId` (or the function's existing `operatorId` / `personId` parameter, which is the
  same value): `till-sale.ts:1038` and `:2224` (`recordManualCardPayment`), `:1415-1426`
  (`collect`), `bill-payments.ts:1220` (`recordManualCardPayment`), `:1495-1505` (`collect`).
  `git grep -n -E "provider\.collect\(|recordManualCardPayment\(|\.initiate\(" -- apps/server/src ':!*.test.ts'`
  must show no other site (stop point 1).
- [ ] **Step 5:** Run Step 1's files and `pnpm --filter @waitron/payments-stripe test`,
  `pnpm --filter @waitron/payments-sumup test`: PASS. Rerun pa1 Task 1 Step 4's measurement
  commands: no `a payment cannot make that change` in any failure.
- [ ] **Step 6:** Commit `git commit -s -m "payments: a card payment records who started it"`.

### Task 2: `payment_refunds`

- [ ] **Step 1: Write the failing tests** in `packages/payments/src/store.test.ts`:
  "a refund attempt is never changed or deleted" (after `recordRefund`, raw `update` and `delete`
  raise `triggerRaised(error, "payment_refunds is append-only")`); "refuses an authoriser who is
  not a person" (`FOREIGN_KEY_VIOLATION` on a raw insert); and the existing "refused refund still
  allows a later refund of the same amount" case unchanged.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** In `payment-refunds.ts` drop `provider` and `paymentRef`, add
  `payment_refunds_authorized_by_fk` → `persons.id` `restrict`; in `store.ts:256-264, :284-291`
  drop the two fields from the inserts; `classification.ts:13` →
  `appendOnly("payment_refunds", "ledger", LEDGER)`; manifest `appendOnlyTables: ["payment_refunds"]`;
  `scripts/append-only-triggers.test.ts` gains `"payment_refunds"`; `scripts/schema-constraints.test.ts`
  gains `["payment_refunds", ["authorized_by"], "persons"]` and `["payments", ["requested_by"],
  "persons"]`. Re-point the tests in **Files** (the `payment_ref` reads join `payments`; the dates
  come from `vi.setSystemTime`; no expected value changes). Delete the redundant `beforeEach` blocks (**Files**).
  Rebuild the set.
- [ ] **Step 4:** `pnpm --filter @waitron/payments test`, `pnpm --filter @waitron/server exec vitest run src/tender-refund-recovery.test.ts src/tender-refund-balance.test.ts src/bill-refunds.card.test.ts`
  and the root guards: PASS.
- [ ] **Step 5:** Delete `docs/backlog/architecture.md:1280` ("`payment_refunds`: decide the
  remaining DELETE restriction") — append-only now refuses both. Put `payment_refunds` (payments)
  into `conventions-data.md:1426`'s list and into A483's entry at `docs/backlog/architecture.md:274`
  (the two places pa1 removed `payment_resolutions` from). Commit
  `git commit -s -m "payments: a provider refund attempt is written once and keeps no copy of its payment"`.

### Task 3: `reconciliation_runs`

**Interfaces:** `reconciliationRuns` (was `scheduledRuns`), same columns; `runState`, `RunState`,
`SCHEDULER_TABLES` keep their names (`SCHEDULER_TABLES = ["reconciliation_runs"]`).

- [ ] **Step 1:** Write `scripts/a1308/pa3-reconciliation-runs.mjs`: list tracked files with
  `git ls-files -- apps packages scripts eslint.config.js docs/developers/conventions-data.md`, skip the excluded
  paths in **Files**, replace `scheduled_runs` → `reconciliation_runs`, `scheduledRuns` →
  `reconciliationRuns`, `scheduled-runs` → `reconciliation-runs` (plain string replacement, in that
  order; no replacement string contains a source string, so a second run finds nothing), then
  `git mv` the two files when the old path exists. Prints each changed path.
- [ ] **Step 2:** Run it; `pnpm --filter @waitron/payments typecheck`; rebuild the set; run it
  again: no output, `git diff --quiet` after the second run.
- [ ] **Step 3 (hand edit, listed in the PR):** `reconciliation-schedule/store.ts:99`:
  `.onConflictDoNothing({ target: [reconciliationRuns.duty, reconciliationRuns.periodFrom, reconciliationRuns.generation] })`
  — the key `reconciliation_runs_key` names exactly these (CLAUDE.md §3: name the target when a
  table has more than one unique constraint). Remove the sentence about `claimGap` from
  `docs/backlog/architecture.md:196-199`, leaving the rest of that entry.
- [ ] **Step 4:** `pnpm --filter @waitron/payments exec vitest run src/reconciliation-schedule src/reconciliation-runs-migrations.test.ts`,
  the server and provisioning commands in **Finish line**: PASS.
- [ ] **Step 5:** Commit `git commit -s -m "payments: the reconciliation ledger is called reconciliation_runs"`
  with the script and its output in the same commit.

### Task 4: A739's person columns (only if pa1 Task 0 found A739's tables in the payments set)

- [ ] **Step 1: failing test** in the A739 schema test that exists for `order_payment_contexts`
  (its file at base): "refuses a person who does not exist" for `order_payment_contexts.person_id`
  and `bill_payment_slip_copies.person_id` (`FOREIGN_KEY_VIOLATION`), with the accepting insert.
- [ ] **Step 2:** Add `order_payment_contexts_person_fk` and `bill_payment_slip_copies_person_fk`
  → `persons.id` `restrict`; delete the "Identity owns persons … without a cross-module key"
  comments at those columns; add both to `scripts/schema-constraints.test.ts`. Rebuild; run: PASS.
  If A739's tables are in core's set instead, skip this task: the orders area folds them.
- [ ] **Step 3:** Commit.

### Task 5: protection list and finishing

- [ ] Protection list after (`--out <B>`), `compare`, paste into the PR, mark every line against
  **Expected protection-list difference**. Run the whole **Finish line**. `/finish-branch`. The PR
  description lists the hand edits after the script, the re-pointed assertions in `store.test.ts`
  (values unchanged), and the append-only disclosure.
