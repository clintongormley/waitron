# Cancel a waiting card payment from the till

Staff can ask their SumUp reader to stop from Pay. Once the original payment confirms no charge,
they can choose how to pay again. A charge goes through the ordinary paid flow. A stop refusal
leaves the payment waiting for its own result. Source: CANCEL-WAITING-CARD-PAYMENT in Lane F's
queue, from the owner's real-box report on 20 November.

1. **SumUp.** Start with failing cases in `packages/payments-sumup/src/sumup-client.test.ts` and
   `provider.test.ts`. Add the reader terminate call in `client.ts`, `sumup-client.ts`,
   `card-provider.ts` (the lazy client) and the existing fake. Add an optional
   `onReaderCheckout(requestStop)` to `CollectParams` in `packages/payments/src/provider.ts`.
   SumUp's `provider.ts` offers the callback after it has created the checkout. On a press,
   use the existing reader status read, allow only online `WAITING_FOR_CARD`, and check the
   collect is still live before dispatch. Keep one live SumUp collect per reader per venue store
   across provider replacement. Reuse `reader.payment_in_progress` for a competing start.
   Before saving a terminal result, close the stop action and wait for any stop HTTP request
   already sent, using the client's existing timeout. Test one dispatch, no dispatch at the
   PIN prompt, refusal, and a newer checkout held off during the old stop request.
2. **Server.** Pass the callback from `apps/server/src/bill-payments-api.ts` through
   `bill-payments.ts`. Keep the live action only for that collect, keyed by bill, submission ID,
   initiating session and device. One POST to `/api/working-orders/:id/payments/:submissionId/cancel`
   checks the person, device, permission and zone as the payment does. It returns requested,
   unavailable, refused or unknown, using the original reader. The existing collect still
   decides whether money moved. In `bill-payments-api.test.ts` check a confirmed failure permits
   another payment, a racing charge settles once, and another session's request sends nothing.
   Cover the new route in the till profile-action, zone and session-person inventories.
3. **Till.** In `apps/till/src/api/client.ts`, have `pay(req, { onSubmission })` report the actual
   submission ID just before the POST, including a reused ID. The shared Pay window already has
   that ID. In `till-app.ts`, bind Cancel to that send and ignore late answers from an old send.
   Reuse `card-waiting.ts` for the two handheld views. Wire it from `bill-pay-dialog.ts` and
   `presented-pay-dialog.ts`, and use the existing controls on desktop and in `tender-pay.ts` via
   `till-counter-screen.ts`. Announce progress and refusal in the waiting view. Show **No payment
   was taken** and return to Pay after a requested stop and definitive no-charge result. Keep
   the existing paid and unknown outcomes. Add localized copy and both table-service guides.
   Test first in `till-app-bill-payments.test.ts`, `till-app-handheld-pay.test.ts` and
   `till-app.test.ts`. Check both languages and themes at phone and desktop widths.

Expected about 260 added production and 250 added test lines. Scope is the live SumUp request and
the three till screens. The provider's 202 confirms dispatch. Its status is last known and a
delayed command can race a card tap or arrive after an HTTP timeout. A949 §5c has no remote
result. Before landing, qualify remote stop and the next checkout on an authorised test Solo and
record the time from the press to a definite result. A provider refusal or uncertain payment
continues through the existing wait and recovery.
[Terminate](https://developer.sumup.com/api/readers/terminate-checkout/) · [Status](https://developer.sumup.com/api/readers/get-status/).
