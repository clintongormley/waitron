# Card reader failure reasons

A card refusal and a reader that did not answer need different explanations. The counter's
completed outcome panel offers Retry and Cancel. It cannot restart a spinner for a request that
has already ended. Retry repeats the payment details; Cancel returns you to the basket.

The owner approved this panel on 2026-10-16 as A739a. The current simulator selection stays in
place until A739 builds its payment window.

## Provider evidence

Read on 2026-10-16. Quotes identify the source's vocabulary; the next column states what Waitron
uses it for. The keep-card instruction is the owner's staff policy, rather than a claim that
Stripe instructs merchants to retain every card with these codes.

| Source | Source words | Interpretation and boundary |
| --- | --- | --- |
| [Stripe decline codes](https://docs.stripe.com/declines/codes) | `insufficient_funds`, `expired_card`, `incorrect_pin` | These distinguish funds, expiry and PIN refusals. The counter translates recognised reasons into English and Spanish. Unknown reasons stay generic. Codes whose documented explanation gives no additional cause also stay generic. |
| [Stripe decline codes](https://docs.stripe.com/declines/codes) | `lost_card`, `stolen_card`, `pickup_card` | These codes exist. Lost and stolen describe reported cards; pickup says the card cannot be used and may be lost or stolen. Stripe says to conceal lost/stolen details from customers. The owner's policy shows the keep-card message on the staff counter and omits Retry. It does not add a customer message. |
| [Stripe server-driven collection](https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven) | `api_error`, `decline_code`, `last_payment_error` | Reader software 2.42 and later can include structured API error details. For a generic card decline without those details, read the referenced PaymentIntent's last error. A failed detail lookup leaves the generic refusal available. Do not parse provider prose. |
| [Stripe server-driven collection](https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven) | `connection_error` | The payment may have reached Stripe before the connection failed. This is no evidence of a bank refusal. The panel explains that the reader did not answer. That wording does not settle the payment. |
| [SumUp Cloud API, transaction results](https://developer.sumup.com/terminal-payments/cloud-api#receive-transaction-results) | `failure_reason`, “free-form text” | The optional reason is documented in the public HTTPS callback. SumUp tells integrations not to classify it by exact text. This is a different path from Waitron's transaction polling. |
| [SumUp transaction retrieval](https://developer.sumup.com/api/transactions) | `FAILED`, `CANCELLED`, `PENDING` | The retrieved transaction schema documents statuses but no failure-reason field. A search of that page for `failure` returned no match. Waitron's `findTransaction` uses this retrieval path; it does not provide a checkout callback URL. A generic SumUp refusal remains generic. Adding a callback needs a separate design, including callback authentication. |

## Payment bookkeeping remains a separate decision

A739a carries optional failure metadata; it does not change stored payment states or create a new
wait. SumUp's pending path and the server's existing payment-in-progress checks remain in place.

Stripe's timeout issue was already recorded under “What M7b2 left open” in
[payments.md](../backlog/payments.md#what-m7b2-left-open-a-manager-clearing-a-stuck-card-payment-702).
Its collect path cancels the reader action best-effort and fails the local row even when that
cancel is refused. Leaving it pending instead would hold the order until a manager resolves it.
On 2026-10-16 the owner kept that repair out of A739a and approved A764: leave uncertain
attempts unknown and check them automatically after collection stops, with the manager action as
fallback. A764 must first demonstrate that its automatic check cannot cancel a live collection.
A different message alone does not repair this bookkeeping issue.

The focused existing case `a timed-out collect still fails cleanly when cancelling the reader
action is refused` in `packages/payments-stripe/src/provider.test.ts` passed on 2026-10-16. It
asserts the failed local row after the cancellation rejects. This is evidence of that local
state, not an experiment establishing what a physical reader charges afterwards.

## Earlier reproduction

Eight counter probes on baseline `6dcffc9d3` retained a selected Decline, sent the declined
simulation outcome, displayed a refusal and retained the basket. They used an API fake, not the
Santet installation. The owner subsequently identified Keep waiting after that refusal as the
reported problem. Those probes checked the decline itself and did not check this button.
