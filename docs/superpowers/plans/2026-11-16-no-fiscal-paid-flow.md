# No fiscal venue paid flow — implementation plan

**Authority:** `NO-FISCAL-PAID-FLOW`, watcher queue 2026-11-16 00:09, in
`/Users/clintongormley/waitron-campaign-f/queue.md`. Separate Sol-high draft, driver checked;
Claude reviewed for 333 seconds. Corrections below await its sole reread and watcher clearance.
No owner design approval is claimed. Do not build before watcher clearance, including the explicit
stored-backend `none` check below; no new fiscal capability is proposed.

> bundle "No fiscal venue paid flow" (docs/backlog/payments.md:372): first run a settled-bill replay on a venue with no fiscal module to see whether the throw is reached; fix it if so; and make the handheld show the paid screen, not the ticket view, after a presented bill is paid on such a venue. Plan first; one PR; delete the entries it finishes.

**Finish line:** a fiscal-none venue can pay a presented bill and replay its original receipt;
a handheld shows the current payment-complete document choice, and None returns to current bills.
Reuse `readSettledTicket`, the stored receipt/VAT pattern in `transaction-receipt.ts`, and the existing
settlement dialog. No new screen, state, receipt fields, protocol, records or provider qualification.

## 1. Reproduce the presented payment and replay, then repair only the reached failure

- [ ] Add **“pays and replays a presented no-fiscal bill”** to `apps/server/src/fiscal-none.e2e.test.ts`.
  Reuse `setupGbVenue`, its real resolved fiscal-none backend, `steadyClock` and `useVenueDb`.
  Follow `bill-payments.issue-clock.test.ts`'s product/`offerProducts` tables-zone/table/session setup,
  `deviceRequestCfg` and `openTillSession`; use existing helpers rather than new shared support.
  Call `placeOrder`, then `issueUnpaidInvoice`; pay cash through the existing
  `collectOrderOrchestration` fixture export (`testing/whole-payment-fixture.ts`), then repeat it.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/fiscal-none.e2e.test.ts` before production.
  Expected failure, still unverified: the first payment throws “has no filed fiscal record”.
  Assert payment succeeds, replay equals its first result, expected stored VAT appears, `qr` is empty,
  and reuse the suite's empty-fiscal-table assertions. No five-table count snapshot or printer setup.
- [ ] If reached, change only `readSettledTicket` in `apps/server/src/till-sale.ts`: select
  `sales.fiscalBackend` and `sales.vatBreakdown`; use stored VAT/empty QR only when filed evidence is
  absent and the saved backend is `none`. Otherwise keep filed VAT/QR and the existing missing-record
  refusal, comment and ignore block. Retain the missing-sale refusal. No repricing or invoice typing.
  In `till-sale.test.ts`, use its existing settled-sale fixture and temporarily stub `filedReceiptFor`
  to return undefined to assert the non-none refusal survives; restore the stub. Rerun changed files.

## 2. Pin the handheld's existing completion and fresh bill list

- [ ] In `apps/till/src/till-app-handheld-pay.test.ts`, reuse `payPresented`, `saleOf`, `documentChoice`
  and `closeDocuments`. One cash case returns `saleOf("120.00")` with empty QR and no invoice type.
  Assert document choice/total/change, no ticket view, a fresh `getPartyBills` read, and None returns
  to the table without a second collection or print. Existing cases own reader/F1/F2 behaviour.
- [ ] Run that file before production. If red, change only the F2-only settlement-bills refresh
  condition in `apps/till/src/till-app.ts` to accept non-F1 results, retaining F1 checks. The dialog
  selection may already work: prove it rather than add another screen. Rerun the changed file.

## 3. Verify and close

- [ ] Run focused existing server receipt/replay files: `till-sale.test.ts`,
  `till-sale-integrated.db.test.ts`, `till-sale-tender-block.test.ts`; preserve behavioural assertions.
- [ ] Only if UI production changes, inspect the existing completion/None flow in EN/ES, both themes,
  phone/desktop. Audit the existing `{#settlement-document}` in both `guide/{en,es}/table-service.md`;
  edit both only if instructions change. Delete the two detail sections/bundle in
  `docs/backlog/payments.md` and its link in `docs/backlog.md` once proved complete.

**Size:** production +10–25/−2–8; tests +55–85/−0, local fixture/import support +80–100/−0.
No new shared helper. No fiscal record writer, hash, invoice-allocation or registration change.
If those boundaries or a new capability become necessary, stop that work and ask the watcher.
