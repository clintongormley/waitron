# Cancel a waiting card payment from the till

Staff can ask their SumUp reader to stop from Pay. A definite no-charge result returns them to Pay.
A charge follows the current paid flow. A refusal leaves Pay waiting for the original payment.
The owner's 20 November report is recorded in Lane F's CANCEL-WAITING-CARD-PAYMENT queue item.
The watcher cleared the plan with the changes recorded at 00:52 and 02:00 on 21 November.

**Before building.** A949 measured a press on the reader itself. The remote test needs a new SumUp
API key on the Lenovo and an authorised Solo session. Run
[A949 §5b and §5c](../../research/2026-09-10-sumup-solo-experiments.md) without tapping a card,
then start a fresh checkout after the stop. Record the HTTP answers, reader
and checkout states, transaction lookup and time to a definite result. Park the build if the original
checkout or lookup stays unresolved until Waitron's poll expires, or the stop reaches the next
checkout. If SumUp accepts two checkouts while the reader waits, take the result to the watcher
before changing the owner's reader-start rule. Record the probes in A949 and update the pending
probes in `docs/backlog/payments.md`.

## PR 1 — Cancel from the shared bill Pay dialog

1. Start with failing cases in `packages/payments-sumup/src/{sumup-client,provider}.test.ts`.
   Add the terminate call in `client.ts`, `sumup-client.ts`, `card-provider.ts` and the fake. Add
   optional `onReaderCheckout(requestStop)` to `CollectParams` in `packages/payments/src/provider.ts`.
   Offer it after Create succeeds. On the press, confirm the collect is still live and use
   `readerStatus` to require online `WAITING_FOR_CARD`. Keep the attempt pending until the stop
   request ends and use the existing reader-start rule. Test the PIN state, refusal and a stop
   after the collect ends. Check the timing of dispatch and the following checkout on the Solo.
2. In `apps/server/src/bill-payments{,-api}.ts`, attach the callback to the live bill, submission
   ID, session and device. One POST to `/api/working-orders/:id/payments/:submissionId/cancel`
   checks the person, device, permission and zone, and reports requested, unavailable, refused
   or unknown. Update the full-disk exceptions in `till-api.ts` and the handed-over replies in
   `restricted-start.ts`. In `bill-payments-api.test.ts`, prove another session dispatches nothing,
   a racing charge settles once, and a definite failure allows a new payment. Cover the till
   action, zone and session inventories and both start gates.
3. In `apps/till/src/api/client.ts`, add the cancel POST. Use the existing submission ID in
   `till-app.ts` and `widgets/bill-pay-dialog.ts`. Show Cancel during the reader wait and
   announce a request or refusal. A requested stop followed by a
   definite failure shows **No payment was taken**. The original Pay request settles the outcome.
   Start with failing cases in `till-app-bill-payments.test.ts` for no charge, already paid and refusal.
   Describe the control in the English and Spanish shared Pay guide.

Estimate 210 added lines of production code and 210 of tests.

## PR 2 — Cancel from counter and table Pay

1. Start with failing cases in `till-app-handheld-pay.test.ts` and `till-app.test.ts` for the
   counter and table entry points. In `api/client.ts`, report the submission ID through
   `pay(req, { onSubmission })` just before the POST, including a reused ID. Wire the same
   action and outcome through `till-app.ts` and `widgets/card-waiting.ts` for table Pay, and
   `widgets/tender-pay.ts` via `screens/till-counter-screen.ts` for counter Pay.
2. Extend the shared Pay note in `apps/server/src/guide/{en,es}/table-service.md` to cover the
   direct Counter and table screens. Add a dated pointer to item 9 of
   the [A796 handheld payments design](../specs/2026-10-19-a796-handheld-payments-design.md).

Estimate 90 added lines of production code and 90 of tests, plus the guides. Both pull requests
keep the existing payment settlement and recovery. Before each branch review, run its focused
tests and check its changed screens in EN and ES, both themes and phone and desktop widths.
[SumUp terminate](https://developer.sumup.com/api/readers/terminate-checkout/) · [Reader status](https://developer.sumup.com/api/readers/get-status/).
