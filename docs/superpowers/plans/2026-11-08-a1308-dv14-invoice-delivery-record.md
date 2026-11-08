# A1308 dv14: `invoice_deliveries` becomes a record only — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** With receipts (dv11), email (dv12) and A4 (dv13) all queued elsewhere, `invoice_deliveries`
drops its seven queue columns in one step: `attempts` (with `invoice_deliveries_attempts_ck`),
`next_attempt_at`, `claim_token_hash`, `claimed_by`, `claimed_agent_id` (with its key to
`print_agents`), `claimed_at`, `printer_hold`. What remains says what was asked for and how it ended
(`tables-ordersales.md` §1.19's table). Every reader of the seven moves to the job or the mail row
first.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U4; [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md)
§1.19 ("Leaving: …"), §5 `invoice_deliveries` row. Rules: [slice rules](2026-11-08-a1308-slice-rules.md).
Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv13. Lines read at `a086eedfb7` and changed by dv11–dv13; a cited function
whose code no longer does what this plan says is a stop (rules §5.1), one that only moved is not.

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported."

## The readers and writers that move first (the inventory)

```bash
git grep -n "invoiceDeliveries\.\(attempts\|nextAttemptAt\|claimTokenHash\|claimedBy\|claimedAgentId\|claimedAt\|printerHold\)\|next_attempt_at\|claimed_at\|printer_hold" -- apps/server/src packages/printing/src ':!*.test.ts'
```

Read at the plan's base and through dv11–dv13's plans; each gets a home:

| Site | Today | After |
| --- | --- | --- |
| `rowAttempt` (`apps/server/src/invoice-delivery-status.ts:326-349`): the attempt's `at` for `queued` (`nextAttemptAt`) and `sending` (`claimedAt`), and `printerHold` | the delivery's columns | `rowAttempt(row, queue)` takes `queue: { dueAt: string; claimedAt: string \| null; printerHold: A4HoldCode \| null }` that `readStates` (`:134-195`) assembles with left joins: the job (`print_job_id`) for print media, the mail row (`dedupe_key = 'invoice:' \|\| id`) for email. `queued`: the mail row's `next_attempt_at` for email, the delivery's `created_at` for print (due at once). `sending`: the job's or mail row's `claimed_at`. `printerHold`: the job's. (`rowAttempt` reads no attempt count.) The A4 "unclaimed since" alert (`apps/server/src/alert-sources.ts:481-486`) reads `at` for a queued A4, so it keeps its time |
| dv12's invoice mail `sweep.due` | the delivery's `claimed_at` for email and A4 | the mail row's lapse is the sender's own (3a-ii); the sweep reads only jobs' `claimed_at` (receipt and A4 deliveries) |
| `queueInvoiceEmail`'s `nextAttemptAt` (dv12) | the delivery's `next_attempt_at` | the retry wait computed directly (`now + RETRY_DELAYS_MS[attempt - 1]`), the delivery writes none |
| `claimInvoicePrintJobs`' `attempts + 1` on a receipt delivery (dv11, `apps/server/src/invoice-print.ts`) and `claimInvoicePagePrint`'s (dv13) | the delivery's `attempts` | not written; the job's own `attempts` already counts |
| `startInvoiceEmail` / `claimInvoiceDelivery` and the generation retry's insert (`invoice-delivery.ts:399-414`) | write `attempts`, `next_attempt_at` | write neither; the attempt number is the mail row's `params.attempt` (dv12) |
| `expireInvoiceDeliveryClaims` (`invoice-delivery.ts:260-287`) | `claimLapsed` on the delivery's `claimed_at` | the job's `claimed_at` only (email lapses on its mail row, 3a-ii) |
| `reportInvoiceDelivery`'s and `reportInvoiceEmailDelivery`'s token check (`:305-325`) | the delivery's `claim_token_hash`, `claimed_by` | print media: the job's (dv11, dv13). Email: the token form goes — its direct callers (`invoice-delivery.test.ts:1503-1900`, the forged token and holder cases at `:1813-1840`, `invoice-customer-data.files.test.ts:131-138`) are **replaced** by mail-row token cases in `invoice-mail.test.ts` (a forged token or holder on the mail row records nothing), each listed in the pull request against the case it replaces |
| `invoice-delivery-actions.ts` (the switch to paper, `:222-232`), `deliveryDue`, `latestNextAttempt` | the delivery's `next_attempt_at` | the mail row is cancelled through 3a-ii's `cancelMail(tx, "invoice:<id>")`; `deliveryDue` and `latestNextAttempt` are deleted when nothing reads them |

The test helpers that read `attempts` from the delivery (dv12's kept cases) read the mail row's
`params.attempt` (email) or the job's `attempts` (print); every `expect` stays.

## What it builds

The seven columns, `invoice_deliveries_attempts_ck` and the key to `print_agents` dropped; the
readers moved as above; `apps/server/src/personal-data-actions.coverage.test.ts:79`
(`invoice_deliveries.claimed_by` leaves `NOT_A_PERSON`).

## Decisions this plan makes

1. **The email token form is replaced, not kept** (dv12 decision 3 left it to this slice): with the
   delivery's token gone, a token check can only be the mail row's, which the sender already makes.
   The replaced cases are listed one for one (stop 2).
2. **No wire change.** `InvoiceDeliveryAttempt` keeps every field (`at`, `printerHold`).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| `invoice_deliveries.person_id`'s key | Orders and sales (os9) |
| A790's `document_page_jobs` | dv15 |

## Files

**Modify:** `packages/db/src/schema/invoice-deliveries.ts:57-100`; `apps/server/src/invoice-delivery.ts`,
`invoice-delivery-status.ts:134-195`, `:326-349`, `invoice-delivery-actions.ts`, `invoice-print.ts`,
`invoice-page-print.ts`, `invoice-mail.ts`, `alert-sources.ts` (only where it read the dropped
columns); `apps/server/src/personal-data-actions.coverage.test.ts:79`;
`scripts/schema-constraints.test.ts` (the agent key out); `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`
(column edits); `docs/developers/conventions-data.md:4719` (the invoice row names no delivery
column any more). Tests: the delivery, mail and status suites (set-up and helpers; decision 1's
replacements). Generated: core's starting migration files and the epoch file.

## Size

| Counted | Lines |
| --- | --- |
| Code: schema 15, status read and `rowAttempt` 50, delivery functions 60, actions 15, print and page claims 10, mail owner 15 | ~165 |
| Tests: replacement token cases 90, helpers and set-up re-pointed 180, status `at` cases 40 | ~310 |
| Docs | ~5 |
| **Total** | **~480** |

About 2 hours.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/invoice-delivery.test.ts src/invoice-delivery-status.test.ts src/invoice-mail.test.ts src/invoice-print-api.test.ts src/invoice-page-print.test.ts src/alert-sources.invoice-delivery.test.ts src/orders-invoice-deliveries.test.ts src/till-api.deliveries.test.ts src/unpaid-invoice-delivery.test.ts src/invoice-customer-data.files.test.ts src/personal-data-actions.coverage.test.ts src/boot.invoice-delivery.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -n "invoiceDeliveries\.\(attempts\|nextAttemptAt\|claimTokenHash\|claimedBy\|claimedAgentId\|claimedAt\|printerHold\)" -- apps packages
```

The grep prints nothing.

## Expected protection-list difference

Under all six headers:

```text
missing table invoice_deliveries.checks[invoice_deliveries_attempts_ck]
missing table invoice_deliveries.columns[attempts]
missing table invoice_deliveries.columns[claim_token_hash]
missing table invoice_deliveries.columns[claimed_agent_id]
missing table invoice_deliveries.columns[claimed_at]
missing table invoice_deliveries.columns[claimed_by]
missing table invoice_deliveries.columns[next_attempt_at]
missing table invoice_deliveries.columns[printer_hold]
missing table invoice_deliveries.foreignKeys[claimed_agent_id->print_agents(id)]
changed table invoice_deliveries.columnOrder
```

Under the two `change-feed` headers, also `changed trigger waitron_change_invoice_deliveries_update.when`.
Reason: `tables-ordersales.md` §5 "`invoice_deliveries` … Dropped with their columns: `_attempts_ck`
and the FK to `print_agents`". Its other keys and CHECKs print nothing.

## Stop points (beyond rules §5)

1. A status read shows a different `at` or `printerHold` for the same set-up.
2. A delivery test outside decision 1's replacements must change an assertion.

## Needs

dv13.

## In-flight work folded in (rules §8)

- **Orders and sales (os9)** adds `invoice_deliveries.person_id`'s key; it lands on either side of
  this slice.

---

### Task 0: base protection list

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.

### Task 1: the readers move

- [ ] **Step 1:** run the inventory grep; reconcile with the table (a site not in it is a stop,
  rules §5.5). Failing cases in `invoice-delivery-status.test.ts`: "a queued email attempt's time is
  its mail row's next attempt"; "a sending A4 attempt's time and hold are its job's"; "a queued A4's
  time is its creation". Run: FAIL (the columns still exist, so these fail until the reads move).
- [ ] **Step 2:** move every site in the table; write decision 1's replacement cases. Run the finish
  line's server suites: PASS. Commit.

### Task 2: the columns go

- [ ] Drop the columns, CHECK and key; rebuild core; the coverage test. Run the full finish line
  (stops 1–2). Commit.

### Task 3: protection list, finish

- [ ] The clock-step row. Protection list after; `compare`; mark each line. Commit; `/finish-branch`;
  reset dev slots and Santet after landing.
