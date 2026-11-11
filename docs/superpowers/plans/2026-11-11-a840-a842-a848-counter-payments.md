# Counter payment cleanup and clear refusals (A840/A842/A848)

Written by Codex. Request: the three entries in `docs/backlog.md`, with detail in
`docs/backlog/till.md` and `docs/backlog/payments.md`. The owner required one change
after A739 (9 November 20:34); watcher 11 November 17:20 closed A739's software
item and released this work. Claude reviews this plan; watcher clearance is still pending.

**Finish line:** Counter shows only cancellation actions reachable through today's
software, the payment action keeps its colour and spinner during sending, and an
empty-order refusal explains what staff should do in English and Spanish.

**Reuse:** existing `till-counter-waiting`, shared cancellation dialog, `tender-pay`,
bill/payment sheets, `wt-button.loading`, `codeMessage`, refusal mappers and test
fixtures. Keep the current payment window and all table cancellation behaviour.
No table, migration, fiscal writer, payment protocol or hardware qualification.

1. **A840: check the path before removing it.** Follow production issuance,
   unpaid departure, transfer closure and bill-to-counter movement into
   `listCounterWaiting`. The existing `issued` counter fixtures explicitly seed
   an unpaid invoice through `testing/issue-order.ts`; they are not proof of a
   current staff journey. Run focused real-route cases for placement, departure
   and movement. If no production journey reaches the action, remove its button,
   app listener/handler and counter-only dialog wording; retain shared table
   cancellation and server cancellation. Replace only tests of the retired
   counter entry with a failing browser check that it is absent, preserving
   table/payment/refusal assertions where their behaviour still applies. If a
   real journey reaches it, report that evidence to the watcher before choosing
   a different build; do not remove a usable action or touch protected writers.
2. **A842: test the live sending action.** In the actual counter/payment journey,
   hold the payment answer and assert the sending action has `loading`, its
   normal fill and a spinner; any alternative Cash/Card action is quiet and
   unavailable. Preserve retry/confirmation locks. Use the existing sheet's
   loading action where A739 already meets the requirement; change only a
   remaining failing surface, including the counter's Pay preparation if needed.
3. **A848: reproduce each refusal, then fix its wording.** Exercise Pay, Send and
   Move with an empty order through the app. Retain controls that already prevent
   an empty action and test their existing empty-state explanation. Where the
   server answers `sale.empty_basket`, show “This order has no items. Add an item
   before continuing.” / “Este pedido no tiene artículos. Añade uno antes de
   continuar.” through the existing code table and the relevant refusal mapper.
   Do not enable actions solely to produce an error or add new server checks.

**Files:** `apps/till/src/till-app.ts`, `i18n/{codes,strings}.ts`,
`widgets/{counter-waiting,tender-pay,cancel-credit-dialog}.ts`, and focused sibling
tests: `till-app-counter-cancel-credit`, `till-app-counter-payment-window`,
`till-app-boot-and-counter`, `till-app-parties`, `till-app-move-dishes`,
`widgets/{counter-waiting,tender-pay,bill-pay-dialog,presented-pay-dialog}`, and
`i18n/codes`. Change only files a reproduced case needs. Existing server route
tests provide reachability evidence; no planned server production change.

**Checks and order:** observed failing browser test before each implementation;
run every changed test file, plus focused server reachability cases. Widget tests
own loading/paint, app cases own forwarding and displayed refusals, code-table
cases own EN/ES wording. Inspect changed surfaces in EN/ES, light/dark, phone and
desktop; use existing accessibility helpers. Update both table-service guides
only for staff instructions affected. Remove completed backlog entries; A739's
physical printer/reader/inbox checks join the existing real-box session. Keep its
dated decision history. Then normal hook, required Claude run-it review(s), one
fix-read where needed, current-head CI and authorised landing.

**Expected size:** production about +45/-100; tests about +140/-750 if the obsolete
counter suite retires; support +0. Documentation about +35/-25. Report additions
and removals separately. Stop for watcher review at 1.5 times the forecast or a
new behaviour beyond these three asks. No owner design approval is claimed.
