# Online payment providers for a guest paying on their own phone — what they charge (2026-09-18)

**Date written:** 2026-09-18. **Status:** prices read from published pages; nothing tested.
**Every figure below is quoted from a provider's own public page on 2026-09-18.** No test payment was
made and no provider was asked for a quote, so this note prices the advertised product, not the deal
the deli would actually be offered. Two of the cheapest figures rest on an inference that is flagged
where it occurs.

**A provider's price is a table, not a number** — plan tier crossed with channel, crossed again with
card class. The first draft of this note learned that the hard way: it priced SumUp from the product
page for online payments, which quotes the default plan only, and so missed both the in-person rates
and the two paid plans. Every provider here should be assumed to have tiers nobody has read yet.

Written because the owner asked which service should take a payment from a diner's own phone, and the
first answer compared only the two providers already built into the tree — which is a question about
the repository, not about the market.

## Why this came up

The idea being priced: a waiter greeting a table hands over a QR code standing for that table's newly
opened tab. The diner scans it, sees the menu, orders, watches what has been served and what is still
coming, and settles the bill on their own phone at the end. Only the last of those — the payment — is
priced here. The rest is unbuilt and undesigned.

Two owner decisions were taken while framing it, both on 2026-09-18:

- **The diner's phone reaches us over the public internet**, through the venue's cloud instance —
  not over the restaurant's own wifi. This is what makes a hosted payment page workable at all: the
  provider has to be able to call us back to say the money arrived, and it can only do that if there
  is a public address to call.
- **Waitron does not have to pick one provider.** Several can be live at once, because
  `packages/payments` defines the provider seam and adapters plug into it independently. The owner's
  example: Mollie for Bizum, SumUp for the card reader in the room, and the online card case still
  open. So the shape of the answer is a routing table — one row per payment method and channel — and
  not a single winner. What running several providers actually costs is one merchant account and one
  settlement reconciliation each, plus one adapter to write and keep working.

## What the repository already has

`packages/payments` carries a second provider interface beside the card-reader one,
`AsyncPaymentProvider`, whose comment already describes this exact idea: the returned `url` is
_"the hosted payment page — presentation-agnostic, rendered as a QR at the table or sent as a link by
the app, never distinguished here"_. `packages/payments-stripe/src/hosted-provider.ts` implements it
against Stripe Checkout — it mints the page, writes an `initiated` row keyed to the working order,
verifies the inbound webhook signature and maps it to a neutral settled/expired result, with a
reconciler behind it that can refund one.

The gap is the one already recorded in this backlog under A6: the webhook `recordSale` hand-off. When
the provider says the diner paid, nothing yet turns that into a recorded, invoiced sale. **That work
sits behind the seam and is therefore provider-neutral** — it can be built against the Stripe adapter
that exists today without foreclosing a cheaper provider later.

## Bizum, online

| Provider | Published wording | Source |
| --- | --- | --- |
| Sipay | _"Bizum · Por transacción exitosa · Tarifa de servicio + 0,10 €"_ | `sipay.es/precios/` |
| Mollie | _"Bizum · Tarifas del adquirente + 0,10% + 0,10 €"_ | `mollie.com/es/pricing` |
| Stripe | _"Bizum · 1,5 % + 0,25 € por cargo realizado correctamente"_ | `stripe.com/es/pricing/local-payment-methods` |
| MONEI | _"Bizum is charged a flat 1.29% + €0.25 MONEI fee per successful transaction, plus a €0.17 acquiring fee"_ | `docs.monei.com/manage-account/monei-fees/` |
| SumUp | not offered — see below | `developer.sumup.com/api/checkouts/create` |

**SumUp cannot do Bizum.** Its checkout API enumerates every non-card method it accepts, and the list
is `BOLETO SOFORT IDEAL BANCONTACT EPS MYBANK SATISPAY BLIK P24 GIROPAY PIX QR_CODE_PIX APPLE_PAY
GOOGLE_PAY PAYPAL TWINT`. Bizum is absent. This is the schema, not marketing copy, so it is the
strongest evidence in this note.

**The pivot is that a Bizum payment costs a flat fee, not a percentage.** MONEI is the only provider
that publishes the underlying acquiring cost separately, and states it as a flat **€0.17** with no
percentage attached. Sipay and Mollie pass that cost through and add almost nothing on top, so their
Bizum pricing is close to flat. Stripe and MONEI charge a percentage on top of a cost that is not a
percentage.

**The inference, stated so nobody treats it as measured:** neither Sipay's _"tarifa de servicio"_ nor
Mollie's _"tarifas del adquirente"_ is published as a number anywhere either company writes. The
worked figures below assume both equal MONEI's published €0.17. That assumption is doing all the work
in the comparison, and it is exactly the sort of number a sales conversation moves. **A written quote
from Mollie settles it; nothing short of one does.**

On a €50 bill, under that assumption:

| Provider | Cost | As a share |
| --- | --- | --- |
| Sipay | ≈ €0.27 | ≈ 0.5 % (inferred) |
| Mollie | ≈ €0.32 | ≈ 0.6 % (inferred) |
| Stripe | €1.00 | 2.0 % (published) |
| MONEI | €1.07 | 2.1 % (published) |

Those inferred shares land on the 0.4–0.6 % that this repository's earlier Bizum research recorded for
the direct route, which is weak corroboration — two estimates agreeing is not a measurement, but a
disagreement would have been a reason to distrust both.

Bizum's own operational limits, per Mollie's method page: minimum €0.50, maximum €2 000, a four-minute
session timeout, refundable in full or part for 365 days, and — the line worth the most to a
restaurant — **"Chargeback risk: No"**. A card payment can be pulled back by the cardholder months
later; a Bizum payment cannot.

## Cards, online

Not every diner will use Bizum, so the card rate decides the rest. On a €50 bill:

| Provider | Spanish card | Card issued outside the EEA |
| --- | --- | --- |
| Mollie | €0.85 — _"Tarjetas de Consumo Doméstico 1,20 % + 0,25 €"_ | €1.88 — _"3,25% + 0,25 €"_ |
| MONEI | ≈ €0.87 — _"0,90% + 0,25 €"_ plus Interchange++ | ≈ €1.30–1.60 (interchange uncapped) |
| Stripe | €1.00 — _"1,5 % + 0,25 €"_ | €1.83 — _"3,15 % + 0,25 €"_ |
| SumUp | €0.98 — flat _"1,95 %"_ | **€0.98** — same flat rate |

Two traps in that table. **MONEI's headline is not all-in**: its own page says card payments _"also
include Interchange++ (scheme fees plus a 0.10% acquiring fee), deducted at settlement"_, and MONEI
additionally charges a platform fee of €0.15 per day, about €55 a year. The MONEI figures above are
therefore estimates, not quotes. And **SumUp's flat rate is its one real advantage**: it is the
cheapest option by a wide margin for a tourist's card, because it does not surcharge by card origin
the way every percentage-plus-fixed competitor does. How much that is worth depends on the deli's
actual card mix, which nobody has measured.

**SumUp's 1,95 % is its ONLINE rate, and it is the same on every plan** — the paid plans below change
only what happens in the room. `sumup.com/es-es/precios/` states it once per plan: _"1,95 % for online
payments (e.g. Payment Links, Bookings, or other digital products)"_.

## Cards, in person — and SumUp's plans

Added 2026-09-18 after the owner supplied SumUp's own pricing table. This section was missing from the
first draft, which priced SumUp from its online-payments product page and so recorded only one cell of
a six-cell table. Source for everything here: `sumup.com/es-es/precios/`.

SumUp sells three plans in Spain, plus a negotiated one:

| Plan | Monthly | In person, Spanish debit and credit | In person, premium / international / Amex | Online |
| --- | --- | --- | --- | --- |
| Pago por uso | €0 | 1,49 % | 1,49 % | 1,95 % |
| Pagos Plus | €19 | **0,75 %** | 1,49 % | 1,95 % |
| Tarifa Plana | €25 | **0 % up to €2 500/month, then 0,79 %** | 1,49 % | 1,95 % |
| A medida | negotiated | negotiated — offered from €10 000/month | negotiated | negotiated |

SumUp's own guidance on when a paid plan starts paying: Pagos Plus _"si procesas pagos por valor de
3200 € o más al mes"_, and custom pricing _"si tu negocio procesa 10 000 € o más al mes"_.

**My arithmetic, not SumUp's, on which plan a deli should be on.** Tarifa Plana overtakes
pay-as-you-go at about €1 680 a month of in-person Spanish card takings (€25 ÷ 1,49 %). It also beats
Pagos Plus at every volume a single restaurant will see — the two cross around €34 000 a month, far
past the €10 000 where SumUp starts offering negotiated rates. So the realistic choice is
pay-as-you-go for a very quiet venue and **Tarifa Plana for anything busier**, with a phone call
replacing both once card takings pass €10 000 a month.

Against Stripe Terminal, whose published in-person rates are _"1,4 % + 0,10 €"_ for EEA cards and
_"2,9 % + 0,10 €"_ outside it, on a €50 bill:

| | Spanish card | Tourist card |
| --- | --- | --- |
| SumUp, Tarifa Plana | €0 within the monthly allowance, then €0.40 | €0.75 |
| SumUp, pay-as-you-go | €0.75 | €0.75 |
| Stripe Terminal | €0.80 | €1.55 |

**This strengthens SumUp's claim on the card-present seat**, which is where the owner had already put
it. SumUp is cheaper than Stripe Terminal on a Spanish card even before the monthly plan, and half the
price on a tourist card, because it does not surcharge by card origin at all.

## Not priced

- **Straight through the deli's bank, on a Redsys virtual terminal.** The traditional Spanish route,
  and usually the cheapest because it removes a layer. Every bank sets its own rates and none publish
  them, so there is no receipt here at all. The deli already has a banking relationship, so one phone
  call would settle it.
- **Adyen and Viva.com.** Neither publishes a Bizum rate that could be found. Adyen also normally
  wants volume commitments a single restaurant would not meet.

## What would settle this

Two written quotes, both specifically for Bizum: one from Mollie and one from the deli's own bank.
The whole comparison turns on a single unpublished number worth roughly €0.70 a bill, and a quote
resolves it in a way that reading websites cannot.
