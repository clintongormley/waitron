# SumUp Card-Present Provider — Design

**Date:** 2026-07-30
**Status:** Approved in brainstorming
**Scope:** `@waitron/payments-sumup` — a card-present provider whose outcome arrives asynchronously —
plus the one neutral addition it needs.

> **Companion document, not yet on `main`.** The hardware this runs on, and the economics that chose
> SumUp over Stripe, are in `docs/superpowers/specs/2026-07-30-deli-hardware-design.md`, in flight as
> **PR #7**. References to it below are deliberately unlinked until it lands; link them when it does.
> Nothing in this design depends on that one being accepted — if the deli buys different readers, the
> shape here is unchanged.

**Why this exists.** Stripe Mode 2a, SumUp's Cloud API and Square's Terminal API are the same
topology: our server pushes a checkout to a networked reader over HTTPS and the outcome comes back.
Stripe returns it in the response; SumUp and Square do not. Building this adapter well is therefore
building the shape a Square adapter later drops into — which is what makes "reuse the reader you
already own" more than a slogan.

---

## 1. The shape: no new interface

`SumUpCloudProvider implements PaymentProvider` — the **existing synchronous** interface. The
asynchrony is an adapter implementation detail, invisible above the seam.

This was chosen over two alternatives. A third contract (`push` returns immediately, a webhook settles
later) would be more honest about the mechanism, but the till must know within seconds whether to hand
over the goods, so the waiting has to happen somewhere and the adapter is the least disruptive place.
Relaxing `AsyncPaymentProvider` to cover both was rejected because its `InitiateResult.url` is a
customer-facing link and its `InitiateParams` assumes an open working order — a counter reader is
neither.

Consequence worth stating: **every caller, the till flow and sale-chaining are untouched.** This spec
adds one method to `PaymentProvider` (§3) and changes no existing one.

## 2. `collect()` — T1/T2 with a poll in the middle

The house transaction discipline is unchanged; only step 3 is new.

1. **T1** — `insertAttempting` (`packages/payments/src/store.ts`), committed **before** any network
   call, so the `payment_ref` idempotency anchor is claimed and a crash leaves a recoverable row.
2. Create a reader checkout over the Cloud API.
3. **Poll** `GET /v2.1/merchants/{merchant_code}/transactions?client_transaction_id=…` until `status`
   leaves `PENDING`.
4. **T2** — `captureAttempting` on `SUCCESSFUL`; `failAttempting` on `FAILED` or `CANCELLED`.

Two vendor constraints shape this:

- **Checkouts serialise per reader.** *"After the checkout is accepted, the system has 60 seconds to
  start the payment on the target device, and during this time, any other checkout for the same
  device will be rejected."* One reader is one queue; a second counter position needs a second reader,
  which §3 of the hardware spec already buys.
- **`Terminate Checkout` exists and we deliberately do not call it on timeout.** Forcing a definite
  answer races the customer: they may complete the tap in the instant we terminate, and we would then
  have recorded a decline against a real payment. An unknown is safer than a possible lie.

## 3. The indeterminate case — the money-critical part

When the poll times out, the customer may or may not have paid. Two rules follow.

**The row stays `attempting`.** It is not resolved to `failed`. Note that `failAttempting` is
currently documented as the resolution for *"the network refused or timed out"* — true for Stripe's
synchronous `collect`, where a timeout means the call never completed, and false here, where a
timeout means we stopped watching. Using it would assert a decline we cannot support.

**The result carries `settledAt: null`**, so `recordSale` refuses and no sale chains against money we
are unsure of. Staff retry or take cash.

> **Rejected during brainstorming, and recorded because the reasoning is not obvious.** Returning
> `network_unavailable` was the first proposal and is wrong. `provider.ts` defines it as the case
> where *"nothing durable is written (no money moved), so it is deliberately NOT a `payment_state`
> enum value"*. Our timeout is the opposite: a durable row exists and money may well have moved. The
> protective behaviour is identical, but the state would have asserted a falsehood in the one enum
> where that matters most.

**New: `resolvePending(now)` on `PaymentProvider`.** Returns the existing `ForwardResult` shape
(`nextDueAt`, plus counts for a log line) and is driven by the existing recurring-work scheduler.
It sweeps this provider's `attempting` rows, polls each, and resolves it. Existing adapters return
all-zeros — exactly how `forward` joined the interface in Mode 2b.

A sibling method rather than widening `forward`: `forward`'s contract is documented as draining *this
provider's `accepted_offline` rows*, and every adapter's all-zeros implementation was written against
that promise. Overloading it would silently change what those implementations claim.

**The happy accident.** If `resolvePending` finds the payment succeeded and no sale was ever chained,
the row is `captured` with `sale_id` null — which is exactly `classify`'s `orphan` predicate
(`packages/payments/src/reconcile.ts`), and the existing orphan self-heal reverses it. A customer who
paid for a sale that never completed, or who was charged twice because staff retried, is refunded
without anyone intervening. This design relies on that behaviour rather than reimplementing it.

## 4. Webhooks are an accelerator, not a requirement

Polling is the floor because it works in every deployment with no extra infrastructure. Had the
outcome been available *only* by webhook, a counter sale would have required a publicly reachable
endpoint, breaking a property the architecture claims explicitly — *"No inbound exposure, no port
forwarding, no static IP"*
([2026-07-18-pos-architecture-design.md](2026-07-18-pos-architecture-design.md) §5).

Webhooks are still worth having: they collapse the indeterminate window from "next scheduler tick" to
seconds, which is the window in which a customer may be double-charged. The subscription is
**per checkout**, via a `return_url` on the create call, so the adapter simply omits it when no
endpoint is configured. Cloud tenants get it by default; a local server syncing to the cloud can
route the resolution back down the existing sync tree; a no-cloud deployment uses the tunnel opt-in
the architecture already documents.

Wiring it is **deferred** — polling makes it optional, and optional work is not launch work.

## 5. Reversals and capabilities

`POST /v0.1/me/refund/{txn_id}` refunds *"either in full or partially"*, so
`capabilities.partialRefund` is `true`. Whether `void` — a same-day reversal, distinct from a refund
in Stripe's model — maps onto the same endpoint is **unverified** (§7).

## 6. Scope

**In this cycle:**

- `resolvePending` added to `PaymentProvider`, with all-zeros implementations on the three existing
  Stripe adapters.
- `@waitron/payments-sumup`: `SumUpCloudProvider`, a narrow `SumUpClient` seam (create checkout, get
  transaction, refund), a hermetic `FakeSumUpClient`, and the real binding coverage-excluded.
- RLS and wiring tests, following `packages/payments-stripe`'s existing layout.

**Deferred, each with a reason:**

- **The SumUp reconciler.** Stripe landed adapter first and reconciler later, and `resolvePending`
  covers the risk that motivated this design. The reconciler catches what polling cannot see.
- **Webhook wiring** (§4).
- **The Square Terminal adapter** — the same shape, once this one has run in a shop.
- **Till → reader provisioning.** An injected resolver, exactly as Mode 2b deferred it.

## 7. Unverified — do not build on these without checking

Listed because the CLAUDE.md §1 rule applies to vendor documentation as much as to our own code.

1. **Whether we may _supply_ `client_transaction_id` rather than only read it back.** What is verified
   is that the checkout response carries it and that the transactions endpoint accepts it as a lookup
   parameter. If we can supply it, a retried `collect` is idempotent at the vendor; if not, the
   adapter must store the returned id before it can poll, which widens the crash window between the
   push and the first poll.
2. **Whether reader checkouts emit webhooks with the same signing as online payments.** The
   HMAC-SHA-256 signature, the 9-retry exponential backoff and the ignore-unknown-events guidance are
   documented for SumUp's *online payments* webhooks. The terminal-payments webhook page 404s.
   `verifyAndParse`'s contract is *"throws on a bad signature"*, which is only honourable if reader
   events are signed.
3. **Whether `void` maps onto the refund endpoint** (§5).
4. **Whether standalone operation survives Cloud API pairing**, carried over from the hardware spec
   §7 — it decides whether the outage path in that document is real. Square's Terminal API disables
   external printer connections while paired, so pairing changing device behaviour is not
   hypothetical.

## 8. Provenance

All read 2026-07-30. Every external claim in this document appears here, not only the numeric ones.

| Claim | Source |
| --- | --- |
| Cloud API pushes a card-present checkout to a Solo from any backend over HTTPS, no proximity limit; results by webhook; target device must be online; 60-second window and per-device rejection; Virtual Solo sandbox | <https://developer.sumup.com/terminal-payments/cloud-api> |
| `GET /v2.1/merchants/{merchant_code}/transactions` accepts `id`, `transaction_code`, `foreign_transaction_id`, `client_transaction_id`; returns `status` of `SUCCESSFUL`/`CANCELLED`/`FAILED`/`PENDING`/`REFUNDED` plus `amount` | <https://developer.sumup.com/api/transactions/get> |
| `POST /v0.1/me/refund/{txn_id}` refunds in full or partially | <https://developer.sumup.com/api/transactions> |
| Webhook subscription is per checkout via `return_url`; HMAC-SHA-256 signature; retried up to 9 times with exponential backoff; ignore unknown events — **documented for online payments, not confirmed for reader checkouts** | <https://developer.sumup.com/online-payments/webhooks> |
| Square Terminal API is the same topology — device-code pairing, `terminal.checkout.updated` webhook or polling; split tender is *"multiple Terminal checkout requests"* | <https://developer.squareup.com/docs/terminal-api/overview> |

Internal references — `PaymentProvider`, `PaymentState`, `insertAttempting`/`captureAttempting`/
`failAttempting`, `classify`'s `orphan` predicate — are cited inline by file and hold as of
`225e75a`.
