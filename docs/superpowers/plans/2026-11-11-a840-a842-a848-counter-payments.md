# Till payment cleanup and clear refusals (A840/A842/A848)

Written by Codex for the three entries in `docs/backlog.md`, with their till/payment
detail. The owner required one change after A739 (9 November 20:34); watcher
11 November 17:20 closed A739 software and released it. Claude's initial plan read
(482 seconds) identified the table surface and cut duplicate tests. Watcher
clearance of this revised plan is pending; no owner design approval is claimed.

**Finish line:** remove the obsolete counter cancellation entry, keep the pressed
payment action coloured and spinning during sending, and explain an empty-order
refusal in EN/ES. Reuse the existing widgets, refusal mappers, code table and test
fixtures. No table, migration, protected fiscal writer or hardware gate. The watcher added
R3 Important 2 on 11 November 17:55, quoting the owner’s 17:50 “yes” to one
Cancel item path for every sent dish, including whole-order cancellation.

1. **A840: prove the closed-party boundary, then delete the counter entry.**
   Production sale writers settle in the same transaction (`till-sale.ts:1064`,
   `bill-payments.ts:806`, `transfer-close.ts:181`); unpaid departure instead
   invoices table bills and closes their party (`unpaid-departure.ts:152,206`).
   Moving an unpaid bill first requires that party open (`bill-actions.ts:136`
   to `parties.ts:401`). Add one real-route case in `till-api.move-bill.test.ts`:
   depart unpaid, try moving that bill to Counter, assert `party.not_open` and
   no invoiced waiting row. The falsifier is an accepted move or that waiting row.
   Existing counter `issued` fixtures use `testing/issue-order.ts`, not a staff
   issuance journey. Remove the waiting button/event, app handler and counter
   success/refusal branches, `fromCounter`, counter network/refresh wording and
   their obsolete tests. Keep the shared table dialog, server cancel route and
   `CounterWaitingOrder.invoiceNumber`: old issued bench orders remain payable.
   Put one absence assertion in an existing waiting-widget case, not a new suite.
2. **A842: fix the live table Cash/Card controls first.** The table still uses
   `tender-pay` without a payment window (`till-table-order-screen.ts:5134`).
   Remember the pressed action inside that widget; while busy it is primary with
   `loading`, the alternative is secondary and unavailable. Cover Counter Pay
   while saving its order, plus the zero-total Counter Cash/Card fallback.
   Widget cases own those loading/variant transitions and reset after the answer;
   one table-app case holds the payment answer and verifies the sending action.
   Preserve confirmation/retry locks. Do not duplicate existing bill-payment or
   presented-payment loading tests, or test the shared button's paint again.
3. **A848: test the ordinary empty cases and word the reachable refusal.**
   Pay/Send on an already empty order stay unavailable. An empty whole bill can
   be refused if another device empties it after this screen's read: reproduce
   that Pay answer, then add `sale.empty_basket` to the existing code table and
   whole-payment mapper. Text: “This order has no items. Add an item before
   continuing.” / “Este pedido no tiene artículos. Añade uno antes de continuar.”
   Check Send's existing disabled state and distinguish Move this bill (empty
   bills may move) from Move dishes (an empty selection sends nothing).
   Exercise a server empty refusal through an applicable send/move mapper only
   if that real flow exposes one. Do not enable controls or add server checks
   just to manufacture a refusal; report any unworded ordinary flow to the watcher.

4. **R3 Important 2 joins A840's cancellation boundary.** A840 retires the
   unreachable invoiced-counter entry, not cancellation of an ordinary placed
   counter order. Reuse Cancel item's A758 §3.3 rules for each sent dish before
   whole-order cancellation; retain the order's own reason. A fired dish asks
   whether preparation started; a started/served one offers still charge / don't
   charge with the existing reason/permission rules. Reuse the current dialog,
   cancellation-context read and server operation, extending their party-only
   scope to an explicitly checked counter bill; keep the table wrapper.
   Whole cancellation must not abandon a bill with a retained charge. Keep it
   payable after a still-charge choice; only close once its remaining charge is
   removed or paid. Do not silently choose an outcome. Give a plain Cancel order
   entry for non-invoiced waiting orders, separate from retired Cancel and credit.
   Check `abandonHeldOrder` too: unsent-only discard stays simple; sent dishes
   must go through the same per-dish choices before a whole discard.
   Before implementation, reproduce lane M's `reports/r3/2.patch` failure;
   adapt its request to the explicit A758 choice without weakening notice/slip
   assertions. Server cases own fired/started/served decisions and kitchen
   notice/slip/report effects; one app journey owns the per-dish choices and
   retained-charge result. The subsequent R3-owner item reuses this counter
   Cancel item support for basket ✕; Recall removal remains in that item.

**Files/tests:** `apps/till/src/till-app.ts`, `i18n/{codes,strings}.ts`,
`widgets/{counter-waiting,tender-pay,cancel-credit-dialog}.ts` and their sibling
tests; `till-app-counter-cancel-credit.test.ts` retires; `till-app-parties.test.ts`
owns the table journey, `till-app-move-dishes.test.ts` the empty move observation.
Include `counter-waiting.a11y.test.ts`, `cancel-credit-dialog.test.ts`,
`test-durations.json` and the one server route test. R3 also touches server `working-order.ts`, `line-cancel{,-context,-api}.ts`,
their existing support and focused tests, the till client and cancellation
state/dialog wiring. Preserve protected fiscal writers and issued-invoice
behaviour; stop and ask the watcher if fulfilling this needs their alteration.

**Verification/documentation:** failing behavioural test before each fix; run every
changed test file and the one route case. Inspect changed surfaces in EN/ES,
light/dark and phone/desktop, using existing accessibility helpers. Delete the
completed backlog entries; add a dated retirement pointer to C126's historical
counter notes. Update staff guides only where staff instructions change. A739's
physical checks stay in the existing real-box session. Normal hook, required
Claude run-it review(s), one fix-read, current-head CI, then authorised landing.

**Forecast with R3:** production +350/-170; tests +550/-850; support +0/-1 (duration entry);
documentation about +40/-30. Count additions/removals separately; watcher review
before growth past 1.5 times this forecast or a new behaviour beyond these asks.

The R3 extension is a proposed implementation of the new ask, not clearance to
build. Its second Claude plan read must challenge the added route/UI scope and
the shared cancellation boundary before the watcher settles it.
