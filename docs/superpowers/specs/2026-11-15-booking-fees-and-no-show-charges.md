# Booking prepayments refunded on arrival

You chose **Prepay, refund on arrival** in the watcher's window on 15 November 2026. Both SumUp and Stripe offer online payment followed by a later refund, independently of a Solo reader [S1–S2, T1–T2]. Either supports this approach within the refund constraints below. No provider choice is recorded here; SumUp remains your till provider.

## Eight guests, one €80 payment

For eight guests at €10 each, your guest pays **€80 now as one booking and one charge**. On arrival, you refund the full €80 to the original payment method, and the guest pays for the meal separately. You bear the original processing fee rather than subtracting it from the guest's refund [S2, T3].

Requesting a refund through the provider's software interface does not mean the refund has completed or reached the guest's bank. Funds can take time to arrive; a pending or refused refund is not money returned [S2, T2]. You cannot promise immediate money back.

If the guests do not arrive and you retain the prepayment, you already hold their €80; there is no new charge attempted without them. Unlike saving a card or reserving funds temporarily, this choice takes the money when they book. The VAT treatment of keeping it is still open below.

## Which provider fits?

**SumUp:** You can take an online payment through its hosted payment page and later request a refund [S1–S2]. Its Spain support text says some payments more than 90 days old may be impossible to refund because of third-party technical limits. This is neither a blanket 90-day cutoff nor a guarantee that every younger payment can be refunded. You need enough balance in deposits not yet paid out [S3]. For a booking months ahead, that possible refusal matters to your promise of a full refund on arrival.

**Stripe:** You can take an online one-off payment through Checkout and later request a refund [T1–T2]. The evidence boundary is: **no card-payment age deadline stated in the reviewed Stripe pages; whether any age is refundable is unverified**. You also need usable available balance: pending funds do not count. With insufficient balance, Stripe can leave a card refund pending rather than pay it automatically [T2].

## Cost of this booking

This table illustrates booking-prepayment/refund processing at published Spain prices, excluding the separate meal payment and optional extras [S4, T3].

| Provider | Published processing price | Fee on one €80 charge | Cost retained after full €80 refund |
| --- | --- | --- | --- |
| SumUp online | 1.95% | €80 × 1.95% = **€1.56** | **€1.56**; original processing fees are not returned [S2] |
| Stripe, standard European Economic Area cards | 1.5% + €0.25 | €80 × 1.5% + €0.25 = **€1.45** | **€1.45**; original processing fees remain, with no extra issuance fee for a standard card refund [T3] |

SumUp's SDK/API price may be negotiated; its published price is illustrative, not your venue tariff [S4]. Stripe's other card, custom and currency-conversion prices may differ [T3].

## The ticket and VAT still need settling

In [the adviser answers, Part C, Deposits (his 1.8)](../../compliance/2026-11-15-adviser-answers.md#part-c-to-remember-when-these-are-built), money for an identified booking is an advance payment and receives its own ticket, a simplified invoice. His final-bill example keeps that advance: the final ticket deducts its pre-VAT amount and VAT, and the record sent to AEAT, Spain's tax agency, carries the remainder.

Your chosen flow returns the whole advance on arrival. Applying his answer to this refunded guarantee requires the advance ticket's refund or corrective treatment to be settled. His deduction example supplies no mechanism for that reversal. You must not also deduct the already refunded €80 from the meal payment.

[Question 18 in the adviser meeting](../../compliance/2026-11-19-adviser-meeting.md) remains unanswered: when you keep a deposit as no-show compensation, does its original VAT ticket stand, or do you issue a corrective removing VAT despite refunding no money? Do not treat the compensation's VAT treatment as settled.

_2026-11-18: the owner's answer, the adviser still to confirm the details — see question 6 of the [19 November sheet](../../compliance/2026-11-19-adviser-meeting.md): the venue issues the corrective._

Online booking is not built, [A1013 remains open](../../backlog/till.md#a1013-online-booking-for-customers-owner-2026-10-22), and this comparison and its tax qualification authorise no implementation.

## Provenance

Provider documentation checked by the driver on 15 November 2026. SumUp Spain support is first-party indexed text; direct open showed only a loading shell, without live-browser validation.

| Source | Exact excerpt and scope |
| --- | --- |
| [S1: SumUp hosted checkout](https://developer.sumup.com/online-payments/checkouts/hosted-checkout/) | “accept online payments with a SumUp-hosted payment page”. Online collection independent of Solo. |
| [S2: SumUp refunds](https://developer.sumup.com/online-payments/guides/refund/) | “The processing fees associated with the original transaction are not returned.” Refunds return funds to the original method. |
| [S3: SumUp Spain refunds](https://help.sumup.com/es-ES/articles/3IXN9yTldqaeEMcM0nUTDp-reembolsar-transacciones) | “puede que no sea posible”; “más de 90 días de antigüedad”; “depósitos todavía no retirados”. Possible older-payment refusal and unwithdrawn-balance condition. |
| [S4: SumUp Spain online pricing](https://www.sumup.com/es-es/pagos-online/) | “1,95 % por transacción”; “puedes acordar precios personalizados”. Published illustration; SDK/API tariff can differ. |
| [T1: Stripe Checkout](https://docs.stripe.com/payments/checkout) | “Accept one-time and subscription payments”. Checkout accepts a real online payment. |
| [T2: Stripe refunds](https://docs.stripe.com/refunds.md) | “Refunds use your available Stripe balance”; “Stripe holds the refund as pending for card transactions”. No card-payment age deadline found in the reviewed pages. |
| [T3: Stripe Spain pricing](https://stripe.com/en-es/pricing) | “1.5% + €0.25”; “standard European Economic Area cards”; “original transaction are not returned”. Standard card refunds have no extra issuance fee; other tariffs differ. |
