# A790: orderless historical F1 delivery

Lane F `queue.md` A790, watcher release 2026-11-11 20:15: “Remaining: orderless historical F1 Invoice delivery”. A separate Sol-high writer drafted this plan; the driver incorporated Claude’s 12-Nov read (445 seconds). The watcher cleared the revised plan and its bounded destination metadata on 12 November at 15:23, inside the queue's 17 October decisions. The queue authorises the outcome; no owner approval of this design is recorded. Build inline.

**Result:** From Transactions, open an orderless F1 and print its Invoice on the device’s Invoice printer, A4 or receipt paper, with status, recovery and handover. Receipt remains a copy after an original completes; no new Receipt-original command. Confirmations name destinations. Selection, saving, Refresh and Back print nothing. Preserve F2 history, basket and Transactions position.

**Boundary:** Three build hours; no dashboard/payment edits, issuance, F2 replacement, schema, record, ledger or protocol. G4/A947, recovery-origin file, browser journal, prepare/accept and duplicate-print protection stay dropped. `document-printer-offers.ts` is not used, extended or deleted. Dashboard routing/browser preference, payment-time mixed Invoice list and Devices-table A4 marker remain open. Keep the Printers tab’s A4-printers wording.

## Existing paths and responsibilities

Source inspection at `26e3ab2930`, runtime unverified: `transaction-receipt-api.ts` uses `resolveTransactionScope`/`checkZones`; `readTransactionReceipt` reconstructs recorded invoices. Print/fallback helpers’ callers are `till-api.ts` and `orders-api.ts`. Keep those callers and both ticket readers unchanged.

1. **Server.** In `apps/server/src/transaction-receipt-api.ts`, add `/api/transactions/:saleId/deliveries` GET/print POST and `/:deliveryId/to-receipt` POST; add `/api/transactions/:saleId/receipt-print` GET and `/retry`, `/handover` POST. Reuse status, reservation, enqueue, resend and handover functions. In each transaction, read the stored order ID, refuse non-null with `sale.not_found`, and check every source zone. Preserve session/person-header, matching device proof and profile capability. No orderless email action. Compose `resolveInvoicePrinter` and `readInvoiceDeliveryState` directly; resolve saved choice then default, without an Invoice holder. In `invoice-delivery-actions.ts`, allow nullable sale `workingOrderId`, selecting `readTransactionReceipt` only for null. Pass existing `onReceiptCopy`/`receiptReprints` only from the new print route. No order-linked audit change.

2. **Till.** Modify `apps/till/src/api/client.ts`, `till-app.ts`, `screens/till-ticket-view.ts`, `i18n/strings.ts`. Add sale-based wrappers and one local order/transaction delivery target across status, send, retry, fallback, handover, refresh, live updates and polling. Transaction targets are orderless F1 only; F2 keeps today’s path. Keep `ticketWorkingOrderId` an order ID. Guard/reset by target/session/visit. Enable `invoicePrintersEnabled` and `historicalDelivery` for orderless F1. Reuse Equipment saves/defaults/takeover and confirmed-save gating. Hide Receipt-original and guard its handler; allow copies only as duplicates through `#deliveryAction`, retaining auditing, language cancellation and both-status refresh.

**Watcher-cleared naming, 12 November 15:23:** retain job printer ID/name on the new sale-based status for EN/ES retry labels; fallback names the saved Receipt destination. Keep shared readers and order-linked answers unchanged. This follows the queue’s 17-Oct decision to “always name the destination for originals, copies and retries”; existing generic order-linked labels remain later A790 work.

## Proof and finish, 45 minutes

TDD each behaviour. Server `transaction-receipt-api.test.ts` owns orderless Invoice originals/copies on both papers, fallback/retry destinations, authority/source-zone/order-linked refusals, unchanged fiscal/money snapshots and no drawer jobs. Add profile-actions/zones inventory rows pointing there; session-person walks routes unchanged. Till `till-app.document-printer-choice.test.ts` owns saved-equipment sequencing, duplicate-only Receipt, named confirmations, both-status refresh and Back/stale responses; `api/find-bill-client.test.ts` owns paths/bodies. Preserve `till-app.test.ts`’s orderless basket/navigation and no-order-ID-read assertions; preserve settlement-document checks. No new dependency-failure matrices.

Run focused files, adding any changed inventory/view suites explicitly:

```sh
pnpm --filter @waitron/server exec vitest run src/transaction-receipt-api.test.ts src/till-api.deliveries.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.session-person.test.ts src/guide-content.test.ts
pnpm --filter @waitron/till exec vitest run src/till-app.document-printer-choice.test.ts src/till-app.test.ts src/till-app-settlement-documents.test.ts src/api/find-bill-client.test.ts
```

Require passing Tests counts; no full-package local suite. LOOK EN/ES, both themes, 390/1280 widths. Update `apps/server/src/guide/{en,es}/table-service.md`, `docs/backlog.md` and `docs/backlog/printers.md`, retaining remaining A790 work. Finish-branch owns two Claude run-it reviews after initial rebase for cross-package/by-ID risk, triage/fixes and a fresh Claude read, normal hook and current-head CI.

Expected lines added/removed: production +280/−70; tests +325/−45; support +0/−0; docs +80/−15: 815 changed lines, outside opinion above 1,222. No generated files.
