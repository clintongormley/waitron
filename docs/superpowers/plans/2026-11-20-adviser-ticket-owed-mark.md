# ADVISER-TICKET-OWED-MARK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: plan, revised after a fresh Claude read (no Critical, four Important, all taken; the read
is at `~/waitron-campaign-l/receipts/adviser-ticket-owed-mark/fresh-read-46bb7253ab.md`). FISCAL
item; the owner lands it. Against main `64ea6c0c39`. Survey with receipts:
`~/waitron-campaign-l/receipts/adviser-ticket-owed-mark/survey.md`.

**Goal:** Every sale a till starts prints its ticket unless it was emailed, even when the till's close
request never arrives, an email fails after **Done**, or the device only gets a receipt printer later.

**Architecture:** No new table. The "ticket owed" mark is the sale row itself. `sales` already says
who made it (`source = 'device'` with `device_id`, a check ties the two: `packages/db/src/schema/origin.ts:15-18`,
`sales.ts:73-75, 201`), when (`issued_at`, `sales.ts:87`, indexed `:133`), and under which node and series
(`node_id :82`, `series_id :77`). #3835's existing `receipt.owed` job (`apps/server/src/owed-receipts.ts`)
gains a second pass. It takes sales made by a device under this box's live installation, issued
between 10 minutes and 24 hours ago, still owed (`stillOwed`, unchanged) and with no original
print job. It queues their original on that device's receipt printer through the same function the
till's close request uses.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest with `useVenueDb`, the server job runner.

**Spec:** lane L queue item (watcher, 2026-11-19 12:32: "the existing retry job prints from it");
adviser sheet question 3 (`docs/compliance/2026-11-19-adviser-meeting.md`); owner 2026-11-19 20:57
(`~/waitron-campaign-l/questions.md:428`: receipts required, payment slips not); #3835's plan
`docs/superpowers/plans/2026-11-19-adviser-no-none.md`.

**What staff get:** if the till crashes or loses the network before the window closes, the receipt
prints by itself about 10 minutes later. If an emailed ticket fails for good, the receipt prints on the
till that made the sale. A till with no receipt printer prints the day's owed tickets once one is set
for it, and its window says so. A box restored under a fiscal regime, or switched over to a spare, never prints the old box's tickets.

**Size:** about +75 production lines (owed-receipts.ts +55, till-sale.ts +10/−8, boot +3, till strings and
guide 8 changed), about +330 test lines, no generated files, no migration, no venue reset.

## Global Constraints

- Nothing filed with AEAT changes: no edit to `computeHuella`, the chain, numbering, series,
  `registros_facturacion` or its triggers, or the alta builders. The job only reads the filed record
  (`readSettledTicket` → `backend.filedReceiptFor`, `till-sale.ts:1004`) and writes `print_jobs` and,
  for a full invoice, an `invoice_deliveries` row. If a task needs a fiscal file, STOP and ask.
- At most one original per sale: queue only through `enqueueOriginalReceipt`'s "exists" check
  (`receipt-print.ts:578-584`), inside a write transaction that re-reads the candidate and `owesOriginal`.
  Never while an original email is `queued`, `sending`, `sent` or `unknown` (`owed-receipts.ts:62-69`).
- What prints is what the close request prints: same builder and printer lookup (`whileSwitchedOff: true`).
- Only this installation's sales: `sales.node_id = cfg.nodeId` and the sale's `invoice_series.retired_at
  is null`. A restore under a fiscal regime retires every live series of the node (`apps/server/src/restore.ts:1022-1038`,
  `packages/db/src/reserved-identity.ts:118-129`; activation does the same, `packages/fiscal-verifactu/src/allocation.ts:454-458`),
  and a promoted spare sells under its own node id (`apps/server/src/promote.ts:240`).
- Run one file at a time: `pnpm --filter @waitron/server exec vitest run <file>`; read each `Tests`
  count; every task's check includes `pnpm exec prettier --check <changed files>`.

## Review Focus

1. **Done** and the job on the same sale at once: one original job.
2. An email whose outcome is `unknown` when 10 minutes pass: nothing prints, then or later.
3. A sale whose original was ended by a deleted, unpaired or moved printer: no reprint (#3835's D3).
4. A device whose profile may not print receipts: nothing prints (#3835's D4).
5. A handheld with no receipt printer making every sale of the day: a pass resolves each device's
   printer once, not once per sale, and takes the write lock only for sales it can print.

---

### Task 1: The owed pass in `receipt.owed`

**Files:**
- Modify: `apps/server/src/till-sale.ts:1034-1074` (extract the `"owed"` branch),
  `apps/server/src/owed-receipts.ts`, `apps/server/src/boot.ts:4500-4506`
- Test: `apps/server/src/owed-receipts.test.ts`, `apps/server/src/till-api.receipt.test.ts` (unchanged, guards the extraction)

**Interfaces:**
- `till-sale.ts`: `queueOwedOriginal(tx: Transaction, backend: FiscalBackend, cfg: OriginConfig, workingOrderId: string,
  personId: string | null): Promise<boolean>`: `owesOriginal`, `readSettledTicket`, `enqueueOriginalReceipt`
  with `printerLookup(tx, cfg.origin, { whileSwitchedOff: true })`; true when it queued. `printSaleReceipt`'s
  `"owed"` mode calls it with `session.personId`; its behaviour is unchanged.
- `owed-receipts.ts`: `thisInstallation(nodeId: string): SQL` (`sales.node_id = nodeId` and a live series),
  added to `givenUpOriginals` too, so fresh rounds also leave a restored or switched-over box's old jobs.
  `owedSales(q: Transaction, nodeId: string, now: Date)` selects `{ saleId, deviceId, workingOrderId, issuedAt }`
  `from sales indexed by sales_issued_idx` joining `invoice_series`: `source = 'device'`, `working_order_id is not null`,
  `issued_at` within `[now − 24 h, now]`, `stillOwed`, no `print_jobs` row with this `sale_id` and `receipt_copy = false`.
  (Changed in review, 2026-11-20: no upper bound `issued_at <= now`; a sale stamped after the pass's time, after a clock step back, is reported as due 10 minutes after its stamp rather than skipped.)
  `printOwedTickets(deps: { db: Database; backend: FiscalBackend; cfg: TradingContext; log: Logger }, now: Date,
  signal?: AbortSignal): Promise<{ queued: string[]; nextDueAt: Date | null }>`. `owedReceiptJob`'s deps gain
  `backend` and `cfg`; `pass` runs `startFreshRounds` then `printOwedTickets` and returns the earlier `nextDueAt`;
  `wakeOn` gains `"sales"`, `"devices"`, `"device_profiles"`. Boot passes `backend: nodeBackend, cfg: tradingContext`.
- A pass: read `owedSales`; those issued under 10 minutes ago only set `nextDueAt` (`issuedAt + 10 min`).
  For the rest, one read transaction resolves each distinct device once: its profile allows `print-receipt`
  (`profileAllows`, as `receipt-print.ts:175-180`) and `printerLookup(..., { whileSwitchedOff: true })("receipt")`
  finds a printer. Sales of other devices wait for a `devices`/`device_profiles`/`printers` wake. Each
  remaining sale gets its own `withTransaction` that checks again that there is no original job, then
  calls `queueOwedOriginal(tx, backend, { ...cfg, origin: deviceOrigin(deviceId) }, workingOrderId, null)`.
  A throw → `log("warn", "receipt.owed_ticket_failed", { saleId, errorCode })`, then the next sale.
  (Changed in review, 2026-11-20: no separate re-check; each sale's transaction relies on `queueOwedOriginal`'s `owesOriginal` and `enqueueOriginalReceipt`'s exists check.)
- `working_order_id is not null`: on main every device sale has one (the four `recordSale` calls,
  `till-sale.ts:1151, 1891, 2039`, `bill-payments.ts:898`, and `working-order.ts:7709`). Correctives,
  which may have none, are already excluded by `stillOwed`. The advance ticket (advances branch) has none; see below.

- [ ] **Step 1: Failing tests** in `owed-receipts.test.ts`, `describe("printOwedTickets")`, each sale made by a
  real till cash sale as `till-api.receipt.test.ts` does:
  `"prints the original 10 minutes after a sale whose close request never came"` (one job, `receiptCopy` false,
  on the device's receipt printer; none at 9 minutes);
  `"prints the original after an email sent before Done failed"`;
  `"prints nothing while an original email is queued, sending, sent or unknown"`;
  `"prints once the device is given a receipt printer, and nothing for a sale over 24 hours old"`;
  `"queues on a switched-off printer, which prints when switched on"`;
  `"leaves a sale whose original was ended by a deleted printer"`;
  `"leaves a device whose profile may not print receipts"`;
  `"Done and the pass together leave one original"` (`Promise.all`; one `receipt_copy = false` job);
  `"a full invoice whose A4 page failed prints on the receipt printer, enrolled with no person"`;
  `"prints the same bytes as the close request"` (payload equal to `printSaleReceipt(…, "owed")` on a twin sale);
  `"leaves a sale under a series a restore retired"` and `"leaves a sale another node recorded"`, each also
  for `startFreshRounds` (a given-up original under a retired series or another node is not resent);
  `"leaves a sale with no working order"`; `"leaves a business-day-close or demo-seed sale"` (`source` not `device`);
  `"resolves a printerless device once for many owed sales"` (spy on the lookup: one call for 20 sales);
  `"says when the next sale falls due"`; `"logs a failure and carries on"`.
  Update the existing `"runs on the primary only, …, woken by …"` case for the three new `wakeOn` entries.
- [ ] **Step 2:** run `owed-receipts.test.ts`; the new cases FAIL.
- [ ] **Step 3:** implement as Interfaces says.
- [ ] **Step 4:** run `owed-receipts.test.ts`, `till-api.receipt.test.ts`, `job-catalogue.test.ts`,
  `boot.restricted-quiet.test.ts`; PASS. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/inmutabilidad.test.ts src/write-path.e2e.test.ts` (inmutabilidad and the golden huella); unedited, PASS.
- [ ] **Step 5:** `git commit -s` "Print a till sale's owed ticket when the till never asked, an email failed, or a printer arrived".

### Task 2: Tell staff, in the window and the guide

**Files:** `apps/till/src/i18n/strings.ts:429-432` and the Spanish twins (`:2622-2625`),
`apps/till/src/widgets/settlement-document-dialog.test.ts`, `apps/till/src/i18n/strings.test.ts`,
`apps/server/src/guide/en/table-service.md:83`, `apps/server/src/guide/es/table-service.md:89-90`

- [ ] **Step 1: Failing test** in `settlement-document-dialog.test.ts`: with no receipt printer, the window
  reads exactly the new EN and ES lines (with and without email).
- [ ] **Step 2:** run it; FAIL.
- [ ] **Step 3:** strings. EN `closing_no_printer`: "This device has no receipt printer. Choose one above or
  email the receipt, or it prints once this device has one."; `_no_email`: "This device has no receipt printer.
  Choose one above, or the receipt prints once this device has one." ES: «Este dispositivo no tiene impresora de
  tickets. Elige una arriba o envía el recibo por correo; si no, se imprimirá cuando este dispositivo tenga una.»;
  «Este dispositivo no tiene impresora de tickets. Elige una arriba; si no, el recibo se imprimirá cuando este
  dispositivo tenga una.» Guide EN `:83`: "If the device has no receipt printer, choose one or send the email
  before closing; otherwise it prints once the device has one." ES likewise («…; si no, se imprime cuando el
  dispositivo tenga una.»).
- [ ] **Step 4:** run the two till files, `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`,
  root `pnpm exec vitest run scripts/guide-links.test.ts`; PASS. Then `/finish-branch`.
- [ ] **Step 5:** `git commit -s` "Say in the till and the guide that a ticket prints once the device has a printer".

## What changes for #3835's choices

- **D1** (no receipt printer: nothing later): replaced; it prints once a printer is set, within 24 hours.
- **D2** (sales with no till window unchanged): replaced for till-started sales (split-table loose bills,
  `till-api.ts:3388`; card payments the work loop finishes, `bill-payments-loop.ts:130`) and, by decision 3,
  the dashboard paths below. Unpaid departures (`stillOwed`) and #3847's close-of-day sales (`source`
  `business_day_close`) still print nothing.
- **D3, D4:** unchanged. **D5:** rounds unchanged, and now limited to this installation's sales.
- **First start:** sales from the last day that never printed and were never emailed print once, at
  most 10 minutes after the start. Harmless before go-live (CLAUDE.md §3); the PR's first lines say so.

## Where rebases meet this plan

- **#3752** (cfa87e8273): changes `owed-receipts.ts` (`owedReceiptJob` deps gain `layOutSaleReceipt`,
  `startFreshRounds` takes it), `owed-receipts.test.ts`, `boot.ts` at the same `owedReceiptJob({...})` call,
  `readSettledTicket` (payments listed; the bytes test then pins its layout), and adds three guide lines
  right after `table-service.md:83` (EN and ES). Its strings hunks start at `strings.ts:448`, after ours.
  It does not touch `printSaleReceipt`'s body. All textual merges.
- **#3847** (15758d2388): adds `"bills.close_of_day": stop` after `receipt.owed` in `job-catalogue.ts`, a job
  in `boot.ts` near `:4504`, and a `before_restore` step in `restore.ts`. This plan touches neither the
  catalogue nor `restore.ts`; its `boot.ts` edit is a textual merge.
- **feat/adviser-advances:** its plan does not mention a mark. The advance ticket is a device sale with
  no working order, printed at once by `issueAdvance` (`bill-advances.ts:179-184` on that branch), not on
  a switched-off printer. Under this design it needs no write at all: whichever lands second drops the
  `working_order_id is not null` condition and, for such a sale, builds with `readTransactionReceipt`
  (as `issueAdvance` does) instead of `readSettledTicket`, with one test.

## Decisions for the owner (recommended default first)

1. **When an unasked-for ticket prints:** 10 minutes after the sale. A window left open longer gets the
   paper original then; if the guest asks for email after that, the email goes as a «DUPLICADO» copy and
   the paper sits on the printer (the read's probe). Alternative: 2 minutes, which hits that more often.
2. **How long a ticket stays owed:** 24 hours from issue, matching #3835's rounds; then staff print it from the sale.
3. **Sales issued from the dashboard for a till's payment** print at that till too: Retain
   (`payments-api.ts:1562` bill, `:1601` whole order), Attest (`:2025`), resolving a bill payment
   (`:1925` → `bill-payments-loop.ts:130`) and resolving a stuck payment (`:1817-1829` → `till-sale.ts:2109`).
   Each began at a till, and the rule is "every sale prints its ticket or emails it". Against: each is
   issued when a manager resolves it, often after the guest left, so its paper may print to nobody.
   Leaving them out needs the alternative below, or a join on the attestation those paths store (not checked).
4. **A full invoice whose A4 page or email failed** prints in receipt form on the receipt printer, as **Done**
   already does. Alternative: print nothing.
5. **A box with no fiscal regime** (`fiscal-none`) keeps its series on restore (`restore.ts:1036` runs only
   when a module returns series), so its restore within a day could print an old owed ticket. Default: accept
   it (whether any venue runs `fiscal-none` was not checked); alternative: skip sales issued before the restore
   in `runRestoreHooks`'s transaction, which needs a stored restore time.
6. **A planned handover** leaves the old box's sales from its last 10 minutes to that box's own close
   request; the new box prints only its own. Alternative: also accept the previous primary's node id (not built).
- **Alternative design (not recommended):** a stored `owed_tickets` row written on each till path,
  which can tell dashboard paths apart. Cost: a new table in core's rebuilt starting migration (and
  `scripts/migration-baseline-epoch.json`) with a venue reset, a classification and write-path entry, six call
  sites, a restore and promotion rule, and conflicts with #3752, #3847 and the advances branch.
