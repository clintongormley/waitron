# Booking fees and no-show charges

You want an €80 no-show charge to be possible without taking an €80 booking payment. Saving a card and reserving funds give you different protection. This proposed comparison keeps SumUp as your current till provider; it authorises no implementation.

## Eight guests on Saturday

Suppose you accept eight guests for Saturday with a €10-per-person no-show charge. In the proposed booking flow, you show the €80 total, cancellation deadline and circumstances for charging before the guest accepts. You keep the accepted terms available beside the booking so you can review them before any charge.

With SumUp's documented online Payment Widget route, the guest goes through a €1 transaction that is reimbursed, consent and card authentication. You receive a saved payment instrument token, a reference for later payment. This is an online flow, not a Solo reader feature; it does not reserve €80 [S1–S2].

With Stripe, a SetupIntent saves the card without an initial payment or reserving €80. The guest explicitly accepts when, why and how much you may charge later without their presence, called an off-session payment [T1].

If the party attends or cancels before your stated deadline, you make no later no-show charge. If nobody arrives, you review the booking against the accepted terms before attempting €80 using the saved method. SumUp requires a new checkout [S1–S2]. With either provider, a pending attempt, failure or request for further card authentication must remain visibly unpaid. Stripe may need the guest to return to the payment page [S2, T1].

For bookings that week or weeks ahead, either saved-card route supports a later attempt, with no guarantee of collection [S1–S2, T1]. Your proposed confirmation distinguishes card setup from a completed no-show payment, so neither you nor your guest mistake permission for money received.

## A hold is a separate choice

A Stripe manual authorisation temporarily reserves €80. You later capture it, meaning collect the reserved money, before its returned `capture_before` deadline, or cancel it to release the hold. Windows vary. Even that week's booking needs a deadline beyond the intended charge date; an ordinary hold taken now cannot be assumed to last until a booking weeks ahead [T2].

No equivalent hold operation was identified in the reviewed public SumUp paths. That finding does not establish what SumUp might offer privately. Neither a zero-amount verification route nor a hold lifetime should be promised from these documents [S1–S3].

## What remains to design

Staff booking operations are declared (`packages/bookings/src/bookings.ts:163` and `routes.ts:111`); the guest page remains proposed under [A1013](../../backlog/till.md#a1013-online-booking-for-customers-owner-2026-10-22).

SumUp's reader adapter (`packages/payments-sumup/src/provider.ts:118`) and Stripe's one-off hosted checkout adapter (`packages/payments-stripe/src/hosted-provider.ts:28`) do not supply this booking/card-saving flow. `CollectParams` and `InitiateParams` require `workingOrderId` (`packages/payments/src/provider.ts:30,302`). Your no-show booking has no bill: payment linkage remains a design gap, not permission to invent a sale.

Any future design must follow [A951 §8](2026-10-22-a951-box-public-access-design.md#8-expose-customer-functions-only-after-their-products-agree-a-manifest): constrained public routes, authenticated provider callbacks and no Cloud payment settlement. Fiscal treatment stays open under [A275's S8 scope](2026-10-20-a275-invoice-now-transfer-later-design.md#10-research-premise-and-the-attached-asesor-question); you should not infer that no-show compensation is automatically an invoiced sale. A1013 stays open.

## Provenance

Public documentation read by the driver on 15 November 2026; supplied evidence only.

| ID / source | Exact quote, then bounded interpretation |
| --- | --- |
| [S1: SumUp tokenisation](https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/) | “transaction amount is instantly reimbursed”. The €1 EUR setup example saves a token with consent and 3D Secure; later payment needs a new checkout. No zero-amount route documented here. |
| [S2: SumUp process](https://developer.sumup.com/api/checkouts/process/) | “Processing a checkout will attempt to charge”. Token/customer payments may need further authentication; acceptance is not payment confirmation. Reviewed public paths identified no authorise/capture/release operation. |
| [S3: SumUp create](https://developer.sumup.com/api/checkouts/create/) | “The checkout must be processed before this moment”. `valid_until` expires an unprocessed checkout, not reserved funds. |
| [T1: Stripe save/reuse](https://docs.stripe.com/payments/save-and-reuse) | “without an initial payment”; “explicitly collect consent”. SetupIntent saves details for later use without reserving funds; later collection can fail or need authentication and a return visit. |
| [T2: Stripe holds](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | “before the authorization expires”; “cancel the PaymentIntent”. Separate manual authorisation/capture has varying windows; use the actual capture deadline or release the hold. |

**Recommendation:** Subject to your choice, prefer Stripe for a future online booking card guarantee because SetupIntent takes no initial payment [T1]. Keep SumUp at the till; call the guarantee permission to attempt collection.

**Owner question:** Should Stripe provide that future online booking card guarantee while SumUp remains your till provider, or do you prefer SumUp's documented €1-and-reimbursement route [S1]?
