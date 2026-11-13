# A790: dashboard document and printer routing

**Authority:** Lane F `queue.md` A790, quoted verbatim in the 13 November plan-writer request. Proposed slice: Claude review, then watcher clearance are required before building. No owner design approval is claimed; older plans are historical input only.

**Finish line:** In dashboard Orders, one **Print/Reprint** entry opens the recorded document choice, then its eligible printers. F1 offers **Receipt / Invoice**; F2 goes directly to Receipt. Every original, copy and retry action names its destination in EN/ES. The browser remembers its own printer per document, independently of till Equipment. Include the Devices Invoice-printer A4 marker using the existing page-printer list.

**Boundary:** At most 1,000 changed lines and three build hours, including checks. No migration, fiscal issuance, F2-to-F1, new record/ledger/journal/protocol or duplicate-print protection. Payment-time mixed Invoice-list choice stays explicitly deferred within A790. G4/A947, recovery-origin files and prepare/accept stay dropped. No cleanup of landed foundations. Keep the Printers tab's A4-printers wording. Invoice-list belt printers require no holder.

## Existing code to reuse

Source read at `c5182b8027`, runtime unverified: `apps/dashboard/src/widgets/order-reprint-dialog.ts:96` watches receipt printers or invoice offers; `apps/server/src/orders-list.ts:732` offers both papers. `orders-api.ts:283` copies receipts; `:299` calls `requestPrintDelivery` for recorded F1 originals/copies on either paper (`invoice-delivery-actions.ts:52`). Preserve direct routes, request keys, permissions, visibility and device-capability checks.

`apps/dashboard/src/screens/devices-screen.ts:289` formats resolved equipment names; its existing `pagePrinters` list identifies A4 IDs. Reuse `i18n/domain.ts`'s `a4PrinterName`, `DashboardQueries`, `wt-combobox`, `wt-form-actions` and the existing draft/close helpers. Leave `document-printer-offers.ts`, `DocumentPrinterForm` and recovery storage untouched.

## Build inline, failing test first for each step

1. **Entry and document choice (45 min).** Modify `apps/dashboard/src/screens/orders-screen.ts`, `widgets/order-detail-dialog.ts` and `widgets/order-reprint-dialog.ts`: one row/detail Print/Reprint entry, Email/PDF separate. F1 chooses Receipt/Invoice; F2 skips ahead. Receipt offers active receipt printers; Invoice uses the server's mixed offer, marking A4. Changing document drops the other list before loading.
   Red then green: `screens/orders-screen.test.ts`, `widgets/order-detail-dialog.delivery.test.ts`, `widgets/order-reprint-dialog.test.ts` own entry, document-first ordering and eligible lists. Run below, inspect expected failures, implement minimally, rerun; preserve behavioral assertions when selectors change.

2. **Routing and browser memory (55 min).** F2 uses `reprintOrder`; F1 original uses `requestOrderPrintDelivery`, restricted to receipt printers for Receipt. After an original completes, Receipt uses `reprintOrder` for a compact copy; Invoice retains `requestOrderPrintDelivery`. Keep the recorded customer and server designation/busy/retry decisions. Change no reservation, retry or audit writer.
   Create `apps/dashboard/src/document-printer-preference.ts`: guarded localStorage printer ID at `waitron-dashboard-document-printer:<receipt|invoice>`, scoped by browser origin. On opening choose eligible browser memory, then eligible original printer for Invoice, then first eligible offer. Explain unavailable memory. Refresh preserves valid selection; visibly clear withdrawn selection without substitution. Remember submitted document/printer after successful request only. Selection, Back, Cancel and reads print/save nothing. Storage denial keeps session-only memory with an EN/ES notice. No till Equipment/storage access.
   Red then green in `widgets/order-reprint-dialog.test.ts`: separate memories, reopening, fallback, withdrawal, denied storage, both-paper original/copy dispatch, captured destination and stale replies changing neither dialog nor preference. Add `widgets/order-reprint-dialog.unsaved.test.ts`; wire `draftScopeFor` for staged selection, commit accepted selection, discard on Cancel and use coordinated navigation close.

3. **Named actions (35 min).** Modify `apps/dashboard/src/i18n/strings.ts` and the dialogs: **Print on {printer} / Print a copy on {printer} / Retry on {printer}**; **Imprimir en {printer} / Imprimir una copia en {printer} / Reintentar en {printer}**. Confirmations retain submitted names. `widgets/invoice-email-dialog.ts` names the typed address for originals/copies; detail names the fixed retry address and retains its delivery ID.
   Add optional `retryEmailRecipient` to `OrderDetailDto` in `api/client.ts`. In `apps/server/src/orders-api.ts` detail GET, expose it only to `report.export` holders with an offered email retry, reading the current delivery by its ID AND visible bill's sale ID. Otherwise omit it. Shared history/status and write replies stay address-free; no endpoint or retry-semantics change.
   Red then green: server `orders-invoice-deliveries.test.ts` owns permission, wrong-bill exclusion and destination; retain no-recipient assertions. Dashboard `widgets/{order-detail-dialog.delivery,invoice-email-dialog,order-reprint-dialog}.test.ts` own EN/ES labels and existing API calls. Extend local fixtures only.

4. **Marker and guides (15 min).** In `apps/dashboard/src/screens/devices-screen.ts`, match resolved Invoice ID against `pagePrinters`; apply `a4PrinterName` before the default suffix. Red then green in `screens/devices-screen.test.ts`: explicit/default A4, receipt-paper/None and late page-list arrival. No DTO/server change. Defer the marker within A790 if it exceeds this formatter and focused cases.
   Update `apps/server/src/guide/en/table-service.md` and `es/table-service.md` with matching `{#dashboard-documents}` headings: choose document, choose printer, check named action; browser memory is separate from Equipment. Add the marker explanation to `guide/en/printers.md` and `es/printers.md` if included. Update both A790 backlog entries, retaining payment-time mixed-list work and any deferred marker. No historical-plan rewriting.

## Focused verification and finish (30 min)

Require passing Tests counts. This documentation-only task runs no tests or implementation.

```sh
pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-screen.test.ts src/widgets/order-reprint-dialog.test.ts src/widgets/order-reprint-dialog.unsaved.test.ts src/widgets/order-detail-dialog.delivery.test.ts src/widgets/invoice-email-dialog.test.ts src/screens/devices-screen.test.ts
pnpm --filter @waitron/server exec vitest run src/orders-invoice-deliveries.test.ts src/orders-reprint.test.ts src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

Add new `src/widgets/order-reprint-dialog.a11y.test.ts` to the dashboard command: keyboard and axe in both themes. LOOK EN/ES, light/dark, 390/1280, long names and empty/read-failed/ready states; screenshots stay ignored. Retain passive reads, action-error precedence, stale-opening guards, Orders position, copy-audit/no-fiscal/no-drawer assertions. No duplicated failure matrices or whole-workspace local run.

Expected added/removed lines: production **+270/−90**, tests **+330/−100**, support **+15/−5**, guides/backlog **+65/−10** = **885 changed**, no generated files. The marker is included in this estimate. If scope or time grows materially, return to the watcher before building the departure. After build and focused proof, run `finish-branch`: its Claude branch reviews/fixes read, normal hook and current-head CI remain required; watcher plan clearance is not branch-review completion.
