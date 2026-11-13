# A790: dashboard document and printer routing

**Authority:** Lane F `queue.md` A790, quoted in the 13 November Sol-high writer brief. Claude reviewed the draft in367s; this revision accepts its simplifications. Watcher clearance is required before building. No owner design approval is claimed; older plans are historical input.

**Finish line:** Dashboard Orders has one Print/Reprint entry: choose the recorded document, then its eligible printer. F1 offers Receipt/Invoice; F2 opens Receipt directly. Print actions name the printer in EN/ES. This browser remembers a printer per document separately from till Equipment. Devices marks an Invoice printer that uses A4.

**Left out:** Payment-time mixed Invoice-list choice and existing generic order-linked email-retry wording stay open in A790. No new email-address exposure, print-retry action, endpoint, fiscal issuance/F2 conversion, migration, record/ledger/journal/protocol, duplicate-print protection, or cleanup of landed foundations. Keep the Printers tab's A4 wording and Invoice-list belt-printer admission without a holder. No storage-denial notice or unsaved-choice prompt.

## Reuse and implement inline with TDD

Source read at `c5182b8027`; runtime unverified. Reuse `widgets/order-reprint-dialog.ts`, `DashboardQueries`, field/action primitives and existing close/stale-reply guards. `orders-list.ts` already offers receipt-paper/A4 printers; `orders-api.ts` already exposes receipt copies and recorded F1 delivery. No server write or status shape changes.

1. **One entry and document-first ordering.** Change `apps/dashboard/src/screens/orders-screen.ts`, `widgets/order-detail-dialog.ts`, `widgets/order-reprint-dialog.ts` and `i18n/strings.ts`. Keep Email/PDF separate. Receipt lists active receipt printers; Invoice uses the existing mixed offer and A4 labels. Switching document drops the previous list before loading the next. F2 uses `reprintOrder`; both F1 documents use `requestOrderPrintDelivery`, letting the server designate original/copy and enforce busy state. Receipt filters that offer to receipt printers and preserves recorded customer facts. No new route or client rule for deciding an original has completed.
   Write failing cases in `screens/orders-screen.test.ts`, `widgets/order-detail-dialog.delivery.test.ts` and `widgets/order-reprint-dialog.test.ts` for ordering, eligible lists, named EN/ES actions and exact existing route/payload for F2 and both F1 documents. Run them red, implement minimally, rerun green. Retain copy audit/no-fiscal/no-drawer assertions in the existing server suites.

2. **Small browser preference.** Add `apps/dashboard/src/document-printer-preference.ts` using the existing try/catch localStorage style; key `waitron-dashboard-document-printer:<receipt|invoice>`, per origin, shared across logins. Store only a printer ID per document, never a document choice or till Equipment. On a new opening: eligible remembered printer, else sole eligible printer, else require a choice with quiet disabled Print. This follows G/J in the historical spec's A–L table; do not default to the original or first listed printer. Explain unavailable memory; no first-use warning. A live refresh preserves a valid selection and clears a withdrawn one without replacement. Remember the submitted printer only after server acceptance. Cancel, selection, refresh and refusal save/print nothing. Storage denial silently falls back to session memory. Empty offers retain Refresh printers and Cancel.
   Red/green in `widgets/order-reprint-dialog.test.ts`: independent memories, sole/multiple fallback, rejected memory/withdrawal, refused storage, acceptance versus refusal/Cancel, and no print on selection/Refresh. Existing first-printer and refresh-substitution assertions change deliberately to G/J, with before/after and authority recorded in the PR. Keep existing stale-reply guards; add no unlikely-clash matrix or draft-scope machinery.

3. **A4 marker and staff instructions.** In `screens/devices-screen.ts`, match the resolved Invoice printer ID to existing `pagePrinters`, then use `a4PrinterName` before its default suffix. Test explicit/default A4, receipt-paper/None and the page list arriving after devices in `screens/devices-screen.test.ts`. No DTO/server change. Update paired `apps/server/src/guide/{en,es}/table-service.md` with shared `{#dashboard-documents}` and `guide/{en,es}/printers.md` for the marker. Update both A790 backlog entries, keeping payment-time work and generic email-retry naming open.

## Verification and bounds

For each step observe the relevant failing assertion before implementation, then its passing Tests count. Add `widgets/order-reprint-dialog.a11y.test.ts` for keyboard and axe in both themes. LOOK at dialog/marker in EN/ES, both themes, phone/desktop and long printer names; screenshots stay ignored.

```sh
pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-screen.test.ts src/widgets/order-detail-dialog.delivery.test.ts src/widgets/order-reprint-dialog.test.ts src/widgets/order-reprint-dialog.a11y.test.ts src/screens/devices-screen.test.ts
pnpm --filter @waitron/server exec vitest run src/orders-reprint.test.ts src/orders-invoice-deliveries.test.ts src/guide-content.test.ts
pnpm exec vitest run scripts/guide-links.test.ts
```

Estimate: production +220/−70, tests +260/−80, support +10/−5, guides/backlog +50/−10 =705 changed lines; three hours through PR, no generated files. A documentation-only plan runs no tests. Build only after watcher clearance; finish-branch supplies Claude branch reviews, normal hook and current-head CI without a whole-workspace local test run.
