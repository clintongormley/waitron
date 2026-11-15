# No fiscal venue paid flow — implementation plan

**Authority:** watcher queue task `NO-FISCAL-PAID-FLOW`, 2026-11-16 00:09, `/Users/clintongormley/waitron-campaign-f/queue.md`; not an owner-approved design.
Claude plan review and watcher clearance are pending; the root driver obtains both before building.

> bundle "No fiscal venue paid flow" (docs/backlog/payments.md:372): first run a settled-bill replay on a venue with no fiscal module to see whether the throw is reached; fix it if so; and make the handheld show the paid screen, not the ticket view, after a presented bill is paid on such a venue. Plan first; one PR; delete the entries it finishes.

**Usable finish:** a real fiscal-none venue replays its settled bill with original receipt/payment facts; paying a presented bill on a handheld opens the existing final-payment document choice and actions.
One PR finishes both entries, including proving a suspected defect absent where appropriate.

**Existing seams:** `apps/server/src/till-sale.ts:900` owns `readSettledTicket`; `apps/server/src/transaction-receipt.ts:120–166` separates persisted receipt data from optional fiscal evidence.
Reuse `readReceiptIssuer`, `receiptQr`, `receiptLines`, `readTenderBlock` and `readBillTenderLines`.
In `apps/till/src/till-app.ts`, presented-payment success already passes table settlement to `#showTicket`;
`settlementDocument` selects `till-settlement-document-dialog`. The F2 condition at 21577 controls a bills refresh, not screen selection. Inspection findings only; neither defect has been reproduced here.

## 1. Reproduce the server path, then fix only the reached failure

- [ ] In `apps/server/src/fiscal-none.e2e.test.ts`, add **“replays a settled no-fiscal bill without repeating payment effects”**.
  Reuse `setupGbVenue`, its resolved fiscal-none backend, `steadyClock` and `useVenueDb`; use existing
  `testing/zone-offers.ts` (`offerProducts`), `testing/whole-payment-fixture.ts` (`payWorkingOrder`)
  and `testing/trading-admission.ts`. Add one product locally, settle with cash, then repeat the same request through the orchestration.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/fiscal-none.e2e.test.ts`.
  Expected red: the replay throws **“has no filed fiscal record”**. Assert original/replay invoice number,
  issue time, total, VAT, lines and tender/change agree; QR is empty and fiscal evidence absent.
  Snapshot sale/tender/payment/drawer/print counts before replay and assert no additions; fiscal tables stay empty.
  If replay passes, retain the proof and make no speculative server fix.
- [ ] If reached, change only `readSettledTicket`: select the existing `sales.vatBreakdown`, keep
  filed VAT when supplied, otherwise use that stored breakdown; pass `filed?.verificationUrl` to `receiptQr`.
  Remove the unconditional missing-record throw and its stale corruption comment; retain the missing-sale refusal.
  Follow `transaction-receipt.ts`'s optional-evidence pattern without repricing or manufacturing invoice typing.
  Repeat the command for green.

## 2. Pin handheld completion using the current screen

- [ ] In `apps/till/src/till-app-handheld-pay.test.ts`, reuse `payPresented`, `saleOf`, `documentChoice`
  and `ticketView`. Add **“a presented no-fiscal bill opens the document choice”**, covering reader
  and cash entry with a result lacking `invoiceType`, `issuer` and fiscal evidence, with empty QR.
  Assert visible document choice, original total/change, no ticket view, and None returns to the table
  without another charge, print or table close. Server owns replay facts; UI owns completion and navigation.
- [ ] Run `pnpm --filter @waitron/till exec vitest run src/till-app-handheld-pay.test.ts` before editing production.
  If green, keep the regression only. If red, record the failed assertion, minimally repair the presented-success/`#showTicket` selection in `till-app.ts`, then rerun for green. Preserve F1/F2 assertions.

## 3. Verify and close the bundle

- [ ] Run existing server receipts/replay checks: `pnpm --filter @waitron/server exec vitest run src/till-sale.test.ts src/till-sale-integrated.db.test.ts src/till-sale-tender-block.test.ts`; retain their payment-side-effect assertions.
- [ ] Visually inspect this same document choice and None action in EN/ES, light/dark, phone/desktop using the existing browser fixture; restore locale/viewport and keep screenshots uncommitted.
- [ ] Audit `apps/server/src/guide/{en,es}/table-service.md` at `{#settlement-document}`; change both only if their current instructions need correction. Delete the two completed detail sections and bundle in `docs/backlog/payments.md`, and its bundle link in `docs/backlog.md`.

**Size/exclusions:** production +5–15/−10–20 lines in `till-sale.ts`, UI 0–10 only after red; tests +70–100 plus local fixture/import support +15–30, removals 0.
No new files/framework, protocol, state, receipt fields or records. No fiscal invariants, record writers, huella or invoice allocation changes; flag the boundary to the watcher if needed. No provider qualification or new visual design.
