# A790: choose the recorded document, then its printer

**Proposed, 9 November 2026. No implementation approval.** Owner20:34: “Drop it, small slices”. Source: `/Users/clintongormley/waitron-campaign-f/questions.md`, heading “OWNER 2026-11-09 20:34 — lane F walk”. `RUNNER.md` §0 requires “Plan, then approval, then build”; `queue.md` says “Build on today’s print path”. Parent arranges the normal Claude read, then watcher approval before building.

**Finish:** on the till ticket view, for live sales and history with a working-order id, open one **Print/Reprint** entry, choose **Receipt** or **Invoice**, choose that role’s printer, then explicitly **Print on {printer}** / **Print a copy on {printer}**. F2 offers Receipt only. F1 Receipt retains the recorded full invoice, including its customer; Invoice uses the Invoice role, on receipt paper or A4. Choosing, saving, Refresh and Back print nothing.

**Estimate, added/removed separately:** production +260/−110, tests +320/−80, support +0/−0, docs +60/−15; total +640/−205, **845 changed lines**, no generated files. Budget **175 minutes**: source refresh 10, code 55, tests 45, docs/support 15, browser inspection 15, review/fixes/hook/PR 35; external approval waits excluded. Stop for watcher direction at three hours or 1.5× size.

## Current path and bounded work

**Source reading only, runtime-unverified**, at `1252e2b6b3`: `till-app.ts`’s `#showTicket` and historical opener keep the working-order id; `bill-payments.ts:754` records it. `till-api.ts:2545–2707` already serves invoice delivery, receipt original and reprint; `receipt-print.ts:313,350,515` owns paper jobs. Reuse these routes unchanged and their existing keys, original/copy, active-delivery, retry, handover, language and fixed-destination rules. No new server protocol. Current Receipt lists are thermal-only (`packages/layouts/src/device-printers.ts`); F1 Invoice lists mix both papers.

1. Extend the landed #2640 folded Invoice chooser, not rebuild it. After document selection, show that role’s device-profile list, **Use default** first, retaining list order and paper/name labels. Keep saved Equipment resolution; an unavailable explicit choice never silently falls back. Without a resolved destination, require a choice, even for one printer. Disabled/unavailable choices cannot enable Print; an empty list explains why and offers Refresh/Back.
2. Add the equivalent Receipt row through existing Equipment GET/PUT and the serialized save queue. Preserve Equipment’s list-takeover question and `takeOver` answer; Invoice acquires no holder. Wait for confirmed save before printing; reuse Invoice’s saved-but-refresh-failed behavior. Preserve session/person/profile/zone permission checks. Opening the chooser does not write Equipment.
3. Final confirmation calls existing original/reprint handlers for Receipt, existing delivery handler for Invoice. Historical copies retain the transaction-reprint route and audit. Fold paper retry/replacement controls into the selected document’s section without rerouting pending work; email and handover remain separate. Keep existing behavioral assertions when entry-point expectations change.

## Exact next-slice file map and proof

Modify under `apps/till/src/`: `till-app.ts`, `screens/till-ticket-view.ts`, `i18n/strings.ts`; tests `till-app.test.ts`, `till-app.invoice-printer-choice.test.ts`, `screens/till-ticket-view.test.ts`, `screens/till-ticket-view.a11y.test.ts`, `screens/till-ticket-view.look.test.ts`. Add `till-app.document-printer-choice.test.ts`. Reuse `apps/till/test/{bill-pay-app,pay-equipment-fixtures}.ts` unchanged.

View tests own document/role/default order, named confirmation and empty/read-error states; app tests own saved-choice sequencing, Receipt takeover confirmation and correct live/history API dispatch. Existing Equipment tests own holder/refusal permutations; existing server delivery tests own original/copy, admission and drawer separation. Do not duplicate them at callers. TDD each changed behavior.

Run `pnpm --filter @waitron/till exec vitest run src/till-app.test.ts src/till-app.invoice-printer-choice.test.ts src/till-app.document-printer-choice.test.ts src/screens/till-ticket-view.test.ts src/screens/till-ticket-view.a11y.test.ts src/screens/till-ticket-view.look.test.ts`; run `pnpm --filter @waitron/server exec vitest run src/till-api.deliveries.test.ts src/till-api.receipt.test.ts src/transaction-receipt-api.test.ts src/guide-content.test.ts`. Inspect EN/ES, light/dark, 390/1280 widths. Update `apps/server/src/guide/{en,es}/table-service.md`, preserving shared anchors, and only A790 in `docs/backlog{,/printers}.md`. Normal hook/current-head CI; no whole-package suites.

## Release and unfinished capability

This slice releases A739’s current order-linked till prerequisite; A739 owns payment/final-screen changes, including the separate handheld paid view. Next usable historical slice: orderless F1 Invoice delivery. `transaction-receipt-api.ts` currently provides only receipt-copy printing; extend its sale-id path with existing delivery actions and let `invoice-delivery-actions.ts`’s `requestPrintDelivery` use `readTransactionReceipt` without an order. Estimate another ≤3 hours, production +180/−25, tests +250/−20, docs/support +40/−5; approve separately. Existing orderless Receipt remains usable. F2 A4/email are absent; offer neither. Dashboard/payment-choice residuals remain open.

Drop G4, recovery-origin file, browser operation journal and prepare/accept entirely; no A947 wait, new table/ledger, all-writer revision or duplicate-print protection. Landed foundations grant no cleanup authority. Fiscal issuance, F2→F1 and payment changes are outside this slice.
