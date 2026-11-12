# A790: orderless historical F1 delivery

Lane F `queue.md` A790, watcher release 2026-11-11 20:15, as quoted in the driver request: “Remaining: orderless historical F1 Invoice delivery”. The owner queue authorises the outcome. The driver owns this plan; Claude reviews it next through `claude-seat.sh review-branch`, then the watcher clears build. No design is owner-approved and no further owner approval is required. The campaign driver builds inline.

**Result:** From Transactions, open an existing orderless F1, choose Receipt or Invoice, choose an eligible printer, then explicitly confirm the named destination and original/copy/retry. Selection, saving, Refresh and Back print nothing. Preserve F2 receipt history, the basket and Transactions position.

**Boundary:** Three build hours. No dashboard or payment edits, fiscal issuance, F2-to-F1 correction, schema, new record, ledger or protocol. G4/A947, recovery-origin file, browser journal, prepare/accept and duplicate-print protection remain dropped; landed foundations grant no cleanup authority. Dashboard routing/browser preference, payment-time mixed Invoice list and Devices-table A4 marker stay open. Keep the Printers tab’s A4-printers wording.

## Existing paths and responsibilities

Source inspection at current local main/origin/main `26e3ab2930`, runtime unverified: `apps/server/src/transaction-receipt-api.ts` already authorises sale-ID receipt access through `resolveTransactionScope` and every source order’s zones. `invoice-delivery-actions.ts` print/fallback use `readSettledTicket`; print callers are `till-api.ts` and `orders-api.ts`, fallback’s caller is `till-api.ts`. Preserve their order-linked behaviour. `readTransactionReceipt` already reconstructs recorded orderless invoices; do not change either reader’s contract.

1. **Server, 65 minutes.** In `transaction-receipt-api.ts`, add `/api/transactions/:saleId/deliveries` GET/print POST and `/:deliveryId/to-receipt`; add `/api/transactions/:saleId/receipt-print` GET/original POST and `/retry`, `/handover` POST. Reuse existing status, reservation, enqueue, resend and handover functions, transaction boundaries and request bodies. Preserve session/person-header, matching device proof, profile capability and all-source zone checks; extend `till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts` and session-person inventory as needed. Offer no new orderless email action. Resolve Invoice through saved device choice then profile default; Invoice-list belt printers require no holder. In `invoice-delivery-actions.ts`, allow nullable `workingOrderId` only on its sale argument and select `readTransactionReceipt` only when null. Audit duplicate receipt-paper Invoice jobs through existing `onReceiptCopy`/`receiptReprints`. Sale-based receipt status supplies retained job printer ID/name for truthful retry/fallback labels; keep existing readers unchanged.

2. **Till, 70 minutes.** Modify `apps/till/src/api/client.ts`, `till-app.ts`, `screens/till-ticket-view.ts`, `i18n/strings.ts`. Add sale-based client wrappers. Resolve one local delivery target, order or transaction, for the existing controller’s status, sends, retry, fallback, handover, refresh, live updates and polling. Keep `ticketWorkingOrderId` as an order ID; never substitute a sale ID. Reset and guard responses by target/session/visit so Back or another ticket rejects stale answers. Enable the existing F1 document chooser for orderless history. Reuse Equipment’s serialized save queue, default resolution, Receipt takeover and confirmed-save gating. Copies retain transaction reprint auditing and language cancellation. EN/ES confirmations name actual destinations, including retained retry destinations; unavailable choices never silently fall back.

## Proof and finish, 45 minutes

For each behaviour, write its first failing test, observe the expected failure, implement minimally, then rerun. Server `transaction-receipt-api.test.ts` owns “orderless F1 prints recorded originals and audited copies on A4 or receipt paper”, “orderless fallback/retry retain destinations” and “delivery routes refuse missing authority or any forbidden substitution source”, asserting unchanged fiscal/money snapshots and no drawer jobs. `till-api.deliveries.test.ts` retains order-linked regressions. Till `till-app.document-printer-choice.test.ts` owns “orderless choice waits for saved equipment, names print/copy/retry, and refreshes both statuses” and “Back ignores late delivery answers”; `api/find-bill-client.test.ts` pins sale-ID paths/bodies. Update the orderless case in `till-app.test.ts` without losing basket/navigation assertions; preserve `till-app-settlement-documents.test.ts` pay-path assertions.

Run focused files, adding any changed inventory/view suites explicitly:

```sh
pnpm --filter @waitron/server exec vitest run src/transaction-receipt-api.test.ts src/till-api.deliveries.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.session-person.test.ts src/guide-content.test.ts
pnpm --filter @waitron/till exec vitest run src/till-app.document-printer-choice.test.ts src/till-app.test.ts src/till-app-settlement-documents.test.ts src/api/find-bill-client.test.ts
```

Require passing Tests counts; no full-package local suite. LOOK EN/ES, both themes, 390/1280 widths. Update `apps/server/src/guide/{en,es}/table-service.md`, `docs/backlog.md` and `docs/backlog/printers.md`, retaining remaining A790 work. Finish-branch owns two Claude run-it reviews after initial rebase for cross-package/by-ID risk, triage/fixes and a fresh Claude read, normal hook and current-head CI.

Expected lines added/removed: production +300/−70; tests +350/−45; support +0/−0; docs +80/−15, including this plan. No generated files.
