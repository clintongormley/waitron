# Cancel a waiting card payment from the till

Staff can press **Cancel** while their SumUp reader is waiting for the card. When SumUp confirms
no charge, they can choose how to pay again. If the card was charged, the ordinary payment result
shows it as paid. If SumUp refuses or gives no answer, keep the ordinary result or recovery pending.
Source: Lane F queue, CANCEL-WAITING-CARD-PAYMENT, from the owner's real-box report on 20 November.

1. **SumUp.** Start with failing cases in `packages/payments-sumup/src/sumup-client.test.ts` and
   `provider.test.ts`. In `client.ts`, `sumup-client.ts`, `provider.ts` and the existing fake, add
   the documented reader termination call and retain the checkout ID returned by Create. The
   optional signal from `packages/payments/src/provider.ts` is a live checkout control with
   `available(): Promise<boolean>` and `request(): Promise<"requested" | "unavailable" | "refused" | "unknown">`.
   Offer it after checkout creation. Reuse `readerStatus` for online and `WAITING_FOR_CARD`, and on
   the press verify the same checkout is still pending by its ID before rechecking reader status.
   During that request, hold the same-reader checkout slot until both the stop request and the
   collect end, including across provider pool replacement. Recheck the live attempt before
   sending. A 202 means only dispatched. Test a confirmed no-charge exit, a capture during Cancel,
   a refused stop, an advanced reader and a newer attempt protected from the old request.
2. **Server.** In `apps/server/src/bill-payments-api.ts` and `bill-payments.ts`, register that control
   for the duration of the original collect, keyed by bill, submission ID and initiating session
   and device. Add GET and POST `/api/working-orders/:id/payments/:submissionId/cancel`, with the
   original payment's person, device, permission and zone checks. GET offers the action, POST sends
   the request. Both use the live control and take no reader ID from the browser. Keep the existing
   collect lookup as the authority for charge, definite failure and unknown. Reuse the existing
   failure reason where SumUp confirms cancellation. In `bill-payments-api.test.ts` prove a stop
   request alone changes no payment or invoice, the original request settles a capture once, and
   bills can be paid again after definite failure. Add the profile-action, zone and session inventory
   cases and prove a stale or other session's submission sends nothing.
3. **Till.** In `apps/till/src/api/client.ts`, use the real submission ID even on resend. All three
   screens already reach the bill-payments POST. In `till-app.ts`, observe availability only during
   the reader request and stop observing when that send ends. Pass the action into `bill-pay-dialog.ts`,
   `presented-pay-dialog.ts` and `tender-pay.ts` through `till-counter-screen.ts`. Use the existing
   status feedback for progress and refusal. Keep Pay unavailable until the original result arrives.
   Add localized copy in `i18n/strings.ts` and update both `guide/*/table-service.md` files. Start with
   failing Chromium cases in `till-app-bill-payments.test.ts`, `till-app-handheld-pay.test.ts` and
   `till-app.test.ts` for the three entry points. Check both languages, both themes and phone width.

Expected about 300 production and 220 test lines. No schema, new settlement path, refund, or changes
to other providers. The old direct pay route offers no Cancel, but its SumUp collects share the
reader slot. A949 §5c has no recorded remote terminate result. Qualify on a test Solo when the
watcher clears access. SumUp documents a reader-wide stop and a last-known reader status, so a card
presented after the status read can race the stop. The actual result decides what the till says.
[Terminate](https://developer.sumup.com/api/readers/terminate-checkout/) · [Checkout](https://developer.sumup.com/api/readers/get-checkout/) · [Status](https://developer.sumup.com/api/readers/get-status/).
