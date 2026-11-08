# A1308 pa1: a card payment's follow-ups become columns on its own row — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** `payment_resolutions`, `payment_holds` and `payment_hold_outcomes` fold into `payments` as
columns that can be written once and never changed, with a new guard trigger on `payments` that
enforces it, and the "held or reversed, never both" race guard becomes a database CHECK.

**Architecture:** Each of the three side tables has at most one row per payment (a unique index on
`payment_id`, or on `hold_id` with one hold per payment), so each becomes a group of nullable
columns on `payments`. A "set-once" column may go from empty to a value once and never change after
(design appendix `tables-fiscal.md`, §1 opening). A hand-written `BEFORE UPDATE` trigger on
`payments` holds those groups and the columns no writer changes fixed, in the trigger source file
slice 1a's command appends to the payments set's starting migration. The writers become `UPDATE`s
of the payment's own row; the readers read columns instead of joining.

**Tech Stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on `node:sqlite`, Hono, Lit
(dashboard), Vitest 4.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) (approved 2026-11-04; it
wins over appendices), [`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md)
§1.3 (`payments`), §4 (the three mapping rows), §5 (the `payments`, `payment_resolutions`,
`payment_holds`, `payment_hold_outcomes` rows), §6 (the working-order duplicate), §8 item 5
(the guard trigger, payments part). Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md),
cited as "rules §n" and not repeated.

**Base:** `main` after everything in **Needs**. Line numbers below were read at the docs worktree's
HEAD `a086eedfb7`. A cite that no longer says what this plan says is a stop (rules §5.1).

**Who lands:** the lane. Nothing here touches `sales`, invoice numbering, the fiscal record, the
fiscal identity, AEAT sending or a hashed value (rules §6).

**Pull request's first line:** "Every venue is reset: payments; backups and exports from before
this cannot be restored or imported." (rules §2).

---

## The area's pull requests

The payments-and-adjustments area is five pull requests, in this order. This file is the first;
each has its own plan.

| PR | Plan | What | Counted lines (est.) | Lands |
| --- | --- | --- | --- | --- |
| pa1 | this file | resolutions, holds and hold outcomes fold into `payments`; a payment keeps the reader it was charged on; guard trigger; measurement 5 | ~1,000 | lane |
| pa2 | [pa2](2026-11-08-a1308-pa2-payments-delete-refusal.md) | `payments` refuses every delete (6 November addition, A805 follow-up) | ~90 | **owner** |
| pa3 | [pa3](2026-11-08-a1308-pa3-requester-and-refund-attempts.md) | `payments.requested_by`; `payment_refunds` append-only, two copied columns gone; `scheduled_runs` → `reconciliation_runs` | ~460 + script output | lane |
| pa4 | [pa4](2026-11-08-a1308-pa4-card-readers.md) | `card_reader_holders`, `device_card_readers`, `device_profile_card_readers` fold into `card_readers`, `devices`, `device_profiles`; `card_readers.active` goes | ~960 | lane |
| pa5 | [pa5](2026-11-08-a1308-pa5-adjustments.md) | `adjustments.comped_extras` goes; measurement 6 decides `splits`; person keys on `adjustments` | ~300 (fallback) / ~570 (if `splits` moves) | lane |

pa2 is opened as soon as pa1 lands and waits for the owner; nothing later waits for it. pa5 does
not depend on pa1–pa4 (a different migration set) and may be built in any gap.

## Area files for the package move

The CI package move (agreed 2026-11-08, design not written; order from A1453) takes each area's
`apps/server/src` files into a package of its own. Not planned here. The files that belong to this
area, read at `a086eedfb7`:

- **Payments:** `payments-api.ts` (with `payments-api.test.ts`, `.clock-behind.test.ts`,
  `.held.test.ts`, `.pin-turn.test.ts`, `.stuck.test.ts`), `card-reader-delete.ts`
  (`.db.test.ts`), `pending-card-recovery.ts` (`.test.ts`), `pending-card-loop.test.ts`,
  `reconcile-duty.ts` (`.test.ts`), `held-payments.scheduler.test.ts`, `card-provider-pool.ts`
  (`.test.ts`), `stripe-account.ts` (`.test.ts`), `boot-card-provider.test.ts`,
  `boot-card-provider-disabled.test.ts`, `boot.reconcile.test.ts`, `card-charged-not-recorded.test.ts`,
  `box-health.payments-off.test.ts`, `take-payment-permission.test.ts`, `reader-slip-setting.test.ts`,
  `testing/zone-payment-venue.ts`, `testing/whole-payment-fixture.ts`.
- **Adjustments:** `adjustments-api.ts` (`.test.ts`), `adjustments-apply.ts` (with
  `adjustments-apply.test.ts`, `adjustments-bill-payments.test.ts`, `adjustments-extra-cancel.test.ts`,
  `adjustments-report.test.ts`, `draft-recall-adjustments.test.ts`, `order-portions.adjustments.test.ts`,
  `bill-editing.adjustments.test.ts`, `full-comp.fiscal-identity.test.ts`,
  `personal-data-adjustments.worked-example.test.ts`), `receipt-adjustments.ts` (`.test.ts`),
  `testing/adjustment-venue.ts` (`.test.ts`).
- **Shared with other areas, not moved with this one:** `device-equipment.ts` (the card terminal
  is one of four equipment roles: devices), `bill-payments*.ts`, `till-sale.ts`, `line-cancel*.ts`
  (orders and sales), `tender-refund*.ts`, `bill-refunds*.ts` (refunds), `pass.ts` (the main loop:
  the job runner, batch 3), `alert-sources.ts`, `box-health.ts`, `boot.ts`,
  `attendance-*-payments.test.ts` and `attendance-adjustments.test.ts` (people), `payment-slip*.ts`
  (printing; A739 owns its current shape).

**Where the move sits:** after pa4 for the payments files (pa4 is the last pull request that
changes them; pa2 touches only `packages/payments` and root guards) and after pa5 for the
adjustments files. If A1453 orders this area first, the move goes after pa5 as one pull request.

---

## Global Constraints

- Rules §1–§9 apply in full. Never edit `drizzle/*.sql`, `drizzle/meta/*` or
  `scripts/migration-baseline-epoch.json` by hand; run
  `pnpm --filter @waitron/server migration-baseline rebuild --set payments` (slice 1a).
- The trigger source file is `packages/payments/triggers/payments.sql`: slice 1a's `triggerFileFor`
  names `<packageDir>/triggers/<set>.sql` for every set, and its `readTriggers` accepts only
  `CREATE TRIGGER` statements separated by `--> statement-breakpoint`, as in
  `packages/db/triggers/core.sql`.
- Owner decisions copied from the design: "Card follow-ups: Resolution, hold and hold outcome become
  columns on `payments`" (README §10); person ids get keys to `persons`, refusing a delete until
  A980 says otherwise (README §5 U11).
- Never edit the hash-pinned captures `packages/country-es/test-fixtures/demo/madrid-before-move.*`;
  they record the past and keep naming the old tables.
- Tests keep their behaviour assertions (rules §4). Every assertion this plan changes or deletes is
  listed in its task with the reason; any other changed assertion is a stop.
- Plain English in the pull request text and commit messages (global rule).

## Review Focus

0. **A recovery Pay on another reader** (the till crashed after the card was charged on reader A,
   and the retry runs on a device holding reader B). It must settle the sale and keep reader A on
   the payment (decision D1, coordinator review 2026-11-08). Task 1 pins it.
1. **A held payment the reconcile sweep finds again.** A second sweep over a period whose payment
   is already held must answer `existing` and write nothing, never raise the guard trigger. Task 3
   pins it (`recordHold` on a held row).
2. **Two sweeps racing on one orphan.** One holds while the other stamps `reconcile_remediated_at`;
   the second write must be refused by its own `WHERE` (answer `refused` / `false`), and the CHECK
   must never be what refuses it in product code. Task 3's concurrency case.
3. **A manager recording a held payment's outcome twice** (two tabs). The second gets
   `payment.hold_already_recorded` with the first outcome kept, not a database refusal. Task 3.
4. **A manager who is later anonymised (A980).** `resolved_by` and `hold_decided_by` keep their key
   and refuse a delete of the person; nothing in this pull request deletes a person. Task 1's FK case.
5. **The dashboard's held list after a reload.** The row's id is now the payment's id; the
   outcome route must accept it and refuse a payment that was never held with
   `payment.hold_not_found`. Task 3's route cases and the dashboard held test.

---

## What it builds

- On `payments` (`packages/payments/src/schema/payments.ts:45-138`), eleven nullable columns:
  `resolution_outcome` (`captured`/`failed`), `resolution_cancelled_at_provider` (flag),
  `resolution_provider_status`, `resolved_by` (FK → `persons`, restrict), `resolved_at`,
  `hold_provider_amount` (money), `held_at`, `hold_outcome` (`refunded_at_provider`/`kept`),
  `hold_note`, `hold_decided_by` (FK → `persons`, restrict), `hold_decided_at`.
- Nine CHECKs carrying the three tables' CHECKs and the new pairing rules, including
  `payments_hold_or_remediation_ck` (`held_at is null or reconcile_remediated_at is null`).
- Two partial indexes for the two reads that used to start from a small side table:
  `payments_open_hold_idx` and `payments_unfiled_resolution_idx`.
- `associatePaymentWithSale` (`packages/payments/src/store.ts:296-308`) stops replacing a reader
  already on the payment: it writes `coalesce(reader_id, <this request's reader>)` (decision D1).
  Today a recovery Pay on another reader (`apps/server/src/till-sale.ts:1234-1237` finds the earlier
  capture by order and provider; `:1678-1682, :1842-1846, :1990-1994, :2079-2083` associate with
  this request's reader) overwrites reader A with B; under the guard it would be refused.
- `liftPaymentGuard`, a test helper for set-ups that deliberately write a column the guard holds
  fixed.
- The guard trigger `payments_guard_update` and its refusal text in
  `packages/payments/src/trigger-refusals.ts`.
- Measurement 5's payments part, run first (Task 1).
- Writers and readers moved: `resolutions.ts`, `holds.ts`, `store.ts`, `reconcile.ts`,
  `held-alert.ts`, `apps/server/src/payments-api.ts`, `pending-card-recovery.ts`,
  `bill-payments-loop.ts`, the dashboard's held list.
- The three tables, their schema files, classification rows, manifest entry and live-update names
  deleted.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `payments.requested_by` | pa3 |
| `payments` refusing deletes (6 November addition) | pa2, owner lands |
| `payment_refunds` append-only and its two copied columns | pa3 |
| Activity-log kinds for card readers, profile reader lists and adjustment reasons (`tables-fiscal.md` §3 "To `activity_log`") | follow-ups, not built in A1308 (README §5 U11) |
| The card follow-up job that merges the card payment check loop and card refund recovery | the job runner, batch 3 (`jobs.md`) |
| A state machine for `payments.state` in the trigger | not built: the design asks for set-once columns; the state rules stay in `store.ts`'s `WHERE` clauses |
| A739 Cut B's `order_payment_contexts` and `bill_payment_slip_copies` | the orders area: on `feat/a739-payment-window` both are in core (`packages/db/src/classification.ts`); only `payments.payment_context_id` is this area's, written at insert and kept unchanged |
| Personal-data export of the new person columns | A980 (`apps/server/src/personal-data-actions.coverage.test.ts:7-8` says other modules' actor columns are its backlog point) |

## Files

**Create**
- `packages/payments/triggers/payments.sql` — `payments_guard_update`.
- `packages/payments/src/trigger-refusals.ts` — `PAYMENT_CHANGE_REFUSAL`.
- `packages/payments/src/schema/payments-follow-ups.test.ts` — the CHECK, key and index cases.
- `packages/payments/src/schema/payments-guard.test.ts` — the trigger cases.
- `packages/payments/src/testing/lift-payment-guard.ts` and `lift-payment-guard.test.ts` — the
  set-up helper (Task 1).

**Modify**
- `packages/payments/src/schema/payments.ts`, `schema/index.ts`, `index.ts:66-75, :151-152`,
  `classification.ts:10-23`, `errors.ts:34-35`, `resolutions.ts`, `holds.ts`, `store.ts:17,
  :296-308, :737-756, :816-836`, `reconcile.ts:331-350` (comment and call), `held-alert.ts:43`.
- `packages/migrations/migrations.manifest.json:60`.
- `apps/server/src/payments-api.ts:39-42, :1382-1431`, `pending-card-recovery.ts:3, :40-60`
  (the query becomes the exported `unfiledAutomaticResolutions(tx)`, Task 3),
  `bill-payments-loop.ts:9, :114-127`, `testing/zone-payment-venue.ts:128`.
- `apps/dashboard/src/api/client.ts:2254-2264, :4900-4915`, `api/live-queries.ts:164`,
  `screens/payments-screen.ts:1412, :1702, :1715`.
- Guards: `scripts/schema-constraints.test.ts:231-235, :458-460`,
  `scripts/append-only-triggers.test.ts:64-66`, `scripts/behavioural-triggers.test.ts`.
- Docs: `docs/developers/conventions-data.md:1426` (`payment_resolutions` named as a switched-off
  module's append-only table: delete that example from the list), `docs/backlog/architecture.md:274`
  (the same example in A483's entry: delete it).

**Delete** (pure deletion, uncounted)
- `packages/payments/src/schema/payment-resolutions.ts`, `schema/payment-holds.ts`,
  `src/payment-holds.test.ts` (its cases are re-homed in Task 2, listed there).

**Tests re-pointed** (set-up and table names; assertions kept unless listed in a task):
`packages/payments/src/{resolutions,holds,held-alert,reconcile,reconcile.concurrency,store,index,monetary-columns,schema-ownership,backup-verification}.test.ts`,
`packages/payments/src/testing/fake-provider.test.ts`,
`packages/payments-stripe/src/{provider,provider-activity,provider-unknown,provider-unknown-http}.test.ts`,
`apps/server/src/{payments-api.held,payments-api.stuck,pending-card-recovery,held-payments.scheduler}.test.ts`,
`apps/dashboard/src/screens/payments-screen.held.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`.

**Test set-ups rewritten for the guard** (Task 1 Step 4; values and assertions unchanged):

| Set-up | Writes | Rewritten as |
| --- | --- | --- |
| `packages/payments/src/collection-owner.sweep.test.ts:54-58` | `node_id` → null (a row with no owner) | `liftPaymentGuard` around the update |
| `packages/payments/src/backup-verification.test.ts:329` | `sale_id` → null (in-flight work) | `liftPaymentGuard` around the update, on both databases |
| `apps/server/src/payments-api.stuck.test.ts:425` | `node_id` → null | `liftPaymentGuard` |
| `apps/server/src/payments-api.stuck.test.ts:955-957` | `source`, `device_id` (a source with no device) | `liftPaymentGuard` |
| `apps/server/src/tender-refund-reservation.test.ts:604-607` | `amount` (a capture whose amount differs, on purpose) | `liftPaymentGuard` |
| `apps/server/src/till-api.receipt.test.ts:2327, :2373, :2406, :2447, :2479, :2497, :2896` | `provider` → `sumup` (and `reader_id` at `:2406`) | `liftPaymentGuard` around each |

The helper, not a plain `drop trigger`: `useVenueDb`'s per-test reset replays a `drop trigger` for
every trigger it saw at set-up (`packages/db/src/testing/venue-db.ts:127-146`), so a trigger a test
dropped and did not restore would fail the next reset. Backup-verification's own `corrupt()`
(`backup-verification.test.ts:190-194`) works on its standalone databases and stays as it is.

**Redundant clean-up deleted** (pure deletion): `packages/payments/src/testing/fake-provider.test.ts:36-42`
(`delete from payments where id not in (select payment_id from payment_resolutions)`; it names a
dropped table, and `useVenueDb` empties every table before each test).

## Size

| Part | Counted lines |
| --- | --- |
| Schema (columns, CHECKs, keys, indexes), exports, classification, manifest, errors | ~110 |
| `associatePaymentWithSale` keeps the first reader (D1) | ~5 |
| `liftPaymentGuard` and its test | ~40 |
| Trigger file and refusal constant | ~50 |
| `resolutions.ts`, `holds.ts`, `store.ts`, `reconcile.ts`, `held-alert.ts` | ~150 |
| Server routes and recovery readers (with the exported query builder); dashboard client, screen, live queries | ~80 |
| New tests (`payments-follow-ups`, `payments-guard`, behavioural-triggers cases, the D1 recovery case) | ~370 |
| Re-pointed tests, rewritten set-ups, backup-check cases and guard lists | ~245 |
| **Total** | **~1,000** |

Uncounted: the three deleted files (~260 lines), the regenerated `packages/payments/drizzle/**` and
epoch line. About 3 hours.

## Finish line

```bash
pnpm --filter @waitron/payments exec vitest run src/schema src/resolutions.test.ts src/holds.test.ts src/held-alert.test.ts src/reconcile.test.ts src/reconcile.concurrency.test.ts src/store.test.ts src/index.test.ts src/monetary-columns.test.ts src/schema-ownership.test.ts src/backup-verification.test.ts src/testing/fake-provider.test.ts
pnpm --filter @waitron/payments-stripe exec vitest run src/provider.test.ts src/provider-activity.test.ts src/provider-unknown.test.ts src/provider-unknown-http.test.ts
pnpm --filter @waitron/server exec vitest run src/payments-api.held.test.ts src/payments-api.stuck.test.ts src/pending-card-recovery.test.ts src/held-payments.scheduler.test.ts src/bill-payments-loop.test.ts src/till-sale-integrated.db.test.ts src/till-api.receipt.test.ts src/tender-refund-reservation.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/payments-screen.held.test.ts src/api/live-queries.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/live-subscriptions.test.ts scripts/append-only-migration-sets.test.ts scripts/migration-upgrade.test.ts
pnpm --filter @waitron/payments --filter @waitron/payments-stripe --filter @waitron/server --filter @waitron/dashboard typecheck
pnpm --filter @waitron/server migration-baseline rebuild --set payments   # prints "unchanged payments"
```

Each run shows a `Tests` count and no failure (CLAUDE.md §4: a run with no count is no evidence).
`git grep -n -E 'payment_resolutions|payment_holds|payment_hold_outcomes|paymentResolutions|paymentHolds|paymentHoldOutcomes' -- apps packages scripts ':!**/drizzle/**' ':!packages/country-es/test-fixtures/**'`
prints nothing.

## Expected protection-list difference

Six venue headers each: the two compositions (`fiscal-verifactu`, `fiscal-none`) × the three
phases. No `node.db` header. Reason for every line: `tables-fiscal.md` §5 rows `payments`,
`payment_resolutions`, `payment_holds`, `payment_hold_outcomes`, and §1.3's table of folded columns.

**Under all six headers** (36 lines each, 216 in all):

```text
missing table payment_resolutions
missing table payment_holds
missing table payment_hold_outcomes
missing index payment_resolutions_payment_key
missing index payment_resolutions_working_order_idx
missing index payment_holds_payment_key
missing index payment_hold_outcomes_hold_key
missing index payment_resolutions.primary key(id)
missing index payment_holds.primary key(id)
missing index payment_hold_outcomes.primary key(id)
changed table payments.columnOrder
extra table payments.columns[resolution_outcome]
extra table payments.columns[resolution_cancelled_at_provider]
extra table payments.columns[resolution_provider_status]
extra table payments.columns[resolved_by]
extra table payments.columns[resolved_at]
extra table payments.columns[hold_provider_amount]
extra table payments.columns[held_at]
extra table payments.columns[hold_outcome]
extra table payments.columns[hold_note]
extra table payments.columns[hold_decided_by]
extra table payments.columns[hold_decided_at]
extra table payments.checks[payments_resolution_outcome_ck]
extra table payments.checks[payments_resolution_cancelled_ck]
extra table payments.checks[payments_resolution_fields_ck]
extra table payments.checks[payments_hold_amount_ck]
extra table payments.checks[payments_hold_fields_ck]
extra table payments.checks[payments_hold_outcome_ck]
extra table payments.checks[payments_hold_note_ck]
extra table payments.checks[payments_hold_outcome_fields_ck]
extra table payments.checks[payments_hold_or_remediation_ck]
extra table payments.foreignKeys[resolved_by->persons(id)]
extra table payments.foreignKeys[hold_decided_by->persons(id)]
extra index payments_open_hold_idx
extra index payments_unfiled_resolution_idx
extra trigger payments_guard_update
```

The `columnOrder` line's `new:` array is the `old:` array with the eleven names appended after the
last column at base; nothing else in it moves.

**Under the four `migrated` and `change-feed` headers** (6 lines each, 24): `missing trigger
<t>_append_only_update` and `missing trigger <t>_append_only_delete` for `payment_resolutions`,
`payment_holds`, `payment_hold_outcomes`. Reason: the three append-only pairs become the set-once
guard (§1.3, "The three tables' append-only triggers become the set-once guard").

**Under the two `change-feed` headers** (10 lines each, 20): `missing trigger
waitron_change_<t>_{insert,update,delete}` for the same three tables (no longer change sources),
and `changed trigger waitron_change_payments_update.when`, whose `new:` clause is the `old:` one plus
eleven `new."<column>" is not old."<column>"` terms.

**260 lines.** If A739 Cut B's `payments.payment_context_id` is at base, nothing about it changes.

## Stop points (beyond rules §5)

1. Task 1's measurement shows a **product** writer refused (the design's failing result; the
   fallback is below, and the watcher confirms it before it is taken). A test set-up refused is
   not this result: it is rewritten with `liftPaymentGuard` and listed; one not in the table under
   **Files** is added to that table in the PR description.
2. A739 Cut B is not on `main` (rules §8: it lands before this area), or its tables landed in the
   payments set rather than core. Then the manifest's payments `appendOnlyTables` must keep
   `bill_payment_slip_copies` (this plan sets it to `[]`, pa3 to `["payment_refunds"]`): stop and
   ask for the fold-in. Also a stop: `git grep -n -E "paymentContextId|payment_context_id"` finds
   it in any `update`/`.set(` (it must be written at insert only).
3. `pnpm --filter @waitron/server migration-baseline rebuild --set payments` refuses the trigger
   file (1a's parser), or 1a's guard reports the starting migration does not end with it.
4. A test outside this plan's lists fails for a reason tied to the three tables.

## Needs

- **Outside this area:** slice 1a (rebuild command, per-set trigger files); 4b (deletes
  `payment_policy` and the `accepted_offline`/`settled`/`declined` states from the same set); A739
  Cut B (rules §8; it changes `payments`). Not the refunds slice (decision D2, coordinator review
  2026-11-08).
- **In this area:** none.
- **Not at the same time as:** any other slice changing the payments set (rules §7).

---

### Task 0: base list and base checks

- [ ] **Step 1:** In a throwaway worktree of the base (`git worktree add --detach <dir> <base-sha>`,
  `pnpm install`), from `apps/server`: `pnpm protection-list list --out <empty absolute dir A>`.
- [ ] **Step 2:** `git grep -n payment_context_id -- packages/payments/src/schema/payments.ts`:
  note whether A739 Cut B's column is there (Task 1's trigger lists it), and
  `git grep -n -E "paymentContextId|payment_context_id" -- apps packages ':!**/drizzle/**'` shows
  it only in schema, inserts and reads (stop point 2). `git grep -n -E
  'order_payment_contexts|bill_payment_slip_copies' -- 'packages/*/src/classification.ts'` names
  `packages/db/src/classification.ts` (core); any other file is stop point 2.
- [ ] **Step 3:** Confirm the cites in **Files** still say what this plan says (rules §5.1).

### Task 1: measurement 5 — the guard on today's writers (early)

The design: "run every writer in `packages/payments/src/store.ts` … under the new triggers.
Failing result: a writer that legitimately changes a column the trigger holds fixed. That column
comes off the fixed list, with the reason written at the trigger." Not established by the design:
whether `associatePaymentWithSale` (`store.ts:296-308`) ever replaces a `reader_id` already set.
This task runs that measurement before anything else is changed, against today's columns.

**Files:** Create `packages/payments/triggers/payments.sql`, `packages/payments/src/trigger-refusals.ts`,
`packages/payments/src/schema/payments-guard.test.ts`, `packages/payments/src/testing/lift-payment-guard.ts`
(and its test); modify `packages/payments/src/store.ts:296-308`, `apps/server/src/till-sale-integrated.db.test.ts`,
and the set-ups in **Files**' table.

**Interfaces:**
- Produces: `export const PAYMENT_CHANGE_REFUSAL = "a payment cannot make that change";` in
  `trigger-refusals.ts`, re-exported from `packages/payments/src/index.ts`.
- Produces: `export async function liftPaymentGuard(db: Database, write: () => unknown): Promise<void>`
  in `packages/payments/src/testing/lift-payment-guard.ts` — reads `payments_guard_update`'s text
  from `sqlite_master`, drops it, awaits `write()`, and re-creates it from that text in a
  `finally`. Imported by `apps/server` tests as `@waitron/payments/src/testing/lift-payment-guard.js`
  (the path style `apps/server/src/tender-refund-balance.ts:11` already uses).
- `associatePaymentWithSale(tx, params: Key & { saleId: string; readerId?: string }): Promise<void>` —
  same signature; with `readerId` it sets `readerId: sql\`coalesce(${payments.readerId}, ${params.readerId})\``.

- [ ] **Step 0: D1, test first.** In `apps/server/src/till-sale-integrated.db.test.ts` add "a recovery
  Pay on another reader settles and keeps reader A": a whole-order card Pay is captured on reader A
  and stops before its sale is written (the file's existing "capture P3 never filed" set-up, `till-sale-integrated.db.test.ts:113`, `:314`); a
  second Pay for the same order arrives from a device holding reader B; it answers settled, the sale
  exists, and `select reader_id from payments` for that order is reader A's id. Run it: FAIL (the
  row reads reader B). Make `associatePaymentWithSale` write the `coalesce`; run: PASS. Also run
  `pnpm --filter @waitron/payments exec vitest run src/store.test.ts`.

- [ ] **Step 1: Write the failing tests** in `payments-guard.test.ts` (`useVenueDb` with
  `CORE_MIGRATIONS, PAYMENTS_MIGRATIONS`, a captured payment seeded with `../../test/seed.js`):
  - `it.each` "refuses a change to <column>" over `working_order_id`, `source`, `device_id`,
    `node_id`, `provider`, `payment_ref`, `amount`, `created_at`, `bill_payment_id` (and
    `payment_context_id` when Task 0 found it): a raw `update payments set <column> = <other>`
    raises, `expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true)`.
  - `it.each` "sets <column> once" over `sale_id`, `reader_id`, `reconcile_remediated_at`: null →
    value succeeds; value → other value and value → null each raise `PAYMENT_CHANGE_REFUSAL`.
  - "still moves a payment through its states": one update changing `state`, `settled_at`,
    `external_ref`, `card_scheme`, `card_last4`, `card_entry_mode`, `card_auth_code` and
    `updated_at` succeeds and reads back.
- [ ] **Step 2:** `pnpm --filter @waitron/payments exec vitest run src/schema/payments-guard.test.ts`:
  FAIL (no trigger).
- [ ] **Step 3:** Write `payments.sql` with this statement (exact text; Task 2 extends it):

```sql
CREATE TRIGGER payments_guard_update
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  SELECT raise(abort, 'a payment cannot make that change')
  WHERE NOT (
    new.id IS old.id
    AND new.working_order_id IS old.working_order_id
    AND new.source IS old.source
    AND new.device_id IS old.device_id
    AND new.node_id IS old.node_id
    AND new.provider IS old.provider
    AND new.payment_ref IS old.payment_ref
    AND new.amount IS old.amount
    AND new.created_at IS old.created_at
    AND new.bill_payment_id IS old.bill_payment_id
    AND (old.sale_id IS NULL OR new.sale_id IS old.sale_id)
    AND (old.reader_id IS NULL OR new.reader_id IS old.reader_id)
    AND (old.reconcile_remediated_at IS NULL
      OR new.reconcile_remediated_at IS old.reconcile_remediated_at)
  );
END;
```

  Add `AND new.payment_context_id IS old.payment_context_id` after `bill_payment_id` if Task 0
  found that column. Run the rebuild command for `payments`; run the test: PASS.
- [ ] **Step 3b: the helper and the set-ups.** Write `liftPaymentGuard` with its test ("restores the
  guard: after the write, a change to `amount` is refused again"; "restores it when the write
  throws"). Rewrite each set-up in **Files**' table to wrap its update in it.
- [ ] **Step 4: the measurement.** Say first what failing looks like: a test that passed at base
  now fails with `a payment cannot make that change` **inside a product function** (a stack through
  `packages/payments/src`, `packages/payments-*/src` or `apps/server/src` non-test code). Run, and
  keep the `Tests` lines:

```bash
pnpm --filter @waitron/payments test
pnpm --filter @waitron/payments-stripe test
pnpm --filter @waitron/payments-sumup test
pnpm --filter @waitron/server exec vitest run src/till-sale-reconciliation.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts src/bill-payments-loop.test.ts src/bill-payments-api.test.ts src/payments-api.test.ts src/payments-api.stuck.test.ts src/pending-card-recovery.test.ts src/pending-card-loop.test.ts src/card-charged-not-recorded.test.ts src/placed-order-one-payment.test.ts src/parked-table-payments.test.ts src/attendance-integrated-payments.test.ts src/attendance-whole-payments.test.ts src/till-api.fiscal-sale-paths.test.ts
```

  Control (proves the probe can see a failure): temporarily change `associatePaymentWithSale` to
  set `readerId: "00000000-0000-4000-8000-000000000000"` unconditionally, rerun
  `src/store.test.ts`, see the refusal, revert.
  Run the set-up suites in **Files**' table too. **Pass:** no product writer is refused. A refusal
  raised by a test's own set-up statement is not the measurement's result: rewrite it with
  `liftPaymentGuard` and list it (stop point 1). **Failing result:** a product writer is refused →
  stop; the fallback the design names is to take that column off the fixed list and write the
  reason at the trigger, one line, after the watcher confirms. Never take a column off the list
  for a test shortcut.
- [ ] **Step 5:** Record the commands and both outcomes in the commit message. Commit:
  `git commit -s -m "payments: a guard trigger holds a payment's fixed columns (measurement 5)"`.

### Task 2: the follow-up columns and their CHECKs

**Files:** Modify `packages/payments/src/schema/payments.ts`, `schema/index.ts`, `index.ts`,
`classification.ts`, `packages/migrations/migrations.manifest.json`; delete the two schema files;
create `schema/payments-follow-ups.test.ts`; delete `src/payment-holds.test.ts`.

**Interfaces:**
- Produces, in `schema/payments.ts`: `paymentResolutionOutcome = enumType(["captured","failed"])`
  and `paymentHoldOutcome = enumType(["refunded_at_provider","kept"])` (moved, same names, still
  exported from `@waitron/payments`); columns `resolutionOutcome`, `resolutionCancelledAtProvider`
  (`flag`, nullable), `resolutionProviderStatus` (`label`), `resolvedBy` (`id`), `resolvedAt`
  (`tsString`), `holdProviderAmount` (`money`), `heldAt`, `holdOutcome`, `holdNote` (`label`),
  `holdDecidedBy` (`id`), `holdDecidedAt`, declared after `billPaymentId` in that order.

- [ ] **Step 1: Write the failing tests** in `payments-follow-ups.test.ts` (raw inserts and
  updates on a seeded payment; a seeded person from `@waitron/identity`'s `persons` for the
  person columns). Each refusal asserts `isRefusal(error, CHECK_VIOLATION)` and the CHECK's name
  in `engineErrorMessage(error)`; each has the accepting row beside it:
  - "accepts no follow-up, an automatic resolution, a manager's resolution, a hold, and a decided hold"
  - "refuses a resolution outcome it does not know" → `payments_resolution_outcome_ck`
  - "refuses a captured resolution that says the provider cancelled" → `payments_resolution_cancelled_ck`
  - "refuses half a resolution: an outcome without its time or flag, a resolver or status without an outcome" → `payments_resolution_fields_ck`
  - "refuses a held amount that is not above zero" → `payments_hold_amount_ck`
  - "refuses an amount without its time and a time without its amount" → `payments_hold_fields_ck`
  - "refuses a hold outcome it does not know, and a blank note" → `payments_hold_outcome_ck`, `payments_hold_note_ck`
  - "refuses an outcome on a payment never held, an outcome without who decided or when, and a note without an outcome" → `payments_hold_outcome_fields_ck`
  - "refuses a payment both held and reversed by the reconcile sweep" → `payments_hold_or_remediation_ck` (held only, and remediated only, are accepted)
  - "refuses a resolver or decider who is not a person" → `FOREIGN_KEY_VIOLATION`
- [ ] **Step 2:** Run it: FAIL.
- [ ] **Step 3:** Add the columns, and these CHECKs (one `check(...)` each, terms written with
  `is not null` themselves, as `adjustments_line_level_ck` does):
  - `payments_resolution_outcome_ck`: `enumCheck(t.resolutionOutcome)`
  - `payments_resolution_cancelled_ck`: `resolution_cancelled_at_provider is null or resolution_cancelled_at_provider = 0 or resolution_outcome = 'failed'`
  - `payments_resolution_fields_ck`: `(resolution_outcome is null) = (resolved_at is null) and (resolution_outcome is null) = (resolution_cancelled_at_provider is null) and (resolution_outcome is not null or (resolution_provider_status is null and resolved_by is null))`
  - `payments_hold_amount_ck`: `hold_provider_amount is null or hold_provider_amount > 0`
  - `payments_hold_fields_ck`: `(hold_provider_amount is null) = (held_at is null)`
  - `payments_hold_outcome_ck`: `enumCheck(t.holdOutcome)`
  - `payments_hold_note_ck`: `hold_note is null or length(trim(hold_note)) > 0`
  - `payments_hold_outcome_fields_ck`: `(hold_outcome is null) = (hold_decided_by is null) and (hold_outcome is null) = (hold_decided_at is null) and (hold_outcome is null or held_at is not null) and (hold_outcome is not null or hold_note is null)`
  - `payments_hold_or_remediation_ck`: `held_at is null or reconcile_remediated_at is null`

  Keys `payments_resolved_by_fk` and `payments_hold_decided_by_fk` → `persons.id`, `restrict`
  (import `persons` from `@waitron/db`; it is core's since A760). Partial indexes:
  `payments_open_hold_idx` on `(held_at)` where `held_at is not null and hold_outcome is null`;
  `payments_unfiled_resolution_idx` on `(working_order_id)` where `resolution_outcome = 'captured'
  and resolved_by is null and sale_id is null`. Delete `payment-resolutions.ts` and
  `payment-holds.ts`; drop their three classification rows and their exports
  (`index.ts:151-152`); set the manifest's payments `appendOnlyTables` to `[]`.
- [ ] **Step 4:** Rebuild `payments`; run the test: PASS.
- [ ] **Step 5: re-home `src/payment-holds.test.ts`'s cases** (the protections moved, design §5;
  these are the only assertions this task removes):
  `:78`, `:103` → the accepting case above; `:113` "second hold" and `:123` "second outcome" →
  Task 3's guard cases; `:132`, `:140`, `:146` → the CHECK cases above under the new names; `:154`
  "a hold naming no payment and an outcome naming no hold" → **dropped**: the hold is the payment's
  own row, so there is nothing to name; `:163` "append-only" → Task 3's guard cases. Delete the file.
- [ ] **Step 6:** Commit `git commit -s -m "payments: resolution, hold and hold outcome become columns on payments"`.
  The package does not typecheck again until Task 3 moves the readers; nothing is pushed between
  the two tasks.

### Task 3: writers, readers, the guard's set-once groups, and the read plans

**Files:** Modify `packages/payments/triggers/payments.sql`, `resolutions.ts`, `holds.ts`,
`store.ts`, `reconcile.ts`, `held-alert.ts`, `errors.ts`; `apps/server/src/payments-api.ts`,
`pending-card-recovery.ts`, `bill-payments-loop.ts`, `testing/zone-payment-venue.ts`;
`apps/dashboard/src/api/client.ts`, `api/live-queries.ts`, `screens/payments-screen.ts`; the
re-pointed tests in **Files**.

**Interfaces:**
- `recordAttemptResolution(tx: Transaction, key: { provider: string; paymentRef: string }, r: { personId: string | null; outcome: "captured" | "failed"; cancelledAtProvider: boolean; providerStatus: string | null; resolvedAt: Date }): Promise<void>` —
  one `UPDATE payments SET resolution_* … WHERE provider = ? AND payment_ref = ?` with no
  `resolution_outcome is null` term, so a second resolution is refused by the guard, as the unique
  index refused it before; zero rows updated → `payment.not_found` `{ provider, paymentRef }`.
  `recordResolution` (by payment id) and `NewPaymentResolution` are deleted; their only product
  callers already use the keyed form (`packages/payments-stripe/src/provider.ts:459`,
  `packages/payments/src/testing/fake-provider.ts:352`).
- `countProviderCancelledResolutions(tx, { provider?, workingOrderId }): Promise<number>` —
  same signature, reads `payments` alone (the copied working-order id goes, `tables-fiscal.md` §6).
- `recordHold(tx, { paymentId, providerAmount, foundAt }): Promise<HoldWrite>` — same signature;
  `UPDATE … SET hold_provider_amount, held_at WHERE id = ? AND held_at IS NULL AND
  reconcile_remediated_at IS NULL RETURNING id`; none → `existing` if `held_at` is set, else `refused`.
- `holdExists(tx, paymentId): Promise<boolean>`, `resolvedHoldsAmong(tx, paymentIds): Promise<Set<string>>` — same signatures, read columns.
- `OpenHold` loses `holdId` and renames `foundAt` to `heldAt`; `export function openHoldsQuery(tx: Transaction)`
  returns the drizzle select (filter `held_at is not null and hold_outcome is null`, order
  `held_at, id`) and `listOpenHolds(tx)` awaits it and maps amounts.
- `apps/server/src/pending-card-recovery.ts`: `export function unfiledAutomaticResolutions(tx: Transaction)`
  returns the select `recoverAutomaticCardPayments` runs today (`:44-60`), on `payments` alone.
- `recordHoldOutcome(tx, { paymentId: string; outcome: HoldOutcome; note: string | null; personId: string; at: Date }): Promise<void>` —
  `UPDATE … WHERE id = ? AND held_at IS NOT NULL AND hold_outcome IS NULL`; none → re-read:
  not held or no row → `payment.hold_not_found` `{ paymentId }`; else
  `payment.hold_already_recorded` `{ paymentId }`. Registry `errors.ts:34-35` params become
  `{ paymentId: string }`.
- `markReconcileRemediated` (`store.ts:816-836`): its `not exists (… payment_holds …)` term becomes
  `held_at is null`.
- Wire: `GET /management-api/payments/held` rows carry `paymentId` in place of `holdId`;
  `POST /management-api/payments/held/:id/outcome` takes the payment's id
  (`requireUuidParam(…, "PaymentId")`). Dashboard `HeldPaymentRow.paymentId`,
  `recordHeldOutcome(paymentId, …)`, `data-test` ids `held-payment-${paymentId}` and
  `record-held-${paymentId}`. `listHeldPayments` live names become `["payments", "working_orders"]`.

- [ ] **Step 1: Write the failing tests.**
  - `payments-guard.test.ts`: "a resolution is written once" (first `update` of the group
    succeeds; any change to any of the five columns afterwards raises `PAYMENT_CHANGE_REFUSAL`);
    the same for "a hold is written once" (two columns) and "a hold's outcome is written once"
    (four columns).
  - `holds.test.ts`: "a sweep that finds a held payment again writes nothing and answers existing"
    (calls `recordHold` twice; second returns `"existing"`; the row's `held_at` unchanged);
    "a payment the sweep reversed is never held" (`markReconcileRemediated` then `recordHold` →
    `"refused"`, `held_at` null); "a held payment is never reversed" (the other order →
    `markReconcileRemediated` returns `false`).
  - `payments-api.held.test.ts`: "records an outcome by the payment's id" and "refuses a payment
    that was never held with payment.hold_not_found".
  - `pending-card-recovery.test.ts` and `held-alert.test.ts`: unchanged assertions, run against the
    new columns.
  - Read plans, on the product's own statements (a hand copy would prove nothing): in
    `holds.test.ts`, "the held list reads by index" — `EXPLAIN QUERY PLAN` of
    `openHoldsQuery(tx).toSQL()` contains `USING INDEX payments_open_hold_idx`; in
    `apps/server/src/pending-card-recovery.test.ts`, "the unfiled-resolution sweep reads by index"
    — the same on `unfiledAutomaticResolutions(tx).toSQL()` with `payments_unfiled_resolution_idx`.
    Neither contains `SCAN payments`, which is what the failing case prints.
- [ ] **Step 2:** Run the files named: FAIL.
- [ ] **Step 3:** Extend `payments_guard_update`'s `WHERE NOT (…)` with three terms:
  `(old.resolution_outcome IS NULL OR (new.resolution_outcome IS old.resolution_outcome AND
  new.resolution_cancelled_at_provider IS old.resolution_cancelled_at_provider AND
  new.resolution_provider_status IS old.resolution_provider_status AND new.resolved_by IS
  old.resolved_by AND new.resolved_at IS old.resolved_at))`, the same shape keyed on
  `old.held_at` over `held_at, hold_provider_amount`, and on `old.hold_outcome` over
  `hold_outcome, hold_note, hold_decided_by, hold_decided_at`. Rebuild `payments`.
- [ ] **Step 4:** Implement the interfaces. In `apps/server`: `pending-card-recovery.ts:40-60`
  filters `payments.resolutionOutcome = 'captured'`, `resolvedBy is null`, `saleId is null` on
  `payments` (no join); `bill-payments-loop.ts:114-127` reads `provided.resolutionOutcome ===
  "failed" && provided.resolvedBy === null` from `findPaymentByBillPayment`'s row (add the two
  fields to what it returns); the held routes read the columns. `zone-payment-venue.ts:128` drops
  `"payment_resolutions"` from its snapshot list. Delete the "No key yet" comments at the old
  person columns (they go with the files).
- [ ] **Step 5: assertions this task changes, each with its reason.**
  `resolutions.test.ts`: `:152` "refuses a payment id that names no payment" (a foreign key
  refusal) → **deleted**: the resolution is the payment's own row, and `:225` already pins
  `payment.not_found` for a key that names nothing; `:160` "second resolution" now asserts
  `triggerRaised(error, PAYMENT_CHANGE_REFUSAL)`; `:172`/`:180` assert the new CHECK names;
  `:189` "append-only" → **deleted**, replaced by the guard's "written once" case; `:204` asserts
  the payment's own row carries the outcome (there is no separate working-order copy).
  `holds.test.ts:225`, `:242`: params `{ paymentId }`.
  `packages/payments/src/backup-verification.test.ts` (by design, the tables are gone): the
  fixture inserts at `:80-86` become the folded columns on the `payment` row (with `manager` seeded
  as a person in both databases); the value-change rows `:260-262` (`payment_resolutions`,
  `payment_holds`, `payment_hold_outcomes`) are **deleted** and one row
  `["payments", "hold_note='Changed note'"]` added; the reference rows `:284-287`
  (`payment_resolutions.payment_id`, `.working_order_id`, `payment_holds.payment_id`,
  `payment_hold_outcomes.hold_id`) are **deleted** — each reference is now the row itself — and
  `["payments", "resolved_by"]`, `["payments", "hold_decided_by"]` added (its `referencesValid`
  walks the schema's keys, `backup-verification.ts:127-160`, so the person keys are checked). `payments-api.held.test.ts` and
  `payments-screen.held.test.ts`: `holdId` → `paymentId` (the wire change above). Any other
  changed assertion is a stop.
- [ ] **Step 6:** Run the Finish line's payments, stripe, server and dashboard commands: PASS.
  Rerun Task 1 Step 4's measurement commands: no refusal text.
- [ ] **Step 7:** Commit `git commit -s -m "payments: follow-ups are written once on the payment's row"`.

### Task 4: guards, docs, protection list

**Files:** the three guards; `docs/developers/conventions-data.md:1426`;
`docs/backlog/architecture.md:274`.

- [ ] **Step 1:** `scripts/behavioural-triggers.test.ts`: add `payments_guard_update` to its
  equality list of non-append-only triggers; add "a payment's amount cannot change"
  (`update payments set amount = amount + 1` raises `PAYMENT_CHANGE_REFUSAL`, imported from
  `../packages/payments/src/trigger-refusals.js`) and its accepting control "a payment still moves
  from attempting to captured". Extend the header comment's list by one clause naming the payments
  guard. `scripts/schema-constraints.test.ts`: delete `:231-232, :234-235` and the three unique
  names at `:458-460`; add `["payments", ["resolved_by"], "persons"]` and
  `["payments", ["hold_decided_by"], "persons"]`. `scripts/append-only-triggers.test.ts`: delete
  the three names at `:64-66`.
- [ ] **Step 2:** Run the Finish line's root guard command: PASS.
- [ ] **Step 3:** Docs: in `conventions-data.md:1426` drop "`payment_resolutions` (payments)," from
  the list of switched-off modules' append-only tables (pa3 adds `payment_refunds` back); in
  `architecture.md:274` drop "`payment_resolutions` (payments, `toggleable`)," from A483's
  entry. No other doc names the three tables outside `docs/superpowers/` and historical records
  (`git grep` in **Finish line**).
- [ ] **Step 4:** Protection list after the change (`--out <B>`), `compare --old <A> --new <B>
  --report <file>`. Paste it into the PR, mark each line against **Expected protection-list
  difference**. An unpredicted line is a stop.
- [ ] **Step 5:** Commit; run `/finish-branch`. The PR description lists the assertions Task 2
  Step 5 and Task 3 Step 5 changed, and says the dev-stack slots and Santet are reset after landing.
