# Cancel a waiting card payment from the till

Staff can ask their SumUp reader to stop from Pay. A definite no-charge result returns them to Pay.
A charge follows the current paid flow. A refusal leaves Pay waiting for the original payment.
Source: Lane F's CANCEL-WAITING-CARD-PAYMENT queue item, from the owner's 20 November report.

**Before building.** A949 measured a press on the reader itself. The SumUp client needs a new
remote stop call, and A949 §5b and §5c are open. With the watcher, run those two probes on an
authorised test Solo and start a fresh checkout after the stop. Record the HTTP answers, the
reader and checkout states, the transaction lookup and the time to a definite result. Stop the
build if the first checkout keeps waiting, the lookup stays missing or pending until Waitron's
existing poll expires, or the stop reaches the next checkout. If SumUp accepts two checkouts
while the reader waits, take the result to the watcher before changing the owner's reader rule.
Keep the probe results in the A949 notes and update the pending probes in `docs/backlog/payments.md`.

1. **SumUp.** Start with failing cases in `packages/payments-sumup/src/{sumup-client,provider}.test.ts`.
   Add terminate in `client.ts`, `sumup-client.ts`, `card-provider.ts` and the fake. Add optional
   `onReaderCheckout(requestStop)` to `CollectParams` in `packages/payments/src/provider.ts` and
   offer it after Create succeeds. On the press, recheck that the collect is live and use
   `readerStatus` to require online `WAITING_FOR_CARD`. An old action becomes unavailable once
   a newer checkout starts. While a stop is in flight, hold off new starts on that reader with
   `reader.payment_in_progress`; the original collect waits for that HTTP request before saving
   its result. The guard shares the venue store and survives a provider refresh. Test the PIN
   state, refusal, stale action and competing start. The 202 confirms dispatch. After a timeout
   an arriving stop could make the next payment appear declined. Check that boundary on the Solo.
2. **Server.** Pass the callback through `apps/server/src/bill-payments{,-api}.ts`. Register it only
   for the live bill, submission ID, session and device. One POST to
   `/api/working-orders/:id/payments/:submissionId/cancel` checks the person, device, permission
   and zone and reports requested, unavailable, refused or unknown. Add it to the full-disk
   exceptions in `till-api.ts` and the handed-over replies in `restricted-start.ts`. In
   `bill-payments-api.test.ts` prove another session sends nothing, a racing charge settles
   once, and a definite failure allows a new payment. Cover the till action, zone and session
   inventories and the two start gates.
3. **Till.** Have `api/client.ts` report the real submission ID through
   `pay(req, { onSubmission })` just before the POST, including a reused ID. Shared Pay already
   has the ID. Bind the button to that send in `till-app.ts`, with `card-waiting.ts` shared by the
   handheld bill and presented dialogs, the desktop bill action, and `tender-pay.ts` via
   `till-counter-screen.ts`. Announce the request and refusal. After a requested stop and definite
   failure, show **No payment was taken**. The original Pay request still decides paid, failed or
   unknown. Test first in `till-app-bill-payments.test.ts`, `till-app-handheld-pay.test.ts` and
   `till-app.test.ts`. Check EN/ES, both themes and phone/desktop. Update both table-service
   guides and add a dated pointer to item 9 of the A796 handheld payments design.

Expected about 300 added production and 300 added test lines. Scope is live SumUp checkout
cancellation on the three till screens. Keep the existing payment settlement and recovery.
[Terminate](https://developer.sumup.com/api/readers/terminate-checkout/) · [Status](https://developer.sumup.com/api/readers/get-status/).
