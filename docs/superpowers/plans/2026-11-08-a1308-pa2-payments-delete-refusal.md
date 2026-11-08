# A1308 pa2: the database refuses to delete a card payment — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Settle the last open delete question on `payments` (an A805 follow-up): a
`BEFORE DELETE` trigger refuses every delete of a `payments` row, as `bill_payments_no_delete`
already does for bill payments.

**Architecture:** One statement added to the payments set's trigger source file that pa1 created,
`packages/payments/triggers/payments.sql`, the starting migration rebuilt, and one refusal text
beside pa1's. No product path deletes a payment today, so nothing else changes.

**Tech Stack:** SQLite triggers on `node:sqlite`, Vitest 4.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md), "Additions of 6 November
2026", row `payments`: "Settle the remaining delete refusal | Payments and adjustments; the owner
lands this part (watcher, 6 November)". The owner's rule of 2026-11-06
(`docs/backlog/architecture.md:1696`): "For non-tax tables, no new database refusal is added unless
someone shows how a wrong delete or update could really happen … The tax and card tables' refusals
go into A1308." The A805 audit's record: `docs/developers/grants-retirement-audit.md:124` (`payments`,
`DELETE`). Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).

**Base:** `main` with pa1 landed. Line numbers read at `a086eedfb7`.

**Who lands:** **the owner**. That rule is the watcher's word of 6 November, recorded in the
design's additions table (README, "Additions of 6 November 2026", row `payments`), not a recorded
owner decision; the plan keeps it owner-landed as that row says. The
lane opens the pull request after pa1 lands and goes on to pa3 without waiting; nothing later in
this area needs this one.

**Pull request's first line:** "Every venue is reset: payments; backups and exports from before
this cannot be restored or imported." (rules §2).

## Global Constraints

- Rules §1–§9 apply. The trigger is added to `packages/payments/triggers/payments.sql` and the set
  rebuilt with `pnpm --filter @waitron/server migration-baseline rebuild --set payments`; never edit
  generated files by hand. On rebase, take `main`'s generated files and rerun the command
  (rules §2.4); the `.sql` source merges as text.
- The refusal is unconditional, as `bill_payments_no_delete` is (`packages/db/drizzle/0000_baseline.sql:3141-3146`):
  `scripts/behavioural-triggers.test.ts`'s header says such a trigger has no accepting control.

## Review Focus

1. **A test suite that cleans payments between cases.** Twelve suites delete payments in a
   `beforeEach` (listed in **Files**; pa1 already removed the one in `fake-provider.test.ts`, and pa3
   removes the blocks that also delete refunds). Each
   uses `useVenueDb`'s per-test reset, which empties the tables first, so the statement deletes no
   row and a row trigger never fires. Task 1 deletes the lines anyway, because once the database
   refuses a delete they read as if they work.
2. **`useVenueDb`'s own reset.** It drops every trigger before deleting
   (`packages/db/src/testing/venue-db.ts:59-70, :161-170`), as it already must for
   `bill_payments_no_delete`. Task 1 runs a whole payments suite to show it.
3. **A configuration import, a restore, Start again.** None deletes `payments` rows: the import
   empties only declared tables and `payments` is not one
   (`packages/composition/src/composition.test.ts:259-283` forbids it); a restore replaces the file.
   Read, not run beyond Task 1's suites.

## What it builds

- `payments_no_delete` in `packages/payments/triggers/payments.sql`.
- `PAYMENT_DELETE_REFUSAL = "a payment is never deleted"` in `packages/payments/src/trigger-refusals.ts`.
- A refusing case in `packages/payments/src/schema/payments-guard.test.ts` and in
  `scripts/behavioural-triggers.test.ts`.
- The bundle entry deleted from `docs/backlog/architecture.md` ("`payments`: decide the remaining
  DELETE restriction (A805 follow-up)", `:1223`).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `payment_refunds`' delete question | pa3: append-only refuses its updates and deletes, and pa3 deletes that entry |
| `payment_policy`'s delete question | 4b deletes the table and the entry |
| `card_readers`, `scheduled_runs` | closed by the owner's rule of 2026-11-06 (no refusal) |
| `envio_flujo`, `envios`, `invoice_series`, `registro_sif` | the fiscal slices, owner-landed |

## Files

- Modify: `packages/payments/triggers/payments.sql`, `packages/payments/src/trigger-refusals.ts`,
  `packages/payments/src/index.ts` (export), `packages/payments/src/schema/payments-guard.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `docs/backlog/architecture.md:1223`.
- Delete lines (pure deletion), whichever pa1 and pa3 have not already removed: the
  `delete from payments` (and `delete from payment_refunds`) `beforeEach` blocks, with the comment
  above each, at `packages/payments-stripe/src/hosted-provider.test.ts:18`,
  `reconciler.test.ts:18`, `stripe-report-client.test.ts:17`;
  `packages/payments/src/collection-owner.sweep.test.ts:17`, `collection-owner.test.ts:31`,
  `manual.test.ts:15`, `reconcile.test.ts:30`, `reconcile.wiring.test.ts:25`, `simulator.test.ts:16`,
  `store.test.ts:62`, `testing/fake-async-provider.test.ts:16`, `testing/fake-provider.test.ts:41`
  (twelve, from `git grep -n -i "delete from payments" -- apps packages` at `a086eedfb7`).
- Regenerated: `packages/payments/drizzle/**`, the epoch line.

## Size

~90 counted lines (trigger 7, constant 3, export 1, tests ~45, behavioural guard ~25, backlog 1).
Uncounted: up to ~50 deleted `beforeEach` lines and the generated files. Under an hour.

## Finish line

```bash
pnpm --filter @waitron/payments test
pnpm --filter @waitron/payments-stripe test
pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/server migration-baseline rebuild --set payments   # "unchanged payments"
git grep -n "delete from payments" -- apps packages   # prints nothing
```

## Expected protection-list difference

Under all six venue headers (two compositions × three phases), one line each, six in all:

```text
extra trigger payments_no_delete
```

Reason: the design's 6 November addition for `payments` and the owner's rule of 2026-11-06 that
card tables' refusals go into A1308.

## Stop points (beyond rules §5)

1. `git grep -n -i -E "delete\(payments\)|delete from payments" -- apps packages ':!*.test.ts'`
   prints a product line. A product delete is a decision for the owner, not something to remove.
2. A suite fails with `a payment is never deleted` (a test that really deletes a row). Report it;
   do not change its assertion.

## Needs

- pa1 (the trigger file and `trigger-refusals.ts`). Nothing else in this area; nothing waits for it.
  Not the refunds slice (decision D2, coordinator review 2026-11-08).

---

### Task 1: the refusal

**Interfaces:** Produces `PAYMENT_DELETE_REFUSAL` (exported from `@waitron/payments`).

- [ ] **Step 0:** From `apps/server`, `pnpm protection-list list --out <empty absolute dir A>` on the base.
- [ ] **Step 1: Write the failing tests.** In `payments-guard.test.ts`: "a payment is never deleted"
  — seed a captured payment, `delete from payments where id = ?` raises,
  `expect(triggerRaised(error, PAYMENT_DELETE_REFUSAL)).toBe(true)`, and the row is still there.
  In `scripts/behavioural-triggers.test.ts`: the same refusal against the product-migrated
  database, and `payments_no_delete` added to its equality list; extend the header sentence that
  names `bill_payments_no_delete` to name it too.
- [ ] **Step 2:** Run both: FAIL.
- [ ] **Step 3:** Append to `payments.sql`, after a `--> statement-breakpoint`:

```sql
CREATE TRIGGER payments_no_delete
BEFORE DELETE ON payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a payment is never deleted');
END;
```

  Rebuild the payments set. Delete the redundant `beforeEach` blocks listed in **Files**.
- [ ] **Step 4:** Run the Finish line: PASS, with `Tests` counts.
- [ ] **Step 5:** Delete the bundle entry at `docs/backlog/architecture.md:1223`. Protection list
  after (`--out <B>`), `compare`, paste into the PR and mark the six lines.
- [ ] **Step 6:** Commit `git commit -s -m "payments: the database refuses to delete a card payment"`;
  `/finish-branch`; the PR description says the owner lands it and why (design additions table).
