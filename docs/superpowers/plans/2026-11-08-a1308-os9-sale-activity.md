# A1308 orders and sales, PR 9: receipt copies and PDF downloads go to the activity log — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `receipt_reprints` and `invoice_pdf_downloads` into the shared `activity_log` as the
kinds `sale.copy_printed` and `sale.invoice_pdf_downloaded`, keep the dashboard's order dialog live
on them, and give `invoice_deliveries.person_id` its key.

**Architecture:** The five writers call slice 2's `activity_log` writer; the order dialog's two reads
(`readReprints`, `readPdfDownloads`, `apps/server/src/orders-list.ts:736-749, :1103-1118`) read
`activity_log` by `(subject_kind, subject_id)`; the dashboard's `getOrder` subscription names
`activity_log` instead of the two tables. Nothing decides from these rows (README §3, R2).

**Tech stack:** TypeScript, Drizzle ORM on `node:sqlite`, Vitest, Lit (dashboard).

**Spec:** README §3 (`activity_log`, "The order dialog shows reprints and PDF downloads, so
`activity_log` must be a live update source"), §5 U4 ("`invoice_deliveries` becomes a record only");
[tables-ordersales.md](../specs/2026-11-02-rationalisation/tables-ordersales.md) §1.19, §3, §4, §5
(receipt_reprints, invoice_pdf_downloads, invoice_deliveries), §6 item 6, §7 "central". Rules:
[slice rules](2026-11-08-a1308-slice-rules.md).

**Who lands:** the lane (no sale row, number or hash input changes; these rows say who asked for a copy).

**First line of the PR description:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported."

---

## Assumed from batch 1 and devices (check before Task 1; a different name is not a stop, a missing feature is)

- **Slice 2** (`2026-11-08-a1308-2-activity-log.md`) made `activity_log`, a live-update source, with
  the kind registry `ACTIVITY_KINDS` / `ActivityKindData` in `packages/db/src/activity-kinds.ts`, the one
  writer `recordActivity(tx, { kind, subjectId, personId, deviceId?, data })`, and the reader
  `readActivityForSubject(db, { kind, id }, { kinds })` (oldest first, ties by `rowid`). Its plan
  assigns `sale.copy_printed` and `sale.invoice_pdf_downloaded`, and the two order-dialog subscriptions,
  to this slice (its table at `:93`). This PR registers the two kinds: `sale.copy_printed` with subject
  `sale` and data `{ printJobId: string }`; `sale.invoice_pdf_downloaded` with subject `sale` and data
  `{}`; neither names a person in `data`.
- **`invoice_deliveries` becomes a record only in the devices slice** (coordinator, 2026-11-08): the
  devices PR that moves A4 printing onto `print_jobs` also moves invoice email onto `outgoing_mail` and
  drops the queue columns (§1.19 "Leaving"). **This PR does nothing to its email or print-claim
  columns**; it only adds `invoice_deliveries.person_id`'s key to `persons` (U11).

## What it builds

1. Writers: `orders-api.ts:332` (dashboard copy), `orders-reprint.ts:40`, `tender-refund-api.ts:220`,
   `transaction-receipt-api.ts:79` call `recordActivity` with `sale.copy_printed` (subject the sale id;
   the person; the device when a till asked; `data.printJobId`); `orders-invoice-pdf.ts:30` with
   `sale.invoice_pdf_downloaded` (subject the sale id; the person; `data: {}`).
2. Readers: both call `readActivityForSubject(tx, { kind: "sale", id: saleId }, { kinds: [<kind>] })`.
   `readReprints` then reads the named print jobs in one query (printer name, `receipt_copy`) and keeps
   only receipt copies (as `:1115`); the reader's order (`at`, then `rowid`) is the order today's reads
   use (`:749`, `:1116`). The person's display name comes from the entry's `personName`.
3. Live: `apps/dashboard/src/api/live-queries.ts:275, :279` name `activity_log` (one entry);
   `apps/dashboard/src/widgets/order-detail-dialog.ts:269` invalidates `{ type: "activity_log" }`.
4. `invoice_deliveries.person_id`'s key to `persons` (Task 3).
5. `receipt_reprints` and `invoice_pdf_downloads` deleted.

## What it leaves out

| Left out | Owner |
| --- | --- |
| A dashboard history screen over `activity_log` | not built (README U11 "`activity_log` scope") |
| The personal-data download of these kinds | stays as today: both columns are `NOT_YET` (`personal-data-actions.coverage.test.ts:51, :65`), so `activity_log.person_id` follows slice 2's entry |
| `drawer.opened` | devices |
| `invoice_deliveries` record-only (email onto `outgoing_mail`, A4 onto `print_jobs`, its queue columns dropped) | devices slice |

## Files

- Modify: `apps/server/src/orders-api.ts:8, :332`, `orders-reprint.ts:3, :40`,
  `tender-refund-api.ts:7, :220-222`, `transaction-receipt-api.ts:2, :79-81`, `orders-invoice-pdf.ts:3, :30`
- Modify: `apps/server/src/orders-list.ts:20-23, :736-749, :1103-1118`
- Modify: `packages/db/src/activity-kinds.ts` (two kinds)
- Modify: `apps/dashboard/src/api/live-queries.ts:275, :279`; `apps/dashboard/src/widgets/order-detail-dialog.ts:269`
- Modify: `packages/db/src/schema/invoice-deliveries.ts` (person key only)
- Delete: `packages/db/src/schema/receipt-reprints.ts`, `.test.ts`; `packages/db/src/schema/invoice-pdf-downloads.ts`,
  `.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/classification.ts:21, :31`,
  `packages/migrations/migrations.manifest.json:13, :15`
- Modify (tests): the 9 test files naming `receiptReprints` and the 9 naming `invoicePdfDownloads`
  (`git grep -l`), including `orders-reprint.test.ts`, `orders-reprint.issue-clock.test.ts`,
  `printer-delete-history.test.ts`, `tender-refund-receipt-api.test.ts`, `orders-invoice-pdf.test.ts`,
  `invoice-customer-data-api.test.ts`, `print-api.printer-wiring.test.ts`, `receipt-language.test.ts`;
  `apps/dashboard/src/api/live-queries.test.ts`, `apps/dashboard/src/widgets/order-detail-dialog.delivery.test.ts`;
  `apps/server/src/personal-data-actions.coverage.test.ts:51, :65` (drop both entries);
  `scripts/append-only-triggers.test.ts:53, :67`; `scripts/schema-constraints.test.ts`;
  `scripts/live-subscriptions.test.ts` if it pins the two names; Madrid lists (`REMOVED_TABLES` gains both)

## Size

| | Counted | Not counted |
| --- | --- | --- |
| Code | writers 30, readers 40, dashboard 5, `invoice_deliveries` 5 | deleted schema files and tests (about 110); generated files |
| Tests | new reader and live cases 80, re-pointed 150 | — |

About 320 counted lines; about 2 hours.

## Finish line

```bash
pnpm --filter @waitron/server exec vitest run src/orders-reprint.test.ts src/orders-reprint.issue-clock.test.ts src/orders-invoice-pdf.test.ts src/orders-list.test.ts src/tender-refund-receipt-api.test.ts src/transaction-receipt-api.test.ts src/printer-delete-history.test.ts src/invoice-customer-data-api.test.ts src/print-api.printer-wiring.test.ts src/receipt-language.test.ts src/personal-data-actions.coverage.test.ts --reporter=dot
pnpm --filter @waitron/dashboard exec vitest run src/api/live-queries.test.ts src/widgets/order-detail-dialog.delivery.test.ts --reporter=dot
pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/schema-constraints.test.ts scripts/live-subscriptions.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts --reporter=dot
```

## Expected protection-list difference

| Table | Line | Phases |
| --- | --- | --- |
| `receipt_reprints` | `missing table receipt_reprints`; `missing index receipt_reprints.primary key(id)`; `missing index receipt_reprints_sale_idx`; `missing index receipt_reprints_job_uq` | all |
| `invoice_pdf_downloads` | `missing table invoice_pdf_downloads`; `missing index invoice_pdf_downloads.primary key(id)`; `missing index invoice_pdf_downloads_sale_idx` | all |
| both | `missing trigger <t>_append_only_update`, `<t>_append_only_delete` | migrated, change-feed |
| both | `missing trigger waitron_change_<t>_insert`, `_update`, `_delete` | change-feed |
| `invoice_deliveries` | `extra table invoice_deliveries.foreignKeys[person_id->persons(id)]` | all |

Where the protections went (§5): both tables' append-only triggers → `activity_log`'s. Dropped with a
reason (§5): the keys to `sales` and `print_jobs` and `receipt_reprints_job_uq` ("a duplicate row shows
one copy twice, and nothing decides from it").

## Stop points (beyond rules §5)

- Product code decides anything from these rows (only the order dialog reads them today).
- The devices PR that makes `invoice_deliveries` a record only has not landed: this PR can still land
  (it touches only `person_id`), but say so in the PR.

## Needs

- **In this area:** none (independent of os2–os8; take it in any order after os1).
- **Outside:** slice 2 (`activity_log`). `invoice_deliveries` record-only is the devices slice's
  (`page_printers` merged into `printers`, A4 onto `print_jobs`, email onto `outgoing_mail`); this PR
  does not wait for it.

---

## Global Constraints

- Rules §1–§9. The order dialog shows the same copies and downloads, in the same order, with the same
  printer names, and refreshes after each action as it does today.

## Review Focus

1. **A copy printed on a printer later deleted:** `readReprints` joins `print_jobs` today with an inner
   join; keep the join and the result. Test: `printer-delete-history.test.ts`, re-pointed.
2. **A document print that is not a receipt copy** (`print_jobs.receipt_copy` false) stays out of the
   list. Test: Task 1's control.
3. **The dialog refreshes after a download** through the `activity_log` invalidation. Test:
   `order-detail-dialog.delivery.test.ts`'s refresh case, re-pointed.
4. **Two copies in the same second** keep their order by `rowid`. Test: Task 1.
5. **Another sale's rows** never appear: the read filters `subject_kind = 'sale' and subject_id = ?`.
   Test: Task 1.

---

### Task 1: Write and read the two kinds

- [ ] **Step 1: Re-point the tests** (assertions unchanged) and add in `orders-list.test.ts`:
  `"lists a sale's receipt copies from the activity log, oldest first, with their printers"` (two copies
  with one `at`, ordered by `rowid`; a document print with `receipt_copy` false left out; another sale's
  copy left out) and `"lists a sale's PDF downloads from the activity log"`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the two registry entries and the writers and readers (What it builds,
  1–2).
- [ ] **Step 4: Run** the Finish line's server command; PASS.
- [ ] **Step 5: Commit** `refactor(server): receipt copies and PDF downloads are activity log entries`.

### Task 2: The dialog stays live

- [ ] **Step 1: Re-point** `live-queries.test.ts` and the dialog's refresh test to `activity_log`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** (What it builds, 3).
- [ ] **Step 4: Run** the dashboard command and `scripts/live-subscriptions.test.ts`; PASS.
- [ ] **Step 5: Commit** `feat(dashboard): the order dialog watches the activity log`.

### Task 3: `invoice_deliveries.person_id` gets its key

- [ ] **Step 1: Write the failing test** in a new `packages/db/src/schema/invoice-deliveries.test.ts`:
  `"refuses a delivery for a person who does not exist"`, with a control for a seeded person and one for
  a receipt row with no person (`invoice_deliveries_person_ck` allows it).
- [ ] **Step 2: Run; it fails. Step 3: Add the key; rebuild core. Step 4: Run; PASS.**
- [ ] **Step 5: Commit** `feat(db): an invoice delivery's person is a checked key`.

### Task 4: Delete; registries; finish

- [ ] **Step 1:** Delete the two schema files, exports, classification and manifest entries; update
  `scripts/append-only-triggers.test.ts` (`EXPECTED` loses both), `scripts/schema-constraints.test.ts`,
  the personal-data coverage list, the Madrid lists.
- [ ] **Step 2:** Rebuild core; Finish line; protection list.
- [ ] **Step 3: Docs.** Grep `docs/developers/` and the dashboard guide for "reprint" sentences that name
  the table; reword.
- [ ] **Step 4: Commit**, `/finish-branch`, PR.
