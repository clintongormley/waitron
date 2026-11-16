# No fiscal venue paid flow — implementation plan

**Authority:** `NO-FISCAL-PAID-FLOW`, watcher queue 2026-11-16 00:09,
`/Users/clintongormley/waitron-campaign-f/queue.md`; no owner design approval is claimed.
Separate Sol-high draft, driver checked; Claude read 333s and sole correction reread 301s.
All findings incorporated below. The watcher cleared this plan at 00:50 on 16 November,
including the saved-`none` exception and the three corrections incorporated below.

> bundle "No fiscal venue paid flow" (docs/backlog/payments.md:372): first run a settled-bill replay on a venue with no fiscal module to see whether the throw is reached; fix it if so; and make the handheld show the paid screen, not the ticket view, after a presented bill is paid on such a venue. Plan first; one PR; delete the entries it finishes.

**Finish:** a fiscal-none sale's presented bill can be paid and replay its original receipt;
a handheld opens the existing payment-complete document choice, refreshes bills, and None returns
to the table. No new screen, state, receipt fields, records, protocol or provider qualification.

## 1. Prove first payment plus replay, then fix only the reached failure

- [ ] Add **“pays and replays a presented no-fiscal bill”** beside `zonePlaced` in
  `apps/server/src/till-sale-integrated.test.ts`. Reuse its menu/zone/order/clock fixture.
  Resolve the real fiscal-none backend with GB module configuration, following
  `receipt-print.test.ts:476-482`. This reuses the existing venue fixture, not new GB provisioning.
  Let `zonePlaced(req, clock, true)` accept this backend for its `priceForIssuance` and
  `issueUnpaidInvoice` calls; it already parks and marks placed. Pass the same backend to both
  collects through `collectOrderOrchestration`. One cash test owns first payment and replay.
- [ ] Run that file before production. Observed red on 16 November: first payment throws
  “has no filed fiscal record”. Assert payment succeeds, replay equals its first result, stored
  VAT appears and QR is empty. No five-table count snapshot, printer setup or second GB fixture.
- [ ] If reached, change only `readSettledTicket` in `apps/server/src/till-sale.ts`: read the saved
  `sales.fiscalBackend` and `sales.vatBreakdown`; reuse the stored VAT as is and
  `receiptQr(backend, undefined)` as `transaction-receipt.ts` does; allow stored VAT/empty QR only when filed evidence
  is absent and the saved backend is `none`. Keep filed VAT/QR and the missing-record refusal for
  every other saved backend. Keep its invariant comment; remove that refusal's now-testable V8
  ignore markers, leaving the missing-sale ignore alone. No repricing or invoice typing.
  This literal means another backend that files nothing needs a reader edit; no capability is added.
- [ ] In `till-sale.test.ts`, use `setupVenue`, settle on its fiscal backend, then pass the real
  GB-recipe no-fiscal backend to exported `readSettledTicket`. Assert “has no filed fiscal record”;
  a check of the current rather than saved backend must fail. Run both changed server files.
- [ ] Cut the now-false no-regime-branch claim in `packages/fiscal-none/src/backend.ts:22–26`.

## 2. Pin existing handheld completion and refresh

- [ ] Inside the `till-app-handheld-pay.test.ts` block defining `payPresented`, add one cash case
  using `{ ...saleOf("120.00"), qr: "" }` with no invoice type. Assert document choice/total/change,
  no ticket view, and an increase in `getPartyBills` calls after payment. Its helper keeps returning
  the same bill, so do not claim changed bill data. Press None with `closeDocuments`; assert return
  to the table without a second collection or print. Existing cases own reader/F1/F2 behaviour.
- [ ] Run the file before production. Observed red on 16 November: F2-only bills refresh. Change only that
  condition in `apps/till/src/till-app.ts` to accept non-F1 results; retain F1 checks and rerun.

## 3. Verify and close

- [ ] Run focused receipt/replay files `till-sale.test.ts`, `till-sale-integrated.test.ts`,
  `till-sale-integrated.db.test.ts`, `till-sale-tender-block.test.ts` and `bill-payments.test.ts`;
  preserve behavioural assertions. Existing settlement-dialog accessibility tests own the layout
  matrix; inspect EN/ES, both themes, phone/desktop manually only if layout changes become necessary.
- [ ] Audit `{#settlement-document}` in `guide/{en,es}/table-service.md`; edit both only if instructions
  change. Delete the two detail sections/bundle in `docs/backlog/payments.md` and its index link.

**Size:** nine files including this plan: production +10–25/−2–8, tests +55–85/−0,
local fixture/import support +5–15/−0, backlog docs +0/−25–30; guides conditional. No new shared helper.
No fiscal writer, hash, invoice allocation or registration change. A new capability or crossing one
of those boundaries goes back to the watcher before building.
