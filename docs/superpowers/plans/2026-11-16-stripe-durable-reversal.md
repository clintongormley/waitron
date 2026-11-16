# Stripe durable reconciler reversal

Plan only: Claude review and watcher clearance precede building. No owner design approval is claimed.

**Request:** STRIPE-DURABLE-REVERSAL in `/Users/clintongormley/waitron-campaign-f/queue.md`: “Record the attempt before sending, reuse its key on a retry, and settle an uncertain outcome from Stripe's own record rather than a new refund”.

**Finish line:** a later scheduled sweep, including after restart and outside the original period, records a reversal whose provider reply or local write was lost, without another refund key.

## Smallest route

Reuse the committed `payments.reconcile_remediated_at` claim before send (`reconcile.ts:386–428`), payment ID for `sr_<paymentId>`, and refund metadata `reconcile_payment_id`. No migration or pending refund row. Preserve abandoned/captured/hold/drift gates and concurrent claim tests. Ordinary terminal/on-device reversal calls, bill refunds, SumUp, invoices, fiscal records and UI stay outside this change.

Use `listAbandonedRefundOutcomes`, not a new query/export. Add payment ID and a failed-refund indicator to its existing projection; Stripe skips confirmed/failed rows. Inside `StripeReconciler`, recover marked rows before the ordinary period audit. Reuse `getPaymentByRef`, `recordRefund`, `recordFailedRefund` and short outcome transactions with a final terminal-state check. Network calls stay outside transactions.

Extract existing `StripeTerminalProvider.sendRefund`/`lookupRefund` logic and status/refusal helpers into `refund.ts`, parameterising the metadata key; provider delegates without changing its contract. Reconciler uses the same helpers. Its lookup treats refunds without matching metadata as ambiguous, with no send; bill-refund lookup retains its current matching behavior. Preserve missing-status/5xx uncertainty and lookup after 4xx; a documented refusal is terminal only after one HTTP attempt and no conflicting evidence.

A matching succeeded refund records its provider ID once; failed/canceled or a definite documented refusal records one failed outcome. Pending, ambiguous, unknown or unreadable evidence remains unconfirmed. An unpaid hosted session records one terminal failure with no send, preserving the existing subsequent-sweep behavior. Resolve paid hosted sessions through the existing report client. Send the saved captured amount explicitly; correct the old “no amount” comment.

Lookup precedes recovery resend. Only resend the same key when claim age is non-negative and under 24 hours; older attempts are lookup-only. Automatic retry is deliberate under the request. Only a fresh uncertain attempt asks for one re-sweep in one hour; recovery never schedules successors, so stuck rows rely on the daily cadence. Fold recovery into existing remediated/failures/unconfirmed counts and raise the existing remediation-failed incident for new terminal failures.

## Build and focused proof

Write each regression, observe its expected failure, then implement minimally:

- `packages/payments/src/store.ts`, `store.test.ts`: extend the existing marked-outcome reader/test for payment ID and failed outcome; preserve its provider isolation and existing semantics. Update permanent-marker prose in `reconcile.ts` and `schema/payments.ts`.
- `packages/payments-stripe/src/{refund,provider,reconciler}.ts`: narrow the account refund seat to existing `createRefund`/`listRefunds`. Update affected doubles/assertions in `reconciler.test.ts`, `stripe-report-client.test.ts`, `apps/server/src/boot.payments-off-alerts.test.ts`; run `provider.test.ts` for unchanged send/lookup behavior.
- Real-database reconciler tests own committed reservation/key-at-send, lost reply followed by a fresh reconciler/later period, pending-to-success, failed/refused terminal outcome, unreadable/ambiguous evidence, expired/negative-age no-resend and bounded scheduling. Reuse FakeStripe's lost-reply/key-replay support; no child-process fixture. Preserve hosted/terminal, unpaid-session, held/drift and concurrency assertions. SDK HTTP/pagination matrices stay in `stripe-client.test.ts`.

## Completion and size

Run the named changed files, payments `reconcile.concurrency.test.ts` and Stripe `stripe-client.test.ts`, then normal hook and scoped CI. Delete this completed backlog gap and stale W44 wording only after proof. No provider API calls. Verified 16 November: [Stripe API v1](https://docs.stripe.com/api/idempotent_requests) may prune keys ‘after they’re at least 24 hours old’; existing 24-hour policy is conservative.

Forecast handwritten production +125–160/−20–35; tests +150–200/−10–20; support and generated lines zero. Source-checked separate Sol-high draft, then driver corrections accepting Claude's smaller route. Watcher clearance pending.
