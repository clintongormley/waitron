# Receipts, payment slips and duplicates implementation

Implement the approved [design](../specs/2026-09-12-receipts-payment-slips-and-duplicates-design.md).

1. Trace receipt DTO consumers and replace card identity with order number and grouping label. Keep amounts and manual references. Test the paper and screen together.
2. Add a separate payment slip renderer and endpoint, reading integrated capture facts directly. Test missing facts, manual/cash no-op, tenant isolation, and absence of fiscal identifiers and QR commands.
3. Separate original and duplicate actions; add the print-receipt profile capability to all three document routes. Test route permissions, byte differences, and unchanged fiscal rows on real PostgreSQL.
4. Preserve a split check’s origin label and connect the till’s item selection to the existing split endpoint. Offer receipt and payment-slip actions at completion.
5. Add print.resend authorization and a dashboard job action that creates a new queue entry with the existing bytes. Refuse jobs still eligible for delivery.
6. Run affected package coverage and the full workspace gate, audit current documentation claims and update the backlog. Report branch readiness for finish-branch.

Each behavior starts with a failing regression test. To verify a forbidden-output assertion, introduce forbidden output and observe failure; deleting an assertion cannot demonstrate that protection. No fiscal schema, hash input, series allocation or filing changes are intended.

Independent ownership: server receipt/slip integration (driver), till UI, dashboard/queue resend, and split grouping helper.

## Approved implementation clarifications

Persist `cash_tendered` on the existing core tender row. This is a core-set column because settlement facts already belong to that row; `amount` keeps its meaning and the existing append-only protection remains. Read issuer identity through the filed fiscal receipt interface, freeze grouping when the sale first files, and leave optional header/footer trim current. Do not store receipt snapshots.

Invoice-first placement always prints an unpaid original, including `never` and `on_request` settings. Collection offers duplicates and preserves cash-drawer behavior. The till’s print controls follow its device profile.

During branch review, the owner clarified that printing never opens the drawer. Cash settlement at a till enqueues a separate audited drawer job in every receipt-print mode. Handheld cash settlement remains available, with no drawer effect; manual drawer opening is refused for handhelds regardless of profile capability. `print_jobs.kind` keeps drawer jobs out of manual resends while preserving document bytes exactly.

## Contract test inventory at implementation

Searched the server and till tests with `rg` for `TillSaleResult`, `TenderBlock`, `receiptPrintMode` and tender property assertions. The resulting suites, including unchanged consumers covered by the final gate:

- `apps/server/src/configuration-import.test.ts`
- `apps/server/src/configuration-transfer.test.ts`
- `apps/server/src/receipt-print.test.ts`
- `apps/server/src/receipt-ticket.test.ts`
- `apps/server/src/split-bill.fiscal.test.ts`
- `apps/server/src/till-api.pg.test.ts`
- `apps/server/src/till-api.receipt.test.ts`
- `apps/server/src/till-api.test.ts`
- `apps/server/src/till-sale-integrated.pg.test.ts`
- `apps/server/src/till-sale-integrated.test.ts`
- `apps/server/src/till-sale-tender-block.test.ts`
- `apps/server/src/till-sale.test.ts`
- `apps/server/src/working-order.pg.test.ts`
- `apps/till/src/api/client.test.ts`
- `apps/till/src/screens/till-ticket-view.a11y.test.ts`
- `apps/till/src/screens/till-ticket-view.test.ts`
- `apps/till/src/till-app.test.ts`

## Validation completed, 2026-09-12

The full workspace gate passed: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`. Formatting initially flagged the dashboard printer screen; formatting that file and rerunning the formatting and test steps passed.

Affected-package coverage passed, including server (241 files, 2,999 tests), database (63 files, 580 tests passed and two skipped), till (73 files, 1,351 tests), dashboard (1,581 tests), and the core, printing, identity, layouts, payments and fiscal packages. Real PostgreSQL tests exercised settlement persistence, duplicate printing, permissions and tenant isolation; browser tests exercised the till and dashboard actions.

Temporary negative controls failed as expected when cash validation, tenant scoping, printing permissions or forbidden-output protections were broken. All controls were restored before the final gate. No physical printer smoke test was run. Branch review and CI remain for `finish-branch`.
