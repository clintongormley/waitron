# A1308 dv11: print jobs record their handover, wait between retries, and hold an invoice receipt's claim — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**One pull request, two parts** (merged on 2026-11-08 from two smaller plans to keep the area's PR
count down after dv4 split; both change only `print_jobs` and the code around it, and part B uses
part A's `next_attempt_at`). Build part A's tasks, then part B's, in one branch; run the protection
list once, at the end, against the combined prediction (part A's lines plus part B's).

- **Part A** — the receipt handover as two columns (`handed_over_by`, `handed_over_at`; R4), the
  6 November addition `next_attempt_at` (retry spacing), and measurement M1.
- **Part B** — the claim of an invoice printed on a receipt printer moves from the delivery record
  onto its print job (`claim_token_hash`), and the agent's claim message drops `deliveryId` and
  `generation`.

**Spec:** README §3 R2, R4; §5 U4, U10, U11; "Additions of 6 November 2026", row `print_jobs`;
[tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md) §1.7, §3 last paragraph,
§8 M1; [tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.19. Rules:
[slice rules](2026-11-08-a1308-slice-rules.md). Area order: [dv1](2026-11-08-a1308-dv1-devices-row.md).

**Base:** `main` after dv10. Lines read at `a086eedfb7`; a cite whose code no longer says what this
plan says is a stop (rules §5.1), one that only moved is not.

**Owner lands:** no (rules §6).

**Pull request's first line (rules §2):** "Every venue is reset: core; backups and exports from
before this cannot be restored or imported. Print agents must run this release: the invoice claim in
the agent's messages changes."

**Size, both parts:** about 380 + 470 = **~850** counted lines (each part's table below; the M1 and
retry docs are counted once). About 3½ hours.

**Expected protection-list difference, both parts:** under all six headers, part A's seven lines and
part B's `extra table print_jobs.columns[claim_token_hash]`, with a single `changed table
print_jobs.columnOrder`; under the two `change-feed` headers, one `changed trigger
waitron_change_print_jobs_update.when`.

## Part A — handover, retry spacing, M1

### M1: the measurement (Task 1, before any change)

**What runs:** on the Santet data venue as it stands at the base (worktree
`waitron-local-santet-data`; read-only, through `sqlite3 -readonly` on its `venue.db`):
`select count(*), sum(length(payload)), avg(length(payload)) from print_jobs` and the same grouped by
`kind`. **Use:** README U10 promised A980 a growth figure for print job payloads; there is no
failing result (`tables-devices.md` §8 M1 names none). **If the venue holds no print jobs** (its
history may be imported sales with no printing), run the same query on slice 0's year-of-trading
bench venue if slice 0's second pull request has landed (`bench build`), and say which; if neither
holds jobs, record "not measured, and why". The figure goes into `docs/backlog/printers.md`, "The
virtual PDF printer" entry (`:312-327`), which holds the retention question, as one dated line.

### What it builds

`print_jobs` (`packages/db/src/schema/print-jobs.ts`):

| Column (drizzle) | Type | Rule |
| --- | --- | --- |
| `handed_over_by` (`handedOverBy`) | `id`, null, key to `persons`, restrict (README U11) | was `receipt_handover.personId` |
| `handed_over_at` (`handedOverAt`) | `tsString`, null | was `receipt_handover.confirmedAt` |
| `next_attempt_at` (`nextAttemptAt`) | `tsString`, null | null = due now; set only when an attempt fails and another is left |

- `receipt_handover` is dropped. CHECK `print_jobs_handover_pair_ck`: `(handed_over_by is null) =
  (handed_over_at is null)`.
- `confirmReceiptHandover` (`apps/server/src/receipt-print.ts:497-512`) writes the two columns;
  `readOriginalReceiptPrints` (`:437-469`) reads them; `OriginalReceiptPrint.handover` keeps its
  shape `{ personId, confirmedAt }` (`:419-427`), so no wire or screen changes.
- **Retry spacing** in `packages/printing/src/runtime.ts`:
  - `export const PRINT_RETRY_WAITS_MS = [5_000, 15_000, 30_000, 60_000] as const;` — the wait after
    the 1st, 2nd, 3rd and 4th failed attempt; the 5th failure leaves no attempt
    (`MAX_DELIVERY_ATTEMPTS = 5`, `:8`). About 110 seconds from the first failure to the last.
  - `reportPrintJob`'s failure branch (`:178-180`) also sets `next_attempt_at = now +
    PRINT_RETRY_WAITS_MS[attempts]` (indexed by the attempts before this one) while attempts stay
    below the maximum, and null otherwise; a `done` report clears it.
  - `dueNow` (`:48-67`) gains a parameter `{ waitForRetry: boolean }`. With `true` (the claim), a
    failed document is due only when `next_attempt_at is null or next_attempt_at <= now or
    next_attempt_at > now + 60s` (the last clause: stamped before the clock stepped back, as every
    other wait in the clock-step table, `docs/developers/conventions-data.md:4719-4721`). With
    `false` (`endUnpairedPrinterJobs`, `:151-170`), a waiting failed job still counts, so an unpaired
    printer's waiting job ends too, as today.
  - **Order is kept** (decision 4): while an earlier failed document on a printer waits for its
    retry, later **document** jobs on that printer wait too. The claim adds `and not exists (select
    1 from print_jobs w indexed by print_jobs_pull_idx where w.printer_id = j.printer_id and
    w.kind = 'document' and w.status = 'failed' and w.attempts < MAX and w.next_attempt_at > now and
    w.next_attempt_at <= now + 60s and (w.created_at < j.created_at or (w.created_at = j.created_at
    and w.rowid < j.rowid)))` for `j.kind = 'document'`. Today the retry is claimed first and the
    later jobs print after it (the order clause, `:113-120`; pinned by
    `packages/printing/src/runtime.history.test.ts:148`, "keeps failed-printer priority…"), so
    without this rule a wait would let later tickets print before the retried one. **Drawer kicks do
    not wait** behind a failing document: D1 (PR #2594) ends a drawer request left waiting 30 seconds,
    and a cash sale's drawer must not be held by a jammed receipt. The order clause itself is
    unchanged.

### Decisions this plan makes

1. **The waits are fixed constants, not settings** (environment.md's rule: knobs nobody sets become
   constants).
2. **The person key restricts deletion** (README U11: "until a row can be deleted, the key refuses
   deletion"). `print_jobs.handed_over_by` joins `NOT_YET` in
   `apps/server/src/personal-data-actions.coverage.test.ts:43-74` (its name matches the actor
   pattern at `:25-26`); it is not in the personal-data download today and this slice does not add
   it.
3. **Thermal jobs only.** A job linked to an invoice delivery is still gated by the delivery's own
   due time (`invoiceDue`, `runtime.ts:89-102`) until part B moves that claim onto the job.
4. **Later documents wait behind a waiting retry; drawer kicks do not** (above). Recommended by
   the coordinator's review; it keeps today's printing order.

### What it leaves out

| Left out | Who takes it |
| --- | --- |
| `printer_hold`, `kind = 'a4'` | dv13 |
| Emptying old payloads | A980 (README U10); M1 gives it the figure |
| Showing the retry time on the Printers screen | Not built: the queue already shows a failed job with attempts left as active (`apps/server/src/print-api.ts:1463-1469`) |

### Files

**Modify**
- `packages/db/src/schema/print-jobs.ts:54-56` and the CHECK list.
- `apps/server/src/receipt-print.ts:419-512`.
- `packages/printing/src/runtime.ts:6-12`, `:48-67`, `:69-135`, `:151-189`.
- `apps/server/src/personal-data-actions.coverage.test.ts:43-74`.
- `scripts/schema-constraints.test.ts` (add `["print_jobs", ["handed_over_by"], "persons"]`).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`print_jobs` column edits).
- `docs/developers/conventions-data.md:4720` (the "Print-job lease" row gains the retry wait and its
  bound, with the new test names).
- `docs/backlog/architecture.md:1225-1226` (delete the "Retry spacing" bundle entry) and the
  bundle's count line (`:1182`, "16 entries" becomes 15).
- `docs/backlog/printers.md:312-327` (M1's line).
- Tests that write `receipt_handover` directly (`git grep -l "receiptHandover\|receipt_handover" -- '*.test.ts'`, 3 files): set-up only.
- Generated: core's starting migration files and the epoch file.

**Create:** `packages/printing/src/runtime.retry.test.ts`, `packages/db/src/schema/print-jobs.handover.test.ts`.

### Size

| Counted | Lines |
| --- | --- |
| Code: schema 15, receipt handover 20, runtime retry 35 | ~70 |
| Tests: retry test 190, handover schema test 60, set-up re-pointed 20, coverage and guard lists 5 | ~225 |
| Docs: clock-step row, backlog edits, M1 line | ~15 |
| **Total** | **~310** |

About 1½ hours plus M1.

### Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/print-jobs.handover.test.ts
pnpm --filter @waitron/printing exec vitest run
pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts src/personal-data-actions.coverage.test.ts src/print-api.test.ts src/print-agent-e2e.test.ts src/print-job-trouble.test.ts src/till-api.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db --filter @waitron/printing --filter @waitron/server typecheck
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -n "receiptHandover\|receipt_handover" -- apps packages scripts ':!**/test-fixtures/**' ':!apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts'
```

The grep prints nothing (the frozen `country-es` demo captures are test fixtures and stay).

### Expected protection-list difference

Under all six headers:

```text
missing table print_jobs.columns[receipt_handover]
changed table print_jobs.columnOrder
extra table print_jobs.checks[print_jobs_handover_pair_ck]
extra table print_jobs.columns[handed_over_at]
extra table print_jobs.columns[handed_over_by]
extra table print_jobs.columns[next_attempt_at]
extra table print_jobs.foreignKeys[handed_over_by->persons(id)]
```

Under the two `change-feed` headers, also `changed trigger waitron_change_print_jobs_update.when`.

Reasons: `tables-devices.md` §1.7 (the two columns and their CHECK, R4) and README "Additions of 6
November 2026" (`next_attempt_at`). `receipt_handover` had no protection to carry. D1's
`print_jobs_printer_kind_idx` (PR #2594), if landed, prints nothing: it is unchanged.

### Stop points (beyond rules §5)

1. A printing or server test asserts a failed document is claimed again at once after a failure
   (the old loop-speed behaviour) as part of what it checks, rather than as incidental set-up.
2. An invoice-receipt test (`runtime.invoice.test.ts`) changes result: decision 3 says it must not.

### Needs

dv10 (last core change).

### In-flight work folded in (rules §8)

- **D1, PR #2594:** its drawer expiry (30-second wait, 60-second claim) lives in `runtime.ts`; drawer
  jobs are never retried (`dueNow`'s `j.kind = 'document'` branch), so the retry wait does not touch
  them. Keep its index.
- **A405 PR 4** (reprint to another printer): a resend makes a new job, with `next_attempt_at` null.

---

#### Task 0: base protection list and M1

- [ ] `pnpm protection-list list --out <empty absolute dir A>` in a throwaway worktree of the base.
- [ ] Run M1 as described; keep the numbers for Task 4.

#### Task 1: handover columns

- [ ] **Step 1: failing test** `print-jobs.handover.test.ts`: "a handover names a real person and
  a time, both or neither" (one without the other raises `print_jobs_handover_pair_ck`); "refuses a
  person who does not exist" (foreign key); "refuses deleting a person a handover names". Run:
  FAIL.
- [ ] **Step 2:** schema; rebuild core; `receipt-print.ts`; the three tests' set-up; the coverage
  test's `NOT_YET`. Run the test and `src/receipt-print.test.ts`: PASS with assertions unchanged.
  Commit.

#### Task 2: retry spacing

- [ ] **Step 1: failing test** `runtime.retry.test.ts` (`useVenueDb`, a network printer, one job,
  fake `Date` only): "after a failed attempt a job waits 5 s, then 15 s, 30 s and 60 s before it is
  claimed again" (claim at each wait minus 1 ms returns nothing; at the wait it returns the job);
  "the fifth failure leaves no attempt and no wait" (`status failed`, `attempts 5`,
  `next_attempt_at` null; never claimed again); "a done report clears the wait"; "a wait stamped
  more than 60 s ahead, as before a backward clock step, is due at once"; "an unpaired printer's
  waiting job is ended with the others" (`endUnpairedPrinterJobs` returns it); "a later document on
  the same printer waits behind a waiting retry and prints after it" (a second job queued after the
  first failure is not claimed until the retry is); "a drawer kick on that printer is claimed while
  the retry waits"; "a job on another printer is not held". Run: FAIL.
- [ ] **Step 2:** implement; rebuild core (the column). Run `@waitron/printing` and the server suites
  in the finish line: PASS (stops 1–2). Commit.

#### Task 3: docs

- [ ] The clock-step row (`conventions-data.md:4720`): add "and a failed document's next attempt
  further ahead than the longest wait (60 seconds) is due (tests: `runtime.retry.test.ts`, 'stamped
  more than 60 s ahead')". Delete the "Retry spacing" bundle entry and fix the count. M1's line in
  `printers.md`: "M1 (A1308 dv11, <date>): <n> jobs, <total> bytes, <average> bytes each on <which
  venue>; by kind: …". Commit.

#### Task 4: commit part A

- [ ] Commit. The protection list and `/finish-branch` run once, after part B (Task 7).

## Part B — the invoice receipt's claim on its job

### What it builds

- `print_jobs.claim_token_hash` (`label`, null): the hash (`tokenHash`,
  `apps/server/src/invoice-delivery.ts:208-210`) of the token the agent got with an invoice job's
  claim. Written at claim, kept after a report so a late report can be authenticated, as the
  delivery keeps its hash today (`invoice-delivery.ts:363`).
- **The agent's message.** `InvoicePrintClaim` (`packages/print-agent/src/client.ts:75`) becomes
  `{ token: string }`; the pull's parse (`:311-335`) accepts only that shape; `JobOutcome` still
  carries it back. The server's reader `readInvoicePrintClaim` (`apps/server/src/print-api.ts:155-176`)
  and the pull (`:750`) follow. The job id the message already carries (`WireJob.id`) names the job;
  `deliveryId` and `generation` leave (§1.7).
- **Claim** (`claimInvoicePrintJobs`, `invoice-print.ts:59-101`): `claimPrintJobs` is called with
  `{ withInvoiceReceipts: true }` instead of the two timestamps; for each claimed job that has a
  `receipt` delivery, a fresh token's hash is written to the job's `claim_token_hash`, and the
  delivery goes `queued` → `sending` with its `attempts` raised by one, in the same transaction
  (refusal still rolls the batch back, `:89-90`). The delivery's `claim_token_hash`, `claimed_by`,
  `claimed_agent_id` and `claimed_at` are **not** written for a receipt delivery any more.
- **The due rule** (`packages/printing/src/runtime.ts:69-135`): `ctx.invoiceReceiptsAt` and
  `ctx.invoiceReceiptsAheadAt` give way to `ctx.withInvoiceReceipts?: boolean`; `invoiceDue` becomes
  `not exists (delivery for the job) or (withInvoiceReceipts and exists (delivery for the job with
  status 'queued'))`. A receipt delivery's `next_attempt_at` is always its creation time today
  ("Only an email retry sets it to a later time", §1.7, `invoice-delivery.ts:413`), so nothing a
  receipt did is lost. (An invoice receipt job is never retried automatically: its report and its
  lapse set its attempts to the maximum, `invoice-delivery.ts:280`, `:380`.)
- **Report** (`reportInvoicePrintJob`, `invoice-print.ts:103-126`): the claim is checked on the job
  (`claimed_by` is the reporting agent and `claim_token_hash` matches); the delivery is found by
  `print_job_id`; `reportInvoiceDelivery` (`invoice-delivery.ts:305-385`) takes a new claim form for
  this case, `{ printJobId, token, holder }`, and keeps every rule it has: a newer generation for the
  sale makes the report history only (`:326-336`), a deleted printer's receipt keeps the state its
  delete gave it (`:337-349`), an `unknown` stays `unknown` unless the report says sent (`:351-356`),
  the job ends `done` or `failed` with no attempts left (`:372-383`).
- **Lapse** (`expireInvoiceDeliveryClaims`, `invoice-delivery.ts:260-287`): for a `receipt` delivery
  `sending`, the claim has lapsed when its **job's** `claimed_at` has (the same `claimLapsed` bounds,
  60 seconds and the backward-step rule, applied to `print_jobs.claimed_at`); email and A4 deliveries
  keep using their own `claimed_at`. The result for a lapsed receipt is today's: delivery `unknown`,
  `timeout`, job `failed` with no attempts left.
- `claimInvoiceDelivery` (`:212-258`) keeps serving email and A4 unchanged; its receipt branch
  (`:220-234`) moves into `claimInvoicePrintJobs`.

### Decisions this plan makes

1. **The token stays a separate secret from the job id.** The job id travels in the pull and in log
   lines; the token proves the report comes from the claim the server handed out, as today.
2. **Generation leaves the wire, not the record.** `invoice_deliveries.generation` and its unique
   key stay (`tables-ordersales.md` §1.19); the server finds the delivery from the job, so the agent
   need not echo it.
3. **Assertions that change** (the owner-announced protocol change, §1.7): only the expected wire
   bodies and parsed claims in `packages/print-agent/src/client.test.ts`,
   `packages/print-agent/src/invoice-claim.test.ts`, `apps/server/src/invoice-print-api.test.ts`,
   `apps/server/src/print-agent-e2e.test.ts` and `packages/printing/src/runtime.invoice.test.ts`,
   where `{ deliveryId, generation, token }` becomes `{ token }` and the context argument of
   `claimPrintJobs` changes. Each such line is listed in the pull request. Any other assertion change
   is a stop.

### What it leaves out

| Left out | Who takes it |
| --- | --- |
| Invoice email off the delivery's claim | dv12 |
| A4 claims on `print_jobs` | dv13 |
| Dropping the delivery's claim, lease, hold, `attempts` and `next_attempt_at` columns | dv14 |

### Files

**Modify**
- `packages/db/src/schema/print-jobs.ts`.
- `apps/server/src/invoice-print.ts`, `apps/server/src/invoice-delivery.ts:168-385`,
  `apps/server/src/print-api.ts:155-176`, `:740-780`.
- `packages/printing/src/runtime.ts:69-135`, `:172-189` (the `not exists` guard stays).
- `packages/print-agent/src/client.ts:75-100`, `:300-345`; `apps/print-agent` only if it builds a
  claim (`git grep -n invoiceClaim apps/print-agent`).
- `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (`print_jobs` column edit).
- `docs/developers/conventions-data.md:4719` (the invoice row: the receipt printer's pick no longer
  reads the delivery's next attempt; its lapse reads the job's claim).
- Tests named in decision 3, plus `apps/server/src/invoice-delivery.test.ts` (its receipt cases'
  set-up and raw reads of the delivery's claim columns re-pointed to the job's), `receipt-print.test.ts`,
  `alert-sources.invoice-delivery.test.ts` (receipt cases' set-up only).
- Generated: core's starting migration files and the epoch file.

### Size

| Counted | Lines |
| --- | --- |
| Code: schema 5, invoice-print 50, invoice-delivery 60, runtime 20, print-api 15, agent client 25 | ~175 |
| Tests: new claim and lapse cases 110, protocol lines 60, set-up and raw reads re-pointed 120 | ~290 |
| Docs | ~5 |
| **Total** | **~470** |

About 2½ hours.

### Finish line

```bash
pnpm --filter @waitron/printing exec vitest run
pnpm --filter @waitron/print-agent exec vitest run
pnpm --filter @waitron/server exec vitest run src/invoice-print-api.test.ts src/invoice-delivery.test.ts src/print-agent-e2e.test.ts src/receipt-print.test.ts src/alert-sources.invoice-delivery.test.ts src/till-api.deliveries.test.ts src/orders-invoice-deliveries.test.ts src/boot.invoice-delivery.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
pnpm --filter @waitron/db --filter @waitron/printing --filter @waitron/print-agent --filter @waitron/server --filter @waitron/print-agent-app typecheck
pnpm exec vitest run scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
git grep -n "invoiceReceiptsAt\|invoiceReceiptsAheadAt\|claim.deliveryId" -- apps packages
```

The grep prints nothing.

### Expected protection-list difference

Under all six headers:

```text
changed table print_jobs.columnOrder
extra table print_jobs.columns[claim_token_hash]
```

Under the two `change-feed` headers, also `changed trigger waitron_change_print_jobs_update.when`.
Reason: `tables-devices.md` §1.7 (`claim_token_hash` "moved from `invoice_deliveries`"; the
delivery's column stays until dv14, so nothing is missing yet).

### Stop points (beyond rules §5)

1. An assertion outside decision 3's list must change.
2. A report that today is history (a newer generation exists) becomes current, or the reverse.
3. A receipt delivery stamped with a later `next_attempt_at` exists in any fixture and a case
   depends on the job waiting for it (the premise that only email sets it would be false).

### Needs

Part A (`next_attempt_at` on jobs).

### In-flight work folded in (rules §8)

- **D1, PR #2594:** its claim-expiry for drawer jobs is in `runtime.ts`; untouched here.
- **A405 PR 4:** `resendInvoicePrintJob` (`invoice-print.ts:24-57`) makes a new job and delivery;
  unchanged.

---

#### Task 5: the claim on the job

- [ ] **Step 1: failing cases** in `invoice-print-api.test.ts` (or `invoice-delivery.test.ts`'s
  receipt describe): "an invoice job's claim stores the token's hash on the job, not the delivery";
  "a report with the right token on the right job records the delivery sent"; "a report with
  another job's token is ignored"; "a report from an agent that does not hold the job is ignored";
  "a receipt claim lapses when its job's claim does, and the delivery ends unknown with timeout";
  "a job claim taken 400 days ahead has lapsed". Run: FAIL.
- [ ] **Step 2:** the column (rebuild core), `claimInvoicePrintJobs`, `reportInvoicePrintJob`,
  `reportInvoiceDelivery`'s new claim form, the lapse, the runtime due rule.
- [ ] **Step 3:** the agent message (client parse, server reader and pull); decision 3's lines.
  Run the finish line: PASS (stops 1–3). Commit.

#### Task 6: docs, protection list for both parts, finish

- [ ] The clock-step row. Protection list after; `compare` against Task 0's list; mark each line
  against the combined prediction (header). Commit;
  `/finish-branch`; reset dev slots and Santet after landing (their print agent containers are built
  from the same commit by `wa-wt`, so they speak the new message).
