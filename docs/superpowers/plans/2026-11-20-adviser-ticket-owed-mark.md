# ADVISER-TICKET-OWED-MARK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: plan, for a fresh Claude read and then the watcher. FISCAL item; the owner lands it. Written
against main `64ea6c0c39`. Survey with receipts: `~/waitron-campaign-l/receipts/adviser-ticket-owed-mark/survey.md`.

**Goal:** Every sale a till records prints its ticket unless it was emailed, even when the till's
close request never arrives, an email fails after **Done**, or the device only gets a receipt printer later.

**Architecture:** A new `owed_tickets` row (sale, device, since when) is written in the same
transaction that records a till sale. A new server job, beside #3835's `receipt.owed`, queues the
original receipt for each marked sale that is still owed (`owesOriginal`, unchanged) and has no
original print job at all, 10 minutes after the sale, on the marked device's receipt printer,
through the same code the till's close request uses. Printed or delivered tickets, and marks over
24 hours old, are cleared. #3835's close request and fresh rounds stay as they are.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest with `useVenueDb`, the server job runner.

**Spec:** lane L queue item (watcher, 2026-11-19 12:32); adviser sheet question 3
(`docs/compliance/2026-11-19-adviser-meeting.md`); owner rule 2026-11-19 20:57 (the receipt or
invoice is required for every sale; no design relies on a payment slip); #3835's plan
`docs/superpowers/plans/2026-11-19-adviser-no-none.md`.

**What staff get:** if the till crashes or loses the network before the window closes, the receipt
prints by itself about 10 minutes later. If they emailed the ticket and the email fails for good,
the receipt prints on that till's printer. A till with no receipt printer prints its owed tickets
from the last 24 hours as soon as one is set for it. Nothing new prints for dashboard payments.

**Size:** about +190 production lines (schema 20, mark 45, job 95, call sites 20, boot/catalogue/
classification 10), +430 test lines, about +110 generated (core's starting migration and snapshot).

## Global Constraints

- Nothing filed with AEAT changes: no edit to `computeHuella`, the chain, numbering, series,
  `registros_facturacion` or its triggers, or the alta builders. Records are made at issuance by
  `recordSale`; the mark and the print happen after that and write only `owed_tickets`,
  `print_jobs` and `invoice_deliveries`. If a task needs a fiscal file, STOP and ask.
- Printing never blocks or rolls back a sale (CLAUDE.md §5): the mark is written through
  `optionalDocument`; the job runs in its own transactions.
- At most one original per sale: the job queues only through `enqueueOriginalReceipt`'s
  "exists" check (`receipt-print.ts:578-584`) and only while `owesOriginal` is true, re-read under
  the write lock. It never prints while an original email is `queued`, `sending`, `sent` or `unknown`.
- What prints is what the close request prints: the same builder (`readSettledTicket`) and printer
  lookup (`whileSwitchedOff: true`).
- Pre-live: change `packages/db/src/schema`, then `pnpm --filter @waitron/db db:generate`; never a new
  migration or a hand edit. On a rebase conflict take main's generated files and rerun it.
- Run one file at a time with `pnpm --filter @waitron/server exec vitest run <file>`; every task's
  check includes `pnpm exec prettier --check <changed files>`.

## Review Focus

1. The till's **Done** and the job act on the same sale at once: one original job, never two.
2. An email whose outcome is `unknown` when the 10 minutes pass: nothing prints, then or later.
3. A sale whose original was ended by a deleted, unpaired or moved printer: the mark does not
   reprint it (#3835's D3 stands).
4. A device whose profile may not print receipts: nothing prints (#3835's D4 stands).
5. A device that had no printer and gets one 25 hours later: nothing prints (the mark expired).

---

### Task 1: The mark: table, writer, clearing

**Files:**
- Create: `packages/db/src/schema/owed-tickets.ts`; export it from `packages/db/src/index.ts`
- Modify: `packages/db/src/classification.ts` (beside `print_jobs`, `:169`), `scripts/write-path-tables.json`,
  generated `packages/db/drizzle/*` (by the command only)
- Create: `apps/server/src/ticket-owed-mark.ts`, `apps/server/src/ticket-owed-mark.test.ts`

**Interfaces:**
- Produces: `owedTickets` = `table("owed_tickets", { saleId: id("sale_id").primaryKey().references(() => sales.id),
  deviceId: id("device_id").notNull().references(() => devices.id, { onDelete: "restrict" }),
  owedSince: tsString("owed_since").notNull().$defaultFn(nowIso) })`, classified
  `classify("owed_tickets", "state", "which till sales still owe their ticket; copied to a standby, never drained back")`.
- Produces: `markTicketOwed(tx: Transaction, saleId: string, deviceId: string): Promise<void>`
  (`onConflictDoNothing({ target: owedTickets.saleId })`: the first till keeps it);
  `clearOwedTickets(tx: Transaction, now: Date): Promise<number>` deletes marks whose sale has an
  original print job (`receipt_copy = false`, any kind) `done`, or an original delivery `sent`, or whose
  `owedSince` is more than 24 hours before `now`. `OWED_TICKET_FOR_MS = 24 * 60 * 60_000` exported.
- write-path entry: `"owed_tickets": ["apps/server/src/ticket-owed-mark.ts"]`.

- [ ] **Step 1: Failing tests** in `ticket-owed-mark.test.ts` (`useVenueDb`, seeds as `owed-receipts.test.ts:46-96`):
  `"marks a sale once, keeping the first device"` (two calls, second device → one row, first `deviceId`);
  `"clears a mark once an original printed"` (job `done` → 1 cleared, row gone);
  `"clears a mark once an original email was sent"`;
  `"keeps a mark while the original is queued, failed, given up, or an email is unknown or failed"` (each → 0 cleared);
  `"keeps a mark when only a copy printed"` (`receipt_copy = true`, `done` → 0);
  `"clears a mark 24 hours and one second old, keeps one 23 hours 59 minutes old"`.
- [ ] **Step 2:** run the file; expect FAIL (module missing).
- [ ] **Step 3:** schema, export, classification, write-path entry, then `pnpm --filter @waitron/db db:generate`.
  Then the two functions.
- [ ] **Step 4:** run the file (PASS), then from the root: `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/write-path-tables.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`, and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts` (unedited, passes).
- [ ] **Step 5:** `git commit -s` "Keep a mark for a till sale whose ticket is still owed".

### Task 2: Set the mark on the till's sale paths only

**Files:**
- Modify: `apps/server/src/receipt-print.ts:280-301` (`enqueueSaleReceipt`), `apps/server/src/optional-document.ts:5`
  (operation union gains `"markTicketOwed"`), `apps/server/src/bill-payments.ts:792-978` (options),
  `apps/server/src/payments-api.ts:1601`, `apps/server/src/deferred-close.ts` (after `issueUnpaidInvoice`, `:160`),
  `apps/server/src/meal-end.ts` (after `issueUnpaidInvoice`, `:129`)
- Test: one case each in `till-api.fiscal-sale-paths.test.ts`, `bill-payments-api.test.ts`,
  `deferred-close.test.ts`, `meal-end.test.ts`, `payments-api.stuck.test.ts`, `unpaid-departure.test.ts`

**Interfaces:**
- Consumes: `markTicketOwed` (Task 1).
- Produces: `enqueueSaleReceipt(tx, cfg, ticket, saleId, printers?, options?: { ticketOwed?: boolean })`
  marks when `ticketOwed !== false` and `cfg.origin.source === "device"`, inside its own
  `optionalDocument(tx, "markTicketOwed", saleId, …)`. `issueIfFullyPaid`'s and `issueWhenFullyPaid`'s
  options gain `ticketOwed?: false`, passed to all three `enqueueSaleReceipt` calls (`:866, :946, :966`).
  Only `payments-api.ts:1601` (the dashboard's retained partial refund) passes `ticketOwed: false`.
  Deferred close and Print the bill call `markTicketOwed(tx, saleId, cfg.origin.deviceId)`.
  Unpaid departures and #3847's close-of-day issue set none (they never call these).

- [ ] **Step 1: Failing tests**, each reading `owed_tickets` after the request:
  `"a cash sale at the counter marks its ticket owed by the device that sold it"`;
  `"a connected-card sale marks its ticket owed"`;
  `"a bill paid off through bill payments marks its ticket owed by the paying device"`;
  `"a deferred close marks its ticket owed"`; `"Print the bill marks its ticket owed"`;
  `"a partial refund kept from the dashboard leaves no mark"`; `"a party left without paying leaves no mark"`.
- [ ] **Step 2:** run the six files; the five positive cases FAIL.
- [ ] **Step 3:** implement as Interfaces says.
- [ ] **Step 4:** run the six files and `till-api.receipt.test.ts`, `receipt-print.test.ts`; PASS.
- [ ] **Step 5:** `git commit -s` "Mark a till sale's ticket owed when it is recorded; dashboard payments stay out".

### Task 3: The job prints marked tickets still owed; guide

**Files:**
- Modify: `apps/server/src/till-sale.ts:1034-1074` (extract the `"owed"` branch)
- Create: `apps/server/src/ticket-owed-job.ts`, `apps/server/src/ticket-owed-job.test.ts`
- Modify: `apps/server/src/job-catalogue.ts:17` (+ its test), `apps/server/src/boot.ts:4500-4506`,
  `apps/server/src/guide/en/table-service.md:83`, `apps/server/src/guide/es/table-service.md:89-90`

**Interfaces:**
- Produces in `till-sale.ts`: `queueOwedOriginal(tx: Transaction, backend: FiscalBackend, cfg: OriginConfig,
  workingOrderId: string, personId: string | null): Promise<boolean>`: `owesOriginal`, `readSettledTicket`,
  `enqueueOriginalReceipt` with `printerLookup(tx, cfg.origin, { whileSwitchedOff: true })`; true when it
  queued a job. `printSaleReceipt`'s `"owed"` mode calls it; its behaviour is unchanged.
- Produces in `ticket-owed-job.ts`: `OWED_TICKET_AFTER_MS = 10 * 60_000`;
  `printOwedTickets(deps: { db: Database; backend: FiscalBackend; cfg: TradingContext; log: Logger }, now: Date,
  signal?: AbortSignal): Promise<{ queued: string[]; nextDueAt: Date | null }>`; and
  `ticketOwedJob(deps & { isPrimary: () => boolean }): JobDefinition`, name `"receipt.ticket_owed"`,
  `wakeOn: ["owed_tickets", "print_jobs", "invoice_deliveries", "printers", "devices", "device_profiles"]`,
  sleeps and backoff as `owedReceiptJob` (`owed-receipts.ts:176-190`). Catalogue `"receipt.ticket_owed": stop`;
  boot passes `backend: nodeBackend, cfg: tradingContext` (both in `bootServer`).
- Each pass: `clearOwedTickets`; then candidates = marks at least 10 minutes old with no original
  print job for their sale. Each candidate gets its own `withTransaction` that re-reads it (still
  marked, still no original job, `owesOriginal`, the device's profile allows `print-receipt` via
  `profileAllows` as `receipt-print.ts:175-180`) and calls `queueOwedOriginal` with
  `{ ...cfg, origin: deviceOrigin(deviceId) }`, the sale's `working_order_id`, person `null`. No printer
  → left for the next wake. A throw → `log("warn", "receipt.owed_ticket_failed", { saleId, errorCode })`,
  then on to the next. `nextDueAt` = the earliest not-yet-due `owedSince + 10 min`.

- [ ] **Step 1: Failing tests** in `ticket-owed-job.test.ts` (sale built through a real till cash sale,
  as `till-api.receipt.test.ts` does, so the bytes are the close path's):
  `"prints the original 10 minutes after a sale whose close request never came"` (one job, `receiptCopy`
  false, on the device's receipt printer; at 9 minutes none);
  `"prints the original after an email sent before Done failed"` (email `failed`, no job → one job);
  `"prints nothing while an original email is queued, sending, sent or unknown"`;
  `"prints once the device is given a receipt printer, and nothing after 24 hours"`;
  `"queues on a switched-off printer, which prints when switched on"`;
  `"leaves a sale whose original was ended by a deleted printer"` (Review Focus 3);
  `"leaves a device whose profile may not print receipts"` (Review Focus 4);
  `"Done and the job together leave one original"` (both in `Promise.all`; one `receipt_copy = false` job; Review Focus 1);
  `"a full invoice whose A4 page failed prints on the receipt printer, enrolled with no person"`;
  `"prints the same bytes as the close request for the same sale"` (payload equal to a `printSaleReceipt(…, "owed")` run on a twin sale);
  `"says when the next mark falls due"`; `"logs a failure and carries on"`; `"runs on the primary only"`.
  Add the catalogue line's case to `job-catalogue.test.ts`.
- [ ] **Step 2:** run them; FAIL (module missing).
- [ ] **Step 3:** extract `queueOwedOriginal`, write the job, register it. Guide: EN `:83` loses "nothing
  prints:" ("If the device has no receipt printer, choose one or send the email before closing."); ES the
  same cut («Si el dispositivo no tiene impresora de tickets, elige una o envía el correo antes de cerrar.»).
- [ ] **Step 4:** run `ticket-owed-job.test.ts`, `till-api.receipt.test.ts`, `owed-receipts.test.ts`,
  `job-catalogue.test.ts`, `boot.restricted-quiet.test.ts`, `guide-content.test.ts`, and from the root
  `pnpm exec vitest run scripts/guide-links.test.ts`; PASS; read each `Tests` count.
- [ ] **Step 5:** `git commit -s` "Print a till sale's owed ticket when the till never asked, an email failed, or a printer arrived". Then `/finish-branch`.

## What changes for #3835's choices

- **D1** (no receipt printer: nothing later): replaced. It prints once a printer is set, within 24 hours.
- **D2** (sales with no till window unchanged): partly replaced. Till-recorded sales with no window
  (a split table's loose bills, a card payment the server finishes after the till lost touch,
  `bill-payments-loop.ts:130`) now print. The dashboard's retained refund, unpaid departures and #3847's
  close-of-day issue still print nothing. The plan's D6 ("only sales a till closed") becomes "sales a till recorded".
- **D3, D4:** unchanged. **D5:** rounds unchanged; the mark adds its own 10 minutes and 24 hours.
- **First start:** the table starts empty, so nothing old prints when this is deployed.

## Where rebases meet this plan

- **#3752** changes `readSettledTicket` (payments listed), `resendInvoicePrintJob` and `owedReceiptJob`'s
  deps; it does not touch `printSaleReceipt`'s body. A textual merge in `till-sale.ts`; the bytes test
  then pins #3752's layout. Its out-of-date waiting job is still an original job, so the mark leaves it.
- **#3847** rebuilds core's starting migration: take main's generated files, rerun `db:generate`. Its
  close-of-day issue sets no mark; a bill it issued and a till later settles is marked then.
- **feat/adviser-advances:** the advance ticket is a till sale, so `issueAdvance` must call
  `markTicketOwed`. Its sale has no working order, so `queueOwedOriginal` gains a branch that builds with
  `readTransactionReceipt`, as `issueAdvance` does. Covered by the advances branch, not this one.

## Decisions for the owner (recommended default first)

1. **When an unasked-for ticket prints:** 10 minutes after the sale (alternative: 2 minutes, which can
   print while the window is still open).
2. **How long a ticket stays owed:** 24 hours, matching #3835's rounds. After that staff print it from the sale.
3. **Till sales that never show a window** (split-table loose bills, a card payment finished by the
   server) print too (alternative: leave them as #3835 did).
4. **A full invoice whose A4 page or email failed** prints in receipt form on the till's receipt
   printer, as **Done** already does (alternative: print nothing).
5. **A restore within 24 hours of a sale** prints owed tickets in the backup on the restored box, as it
   already does with queued print jobs (alternative: clear the marks on restore).
