# A1403: Unpaid departure kitchen stop

**Goal:** Recording unpaid departure stops unserved kitchen work, prints the usual cancellation slips, removes every family bill from kitchen lists and the overdue report, and keeps the full amount unpaid. Paid siblings keep their charges; departure offers no refund or extra waiter questions.

**Approval receipt:** The watcher recorded “Walk-outs: option A.” in Lane C questions, 2026-11-06 ~13:40. Its ~12:02 detail says “Dishes the kitchen was never making (not sent, or held): unchanged” and that later payment restores nothing. The watcher moved A1403 to H on 2026-11-08 05:49: “Plan first; new printed or screen words come to me before landing.” These local campaign records are outside this checkout.

**Final decision / approval receipt:** Watcher answer in local `questions.md`, 2026-11-08 06:04: kitchen cancellation state only; no adjustment or void record and no venue reason. Bill stays full amount unpaid. Departure free-text reason stays on owing bill departure row. Held/requested dishes with printed HOLD tickets stay unchanged, no HOLD CANCELLED slip; still remove from kitchen lists and overdue report. Keep one real TCP printer-delivery control.

**Execution:** Inline, `superpowers:executing-plans`, one PR. Preserve the existing invoice/chain/series/payment/refund paths and protected tests. No migration is proposed; the A1308 hold was lifted. Reuse existing paper words. All behavior claims below remain source-derived until tested.

## 1. Pin the accepted behavior

- [ ] Add `apps/server/src/unpaid-departure-kitchen.test.ts` with real `useVenueDb`, `manifestSets()` and `testing/adjustment-venue.ts`. First observe a failure: actual departure of a fired unserved dish produces its kitchen cancellation and VOID slip while retaining its full debt, with no adjustment or void record or venue reason. Change the old kitchen assertions in `unpaid-departure.test.ts` and `finish-party-collect.test.ts`, keeping their money/status assertions.
- [ ] Cover every post-issuance placed/settled bill from `readBillsOfParties`, including joined families, paid siblings and zero-due bills just settled. Check station, pass/monitor and `computeOverdueOrders`; retain an unrelated visible party and earlier collection stamps. Pin extras, extra-only remote work, fractions, partial serving and prior cancellation. Preserve served quantities and bill amounts.
- [ ] Held/requested controls use already-invoiced or paid bills. Unissued held/requested bills retain their existing unfired refusal; unsent drafts retain `bill.unsent_dishes`. One guarded refusal proves no kitchen/print change; retain existing refusal suites. Check both serve/departure orders and a refused duplicate departure with no second slip.

## 2. Share the service cancellation core

- [ ] Extract the existing quantity, correction-paper and service-state writes from `line-cancel.ts` into `line-service-cancel.ts`, taking dish quantities to cancel, actor and existing preparation state. Both `cancelItem` and departure use the same core; keep normal `cancelItem` adjustments unchanged. Preserve its behavioral assertions.
- [ ] In `unpaid-departure.ts`, preserve `priceForIssuance` → `issueUnpaidInvoice` → `markOrderPlaced`. Within the same transaction, stop only remaining fired remote work across the complete family. Reuse `parties.ts`’s collection helper with placed/settled statuses; identify bills with tickets before cancellations delete them, retain non-null stamps, and avoid stamping bills that never had kitchen work.
- [ ] Decode an actual departure slip, then deliver its bytes through existing `runAgentOnce`/`NetworkTcpTransport` to a local TCP sink and check completion. Pay the departed bill through `/api/working-orders/:id/collect`; verify no restored kitchen work or second invoice. The departure reason stays on owing bills’ `unpaid_departures` rows, not on individual cancellation rows or paid siblings.

## 3. Verify and finish

- [ ] Run server Vitest for the new test, `unpaid-departure.test.ts`, `finish-party-collect.test.ts` and `line-cancel.test.ts`. Run unedited fiscal `src/write-path.e2e.test.ts`/`src/inmutabilidad.test.ts` and the existing Task 7 draft suites. Require test counts.
- [ ] Update English/Spanish table and kitchen guides; run `guide-content.test.ts` and root `guide-links.test.ts`. Audit changed-behavior claims wherever found; add dated pointers to historical claims. Delete A908/A1367 details, bundle and backlog index. Run authorised `finish-branch`, resolve findings, require current-head CI, then `land-branch` under H11.
