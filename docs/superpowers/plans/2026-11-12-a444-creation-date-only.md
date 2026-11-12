# A444 — a full invoice carries one date: when it was created

Status: approved by the watcher's 2026-11-12 11:10 instruction (lane L questions.md, "A444: the owner
chose the creation date everywhere; replan as one small fix"); fresh Claude plan read 2026-11-12
(0 critical, 3 important, 2 minor; all taken below).

**Owner, 2026-11-12 (watcher window, 11:0x):** "I think we should use the creation date. That way our
invoices and AEAT and our reports will all use the same dates and times." Asked whether lane L should
switch to the creation date everywhere and park what it built until the adviser answers, the owner
answered **"yes"** (11:10). This replaces the owner's 27 October rule ("the meal ends when the bill
closes") until the adviser answers S4.

## Outcome

A full invoice (F1) shows one date, the moment it was created, on paper, on the till's ticket view,
in the A4/email document and in the accountant export. AEAT already receives only that date:
`toRegistroRow` refuses an alta carrying `FechaOperacion`
(`packages/fiscal-verifactu/src/registro-row.ts:117–121`), so nothing filed changes.

## What main does today (read on main d4520c53f2)

- `packages/core/src/record-sale.ts:276–293` reads the bill's `opened_at` for a full invoice and
  saves that venue day (or the issue day, with no bill) in `sales.operation_date`
  (`packages/db/src/schema/sales.ts:86`). A simplified invoice saves `null`.
- `apps/server/src/receipt-issuer.ts:55–57`, `transaction-receipt.ts:166–167` and
  `invoice-document.ts:174–175` hand it on when it differs from the issue day;
  `receipt-document.ts:238–256` prints «Fecha de operación»; `apps/till/src/screens/till-ticket-view.ts:1220–1227`
  shows it; `apps/server/src/accountant-export.ts:29, 97, 188` and its two header words
  (`apps/server/src/i18n/accountant-export.ts:23, 78`) export it as a column.
- The label lives in `packages/country-es/src/receipt-labels.ts` (five languages).

## The change — one PR, deletion only

1. **The column goes.** Remove `operationDate` from the `sales` schema and rebuild the core
   starting migration (`migration-baseline rebuild --set core`), recomputing the backup-schema pin.
   Why it goes rather than stays unused: after this change nothing writes or reads it, a kept
   column invites a future reader to trust a value nobody sets, and before go-live a column is
   deleted freely (CLAUDE.md §3, "No backwards-compatibility … until Waitron is in production").
   If the adviser later requires a separate date, the parked `feat/a444-fiscal-operation-day`
   branch re-adds a date with its own reading. The PR title starts "Reset test venues:".
2. **`recordSale` stops computing it**: delete the `bill` read and the `operationDate` block, and
   the field from `insertSale`'s input.
3. **Every reader drops it**: receipt-issuer, transaction-receipt, invoice-document,
   receipt-document (the simplified branch becomes `if (simplified)`; the full-invoice branch keeps
   the heading, number and `label.date` row), `TillSaleResult.operationDate`, the till client type
   and ticket view, the accountant-export column and both header words, and the label in all five
   languages with its type.
4. **Dead code the deletion exposes goes too.** A simplified receipt never carried an operation
   date (only a full invoice did), so `receipt-document.ts:246–249`'s simplified heading inside the
   `else` branch never runs; delete it, and the `simplifiedInvoice` / `simplifiedInvoiceShort`
   labels in `packages/country-es/src/receipt-labels.ts` and their type in
   `packages/country/src/country.ts:82–83`, after grepping that nothing else reads them.
   `receiptDay` stays (`box-alert-email.ts:97` uses it).
5. **Tests.** Red first, through the real path: `recordSale` with a working order opened before
   midnight and issued after it, then the transaction-receipt answer has no `operationDate`
   (`transaction-receipt-api.test.ts:256` pins it today), the receipt document built from
   `readReceiptIssuer`/`readTransactionReceipt` has no «Fecha de operación» row, and the accountant
   export's header has no operation column. The till ticket view is covered by the type removal
   (the field no longer exists on its result), not by a new case. Then update or delete the checks
   that pinned the second date, each in the PR's "Changed test checks" section:
   `zone-core-capabilities.test.ts:111, 144, 158–186`, `record-sale.test.ts:2041–2106`,
   `bill-payments.issue-clock.test.ts:352`, `receipt-issuer.test.ts:74`, `invoice-email.test.ts:409`,
   `invoice-pdf.test.ts:74`, `invoice-language.test.ts:16–119`, `receipt-language.test.ts:1144`,
   `receipt-ticket.test.ts:159–241, 2651, 3767`, `spain.test.ts:310`,
   `till-ticket-view.a11y.test.ts:302`, `till-ticket-view.test.ts`, the shared fixture
   `apps/server/src/testing/full-invoice-fixture.ts:14`, and `accountant-export.test.ts:200–201, 285`
   (columns after "Issue date" move left by one). Demo seed: drop `operation_date` from
   `seed-sales.golden.test.ts:47` and its select at :195, regenerate the golden with
   `WAITRON_WRITE_GOLDEN=1`, and add `sales: ["operation_date"]` to `DROPPED_COLUMNS` in
   `seed.madrid-baseline.test.ts:29` (precedent #2804's `receipt_print_mode`), revisiting its
   `REBUILT_COLUMN_ORDER` at :179; the frozen `madrid-before-move` fixtures stay unchanged.
6. **Docs, in this PR:** a dated line under S4 in `docs/compliance/asesor-questions.md`, English (:341) and
   Spanish (:452) copies (the owner chose the creation date pending the adviser's answer), and dated
   pointers under the A231 note (:85, :89) and the 2026-10-27 research update (:13–23); Status lines on `docs/superpowers/specs/2026-10-27-a444-meal-completion-date-design.md`
   and `docs/superpowers/plans/2026-10-27-a444-meal-completion-date.md` pointing to the decision
   (the 2026-11-12 revised plan exists only on the parked branches); delete A444's entry from
   `docs/backlog.md` and its detail in `docs/backlog/fiscal.md`, drop "A444" wherever the backlog still names it as open
   (`docs/backlog.md:281`; `docs/backlog/fiscal.md:122, 159, 270 ("the operation day is the owner's
   provisional service-start rule"), 287, 307, 1121, 1194`), and add the decision with the owner's words under fiscal's "Decisions and
   deliberate limits"; the open question "Can a simplified invoice carry an operation date different
   from its issue date?" is answered by the same decision (no invoice carries one) and moves there
   too; the receipt layout lines in `docs/backlog/printers.md` (~368, ~790–795) lose the
   operation-date and «Fra. simplificada» clauses; the till and dashboard guides, if any sentence names it.

## Gates

Golden huella (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass
unedited. Schema guards: `scripts/schema-constraints.test.ts`, `append-only-triggers`,
`behavioural-triggers`, `starting-migrations`, `classification-complete`, and the backup-schema pin.
`scripts/english-only.test.ts` for the till test. Full review wave, two Codex angles; the owner
lands it. Size: production about 60–90 lines removed, nothing added beyond the simplified branch's
condition.

## Out of scope

The parked branches `feat/a444-fiscal-operation-day` and `feat/a444-close-day-capture` stay as
they are. No change to the fiscal record, the hash, numbering or any AEAT field.
